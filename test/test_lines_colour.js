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

console.log('\n=== 3b. Panels get an axis each, and three scales say why ===');
{
  const { w, d } = boot();
  threeKinds(w);
  add(d, 'L2 hit rate');
  add(d, 'Exec time');
  const tags = () => Array.from(d.querySelectorAll('#plots .yaxis-group'))
    .map(g => g.getAttribute('data-axis'));
  ok(w.eval('JSON.stringify(computeAxisPlan(plots[0]).metricPanels)') === '[["l1","l2"],["exectime"]]',
     'two rates share a panel, the duration has its own');
  ok(tags().length === 2, 'so there are two sets of axis controls, not one',
     JSON.stringify(tags()));
  const caps = Array.from(d.querySelectorAll('#plots .yaxis-label')).map(t => t.textContent);
  ok(caps.join(' | ') === 'Y · rate % | Y · duration', 'each named by the scale it sets',
     caps.join(' | '));

  // the second panel's maximum must not be the first panel's
  const second = d.querySelectorAll('#plots .yaxis-group')[1].querySelectorAll('.yaxis-bound')[1];
  second.value = '1';
  fire(w, second);
  ok(w.eval('plots[0].yAxis.max') === null, 'setting it leaves the first panel alone');
  ok(w.eval('JSON.stringify(plots[0].yAxisBy)') === '{"duration|s":{"min":null,"max":1,"scale":"auto"}}',
     'it is stored against the scale, not a position',
     w.eval('JSON.stringify(plots[0].yAxisBy)'));
  const ticks = Array.from(d.querySelectorAll('#plots text.axis-label')).map(t => t.textContent);
  ok(ticks.indexOf('1s') !== -1, 'and the duration panel is drawn to it', ticks.join(','));
  ok(ticks.some(t => /%$/.test(t)), 'while the rate panel keeps percentages', ticks.join(','));

  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('plots[0].yAxisBy["duration|s"].max') === 1, 'saved and restored',
     w.eval('JSON.stringify(plots[0].yAxisBy)'));

  ok(w.eval('computeAxisPlan(plots[0]).dualEligible'),
     'and with two scales the second axis is still on offer as an alternative');
  w.close();
}

console.log('\n=== 3c. Three scales: the second-axis offer is withdrawn, and says so ===');
{
  const { w, d } = boot();
  add(d, 'Count A');          // a rate and a count: two scales
  ok(w.eval('computeAxisPlan(plots[0]).dualEligible'), 'two scales offer a second axis');
  ok(Array.from(d.querySelectorAll('#plots .head-toggle')).some(l => /second y-axis/.test(l.textContent)),
     'and the control is there');
  ok(!d.querySelector('#plots .head-note'), 'with nothing to explain');

  add(d, 'Δ Rate A');         // a third scale
  ok(w.eval('computeAxisPlan(plots[0]).scaleCount') === 3, 'now three',
     w.eval('computeAxisPlan(plots[0]).scaleCount'));
  ok(!Array.from(d.querySelectorAll('#plots .head-toggle')).some(l => /second y-axis/.test(l.textContent)),
     'the second-axis control is gone, because a frame has two axes');
  const note = d.querySelector('#plots .head-note');
  ok(!!note && /two scales; this shows 3/.test(note.textContent),
     'and the head says so rather than letting it vanish', note && note.textContent);
  ok(d.querySelectorAll('#plots .yaxis-group').length === 3, 'with an axis control per scale',
     d.querySelectorAll('#plots .yaxis-group').length);
  w.close();
}

console.log('\n=== 3d. The axis settings are a strip of their own, and collapse ===');
{
  const { w, d } = boot();
  threeKinds(w);
  add(d, 'L2 hit rate');
  add(d, 'Exec time');
  const bar = () => d.querySelector('#plots .plot-axes-bar');
  ok(!!bar(), 'there is a strip');
  ok(bar().parentNode.className === 'plot-card',
     'outside the head, not strung along it next to the chart type',
     bar().parentNode.className);
  ok(d.querySelectorAll('#plots .plot-head .yaxis-group').length === 0,
     'so no axis control is left in the head');
  ok(bar().querySelectorAll('.yaxis-group').length === 2, 'both axes are in it');
  ok(Array.from(bar().querySelectorAll('.head-toggle')).some(l => /one shared y-axis/.test(l.textContent)),
     'and so are the toggles about axes');

  const t = d.querySelector('#plots .axes-toggle');
  ok(!!t && /Axes/.test(t.textContent), 'a control to collapse it', t && t.textContent.trim());
  ok(/\(2\)/.test(t.textContent), 'saying how many axes are in there', t.textContent.trim());
  ok(t.textContent.indexOf('▾') === 0, 'open to begin with — a hidden setting is a lost setting');
  t.click();
  ok(!bar(), 'clicking it puts the strip away');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the chart is unaffected');
  d.querySelector('#plots .axes-toggle').click();
  ok(!!bar(), 'and back');
  w.close();
}

