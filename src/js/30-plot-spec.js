// plot spec, zones, chart types, defaults
// ---- plot spec ----
let plotIdSeq = 1;
function defaultIncluded(dimKey) {
  if (dimKey === 'dataset') return ['setA'];
  if (dimKey === 'metric') return ['rateA'];
  return DIM_BY_KEY[dimKey].values.slice();
}
// Grouping is a partition of the groupable dims across three zones. Any number of
// dims can sit on the X-axis at once — they nest left-to-right (first = outermost
// band, last = innermost bar group), so several dimensions can be compared inside
// ONE chart instead of being split into separate facet cards. Facets are opt-in.
const ZONES = [
  { key: 'x',      label: 'X-axis',  hint: 'nested left → right (first = outermost band)' },
  { key: 'series', label: 'Series',  hint: 'colour of the bars within each group' },
  { key: 'facet',  label: 'Facets',  hint: 'splits into separate charts — usually leave empty' },
];
const ZONE_KEYS = ZONES.map(z => z.key);
// Metric-only fourth zone. A a percentage and a raw count share no y-scale, so
// they can never be bars on one axis — stacked panels over a shared x-axis is the
// correct way to read them together.
const CHART_TYPES = [
  ['bars', 'Bar chart'], ['lines', 'Line chart'],
  ['diverging', 'Diverging bars'], ['matrix', 'Matrix'], ['table', 'Table'],
];
function isCartesian(t) { return t === 'bars' || t === 'lines'; }
// charts that name their axes Rows/Columns rather than Series/X-axis
function isGridType(t) { return t === 'matrix' || t === 'table'; }

const PANEL_ZONE = { key: 'panel', label: 'Panels', hint: 'one stacked sub-chart per metric over a shared x-axis — the way to combine a percentage and a raw count' };
const METRIC_ZONE_KEYS = ZONE_KEYS.concat([PANEL_ZONE.key]);

function makeDefaultPlot() {
  const included = {};
  DIM_KEYS.forEach(k => { included[k] = defaultIncluded(k); });
  return {
    id: plotIdSeq++,
    chartType: 'bars',
    repeatPanelAxis: false,
    dualAxis: false,
    breakLines: true,
    collapseRepeats: true,
    zones: { x: ['device', 'size', 'app'], series: ['variant'], facet: ['dataset'] },
    metricZone: 'series',
    metricPos: 99, // index of the Metric chip inside its zone; clamped to the end
    included,
  };
}
function cloneIncluded(inc) {
  const out = {};
  DIM_KEYS.forEach(k => { out[k] = inc[k].slice(); });
  return out;
}
function cloneZones(z) {
  const out = {};
  ZONE_KEYS.forEach(k => { out[k] = z[k].slice(); });
  return out;
}
function clonePlot(p) {
  return {
    id: plotIdSeq++,
    chartType: p.chartType,
    repeatPanelAxis: p.repeatPanelAxis,
    dualAxis: p.dualAxis,
    breakLines: p.breakLines,
    collapseRepeats: p.collapseRepeats,
    zones: cloneZones(p.zones),
    metricZone: p.metricZone,
    metricPos: p.metricPos,
    included: cloneIncluded(p.included),
  };
}

let plots = [makeDefaultPlot()];
