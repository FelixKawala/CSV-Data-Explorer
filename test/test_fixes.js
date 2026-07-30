const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/cache_explorer.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const addMetric = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const rmMetric = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const fills = d => Array.from(d.querySelectorAll('#plots rect.bar')).map(r => r.getAttribute('fill'));
const legend = d => Array.from(d.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
function block(d, label) {
  return Array.from(d.querySelectorAll('#plots .dim-block'))
    .find(b => b.querySelector('.dim-label') && b.querySelector('.dim-label').textContent.trim().indexOf(label) === 0);
}
const zoneChips = d => Array.from(d.querySelectorAll('#plots .zone .zone-chip')).map(c => c.getAttribute('data-dim')).sort().join(',');

console.log('\n=== 1. Deltas are coloured by series, not just by sign ===');
{
  const { w, d } = boot();
  rmMetric(d, 'L1 hit rate');
  addMetric(d, 'Δ L1 (TAPAS−KbK)');
  const single = new Set(fills(d));
  ok(single.size <= 2 && Array.from(single).every(f => /div-(pos|neg)/.test(f)),
     'one delta metric still uses the improved/regressed colours', Array.from(single).join(' '));
  ok(legend(d).some(l => /improved/.test(l)), 'and the polarity legend', legend(d).join(' | '));

  addMetric(d, 'Δ L2 (TAPAS−KbK)');
  const multi = new Set(fills(d));
  ok(!Array.from(multi).some(f => /div-(pos|neg)/.test(f)), 'two delta metrics switch to series colours', Array.from(multi).join(' '));
  ok(multi.size === 2, 'exactly two distinct colours for two metrics', multi.size);
  const lg = legend(d);
  ok(lg.some(l => /Δ L1/.test(l)) && lg.some(l => /Δ L2/.test(l)), 'legend names both delta metrics', lg.join(' | '));
  ok(lg.length === 2, 'the legend is just the two metrics; sign is read off the zero line', lg.join(' | '));
  const zero = d.querySelectorAll('#plots line.baseline');
  ok(zero.length > 0, 'a zero line is drawn for the negative values');
  const negBars = Array.from(d.querySelectorAll('#plots rect.bar'))
    .filter(r => parseFloat(r.getAttribute('y')) + parseFloat(r.getAttribute('height')) > parseFloat(zero[0].getAttribute('y1')) + 0.5);
  ok(negBars.length > 0, 'and bars hang below it', negBars.length + ' bars below zero');
  w.close();
}

console.log('\n=== 2. Mixing a percentage with an access count just works ===');
{
  const { w, d } = boot();
  addMetric(d, 'L1 access count');
  const refusal = d.querySelector('#plots .plot-empty');
  ok(!refusal, 'no refusal message', refusal && refusal.textContent.slice(0, 60));
  const panels = d.querySelectorAll('#plots .metric-panel');
  ok(panels.length === 2, 'it falls back to two stacked panels automatically', panels.length);
  const titles = Array.from(panels).map(p => p.querySelector('.panel-name').textContent);
  ok(titles.join(' + ') === 'L1 hit rate + L1 access count', 'each panel names its metric', titles.join(' + '));
  const note = Array.from(d.querySelectorAll('#plots .chart-note')).map(n => n.textContent);
  ok(note.some(t => /different scales/.test(t)), 'and explains why', note.join(' // ').slice(0, 120));
  const mchip = d.querySelector('#plots .zone-chip[data-dim="metric"]');
  ok(mchip && mchip.getAttribute('data-zone') === 'series',
     'the Metric chip stays in the zone you chose, so it remains movable', mchip && mchip.getAttribute('data-zone'));
  ok(mchip.textContent.indexOf('drawn as panels') !== -1, 'and is badged with how it is actually drawn');
  ok(d.querySelectorAll('#plots rect.bar').length > 100, 'bars actually render', d.querySelectorAll('#plots rect.bar').length);

  // removing the odd metric out restores the user's chosen zone
  rmMetric(d, 'L1 access count');
  addMetric(d, 'L2 hit rate');
  const mchip2 = d.querySelector('#plots .zone-chip[data-dim="metric"]');
  ok(mchip2.getAttribute('data-zone') === 'series', 'same-scale metrics go back to Series', mchip2.getAttribute('data-zone'));
  ok(d.querySelectorAll('#plots .metric-panel').length === 0, 'and back to a single chart');
  w.close();
}

console.log('\n=== 3. Mixed scales work from every starting zone ===');
['x', 'series', 'facet'].forEach(z => {
  const { w, d } = boot();
  setZone(w, d, 'app', 'facet'); // make sure a facet level is in play too
  addMetric(d, 'L2 hit rate');
  setZone(w, d, 'metric', z);
  addMetric(d, 'L2 access count');
  const panels = d.querySelectorAll('#plots .metric-panel').length;
  ok(panels > 0 && d.querySelectorAll('#plots .plot-empty').length === 0,
     'starting from ' + z + ': renders as panels, no refusal', panels + ' panels');
  w.close();
});

console.log('\n=== 4. Abandoned drags no longer corrupt the lists ===');
{
  const { w, d } = boot();
  const mkDT = () => ({ data: {}, setData() {}, getData() { return ''; } });
  const fire = (el, type) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = mkDT(); el.dispatchEvent(e); };
  const gpuShown = () => Array.from(block(d, 'GPU').querySelectorAll('.dual-col')[0].querySelectorAll('.dnd-chip')).map(c => c.textContent).join(' ');
  const before = gpuShown(), zonesBefore = zoneChips(d);

  // abandon a value drag, then drop a zone chip on the value list
  fire(block(d, 'GPU').querySelectorAll('.dual-col')[0].querySelector('.dnd-chip'), 'dragstart');
  fire(block(d, 'GPU').querySelectorAll('.dual-col')[0].querySelector('.dnd-chip'), 'dragend');
  const zoneChip = d.querySelector('#plots .zone[data-zone="x"] .zone-chip[data-dim="gpu"]');
  fire(zoneChip, 'dragstart');
  fire(block(d, 'GPU').querySelectorAll('.dual-col')[1].querySelector('.dual-col-body'), 'drop');
  fire(zoneChip, 'dragend');
  ok(gpuShown() === before, 'GPU values untouched by the unrelated drop', before + ' -> ' + gpuShown());
  ok(zoneChips(d) === zonesBefore, 'zones untouched', zoneChips(d));

  // abandon a dim drag, then drop a value chip on a zone
  fire(d.querySelector('#plots .zone-chip[data-dim="app"]'), 'dragstart');
  fire(d.querySelector('#plots .zone-chip[data-dim="app"]'), 'dragend');
  fire(block(d, 'GPU').querySelectorAll('.dual-col')[0].querySelector('.dnd-chip'), 'dragstart');
  fire(d.querySelector('#plots .zone[data-zone="facet"]'), 'drop');
  ok(zoneChips(d) === zonesBefore, 'a value dropped on a zone does not move a dimension', zoneChips(d));
  w.close();
}

