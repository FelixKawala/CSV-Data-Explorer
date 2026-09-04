// plot card and plot list
// ---- plot card & plot list management ----
// Open until the user closes it: the axis strip is where a range gets set, and
// hiding it by default would make the settings harder to find than the crowding
// it exists to cure.
const axesOpen = {};
// The pins strip is the same idea for the correlation plot: open until closed,
// since a chart with nothing pinned has nothing to draw.
const pinsOpen = {};
// Which config blocks are folded away, keyed plot and block. Open until closed:
// a control that starts hidden is a control nobody finds, and the point of
// folding one is to get the chart back on screen once you know where it is.
const blockOpen = {};

// A config block with a heading that folds it. Returns the body to fill, or
// null when it is folded -- so a collapsed block costs nothing to render, which
// matters on a card holding a dimension picker per dimension.
function blockBody(block, plot, key, title) {
  const id = plot.id + ':' + key;
  const open = blockOpen[id] !== false;
  const t = html('button', 'block-toggle', block);
  t.type = 'button';
  t.setAttribute('data-block', key);
  t.textContent = (open ? '▾  ' : '▸  ') + title;
  t.addEventListener('click', () => {
    blockOpen[id] = !open;
    renderPlotCard(plot);
  });
  return open ? html('div', 'block-body', block) : null;
}

