// axis planning, cartesian product, facet recursion, leaves

// ---- correlation pins -------------------------------------------------------
// A correlation plot's two axes are two readings of the same tuple that differ
// only in what is pinned: X takes one value of the pinned dimension, Y takes the
// other. Everything below reads the pins through `pinsOf`, which re-validates
// them on every call -- a row naming a value the data no longer has can then
// never reach a lookup, whatever is in a stored view.
function pinsOf(plot) {
  return withPlotSchema(plot, () => (
    isCorrelation(plot.chartType) ? normalisePins(plot.pins) : []));
}
function pinnedDimsOf(plot) { return pinsOf(plot).map(r => r.over); }
function metricPinnedIn(plot) { return pinnedDimsOf(plot).indexOf(MEASURE_DIM) !== -1; }
// A pin's x or y may be one value or several, since one axis can hold more than
// one reading. `pinValues` always reads it as a list.
function pinValues(v) {
  return Array.isArray(v) ? v.slice() : (v === undefined || v === null ? [] : [v]);
}
// One axis of the old single-value pins was a single overlay. Several values
// make it several readings, so `pinChoices` enumerates them: every choice of
// one x value and one y value per pinned dimension. One choice is the case the
// chart has always been.
function pinChoices(plot) {
  const rows = pinsOf(plot).map(r => ({ over: r.over, xs: pinValues(r.x), ys: pinValues(r.y) }));
  if (!rows.length) return [];
  const out = [];
  const xv = {}, yv = {};
  const walk = i => {
    if (i === rows.length) { out.push({ xv: Object.assign({}, xv), yv: Object.assign({}, yv) }); return; }
    const r = rows[i];
    r.xs.forEach(x => r.ys.forEach(y => {
      xv[r.over] = x; yv[r.over] = y;
      walk(i + 1);
    }));
  };
  walk(0);
  return out;
}
// Which measures a plot actually READS. Normally the ones shown; a correlation
// plot whose axes differ in Metric reads the ones its pin names instead -- and
// those are what decide which dimensions the measures have already consumed, so
// a pinned comparison measure does not leave the dimension it compares over
// drawing the same dot once per value of it.
function metricsInPlay(plot) {
  const row = pinsOf(plot).filter(r => r.over === MEASURE_DIM)[0];
  if (!row) return plot.included[MEASURE_DIM] || [];
  const keys = pinValues(row.x).concat(pinValues(row.y));
  return keys.filter((k, i) => keys.indexOf(k) === i);
}
// What each axis measures, and whether one range can serve both. Two readings of
// one measure always share a scale; two different measures share one only when
// their formats agree, and that is exactly when a 45 degree line means anything.
// An axis that would hold several measures has to hold ONE kind of measure for
// the axis to be a scale at all, so a mix on either side is reported as such.
function correlationKinds(plot, fallback) {
  const row = pinsOf(plot).filter(r => r.over === MEASURE_DIM)[0];
  const fmt = k => (METRIC_BY_KEY[k] ? METRIC_BY_KEY[k].format : fallback);
  // A Metric pin names the kinds the axes read; without one both axes read the
  // same measure, whose kind is the plot's own.
  const xRaw = row ? pinValues(row.x) : [];
  const yRaw = row ? pinValues(row.y) : [];
  const xKinds = xRaw.length ? xRaw.map(fmt).filter(Boolean) : (fallback ? [fallback] : []);
  const yKinds = yRaw.length ? yRaw.map(fmt).filter(Boolean) : (fallback ? [fallback] : []);
  const oneKind = ks => !ks.length || ks.every(k => sameAxis(ks[0], k));
  const xMixed = !oneKind(xKinds), yMixed = !oneKind(yKinds);
  const shared = !xMixed && !yMixed && xKinds.length && yKinds.length
    && xKinds.every(k => yKinds.every(y => sameAxis(k, y)));
  return {
    xKind: (xKinds[0] || fallback), yKind: (yKinds[0] || fallback),
    shared: shared, xMixed: xMixed, yMixed: yMixed,
  };
}
// What one axis is: the measure(s) it reads, then what it is pinned to. The
// measure's own name rather than its kind -- "Rate A at setB" says what is
// plotted, where "rate % at setB" only says what units it is in.
function pinAxisLabel(plot, which, kind, baseMetricKey) {
  const parts = [];
  const row = pinsOf(plot).filter(r => r.over === MEASURE_DIM)[0];
  const named = row ? pinValues(row[which]).map(v => (METRIC_BY_KEY[v] ? METRIC_BY_KEY[v].label : v)).filter(Boolean) : [];
  if (named.length) parts.push(named.join(' / '));
  else if (kind) parts.push(axisLabelOf(kind));
  pinsOf(plot).forEach(r => {
    if (r.over === MEASURE_DIM) return;
    const vv = pinValues(r[which]).map(v => dimValueLabel(r.over, v));
    parts.push(DIM_BY_KEY[r.over].label + ': ' + vv.join(' / '));
  });
  return parts.join(' · ') || (kind ? axisLabelOf(kind) : '');
}
// A reading's own colour. One pinned dimension and it takes the dimension's
// colour for the value it reads -- a measure keeps its colour wherever it is
// compared, and so does a variant. More than one pinned dimension and there is
// no one value to key it to, so it takes the palette by slot instead.
function corrSeriesColor(plot, ds) {
  const palette = (plot.style && plot.style.palette) || 'default';
  const rows = pinsOf(plot);
  if (rows.length === 1) {
    const r = rows[0];
    const v = ds.choice.xv[r.over];
    if (r.over === MEASURE_DIM && METRIC_BY_KEY[v]) return metricColorOf(palette, v);
    if (r.over !== MEASURE_DIM) return paletteDimValueColor(palette, r.over, v);
  }
  return paletteColorAt(palette, ds.slot);
}
// What one reading is called in the key: "data0 vs baseline" names both axes of
// it, and the unpinned series dims' value follows when there is one.
function corrReadingLabel(plot, c, sv, nSeriesDims) {
  const name = (over, v) => over === MEASURE_DIM
    ? (METRIC_BY_KEY[v] ? METRIC_BY_KEY[v].label : v)
    : dimValueLabel(over, v);
  const parts = [];
  pinsOf(plot).forEach(r => {
    const xl = name(r.over, c.xv[r.over]);
    const yl = name(r.over, c.yv[r.over]);
    parts.push(xl === yl ? xl : xl + ' vs ' + yl);
  });
  const base = parts.join(' · ');
  if (nSeriesDims && sv.label !== 'All') return base ? base + ' · ' + sv.label : sv.label;
  return base;
}

