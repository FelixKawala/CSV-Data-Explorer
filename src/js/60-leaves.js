// bar / line / dual-axis / diverging / table / matrix renderers

// One bar, drawn the way the Style block says a bar is drawn. Every leaf that
// draws bars goes through here: the dual-axis and the diverging leaves each had
// a <rect> of their own and so ignored the corner, the texture and the value
// label entirely. The panel went on offering all three -- it is offered for
// whatever chart draws bars -- and nothing happened, which reads as the style
// options being broken rather than as this chart never having been wired to
// them.
//
// `thickness` is the bar's narrow side and `length` its long one, whichever way
// round the chart lays them out: the corner radius is a statement about the
// narrow side, and a horizontal bar has it in `height`.
function drawStyledBar(svg, plotG, box, opts) {
  const rx = barCornerRadius(opts.corner, opts.thickness, opts.length);
  const rect = el('rect', Object.assign(
    { class: 'bar', fill: opts.fill, rx: rx }, box, opts.attrs || {}), plotG);
  // texture as a second rect over the solid colour, so `fill` stays a plain
  // paint for anything that cannot resolve a url(#id)
  const tex = patternFill(svg, opts.pattern, 'var(--text-primary)');
  if (tex) {
    el('rect', Object.assign({}, box, {
      class: 'bar-texture', 'data-pattern': opts.pattern, rx: rx,
      fill: tex, opacity: 0.5, 'pointer-events': 'none',
    }), plotG);
  }
  // The number on the bar. When measures of different size share a frame the
  // small one is a sliver, and the label is the only way to read it at all.
  if (opts.label) {
    el('text', {
      class: 'bar-value', x: opts.label.x, y: opts.label.y,
      'text-anchor': opts.label.anchor || 'middle',
    }, plotG).textContent = opts.label.text;
  }
  return rect;
}

// ---- bar chart leaf ----
function renderBarLeaf(container, spec) {
  const sVals = spec.series, xVals = spec.x, xDims = spec.xDims;
  const getValue = spec.getValue, kind = spec.kind;
  const showX = spec.showXLabels !== false && xDims.length > 0;
  // one delta series has nothing to tell apart, so colour carries polarity instead
  const signColoured = isDiverging(kind) && sVals.length === 1;
  const style = spec.style || defaultPlotStyle();
  const slots = Math.max(spec.slots || sVals.length, sVals.length);
  const lay = xLayout(xVals, xDims, slots);
  const inset = (lay.groupW - (sVals.length * lay.unitW + (sVals.length - 1) * lay.gap)) / 2;
  const plotH = 170, marginL = 46, marginR = 8, marginT = 10;
  const marginB = xMarginB(xDims, showX);

  const all = [];
  xVals.forEach(xv => sVals.forEach(sv => all.push(getValue(sv, xv))));
  const sc = makeYScale(kind, all, plotH, spec.yAxis);
  const colourFor = metricColourFor(spec);

  const w = lay.plotW + marginL + marginR, h = plotH + marginT + marginB;
  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  drawYAxis(plotG, sc, lay.plotW);

  xVals.forEach((xv, gi) => {
    sVals.forEach((sv, vi) => {
      const val = getValue(sv, xv);
      if (val === null || val === undefined) return;
      const bx = lay.gxs[gi] + inset + vi * (lay.unitW + lay.gap);
      const barY = sc.clamp(sc.y(val));
      const barTop = Math.min(barY, sc.zeroY);
      const barH = Math.max(Math.abs(barY - sc.zeroY), 1);
      const fill = signColoured ? (val >= 0 ? 'var(--div-pos-2)' : 'var(--div-neg-2)')
        : (colourFor ? colourFor(sv, xv) : sv.color);
      const rect = drawStyledBar(svg, plotG,
        { x: bx, y: barTop, width: lay.unitW, height: barH },
        {
          fill: fill, corner: style.barCorner, thickness: lay.unitW, length: barH,
          // polarity is what the colour is saying here; a texture on top of it
          // would be a second distinction with nothing to distinguish
          pattern: signColoured ? null : sv.pattern,
          label: style.valueLabels
            ? { x: bx + lay.unitW / 2, y: Math.max(barTop - 3, 8), text: formatValue(kind, val) }
            : null,
        });
      rect.addEventListener('mousemove', e => showTip(e, [
        xv.label + (sVals.length > 1 ? ' — ' + sv.label : ''), formatValue(kind, val)
      ]));
      rect.addEventListener('mouseleave', hideTip);
    });
  });
  drawXAxis(plotG, xVals, xDims, lay, plotH, showX);

  scrollWrap(container, svg, w, h, spec);
  axisNotes(container, sc, all);
  if (spec.showLegend !== false) {
    if (signColoured) polarityLegend(container);
    else {
      seriesLegend(container, sVals, spec.seriesDims, spec.style, spec.chartType,
      { colourFor: legendColourFor(spec) });
      metricLegend(container, spec);
    }
  }
}

