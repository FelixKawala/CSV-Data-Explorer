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
  w.document.querySelector('.mode-tab[data-mode="data"]').click();
  return { w, d: w.document };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function pick(w, files) {
  const input = w.document.getElementById('csv-input');
  const list = files.map(f => new w.File([f.text], f.name, { type: 'text/csv' }));
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
}
const review = d => d.querySelector('.import-review');
const importBtn = d => Array.from(review(d).querySelectorAll('button')).find(b => b.textContent === 'Import');
const radio = (d, label) => Array.from(d.querySelectorAll('.import-target .radio-row'))
  .find(l => l.textContent.indexOf(label) !== -1);

const A = 'case,size,rate\nalpha,512,10.0\nalpha,256,20.0\nbeta,512,30.0\nbeta,256,40.0\n';
const B = 'case,size,rate\nalpha,512,11.0\nalpha,256,21.0\nbeta,512,31.0\nbeta,256,41.0\n';
const OTHER = 'thing,score\nx,1.5\ny,2.5\n';

(async () => {
  console.log('\n=== 1. Same-shaped files: choosing separate datasets ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runA.csv', text: A }, { name: 'runB.csv', text: B }]);
    await wait(60);
    ok(!!radio(d, 'separate datasets'), 'the choice is offered');
    ok(!!radio(d, 'one dataset'), 'including unioning them, since the headers match');
    // Matching headers describe the same thing, so unioning is the default; it keeps
    // every row and names its file. Separate is one click away.
    ok(radio(d, 'one dataset').querySelector('input').checked, 'unioning is the default for matching headers');

    const sep = radio(d, 'separate datasets').querySelector('input');
    sep.checked = true;
    sep.dispatchEvent(new w.Event('change'));
    await wait(20);
    importBtn(d).click();
    await wait(60);
    const list = await w.eval('STORE.list()');
    ok(list.length === 2, 'two datasets stored', list.map(r => r.name).join(', '));
    ok(list.map(r => r.name).sort().join(',') === 'runA,runB', 'named after their files', list.map(r => r.name).join(','));
    ok(w.eval('DS.nRows') === 4, 'the live one holds a single file', w.eval('DS.nRows'));
    ok(w.eval('DS.dims.map(x=>x.key).join(",")') === 'case,size', 'with no Source dimension',
       w.eval('DS.dims.map(x=>x.key).join(",")'));
    w.close();
  }

  console.log('\n=== 2. Unioned into one, with a Source dimension ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runA.csv', text: A }, { name: 'runB.csv', text: B }]);
    await wait(60);
    const one = radio(d, 'one dataset').querySelector('input');
    one.checked = true;
    one.dispatchEvent(new w.Event('change'));
    await wait(20);
    ok(!!radio(d, 'add a Source dimension'), 'the Source dimension is offered');
    importBtn(d).click();
    await wait(60);
    const list = await w.eval('STORE.list()');
    ok(list.length === 1, 'one dataset stored', list.length);
    ok(w.eval('DS.nRows') === 8, 'holding both files\' rows', w.eval('DS.nRows'));
    const dims = w.eval('DS.dims.map(x=>x.key).join(",")');
    ok(dims === '__source,case,size', 'with Source first', dims);
    ok(w.eval('DS.dims[0].values.join(",")') === 'runA,runB', 'naming each file',
       w.eval('DS.dims[0].values.join(",")'));
    const a = w.eval('metricValueAt({__source:"runA",case:"alpha",size:"512",metric:"rate"})');
    const b = w.eval('metricValueAt({__source:"runB",case:"alpha",size:"512",metric:"rate"})');
    ok(a === 10 && b === 11, 'and the two files stay distinguishable', a + ' vs ' + b);
    w.close();
  }

  console.log('\n=== 3. Without the Source dimension the rows would collide, so it is kept ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runA.csv', text: A }, { name: 'runB.csv', text: B }]);
    await wait(60);
    const one = radio(d, 'one dataset').querySelector('input');
    one.checked = true; one.dispatchEvent(new w.Event('change'));
    await wait(20);
    const cb = radio(d, 'add a Source dimension').querySelector('input');
    cb.checked = false; cb.dispatchEvent(new w.Event('change'));
    importBtn(d).click();
    await wait(60);
    ok(w.eval('DS.nRows') === 4, 'the tuples do collapse without it', w.eval('DS.nRows'));
    ok(w.eval('DS.stats.collapsed') === 4, 'and the collapse is recorded rather than hidden',
       w.eval('DS.stats.collapsed'));
    const v = w.eval('metricValueAt({case:"alpha",size:"512",metric:"rate"})');
    ok(Math.abs(v - 10.5) < 1e-9, 'the two files being averaged, not one silently winning', v);
    w.close();
  }

  console.log('\n=== 4. Differently-shaped files cannot be unioned ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runA.csv', text: A }, { name: 'other.csv', text: OTHER }]);
    await wait(60);
    ok(!radio(d, 'one dataset'), 'unioning is not offered');
    ok(/different columns/.test(d.querySelector('.import-target').textContent), 'and the reason is given',
       d.querySelector('.import-target').textContent.slice(-70));
    importBtn(d).click();
    await wait(60);
    const list = await w.eval('STORE.list()');
    ok(list.length === 2, 'they import as two datasets', list.map(r => r.name).join(', '));
    w.close();
  }

  console.log('\n=== 5. Switching between stored datasets ===');
  {
    const { w, d } = boot();
    pick(w, [{ name: 'runA.csv', text: A }, { name: 'other.csv', text: OTHER }]);
    await wait(60);
    importBtn(d).click();
    await wait(60);
    w.document.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(30);
    const cards = d.querySelectorAll('.dataset-card');
    ok(cards.length === 2, 'both are listed', cards.length);
    ok(d.querySelectorAll('.dataset-card.active').length === 1, 'one is marked active');
    const runA = Array.from(cards).find(c => c.querySelector('.dataset-name').textContent === 'runA');
    ok(/2 dimensions · 1 measure/.test(runA.querySelector('.dataset-meta').textContent),
       'each card describes its shape', runA.querySelector('.dataset-meta').textContent);
    Array.from(runA.querySelectorAll('button')).find(b => b.textContent === 'Open').click();
    await wait(60);
    ok(w.eval('DS.name') === 'runA', 'opening one switches the live dataset', w.eval('DS.name'));
    ok(w.eval('DIM_KEYS.join(",")') === 'case,size,metric', 'and the schema follows it',
       w.eval('DIM_KEYS.join(",")'));
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws');
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
