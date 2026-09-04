// The correlation plot: one dot per combination, two readings of it.
//
// X and Y differ only in what the plot pins -- one value of a dimension against
// another, and Metric is a dimension here like any other, so "one measure
// against another" is the same control. A dot above the 45 degree line is a
// combination whose Y reading is the larger, which is the question the chart
// exists to answer; it only asks that question when both axes are the same
// quantity, and says so when they are not.

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
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}

const setType = (w, d, t) => {
  const s = d.querySelector('#plots .plot-head select');
  s.value = t; s.dispatchEvent(new w.Event('change'));
};
const setZone = (w, d, dim, z) => {
  const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select');
  s.value = z; s.dispatchEvent(new w.Event('change'));
};
const setPin = (w, d, i, field, value) => {
  const s = d.querySelector('.pin-row[data-index="' + i + '"] .pin-' + field);
  s.value = value; s.dispatchEvent(new w.Event('change'));
};
const addMetric = (w, d, label) => {
  const cols = d.querySelectorAll('.data-shown-block .dual-col');
  Array.from(cols[1].querySelectorAll('.dnd-chip'))
    .find(c => c.textContent.indexOf(label) !== -1).querySelector('button').click();
};
const dots = d => d.querySelectorAll('#plots .series-dot').length;
const notes = d => Array.from(d.querySelectorAll('#plots .chart-note')).map(e => e.textContent).join(' || ');
const empties = d => Array.from(d.querySelectorAll('#plots .plot-empty')).map(e => e.textContent).join(' || ');

// Every coordinate finite, every label free of the words a broken number leaves
// behind. Extended past the shared scanner with the shapes this leaf adds.
function anomalies(d) {
  const bad = [];
  d.querySelectorAll('#plots svg *').forEach(node => {
    ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'points'].forEach(a => {
      if (!node.hasAttribute(a)) return;
      const v = node.getAttribute(a);
      if (!/^[-\d.,\s]+$/.test(v) || /NaN|Infinity/.test(v)) bad.push(node.tagName + '@' + a + '=' + v);
    });
    if (node.tagName === 'text' && /NaN|undefined/.test(node.textContent)) {
      bad.push('text: ' + node.textContent);
    }
  });
  return bad;
}

console.log('\n=== 1. It is offered, and it draws ===');
{
  const { w, d } = boot();
  ok(Array.from(d.querySelectorAll('#plots .plot-head select')[0].options).map(o => o.value).join(',')
     === 'bars,lines,diverging,correlation,matrix,table',
     'it is in the chart-type list, beside the other cartesian types',
     Array.from(d.querySelectorAll('#plots .plot-head select')[0].options).map(o => o.value).join(','));
  setType(w, d, 'correlation');
  ok(w.eval('plots[0].pins.length') === 1,
     'switching to it proposes a first pin rather than an empty frame',
     w.eval('JSON.stringify(plots[0].pins)'));
  ok(d.querySelectorAll('.pin-row').length === 1, 'with one row in the Pins strip',
     d.querySelectorAll('.pin-row').length);
  ok(dots(d) > 0, 'and it draws dots', dots(d));
  ok(d.querySelectorAll('#plots rect.bar').length === 0
     && d.querySelectorAll('#plots polyline.series-line').length === 0,
     'and nothing else — no bars, no lines');
  ok(d.querySelectorAll('#plots line.diag-line').length === 1,
     'one 45° line, since both axes are the same measure');
  ok(!empties(d), 'nothing is refused', empties(d));
  ok(anomalies(d).length === 0, 'every coordinate is a number', anomalies(d).slice(0, 3).join(' ; '));
  w.close();
}

console.log('\n=== 2. A dot is a combination, read twice ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  const both = dots(d);
  ok(both === 55, 'one dot per device × size × app that has both variants', both);
  ok(w.eval('DIM_BY_KEY.variant.values.length') === 3
     && d.querySelectorAll('.pin-y option').length === 3,
     'the value pickers offer the dimension\'s own values',
     d.querySelectorAll('.pin-y option').length);

  setPin(w, d, 0, 'y', 'tunedAlt');
  ok(dots(d) === 11 && dots(d) < both,
     'a variant only some apps have gives only the combinations that have both', dots(d));
  ok(anomalies(d).length === 0, 'and still no broken coordinate');

  // both sides the same: every dot must sit exactly on the line
  setPin(w, d, 0, 'y', 'base');
  ok(/ 0 above the line/.test(notes(d)) && /55 on it/.test(notes(d)),
     'pinning both sides to one value puts every dot on the line', notes(d));
  w.close();
}

