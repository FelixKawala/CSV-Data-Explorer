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
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const box = (d, txt) => Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => l.textContent.indexOf(txt) !== -1);
const flip = (w, d, txt) => { const cb = box(d, txt).querySelector('input'); cb.checked = !cb.checked; cb.dispatchEvent(new w.Event('change')); };
const segs = d => Array.from(d.querySelectorAll('#plots polyline.series-line'))
  .map(p => p.getAttribute('points').trim().split(' ').length);

console.log('\n=== 1. On by default: one line per innermost group ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  // x = Device > size > Application, so each (Device, size) block gets its own line
  const cb = box(d, 'break lines per group');
  ok(!!cb, 'the checkbox is offered');
  ok(cb.querySelector('input').checked, 'and is on by default');
  const s = segs(d);
  ok(s.length === 22, 'one segment per (Device, size) block per continuous series', s.length);
  ok(s.every(n => n === 5), 'each spans exactly the 5 applications', Array.from(new Set(s)).join(','));
  ok(d.querySelectorAll('#plots .series-dot').length === 121, 'every point still has its marker');
  w.close();
}

console.log('\n=== 2. Off gives the old single run ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  flip(w, d, 'break lines per group');
  const s = segs(d);
  ok(s.length === 2 && s.every(n => n === 55), 'one continuous line per series across the whole axis', s.join(','));
  w.close();
}

console.log('\n=== 3. It follows the grouping, not a fixed dimension ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  // reorder so the innermost dimension is the size sweep
  const chip = d.querySelector('#plots .zone-chip[data-dim="app"]');
  Array.from(chip.querySelectorAll('button.mini')).find(b => b.textContent === '◀').click();
  const zone = Array.from(d.querySelectorAll('#plots .zone[data-zone="x"] .zone-chip')).map(c => c.getAttribute('data-dim'));
  ok(zone.join(',') === 'device,app,size', 'x is now Device > Application > size', zone.join(','));
  const s = segs(d);
  ok(s.every(n => n === 3 || n === 4), 'each line is now one size sweep', Array.from(new Set(s)).sort().join(','));
  ok(s.filter(n => n === 3).length > 0, 'the dev1 blocks are 3 points, having no 1024 config', s.filter(n => n === 3).length);
  w.close();
}

console.log('\n=== 4. Hidden when there is nothing to break on ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  setZone(w, d, 'device', 'facet');
  setZone(w, d, 'app', 'facet');
  ok(!box(d, 'break lines per group'), 'not offered when the x-axis has a single dimension');
  const s = segs(d);
  ok(s.length > 0 && s.every(n => n >= 3), 'and lines simply span that axis', Array.from(new Set(s)).join(','));

  const b2 = boot();
  ok(!box(b2.d, 'break lines per group'), 'not offered for a bar chart');
  b2.w.close(); w.close();
}

console.log('\n=== 5. Applies to the dual-axis chart too ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const avail = d.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  Array.from(avail.querySelectorAll('.dnd-chip')).find(c => /Count A/.test(c.textContent)).click();
  flip(w, d, 'second y-axis');
  const solid = Array.from(d.querySelectorAll('#plots polyline.series-line')).filter(p => !p.getAttribute('stroke-dasharray'));
  const dashed = Array.from(d.querySelectorAll('#plots polyline.series-line')).filter(p => p.getAttribute('stroke-dasharray'));
  const len = p => p.getAttribute('points').trim().split(' ').length;
  ok(solid.length > 2 && dashed.length > 2, 'both scales are broken into blocks', solid.length + ' solid / ' + dashed.length + ' dashed');
  ok(solid.every(p => len(p) === 5) && dashed.every(p => len(p) === 5), 'each still spans one block');
  w.close();
}

console.log('\n=== 6. Persists ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  flip(w, d, 'break lines per group');   // turn it off
  setTimeout(() => {
    const raw = w.localStorage.getItem('viz-builder-autosave-v1');
    ok(JSON.parse(raw)[0].breakLines === false, 'the choice is saved', JSON.parse(raw)[0].breakLines);
    w.close();
    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('viz-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(segs(d2).length === 2, 'and restored as one continuous line', segs(d2).join(','));

    // a save written before this option existed must default to breaking
    const old = JSON.parse(raw); delete old[0].breakLines;
    const dom3 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('viz-builder-autosave-v1', JSON.stringify(old)); },
    });
    const d3 = dom3.window.document;
    d3.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(segs(d3).length === 22, 'older saves get the new default', segs(d3).length);
    dom2.window.close(); dom3.window.close();
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
