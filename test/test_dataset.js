const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot(seed) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w) { if (seed) w.localStorage.setItem('viz-builder-autosave-v1', seed); },
  });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
const zoneOf = (d, z) => Array.from(d.querySelectorAll('#plots .zone[data-zone="' + z + '"] .zone-chip')).map(c => c.getAttribute('data-dim'));
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
function dimBlock(d, label) {
  return Array.from(d.querySelectorAll('#plots .dim-block'))
    .find(b => b.querySelector('.dim-label') && b.querySelector('.dim-label').textContent.trim().indexOf(label) === 0);
}
function addSecondDataset(d) {
  dimBlock(d, 'Dataset').querySelectorAll('.dual-col')[1].querySelector('.dnd-chip button').click();
}

console.log('\n=== 1. Default look is unchanged ===');
{
  const { w, d } = boot();
  ok(zoneOf(d, 'facet').join(',') === 'dataset', 'Dataset now sits in Facets as a real chip', zoneOf(d, 'facet').join(','));
  ok(zoneOf(d, 'x').join(',') === 'device,size,app', 'X-axis unchanged');
  ok(d.querySelectorAll('#plots .facet-card').length === 0, 'one dataset selected, so no facet card appears');
  ok(d.querySelectorAll('#plots rect.bar').length === 121, 'same 121 bars as before', d.querySelectorAll('#plots rect.bar').length);
  ok(!!dimBlock(d, 'Dataset'), 'Dataset still has an included-values list');
  w.close();
}

console.log('\n=== 2. Dataset is no longer stuck as the outer facet ===');
{
  const { w, d } = boot();
  addSecondDataset(d);
  ok(d.querySelectorAll('#plots .facet-card').length === 2, 'two datasets still facet by default', d.querySelectorAll('#plots .facet-card').length);

  setZone(w, d, 'dataset', 'series');
  ok(zoneOf(d, 'series').join(',') === 'variant,dataset', 'Dataset can move to Series', zoneOf(d, 'series').join(','));
  ok(d.querySelectorAll('#plots .facet-card').length === 0, 'no more facet cards');
  const legend = Array.from(d.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend.length === 6, '3 variants x 2 datasets = 6 series', legend.join(' | '));
  ok(legend.some(l => /setA/.test(l)) && legend.some(l => /setB/.test(l)), 'both datasets named in the legend');

  setZone(w, d, 'dataset', 'x');
  ok(zoneOf(d, 'x').indexOf('dataset') !== -1, 'Dataset can move onto the X-axis', zoneOf(d, 'x').join(','));
  // appended last, so Dataset is the innermost group: its values are the tick labels
  const ticks = Array.from(d.querySelectorAll('#plots text.group-label')).map(t => t.textContent);
  ok(ticks.indexOf('setA') !== -1 && ticks.indexOf('setB') !== -1, 'datasets sit side by side as the innermost groups', ticks.slice(0, 4).join(' | '));
  ok(d.querySelectorAll('#plots rect.bar').length > 200, 'both datasets drawn in one chart', d.querySelectorAll('#plots rect.bar').length);

  // and moving it outward promotes it to a labelled band spanning everything else
  const dchip = d.querySelector('#plots .zone-chip[data-dim="dataset"]');
  const back = Array.from(dchip.querySelectorAll('button.mini')).find(b => b.textContent === '◀');
  back.click(); back.click(); back.click();
  ok(zoneOf(d, 'x').join(',') === 'dataset,device,size,app', 'Dataset moved to the outermost slot', zoneOf(d, 'x').join(','));
  const bands = Array.from(d.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands.indexOf('setA') !== -1 && bands.indexOf('setB') !== -1, 'now an outer band spanning its Devices', bands.slice(0, 4).join(' | '));

  // move it back out and the facets return
  setZone(w, d, 'dataset', 'facet');
  ok(d.querySelectorAll('#plots .facet-card').length === 2, 'and back to facets', d.querySelectorAll('#plots .facet-card').length);
  w.close();
}

