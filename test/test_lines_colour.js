// Two axes that are actually two scales, lines that run along a dimension,
// colour that follows the measure, and a legend that shows what the chart drew.
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
  return { w: dom.window, d: dom.window.document };
}
const cols = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(cols(d)[1].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.trim().indexOf(p) === 0).click();
const setType = (w, d, t) => { const s = d.querySelectorAll('#plots .plot-head select')[0]; s.value = t; s.dispatchEvent(new w.Event('change')); };
const fire = (w, el, ev) => el.dispatchEvent(new w.Event(ev || 'change'));
const metricTo = (w, d, zone) => {
  const s = d.querySelector('#plots .zone-chip[data-dim="metric"] select');
  s.value = zone; fire(w, s);
};
const dualOn = (w, d) => {
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle'))
    .find(l => /second y-axis/.test(l.textContent));
  if (!lab) return false;
  const i = lab.querySelector('input');
  i.checked = true; fire(w, i);
  return true;
};

// two rates and a duration: three measures on two scales, the reported case
function threeKinds(w) {
  w.eval('setStore(makeMemoryStore());');
  const CSV = 'app,l1,l2,exectime\nA,62.1,88.4,0.42\nB,55.3,79.0,0.51\nC,71.8,90.2,0.33\n';
  const rec = { id: 'r', name: 'r', sources: [{ filename: 'r.csv', text: CSV }], recipe: { columns: [
    { source: 'app', name: 'app', label: 'App', role: 'dimension' },
    { source: 'l1', name: 'l1', label: 'L1 hit rate', role: 'measure', format: 'pct' },
    { source: 'l2', name: 'l2', label: 'L2 hit rate', role: 'measure', format: 'pct' },
    { source: 'exectime', name: 'exectime', label: 'Exec time', role: 'measure', format: 'duration' }] } };
  w.eval('startWithDataset(datasetFromRecord(' + JSON.stringify(rec) + '))');
}

console.log('\n=== 1. The second axis takes a SCALE, not one measure ===');
{
  // Splitting the series on format identity gave every measure its own group,
  // so "the first" and "the second" were L1 and L2 -- and the duration, the
  // whole reason the second axis was switched on, was drawn against neither
  // axis and disappeared without a word.
  const { w, d } = boot();
  threeKinds(w);
  add(d, 'L2 hit rate');
  add(d, 'Exec time');
  ok(w.eval('computeAxisPlan(plots[0]).dualEligible'), 'two scales make the second axis available');
  ok(dualOn(w, d), 'and it can be switched on');

  const bars = d.querySelectorAll('#plots rect.bar').length;
  ok(bars === 6, 'both rates are bars on the left axis: 2 measures x 3 apps', bars);
  const dots = d.querySelectorAll('#plots .series-dot').length;
  ok(dots === 3, 'the duration is drawn as a line on the right, not dropped', dots);
  const right = Array.from(d.querySelectorAll('#plots text.axis-right')).map(t => t.textContent);
  ok(right.some(t => /s$/.test(t)), 'and the right axis is labelled in its own unit', right.join(','));
  ok(!right.some(t => /%$/.test(t)), 'not in the left axis\'s', right.join(','));
  ok(d.querySelectorAll('#plots .plot-empty').length === 0, 'nothing refused to draw');
  const caps = Array.from(d.querySelectorAll('#plots .legend-cap')).map(t => t.textContent);
  ok(caps.length === 2 && /rate %/.test(caps[0]) && /duration/.test(caps[1]),
     'the legend names which scale is which side', caps.join(' | '));
  w.close();
}

console.log('\n=== 2. A tick keeps enough decimals to mean something ===');
{
  const { w } = boot();
  const dur = w.eval('JSON.stringify([0, 0.255, 0.51].map(function(t){ return tickLabel(makeFormat("duration"), t); }))');
  ok(dur === '["0s","0.255s","0.51s"]',
     'half a second no longer prints as three ticks reading 0s, 0s, 1s', dur);
  const small = w.eval('JSON.stringify([0.001, 12.34, 456.7].map(function(t){ return tickLabel(makeFormat("duration"), t); }))');
  ok(small === '["0.001s","12.3s","457s"]', 'decimals follow the magnitude', small);
  const big = w.eval('tickLabel(makeFormat("number"), 1234.5)');
  ok(big === '1235', 'a large number still rounds', big);
  w.close();
}

