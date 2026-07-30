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
  ok(zoneDims(doc, 'x').join(',') === 'gpu,cacheline,app', 'X-axis holds 3 dims nested', zoneDims(doc, 'x').join(' > '));
  ok(zoneDims(doc, 'series').join(',') === 'variant', 'Series holds Variant');
  ok(zoneDims(doc, 'facet').join(',') === 'dataset', 'Facets holds only Dataset by default', zoneDims(doc, 'facet').join(','));
  ok(doc.querySelectorAll('#plots .facet-card').length === 0, 'no facet cards rendered');
  const svgs = doc.querySelectorAll('#plots .plot-render svg');
  ok(svgs.length === 1, 'exactly ONE chart for all GPU x cacheline x app', svgs.length + ' svg');
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 100, 'bars rendered', bars);
  const bands = doc.querySelectorAll('#plots text.axis-band-label');
  ok(bands.length > 0, 'nested grouping bands drawn for outer x dims', bands.length + ' band labels');
  const bandTexts = Array.from(bands).map(b => b.textContent);
  ok(bandTexts.indexOf('5090') !== -1 && bandTexts.indexOf('512') !== -1, 'bands include GPU and cache-line labels');
  ok(doc.querySelectorAll('#plots .svg-scroll').length === 1, 'chart is in a horizontal scroll box');
  const anom = scanAnomalies(doc);
  ok(anom.length === 0, 'no coordinate anomalies', anom.slice(0, 5).join('; '));
  window.close();
}

console.log('\n=== 2. Dead combinations pruned (2080 has no 1024) ===');
{
  const { window, doc } = boot();
  const inner = Array.from(doc.querySelectorAll('#plots text.group-label')).map(t => t.textContent);
  ok(inner.length > 0, 'innermost tick labels present', inner.length);
  // 2080 band should span fewer groups than 5090 (3 cachelines vs 4)
  const runs = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  const cl2080 = runs.filter(r => r === '1024').length;
  ok(cl2080 === 2, 'only the two GPUs that have 1024-line configs show a 1024 band', cl2080);
  window.close();
}

console.log('\n=== 3. Two metrics in ONE plot ===');
{
  const { window, doc } = boot();
  ok(!chip(doc, 'metric'), 'no Metric chip while a single metric is selected');
  // add L2 from the "Available" column of the Data shown block
  const avail = Array.from(doc.querySelectorAll('#plots .data-shown-block .dual-col')).pop();
  const l2 = Array.from(avail.querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf('L2 hit rate') !== -1);
  ok(!!l2, 'L2 hit rate available to add');
  l2.querySelector('button').click();
  const mchip = chip(doc, 'metric');
  ok(!!mchip, 'Metric chip appears in the grouping zones');
  ok(mchip.getAttribute('data-zone') === 'series', 'Metric lands in Series by default');
  const legend = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend.length === 6, 'series = Variant x Metric = 6 entries', legend.join(' | '));
  ok(legend.some(l => l.indexOf('L1 hit rate') !== -1) && legend.some(l => l.indexOf('L2 hit rate') !== -1),
     'legend names both metrics');
  ok(doc.querySelectorAll('#plots .plot-render svg').length === 1, 'still a single chart');
  const anom = scanAnomalies(doc);
  ok(anom.length === 0, 'no anomalies with 2 metrics', anom.slice(0, 5).join('; '));

  // move Metric onto the X-axis instead
  setZone(window, doc, 'metric', 'x');
  ok(zoneDims(doc, 'x').join(',') === 'gpu,cacheline,app,metric', 'Metric moved to X-axis (innermost)', zoneDims(doc, 'x').join(' > '));
  const legend2 = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend2.length === 3, 'series back to 3 variants', legend2.join(' | '));
  const bands2 = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands2.some(b => b === 'HarrisCorner'), 'Application is now a band since Metric is innermost');
  ok(scanAnomalies(doc).length === 0, 'no anomalies with Metric on X');
  window.close();
}

console.log('\n=== 4. Reordering within the X-axis zone ===');
{
  const { window, doc } = boot();
  const appChip = chip(doc, 'app');
  const leftBtn = Array.from(appChip.querySelectorAll('button.mini')).find(b => b.textContent === '◀');
  leftBtn.click();
  ok(zoneDims(doc, 'x').join(',') === 'gpu,app,cacheline', 'Application moved outward one slot', zoneDims(doc, 'x').join(' > '));
  const bands = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands.indexOf('HarrisCorner') !== -1, 'Application is now a band level');
  const inner = Array.from(doc.querySelectorAll('#plots text.group-label')).map(t => t.textContent);
  ok(inner.every(t => /^\d+$/.test(t)), 'innermost tick labels are now cache-line counts', inner.slice(0, 5).join(','));
  ok(scanAnomalies(doc).length === 0, 'no anomalies after reorder');
  window.close();
}

