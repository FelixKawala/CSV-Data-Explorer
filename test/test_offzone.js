// "Not used": a dimension kept in the data but out of the plot. Its rows are
// folded together rather than filtered away, and it names, orders and splits
// nothing.
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
const setZone = (w, d, dim, z) => {
  const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select');
  s.value = z; s.dispatchEvent(new w.Event('change'));
};
const zoneOf = (d, dim) => {
  const chip = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"]');
  return chip ? chip.getAttribute('data-zone') : null;
};
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

console.log('\n=== 1. The zone exists, last, and Metric is not offered it ===');
{
  const { w, d } = boot();
  const boxes = Array.from(d.querySelectorAll('#plots .zone'));
  const keys = boxes.map(b => b.getAttribute('data-zone'));
  ok(keys.indexOf('off') === keys.length - 1, 'Not used is the last zone', keys.join(' '));
  const offBox = boxes[keys.indexOf('off')];
  ok(/Not used/.test(offBox.textContent), 'and says what it is');
  ok(/none — every dimension is in play/.test(offBox.textContent), 'empty to begin with');
  // Metric is only a chip once more than one measure is shown
  Array.from(d.querySelectorAll('#plots .data-shown-block .dual-col')[1].querySelectorAll('.dnd-chip'))
    .find(c => c.textContent.indexOf('Rate B') !== -1).click();
  const metricOpts = Array.from(
    d.querySelectorAll('#plots .zone-chip[data-dim="metric"] select option')).map(o => o.value);
  ok(metricOpts.length > 0, 'the Metric chip offers zones', metricOpts.join(','));
  ok(metricOpts.indexOf('off') === -1, 'Metric cannot be parked there', metricOpts.join(','));
  ok(metricOpts.indexOf('panel') !== -1, 'it gets Panels instead');
  w.close();
}

console.log('\n=== 2. A dimension moved there leaves the axes and the labels ===');
{
  const { w, d } = boot();
  const beforeTicks = Array.from(d.querySelectorAll('#plots .leaf-shell text')).map(t => t.textContent).join('|');
  ok(/dev/.test(beforeTicks), 'Device is on the axis to begin with');
  setZone(w, d, 'device', 'off');
  ok(zoneOf(d, 'device') === 'off', 'the chip moved');
  const afterTicks = Array.from(d.querySelectorAll('#plots .leaf-shell text')).map(t => t.textContent).join('|');
  ok(!/dev1|dev2|dev3/.test(afterTicks), 'and no tick or key names it any more');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the chart still draws');
  const note = Array.from(d.querySelectorAll('#plots .chart-note')).map(n => n.textContent).join(' ');
  ok(/Device is not used here/.test(note), 'and says so above the chart', note.slice(0, 80));
  ok(/average across it/.test(note), 'naming the averaging, not hiding it');
  w.close();
}

console.log('\n=== 3. The number drawn is the average across it ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'off');
  setZone(w, d, 'size', 'off');
  const got = w.eval(`(function () {
    const p = plots[0];
    const shell = document.querySelector('#plots .leaf-shell');
    const dt = shell.__vizData;
    const ctx = { metric: 'rateA', dataset: p.included.dataset[0] };
    // the first drawn point: its x tuple and its first series
    const xKeys = dt.xDims, sKeys = dt.seriesDims;
    const row = dt.rows[0];
    xKeys.forEach((k, i) => { ctx[k] = DIM_BY_KEY[k].values.filter(
      v => dimValueLabel(k, v) === row.parts[i])[0]; });
    sKeys.forEach(k => { ctx[k] = p.included[k][0]; });
    let sum = 0, n = 0;
    p.included.device.forEach(dv => p.included.size.forEach(sz => {
      const v = metricValueAt(Object.assign({}, ctx, { device: dv, size: sz }));
      if (v !== null) { sum += v; n++; }
    }));
    return { drawn: row.values[0], mean: n ? sum / n : null, n: n,
             one: metricValueAt(Object.assign({}, ctx, { device: p.included.device[0], size: p.included.size[0] })) };
  })()`);
  ok(got.n > 1, 'there really are several values behind it', got.n + ' cells');
  ok(near(got.drawn, got.mean), 'the plotted value is their mean',
     got.drawn + ' vs ' + got.mean);
  ok(!near(got.drawn, got.one), 'and not just the first of them', got.one);
  w.close();
}

