// Several readings per axis: a pin may name more than one value on X or on Y,
// and each choice of one x value and one y value is drawn as its own series,
// in its own colour and shape -- data0 vs baseline and data1 vs baseline in
// one chart, not two charts and not one chart with the readings folded in.

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
const setType = (w, d, t) => {
  const s = d.querySelector('#plots .plot-head select:not(.plot-dataset)');
  s.value = t; s.dispatchEvent(new w.Event('change'));
};
const pinSel = (d, i, which, k) =>
  d.querySelectorAll('.pin-row[data-index="' + i + '"] .pin-' + which)[k];
const pinAxis = (d, i, which) =>
  d.querySelectorAll('.pin-row[data-index="' + i + '"] .pin-axis')[which === 'x' ? 0 : 1];
const dots = d => d.querySelectorAll('#plots .series-dot').length;
const notes = d => Array.from(d.querySelectorAll('#plots .chart-note')).map(e => e.textContent).join(' || ');
const empties = d => Array.from(d.querySelectorAll('#plots .plot-empty')).map(e => e.textContent).join(' || ');

// Import a single CSV and land on the builder with a correlation plot over the
// given pin row. Returns the pin row's selects as helpers.
async function importThenPin(csvText, over) {
  const { w, d } = boot();
  d.querySelector('.mode-tab[data-mode="data"]').click();
  pick(w, [{ name: 'runs.csv', text: csvText }]);
  await wait(60);
  Array.from(d.querySelectorAll('.import-review button')).find(b => b.textContent === 'Import').click();
  await wait(60);
  d.querySelector('.mode-tab[data-mode="builder"]').click();
  setType(w, d, 'correlation');
  const sel = d.querySelector('.pin-row[data-index="0"] .pin-over');
  sel.value = over; sel.dispatchEvent(new w.Event('change'));
  const setVal = (which, k, v) => {
    const s = d.querySelectorAll('.pin-row[data-index="0"] .pin-' + which)[k];
    s.value = v; s.dispatchEvent(new w.Event('change'));
  };
  return { w, d, setVal };
}

// data0 and data1 compared against one baseline, the way the feature was asked
// for. Float values so the import proposes the three columns as measures.
const CSV = `config,data0,data1,baseline
a,10.5,12.1,11.0
b,20.5,22.2,21.0
c,30.5,33.3,31.0
`;
// the reading the feature was asked for on a dimension instead: dataset0 and
// dataset1 against dataset2, all values of one dimension, one measure beneath
const DIM_CSV = `config,dataset,value
a,dataset0,10.5
a,dataset1,12.1
a,dataset2,11.0
b,dataset0,20.5
b,dataset1,22.2
b,dataset2,21.0
c,dataset0,30.5
c,dataset1,33.3
c,dataset2,31.0
`;