console.log('\n=== 3. Each axis has its own range and its own scale ===');
{
  const { w, d } = boot();
  threeKinds(w);
  add(d, 'Exec time');
  dualOn(w, d);
  const groups = d.querySelectorAll('#plots .yaxis-group');
  ok(groups.length === 2, 'two axes, two sets of controls', groups.length);
  ok(groups[0].textContent.indexOf('Y left') === 0
     && groups[1].textContent.indexOf('Y right') === 0, 'labelled by side',
     groups[0].textContent.slice(0, 6) + ' / ' + groups[1].textContent.slice(0, 7));

  const rightMax = groups[1].querySelectorAll('.yaxis-bound')[1];
  rightMax.value = '2';
  fire(w, rightMax);
  ok(w.eval('plots[0].yAxisRight.max') === 2, 'the right bound is its own');
  ok(w.eval('plots[0].yAxis.max') === null, 'and does not touch the left one');
  const right = Array.from(d.querySelectorAll('#plots text.axis-right')).map(t => t.textContent);
  ok(right.indexOf('2s') !== -1, 'the right axis really is drawn to it', right.join(','));

  const scale = d.querySelectorAll('#plots .yaxis-group')[1].querySelector('.yaxis-scale');
  scale.value = 'log';
  fire(w, scale);
  ok(w.eval('plots[0].yAxisRight.scale') === 'log', 'and log/linear is per axis too');
  ok(w.eval('JSON.stringify(serializePlots()[0].yAxisRight)') === '{"min":null,"max":2,"scale":"log"}',
     'it is saved', w.eval('JSON.stringify(serializePlots()[0].yAxisRight)'));
  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('plots[0].yAxisRight.max') === 2, 'and restored');
  w.close();
}

console.log('\n=== 4. Line settings are reachable from a chart that draws lines ===');
{
  const { w, d } = boot();
  threeKinds(w);
  add(d, 'Exec time');
  d.querySelector('#plots .style-toggle').click();     // stays open across redraws
  ok(!d.querySelector('#plots .style-markers'),
     'a plain bar chart offers no marker settings');

  dualOn(w, d);
  ok(!!d.querySelector('#plots .style-markers'),
     'but a bar chart with a second axis draws lines, so it offers them');
  ok(!!d.querySelector('#plots .style-linewidth'), 'line width as well');
  ok(!!d.querySelector('#plots .style-pattern'), 'and it still offers the bar settings');
  const perSeries = d.querySelector('#plots .style-series');
  ok(!!perSeries.querySelector('.style-series-shape') && !!perSeries.querySelector('.style-series-pattern'),
     'per series, both — the chart has both kinds of mark on it');
  w.close();
}

console.log('\n=== 5. A line can be told which dimension it runs along ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const sel = d.querySelector('#plots .line-along');
  ok(!!sel, 'the choice is offered where the x-axis nests');
  ok(sel.value === '', 'following the axis is the default — the old behaviour');
  const opts = Array.from(sel.options).map(o => o.value);
  ok(opts.join(',') === ',device,size,app', 'one entry per x dimension', opts.join(','));

  const before = d.querySelectorAll('#plots polyline.series-line').length;
  sel.value = 'size';
  fire(w, sel);
  const after = d.querySelectorAll('#plots polyline.series-line').length;
  ok(after !== before, 'choosing one redraws the lines', before + ' -> ' + after);
  ok(after > 0, 'and there are lines to see', after);
  ok(w.eval('serializePlots()[0].lineAlong') === 'size', 'it is saved');
  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('plots[0].lineAlong') === 'size', 'and restored');
  w.eval('applyConfig([{"chartType":"lines","lineAlong":"nosuchdim"}])');
  ok(w.eval('plots[0].lineAlong') === null, 'a dimension that no longer exists is dropped');
  w.close();
}

