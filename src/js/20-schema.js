// build the runtime schema from a dataset bundle
//
// Everything here used to be hardcoded: six named dimensions and twelve named
// metrics, with a lookup that indexed the bundle's nested shape directly. It is
// now derived -- the bundle is flattened into tidy rows and handed to the
// generic model, and the UI's dimension list is read back off the result.
//
// Phase 3 replaces this adapter with the CSV import pipeline. The consumers
// below (DIMENSIONS, METRICS, metricValueAt, ...) keep their names and shapes so
// the rest of the app, and every test, is untouched by the swap.

// ---- describe the bundle as measures --------------------------------------
const RAW_MEASURES = [
  { key: 'rateA', label: 'Rate A', format: makeFormat('pct') },
  { key: 'rateB', label: 'Rate B', format: makeFormat('pct') },
  { key: 'countA', label: 'Count A', format: makeFormat('count') },
  { key: 'countB', label: 'Count B', format: makeFormat('count') },
];

// A change is a comparison along one dimension. Absolute for a rate (points),
// relative for a count -- raw counts span orders of magnitude, so "-42%"
// compares across cases where "-3.1M" does not.
const COMPARISONS = [
  { suffix: 'dTuned', a: 'tuned', label: 'Tuned' },
  { suffix: 'dAlt', a: 'tunedAlt', label: 'Tuned-alt' },
];
const DERIVED_MEASURES = [];
COMPARISONS.forEach(cmp => {
  ['rateA', 'rateB'].forEach(base => {
    DERIVED_MEASURES.push({
      key: base + '_' + cmp.suffix,
      label: 'Δ ' + (base === 'rateA' ? 'Rate A' : 'Rate B') + ' (' + cmp.label + '−Base)',
      format: makeFormat('delta'),
      derived: { op: 'diff', base, over: 'variant', a: cmp.a, b: 'base' },
    });
  });
});
COMPARISONS.forEach(cmp => {
  ['countA', 'countB'].forEach(base => {
    DERIVED_MEASURES.push({
      key: base + '_' + cmp.suffix,
      label: 'Δ ' + (base === 'countA' ? 'Count A' : 'Count B') + ' (' + cmp.label + ' vs Base)',
      format: makeFormat('reldelta'),
      derived: { op: 'reldiff', base, over: 'variant', a: cmp.a, b: 'base' },
    });
  });
});

// ---- flatten the bundle into tidy rows -------------------------------------
function datasetSpecFromBundle(bundle) {
  const datasetKeys = Object.keys(bundle);
  const apps = bundle[datasetKeys[0]].apps.slice();
  const sizes = [];
  const devices = [];
  const rows = [];
  datasetKeys.forEach(dsKey => {
    const ds = bundle[dsKey];
    ds.combos.forEach(c => {
      if (devices.indexOf(c.device) === -1) devices.push(c.device);
      if (sizes.indexOf(c.size) === -1) sizes.push(c.size);
    });
    ds.apps.forEach(app => {
      ds.combos.forEach(combo => {
        const point = ds.data[app][combo.key];
        VARIANTS.forEach(variant => {
          if (!point || point[RAW_MEASURES[0].key][variant] === undefined) return;
          const row = { dataset: dsKey, app, device: combo.device, size: combo.size, variant };
          RAW_MEASURES.forEach(m => { row[m.key] = point[m.key][variant]; });
          rows.push(row);
        });
      });
    });
  });
  sizes.sort((a, b) => Number(b) - Number(a));   // largest first, as the axis reads
  return {
    name: 'bundle',
    dims: [
      { key: 'dataset', label: 'Dataset', values: datasetKeys },
      { key: 'device', label: 'Device', values: devices },
      { key: 'size', label: 'Size', values: sizes },
      { key: 'app', label: 'Application', values: apps },
      { key: 'variant', label: 'Variant', values: VARIANTS.slice(), labelOverride: VARIANT_LABEL },
    ],
    measures: RAW_MEASURES.concat(DERIVED_MEASURES),
    rows,
  };
}

