const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

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
  // with data embedded the page boots straight into the Builder, so it starts wide
  ok(root.classList.contains('wide'), 'a page with data boots into the Builder, widened');
  doc.querySelector('.mode-tab[data-mode="data"]').click();
  ok(!root.classList.contains('wide'), 'the Data tab is a narrow reading column');
  toBuilder(doc);
  ok(root.classList.contains('wide'), 'and the Builder widens it again');
  window.close();
}

console.log('\n=== G. Hierarchical gaps between groups ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  // x = device > size > app, so bar groups are (device, size, app) triples
  const bars = Array.from(doc.querySelectorAll('#plots rect.bar'));
  const n = 3; // Base / Tuned / Tuned-alt
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
  ok(uniq.length >= 3, 'three distinct group spacings (app / size / Device boundaries)', uniq.join(', '));
  ok(uniq[uniq.length - 1] >= uniq[0] * 1.5, 'outer-boundary gap is clearly wider than the inner one',
     'inner ' + uniq[0] + ' vs outer ' + uniq[uniq.length - 1]);

  // bands must still line up with the groups they cover
  const bandYs = Array.from(new Set(Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.getAttribute('y'))));
  ok(bandYs.length === 2, 'two band rows (Device over size)', bandYs.join(', '));
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
  addMetric(doc, 'Δ Rate B (Tuned−Base)');
  const heads = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads.indexOf('dev1') !== -1, 'Device headings present on the delta chart', heads.slice(0, 8).join(' | '));
  ok(heads.filter(h => h === '512').length >= 2, 'size headings repeat under each Device');
  const indents = Array.from(new Set(Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.getAttribute('x'))));
  ok(indents.length === 2, 'two indent levels reflect the nesting', indents.join(', '));
  const rows = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rows.every(r => r.indexOf('·') === -1), 'row labels are no longer repeated composite keys', rows[0]);

  // reordering the x zone must restructure the delta chart too
  const left = Array.from(doc.querySelectorAll('#plots .zone-chip[data-dim="app"] button.mini')).find(b => b.textContent === '◀');
  left.click(); left.click ? null : null;
  const heads2 = Array.from(doc.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(heads2.indexOf('alpha') !== -1, 'moving Application outward makes it a heading level', heads2.slice(0, 6).join(' | '));
  const rows2 = Array.from(doc.querySelectorAll('#plots text.row-label')).map(t => t.textContent);
  ok(rows2.every(r => /^\d+$/.test(r)), 'rows are now sizes', rows2.slice(0, 4).join(','));

  // Variant is meaningless for a delta metric and must not duplicate bars
  const note = doc.querySelector('#plots .chart-note');
  ok(!!note && /already compares/.test(note.textContent), 'Variant is collapsed on delta charts', note && note.textContent);
  const rowsN = doc.querySelectorAll('#plots text.row-label').length;
  const barsN = doc.querySelectorAll('#plots rect.bar').length;
  ok(barsN === rowsN, 'exactly one bar per row, not one per variant', barsN + ' bars / ' + rowsN + ' rows');

  // moving a real dim into Series does change the bars per row
  setZone(window, doc, 'device', 'series');
  const legend = Array.from(doc.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(['dev1', 'dev2', 'dev3'].every(g => legend.indexOf(g) !== -1), 'each series is named in the legend', legend.join(' | '));
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
  addMetric(doc, 'Count A');
  setZone(window, doc, 'metric', 'panel');
  const panels = doc.querySelectorAll('#plots .metric-panel');
  const svgs = Array.from(panels).map(p => p.querySelector('svg'));
  ok(svgs[0].getAttribute('width') === svgs[1].getAttribute('width'),
     'panels share an identical x extent', svgs.map(s => s.getAttribute('width')).join(' vs '));
  const firstBarX = i => parseFloat(panels[i].querySelector('rect.bar').getAttribute('x'));
  ok(firstBarX(0) === firstBarX(1), 'first bar sits at the same x in both panels', firstBarX(0) + ' / ' + firstBarX(1));
  window.close();
}

console.log('\n=== J. Folding a config block, and the controls beside the chart ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  const toggles = () => Array.from(doc.querySelectorAll('#plots .block-toggle'));
  ok(toggles().map(t => t.getAttribute('data-block')).join(',') === 'shown,grouping,included',
     'every config block has a heading that folds it',
     toggles().map(t => t.getAttribute('data-block')).join(','));
  ok(toggles().every(t => /^▾/.test(t.textContent)),
     'all open to begin with — a control that starts hidden is a control nobody finds');
  const chips = () => doc.querySelectorAll('#plots .zone-chip').length;
  const before = chips();
  ok(before > 0, 'the grouping zones are there', before);

  const grouping = () => toggles().find(t => t.getAttribute('data-block') === 'grouping');
  grouping().click();
  ok(chips() === 0, 'folding one takes its body away rather than hiding it', chips());
  ok(/^▸/.test(grouping().textContent), 'and the heading says which way it is',
     grouping().textContent.trim());
  ok(doc.querySelectorAll('#plots rect.bar').length > 0,
     'the chart is untouched by it', doc.querySelectorAll('#plots rect.bar').length);
  grouping().click();
  ok(chips() === before, 'unfolding brings it back as it was', chips());
  window.close();
}

{
  const { window, doc } = boot();
  toBuilder(doc);
  const btn = () => doc.querySelector('.side-by-side-toggle');
  ok(!!btn() && btn().getAttribute('aria-pressed') === 'false',
     'the builder starts with the controls above the chart');
  ok(!doc.getElementById('plots').classList.contains('side-by-side'), 'and says so in the markup');
  const barsBefore = doc.querySelectorAll('#plots rect.bar').length;

  btn().click();
  ok(doc.getElementById('plots').classList.contains('side-by-side'),
     'one switch puts them beside it');
  ok(btn().getAttribute('aria-pressed') === 'true', 'and the button says which state it is in');
  ok(doc.querySelectorAll('#plots .plot-splitter').length === 1,
     'with a divider between the two halves');
  ok(!!doc.querySelector('#plots .plot-controls .config-block'),
     'the controls are in the left half');
  ok(!!doc.querySelector('#plots .plot-render-col .plot-render'),
     'and the chart in the right');
  ok(!!doc.querySelector('#plots .plot-controls .style-block'),
     'Style joins the other controls there, since the chart is already in view beside it');
  ok(doc.querySelectorAll('#plots rect.bar').length === barsBefore,
     'the same chart is drawn either way',
     doc.querySelectorAll('#plots rect.bar').length + '/' + barsBefore);
  ok(window.localStorage.getItem('viz-side-by-side') === '1',
     'the choice is remembered — it is about the screen, not about a plot');

  // dragging the divider sets one width for every card
  const splitter = doc.querySelector('#plots .plot-splitter');
  splitter.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 400, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 500, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  const stored = Number(window.localStorage.getItem('viz-config-width'));
  ok(stored >= 220 && stored <= 900, 'dragging it stores a width inside the bounds', stored);
  ok(doc.getElementById('plots').style.getPropertyValue('--config-w') === stored + 'px',
     'and applies it to the column', doc.getElementById('plots').style.getPropertyValue('--config-w'));

  btn().click();
  ok(!doc.getElementById('plots').classList.contains('side-by-side'), 'and it switches back');
  ok(!!doc.querySelector('#plots .plot-render-col .style-block'),
     'with Style back under the chart where it was');
  window.close();
}

console.log('\n=== H. Plots side by side in a row ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  const plotsEl = doc.getElementById('plots');
  const btn = () => doc.querySelector('#builder-toolbar .row-layout-toggle');
  ok(!!btn(), 'the toolbar offers "Plots in a row"');
  ok(btn().textContent === 'Plots in a row' && !plotsEl.classList.contains('row-layout'),
     'stacked by default', btn().textContent);
  btn().click();
  ok(plotsEl.classList.contains('row-layout'), 'the container asks for the row layout');
  ok(btn().textContent === 'Plots stacked', 'and the button says how to undo it', btn().textContent);
  ok(window.localStorage.getItem('viz-row-layout') === '1',
     'the choice is remembered, like the controls-beside one');
  ok(doc.querySelectorAll('#plots .plot-card').length > 0, 'the cards are still there');

  // a fresh page with the preference stored comes back in the row layout
  const back = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(win) { win.localStorage.setItem('viz-row-layout', '1'); },
  });
  back.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  ok(back.window.document.getElementById('plots').classList.contains('row-layout'),
     'a reload lands in the row layout');
  back.window.close();

  btn().click();
  ok(!plotsEl.classList.contains('row-layout') && btn().textContent === 'Plots in a row',
     'and it switches back to stacked');
  window.close();
}