console.log('\n=== 3. The pinned dimension stops telling dots apart ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  const chip = d.querySelector('#plots .zone-chip[data-dim="variant"]');
  ok(!!chip, 'the chip stays where the user put it');
  ok(!!chip.querySelector('.order-num.pinned'), 'and says it is pinned');
  ok(/the two axes differ in this/.test(notes(d)),
     'the chart says so too, under it', notes(d));
  ok(dots(d) === 55, 'the dots are not multiplied by the variant it has consumed', dots(d));
  ok(d.querySelectorAll('#plots .legend .item').length === 0,
     'and with nothing left in Series there is no key to draw',
     d.querySelectorAll('#plots .legend .item').length);

  // the same dimension, still doing its old job, once the pin is taken off
  d.querySelector('.pin-remove').click();
  ok(w.eval('plots[0].pins.length') === 0, 'removing the row empties the pins');
  ok(/Nothing to correlate yet/.test(empties(d)),
     'and the chart asks for one rather than drawing something arbitrary', empties(d));
  w.close();
}

console.log('\n=== 4. Two rows: the axes differ in two things at once ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  d.querySelector('.pin-add').click();
  ok(w.eval('plots[0].pins.length') === 2, 'a second row is added',
     w.eval('JSON.stringify(plots[0].pins)'));
  setPin(w, d, 1, 'over', 'metric');
  setPin(w, d, 1, 'x', 'rateA');
  setPin(w, d, 1, 'y', 'rateB');
  const titles = Array.from(d.querySelectorAll('#plots text.axis-title')).map(t => t.textContent);
  ok(titles.length === 2, 'both axes are named', titles.join(' / '));
  ok(/Rate A/.test(titles[0]) && /Base/.test(titles[0]),
     'the x title names its measure and its pinned value', titles[0]);
  ok(/Rate B/.test(titles[1]) && /Tuned/.test(titles[1]),
     'and the y title names the other of each', titles[1]);
  ok(dots(d) > 0 && anomalies(d).length === 0, 'and it still draws cleanly', dots(d));
  w.close();
}

console.log('\n=== 5. Two measures on different scales: drawn, without a line ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  addMetric(w, d, 'Count A');
  setPin(w, d, 0, 'over', 'metric');
  setPin(w, d, 0, 'x', 'rateA');
  setPin(w, d, 0, 'y', 'countA');
  ok(!empties(d), 'the "mixes metrics of different scale" refusal does not fire', empties(d));
  ok(d.querySelectorAll('#plots .metric-panel').length === 0,
     'and it is not split into a panel per scale — that would be two charts of one measure each',
     d.querySelectorAll('#plots .metric-panel').length);
  ok(dots(d) > 0, 'the dots are drawn', dots(d));
  ok(d.querySelectorAll('#plots line.diag-line').length === 0,
     'with no 45° line: a rate is not above or below a count');
  ok(/different quantities/.test(notes(d)), 'and the chart says why', notes(d));
  const axes = Array.from(d.querySelectorAll('.yaxis-group')).map(g => g.getAttribute('data-axis'));
  ok(axes.join(',') === 'yAxis,xAxis', 'each axis gets its own range control', axes.join(','));
  ok(anomalies(d).length === 0, 'nothing broken by the two scales',
     anomalies(d).slice(0, 3).join(' ; '));
  w.close();
}

console.log('\n=== 6. Two measures on one scale: one range, and a real 45° ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  addMetric(w, d, 'Rate B');
  setPin(w, d, 0, 'over', 'metric');
  setPin(w, d, 0, 'x', 'rateA');
  setPin(w, d, 0, 'y', 'rateB');
  const line = d.querySelector('#plots line.diag-line');
  ok(!!line, 'the line is drawn, because both axes are rates');
  const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1');
  const x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
  ok(x1 === 0 && y2 === 0 && x2 === y1,
     'corner to corner of a square frame, so 45° on screen is 45°',
     [x1, y1, x2, y2].join(','));
  const axes = Array.from(d.querySelectorAll('.yaxis-group')).map(g => g.getAttribute('data-axis'));
  ok(axes.join(',') === 'yAxis', 'one range control for both axes, since they share a range',
     axes.join(','));
  ok(!d.querySelector('.one-axis-toggle'),
     'and no "one shared y-axis" offer — this chart has no arrangement to force');
  w.close();
}

console.log('\n=== 7. What the dots add up to ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  const n = dots(d);
  const m = notes(d).match(/(\d+) points — (\d+) above the line[^,]*, (\d+) below, (\d+) on it/);
  ok(!!m, 'the counts are stated', notes(d).split('||')[0]);
  ok(m && +m[1] === n, 'the total is the number of dots drawn', m && m[1] + '/' + n);
  ok(m && (+m[2] + +m[3] + +m[4]) === n, 'and above + below + on accounts for all of them',
     m && [m[2], m[3], m[4]].join('+'));
  ok(/Pearson r = -?\d/.test(notes(d)) && /R² = \d/.test(notes(d)),
     'r and R² are reported', notes(d).split('||')[1]);
  ok(/Lin's ρc = -?\d/.test(notes(d)),
     'and Lin\'s concordance ρc, since both axes are the same measure', notes(d).split('||')[2]);
  ok(!/NaN|undefined/.test(notes(d)), 'with no NaN anywhere in them', notes(d));
  w.close();
}

