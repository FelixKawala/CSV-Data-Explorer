// The stored-dataset list: renaming what is in it, and combining several of
// them into one.
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

  console.log('\n=== 5. Combining two stored datasets ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    await importOne(w, d, 'runB.csv', B);
    ok(!d.getElementById('dataset-combine'), 'nothing is offered with nothing picked');
    cardNamed(d, 'runA').querySelector('.dataset-pick').click();
    await wait(30);
    ok(!d.getElementById('dataset-combine'), 'nor with one');
    ok(/Tick a second/.test(d.querySelector('.dataset-hint').textContent), 'but it says what is missing');
    cardNamed(d, 'runB').querySelector('.dataset-pick').click();
    await wait(30);
    const bar = d.getElementById('dataset-combine');
    ok(!!bar, 'two picked, and the form appears');
    ok(d.getElementById('combine-name').value === 'runA + runB', 'named after both by default',
       d.getElementById('combine-name').value);
    ok(d.getElementById('combine-dim').checked, 'with a Dataset dimension by default');

    d.getElementById('combine-name').value = 'both runs';
    Array.from(bar.querySelectorAll('button')).find(b => b.textContent === 'Combine').click();
    await wait(120);

    const list = await w.eval('STORE.list()');
    ok(list.length === 3, 'a third record, and the originals are kept', list.length);
    const made = list.find(r => r.name === 'both runs');
    ok(!!made, 'stored under the name that was typed');
    ok(made.parts.length === 2, 'holding both parts', made.parts && made.parts.length);
    ok(made.parts[0].recipe.columns.length === 3, 'each with its own recipe');

    const got = w.eval(`(function () {
      return { name: DS.name, dims: DS.dims.map(x => x.key).join(','), rows: DS.nRows,
               parts: DS.dims[0].values.join(','),
               a: metricValueAt({ __dataset: 'runA', case: 'alpha', size: '512', metric: 'rate' }),
               b: metricValueAt({ __dataset: 'runB', case: 'alpha', size: '512', metric: 'rate' }) };
    })()`);
    ok(got.name === 'both runs', 'and it is the live dataset', got.name);
    ok(got.dims === '__dataset,case,size', 'the Dataset dimension leads', got.dims);
    ok(got.parts === 'runA,runB', 'naming each part', got.parts);
    ok(got.rows === 8, 'every row of both survived', got.rows);
    ok(got.a === 10 && got.b === 11, 'and they are kept apart', got.a + ' / ' + got.b);
    w.close();
  }

  console.log('\n=== 6. Datasets with different columns combine on the union ===');
  {
    const OTHER = 'thing,score\nx,1.5\ny,2.5\n';
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    await importOne(w, d, 'other.csv', OTHER);
    cardNamed(d, 'runA').querySelector('.dataset-pick').click();
    await wait(30);
    cardNamed(d, 'other').querySelector('.dataset-pick').click();
    await wait(30);
    d.getElementById('combine-fill').value = 'missing';
    Array.from(d.getElementById('dataset-combine').querySelectorAll('button'))
      .find(b => b.textContent === 'Combine').click();
    await wait(120);

    const got = w.eval(`(function () {
      return { dims: DS.dims.map(x => x.key).join(','),
               measures: DS.measures.map(m => m.key).join(','),
               rows: DS.nRows,
               thingVals: DS.dims.filter(x => x.key === 'thing')[0].values.join(','),
               kept: metricValueAt({ __dataset: 'runA', case: 'alpha', size: '512', thing: 'missing', metric: 'rate' }),
               other: metricValueAt({ __dataset: 'other', case: 'missing', size: 'missing', thing: 'x', metric: 'score' }),
               gap: metricValueAt({ __dataset: 'other', case: 'missing', size: 'missing', thing: 'x', metric: 'rate' }) };
    })()`);
    ok(got.dims === '__dataset,case,size,thing', 'every dimension of both', got.dims);
    ok(got.measures === 'rate,score', 'and every measure', got.measures);
    ok(got.rows === 6, 'all six rows', got.rows);
    ok(/missing/.test(got.thingVals), 'the fill is a value of the dimension', got.thingVals);
    ok(got.kept === 10, 'a row from one part keeps its number', got.kept);
    ok(got.other === 1.5, 'and so does one from the other', got.other);
    ok(got.gap === null, 'a measure the part has not got stays empty', got.gap);
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the combined dataset draws');
    w.close();
  }

  console.log('\n=== 7. It reloads from the store, and combines again ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runA.csv', A);
    await importOne(w, d, 'runB.csv', B);
    cardNamed(d, 'runA').querySelector('.dataset-pick').click();
    await wait(30);
    cardNamed(d, 'runB').querySelector('.dataset-pick').click();
    await wait(30);
    Array.from(d.getElementById('dataset-combine').querySelectorAll('button'))
      .find(b => b.textContent === 'Combine').click();
    await wait(120);
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(50);

    const card = cardNamed(d, 'runA + runB');
    ok(/combined from 2 datasets/.test(card.querySelector('.dataset-meta').textContent),
       'the card says it is a combination', card.querySelector('.dataset-meta').textContent);
    ok(/2 files/.test(card.querySelector('.dataset-meta').textContent), 'counting the files of both');

    // a fresh build from the stored record alone, as a reload would do
    const stored = (await w.eval('STORE.list()')).find(r => r.name === 'runA + runB');
    const again = w.eval('(function () { const ds = datasetFromRecord('
      + JSON.stringify(stored) + '); return ds.dims.map(x => x.key).join(",") + "|" + ds.nRows; })()');
    ok(again === '__dataset,case,size|8', 'it rebuilds from the record alone', again);

    // combining a combination flattens rather than nests
    await importOne(w, d, 'runC.csv', B.replace(/1\n/g, '2\n'));
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(50);
    cardNamed(d, 'runA + runB').querySelector('.dataset-pick').click();
    await wait(30);
    cardNamed(d, 'runC').querySelector('.dataset-pick').click();
    await wait(30);
    Array.from(d.getElementById('dataset-combine').querySelectorAll('button'))
      .find(b => b.textContent === 'Combine').click();
    await wait(120);
    const parts = w.eval('DS.dims[0].values.join(",")');
    ok(parts === 'runA,runB,runC', 'three parts, not two with one nested', parts);
    w.close();
  }

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