console.log('\n=== 6. Along a dimension, a missing value is stepped over ===');
{
  const { w } = boot();
  // Three x positions, the middle one empty. Following the axis that is two
  // runs of one point -- no line at all. Along the dimension it is one line
  // from the first point to the last, which is the difference between "not
  // measured here" and "the series ends here".
  const xVals = [{ vals: { a: '1' } }, { vals: { a: '2' } }, { vals: { a: '3' } }];
  const runs = w.eval('JSON.stringify(lineRunsFor('
    + JSON.stringify(xVals) + ', ["a"], "a"))');
  ok(runs === '[[0,1,2]]', 'one run over every position when only that dimension varies', runs);

  const two = [{ vals: { g: 'x', a: '1' } }, { vals: { g: 'y', a: '1' } },
    { vals: { g: 'x', a: '2' } }, { vals: { g: 'y', a: '2' } }];
  const r2 = w.eval('JSON.stringify(lineRunsFor(' + JSON.stringify(two) + ', ["g","a"], "a"))');
  ok(r2 === '[[0,2],[1,3]]',
     'and a run need not be contiguous on the axis — that is the whole point', r2);
  ok(w.eval('lineRunsFor(' + JSON.stringify(two) + ', ["g","a"], "nope")') === null,
     'a dimension not on the axis names no runs');
  w.close();
}

console.log('\n=== 7. Colour can follow the metric instead of the series ===');
{
  const { w, d } = boot();
  add(d, 'Rate B');
  metricTo(w, d, 'x');                 // metric on the axis: one colour for everything
  const fill = r => r.getAttribute('fill');
  const before = new Set(Array.from(d.querySelectorAll('#plots rect.bar')).map(fill));
  d.querySelector('#plots .style-toggle').click();
  const sel = d.querySelector('#plots .style-colour-by');
  ok(!!sel, 'the choice is offered once two measures are shown');
  ok(sel.value === 'series', 'colouring by series stays the default');

  sel.value = 'metric';
  fire(w, sel);
  const after = Array.from(d.querySelectorAll('#plots rect.bar')).map(fill);
  ok(new Set(after).size === 2, 'each measure now has its own colour',
     Array.from(new Set(after)).join(','));
  ok(new Set(after).size !== before.size || Array.from(new Set(after)).join(',') !== Array.from(before).join(','),
     'which is a different picture from before');
  const keys = Array.from(d.querySelectorAll('#plots .metric-legend .item')).map(i => i.textContent);
  ok(keys.length === 2 && keys.some(t => /Rate A/.test(t)) && keys.some(t => /Rate B/.test(t)),
     'and there is a key for it', keys.join(' | '));
  ok(w.eval('serializePlots()[0].style.colourBy') === 'metric', 'saved with the plot');
  w.close();
}

console.log('\n=== 8. With Metric as the series, one legend is enough ===');
{
  const { w, d } = boot();
  add(d, 'Rate B');
  metricTo(w, d, 'series');
  d.querySelector('#plots .style-toggle').click();
  const sel = d.querySelector('#plots .style-colour-by');
  sel.value = 'metric';
  fire(w, sel);
  ok(d.querySelectorAll('#plots .metric-legend').length === 0,
     'the series legend already names the measures, so no second key is drawn');
  ok(d.querySelectorAll('#plots .legend').length > 0, 'the series legend is still there');
  w.close();
}

console.log('\n=== 9. The legend shows what the chart actually drew ===');
{
  const { w, d } = boot();
  // a texture set on ONE series, with the plot-wide setting still "solid"
  d.querySelector('#plots .style-toggle').click();
  ok(d.querySelector('#plots .style-pattern').value === 'none', 'textures are off plot-wide');
  ok(d.querySelectorAll('#plots .legend .swatch-svg').length === 0, 'so the key is flat squares');

  const one = d.querySelector('#plots .style-series-pattern');
  one.value = 'diagonal';
  fire(w, one);
  const drawn = d.querySelectorAll('#plots rect.bar-texture').length;
  ok(drawn > 0, 'the bars of that series are textured', drawn);
  const keys = d.querySelectorAll('#plots .legend .swatch-svg');
  ok(keys.length > 0, 'and the key stops claiming they are told apart by colour alone', keys.length);
  w.close();
}

