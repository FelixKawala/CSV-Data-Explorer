// where imported datasets live between visits
//
// IndexedDB, not localStorage: localStorage caps around 5 MB, is string-only and
// blocks the main thread. View configs stay in localStorage under their existing
// keys, untouched, so saved views survive this.
//
// What is stored is the raw CSV text plus the recipe that turned it into a
// dataset -- not the built columns. Re-deriving costs milliseconds and keeps the
// provenance auditable: this chart came from these bytes through these steps.

const DB_NAME = 'viz-explorer';
const DB_VERSION = 1;
const LS_ACTIVE_DATASET = 'viz-active-dataset';

// An in-memory implementation with the same interface, so the suites can drive
// the import pipeline without an IndexedDB shim.
function makeMemoryStore() {
  const datasets = new Map();
  return {
    kind: 'memory',
    async list() {
      return Array.from(datasets.values()).map(d => ({
        id: d.id, name: d.name, createdAt: d.createdAt, recipe: d.recipe, sources: d.sources,
      }));
    },
    async get(id) { return datasets.get(id) || null; },
    async put(rec) { datasets.set(rec.id, rec); return rec; },
    async remove(id) { datasets.delete(id); },
  };
}

function makeIdbStore() {
  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('datasets', mode);
      const store = t.objectStore('datasets');
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  return {
    kind: 'indexeddb',
    list() { return tx('readonly', s => s.getAll()); },
    get(id) { return tx('readonly', s => s.get(id)); },
    put(rec) { return tx('readwrite', s => s.put(rec)).then(() => rec); },
    remove(id) { return tx('readwrite', s => s.delete(id)); },
  };
}

function makeStore() {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) return makeIdbStore();
  } catch (e) { /* fall through */ }
  return makeMemoryStore();
}

let STORE = makeStore();
function setStore(s) { STORE = s; }        // tests inject the memory implementation

function activeDatasetId() {
  try { return localStorage.getItem(LS_ACTIVE_DATASET); } catch (e) { return null; }
}
function setActiveDatasetId(id) {
  try {
    if (id === null) localStorage.removeItem(LS_ACTIVE_DATASET);
    else localStorage.setItem(LS_ACTIVE_DATASET, id);
  } catch (e) { /* private mode */ }
}

// ---- recipe -> dataset ------------------------------------------------------
// A recipe is everything needed to rebuild a dataset from its sources: the
// per-column decisions, whether several files were unioned, and -- when the CSV
// is not tidy -- how to get dimensions out of the column names and the file
// paths.
//
//   { name,
//     columns:   [{source, name, label, role, format, agg, labelOverride}],
//     sourceDim: null | string,
//     fill:      null | string,                                   // absent columns
//     melt:      null | { pattern, fields, measure, measures },   // column names
//     path:      null | { levels, pattern },                      // file paths
//     custom:    [ ... ] }                                        // page-defined measures
//
// `melt` and `path` are optional and a recipe written before they existed has
// neither. The loop below is written so that absent means "the degenerate case",
// not "the old branch" -- there is one code path, and a tidy CSV takes it with
// the reshape steps doing nothing.

// A melt turns wide columns into rows: the pattern's fields become dimensions
// that vary WITHIN a CSV row, and one of them may name the measure.
function compileMeltPlan(spec) {
  if (!spec || !spec.pattern) return null;
  const pattern = compilePattern(spec.pattern);
  if (!pattern.ok) return null;
  const dims = (spec.fields || [])
    .filter(f => f && f.include !== false && f.field !== PATTERN_MEASURE_FIELD)
    .map(f => ({
      field: f.field,
      key: f.key || f.field,
      label: f.label || f.key || f.field,
      labelOverride: f.labelOverride || {},
    }));
  const fallback = Object.assign(
    { value: '', key: 'value', label: 'Value', format: 'number', agg: 'mean' },
    spec.measure || {});
  const declared = (spec.measures || []).map(m => Object.assign(
    { format: 'number', agg: 'mean' }, m,
    { key: m.key || m.value, label: m.label || m.key || m.value }));
  return { pattern, dims, fallback, declared };
}

