const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}

// Boot with the in-memory store so nothing needs an IndexedDB shim.
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  w.eval('setStore(makeMemoryStore());');
  return { w, d: w.document };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Drive the picker the way a browser would: hand the change handler real Files.
function pick(w, files) {
  const input = w.document.getElementById('csv-input');
  const list = files.map(f => new w.File([f.text], f.name, { type: 'text/csv' }));
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
}
const review = d => d.querySelector('.import-review');
const colRow = (d, name) => d.querySelector('.import-table tr[data-col="' + name + '"]');
const setRole = (w, d, name, role) => {
  const sel = colRow(d, name).querySelectorAll('select')[0];
  sel.value = role; sel.dispatchEvent(new w.Event('change'));
};
const importBtn = d => Array.from(review(d).querySelectorAll('button')).find(b => b.textContent === 'Import');

const TIDY = `device,size,variant,rate,accesses
dev1,512,base,62.1,8100000
dev1,512,tuned,66.6,9900000
dev1,256,base,52.5,8100000
dev1,256,tuned,45.4,9900000
dev2,512,base,64.0,7300000
dev2,512,tuned,73.6,7900000
dev2,256,base,63.3,7300000
dev2,256,tuned,60.1,7900000
`;

(async () => {
  console.log('\n=== 1. A tidy CSV imports and charts ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: TIDY }]);
    await wait(60);
    ok(!!review(d), 'the review step appears rather than importing blind');
    ok(/8 rows/.test(d.querySelector('.import-summary').textContent), 'it counts the rows',
       d.querySelector('.import-summary').textContent);

    const roles = ['device', 'size', 'variant', 'rate', 'accesses']
      .map(n => n + '=' + colRow(d, n).querySelectorAll('select')[0].value);
    ok(roles.join(' ') === 'device=dimension size=dimension variant=dimension rate=measure accesses=measure',
       'roles are inferred, not guessed at random', roles.join(' '));
    const fmt = colRow(d, 'accesses').querySelectorAll('select')[1].value;
    ok(fmt === 'count', 'a wide-ranging integer column is proposed as a count', fmt);
    const rateFmt = colRow(d, 'rate').querySelectorAll('select')[1].value;
    ok(rateFmt === 'pct', 'a 0..100 column named "rate" is proposed as a percentage', rateFmt);

    importBtn(d).click();
    await wait(60);
    ok(!review(d), 'the review closes');
    ok(w.eval('hasDataset()'), 'a dataset is live');
    ok(w.eval('DS.dims.map(x => x.key).join(",")') === 'device,size,variant', 'its dimensions are the three text columns',
       w.eval('DS.dims.map(x => x.key).join(",")'));
    ok(w.eval('DS.measures.length') === 2, 'and its measures the two numeric ones', w.eval('DS.measures.length'));
    ok(w.eval('DS.nRows') === 8, 'every row landed', w.eval('DS.nRows'));
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
       d.querySelectorAll('#plots rect.bar').length);
    const v = w.eval('metricValueAt({device:"dev2",size:"512",variant:"tuned",metric:"rate"})');
    ok(Math.abs(v - 73.6) < 1e-9, 'values survive the round trip', v);
    w.close();
  }

  console.log('\n=== 2. Renaming a column changes what the page shows ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: TIDY }]);
    await wait(60);
    const nameIn = colRow(d, 'device').querySelector('input.name-input');
    nameIn.value = 'Accelerator';
    nameIn.dispatchEvent(new w.Event('input'));
    importBtn(d).click();
    await wait(60);
    const labels = w.eval('DIMENSIONS.map(x => x.label).join(",")');
    ok(/Accelerator/.test(labels), 'the display name is used', labels);
    ok(w.eval('DS.dims[0].key') === 'device', 'while the underlying key is unchanged', w.eval('DS.dims[0].key'));
    w.close();
  }

  console.log('\n=== 3. Ignoring a column collapses rows, and says so ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: TIDY }]);
    await wait(60);
    setRole(w, d, 'variant', 'ignore');
    const outcome = d.querySelector('.import-outcome, .import-warn');
    ok(/collapse/.test(outcome.textContent), 'the collapse is announced before importing', outcome.textContent.slice(0, 80));
    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.nRows') === 4, 'eight rows become four', w.eval('DS.nRows'));
    ok(w.eval('DS.stats.collapsed') === 4, 'and the collapse is recorded', w.eval('DS.stats.collapsed'));
    const v = w.eval('metricValueAt({device:"dev1",size:"512",metric:"rate"})');
    ok(Math.abs(v - (62.1 + 66.6) / 2) < 1e-9, 'duplicates are averaged, not last-write-wins', v);
    w.close();
  }

  console.log('\n=== 4. It refuses imports that could not be plotted ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'runs.csv', text: TIDY }]);
    await wait(60);
    setRole(w, d, 'rate', 'ignore');
    setRole(w, d, 'accesses', 'ignore');
    ok(importBtn(d).disabled, 'no measures: Import is disabled');
    ok(/at least one column as a measure/.test(d.querySelector('.import-warn').textContent), 'and says why');
    setRole(w, d, 'rate', 'measure');
    setRole(w, d, 'device', 'ignore');
    setRole(w, d, 'size', 'ignore');
    setRole(w, d, 'variant', 'ignore');
    ok(importBtn(d).disabled, 'no dimensions: Import is disabled');
    ok(/at least one column as a dimension/.test(d.querySelector('.import-warn').textContent), 'and says why');
    w.close();
  }

  console.log('\n=== 5. Malformed input is reported, not silently repaired ===');
  {
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'ragged.csv', text: 'a,b,c\n1,2,3\n4,5\n6,7,8,9\n' }]);
    await wait(60);
    const warn = d.querySelector('.import-warn');
    ok(!!warn && /wrong number of fields/.test(warn.textContent), 'ragged rows are called out', warn && warn.textContent.slice(0, 70));
    w.close();
  }

  console.log('\n=== 6. Quoting, semicolons and comment lines ===');
  {
    const { w, d } = boot();
    const semi = '# a comment line\nname;value\n"one; with semicolon";1\n"say ""hi""";2\n';
    d.querySelector('.mode-tab[data-mode="data"]').click();
    pick(w, [{ name: 'q.csv', text: semi }]);
    await wait(60);
    ok(/delimiter ";"/.test(d.querySelector('.import-summary').textContent), 'the delimiter is sniffed',
       d.querySelector('.import-summary').textContent);
    ok(/a comment line/.test(d.querySelector('.import-note').textContent), 'the comment line is surfaced');
    const prof = colRow(d, 'name').querySelector('.col-profile').textContent;
    ok(/one; with semicolon/.test(prof), 'a quoted separator does not split the field', prof.slice(0, 60));
    ok(/say "hi"/.test(prof), 'and doubled quotes unescape', prof.slice(0, 80));
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