console.log('\n=== 10. A composite legend label says the varying part ===');
{
  const { w } = boot();
  const same = w.eval('JSON.stringify(trimSeriesLabels(['
    + '{labels:["dev1","512","base"], label:"dev1 · 512 · base"},'
    + '{labels:["dev1","512","tuned"], label:"dev1 · 512 · tuned"}]))');
  const o = JSON.parse(same);
  ok(o.labels.join(',') === 'base,tuned', 'what every series agrees on is dropped', o.labels.join(','));
  ok(o.shared.join(',') === 'dev1,512', 'and said once instead', o.shared.join(','));

  const allDiff = JSON.parse(w.eval('JSON.stringify(trimSeriesLabels(['
    + '{labels:["a"], label:"a"},{labels:["b"], label:"b"}]))'));
  ok(allDiff.labels.join(',') === 'a,b' && allDiff.shared.length === 0,
     'nothing is dropped when nothing is shared');
  const single = JSON.parse(w.eval('JSON.stringify(trimSeriesLabels(['
    + '{labels:["x"], label:"x"},{labels:["x"], label:"x"}]))'));
  ok(single.labels.join(',') === 'x,x',
     'and two series that read alike keep their labels rather than losing them both',
     single.labels.join(','));
  w.close();
}

console.log('\n=== 11. Both keys reach every export ===');
{
  const { w, d } = boot();
  add(d, 'Rate B');
  metricTo(w, d, 'x');
  d.querySelector('#plots .style-toggle').click();
  const sel = d.querySelector('#plots .style-colour-by');
  sel.value = 'metric';
  fire(w, sel);
  ok(d.querySelectorAll('#plots .legend').length === 2, 'the chart has two keys',
     d.querySelectorAll('#plots .legend').length);

  const svg = w.eval('(function(){ var s = svgSource('
    + 'document.getElementById("plot-render-" + plots[0].id), window);'
    + 'return s ? s.text : ""; })()');
  ok(/Rate A/.test(svg) && /Rate B/.test(svg),
     'and the SVG export carries the measure names, not only the series ones');

  const tex = w.eval('buildTikzDocument(document.getElementById("plot-render-" + plots[0].id), window, "x") || ""');
  ok(/Rate A/.test(tex) && /Rate B/.test(tex), 'so does the TikZ export');

  // pgfplots gives one colour per \addplot, which this chart is not
  const shell = w.eval('(function(){ var s = document.querySelector("#plots .leaf-shell");'
    + 'return s && s.__vizData ? JSON.stringify(s.__vizData.colourPerPoint) : "none"; })()');
  ok(shell === 'true', 'the data table records that colour varies within a series', shell);
  const pgf = w.eval('(function(){ var s = document.querySelector("#plots .leaf-shell");'
    + 'return pgfplotsFor(s.__vizData, "d.csv", "", window, null).join("\\n"); })()');
  ok(/colour follows the metric/.test(pgf),
     'and the pgfplots export says it cannot reproduce that rather than quietly differing',
     pgf.split('\n').slice(0, 4).join(' / '));
  w.close();
}

console.log('\n=== 12. Layout presets say which dimensions they move ===');
{
  const { w, d } = boot();
  const btns = Array.from(d.querySelectorAll('#builder-toolbar .preset-group button'));
  ok(btns.length >= 2, 'there are presets', btns.length);
  ok(btns.every(b => !/^(Nested|Faceted|Side by side)$/.test(b.textContent)),
     'none is named after the shape of the result alone',
     btns.map(b => b.textContent).join(' | '));
  ok(btns.every(b => /Dataset|Device|Size|Application|Variant|Default/.test(b.textContent)),
     'every label names a dimension', btns.map(b => b.textContent).join(' | '));
  ok(btns.every(b => /x-axis|colour|chart per/.test(b.title)),
     'and the hint spells the whole layout out', btns[1].title);
  const titles = btns.map(b => b.title);
  ok(new Set(titles).size === titles.length,
     'no two presets do the same thing under different names', titles.join(' | '));

  const before = w.eval('JSON.stringify(plots[0].zones)');
  btns[btns.length - 1].click();
  ok(w.eval('JSON.stringify(plots[0].zones)') !== before, 'pressing one changes the layout');
  const undo = Array.from(d.querySelectorAll('#builder-status button')).find(b => b.textContent === 'Undo');
  ok(!!undo, 'the largest change on the page offers to take itself back');
  undo.click();
  ok(w.eval('JSON.stringify(plots[0].zones)') === before, 'and does', w.eval('JSON.stringify(plots[0].zones)'));
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