console.log('\n=== I. Facets in a row ===');
{
  const { window, doc } = boot();
  toBuilder(doc);
  setZone(window, doc, 'app', 'facet');
  const before = doc.querySelectorAll('#plots .facet-card').length;
  ok(before > 2, 'several facet cards', before);
  ok(!doc.querySelector('#plots .facet-grid'), 'stacked one below the other by default');
  const toggle = () => Array.from(doc.querySelectorAll('#plots .plot-head label.head-toggle'))
    .find(l => /facets in a row/.test(l.textContent));
  ok(!!toggle(), 'the plot head offers "facets in a row"');
  toggle().querySelector('input').click();
  const grid = doc.querySelector('#plots .facet-grid');
  ok(!!grid, 'the cards are wrapped in a row grid');
  ok(grid.querySelectorAll('.facet-card').length === before,
     'and every card is in it', grid.querySelectorAll('.facet-card').length + '/' + before);
  ok(window.eval('plots[0].facetsInRow') === true, 'the plot remembers it');
  ok(/facetsInRow":true/.test(window.eval('JSON.stringify(serializePlots())')),
     'and it is part of the saved view');
  toggle().querySelector('input').click();
  ok(!doc.querySelector('#plots .facet-grid'), 'and un-toggling stacks them again');
  window.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