function polarityLegend(container) {
  const legend = html('div', 'legend', container);
  const pos = html('div', 'item', legend);
  html('span', 'swatch', pos).style.background = 'var(--div-pos-2)';
  html('span', null, pos).textContent = 'improved (+)';
  const neg = html('div', 'item', legend);
  html('span', 'swatch', neg).style.background = 'var(--div-neg-2)';
  html('span', null, neg).textContent = 'regressed (−)';
}

// ---- line chart leaf ----
// One polyline per series across the same nested categorical x-axis. Gaps in the
// data break the line rather than being bridged, so a missing configuration cannot
// masquerade as a trend.
function renderLineLeaf(container, spec) {
  const sVals = spec.series, xVals = spec.x, xDims = spec.xDims;
  const getValue = spec.getValue, kind = spec.kind;
  const showX = spec.showXLabels !== false && xDims.length > 0;
  const lay = xLayout(xVals, xDims, Math.max(spec.slots || 1, 1), { unitW: spec.slots ? 14 : 26, minUnit: 8 });
  const plotH = 170, marginL = 46, marginR = 10, marginT = 10;
  const marginB = xMarginB(xDims, showX);

  const all = [];
  xVals.forEach(xv => sVals.forEach(sv => all.push(getValue(sv, xv))));
  const sc = makeYScale(kind, all, plotH, spec.yAxis);

  const w = lay.plotW + marginL + marginR, h = plotH + marginT + marginB;
  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  drawYAxis(plotG, sc, lay.plotW);
  drawSeriesLines(plotG, sVals, xVals, lay, sc, getValue, kind, false, spec.lineBreaks, spec.style,
    { runs: spec.lineRuns, colourFor: metricColourFor(spec) });
  drawXAxis(plotG, xVals, xDims, lay, plotH, showX);

  scrollWrap(container, svg, w, h, spec);
  axisNotes(container, sc, all);
  if (spec.showLegend !== false) {
    seriesLegend(container, sVals, spec.seriesDims, spec.style, spec.chartType,
      { colourFor: legendColourFor(spec) });
    metricLegend(container, spec);
  }
}

// Colouring by metric only means anything where the metric varies inside the
// leaf. Where it does not -- a panel per measure, a single measure shown -- the
// series colours are still the ones doing work, so this returns null and
// nothing changes.
function metricColourFor(spec) {
  if (!spec || spec.colourBy !== 'metric' || !spec.metricKeyAt) return null;
  const palette = (spec.style && spec.style.palette) || 'default';
  return (sv, xv) => metricColorOf(palette, spec.metricKeyAt(sv, xv)) || sv.color;
}

// What the KEY should be painted, which is not always what the series entry
// carries. Where the metric is one of the series dimensions each series really
// does have one colour -- the metric's -- and the key must use it, or the key
// shows the series palette while the chart shows the metric palette. Where the
// metric varies inside a series there is no one colour, and null says so.
function legendColourFor(spec) {
  if (!spec || spec.colourBy !== 'metric') return null;
  const palette = (spec.style && spec.style.palette) || 'default';
  return sv => {
    const mk = sv.vals && sv.vals[MEASURE_DIM];
    return mk ? metricColorOf(palette, mk) : null;
  };
}

// The key for those colours. Only where the series legend is not already saying
// the same thing: with Metric as the series dimension the two agree, and two
// legends listing the same names would be one too many.
function metricLegend(container, spec) {
  if (!spec || spec.colourBy !== 'metric' || !spec.metricKeyAt) return;
  if ((spec.seriesDims || []).indexOf(MEASURE_DIM) !== -1) return;
  const keys = [];
  spec.series.forEach(sv => spec.x.forEach(xv => {
    const mk = spec.metricKeyAt(sv, xv);
    if (mk && keys.indexOf(mk) === -1) keys.push(mk);
  }));
  if (keys.length < 2) return;
  const palette = (spec.style && spec.style.palette) || 'default';
  const legend = html('div', 'legend metric-legend', container);
  keys.forEach(mk => {
    const item = html('div', 'item', legend);
    html('span', 'swatch', item).style.background = metricColorOf(palette, mk);
    html('span', 'legend-text', item).textContent = METRIC_BY_KEY[mk] ? METRIC_BY_KEY[mk].label : mk;
  });
}

