// measure semantics, DIMENSIONS, the value lookup
function formatByKind(kind, val) {
  if (val === null || val === undefined) return '—';
  if (kind === 'count') return fmtAccess(val);
  if (kind === 'delta') return (val >= 0 ? '+' : '') + val.toFixed(2) + 'pt';
  if (kind === 'reldelta') return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
  return val.toFixed(2) + '%';
}
const DIVERGING_KINDS = ['delta', 'reldelta'];
function deltaUnit(kind) { return kind === 'reldelta' ? '%' : 'pt'; }
// Some metrics simply do not vary along some dimensions: a Δ metric already contains
// the variant comparison, so its value is identical for every Variant. Declaring that
// once lets both the charts and the table stop repeating the same number.
function metricIgnoresDim(metricKey, dimKey) {
  const m = METRIC_BY_KEY[metricKey];
  if (!m) return false;
  return DIVERGING_KINDS.indexOf(m.kind) !== -1 && dimKey === 'variant';
}
function anyMetricIgnores(plot, dims) {
  for (let i = 0; i < plot.included.metric.length; i++) {
    for (let j = 0; j < dims.length; j++) {
      if (metricIgnoresDim(plot.included.metric[i], dims[j])) return true;
    }
  }
  return false;
}

function kindAxisLabel(kind) {
  if (kind === 'count') return 'counts (log)';
  if (kind === 'pct') return 'rate %';
  if (kind === 'reldelta') return 'relative change %';
  if (kind === 'delta') return 'change in points';
  return kind;
}

const METRICS = [
  { key: 'rateA',             label: 'Rate A',         kind: 'pct',   field: 'rateA' },
  { key: 'rateB',             label: 'Rate B',         kind: 'pct',   field: 'rateB' },
  { key: 'countA',      label: 'Count A',     kind: 'count', field: 'countA' },
  { key: 'countB',      label: 'Count B',     kind: 'count', field: 'countB' },
  { key: 'rateA_dTuned',  label: 'Δ Rate A (Tuned−Base)',   kind: 'delta', field: 'rateA', pair: ['tuned', 'base'] },
  { key: 'rateB_dTuned',  label: 'Δ Rate B (Tuned−Base)',   kind: 'delta', field: 'rateB', pair: ['tuned', 'base'] },
  { key: 'rateA_dAlt', label: 'Δ Rate A (Tuned-alt−Base)', kind: 'delta', field: 'rateA', pair: ['tunedAlt', 'base'] },
  { key: 'rateB_dAlt', label: 'Δ Rate B (Tuned-alt−Base)', kind: 'delta', field: 'rateB', pair: ['tunedAlt', 'base'] },
  // access-count change is expressed relative, not absolute: raw access counts span
  // orders of magnitude across apps, so "-42%" compares where "-3.1M" does not
  { key: 'countA_dTuned',  label: 'Δ Count A (Tuned vs Base)',   kind: 'reldelta', field: 'countA', pair: ['tuned', 'base'] },
  { key: 'countB_dTuned',  label: 'Δ Count B (Tuned vs Base)',   kind: 'reldelta', field: 'countB', pair: ['tuned', 'base'] },
  { key: 'countA_dAlt', label: 'Δ Count A (Tuned-alt vs Base)', kind: 'reldelta', field: 'countA', pair: ['tunedAlt', 'base'] },
  { key: 'countB_dAlt', label: 'Δ Count B (Tuned-alt vs Base)', kind: 'reldelta', field: 'countB', pair: ['tunedAlt', 'base'] },
];
const METRIC_BY_KEY = {};
METRICS.forEach(m => { METRIC_BY_KEY[m.key] = m; });

const DATASET_KEYS = Object.keys(DATA);
const ALL_APPS = DATA[DATASET_KEYS[0]].apps;
const ALL_SIZES = ['1024', '512', '256', '128'];

const DIMENSIONS = [
  { key: 'dataset',   label: 'Dataset',          values: DATASET_KEYS,             labelFor: v => v },
  { key: 'app',       label: 'Application',      values: ALL_APPS,                 labelFor: v => v },
  { key: 'device',       label: 'Device',              values: DEVICES,                     labelFor: v => v },
  { key: 'size', label: 'Size', values: ALL_SIZES,           labelFor: v => v },
  { key: 'metric',    label: 'Metric',           values: METRICS.map(m => m.key),  labelFor: v => METRIC_BY_KEY[v].label },
  { key: 'variant',   label: 'Variant',          values: VARIANTS,                 labelFor: v => VARIANT_LABEL[v] },
];
const DIM_BY_KEY = {};
DIMENSIONS.forEach(d => { DIM_BY_KEY[d.key] = d; });
const DIM_KEYS = DIMENSIONS.map(d => d.key);

// Metric gets its own dedicated "data shown" selector; every other dimension --
// Dataset included -- can be dragged between the grouping zones. Dataset merely
// *defaults* to Facets, which is where it used to be nailed down.
const GROUPABLE_KEYS = DIM_KEYS.filter(k => k !== 'metric');

const CAT_PALETTE = ['var(--series-base)', 'var(--series-tuned)', 'var(--series-tuned-alt)', 'var(--app-4)', 'var(--app-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)'];
const SEP = ' · '; // joins the parts of a composite (multi-dimension) axis label
function dimValueColor(dimKey, value) {
  const dim = DIM_BY_KEY[dimKey];
  const idx = dim.values.indexOf(value);
  return CAT_PALETTE[idx % CAT_PALETTE.length];
}
function dimValueLabel(dimKey, value) { return DIM_BY_KEY[dimKey].labelFor(value); }

function findCombo(datasetKey, device, size) {
  return DATA[datasetKey].combos.find(c => c.device === device && c.size === size);
}
function rawFieldValue(datasetKey, app, device, size, field, variant) {
  const combo = findCombo(datasetKey, device, size);
  if (!combo) return null;
  const appData = DATA[datasetKey].data[app];
  if (!appData) return null;
  const point = appData[combo.key];
  if (!point || !point[field]) return null;
  const v = point[field][variant];
  return (v === undefined) ? null : v;
}
function metricValueAt(ctx) {
  const m = METRIC_BY_KEY[ctx.metric];
  if (!m) return null;
  if (m.kind === 'delta' || m.kind === 'reldelta') {
    const a = rawFieldValue(ctx.dataset, ctx.app, ctx.device, ctx.size, m.field, m.pair[0]);
    const b = rawFieldValue(ctx.dataset, ctx.app, ctx.device, ctx.size, m.field, m.pair[1]);
    if (a === null || b === null) return null;
    if (m.kind === 'reldelta') return b === 0 ? null : ((a - b) / b) * 100;
    return a - b;
  }
  return rawFieldValue(ctx.dataset, ctx.app, ctx.device, ctx.size, m.field, ctx.variant);
}