// Path fields are constant for every row of a file: the directory levels the
// user named, plus an optional pattern over the file's own name.
function compilePathPlan(spec) {
  if (!spec) return null;
  const levels = (spec.levels || []).filter(l => l && l.key);
  const pat = spec.pattern && spec.pattern.spec ? compilePattern(spec.pattern.spec) : null;
  const patFields = (pat && pat.ok ? (spec.pattern.fields || []) : [])
    .filter(f => f && f.include !== false)
    .map(f => ({ field: f.field, key: f.key || f.field, label: f.label || f.key || f.field,
      labelOverride: f.labelOverride || {} }));
  if (!levels.length && !patFields.length) return null;
  const on = (spec.pattern && spec.pattern.on) || 'stem';
  const dims = levels.map(l => ({
    key: l.key, label: l.label || l.key, index: l.index, labelOverride: l.labelOverride || {},
  })).concat(patFields);
  return {
    dims,
    valuesFor(path) {
      const segs = String(path || '').split('/');
      const out = {};
      levels.forEach(l => { out[l.key] = segs[l.index] === undefined ? '' : segs[l.index]; });
      if (patFields.length) {
        const base = segs[segs.length - 1] || '';
        const subject = on === 'path' ? String(path || '')
          : on === 'basename' ? base
            : base.replace(/\.[^.]+$/, '');
        const m = matchPattern(pat, subject);
        patFields.forEach(f => { out[f.key] = m ? (m.fields[f.field] || '') : ''; });
      }
      return out;
    },
  };
}

// Which measure a matched column lands in. An empty `measure` capture means the
// fallback, which is what lets one pattern separate a count column from a rate
// column: `(?<measure>MemAcc)?` fires on one and not the other.
function meltMeasureFor(melt, matched, byValue, appended, taken) {
  const captured = melt.pattern.hasMeasure ? (matched.fields[PATTERN_MEASURE_FIELD] || '') : '';
  if (!captured) return { spec: melt.fallback, fallback: true };
  let spec = byValue[captured];
  if (!spec) {
    // A level that was not declared at import time still imports rather than
    // being dropped; declared ones keep their order so METRICS[0] is stable.
    let key = captured;
    while (taken[key]) key += '_value';
    spec = { value: captured, key, label: captured, format: 'number', agg: 'mean' };
    byValue[captured] = spec;
    taken[key] = true;
    appended.push(spec);
  }
  return { spec, fallback: false };
}

// What a file that has not got a column contributes to it. Files with different
// columns can be unioned deliberately, and then the gap needs a value: a
// dimension takes the text (it has to take something, or the row falls outside
// the declared domain and is dropped whole), a measure takes it only if it is a
// number, because "no data" and "zero" are different claims about a measurement.
// One string serves both roles, because the row loop already asks whether a
// cell is a number: "n/a" leaves a measure empty and labels a dimension, "0"
// fills both in. That is why it is offered as a value rather than as a choice
// between blank and zero.
function fillCell(recipe) {
  return recipe.fill === undefined || recipe.fill === null ? '' : String(recipe.fill);
}

