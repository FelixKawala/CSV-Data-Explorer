const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/cache_explorer.html', 'utf8');

let failures = 0;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log('  FAIL: ' + msg + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else console.log('  ok: ' + msg + (extra !== undefined ? '  (' + extra + ')' : ''));
}
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { window: dom.window, doc: dom.window.document };
}
function scanAnomalies(doc) {
  const bad = [];
  doc.querySelectorAll('rect.bar, rect.cell').forEach(r => ['x', 'y', 'width', 'height'].forEach(a => {
    const v = parseFloat(r.getAttribute(a));
    if (!isFinite(v)) bad.push(a + '=' + r.getAttribute(a));
    else if ((a === 'width' || a === 'height') && v <= 0) bad.push(a + '=' + v);
  }));
  doc.querySelectorAll('text').forEach(t => { if (/NaN|undefined/.test(t.textContent)) bad.push('text=' + t.textContent); });
  return bad;
}
function dataShownCols(doc) { return doc.querySelectorAll('#plots .data-shown-block .dual-col'); }
function addMetric(doc, labelPart) {
  const avail = dataShownCols(doc)[1];
  const c = Array.from(avail.querySelectorAll('.dnd-chip')).find(x => x.textContent.indexOf(labelPart) !== -1);
  if (!c) throw new Error('metric not found: ' + labelPart);
  c.querySelector('button').click();
}
function removeMetric(doc, labelPart) {
  const shown = dataShownCols(doc)[0];
  const c = Array.from(shown.querySelectorAll('.dnd-chip')).find(x => x.textContent.indexOf(labelPart) !== -1);
  if (!c) throw new Error('shown metric not found: ' + labelPart);
  c.querySelector('button').click();
}
function setZone(win, doc, dim, zoneKey) {
  const sel = doc.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select');
  sel.value = zoneKey;
  sel.dispatchEvent(new win.Event('change'));
}

console.log('\n=== A. Access-count delta metrics exist ===');
{
  const { window, doc } = boot();
  const avail = Array.from(dataShownCols(doc)[1].querySelectorAll('.dnd-chip')).map(c => c.textContent.replace(/[+×]$/, ''));
  const accDeltas = avail.filter(t => /accesses/.test(t));
  ok(accDeltas.length === 4, 'four access-count delta metrics offered', accDeltas.join(' | '));
  ok(accDeltas.some(t => /TAPAS-i/.test(t)), 'includes TAPAS-interleaved variants');

  removeMetric(doc, 'L1 hit rate');
  addMetric(doc, 'Δ L1 accesses (TAPAS vs KbK)');
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 0, 'renders as a diverging chart', bars);
  const ticks = Array.from(doc.querySelectorAll('#plots text.axis-label')).map(t => t.textContent);
  ok(ticks.some(t => /%$/.test(t)), 'axis is a relative % change, not raw counts', ticks.slice(0, 5).join(' '));
  ok(!ticks.some(t => /pt$/.test(t)), 'no "pt" unit on the access-count delta axis');
  ok(scanAnomalies(doc).length === 0, 'no anomalies');
  window.close();
}

