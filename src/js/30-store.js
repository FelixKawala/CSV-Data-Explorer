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
        parts: d.parts, ui: d.ui,
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
//     columns:   [{source, name, label, role, format, agg, labelOverride,
//                  split: null | { pattern, fields }}],           // cell values
//     sourceDim: null | string,
//     fill:      null | string,                                   // absent columns
//     melt:      null | { pattern, fields, measure, measures },   // column names
//     path:      null | { levels, pattern },                      // file paths
//     custom:    [ ... ] }                                        // page-defined measures
//
// `melt`, `path` and `split` are optional and a recipe written before they
// existed has none of them. The loop below is written so that absent means "the
// degenerate case", not "the old branch" -- there is one code path, and a tidy
// CSV takes it with the reshape steps doing nothing.

// A melt turns wide columns into rows: the pattern's fields become dimensions
// that vary WITHIN a CSV row, and one of them may name the measure.
function compileMeltPlan(spec) {
  if (!spec || !(spec.pattern || spec.parts)) return null;
  const fallback = Object.assign(
    { value: '', key: 'value', label: 'Value', format: 'number', agg: 'mean' },
    spec.measure || {});
  const declared = (spec.measures || []).map(m => Object.assign(
    { format: 'number', agg: 'mean' }, m,
    { key: m.key || m.value, label: m.label || m.key || m.value }));
  // The header read as a set of parts rather than as a sequence. Every group is
  // a dimension except the one marked `measure`, which is `{measure}` by
  // another name: its parts pick the column the number lands in.
  if (spec.parts) {
    const seps = spec.parts.seps === undefined ? PART_SEPS_DEFAULT : spec.parts.seps;
    const groups = (spec.parts.groups || [])
      .filter(g => g && g.include !== false && (g.parts || []).length)
      .map(g => ({
        key: g.key || g.parts[0],
        label: g.label || g.key || g.parts[0],
        parts: g.parts.slice(),
        labelOverride: g.labelOverride || {},
        measure: !!g.measure,
      }));
    if (!groups.length) return null;
    const measureGroup = groups.filter(g => g.measure)[0] || null;
    const dims = groups.filter(g => !g.measure).map(g => ({
      field: g.key, key: g.key, label: g.label, labelOverride: g.labelOverride,
    }));
    return {
      pattern: null,
      parts: { seps: seps, groups: groups, measureGroup: measureGroup },
      hasMeasure: !!measureGroup, dims: dims, fallback: fallback, declared: declared,
    };
  }
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
  return { pattern, parts: null, hasMeasure: pattern.hasMeasure, dims, fallback, declared };
}

