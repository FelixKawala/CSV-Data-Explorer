// axis planning, cartesian product, facet recursion, leaves
// ---- recursive facet + leaf chart rendering ----
// Metric is a dedicated "data shown" selector. With exactly 1 metric included it is
// a pure filter; with 2+ it joins the grouping as a chip in plot.metricZone.
function computeAxisPlan(plot) {
  const metricActive = plot.included.metric.length > 1;
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
  ZONE_KEYS.forEach(k => { zoneDims[k] = plot.zones[k].slice(); axisDims[k] = plot.zones[k].slice(); });
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
      && mz === 'series' && isCartesian(plot.chartType);
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
  let seriesCount = 1;
  axisDims.series.forEach(k => { seriesCount *= Math.max(plot.included[k].length, 0); });
  return {
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
    dualEligible: mixedKinds && groups.length === 2 && isCartesian(plot.chartType),
    metricKinds: kindNames,
    // whether an override is on offer, and whether it is doing anything
    oneAxisEligible: groups.length > 1 && !isGridType(plot.chartType),
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

// Yields the format the leaf should draw with, plus the dimension (if any) the
// measures in play do not vary along, so a comparison is not repeated once per
// value of the thing it already compares.
function effectiveKind(plot, fixed) {
  const inPlay = (fixed[MEASURE_DIM] !== undefined) ? [fixed[MEASURE_DIM]] : plot.included[MEASURE_DIM];
  const formats = [];
  const groups = [];
  const ignored = [];
  inPlay.forEach(mk => {
    const m = METRIC_BY_KEY[mk];
    if (!m) return;
    if (groups.indexOf(m.format.axisGroup) === -1) { groups.push(m.format.axisGroup); formats.push(m.format); }
    // the compared dimension AND any the comparison averages over: the measure
    // is one number for all of them, so grouping by either repeats it
    const eaten = m.derived ? [m.derived.over].concat(m.derived.hold || []) : [];
    eaten.forEach(k => { if (k && ignored.indexOf(k) === -1) ignored.push(k); });
  });
  // only where EVERY measure on the chart ignores it; otherwise it is still a
  // grouping for the ones that do vary along it
  const ignoredDims = ignored.filter(
    k => inPlay.every(mk => measureIgnoresDim(METRIC_BY_KEY[mk], k)));
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
  opts = opts || {};
  const seriesDims = axes.seriesDims, xDims = axes.xDims;
  const emptyDim = seriesDims.concat(xDims).find(k => plot.included[k].length === 0);
  if (emptyDim) {
    html('div', 'plot-empty', container).textContent = 'Nothing to show - enable at least one value for ' + DIM_BY_KEY[emptyDim].label + '.';
    return;
  }
  const isTable = plot.chartType === 'table';
  const dual = !!axes.dualAxis;
  const kindInfo = effectiveKind(plot, fixed);
  if (kindInfo.mixed && !isTable && !dual) {
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
  seriesAll.forEach((e, i) => {
    const slot = (sDims.length === 1 && DIM_BY_KEY[sDims[0]])
      ? Math.max(DIM_BY_KEY[sDims[0]].values.indexOf(e.vals[sDims[0]]), 0) : i;
    const ov = style.series[seriesSignature(e)] || {};
    e.sig = seriesSignature(e);
    e.color = ov.color || ((sDims.length === 1)
      ? paletteDimValueColor(style.palette, sDims[0], e.vals[sDims[0]])
      : paletteColorAt(style.palette, i));
    e.shape = ov.shape
      || (style.markers === 'auto' ? markShapeAt(slot) : style.markers);
    e.pattern = ov.pattern
      || (style.barPattern === 'auto' ? barPatternAt(slot) : style.barPattern);
  });

  function getValue(sEntry, xEntry) {
    const ctx = Object.assign({}, fixed, sEntry.vals, xEntry.vals);
    return metricValueAt(ctx);
  }
  // drop combinations that have no data at all (e.g. 1024-line configs on the dev1,
  // or Tuned-altnterleaved on apps that don't have it) so the axis has no dead slots
  const xVals = xAll.filter(x => seriesAll.some(s => getValue(s, x) !== null));
  const sVals = seriesAll.filter(s => xVals.some(x => getValue(s, x) !== null));
  if (xVals.length === 0 || sVals.length === 0) {
    html('div', 'plot-empty', container).textContent = 'No data for this combination.';
    return;
  }

  // What the style panel offers overrides for: the series this chart really has,
  // after pruning, deduplicated across facets.
  if (!plot.__drawnSeries) plot.__drawnSeries = [];
  sVals.forEach(sv => {
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

  const spec = {
    series: sVals, x: xVals, xDims: xDimsOut, seriesDims: sDims,
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
      seriesLabels: sVals.map(sv => sv.label),
      // so a pgfplots figure carries the same appearance as the chart on screen
      seriesStyles: sVals.map(sv => ({ color: sv.color, shape: sv.shape, pattern: sv.pattern })),
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
      const ctx = Object.assign({}, fixed, sEntry.vals, xEntry.vals);
      return ctx.metric;
    },
    showXLabels: opts.showXLabels !== false,
    showLegend: opts.showLegend !== false,
  };
  if (isTable) renderTableLeaf(container, spec);
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
    seriesDims: plan.seriesDims, xDims: plan.xDims,
    metricPanels: plan.metricPanels, forcedPanels: plan.forcedPanels,
    dualAxis: plan.dualAxis,
  };
}

function renderPlotChart(plot, container) {
  container.innerHTML = '';
  if (plot.included.metric.length === 0) {
    html('div', 'plot-empty', container).textContent = 'Nothing shown - Metric has no included values.';
    return;
  }
  const plan = computeAxisPlan(plot);
  const fixed = {};
  if (!plan.metricActive) fixed.metric = plot.included.metric[0];
  renderFacetLevel(plot, plan.facetDims, fixed, container, axesFromPlan(plan));
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