// Dragging the divider between the controls and the chart. One width for every
// card: two cards disagreeing about it would read as a rendering fault, and the
// question "how much room do the controls need" has one answer per screen.
const LS_CONFIG_W = 'viz-config-width';
function applyConfigWidth() {
  const host = document.getElementById('plots');
  if (!host) return;
  let w = 0;
  try { w = Number(localStorage.getItem(LS_CONFIG_W)) || 0; } catch (e) { w = 0; }
  if (w >= 220 && w <= 900) host.style.setProperty('--config-w', w + 'px');
}
function attachSplitter(el) {
  el.addEventListener('mousedown', down => {
    const host = document.getElementById('plots');
    const controls = el.previousSibling;
    if (!host || !controls) return;
    down.preventDefault();
    const startX = down.clientX;
    const startW = controls.getBoundingClientRect().width || 340;
    const move = e => {
      const w = Math.max(220, Math.min(900, startW + (e.clientX - startX)));
      host.style.setProperty('--config-w', w + 'px');
      try { localStorage.setItem(LS_CONFIG_W, String(Math.round(w))); } catch (err) {}
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging-splitter');
    };
    document.body.classList.add('dragging-splitter');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
function renderPlotCard(plot) {
  return withPlotSchema(plot, () => drawPlotCard(plot));
}
function drawPlotCard(plot) {
  const container = document.getElementById('plot-card-' + plot.id);
  if (!container) return;
  container.innerHTML = '';
  const rerender = () => renderPlotCard(plot);

  const head = html('div', 'plot-head', container);
  const title = html('div', 'plot-title', head);
  title.textContent = 'Plot ' + (plots.indexOf(plot) + 1);
  renderPlotDatasetPicker(head, plot, rerender);

  const typeSel = document.createElement('select');
  CHART_TYPES.forEach(pair => {
    const o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1];
    typeSel.appendChild(o);
  });
  typeSel.value = plot.chartType;
  // Bound, not bare: this reads the plot's dimensions to propose a pin BEFORE
  // anything re-renders, and by the time a click arrives the page may be
  // showing something else. The handlers that only change the plot and
  // re-render need no such thing -- the re-render binds itself.
  typeSel.addEventListener('change', bindDataset(() => {
    plot.chartType = typeSel.value;
    // A correlation plot with nothing pinned is an empty frame and an
    // instruction, so switching to it proposes the obvious first question
    // rather than asking one.
    if (isCorrelation(plot.chartType) && !normalisePins(plot.pins).length) {
      plot.pins = defaultPins();
    }
    rerender(); persistPlotsDebounced();
  }));
  head.appendChild(typeSel);

  const headPlan = computeAxisPlan(plot);
  // ---- what the two axes differ in ----------------------------------------
  // Its own strip rather than a row of selects in the head: three selects per
  // row and up to three rows would crowd out everything beside it, and this is
  // set once and then left alone. Collapsible for the same reason the axis
  // strip is.
  if (isCorrelation(plot.chartType)) {
    const pinsBar = html('div', 'plot-pins-bar', null);
    const pins = normalisePins(plot.pins);
    plot.pins = pins;
    const used = pins.map(r => r.over);
    const commit = () => { rerender(); persistPlotsDebounced(); };
    const pinList = v => Array.isArray(v) ? v.slice() : (v === undefined ? [] : [v]);
    const setPinList = (row, which, list) => { row[which] = list.length === 1 ? list[0] : list; };
    // One select per value on the axis, plus a ＋ that adds the next value not
    // already there: an axis can hold several readings -- data0 AND data1
    // against one baseline -- each drawn as its own series.
    const axisControls = (row, which, line) => {
      const wrap = html('span', 'pin-axis', line);
      html('span', 'mini-label', wrap).textContent = which === 'x' ? 'X =' : 'Y =';
      const vals = pinList(row[which]);
      if (!vals.length) vals.push(DIM_BY_KEY[row.over].values[0]);
      vals.forEach((v, idx) => {
        const sel = document.createElement('select');
        sel.className = 'pin-' + which;
        DIM_BY_KEY[row.over].values.forEach(val => {
          const o = document.createElement('option');
          o.value = val; o.textContent = dimValueLabel(row.over, val);
          sel.appendChild(o);
        });
        sel.value = v;
        sel.addEventListener('change', () => {
          const list = pinList(row[which]);
          list[idx] = sel.value;
          setPinList(row, which, list);
          commit();
        });
        wrap.appendChild(sel);
        if (idx > 0) {
          const rm = document.createElement('button');
          rm.type = 'button'; rm.className = 'btn small ghost pin-remove'; rm.textContent = '×';
          rm.title = 'Take this reading off the ' + (which === 'x' ? 'X' : 'Y') + ' axis';
          rm.addEventListener('click', () => {
            const list = pinList(row[which]);
            list.splice(idx, 1);
            setPinList(row, which, list);
            commit();
          });
          wrap.appendChild(rm);
        }
      });
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'btn small ghost pin-add-val';
      add.textContent = '＋';
      add.title = 'Add another reading to this axis — each gets its own colour and shape';
      add.addEventListener('click', () => {
        const list = pinList(row[which]);
        const taken = {};
        list.forEach(v => { taken[v] = true; });
        const next = DIM_BY_KEY[row.over].values.filter(v => !taken[v])[0];
        if (next === undefined) return;
        list.push(next);
        setPinList(row, which, list);
        commit();
      });
      wrap.appendChild(add);
      return wrap;
    };
    pins.forEach((row, i) => {
      const line = html('div', 'pin-row', pinsBar);
      line.setAttribute('data-index', String(i));
      html('span', 'mini-label', line).textContent = i === 0 ? 'X and Y differ in' : 'and also in';
      const overSel = document.createElement('select');
      overSel.className = 'pin-over';
      // the dimensions still free, plus this row's own
      pinnableDims().filter(k => k === row.over || used.indexOf(k) === -1).forEach(k => {
        const o = document.createElement('option');
        o.value = k; o.textContent = DIM_BY_KEY[k].label;
        overSel.appendChild(o);
      });
      overSel.value = row.over;
      overSel.addEventListener('change', bindDataset(() => {
        const vals = DIM_BY_KEY[overSel.value].values;
        plot.pins[i] = { over: overSel.value, x: vals[0], y: vals[1] === undefined ? vals[0] : vals[1] };
        commit();
      }));
      line.appendChild(overSel);
      line.appendChild(axisControls(row, 'x', line));
      line.appendChild(axisControls(row, 'y', line));
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn small ghost pin-remove'; rm.textContent = '✕';
      rm.title = 'Stop differing in ' + DIM_BY_KEY[row.over].label
        + ' — it goes back to telling one dot from another.';
      rm.addEventListener('click', () => { plot.pins = pins.filter((_, j) => j !== i); commit(); });
      line.appendChild(rm);
    });
    const free = pinnableDims().filter(k => used.indexOf(k) === -1);
    if (free.length && pins.length < PIN_LIMIT) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'btn small pin-add';
      add.textContent = pins.length ? '＋ and also in …' : '＋ pick what they differ in';
      add.title = 'A second row lets the axes differ in two things at once — X = the '
        + 'target measure at Run 1, Y = the result measure at Run 2.';
      add.addEventListener('click', bindDataset(() => {
        const vals = DIM_BY_KEY[free[0]].values;
        plot.pins = pins.concat([{ over: free[0], x: vals[0], y: vals[1] === undefined ? vals[0] : vals[1] }]);
        commit();
      }));
      html('div', 'pin-actions', pinsBar).appendChild(add);
    }
    html('div', 'pin-hint', pinsBar).textContent =
      'Both axes read the same combination; these are the only things they differ in. '
      + 'A row with the same value on both sides pins that dimension for the whole chart, '
      + 'and the values offered are the dimension\'s own — not the "shown" list, which '
      + 'no longer decides anything for a pinned dimension. ＋ on an axis adds another '
      + 'reading of it: several on one axis become one series each, in their own colour and shape.';
    const openPins = pinsOpen[plot.id] !== false;
    const pt = html('button', 'axes-toggle pins-toggle', head);
    pt.type = 'button';
    pt.setAttribute('data-plot', String(plot.id));
    pt.textContent = (openPins ? '▾' : '▸') + '  Pins' + (pins.length > 1 ? ' (' + pins.length + ')' : '');
    pt.title = 'What the two axes differ in';
    pt.addEventListener('click', () => { pinsOpen[plot.id] = !openPins; rerender(); });
    if (openPins) container.appendChild(pinsBar);
  }
  if (plot.chartType === 'table'
      && anyMetricIgnores(plot, headPlan.seriesDims.concat(headPlan.xDims))) {
    const lab4 = html('label', 'head-toggle', head);
    const cb4 = document.createElement('input');
    cb4.type = 'checkbox'; cb4.checked = plot.collapseRepeats !== false;
    cb4.title = 'Show a repeated value once instead of once per Variant, where the metric does not depend on it.';
    cb4.addEventListener('change', () => { plot.collapseRepeats = cb4.checked; rerender(); persistPlotsDebounced(); });
    lab4.appendChild(cb4);
    html('span', null, lab4).textContent = 'collapse repeated values';
  }
  // What a line joins. By default it follows the axis and stops at a gap, which
  // is right when the x-axis is a sequence. Naming a dimension instead makes the
  // line a statement about that dimension: one line per combination of the
  // others, stepping over the positions where there is no value rather than
  // ending there.
  const drawsLinesHead = plot.chartType === 'lines' || headPlan.dualAxis;
  if (drawsLinesHead && headPlan.xDims.length > 1) {
    const grp = html('span', 'head-group', head);
    html('span', 'mini-label', grp).textContent = 'Lines';
    const sel = document.createElement('select');
    sel.className = 'line-along';
    sel.title = 'Which dimension a line runs along. "follow the axis" keeps the '
      + 'drawn order and breaks at a missing value.';
    const opts = [['', 'follow the axis']].concat(
      headPlan.xDims.filter(k => DIM_BY_KEY[k]).map(k => [k, 'along ' + DIM_BY_KEY[k].label]));
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = plot.lineAlong || '';
    sel.addEventListener('change', () => {
      plot.lineAlong = sel.value || null; rerender(); persistPlotsDebounced();
    });
    grp.appendChild(sel);
  }
  // Breaking per group is what "follow the axis" does at a block boundary; once
  // a dimension is named it is that dimension, not the blocks, that decides.
  // Gated on whether the chart DRAWS lines, not on whether it is a line chart:
  // a bar chart with a second axis draws its right-hand series as lines, and
  // where those lines connect was reachable only by switching chart type,
  // changing it, and switching back.
  if (drawsLinesHead && headPlan.xDims.length > 1 && !plot.lineAlong) {
    const lab3 = html('label', 'head-toggle', head);
    const cb3 = document.createElement('input');
    cb3.type = 'checkbox'; cb3.checked = plot.breakLines !== false;
    cb3.title = 'Start a new line for each ' + headPlan.xDims.slice(0, -1).map(k => DIM_BY_KEY[k].label).join(' / ')
      + ' block, instead of one line across the whole axis.';
    cb3.addEventListener('change', () => { plot.breakLines = cb3.checked; rerender(); persistPlotsDebounced(); });
    lab3.appendChild(cb3);
    html('span', null, lab3).textContent = 'break lines per group';
  }
  // Facets stack by default; a facet dimension with many values draws a page
  // taller than the screen. Side by side, as many facets sit in the row as
  // fit, and the rest wrap beneath them.
  if (headPlan.facetDims.length > 0) {
    const labF = html('label', 'head-toggle', head);
    const cbF = document.createElement('input');
    cbF.type = 'checkbox'; cbF.checked = !!plot.facetsInRow;
    cbF.title = 'Draw the facet cards side by side, wrapping into rows, instead of one below the other';
    cbF.addEventListener('change', () => { plot.facetsInRow = cbF.checked; rerender(); persistPlotsDebounced(); });
    labF.appendChild(cbF);
    html('span', null, labF).textContent = 'facets in a row';
  }
  // ---- y-axis: scale and bounds -------------------------------------------
  // Only where there is a y-axis to speak of; a matrix and a table have none.
  // The second axis of a dual-axis chart is a different measure on a different
  // scale, so it gets the same controls rather than being told to fit its data:
  // a count opposite a rate usually wants log where the rate wants linear.
  // Axis settings live in a strip of their own, not strung along the head next
  // to the chart type and the buttons. There can be three of them at once (one
  // per scale), each with a select and two boxes, and inline they crowded out
  // everything they sat beside. Collapsible, because once a range is set it is
  // set.
  const axesBar = html('div', 'plot-axes-bar', null);
  const axisControls = (ax, tag, caption, hint) => {
    const grp = html('span', 'yaxis-group', axesBar);
    grp.setAttribute('data-axis', tag);
    const cap = html('span', 'yaxis-label', grp);
    cap.textContent = caption;
    if (hint) cap.title = hint;

    const scaleSel = document.createElement('select');
    scaleSel.className = 'yaxis-scale';
    [['auto', 'auto'], ['linear', 'linear'], ['log', 'log']].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      scaleSel.appendChild(opt);
    });
    scaleSel.value = ax.scale || 'auto';
    scaleSel.title = 'auto follows the measure: log for counts, linear for rates and changes.';
    scaleSel.addEventListener('change', () => {
      ax.scale = scaleSel.value; rerender(); persistPlotsDebounced();
    });
    grp.appendChild(scaleSel);

    // An empty box means auto. Typing a number is a claim about the window you
    // want; it is used exactly as written, not padded.
    [['min', 'min'], ['max', 'max']].forEach(([key, placeholder]) => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'yaxis-bound';
      inp.placeholder = placeholder;
      inp.value = ax[key] === null || ax[key] === undefined ? '' : String(ax[key]);
      inp.title = 'Leave empty to fit the data.';
      inp.addEventListener('change', () => {
        const raw = inp.value.trim();
        const n = Number(raw);
        ax[key] = (raw === '' || !isFinite(n)) ? null : n;
        rerender(); persistPlotsDebounced();
      });
      grp.appendChild(inp);
    });

    if (ax.min !== null || ax.max !== null || ax.scale !== 'auto') {
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'btn small'; reset.textContent = 'auto';
      reset.title = 'Back to fitting the data';
      reset.addEventListener('click', () => {
        // in place, because the object may be a slot inside yAxisBy that the
        // chart already holds a reference to
        ax.min = null; ax.max = null; ax.scale = 'auto';
        rerender(); persistPlotsDebounced();
      });
      grp.appendChild(reset);
    }
  };
  if (plot.chartType !== 'matrix' && plot.chartType !== 'table') {
    if (!plot.yAxis) plot.yAxis = { min: null, max: null, scale: 'auto' };
    if (!plot.yAxisRight) plot.yAxisRight = { min: null, max: null, scale: 'auto' };
    const panels = headPlan.metricPanels;
    if (isCorrelation(plot.chartType)) {
      // One quantity on both axes gets ONE range: two that could be set apart
      // by hand would break the only claim the 45° line makes. Two quantities
      // get one each, and the horizontal one borrows the second-axis slot,
      // which this chart type has no other use for.
      const ck = correlationKinds(plot, effectiveKind(plot, {}).kind);
      if (ck.shared) {
        axisControls(plot.yAxis, 'yAxis', 'Both axes',
          'One range on both, which is what makes the 45° line 45°.');
      } else {
        axisControls(plot.yAxis, 'yAxis', 'Y', 'The vertical axis');
        axisControls(plot.yAxisRight, 'xAxis', 'X', 'The horizontal axis');
      }
    } else if (headPlan.dualAxis) {
      axisControls(plot.yAxis, 'yAxis', 'Y left',
        'The axis the ' + (headPlan.metricKinds[0] || 'first') + ' series are drawn against');
      axisControls(plot.yAxisRight, 'yAxisRight', 'Y right',
        'The axis the ' + (headPlan.metricKinds[1] || 'second') + ' series are drawn against');
    } else if (panels && panels.length > 1) {
      // The chart is several panels, each with its own y-scale, so one set of
      // controls for all of them was the wrong shape: a maximum meant for the
      // percentages was also bounding the durations underneath. One per scale.
      panels.forEach(g => {
        const m = METRIC_BY_KEY[g[0]];
        if (!m) return;
        axisControls(axisSlotFor(plot, m.format), 'scale:' + m.format.axisGroup,
          'Y · ' + axisLabelOf(m.format),
          'The panel holding ' + g.map(k => METRIC_BY_KEY[k].label).join(', '));
      });
    } else {
      axisControls(plot.yAxis, 'yAxis', 'Y', '');
    }
  }

  // Three scales is where the second-axis offer used to disappear without a
  // word. A frame has two axes; say so, rather than leaving the control the
  // user had a moment ago simply gone.
  if (!headPlan.dualEligible && headPlan.scaleCount > 2 && isCartesian(plot.chartType)) {
    const hint = html('span', 'head-note', axesBar);
    hint.textContent = 'a second y-axis takes two scales; this shows ' + headPlan.scaleCount;
    hint.title = headPlan.metricKinds.join(', ')
      + ' — drop one from Data shown to use a second axis, or read them as the panels below.';
  }
  if (headPlan.dualEligible) {
    const lab2 = html('label', 'head-toggle', axesBar);
    const cb2 = document.createElement('input');
    cb2.type = 'checkbox'; cb2.checked = !!plot.dualAxis;
    cb2.title = 'Two y-scales in one frame: compact, but where the series cross means nothing.';
    cb2.addEventListener('change', () => { plot.dualAxis = cb2.checked; rerender(); persistPlotsDebounced(); });
    lab2.appendChild(cb2);
    html('span', null, lab2).textContent = 'second y-axis';
  }
  if (headPlan.oneAxisEligible) {
    const lab5 = html('label', 'head-toggle', axesBar);
    const cb5 = document.createElement('input');
    cb5.type = 'checkbox';
    cb5.className = 'one-axis-toggle';
    cb5.checked = !!plot.forceOneAxis;
    cb5.title = 'Draw measures of different kinds against a single y-axis instead of '
      + 'splitting them into panels. Right when they are comparable — a rate and a '
      + 'relative change are both percentages — and misleading when they are not.';
    cb5.addEventListener('change', () => { plot.forceOneAxis = cb5.checked; rerender(); persistPlotsDebounced(); });
    lab5.appendChild(cb5);
    html('span', null, lab5).textContent = 'one shared y-axis';
  }
  if (headPlan.metricPanels) {
    const lab = html('label', 'head-toggle', axesBar);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!plot.repeatPanelAxis;
    cb.addEventListener('change', () => { plot.repeatPanelAxis = cb.checked; rerender(); persistPlotsDebounced(); });
    lab.appendChild(cb);
    html('span', null, lab).textContent = 'grouping on every panel';
  }

  // The axis strip only exists if there is something in it, and it collapses.
  if (axesBar.childNodes.length) {
    const open = axesOpen[plot.id] !== false;
    const t = html('button', 'axes-toggle', head);
    t.type = 'button';
    t.setAttribute('data-plot', String(plot.id));
    const nAxes = axesBar.querySelectorAll('.yaxis-group').length;
    t.textContent = (open ? '▾' : '▸') + '  Axes'
      + (nAxes > 1 ? ' (' + nAxes + ')' : '');
    t.title = 'Scale and range for each y-axis this chart has';
    t.addEventListener('click', () => { axesOpen[plot.id] = !open; rerender(); });
    if (open) container.appendChild(axesBar);
  }

  // One place for "get this out of the page", rather than three buttons loose
  // among the toggles and the card actions.
  const exports = html('span', 'export-group', head);
  html('span', 'mini-label', exports).textContent = 'Export';
  addTikzButton(exports, () => document.getElementById('plot-render-' + plot.id) || container,
    'TikZ', 'plot ' + (plots.indexOf(plot) + 1), 'btn small');

  const actions = html('span', 'card-actions', head);
  const dupBtn = document.createElement('button'); dupBtn.type = 'button'; dupBtn.className = 'btn small'; dupBtn.textContent = 'Duplicate';
  dupBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); plots.splice(idx + 1, 0, clonePlot(plot)); renderPlots(); });
  actions.appendChild(dupBtn);

  const upBtn = document.createElement('button'); upBtn.type = 'button'; upBtn.className = 'btn small'; upBtn.textContent = '↑';
  upBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); if (idx > 0) { plots.splice(idx, 1); plots.splice(idx - 1, 0, plot); renderPlots(); } });
  actions.appendChild(upBtn);

  const downBtn = document.createElement('button'); downBtn.type = 'button'; downBtn.className = 'btn small'; downBtn.textContent = '↓';
  downBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); if (idx < plots.length - 1) { plots.splice(idx, 1); plots.splice(idx + 1, 0, plot); renderPlots(); } });
  actions.appendChild(downBtn);

  const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn small danger'; rmBtn.textContent = 'Remove';
  rmBtn.addEventListener('click', () => { plots = plots.filter(p => p !== plot); if (plots.length === 0) plots = [makeDefaultPlot()]; renderPlots(); });
  actions.appendChild(rmBtn);

  const onDimChange = () => { rerender(); persistPlotsDebounced(); };

  // The controls and the chart, in two halves. Stacked they read as one column,
  // exactly as before; side by side the halves become two, with a divider that
  // drags -- which is the only way to change a grouping and watch what it does
  // to the chart rather than scrolling between the two.
  const body = html('div', 'plot-body', container);
  const controls = html('div', 'plot-controls', body);
  const splitter = html('div', 'plot-splitter', body);
  splitter.setAttribute('data-plot', String(plot.id));
  splitter.title = 'Drag to give the chart more room';
  attachSplitter(splitter);
  const renderCol = html('div', 'plot-render-col', body);

  // "Data shown" — Metric gets its own prominent, full-width picker: tell the
  // plot what data it's showing before configuring how everything else groups.
  const plan = computeAxisPlan(plot);
  const dataShownBlock = html('div', 'config-block data-shown-block', controls);
  const shownBody = blockBody(dataShownBlock, plot, 'shown', 'Data shown');
  if (shownBody) {
    const dataShownHead = html('div', 'dim-label', shownBody);
    dataShownHead.textContent = 'Data shown';
    const roleNote = html('span', 'role-badge', dataShownHead);
    roleNote.style.marginLeft = '8px';
    roleNote.textContent = plan.metricActive ? 'Grouping dimension' : 'Filter';
    const roleHint = html('span', 'zone-hint', dataShownHead);
    roleHint.style.marginLeft = '8px';
    roleHint.textContent = plan.metricActive
      ? '2+ metrics selected — "Metric" is now a chip in Grouping below; drop it in Panels to combine different scales (e.g. a percentage and a raw count).'
      : 'Select a 2nd metric to compare two metrics inside one chart.';
    renderDimIncludedBlock(shownBody, plot, 'metric', onDimChange);
  }

  // Grouping gets its own full-width block: any number of dims can sit on the
  // X-axis together, so several dimensions compare inside one chart.
  const groupingBlock = html('div', 'config-block', controls);
  groupingBlock.style.marginBottom = '14px';
  const groupingBody = blockBody(groupingBlock, plot, 'grouping',
    'Grouping — drag dimensions between zones');
  if (groupingBody) renderZonesUI(html('div', null, groupingBody), plot, onDimChange);

  const config = html('div', 'plot-config', controls);
  const dimsBlock = html('div', 'config-block', config);
  const dimsBody = blockBody(dimsBlock, plot, 'included', 'Data included per dimension');
  if (dimsBody) {
    const dimsGrid = html('div', 'dims-grid', dimsBody);
    GROUPABLE_KEYS.forEach(dimKey => renderDimIncludedBlock(dimsGrid, plot, dimKey, onDimChange));
  }

  const toolbar = html('div', 'toolbar', renderCol);
  const tblBtn = document.createElement('button'); tblBtn.type = 'button'; tblBtn.className = 'table-toggle'; tblBtn.textContent = 'Show as table';
  toolbar.appendChild(tblBtn);

  const renderArea = html('div', 'plot-render', renderCol);
  renderArea.id = 'plot-render-' + plot.id;
  plot.__drawnSeries = [];
  renderPlotChart(plot, renderArea);
  // after the chart, because the per-series rows list what was actually drawn --
  // and because style is the last thing you reach for, not the first. Side by
  // side it joins the other controls instead, where the chart is already in
  // view beside it.
  renderStyleBlock(sideBySide() ? controls : renderCol, plot, rerender);

  const tableWrap = html('div', 'table-wrap hidden', renderCol);
  tblBtn.addEventListener('click', () => {
    const showing = !tableWrap.classList.contains('hidden');
    tableWrap.classList.toggle('hidden');
    tblBtn.textContent = showing ? 'Show as table' : 'Hide table';
    if (!showing) renderPlotTable(plot, tableWrap);
  });
}

