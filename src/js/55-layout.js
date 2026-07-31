// shared cartesian layout, axes, scales
function scrollWrap(container, svg, w, h, spec) {
  const shell = html('div', 'leaf-shell', container);
  if (spec && spec.dataTable) shell.__vizData = spec.dataTable;
  const box = html('div', 'svg-scroll', shell);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  box.appendChild(svg);
  const bar = html('div', 'leaf-tools', shell);
  addTikzButton(bar, () => shell, 'TikZ', 'chart', 'btn small ghost');
  return box;
}

function seriesLegend(container, sVals, seriesDims) {
  if (sVals.length <= 1) return;
  const legend = html('div', 'legend', container);
  sVals.forEach(s => {
    const item = html('div', 'item', legend);
    html('span', 'swatch', item).style.background = s.color;
    html('span', null, item).textContent = s.label;
  });
}

// ---- shared cartesian layout (bars, lines, dual-axis all use these) ----

// Horizontal placement of the grouped categories, including the hierarchical extra
// gap wherever an outer grouping band changes.
function xLayout(xVals, xDims, nSeries, opts) {
  opts = opts || {};
  const gap = 2;
  const WIDTH_BUDGET = 1400;
  const maxUnit = opts.unitW || 14;
  const minUnit = opts.minUnit || 5;
  let unitW = maxUnit, groupGap = 14;
  const natural = xVals.length * (nSeries * unitW + (nSeries - 1) * gap) + (xVals.length - 1) * groupGap;
  if (natural > WIDTH_BUDGET) {
    const per = WIDTH_BUDGET / xVals.length - groupGap;
    unitW = Math.max(minUnit, Math.floor((per - (nSeries - 1) * gap) / nSeries));
    if (unitW < 10) groupGap = 8;
  }
  const groupW = nSeries * unitW + (nSeries - 1) * gap;
  const levelKeys = [];
  for (let lvl = 0; lvl < xDims.length - 1; lvl++) {
    levelKeys.push(xVals.map(xv => xDims.slice(0, lvl + 1).map(d => String(xv.vals[d])).join(SIG_SEP)));
  }
  const gxs = [];
  let cursor = 0;
  for (let gi = 0; gi < xVals.length; gi++) {
    if (gi > 0) {
      let extra = 0;
      for (let lvl = 0; lvl < levelKeys.length; lvl++) {
        if (levelKeys[lvl][gi] !== levelKeys[lvl][gi - 1]) { extra = (levelKeys.length - lvl) * 16; break; }
      }
      cursor += groupGap + extra;
    }
    gxs.push(cursor);
    cursor += groupW;
  }
  return { gxs: gxs, groupW: groupW, plotW: cursor, unitW: unitW, gap: gap, groupGap: groupGap };
}

// Grid, tick labels and the emphasised zero line (which is only at the bottom of the
// frame when the data never goes negative).
function drawYAxis(plotG, sc, plotW) {
  sc.ticks.forEach(t => {
    const ty = sc.y(t);
    if (Math.abs(t) > 1e-9 || !sc.hasNegative) {
      el('line', { class: 'grid-line', x1: 0, x2: plotW, y1: ty, y2: ty }, plotG);
    }
    el('text', { class: 'axis-label', x: -6, y: ty + 3, 'text-anchor': 'end' }, plotG).textContent = sc.tickLabel(t);
  });
  el('line', { class: 'baseline', x1: 0, x2: plotW, y1: sc.zeroY, y2: sc.zeroY }, plotG);
}

function xMarginB(xDims, showX) {
  return (showX && xDims.length > 0) ? 48 + Math.max(xDims.length - 1, 0) * 20 : 12;
}

function drawXAxis(plotG, xVals, xDims, lay, plotH, showX) {
  if (!showX || xDims.length === 0) return;
  xVals.forEach((xv, gi) => {
    const cx = lay.gxs[gi] + lay.groupW / 2;
    el('text', {
      class: 'group-label', x: cx, y: plotH + 14, 'text-anchor': 'end',
      transform: 'rotate(-40 ' + cx + ' ' + (plotH + 14) + ')'
    }, plotG).textContent = xv.labels[xDims.length - 1];
  });
  const bandLevels = Math.max(xDims.length - 1, 0);
  for (let lvl = 0; lvl < bandLevels; lvl++) {
    const by = plotH + 44 + (bandLevels - 1 - lvl) * 20;
    axisRuns(xVals, xDims, lvl).forEach(run => {
      const x0 = lay.gxs[run.start], x1 = lay.gxs[run.end] + lay.groupW;
      el('line', { class: 'axis-band-line', x1: x0 + 1, x2: x1 - 1, y1: by, y2: by }, plotG);
      el('text', { class: 'axis-band-label', x: (x0 + x1) / 2, y: by + 12, 'text-anchor': 'middle' }, plotG)
        .textContent = run.label;
    });
  }
}