function datasetFromRecord(rec) {
  const recipe = rec.recipe;
  const cols = recipe.columns || [];
  const melt = compileMeltPlan(recipe.melt);
  const pathPlan = compilePathPlan(recipe.path);
  const dims = [];
  const measures = [];
  const rows = [];

  // Every bucket is declared from the recipe, before any file is read: creating
  // them lazily would let whichever file happens to be first decide the order
  // of a dimension's values.
  const dimValues = {};
  const need = k => (dimValues[k] || (dimValues[k] = []));
  const seen = (k, v) => { const a = need(k); if (a.indexOf(v) === -1) a.push(v); };
  if (recipe.sourceDim) need(recipe.sourceDim);
  if (pathPlan) pathPlan.dims.forEach(d => need(d.key));
  cols.forEach(c => { if (c.role === 'dimension') need(c.name); });
  if (melt) melt.dims.forEach(d => need(d.key));

  // measure bookkeeping for the melt
  const byValue = {};
  const appended = [];
  const takenKeys = {};
  if (melt) {
    Object.keys(dimValues).forEach(k => { takenKeys[k] = true; });
    cols.forEach(c => { if (c.role === 'measure') takenKeys[c.name] = true; });
    melt.declared.forEach(m => { byValue[m.value] = m; takenKeys[m.key] = true; });
  }
  let usedFallback = false;

  rec.sources.forEach(srcRec => {
    const parsed = parseCsv(srcRec.text, recipe.parse);
    const raw = parsed.header;              // the melt matches these
    const header = dedupeHeader(parsed.header);   // id columns are found by these
    // Matching the deduped names would make a repeated wide header fail `^…$`
    // and vanish; finding id columns by the raw names would reinstate the
    // shadowing that dedupeHeader exists to prevent. Both halves are needed.

    const constants = {};
    if (recipe.sourceDim) constants[recipe.sourceDim] = srcRec.label || srcRec.filename;
    if (pathPlan) {
      const got = pathPlan.valuesFor(srcRec.path || srcRec.filename);
      Object.keys(got).forEach(k => { constants[k] = got[k]; });
    }
    Object.keys(constants).forEach(k => seen(k, constants[k]));

    const idIdx = cols.map(c => (c.role === 'ignore' ? -1 : header.indexOf(c.source)));
    // A column this file has not got still has to be a value of its dimension,
    // or every row of the file falls outside the declared domain and is dropped
    // whole -- silently, since makeDataset simply skips a tuple it cannot code.
    const gap = fillCell(recipe);
    cols.forEach((c, ci) => {
      if (c.role === 'dimension' && idIdx[ci] === -1) seen(c.name, gap.trim());
    });

    // Columns that share a dimension tuple become ONE emitted row carrying
    // several measures. Emitting one row per column instead would make the
    // {measure} variants collide and be averaged together.
    const groups = [];
    if (melt) {
      const bySig = {};
      for (let i = 0; i < raw.length; i++) {
        const matched = matchPattern(melt.pattern, raw[i]);
        if (!matched) continue;
        const picked = meltMeasureFor(melt, matched, byValue, appended, takenKeys);
        if (picked.fallback) usedFallback = true;
        const vals = melt.dims.map(d => {
          const v = matched.fields[d.field];
          return v === undefined ? '' : v;
        });
        vals.forEach((v, k) => seen(melt.dims[k].key, v));
        const sig = vals.join(SIG_SEP);
        let g = Object.prototype.hasOwnProperty.call(bySig, sig) ? bySig[sig] : null;
        if (!g) { g = { vals, cells: [], keys: {} }; bySig[sig] = g; groups.push(g); }
        if (g.keys[picked.spec.key]) {
          // two columns claim the same tuple AND measure: keep them in separate
          // rows so the collapse is averaged and counted, not silently dropped
          groups.push({ vals, cells: [{ i, spec: picked.spec }], keys: {} });
        } else {
          g.keys[picked.spec.key] = true;
          g.cells.push({ i, spec: picked.spec });
        }
      }
    }

    parsed.rows.forEach(cells => {
      const base = {};
      Object.keys(constants).forEach(k => { base[k] = constants[k]; });
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (c.role === 'ignore') continue;
        const cell = idIdx[ci] === -1 ? gap : cells[idIdx[ci]];
        if (c.role === 'dimension') {
          const v = String(cell).trim();
          base[c.name] = v;
          seen(c.name, v);
        } else {
          base[c.name] = isNumeric(cell) ? Number(cell) : null;
        }
      }
      if (!melt) { rows.push(base); return; }
      groups.forEach(g => {
        const row = {};
        Object.keys(base).forEach(k => { row[k] = base[k]; });
        for (let k = 0; k < melt.dims.length; k++) row[melt.dims[k].key] = g.vals[k];
        g.cells.forEach(cell => {
          const v = cells[cell.i];
          row[cell.spec.key] = isNumeric(v) ? Number(v) : null;
        });
        rows.push(row);
      });
    });
  });

  // Emission order is [source, path, id columns, melt]: coarsest and constant
  // per file first (they read best as facets), row identity next, within-row
  // variation last (finest, best as the series colour). defaultZones() takes
  // the first as the facet and the last as the series, so the order the pattern
  // is written in becomes the axis order.
  if (recipe.sourceDim) {
    dims.push({ key: recipe.sourceDim, label: recipe.sourceLabel || 'Source',
      values: dimValues[recipe.sourceDim] });
  }
  if (pathPlan) {
    pathPlan.dims.forEach(d => dims.push({
      key: d.key, label: d.label, values: dimValues[d.key], labelOverride: d.labelOverride,
    }));
  }
  cols.forEach(c => {
    if (c.role === 'dimension') {
      dims.push({ key: c.name, label: c.label || c.name, values: dimValues[c.name], labelOverride: c.labelOverride });
    } else if (c.role === 'measure') {
      measures.push({ key: c.name, label: c.label || c.name, agg: c.agg || 'mean', format: makeFormat(c.format || 'number') });
    }
  });
  if (melt) {
    melt.dims.forEach(d => dims.push({
      key: d.key, label: d.label, values: dimValues[d.key], labelOverride: d.labelOverride,
    }));
    // The fallback goes first when it was used: with a pattern like the defbl
    // one it holds the main measurement and the captures are the extras.
    const meltMeasures = (usedFallback ? [melt.fallback] : [])
      .concat(melt.declared.filter(m => m.key !== melt.fallback.key))
      .concat(appended);
    meltMeasures.forEach(m => measures.push({
      key: m.key, label: m.label || m.key, agg: m.agg || 'mean', format: makeFormat(m.format || 'number'),
    }));
  }

  const ds = makeDataset({ name: rec.name, dims, measures, rows });
  applyMeasureOverrides(ds, recipe.measureOverrides);
  attachCustomMeasures(ds, recipe.custom);
  attachSourceText(ds, rec.sources);
  return ds;
}

