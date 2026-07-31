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
const form = d => d.querySelector('.formula-form');
const exprBox = d => d.getElementById('formula-expr');
const nameBox = d => d.getElementById('formula-name');
const preview = d => form(d).querySelector('.formula-preview').textContent;
const units = d => form(d).querySelector('.formula-units').textContent;
const addBtn = d => Array.from(form(d).querySelectorAll('button')).find(b => b.textContent === 'Add measure');
function type(w, d, text) {
  const box = exprBox(d);
  box.value = text;
  box.dispatchEvent(new w.Event('input'));
}
// evaluate an expression through the real pipeline and return its value at one tuple
function valueOf(w, expr, ctxJs, fmt) {
  return w.eval('(function(){'
    + ' const c = compileFormula(' + JSON.stringify(expr) + ', METRICS, ' + (fmt ? JSON.stringify(fmt) : 'null') + ');'
    + ' const ctx = ' + ctxJs + ';'
    + ' const get = k => { const m = METRIC_BY_KEY[k]; const cc = Object.assign({}, ctx, {metric: k});'
    + '   const v = metricValueAt(cc); return v === null ? null : v * ratioScale(m.format); };'
    + ' const raw = evalFormulaNode(c.ast, get);'
    + ' return raw === null ? null : raw * c.outScale; })()');
}
const CTX = '{dataset:"setA",app:"alpha",device:"dev2",size:"512",variant:"base"}';

console.log('\n=== 1. The expression language parses what it claims to ===');
{
  const { w } = boot();
  const ev = e => w.eval('(function(){ const c = compileFormula(' + JSON.stringify(e) + ', METRICS, null);'
    + ' return evalFormulaNode(c.ast, () => null) * c.outScale; })()');
  ok(ev('2 + 3 * 4') === 14, 'multiplication binds tighter than addition', ev('2 + 3 * 4'));
  ok(ev('(2 + 3) * 4') === 20, 'brackets override it', ev('(2 + 3) * 4'));
  ok(ev('2 ^ 3 ^ 2') === 512, 'the power operator is right-associative', ev('2 ^ 3 ^ 2'));
  ok(ev('-3 + 10') === 7, 'unary minus works', ev('-3 + 10'));
  ok(ev('10 - 2 - 3') === 5, 'subtraction is left-associative', ev('10 - 2 - 3'));
  ok(ev('max(1, 9, 4)') === 9, 'variadic max', ev('max(1, 9, 4)'));
  ok(ev('abs(0 - 7)') === 7, 'abs', ev('abs(0 - 7)'));
  ok(ev('clamp(15, 0, 10)') === 10, 'clamp', ev('clamp(15, 0, 10)'));
  ok(Math.abs(ev('sqrt(2.5e3 / 10)') - Math.sqrt(250)) < 1e-12, 'scientific notation and sqrt', ev('sqrt(2.5e3 / 10)'));
  w.close();
}

console.log('\n=== 2. A percentage literal is a proportion, whatever the units ===');
{
  const { w } = boot();
  // Rate A is stored as 0..100. `100% - rate` must therefore land on 0..100 too,
  // and be exactly the complement.
  const rate = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"rateA"}))');
  ok(rate > 1 && rate <= 100, 'the fixture stores Rate A as a percentage, not a fraction', rate);
  const miss = valueOf(w, '100% - [Rate A]', CTX);
  ok(Math.abs(miss - (100 - rate)) < 1e-9, '100% − Rate A is the complement in the same units',
     miss + ' vs ' + (100 - rate));

  // The whole point: multiplying by a count must cancel the percent.
  const count = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"countA"}))');
  const misses = valueOf(w, '(100% - [Rate A]) * [Count A]', CTX);
  const expected = (1 - rate / 100) * count;
  ok(Math.abs(misses - expected) < 1e-6, 'a rate times a count is a count, not 100x one',
     misses + ' vs ' + expected);
  ok(misses < count, 'and it is smaller than the count it came from', misses + ' < ' + count);
  ok(w.eval('compileFormula("(100% - [Rate A]) * [Count A]", METRICS, null).format.key') === 'count',
     'so it is formatted as a count');
  w.close();
}