console.log('\n=== 5. Facets still work when you opt in ===');
{
  const { window, doc } = boot();
  setZone(window, doc, 'gpu', 'facet');
  ok(zoneDims(doc, 'facet').join(',') === 'dataset,gpu', 'GPU moved to Facets', zoneDims(doc, 'facet').join(','));
  const cards = doc.querySelectorAll('#plots .facet-card');
  ok(cards.length === 3, 'one facet card per GPU', cards.length);
  ok(doc.querySelectorAll('#plots .plot-render svg').length === 3, '3 charts');
  ok(scanAnomalies(doc).length === 0, 'no anomalies with facets');
  window.close();
}

console.log('\n=== 6. Too-many-series guard ===');
{
  const { window, doc } = boot();
  setZone(window, doc, 'app', 'series'); // variant(3) x app(5) = 15 > 8
  const warn = doc.querySelector('#plots .dim-warning');
  ok(!!warn && /distinct colours/.test(warn.textContent), 'zone UI warns about the colour budget', warn && warn.textContent.slice(0, 70));
  const empty = doc.querySelector('#plots .plot-empty');
  ok(!!empty && /series colours/.test(empty.textContent), 'chart explains instead of cycling colours');
  ok(doc.querySelectorAll('#plots rect.bar').length === 0, 'no bars drawn in the blocked state');
  setZone(window, doc, 'app', 'x');
  ok(doc.querySelectorAll('#plots rect.bar').length > 100, 'recovers when App goes back to X-axis');
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
  shown.querySelector('.dnd-chip button').click(); // drop L1 hit rate
  const avail2 = doc.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  const d = Array.from(avail2.querySelectorAll('.dnd-chip')).find(c => /Δ L1/.test(c.textContent));
  ok(!!d, 'a delta metric is available', d && d.textContent.slice(0, 30));
  d.querySelector('button').click();
  const bars = doc.querySelectorAll('#plots rect.bar').length;
  ok(bars > 0, 'diverging bars rendered', bars);
  const rowLabels = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rowLabels.length > 0 && rowLabels[0].indexOf('·') === -1, 'rows carry only the innermost label', rowLabels[0]);
  const heads = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads.indexOf('2080') !== -1 && heads.indexOf('512') !== -1, 'delta chart gets nested group headings', heads.slice(0, 6).join(' | '));
  ok(scanAnomalies(doc).length === 0, 'no diverging anomalies');
  window.close();
}

async function test9() {
  console.log('\n=== 9. Persistence round-trip (new zones format) ===');
  const { window, doc } = boot();
  setZone(window, doc, 'gpu', 'facet');
  setZone(window, doc, 'variant', 'x');
  await wait(600);
  const raw = window.localStorage.getItem('cache-explorer-builder-autosave-v1');
  const saved = JSON.parse(raw || 'null');
  ok(!!saved && !!saved[0].zones, 'autosave stores zones', saved && JSON.stringify(saved[0].zones));
  window.close();

  const b2 = boot(w => w.localStorage.setItem('cache-explorer-builder-autosave-v1', raw));
  ok(groupDims(b2.doc, 'facet').join(',') === 'dataset,gpu', 'facet zone restored after reload', groupDims(b2.doc, 'facet').join(','));
  ok(groupDims(b2.doc, 'x').indexOf('variant') !== -1, 'variant restored on X-axis', groupDims(b2.doc, 'x').join(' > '));
  ok(scanAnomalies(b2.doc).length === 0, 'restored plot renders clean');
  b2.window.close();
}

console.log('\n=== 10. Migration from the old groupOrder format ===');
{
  const old = JSON.stringify([{
    chartType: 'bars',
    groupOrder: ['app', 'gpu', 'variant', 'cacheline'],
    metricAxisRole: 'secondary',
    included: {
      dataset: ['32x32'], app: ['HarrisCorner', 'Hotspot'], gpu: ['5090'],
      cacheline: ['1024', '512'], metric: ['L1', 'L2'], variant: ['base', 'kbk'],
    },
  }]);
  const { window, doc } = boot(w => w.localStorage.setItem('cache-explorer-builder-autosave-v1', old));
  ok(groupDims(doc, 'facet').join(',') === 'dataset,app,gpu', 'old leading dims became facets, Dataset kept outermost', groupDims(doc, 'facet').join(','));
  ok(groupDims(doc, 'series').join(',') === 'variant', 'old series slot preserved', groupDims(doc, 'series').join(','));
  ok(groupDims(doc, 'x').join(',') === 'cacheline', 'old x slot preserved', groupDims(doc, 'x').join(','));
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
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
});
