// drag token, zone moves, zone UI, included-values list
// ---- grouping zones UI (drag dims between X-axis / Series / Facets) ----
// One shared, tagged drag token. Per-widget flags used to survive an abandoned drag
// and then get applied by the *next* unrelated drop, silently moving a value the user
// never touched. Every drop consumes the token and checks that it came from itself.
let DRAG = null; // { kind: 'value'|'dim', dimKey, value?, from? }
function takeDrag(kind, dimKey) {
  const d = DRAG;
  DRAG = null;
  if (!d || d.kind !== kind) return null;
  if (dimKey !== undefined && d.dimKey !== dimKey) return null;
  return d;
}

// Metric is not stored inside plot.zones (it is injected by computeAxisPlan from
// metricZone/metricPos), which made every index calculation a special case. These two
// helpers convert to and from the list you actually see, so all reordering is a plain
// array move and Metric behaves exactly like any other chip.
function effectiveZoneList(plot, zoneKey) {
  const arr = plot.zones[zoneKey].slice();
  if (plot.metricZone === zoneKey) {
    const pos = plot.metricPos === undefined ? 99 : plot.metricPos;
    arr.splice(Math.max(0, Math.min(pos, arr.length)), 0, 'metric');
  }
  return arr;
}
function setEffectiveZoneList(plot, zoneKey, list) {
  const mi = list.indexOf('metric');
  if (mi !== -1) {
    plot.metricZone = zoneKey;
    // keep "last" sticky, so a dimension added later still lands outside Metric
    plot.metricPos = (mi === list.length - 1) ? 99 : mi;
  }
  plot.zones[zoneKey] = list.filter(k => k !== 'metric');
}

// Every grouping change goes through here, which makes it the one place worth
// snapshotting: a dimension dragged into the wrong zone by accident rewrites the
// whole chart, and until now the only way back was to remember where it came
// from. One slot, not a stack -- the same one Load already uses.
function moveDimToZone(plot, dimKey, zoneKey, beforeDim) {
  return withPlotSchema(plot, () => placeDimInZone(plot, dimKey, zoneKey, beforeDim));
}
function placeDimInZone(plot, dimKey, zoneKey, beforeDim) {
  const isMetric = dimKey === 'metric';
  const allowed = isMetric ? METRIC_ZONE_KEYS : ZONE_KEYS;
  if (allowed.indexOf(zoneKey) === -1) return;

  const fromZone = ZONE_KEYS.filter(zk => effectiveZoneList(plot, zk).indexOf(dimKey) !== -1)[0]
    || (isMetric ? plot.metricZone : null);
  const before = serializePlots();

  ZONE_KEYS.forEach(zk => {
    const list = effectiveZoneList(plot, zk);
    if (list.indexOf(dimKey) === -1) return;
    setEffectiveZoneList(plot, zk, list.filter(k => k !== dimKey));
  });

  if (isMetric && zoneKey === PANEL_ZONE.key) {
    plot.metricZone = zoneKey;
    plot.metricPos = 99;
    announceZoneMove(dimKey, fromZone, zoneKey, before);
    return;
  }

  const target = effectiveZoneList(plot, zoneKey).filter(k => k !== dimKey);
  let at = target.length;
  if (beforeDim !== undefined && beforeDim !== null && beforeDim !== dimKey) {
    const bi = target.indexOf(beforeDim);
    if (bi !== -1) at = bi;
  }
  target.splice(at, 0, dimKey);
  setEffectiveZoneList(plot, zoneKey, target);
  announceZoneMove(dimKey, fromZone, zoneKey, before);
}

// Only worth offering when the chip actually changed zone: reordering within one
// zone is a nudge, and an Undo button after every nudge is noise.
function announceZoneMove(dimKey, fromZone, zoneKey, before) {
  if (!fromZone || fromZone === zoneKey) return;
  const dim = DIM_BY_KEY[dimKey];
  const zoneLabel = k => {
    if (k === PANEL_ZONE.key) return PANEL_ZONE.label;
    const z = ZONES.filter(o => o.key === k)[0];
    return z ? z.label : k;
  };
  undoSnapshot = before;
  setStatus('Moved ' + (dim ? dim.label : dimKey) + ' to ' + zoneLabel(zoneKey) + '.', true);
}

