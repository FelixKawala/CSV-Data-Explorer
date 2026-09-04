// the flat table dump
// ---- plot table ----
function renderPlotTable(plot, wrap) {
  return withPlotSchema(plot, () => drawPlotTable(plot, wrap));
}
function drawPlotTable(plot, wrap) {
  assertPlotSchema(plot, 'renderPlotTable');
  const ds = datasetOf(plot);
  // The dataset's own dimensions, in its own order -- that order is what the
  // columns are printed in -- but only the ones this plot has a list for, so a
  // plot that predates a dimension prints without it rather than throwing.
  const dimKeys = DIM_KEYS.filter(k => plot.included[k]);
  for (let i = 0; i < dimKeys.length; i++) {
    if (plot.included[dimKeys[i]].length === 0) {
      wrap.innerHTML = '<div class="plot-empty">Some dimensions have nothing included — nothing to tabulate.</div>';
      return;
    }
  }
  let rows = [{}];
  dimKeys.forEach(dimKey => {
    const next = [];
    rows.forEach(r => {
      plot.included[dimKey].forEach(v => { const r2 = Object.assign({}, r); r2[dimKey] = v; next.push(r2); });
    });
    rows = next;
  });
  const MAX_ROWS = 500;
  const truncated = rows.length > MAX_ROWS;
  const shown = rows.slice(0, MAX_ROWS);

  let out = '<table class="data-table"><thead><tr>' + dimKeys.map(k => `<th>${DIM_BY_KEY[k].label}</th>`).join('') + '<th>Value</th></tr></thead><tbody>';
  shown.forEach(r => {
    // the plot's dataset by name, for the same reason the chart reads it by name
    const val = ds ? datasetValueAt(ds, r) : null;
    out += '<tr>' + dimKeys.map(k => `<td>${dimValueLabel(k, r[k])}</td>`).join('') + `<td>${formatValue(METRIC_BY_KEY[r[MEASURE_DIM]].format, val)}</td></tr>`;
  });
  out += '</tbody></table>';
  if (truncated) out += `<div class="plot-empty">Showing first ${MAX_ROWS} of ${rows.length} rows.</div>`;
  wrap.innerHTML = out;
}
