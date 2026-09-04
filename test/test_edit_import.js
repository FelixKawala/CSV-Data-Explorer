// Editing an import after the fact.
//
// A stored dataset is its raw text plus the recipe that read it, so the review
// screen can be put back up over the same bytes with every switch where it was
// left. What is tested here is that it comes back the SAME -- a reshape that
// round-trips through the review must produce the recipe it started from -- and
// that saving edits the record rather than making a new one.
//
// The second half is the part with no undo: what a role change does to the
// plots, to a measure that was renamed from the builder, and to a calculated
// measure whose column has just stopped being a measure.

const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  w.eval('setStore(makeMemoryStore());');
  w.document.querySelector('.mode-tab[data-mode="data"]').click();
  return { w, d: w.document };
}
function pick(w, files, inputId) {
  const input = w.document.getElementById(inputId || 'csv-input');
  const list = files.map(f => {
    const file = new w.File([f.text], f.name, { type: 'text/csv' });
    if (f.path) Object.defineProperty(file, 'webkitRelativePath', { value: f.path, configurable: true });
    return file;
  });
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
}
const review = d => d.querySelector('.import-review');
const btn = (d, text) => Array.from(review(d).querySelectorAll('button'))
  .find(b => b.textContent === text);
const colRow = (d, k) => d.querySelector('.import-table tr[data-col="' + k + '"]');
const cards = d => Array.from(d.querySelectorAll('.dataset-card'));
const cardNamed = (d, n) => cards(d).find(c => (c.querySelector('.dataset-name') || {}).textContent === n);
const cardBtn = (d, name, text) => Array.from(cardNamed(d, name).querySelectorAll('button'))
  .find(b => b.textContent === text);
const status = d => d.getElementById('data-status').textContent;
const setText = (w, inp, v) => { inp.value = v; inp.dispatchEvent(new w.Event('input')); };
const setSel = (w, sel, v) => { sel.value = v; sel.dispatchEvent(new w.Event('change')); };
const setCheck = (w, cb, v) => { cb.checked = v; cb.dispatchEvent(new w.Event('change')); };
const stored = w => w.eval('STORE.list()');

async function importOne(w, d, name, text) {
  pick(w, [{ name, text }]);
  await wait(60);
  btn(d, 'Import').click();
  await wait(80);
  d.querySelector('.mode-tab[data-mode="data"]').click();
  await wait(30);
}
async function openEdit(d, name) {
  cardBtn(d, name, 'Edit import').click();
  await wait(80);
}

const TIDY = 'device,size,rate,accesses\n'
  + 'dev1,512,62.1,8100000\ndev1,256,52.5,8100000\n'
  + 'dev2,512,64.0,7300000\ndev2,256,63.3,7300000\n';

// one row per block configuration, which is two numbers written as one label
const BLOCKS = 'block-config,l1hitrate,l2hitrate\n16x4,1,25\n16x8,2,26\n32x8,3,27\n';

// the dimensions live in the column names, read by position and as a vocabulary
const WIDE = 'app,2080c512,2080c256,4070c512\nA,10,11,12\nB,20,21,22\n';
const HEADER_PARTS = 'app,avg_CPU_value,run0_CPU_value,avg_GPU_value,avg_CPU_variance\n'
  + 'A,1.0,2.0,3.0,4.0\nB,5.0,6.0,7.0,8.0\n';

