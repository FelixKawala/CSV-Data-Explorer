const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(cond, msg, extra) {
  if (!cond) { failures++; console.log('  FAIL: ' + msg + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else console.log('  ok: ' + msg + (extra !== undefined ? '  (' + extra + ')' : ''));
}

// A sandboxed artifact iframe suppresses confirm(): it never prompts and returns false.
// Simulate exactly that, so a regression back to a modal would fail this suite.
function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(win) {
      win.confirm = () => false;
      win.alert = () => {};
    },
  });
  const w = dom.window, d = w.document;
  d.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w, d };
}
const bar = d => d.getElementById('builder-toolbar');
const btn = (d, t) => Array.from(bar(d).querySelectorAll('button')).find(b => b.textContent === t);
const nplots = d => d.querySelectorAll('.plot-card').length;
const status = d => (d.getElementById('builder-status') || {}).textContent || '';
const xzones = (d, i) => Array.from(d.querySelectorAll('.plot-card')[i].querySelectorAll('.zone[data-zone="x"] .zone-chip')).map(c => c.getAttribute('data-dim')).join(',');
function setZone(w, d, i, dim, z) {
  const sel = d.querySelectorAll('.plot-card')[i].querySelector('.zone-chip[data-dim="' + dim + '"] select');
  sel.value = z; sel.dispatchEvent(new w.Event('change'));
}
const views = w => JSON.parse(w.localStorage.getItem('viz-builder-views-v1') || '{}');

console.log('\n=== Load works with confirm() suppressed (the sandbox case) ===');
{
  const { w, d } = boot();
  setZone(w, d, 0, 'device', 'facet');
  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  ok(status(d).indexOf('Saved "A"') === 0, 'save reports what happened', status(d));

  btn(d, '+ Add plot').click();
  btn(d, '+ Add plot').click();
  ok(nplots(d) === 3, 'three plots on the page');

  btn(d, 'Load').click();
  ok(nplots(d) === 1, 'Load still replaces even though confirm() returns false', nplots(d));
  ok(xzones(d, 0) === 'size,app', 'the loaded view is the saved one', xzones(d, 0));
  ok(/replaced 3 plots/.test(status(d)), 'it says what it replaced', status(d));
  w.close();
}

console.log('\n=== Undo restores what Load replaced ===');
{
  const { w, d } = boot();
  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  btn(d, '+ Add plot').click();
  setZone(w, d, 1, 'app', 'facet');
  btn(d, '+ Add plot').click();
  const before = [xzones(d, 0), xzones(d, 1), xzones(d, 2)].join(' | ');
  ok(nplots(d) === 3, 'three plots before load');

  btn(d, 'Load').click();
  ok(nplots(d) === 1, 'replaced');
  const undo = btn(d, 'Undo');
  ok(!!undo, 'an Undo button is offered');
  undo.click();
  ok(nplots(d) === 3, 'Undo brings all three back', nplots(d));
  ok([xzones(d, 0), xzones(d, 1), xzones(d, 2)].join(' | ') === before, 'each plot restored exactly', before);
  ok(!btn(d, 'Undo'), 'Undo is one-shot and clears itself');
  w.close();
}

console.log('\n=== Overwrite updates the selected view in place ===');
{
  const { w, d } = boot();
  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  ok(views(w).A.length === 1, 'view A has 1 plot', views(w).A.length);

  const sel = d.getElementById('saved-views-select');
  ok(sel.value === 'A', 'the just-saved view is selected automatically', sel.value);

  btn(d, '+ Add plot').click();
  setZone(w, d, 1, 'variant', 'facet');
  ok(!!btn(d, 'Overwrite'), 'an Overwrite button exists');
  btn(d, 'Overwrite').click();
  ok(views(w).A.length === 2, 'view A now holds both plots', views(w).A.length);
  ok(/Overwrote "A" \(2 plots\)/.test(status(d)), 'it confirms the overwrite', status(d));
  ok(Object.keys(views(w)).length === 1, 'no duplicate view was created');

  // and the overwritten content is what actually loads back
  btn(d, '+ Add plot').click();
  btn(d, 'Load').click();
  ok(nplots(d) === 2, 'loading A brings back 2 plots', nplots(d));
  ok(views(w).A[1].zones.facet.indexOf('variant') !== -1, 'the second plot kept its facet config');
  w.close();
}

console.log('\n=== Save view onto an existing name reports as an overwrite ===');
{
  const { w, d } = boot();
  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  btn(d, '+ Add plot').click();
  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  ok(/^Overwrote "A"/.test(status(d)), 'says Overwrote, not Saved', status(d));
  ok(Object.keys(views(w)).length === 1, 'still a single view named A');
  ok(views(w).A.length === 2, 'holding the newer 2-plot state', views(w).A.length);
  w.close();
}

console.log('\n=== Guard rails ===');
{
  const { w, d } = boot();
  btn(d, 'Overwrite').click();
  ok(/No saved view selected/.test(status(d)), 'Overwrite with nothing selected explains itself', status(d));
  btn(d, 'Save view').click();
  ok(/Type a name first/.test(status(d)), 'Save with an empty name explains itself', status(d));
  ok(nplots(d) === 1, 'nothing was destroyed by either');

  bar(d).querySelector('input.name-input').value = 'A';
  btn(d, 'Save view').click();
  btn(d, 'Delete').click();
  ok(/Deleted "A"/.test(status(d)), 'delete reports', status(d));
  ok(Object.keys(views(w)).length === 0, 'view really gone');
  btn(d, 'Load').click();
  ok(nplots(d) === 1, 'Load on an empty list is a no-op, not a wipe', nplots(d));
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