console.log('\n=== 3. Units are inferred, not assumed ===');
{
  const { w } = boot();
  const cls = e => w.eval('compileFormula(' + JSON.stringify(e) + ', METRICS, null).cls');
  const fmt = e => w.eval('compileFormula(' + JSON.stringify(e) + ', METRICS, null).format.key');
  ok(cls('[Rate A] + [Rate B]') === 'ratio', 'rate + rate is a rate', cls('[Rate A] + [Rate B]'));
  ok(cls('[Count A] / [Count B]') === 'ratio', 'count ÷ count is a proportion', cls('[Count A] / [Count B]'));
  ok(fmt('[Count A] / [Count B]') === 'pct', 'and is shown as a percentage', fmt('[Count A] / [Count B]'));
  ok(cls('[Count A] * 2') === 'count', 'a bare number leaves the kind alone', cls('[Count A] * 2'));
  ok(cls('[Count A] - [Count B]') === 'count', 'count − count is a count', cls('[Count A] - [Count B]'));
  ok(cls('sqrt([Count A])') === 'number', 'sqrt gives a plain number', cls('sqrt([Count A])'));
  ok(cls('[Rate A] + [Count A]') === 'number', 'adding a rate to a count is a plain number',
     cls('[Rate A] + [Count A]'));
  const notes = w.eval('compileFormula("[Rate A] + [Count A]", METRICS, null).notes.join("|")');
  ok(/ratio/.test(notes) && /count/.test(notes), 'and it says so rather than pretending', notes);

  // A ratio of two counts, checked against the numbers
  const got = valueOf(w, '[Count A] / [Count B] ', CTX);
  const a = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"countA"}))');
  const b = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"countB"}))');
  ok(Math.abs(got - (a / b) * 100) < 1e-9, 'a ÷ b lands on 0–100 because it is shown as a percentage',
     got + ' vs ' + (a / b) * 100);
  // ... and on 0-1 when the user asks for a fraction instead
  const asFrac = valueOf(w, '[Count A] / [Count B]', CTX, 'fraction');
  ok(Math.abs(asFrac - a / b) < 1e-12, 'choosing "fraction" moves the decimal point, nothing else',
     asFrac + ' vs ' + a / b);
  w.close();
}

console.log('\n=== 4. Bad input is rejected with the position of the mistake ===');
{
  const { w } = boot();
  const err = e => w.eval('(function(){ try { compileFormula(' + JSON.stringify(e) + ', METRICS, null); return "no error"; }'
    + ' catch (x) { return x.message + " @" + x.pos; } })()');
  ok(/No measure called "Nope"/.test(err('[Nope] * 2')), 'an unknown name is named', err('[Nope] * 2'));
  ok(err('[Rate A] * ').indexOf('@10') !== -1, 'a dangling operator points past the end', err('[Rate A] * '));
  ok(/closing "\)"/.test(err('(1 + 2')), 'an unclosed bracket says which', err('(1 + 2'));
  ok(/Unclosed "\["/.test(err('[Rate A * 2')), 'an unclosed name bracket too', err('[Rate A * 2'));
  ok(/do not know what to do with "#"/.test(err('1 # 2')), 'a stray character is quoted back', err('1 # 2'));
  ok(/takes 1 argument/.test(err('sqrt(1, 2)')), 'wrong arity is caught', err('sqrt(1, 2)'));
  ok(/Write an expression/.test(err('   ')), 'an empty expression is not an internal error', err('   '));
  ok(err('2 2').indexOf('@2') !== -1, 'trailing junk is located', err('2 2'));
  w.close();
}