// ---- recursive facet + leaf chart rendering ----
// Metric is a dedicated "data shown" selector. With exactly 1 metric included it is
// a pure filter; with 2+ it joins the grouping as a chip in plot.metricZone.
// Everything below reads the dimensions and measures of the plot's own dataset,
// so it is entered under that dataset rather than under whichever one the page
// last looked at. The pattern throughout: the `render`/`compute` name is the
// entry point and does the binding, the `draw`/`...Of` name is the body.
// Wrapping this one covers the most ground -- four callers, and it hands back
// plain data every one of them reads afterwards.
function computeAxisPlan(plot) {
  return withPlotSchema(plot, () => axisPlanOf(plot));
}
function axisPlanOf(plot) {
  const pinnedDims = pinnedDimsOf(plot);
  // A pin CONSUMES the dimension it names: both axes already say which value of
  // it they read. For Metric that also means it is not an axis and not a panel
  // split -- otherwise a plot showing two measures would be stacked into one
  // panel per scale, and the correlation between them, which is the whole
  // chart, could never be drawn at all.
  const metricActive = plot.included.metric.length > 1 && !metricPinnedIn(plot);
  // Two measures may share a y-axis only when their formats agree on one. Comparing
  // formats by identity was wrong: two unrelated `number` measures (nanoseconds and
  // bytes) would have been merged onto one scale.
  const groups = [];
  plot.included[MEASURE_DIM].forEach(mk => {
    const g = METRIC_BY_KEY[mk].format.axisGroup;
    if (groups.indexOf(g) === -1) groups.push(g);
  });
  // Measures on different scales can never share an axis, so rather than refusing to
  // draw, fall back to stacked panels and say so. A table prints text, so unlike a
  // chart it can hold measures of different scales.
  const mixedKinds = metricActive && groups.length > 1 && plot.chartType !== 'table';
  const kindNames = groups.map(g => {
    const m = plot.included[MEASURE_DIM].map(k => METRIC_BY_KEY[k])
      .filter(x => x && x.format.axisGroup === g)[0];
    return m ? axisLabelOf(m.format) : g;
  });
  // mixedKinds is the fact; splitScales is what we do about it, which the user
  // can override
  let splitScales = mixedKinds;
  // Two views of the same thing: `zoneDims` drives the UI and shows the Metric chip
  // wherever the user actually put it (so it stays draggable); `axisDims` drives the
  // chart and pulls Metric out of the axes when it is being drawn as panels.
  const zoneDims = {}, axisDims = {};
  ZONE_KEYS.forEach(k => {
    const arr = Array.isArray(plot.zones[k]) ? plot.zones[k].slice() : [];
    zoneDims[k] = arr; axisDims[k] = arr.slice();
  });
  zoneDims[PANEL_ZONE.key] = [];
  axisDims[PANEL_ZONE.key] = [];
  let metricPanels = null;
  let forcedPanels = false;
  let dualAxis = false;
  if (metricActive) {
    const mz = METRIC_ZONE_KEYS.indexOf(plot.metricZone) === -1 ? 'series' : plot.metricZone;
    const at = Math.max(0, Math.min(plot.metricPos === undefined ? 99 : plot.metricPos, zoneDims[mz].length));
    zoneDims[mz].splice(at, 0, 'metric');
    // a second y-axis is only meaningful for a cartesian chart whose series carry
    // the differing metrics, and only for exactly two scales
    dualAxis = !!plot.dualAxis && mixedKinds && groups.length === 2
      && mz === 'series' && supportsDualAxis(plot.chartType);
    // "One axis" is a decision, not a default: two measures can differ in kind
    // and still be readable together -- a rate and a relative change are both
    // percentages, and forcing them apart says they are less comparable than
    // they are. Splitting them stays the default because usually they are.
    if (plot.forceOneAxis && mixedKinds && !dualAxis) splitScales = false;
    forcedPanels = splitScales && mz !== PANEL_ZONE.key && !dualAxis;
    if (mz === PANEL_ZONE.key || forcedPanels) {
      // Drawn as panels: Metric is not an axis. One panel per SCALE, not per
      // metric -- two hit rates share an axis perfectly well, and splitting
      // them into a panel each says they cannot be compared when they can.
      metricPanels = metricScaleGroups(plot.included.metric);
    } else {
      axisDims[mz].splice(at, 0, 'metric');
    }
  }
  // A dimension every shown measure is constant along is not a grouping in ANY
  // zone. Dropping it from Series and X but not from Facets left the compared
  // dimension splitting the page into one chart per value of itself, each an
  // identical copy -- the comparison had already consumed it, so every copy
  // held the same numbers.
  const ignoredDims = metricsIgnoredDims(metricsInPlay(plot));
  if (ignoredDims.length) {
    ZONE_KEYS.forEach(k => {
      axisDims[k] = axisDims[k].filter(dk => ignoredDims.indexOf(dk) === -1);
    });
  }
  // A pinned dimension is spent, and is removed from EVERY zone for the same
  // reason as an ignored one. Left in Facets it would draw one card per value
  // of it, each an identical chart, because the pin overrides the facet's value
  // on both axes. Left in "Not used" it would be worse than useless: the
  // averaging there overwrites the tuple's value for that dimension, which
  // would quietly make the two axes read the same thing.
  if (pinnedDims.length) {
    ZONE_KEYS.forEach(k => {
      axisDims[k] = axisDims[k].filter(dk => pinnedDims.indexOf(dk) === -1);
    });
  }
  // Not a grouping and not a filter: the values are read and folded together,
  // so a dimension parked here changes what every number IS without changing
  // where any of them sits. A measure that is constant along it is already
  // averaged over it by definition, so it is not listed twice.
  const offDims = axisDims[OFF_ZONE].filter(
    k => DIM_BY_KEY[k] && ignoredDims.indexOf(k) === -1);
  let seriesCount = 1;
  axisDims.series.forEach(k => { seriesCount *= Math.max(plot.included[k].length, 0); });
  return {
    ignoredDims: ignoredDims,
    pinnedDims: pinnedDims,
    offDims: offDims,
    metricActive: metricActive,
    zoneDims: zoneDims,
    facetDims: axisDims.facet,
    seriesDims: axisDims.series,
    xDims: axisDims.x,
    seriesCount: seriesCount,
    metricPanels: metricPanels,
    mixedKinds: mixedKinds,
    forcedPanels: forcedPanels,
    dualAxis: dualAxis,
    dualEligible: mixedKinds && groups.length === 2 && supportsDualAxis(plot.chartType),
    metricKinds: kindNames,
    // whether an override is on offer, and whether it is doing anything
    // Not offered where the two axes are separate scales by design: forcing
    // "one shared y-axis" on a correlation plot would be an instruction about
    // an axis arrangement it does not have.
    oneAxisEligible: groups.length > 1 && !isGridType(plot.chartType)
      && !isCorrelation(plot.chartType),
    oneAxisForced: !!plot.forceOneAxis && groups.length > 1 && !dualAxis,
    // how many y-scales the shown measures need. A frame has two axes, so past
    // two the second-axis offer is withdrawn -- and the head says why rather
    // than letting the control vanish without explanation.
    scaleCount: groups.length,
  };
}

