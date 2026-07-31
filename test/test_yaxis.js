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
const grp = d => d.querySelector('#plots .yaxis-group');
const scaleSel = d => grp(d).querySelector('.yaxis-scale');
const bounds = d => grp(d).querySelectorAll('.yaxis-bound');
const setType = (w, d, t) => { const s = d.querySelectorAll('#plots .plot-head select')[0]; s.value = t; s.dispatchEvent(new w.Event('change')); };
function setBound(w, d, i, v) {
  const inp = bounds(d)[i];
  inp.value = v;
  inp.dispatchEvent(new w.Event('change'));
}
// the y coordinates of the drawn bars, top edge
const barTops = d => Array.from(d.querySelectorAll('#plots rect.bar')).map(r => +r.getAttribute('y'));
const tickLabels = d => Array.from(d.querySelectorAll('#plots text.axis-label')).map(t => t.textContent);
const note = d => (d.querySelector('#plots .chart-note') || {}).textContent;

// makeYScale in isolation: the maths, without the chart around it
function scale(w, kind, values, axis) {
  return JSON.parse(w.eval('(function(){'
    + ' const sc = makeYScale(makeFormat(' + JSON.stringify(kind) + '), '
    + JSON.stringify(values) + ', 100, ' + JSON.stringify(axis || null) + ');'
    + ' return JSON.stringify({ ticks: sc.ticks, useLog: sc.useLog, zeroY: sc.zeroY,'
    + '   notes: sc.notes, y0: sc.y(' + JSON.stringify(values[0]) + ') }); })()'));
}

console.log('\n=== 1. Without an override nothing changes ===');
{
  const { w, d } = boot();
  ok(!!grp(d), 'the axis controls are in the plot head');
  ok(scaleSel(d).value === 'auto', 'the scale starts on auto');
  ok(bounds(d)[0].value === '' && bounds(d)[1].value === '',
     'and both bounds start empty, meaning fit the data');
  ok(!grp(d).querySelector('button'), 'with no reset button to press');

  const a = scale(w, 'pct', [10, 20, 30]);
  const b = scale(w, 'pct', [10, 20, 30], { min: null, max: null, scale: 'auto' });
  ok(JSON.stringify(a) === JSON.stringify(b),
     'an all-auto override is identical to no override at all');
  ok(a.notes.length === 0, 'and says nothing');
  w.close();
}

console.log('\n=== 2. A hand-set range is used exactly as written ===');
{
  const { w } = boot();
  // auto pads the top by 15%; an explicit bound must not be padded, or the
  // number typed is not the number drawn
  const auto = scale(w, 'pct', [10, 50]);
  ok(auto.ticks[2] > 50, 'auto leaves headroom above the data', auto.ticks[2]);
  const set = scale(w, 'pct', [10, 50], { min: 0, max: 50, scale: 'auto' });
  ok(set.ticks[2] === 50, 'a set maximum is the maximum', set.ticks[2]);
  ok(set.ticks[0] === 0, 'and a set minimum is the minimum', set.ticks[0]);
  ok(Math.abs(set.y0 - 80) < 1e-9, '10 sits four fifths down a 0..50 axis of 100px', set.y0);

  // zero only earns a tick when the domain contains it
  const above = scale(w, 'pct', [60, 90], { min: 50, max: 100, scale: 'auto' });
  ok(above.ticks.join(',') === '50,75,100', 'a floor above zero gets its own ticks',
     above.ticks.join(','));
  ok(above.zeroY === 100, 'and the baseline is pinned to the bottom, not drawn off it',
     above.zeroY);
  w.close();
}

console.log('\n=== 3. It refuses to produce nonsense, and says why ===');
{
  const { w } = boot();
  const inverted = scale(w, 'pct', [10, 20], { min: 80, max: 20, scale: 'auto' });
  ok(/maximum must be above/.test(inverted.notes.join(' ')), 'an inverted range is called out',
     inverted.notes.join('; '));
  ok(inverted.ticks[2] > inverted.ticks[0], 'and the axis is still drawable',
     inverted.ticks.join(','));

  const badLog = scale(w, 'count', [100, 1000], { min: 0, max: null, scale: 'log' });
  ok(/log axis cannot start at 0/.test(badLog.notes.join(' ')),
     'a log axis cannot start at zero, and says so', badLog.notes.join('; '));
  ok(badLog.useLog === true, 'it stays logarithmic');
  ok(JSON.stringify(badLog.ticks).indexOf('null') === -1
     && badLog.ticks.every(t => t > 0), 'with real positive ticks, not NaN',
     badLog.ticks.join(','));
  ok(badLog.y0 !== null && isFinite(badLog.y0), 'and finite coordinates', badLog.y0);

  const negLog = scale(w, 'delta', [-5, 5], { min: null, max: null, scale: 'log' });
  ok(/at or below zero/.test(negLog.notes.join(' ')),
     'forcing log onto data that goes negative warns rather than silently dropping it',
     negLog.notes.join('; '));
  w.close();
}