console.log('\n=== 5. A name resolves however it is written ===');
{
  const { w } = boot();
  const key = e => w.eval('compileFormula(' + JSON.stringify(e) + ', METRICS, null).refs[0]');
  ok(key('[Rate A]') === 'rateA', 'by label', key('[Rate A]'));
  ok(key('rateA') === 'rateA', 'by column key', key('rateA'));
  ok(key('[rate a]') === 'rateA', 'ignoring case and spacing', key('[rate a]'));
  ok(key('rate_a') === 'rateA', 'ignoring punctuation', key('rate_a'));
  w.close();
}

console.log('\n=== 6. Missing operands make a missing result, never a zero ===');
{
  const { w } = boot();
  // dev1 has no 1024 in the fixture, so this tuple has no row at all
  const gap = '{dataset:"setA",app:"alpha",device:"dev1",size:"1024",variant:"base"}';
  ok(w.eval('metricValueAt(Object.assign(' + gap + ',{metric:"rateA"}))') === null,
     'the fixture really does have a hole there');
  ok(valueOf(w, '(100% - [Rate A]) * [Count A]', gap) === null, 'the formula reports the hole');
  ok(valueOf(w, '[Rate A] / 0', CTX) === null, 'dividing by zero is missing, not Infinity');
  ok(valueOf(w, '[Count A] - [Count A]', CTX) === 0, 'but a genuine zero is still a zero');
  ok(valueOf(w, 'ln(0 * [Count A])', CTX) === null, 'ln(0) is missing rather than -Infinity');
  w.close();
}

console.log('\n=== 7. The form previews against real data before committing ===');
{
  const { w, d } = boot();
  d.getElementById('formula-toggle').click();
  ok(!!form(d), 'the calculator opens');
  ok(addBtn(d).disabled, 'with nothing to add yet');
  ok(/Write an expression/.test(preview(d)), 'and says what to do', preview(d));

  type(w, d, '(100% - [Rate A]) * [Count A]');
  ok(!addBtn(d).disabled, 'a valid expression enables the button');
  ok(/^At /.test(preview(d)), 'the preview names the row it evaluated at', preview(d));
  ok(/Rate A = /.test(preview(d)) && /Count A = /.test(preview(d)),
     'and shows the operands it used', preview(d));
  ok(/result: count/.test(units(d)), 'the unit reasoning is stated', units(d));

  type(w, d, '(100% - [Rate A) * 2');
  ok(addBtn(d).disabled, 'a broken expression disables it again');
  ok(/character \d+/.test(preview(d)), 'and points at the character', preview(d));
  ok(form(d).querySelector('.formula-preview').classList.contains('bad'), 'marked as an error');
  w.close();
}

console.log('\n=== 8. Clicking a measure inserts it, and two in a row do not fuse ===');
{
  const { w, d } = boot();
  d.getElementById('formula-toggle').click();
  const chips = Array.from(form(d).querySelectorAll('.formula-chip'));
  ok(chips.length === w.eval('METRICS.length'), 'every measure has a chip', chips.length);
  chips.find(c => c.textContent === 'Rate A').click();
  ok(exprBox(d).value === '[Rate A]', 'the first insert is bare', exprBox(d).value);
  chips.find(c => c.textContent === 'Count A').click();
  ok(exprBox(d).value === '[Rate A] * [Count A]', 'a second one gets an operator between them',
     exprBox(d).value);
  ok(!addBtn(d).disabled, 'so the result still parses');
  w.close();
}

