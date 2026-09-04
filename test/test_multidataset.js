// Plots from different datasets on one page.
//
// The page has always had one active dataset, and every plot read it. A plot
// may now name one of its own instead -- and a plot that names none goes on
// following the page exactly as before, which is what keeps every stored view,
// every autosave and every plot made before this working untouched.
//
// The whole suite runs with __STRICT_SCHEMA on, which makes the render assert
// that the schema in force belongs to the plot being drawn. A plot reading
// another dataset's dimensions draws a chart that looks entirely reasonable, so
// this is the one thing here that cannot be checked by looking at the output.

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
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'https://example.com/',
    beforeParse(w) { w.__STRICT_SCHEMA = true; },
  });
  const w = dom.window;
  w.eval('setStore(makeMemoryStore());');
  w.document.querySelector('.mode-tab[data-mode="data"]').click();
  return { w, d: w.document };
}
const cards = d => Array.from(d.querySelectorAll('.dataset-card'));
const cardNamed = (d, n) => cards(d).find(c => (c.querySelector('.dataset-name') || {}).textContent === n);
const cardBtn = (d, name, text) => Array.from(cardNamed(d, name).querySelectorAll('button'))
  .find(b => b.textContent === text);
const plotCards = d => Array.from(d.querySelectorAll('#plots .plot-card'));
const barsIn = card => card.querySelectorAll('rect.bar').length;
const chipsIn = card => Array.from(card.querySelectorAll('.zone-chip'))
  .map(z => (z.getAttribute('data-dim') || z.textContent)).join(',');
const status = d => (d.getElementById('builder-status') || {}).textContent || '';