console.log('\n=== 4. The scale can be forced either way ===');
{
  const { w } = boot();
  ok(scale(w, 'count', [1, 1000]).useLog === true, 'a count is logarithmic by default');
  ok(scale(w, 'count', [1, 1000], { min: null, max: null, scale: 'linear' }).useLog === false,
     'and can be forced linear');
  ok(scale(w, 'pct', [1, 90]).useLog === false, 'a percentage is linear by default');
  ok(scale(w, 'pct', [1, 90], { min: null, max: null, scale: 'log' }).useLog === true,
     'and can be forced logarithmic');
  w.close();
}

console.log('\n=== 5. The controls drive the chart ===');
{
  const { w, d } = boot();
  const before = barTops(d);
  ok(before.length > 0, 'bars are drawn to begin with', before.length);

  setBound(w, d, 1, '100');
  const after = barTops(d);
  ok(after.length === before.length, 'the same bars are still drawn', after.length);
  ok(after.every((y, i) => y > before[i]), 'and every one is shorter against a taller axis');
  ok(w.eval('JSON.stringify(plots[0].yAxis)') === '{"min":null,"max":100,"scale":"auto"}',
     'the setting is on the plot', w.eval('JSON.stringify(plots[0].yAxis)'));
  ok(tickLabels(d).indexOf('100%') !== -1, 'and the axis is labelled to it', tickLabels(d).join(' '));

  ok(!!grp(d).querySelector('button'), 'a reset appears once anything is set');
  grp(d).querySelector('button').click();
  ok(w.eval('JSON.stringify(plots[0].yAxis)') === '{"min":null,"max":null,"scale":"auto"}',
     'and puts it all back');
  ok(JSON.stringify(barTops(d)) === JSON.stringify(before), 'redrawing exactly as before');
  w.close();
}

console.log('\n=== 6. Values outside the window are clipped, and counted ===');
{
  const { w, d } = boot();
  ok(note(d) === undefined, 'nothing to say while the axis fits the data', note(d));
  setBound(w, d, 0, '0');
  setBound(w, d, 1, '10');          // most of the fixture's rates are above 10%
  ok(/outside the axis range/.test(note(d) || ''), 'a squeezed axis says how much it hides',
     note(d));
  const tops = barTops(d);
  ok(tops.every(y => y >= 0), 'and no bar is drawn above the frame', Math.min.apply(null, tops));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the chart still draws');
  w.close();
}

console.log('\n=== 7. A line chart honours it too, and a table has no axis to set ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  setBound(w, d, 1, '100');
  const ys = Array.from(d.querySelectorAll('#plots circle.series-dot')).map(c => +c.getAttribute('cy'));
  ok(ys.length > 0 && ys.every(y => y >= 0 && y <= 170), 'every marker is inside the frame',
     ys.length);
  ok(w.eval('plots[0].yAxis.max') === 100, 'the line chart took the bound');

  setType(w, d, 'table');
  ok(!grp(d), 'a table offers no y-axis controls');
  setType(w, d, 'matrix');
  ok(!grp(d), 'nor does a matrix');
  w.close();
}

console.log('\n=== 8. The setting is saved and restored ===');
{
  const { w, d } = boot();
  setBound(w, d, 0, '5');
  setBound(w, d, 1, '95');
  scaleSel(d).value = 'linear';
  scaleSel(d).dispatchEvent(new w.Event('change'));
  const saved = w.eval('JSON.stringify(serializePlots()[0].yAxis)');
  ok(saved === '{"min":5,"max":95,"scale":"linear"}', 'it serialises', saved);

  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('JSON.stringify(plots[0].yAxis)') === '{"min":5,"max":95,"scale":"linear"}',
     'and comes back', w.eval('JSON.stringify(plots[0].yAxis)'));

  // a view saved before any of this existed has no yAxis at all
  w.eval('applyConfig([{"chartType":"bars"}])');
  ok(w.eval('JSON.stringify(plots[0].yAxis)') === '{"min":null,"max":null,"scale":"auto"}',
     'an older saved view reads as auto rather than as a broken record',
     w.eval('JSON.stringify(plots[0].yAxis)'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and still draws');

  // and rubbish in the stored value does not reach the scale
  w.eval('applyConfig([{"chartType":"bars","yAxis":{"min":"x","max":null,"scale":"sideways"}}])');
  ok(w.eval('JSON.stringify(plots[0].yAxis)') === '{"min":null,"max":null,"scale":"auto"}',
     'nor does a nonsensical one', w.eval('JSON.stringify(plots[0].yAxis)'));
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