console.log('\n=== 7b. No concordance metric where there is no line of equality ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  addMetric(w, d, 'Count A');
  setPin(w, d, 0, 'over', 'metric');
  setPin(w, d, 0, 'x', 'rateA');
  setPin(w, d, 0, 'y', 'countA');
  ok(/Pearson r = -?\d/.test(notes(d)) && /R² = \d/.test(notes(d)),
     'r and R² are still reported across the two quantities', notes(d));
  ok(!/ρc/.test(notes(d)),
     'but no ρc: a rate against a count has no y = x line to agree with', notes(d));
  w.close();
}

console.log('\n=== 8. The band, and the dot labels ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  ok(d.querySelectorAll('#plots polygon.tol-band').length === 1,
     'the ±10% band is drawn with the line');
  ok(d.querySelectorAll('#plots path').length === 0,
     'as a polygon — no <path>, which no exporter here understands',
     d.querySelectorAll('#plots path').length);
  d.querySelector('.style-toggle').click();
  const band = d.querySelector('.style-diag-band');
  ok(!!band && band.checked, 'the switch is in Style, on by default');
  band.checked = false;
  band.dispatchEvent(new w.Event('change'));
  ok(d.querySelectorAll('#plots polygon.tol-band').length === 0, 'turning it off removes it');

  ok(d.querySelectorAll('#plots text.dot-label').length === 0, 'dots are unlabelled by default');
  const labels = d.querySelector('.style-value-labels');
  labels.checked = true;
  labels.dispatchEvent(new w.Event('change'));
  ok(d.querySelectorAll('#plots text.dot-label').length === dots(d),
     'turning labels on names every dot', d.querySelectorAll('#plots text.dot-label').length);
  ok(!/undefined/.test(Array.from(d.querySelectorAll('#plots text.dot-label')).map(t => t.textContent).join()),
     'with the combination it stands for, not a broken string');
  ok(anomalies(d).length === 0, 'and nothing malformed');
  w.close();
}

console.log('\n=== 9. Facets, averaging, and a pinned facet dimension ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  setZone(w, d, 'app', 'off');
  ok(dots(d) === 11, 'a dimension moved to "Not used" is averaged into the dots, not dropped', dots(d));
  setZone(w, d, 'device', 'facet');
  ok(d.querySelectorAll('#plots .facet-card').length === 3, 'facets still split the page',
     d.querySelectorAll('#plots .facet-card').length);
  ok(d.querySelectorAll('#plots line.diag-line').length === 3, 'each card gets its own line',
     d.querySelectorAll('#plots line.diag-line').length);
  ok(anomalies(d).length === 0, 'with every card drawn cleanly');
  w.close();

  // Dataset facets by default with ONE value included, so pinning it proves the
  // pin reads the dimension's own values rather than the shown list.
  const b = boot();
  setType(b.w, b.d, 'correlation');
  setPin(b.w, b.d, 0, 'over', 'dataset');
  ok(b.w.eval('plots[0].included.dataset.length') === 1,
     'the dataset dimension shows one value');
  ok(b.d.querySelectorAll('.pin-y option').length === 2,
     'but both are offered to pin', b.d.querySelectorAll('.pin-y option').length);
  ok(dots(b.d) === 121 && !empties(b.d),
     'and the chart reads the one that is not shown', dots(b.d) + ' ' + empties(b.d));
  b.w.close();
}

console.log('\n=== 10. Exports carry the points, not the row numbers ===');
{
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  d.querySelectorAll('#plots .leaf-tools button')[0].click();
  const parts = {};
  Array.from(d.querySelectorAll('#tex-modal .tex-tab')).forEach(t => {
    t.click();
    parts[t.title] = d.querySelector('#tex-modal textarea').value;
  });
  const csv = parts['chart.csv'];
  ok(/,All x,All y$/m.test(csv.split('\n')[0]),
     'the csv carries an x and a y column per series', csv.split('\n')[0]);
  ok(csv.split('\n')[1].split(',').length === csv.split('\n')[0].split(',').length,
     'and every row matches the header');
  const pgf = parts['chart-pgfplots.tex'];
  ok(/only marks/.test(pgf), 'pgfplots draws marks');
  ok(!/coordindex/.test(pgf),
     'against the two columns rather than against the row number — which would be a different figure');
  ok(/x index=\d+, y index=\d+/.test(pgf), 'naming both', (pgf.match(/x index=\d+, y index=\d+/) || [])[0]);
  ok(/\] \{x\};/.test(pgf) && /axis equal/.test(pgf),
     'with the diagonal, on equal axes');
  ok(/1\.1\*x/.test(pgf) && /0\.9\*x/.test(pgf), 'and the band either side of it');
  const drawn = parts['chart.tex'];
  ok((drawn.match(/\\path/g) || []).length === dots(d),
     'the drawn TikZ has every dot', (drawn.match(/\\path/g) || []).length);
  ok(/dash pattern/.test(drawn), 'and the diagonal keeps its dash, which comes from the stylesheet');
  ok(!/[^\x00-\x7F]/.test(drawn + pgf), 'both are plain ASCII');
  w.close();
}