// shared by the line chart and the secondary axis of a dual-axis chart
//
// `opts.runs` names the x positions each line passes through, one list per line.
// With it, a missing value is stepped over instead of ending the line -- which
// is the difference between "there is no measurement here" and "the series
// stops here", and only the caller knows which was meant.
function drawSeriesLines(plotG, sVals, xVals, lay, sc, getValue, kind, dashed, breaks, style, opts) {
  style = style || defaultPlotStyle();
  opts = opts || {};
  const cx = gi => lay.gxs[gi] + lay.groupW / 2;
  const colourAt = (sv, xv) => (opts.colourFor ? opts.colourFor(sv, xv) : sv.color);
  const runs = opts.runs || null;
  sVals.forEach(sv => {
    let pts = [];
    const flush = () => {
      if (pts.length > 1) {
        const attrs = {
          class: 'series-line', fill: 'none', stroke: sv.color,
          'stroke-width': style.lineWidth || 2,
          points: pts.map(p => p[0] + ',' + p[1]).join(' '),
        };
        if (dashed) attrs['stroke-dasharray'] = '5 3';
        el('polyline', attrs, plotG);
      }
      pts = [];
    };
    const point = (gi, bridging) => {
      const xv = xVals[gi];
      const val = getValue(sv, xv);
      if (val === null || val === undefined) {
        // bridging: the line is a claim about the named dimension, and a hole in
        // it is a configuration that was not measured, not a break in the claim
        if (!bridging) flush();
        return;
      }
      const px = cx(gi), py = sc.clamp(sc.y(val));
      pts.push([px, py]);
      if (style.markers === 'none') return;
      const dot = drawMark(plotG, sv.shape || 'circle', px, py, style.markerSize || 3.5,
        { fill: colourAt(sv, xv) });
      dot.addEventListener('mousemove', e => showTip(e, [
        xv.label + (sVals.length > 1 ? ' — ' + sv.label : ''), formatValue(kind, val)
      ]));
      dot.addEventListener('mouseleave', hideTip);
    };
    if (runs) {
      runs.forEach(run => { run.forEach(gi => point(gi, true)); flush(); });
      return;
    }
    xVals.forEach((xv, gi) => {
      if (breaks && gi > 0 && breaks[gi]) flush();
      point(gi, false);
    });
    flush();
  });
}

