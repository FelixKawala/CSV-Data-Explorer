// Editing what a measure is called and what kind of thing it is, and the two
// ways a comparison measure could come out empty everywhere with nothing on
// screen to say why.
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const openEditor = d => d.getElementById('measures-toggle').click();
const nameOf = (d, k) => d.querySelector('.measure-name[data-measure="' + k + '"]');
const fmtOf = (d, k) => d.querySelector('.measure-format[data-measure="' + k + '"]');
const fire = (w, el, ev) => el.dispatchEvent(new w.Event(ev || 'change'));

// a two-measure import that is wrong about one of them, as a guessed import is
function typedWrong(w, id) {
  w.eval('setStore(makeMemoryStore());');
  const CSV = 'app,l1,ms\nA,62.1,420\nB,55.3,510\nC,71.8,330\n';
  const rec = { id: id, name: 'r', sources: [{ filename: 'r.csv', text: CSV }], recipe: { columns: [
    { source: 'app', name: 'app', label: 'App', role: 'dimension' },
    { source: 'l1', name: 'l1', label: 'l1', role: 'measure', format: 'pct' },
    { source: 'ms', name: 'ms', label: 'ms', role: 'measure', format: 'number' }] } };
  w.eval('STORE.put(' + JSON.stringify(rec) + ')');
  w.eval('setActiveDatasetId(' + JSON.stringify(id) + ')');
  w.eval('startWithDataset(datasetFromRecord(' + JSON.stringify(rec) + '))');
}

console.log('\n=== 1. A measure can be renamed, and the whole page follows ===');
{
  const { w, d } = boot();
  openEditor(d);
  ok(d.querySelectorAll('#measures-holder .measure-row').length === w.eval('METRICS.length'),
     'every measure is listed', d.querySelectorAll('#measures-holder .measure-row').length);
  const inp = nameOf(d, 'countA');
  ok(!!inp && inp.value === 'Count A', 'with its current name in an editable field', inp && inp.value);

  inp.value = 'L2 accesses';
  fire(w, inp);
  ok(w.eval('METRIC_BY_KEY.countA.label') === 'L2 accesses', 'the label changes');
  ok(w.eval('DIM_BY_KEY.metric.labelFor("countA")') === 'L2 accesses',
     'and the Metric dimension reads it through, so chips and axes follow');
  const chips = Array.from(d.querySelectorAll('#plots .dnd-chip')).map(c => c.textContent);
  ok(chips.some(t => /L2 accesses/.test(t)), 'the Data shown list shows the new name');

  // a blank name is not a name
  const again = nameOf(d, 'countA');
  again.value = '   ';
  fire(w, again);
  ok(w.eval('METRIC_BY_KEY.countA.label') === 'L2 accesses', 'and an empty one is refused');
  w.close();
}

console.log('\n=== 2. Retyping a measure moves it to another y-axis ===');
{
  const { w, d } = boot();
  ok(w.eval('METRIC_BY_KEY.countA.format.axisGroup') !== w.eval('METRIC_BY_KEY.rateA.format.axisGroup'),
     'a count and a rate start on different axes');
  openEditor(d);
  const sel = fmtOf(d, 'countA');
  ok(!!sel, 'the kind is a choice, not a fact about the file');
  sel.value = 'pct';
  fire(w, sel);
  ok(w.eval('METRIC_BY_KEY.countA.format.key') === 'pct', 'it takes the new kind');
  ok(w.eval('sameAxis(METRIC_BY_KEY.countA.format, METRIC_BY_KEY.rateA.format)'),
     'and now shares an axis with the rate — which is the point of retyping it');
  ok(w.eval('METRIC_BY_KEY.countA.format.scale') === 'linear',
     'the log scale a count had goes with it');

  // and the plot agrees: two measures of one kind are one panel
  w.eval('plots[0].included.metric = ["rateA", "countA"]; renderPlots();');
  ok(w.eval('JSON.stringify(computeAxisPlan(plots[0]).metricPanels)') === 'null',
     'so the two no longer need a panel each',
     w.eval('JSON.stringify(computeAxisPlan(plots[0]).metricPanels)'));
  w.close();
}

