// the generic dataset: N arbitrary dimensions, M measures, O(#dims) lookup
//
// Replaces a lookup hardwired to this schema:
//   DATA[dataset].data[app][combo.key][field][variant]
// with dictionary-encoded columns plus a mixed-radix index. A dimension tuple
// becomes a row in one pass over the dimensions -- no scan -- which matters
// because a default render issues roughly 540 lookups.
//
// Storage is columnar (Int32Array of codes per dimension, Float64Array of values
// per measure) rather than rows of objects: an order of magnitude less memory at
// 100k rows, and typed arrays go into IndexedDB without a JSON round-trip.

// Dimension key reserved for "which measure is being shown". It is a dimension
// everywhere in the UI, but it selects a column rather than filtering rows.
const MEASURE_DIM = 'metric';

// A measure with no column of its own: it is computed from the others.
function isComputedMeasure(m) { return !!(m && (m.derived || m.formula)); }

function makeDim(spec) {
  const values = spec.values.slice();
  const codeOf = new Map();
  values.forEach((v, i) => codeOf.set(v, i));
  const overrides = spec.labelOverride || {};
  return {
    key: spec.key,
    label: spec.label || spec.key,
    values,
    codeOf,
    labelOverride: overrides,
    labelFor: v => (Object.prototype.hasOwnProperty.call(overrides, v) ? overrides[v] : String(v)),
  };
}

// Dense array while the product of cardinalities is small, a Map beyond that.
// The dense case is the common one and costs a single array index per lookup.
function makeRowIndex(cellCount) {
  const DENSE_LIMIT = 1 << 22;
  if (cellCount <= DENSE_LIMIT) {
    const arr = new Int32Array(cellCount).fill(-1);
    return { dense: true, get: k => arr[k], set: (k, r) => { arr[k] = r; } };
  }
  const m = new Map();
  return { dense: false, get: k => (m.has(k) ? m.get(k) : -1), set: (k, r) => m.set(k, r) };
}

// rows: [{ <dimKey>: value, ..., <measureKey>: number|null }]
// Rows that collapse onto the same tuple are aggregated per measure (default
// mean) rather than last-write-wins, and the count is reported in `stats`.
function makeDataset(spec) {
  const dims = spec.dims.map(makeDim);
  const measures = spec.measures.map(m => Object.assign({}, m, {
    format: m.format && m.format.key ? m.format : makeFormat(m.format || 'number'),
  }));
  const measureByKey = {};
  measures.forEach(m => { measureByKey[m.key] = m; });

  const strides = new Array(dims.length);
  let cells = 1;
  for (let i = dims.length - 1; i >= 0; i--) {
    strides[i] = cells;
    cells *= Math.max(dims[i].values.length, 1);
  }

  const rows = spec.rows || [];
  const index = makeRowIndex(cells);
  const codes = {};
  dims.forEach(d => { codes[d.key] = new Int32Array(rows.length); });
  const vals = {};
  const sums = {};
  const hits = {};
  measures.forEach(m => {
    if (isComputedMeasure(m)) return;
    vals[m.key] = new Float64Array(rows.length).fill(NaN);
    sums[m.key] = new Float64Array(rows.length);
    hits[m.key] = new Int32Array(rows.length);
  });

  let nRows = 0;
  let collapsed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let key = 0;
    let ok = true;
    for (let d = 0; d < dims.length; d++) {
      const c = dims[d].codeOf.get(row[dims[d].key]);
      if (c === undefined) { ok = false; break; }
      key += c * strides[d];
    }
    if (!ok) continue;                      // a value outside the declared domain
    let r = index.get(key);
    if (r < 0) {
      r = nRows++;
      index.set(key, r);
      for (let d = 0; d < dims.length; d++) codes[dims[d].key][r] = dims[d].codeOf.get(row[dims[d].key]);
    } else {
      collapsed++;
    }
    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      if (isComputedMeasure(m)) continue;
      const v = row[m.key];
      if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) continue;
      sums[m.key][r] += Number(v);
      hits[m.key][r] += 1;
    }
  }

  let filled = 0;
  measures.forEach(m => {
    if (isComputedMeasure(m)) return;
    const out = vals[m.key];
    for (let r = 0; r < nRows; r++) {
      if (!hits[m.key][r]) continue;
      filled++;
      out[r] = m.agg === 'sum' ? sums[m.key][r]
        : m.agg === 'first' ? sums[m.key][r] / hits[m.key][r]   // first == mean when unique
        : sums[m.key][r] / hits[m.key][r];
    }
  });

  return {
    name: spec.name || 'dataset',
    dims, measures, measureByKey, strides, index, codes, vals,
    nRows, cells,
    stats: { rows: rows.length, collapsed, filled, density: cells ? nRows / cells : 0 },
  };
}