// ---- dual-axis leaf ----
// Opt-in only. Two y-scales in one frame means the point where two series cross
// carries no meaning, so this stays off by default in favour of stacked panels.
// The secondary series are drawn as dashed lines and the right axis is labelled
// with the metric it belongs to, so at least which scale is which is unambiguous.
function renderDualAxisLeaf(container, spec, asLines) {
  const sVals = spec.series, xVals = spec.x, xDims = spec.xDims, getValue = spec.getValue;
  const style = spec.style || defaultPlotStyle();
  const kindOf = sv => {
    const mk = sv.vals.metric;
    return (mk && METRIC_BY_KEY[mk]) ? METRIC_BY_KEY[mk].format : spec.kind;
  };
  // Which axis a series belongs on is a question about SCALE, not about which
  // format object it happens to hold. Splitting on object identity gave every
  // measure its own group, so two hit rates and a duration became "the first
  // measure" and "the second" -- and the third was drawn on neither axis and
  // silently vanished. Two measures share an axis exactly when sameAxis says so.
  const axisGroups = [];
  sVals.forEach(sv => {
    const f = kindOf(sv);
    let g = axisGroups.find(x => sameAxis(x.fmt, f));
    if (!g) { g = { fmt: f, list: [] }; axisGroups.push(g); }
    g.list.push(sv);
  });
  const primaryKind = axisGroups[0] ? axisGroups[0].fmt : spec.kind;
  const secondaryKind = axisGroups[1] ? axisGroups[1].fmt : null;
  const primary = axisGroups[0] ? axisGroups[0].list : [];
  const secondary = axisGroups[1] ? axisGroups[1].list : [];
  // A frame has two axes and no more. The plan only offers this chart for
  // exactly two scales, so this is a backstop -- but a silently undrawn series
  // is the failure this whole function just stopped having, and it is not
  // allowed back in through the side door.
  const unplaced = axisGroups.slice(2);

  const showX = spec.showXLabels !== false && xDims.length > 0;
  const lay = xLayout(xVals, xDims, asLines ? 1 : primary.length, asLines ? { unitW: 26, minUnit: 8 } : undefined);
  const plotH = 170, marginL = 46, marginR = 52, marginT = 10;
  const marginB = xMarginB(xDims, showX);

  const primVals = [], secVals = [];
  xVals.forEach(xv => {
    primary.forEach(sv => primVals.push(getValue(sv, xv)));
    secondary.forEach(sv => secVals.push(getValue(sv, xv)));
  });
  const scL = makeYScale(primaryKind, primVals, plotH, spec.yAxis);
  const scR = makeYScale(secondaryKind, secVals, plotH, spec.yAxisRight);

  const w = lay.plotW + marginL + marginR, h = plotH + marginT + marginB;
  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  drawYAxis(plotG, scL, lay.plotW);
  scR.ticks.forEach(t => {
    const ty = scR.y(t);
    el('text', { class: 'axis-label axis-right', x: lay.plotW + 6, y: ty + 3, 'text-anchor': 'start' }, plotG)
      .textContent = scR.tickLabel(t);
  });
  if (scR.hasNegative && Math.abs(scR.zeroY - scL.zeroY) > 0.5) {
    // the two scales disagree about where zero sits; mark the right one so a reader
    // cannot mistake the left zero line for the dashed series' baseline
    el('line', { class: 'zero-line-right', x1: 0, x2: lay.plotW, y1: scR.zeroY, y2: scR.zeroY }, plotG);
  }

  const colourFor = metricColourFor(spec);
  const lineOpts = { runs: spec.lineRuns, colourFor: colourFor };
  if (asLines) {
    drawSeriesLines(plotG, primary, xVals, lay, scL, getValue, primaryKind, false, spec.lineBreaks, spec.style, lineOpts);
  } else {
    xVals.forEach((xv, gi) => {
      primary.forEach((sv, vi) => {
        const val = getValue(sv, xv);
        if (val === null || val === undefined) return;
        const bx = lay.gxs[gi] + vi * (lay.unitW + lay.gap);
        const barY = scL.y(val);
        const barTop = Math.min(barY, scL.zeroY);
        const barH = Math.max(Math.abs(barY - scL.zeroY), 1);
        const rect = drawStyledBar(svg, plotG,
          { x: bx, y: barTop, width: lay.unitW, height: barH },
          {
            fill: colourFor ? colourFor(sv, xv) : sv.color,
            corner: style.barCorner, thickness: lay.unitW, length: barH,
            pattern: sv.pattern,
            label: style.valueLabels
              ? { x: bx + lay.unitW / 2, y: Math.max(barTop - 3, 8), text: formatValue(kindOf(sv), val) }
              : null,
          });
        rect.addEventListener('mousemove', e => showTip(e, [
          xv.label + ' — ' + sv.label, formatValue(kindOf(sv), val)
        ]));
        rect.addEventListener('mouseleave', hideTip);
      });
    });
  }
  drawSeriesLines(plotG, secondary, xVals, lay, scR, getValue, secondaryKind, true, spec.lineBreaks, spec.style, lineOpts);
  drawXAxis(plotG, xVals, xDims, lay, plotH, showX);

  // Which series belongs on which axis, recorded for the exports. Without it
  // pgfplots put every series on one `ybar` axis: the right-hand measure came
  // out as a bar on the left-hand scale, which for a count beside a percentage
  // is a flat line at zero -- so the series the second axis exists for was the
  // one missing from the figure.
  if (spec.dataTable) {
    spec.dataTable.dual = true;
    spec.dataTable.asLines = !!asLines;
    spec.dataTable.axisKinds = [primaryKind, secondaryKind];
    spec.dataTable.seriesAxis = sVals.map(sv => (secondary.indexOf(sv) !== -1 ? 1 : 0));
  }

  scrollWrap(container, svg, w, h, spec);
  if (unplaced.length) {
    html('div', 'chart-note', container).textContent =
      'A frame has two y-axes, and these measures need '
      + (axisGroups.length) + ': '
      + unplaced.map(g => axisLabelOf(g.fmt)).join(', ')
      + ' could not be drawn. Turn the second axis off to get a panel per scale instead.';
  }

  if (spec.showLegend !== false) {
    const legend = html('div', 'legend axis-legend', container);
    // Colouring by metric repaints every mark, here as anywhere else; a key
    // still showing the series palette would be a key to another chart.
    const paint = legendColourFor(spec);
    const cluster = (title, list, right) => {
      if (list.length === 0) return;
      const g = html('div', 'legend-group' + (right ? ' right' : ''), legend);
      html('span', 'legend-cap', g).textContent = title;
      // The right axis is always drawn as lines whatever the chart type, so its
      // key is a mark; the left one is a mark only on a line chart. Same builder
      // as the single-axis legend, so a texture set per series shows here too.
      const mode = legendMode(list, style, (right || asLines) ? 'lines' : spec.chartType);
      list.forEach(sv => {
        const item = html('div', 'item', g);
        const c = (paint ? paint(sv) : sv.color) || 'var(--text-muted)';
        if (mode === 'flat' && right) {
          html('span', 'swatch dashed', item).style.background = c;
        } else {
          legendGlyph(item, sv, mode, c);
        }
        html('span', null, item).textContent = sv.label;
      });
    };
    cluster('Left axis · ' + axisLabelOf(primaryKind), primary, false);
    cluster('Right axis · ' + axisLabelOf(secondaryKind) + ' (dashed)', secondary, true);
    html('div', 'legend-note', legend).textContent =
      'Two scales in one frame — heights are not comparable across axes, and where the series cross means nothing.';
    metricLegend(container, spec);
  }
}

