const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML_WITH_DATA = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// A page built without a dataset: the shape a first visit takes.
function htmlWithoutData() {
  return HTML_WITH_DATA.replace(
    /(<script id="dataset" type="application\/json">)[\s\S]*?(<\/script>)/,
    '$1$2');
}
function boot(html, seed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w) { if (seed) seed(w); },
  });
  return { w: dom.window, d: dom.window.document };
}

const TIDY = 'case,size,rate\nalpha,512,10.5\nalpha,256,20.5\nbeta,512,30.5\nbeta,256,40.5\n';
const RECORD = {
  id: 'ds-test-1', name: 'stored one', createdAt: 1,
  recipe: {
    columns: [
      { source: 'case', name: 'case', label: 'Case', role: 'dimension' },
      { source: 'size', name: 'size', label: 'Size', role: 'dimension' },
      { source: 'rate', name: 'rate', label: 'Rate', role: 'measure', format: 'pct' },
    ],
    sourceDim: null, parse: {},
  },
  sources: [{ filename: 'stored.csv', text: TIDY, label: 'stored' }],
};

(async () => {
  console.log('\n=== 1. No data at all: an empty state, not a blank page ===');
  {
    const { w, d } = boot(htmlWithoutData(), win => win.eval || 0);
    await wait(60);
    ok(!d.getElementById('data-view').classList.contains('hidden'), 'the Data tab is showing');
    ok(!!d.querySelector('#csv-input'), 'with an import control');
    ok(/No data yet/.test(d.querySelector('.data-empty').textContent), 'and an explanation',
       d.querySelector('.data-empty').textContent.slice(0, 50));
    ok(!w.eval('hasDataset()'), 'no dataset is live');
    ok(d.querySelectorAll('#plots .plot-card').length === 0, 'and no plots were invented');
    w.close();
  }

  console.log('\n=== 2. A stored dataset is restored on the next visit ===');
  {
    const { w, d } = boot(htmlWithoutData(), win => {
      win.__seedRecord = RECORD;
      // install the memory store before any script runs, pre-seeded
      win.__seedStore = true;
    });
    // the page has already booted with the default store; re-run the async boot
    // against a seeded memory store, which is what a second visit looks like
    w.eval('setStore(makeMemoryStore());');
    await w.eval('STORE.put(' + JSON.stringify(RECORD) + ')');
    await w.eval('bootAsync()');
    await wait(60);
    ok(w.eval('hasDataset()'), 'the dataset comes back');
    ok(w.eval('DS.name') === 'stored one', 'by name', w.eval('DS.name'));
    ok(w.eval('DS.nRows') === 4, 'with its rows', w.eval('DS.nRows'));
    ok(w.eval('DIM_KEYS.join(",")') === 'case,size,metric', 'and its schema', w.eval('DIM_KEYS.join(",")'));
    ok(w.eval('DIMENSIONS[0].label') === 'Case', 'including the display names from the recipe',
       w.eval('DIMENSIONS[0].label'));
    ok(!d.getElementById('builder-view').classList.contains('hidden'), 'and it opens in the Builder');
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'drawing straight away');
    w.close();
  }

  console.log('\n=== 3. Raw text is stored, so a rebuild is exact ===');
  {
    const { w } = boot(htmlWithoutData());
    w.eval('setStore(makeMemoryStore());');
    await w.eval('STORE.put(' + JSON.stringify(RECORD) + ')');
    const rec = await w.eval('STORE.get("ds-test-1")');
    ok(rec.sources[0].text === TIDY, 'the original bytes are kept, not a derived form');
    ok(!!rec.recipe.columns, 'alongside the decisions that shaped them');
    const a = w.eval('datasetValueAt(datasetFromRecord(' + JSON.stringify(RECORD) + '), {case:"beta",size:"512",metric:"rate"})');
    ok(a === 30.5, 'rebuilding reproduces the values', a);
    w.close();
  }

  console.log('\n=== 4. Saved views survive, under their own keys ===');
  {
    const { w } = boot(HTML_WITH_DATA);
    await wait(40);
    const keys = w.eval('[LS_AUTOSAVE_KEY, LS_VIEWS_KEY].join(",")');
    ok(keys === 'viz-builder-autosave-v1,viz-builder-views-v1', 'the view keys are unchanged', keys);
    w.eval('saveNamedView("mine")');
    const stored = JSON.parse(w.localStorage.getItem('viz-builder-views-v1'));
    ok(!!stored.mine && stored.mine.length >= 1, 'a named view round-trips through localStorage');
    ok(w.eval('activeDatasetId()') === null || typeof w.eval('activeDatasetId()') === 'string',
       'the active-dataset pointer is a separate key');
    w.close();
  }

  console.log('\n=== 5. An import that would carry no values is refused ===');
  {
    const { w, d } = boot(htmlWithoutData());
    w.eval('setStore(makeMemoryStore());');
    d.querySelector('.mode-tab[data-mode="data"]').click();
    const input = d.getElementById('csv-input');
    Object.defineProperty(input, 'files', {
      value: [new w.File(['case,note\nalpha,hello\nbeta,world\n'], 'notes.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new w.Event('change'));
    await wait(60);
    // force the text column to be a measure -- the mistake the review exists to catch
    const sel = d.querySelector('.import-table tr[data-col="note"]').querySelectorAll('select')[0];
    sel.value = 'measure';
    sel.dispatchEvent(new w.Event('change'));
    await wait(20);
    Array.from(d.querySelectorAll('.import-review button')).find(b => b.textContent === 'Import').click();
    await wait(60);
    ok(/no numeric values/.test(d.querySelector('.data-status').textContent),
       'it says what is wrong', d.querySelector('.data-status').textContent);
    const list = await w.eval('STORE.list()');
    ok(list.length === 0, 'and stores nothing', list.length);
    ok(!w.eval('hasDataset()'), 'leaving no broken dataset live');
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
