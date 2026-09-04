// autosave, named views, import/export of view configs
// ---- persistence: autosave, named views, export/import ----
const LS_AUTOSAVE_KEY = 'viz-builder-autosave-v1';
const LS_VIEWS_KEY = 'viz-builder-views-v1';
// A sidecar, so the autosave itself keeps exactly the format it always had.
const LS_AUTOSAVE_SHAPE = 'viz-builder-autosave-shape-v1';

// Detached, not aliased. This used to hand back live references to `zones`,
// `included`, `yAxis` and `style`, which is invisible when the result is
// immediately stringified for storage -- and useless as a snapshot, because it
// changed along with the plot it came from. Anything undoing an in-place edit
// got a picture of the state it was trying to restore.
function serializePlots() {
  return plots.map(p => Object.assign(plotProvenance(p), {
    chartType: p.chartType, repeatPanelAxis: p.repeatPanelAxis, dualAxis: p.dualAxis,
    forceOneAxis: !!p.forceOneAxis,
    facetsInRow: !!p.facetsInRow,
    breakLines: p.breakLines, collapseRepeats: p.collapseRepeats,
    yAxis: Object.assign({}, p.yAxis),
    yAxisRight: Object.assign({}, p.yAxisRight),
    yAxisBy: cloneAxisMap(p.yAxisBy),
    lineAlong: p.lineAlong || null,
    pins: clonePins(p.pins),
    style: cloneStyle(p.style),
    metricBreaks: (p.metricBreaks || []).slice(),
    zones: cloneZones(p.zones), metricZone: p.metricZone,
    metricPos: p.metricPos, included: cloneIncluded(p.included),
  }));
}
// Which dataset this plot reads, written only when it reads a particular one.
//
// A view is not bound to a dataset and must not become bound to one: loading
// one onto whatever is open is how they are used, and every plot that follows
// the page goes on doing exactly that. This says the opposite thing -- "this
// plot was pinned to that dataset on purpose" -- and only a pinned plot carries
// it, so an ordinary view is byte-for-byte what it always was.
function plotProvenance(p) {
  if (!p.datasetId) return {};
  return { datasetId: p.datasetId, datasetName: p.datasetName || plotDatasetName(p) };
}
// Repairs rather than rejects, so a save written by any earlier version still loads:
//  - current shape: explicit zones
//  - one version back: zones without Dataset (it was a filter pinned to the outside)
//  - two versions back: a flat `groupOrder` whose last two entries were the axes
// Anything still unaccounted for lands in Facets, which is where a dimension that
// used to be a page-splitting filter belongs.
function migrateZones(p) {
  const out = {};
  ZONE_KEYS.forEach(k => { out[k] = []; });
  const seen = {};
  const claim = (zone, key) => {
    if (GROUPABLE_KEYS.indexOf(key) === -1 || seen[key]) return;
    seen[key] = true;
    out[zone].push(key);
  };
  if (p && p.zones && typeof p.zones === 'object') {
    ZONE_KEYS.forEach(zk => {
      const arr = Array.isArray(p.zones[zk]) ? p.zones[zk] : [];
      arr.forEach(k => claim(zk, k));
    });
  } else if (Array.isArray(p && p.groupOrder)) {
    const go = p.groupOrder.filter(k => GROUPABLE_KEYS.indexOf(k) !== -1);
    go.forEach((k, i) => {
      claim(i === go.length - 1 ? 'x' : (i === go.length - 2 ? 'series' : 'facet'), k);
    });
  }
  const claimed = Object.keys(seen).length;
  const missing = GROUPABLE_KEYS.filter(k => !seen[k]);
  if (missing.length) out.facet = missing.concat(out.facet);
  // Nothing on either axis and every dimension in Facets is not a layout, it is
  // the absence of one: it draws an empty chart with nothing to explain it. Two
  // ways to arrive there, and they get the same answer -- a layout that named
  // no zones at all (an old save), and one whose zones named dimensions this
  // dataset has not got a single one of.
  //
  // That second case is a view meeting data it was not drawn against: not this
  // data rearranged, but a layout about something else entirely, so the
  // dataset's own default is a better answer than a pile in Facets. A view that
  // shares even one dimension is left alone -- it is recognisably about this
  // data, and rearranging what the user chose would be presumptuous.
  if (out.x.length === 0 && out.series.length === 0 && out.facet.length === GROUPABLE_KEYS.length
      && (claimed === 0)) {
    // normalised, because defaultZones names only the three it decides and this
    // is a plot's zones: a missing "Not used" list is not an empty one
    return normaliseZones(defaultZones());
  }
  return out;
}
// A saved view from before the axis could be overridden has no yAxis at all,
// which must read as "auto" rather than as a broken record.
function normaliseYAxis(a) {
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const scale = a && (a.scale === 'linear' || a.scale === 'log') ? a.scale : 'auto';
  return { min: num(a && a.min), max: num(a && a.max), scale: scale };
}
// Keys are axisGroups, which are derived from the data rather than chosen, so a
// key for a scale this dataset does not have is simply never read.
function normaliseAxisMap(by) {
  const out = {};
  if (!by || typeof by !== 'object') return out;
  Object.keys(by).forEach(k => { out[k] = normaliseYAxis(by[k]); });
  return out;
}
function migrateMetricZone(p) {
  if (p && METRIC_ZONE_KEYS.indexOf(p.metricZone) !== -1) return p.metricZone;
  if (p && p.metricAxisRole === 'secondary') return 'x';
  return 'series';
}
function deserializePlots(cfg) {
  const list = Array.isArray(cfg) ? cfg : (cfg && Array.isArray(cfg.plots)) ? cfg.plots : [];
  // Every plot is repaired against the dataset IT reads. For a view of one
  // dataset that is the page's, as before; for a plot pinned to another, the
  // filtering below has to ask that one which values exist, or a perfectly good
  // plot would come back with every list reset for naming values the page has
  // never heard of. A pinned dataset that is not in memory falls through to the
  // page's -- the plot still lands, and the card says what happened.
  return list.map(p => withDataset(
    (p && p.datasetId && loadedDataset(p.datasetId)) || DS,
    () => restorePlot(p)));
}
function restorePlot(p) {
  return Object.assign(readProvenance(p), restorePlotFields(p));
}
// A pinned plot keeps its pin across a save and a load, whether or not the
// dataset it names is still there to be found.
function readProvenance(p) {
  if (!p || !p.datasetId) return {};
  return { datasetId: p.datasetId, datasetName: p.datasetName || null };
}
function restorePlotFields(p) {
  const zones = migrateZones(p);
  const included = {};
  DIM_KEYS.forEach(k => {
    const src = (p.included && Array.isArray(p.included[k])) ? p.included[k] : null;
    const kept = src ? src.filter(v => DIM_BY_KEY[k].values.indexOf(v) !== -1) : null;
    // A view that named values, none of which still exist, is not a view of
    // this data -- it was saved against something else. Showing nothing would
    // be an empty chart with no explanation, so fall back to the defaults.
    // An empty list the user actually chose is kept: src was empty to begin with.
    included[k] = kept && (kept.length || !src.length) ? kept : defaultIncluded(k);
  });
  return {
    id: plotIdSeq++,
    chartType: CHART_TYPES.some(t => t[0] === p.chartType) ? p.chartType : 'bars',
    repeatPanelAxis: !!p.repeatPanelAxis,
    dualAxis: !!p.dualAxis,
    forceOneAxis: !!p.forceOneAxis,
    facetsInRow: !!p.facetsInRow,
    breakLines: p.breakLines !== false,
    collapseRepeats: p.collapseRepeats !== false,
    yAxis: normaliseYAxis(p.yAxis),
    yAxisRight: normaliseYAxis(p.yAxisRight),
    yAxisBy: normaliseAxisMap(p.yAxisBy),
    // a dimension that no longer exists is not a line to draw along
    lineAlong: GROUPABLE_KEYS.indexOf(p.lineAlong) !== -1 ? p.lineAlong : null,
    // nor a pair of values to put on two axes
    pins: normalisePins(p.pins),
    style: normalisePlotStyle(p.style),
    metricBreaks: Array.isArray(p.metricBreaks) ? p.metricBreaks.slice() : [],
    zones,
    metricZone: migrateMetricZone(p),
    metricPos: (typeof p.metricPos === 'number' && p.metricPos >= 0) ? p.metricPos : 99,
    included,
  };
}
// Replacing plots is undoable rather than confirmed: a sandboxed page cannot show
// confirm() dialogs, so a blocking prompt would just make the button do nothing.
let undoSnapshot = null;
// replace everything on the page with the saved view
function applyConfig(cfg) {
  const loaded = deserializePlots(cfg);
  plots = loaded.length ? loaded : [makeDefaultPlot()];
  renderPlots();
}
// Every dataset a config names, in memory, before any of it is drawn.
//
// applyConfig stays synchronous -- the suites depend on it, and so does the
// rebuild after an import is edited -- so this is the door for the callers that
// can wait: the toolbar's Load and Add, and the boot. A plot naming a dataset
// that no longer exists resolves to nothing and falls back to the page's, which
// is why this never rejects.
function datasetIdsIn(cfg) {
  const list = Array.isArray(cfg) ? cfg : (cfg && Array.isArray(cfg.plots)) ? cfg.plots : [];
  const out = [];
  list.forEach(p => {
    if (p && p.datasetId && out.indexOf(p.datasetId) === -1) out.push(p.datasetId);
  });
  return out;
}
// Synchronous when it can be, which is almost always: a view of one dataset
// names none, so it lands in the same tick it always did -- which is the
// contract the toolbar, the suites and everything that reads the page straight
// after a Load depend on. Only a view holding plots pinned to datasets that are
// not in memory waits, and only for those.
function loadConfig(cfg, append) {
  const put = () => (append ? appendConfig(cfg) : applyConfig(cfg));
  const need = datasetIdsIn(cfg).filter(id => !loadedDataset(id));
  if (!need.length) return put();
  return ensureDatasetsLoaded(need).then(put, put);
}