function renderBarLeafDiverging(container, spec) {
  const sVals = spec.series, xVals = spec.x, getValue = spec.getValue;
  const xDims = spec.xDims || [];
  // A diverging chart's value axis runs across the page, so a second scale is a
  // second tick row rather than a second side. Same bargain as the vertical
  // one: compact, and lengths mean nothing across the two.
  const dual = !!spec.dualAxis;
  const style = spec.style || defaultPlotStyle();
  const kindOf = sv => {
    const mk = sv.vals && sv.vals[MEASURE_DIM];
    return (mk && METRIC_BY_KEY[mk]) ? METRIC_BY_KEY[mk].format : spec.kind;
  };
  const axisGroups = [];
  if (dual) {
    sVals.forEach(sv => {
      const f = kindOf(sv);
      let g = axisGroups.find(x => sameAxis(x.fmt, f));
      if (!g) { g = { fmt: f, list: [] }; axisGroups.push(g); }
      g.list.push(sv);
    });
  }
  const fmtA = (dual && axisGroups[0]) ? axisGroups[0].fmt : spec.kind;
  const fmtB = (dual && axisGroups[1]) ? axisGroups[1].fmt : null;
  const onB = sv => !!(fmtB && axisGroups[1].list.indexOf(sv) !== -1);
  const unplaced = dual ? axisGroups.slice(2) : [];

  const rowH = Math.max(22, sVals.length * 11 + 8);
  const plotW = 420;
  const marginL = 168, marginR = 54, marginT = fmtB ? 26 : 8, marginB = 22;
  const cx0 = plotW / 2;

  // Same nested grouping as the vertical charts, laid out down the page: every outer
  // x dimension gets an indented heading above its block of rows, and rows keep only
  // their innermost label instead of repeating the whole composite key.
  const outerLevels = Math.max(xDims.length - 1, 0);
  const runStarts = [];
  for (let lvl = 0; lvl < outerLevels; lvl++) {
    const map = {};
    axisRuns(xVals, xDims, lvl).forEach(r => { map[r.start] = r.label; });
    runStarts.push(map);
  }
  const HEADER_H = 17;
  const rowTop = [], headers = [];
  let cy = 0;
  for (let i = 0; i < xVals.length; i++) {
    for (let lvl = 0; lvl < outerLevels; lvl++) {
      if (runStarts[lvl][i] !== undefined) {
        if (i > 0) cy += (outerLevels - lvl) * 6;
        headers.push({ text: runStarts[lvl][i], y: cy + 12, indent: lvl * 13, lvl: lvl });
        cy += HEADER_H;
      }
    }
    rowTop.push(cy);
    cy += rowH;
  }
  const plotH = cy;
  const w = plotW + marginL + marginR, h = plotH + marginT + marginB;

  const maxAbs = [0, 0];
  xVals.forEach(xv => sVals.forEach(sv => {
    const val = getValue(sv, xv);
    if (val !== null && val !== undefined) {
      const s = onB(sv) ? 1 : 0;
      maxAbs[s] = Math.max(maxAbs[s], Math.abs(val));
    }
  }));
  const niceSteps = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 800, 1000];
  const niceMax = m => niceSteps.find(s => s >= m * 1.15) || Math.ceil((m * 1.15) / 100) * 100 || 10;
  const domainMax = [niceMax(maxAbs[0]), niceMax(maxAbs[1])];
  function xPosOn(delta, s) { return cx0 + (delta / domainMax[s]) * cx0; }
  function xPos(delta) { return xPosOn(delta, 0); }

  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  // Zero is the one place the two scales agree, so it is drawn once and both
  // sets of ticks hang off it.
  const divTick = (fmt, t) => (t > 0 ? '+' : '') + Math.round(t) + (fmt ? fmt.unit : '');
  const tickRow = (s, fmt, y, cls) => {
    [-domainMax[s], -domainMax[s] / 2, 0, domainMax[s] / 2, domainMax[s]].forEach(t => {
      const tx = xPosOn(t, s);
      if (s === 0) {
        el('line', { class: t === 0 ? 'baseline' : 'grid-line', x1: tx, x2: tx, y1: 0, y2: plotH }, plotG);
      }
      el('text', { class: cls, x: tx, y: y, 'text-anchor': 'middle' }, plotG)
        .textContent = divTick(fmt, t);
    });
  };
  tickRow(0, fmtA, plotH + 14, 'axis-label');
  if (fmtB) tickRow(1, fmtB, -10, 'axis-label axis-secondary');

  headers.forEach(hd => {
    el('text', {
      class: 'axis-band-label', x: -marginL + 4 + hd.indent, y: hd.y, 'text-anchor': 'start',
      'fill-opacity': hd.lvl === 0 ? 1 : 0.8,
    }, plotG).textContent = hd.text;
    el('line', { class: 'axis-band-line', x1: -marginL + 4 + hd.indent, x2: -6, y1: hd.y + 3, y2: hd.y + 3 }, plotG);
  });

  const multiSeries = sVals.length > 1;
  const colourFor = metricColourFor(spec);
  const barH = Math.max(1, Math.min(12, Math.floor((rowH - 6) / sVals.length)));
  xVals.forEach((xv, ri) => {
    const rowY0 = rowTop[ri];
    el('text', { class: 'row-label', x: -8, y: rowY0 + rowH / 2 + 4, 'text-anchor': 'end' }, plotG)
      .textContent = xDims.length > 0 ? xv.labels[xDims.length - 1] : xv.label;
    sVals.forEach((sv, si) => {
      const val = getValue(sv, xv);
      if (val === null || val === undefined) return;
      const s = onB(sv) ? 1 : 0;
      const barY = rowY0 + 3 + si * (barH + 2);
      const good = val >= 0;
      const bx = Math.min(xPosOn(0, s), xPosOn(val, s));
      const bw = Math.max(Math.abs(xPosOn(val, s) - xPosOn(0, s)), 1);
      // With several series the bars must be told apart by series (metric, Device, ...);
      // the sign is still unambiguous because the bar grows left or right of zero.
      // With a single series nothing needs distinguishing, so colour carries polarity.
      const signColoured = !multiSeries && !dual;
      const fill = signColoured ? (good ? 'var(--div-pos-2)' : 'var(--div-neg-2)')
        : (colourFor ? colourFor(sv, xv) : sv.color);
      const attrs = {};
      // The second scale's bars are outlined rather than solid, the way the
      // vertical dual axis dashes its lines: a reader must never compare a
      // length on one scale with a length on the other by eye.
      if (s === 1) {
        attrs.class = 'bar bar-secondary';
        attrs['fill-opacity'] = 0.45;
        attrs.stroke = fill;
        attrs['stroke-dasharray'] = '3 2';
      }
      const rect = drawStyledBar(svg, plotG,
        { x: bx, y: barY, width: bw, height: barH },
        {
          fill: fill, corner: style.barCorner, thickness: barH, length: bw,
          pattern: signColoured ? null : sv.pattern,
          // outside the end of the bar, on the side it grew towards, so a short
          // bar's number is not written over the bar next to it
          label: style.valueLabels ? {
            x: good ? bx + bw + 3 : bx - 3, y: barY + barH / 2 + 3,
            anchor: good ? 'start' : 'end',
            text: formatValue(dual ? kindOf(sv) : spec.kind, val),
          } : null,
          attrs: attrs,
        });
      rect.addEventListener('mousemove', e => showTip(e, [
        xv.label + (sVals.length > 1 ? ' — ' + sv.label : ''),
        formatValue(dual ? kindOf(sv) : spec.kind, val)
      ]));
      rect.addEventListener('mouseleave', hideTip);
    });
  });

  scrollWrap(container, svg, w, h, spec);
  if (unplaced.length) {
    html('div', 'chart-note', container).textContent =
      'A frame has two value axes, and these measures need ' + axisGroups.length + ': '
      + unplaced.map(g => axisLabelOf(g.fmt)).join(', ')
      + ' could not be drawn. Turn the second axis off to get a chart per scale instead.';
  }

  if (spec.showLegend === false) return;
  if (fmtB) {
    const legend = html('div', 'legend axis-legend', container);
    const paint = legendColourFor(spec);
    const cluster = (title, list, second) => {
      if (!list.length) return;
      const g = html('div', 'legend-group' + (second ? ' right' : ''), legend);
      html('span', 'legend-cap', g).textContent = title;
      // Same builder as everywhere else, so a texture set per series shows in
      // the key rather than the key claiming colour is the whole difference.
      const mode = legendMode(list, style, 'bars');
      list.forEach(sv => {
        const item = html('div', 'item', g);
        const c = paint ? paint(sv) : sv.color;
        if (mode === 'flat') {
          html('span', 'swatch' + (second ? ' dashed' : ''), item).style.background = c || 'var(--text-muted)';
        } else {
          legendGlyph(item, sv, mode, c || 'var(--text-muted)');
        }
        html('span', 'legend-text', item).textContent = sv.label;
      });
    };
    cluster('Lower axis · ' + axisLabelOf(fmtA), axisGroups[0].list, false);
    cluster('Upper axis · ' + axisLabelOf(fmtB) + ' (outlined)', axisGroups[1].list, true);
    html('div', 'legend-note', legend).textContent =
      'Two scales in one frame — bars right of zero improved, left regressed, but a '
      + 'length on one axis says nothing about a length on the other.';
    metricLegend(container, spec);
    return;
  }
  const legend = html('div', 'legend', container);
  if (multiSeries) {
    const paint = legendColourFor(spec);
    const mode = legendMode(sVals, style, 'bars');
    sVals.forEach(sv => {
      const item = html('div', 'item', legend);
      const c = paint ? paint(sv) : sv.color;
      legendGlyph(item, sv, mode, c || 'var(--text-muted)');
      html('span', 'legend-text', item).textContent = sv.label;
    });
    const note = html('div', 'item', legend);
    note.style.color = 'var(--text-muted)';
    note.textContent = 'bars right of zero improved, left regressed';
    metricLegend(container, spec);
  } else {
    const posItem = html('div', 'item', legend);
    html('span', 'swatch', posItem).style.background = 'var(--div-pos-2)';
    html('span', null, posItem).textContent = 'improved (+)';
    const negItem = html('div', 'item', legend);
    html('span', 'swatch', negItem).style.background = 'var(--div-neg-2)';
    html('span', null, negItem).textContent = 'regressed (−)';
  }
}