function datasetRowAt(ds, ctx) {
  let key = 0;
  for (let i = 0; i < ds.dims.length; i++) {
    const d = ds.dims[i];
    const c = d.codeOf.get(ctx[d.key]);
    if (c === undefined) return -1;
    key += c * ds.strides[i];
  }
  return ds.index.get(key);
}

function rawMeasureAt(ds, ctx, measureKey) {
  const col = ds.vals[measureKey];
  if (!col) return null;
  const r = datasetRowAt(ds, ctx);
  if (r < 0) return null;
  const v = col[r];
  return Number.isNaN(v) ? null : v;
}

// A derived measure compares one measure between two values of one dimension.
// This is the generalisation of the old hardcoded `pair: ['tuned','base']`,
// which could only ever compare along `variant`.
//   { op: 'diff' | 'reldiff' | 'ratio', base: measureKey, over: dimKey, a, b }
function derivedValue(ds, ctx, spec) {
  const ca = Object.assign({}, ctx); ca[spec.over] = spec.a;
  const cb = Object.assign({}, ctx); cb[spec.over] = spec.b;
  const a = rawMeasureAt(ds, ca, spec.base);
  const b = rawMeasureAt(ds, cb, spec.base);
  if (a === null || b === null) return null;
  if (spec.op === 'reldiff') return b === 0 ? null : ((a - b) / b) * 100;
  if (spec.op === 'ratio') return b === 0 ? null : a / b;
  return a - b;
}

// A calculated measure is an expression over other measures, evaluated at this
// tuple. Operands are read through datasetValueAt, so a formula may refer to a
// comparison measure or to an earlier formula; a cycle is impossible because
// every name has to resolve to a measure that already exists.
function formulaValue(ds, ctx, spec) {
  const get = key => {
    const m = ds.measureByKey[key];
    if (!m) return null;
    const c = Object.assign({}, ctx);
    c[MEASURE_DIM] = key;
    const v = datasetValueAt(ds, c);
    return v === null ? null : v * ratioScale(m.format);
  };
  const raw = evalFormulaNode(spec.ast, get);
  return raw === null ? null : raw * spec.outScale;
}

function datasetValueAt(ds, ctx) {
  const m = ds.measureByKey[ctx[MEASURE_DIM]];
  if (!m) return null;
  if (m.derived) return derivedValue(ds, ctx, m.derived);
  if (m.formula) return formulaValue(ds, ctx, m.formula);
  return rawMeasureAt(ds, ctx, m.key);
}

// Which dimensions a measure does not vary along -- a derived measure has
// already consumed the dimension it compares over, so repeating it would draw
// the same number once per value of it. A formula inherits that from whatever
// it refers to: (a - b) * count still does not vary along the compared
// dimension, so `byKey` is needed to follow the references.
function measureIgnoresDim(m, dimKey, byKey) {
  if (!m) return false;
  if (m.derived) return m.derived.over === dimKey;
  if (m.formula && byKey) {
    return m.formula.refs.some(k => k !== m.key && measureIgnoresDim(byKey[k], dimKey, byKey));
  }
  return false;
}

// A dimension tuple for one stored row, used to preview a formula against real
// data rather than against a number the user has to trust.
function datasetCtxAtRow(ds, r) {
  const ctx = {};
  if (r < 0 || r >= ds.nRows) return ctx;
  ds.dims.forEach(d => { ctx[d.key] = d.values[ds.codes[d.key][r]]; });
  return ctx;
}