console.log('\n=== 3e. The exports sit together ===');
{
  const { w, d } = boot();
  const grp = d.querySelector('#plots .export-group');
  ok(!!grp, 'they are one group');
  const labels = Array.from(grp.querySelectorAll('button')).map(b => b.textContent);
  ok(labels.join(',') === 'TikZ,SVG,PNG', 'holding every export and nothing else', labels.join(','));
  ok(grp.textContent.indexOf('Export') === 0, 'captioned as what they are', grp.textContent.slice(0, 12));
  const actions = d.querySelector('#plots .card-actions');
  ok(!!actions && Array.from(actions.querySelectorAll('button')).map(b => b.textContent).join(',')
     === 'Duplicate,↑,↓,Remove', 'and the card actions are their own group, not mixed in',
     actions && actions.textContent);

  // the panel says what each part is, not just what it is called
  grp.querySelector('button').click();
  const tabs = Array.from(d.querySelectorAll('#tex-modal .tex-tab'));
  ok(tabs.map(b => b.textContent).join(' | ') === 'TikZ (drawn) | pgfplots (reads the .csv) | the .csv',
     'the TikZ export offers a pgfplots figure that plots an exported .csv',
     tabs.map(b => b.textContent).join(' | '));
  ok(tabs.map(b => b.title).join(',') === 'plot-1.tex,plot-1-pgfplots.tex,plot-1.csv',
     'each still downloading under its filename', tabs.map(b => b.title).join(','));
  w.close();
}

