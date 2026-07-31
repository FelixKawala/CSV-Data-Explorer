// bar / line / dual-axis / diverging / table / matrix renderers
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
      const fill = signColoured ? (val >= 0 ? 'var(--div-pos-2)' : 'var(--div-neg-2)') : sv.color;
      const rx = barCornerRadius(style.barCorner, lay.unitW, barH);
      const rect = el('rect', {
        class: 'bar', fill: fill,
        x: bx, y: barTop,
        width: lay.unitW, height: barH, rx: rx
      }, plotG);
      // texture as a second rect over the solid colour, so `fill` stays a plain
      // paint for anything that cannot resolve a url(#id)
      const tex = signColoured ? null : patternFill(svg, sv.pattern, 'var(--text-primary)');
      if (tex) {
        el('rect', {
          class: 'bar-texture', 'data-pattern': sv.pattern,
          x: bx, y: barTop, width: lay.unitW, height: barH, rx: rx,
          fill: tex, opacity: 0.5, 'pointer-events': 'none',
        }, plotG);
      }
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
    else seriesLegend(container, sVals, spec.seriesDims, spec.style, spec.chartType);
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
  drawSeriesLines(plotG, sVals, xVals, lay, sc, getValue, kind, false, spec.lineBreaks, spec.style);
  drawXAxis(plotG, xVals, xDims, lay, plotH, showX);

  scrollWrap(container, svg, w, h, spec);
  axisNotes(container, sc, all);
  if (spec.showLegend !== false) seriesLegend(container, sVals, spec.seriesDims, spec.style, spec.chartType);
}