(async () => {
  console.log('\n=== 1. The review comes back with the decisions it was left with ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runs.csv', text: TIDY }]);
    await wait(60);
    setText(w, colRow(d, 'rate').querySelector('input'), 'Hit rate');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'ignore');
    btn(d, 'Import').click();
    await wait(80);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);

    ok(!!cardBtn(d, 'runs', 'Edit import'), 'a stored dataset offers an edit');
    await openEdit(d, 'runs');
    ok(!!review(d), 'the review screen comes back');
    ok(/Edit the import/.test(review(d).querySelector('h4').textContent),
       'and says it is an edit, not an import', review(d).querySelector('h4').textContent);
    ok(colRow(d, 'rate').querySelector('input').value === 'Hit rate',
       'the renamed column shows the name it was given',
       colRow(d, 'rate').querySelector('input').value);
    ok(colRow(d, 'accesses').querySelectorAll('select')[0].value === 'ignore',
       'and the ignored column is still ignored',
       colRow(d, 'accesses').querySelectorAll('select')[0].value);
    ok(!!btn(d, 'Save changes') && !btn(d, 'Import'),
       'the button saves rather than imports');
    w.close();
  }

  console.log('\n=== 2. A measure can be made a dimension, and the record is the same record ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    const was = (await stored(w))[0];
    ok(w.eval('METRICS.map(m => m.key).join(",")') === 'rate,accesses',
       'both numeric columns arrive as measures', w.eval('METRICS.map(m => m.key).join(",")'));

    await openEdit(d, 'runs');
    setSel(w, colRow(d, 'size').querySelectorAll('select')[0], 'measure');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'dimension');
    await wait(60);
    btn(d, 'Save changes').click();
    await wait(120);

    const now = (await stored(w))[0];
    ok(now.id === was.id, 'the same record is edited, not a second one written');
    ok((await stored(w)).length === 1, 'so the list still holds one dataset');
    ok(now.createdAt === was.createdAt, 'and it keeps the date it was imported');
    const roles = now.recipe.columns.map(c => c.name + '=' + c.role).join(' ');
    ok(roles === 'device=dimension size=measure rate=measure accesses=dimension',
       'the stored recipe has the new roles', roles);
    ok(w.eval('DIM_KEYS.join(",")').indexOf('accesses') !== -1,
       'the open dataset groups by the column that became a dimension',
       w.eval('DIM_KEYS.join(",")'));
    // in column order, which is the order the file has them in
    ok(w.eval('METRICS.map(m => m.key).join(",")') === 'size,rate',
       'and plots the one that became a measure', w.eval('METRICS.map(m => m.key).join(",")'));
    ok(/"size" is now a measure/.test(status(d)) && /"accesses" is now a dimension/.test(status(d)),
       'the status says what moved', status(d));
    w.close();
  }

  console.log('\n=== 3. The plots survive the change rather than resetting ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    d.querySelector('.mode-tab[data-mode="builder"]').click();
    await wait(60);
    w.eval('plots[0].chartType = "lines"; plots[0].style.valueLabels = true;'
      + ' plots[0].style.palette = Object.keys(PALETTES)[1];'
      + ' plots.push(JSON.parse(JSON.stringify(plots[0]))); plots[1].id = 99; renderBuilder();');
    await wait(30);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);

    await openEdit(d, 'runs');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'dimension');
    await wait(60);
    btn(d, 'Save changes').click();
    await wait(150);

    ok(w.eval('plots.length') === 2, 'both plots are still there', w.eval('plots.length'));
    ok(w.eval('plots[0].chartType') === 'lines', 'each keeps its type', w.eval('plots[0].chartType'));
    ok(w.eval('plots[0].style.valueLabels') === true
       && w.eval('plots[0].style.palette') === w.eval('Object.keys(PALETTES)[1]'), 'and its style');
    ok(w.eval('plots.every(p => p.included.metric.indexOf("accesses") === -1)'),
       'nothing still asks for the measure that stopped being one');
    ok(w.eval('GROUPABLE_KEYS.indexOf("accesses") !== -1'),
       'and it can now be dragged between zones');
    ok(w.eval('document.querySelectorAll("#plots .plot-card").length') === 2,
       'the page redraws them', w.eval('document.querySelectorAll("#plots .plot-card").length'));
    w.close();
  }

  console.log('\n=== 4. A split round-trips through the review unchanged ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'blocks.csv', text: BLOCKS }]);
    await wait(60);
    setCheck(w, d.getElementById('split-enable'), true);
    await wait(40);
    setText(w, d.getElementById('split-pattern'), '{bx:d}x{by:d}');
    await wait(220);
    setText(w, d.querySelector('.import-table tr[data-col="split:bx"] input'), 'Block X');
    await wait(40);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const before = JSON.stringify((await stored(w))[0].recipe);

    await openEdit(d, 'blocks');
    ok(d.getElementById('split-enable').checked,
       'the "a column\'s values carry dimensions" box is back on');
    ok(d.getElementById('split-column').value === 'block-config',
       'over the same column', d.getElementById('split-column').value);
    ok(d.getElementById('split-pattern').value === '{bx:d}x{by:d}',
       'with the same pattern', d.getElementById('split-pattern').value);
    ok(!!colRow(d, 'split:block_x'), 'and the field keeps the name it was given');
    ok(d.querySelectorAll('.melt-preview tbody tr').length === 3,
       'the preview is drawn against the real values again',
       d.querySelectorAll('.melt-preview tbody tr').length);

    btn(d, 'Save changes').click();
    await wait(120);
    const after = JSON.stringify((await stored(w))[0].recipe);
    ok(after === before, 'saving it untouched writes back the recipe it started from');
    ok(/nothing about its shape changed/.test(status(d)), 'and says nothing changed', status(d));
    w.close();
  }

  console.log('\n=== 5. A split can be changed, not only inspected ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'blocks.csv', text: BLOCKS }]);
    await wait(60);
    setCheck(w, d.getElementById('split-enable'), true);
    await wait(40);
    setText(w, d.getElementById('split-pattern'), '{bx:d}x{by:d}');
    await wait(220);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);

    await openEdit(d, 'blocks');
    setText(w, d.getElementById('split-pattern'), '{width:d}x{height:d}');
    await wait(220);
    setText(w, d.querySelector('.import-table tr[data-col="split:width"] input'), 'Width');
    await wait(40);
    btn(d, 'Save changes').click();
    await wait(150);

    const rec = (await stored(w))[0];
    const fields = rec.recipe.columns[0].split.fields.map(f => f.key).join(',');
    ok(fields === 'width,height', 'the new pattern is what is stored', fields);
    ok(w.eval('DIM_KEYS.join(",")').indexOf('width') !== -1,
       'and the open dataset has the dimensions it names', w.eval('DIM_KEYS.join(",")'));
    ok(w.eval('DIM_BY_KEY.width.label') === 'Width', 'under the name typed for it',
       w.eval('DIM_BY_KEY.width.label'));
    ok(w.eval('DIM_KEYS.indexOf("bx")') === -1, 'the old ones are gone');
    w.close();
  }

  console.log('\n=== 6. A dataset stored before this existed is reconstructed from its recipe ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'blocks.csv', text: BLOCKS }]);
    await wait(60);
    setCheck(w, d.getElementById('split-enable'), true);
    await wait(40);
    setText(w, d.getElementById('split-pattern'), '{bx:d}x{by:d}');
    await wait(220);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const before = JSON.stringify((await stored(w))[0].recipe);

    // exactly what an older record is: a recipe, its sources, and no record of
    // the screen that wrote them
    await w.eval('(async () => { const l = await STORE.list();'
      + ' const r = await STORE.get(l[0].id); delete r.ui; await STORE.put(r); })()');
    const noUi = (await stored(w))[0];
    ok(noUi.ui === undefined, 'the stored decisions are gone');

    await openEdit(d, 'blocks');
    ok(d.getElementById('split-enable').checked, 'the split is read back off the recipe');
    ok(d.getElementById('split-pattern').value === '{bx:d}x{by:d}',
       'with its pattern', d.getElementById('split-pattern').value);
    ok(!!colRow(d, 'split:bx') && !!colRow(d, 'split:by'), 'and both its fields');
    btn(d, 'Save changes').click();
    await wait(120);
    ok(JSON.stringify((await stored(w))[0].recipe) === before,
       'saving it untouched still writes back the same recipe');
    w.close();
  }

  console.log('\n=== 7. Reconstruction does not reinstate what was left out ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'blocks.csv', text: BLOCKS }]);
    await wait(60);
    setCheck(w, d.getElementById('split-enable'), true);
    await wait(40);
    setText(w, d.getElementById('split-pattern'), '{bx:d}x{by:d}');
    await wait(220);
    // the second field is not wanted: it is dropped in the review
    setSel(w, d.querySelector('.import-table tr[data-col="split:by"] select'), 'ignore');
    await wait(60);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    await w.eval('(async () => { const l = await STORE.list();'
      + ' const r = await STORE.get(l[0].id); delete r.ui; await STORE.put(r); })()');

    await openEdit(d, 'blocks');
    ok(colRow(d, 'split:by').querySelector('select').value === 'ignore',
       'the field that was dropped comes back dropped, not proposed again',
       colRow(d, 'split:by').querySelector('select').value);
    btn(d, 'Save changes').click();
    await wait(120);
    const keys = ((await stored(w))[0].recipe.columns[0].split.fields || []).map(f => f.key);
    ok(keys.join(',') === 'bx', 'and it is still not in the recipe after a save', keys.join(','));
    w.close();
  }

  console.log('\n=== 8. An edit that would produce nothing is refused ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    await openEdit(d, 'runs');
    setSel(w, colRow(d, 'rate').querySelectorAll('select')[0], 'dimension');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'dimension');
    await wait(60);
    ok(btn(d, 'Save changes').disabled, 'with no measures left, saving is blocked');
    ok(/mark at least one column as a measure/.test(d.querySelector('.import-warn').textContent),
       'and it says what is missing', d.querySelector('.import-warn').textContent);
    ok(w.eval('METRICS.length') === 2, 'the open dataset is untouched meanwhile');

    setSel(w, colRow(d, 'rate').querySelectorAll('select')[0], 'measure');
    await wait(60);
    ok(!btn(d, 'Save changes').disabled, 'putting one back unblocks it');
    w.close();
  }

  console.log('\n=== 9. A name given in the builder survives the trip through the review ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    await w.eval('editMeasure("rate", { label: "Hit rate", format: "pct" })');
    await wait(60);
    ok((await stored(w))[0].recipe.measureOverrides.rate.label === 'Hit rate',
       'the rename is stored as a difference from the recipe');

    await openEdit(d, 'runs');
    ok(colRow(d, 'rate').querySelector('input').value === 'Hit rate',
       'the review opens showing the name the page shows, not the one the file had',
       colRow(d, 'rate').querySelector('input').value);
    ok(colRow(d, 'rate').querySelectorAll('select')[1].value === 'pct',
       'and the format it was retyped to',
       colRow(d, 'rate').querySelectorAll('select')[1].value);
    btn(d, 'Save changes').click();
    await wait(120);

    const rec = (await stored(w))[0];
    const col = rec.recipe.columns.find(c => c.name === 'rate');
    ok(col.label === 'Hit rate' && col.format === 'pct',
       'saving writes it as what the recipe declares', col.label + '/' + col.format);
    ok(!(rec.recipe.measureOverrides || {}).rate,
       'so it is no longer carried as a difference from itself');
    ok(w.eval('METRIC_BY_KEY.rate.label') === 'Hit rate', 'and the page still shows it',
       w.eval('METRIC_BY_KEY.rate.label'));
    w.close();
  }

  console.log('\n=== 10. A calculated measure that can no longer be computed is dropped ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    await w.eval('addCustomMeasure({ key: "per", label: "Rate per access", format: "number",'
      + ' formula: compileFormula("rate / accesses", DS.measures, "number") })');
    await wait(60);
    ok(((await stored(w))[0].recipe.custom || []).length === 1, 'it is stored with the recipe');

    await openEdit(d, 'runs');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'dimension');
    await wait(60);
    btn(d, 'Save changes').click();
    await wait(150);

    ok(((await stored(w))[0].recipe.custom || []).length === 0,
       'once its measure is a dimension it is not kept');
    ok(/could no longer be computed/.test(status(d)), 'and the save says so', status(d));
    ok(w.eval('METRIC_BY_KEY.per === undefined'), 'nor is it on the page');
    w.close();
  }

  console.log('\n=== 11. A combined dataset says why it cannot be edited ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', TIDY);
    await importOne(w, d, 'runB.csv', TIDY.replace(/dev(\d)/g, 'box$1'));
    // one at a time: ticking one redraws the list, detaching the other card
    cardNamed(d, 'runA').querySelector('.dataset-pick').click();
    await wait(60);
    cardNamed(d, 'runB').querySelector('.dataset-pick').click();
    await wait(60);
    d.getElementById('dataset-combine').querySelector('button').click();
    await wait(150);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(60);

    const combined = cards(d).find(c => /combined from 2/.test(c.textContent));
    ok(!!combined, 'the combined dataset is listed');
    Array.from(combined.querySelectorAll('button')).find(b => b.textContent === 'Edit import').click();
    await wait(80);
    ok(!review(d), 'editing it does not open a review');
    ok(/combined from 2 datasets/.test(status(d)) && /Edit those/.test(status(d)),
       'it points at the parts instead', status(d));
    w.close();
  }

  console.log('\n=== 12. Discarding an edit changes nothing ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', TIDY);
    const before = JSON.stringify((await stored(w))[0]);
    await openEdit(d, 'runs');
    setSel(w, colRow(d, 'rate').querySelectorAll('select')[0], 'ignore');
    setText(w, d.getElementById('import-name'), 'Something else');
    await wait(60);
    btn(d, 'Discard changes').click();
    await wait(80);
    ok(!review(d), 'the review closes');
    ok(JSON.stringify((await stored(w))[0]) === before, 'and the record is byte-identical');
    ok(w.eval('METRICS.length') === 2, 'the open dataset still has both measures');
    w.close();
  }

  console.log('\n=== 13. A melt over the column names round-trips, pattern and all ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'wide.csv', text: WIDE }]);
    await wait(60);
    setCheck(w, d.getElementById('melt-enable'), true);
    await wait(40);
    setText(w, d.getElementById('melt-pattern'), '{device:d}c{threads:d}');
    await wait(220);
    setText(w, d.getElementById('melt-fallback-name'), 'Hit rate');
    await wait(220);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const before = JSON.stringify((await stored(w))[0].recipe);

    await openEdit(d, 'wide');
    ok(d.getElementById('melt-enable').checked, 'the column-name split is back on');
    ok(d.getElementById('melt-pattern').value === '{device:d}c{threads:d}',
       'with its pattern', d.getElementById('melt-pattern').value);
    ok(d.getElementById('melt-fallback-name').value === 'Hit rate',
       'and the name the value was given', d.getElementById('melt-fallback-name').value);
    ok(!!colRow(d, 'melt:device') && !!colRow(d, 'melt:threads'),
       'both melted dimensions are listed');
    btn(d, 'Save changes').click();
    await wait(120);
    ok(JSON.stringify((await stored(w))[0].recipe) === before,
       'and an untouched save is a no-op');
    w.close();
  }

  console.log('\n=== 14. So does a melt read as parts, including the part put aside ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'h.csv', text: HEADER_PARTS }]);
    await wait(60);
    setCheck(w, d.getElementById('melt-enable'), true);
    await wait(40);
    setSel(w, d.getElementById('melt-kind'), 'parts');
    await wait(60);
    // the id column is only an id column once its own word is out of play
    setSel(w, d.querySelector('.parts-table tr[data-part="app"] select'), 'off');
    await wait(60);
    const mg = d.getElementById('melt-measure-group');
    setSel(w, mg, Array.from(mg.options).find(o => /value/.test(o.textContent)).value);
    await wait(60);
    btn(d, 'Import').click();
    await wait(100);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const before = JSON.stringify((await stored(w))[0].recipe);
    const dims = w.eval('DS.dims.map(x => x.key).join(",")');

    // reconstructed rather than replayed: the harder of the two paths
    await w.eval('(async () => { const l = await STORE.list();'
      + ' const r = await STORE.get(l[0].id); delete r.ui; await STORE.put(r); })()');
    await openEdit(d, 'h');
    ok(d.getElementById('melt-kind').value === 'parts',
       'it comes back as a parts reading', d.getElementById('melt-kind').value);
    ok(d.querySelector('.parts-table tr[data-part="app"] select').value === 'off',
       'the part that was put aside is still put aside',
       d.querySelector('.parts-table tr[data-part="app"] select').value);
    ok(!!colRow(d, 'app'), 'so its column is still a column of its own');
    const mg2 = d.getElementById('melt-measure-group');
    ok(mg2.value && /value/.test(Array.from(mg2.options).find(o => o.value === mg2.value).textContent),
       'and the group that names the measure still does');
    ok(!!colRow(d, 'melt:value') && !!colRow(d, 'melt:variance'), 'so its parts are the measures');

    btn(d, 'Save changes').click();
    await wait(150);
    ok(JSON.stringify((await stored(w))[0].recipe) === before,
       'saving it writes back the recipe it was reconstructed from');
    ok(w.eval('DS.dims.map(x => x.key).join(",")') === dims,
       'and the dataset is the one it was', w.eval('DS.dims.map(x => x.key).join(",")'));
    w.close();
  }

  console.log('\n=== 15. Folder dimensions come back, and the ignored level stays ignored ===');
  {
    const { w, d } = boot();
    const csv = 'app,rate\nA,1\nB,2\n';
    pick(w, [
      { name: 'r.csv', path: 'eval/32x32/RTX2080/r.csv', text: csv },
      { name: 'r.csv', path: 'eval/32x32/RTX4070/r.csv', text: csv },
      { name: 'r.csv', path: 'eval/defBlock/RTX2080/r.csv', text: csv },
    ], 'csv-dir-input');
    await wait(60);
    setText(w, d.getElementById('path-name-1'), 'Block');
    setText(w, d.getElementById('path-name-2'), 'Device');
    await wait(220);
    btn(d, 'Import').click();
    await wait(120);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const name = cards(d)[0].querySelector('.dataset-name').textContent;
    const before = JSON.stringify((await stored(w))[0].recipe);

    await w.eval('(async () => { const l = await STORE.list();'
      + ' const r = await STORE.get(l[0].id); delete r.ui; await STORE.put(r); })()');
    await openEdit(d, name);
    ok(d.querySelector('.path-levels tr[data-level="1"] select').value === 'dimension',
       'the folder levels that were named come back as dimensions',
       d.querySelector('.path-levels tr[data-level="1"] select').value);
    ok(d.getElementById('path-name-1').value === 'Block', 'under their names',
       d.getElementById('path-name-1').value);
    ok(d.querySelector('.path-levels tr[data-level="0"] select').value === 'ignore',
       'and the one that was ignored is not proposed again',
       d.querySelector('.path-levels tr[data-level="0"] select').value);
    btn(d, 'Save changes').click();
    await wait(150);
    ok(JSON.stringify((await stored(w))[0].recipe) === before,
       'so an untouched save writes the same recipe');
    ok(w.eval('DIM_KEYS.join(",")') === 'block,device,app,metric',
       'and the dataset keeps its folder dimensions', w.eval('DIM_KEYS.join(",")'));
    w.close();
  }

  console.log('\n=== 16. Editing a dataset that is not the open one leaves the page alone ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', TIDY);
    await importOne(w, d, 'runB.csv', TIDY.replace(/dev(\d)/g, 'box$1'));
    ok(w.eval('DS.name') === 'runB', 'the second import is the open one', w.eval('DS.name'));
    const openDims = w.eval('DIM_KEYS.join(",")');

    await openEdit(d, 'runA');
    setSel(w, colRow(d, 'accesses').querySelectorAll('select')[0], 'dimension');
    await wait(60);
    btn(d, 'Save changes').click();
    await wait(150);

    const recA = (await stored(w)).find(r => r.name === 'runA');
    ok(recA.recipe.columns.find(c => c.name === 'accesses').role === 'dimension',
       'the stored dataset takes the edit');
    ok(w.eval('DS.name') === 'runB', 'the open one is still the open one', w.eval('DS.name'));
    ok(w.eval('DIM_KEYS.join(",")') === openDims, 'and is untouched', w.eval('DIM_KEYS.join(",")'));
    ok(!/Plots using them/.test(status(d)), 'so nothing is claimed about its plots', status(d));
    w.close();
  }

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
