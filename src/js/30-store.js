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
// per-column decisions, and whether several files were unioned.
//
//   { name, columns: [{source, name, role, format, agg}], sourceDim: null|string }

function datasetFromRecord(rec) {
  const cols = rec.recipe.columns;
  const dims = [];
  const measures = [];
  const rows = [];
  const dimValues = {};

  cols.forEach(c => {
    if (c.role === 'dimension') dimValues[c.name] = [];
  });
  if (rec.recipe.sourceDim) dimValues[rec.recipe.sourceDim] = [];

  rec.sources.forEach(srcRec => {
    const parsed = parseCsv(srcRec.text, rec.recipe.parse);
    const header = dedupeHeader(parsed.header);
    parsed.rows.forEach(cells => {
      const row = {};
      cols.forEach(c => {
        if (c.role === 'ignore') return;
        const i = header.indexOf(c.source);
        const raw = i === -1 ? '' : cells[i];
        if (c.role === 'dimension') {
          const v = String(raw).trim();
          row[c.name] = v;
          if (dimValues[c.name].indexOf(v) === -1) dimValues[c.name].push(v);
        } else {
          row[c.name] = isNumeric(raw) ? Number(raw) : null;
        }
      });
      if (rec.recipe.sourceDim) {
        const v = srcRec.label || srcRec.filename;
        row[rec.recipe.sourceDim] = v;
        if (dimValues[rec.recipe.sourceDim].indexOf(v) === -1) dimValues[rec.recipe.sourceDim].push(v);
      }
      rows.push(row);
    });
  });

  if (rec.recipe.sourceDim) {
    dims.push({ key: rec.recipe.sourceDim, label: rec.recipe.sourceLabel || 'Source',
      values: dimValues[rec.recipe.sourceDim] });
  }
  cols.forEach(c => {
    if (c.role === 'dimension') {
      dims.push({ key: c.name, label: c.label || c.name, values: dimValues[c.name], labelOverride: c.labelOverride });
    } else if (c.role === 'measure') {
      measures.push({ key: c.name, label: c.label || c.name, agg: c.agg || 'mean', format: makeFormat(c.format || 'number') });
    }
  });

  const ds = makeDataset({ name: rec.name, dims, measures, rows });
  attachCustomMeasures(ds, rec.recipe.custom);
  return ds;
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

function newDatasetId() {
  return 'ds-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
