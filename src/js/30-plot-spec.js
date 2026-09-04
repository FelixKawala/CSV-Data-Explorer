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
// A dimension in OFF_ZONE is still in the data: its rows are folded together
// rather than filtered out, so every number on the chart is an average across
// it. What it stops doing is naming, ordering and splitting -- which is the
// whole request: a folder level that is part of the provenance and none of the
// story should not be forced onto an axis to get it out of the way.
const OFF_ZONE = 'off';
const ZONES = [
  { key: 'x',      label: 'X-axis',  hint: 'nested left → right (first = outermost band)' },
  { key: 'series', label: 'Series',  hint: 'colour of the bars within each group' },
  { key: 'facet',  label: 'Facets',  hint: 'splits into separate charts — usually leave empty' },
  { key: OFF_ZONE, label: 'Not used', hint: 'kept in the data and averaged over — it names nothing and splits nothing' },
];
const ZONE_KEYS = ZONES.map(z => z.key);
// The three that put a dimension somewhere on the chart. Metric may only ever
// be one of these (or Panels): it selects a column rather than filtering rows,
// so there is nothing to average it over.
const AXIS_ZONE_KEYS = ZONE_KEYS.filter(k => k !== OFF_ZONE);
// Metric-only fourth zone. A a percentage and a raw count share no y-scale, so
// they can never be bars on one axis — stacked panels over a shared x-axis is the
// correct way to read them together.
const CHART_TYPES = [
  ['bars', 'Bar chart'], ['lines', 'Line chart'],
  ['diverging', 'Diverging bars'], ['correlation', 'Correlation plot'],
  ['matrix', 'Matrix'], ['table', 'Table'],
];
function isCartesian(t) { return t === 'bars' || t === 'lines'; }
// Both of its axes are quantities, so it is not `isCartesian` either: that means
// "categories along the bottom, a measure up the side", and here the bottom is a
// measure too. It has no second y-axis for the same reason -- the second axis is
// already in use as the first one.
function isCorrelation(t) { return t === 'correlation'; }
// A diverging chart is cartesian too, just laid on its side: its value axis is
// horizontal. That is enough to carry a second scale, so it is offered one --
// but it is not `isCartesian`, which elsewhere means "has a vertical y-axis".
function supportsDualAxis(t) { return isCartesian(t) || t === 'diverging'; }
// charts that name their axes Rows/Columns rather than Series/X-axis
function isGridType(t) { return t === 'matrix' || t === 'table'; }

const PANEL_ZONE = { key: 'panel', label: 'Panels', hint: 'one stacked sub-chart per metric over a shared x-axis — the way to combine a percentage and a raw count' };
const METRIC_ZONE_KEYS = AXIS_ZONE_KEYS.concat([PANEL_ZONE.key]);

// A plot of the page's dataset, or of a named one. A plot with no id follows
// the page, which is what every plot made before this does -- so the id is set
// only when one is asked for, and the shape of an ordinary plot is unchanged.
function makeDefaultPlot(datasetId) {
  const ds = datasetId ? loadedDataset(datasetId) : DS;
  const plot = withDataset(ds, () => defaultPlotHere());
  if (datasetId) {
    plot.datasetId = datasetId;
    // kept beside the id so a plot can still name its dataset in a message
    // after that dataset has been deleted
    plot.datasetName = ds ? ds.name : null;
  }
  return plot;
}
function defaultPlotHere() {
  const zones = normaliseZones(defaultZones());
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
    // The right-hand axis of a dual-axis chart carries a different measure, so
    // it needs its own range and its own linear/log choice -- a count opposite a
    // rate is the whole reason the second axis exists, and a count usually wants
    // log where the rate wants linear.
    yAxisRight: { min: null, max: null, scale: 'auto' },
    // Per-scale settings, keyed by axisGroup, for a chart drawn as one panel
    // per scale. The first scale keeps `yAxis`, so a plot with one measure
    // behaves exactly as it always did.
    yAxisBy: {},
    style: defaultPlotStyle(),
    // "start a new group after this metric", keyed rather than indexed so it
    // survives adding, removing and reordering the metrics around it
    metricBreaks: [],
    breakLines: true,
    // Which x dimension a line runs along. null keeps the old behaviour: one
    // line across the axis in its drawn order, broken wherever a value is
    // missing. Naming a dimension instead makes the line a statement about that
    // dimension, and a missing point a gap it steps over rather than an end.
    lineAlong: null,
    // What the two axes of a correlation plot differ in: an ordered list of
    // { over, x, y }, where `over` may be any dimension INCLUDING Metric --
    // Metric is a dimension here like any other, which is what makes "one
    // measure against another" the same control as "one run against another"
    // rather than a special case. One row is the normal chart; a second lets
    // the axes differ in two things at once (the target measure at Run 1
    // against the result measure at Run 2). A row with x === y pins that
    // dimension to one value for the whole chart.
    pins: [],
    collapseRepeats: true,
    zones,
    metricZone: 'series',
    metricPos: 99, // index of the Metric chip inside its zone; clamped to the end
    included,
  };
}
// The plot's own lists, not the current dataset's dimensions.
//
// This walked DIM_KEYS and indexed `inc[k]` unguarded, which is a copy of the
// plot filtered through whatever schema happened to be live -- and a throw when
// the plot has not got one of those keys. It matters most from the autosave,
// which runs on a 300ms timer, outside any render and inside no try: a plot
// carrying anything but exactly today's dimensions took the page down from a
// callback with nothing to catch it. Serialising a plot now reads no schema at
// all, which is what lets a snapshot outlive the dataset it was taken under.
function cloneIncluded(inc) {
  const out = {};
  Object.keys(inc || {}).forEach(k => { out[k] = (inc[k] || []).slice(); });
  return out;
}
function cloneAxisMap(by) {
  const out = {};
  Object.keys(by || {}).forEach(k => { out[k] = Object.assign({ min: null, max: null, scale: 'auto' }, by[k]); });
  return out;
}
// Every zone present, even the ones a caller did not think about: a layout
// written before "Not used" existed -- a preset, a saved view, an old autosave --
// simply has no list for it.
function normaliseZones(z) {
  const out = {};
  ZONE_KEYS.forEach(k => { out[k] = Array.isArray(z && z[k]) ? z[k].slice() : []; });
  return out;
}
function cloneZones(z) { return normaliseZones(z); }

