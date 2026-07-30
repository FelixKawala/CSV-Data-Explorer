// the flat table dump
// ---- plot table ----
function renderPlotTable(plot, wrap) {
  for (let i = 0; i < DIM_KEYS.length; i++) {
    if (plot.included[DIM_KEYS[i]].length === 0) {
      wrap.innerHTML = '<div class="plot-empty">Some dimensions have nothing included — nothing to tabulate.</div>';
      return;
    }
  }
  let rows = [{}];
  DIM_KEYS.forEach(dimKey => {
    const next = [];
    rows.forEach(r => {
      plot.included[dimKey].forEach(v => { const r2 = Object.assign({}, r); r2[dimKey] = v; next.push(r2); });
    });
    rows = next;
  });
  const MAX_ROWS = 500;
  const truncated = rows.length > MAX_ROWS;
  const shown = rows.slice(0, MAX_ROWS);

  let out = '<table class="data-table"><thead><tr>' + DIM_KEYS.map(k => `<th>${DIM_BY_KEY[k].label}</th>`).join('') + '<th>Value</th></tr></thead><tbody>';
  shown.forEach(r => {
    const val = metricValueAt(r);
    out += '<tr>' + DIM_KEYS.map(k => `<td>${dimValueLabel(k, r[k])}</td>`).join('') + `<td>${formatByKind(METRIC_BY_KEY[r.metric].kind, val)}</td></tr>`;
  });
  out += '</tbody></table>';
  if (truncated) out += `<div class="plot-empty">Showing first ${MAX_ROWS} of ${rows.length} rows.</div>`;
  wrap.innerHTML = out;
}