function renderPlots() {
  const container = document.getElementById('plots');
  if (!container) return;
  container.innerHTML = '';
  container.classList.toggle('side-by-side', sideBySide());
  container.classList.toggle('row-layout', rowLayout());
  applyConfigWidth();
  plots.forEach(plot => {
    const card = html('div', 'plot-card', container);
    card.id = 'plot-card-' + plot.id;
    renderPlotCard(plot);
  });
  persistPlotsDebounced();
}


// ---- style ------------------------------------------------------------------
// Collapsed by default: this is the last thing you touch, after the chart says
// the right thing, and it should not sit between you and the grouping controls.
const styleOpen = {};
function renderStyleBlock(container, plot, rerender) {
  return withPlotSchema(plot, () => drawStyleBlock(container, plot, rerender));
}
function drawStyleBlock(container, plot, rerender) {
  if (isGridType(plot.chartType)) return;
  const style = plot.style || (plot.style = defaultPlotStyle());
  const block = html('div', 'config-block style-block', container);
  const head = html('button', 'style-toggle', block);
  head.type = 'button';
  head.setAttribute('data-plot', String(plot.id));
  head.textContent = (styleOpen[plot.id] ? '▾' : '▸') + '  Style — colours, shapes, textures';
  head.addEventListener('click', () => { styleOpen[plot.id] = !styleOpen[plot.id]; rerender(); });
  if (!styleOpen[plot.id]) return;

  // A bar chart draws lines too, once the second axis is on -- its right-hand
  // series are always lines. Hiding the line and marker settings behind the
  // chart type meant the only way to reach them was to switch to a line chart,
  // change them, and switch back.
  const drawsLines = plot.chartType === 'lines' || computeAxisPlan(plot).dualAxis;
  const drawsBars = plot.chartType === 'bars' || plot.chartType === 'diverging';
  // A correlation plot is marks and nothing else, so it wants the point
  // settings and the per-series shape picker, and none of the line or bar ones.
  const drawsDots = isCorrelation(plot.chartType);

  const body = html('div', 'style-body', block);
  const apply = () => { rerender(); persistPlotsDebounced(); };
  const row = labelText => {
    const r = html('label', 'style-row', body);
    html('span', 'style-label', r).textContent = labelText;
    return r;
  };
  const pick = (parent, opts, value, onChange, cls) => {
    const sel = document.createElement('select');
    if (cls) sel.className = cls;
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', () => { onChange(sel.value); apply(); });
    parent.appendChild(sel);
    return sel;
  };

  const r1 = row('Colours');
  pick(r1, Object.keys(PALETTES).map(k => [k, PALETTES[k].label]), style.palette,
    v => { style.palette = v; }, 'style-palette');
  html('span', 'radio-hint', r1).textContent =
    style.palette === 'grey' ? 'shapes and textures carry the distinction' : '';

  // Always offered, even with one measure shown. Hiding it until a second
  // measure arrived meant the setting existed only in states nobody was in when
  // they went looking for it -- and a control you cannot find is a control that
  // is not there.
  {
    const r1b = row('Colour by');
    const many = plot.included[MEASURE_DIM].length > 1;
    const sel = pick(r1b, [['series', 'the series'], ['metric', 'the metric']], style.colourBy,
      v => { style.colourBy = v; }, 'style-colour-by');
    sel.disabled = !many;
    html('span', 'radio-hint', r1b).textContent = !many
      ? 'one measure shown — colouring by it would paint everything the same'
      : (style.colourBy === 'metric'
        ? 'each measure keeps its colour wherever it is drawn'
        : 'colour follows whatever is in the Series zone');
  }

  if (drawsBars) {
    const r2 = row('Bars');
    pick(r2, [['rounded', 'rounded'], ['square', 'square'], ['pill', 'pill']],
      style.barCorner, v => { style.barCorner = v; }, 'style-corner');
    pick(r2, [['none', 'solid']].concat([['auto', 'a texture each']])
      .concat(BAR_PATTERNS.filter(p => p.key !== 'none').map(p => [p.key, p.label])),
      style.barPattern, v => { style.barPattern = v; }, 'style-pattern');
  }
  if (drawsBars || drawsDots) {
    const r2b = html('label', 'style-row', body);
    html('span', 'style-label', r2b).textContent = 'Labels';
    const vl = document.createElement('input');
    vl.type = 'checkbox';
    vl.className = 'style-value-labels';
    vl.checked = !!style.valueLabels;
    vl.addEventListener('change', () => { style.valueLabels = vl.checked; apply(); });
    r2b.appendChild(vl);
    html('span', 'radio-hint', r2b).textContent = drawsDots
      ? 'name each dot with the combination it stands for — readable up to a couple '
        + 'of dozen dots, noise past that'
      : 'print the number on each bar — the only way to read a bar that is a sliver '
        + 'next to a much larger one';
  }
  if (drawsDots) {
    const r2c = html('label', 'style-row', body);
    html('span', 'style-label', r2c).textContent = 'Diagonal';
    const bd = document.createElement('input');
    bd.type = 'checkbox';
    bd.className = 'style-diag-band';
    bd.checked = !!style.diagBand;
    bd.addEventListener('change', () => { style.diagBand = bd.checked; apply(); });
    r2c.appendChild(bd);
    const ck = correlationKinds(plot, effectiveKind(plot, {}).kind);
    html('span', 'radio-hint', r2c).textContent = ck.shared
      ? 'shade the ±10% band — where the two readings agree to within a tenth'
      : 'the axes are different quantities here, so there is no 45° line to band';
  }
  if (drawsLines || drawsDots) {
    const r3 = row('Points');
    pick(r3, [['auto', 'a shape each']].concat(drawsDots ? [] : [['none', 'none']])
      .concat(MARK_SHAPES.map(m => [m.key, m.label])),
      style.markers === 'none' && drawsDots ? 'auto' : style.markers,
      v => { style.markers = v; }, 'style-markers');
    const size = document.createElement('input');
    size.type = 'range'; size.min = '2'; size.max = '8'; size.step = '0.5';
    size.className = 'style-size';
    size.value = String(style.markerSize);
    size.title = 'Marker size';
    size.addEventListener('change', () => { style.markerSize = Number(size.value); apply(); });
    r3.appendChild(size);

    if (drawsLines) {
      const r4 = row('Lines');
      const lw = document.createElement('input');
      lw.type = 'range'; lw.min = '0.5'; lw.max = '5'; lw.step = '0.5';
      lw.className = 'style-linewidth';
      lw.value = String(style.lineWidth);
      lw.title = 'Line width';
      lw.addEventListener('change', () => { style.lineWidth = Number(lw.value); apply(); });
      r4.appendChild(lw);
    }
  }

  // per-series overrides, listed from what the chart actually drew
  const drawn = plot.__drawnSeries || [];
  if (drawn.length) {
    html('div', 'style-sub', body).textContent = 'Per series';
    drawn.forEach(sv => {
      const r = html('div', 'style-row style-series', body);
      html('span', 'style-label', r).textContent = sv.label;
      const ov = style.series[sv.sig] || (style.series[sv.sig] = {});
      const col = document.createElement('input');
      col.type = 'color';
      col.className = 'style-color';
      col.setAttribute('data-sig', sv.sig);
      col.value = ov.color || rgbToHexSafe(sv.color) || '#888888';
      col.addEventListener('change', () => { ov.color = col.value; apply(); });
      r.appendChild(col);
      // With two axes a chart draws both kinds of mark at once, so it offers
      // both pickers rather than guessing which side this series is on.
      if (drawsLines || drawsDots) {
        pick(r, [['', 'auto']].concat(MARK_SHAPES.map(m => [m.key, m.label])),
          ov.shape || '', v => { if (v) ov.shape = v; else delete ov.shape; }, 'style-series-shape');
      }
      if (drawsBars) {
        pick(r, [['', 'auto']].concat(BAR_PATTERNS.map(p => [p.key, p.label])),
          ov.pattern || '', v => { if (v) ov.pattern = v; else delete ov.pattern; }, 'style-series-pattern');
      }
      const clr = document.createElement('button');
      clr.type = 'button'; clr.className = 'btn small'; clr.textContent = 'auto';
      clr.title = 'Drop the overrides for this series';
      clr.addEventListener('click', () => { delete style.series[sv.sig]; apply(); });
      r.appendChild(clr);
    });
  }
}

// A colour input needs six hex digits; the app's own colours are CSS variables.
function rgbToHexSafe(paint) {
  if (typeof paint === 'string' && /^#[0-9a-f]{6}$/i.test(paint)) return paint;
  try {
    const hex = rgbToHex(resolveVar(document.body, window, paint));
    return hex ? '#' + hex : null;
  } catch (e) { return null; }
}