console.log('\n=== 9. The added measure behaves like any other ===');
{
  const { w, d } = boot();
  d.getElementById('formula-toggle').click();
  type(w, d, '(100% - [Rate A]) * [Count A]');
  nameBox(d).value = 'Miss count';
  nameBox(d).dispatchEvent(new w.Event('input'));
  const before = w.eval('METRICS.length');
  addBtn(d).click();
  ok(w.eval('METRICS.length') === before + 1, 'it is added', w.eval('METRICS.length'));
  ok(!form(d), 'and the form closes');

  const key = w.eval('METRICS[METRICS.length - 1].key');
  ok(w.eval('METRIC_BY_KEY["' + key + '"].label') === 'Miss count', 'under the name given');
  const got = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"' + key + '"}))');
  const rate = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"rateA"}))');
  const count = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"countA"}))');
  ok(Math.abs(got - (1 - rate / 100) * count) < 1e-6, 'metricValueAt computes it like anything else',
     got + ' vs ' + (1 - rate / 100) * count);

  // it appears in Data shown, and plots
  const shown = Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col'))[1];
  const chip = Array.from(shown.querySelectorAll('.dnd-chip')).find(c => /Miss count/.test(c.textContent));
  ok(!!chip, 'it is offered in Data shown');
  chip.click();
  const rm = Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col')[0].querySelectorAll('.dnd-chip'))
    .find(c => /^Rate A/.test(c.textContent.trim()));
  if (rm) rm.click();
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
     d.querySelectorAll('#plots rect.bar').length);
  ok(w.eval('METRIC_BY_KEY["' + key + '"].format.scale') === 'log',
     'on a log axis, because it is a count');
  w.close();
}

console.log('\n=== 10. A formula over a comparison collapses the compared dimension ===');
{
  const { w, d } = boot();
  // rateA_dTuned compares variants, so it does not vary along variant. Anything
  // built on it must inherit that, or the same number is drawn once per variant.
  ok(w.eval('metricIgnoresDim("rateA_dTuned", "variant")'), 'the comparison itself ignores variant');
  d.getElementById('formula-toggle').click();
  type(w, d, 'abs([Δ Rate A (Tuned−Base)]) * 2');
  ok(!addBtn(d).disabled, 'a comparison can be referred to by its label', preview(d));
  addBtn(d).click();
  const key = w.eval('METRICS[METRICS.length - 1].key');
  ok(w.eval('metricIgnoresDim("' + key + '", "variant")'), 'and the formula inherits that');
  ok(!w.eval('metricIgnoresDim("' + key + '", "device")'), 'without claiming it for other dimensions');

  const got = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"' + key + '"}))');
  const src = w.eval('metricValueAt(Object.assign(' + CTX + ',{metric:"rateA_dTuned"}))');
  ok(Math.abs(got - Math.abs(src) * 2) < 1e-9, 'and computes from it', got + ' vs ' + Math.abs(src) * 2);
  w.close();
}

