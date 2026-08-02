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
  return plots.map(p => ({
    chartType: p.chartType, repeatPanelAxis: p.repeatPanelAxis, dualAxis: p.dualAxis,
    forceOneAxis: !!p.forceOneAxis,
    breakLines: p.breakLines, collapseRepeats: p.collapseRepeats,
    yAxis: Object.assign({}, p.yAxis),
    style: cloneStyle(p.style),
    metricBreaks: (p.metricBreaks || []).slice(),
    zones: cloneZones(p.zones), metricZone: p.metricZone,
    metricPos: p.metricPos, included: cloneIncluded(p.included),
  }));
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
  const missing = GROUPABLE_KEYS.filter(k => !seen[k]);
  if (missing.length) out.facet = missing.concat(out.facet);
  if (out.x.length === 0 && out.series.length === 0 && out.facet.length === GROUPABLE_KEYS.length
      && !(p && (p.zones || p.groupOrder))) {
    return defaultZones();
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
function migrateMetricZone(p) {
  if (p && METRIC_ZONE_KEYS.indexOf(p.metricZone) !== -1) return p.metricZone;
  if (p && p.metricAxisRole === 'secondary') return 'x';
  return 'series';
}
function deserializePlots(cfg) {
  const list = Array.isArray(cfg) ? cfg : (cfg && Array.isArray(cfg.plots)) ? cfg.plots : [];
  return list.map(p => {
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
      breakLines: p.breakLines !== false,
      collapseRepeats: p.collapseRepeats !== false,
      yAxis: normaliseYAxis(p.yAxis),
      style: normalisePlotStyle(p.style),
      metricBreaks: Array.isArray(p.metricBreaks) ? p.metricBreaks.slice() : [],
      zones,
      metricZone: migrateMetricZone(p),
      metricPos: (typeof p.metricPos === 'number' && p.metricPos >= 0) ? p.metricPos : 99,
      included,
    };
  });
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
function loadNamedView(name) { const views = readNamedViews(); if (views[name]) applyConfig(views[name]); }
function appendNamedView(name) { const views = readNamedViews(); if (views[name]) appendConfig(views[name]); }
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