(async () => {
  console.log('\n=== 1. An axis holds several readings, one series each ===');
  {
    const { w, d, setVal } = await importThenPin(CSV, 'metric');
    setVal('x', 0, 'data0');
    setVal('y', 0, 'baseline');
    ok(w.eval('plots[0].pins[0].x') === 'data0'
       && w.eval('plots[0].pins[0].y') === 'baseline',
       'one reading to begin with', w.eval('JSON.stringify(plots[0].pins[0])'));

    // the ＋ on the X axis adds the next value not already there
    pinAxis(d, 0, 'x').querySelector('.pin-add-val').click();
    ok(Array.isArray(w.eval('plots[0].pins[0].x'))
       && w.eval('JSON.stringify(plots[0].pins[0].x)') === '["data0","data1"]',
       'X now reads data0 and data1', w.eval('JSON.stringify(plots[0].pins[0])'));
    ok(d.querySelectorAll('.pin-row[data-index="0"] .pin-x').length === 2,
       'and the strip shows a select per reading');

    const n = dots(d);
    ok(n === 6, 'three combinations × two readings = six dots', n);
    ok(empties(d) === '', 'nothing refused', empties(d));
    const items = Array.from(d.querySelectorAll('#plots .legend .item'));
    ok(items.length === 2, 'the key names both readings', items.length);
    const labels = items.map(it => it.querySelector('.legend-text').textContent);
    ok(labels[0] === 'data0 vs baseline' && labels[1] === 'data1 vs baseline',
       'each in full, "x vs y"', labels.join(' | '));
    const fills = items.map(it => {
      const s = it.querySelector('svg .swatch-mark, svg path, svg circle, .swatch');
      return s ? (s.getAttribute('fill') || s.style.background) : null;
    });
    ok(fills[0] && fills[1] && fills[0] !== fills[1], 'the two readings are drawn in different colours',
       fills.join(' vs '));
    const shapes = items.map(it => {
      const m = it.querySelector('svg .swatch-mark');
      return m && m.tagName === 'circle' ? 'circle'
        : m ? m.getAttribute('points') || 'poly' : null;
    });
    ok(!!shapes[0] && !!shapes[1] && shapes[0] !== shapes[1],
       'and in different shapes', shapes.join(' vs '));
    ok(/Pearson r = /.test(notes(d)), 'the correlation note is still there', notes(d).slice(0, 60));
    w.close();
  }

  console.log('\n=== 2. The exported csv carries a column pair per reading ===');
  await (async function () {
    const { w, d, setVal } = await importThenPin(CSV, 'metric');
    setVal('x', 0, 'data0');
    setVal('y', 0, 'baseline');
    pinAxis(d, 0, 'x').querySelector('.pin-add-val').click();

    d.querySelectorAll('#plots .leaf-tools button')[0].click();
    const csvTab = Array.from(d.querySelectorAll('#tex-modal .tex-tab')).find(t => t.title === 'chart.csv');
    csvTab.click();
    const csv = d.querySelector('#tex-modal textarea').value;
    const head = csv.split('\n')[0].split(',');
    ok(/,data0 vs baseline x,data0 vs baseline y,data1 vs baseline x,data1 vs baseline y$/.test(head.join(',')),
       'one x and one y column per reading', head.join(','));
    const rows = csv.split('\n').slice(1).filter(l => l.trim());
    ok(rows.length === 3, 'one row per combination', rows.length);
    ok(/^0,.*,10\.5,11,12\.1,11$/.test(rows[0]),
       'the first row reads data0=10.5, data1=12.1 against baseline 11', rows[0]);
    w.close();
  })();

  console.log('\n=== 3. Two values of one dimension against its third ===');
  await (async function () {
    const { w, d, setVal } = await importThenPin(DIM_CSV, 'dataset');
    setVal('x', 0, 'dataset0');
    setVal('y', 0, 'dataset2');
    pinAxis(d, 0, 'x').querySelector('.pin-add-val').click();
    ok(Array.isArray(w.eval('plots[0].pins[0].x'))
       && w.eval('JSON.stringify(plots[0].pins[0].x)') === '["dataset0","dataset1"]'
       && w.eval('plots[0].pins[0].y') === 'dataset2',
       'X holds dataset0 and dataset1, Y reads dataset2',
       w.eval('JSON.stringify(plots[0].pins[0])'));
    ok(dots(d) === 6, 'three configurations × two readings = six dots', dots(d));
    const labels = Array.from(d.querySelectorAll('#plots .legend .legend-text')).map(t => t.textContent);
    ok(labels[0] === 'dataset0 vs dataset2' && labels[1] === 'dataset1 vs dataset2',
       'the key names both readings', labels.join(' | '));
    ok(empties(d) === '', 'nothing refused', empties(d));
    w.close();
  })();

  console.log('\n=== 4. An axis cannot mix measures of different scale ===');
  {
    // the demo dataset has rates and counts, so the refusal can be built
    const { w, d } = boot();
    d.querySelector('.mode-tab[data-mode="builder"]').click();
    setType(w, d, 'correlation');
    w.eval('plots[0].pins = [{ over: "metric", x: ["rateA", "countA"], y: "rateB" }]; renderPlots();');
    ok(/different scale/.test(empties(d)), 'the chart refuses and says why', empties(d));
    w.eval('plots[0].pins = [{ over: "metric", x: ["rateA", "rateB"], y: "rateB" }]; renderPlots();');
    ok(empties(d) === '', 'two rates on one axis are fine', empties(d));
    ok(dots(d) > 0, 'and it draws', dots(d));
    w.close();
  }

  console.log('\n=== 5. Per-series overrides reach every reading ===');
  await (async function () {
    const { w, d, setVal } = await importThenPin(CSV, 'metric');
    setVal('x', 0, 'data0');
    setVal('y', 0, 'baseline');
    pinAxis(d, 0, 'x').querySelector('.pin-add-val').click();
    d.querySelector('.style-toggle').click();
    const rows = Array.from(d.querySelectorAll('.style-series'));
    ok(rows.length === 2, 'both readings get a per-series row in Style', rows.length);
    const labels = rows.map(r => r.querySelector('.style-label').textContent);
    ok(labels.join(' | ') === 'data0 vs baseline | data1 vs baseline',
       'each named after its reading', labels.join(' | '));
    ok(rows.every(r => r.querySelectorAll('input[type=color]').length === 1),
       'and each row has its own colour picker');
    // override only the second reading: the first must keep its colour
    const col = rows[1].querySelector('input[type=color]');
    col.value = '#ff0000';
    col.dispatchEvent(new w.Event('change'));
    ok(w.eval('plots[0].style.series["metric=data1"].color') === '#ff0000',
       'the override is stored against that reading',
       w.eval('JSON.stringify(plots[0].style.series["metric=data1"])'));
    ok(!w.eval('plots[0].style.series["metric=data0"]')
       || !w.eval('plots[0].style.series["metric=data0"].color'),
       'and the first reading is left alone');
    const fills = Array.from(d.querySelectorAll('#plots .series-dot')).map(el => el.getAttribute('fill'));
    ok(fills.indexOf('#ff0000') !== -1 && fills.indexOf('var(--series-base)') !== -1,
       'the dots carry both colours — red for data1, the measure colour for data0',
       Array.from(new Set(fills)).join(', '));
    w.close();
  })();

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  failures++;
  console.log('  FAIL: crashed — ' + e.message);
  console.log(e.stack);
  process.exit(1);
});