// shared by the line chart and the secondary axis of a dual-axis chart
function drawSeriesLines(plotG, sVals, xVals, lay, sc, getValue, kind, dashed, breaks, style) {
  style = style || defaultPlotStyle();
  const cx = gi => lay.gxs[gi] + lay.groupW / 2;
  sVals.forEach(sv => {
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const attrs = {
          class: 'series-line', fill: 'none', stroke: sv.color,
          'stroke-width': style.lineWidth || 2,
          points: run.map(p => p[0] + ',' + p[1]).join(' '),
        };
        if (dashed) attrs['stroke-dasharray'] = '5 3';
        el('polyline', attrs, plotG);
      }
      run = [];
    };
    xVals.forEach((xv, gi) => {
      if (breaks && gi > 0 && breaks[gi]) flush();
      const val = getValue(sv, xv);
      if (val === null || val === undefined) { flush(); return; }
      const px = cx(gi), py = sc.clamp(sc.y(val));
      run.push([px, py]);
      if (style.markers === 'none') return;
      const dot = drawMark(plotG, sv.shape || 'circle', px, py, style.markerSize || 3.5,
        { fill: sv.color });
      dot.addEventListener('mousemove', e => showTip(e, [
        xv.label + (sVals.length > 1 ? ' — ' + sv.label : ''), formatValue(kind, val)
      ]));
      dot.addEventListener('mouseleave', hideTip);
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
  const kindOf = sv => {
    const mk = sv.vals.metric;
    return (mk && METRIC_BY_KEY[mk]) ? METRIC_BY_KEY[mk].format : spec.kind;
  };
  const kinds = [];
  sVals.forEach(sv => { const k = kindOf(sv); if (kinds.indexOf(k) === -1) kinds.push(k); });
  const primaryKind = kinds[0], secondaryKind = kinds[1];
  const primary = sVals.filter(sv => kindOf(sv) === primaryKind);
  const secondary = sVals.filter(sv => kindOf(sv) === secondaryKind);

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
  const scR = makeYScale(secondaryKind, secVals, plotH);

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

  if (asLines) {
    drawSeriesLines(plotG, primary, xVals, lay, scL, getValue, primaryKind, false, spec.lineBreaks, spec.style);
  } else {
    xVals.forEach((xv, gi) => {
      primary.forEach((sv, vi) => {
        const val = getValue(sv, xv);
        if (val === null || val === undefined) return;
        const bx = lay.gxs[gi] + vi * (lay.unitW + lay.gap);
        const barY = scL.y(val);
        const barTop = Math.min(barY, scL.zeroY);
        const rect = el('rect', {
          class: 'bar', fill: sv.color, x: bx, y: barTop,
          width: lay.unitW, height: Math.max(Math.abs(barY - scL.zeroY), 1), rx: Math.min(3, lay.unitW / 2)
        }, plotG);
        rect.addEventListener('mousemove', e => showTip(e, [
          xv.label + ' — ' + sv.label, formatValue(primaryKind, val)
        ]));
        rect.addEventListener('mouseleave', hideTip);
      });
    });
  }
  drawSeriesLines(plotG, secondary, xVals, lay, scR, getValue, secondaryKind, true, spec.lineBreaks, spec.style);
  drawXAxis(plotG, xVals, xDims, lay, plotH, showX);

  scrollWrap(container, svg, w, h, spec);

  if (spec.showLegend !== false) {
    const legend = html('div', 'legend axis-legend', container);
    const cluster = (title, list, right) => {
      if (list.length === 0) return;
      const g = html('div', 'legend-group' + (right ? ' right' : ''), legend);
      html('span', 'legend-cap', g).textContent = title;
      list.forEach(sv => {
        const item = html('div', 'item', g);
        html('span', 'swatch' + (right ? ' dashed' : ''), item).style.background = sv.color;
        html('span', null, item).textContent = sv.label;
      });
    };
    cluster('Left axis · ' + axisLabelOf(primaryKind), primary, false);
    cluster('Right axis · ' + axisLabelOf(secondaryKind) + ' (dashed)', secondary, true);
    html('div', 'legend-note', legend).textContent =
      'Two scales in one frame — heights are not comparable across axes, and where the series cross means nothing.';
  }
}

function renderBarLeafDiverging(container, spec) {
  const sVals = spec.series, xVals = spec.x, getValue = spec.getValue;
  const unit = spec.kind ? spec.kind.unit : '';
  const xDims = spec.xDims || [];
  const rowH = Math.max(22, sVals.length * 11 + 8);
  const plotW = 420;
  const marginL = 168, marginR = 54, marginT = 8, marginB = 22;
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

  let maxAbs = 0;
  xVals.forEach(xv => sVals.forEach(sv => {
    const val = getValue(sv, xv);
    if (val !== null && val !== undefined) maxAbs = Math.max(maxAbs, Math.abs(val));
  }));
  const niceSteps = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 800, 1000];
  const domainMax = niceSteps.find(s => s >= maxAbs * 1.15) || Math.ceil((maxAbs * 1.15) / 100) * 100 || 10;
  function xPos(delta) { return cx0 + (delta / domainMax) * cx0; }

  const svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h });
  const plotG = el('g', { transform: 'translate(' + marginL + ',' + marginT + ')' }, svg);

  [-domainMax, -domainMax / 2, 0, domainMax / 2, domainMax].forEach(t => {
    const tx = xPos(t);
    el('line', { class: t === 0 ? 'baseline' : 'grid-line', x1: tx, x2: tx, y1: 0, y2: plotH }, plotG);
    el('text', { class: 'axis-label', x: tx, y: plotH + 14, 'text-anchor': 'middle' }, plotG)
      .textContent = (t > 0 ? '+' : '') + Math.round(t) + unit;
  });

  headers.forEach(hd => {
    el('text', {
      class: 'axis-band-label', x: -marginL + 4 + hd.indent, y: hd.y, 'text-anchor': 'start',
      'fill-opacity': hd.lvl === 0 ? 1 : 0.8,
    }, plotG).textContent = hd.text;
    el('line', { class: 'axis-band-line', x1: -marginL + 4 + hd.indent, x2: -6, y1: hd.y + 3, y2: hd.y + 3 }, plotG);
  });

  const multiSeries = sVals.length > 1;
  const barH = Math.max(1, Math.min(12, Math.floor((rowH - 6) / sVals.length)));
  xVals.forEach((xv, ri) => {
    const rowY0 = rowTop[ri];
    el('text', { class: 'row-label', x: -8, y: rowY0 + rowH / 2 + 4, 'text-anchor': 'end' }, plotG)
      .textContent = xDims.length > 0 ? xv.labels[xDims.length - 1] : xv.label;
    sVals.forEach((sv, si) => {
      const val = getValue(sv, xv);
      if (val === null || val === undefined) return;
      const barY = rowY0 + 3 + si * (barH + 2);
      const good = val >= 0;
      const bx = Math.min(xPos(0), xPos(val)), bw = Math.max(Math.abs(xPos(val) - xPos(0)), 1);
      // With several series the bars must be told apart by series (metric, Device, ...);
      // the sign is still unambiguous because the bar grows left or right of zero.
      // With a single series nothing needs distinguishing, so colour carries polarity.
      const fill = multiSeries ? sv.color : (good ? 'var(--div-pos-2)' : 'var(--div-neg-2)');
      const rect = el('rect', {
        class: 'bar', x: bx, y: barY, width: bw, height: barH, rx: 2,
        fill: fill
      }, plotG);
      rect.addEventListener('mousemove', e => showTip(e, [
        xv.label + (sVals.length > 1 ? ' — ' + sv.label : ''),
        formatValue(spec.kind, val)
      ]));
      rect.addEventListener('mouseleave', hideTip);
    });
  });

  scrollWrap(container, svg, w, h, spec);

  if (spec.showLegend === false) return;
  const legend = html('div', 'legend', container);
  if (multiSeries) {
    sVals.forEach(sv => {
      const item = html('div', 'item', legend);
      html('span', 'swatch', item).style.background = sv.color;
      html('span', null, item).textContent = sv.label;
    });
    const note = html('div', 'item', legend);
    note.style.color = 'var(--text-muted)';
    note.textContent = 'bars right of zero improved, left regressed';
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
