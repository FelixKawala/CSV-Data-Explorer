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
const zones = w => w.eval('JSON.stringify(plots[0].zones)');
const status = d => (d.getElementById('builder-status') || {}).textContent || '';
const undoBtn = d => Array.from((d.getElementById('builder-status') || d).querySelectorAll('button'))
  .find(b => b.textContent === 'Undo');
// the zone select on a chip is how a dimension is moved without a real drag
function moveVia(w, d, dimKey, zone) {
  const sel = d.querySelector('#plots .zone-chip[data-dim="' + dimKey + '"] select');
  sel.value = zone;
  sel.dispatchEvent(new w.Event('change'));
}

console.log('\n=== 1. Moving a dimension between zones offers an undo ===');
{
  const { w, d } = boot();
  const before = zones(w);
  ok(/"x":\["device","size","app"\]/.test(before), 'device starts on the x-axis', before);
  ok(!undoBtn(d), 'nothing to undo yet');

  moveVia(w, d, 'device', 'facet');
  ok(/"facet":\[.*"device"/.test(zones(w)), 'the move happens', zones(w));
  ok(/Moved Device to Facets/.test(status(d)), 'and is announced by name', status(d));
  ok(!!undoBtn(d), 'with an undo offered');

  undoBtn(d).click();
  ok(zones(w) === before, 'which puts the grouping back exactly', zones(w));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the chart redraws');
  ok(!undoBtn(d), 'the offer is spent, not repeatable into nonsense');
  w.close();
}

console.log('\n=== 2. It says where the chip went, for each zone ===');
{
  const { w, d } = boot();
  moveVia(w, d, 'app', 'series');
  ok(/Moved Application to Series/.test(status(d)), 'Series', status(d));
  moveVia(w, d, 'app', 'x');
  ok(/Moved Application to X-axis/.test(status(d)), 'X-axis', status(d));
  moveVia(w, d, 'app', 'facet');
  ok(/Moved Application to Facets/.test(status(d)), 'Facets', status(d));
  w.close();
}

console.log('\n=== 3. Only a real change of zone is worth an undo ===');
{
  const { w, d } = boot();
  // reordering inside one zone is a nudge; an Undo after every nudge is noise
  const chip = d.querySelector('#plots .zone-chip[data-dim="device"]');
  const right = Array.from(chip.querySelectorAll('button')).find(b => b.textContent === '▶');
  if (right) {
    right.click();
    ok(!/Moved/.test(status(d)), 'moving a chip along its own zone says nothing', status(d));
  } else {
    ok(true, 'no reorder control to test');
  }
  w.close();
}

console.log('\n=== 4. Undo restores the whole layout, not just the one chip ===');
{
  const { w, d } = boot();
  // make the plot distinctive first, then move a chip and take it back
  const t = d.querySelectorAll('#plots .plot-head select')[0];
  t.value = 'lines'; t.dispatchEvent(new w.Event('change'));
  const b = d.querySelectorAll('#plots .yaxis-bound')[1];
  b.value = '90'; b.dispatchEvent(new w.Event('change'));
  const before = w.eval('JSON.stringify(serializePlots())');

  moveVia(w, d, 'size', 'facet');
  ok(w.eval('JSON.stringify(serializePlots())') !== before, 'the layout changed');
  undoBtn(d).click();
  ok(w.eval('JSON.stringify(serializePlots())') === before,
     'and undo restores every setting the plot had, not only the zones');
  ok(w.eval('plots[0].chartType') === 'lines' && w.eval('plots[0].yAxis.max') === 90,
     'chart type and axis included',
     w.eval('plots[0].chartType + "/" + plots[0].yAxis.max'));
  w.close();
}

console.log('\n=== 5. The snapshot is detached from the plot it came from ===');
{
  // serializePlots used to hand back live references to zones/included/style,
  // which is invisible when the result is immediately stringified for storage
  // and useless as a snapshot: it changed along with the plot.
  const { w } = boot();
  const snap = w.eval('window.__snap = serializePlots(); "ok"');
  w.eval('plots[0].zones.x = ["app"]; plots[0].included.device = []; '
    + 'plots[0].yAxis.max = 42; plots[0].style.palette = "grey";');
  ok(w.eval('JSON.stringify(window.__snap[0].zones.x)') !== '["app"]',
     'mutating the plot does not reach the snapshot zones',
     w.eval('JSON.stringify(window.__snap[0].zones.x)'));
  ok(w.eval('window.__snap[0].included.device.length') > 0, 'nor its included values',
     w.eval('window.__snap[0].included.device.length'));
  ok(w.eval('window.__snap[0].yAxis.max') === null, 'nor the axis',
     w.eval('String(window.__snap[0].yAxis.max)'));
  ok(w.eval('window.__snap[0].style.palette') === 'default', 'nor the style',
     w.eval('window.__snap[0].style.palette'));
  w.close();
}

console.log('\n=== 6. The Metric chip is covered too ===');
{
  const { w, d } = boot();
  // two metrics make Metric a real chip in the grouping zones
  const avail = d.querySelectorAll('#plots .data-shown-block .dual-col')[1];
  const add = Array.from(avail.querySelectorAll('.dnd-chip')).find(c => /Rate B/.test(c.textContent));
  add.click();
  ok(!!d.querySelector('#plots .zone-chip[data-dim="metric"]'), 'Metric is a chip now');

  const before = zones(w) + '|' + w.eval('plots[0].metricZone');
  moveVia(w, d, 'metric', 'panel');
  ok(w.eval('plots[0].metricZone') === 'panel', 'it can go into Panels');
  ok(/Moved Metric to Panels/.test(status(d)), 'and says so', status(d));
  undoBtn(d).click();
  ok(zones(w) + '|' + w.eval('plots[0].metricZone') === before, 'and comes back',
     zones(w) + '|' + w.eval('plots[0].metricZone'));
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
