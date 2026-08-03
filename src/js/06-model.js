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
  const measures = spec.measures.map(m => {
    const format = m.format && m.format.key ? m.format : makeFormat(m.format || 'number');
    // what the source declared, kept so a later rename or retype can be stored
    // as the difference from it rather than as a second copy of the recipe
    return Object.assign({}, m, {
      format,
      __declared: { label: m.label || m.key, format: format.key },
    });
  });
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
//   { op, base: measureKey, over: dimKey, a, b, hold?: [dimKey] }
//
// The base is read through datasetValueAt, not out of a stored column. Reading
// the column meant a comparison over a CALCULATED measure found no column and
// returned null at every tuple -- the comparison form offers calculated
// measures as a base, so the only symptom was a measure that produced nothing
// anywhere, with nothing to say why.
function baseValueAt(ds, ctx, baseKey, hold) {
  const read = c => {
    const cc = Object.assign({}, c);
    cc[MEASURE_DIM] = baseKey;
    return datasetValueAt(ds, cc);
  };
  if (!hold || !hold.length) return read(ctx);
  // A held dimension is one the comparison does not hold fixed. It exists
  // because a dimension can be functionally dependent on the compared one --
  // a compute capability that only ever occurs with one device -- and then
  // holding everything else fixed means no tuple ever has both sides, and the
  // measure is empty everywhere for a reason nothing on screen explains.
  let combos = [ctx];
  hold.forEach(k => {
    const dim = ds.dims.filter(d => d.key === k)[0];
    if (!dim) return;
    const next = [];
    combos.forEach(c => dim.values.forEach(v => {
      const n = Object.assign({}, c); n[k] = v; next.push(n);
    }));
    combos = next;
  });
  let sum = 0, n = 0;
  combos.forEach(c => { const v = read(c); if (v !== null && v !== undefined) { sum += v; n++; } });
  return n ? sum / n : null;
}

function derivedValue(ds, ctx, spec) {
  const ca = Object.assign({}, ctx); ca[spec.over] = spec.a;
  const cb = Object.assign({}, ctx); cb[spec.over] = spec.b;
  const a = baseValueAt(ds, ca, spec.base, spec.hold);
  const b = baseValueAt(ds, cb, spec.base, spec.hold);
  if (a === null || b === null) return null;
  if (spec.op === 'reldiff') return b === 0 ? null : ((a - b) / b) * 100;
  // the same quotient as `ratio`, read as a percentage: stored the way a
  // percentage is stored everywhere here, 92 rather than 0.92
  if (spec.op === 'share') return b === 0 ? null : (a / b) * 100;
  if (spec.op === 'ratio') return b === 0 ? null : a / b;
  return a - b;
}

// How many tuples a comparison can actually be computed at, before it is
// created -- and when the answer is none, which dimension is in the way.
// Everything but the compared dimension is held fixed, so a dimension whose
// value is decided by the compared one leaves the two sides with no tuple in
// common, and the measure comes out empty at every point.
function derivedCoverage(ds, spec) {
  const out = { both: 0, aOnly: 0, bOnly: 0, blockers: [] };
  if (!ds) return out;
  const dim = ds.dims.filter(d => d.key === spec.over)[0];
  if (!dim) return out;
  const ca = dim.codeOf.get(spec.a), cb = dim.codeOf.get(spec.b);
  if (ca === undefined || cb === undefined) return out;
  const hold = spec.hold || [];
  const pairsWith = held => {
    const others = ds.dims.filter(d => d.key !== spec.over && held.indexOf(d.key) === -1);
    const aSeen = {}, bSeen = {};
    for (let r = 0; r < ds.nRows; r++) {
      const c = ds.codes[spec.over][r];
      if (c !== ca && c !== cb) continue;
      let k = '';
      for (let i = 0; i < others.length; i++) k += ds.codes[others[i].key][r] + ',';
      if (c === ca) aSeen[k] = true; else bSeen[k] = true;
    }
    let both = 0, aOnly = 0, bOnly = 0;
    Object.keys(aSeen).forEach(k => { if (bSeen[k]) both++; else aOnly++; });
    Object.keys(bSeen).forEach(k => { if (!aSeen[k]) bOnly++; });
    return { both, aOnly, bOnly };
  };
  const got = pairsWith(hold);
  out.both = got.both; out.aOnly = got.aOnly; out.bOnly = got.bOnly;
  if (out.both === 0) {
    ds.dims.forEach(d => {
      if (d.key === spec.over || hold.indexOf(d.key) !== -1) return;
      if (pairsWith(hold.concat([d.key])).both > 0) out.blockers.push(d.key);
    });
  }
  return out;
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
  // a held dimension is averaged over, so the measure does not vary along it
  // either -- drawing it once per value would repeat the same number
  if (m.derived) {
    return m.derived.over === dimKey
      || (m.derived.hold || []).indexOf(dimKey) !== -1;
  }
  // EVERY operand, not any: `delta * count` still varies along the compared
  // dimension, because the count does. `some` said it did not, which would have
  // collapsed a grouping that carries real variation.
  if (m.formula && byKey) {
    const refs = m.formula.refs.filter(k => k !== m.key);
    return refs.length > 0 && refs.every(k => measureIgnoresDim(byKey[k], dimKey, byKey));
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
