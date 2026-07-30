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
  return { window: dom.window, doc: dom.window.document };
}
function toBuilder(doc) { doc.querySelector('.mode-tab[data-mode="builder"]').click(); }
function addMetric(doc, part) {
  const avail = doc.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  Array.from(avail.querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(part) !== -1).querySelector('button').click();
}
function setZone(win, doc, dim, z) {
  const sel = doc.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select');
  sel.value = z; sel.dispatchEvent(new win.Event('change'));
}

console.log('\n=== F. Wide layout in Builder mode ===');
{
  const { window, doc } = boot();
  const root = doc.querySelector('.viz-root');
  ok(!root.classList.contains('wide'), 'Simple mode keeps the narrow reading column');
  toBuilder(doc);
  ok(root.classList.contains('wide'), 'Builder mode widens the page to the window');
  doc.querySelector('.mode-tab[data-mode="simple"]').click();
  ok(!root.classList.contains('wide'), 'switching back restores the narrow column');
  window.close();
}

console.log('\n=== G. Hierarchical gaps between groups ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  // x = gpu > cacheline > app, so bar groups are (gpu, cacheline, app) triples
  const bars = Array.from(doc.querySelectorAll('#plots rect.bar'));
  const n = 3; // KbK / TAPAS / TAPAS-i
  // group start x per group = x of its first bar; derive gaps between consecutive groups
  const groupXs = [];
  const seen = {};
  bars.forEach(b => {
    const x = parseFloat(b.getAttribute('x'));
    const w = parseFloat(b.getAttribute('width'));
    const key = Math.round(x / (w + 2));
    if (!seen[key]) { seen[key] = 1; }
  });
  // simpler: read the tick label positions, one per group
  const ticks = Array.from(doc.querySelectorAll('#plots text.group-label')).map(t => parseFloat(t.getAttribute('x')));
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) gaps.push(Math.round(ticks[i] - ticks[i - 1]));
  const uniq = Array.from(new Set(gaps)).sort((a, b) => a - b);
  ok(uniq.length >= 3, 'three distinct group spacings (app / cache-line / GPU boundaries)', uniq.join(', '));
  ok(uniq[uniq.length - 1] >= uniq[0] * 1.5, 'outer-boundary gap is clearly wider than the inner one',
     'inner ' + uniq[0] + ' vs outer ' + uniq[uniq.length - 1]);

  // bands must still line up with the groups they cover
  const bandYs = Array.from(new Set(Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.getAttribute('y'))));
  ok(bandYs.length === 2, 'two band rows (GPU over cache-line)', bandYs.join(', '));
  window.close();
}

console.log('\n=== H. Grouping applies to delta metrics ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  const typeSel = doc.querySelector('#plots .plot-head select');
  typeSel.value = 'diverging';
  typeSel.dispatchEvent(new window.Event('change'));
  const shown = doc.querySelectorAll('#plots .data-shown-block .dual-col')[0];
  shown.querySelector('.dnd-chip button').click();
  addMetric(doc, 'Δ L2 (TAPAS−KbK)');
  const heads = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads.indexOf('2080') !== -1, 'GPU headings present on the delta chart', heads.slice(0, 8).join(' | '));
  ok(heads.filter(h => h === '512').length >= 2, 'cache-line headings repeat under each GPU');
  const indents = Array.from(new Set(Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.getAttribute('x'))));
  ok(indents.length === 2, 'two indent levels reflect the nesting', indents.join(', '));
  const rows = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rows.every(r => r.indexOf('·') === -1), 'row labels are no longer repeated composite keys', rows[0]);

  // reordering the x zone must restructure the delta chart too
  const left = Array.from(doc.querySelectorAll('#plots .zone-chip[data-dim="app"] button.mini')).find(b => b.textContent === '◀');
  left.click(); left.click ? null : null;
  const heads2 = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads2.indexOf('HarrisCorner') !== -1, 'moving Application outward makes it a heading level', heads2.slice(0, 6).join(' | '));
  const rows2 = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rows2.every(r => /^\d+$/.test(r)), 'rows are now cache-line counts', rows2.slice(0, 4).join(','));

  // Variant is meaningless for a delta metric and must not duplicate bars
  const note = doc.querySelector('#plots .chart-note');
  ok(!!note && /already compares/.test(note.textContent), 'Variant is collapsed on delta charts', note && note.textContent);
  const rowsN = doc.querySelectorAll('#plots text.row-label').length;
  const barsN = doc.querySelectorAll('#plots rect.bar').length;
  ok(barsN === rowsN, 'exactly one bar per row, not one per variant', barsN + ' bars / ' + rowsN + ' rows');

  // moving a real dim into Series does change the bars per row
  setZone(window, doc, 'gpu', 'series');
  const legend = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(['2080', '4070', '5090'].every(g => legend.indexOf(g) !== -1), 'each series is named in the legend', legend.join(' | '));
  ok(legend.some(l => /right of zero improved/.test(l)), 'and the sign is still explained', legend.join(' | '));
  const dfills = new Set(Array.from(doc.querySelectorAll('#plots rect.bar')).map(r => r.getAttribute('fill')));
  ok(dfills.size === 3 && !Array.from(dfills).some(f => /div-(pos|neg)/.test(f)),
     'delta bars are coloured per series, not by sign', Array.from(dfills).join(' '));
  ok(doc.querySelectorAll('#plots rect.bar').length > 0, 'still renders');
  window.close();
}

console.log('\n=== I. Panels line up after the margin fix ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  addMetric(doc, 'L1 access count');
  setZone(window, doc, 'metric', 'panel');
  const panels = doc.querySelectorAll('#plots .metric-panel');
  const svgs = Array.from(panels).map(p => p.querySelector('svg'));
  ok(svgs[0].getAttribute('width') === svgs[1].getAttribute('width'),
     'panels share an identical x extent', svgs.map(s => s.getAttribute('width')).join(' vs '));
  const firstBarX = i => parseFloat(panels[i].querySelector('rect.bar').getAttribute('x'));
  ok(firstBarX(0) === firstBarX(1), 'first bar sits at the same x in both panels', firstBarX(0) + ' / ' + firstBarX(1));
  window.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
