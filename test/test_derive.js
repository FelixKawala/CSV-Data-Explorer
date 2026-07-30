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
  return { w: dom.window, d: dom.window.document };
}
const form = d => d.querySelector('.derive-form');
const sel = (d, role) => form(d).querySelector('select[data-role="' + role + '"]');
const set = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('change')); };
const preview = d => form(d).querySelector('.derive-preview').textContent;
const addBtn = d => Array.from(form(d).querySelectorAll('button')).find(b => b.textContent === 'Add measure');

console.log('\n=== 1. The form describes what it will build ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  ok(!!form(d), 'the form opens');
  ok(/^Δ Rate A/.test(preview(d)), 'with a live preview of the label', preview(d));
  set(w, sel(d, 'over'), 'device');
  ok(preview(d) === 'Δ Rate A (dev1 − dev2)', 'changing the dimension carries the rest across', preview(d));
  set(w, sel(d, 'b'), 'dev3');
  ok(preview(d) === 'Δ Rate A (dev1 − dev3)', 'and the value pickers update it', preview(d));
  const ops = form(d).querySelectorAll('select');
  set(w, ops[ops.length - 1], 'reldiff');
  ok(preview(d) === 'Δ Rate A (dev1 vs dev3)', 'as does the operation', preview(d));
  w.close();
}

console.log('\n=== 2. The measure it adds computes the right number ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  set(w, sel(d, 'over'), 'device');
  set(w, sel(d, 'a'), 'dev1');
  set(w, sel(d, 'b'), 'dev3');
  const before = w.eval('METRICS.length');
  addBtn(d).click();
  ok(w.eval('METRICS.length') === before + 1, 'one measure is added', w.eval('METRICS.length'));

  const key = w.eval('METRICS[METRICS.length - 1].key');
  const ctx = '{dataset:"setA",app:"alpha",size:"512",variant:"base"}';
  const got = w.eval('metricValueAt(Object.assign(' + ctx + ',{metric:"' + key + '"}))');
  const a = w.eval('metricValueAt(Object.assign(' + ctx + ',{device:"dev1",metric:"rateA"}))');
  const b = w.eval('metricValueAt(Object.assign(' + ctx + ',{device:"dev3",metric:"rateA"}))');
  ok(a !== null && b !== null && a !== b, 'the two operands are real and different', a + ' / ' + b);
  ok(Math.abs(got - (a - b)) < 1e-9, 'and the difference is exactly a − b', got + ' vs ' + (a - b));

  ok(w.eval('METRIC_BY_KEY["' + key + '"].format.key') === 'delta', 'a difference is formatted as a delta');
  ok(w.eval('METRIC_BY_KEY["' + key + '"].format.palette') === 'diverging', 'and coloured diverging');
  w.close();
}

console.log('\n=== 3. A relative comparison divides ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  set(w, sel(d, 'over'), 'device');
  set(w, sel(d, 'b'), 'dev3');
  const ops = form(d).querySelectorAll('select');
  set(w, ops[ops.length - 1], 'reldiff');
  addBtn(d).click();
  const key = w.eval('METRICS[METRICS.length - 1].key');
  const ctx = '{dataset:"setA",app:"beta",size:"256",variant:"tuned"}';
  const got = w.eval('metricValueAt(Object.assign(' + ctx + ',{metric:"' + key + '"}))');
  const a = w.eval('metricValueAt(Object.assign(' + ctx + ',{device:"dev1",metric:"rateA"}))');
  const b = w.eval('metricValueAt(Object.assign(' + ctx + ',{device:"dev3",metric:"rateA"}))');
  ok(Math.abs(got - ((a - b) / b) * 100) < 1e-9, 'it is (a − b) / b as a percentage',
     got + ' vs ' + ((a - b) / b) * 100);
  ok(w.eval('METRIC_BY_KEY["' + key + '"].format.key') === 'reldelta', 'formatted as a relative change');
  w.close();
}

console.log('\n=== 4. The new measure behaves like a built-in one ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  set(w, sel(d, 'over'), 'device');
  set(w, sel(d, 'b'), 'dev3');
  addBtn(d).click();
  const key = w.eval('METRICS[METRICS.length - 1].key');

  const shown = Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col'))[1];
  const chip = Array.from(shown.querySelectorAll('.dnd-chip')).find(c => /dev1/.test(c.textContent));
  ok(!!chip, 'it appears in Data shown for an existing plot', chip && chip.textContent.slice(0, 30));
  chip.click();
  const rm = Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col')[0].querySelectorAll('.dnd-chip'))
    .find(c => /Rate A\b/.test(c.textContent) && !/dev/.test(c.textContent));
  if (rm) rm.click();
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and plots', d.querySelectorAll('#plots rect.bar').length);

  // the dimension it compares over must collapse, as for any comparison measure
  ok(w.eval('measureIgnoresDim(METRIC_BY_KEY["' + key + '"], "device")'),
     'the compared dimension is marked as one it does not vary along');
  ok(!w.eval('measureIgnoresDim(METRIC_BY_KEY["' + key + '"], "variant")'),
     'but other dimensions are untouched');
  w.close();
}

console.log('\n=== 5. It refuses a comparison of a value with itself ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  set(w, sel(d, 'over'), 'device');
  set(w, sel(d, 'a'), 'dev2');
  set(w, sel(d, 'b'), 'dev2');
  const before = w.eval('METRICS.length');
  addBtn(d).click();
  ok(w.eval('METRICS.length') === before, 'nothing is added', w.eval('METRICS.length'));
  ok(/two different values/.test(d.getElementById('builder-status').textContent), 'and it says why',
     d.getElementById('builder-status').textContent);
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
