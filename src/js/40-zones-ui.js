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

function moveDimToZone(plot, dimKey, zoneKey, beforeDim) {
  const isMetric = dimKey === 'metric';
  const allowed = isMetric ? METRIC_ZONE_KEYS : ZONE_KEYS;
  if (allowed.indexOf(zoneKey) === -1) return;

  ZONE_KEYS.forEach(zk => {
    const list = effectiveZoneList(plot, zk);
    if (list.indexOf(dimKey) === -1) return;
    setEffectiveZoneList(plot, zk, list.filter(k => k !== dimKey));
  });

  if (isMetric && zoneKey === PANEL_ZONE.key) {
    plot.metricZone = zoneKey;
    plot.metricPos = 99;
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
}

function renderZonesUI(container, plot, onChange) {
  container.innerHTML = '';
  const plan = computeAxisPlan(plot);
  const wrap = html('div', 'zones', container);

  const grid = isGridType(plot.chartType);
  const isTable = plot.chartType === 'table';
  const zoneTitle = { x: grid ? 'Columns' : 'X-axis', series: grid ? 'Rows' : 'Series', facet: 'Facets', panel: 'Panels' };
  const zoneHint = {
    x: isTable ? 'each combination becomes one value column; headings nest left → right'
       : grid ? 'nested left → right (first = outermost)'
       : 'nested left → right (first = outermost band)',
    series: isTable ? 'one row per combination; these become the leading descriptor columns'
       : grid ? 'one matrix row per combination'
       : 'colour of the bars within each group',
    facet: 'splits into separate charts — usually leave empty',
    panel: PANEL_ZONE.hint,
  };
  // the Panels zone only exists once Metric is an active grouping dimension
  const zoneList = plan.metricActive ? ZONES.concat([PANEL_ZONE]) : ZONES;

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
    (isMetric ? ZONES.concat([PANEL_ZONE]) : ZONES).forEach(z => {
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
    html('div', 'chart-note', container).textContent =
      'The selected metrics use different scales (' + plan.metricKinds.join(' + ') +
      '), so Metric is shown as stacked Panels — one sub-chart per metric. Remove the odd one out to group it as ' +
      zoneTitle[plot.metricZone] + ' again.';
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
  const dim = DIM_BY_KEY[dimKey];
  const block = html('div', 'dim-block', container);
  html('div', 'dim-label', block).textContent = dim.label;

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

  plot.included[dimKey].forEach(value => includedBody.appendChild(makeChip(value, 'included')));
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

  if (plot.included[dimKey].length === 0) {
    html('div', 'dim-warning', block).textContent = 'Nothing shown for ' + dim.label + '.';
  }
}