// keep what's on the page and append the saved view's plots after it
function appendConfig(cfg) {
  const loaded = deserializePlots(cfg);
  if (loaded.length === 0) return;
  plots = plots.concat(loaded);
  renderPlots();
  const card = document.getElementById('plot-card-' + loaded[0].id);
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// What the autosave was written against. Restoring one dataset's layout onto
// another produces a plot whose every value has been filtered away as unknown --
// an empty chart with nothing to explain it -- so the autosave carries the shape
// it belongs to and is skipped when that shape has changed.
function datasetFingerprint() {
  return DIM_KEYS.join(',') + '|' + METRICS.map(m => m.key).join(',');
}

let autosaveTimer = null;
function persistPlotsDebounced() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(serializePlots()));
      localStorage.setItem(LS_AUTOSAVE_SHAPE, datasetFingerprint());
    } catch (e) {}
  }, 300);
}
function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE_KEY);
    if (!raw) return false;
    // An autosave written before the shape key existed has none; load it, as
    // before -- the repair in deserializePlots still catches a mismatch.
    const shape = localStorage.getItem(LS_AUTOSAVE_SHAPE);
    if (shape && shape !== datasetFingerprint()) return false;
    applyConfig(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}

function readNamedViews() {
  try { return JSON.parse(localStorage.getItem(LS_VIEWS_KEY) || '{}'); } catch (e) { return {}; }
}
function writeNamedViews(obj) {
  try { localStorage.setItem(LS_VIEWS_KEY, JSON.stringify(obj)); } catch (e) {}
}
function saveNamedView(name) { const views = readNamedViews(); views[name] = serializePlots(); writeNamedViews(views); }
function loadNamedView(name) { const views = readNamedViews(); if (views[name]) loadConfig(views[name]); }
function appendNamedView(name) { const views = readNamedViews(); if (views[name]) loadConfig(views[name], true); }
function deleteNamedView(name) { const views = readNamedViews(); delete views[name]; writeNamedViews(views); }

function refreshSavedViewsSelect() {
  const select = document.getElementById('saved-views-select');
  if (!select) return;
  const views = readNamedViews();
  const names = Object.keys(views).sort();
  select.innerHTML = '';
  if (names.length === 0) {
    const o = document.createElement('option'); o.textContent = 'No saved views'; o.disabled = true; select.appendChild(o);
  } else {
    names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; select.appendChild(o); });
  }
}

function exportCurrentConfig() {
  try {
    const blob = new Blob([JSON.stringify({ plots: serializePlots() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'viz-view.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Could not export a file in this environment. Try "Save view" instead.');
  }
}
