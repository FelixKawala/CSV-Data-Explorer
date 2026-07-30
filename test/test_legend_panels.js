const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

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
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const zoneOf = (d, z) => Array.from(d.querySelectorAll('#plots .zone[data-zone="' + z + '"] .zone-chip')).map(c => c.getAttribute('data-dim'));
const chipOf = (d, dim) => d.querySelector('#plots .zone-chip[data-dim="' + dim + '"]');
const dt = { data: {}, setData() {}, getData() { return ''; } };
const fire = (w, el, t) => { const e = new w.Event(t, { bubbles: true, cancelable: true }); e.dataTransfer = dt; el.dispatchEvent(e); };

console.log('\n=== 1. Metric stays movable when scales are mixed ===');
{
  const { w, d } = boot();
  add(d, 'L1 access count');            // pct + count -> drawn as panels
  const chip = chipOf(d, 'metric');
  ok(chip.getAttribute('data-zone') === 'series', 'the chip stays in the zone you chose', chip.getAttribute('data-zone'));
  ok(chip.textContent.indexOf('drawn as panels') !== -1, 'and is badged with how it is actually drawn');
  ok(d.querySelectorAll('#plots .metric-panel').length === 2, 'the chart still renders as panels');

  setZone(w, d, 'metric', 'x');
  const chip2 = chipOf(d, 'metric');
  ok(chip2.getAttribute('data-zone') === 'x', 'moving it to the X-axis sticks', chip2.getAttribute('data-zone'));
  ok(zoneOf(d, 'x').join(',') === 'gpu,cacheline,app,metric', 'and it appears in that zone', zoneOf(d, 'x').join(','));
  ok(chip2.querySelector('select').value === 'x', 'the dropdown reflects the choice, it no longer snaps back');

  const minis = Array.from(chip2.querySelectorAll('button.mini')).map(b => b.textContent);
  ok(minis.join('') === '◀▶', 'and it regains its move buttons', minis.join('') || 'NONE');
  Array.from(chip2.querySelectorAll('button.mini')).find(b => b.textContent === '◀').click();
  ok(zoneOf(d, 'x').join(',') === 'gpu,cacheline,metric,app', 'which actually move it', zoneOf(d, 'x').join(','));
  ok(d.querySelectorAll('#plots .metric-panel').length === 2, 'still drawn as panels, since the scales still differ');

  // explicit Panels is still reachable and drops the badge
  setZone(w, d, 'metric', 'panel');
  const chip3 = chipOf(d, 'metric');
  ok(chip3.getAttribute('data-zone') === 'panel', 'Panels can be chosen explicitly');
  ok(chip3.textContent.indexOf('drawn as panels') === -1, 'no badge when it is not a fallback');
  w.close();
}

console.log('\n=== 2. Dropping a dimension onto the Metric chip takes its slot ===');
{
  const { w, d } = boot();
  add(d, 'L2 hit rate');
  setZone(w, d, 'metric', 'x');
  Array.from(chipOf(d, 'metric').querySelectorAll('button.mini')).find(b => b.textContent === '◀').click();
  ok(zoneOf(d, 'x').join(',') === 'gpu,cacheline,metric,app', 'metric parked mid-list', zoneOf(d, 'x').join(','));
  fire(w, chipOf(d, 'gpu'), 'dragstart');
  fire(w, chipOf(d, 'metric'), 'drop');
  ok(zoneOf(d, 'x').join(',') === 'cacheline,gpu,metric,app', 'GPU landed on the Metric slot, not at the end', zoneOf(d, 'x').join(','));
  w.close();
}

console.log('\n=== 3. Matrix has a colour-scale legend ===');
{
  const { w, d } = boot();
  setType(w, d, 'matrix');
  const legend = d.querySelector('#plots .scale-legend');
  ok(!!legend, 'a scale legend renders for a percentage matrix');
  ok(legend.querySelectorAll('.scale-step').length === 7, 'a swatch ramp', legend.querySelectorAll('.scale-step').length);
  const ends = Array.from(legend.querySelectorAll('.scale-end')).map(e => e.textContent);
  ok(ends.join(' → ') === '0.00% → 100.00%', 'labelled with its range', ends.join(' → '));

  rm(d, 'L1 hit rate'); add(d, 'L1 access count');
  const ends2 = Array.from(d.querySelectorAll('#plots .scale-legend .scale-end')).map(e => e.textContent);
  ok(/[KM]$/.test(ends2[1]), 'a count matrix is labelled with its max count', ends2.join(' → '));
  ok(d.querySelector('#plots .scale-legend .scale-note').textContent === 'log scale', 'and says the scale is logarithmic');

  rm(d, 'L1 access count'); add(d, 'Δ L1 (TAPAS−KbK)');
  const l3 = d.querySelector('#plots .scale-legend');
  const ends3 = Array.from(l3.querySelectorAll('.scale-end')).map(e => e.textContent);
  ok(ends3[0].indexOf('-') === 0 && ends3[1].indexOf('+') === 0, 'a delta matrix is labelled ± its range', ends3.join(' → '));
  ok(/no change/.test(l3.querySelector('.scale-note').textContent), 'and explains the midpoint');
  w.close();
}

console.log('\n=== 4. Grouping can repeat on every panel ===');
{
  const { w, d } = boot();
  add(d, 'L1 access count');
  const panels = () => d.querySelectorAll('#plots .metric-panel');
  const ticksIn = i => panels()[i].querySelectorAll('text.group-label').length;
  const bandsIn = i => panels()[i].querySelectorAll('text.axis-band-label').length;
  ok(ticksIn(0) === 0 && ticksIn(1) > 0, 'by default only the bottom panel carries the grouping', ticksIn(0) + '/' + ticksIn(1));

  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /every panel/.test(l.textContent));
  ok(!!lab, 'the toggle is offered when panels are in play');
  const cb = lab.querySelector('input');
  cb.checked = true; cb.dispatchEvent(new w.Event('change'));
  ok(ticksIn(0) > 0 && ticksIn(1) > 0, 'now every panel carries its own tick labels', ticksIn(0) + '/' + ticksIn(1));
  ok(bandsIn(0) > 0, 'and its nested grouping bands', bandsIn(0));
  ok(panels()[0].querySelectorAll('.legend').length > 0, 'each panel gets its legend too');

  // the toggle is irrelevant without panels, so it should not be shown
  const { w: w2, d: d2 } = boot();
  ok(!Array.from(d2.querySelectorAll('#plots .head-toggle')).some(l => /every panel/.test(l.textContent)),
     'hidden when there are no panels');
  w.close(); w2.close();
}

console.log('\n=== 5. Persists across a reload ===');
{
  const { w, d } = boot();
  add(d, 'L1 access count');
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /every panel/.test(l.textContent));
  const cb = lab.querySelector('input'); cb.checked = true; cb.dispatchEvent(new w.Event('change'));
  setTimeout(() => {
    const raw = w.localStorage.getItem('cache-explorer-builder-autosave-v1');
    ok(JSON.parse(raw)[0].repeatPanelAxis === true, 'the toggle is saved');
    w.close();
    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('cache-explorer-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    const p0 = d2.querySelectorAll('#plots .metric-panel')[0];
    ok(p0 && p0.querySelectorAll('text.group-label').length > 0, 'and restored after reload');
    dom2.window.close();
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