console.log('\n=== 11. The pins survive saving, duplicating and undo ===');
(async function () {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const { w, d } = boot();
  setType(w, d, 'correlation');
  setPin(w, d, 0, 'over', 'variant');
  setPin(w, d, 0, 'y', 'tunedAlt');
  await wait(600);
  const raw = w.localStorage.getItem('viz-builder-autosave-v1');
  const saved = JSON.parse(raw);
  ok(JSON.stringify(saved[0].pins) === '[{"over":"variant","x":"base","y":"tunedAlt"}]',
     'the autosave holds the pins', JSON.stringify(saved[0].pins));

  const back = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'https://example.com/',
    beforeParse(win) { win.localStorage.setItem('viz-builder-autosave-v1', raw); },
  });
  const bw = back.window, bd = bw.document;
  bd.querySelector('.mode-tab[data-mode="builder"]').click();
  ok(bw.eval('plots[0].chartType') === 'correlation'
     && bw.eval('JSON.stringify(plots[0].pins)') === JSON.stringify(saved[0].pins),
     'and a fresh page comes back to the same chart',
     bw.eval('JSON.stringify(plots[0].pins)'));
  ok(bd.querySelectorAll('#plots .series-dot').length === 11, 'drawing the same dots',
     bd.querySelectorAll('#plots .series-dot').length);
  bw.close();

  // Duplicate must not share the row objects
  Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Duplicate').click();
  ok(w.eval('plots.length') === 2, 'the plot duplicates');
  w.eval('plots[0].pins[0].x = "tuned"');
  ok(w.eval('plots[1].pins[0].x') === 'base',
     'and the copy has pins of its own rather than the original\'s',
     w.eval('plots[1].pins[0].x'));

  // undo restores the snapshot, pins included
  w.eval('plots[0].pins[0].x = "base"; renderPlots();');
  setZone(w, d, 'size', 'facet');
  const undo = Array.from(d.querySelectorAll('button')).find(b => /Undo/.test(b.textContent));
  if (undo) {
    undo.click();
    ok(w.eval('JSON.stringify(plots[0].pins)') === JSON.stringify(saved[0].pins),
       'an undone zone change leaves the pins as they were',
       w.eval('JSON.stringify(plots[0].pins)'));
  } else {
    ok(true, 'no undo button offered here — nothing to check');
  }
  w.close();
  await section12();
})();

async function section12() {
  console.log('\n=== 12. A view naming pins this data has not got ===');
  const { w, d } = boot();
  const load = cfg => w.eval('applyConfig(' + JSON.stringify(cfg) + ')');
  load([{ chartType: 'correlation', pins: [{ over: 'nosuchdim', x: 'a', y: 'b' }] }]);
  ok(w.eval('JSON.stringify(plots[0].pins)') === '[]',
     'a pin over a dimension that no longer exists is dropped',
     w.eval('JSON.stringify(plots[0].pins)'));
  ok(/Nothing to correlate/.test(empties(d)), 'and the chart says what it needs', empties(d));

  load([{ chartType: 'correlation', pins: [{ over: 'variant', x: 'ghost', y: 'base' }] }]);
  ok(w.eval('JSON.stringify(plots[0].pins)') === '[]',
     'so is one naming a value that no longer exists');

  load([{ chartType: 'correlation', pins: 'nonsense' }]);
  ok(w.eval('JSON.stringify(plots[0].pins)') === '[]', 'and so is a pins field that is not a list');

  load([{ chartType: 'correlation',
    pins: [{ over: 'variant', x: 'base', y: 'tuned' }, { over: 'variant', x: 'base', y: 'tuned' }] }]);
  ok(w.eval('plots[0].pins.length') === 1,
     'the same dimension twice is one pin, not two', w.eval('plots[0].pins.length'));
  // a bare config carries no zones or included lists, so it opens on the
  // repaired defaults rather than on the layout section 2 built by hand
  ok(dots(d) > 0 && !empties(d) && anomalies(d).length === 0,
     'and the repaired view draws', dots(d) + ' dots ' + empties(d));
  w.close();

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}