console.log('\n=== 5. Real drags still work ===');
{
  const { w, d } = boot();
  const dt = { data: {}, setData() {}, getData() { return ''; } };
  const fire = (el, type) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = dt; el.dispatchEvent(e); };
  // dimension: X-axis -> Facets
  fire(d.querySelector('#plots .zone[data-zone="x"] .zone-chip[data-dim="gpu"]'), 'dragstart');
  fire(d.querySelector('#plots .zone[data-zone="facet"]'), 'drop');
  const facet = Array.from(d.querySelectorAll('#plots .zone[data-zone="facet"] .zone-chip')).map(c => c.getAttribute('data-dim'));
  ok(facet.join(',') === 'dataset,gpu', 'dragging a dimension between zones works', facet.join(','));
  ok(d.querySelectorAll('#plots .facet-card').length === 3, 'and the chart follows');

  // value: Shown -> Available
  const gpuBlock = block(d, 'GPU');
  const chip0 = gpuBlock.querySelectorAll('.dual-col')[0].querySelector('.dnd-chip');
  fire(chip0, 'dragstart');
  fire(gpuBlock.querySelectorAll('.dual-col')[1].querySelector('.dual-col-body'), 'drop');
  const shownNow = Array.from(block(d, 'GPU').querySelectorAll('.dual-col')[0].querySelectorAll('.dnd-chip')).map(c => c.textContent);
  ok(shownNow.length === 2, 'dragging a value out of Shown works', shownNow.join(' '));
  ok(d.querySelectorAll('#plots .facet-card').length === 2, 'and the chart follows');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