// What one header name becomes: the value of every melt dimension at it, and
// which measure it names. Null when the melt does not claim the column at all --
// for a pattern that is a failed match, and for parts it is a name with no part
// in play, which is what keeps an id column out of a melt that would otherwise
// claim every header.
function meltReadColumn(melt, name) {
  if (!melt.parts) {
    const m = matchPattern(melt.pattern, name);
    if (!m) return null;
    return {
      fields: m.fields,
      measure: melt.hasMeasure ? (m.fields[PATTERN_MEASURE_FIELD] || '') : '',
    };
  }
  const seps = melt.parts.seps;
  const fields = {};
  let claimed = false;
  melt.parts.groups.forEach(g => {
    const hit = g.parts.filter(p => labelHasPart(name, p, seps))[0];
    if (hit) claimed = true;
    if (!g.measure) fields[g.key] = partValueAt(g, name, seps);
  });
  if (!claimed) return null;
  const mg = melt.parts.measureGroup;
  const named = mg ? (mg.parts.filter(p => labelHasPart(name, p, seps))[0] || '') : '';
  return { fields: fields, measure: named };
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

// A column's own values can carry dimensions too: the row labels are as often
// compound as the header labels are -- `16x4` is a block width and a height,
// `harris-corner-tiled` an application and a variant. This is the melt's
// counterpart for the other axis, and the same pattern language drives it.
//
// One plan per column that has a split, keyed by the column's index so the row
// loop can find it without another scan.
// Two readings, because labels are written two ways. A pattern reads one by
// position; `parts` reads one as a set of separator-cut flags, where each part
// becomes a dimension of its own. Both end up as a list of fields the row loop
// fills in, so nothing downstream knows which reading produced them.
function compileSplitPlans(cols) {
  const plans = [];
  (cols || []).forEach((c, ci) => {
    const spec = c && c.split;
    // a split on a measure column would be splitting a number: nothing to do
    if (!spec || (c.role === 'measure')) return;
    if (spec.parts) {
      // Every group is declared in the recipe rather than re-derived from the
      // data: the grouping was a proposal the user accepted or changed, and
      // re-running the proposal on reload could quietly regroup a stored
      // dataset the moment a value was added to it.
      const seps = spec.parts.seps === undefined ? PART_SEPS_DEFAULT : spec.parts.seps;
      const groups = (spec.parts.groups || [])
        .filter(g => g && g.include !== false && (g.parts || []).length)
        .map(g => ({
          key: g.key || g.parts[0],
          label: g.label || g.key || g.parts[0],
          parts: g.parts.slice(),
          labelOverride: g.labelOverride || {},
        }));
      if (!groups.length) return;
      plans.push({ index: ci, source: c.source, seps: seps, groups: groups,
        fields: groups.map(g => ({ key: g.key, label: g.label, labelOverride: g.labelOverride })) });
      return;
    }
    if (!spec.pattern) return;
    const pattern = compilePattern(spec.pattern);
    if (!pattern.ok) return;
    const fields = (spec.fields || [])
      .filter(f => f && f.field && f.include !== false)
      .map(f => ({
        field: f.field,
        key: f.key || f.field,
        label: f.label || f.key || f.field,
        labelOverride: f.labelOverride || {},
      }));
    if (!fields.length) return;
    plans.push({ index: ci, source: c.source, pattern: pattern, fields: fields });
  });
  return plans;
}

// What one cell becomes. A value the pattern does not match keeps its whole
// text under the FIRST field rather than emptying every one of them: two
// unmatched labels that differ stay two rows, where blanking them would fold
// every leftover onto one tuple and average it -- silently, and only for the
// rows the pattern was worst at.
//
// A parts split cannot fail to match: a label either carries a part or does
// not, and "does not" is a value of that dimension like any other.
function splitCellValues(plan, cell) {
  const text = String(cell === undefined || cell === null ? '' : cell).trim();
  const out = {};
  if (plan.groups) {
    plan.groups.forEach(g => { out[g.key] = partValueAt(g, text, plan.seps); });
    return out;
  }
  const m = matchPattern(plan.pattern, text);
  plan.fields.forEach((f, i) => {
    if (m) {
      const v = m.fields[f.field];
      out[f.key] = v === undefined ? '' : v;
    } else {
      out[f.key] = i === 0 ? text : '';
    }
  });
  return out;
}

// Which measure a matched column lands in. An empty `measure` capture means the
// fallback, which is what lets one pattern separate a count column from a rate
// column: `(?<measure>MemAcc)?` fires on one and not the other.
function meltMeasureFor(melt, matched, byValue, appended, taken) {
  const captured = melt.hasMeasure ? (matched.measure || '') : '';
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

// A record holds either one recipe over its own files, or several parts, each
// with its own recipe over its own files -- which is what combining two stored
// datasets produces. One part is the degenerate case and takes the same path.
function recordParts(rec) {
  if (Array.isArray(rec.parts) && rec.parts.length) {
    return rec.parts.map(p => ({
      name: p.name, recipe: p.recipe || {}, sources: p.sources || [],
    }));
  }
  return [{ name: rec.name, recipe: rec.recipe || {}, sources: rec.sources || [] }];
}

function buildPartSpec(recipe, srcList) {
  const cols = recipe.columns || [];
  const melt = compileMeltPlan(recipe.melt);
  const pathPlan = compilePathPlan(recipe.path);
  const splits = compileSplitPlans(cols);
  const splitAt = [];
  splits.forEach(s => { splitAt[s.index] = s; });
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
  splits.forEach(s => s.fields.forEach(f => need(f.key)));
  if (melt) melt.dims.forEach(d => need(d.key));

  // measure bookkeeping for the melt
  const byValue = {};
  const appended = [];
  const takenKeys = {};
  if (melt) {
    Object.keys(dimValues).forEach(k => { takenKeys[k] = true; });
    cols.forEach(c => { if (c.role === 'measure') takenKeys[c.name] = true; });
    melt.declared.forEach(m => { byValue[m.value] = m; takenKeys[m.key] = true; });
    // The fallback's key is a default -- "value" unless it was named -- so
    // whatever already answers to it owns it and the fallback moves aside.
    // Two measures on one key would write the same field of the same row and
    // average two different columns together; a measure on a DIMENSION's key
    // overwrote the dimension value, which put every row outside the declared
    // domain and dropped the lot, silently and completely.
    while (takenKeys[melt.fallback.key]) melt.fallback.key += '_value';
    takenKeys[melt.fallback.key] = true;
  }
  let usedFallback = false;

  srcList.forEach(srcRec => {
    let parsed = parseCsv(srcRec.text, recipe.parse);
    // A stored preselect is replayed before anything else is read: the recipe
    // records what came in, so the dataset is rebuilt from exactly that.
    const stored = ((recipe.parse || {}).preselect || {})[srcRec.path || srcRec.filename];
    if (stored) parsed = applySelection(parsed, stored);
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

    // Looked up even for an ignored column: its own value is dropped, but a
    // split still reads the cell, which is how a column can contribute its
    // parts and not itself.
    const idIdx = cols.map(c => header.indexOf(c.source));
    // A column this file has not got still has to be a value of its dimension,
    // or every row of the file falls outside the declared domain and is dropped
    // whole -- silently, since makeDataset simply skips a tuple it cannot code.
    const gap = fillCell(recipe);
    cols.forEach((c, ci) => {
      if (idIdx[ci] !== -1) return;
      if (c.role === 'dimension') seen(c.name, gap.trim());
      const plan = splitAt[ci];
      if (!plan) return;
      const got = splitCellValues(plan, gap);
      plan.fields.forEach(f => seen(f.key, got[f.key]));
    });

    // Columns that share a dimension tuple become ONE emitted row carrying
    // several measures. Emitting one row per column instead would make the
    // {measure} variants collide and be averaged together.
    const groups = [];
    if (melt) {
      const bySig = {};
      for (let i = 0; i < raw.length; i++) {
        const matched = meltReadColumn(melt, raw[i]);
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
        const cell = idIdx[ci] === -1 ? gap : cells[idIdx[ci]];
        const plan = splitAt[ci];
        if (plan) {
          const got = splitCellValues(plan, cell);
          plan.fields.forEach(f => { base[f.key] = got[f.key]; seen(f.key, got[f.key]); });
        }
        if (c.role === 'ignore') continue;
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
  cols.forEach((c, ci) => {
    if (c.role === 'dimension') {
      dims.push({ key: c.name, label: c.label || c.name, values: dimValues[c.name], labelOverride: c.labelOverride });
    } else if (c.role === 'measure') {
      measures.push({ key: c.name, label: c.label || c.name, agg: c.agg || 'mean', format: makeFormat(c.format || 'number') });
    }
    // A column's parts sit where the column itself sits: they are row identity,
    // the same as the column was, and the pattern's order is their order.
    const plan = splitAt[ci];
    if (plan) {
      plan.fields.forEach(f => dims.push({
        key: f.key, label: f.label, values: dimValues[f.key], labelOverride: f.labelOverride,
      }));
    }
  });
  if (melt) {
    melt.dims.forEach(d => dims.push({
      key: d.key, label: d.label, values: dimValues[d.key], labelOverride: d.labelOverride,
    }));
    // The fallback goes first when it was used: with a pattern like the defbl
    // one it holds the main measurement and the captures are the extras. Only
    // when it was used -- a declared level whose text happens to be "value" is
    // a measure of the file's own, and dropping it as a duplicate of the
    // unused fallback took its column out of the dataset without saying so.
    const meltMeasures = [];
    const emitted = {};
    const emit = m => {
      if (!m || emitted[m.key]) return;
      emitted[m.key] = true;
      meltMeasures.push(m);
    };
    if (usedFallback) emit(melt.fallback);
    melt.declared.forEach(emit);
    appended.forEach(emit);
    meltMeasures.forEach(m => measures.push({
      key: m.key, label: m.label || m.key, agg: m.agg || 'mean', format: makeFormat(m.format || 'number'),
    }));
  }

  return { dims: dims, measures: measures, rows: rows };
}

// Several parts become one dataset on the union of their dimensions and their
// measures. A row from a part that has not got a dimension takes the fill value
// for it -- the same rule, and the same reason, as a file missing a column
// inside one part: a tuple that cannot be coded is dropped whole.
function mergeSpecs(specs, parts, recipe) {
  const gap = (recipe.fill === undefined || recipe.fill === null ? 'n/a' : String(recipe.fill)).trim();
  const dims = [];
  const dimAt = {};
  const measures = [];
  const mAt = {};
  const rows = [];
  const partDim = recipe.partDim || null;
  if (partDim) {
    dimAt[partDim] = 0;
    dims.push({ key: partDim, label: recipe.partLabel || 'Dataset',
      values: parts.map(p => p.name) });
  }
  specs.forEach(spec => {
    spec.dims.forEach(d => {
      if (dimAt[d.key] === undefined) {
        dimAt[d.key] = dims.length;
        dims.push({ key: d.key, label: d.label, values: d.values.slice(),
          labelOverride: d.labelOverride });
        return;
      }
      // Same key, so the same dimension: the domains are unioned in the order
      // they were declared. This holds for the Dataset dimension too, where a
      // part that already had one of its own simply widens it.
      const into = dims[dimAt[d.key]].values;
      d.values.forEach(v => { if (into.indexOf(v) === -1) into.push(v); });
    });
    // First declaration wins: two parts calling a measure the same thing are
    // taken at their word, and the second one's label and format are its own
    // business only where the first said nothing.
    spec.measures.forEach(m => {
      if (mAt[m.key] !== undefined) return;
      mAt[m.key] = measures.length;
      measures.push(m);
    });
  });
  specs.forEach((spec, i) => {
    const name = parts[i].name;
    const have = {};
    spec.dims.forEach(d => { have[d.key] = true; });
    const missing = dims.filter(d => d.key !== partDim && !have[d.key]);
    missing.forEach(d => { if (d.values.indexOf(gap) === -1) d.values.push(gap); });
    spec.rows.forEach(row => {
      if (partDim) row[partDim] = name;
      missing.forEach(d => { row[d.key] = gap; });
      rows.push(row);
    });
  });
  return { dims: dims, measures: measures, rows: rows };
}

function datasetFromRecord(rec) {
  const parts = recordParts(rec);
  const recipe = rec.recipe || {};
  const specs = parts.map(p => buildPartSpec(p.recipe, p.sources));
  const spec = specs.length === 1 ? specs[0] : mergeSpecs(specs, parts, recipe);
  const ds = makeDataset({ name: rec.name, dims: spec.dims, measures: spec.measures, rows: spec.rows });
  // Where it came from, carried on the dataset itself. This is the one place a
  // record becomes a dataset, so it is the one place that knows both -- and a
  // plot that names a dataset names this id.
  ds.__id = rec.id;
  applyMeasureOverrides(ds, recipe.measureOverrides);
  attachCustomMeasures(ds, recipe.custom);
  const allSources = [];
  parts.forEach(p => p.sources.forEach(s => allSources.push(s)));
  attachSourceText(ds, allSources);
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

// ---- a recipe, read back as the decisions that wrote it ---------------------
// Editing an import means putting the review screen back up with every switch
// where it was left. A dataset imported since that was possible carries that
// state verbatim (`rec.ui`), so nothing is inferred. One imported before it
// does not, and is reconstructed from the recipe -- which holds nearly all of
// it, because the recipe IS those decisions, written in the form the row loop
// wants rather than the form the review does.
//
// What a recipe cannot say is what was switched OFF. A pattern field left out,
// a part assigned to no dimension, an ignored folder level: all three are
// simply absent from it. So a reconstructed state says so, and everything the
// recipe does not mention then reads as "excluded" rather than as "propose it
// again" -- otherwise re-opening an import would quietly reinstate the columns
// its author had dropped.
function fieldCfgFromRecipe(fields) {
  const out = {};
  (fields || []).forEach(f => {
    if (!f || !f.field) return;
    out[f.field] = {
      key: f.key || f.field,
      label: f.label || f.key || f.field,
      include: true,
      labelOverride: f.labelOverride || {},
      labelTouched: true,
    };
  });
  return out;
}

// The parts reading, inverted: every stored group's parts point back at it, and
// `defaultOff` says that a part named by none of them was one the user put
// aside. The group ids are positional because nothing outside this object reads
// them -- they identify a group only for as long as the review is open.
function partsCfgFromRecipe(spec, measureAware) {
  const cfg = {
    seps: spec.seps === undefined ? PART_SEPS_DEFAULT : spec.seps,
    assign: {}, groupCfg: {}, measureGid: null, defaultOff: true,
  };
  (spec.groups || []).forEach((g, i) => {
    if (!g) return;
    const gid = 'g' + i;
    (g.parts || []).forEach(name => { cfg.assign[name] = gid; });
    cfg.groupCfg[gid] = {
      include: true, key: g.key, label: g.label || g.key,
      labelOverride: g.labelOverride || {}, labelTouched: true,
    };
    if (measureAware && g.measure) cfg.measureGid = gid;
  });
  return cfg;
}

function meltUiFromRecipe(spec) {
  const off = {
    on: false, kind: 'template', text: '', fieldCfg: {}, measureCfg: {},
    fallback: { name: 'Value', format: 'number' },
  };
  if (!spec || !(spec.pattern || spec.parts)) return off;
  const fb = spec.measure || {};
  // A stored format is a decision, so it is marked as one: left untouched, the
  // review re-guesses a format from the column's numbers on every keystroke and
  // would overwrite the one that was chosen.
  const measureCfg = {
    '': { label: fb.label || 'Value', format: fb.format || 'number', formatTouched: true },
  };
  (spec.measures || []).forEach(m => {
    if (!m) return;
    measureCfg[m.value] = {
      label: m.label || m.value, format: m.format || 'number', formatTouched: true,
    };
  });
  const ui = {
    on: true, kind: 'template', text: '', fieldCfg: {}, measureCfg: measureCfg,
    fallback: { name: fb.label || 'Value', format: fb.format || 'number' },
  };
  if (spec.parts) {
    ui.kind = 'parts';
    ui.parts = partsCfgFromRecipe(spec.parts, true);
  } else {
    ui.kind = (spec.pattern || {}).kind || 'template';
    ui.text = (spec.pattern || {}).text || '';
    ui.fieldCfg = fieldCfgFromRecipe(spec.fields);
  }
  return ui;
}

// At most one column carries a split, so the recipe is searched for it rather
// than the review being asked which column it was about.
function splitUiFromRecipe(cols) {
  const off = { on: false, source: null, kind: 'template', text: '', fieldCfg: {} };
  const col = (cols || []).filter(c => c && c.split)[0];
  if (!col) return off;
  if (col.split.parts) {
    return { on: true, source: col.source, kind: 'parts', text: '', fieldCfg: {},
      parts: partsCfgFromRecipe(col.split.parts, false) };
  }
  const pat = col.split.pattern || {};
  return { on: true, source: col.source, kind: pat.kind || 'template',
    text: pat.text || '', fieldCfg: fieldCfgFromRecipe(col.split.fields) };
}

function pathUiFromRecipe(spec) {
  const ui = { levelCfg: {}, stem: { on: false, kind: 'template', text: '', fieldCfg: {} } };
  if (!spec) return ui;
  (spec.levels || []).forEach(l => {
    if (!l || l.index === undefined) return;
    ui.levelCfg[l.index] = { key: l.key, label: l.label || l.key };
  });
  const pat = spec.pattern && spec.pattern.spec;
  if (pat) {
    ui.stem = { on: true, kind: pat.kind || 'template', text: pat.text || '',
      fieldCfg: fieldCfgFromRecipe(spec.pattern.fields) };
  }
  return ui;
}

// One record's worth. `union` is not stored in a recipe and does not need to
// be: several files under one record ARE a union, because files kept apart
// became a record each.
function importUiFromRecipe(recipe, sources) {
  const r = recipe || {};
  const files = (sources || []).length;
  const filled = r.fill !== undefined && r.fill !== null;
  return {
    reconstructed: true,
    melt: meltUiFromRecipe(r.melt),
    split: splitUiFromRecipe(r.columns),
    path: pathUiFromRecipe(r.path),
    union: files > 1,
    forceUnion: files > 1 && filled,
    fill: filled ? String(r.fill) : 'n/a',
    addSourceDim: !!r.sourceDim,
  };
}

// What a stored recipe will produce, without building it. The dataset cards on
// the Data tab count dimensions and measures, and with a reshape those no
// longer live in `columns` alone -- so both readings come from here.
function recipeNames(recipe) {
  const cols = (recipe && recipe.columns) || [];
  const dims = [];
  const measures = [];
  if (recipe && recipe.sourceDim) dims.push(recipe.sourceDim);
  const pathPlan = compilePathPlan(recipe && recipe.path);
  if (pathPlan) pathPlan.dims.forEach(d => dims.push(d.key));
  cols.forEach(c => {
    if (c.role === 'dimension') dims.push(c.name);
    else if (c.role === 'measure') measures.push(c.name);
  });
  compileSplitPlans(cols).forEach(s => s.fields.forEach(f => dims.push(f.key)));
  const melt = compileMeltPlan(recipe && recipe.melt);
  if (melt) {
    melt.dims.forEach(d => dims.push(d.key));
    // the fallback may or may not be used; count declared levels, or one
    if (melt.declared.length) melt.declared.forEach(m => measures.push(m.key));
    else measures.push(melt.fallback.key);
  }
  return { dims: dims, measures: measures };
}
function recipeShape(recipe) {
  const n = recipeNames(recipe);
  return { dims: n.dims.length, measures: n.measures.length };
}

// The same question for a whole record, which may be several parts merged on
// the union of their names -- so it counts distinct names rather than adding
// the parts' totals up.
function recordShape(rec) {
  const parts = recordParts(rec);
  if (parts.length === 1) return Object.assign(recipeShape(parts[0].recipe), { parts: 1, files: parts[0].sources.length });
  const dims = {}, measures = {};
  let files = 0;
  parts.forEach(p => {
    const n = recipeNames(p.recipe);
    n.dims.forEach(k => { dims[k] = 1; });
    n.measures.forEach(k => { measures[k] = 1; });
    files += p.sources.length;
  });
  if (rec.recipe && rec.recipe.partDim) dims[rec.recipe.partDim] = 1;
  return { dims: Object.keys(dims).length, measures: Object.keys(measures).length,
    parts: parts.length, files: files };
}

// Several stored datasets as one. The parts keep their own recipes, because
// that is what makes this possible at all: they were imported from different
// files with different columns and, after a melt, possibly different shapes.
// Nothing is re-read -- the raw text is already stored, and the merge happens
// where every recipe has already been replayed.
function combineDatasets(ids, opts) {
  const o = opts || {};
  return Promise.all((ids || []).map(id => STORE.get(id))).then(got => {
    const recs = got.filter(Boolean);
    if (recs.length < 2) return null;
    const parts = [];
    const custom = [];
    const overrides = {};
    recs.forEach(r => {
      // combining something already combined takes its parts, not a nesting
      recordParts(r).forEach(p => parts.push(p));
      ((r.recipe || {}).custom || []).forEach(c => {
        if (c && c.key && !custom.some(x => x.key === c.key)) custom.push(c);
      });
      const ov = (r.recipe || {}).measureOverrides || {};
      Object.keys(ov).forEach(k => { if (overrides[k] === undefined) overrides[k] = ov[k]; });
    });
    const rec = {
      id: newDatasetId(),
      name: o.name || recs.map(r => r.name).join(' + '),
      createdAt: Date.now(),
      recipe: {
        combined: true,
        fill: o.fill === undefined ? 'n/a' : o.fill,
        partDim: o.partDim === false ? null : '__dataset',
        partLabel: o.partLabel || 'Dataset',
        custom: custom,
        measureOverrides: overrides,
      },
      sources: [],
      parts: parts,
    };
    // built before it is stored: a record that cannot be rebuilt is not saved
    const ds = datasetFromRecord(rec);
    return Promise.resolve(STORE.put(rec)).then(() => ({ rec: rec, ds: ds }));
  });
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
