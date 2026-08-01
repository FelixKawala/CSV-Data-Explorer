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
const addMetric = (d, p) => Array.from(cols(d)[1].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.trim().indexOf(p) === 0).click();
const rmMetric = (d, p) => Array.from(cols(d)[0].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.trim().indexOf(p) === 0).click();
const splits = d => Array.from(d.querySelectorAll('#plots .metric-split'));
const splitAfter = (d, key) => splits(d).find(s => s.getAttribute('data-after') === key);
const metricTo = (w, d, zone) => {
  const s = d.querySelector('#plots .zone-chip[data-dim="metric"] select');
  s.value = zone; s.dispatchEvent(new w.Event('change'));
};
const bandLabels = d => Array.from(d.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
const groupCols = d => d.querySelectorAll('#plots .metric-col');

console.log('\n=== 1. The split control appears between the shown metrics ===');
{
  const { w, d } = boot();
  ok(splits(d).length === 0, 'nothing to split with one metric shown', splits(d).length);
  addMetric(d, 'Rate B');
  ok(splits(d).length === 1, 'two metrics offer one place to split', splits(d).length);
  addMetric(d, 'Count A');
  ok(splits(d).length === 2, 'three offer two', splits(d).length);
  ok(splits(d).map(s => s.getAttribute('data-after')).join(',') === 'rateA,rateB',
     'one after each metric but the last — a split there would be empty',
     splits(d).map(s => s.getAttribute('data-after')).join(','));
  ok(splits(d).every(s => !s.classList.contains('on')), 'and none is set yet');
  w.close();
}

console.log('\n=== 2. Splitting records a break, keyed by the metric ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  splitAfter(d, 'rateA').click();
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '["rateA"]',
     'the break names the metric it follows, not a position',
     w.eval('JSON.stringify(plots[0].metricBreaks)'));
  ok(splitAfter(d, 'rateA').classList.contains('on'), 'and the control shows as set');
  ok(/group ends here/.test(splitAfter(d, 'rateA').textContent), 'saying what it does',
     splitAfter(d, 'rateA').textContent);
  ok(/2 groups/.test(d.querySelector('#plots .dim-note').textContent), 'with the count stated',
     d.querySelector('#plots .dim-note').textContent);

  splitAfter(d, 'rateA').click();
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '[]', 'clicking again takes it back');
  w.close();
}

console.log('\n=== 3. Groups that share a scale become a band on one axis ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  metricTo(w, d, 'x');
  const before = d.querySelectorAll('#plots rect.bar').length;
  const svgsBefore = d.querySelectorAll('#plots svg').length;
  ok(before > 0 && svgsBefore === 1, 'one chart to begin with', before + ' bars in ' + svgsBefore);

  splitAfter(d, 'rateA').click();
  ok(d.querySelectorAll('#plots svg').length === 1, 'still ONE chart, not one per group',
     d.querySelectorAll('#plots svg').length);
  ok(groupCols(d).length === 0, 'and no side-by-side columns');
  ok(d.querySelectorAll('#plots rect.bar').length === before, 'every bar still drawn',
     d.querySelectorAll('#plots rect.bar').length);

  const labels = bandLabels(d);
  ok(labels.indexOf('Rate A') !== -1 && labels.indexOf('Rate B') !== -1,
     'the groups are labelled as a band under the axis');
  ok(w.eval('computeAxisPlan(plots[0]).xDims.join(",")') === 'device,size,app,metric',
     'the plan itself is untouched — the band is added at draw time',
     w.eval('computeAxisPlan(plots[0]).xDims.join(",")'));
  ok(d.querySelectorAll('#plots text.axis-label').length > 0, 'and there is one y-axis');
  w.close();
}

console.log('\n=== 4. Two groups reading alike still make two bands ===');
{
  // both groups here are percentages, so naming a band after its scale would
  // give both the same name, the axis code would see one value, and they would
  // silently merge back into one band
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  metricTo(w, d, 'x');
  splitAfter(d, 'rateA').click();
  const runs = bandLabels(d).filter(l => l === 'Rate A' || l === 'Rate B');
  ok(runs.length >= 2, 'both bands are drawn', runs.length);
  ok(new Set(runs).size === 2, 'and they are distinguishable', Array.from(new Set(runs)).join(','));
  w.close();
}

console.log('\n=== 5. Groups on different scales get a chart each ===');
{
  const { w, d } = boot();
  addMetric(d, 'Count A');            // a count next to a percentage
  splitAfter(d, 'rateA').click();
  ok(groupCols(d).length === 2, 'one plot area per group, side by side', groupCols(d).length);
  ok(d.querySelectorAll('#plots .metric-row').length === 1, 'laid out in a row, not stacked');
  const caps = Array.from(groupCols(d)).map(c => c.getAttribute('data-caption'));
  ok(caps.join(' | ') === 'Rate A | Count A', 'each named by what is in it', caps.join(' | '));
  ok(/own y-axis/.test(d.querySelector('#plots .chart-note').textContent),
     'and it says why', d.querySelector('#plots .chart-note').textContent);
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'both draw',
     d.querySelectorAll('#plots rect.bar').length);
  // each group scales to its own data, which is the point
  const ticks = Array.from(d.querySelectorAll('#plots text.axis-label')).map(t => t.textContent);
  ok(ticks.some(t => /%$/.test(t)) && ticks.some(t => /[KM]$|^\d+$/.test(t)),
     'one axis in percent, the other in counts', Array.from(new Set(ticks)).slice(0, 8).join(' '));
  w.close();
}

console.log('\n=== 6. A break for a metric no longer shown is dropped ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  addMetric(d, 'Count A');
  splitAfter(d, 'rateB').click();
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '["rateB"]', 'a break is set');
  rmMetric(d, 'Rate B');
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '[]',
     'removing that metric takes its break with it, rather than leaving a split nobody can see',
     w.eval('JSON.stringify(plots[0].metricBreaks)'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the chart still draws');
  w.close();
}

console.log('\n=== 7. A break after the last metric would make an empty group ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  splitAfter(d, 'rateA').click();
  rmMetric(d, 'Rate B');                    // rateA is now last, and still carries a break
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '[]',
     'a break that has drifted to the end is dropped',
     w.eval('JSON.stringify(plots[0].metricBreaks)'));
  ok(w.eval('metricGroupsOf(plots[0])') === null, 'so there are no groups');
  ok(d.querySelectorAll('#plots svg').length === 1, 'and one plain chart');
  w.close();
}

console.log('\n=== 8. Three groups, and the split survives a save ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  addMetric(d, 'Count A');
  splitAfter(d, 'rateA').click();
  splitAfter(d, 'rateB').click();
  ok(w.eval('JSON.stringify(metricGroupsOf(plots[0]))') === '[["rateA"],["rateB"],["countA"]]',
     'three groups', w.eval('JSON.stringify(metricGroupsOf(plots[0]))'));
  ok(groupCols(d).length === 3, 'drawn as three', groupCols(d).length);

  const saved = w.eval('JSON.stringify(serializePlots()[0].metricBreaks)');
  ok(saved === '["rateA","rateB"]', 'it serialises', saved);
  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '["rateA","rateB"]', 'and comes back');
  ok(groupCols(d).length === 3, 'still three', groupCols(d).length);

  w.eval('applyConfig([{"chartType":"bars"}])');
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '[]',
     'a view saved before splitting existed has none');
  w.eval('applyConfig([{"chartType":"bars","metricBreaks":"nonsense"}])');
  ok(w.eval('JSON.stringify(plots[0].metricBreaks)') === '[]', 'and rubbish is replaced');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the chart still draws');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