console.log('\n=== 3. Dataset as a table column heading ===');
{
  const { w, d } = boot();
  addSecondDataset(d);
  setType(w, d, 'table');
  setZone(w, d, 'dataset', 'x');
  const chip = d.querySelector('#plots .zone-chip[data-dim="dataset"]');
  Array.from(chip.querySelectorAll('button.mini')).find(b => b.textContent === '◀').click();
  const head = Array.from(d.querySelectorAll('#plots .plot-table thead tr')).map(tr =>
    Array.from(tr.querySelectorAll('th')).map(th => th.textContent));
  const flat = head.reduce((a, b) => a.concat(b), []);
  ok(flat.indexOf('setA') !== -1 && flat.indexOf('setB') !== -1, 'datasets are column headings', flat.slice(0, 8).join(' '));
  const body = Array.from(d.querySelectorAll('#plots .plot-table tbody tr'))[0];
  ok(body.querySelectorAll('td').length > 100, 'both datasets share one row of values', body.querySelectorAll('td').length);
  w.close();
}

console.log('\n=== 4. Dataset values still act as a filter when you narrow them ===');
{
  const { w, d } = boot();
  addSecondDataset(d);
  setZone(w, d, 'dataset', 'x');
  const barsBoth = d.querySelectorAll('#plots rect.bar').length;
  // drop setA again
  dimBlock(d, 'Dataset').querySelectorAll('.dual-col')[0].querySelector('.dnd-chip button').click();
  const barsOne = d.querySelectorAll('#plots rect.bar').length;
  ok(barsOne < barsBoth && barsOne > 0, 'narrowing the included values still filters', barsBoth + ' -> ' + barsOne);
  const bands = Array.from(d.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands.indexOf('setA') === -1, 'the removed dataset is gone from the axis');
  w.close();
}

console.log('\n=== 5. Saves from earlier versions keep Dataset where it was ===');
{
  // a save written when Dataset was a pinned filter: zones hold only the other four
  const oldSave = JSON.stringify([{
    chartType: 'bars',
    zones: { x: ['size', 'app'], series: ['variant'], facet: ['device'] },
    metricZone: 'series',
    included: { dataset: ['setA', 'setB'], app: ['alpha'], device: ['dev3'], size: ['512'], metric: ['rateA'], variant: ['base', 'tuned'] },
  }]);
  const { w, d } = boot(oldSave);
  ok(zoneOf(d, 'facet').join(',') === 'dataset,device', 'Dataset is restored as the outermost facet', zoneOf(d, 'facet').join(','));
  ok(zoneOf(d, 'x').join(',') === 'size,app', 'the rest of the layout is untouched', zoneOf(d, 'x').join(','));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it renders');
  w.close();

  // a much older save: the flat groupOrder form
  const ancient = JSON.stringify([{
    chartType: 'bars',
    groupOrder: ['app', 'device', 'variant', 'size'],
    metricAxisRole: 'primary',
    included: { dataset: ['setA'], app: ['alpha', 'beta'], device: ['dev3'], size: ['1024', '512'], metric: ['rateA'], variant: ['base', 'tuned'] },
  }]);
  const b2 = boot(ancient);
  ok(zoneOf(b2.d, 'facet').join(',') === 'dataset,app,device', 'ancient save: Dataset joins the facets', zoneOf(b2.d, 'facet').join(','));
  ok(zoneOf(b2.d, 'series').join(',') === 'variant', 'ancient save: series preserved', zoneOf(b2.d, 'series').join(','));
  ok(zoneOf(b2.d, 'x').join(',') === 'size', 'ancient save: x preserved', zoneOf(b2.d, 'x').join(','));
  ok(b2.d.querySelectorAll('#plots rect.bar').length > 0, 'and it renders');
  b2.w.close();

  // a corrupt save must not wipe the layout
  const junk = JSON.stringify([{ chartType: 'bars', zones: { x: ['nope'], series: 'oops' }, included: {} }]);
  const b3 = boot(junk);
  const all = ['x', 'series', 'facet'].reduce((a, z) => a.concat(zoneOf(b3.d, z)), []).sort().join(',');
  ok(all === 'app,dataset,device,size,variant', 'corrupt save still yields every dimension exactly once', all);
  ok(b3.d.querySelectorAll('#plots rect.bar').length > 0, 'and renders');
  b3.w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
