// plot spec, zones, chart types, defaults
// ---- plot spec ----
let plotIdSeq = 1;
// The default layout is derived, not hand-picked: the outermost dimension facets,
// the innermost colours the series, and everything between shares the x-axis. A
// facet dimension starts at one value, because otherwise opening the page would
// draw a chart per value of it.
//
// The x-axis nests, so its width is the PRODUCT of its dimensions. Putting
// everything on it is right for a handful of dimensions and impossible for ten:
// an import with ten would ask for a million cells, and the render refuses past
// twenty thousand -- so the first thing seen after importing would be a refusal
// rather than a chart. Instead the axis is filled to a budget and the rest
// facet, where each starts at a single value and costs nothing.
const X_WIDTH_BUDGET = 500;
function defaultZones() {
  const g = GROUPABLE_KEYS.slice();
  if (g.length === 0) return { x: [], series: [], facet: [] };
  if (g.length === 1) return { x: g.slice(), series: [], facet: [] };
  if (g.length === 2) return { x: [g[0]], series: [g[1]], facet: [] };
  const sizeOf = k => Math.max(DIM_BY_KEY[k] ? DIM_BY_KEY[k].values.length : 1, 1);
  const series = [g[g.length - 1]];
  const facet = [g[0]];
  const x = [];
  let width = sizeOf(series[0]);
  g.slice(1, -1).forEach(k => {
    const n = sizeOf(k);
    if (width * n <= X_WIDTH_BUDGET) { x.push(k); width *= n; } else facet.push(k);
  });
  return { x, series, facet };
}
function defaultIncluded(dimKey, zones) {
  if (dimKey === MEASURE_DIM) return METRICS.length ? [METRICS[0].key] : [];
  const values = DIM_BY_KEY[dimKey] ? DIM_BY_KEY[dimKey].values : [];
  if (zones && zones.facet.indexOf(dimKey) !== -1) return values.slice(0, 1);
  return values.slice();
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
  const zones = defaultZones();
  const included = {};
  DIM_KEYS.forEach(k => { included[k] = defaultIncluded(k, zones); });
  return {
    id: plotIdSeq++,
    chartType: 'bars',
    repeatPanelAxis: false,
    dualAxis: false,
    forceOneAxis: false,
    // null and 'auto' mean "derive it from the data", exactly as before
    yAxis: { min: null, max: null, scale: 'auto' },
    style: defaultPlotStyle(),
    // "start a new group after this metric", keyed rather than indexed so it
    // survives adding, removing and reordering the metrics around it
    metricBreaks: [],
    breakLines: true,
    collapseRepeats: true,
    zones,
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
    forceOneAxis: p.forceOneAxis,
    breakLines: p.breakLines,
    collapseRepeats: p.collapseRepeats,
    yAxis: Object.assign({ min: null, max: null, scale: 'auto' }, p.yAxis),
    style: normalisePlotStyle(p.style),
    metricBreaks: (p.metricBreaks || []).slice(),
    zones: cloneZones(p.zones),
    metricZone: p.metricZone,
    metricPos: p.metricPos,
    included: cloneIncluded(p.included),
  };
}

let plots = [];
// A default layout can only be chosen once the dimensions are known, so plots are
// (re)built when a dataset is adopted rather than at load.
function resetPlots() { plots = hasDataset() ? [makeDefaultPlot()] : []; }

// Named zone layouts, offered in the toolbar. Derived from whatever dimensions
// exist rather than hardcoded, so they mean something for an imported CSV too.
function layoutPresets() {
  const g = GROUPABLE_KEYS.slice();
  if (g.length < 2) return [];
  const first = g[0];
  const last = g[g.length - 1];
  const middle = g.slice(1, -1);
  const out = [
    {
      label: 'Nested',
      hint: 'every dimension but the last shares one x-axis, nested left to right',
      zones: () => ({ x: g.slice(0, -1), series: [last], facet: [] }),
    },
    {
      label: 'Faceted',
      hint: 'one chart per value of the first dimension',
      zones: () => ({ x: middle.length ? middle : [last], series: middle.length ? [last] : [], facet: [first] }),
    },
  ];
  if (g.length >= 3) {
    out.push({
      label: 'Side by side',
      hint: 'the innermost dimension on the x-axis, the outermost as the series colour',
      zones: () => ({ x: g.slice(1), series: [first], facet: [] }),
    });
  }
  return out;
}