// Cartesian product of the included values of `dims`, in order: the first dim varies
// slowest, so consecutive entries share their outer values (which is what lets the
// x-axis draw nested grouping bands).
function comboEntries(plot, dims) {
  let out = [{ vals: {}, labels: [] }];
  for (let i = 0; i < dims.length; i++) {
    const dimKey = dims[i];
    const values = plot.included[dimKey];
    const next = [];
    out.forEach(e => values.forEach(v => {
      const vals = Object.assign({}, e.vals); vals[dimKey] = v;
      next.push({ vals: vals, labels: e.labels.concat([dimValueLabel(dimKey, v)]) });
    }));
    out = next;
  }
  out.forEach(e => { e.label = e.labels.length ? e.labels.join(SEP) : 'All'; });
  return out;
}

// The dimensions that EVERY measure in play is constant along. A comparison has
// already consumed the dimension it compares over, and one it averages over; a
// formula built on one inherits that. Grouping by such a dimension draws the
// same number once per value of it, which reads as data and is not.
//
// Every measure, because the axis is shared: a dimension one measure is flat
// along is still a grouping for another that varies along it.
function metricsIgnoredDims(inPlay) {
  const keys = inPlay || [];
  if (!keys.length) return [];
  return GROUPABLE_KEYS.filter(k => keys.every(mk => metricIgnoresDim(mk, k)));
}

// Yields the format the leaf should draw with, plus the dimensions the measures
// in play do not vary along, so a comparison is not repeated once per value of
// the thing it already compares.
function effectiveKind(plot, fixed) {
  // A pinned Metric decides this instead of `fixed` and instead of the shown
  // list: the pin is what the axes read, and one of the two measures it names
  // is the one this leaf draws with.
  const inPlay = metricPinnedIn(plot) ? metricsInPlay(plot)
    : (fixed[MEASURE_DIM] !== undefined) ? [fixed[MEASURE_DIM]] : plot.included[MEASURE_DIM];
  const formats = [];
  const groups = [];
  inPlay.forEach(mk => {
    const m = METRIC_BY_KEY[mk];
    if (!m) return;
    if (groups.indexOf(m.format.axisGroup) === -1) { groups.push(m.format.axisGroup); formats.push(m.format); }
  });
  // Inside a panel `inPlay` is the one measure that panel draws, so this is
  // narrower than the plan-wide answer and catches what that could not.
  const ignoredDims = metricsIgnoredDims(inPlay);
  if (groups.length === 1) return { kind: formats[0], mixed: false, ignoredDims };
  // Forced onto one axis: the first measure's format decides how the axis reads,
  // and the caller says so on the chart rather than letting it pass unremarked.
  const named = formats.map(axisLabelOf);
  if (plot.forceOneAxis) {
    return { kind: formats[0], mixed: false, ignoredDims, forcedOne: true, kinds: named };
  }
  return { kind: null, mixed: true, kinds: named, ignoredDims: [] };
}

// A delta panel drops the Variant dimension (the comparison is already in the metric),
// so panels would otherwise be laid out at different widths and not line up under the
// shared x-axis. Give every panel the widest panel's slot count.
function seriesSlotsFor(plot, axes, metricKey) {
  const m = METRIC_BY_KEY[metricKey];
  let n = 1;
  axes.seriesDims.forEach(k => {
    if (measureIgnoresDim(m, k)) return;
    n *= Math.max(plot.included[k].length, 1);
  });
  return n;
}

// Metrics that can share one y-axis, in the order they are shown. Grouping by
// axisGroup rather than by format identity is what keeps two unrelated `number`
// measures apart while letting two percentages together.
// Inside a panel or a group column, Metric has to sit on an axis that leaf
// actually draws. If the user put it in Facets or Panels, that choice has
// already been spent making this panel -- so within it Metric becomes Series,
// which is the predictable place for it. X is honoured because it still means
// something here.
function innerMetricView(plot, metricKeys) {
  const mz = (plot.metricZone === 'x' || plot.metricZone === 'series') ? plot.metricZone : 'series';
  return Object.assign({}, plot, {
    included: Object.assign({}, plot.included, { metric: metricKeys.slice() }),
    metricBreaks: [],
    metricZone: mz,
    // the scale groups of the WHOLE plot, so a panel can still tell which of
    // them it is -- it has been narrowed to one and would otherwise look like a
    // single-scale plot and read the plot-wide axis settings
    __scaleGroups: plot.__scaleGroups || metricScaleGroups(plot.included[MEASURE_DIM]),
  });
}

// Which axis settings a panel drawing `format` should use. One scale: the
// plot-wide Y, exactly as before. Several: the first keeps the plot-wide one
// (so a range set before a second measure arrived is not lost) and every other
// scale gets its own -- a maximum of 100 chosen for a percentage has no
// business bounding a duration drawn underneath it.
function axisSlotFor(plot, format) {
  const groups = plot.__scaleGroups || metricScaleGroups(plot.included[MEASURE_DIM] || []);
  if (!format || !groups || groups.length < 2) return plot.yAxis;
  const g = format.axisGroup;
  const firstKey = groups[0] && groups[0][0];
  const first = firstKey && METRIC_BY_KEY[firstKey];
  if (first && first.format.axisGroup === g) return plot.yAxis;
  const by = plot.yAxisBy || (plot.yAxisBy = {});
  if (!by[g]) by[g] = { min: null, max: null, scale: 'auto' };
  return by[g];
}

function metricScaleGroups(keys) {
  const groups = [];
  const at = {};
  keys.forEach(mk => {
    const m = METRIC_BY_KEY[mk];
    if (!m) return;
    const g = m.format.axisGroup;
    if (at[g] === undefined) { at[g] = groups.length; groups.push([mk]); }
    else groups[at[g]].push(mk);
  });
  return groups;
}

// ---- metric groups ---------------------------------------------------------
// A divider dropped into the "Data shown" list splits the metrics into groups.
// A group is a band on the x-axis when everything shares one scale, and a chart
// of its own when it does not -- because a percentage and a raw count have no
// axis in common, and one of them would be a flat line against the other.
const MGROUP_DIM = '__mgroup';

