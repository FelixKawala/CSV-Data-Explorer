// The preselect: which rows and columns of a file an import reads at all.
//
// Everything is selected by default and the panel is folded away, so a file
// imported without touching it behaves exactly as before. Expanded, a
// virtualised grid shows the file as it was read, and dragging across the row
// numbers or the column headers removes or restores a band -- the gesture's
// polarity comes from the cell it starts on. What is left selected is what the
// profiles, the counts and the emitted rows are all derived from, and the
// selection is stored with the recipe so an edit reopens with the same bands
// out and the dataset is rebuilt from exactly what was selected.

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
  const w = dom.window;
  w.eval('setStore(makeMemoryStore());');
  return { w, d: w.document };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = (w, files) => {
  const input = w.document.getElementById('csv-input');
  const list = files.map(f => new w.File([f.text], f.name, { type: 'text/csv' }));
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
};
const review = d => d.querySelector('.import-review');
const preselToggle = d => review(d).querySelector('.preselect-toggle');
const preselSummary = d => review(d).querySelector('.preselect-summary').textContent;
const expand = (w, d) => { preselToggle(d).click(); };
const col = (d, i) => review(d).querySelector('.pg-col[data-col="' + i + '"]');
const rowEl = (d, i) => review(d).querySelector('.pg-row[data-row="' + i + '"]');
const importBtn = d => Array.from(review(d).querySelectorAll('button')).find(b => b.textContent === 'Import');
// A band drag in two gestures: press on `from`, drag to `to`, release on the
// document. The polarity comes from the cell the press lands on. The grid
// repaints on the press, so the drag target is re-found by its index.
const band = (w, d, from, to) => {
  const find = el => {
    const r = el.getAttribute('data-row');
    return r !== null ? rowEl(d, +r) : col(d, +el.getAttribute('data-col'));
  };
  from.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  const cur = find(to);
  cur.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true }));
  w.document.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
};

const CSV = `app,config,hits
a,x,1
a,y,2
b,x,3
b,y,4
c,x,5
c,y,6
`;