// ---- table leaf ----
// Rows come from the Rows zone (one leading descriptor column per dimension in it);
// value columns come from the Columns zone, whose dimensions nest into a multi-row
// header — so a heading can read Device / size / Application / Metric stacked up.
// Each cell formats itself from its own metric, which is why a table may mix a
// percentage and an access count where a chart cannot.
function renderTableLeaf(container, spec) {
  const rowEntries = spec.series, colEntries = spec.x;
  const rowDims = spec.seriesDims, colDims = spec.xDims;
  const headerLevels = Math.max(colDims.length, 1);

  const shell = html('div', 'leaf-shell', container);
  const wrap = html('div', 'plot-table-wrap', shell);
  const table = html('table', 'plot-table', wrap);
  const thead = html('thead', null, table);

  for (let lvl = 0; lvl < headerLevels; lvl++) {
    const tr = html('tr', null, thead);
    if (lvl === 0) {
      if (rowDims.length === 0) {
        const th = html('th', 'corner', tr);
        th.rowSpan = headerLevels;
        th.textContent = '';
      }
      rowDims.forEach(dk => {
        const th = html('th', 'corner', tr);
        th.rowSpan = headerLevels;
        th.textContent = DIM_BY_KEY[dk].label;
      });
    }
    if (colDims.length === 0) {
      const th = html('th', null, tr);
      th.textContent = 'Value';
      continue;
    }
    axisRuns(colEntries, colDims, lvl).forEach(run => {
      const th = html('th', null, tr);
      th.colSpan = run.end - run.start + 1;
      th.textContent = run.label;
      th.title = DIM_BY_KEY[colDims[lvl]].label + ': ' + run.label;
    });
  }

  // signature of a cell with the metric's irrelevant dimensions stripped out
  const seen = {};
  const allDims = rowDims.concat(colDims);
  function repeated(mk, r, c) {
    if (!spec.collapseRepeats || !mk) return false;
    const ctx = Object.assign({}, spec.fixedCtx || {}, r.vals, c.vals);
    let ignoresAny = false;
    const parts = [mk];
    for (let i = 0; i < allDims.length; i++) {
      const dk = allDims[i];
      if (metricIgnoresDim(mk, dk)) { ignoresAny = true; continue; }
      parts.push(dk + '=' + ctx[dk]);
    }
    if (!ignoresAny) return false;
    const key = parts.join('|');
    if (seen[key]) return true;
    seen[key] = true;
    return false;
  }

  const tbody = html('tbody', null, table);
  rowEntries.forEach(r => {
    const tr = html('tr', null, tbody);
    if (rowDims.length === 0) {
      html('td', 'rowhead', tr).textContent = 'All';
    }
    rowDims.forEach((dk, i) => {
      html('td', 'rowhead', tr).textContent = r.labels[i];
    });
    colEntries.forEach(c => {
      const td = html('td', 'num', tr);
      const val = spec.getValue(r, c);
      const mk = spec.metricKeyAt ? spec.metricKeyAt(r, c) : null;
      const kind = (mk && METRIC_BY_KEY[mk]) ? METRIC_BY_KEY[mk].format : spec.kind;
      if (val === null || val === undefined) {
        td.textContent = '—';
        td.classList.add('empty');
        return;
      }
      // if this cell differs from an earlier one only along a dimension the metric
      // does not vary over, it is the same number again, not a new measurement
      if (repeated(mk, r, c)) {
        td.textContent = '″';
        td.classList.add('repeat');
        td.title = formatValue(kind, val) + ' — same as the first column of this group; '
          + METRIC_BY_KEY[mk].label + ' does not vary by '
          + DIM_BY_KEY[METRIC_BY_KEY[mk].derived.over].label + '.';
        return;
      }
      td.textContent = formatValue(kind, val);
      if (isDiverging(kind)) td.classList.add(val >= 0 ? 'pos' : 'neg');
    });
  });

  // a pivot table is exactly the case where a .csv is most useful
  shell.__vizData = {
    isTable: true,
    rowDims: rowDims, colDims: colDims, kind: spec.kind,
    colLabels: colEntries.map(c => c.label),
    rows: rowEntries.map(r => ({
      parts: rowDims.length ? r.labels.slice() : ['All'],
      values: colEntries.map(c => spec.getValue(r, c)),
    })),
  };
  const tools = html('div', 'leaf-tools', shell);
  addTikzButton(tools, () => shell, 'TikZ + CSV', 'table', 'btn small ghost');

  if (spec.collapseRepeats && table.querySelector('td.repeat')) {
    html('div', 'chart-note', container).textContent =
      '″ marks a value that repeats because the measure does not vary along that dimension '
      + '(it already compares across it). Hover to see the number, or switch the collapse off in the plot header.';
  }

  const note = html('div', 'chart-note', container);
  note.textContent = rowEntries.length + ' row' + (rowEntries.length === 1 ? '' : 's')
    + ' × ' + colEntries.length + ' value column' + (colEntries.length === 1 ? '' : 's')
    + (colDims.length ? ' (' + colDims.map(d => DIM_BY_KEY[d].label).join(' × ') + ')' : '');
}