console.log('\n=== 4. Excluding a value excludes it from the average too ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'off');
  // a tuple several devices actually carry, so removing one has to change it
  const spot = w.eval(`(function () {
    const p = plots[0];
    let best = null;
    p.included.size.forEach(sz => p.included.app.forEach(ap => {
      const ctx = { metric: 'rateA', dataset: p.included.dataset[0], size: sz, app: ap, variant: 'base' };
      const have = p.included.device.filter(dv => metricValueAt(Object.assign({}, ctx, { device: dv })) !== null);
      if (have.length > 1 && !best) best = { size: sz, app: ap, have: have };
    }));
    window.__spot = best;
    return best;
  })()`);
  ok(spot && spot.have.length > 1, 'found a tuple several devices carry',
     spot && spot.have.join(','));
  const read = `(function () {
    const p = plots[0];
    const ctx = { metric: 'rateA', dataset: p.included.dataset[0], size: window.__spot.size,
                  app: window.__spot.app, variant: 'base' };
    return { v: metricValueOver(ctx, ['device'], k => p.included[k]),
             n: p.included.device.length };
  })()`;
  const before = w.eval(read);
  // drop one device from Shown
  const block = Array.from(d.querySelectorAll('#plots .dim-block'))
    .find(b => b.querySelector('.dim-label').textContent === 'Device');
  ok(/Not used in this plot/.test(block.textContent), 'the value list says what it now decides');
  Array.from(block.querySelectorAll('.dual-col')[0].querySelectorAll('.dnd-chip'))
    .find(c => c.textContent.indexOf(spot.have[0]) !== -1).click();
  const after = w.eval(read);
  ok(after.n === before.n - 1, 'one device left the list', before.n + ' → ' + after.n);
  ok(!near(before.v, after.v), 'and the average moved with it', before.v + ' → ' + after.v);
  w.close();
}

console.log('\n=== 5. A sum measure sums rather than averages ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'off');
  const got = w.eval(`(function () {
    const p = plots[0];
    const ctx = { metric: 'countA', dataset: p.included.dataset[0],
                  size: p.included.size[0], app: p.included.app[0], variant: 'base' };
    const vals = p.included.device.map(dv => metricValueAt(Object.assign({}, ctx, { device: dv })))
      .filter(v => v !== null);
    const mean = metricValueOver(ctx, ['device'], k => p.included[k]);
    METRIC_BY_KEY.countA.agg = 'sum';
    const sum = metricValueOver(ctx, ['device'], k => p.included[k]);
    METRIC_BY_KEY.countA.agg = 'mean';
    return { n: vals.length, total: vals.reduce((a, b) => a + b, 0), mean: mean, sum: sum };
  })()`);
  ok(got.n > 1, 'several devices carry a count', got.n);
  ok(near(got.mean, got.total / got.n), 'a mean measure averages', got.mean);
  ok(near(got.sum, got.total), 'one declared sum adds up instead', got.sum);
  w.close();
}

console.log('\n=== 6. It survives a save and a reload ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'off');
  const round = w.eval('applyConfig(JSON.parse(JSON.stringify(serializePlots()))), plots[0].zones.off.join(",")');
  ok(round === 'device', 'the zone came back', round);
  ok(zoneOf(d, 'device') === 'off', 'and the chip is drawn there');
  // a layout saved before the zone existed has no list for it
  const old = w.eval('deserializePlots([{ zones: { x: ["app"], series: ["variant"] } }])[0].zones.off.length');
  ok(old === 0, 'an older saved view loads with an empty one', old);
  w.close();
}

console.log('\n=== 6b. Emptying its values says so rather than saying "no data" ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'off');
  w.eval('plots[0].included.device = []; renderPlots();');
  const msg = (d.querySelector('#plots .plot-empty') || {}).textContent || '';
  ok(/averaged over/.test(msg) && /Enable at least one/.test(msg),
     'the refusal names the cause', msg.slice(0, 90));
  const note = Array.from(d.querySelectorAll('#plots .chart-note')).map(n => n.textContent).join(' ');
  ok(!/nothing is averaged away/.test(note), 'and the note above does not claim otherwise', note);
  w.close();
}

console.log('\n=== 7. Everything parked is still a chart, not an error ===');
{
  const { w, d } = boot();
  ['dataset', 'device', 'size', 'app', 'variant'].forEach(k => setZone(w, d, k, 'off'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'one bar remains: the whole dataset');
  ok(!d.querySelector('#plots .plot-empty'), 'and nothing refused to draw');
  w.close();
}

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