// ---- correlation pins -------------------------------------------------------
// Per-row copies, not a slice: sharing the row objects would let a duplicated
// plot edit the plot it was duplicated from, and would make the undo snapshot a
// picture of the state it is meant to restore.
function clonePins(list) {
  return (list || []).map(r => ({
    over: r.over,
    x: Array.isArray(r.x) ? r.x.slice() : r.x,
    y: Array.isArray(r.y) ? r.y.slice() : r.y,
  }));
}
// A pin names a dimension and the values of it the two axes read: one on each
// side, or several -- several let one axis hold more than one reading, each
// drawn as its own series. A saved view outlives the file it was drawn against:
// all three may be gone in another dataset. A row that no longer resolves is
// dropped rather than kept -- kept, it would read the data at a value that does
// not exist, which is null at every tuple: an empty chart with nothing on it to
// say why. The same reasoning as `lineAlong`.
//
// The values are checked against the dimension's DOMAIN rather than against the
// plot's included list. A pinned dimension has been taken off the chart, and the
// pin is now what says which of its values are read -- and the default layout
// starts a facet dimension at one included value, so requiring inclusion would
// refuse the first pin anyone tries.
const PIN_LIMIT = 3;
function normalisePins(list) {
  if (!Array.isArray(list)) return [];
  const seen = {};
  const out = [];
  list.forEach(r => {
    if (!r || typeof r !== 'object' || out.length >= PIN_LIMIT) return;
    const dim = DIM_BY_KEY[r.over];
    if (!dim || seen[r.over]) return;
    const normVal = v => {
      if (Array.isArray(v)) {
        const f = v.filter(x => dim.values.indexOf(x) !== -1);
        return f.length ? f : null;
      }
      return dim.values.indexOf(v) !== -1 ? v : null;
    };
    const x = normVal(r.x);
    const y = normVal(r.y);
    if (x === null || y === null) return;
    seen[r.over] = true;
    out.push({ over: r.over, x: x, y: y });
  });
  return out;
}
// Dimensions worth differing in: anything with two values to tell apart. Metric
// counts, and is offered last so a dimension of the data is proposed first --
// "this run against that one" is the commoner question than "this measure
// against that one", and the measure pair is one select away either way.
function pinnableDims() {
  return DIM_KEYS.filter(k => k !== MEASURE_DIM && DIM_BY_KEY[k] && DIM_BY_KEY[k].values.length >= 2)
    .concat(DIM_BY_KEY[MEASURE_DIM] && DIM_BY_KEY[MEASURE_DIM].values.length >= 2 ? [MEASURE_DIM] : []);
}
// The obvious first question, so switching to this chart type draws something
// rather than an empty frame and an instruction.
function defaultPins() {
  const k = pinnableDims()[0];
  if (!k) return [];
  const v = DIM_BY_KEY[k].values;
  return [{ over: k, x: v[0], y: v[1] }];
}

function clonePlot(p) {
  return withPlotSchema(p, () => copyPlot(p));
}
function copyPlot(p) {
  const out = copyPlotFields(p);
  if (p.datasetId) { out.datasetId = p.datasetId; out.datasetName = p.datasetName || null; }
  return out;
}
function copyPlotFields(p) {
  return {
    id: plotIdSeq++,
    chartType: p.chartType,
    repeatPanelAxis: p.repeatPanelAxis,
    dualAxis: p.dualAxis,
    forceOneAxis: p.forceOneAxis,
    facetsInRow: !!p.facetsInRow,
    breakLines: p.breakLines,
    collapseRepeats: p.collapseRepeats,
    yAxis: Object.assign({ min: null, max: null, scale: 'auto' }, p.yAxis),
    yAxisRight: Object.assign({ min: null, max: null, scale: 'auto' }, p.yAxisRight),
    yAxisBy: cloneAxisMap(p.yAxisBy),
    style: normalisePlotStyle(p.style),
    lineAlong: p.lineAlong || null,
    pins: clonePins(p.pins),
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