// ---- matrix leaf ----
function seqColorGeneric(t) {
  const steps = ['--seq-100', '--seq-150', '--seq-200', '--seq-250', '--seq-300', '--seq-350', '--seq-400', '--seq-450', '--seq-500', '--seq-550', '--seq-600', '--seq-650', '--seq-700'];
  const i = Math.max(0, Math.min(steps.length - 1, Math.round(t * (steps.length - 1))));
  return 'var(' + steps[i] + ')';
}
function divColorGeneric(t) {
  if (Math.abs(t) < 0.03) return 'var(--div-mid)';
  if (t > 0) { const steps = ['--div-pos-1', '--div-pos-2', '--div-pos-3']; return 'var(' + steps[t > 0.6 ? 2 : (t > 0.25 ? 1 : 0)] + ')'; }
  const steps = ['--div-neg-1', '--div-neg-2', '--div-neg-3']; return 'var(' + steps[t < -0.6 ? 2 : (t < -0.25 ? 1 : 0)] + ')';
}

function renderMatrixLeaf(container, spec) {
  const rowVals = spec.series, colVals = spec.x, getValue = spec.getValue, kind = spec.kind;
  const cellW = 58, cellH = 26, gap = 2;
  const marginL = 150, marginT = 44, marginR = 4, marginB = 4;
  const plotW = colVals.length * (cellW + gap) - gap, plotH = rowVals.length * (cellH + gap) - gap;
  const w = plotW + marginL + marginR, h = plotH + marginT + marginB;

  let maxAbs = 0, maxVal = 0;
  rowVals.forEach(rv => colVals.forEach(cv => {
    const val = getValue(rv, cv);
    if (val !== null && val !== undefined) { maxAbs = Math.max(maxAbs, Math.abs(val)); maxVal = Math.max(maxVal, val); }
  }));
  if (maxVal <= 0) maxVal = 1;
  if (maxAbs <= 0) maxAbs = 1;

  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  colVals.forEach((cv, ci) => {
    const cx = ci * (cellW + gap);
    el('text', {
      class: 'axis-label', x: cx + cellW / 2, y: -8, 'text-anchor': 'start',
      transform: 'rotate(-40 ' + (cx + cellW / 2) + ' -8)'
    }, plotG).textContent = cv.label;
  });

  rowVals.forEach((rv, ri) => {
    const ry = ri * (cellH + gap);
    el('text', { class: 'row-app-label', x: -8, y: ry + cellH / 2 + 4, 'text-anchor': 'end' }, plotG).textContent = rv.label;
    colVals.forEach((cv, ci) => {
      const cx = ci * (cellW + gap);
      const val = getValue(rv, cv);
      let fill, text, dark;
      if (val === null || val === undefined) { fill = 'var(--grid)'; text = '—'; dark = false; }
      else if (isDiverging(kind)) {
        fill = divColorGeneric(val / maxAbs); text = (val >= 0 ? '+' : '') + val.toFixed(kind && kind.key === 'reldelta' ? 0 : 1); dark = Math.abs(val) / maxAbs > 0.5;
      } else if (useLog(kind)) {
        const t = Math.log10(val + 1) / Math.log10(maxVal + 1);
        fill = seqColorGeneric(t); text = fmtAccess(val); dark = t > 0.55;
      } else {
        fill = seqColorGeneric(val / seqDomain(kind, maxVal)); text = val.toFixed(0) + '%'; dark = val / seqDomain(kind, maxVal) > 0.45;
      }
      const rect = el('rect', { class: 'cell', x: cx, y: ry, width: cellW, height: cellH, fill: fill, rx: 3 }, plotG);
      const label = el('text', {
        class: 'cell-label ' + (dark ? 'on-dark' : 'on-light'), x: cx + cellW / 2, y: ry + cellH / 2 + 3.5, 'text-anchor': 'middle'
      }, plotG);
      label.textContent = text;
      rect.addEventListener('mousemove', e => showTip(e, [
        cv.label + ' — ' + rv.label,
        formatValue(kind, val)
      ]));
      rect.addEventListener('mouseleave', hideTip);
    });
  });

  scrollWrap(container, svg, w, h, spec);
  if (spec.showLegend !== false) matrixScaleLegend(container, kind, maxVal, maxAbs);
}