console.log('\n=== 3f. Diverging bars can carry a second scale too ===');
{
  const { w, d } = boot();
  // its value axis is horizontal, so a second scale is a second tick row
  Array.from(cols(d)[0].querySelectorAll('.dnd-chip'))
    .find(c => c.textContent.trim().indexOf('Rate A') === 0).click();
  add(d, 'Δ Rate A (Tuned−Base)');
  add(d, 'Δ Count A (Tuned vs Base)');
  setType(w, d, 'diverging');
  ok(w.eval('computeAxisPlan(plots[0]).dualEligible'),
     'the second axis is offered on a diverging chart');
  ok(dualOn(w, d), 'and can be switched on');

  ok(d.querySelectorAll('#plots .plot-empty').length === 0, 'it draws');
  const sec = d.querySelectorAll('#plots rect.bar-secondary').length;
  ok(sec > 0 && sec < d.querySelectorAll('#plots rect.bar').length,
     'some bars are on the second scale, not all',
     sec + ' of ' + d.querySelectorAll('#plots rect.bar').length);
  const lower = Array.from(d.querySelectorAll('#plots text.axis-label:not(.axis-secondary)')).map(t => t.textContent);
  const upper = Array.from(d.querySelectorAll('#plots text.axis-secondary')).map(t => t.textContent);
  ok(lower.some(t => /pt$/.test(t)), 'the lower ticks are in points', lower.join(','));
  ok(upper.length > 0 && upper.every(t => /%$/.test(t)), 'the upper ticks in per cent', upper.join(','));
  ok(upper.indexOf('0%') !== -1 && lower.indexOf('0pt') !== -1,
     'both meet at zero, which is the one thing they agree on');
  const caps = Array.from(d.querySelectorAll('#plots .legend-cap')).map(t => t.textContent);
  ok(caps.length === 2 && /Lower axis/.test(caps[0]) && /Upper axis/.test(caps[1]),
     'the key names which row of ticks is which', caps.join(' | '));
  ok(/outlined/.test(caps[1]), 'and how to tell the bars apart', caps[1]);
  const note = d.querySelector('#plots .legend-note');
  ok(!!note && /says nothing about a length on the other/.test(note.textContent),
     'with the cost of two scales stated', note && note.textContent);
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
  ok(!sel.disabled, 'and usable');
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

console.log('\n=== 7b. And it is findable before there are two measures ===');
{
  // Hiding the control until a second measure arrived meant it existed only in
  // states nobody was in when they went looking for it.
  const { w, d } = boot();
  ok(w.eval('plots[0].included.metric.length') === 1, 'one measure shown');
  d.querySelector('#plots .style-toggle').click();
  const sel = d.querySelector('#plots .style-colour-by');
  ok(!!sel, 'the control is still listed');
  ok(sel.disabled, 'greyed, because with one measure it would say nothing');
  const hint = sel.parentNode.querySelector('.radio-hint');
  ok(/one measure shown/.test(hint.textContent), 'and it says why', hint.textContent);
  w.close();
}

console.log('\n=== 7c. The key is painted what the chart is painted ===');
{
  // Colouring by metric repaints every mark. A key still showing the series
  // palette is a key to a chart that is not on the page.
  const { w, d } = boot();
  add(d, 'Rate B');
  metricTo(w, d, 'series');
  d.querySelector('#plots .style-toggle').click();
  const sel = d.querySelector('#plots .style-colour-by');
  sel.value = 'metric';
  fire(w, sel);

  const swatches = Array.from(d.querySelectorAll('#plots .legend .item'))
    .map(i => (i.querySelector('.swatch') || {}).style.background);
  const fills = Array.from(new Set(Array.from(d.querySelectorAll('#plots rect.bar'))
    .map(r => r.getAttribute('fill'))));
  ok(fills.length === 2, 'the chart uses two colours, one per measure', fills.join(','));
  ok(new Set(swatches).size === 2, 'and so does the key', Array.from(new Set(swatches)).join(','));
  ok(swatches.every(s => fills.indexOf(s) !== -1),
     'every key colour is one the chart actually drew',
     swatches.join(' | ') + ' vs ' + fills.join(','));
  const labels = Array.from(d.querySelectorAll('#plots .legend .legend-text')).map(t => t.textContent);
  ok(labels.length === 6 && labels.every(t => /Rate A|Rate B/.test(t)),
     'while the labels still name the whole series', labels.join(' | '));
  w.close();
}

console.log('\n=== 7d. Series that lose colour are given something else ===');
{
  const { w, d } = boot();
  add(d, 'Rate B');
  metricTo(w, d, 'x');          // metric is not a series dim: colour cannot key both
  d.querySelector('#plots .style-toggle').click();
  ok(d.querySelector('#plots .style-pattern').value === 'none', 'textures are off plot-wide');
  ok(d.querySelectorAll('#plots rect.bar-texture').length === 0, 'and none is drawn');

  const sel = d.querySelector('#plots .style-colour-by');
  sel.value = 'metric';
  fire(w, sel);
  ok(d.querySelectorAll('#plots rect.bar-texture').length > 0,
     'now the series get textures, because colour is no longer telling them apart',
     d.querySelectorAll('#plots rect.bar-texture').length);
  const swatches = Array.from(d.querySelectorAll('#plots .legend:not(.metric-legend) .item'))
    .map(i => !!i.querySelector('.swatch-svg'));
  ok(swatches.every(Boolean), 'the series key shows those textures, not a colour');
  const note = d.querySelector('#plots .legend-note');
  ok(!!note && /colour follows the metric/.test(note.textContent) && /texture/.test(note.textContent),
     'and says what is doing the work now', note && note.textContent);
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

console.log('\n=== 10. A key names its series in full, at a fixed size ===');
{
  const { w, d } = boot();
  const labels = () => Array.from(d.querySelectorAll('#plots .legend .item'))
    .map(i => i.querySelector('.legend-text').textContent);
  // two metrics with Metric in the series: every label ends in the metric name,
  // and shortening the labels by dropping what they share took it away
  add(d, 'Rate B');
  metricTo(w, d, 'series');
  const plain = labels();
  ok(plain.every(t => /Rate A|Rate B/.test(t)), 'the measure is named on every key', plain.join(' | '));

  // and it survives the swatch becoming a drawn shape
  setType(w, d, 'lines');
  const shaped = labels();
  ok(d.querySelectorAll('#plots .legend .swatch-svg').length > 0, 'the key is a drawn shape now');
  ok(shaped.every(t => t.length > 0), 'and every one still has its label', shaped.join(' | '));
  ok(shaped.join('|') === plain.join('|'), 'saying exactly what it said before', shaped.join(' | '));
  w.close();
}

console.log('\n=== 10b. The drawn swatch has a size in CSS, not only in markup ===');
{
  // An <svg> sized only by its width/height ATTRIBUTES has no CSS size, and as
  // a flex item it lays out from its default 300x150 -- so the key took the
  // whole row and squeezed its own label to nothing.
  const CSS = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));
  const rule = (CSS.match(/\.legend \.swatch-svg \{[^}]*\}/) || [''])[0];
  ok(/width:\s*\d/.test(rule) && /height:\s*\d/.test(rule),
     'the swatch is sized in CSS', rule.trim());
  ok(/flex:\s*0 0 auto/.test(rule), 'and cannot grow', rule.trim());
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