(async () => {
  console.log('\n=== 1. Folded by default, and importing without touching it changes nothing ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    ok(!!preselToggle(d), 'the preselect control is on the review');
    ok(/all 6 rows · all 3 columns selected/.test(preselSummary(d)), 'and says everything is in',
       preselSummary(d));
    ok(!review(d).querySelector('.preselect-grid'),
       'folded by default: no grid until it is asked for');
    ok(/6 rows · 3 columns/.test(d.querySelector('.import-summary').textContent),
       'the review counts the whole file', d.querySelector('.import-summary').textContent);
    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.nRows') === 6 && w.eval('DS.dims.length') === 2 && w.eval('DS.measures.length') === 1,
       'the import is exactly the tidy one',
       w.eval('DS.nRows + " rows " + DS.dims.length + " dims " + DS.measures.length + " meas"'));
    ok(w.eval('metricValueAt({app:"a",config:"x",metric:"hits"})') === 1
       && w.eval('metricValueAt({app:"c",config:"y",metric:"hits"})') === 6,
       'every value landed',
       w.eval('metricValueAt({app:"c",config:"y",metric:"hits"})'));
    w.close();
  }

  console.log('\n=== 2. Dragging across columns takes a band out ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    expand(w, d);
    ok(review(d).querySelectorAll('.pg-col').length === 3, 'the grid shows the header',
       review(d).querySelectorAll('.pg-col').length);
    ok(review(d).querySelectorAll('.pg-row').length > 0, 'and the visible rows',
       review(d).querySelectorAll('.pg-row').length);

    // pressing on the selected `config` header makes the drag a removal
    band(w, d, col(d, 1), col(d, 1));
    ok(/all 6 rows · 2 of 3 columns selected/.test(preselSummary(d)),
       'the column is out of the import', preselSummary(d));
    ok(!review(d).querySelector('.import-table tr[data-col="config"]'),
       'and the column table no longer offers it');
    ok(/2 columns/.test(d.querySelector('.import-summary').textContent),
       'the summary counts the columns that remain', d.querySelector('.import-summary').textContent);
    ok(/6 rows collapse onto 3 combinations/.test(review(d).textContent),
       'and the review says the rows now fold together',
       review(d).querySelector('.import-outcome').textContent);

    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.dims.map(x => x.key).join(",")') === 'app', 'only app groups the rows',
       w.eval('DS.dims.map(x => x.key).join(",")'));
    ok(w.eval('DS.nRows') === 3, 'each app collapses to one row', w.eval('DS.nRows'));
    ok(w.eval('metricValueAt({app:"a",metric:"hits"})') === 1.5,
       'and the x/y pair averages, as it does whenever a grouping column is gone',
       w.eval('metricValueAt({app:"a",metric:"hits"})'));
    w.close();
  }

  console.log('\n=== 3. Dragging across rows takes a band out ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    expand(w, d);
    band(w, d, rowEl(d, 0), rowEl(d, 1));
    ok(/4 of 6 rows · all 3 columns selected/.test(preselSummary(d)),
       'rows 1 and 2 are out', preselSummary(d));
    ok(/4 rows/.test(d.querySelector('.import-summary').textContent),
       'the review counts what remains', d.querySelector('.import-summary').textContent);
    // the row's own state has to be visible, not just stored
    ok(!!rowEl(d, 0) && /off/.test(rowEl(d, 0).className)
       && Array.from(rowEl(d, 0).querySelectorAll('.pg-cell')).every(c => /off/.test(c.className))
       && /off/.test(rowEl(d, 0).querySelector('.pg-gut').className),
       'an unselected row is dimmed — row, every cell and the row number');
    ok(!/off/.test(rowEl(d, 2).className),
       'while a selected row is not');
    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.nRows') === 4, 'four rows land', w.eval('DS.nRows'));
    ok(w.eval('DS.dims.map(x => x.key).join(",")') === 'app,config',
       'with both grouping columns intact', w.eval('DS.dims.map(x => x.key).join(",")'));
    ok(w.eval('metricValueAt({app:"a",config:"x",metric:"hits"})') === null,
       'the excluded rows are really gone, not folded as empty');
    w.close();
  }

  console.log('\n=== 4. Re-selecting is the same gesture on the empty side ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    expand(w, d);
    band(w, d, rowEl(d, 0), rowEl(d, 1));
    // rows 0..1 are now empty of selection, so pressing on row 0 adds the band back
    band(w, d, rowEl(d, 0), rowEl(d, 1));
    ok(/all 6 rows · all 3 columns selected/.test(preselSummary(d)),
       'dragging out of the empty band restores it', preselSummary(d));
    w.close();
  }

  console.log('\n=== 5. Select all and unselect all ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    expand(w, d);
    const btn = label => Array.from(review(d).querySelectorAll('.preselect-tools button'))
      .find(b => b.textContent === label);
    btn('Unselect all rows').click();
    ok(/0 of 6 rows · all 3 columns selected/.test(preselSummary(d)), 'rows can be emptied',
       preselSummary(d));
    ok(/Nothing is selected/.test(review(d).textContent),
       'and the review says there is nothing left to import');
    btn('Select all rows').click();
    ok(/all 6 rows/.test(preselSummary(d)), 'and filled again');
    btn('Unselect all columns').click();
    ok(/all 6 rows · 0 of 3 columns selected/.test(preselSummary(d)), 'columns too');
    btn('Select all columns').click();
    ok(/all 3 columns selected/.test(preselSummary(d)), 'both back to everything');
    w.close();
  }

  console.log('\n=== 6. The selection is stored and an edit reopens with it ===');
  (async function () {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: CSV }]);
    await wait(60);
    expand(w, d);
    band(w, d, rowEl(d, 0), rowEl(d, 1));       // rows 1-2 out
    band(w, d, col(d, 1), col(d, 1));           // config out
    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.nRows') === 2 && w.eval('DS.dims.length') === 1,
       'the dataset is built from what was selected (the b/c rows collapse onto one row each)',
       w.eval('DS.nRows + " rows " + DS.dims.length + " dims"'));

    const rec = await w.eval('STORE.list()').then(rs => rs[0]);
    const presel = rec.recipe.parse.preselect;
    ok(!!presel && !!presel['runs.csv'],
       'the recipe carries the selection', JSON.stringify(rec.recipe.parse));
    ok(presel['runs.csv'].cols.join(',') === 'true,false,true',
       'with the config column out', presel['runs.csv'].cols.join(','));
    ok(JSON.stringify(presel['runs.csv'].rows) === '[[2,5]]',
       'and the rows as an interval list', JSON.stringify(presel['runs.csv'].rows));

    // reopen through Edit import: the same screen, the same bands out
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(20);
    const editBtn = Array.from(d.querySelectorAll('.dataset-actions button'))
      .find(b => b.textContent === 'Edit import');
    ok(!!editBtn, 'the stored dataset offers to edit its import');
    editBtn.click();
    await wait(60);
    ok(!!review(d), 'the review is back up');
    expand(w, d);
    ok(/4 of 6 rows · 2 of 3 columns selected/.test(preselSummary(d)),
       'the reopened grid shows the same selection', preselSummary(d));
    ok(!!rowEl(d, 0) && /off/.test(rowEl(d, 0).className), 'row 1 is visibly out');
    ok(!!col(d, 1) && /off/.test(col(d, 1).className), 'config is visibly out');
    const saveBtn = Array.from(review(d).querySelectorAll('button')).find(b => b.textContent === 'Save changes');
    saveBtn.click();
    await wait(60);
    ok(!review(d), 'the edit saves without re-importing');
    ok(w.eval('DS.nRows') === 2 && w.eval('DS.dims.length') === 1,
       'and the rebuilt dataset is the same one',
       w.eval('DS.nRows + " rows " + DS.dims.length + " dims"'));
    w.close();

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  })();
})().catch(e => {
  failures++;
  console.log('  FAIL: crashed — ' + e.message);
  console.log(e.stack);
  process.exit(1);
});