async function importOne(w, d, name, text) {
  const input = d.getElementById('csv-input');
  Object.defineProperty(input, 'files',
    { value: [new w.File([text], name, { type: 'text/csv' })], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await wait(70);
  Array.from(d.querySelector('.import-review').querySelectorAll('button'))
    .find(b => b.textContent === 'Import').click();
  await wait(90);
  d.querySelector('.mode-tab[data-mode="data"]').click();
  await wait(40);
}
async function addPlotFrom(d, name) {
  cardBtn(d, name, 'Add a plot from this').click();
  await wait(150);
}

// two datasets with nothing in common: no shared dimension, no shared measure
const RUNS = 'device,size,rate\ndev1,512,10\ndev1,256,20\ndev2,512,30\ndev2,256,40\n';
const KERNELS = 'kernel,threads,speedup\nk1,64,1.5\nk1,128,2.5\nk2,64,3.5\nk2,128,4.5\n';

(async () => {
  console.log('\n=== 1. A plot from another dataset joins the page rather than replacing it ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    ok(w.eval('DS.name') === 'kernels', 'the last import is the page dataset', w.eval('DS.name'));
    ok(!!cardBtn(d, 'runs', 'Add a plot from this'), 'every stored dataset offers a plot of its own');

    await addPlotFrom(d, 'runs');
    ok(w.eval('plots.length') === 2, 'the page gained a plot rather than being rebuilt',
       w.eval('plots.length'));
    ok(!w.eval('plots[0].datasetId'), 'the plot that was there still follows the page');
    ok(!!w.eval('plots[1].datasetId'), 'and the new one names its own dataset');
    ok(w.eval('plots[1].datasetName') === 'runs', 'by name too, for when it is gone later',
       w.eval('plots[1].datasetName'));
    ok(w.eval('DS.name') === 'kernels', 'the page dataset is untouched', w.eval('DS.name'));

    const cs = plotCards(d);
    ok(cs.length === 2, 'both cards are drawn', cs.length);
    ok(barsIn(cs[0]) > 0 && barsIn(cs[1]) > 0, 'and both draw bars',
       barsIn(cs[0]) + ' + ' + barsIn(cs[1]));
    w.close();
  }

  console.log('\n=== 2. Each card offers its own dataset\'s dimensions, not the page\'s ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');

    const cs = plotCards(d);
    const page = chipsIn(cs[0]);
    const pinned = chipsIn(cs[1]);
    ok(/kernel/.test(page) && /threads/.test(page), 'the page plot has the page dataset\'s chips', page);
    ok(!/device|size/.test(page), 'and none of the other one\'s');
    ok(/device/.test(pinned) && /size/.test(pinned), 'the pinned plot has its own', pinned);
    ok(!/kernel|threads/.test(pinned), 'and none of the page\'s');

    const inc0 = JSON.parse(w.eval('JSON.stringify(Object.keys(plots[0].included))'));
    const inc1 = JSON.parse(w.eval('JSON.stringify(Object.keys(plots[1].included))'));
    const shared = inc0.filter(k => k !== 'metric' && inc1.indexOf(k) !== -1);
    ok(shared.length === 0, 'the two plots filter on disjoint sets of dimensions',
       inc0.join(',') + ' | ' + inc1.join(','));
    ok(w.eval('JSON.stringify(plots[1].included.metric)') === '["rate"]',
       'the pinned plot shows its own measure', w.eval('JSON.stringify(plots[1].included.metric)'));
    w.close();
  }

  console.log('\n=== 3. A plot can be pointed at another dataset, and back ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');

    const sels = Array.from(d.querySelectorAll('.plot-dataset'));
    ok(sels.length === 2, 'each card gets a dataset select once there are two', sels.length);
    ok(sels[0].value === '' && sels[1].value === w.eval('plots[1].datasetId'),
       'showing what each plot reads');
    const labels = Array.from(sels[0].options).map(o => o.textContent);
    ok(labels[0] === 'follow the page dataset' && labels.indexOf('runs') !== -1
       && labels.indexOf('kernels') !== -1, 'every loaded dataset is offered', labels.join(' | '));

    sels[1].value = '';
    sels[1].dispatchEvent(new w.Event('change'));
    await wait(120);
    ok(!w.eval('plots[1].datasetId'), 'set back to the page, the pin is dropped');
    ok(/kernel/.test(chipsIn(plotCards(d)[1])), 'and the plot now offers the page\'s dimensions',
       chipsIn(plotCards(d)[1]));
    ok(barsIn(plotCards(d)[1]) > 0, 'and still draws', barsIn(plotCards(d)[1]));

    const undo = Array.from(d.querySelectorAll('#builder-status button')).find(b => b.textContent === 'Undo');
    ok(!!undo, 'the change offers to take itself back');
    undo.click();
    await wait(120);
    ok(w.eval('plots[1].datasetName') === 'runs', 'and does', w.eval('plots[1].datasetName'));
    w.close();
  }

  console.log('\n=== 4. A view remembers which dataset each plot read ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');
    w.eval('saveNamedView("both")');

    const saved = JSON.parse(w.localStorage.getItem('viz-builder-views-v1')).both;
    ok(saved.length === 2, 'both plots are in the view', saved.length);
    ok(saved[0].datasetId === undefined,
       'a plot that follows the page records nothing — the view stays as portable as it was');
    ok(saved[1].datasetName === 'runs', 'a pinned plot records which dataset it is pinned to',
       saved[1].datasetName);

    // The plots are thrown away AND the pinned dataset is dropped from memory,
    // so loading the view has to go back to the store for it -- which is the
    // path a fresh page takes.
    const pinnedId = w.eval('plots[1].datasetId');
    w.eval('plots = []; renderPlots(); forgetDataset("' + pinnedId + '");');
    ok(!w.eval('loadedDataset("' + pinnedId + '")'), 'its dataset is not in memory any more');
    w.eval('loadNamedView("both")');
    await wait(200);
    ok(w.eval('plots.length') === 2, 'both come back', w.eval('plots.length'));
    ok(!w.eval('plots[0].datasetId') && w.eval('plots[1].datasetName') === 'runs',
       'each on the dataset it was on');
    ok(barsIn(plotCards(d)[1]) > 0, 'and the pinned one draws its own data again',
       barsIn(plotCards(d)[1]));
    w.close();
  }

  console.log('\n=== 5. A view of one dataset is untouched, and still lands on any other ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    w.eval('saveNamedView("plain")');
    const saved = JSON.parse(w.localStorage.getItem('viz-builder-views-v1')).plain;
    ok(Object.keys(saved[0]).indexOf('datasetId') === -1
       && Object.keys(saved[0]).indexOf('datasetName') === -1,
       'nothing about datasets is written into an ordinary view',
       Object.keys(saved[0]).join(','));
    await wait(350);                       // the autosave is debounced
    const auto = JSON.parse(w.localStorage.getItem('viz-builder-autosave-v1'));
    ok(Array.isArray(auto), 'and the autosave is still a bare array');
    ok(Object.keys(auto[0]).indexOf('datasetId') === -1, 'with nothing added to it');

    // the behaviour this must not break: apply it to different data
    await importOne(w, d, 'kernels.csv', KERNELS);
    ok(w.eval('DS.name') === 'kernels', 'a second dataset is open', w.eval('DS.name'));
    w.eval('loadNamedView("plain")');
    await wait(100);
    ok(w.eval('plots.length') === 1, 'the view loads with no prompt and no guard');
    ok(!w.eval('plots[0].datasetId'), 'it is not bound to the dataset it was saved on');
    ok(barsIn(plotCards(d)[0]) > 0, 'and it draws the data that IS open',
       barsIn(plotCards(d)[0]));
    ok(/kernel|threads/.test(chipsIn(plotCards(d)[0])), 'grouped by that data\'s dimensions',
       chipsIn(plotCards(d)[0]));
    w.close();
  }

  console.log('\n=== 6. Opening a dataset leaves pinned plots alone ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');
    const pinnedBefore = w.eval('JSON.stringify(plots[1].included)');

    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(40);
    cardBtn(d, 'runs', 'Open').click();
    await wait(200);

    ok(w.eval('DS.name') === 'runs', 'the page dataset changed', w.eval('DS.name'));
    ok(w.eval('plots.length') === 2, 'both plots are still there', w.eval('plots.length'));
    ok(w.eval('JSON.stringify(plots[1].included)') === pinnedBefore,
       'the pinned plot is exactly as it was');
    ok(/device|size/.test(chipsIn(plotCards(d)[0])),
       'the plot that follows the page now reads the newly opened dataset',
       chipsIn(plotCards(d)[0]));
    w.close();
  }

  console.log('\n=== 7. A dataset deleted underneath a plot does not take the plot with it ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');
    d.querySelector('.mode-tab[data-mode="data"]').click();
    await wait(40);
    cardBtn(d, 'runs', 'Delete').click();
    await wait(200);
    d.querySelector('.mode-tab[data-mode="builder"]').click();
    await wait(60);

    ok(w.eval('plots.length') === 2, 'the plot survives its dataset', w.eval('plots.length'));
    ok(w.eval('plots[1].datasetName') === 'runs',
       'and remembers what it was reading', w.eval('plots[1].datasetName'));
    ok(barsIn(plotCards(d)[1]) > 0, 'it falls back to the page dataset and draws',
       barsIn(plotCards(d)[1]));
    const note = d.querySelector('.plot-dataset-missing');
    ok(!!note && /is not loaded/.test(note.textContent), 'the card says what happened',
       note && note.textContent);
    w.close();
  }

  console.log('\n=== 8. A measure defined on one dataset is not forced onto plots of another ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');
    const pinnedMetric = w.eval('JSON.stringify(plots[1].included.metric)');

    w.eval('addCustomMeasure({ key: "twice", label: "Twice", format: makeFormat("number"),'
      + ' formula: compileFormula("speedup * 2", DS.measures, "number") })');
    await wait(80);
    ok(w.eval('METRIC_BY_KEY.twice !== undefined'), 'the measure lands on the page dataset');
    ok(w.eval('JSON.stringify(plots[1].included.metric)') === pinnedMetric,
       'the plot reading the other dataset is untouched',
       w.eval('JSON.stringify(plots[1].included.metric)'));
    ok(barsIn(plotCards(d)[1]) > 0, 'and still draws', barsIn(plotCards(d)[1]));
    w.close();
  }

  console.log('\n=== 9. Each plot exports its own data ===');
  {
    const { w, d } = boot();
    await importOne(w, d, 'runs.csv', RUNS);
    await importOne(w, d, 'kernels.csv', KERNELS);
    await addPlotFrom(d, 'runs');

    const tikz = Array.from(plotCards(d)[1].querySelectorAll('button'))
      .find(b => b.textContent === 'TikZ');
    ok(!!tikz, 'the pinned card has an export button');
    tikz.click();
    await wait(200);
    const panel = d.getElementById('tex-modal');
    const tabs = Array.from(panel.querySelectorAll('button')).map(b => b.textContent);
    ok(tabs.indexOf('imported: runs.csv') !== -1,
       'the files it ships are the ones that plot was built from', tabs.join(' | '));
    ok(tabs.indexOf('imported: kernels.csv') === -1,
       'not the ones behind whatever the page is showing');
    const drawn = Array.from(panel.querySelectorAll('textarea'))
      .map(a => a.value || '').join('\n');
    ok(/dev1/.test(drawn), 'and the figure is drawn from that dataset\'s values');
    ok(!/\bk1\b/.test(drawn), 'with none of the other one\'s');
    w.close();
  }

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