function renderZonesUI(container, plot, onChange) {
  return withPlotSchema(plot, () => drawZonesUI(container, plot, onChange));
}
function drawZonesUI(container, plot, onChange) {
  container.innerHTML = '';
  const plan = computeAxisPlan(plot);
  const wrap = html('div', 'zones', container);

  const grid = isGridType(plot.chartType);
  const isTable = plot.chartType === 'table';
  // Both axes of a correlation plot are quantities, so neither zone is an axis
  // here: both of them make dots, and the only difference is that Series is the
  // one the key names. Calling this zone "X-axis" would be a plain lie.
  const corr = isCorrelation(plot.chartType);
  const zoneTitle = {
    x: corr ? 'Dots' : grid ? 'Columns' : 'X-axis',
    series: corr ? 'Dot colour' : grid ? 'Rows' : 'Series',
    facet: 'Facets', panel: 'Panels', off: 'Not used',
  };
  const zoneHint = {
    x: corr ? 'one dot per combination — these say which combination a dot is'
       : isTable ? 'each combination becomes one value column; headings nest left → right'
       : grid ? 'nested left → right (first = outermost)'
       : 'nested left → right (first = outermost band)',
    series: corr ? 'one dot per combination too, and these choose its colour and shape'
       : isTable ? 'one row per combination; these become the leading descriptor columns'
       : grid ? 'one matrix row per combination'
       : 'colour of the bars within each group',
    facet: 'splits into separate charts — usually leave empty',
    panel: PANEL_ZONE.hint,
    off: 'still in the data and averaged over — names nothing, orders nothing, splits nothing',
  };
  // the Panels zone only exists once Metric is an active grouping dimension.
  // "Not used" goes last of all: it is where a dimension goes to stop taking
  // part, so it reads as the end of the row rather than as another axis.
  const onChart = ZONES.filter(z => z.key !== OFF_ZONE);
  const offBox = ZONES.filter(z => z.key === OFF_ZONE);
  const zoneList = (plan.metricActive ? onChart.concat([PANEL_ZONE]) : onChart).concat(offBox);

  function makeZoneChip(dimKey, zoneKey, idx, count) {
    const isMetric = dimKey === 'metric';
    const chip = html('div', 'zone-chip' + (isMetric ? ' metric-chip' : ''), null);
    chip.draggable = true;
    chip.setAttribute('data-dim', dimKey);
    chip.setAttribute('data-zone', zoneKey);
    html('span', 'handle', chip).textContent = '⠿';
    if (count > 1) html('span', 'order-num', chip).textContent = String(idx + 1);
    const lbl = html('span', null, chip);
    lbl.textContent = isMetric ? 'Metric (data shown)' : DIM_BY_KEY[dimKey].label;
    if (isMetric && plan.forcedPanels) {
      const badge = html('span', 'order-num', chip);
      badge.textContent = 'drawn as panels';
      badge.title = 'These metrics use different scales, so they are stacked as panels rather than sharing this axis.';
    }
    // The chip stays where it was put and says what is happening to it, which is
    // the same courtesy a dimension a comparison has already consumed gets.
    if ((plan.pinnedDims || []).indexOf(dimKey) !== -1) {
      const badge = html('span', 'order-num pinned', chip);
      badge.textContent = 'pinned';
      badge.title = 'The two axes differ in this, so it cannot also tell one dot from '
        + 'another. Remove its row under Pins to group by it again.';
    }

    if (count > 1) {
      // Metric lives outside plot.zones (it is injected by computeAxisPlan), so it
      // moves by index instead of by splicing the array -- same buttons either way.
      const shift = delta => {
        const list = effectiveZoneList(plot, zoneKey);
        const i = list.indexOf(dimKey);
        const j = i + delta;
        if (i === -1 || j < 0 || j >= list.length) return;
        list.splice(i, 1); list.splice(j, 0, dimKey);
        setEffectiveZoneList(plot, zoneKey, list);
        onChange();
      };
      const left = document.createElement('button');
      left.type = 'button'; left.className = 'mini'; left.textContent = '◀'; left.title = 'Move outward';
      left.disabled = idx === 0;
      left.addEventListener('click', () => shift(-1));
      chip.appendChild(left);
      const right = document.createElement('button');
      right.type = 'button'; right.className = 'mini'; right.textContent = '▶'; right.title = 'Move inward';
      right.disabled = idx === count - 1;
      right.addEventListener('click', () => shift(1));
      chip.appendChild(right);
    }

    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Zone for ' + lbl.textContent);
    // Metric picks a column rather than filtering rows, so there is nothing to
    // average it over: it is offered Panels instead of Not used.
    (isMetric ? ZONES.filter(z => z.key !== OFF_ZONE).concat([PANEL_ZONE]) : ZONES).forEach(z => {
      const o = document.createElement('option');
      o.value = z.key; o.textContent = zoneTitle[z.key];
      sel.appendChild(o);
    });
    sel.value = zoneKey;
    sel.addEventListener('change', () => { moveDimToZone(plot, dimKey, sel.value, undefined); onChange(); });
    chip.appendChild(sel);

    chip.addEventListener('dragstart', e => {
      DRAG = { kind: 'dim', dimKey: dimKey }; chip.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dimKey); } catch (err) {} }
    });
    chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); DRAG = null; });
    chip.addEventListener('dragover', e => e.preventDefault());
    chip.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const d = takeDrag('dim');
      if (!d || d.dimKey === dimKey) return;
      moveDimToZone(plot, d.dimKey, zoneKey, dimKey);
      onChange();
    });
    return chip;
  }

  zoneList.forEach(z => {
    const dims = plan.zoneDims[z.key] || [];
    const box = html('div', 'zone', wrap);
    box.setAttribute('data-zone', z.key);
    const head = html('div', 'zone-head', box);
    html('span', 'zone-name', head).textContent = zoneTitle[z.key];
    html('span', 'zone-hint', head).textContent = zoneHint[z.key];
    const body = html('div', 'zone-body', box);
    if (dims.length === 0) {
      html('div', 'zone-empty', body).textContent =
        z.key === 'facet' ? 'none — everything stays in one chart'
        : z.key === 'panel' ? 'drop Metric here to stack one sub-chart per metric'
        : z.key === OFF_ZONE ? 'none — every dimension is in play'
        : 'drop a dimension here';
    }
    dims.forEach((dimKey, i) => body.appendChild(makeZoneChip(dimKey, z.key, i, dims.length)));

    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag-over'); });
    box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
    box.addEventListener('drop', e => {
      e.preventDefault(); box.classList.remove('drag-over');
      const d = takeDrag('dim');
      if (!d) return;
      moveDimToZone(plot, d.dimKey, z.key, undefined);
      onChange();
    });
  });

  if (plan.forcedPanels) {
    // With a split in play the groups decide the layout, not this fallback, so
    // the advice has to change with it rather than describe what is not happening.
    const split = plot.metricBreaks && plot.metricBreaks.length;
    html('div', 'chart-note', container).textContent = split
      ? 'The selected metrics use different scales (' + plan.metricKinds.join(' + ')
        + '). Your groups are drawn side by side, each with its own y-axis.'
      : 'The selected metrics use different scales (' + plan.metricKinds.join(' + ')
        + '), so Metric is shown as stacked Panels — one sub-chart per metric. '
        + 'Split them into groups in "Data shown", or remove the odd one out to group it as '
        + zoneTitle[plot.metricZone] + ' again.';
  }
  if (plan.seriesCount > PALETTE_COMFORTABLE && plot.chartType !== 'table') {
    html('div', 'dim-warning', container).textContent =
      'Series needs ' + plan.seriesCount + ' colours. Past about ' + PALETTE_COMFORTABLE +
      ' they stop being reliably distinguishable — consider moving a dimension out of '
      + zoneTitle.series + ', or narrowing its included values.';
  }
}