// ---- the live schema -------------------------------------------------------
// These were const, built once from the embedded bundle. They are rebound when a
// dataset is imported or switched, so every consumer reads them at call time.
let DS = null;
let METRICS = [];
let METRIC_BY_KEY = {};
let DIMENSIONS = [];
let DIM_BY_KEY = {};
let DIM_KEYS = [];
let GROUPABLE_KEYS = [];

const SEP = ' \u00b7 '; // joins the parts of a composite (multi-dimension) axis label

function useDataset(ds) {
  DS = ds;
  if (ds && ds.__id) LOADED.set(ds.__id, ds);
  METRICS = ds ? ds.measures : [];
  METRIC_BY_KEY = ds ? ds.measureByKey : {};
  // The measure selector is a dimension everywhere in the UI; it just picks a
  // column instead of filtering rows. It sits fifth because the flat table dump
  // prints dimensions in this order.
  const pseudo = {
    key: MEASURE_DIM,
    label: 'Metric',
    values: METRICS.map(m => m.key),
    labelFor: v => (METRIC_BY_KEY[v] ? METRIC_BY_KEY[v].label : v),
  };
  const dims = ds ? ds.dims : [];
  const at = Math.min(4, dims.length);
  DIMENSIONS = dims.slice(0, at).concat([pseudo], dims.slice(at));
  DIM_BY_KEY = {};
  DIMENSIONS.forEach(d => { DIM_BY_KEY[d.key] = d; });
  DIM_KEYS = DIMENSIONS.map(d => d.key);
  // Metric gets its own "data shown" selector; everything else can be dragged
  // between the grouping zones.
  GROUPABLE_KEYS = DIM_KEYS.filter(k => k !== MEASURE_DIM);
  return DS;
}

// ---- reading a particular dataset ------------------------------------------
// Everything above is the schema of ONE dataset, and every consumer resolves it
// by name at call time. That is what makes a page of plots all read the same
// data -- and what stopped two plots reading two different datasets.
//
// Rather than thread a dataset through the render recursion (plot plan, layout,
// leaves: a few hundred forwarding parameters, where one dropped forward draws
// the wrong numbers and no test can see it), the binding is scoped. `useDataset`
// already swaps all seven at once; this is that with a restore, which is safe
// here for one reason worth stating: rendering is synchronous from end to end.
// Nothing between entering and leaving awaits anything.
//
// The fast path matters. A facet-heavy chart re-enters this hundreds of times,
// and re-entering the dataset already in force must cost a pointer compare
// rather than rebuilding the pseudo-dimension.
function withDataset(ds, fn) {
  if (!ds || ds === DS) return fn();
  const prev = DS;
  useDataset(ds);
  try {
    return fn();
  } finally {
    useDataset(prev);          // null is a valid restore: every read above guards on `ds`
  }
}

// ---- the datasets currently in memory ---------------------------------------
// Several, now, rather than one: a plot may name the dataset it reads, and two
// plots may name different ones. Keyed by the stored record's id, which is what
// a plot names and what survives a reload; `datasetFromRecord` stamps it on.
const LOADED = new Map();

function registerDataset(ds) {
  if (ds && ds.__id) LOADED.set(ds.__id, ds);
  return ds;
}
function loadedDataset(id) { return (id && LOADED.get(id)) || null; }
// Deleted from the store: the copy in memory is not a dataset any more, it is a
// dataset that cannot be rebuilt. A plot pinned to it should say so rather than
// go on drawing from something nothing can reproduce.
function forgetDataset(id) { LOADED.delete(id); }

// Rebuild whichever of these is not in memory yet, from the store. Loading is
// asynchronous and rendering is not, so this is the pre-pass: everything a
// config names is resolved BEFORE a plot is drawn, never during.
function ensureDatasetsLoaded(ids) {
  const want = (ids || []).filter(id => id && !LOADED.has(id));
  if (!want.length) return Promise.resolve([]);
  return Promise.all(want.map(id => Promise.resolve(STORE.get(id))
    .then(rec => (rec ? registerDataset(datasetFromRecord(rec)) : null))
    .catch(() => null)));
}

