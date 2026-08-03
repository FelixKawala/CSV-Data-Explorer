// The stored-dataset list: renaming what is in it.
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
function pick(w, files) {
  const input = w.document.getElementById('csv-input');
  const list = files.map(f => new w.File([f.text], f.name, { type: 'text/csv' }));
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
}
const importBtn = d => Array.from(d.querySelector('.import-review').querySelectorAll('button'))
  .find(b => b.textContent === 'Import');
const cards = d => Array.from(d.querySelectorAll('.dataset-card'));
const cardNamed = (d, n) => cards(d).find(c => (c.querySelector('.dataset-name') || {}).textContent === n);

const A = 'case,size,rate\nalpha,512,10\nalpha,256,20\nbeta,512,30\nbeta,256,40\n';
const B = 'case,size,rate\nalpha,512,11\nalpha,256,21\nbeta,512,31\nbeta,256,41\n';

async function importOne(w, d, name, text) {
  pick(w, [{ name: name, text: text }]);
  await wait(60);
  importBtn(d).click();
  await wait(80);
  d.querySelector('.mode-tab[data-mode="data"]').click();
  await wait(30);
}

(async () => {
  console.log('\n=== 1. A stored dataset can be renamed ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    const card = cardNamed(d, 'runA');
    ok(!!card, 'it is listed under the filename it came from');
    ok(!!Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Rename'),
       'and offers a rename');

    Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Rename').click();
    const inp = d.querySelector('.dataset-rename');
    ok(!!inp && inp.value === 'runA', 'the caption becomes a field holding the old name');
    inp.value = 'Tuned run, June';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
    await wait(80);

    ok(!!cardNamed(d, 'Tuned run, June'), 'the card shows the new name');
    const stored = await w.eval('STORE.list()');
    ok(stored[0].name === 'Tuned run, June', 'and so does the store', stored[0].name);
    ok(w.eval('DS.name') === 'Tuned run, June', 'the open dataset follows it', w.eval('DS.name'));
    w.close();
  }

  console.log('\n=== 2. Clicking the name renames it too, and Escape does not ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    cardNamed(d, 'runA').querySelector('.dataset-name').click();
    const inp = d.querySelector('.dataset-rename');
    ok(!!inp, 'the caption itself is the affordance');
    inp.value = 'something else';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    await wait(60);
    ok(!!cardNamed(d, 'runA'), 'Escape leaves it alone');
    const stored = await w.eval('STORE.list()');
    ok(stored[0].name === 'runA', 'and the store is untouched', stored[0].name);
    w.close();
  }

  console.log('\n=== 3. An empty name is refused ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    cardNamed(d, 'runA').querySelector('.dataset-name').click();
    const inp = d.querySelector('.dataset-rename');
    inp.value = '   ';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
    await wait(60);
    ok(!!cardNamed(d, 'runA'), 'the old name stands');
    const direct = await w.eval('renameDataset(activeDatasetId(), "   ")');
    ok(direct === false, 'and the call itself refuses one', String(direct));
    w.close();
  }

  console.log('\n=== 4. Renaming one leaves the others alone ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    await importOne(w, d, 'runB.csv', B);
    ok(cards(d).length === 2, 'two datasets are stored', cards(d).length);
    cardNamed(d, 'runA').querySelector('.dataset-name').click();
    const inp = d.querySelector('.dataset-rename');
    inp.value = 'baseline';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
    await wait(80);
    const names = (await w.eval('STORE.list()')).map(r => r.name).sort().join(',');
    ok(names === 'baseline,runB', 'only the one renamed changed', names);
    w.close();
  }

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