// The files as imported, kept beside the dataset so a figure can be exported
// with its source rather than only with the numbers that were plotted.
//
// Capped, because this is the one thing here that holds a second copy of every
// byte the user handed over: a folder import is already the way to make this
// page fall over, and a hundred files behind a figure would be a hundred tabs
// nobody wants anyway.
const SOURCE_KEEP_FILES = 8;
const SOURCE_KEEP_BYTES = 4 * 1024 * 1024;
function attachSourceText(ds, sources) {
  if (!Array.isArray(sources) || !sources.length) return;
  let bytes = 0;
  sources.forEach(s => { bytes += String(s.text || '').length; });
  if (sources.length > SOURCE_KEEP_FILES || bytes > SOURCE_KEEP_BYTES) {
    ds.sourcesNote = sources.length + ' imported files (' + Math.round(bytes / 1024)
      + ' KB) — too many to attach to a figure.';
    return;
  }
  ds.sources = sources.map(s => ({
    name: s.filename || s.path || 'source.csv',
    text: String(s.text || ''),
  }));
}

// A name or a format the user changed after importing. Stored as the
// difference from what the recipe declared, so re-importing the same file with
// a better recipe does not silently keep an old override alive under a name
// that no longer exists.
function applyMeasureOverrides(ds, overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  Object.keys(overrides).forEach(key => {
    const m = ds.measureByKey[key];
    const o = overrides[key];
    if (!m || !o) return;
    if (o.label) m.label = String(o.label);
    if (o.format && FORMATS[o.format]) m.format = makeFormat(o.format);
  });
}

function persistMeasureOverrides() {
  const id = activeDatasetId();
  if (!id || !DS) return Promise.resolve(false);
  const specs = measureOverrideSpecs();
  return Promise.resolve()
    .then(() => STORE.get(id))
    .then(rec => {
      if (!rec || !rec.recipe) return false;
      rec.recipe.measureOverrides = specs;
      return STORE.put(rec).then(() => true);
    })
    .catch(() => false);
}

