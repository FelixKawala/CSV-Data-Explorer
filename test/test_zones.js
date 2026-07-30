const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');
let failures = 0;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log('  FAIL: ' + msg + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else console.log('  ok: ' + msg + (extra !== undefined ? '  (' + extra + ')' : ''));
}

function boot(seedLocalStorage) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'https://example.com/',
    beforeParse(window) {
      if (seedLocalStorage) seedLocalStorage(window);
    },
  });
  const { window } = dom;
  const doc = window.document;
  doc.querySelector('.mode-tab[data-mode="builder"]').click();
  return { dom, window, doc };
}

function scanAnomalies(doc) {
  const bad = [];
  doc.querySelectorAll('rect.bar, rect.cell').forEach(r => {
    ['x', 'y', 'width', 'height'].forEach(a => {
      const v = parseFloat(r.getAttribute(a));
      if (!isFinite(v)) bad.push(a + '=' + r.getAttribute(a));
      else if ((a === 'width' || a === 'height') && v <= 0) bad.push(a + '=' + v);
    });
  });
  doc.querySelectorAll('text').forEach(t => {
    const x = t.getAttribute('x'), y = t.getAttribute('y');
    if (x !== null && !isFinite(parseFloat(x))) bad.push('text x=' + x);
    if (y !== null && !isFinite(parseFloat(y))) bad.push('text y=' + y);
    if (/NaN|undefined/.test(t.textContent)) bad.push('text content=' + t.textContent);
  });
  return bad;
}

function zoneDims(doc, zoneKey) {
  const box = doc.querySelector('#plots .zone[data-zone="' + zoneKey + '"]');
  return Array.from(box.querySelectorAll('.zone-chip')).map(c => c.getAttribute('data-dim'));
}
function groupDims(doc, zoneKey) { return zoneDims(doc, zoneKey).filter(d => d !== 'metric'); }
const wait = ms => new Promise(r => setTimeout(r, ms));
function chip(doc, dim) {
  return doc.querySelector('#plots .zone-chip[data-dim="' + dim + '"]');
}
function setZone(win, doc, dim, zoneKey) {
  const sel = chip(doc, dim).querySelector('select');
  sel.value = zoneKey;
  sel.dispatchEvent(new win.Event('change'));
}

console.log('\n=== 1. Default plot: multi-dim X-axis, no facets ===');
{
  const { window, doc } = boot();
  ok(zoneDims(doc, 'x').join(',') === 'device,size,app', 'X-axis holds 3 dims nested', zoneDims(doc, 'x').join(' > '));
  ok(zoneDims(doc, 'series').join(',') === 'variant', 'Series holds Variant');
  ok(zoneDims(doc, 'facet').join(',') === 'dataset', 'Facets holds only Dataset by default', zoneDims(doc, 'facet').join(','));
  ok(doc.querySelectorAll('#plots .facet-card').length === 0, 'no facet cards rendered');
  const svgs = doc.querySelectorAll('#plots .plot-render svg');
  ok(svgs.length === 1, 'exactly ONE chart for all Device x size x app', svgs.length + ' svg');
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 100, 'bars rendered', bars);
  const bands = doc.querySelectorAll('#plots text.axis-band-label');
  ok(bands.length > 0, 'nested grouping bands drawn for outer x dims', bands.length + ' band labels');
  const bandTexts = Array.from(bands).map(b => b.textContent);
  ok(bandTexts.indexOf('dev3') !== -1 && bandTexts.indexOf('512') !== -1, 'bands include Device and size labels');
  ok(doc.querySelectorAll('#plots .svg-scroll').length === 1, 'chart is in a horizontal scroll box');
  const anom = scanAnomalies(doc);
  ok(anom.length === 0, 'no coordinate anomalies', anom.slice(0, 5).join('; '));
  window.close();
}

console.log('\n=== 2. Dead combinations pruned (dev1 has no 1024) ===');
{
  const { window, doc } = boot();
  const inner = Array.from(doc.querySelectorAll('#plots text.group-label')).map(t => t.textContent);
  ok(inner.length > 0, 'innermost tick labels present', inner.length);
  // dev1 band should span fewer groups than dev3 (3 sizes vs 4)
  const runs = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  const cldev1 = runs.filter(r => r === '1024').length;
  ok(cldev1 === 2, 'only the two Devices that have 1024-line configs show a 1024 band', cldev1);
  window.close();
}

