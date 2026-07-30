// plot card and plot list
// ---- plot card & plot list management ----
function renderPlotCard(plot) {
  const container = document.getElementById('plot-card-' + plot.id);
  if (!container) return;
  container.innerHTML = '';
  const rerender = () => renderPlotCard(plot);

  const head = html('div', 'plot-head', container);
  const title = html('div', 'plot-title', head);
  title.textContent = 'Plot ' + (plots.indexOf(plot) + 1);

  const typeSel = document.createElement('select');
  CHART_TYPES.forEach(pair => {
    const o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1];
    typeSel.appendChild(o);
  });
  typeSel.value = plot.chartType;
  typeSel.addEventListener('change', () => { plot.chartType = typeSel.value; rerender(); persistPlotsDebounced(); });
  head.appendChild(typeSel);

  const headPlan = computeAxisPlan(plot);
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
  if (plot.chartType === 'lines' && headPlan.xDims.length > 1) {
    const lab3 = html('label', 'head-toggle', head);
    const cb3 = document.createElement('input');
    cb3.type = 'checkbox'; cb3.checked = plot.breakLines !== false;
    cb3.title = 'Start a new line for each ' + headPlan.xDims.slice(0, -1).map(k => DIM_BY_KEY[k].label).join(' / ')
      + ' block, instead of one line across the whole axis.';
    cb3.addEventListener('change', () => { plot.breakLines = cb3.checked; rerender(); persistPlotsDebounced(); });
    lab3.appendChild(cb3);
    html('span', null, lab3).textContent = 'break lines per group';
  }
  if (headPlan.dualEligible) {
    const lab2 = html('label', 'head-toggle', head);
    const cb2 = document.createElement('input');
    cb2.type = 'checkbox'; cb2.checked = !!plot.dualAxis;
    cb2.title = 'Two y-scales in one frame: compact, but where the series cross means nothing.';
    cb2.addEventListener('change', () => { plot.dualAxis = cb2.checked; rerender(); persistPlotsDebounced(); });
    lab2.appendChild(cb2);
    html('span', null, lab2).textContent = 'second y-axis';
  }
  if (headPlan.metricPanels) {
    const lab = html('label', 'head-toggle', head);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!plot.repeatPanelAxis;
    cb.addEventListener('change', () => { plot.repeatPanelAxis = cb.checked; rerender(); persistPlotsDebounced(); });
    lab.appendChild(cb);
    html('span', null, lab).textContent = 'grouping on every panel';
  }

  addTikzButton(head, () => document.getElementById('plot-render-' + plot.id) || container,
    'Export TikZ', 'plot ' + (plots.indexOf(plot) + 1), 'btn small');

  const dupBtn = document.createElement('button'); dupBtn.type = 'button'; dupBtn.className = 'btn small'; dupBtn.textContent = 'Duplicate';
  dupBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); plots.splice(idx + 1, 0, clonePlot(plot)); renderPlots(); });
  head.appendChild(dupBtn);

  const upBtn = document.createElement('button'); upBtn.type = 'button'; upBtn.className = 'btn small'; upBtn.textContent = '↑';
  upBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); if (idx > 0) { plots.splice(idx, 1); plots.splice(idx - 1, 0, plot); renderPlots(); } });
  head.appendChild(upBtn);

  const downBtn = document.createElement('button'); downBtn.type = 'button'; downBtn.className = 'btn small'; downBtn.textContent = '↓';
  downBtn.addEventListener('click', () => { const idx = plots.indexOf(plot); if (idx < plots.length - 1) { plots.splice(idx, 1); plots.splice(idx + 1, 0, plot); renderPlots(); } });
  head.appendChild(downBtn);

  const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn small danger'; rmBtn.textContent = 'Remove';
  rmBtn.addEventListener('click', () => { plots = plots.filter(p => p !== plot); if (plots.length === 0) plots = [makeDefaultPlot()]; renderPlots(); });
  head.appendChild(rmBtn);

  const onDimChange = () => { rerender(); persistPlotsDebounced(); };

  // "Data shown" — Metric gets its own prominent, full-width picker: tell the
  // plot what data it's showing before configuring how everything else groups.
  const dataShownBlock = html('div', 'config-block data-shown-block', container);
  const dataShownHead = html('div', 'dim-label', dataShownBlock);
  dataShownHead.textContent = 'Data shown';
  const plan = computeAxisPlan(plot);
  const roleNote = html('span', 'role-badge', dataShownHead);
  roleNote.style.marginLeft = '8px';
  roleNote.textContent = plan.metricActive ? 'Grouping dimension' : 'Filter';
  const roleHint = html('span', 'zone-hint', dataShownHead);
  roleHint.style.marginLeft = '8px';
  roleHint.textContent = plan.metricActive
    ? '2+ metrics selected — "Metric" is now a chip in Grouping below; drop it in Panels to combine different scales (e.g. a percentage and a raw count).'
    : 'Select a 2nd metric to compare two metrics inside one chart.';
  renderDimIncludedBlock(dataShownBlock, plot, 'metric', onDimChange);

  // Grouping gets its own full-width block: any number of dims can sit on the
  // X-axis together, so several dimensions compare inside one chart.
  const groupingBlock = html('div', 'config-block', container);
  groupingBlock.style.marginBottom = '14px';
  html('h4', null, groupingBlock).textContent = 'Grouping — drag dimensions between zones';
  const zonesHost = html('div', null, groupingBlock);
  renderZonesUI(zonesHost, plot, onDimChange);

  const config = html('div', 'plot-config', container);
  const dimsBlock = html('div', 'config-block', config);
  html('h4', null, dimsBlock).textContent = 'Data included per dimension';
  const dimsGrid = html('div', 'dims-grid', dimsBlock);
  GROUPABLE_KEYS.forEach(dimKey => renderDimIncludedBlock(dimsGrid, plot, dimKey, onDimChange));

  const toolbar = html('div', 'toolbar', container);
  const tblBtn = document.createElement('button'); tblBtn.type = 'button'; tblBtn.className = 'table-toggle'; tblBtn.textContent = 'Show as table';
  toolbar.appendChild(tblBtn);

  const renderArea = html('div', 'plot-render', container);
  renderArea.id = 'plot-render-' + plot.id;
  renderPlotChart(plot, renderArea);

  const tableWrap = html('div', 'table-wrap hidden', container);
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
  plots.forEach(plot => {
    const card = html('div', 'plot-card', container);
    card.id = 'plot-card-' + plot.id;
    renderPlotCard(plot);
  });
  persistPlotsDebounced();
}