// ---- per-dimension included-values dual list ----
function renderDimIncludedBlock(container, plot, dimKey, onChange) {
  return withPlotSchema(plot, () => drawDimIncludedBlock(container, plot, dimKey, onChange));
}
function drawDimIncludedBlock(container, plot, dimKey, onChange) {
  const dim = DIM_BY_KEY[dimKey];
  const block = html('div', 'dim-block', container);
  const label = html('div', 'dim-label', block);
  html('span', 'dim-label-name', label).textContent = dim.label;
  // "all" and "none" do the same job for one dimension's list that the import
  // preselect does for a whole file: excluding or including everything at once
  // rather than a click per value.
  const mkBtn = (text, title, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip-mini ' + cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', fn);
    label.appendChild(b);
    return b;
  };
  mkBtn('all', 'Show every value of ' + dim.label, 'dim-all', () => {
    plot.included[dimKey] = dim.values.slice();
    onChange();
  });
  mkBtn('none', 'Show nothing of ' + dim.label, 'dim-none', () => {
    plot.included[dimKey] = [];
    onChange();
  });
  // Shown/Available still means something for a dimension that is not on the
  // chart: it decides what gets folded into the average, not what appears.
  if ((plot.zones[OFF_ZONE] || []).indexOf(dimKey) !== -1) {
    html('div', 'dim-note', block).textContent =
      'Not used in this plot — the values below are averaged together, and one '
      + 'left in Available is left out of that average.';
  }

  const dual = html('div', 'dual-list', block);
  const includedCol = html('div', 'dual-col', dual);
  html('div', 'col-label', includedCol).textContent = 'Shown';
  const includedBody = html('div', 'dual-col-body', includedCol);

  const availCol = html('div', 'dual-col', dual);
  html('div', 'col-label', availCol).textContent = 'Available';
  const availBody = html('div', 'dual-col-body', availCol);

  function moveValue(value, fromList, toList, beforeValue) {
    if (toList === 'included') {
      let arr = plot.included[dimKey].filter(v => v !== value);
      let insertAt = arr.length;
      if (beforeValue !== undefined && beforeValue !== value) {
        const bi = arr.indexOf(beforeValue);
        if (bi !== -1) insertAt = bi;
      }
      arr.splice(insertAt, 0, value);
      plot.included[dimKey] = arr;
    } else if (fromList === 'included') {
      plot.included[dimKey] = plot.included[dimKey].filter(v => v !== value);
    }
    onChange();
  }

  function makeChip(value, fromList) {
    const included = fromList === 'included';
    const chip = document.createElement('div');
    chip.className = 'dnd-chip';
    chip.draggable = true;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-pressed', included ? 'true' : 'false');
    chip.title = (included ? 'Click to remove ' : 'Click to add ') + dimValueLabel(dimKey, value);
    const sw = html('span', 'swatch', chip); sw.style.background = dimValueColor(dimKey, value);
    const lbl = html('span', null, chip); lbl.textContent = dimValueLabel(dimKey, value);
    // the +/x stays as an affordance but is not the hit target: clicks bubble up
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.setAttribute('aria-hidden', 'true');
    btn.textContent = included ? '×' : '+';
    chip.appendChild(btn);

    let dragged = false;
    const toggleValue = () => moveValue(value, fromList, included ? 'available' : 'included', undefined);
    chip.addEventListener('click', () => {
      if (dragged) { dragged = false; return; }  // a completed drag must not also toggle
      toggleValue();
    });
    chip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleValue(); }
    });

    chip.addEventListener('dragstart', e => {
      dragged = true;
      DRAG = { kind: 'value', dimKey: dimKey, value: value, from: fromList };
      chip.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(value)); } catch (err) {} }
    });
    chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); DRAG = null; });
    chip.addEventListener('dragover', e => e.preventDefault());
    chip.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const d = takeDrag('value', dimKey);
      if (!d) return;
      moveValue(d.value, d.from, fromList, value);
    });
    return chip;
  }

  // Between the shown metrics, a place to split them into groups. The list is
  // stacked vertically, so the divider sits between two chips the way it reads.
  function splitControl(afterValue, isLast) {
    if (dimKey !== MEASURE_DIM || isLast) return null;
    const breaks = plot.metricBreaks || (plot.metricBreaks = []);
    const on = breaks.indexOf(afterValue) !== -1;
    const bar = html('div', 'metric-split' + (on ? ' on' : ''), null);
    bar.setAttribute('data-after', afterValue);
    bar.setAttribute('role', 'button');
    bar.tabIndex = 0;
    bar.title = on ? 'Remove this split' : 'Split the metrics into groups here';
    html('span', 'metric-split-line', bar);
    html('span', 'metric-split-text', bar).textContent = on ? 'group ends here ×' : 'split here';
    const toggle = () => {
      plot.metricBreaks = on ? breaks.filter(v => v !== afterValue) : breaks.concat([afterValue]);
      onChange();
    };
    bar.addEventListener('click', toggle);
    bar.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    return bar;
  }

  plot.included[dimKey].forEach((value, i, arr) => {
    includedBody.appendChild(makeChip(value, 'included'));
    const sp = splitControl(value, i === arr.length - 1);
    if (sp) includedBody.appendChild(sp);
  });
  dim.values.filter(v => plot.included[dimKey].indexOf(v) === -1).forEach(value => availBody.appendChild(makeChip(value, 'available')));

  [[includedBody, 'included'], [availBody, 'available']].forEach(pair => {
    const body = pair[0], listName = pair[1];
    body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', e => {
      e.preventDefault(); body.classList.remove('drag-over');
      const d = takeDrag('value', dimKey);
      if (!d) return;
      moveValue(d.value, d.from, listName, undefined);
    });
  });

  if (dimKey === MEASURE_DIM && plot.metricBreaks && plot.metricBreaks.length) {
    const shown = plot.included[MEASURE_DIM];
    const live = plot.metricBreaks.filter(v => shown.indexOf(v) !== -1 && shown[shown.length - 1] !== v);
    if (live.length !== plot.metricBreaks.length) plot.metricBreaks = live;
    const n = live.length + 1;
    if (live.length) {
      html('div', 'dim-note', block).textContent =
        n + ' groups. They share one y-axis where the scales agree, and get one each where they do not.';
    }
  }
  if (plot.included[dimKey].length === 0) {
    html('div', 'dim-warning', block).textContent = 'Nothing shown for ' + dim.label + '.';
  }
}