// Anything the scale had to compromise on, said on the chart rather than
// silently absorbed: a log axis that could not start where it was told, values
// that fall outside a hand-set range.
function axisNotes(container, sc, values) {
  const msgs = (sc.notes || []).slice();
  let off = 0;
  if (sc.outside) values.forEach(v => { if (sc.outside(v)) off++; });
  if (off) {
    msgs.push(off + ' value' + (off === 1 ? '' : 's') + ' outside the axis range, drawn clipped');
  }
  if (msgs.length) html('div', 'chart-note', container).textContent = msgs.join(' · ');
}

// Linear for percentages and changes, logarithmic for access counts. The linear
// domain always contains zero and expands downwards when the data goes negative,
// so a delta series is drawn against a real zero line instead of falling off the
// bottom of the frame.
//
// `axis` overrides that: { min, max, scale } where null and 'auto' mean "as
// derived above". An explicit bound is used exactly as given -- padding a number
// the user typed would defeat the point of typing it.
function makeYScale(kind, values, plotH, axis) {
  const ax = axis || {};
  const isLog = ax.scale === 'log' ? true : ax.scale === 'linear' ? false : useLog(kind);
  const notes = [];
  let maxVal = -Infinity, minVal = Infinity, minPos = Infinity;
  values.forEach(v => {
    if (v === null || v === undefined) return;
    if (v > maxVal) maxVal = v;
    if (v < minVal) minVal = v;
    if (v > 0 && v < minPos) minPos = v;
  });
  if (!isFinite(maxVal)) { maxVal = 1; minVal = 0; }
  if (!isFinite(minPos)) minPos = 1;

  if (isLog) {
    // A log axis has no room for zero or anything below it. Rather than emit
    // NaN coordinates, fall back to the smallest positive value and say so.
    let lowBound = minPos;
    if (ax.min !== null && ax.min !== undefined) {
      if (ax.min > 0) lowBound = ax.min;
      else notes.push('a log axis cannot start at ' + ax.min + '; started at ' + fmtAccess(minPos));
    }
    let highBound = Math.max(maxVal, lowBound);
    if (ax.max !== null && ax.max !== undefined) {
      if (ax.max > lowBound) highBound = ax.max;
      else notes.push('the maximum must be above the minimum on a log axis');
    }
    if (ax.scale === 'log' && !useLog(kind) && minVal <= 0) {
      notes.push('values at or below zero cannot be drawn on a log axis');
    }
    const logMin = Math.pow(10, Math.floor(Math.log10(lowBound)));
    const scaleMax = Math.pow(10, Math.ceil(Math.log10(highBound)));
    const span = Math.log10(scaleMax) - Math.log10(logMin) || 1;
    const y = v => {
      if (v === null || v === undefined) return null;
      if (v <= 0) return plotH;
      return plotH - ((Math.log10(v) - Math.log10(logMin)) / span) * plotH;
    };
    const ticks = Array.from({ length: Math.round(span) + 1 }, (_, i) => logMin * Math.pow(10, i));
    return { y: y, ticks: ticks, useLog: true, zeroY: plotH, hasNegative: false,
      tickLabel: fmtAccess, notes: notes,
      clamp: p => Math.max(0, Math.min(plotH, p)),
      outside: v => (v !== null && v !== undefined && (v < logMin || v > scaleMax)) };
  }

  let hi = Math.max(maxVal, 0), lo = Math.min(minVal, 0);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.15;
  if (maxVal > 0) hi += pad;
  if (minVal < 0) lo -= pad;
  if (ax.min !== null && ax.min !== undefined) lo = ax.min;
  if (ax.max !== null && ax.max !== undefined) hi = ax.max;
  if (hi <= lo) { notes.push('the maximum must be above the minimum'); hi = lo + 1; }
  const span = (hi - lo) || 1;
  const y = v => (v === null || v === undefined) ? null : plotH - ((v - lo) / span) * plotH;
  // Zero only earns a tick when it is inside the domain. A hand-set minimum
  // above zero used to put a tick, and the bar baseline, off the bottom.
  const ticks = (lo < 0 && hi > 0) ? [lo, 0, hi] : [lo, (lo + hi) / 2, hi];
  return {
    y: y, ticks: ticks, useLog: false,
    zeroY: Math.max(0, Math.min(plotH, y(0))),
    hasNegative: lo < 0,
    tickLabel: t => tickLabel(kind, t),
    notes: notes,
    // An explicit range is a window on the data, so anything outside it is
    // drawn clipped to the frame rather than off it -- and counted, so the
    // chart can say how much it is not showing.
    clamp: p => Math.max(0, Math.min(plotH, p)),
    outside: v => (v !== null && v !== undefined && (v < lo || v > hi)),
  };
}