console.log('\n=== 3. Two metrics in ONE plot ===');
{
  const { window, doc } = boot();
  ok(!chip(doc, 'metric'), 'no Metric chip while a single metric is selected');
  // add rateB from the "Available" column of the Data shown block
  const avail = Array.from(doc.querySelectorAll('#plots .data-shown-block .dual-col')).pop();
  const l2 = Array.from(avail.querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf('Rate B') !== -1);
  ok(!!l2, 'Rate B available to add');
  l2.querySelector('button').click();
  const mchip = chip(doc, 'metric');
  ok(!!mchip, 'Metric chip appears in the grouping zones');
  ok(mchip.getAttribute('data-zone') === 'series', 'Metric lands in Series by default');
  const legend = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend.length === 6, 'series = Variant x Metric = 6 entries', legend.join(' | '));
  ok(legend.some(l => l.indexOf('Rate A') !== -1) && legend.some(l => l.indexOf('Rate B') !== -1),
     'legend names both metrics');
  ok(doc.querySelectorAll('#plots .plot-render svg').length === 1, 'still a single chart');
  const anom = scanAnomalies(doc);
  ok(anom.length === 0, 'no anomalies with 2 metrics', anom.slice(0, 5).join('; '));

  // move Metric onto the X-axis instead
  setZone(window, doc, 'metric', 'x');
  ok(zoneDims(doc, 'x').join(',') === 'device,size,app,metric', 'Metric moved to X-axis (innermost)', zoneDims(doc, 'x').join(' > '));
  const legend2 = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend2.length === 3, 'series back to 3 variants', legend2.join(' | '));
  const bands2 = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands2.some(b => b === 'alpha'), 'Application is now a band since Metric is innermost');
  ok(scanAnomalies(doc).length === 0, 'no anomalies with Metric on X');
  window.close();
}

console.log('\n=== 4. Reordering within the X-axis zone ===');
{
  const { window, doc } = boot();
  const appChip = chip(doc, 'app');
  const leftBtn = Array.from(appChip.querySelectorAll('button.mini')).find(b => b.textContent === '◀');
  leftBtn.click();
  ok(zoneDims(doc, 'x').join(',') === 'device,app,size', 'Application moved outward one slot', zoneDims(doc, 'x').join(' > '));
  const bands = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands.indexOf('alpha') !== -1, 'Application is now a band level');
  const inner = Array.from(doc.querySelectorAll('#plots text.group-label')).map(t => t.textContent);
  ok(inner.every(t => /^\d+$/.test(t)), 'innermost tick labels are now sizes', inner.slice(0, 5).join(','));
  ok(scanAnomalies(doc).length === 0, 'no anomalies after reorder');
  window.close();
}

console.log('\n=== 5. Facets still work when you opt in ===');
{
  const { window, doc } = boot();
  setZone(window, doc, 'device', 'facet');
  ok(zoneDims(doc, 'facet').join(',') === 'dataset,device', 'Device moved to Facets', zoneDims(doc, 'facet').join(','));
  const cards = doc.querySelectorAll('#plots .facet-card');
  ok(cards.length === 3, 'one facet card per Device', cards.length);
  ok(doc.querySelectorAll('#plots .plot-render svg').length === 3, '3 charts');
  ok(scanAnomalies(doc).length === 0, 'no anomalies with facets');
  window.close();
}

console.log('\n=== 6. Many series: colours are generated, not refused ===');
{
  const { window, doc } = boot();
  setZone(window, doc, 'app', 'series'); // variant(3) x app(5) = 15 series
  ok(!doc.querySelector('#plots .plot-empty'), 'the chart is drawn rather than refused');
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 100, 'bars render for every series', bars);
  const fills = Array.from(new Set(Array.from(doc.querySelectorAll('#plots rect.bar')).map(r => r.getAttribute('fill'))));
  // 3 variants x 5 cases = 15, less the 4 the sparse variant has no data for
  ok(fills.length === 11, 'a distinct colour per drawn series, none reused', fills.length);
  ok(fills.filter(f => /^hsl\(/.test(f)).length === 3, 'the first eight come from the validated palette, the rest are generated',
     fills.filter(f => /^hsl\(/.test(f)).length + ' generated');
  const warn = doc.querySelector('#plots .dim-warning');
  ok(!!warn && /stop being reliably distinguishable/.test(warn.textContent),
     'but the zone UI says the colours stop being distinguishable', warn && warn.textContent.slice(0, 60));
  setZone(window, doc, 'app', 'x');
  ok(!doc.querySelector('#plots .dim-warning'), 'the note clears when the series count drops');
  window.close();
}

console.log('\n=== 7. Matrix chart type ===');
{
  const { window, doc } = boot();
  const sel = doc.querySelector('#plots .plot-head select');
  sel.value = 'matrix';
  sel.dispatchEvent(new window.Event('change'));
  const cells = doc.querySelectorAll('#plots rect.cell').length;
  ok(cells > 100, 'matrix cells rendered', cells);
  const zoneName = doc.querySelector('#plots .zone[data-zone="x"] .zone-name').textContent;
  ok(zoneName === 'Columns', 'zone re-labels itself as Columns in matrix mode', zoneName);
  ok(scanAnomalies(doc).length === 0, 'no matrix anomalies');
  window.close();
}

console.log('\n=== 8. Delta metric (diverging) with composite rows ===');
{
  const { window, doc } = boot();
  const typeSel = doc.querySelector('#plots .plot-head select');
  typeSel.value = 'diverging';
  typeSel.dispatchEvent(new window.Event('change'));
  const blocks = doc.querySelectorAll('#plots .data-shown-block .dual-col');
  const shown = blocks[0], avail = blocks[1];
  shown.querySelector('.dnd-chip button').click(); // drop Rate A
  const avail2 = doc.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  const d = Array.from(avail2.querySelectorAll('.dnd-chip')).find(c => /Δ Rate A/.test(c.textContent));
  ok(!!d, 'a delta metric is available', d && d.textContent.slice(0, 30));
  d.querySelector('button').click();
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 0, 'diverging bars rendered', bars);
  const rowLabels = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rowLabels.length > 0 && rowLabels[0].indexOf('·') === -1, 'rows carry only the innermost label', rowLabels[0]);
  const heads = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads.indexOf('dev1') !== -1 && heads.indexOf('512') !== -1, 'delta chart gets nested group headings', heads.slice(0, 6).join(' | '));
  ok(scanAnomalies(doc).length === 0, 'no diverging anomalies');
  window.close();
}