function metricGroupsOf(plot) {
  const shown = plot.included[MEASURE_DIM] || [];
  const breaks = plot.metricBreaks || [];
  if (!breaks.length || shown.length < 2) return null;
  const groups = [];
  let cur = [];
  shown.forEach(mk => {
    cur.push(mk);
    if (breaks.indexOf(mk) !== -1) { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  return groups.length > 1 ? groups : null;
}

// What the band says. Naming a group by its shared scale reads well -- until two
// groups share one, and then both bands are called "rate %", the axis code sees
// one value, and they merge into a single band that silently says the split did
// not happen. The metrics themselves are always distinct, so they are the name.
function metricGroupLabel(group) {
  const names = group.map(mk => (METRIC_BY_KEY[mk] ? METRIC_BY_KEY[mk].label : mk));
  if (names.length <= 3) return names.join(' / ');
  return names.slice(0, 2).join(' / ') + ' +' + (names.length - 2) + ' more';
}

function metricGroupsShareScale(groups) {
  const fmts = [];
  groups.forEach(g => g.forEach(mk => {
    const m = METRIC_BY_KEY[mk];
    if (m) fmts.push(m.format);
  }));
  return fmts.length > 0 && fmts.every(f => sameAxis(f, fmts[0]));
}

// One chart per group, laid out left to right. Each computes its own y-scale,
// which is the whole point: the groups are here because they do not share one.
function renderMetricGroupCols(plot, fixed, axes, container, groups) {
  html('div', 'chart-note', container).textContent =
    'These groups are on different scales, so each has its own y-axis.';
  const row = html('div', 'metric-row', container);
  groups.forEach(g => {
    const label = metricGroupLabel(g);
    const col = html('div', 'metric-col', row);
    col.setAttribute('data-caption', label);
    const t = html('div', 'panel-title', col);
    html('span', 'panel-name', t).textContent = label;
    addTikzButton(t, () => col, 'TikZ', label, 'btn small ghost');
    const view = innerMetricView(plot, g);
    // The group needs its OWN plan, not the parent's. The parent's was computed
    // across every metric at once, so mixed scales had already forced Metric
    // into panels -- handing that down leaves the leaf with no metric on any
    // axis and nothing to draw. Within one group the scales usually agree, so
    // Metric goes back where the user put it; where they still do not, this
    // falls through to stacked panels inside the column, which is correct.
    const subPlan = computeAxisPlan(view);
    const subFixed = Object.assign({}, fixed);
    // A group of one leaves Metric a filter rather than a dimension, exactly as
    // it is for a single-metric plot -- and then the value has to be pinned
    // here, or the leaf asks for a metric nobody named and draws nothing.
    if (!subPlan.metricActive) subFixed.metric = g[0];
    renderLeafPanels(view, subFixed, axesFromPlan(subPlan), col);
  });
}

function renderLeaf(plot, fixed, axes, container) {
  // only where Metric is still a free dimension: inside a per-metric panel it
  // has already been fixed to one value and there is nothing left to group
  const groups = (fixed[MEASURE_DIM] === undefined) ? metricGroupsOf(plot) : null;
  if (groups) {
    if (metricGroupsShareScale(groups) && axes.xDims.indexOf(MEASURE_DIM) !== -1) {
      renderLeafOne(plot, fixed, axes, container, { metricBands: groups });
      return;
    }
    renderMetricGroupCols(plot, fixed, axes, container, groups);
    return;
  }
  return renderLeafPanels(plot, fixed, axes, container);
}

function renderLeafPanels(plot, fixed, axes, container) {
  if (!axes.metricPanels) { renderLeafOne(plot, fixed, axes, container); return; }
  const groups = axes.metricPanels;
  let slots = 1;
  groups.forEach(g => g.forEach(mk => { slots = Math.max(slots, seriesSlotsFor(plot, axes, mk)); }));
  if (axes.forcedPanels) {
    html('div', 'chart-note', container).textContent = groups.length === 1
      ? 'One panel — these measures share a scale.'
      : 'Different scales — one panel per scale, each with its own y-axis. '
        + 'Measures of the same kind share a panel.';
  }
  // one stacked sub-chart per scale, each with its own y-scale, sharing the
  // x-axis: only the last panel carries the x tick labels and the legend
  groups.forEach((g, i) => {
    const last = i === groups.length - 1;
    const label = metricGroupLabel(g);
    const panel = html('div', 'metric-panel', container);
    panel.setAttribute('data-caption', label);
    const pt = html('div', 'panel-title', panel);
    html('span', 'panel-name', pt).textContent = label;
    addTikzButton(pt, () => panel, 'TikZ', label, 'btn small ghost');
    const opts = {
      showXLabels: plot.repeatPanelAxis || last,
      // Only the last panel carries the legend, because a panel of one metric is
      // named by its own title. A panel holding SEVERAL always needs one: its
      // title names the scale, not which series is which.
      showLegend: plot.repeatPanelAxis || last || g.length > 1,
      slots: slots,
    };
    if (g.length === 1) {
      const panelFixed = Object.assign({}, fixed);
      panelFixed.metric = g[0];
      renderLeafOne(plot, panelFixed, axes, panel, opts);
      return;
    }
    // Several metrics on one panel: Metric has to be a real dimension again
    // inside it, so the panel needs its own plan -- the outer one had already
    // taken Metric off the axes to make these panels in the first place.
    const view = innerMetricView(plot, g);
    renderLeafOne(view, fixed, axesFromPlan(computeAxisPlan(view)), panel, opts);
  });
}

function renderLeafOne(plot, fixed, axes, container, opts) {
  // The deepest point that still knows which plot it is drawing, and the last
  // one before numbers are read. A path that got here without entering the
  // plot's dataset would draw a plausible chart of the wrong data, so in strict
  // mode it says so instead.
  assertPlotSchema(plot, 'renderLeafOne');
  opts = opts || {};
  const seriesDims = axes.seriesDims, xDims = axes.xDims;
  const emptyDim = seriesDims.concat(xDims).find(k => plot.included[k].length === 0);
  if (emptyDim) {
    html('div', 'plot-empty', container).textContent = 'Nothing to show - enable at least one value for ' + DIM_BY_KEY[emptyDim].label + '.';
    return;
  }
  // A dimension that is not used still decides what is averaged, so emptying it
  // empties every cell -- which reads as "no data" and is not.
  const emptyOff = (axes.offDims || []).find(k => plot.included[k].length === 0);
  if (emptyOff) {
    html('div', 'plot-empty', container).textContent =
      DIM_BY_KEY[emptyOff].label + ' is not used here, so its shown values are what '
      + 'every number is averaged over — and none of them are shown. Enable at least one.';
    return;
  }
  const isTable = plot.chartType === 'table';
  const isCorr = isCorrelation(plot.chartType);
  const dual = !!axes.dualAxis;
  const kindInfo = effectiveKind(plot, fixed);
  // A correlation plot reads one quantity per axis and gives each its own
  // scale, so two measures of different kind are the point of it rather than a
  // mixture on one axis. The test is the pin, not the chart type: with Metric
  // NOT pinned, two measures of different scale are genuinely mixed here too,
  // and are still split into panels.
  const corrPinned = isCorr && metricPinnedIn(plot);
  if (kindInfo.mixed && !isTable && !dual && !corrPinned) {
    html('div', 'plot-empty', container).textContent =
      'This chart mixes metrics of different scale (' + kindInfo.kinds.join(', ') + ') on one axis - drag Metric to the Panels zone to stack them as sub-charts with their own scales, or restrict "Data shown" to a single kind.';
    return;
  }

  // A comparison measure already contains the comparison, so grouping by the very
  // dimension it compares over would repeat the same bar once per value of it.
  // The same is true of a dimension it averages over.
  const dropDims = (kindInfo.ignoredDims || []).filter(
    k => seriesDims.indexOf(k) !== -1 || xDims.indexOf(k) !== -1);
  const sDims = dropDims.length ? seriesDims.filter(k => dropDims.indexOf(k) === -1) : seriesDims;
  const xD = dropDims.length ? xDims.filter(k => dropDims.indexOf(k) === -1) : xDims;

  // comboEntries is a cartesian product. With a hardcoded schema its size was
  // known; with an imported CSV a free-text column marked as a dimension would
  // hang the render, so refuse loudly and name the culprit instead.
  const CELL_LIMIT = 20000;
  let cells = 1;
  let widest = null;
  sDims.concat(xD).forEach(k => {
    const n = Math.max(plot.included[k].length, 1);
    cells *= n;
    if (!widest || n > Math.max(plot.included[widest].length, 1)) widest = k;
  });
  if (cells > CELL_LIMIT) {
    html('div', 'plot-empty', container).textContent =
      'That would draw ' + cells.toLocaleString() + ' cells. '
      + (widest ? DIM_BY_KEY[widest].label + ' alone has ' + plot.included[widest].length + ' values — ' : '')
      + 'move a dimension into Facets or narrow its included values.';
    return;
  }

  const seriesAll = comboEntries(plot, sDims);
  const xAll = comboEntries(plot, xD);
  // colour is assigned before any pruning so a series keeps its colour when other
  // series drop out of a facet (colour follows the entity, never its rank)
  // Colour, shape and texture are all assigned before any pruning and all keyed
  // to the series' slot rather than its index, so a series keeps its whole
  // appearance when other series drop out of a facet.
  const style = plot.style || (plot.style = defaultPlotStyle());
  // Colouring by metric hands colour to the measure, so it is no longer telling
  // the series apart -- and if nothing else is, they are distinguished by
  // nothing at all. Give them a shape or a texture instead.
  const seriesNeedMark = style.colourBy === 'metric'
    && sDims.indexOf(MEASURE_DIM) === -1 && seriesAll.length > 1;
  seriesAll.forEach((e, i) => {
    const slot = (sDims.length === 1 && DIM_BY_KEY[sDims[0]])
      ? Math.max(DIM_BY_KEY[sDims[0]].values.indexOf(e.vals[sDims[0]]), 0) : i;
    const ov = style.series[seriesSignature(e)] || {};
    e.sig = seriesSignature(e);
    e.color = ov.color || ((sDims.length === 1)
      ? paletteDimValueColor(style.palette, sDims[0], e.vals[sDims[0]])
      : paletteColorAt(style.palette, i));
    // "none" for markers is a deliberate choice and is left alone; a fixed
    // shape or a solid fill is only a default, and yields.
    e.shape = ov.shape
      || ((style.markers === 'auto' || (seriesNeedMark && style.markers !== 'none'))
        ? markShapeAt(slot) : style.markers);
    e.pattern = ov.pattern
      || ((style.barPattern === 'auto' || seriesNeedMark) ? barPatternAt(slot) : style.barPattern);
  });

  // Dimensions the plot is not using are folded together here rather than left
  // out of the tuple: a ctx missing a dimension names no row at all, so without
  // this the chart would be empty rather than averaged.
  const offDims = (axes.offDims || []).filter(k => fixed[k] === undefined);
  const offValues = k => plot.included[k] || [];
  // A pin is a ctx overlay applied LAST, so it wins over the values a facet
  // pinned and over the dot's own tuple -- which is what makes it a pin.
  // `overlay` is null for every chart type but the correlation plot, and then
  // this is the reader it has always been.
  // Named rather than ambient, alone among the reads in this file. Everywhere
  // else the live schema decides a label or which options a list offers, and
  // getting it wrong is visible; here it decides which numbers are drawn, and
  // getting it wrong is a chart that looks entirely reasonable.
  const ds = datasetOf(plot);
  function valueAt(sEntry, xEntry, overlay) {
    if (!ds) return null;
    const ctx = Object.assign({}, fixed, sEntry.vals, xEntry.vals, overlay || null);
    return offDims.length
      ? datasetValueOver(ds, ctx, offDims, offValues)
      : datasetValueAt(ds, ctx);
  }
  function getValue(sEntry, xEntry) { return valueAt(sEntry, xEntry, null); }
  const corrChoices = isCorr ? pinChoices(plot) : [];
  // The one overlay the chart has always used, for the common single-value pins;
  // the multi-value case reads each choice's own overlay below.
  const pinX = isCorr && corrChoices.length === 1 ? corrChoices[0].xv : null;
  const pinY = isCorr && corrChoices.length === 1 ? corrChoices[0].yv : null;
  // A correlation plot with a Metric pin that reads a mix of scales on one axis
  // has no scale to draw that axis with, so it says so rather than drawing dots
  // the axis cannot place.
  if (isCorr && metricPinnedIn(plot)) {
    const ck = correlationKinds(plot, kindInfo.kind);
    if (ck.xMixed || ck.yMixed) {
      html('div', 'plot-empty', container).textContent =
        'One axis would read measures of different scale — an axis is one scale, '
        + 'so keep one kind of measure per axis.';
      return;
    }
  }
  // drop combinations that have no data at all (e.g. 1024-line configs on the dev1,
  // or Tuned-altnterleaved on apps that don't have it) so the axis has no dead slots
  //
  // For a correlation plot this has to ask the pinned question, not the bare
  // one: with the pinned dimension absent from the tuple the bare lookup names
  // no row at all and returns null everywhere, which would prune away every
  // combination and report "no data" for a chart that has plenty. A dot also
  // needs BOTH readings -- a tuple measured on one axis only is half a point,
  // and half a point cannot be placed.
  const live = isCorr
    ? corrChoices.length
      ? (s, x) => corrChoices.some(c => valueAt(s, x, c.xv) !== null && valueAt(s, x, c.yv) !== null)
      : (s, x) => getValue(s, x) !== null
    : (s, x) => getValue(s, x) !== null;
  const xVals = xAll.filter(x => seriesAll.some(s => live(s, x)));
  const sVals = seriesAll.filter(s => xVals.some(x => live(s, x)));
  if (xVals.length === 0 || sVals.length === 0) {
    html('div', 'plot-empty', container).textContent = 'No data for this combination.';
    return;
  }

  // One series per reading. A correlation plot's series are the readings its
  // pin names: single-value pins give the series the chart has always had, and
  // a pin holding several values on one axis gives one series per choice of
  // them -- data0 vs baseline and data1 vs baseline in one chart, told apart by
  // colour and shape. Built here because the series styling and the per-series
  // overrides already are.
  const corrSeries = (function () {
    if (!isCorr) return null;
    const multi = corrChoices.length > 1;
    const out = [];
    sVals.forEach(sv => corrChoices.forEach(c => {
      const ds = {
        // a single reading keeps the series signature it has always had, so
        // per-series overrides made for it survive; several readings need a
        // signature of their own, and get the pinned values in it
        vals: multi ? Object.assign({}, sv.vals, c.xv) : sv.vals,
        sv: sv, choice: c, slot: out.length,
        label: multi ? corrReadingLabel(plot, c, sv, sDims.length) : sv.label,
      };
      ds.sig = seriesSignature(ds);
      const ov = style.series[ds.sig] || {};
      ds.color = ov.color || corrSeriesColor(plot, ds);
      ds.shape = ov.shape || (style.markers === 'auto' ? markShapeAt(out.length) : style.markers);
      ds.pattern = ov.pattern || (style.barPattern === 'auto' ? barPatternAt(out.length) : style.barPattern);
      out.push(ds);
    }));
    return out;
  })();

  // What the style panel offers overrides for: the series this chart really has,
  // after pruning, deduplicated across facets.
  if (!plot.__drawnSeries) plot.__drawnSeries = [];
  (corrSeries || sVals).forEach(sv => {
    if (!plot.__drawnSeries.some(o => o.sig === sv.sig)) {
      plot.__drawnSeries.push({ sig: sv.sig, label: sv.label, color: sv.color });
    }
  });

  // The group band is a synthetic axis level: nothing downstream knows or cares
  // where an x dimension came from -- xLayout keys its gaps off `vals` and
  // drawXAxis labels its bands off `labels` -- so adding one entry to each is
  // the whole of it. Done after pruning, so the band describes what is drawn.
  let xDimsOut = xD;
  if (opts.metricBands) {
    const at = xD.indexOf(MEASURE_DIM);
    if (at !== -1) {
      const bandOf = {};
      opts.metricBands.forEach((g, gi) => {
        const lb = metricGroupLabel(g);
        g.forEach(mk => { bandOf[mk] = { key: 'g' + gi, label: lb }; });
      });
      xVals.forEach(xv => {
        const b = bandOf[xv.vals[MEASURE_DIM]] || { key: '', label: '' };
        // the key is the group, not its name: two groups may read alike and
        // must still be two bands
        xv.vals[MGROUP_DIM] = b.key;
        xv.labels = xv.labels.slice();
        xv.labels.splice(at, 0, b.label);
        xv.label = xv.labels.join(SEP);
      });
      xDimsOut = xD.slice(0, at).concat([MGROUP_DIM], xD.slice(at));
    }
  }

  // A line may only join points inside one innermost group: crossing into the next
  // Device or size block would draw a slope between unrelated configurations.
  let lineBreaks = null;
  if (plot.breakLines !== false && xDimsOut.length > 1) {
    lineBreaks = {};
    axisRuns(xVals, xDimsOut, xDimsOut.length - 2).forEach(r => { lineBreaks[r.start] = true; });
  }
  // Naming the dimension a line runs along says what the line MEANS, and that
  // is a different question from where the bars happen to sit. The points of
  // one line then need not be adjacent on the axis, and a missing value is a
  // gap the line steps over rather than the end of it.
  const lineRuns = plot.lineAlong ? lineRunsFor(xVals, xDimsOut, plot.lineAlong) : null;

  // One dot per surviving tuple, read twice. Built here rather than in the leaf
  // because this is where the cartesian product, the pruning and the series'
  // colours already are -- the leaf should receive numbers it can place.
  let points = null;
  let corr = null;
  if (isCorr) {
    corr = correlationKinds(plot, kindInfo.kind);
    points = [];
    corrSeries.forEach(ds => xVals.forEach(xv => {
      const vx = valueAt(ds.sv, xv, ds.choice.xv);
      const vy = valueAt(ds.sv, xv, ds.choice.yv);
      if (vx === null || vy === null) return;
      const parts = [xv.label, ds.label].filter(t => t && t !== 'All');
      points.push({ x: vx, y: vy, sv: ds, xv: xv, label: parts.join(SEP) || 'All' });
    }));
  }

  const corrOut = corrSeries || sVals;
  const spec = {
    series: corrOut, x: xVals, xDims: xDimsOut, seriesDims: sDims,
    lineBreaks: lineBreaks, lineRuns: lineRuns,
    colourBy: style.colourBy,
    getValue: getValue, kind: kindInfo.kind,
    yAxis: axisSlotFor(plot, kindInfo.kind), yAxisRight: plot.yAxisRight,
    style: style, chartType: plot.chartType,
    slots: opts.slots,
    collapseRepeats: plot.collapseRepeats !== false,
    fixedCtx: fixed,
    // a plain record of what is plotted, so an export can ship data instead of shapes
    dataTable: {
      xDims: xDimsOut, seriesDims: sDims, kind: kindInfo.kind, chartType: plot.chartType,
      seriesLabels: corrOut.map(sv => sv.label),
      // so a pgfplots figure carries the same appearance as the chart on screen
      seriesStyles: corrOut.map(sv => ({ color: sv.color, shape: sv.shape, pattern: sv.pattern })),
      yAxis: axisSlotFor(plot, kindInfo.kind), yAxisRight: plot.yAxisRight,
      markers: style.markers,
      // pgfplots gives one colour per \addplot, so a chart whose colour varies
      // WITHIN a series is something it cannot say. Recorded here so the export
      // can admit the difference rather than quietly drop it.
      colourPerPoint: style.colourBy === 'metric' && sDims.indexOf(MEASURE_DIM) === -1,
      rows: xVals.map(xv => ({
        label: xv.label,
        parts: xv.labels.slice(),
        values: sVals.map(sv => getValue(sv, xv)),
      })),
    },
    metricKeyAt: function (sEntry, xEntry) {
      // A correlation dot has two metrics; the Y one is what colours it, since
      // the y-axis is what the eye reads a dot's height against.
      const ctx = Object.assign({}, fixed, sEntry.vals, xEntry.vals,
        sEntry.choice ? sEntry.choice.yv : (isCorr ? pinY : null));
      return ctx.metric;
    },
    showXLabels: opts.showXLabels !== false,
    showLegend: opts.showLegend !== false,
  };
  spec.dualAxis = dual;
  if (isCorr) {
    spec.points = points;
    spec.pins = pinsOf(plot);
    spec.xKind = corr.xKind;
    spec.yKind = corr.yKind;
    spec.sharedScale = corr.shared;
    spec.diagonal = corr.shared;
    const baseMetric = fixed[MEASURE_DIM] || (plot.included[MEASURE_DIM] || [])[0];
    spec.xAxisLabel = pinAxisLabel(plot, 'x', corr.xKind, baseMetric);
    spec.yAxisLabel = pinAxisLabel(plot, 'y', corr.yKind, baseMetric);
    // One quantity on both axes means ONE range object, so the two cannot be
    // set apart by hand and quietly break the claim the diagonal makes. Two
    // quantities get a range each, and the horizontal one borrows the slot the
    // second y-axis would have used -- this chart type has no second y-axis, so
    // nothing else wants it and no new stored state is needed.
    spec.yAxis = plot.yAxis;
    spec.xAxis = corr.shared ? plot.yAxis : plot.yAxisRight;
    spec.dataTable.scatter = true;
    spec.dataTable.pointCols = 2;
    spec.dataTable.kind = corr.yKind;
    spec.dataTable.xKind = corr.xKind;
    spec.dataTable.xAxis = spec.xAxis;
    spec.dataTable.yAxis = spec.yAxis;
    spec.dataTable.diagonal = corr.shared;
    spec.dataTable.band = corr.shared && !!style.diagBand;
    spec.dataTable.xAxisLabel = spec.xAxisLabel;
    spec.dataTable.yAxisLabel = spec.yAxisLabel;
    spec.dataTable.rows = xVals.map(xv => ({
      label: xv.label,
      parts: xv.labels.slice(),
      values: corrSeries.reduce((acc, ds) => acc.concat(
        [valueAt(ds.sv, xv, ds.choice.xv), valueAt(ds.sv, xv, ds.choice.yv)]), []),
    }));
    // the drawn span, so an exported diagonal covers the same ground as the one
    // on screen rather than the whole axis
    const spanVals = [];
    points.forEach(p => { spanVals.push(p.x); spanVals.push(p.y); });
    spec.dataTable.range = spanVals.length
      ? [Math.min.apply(null, spanVals), Math.max.apply(null, spanVals)] : [0, 1];
  }
  if (isCorr) renderCorrelationLeaf(container, spec);
  else if (isTable) renderTableLeaf(container, spec);
  else if (plot.chartType === 'matrix') renderMatrixLeaf(container, spec);
  else if (plot.chartType === 'diverging') renderBarLeafDiverging(container, spec);
  else if (dual) renderDualAxisLeaf(container, spec, plot.chartType === 'lines');
  else if (plot.chartType === 'lines') renderLineLeaf(container, spec);
  else renderBarLeaf(container, spec);
  if (kindInfo.forcedOne) {
    // "May be hard to read" is an understatement when a bar comes out one pixel
    // tall, which is what a duration next to a percentage actually does. Count
    // them and say so, or it reads as the measure having been dropped.
    const seen = [];
    xVals.forEach(x => sVals.forEach(sv => {
      const v = getValue(sv, x);
      if (v !== null && v !== undefined) seen.push(Math.abs(v));
    }));
    const hi = seen.reduce((a, b) => Math.max(a, b), 0);
    const tiny = hi > 0 ? seen.filter(v => v > 0 && v / hi < 0.01).length : 0;
    html('div', 'chart-note', container).textContent =
      'These measures are on different scales (' + kindInfo.kinds.join(' + ')
      + ') but share one axis'
      + (tiny
        ? ', and ' + tiny + ' value' + (tiny === 1 ? ' is' : 's are')
          + ' under a hundredth of the tallest — drawn, but too small to see. '
          + 'Turn on value labels in Style, or leave the panels split.'
        : ', so the smaller of them may be hard to read.');
  }
  if (dropDims.length) {
    const names = dropDims.map(k => DIM_BY_KEY[k].label);
    html('div', 'chart-note', container).textContent =
      names.join(' and ') + (names.length === 1 ? ' is' : ' are')
      + ' not a grouping here — this measure already compares or averages across '
      + (names.length === 1 ? 'it' : 'them') + '.';
  }
  // The same courtesy for a pinned dimension: the chip stays where it was put,
  // so the chart says why it is doing nothing there.
  const pinNote = (spec.pins || []).filter(r => {
    const z = plot.zones;
    return r.over === MEASURE_DIM
      || AXIS_ZONE_KEYS.concat([OFF_ZONE]).some(k => (z[k] || []).indexOf(r.over) !== -1);
  });
  if (pinNote.length) {
    html('div', 'chart-note', container).textContent = pinNote.map(r =>
      DIM_BY_KEY[r.over].label + ' (X = ' + pinValues(r.x).map(v => dimValueLabel(r.over, v)).join(', ')
      + ', Y = ' + pinValues(r.y).map(v => dimValueLabel(r.over, v)).join(', ') + ')').join(' · ')
      + ' — the two axes differ in '
      + (pinNote.length === 1 ? 'this, so it tells' : 'these, so they tell')
      + ' no dot from another.';
  }
}

function renderFacetLevel(plot, remaining, fixed, container, axes) {
  if (remaining.length === 0) { renderLeaf(plot, fixed, axes, container); return; }
  const dimKey = remaining[0], rest = remaining.slice(1);
  const dim = DIM_BY_KEY[dimKey];
  const values = plot.included[dimKey];
  if (values.length === 0) {
    html('div', 'plot-empty', container).textContent = 'Nothing shown - ' + dim.label + ' has no included values.';
    return;
  }
  if (values.length === 1) {
    const nextFixed = Object.assign({}, fixed); nextFixed[dimKey] = values[0];
    renderFacetLevel(plot, rest, nextFixed, container, axes);
    return;
  }
  values.forEach(v => {
    const card = html('div', 'facet-card', container);
    const caption = dim.label + ': ' + dimValueLabel(dimKey, v);
    card.setAttribute('data-caption', caption);
    const headRow = html('h5', null, card);
    html('span', 'facet-name', headRow).textContent = caption;
    addTikzButton(headRow, () => card, 'TikZ', dim.label + ' ' + dimValueLabel(dimKey, v), 'btn small ghost');
    const nextFixed = Object.assign({}, fixed); nextFixed[dimKey] = v;
    renderFacetLevel(plot, rest, nextFixed, card, axes);
  });
}

function axesFromPlan(plan) {
  return {
    seriesDims: plan.seriesDims, xDims: plan.xDims, offDims: plan.offDims,
    metricPanels: plan.metricPanels, forcedPanels: plan.forcedPanels,
    dualAxis: plan.dualAxis,
  };
}

// The same plot showing a different set of measures. Everything else -- zones,
// included values, style, the drawn-series list the style panel reads -- is
// shared, so the two halves of a split plot stay one plot.
function metricSubset(plot, keys) {
  return Object.assign({}, plot, {
    included: Object.assign({}, plot.included, { metric: keys.slice() }),
  });
}

function renderPlotChart(plot, container) {
  return withPlotSchema(plot, () => drawPlotChart(plot, container));
}
function drawPlotChart(plot, container) {
  container.innerHTML = '';
  if (plot.included.metric.length === 0) {
    html('div', 'plot-empty', container).textContent = 'Nothing shown - Metric has no included values.';
    return;
  }
  const plan = computeAxisPlan(plot);
  // A facet dimension only SOME of the measures vary along cannot be dropped --
  // the others need it -- but the ones that are constant along it were being
  // drawn again, identically, inside every chart it produced.
  //
  // So the measures are grouped by WHICH facet dimensions they are flat along,
  // and each group is drawn as its own plot. Each group then has a uniform
  // answer, so the plan-level drop above removes those dimensions from it and
  // it is drawn once. Two groups was not enough: with Device and Application
  // both faceting, a comparison over Device is flat along one of them and not
  // the other, and "flat along all of them" put it back with the rest.
  //
  // Metric is excluded from the question. It is a facet like any other here,
  // but no measure is "constant along which measure is shown", and asking left
  // every group empty.
  const facetable = plan.facetDims.filter(k => k !== MEASURE_DIM);
  // With Metric pinned, the shown list is not what is drawn -- the pin names the
  // two measures -- so splitting the plot by which of them is flat where would
  // be splitting on something this chart does not read.
  if (facetable.length && plot.included[MEASURE_DIM].length > 1 && !metricPinnedIn(plot)) {
    const groups = [];
    const at = {};
    plot.included[MEASURE_DIM].forEach(mk => {
      const sig = facetable.filter(k => metricIgnoresDim(mk, k)).join(SIG_SEP);
      if (at[sig] === undefined) { at[sig] = groups.length; groups.push({ sig: sig, keys: [] }); }
      groups[at[sig]].keys.push(mk);
    });
    if (groups.length > 1) {
      groups.forEach(g => {
        const dropped = g.sig ? g.sig.split(SIG_SEP) : [];
        const part = html('div', 'plot-part', container);
        if (dropped.length) {
          html('div', 'chart-note', part).textContent =
            g.keys.map(mk => METRIC_BY_KEY[mk].label).join(', ')
            + (g.keys.length === 1 ? ' does' : ' do') + ' not vary by '
            + dropped.map(k => DIM_BY_KEY[k].label).join(' or ')
            + ', so ' + (g.keys.length === 1 ? 'it is' : 'they are')
            + ' drawn once rather than repeated in every chart of ' + (dropped.length === 1 ? 'it' : 'them') + '.';
        }
        // Each group has one answer for every facet dimension, so re-entering
        // finds a single group and cannot split again. Its own holder, because
        // renderPlotChart empties what it is handed -- including the note.
        renderPlotChart(metricSubset(plot, g.keys), html('div', 'plot-part-body', part));
      });
      return;
    }
  }
  // Said once, above everything, because the drop is a decision about the whole
  // plot: the chips are still where the user put them and the chart is quietly
  // not using them.
  if (plan.ignoredDims.length) {
    const names = plan.ignoredDims.map(k => DIM_BY_KEY[k].label);
    html('div', 'chart-note', container).textContent =
      names.join(' and ') + (names.length === 1 ? ' is' : ' are')
      + ' not a grouping here — this measure already compares or averages across '
      + (names.length === 1 ? 'it' : 'them')
      + ', so one chart per value would be the same chart over again.';
  }
  if (plan.offDims.length) {
    const names = plan.offDims.map(k => DIM_BY_KEY[k].label);
    const counts = plan.offDims.map(k => (plot.included[k] || []).length);
    const many = counts.some(n => n > 1);
    const none = counts.some(n => n === 0);
    html('div', 'chart-note', container).textContent =
      names.join(' and ') + (names.length === 1 ? ' is' : ' are') + ' not used here'
      + (none
        ? ' — and nothing is shown for '
          + (names.length === 1 ? 'it' : 'one of them')
          + ', so there is nothing left to average.'
        : many
          ? ' — every value below is an average across ' + (names.length === 1 ? 'it' : 'them') + '.'
          : ' — one value each, so nothing is averaged away.');
  }
  const fixed = {};
  if (!plan.metricActive) fixed.metric = plot.included.metric[0];
  // "Facets in a row": the top-level facet cards sit side by side, wrapping,
  // instead of one below the other -- a facet dimension with many values draws
  // a page taller than the screen. The notes stay above, in the plot render;
  // only the cards go into the grid.
  const facetHost = plot.facetsInRow
    ? html('div', 'facet-grid', container)
    : container;
  renderFacetLevel(plot, plan.facetDims, fixed, facetHost, axesFromPlan(plan));
}

// The x positions each line passes through, when the user has named the
// dimension the lines run along. One run per combination of the OTHER x
// dimensions, holding the indices of every position that varies only along the
// named one -- so a run need not be contiguous on the axis, which is the point:
// with Device outermost and Threads named, one line per Device crosses the
// whole chart instead of one line per Device × Threads block.
function lineRunsFor(xVals, xDims, alongKey) {
  if (xDims.indexOf(alongKey) === -1) return null;
  const others = xDims.filter(k => k !== alongKey);
  const byKey = {};
  const runs = [];
  xVals.forEach((xv, i) => {
    const k = others.map(d => String(xv.vals[d])).join(SIG_SEP);
    if (!Object.prototype.hasOwnProperty.call(byKey, k)) { byKey[k] = []; runs.push(byKey[k]); }
    byKey[k].push(i);
  });
  return runs;
}

// Consecutive runs of x entries sharing the same values for xDims[0..level] - these
// become the nested grouping bands drawn underneath the innermost tick labels.
function axisRuns(xVals, xDims, level) {
  const runs = [];
  for (let i = 0; i < xVals.length; i++) {
    const key = xDims.slice(0, level + 1).map(d => String(xVals[i].vals[d])).join('');
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.end = i;
    else runs.push({ key: key, start: i, end: i, label: xVals[i].labels[level] });
  }
  return runs;
}