console.log('\n=== 12. A measure defined here can be taken back, unless it is in use ===');
{
  const { w, d } = boot();
  const defined = () => Array.from((form(d) || d).querySelectorAll('.formula-defined')).map(c => c.textContent);
  d.getElementById('formula-toggle').click();
  ok(defined().length === 0, 'the fixture\'s own comparison measures are not listed as ours',
     JSON.stringify(defined()));

  type(w, d, '[Count A] * 2');
  nameBox(d).value = 'Doubled';
  nameBox(d).dispatchEvent(new w.Event('input'));
  addBtn(d).click();
  d.getElementById('formula-toggle').click();
  ok(defined().join('') === 'Doubled×', 'what we added is listed', JSON.stringify(defined()));

  // build something on top of it, then try to remove the thing underneath
  type(w, d, '[Doubled] + 1');
  nameBox(d).value = 'On top';
  nameBox(d).dispatchEvent(new w.Event('input'));
  addBtn(d).click();
  d.getElementById('formula-toggle').click();
  const x = Array.from(form(d).querySelectorAll('.formula-defined'))
    .find(c => /^Doubled/.test(c.textContent)).querySelector('button');
  const n = w.eval('METRICS.length');
  x.click();
  ok(w.eval('METRICS.length') === n, 'removing one that another is built on does nothing',
     w.eval('METRICS.length'));
  ok(/On top/.test(d.getElementById('builder-status').textContent), 'and names the dependant',
     d.getElementById('builder-status').textContent);

  // remove the dependant first, then the base
  const y = Array.from(form(d).querySelectorAll('.formula-defined'))
    .find(c => /^On top/.test(c.textContent)).querySelector('button');
  y.click();
  const z = Array.from(form(d).querySelectorAll('.formula-defined'))
    .find(c => /^Doubled/.test(c.textContent)).querySelector('button');
  z.click();
  ok(w.eval('METRICS.length') === n - 2, 'in dependency order both come out', w.eval('METRICS.length'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the page still draws',
     d.querySelectorAll('#plots rect.bar').length);
  w.close();
}

console.log('\n=== 11. A calculated measure survives a reload ===');
(async function () {
  const { w } = boot();
  const CSV = 'app,rate,count\nx,25,400\ny,50,800\n';
  // Drive the store directly: a page with data embedded in it has no record to
  // update, so this exercises the imported-dataset path persistence is for.
  const rec = '{ id: "ds-1", name: "t", createdAt: 1,'
    + ' sources: [{ filename: "a.csv", text: ' + JSON.stringify(CSV) + ' }],'
    + ' recipe: { columns: ['
    + '   { source: "app", name: "app", label: "App", role: "dimension" },'
    + '   { source: "rate", name: "rate", label: "Rate", role: "measure", format: "pct" },'
    + '   { source: "count", name: "count", label: "Count", role: "measure", format: "count" } ] } }';

  await w.eval('(function(){ setStore(makeMemoryStore());'
    + ' const rec = ' + rec + ';'
    + ' return STORE.put(rec).then(() => { localStorage.setItem("viz-active-dataset", "ds-1");'
    + '   startWithDataset(datasetFromRecord(rec)); }); })()');

  const wrote = await w.eval('(function(){'
    + ' const c = compileFormula("(100% - [Rate]) * [Count]", METRICS, null);'
    + ' addCustomMeasure({ key: "fx", label: "Misses", format: c.format, formula: c });'
    + ' return persistCustomMeasures(); })()');
  ok(wrote === true, 'the measure is written back to the dataset record');

  const specs = JSON.parse(await w.eval(
    'STORE.get("ds-1").then(r => JSON.stringify(r.recipe.custom))'));
  ok(specs.length === 1 && specs[0].formula.expr === '(100% - [Rate]) * [Count]',
     'as the text that was typed, not a compiled blob', JSON.stringify(specs));
  ok(specs[0].format === 'count', 'with the format it was shown in', specs[0].format);

  // rebuild from the record, as a reload would
  const back = JSON.parse(await w.eval('STORE.get("ds-1").then(r => {'
    + ' const ds2 = datasetFromRecord(r);'
    + ' const m = ds2.measureByKey["fx"];'
    + ' return JSON.stringify({ has: !!m, label: m && m.label,'
    + '   v: m ? datasetValueAt(ds2, { app: "x", metric: "fx" }) : null }); })'));
  ok(back.has, 'rebuilding the dataset brings it back');
  ok(back.label === 'Misses', 'with its name', back.label);
  ok(Math.abs(back.v - 300) < 1e-9, 'and it still computes: (100% - 25%) x 400 = 300', back.v);

  // a formula naming a column that is no longer imported is dropped, not fatal
  const dropped = JSON.parse(await w.eval('STORE.get("ds-1").then(r => {'
    + ' const r2 = JSON.parse(JSON.stringify(r));'
    + ' r2.recipe.columns = r2.recipe.columns.filter(c => c.name !== "count");'
    + ' const ds3 = datasetFromRecord(r2);'
    + ' return JSON.stringify({ has: !!ds3.measureByKey["fx"], n: ds3.measures.length }); })'));
  ok(!dropped.has, 'a formula whose column is gone is dropped rather than throwing');
  ok(dropped.n === 1, 'and the rest of the dataset still loads', dropped.n);

  w.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