console.log('\n=== 3. A comparison is typed by its operation, not by hand ===');
{
  const { w, d } = boot();
  openEditor(d);
  const derivedKey = w.eval('METRICS.filter(m=>m.derived)[0].key');
  const sel = fmtOf(d, derivedKey);
  ok(sel.disabled, 'its kind is shown but not editable', sel.value);
  ok(!!nameOf(d, derivedKey), 'its name still is');
  w.close();
}

console.log('\n=== 4. The edit survives a reload ===');
(async () => {
  const { w, d } = boot();
  typedWrong(w, 'ds-1');
  openEditor(d);
  fmtOf(d, 'ms').value = 'duration';
  fire(w, fmtOf(d, 'ms'));
  openEditor(d); openEditor(d);                 // the form re-renders on change
  const inp = nameOf(d, 'ms');
  inp.value = 'Exec time';
  fire(w, inp);

  ok(w.eval('JSON.stringify(measureOverrideSpecs())') === '{"ms":{"label":"Exec time","format":"duration"}}',
     'only the difference from the recipe is recorded',
     w.eval('JSON.stringify(measureOverrideSpecs())'));
  ok(w.eval('JSON.stringify(measureOverrideSpecs()).indexOf("l1")') === -1,
     'a measure left alone stores nothing');

  await wait(60);
  w.eval('STORE.get("ds-1").then(function(r){ window.__rec = r; })');
  await wait(60);
  ok(w.eval('JSON.stringify(window.__rec.recipe.measureOverrides)')
     === '{"ms":{"label":"Exec time","format":"duration"}}', 'it is written to the recipe',
     w.eval('JSON.stringify(window.__rec.recipe.measureOverrides)'));
  const rebuilt = w.eval('(function(){var ds = datasetFromRecord(window.__rec);'
    + 'return JSON.stringify(ds.measures.map(function(m){ return m.key + "/" + m.label + "/" + m.format.key; }));})()');
  ok(rebuilt === '["l1/l1/pct","ms/Exec time/duration"]',
     'and rebuilding the dataset from raw text replays it', rebuilt);
  w.close();

  console.log('\n=== 5. A comparison over a CALCULATED measure produces numbers ===');
  {
    // derivedValue read the stored column, and a calculated measure has none --
    // so a comparison built on one came out null at every tuple, everywhere,
    // with no message. The form offers calculated measures as a base, so this
    // was reachable in three clicks.
    const { w, d } = boot();
    w.eval('addCustomMeasure({key:"calc1",label:"Missed",format:makeFormat("count"),'
      + 'formula:compileFormula("(100% - rateA) * countA", METRICS, "count")})');
    ok(w.eval('derivableMeasures().some(function(m){return m.key==="calc1";})'),
       'the calculator\'s measures are offered as a comparison base');
    w.eval('addDerivedMeasure({op:"diff",base:"calc1",over:"variant",a:"tuned",b:"base"})');
    const key = w.eval('customMeasures().filter(function(m){return m.derived;})[0].key');
    const v = w.eval('JSON.stringify(metricValueAt({dataset:DIM_BY_KEY.dataset.values[0],'
      + 'device:DIM_BY_KEY.device.values[0],size:DIM_BY_KEY.size.values[1],'
      + 'app:DIM_BY_KEY.app.values[0],metric:"' + key + '"}))');
    ok(v !== 'null' && v !== 'undefined', 'and comparing them gives a number', v);
    w.eval('plots[0].included.metric = ["' + key + '"]; renderPlots();');
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the chart draws',
       d.querySelectorAll('#plots rect.bar').length);
    w.close();
  }

  console.log('\n=== 6. A comparison that cannot be computed says so before it is made ===');
  {
    const { w, d } = boot();
    w.eval('setStore(makeMemoryStore());');
    // cc is decided by gpu: cc75 only ever occurs with 2080. Holding every other
    // dimension fixed then leaves the two sides with no tuple in common -- the
    // shape of a real results tree, and previously an empty measure with no note.
    const CSV = 'app,gpu,cc,l1\nA,2080,cc75,60\nB,2080,cc75,55\nC,2080,cc75,70\n'
      + 'A,4070,cc89,68\nB,4070,cc89,63\nC,4070,cc89,78\n';
    const rec = { id: 'r', name: 'r', sources: [{ filename: 'r.csv', text: CSV }], recipe: { columns: [
      { source: 'app', name: 'app', label: 'App', role: 'dimension' },
      { source: 'gpu', name: 'gpu', label: 'GPU', role: 'dimension' },
      { source: 'cc', name: 'cc', label: 'Compute cap', role: 'dimension' },
      { source: 'l1', name: 'l1', label: 'L1 hit rate', role: 'measure', format: 'pct' }] } };
    w.eval('startWithDataset(datasetFromRecord(' + JSON.stringify(rec) + '))');

    d.getElementById('derive-toggle').click();
    const over = d.querySelector('.derive-form select[data-role="over"]');
    over.value = 'gpu';
    fire(w, over);
    const cov = () => d.querySelector('.derive-form .derive-coverage');
    ok(cov().classList.contains('bad'), 'the form says it is empty before you add it',
       cov().textContent);
    ok(/Compute cap/.test(cov().textContent), 'and names the dimension in the way', cov().textContent);
    const marked = Array.from(d.querySelectorAll('.derive-hold-item.blocker'))
      .map(l => l.textContent.replace(/[^A-Za-z ]/g, '').trim());
    ok(marked.join(',') === 'Compute cap', 'marking it in the list too', marked.join(','));

    const cb = d.querySelector('.derive-hold-item input[data-dim="cc"]');
    cb.checked = true;
    fire(w, cb);
    ok(!cov().classList.contains('bad'), 'holding it loose fixes it', cov().textContent);
    ok(/3 points/.test(cov().textContent), 'and counts what the comparison will cover',
       cov().textContent);

    Array.from(d.querySelectorAll('.derive-form button')).find(b => b.textContent === 'Add measure').click();
    const m = w.eval('JSON.stringify(customMeasures()[0].derived)');
    ok(/"hold":\["cc"\]/.test(m), 'the choice is part of the measure', m);
    ok(/mean over Compute cap/.test(w.eval('customMeasures()[0].label')),
       'and its name says the number is a mean, not a single reading',
       w.eval('customMeasures()[0].label'));

    const key = w.eval('customMeasures()[0].key');
    ok(w.eval('metricValueAt({app:"A",cc:"cc75",metric:"' + key + '"})') === -8,
       'the value is the difference of the two sides',
       w.eval('String(metricValueAt({app:"A",cc:"cc75",metric:"' + key + '"}))'));

    w.eval('plots[0].included.metric = ["' + key + '"]; renderPlots();');
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws');
    const note = Array.from(d.querySelectorAll('#plots .chart-note')).map(n => n.textContent).join(' ');
    ok(/GPU and Compute cap/.test(note),
       'neither the compared nor the averaged dimension is left as a grouping — '
       + 'both would repeat one number', note);
    w.close();
  }

  console.log('\n=== 6b. A comparison can be read as a percentage ===');
{
  const { w, d } = boot();
  d.getElementById('derive-toggle').click();
  const box = d.querySelector('.derive-form');
  const ops = Array.from(box.querySelectorAll('select')).pop();
  const labels = Array.from(ops.options).map(o => o.value);
  ok(labels.indexOf('share') !== -1, 'a share is on offer beside the ratio', labels.join(','));

  w.eval('addDerivedMeasure({op:"share",base:"rateA",over:"variant",a:"tuned",b:"base"})');
  const m = w.eval('customMeasures()[0]');
  ok(w.eval('customMeasures()[0].format.key') === 'pct', 'and it is typed as a percentage',
     w.eval('customMeasures()[0].format.key'));
  ok(/as % of/.test(w.eval('customMeasures()[0].label')), 'named for what it is',
     w.eval('customMeasures()[0].label'));

  const ctx = '{dataset:DIM_BY_KEY.dataset.values[0],device:DIM_BY_KEY.device.values[0],'
    + 'size:DIM_BY_KEY.size.values[1],app:DIM_BY_KEY.app.values[0]}';
  const key = w.eval('customMeasures()[0].key');
  const share = w.eval('metricValueAt(Object.assign(' + ctx + ', {metric:"' + key + '"}))');
  w.eval('addDerivedMeasure({op:"ratio",base:"rateA",over:"variant",a:"tuned",b:"base"})');
  const rkey = w.eval('customMeasures()[1].key');
  const ratio = w.eval('metricValueAt(Object.assign(' + ctx + ', {metric:"' + rkey + '"}))');
  ok(Math.abs(share - ratio * 100) < 1e-9,
     'the same quotient as the ratio, stored the way a percentage is stored here',
     share + ' vs ' + ratio);
  w.close();
}

console.log('\n=== 6c. A measure defined on the page can be removed from any of its forms ===');
{
  const { w, d } = boot();
  w.eval('addDerivedMeasure({op:"diff",base:"rateA",over:"variant",a:"tuned",b:"base"})');
  const key = w.eval('customMeasures()[0].key');

  // the comparison form now lists them, as the calculator already did
  d.getElementById('derive-toggle').click();
  const inDerive = d.querySelector('.derive-form .formula-defined');
  ok(!!inDerive, 'the comparison form lists what has been defined');
  d.getElementById('derive-toggle').click();

  // and the measure editor offers it directly
  d.getElementById('measures-toggle').click();
  const rm = d.querySelector('.measure-remove[data-measure="' + key + '"]');
  ok(!!rm, 'the measure editor offers a Remove');
  ok(!d.querySelector('.measure-remove[data-measure="rateA"]'),
     'but only for the page\'s own measures — an imported column is not ours to withdraw');
  rm.click();
  ok(!w.eval('METRIC_BY_KEY["' + key + '"]'), 'and it goes');
  ok(/Removed/.test(d.getElementById('builder-status').textContent), 'with a word about it',
     d.getElementById('builder-status').textContent);
  w.close();
}

console.log('\n=== 6d. Removing something another measure is built on is refused ===');
{
  const { w, d } = boot();
  w.eval('addCustomMeasure({key:"basem",label:"Base m",format:makeFormat("count"),'
    + 'formula:compileFormula("countA * 2", METRICS, "count")})');
  w.eval('addCustomMeasure({key:"onTop",label:"On top",format:makeFormat("count"),'
    + 'formula:compileFormula("[Base m] + 1", METRICS, "count")})');
  d.getElementById('measures-toggle').click();
  d.querySelector('.measure-remove[data-measure="basem"]').click();
  ok(!!w.eval('METRIC_BY_KEY.basem'), 'it stays');
  ok(/On top/.test(d.getElementById('builder-status').textContent),
     'and the thing standing on it is named', d.getElementById('builder-status').textContent);
  w.close();
}

console.log('\n=== 7. Coverage counts partial overlap honestly ===');
  {
    const { w } = boot();
    const cov = w.eval('JSON.stringify(derivedCoverage(DS, {over:"variant",a:"tuned",b:"base"}))');
    const o = JSON.parse(cov);
    ok(o.both > 0, 'the bundle can compare tuned against base', o.both);
    ok(o.blockers.length === 0, 'with nothing in the way');
    ok(o.aOnly + o.bOnly >= 0, 'and a count of the tuples with only one side', o.aOnly + o.bOnly);
    // a value against itself has no second side to find, which is why the form
    // refuses it at the button rather than relying on the coverage line
    const same = JSON.parse(w.eval('JSON.stringify(derivedCoverage(DS, {over:"variant",a:"tuned",b:"tuned"}))'));
    ok(same.both === 0, 'a value compared with itself pairs with nothing', same.both);
    const missing = JSON.parse(w.eval('JSON.stringify(derivedCoverage(DS, {over:"variant",a:"nope",b:"base"}))'));
    ok(missing.both === 0, 'and a value that does not exist is not a crash', missing.both);
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