// What a stored recipe will produce, without building it. The dataset cards on
// the Data tab count dimensions and measures, and with a reshape those no
// longer live in `columns` alone -- so both readings come from here.
function recipeShape(recipe) {
  const cols = (recipe && recipe.columns) || [];
  let dimCount = cols.filter(c => c.role === 'dimension').length;
  let measureCount = cols.filter(c => c.role === 'measure').length;
  if (recipe && recipe.sourceDim) dimCount++;
  const pathPlan = compilePathPlan(recipe && recipe.path);
  if (pathPlan) dimCount += pathPlan.dims.length;
  const melt = compileMeltPlan(recipe && recipe.melt);
  if (melt) {
    dimCount += melt.dims.length;
    // the fallback may or may not be used; count declared levels, or one
    measureCount += melt.declared.length || 1;
  }
  return { dims: dimCount, measures: measureCount };
}

// ---- measures the user defined on the page ---------------------------------
// A comparison or a calculated measure holds no data, only a rule, so it is
// stored with the recipe rather than with the columns. A formula is stored as
// the text the user wrote and recompiled on load: the text is the record, and
// recompiling re-checks that every name it mentions still resolves.
function serializeCustomMeasure(m) {
  return {
    key: m.key,
    label: m.label,
    format: m.format ? m.format.key : 'number',
    derived: m.derived || null,
    formula: m.formula ? { expr: m.formula.expr } : null,
  };
}

// Order matters: a formula may refer to a measure defined just before it, so
// each one is attached before the next is compiled.
function attachCustomMeasures(ds, specs) {
  if (!Array.isArray(specs)) return [];
  const dropped = [];
  specs.forEach(spec => {
    if (!spec || !spec.key || ds.measureByKey[spec.key]) return;
    let measure = null;
    if (spec.derived) {
      if (!ds.measureByKey[spec.derived.base]) { dropped.push(spec.label); return; }
      measure = { key: spec.key, label: spec.label, format: makeFormat(spec.format), derived: spec.derived };
    } else if (spec.formula) {
      try {
        measure = {
          key: spec.key,
          label: spec.label,
          format: makeFormat(spec.format),
          formula: compileFormula(spec.formula.expr, ds.measures, spec.format),
        };
      } catch (e) { dropped.push(spec.label); return; }
    }
    if (!measure) return;
    measure.userDefined = true;
    ds.measures.push(measure);
    ds.measureByKey[measure.key] = measure;
  });
  return dropped;
}

// Best effort: with data embedded in the page there is no stored record to
// update, and the measure still works for this visit.
function persistCustomMeasures() {
  const id = activeDatasetId();
  if (!id || !DS) return Promise.resolve(false);
  const specs = DS.measures.filter(m => m.userDefined).map(serializeCustomMeasure);
  return Promise.resolve()
    .then(() => STORE.get(id))
    .then(rec => {
      if (!rec || !rec.recipe) return false;
      rec.recipe.custom = specs;
      return STORE.put(rec).then(() => true);
    })
    .catch(() => false);
}

// The name a dataset was imported under is the file's stem, or "3 files" -- it
// says where the bytes came from and nothing about what they are. It is a label
// on a stored record, so it can simply be changed; the live dataset follows when
// it is the open one, since nothing else holds a copy of it.
function renameDataset(id, name) {
  const clean = String(name || '').trim();
  if (!clean) return Promise.resolve(false);
  return Promise.resolve()
    .then(() => STORE.get(id))
    .then(rec => {
      if (!rec) return false;
      rec.name = clean;
      return Promise.resolve(STORE.put(rec)).then(() => {
        if (DS && activeDatasetId() === id) DS.name = clean;
        return true;
      });
    })
    .catch(() => false);
}

function newDatasetId() {
  return 'ds-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