async function test9() {
  console.log('\n=== 9. Persistence round-trip (new zones format) ===');
  const { window, doc } = boot();
  setZone(window, doc, 'device', 'facet');
  setZone(window, doc, 'variant', 'x');
  await wait(600);
  const raw = window.localStorage.getItem('viz-builder-autosave-v1');
  const saved = JSON.parse(raw || 'null');
  ok(!!saved && !!saved[0].zones, 'autosave stores zones', saved && JSON.stringify(saved[0].zones));
  window.close();

  const b2 = boot(w => w.localStorage.setItem('viz-builder-autosave-v1', raw));
  ok(groupDims(b2.doc, 'facet').join(',') === 'dataset,device', 'facet zone restored after reload', groupDims(b2.doc, 'facet').join(','));
  ok(groupDims(b2.doc, 'x').indexOf('variant') !== -1, 'variant restored on X-axis', groupDims(b2.doc, 'x').join(' > '));
  ok(scanAnomalies(b2.doc).length === 0, 'restored plot renders clean');
  b2.window.close();
}

console.log('\n=== 10. Migration from the old groupOrder format ===');
{
  const old = JSON.stringify([{
    chartType: 'bars',
    groupOrder: ['app', 'device', 'variant', 'size'],
    metricAxisRole: 'secondary',
    included: {
      dataset: ['setA'], app: ['alpha', 'beta'], device: ['dev3'],
      size: ['1024', '512'], metric: ['rateA', 'rateB'], variant: ['base', 'tuned'],
    },
  }]);
  const { window, doc } = boot(w => w.localStorage.setItem('viz-builder-autosave-v1', old));
  ok(groupDims(doc, 'facet').join(',') === 'dataset,app,device', 'old leading dims became facets, Dataset kept outermost', groupDims(doc, 'facet').join(','));
  ok(groupDims(doc, 'series').join(',') === 'variant', 'old series slot preserved', groupDims(doc, 'series').join(','));
  ok(groupDims(doc, 'x').join(',') === 'size', 'old x slot preserved', groupDims(doc, 'x').join(','));
  const m = chip(doc, 'metric');
  ok(!!m && m.getAttribute('data-zone') === 'x', 'old metricAxisRole=secondary maps to Metric on X', m && m.getAttribute('data-zone'));
  ok(doc.querySelectorAll('#plots rect.bar').length > 0, 'migrated plot renders');
  ok(scanAnomalies(doc).length === 0, 'no anomalies after migration');
  window.close();
}

console.log('\n=== 11. Simple mode regression ===');
{
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  const doc = dom.window.document;
  const bars = doc.querySelectorAll('#simple-view rect.bar').length;
  ok(bars > 0, 'simple mode still renders', bars);
  ok(scanAnomalies(doc).length === 0, 'simple mode clean');
  dom.window.close();
}

test9().then(() => {
  console.log('\n=== 12. A runaway cartesian product is refused, not hung ===');
{
  const { window, doc } = boot();
  // fake a high-cardinality dimension the way a mis-marked free-text CSV column would
  const win = window;
  win.eval('DIM_BY_KEY.app.values = Array.from({length: 4000}, (_, i) => "v" + i);'
    + 'plots[0].included.app = DIM_BY_KEY.app.values.slice();'
    + 'plots[0].zones = { x: ["app", "size"], series: ["variant"], facet: ["dataset", "device"] };'
    + 'renderPlots();');
  const msg = doc.querySelector('#plots .plot-empty');
  ok(!!msg && /would draw/.test(msg.textContent), 'it refuses with a count', msg && msg.textContent.slice(0, 70));
  ok(/Application alone has 4000 values/.test(msg.textContent), 'and names the offending dimension');
  ok(doc.querySelectorAll('#plots rect.bar').length === 0, 'nothing is drawn');
  window.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
});