// A matrix encodes its value in the cell colour, so it needs a key for that scale
// just as a bar chart needs one for its series colours.
function matrixScaleLegend(container, kind, maxVal, maxAbs) {
  const legend = html('div', 'legend scale-legend', container);
  const item = html('div', 'item', legend);
  const diverging = isDiverging(kind);
  const label = t => { const e = html('span', 'scale-end', item); e.textContent = t; };

  if (diverging) {
    label(formatValue(kind, -maxAbs));
    ['--div-neg-3', '--div-neg-2', '--div-neg-1', '--div-mid', '--div-pos-1', '--div-pos-2', '--div-pos-3']
      .forEach(v => { html('span', 'scale-step', item).style.background = 'var(' + v + ')'; });
    label(formatValue(kind, maxAbs));
    const mid = html('span', 'scale-note', item);
    mid.textContent = 'grey = no change';
  } else {
    const lo = 0;
    const hi = seqDomain(kind, maxVal);
    label(formatValue(kind, lo));
    for (let i = 0; i <= 6; i++) {
      html('span', 'scale-step', item).style.background = seqColorGeneric(i / 6);
    }
    label(formatValue(kind, hi));
    if (useLog(kind)) {
      const note = html('span', 'scale-note', item);
      note.textContent = 'log scale';
    }
  }
}