console.log('\n=== B. Access delta values are correct ===');
{
  const { window, doc } = boot();
  // pull the numbers straight out of the table view and check one against the raw dataset
  removeMetric(doc, 'L1 hit rate');
  addMetric(doc, 'Δ L1 accesses (TAPAS vs KbK)');
  doc.querySelector('#plots .table-toggle').click();
  const rows = Array.from(doc.querySelectorAll('#plots .data-table tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent));
  ok(rows.length > 0, 'table rows produced', rows.length);
  const DATA = JSON.parse(doc.querySelector('script[type="application/json"]').textContent);
  // columns: dataset, app, gpu, cacheline, metric, variant, value
  const r = rows.find(row => row[6] !== '—' && DATA[row[0]].combos.some(c => c.gpu === row[2] && c.threads === row[3]));
  ok(!!r, 'found a row with real data', r && r.join('/'));
  const combo = DATA[r[0]].combos.find(c => c.gpu === r[2] && c.threads === r[3]);
  const pt = DATA[r[0]].data[r[1]][combo.key].L1_access;
  const expect = ((pt.kbk - pt.base) / pt.base) * 100;
  const got = parseFloat(r[6]);
  ok(Math.abs(got - expect) < 0.05, 'first row matches (a-b)/b*100 from the raw data',
     r.slice(0, 4).join('/') + ' got ' + got + ' expect ' + expect.toFixed(1));
  window.close();
}

console.log('\n=== C. Hit rate + access count in one plot via Panels ===');
{
  const { window, doc } = boot();
  addMetric(doc, 'L1 access count');
  // incompatible scales must not dead-end: the plot falls back to panels on its own
  ok(!doc.querySelector('#plots .plot-empty'), 'no refusal message');
  const why = Array.from(doc.querySelectorAll('#plots .chart-note')).map(n => n.textContent).join(' ');
  ok(/different scales/.test(why), 'it explains the fallback', why.slice(0, 90));

  const panelZone = doc.querySelector('#plots .zone[data-zone="panel"]');
  ok(!!panelZone, 'a Panels zone is offered once Metric is active');

  setZone(window, doc, 'metric', 'panel');
  const panels = doc.querySelectorAll('#plots .metric-panel');
  ok(panels.length === 2, 'two stacked sub-charts', panels.length);
  const titles = Array.from(panels).map(p => p.querySelector('.panel-name').textContent);
  ok(titles.join(' + ') === 'L1 hit rate + L1 access count', 'each panel names its metric', titles.join(' + '));
  ok(doc.querySelectorAll('#plots .plot-empty').length === 0, 'no refusal message any more');

  // panel 1 is a % scale, panel 2 is a log count scale -> separate y axes, one x axis
  const ax = i => Array.from(panels[i].querySelectorAll('text.axis-label')).map(t => t.textContent);
  ok(ax(0).some(t => /%$/.test(t)), 'top panel keeps a % y-axis', ax(0).join(' '));
  ok(ax(1).some(t => /[KM]$/.test(t)), 'bottom panel uses the access-count scale', ax(1).join(' '));
  ok(panels[0].querySelectorAll('text.group-label').length === 0, 'x tick labels drawn once, on the bottom panel only');
  ok(panels[1].querySelectorAll('text.group-label').length > 0, 'bottom panel carries the shared x labels');
  ok(panels[0].querySelectorAll('.legend').length === 0 && panels[1].querySelectorAll('.legend').length === 1,
     'one legend for the pair');

  const w0 = panels[0].querySelector('svg').getAttribute('width');
  const w1 = panels[1].querySelector('svg').getAttribute('width');
  ok(w0 === w1, 'panels share an identical x extent so bars line up', w0 + ' vs ' + w1);
  ok(scanAnomalies(doc).length === 0, 'no anomalies', scanAnomalies(doc).slice(0, 3).join('; '));
  window.close();
}

console.log('\n=== D. Panels with three metrics incl. a delta ===');
{
  const { window, doc } = boot();
  addMetric(doc, 'L2 access count');
  addMetric(doc, 'Δ L1 (TAPAS−KbK)');
  setZone(window, doc, 'metric', 'panel');
  const panels = doc.querySelectorAll('#plots .metric-panel');
  ok(panels.length === 3, 'three stacked panels', panels.length);
  ok(panels[2].querySelectorAll('rect.bar').length > 0, 'the delta panel renders its diverging chart');
  ok(scanAnomalies(doc).length === 0, 'no anomalies with mixed panel kinds');
  window.close();
}

console.log('\n=== E. Panels survive a save/reload and work in matrix mode ===');
{
  const { window, doc } = boot();
  addMetric(doc, 'L1 access count');
  setZone(window, doc, 'metric', 'panel');
  const sel = doc.querySelector('#plots .plot-head select');
  sel.value = 'matrix';
  sel.dispatchEvent(new window.Event('change'));
  ok(doc.querySelectorAll('#plots .metric-panel').length === 2, 'panels apply to matrices too');
  ok(doc.querySelectorAll('#plots rect.cell').length > 0, 'matrix cells render in panels');
  ok(scanAnomalies(doc).length === 0, 'no matrix panel anomalies');

  setTimeout(() => {
    const raw = window.localStorage.getItem('cache-explorer-builder-autosave-v1');
    const saved = JSON.parse(raw);
    ok(saved[0].metricZone === 'panel', 'metricZone:panel persisted', saved[0].metricZone);
    window.close();

    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(w) { w.localStorage.setItem('cache-explorer-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(d2.querySelectorAll('#plots .metric-panel').length === 2, 'panels restored after reload');
    ok(d2.querySelector('#plots .zone-chip[data-dim="metric"]').getAttribute('data-zone') === 'panel',
       'Metric chip restored into the Panels zone');
    dom2.window.close();

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