// A dataset nothing points at any more is a second copy of every column it has.
// The live one is always kept, whether or not a plot names it.
function releaseUnusedDatasets() {
  const keep = {};
  if (DS && DS.__id) keep[DS.__id] = true;
  plots.forEach(p => { if (p.datasetId) keep[p.datasetId] = true; });
  Array.from(LOADED.keys()).forEach(id => { if (!keep[id]) LOADED.delete(id); });
}

// Which dataset a plot reads: the one it names, or the page's.
//
// No id means "follow the page", and that is the default rather than a
// migration -- every plot made before this, every stored view and every
// autosave has none, and goes on reading whatever is open exactly as it did.
// A plot gets an id only when someone gives it one deliberately.
// A plot may name a dataset that is not here: deleted, or not loaded yet. The
// fallback is the page's, and it is deliberate -- the plot still draws, its
// card says whose data it is drawing, and the pin is kept so it can go back.
// This is the ONE place that decides it, so that what is drawn, what the chips
// offer and what the values are read from cannot disagree.
function datasetOf(plot) {
  if (plot && plot.datasetId) return loadedDataset(plot.datasetId) || DS;
  return DS;
}
function plotDatasetMissing(plot) {
  return !!(plot && plot.datasetId && !loadedDataset(plot.datasetId));
}
// The plots on the page that read a given dataset -- the ones pinned to it, and
// the ones following the page when it is the page's.
function plotsReading(ds) {
  return plots.filter(p => datasetOf(p) === ds);
}
function plotDatasetName(plot) {
  if (plotDatasetMissing(plot)) {
    return plot.datasetName || 'a dataset that is no longer stored';
  }
  const ds = datasetOf(plot);
  return ds ? ds.name : '';
}
function withPlotSchema(plot, fn) { return withDataset(datasetOf(plot), fn); }

// A handler built during a render but fired long after it, when the schema in
// force is whatever the page last looked at. Most handlers do not need this --
// they change the plot and re-render, and the re-render establishes the context
// itself -- but the ones that read a dimension or a measure BEFORE re-rendering
// would read it from the wrong dataset.
function bindDataset(fn) {
  const ds = DS;
  return function () {
    const args = arguments;
    return withDataset(ds, () => fn.apply(this, args));
  };
}

// Development-only: proves the context discipline holds rather than assuming it.
// Off unless a page sets __STRICT_SCHEMA before the scripts run.
//
// A plot whose dataset is not in memory is not a failure of the discipline --
// it is the documented fallback, and it reads the page's data on purpose -- so
// only a plot that HAS its dataset is held to this.
function assertPlotSchema(plot, where) {
  if (typeof __STRICT_SCHEMA === 'undefined' || !__STRICT_SCHEMA) return;
  if (plotDatasetMissing(plot)) return;
  if (DS !== datasetOf(plot)) {
    throw new Error('schema out of context in ' + where + ': the page is showing '
      + (DS && DS.name) + ' while this plot reads ' + ((datasetOf(plot) || {}).name));
  }
}

function hasDataset() { return !!DS && DS.dims.length > 0; }

function dimValueLabel(dimKey, value) {
  const d = DIM_BY_KEY[dimKey];
  return d ? d.labelFor(value) : String(value);
}

function metricValueAt(ctx) { return DS ? datasetValueAt(DS, ctx) : null; }
// The same lookup, folding together the dimensions a plot is not using.
function metricValueOver(ctx, dims, valuesOf) {
  return DS ? datasetValueOver(DS, ctx, dims, valuesOf) : null;
}
function metricIgnoresDim(metricKey, dimKey) {
  return measureIgnoresDim(METRIC_BY_KEY[metricKey], dimKey, METRIC_BY_KEY);
}

