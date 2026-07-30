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
      { key: 'app', label: 'Application', values: apps },
      { key: 'device', label: 'Device', values: devices },
      { key: 'size', label: 'Size', values: sizes },
      { key: 'variant', label: 'Variant', values: VARIANTS.slice(), labelOverride: VARIANT_LABEL },
    ],
    measures: RAW_MEASURES.concat(DERIVED_MEASURES),
    rows,
  };
}

const DS = makeDataset(datasetSpecFromBundle(DATA));

// ---- what the rest of the app consumes -------------------------------------
const METRICS = DS.measures;
const METRIC_BY_KEY = DS.measureByKey;

// The measure selector is a dimension everywhere in the UI; it just picks a
// column instead of filtering rows. It sits where it always sat in the order,
// because the flat table dump prints dimensions in this sequence.
const MEASURE_PSEUDO_DIM = {
  key: MEASURE_DIM,
  label: 'Metric',
  values: METRICS.map(m => m.key),
  labelFor: v => (METRIC_BY_KEY[v] ? METRIC_BY_KEY[v].label : v),
};
const DIMENSIONS = DS.dims.slice(0, 4).concat([MEASURE_PSEUDO_DIM], DS.dims.slice(4));
const DIM_BY_KEY = {};
DIMENSIONS.forEach(d => { DIM_BY_KEY[d.key] = d; });
const DIM_KEYS = DIMENSIONS.map(d => d.key);

// Metric gets its own dedicated "data shown" selector; every other dimension --
// Dataset included -- can be dragged between the grouping zones.
const GROUPABLE_KEYS = DIM_KEYS.filter(k => k !== MEASURE_DIM);

const SEP = ' · '; // joins the parts of a composite (multi-dimension) axis label
function dimValueLabel(dimKey, value) { return DIM_BY_KEY[dimKey].labelFor(value); }

function metricValueAt(ctx) { return datasetValueAt(DS, ctx); }
function metricIgnoresDim(metricKey, dimKey) {
  return measureIgnoresDim(METRIC_BY_KEY[metricKey], dimKey);
}
function anyMetricIgnores(plot, dims) {
  for (let i = 0; i < plot.included[MEASURE_DIM].length; i++) {
    for (let j = 0; j < dims.length; j++) {
      if (metricIgnoresDim(plot.included[MEASURE_DIM][i], dims[j])) return true;
    }
  }
  return false;
}