// ---- measures defined from the page ----------------------------------------
// Comparison measures and calculated ones are both just measures with no column
// of their own, so they are added the same way: onto the live dataset, then the
// schema is rebuilt so they appear in every plot's "Data shown" list. Plots keep
// their configuration -- nothing about the existing ones changes.
function addCustomMeasure(measure) {
  if (!DS || !measure || METRIC_BY_KEY[measure.key]) return null;
  // Marks it as the page's rather than the dataset's: the measures a bundle or
  // an import declared are not the user's to withdraw here.
  measure.userDefined = true;
  DS.measures.push(measure);
  DS.measureByKey[measure.key] = measure;
  useDataset(DS);
  // Only the plots that read THIS dataset. A measure belongs to the dataset it
  // was defined on, and giving a plot of some other data an empty list of it
  // would leave that plot asking for nothing at all.
  plotsReading(DS).forEach(p => {
    if (!p.included[MEASURE_DIM]) p.included[MEASURE_DIM] = [];
  });
  persistCustomMeasures();
  return measure;
}

function removeCustomMeasure(key) {
  const m = METRIC_BY_KEY[key];
  if (!DS || !m || !m.userDefined) return false;
  // Anything built on top of it would silently start returning nothing.
  const dependents = DS.measures.filter(
    o => o.formula && o.formula.refs.indexOf(key) !== -1);
  if (dependents.length) return dependents.map(d => d.label);
  DS.measures = DS.measures.filter(o => o.key !== key);
  delete DS.measureByKey[key];
  plotsReading(DS).forEach(p => {
    if (p.included[MEASURE_DIM]) {
      p.included[MEASURE_DIM] = p.included[MEASURE_DIM].filter(v => v !== key);
    }
    // A correlation axis pinned to it would read nothing at every tuple, with
    // nothing on the chart to explain the emptiness.
    if (Array.isArray(p.pins)) {
      p.pins = p.pins.filter(r => !(r.over === MEASURE_DIM && (r.x === key || r.y === key)));
    }
  });
  useDataset(DS);
  persistCustomMeasures();
  return true;
}

// ---- editing a measure -----------------------------------------------------
// A CSV column arrives named whatever the file called it and typed by a guess
// from its values, and neither is necessarily right. Both are display policy
// rather than data, so both can be changed after the fact without touching a
// stored number: the label is what every axis, legend and chip reads, and the
// format decides the scale, the units and -- through axisGroup -- which other
// measures this one may share a y-axis with.
function editMeasure(key, patch) {
  const m = METRIC_BY_KEY[key];
  if (!DS || !m) return null;
  if (patch.label !== undefined) {
    const label = String(patch.label).trim();
    if (label) m.label = label;
  }
  if (patch.format !== undefined && FORMATS[patch.format]) {
    // a computed measure keeps its own scaling: a formula's outScale is derived
    // from the format it was compiled against, so it has to follow it
    m.format = makeFormat(patch.format);
    if (m.formula) m.formula.outScale = 1 / ratioScale(m.format);
  }
  useDataset(DS);
  if (m.userDefined) persistCustomMeasures();
  else persistMeasureOverrides();
  return m;
}

// What has been changed away from what the recipe declared, so a reload can
// replay it. Only the differences: a measure left alone stores nothing.
function measureOverrideSpecs() {
  if (!DS) return {};
  const out = {};
  DS.measures.forEach(m => {
    if (m.userDefined) return;                 // stored with the measure itself
    if (!m.__declared) return;
    const o = {};
    if (m.label !== m.__declared.label) o.label = m.label;
    if (m.format.key !== m.__declared.format) o.format = m.format.key;
    if (Object.keys(o).length) out[m.key] = o;
  });
  return out;
}

function customMeasures() { return DS ? DS.measures.filter(m => m.userDefined) : []; }
function anyMetricIgnores(plot, dims) {
  for (let i = 0; i < plot.included[MEASURE_DIM].length; i++) {
    for (let j = 0; j < dims.length; j++) {
      if (metricIgnoresDim(plot.included[MEASURE_DIM][i], dims[j])) return true;
    }
  }
  return false;
}
