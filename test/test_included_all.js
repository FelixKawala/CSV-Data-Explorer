// "all" and "none" on each dimension's Shown/Available list: every value in or
// every value out in one click, where clicking chips is a click per value. The
// per-dimension list is the same decision as the import preselect -- what a
// dimension contributes to a plot -- and gets the same escape hatch.

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
// Blocks are recreated on every re-render, so everything is re-found after a
// click rather than holding a reference the re-render has detached.
const dimBlocks = d => Array.from(d.querySelectorAll('#plots .dims-grid .dim-block'));
const metricBlock = d => d.querySelector('#plots .data-shown-block .dim-block');
const blockOf = (d, name) => dimBlocks(d).find(b => b.querySelector('.dim-label-name').textContent === name);
const shown = b => Array.from(b.querySelectorAll('.dual-col:first-child .dnd-chip'));
const avail = b => Array.from(b.querySelectorAll('.dual-col:nth-child(2) .dnd-chip'));

(async () => {
  console.log('\n=== 1. Every dimension block offers all and none ===');
  {
    const { w, d } = boot();
    ok(dimBlocks(d).length > 0, 'there are per-dimension blocks', dimBlocks(d).length);
    ok(dimBlocks(d).every(b => b.querySelector('.dim-all') && b.querySelector('.dim-none')),
       'each groupable dimension has both buttons');
    ok(!!metricBlock(d) && !!metricBlock(d).querySelector('.dim-all')
       && !!metricBlock(d).querySelector('.dim-none'),
       'and Metric has them too, in Data shown');
    w.close();
  }

  console.log('\n=== 2. none empties a dimension, all refills it ===');
  {
    const { w, d } = boot();
    let dev = blockOf(d, 'Device');
    const before = shown(dev).length;
    ok(before > 0 && avail(dev).length === 0, 'everything is shown to begin with',
       before + ' shown');
    dev.querySelector('.dim-none').click();
    dev = blockOf(d, 'Device');
    ok(shown(dev).length === 0 && avail(dev).length === before,
       'none moves every chip to Available', shown(dev).length + '/' + avail(dev).length);
    ok(/Nothing shown for Device/.test(dev.textContent),
       'and the block says nothing is shown');
    ok(w.eval('plots[0].included.device.length') === 0,
       'the plot holds the empty list', w.eval('plots[0].included.device.length'));

    dev.querySelector('.dim-all').click();
    dev = blockOf(d, 'Device');
    ok(shown(dev).length === before && avail(dev).length === 0,
       'all brings every value back', shown(dev).length + '/' + avail(dev).length);
    ok(w.eval('plots[0].included.device.length') === w.eval('DIM_BY_KEY.device.values.length'),
       'the plot now lists them all',
       w.eval('plots[0].included.device.length + "/" + DIM_BY_KEY.device.values.length'));
    w.close();
  }

  console.log('\n=== 3. The same, for the metric list in Data shown ===');
  {
    const { w, d } = boot();
    let mb = metricBlock(d);
    const total = w.eval('DIM_BY_KEY.metric.values.length');
    ok(shown(mb).length === 1 && total > 1, 'one measure shown of several', shown(mb).length + '/' + total);
    mb.querySelector('.dim-none').click();
    mb = metricBlock(d);
    ok(shown(mb).length === 0 && avail(mb).length === total,
       'none empties the measure list', shown(mb).length + '/' + avail(mb).length);
    ok(/Nothing shown for Metric/.test(mb.textContent), 'and says so');
    ok(d.querySelectorAll('#plots rect.bar').length === 0,
       'with nothing to plot there are no bars');
    mb.querySelector('.dim-all').click();
    mb = metricBlock(d);
    ok(shown(mb).length === total, 'all restores every measure', shown(mb).length);
    ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and the chart draws again',
       d.querySelectorAll('#plots rect.bar').length);
    ok(!/Nothing shown/.test(metricBlock(d).textContent), 'the warning is gone');
    w.close();
  }

  console.log('\n=== 4. A facet dimension narrowed by default refills to the whole set ===');
  {
    const { w, d } = boot();
    let ds = blockOf(d, 'Dataset');
    const total = w.eval('DIM_BY_KEY.dataset.values.length');
    ok(shown(ds).length === 1 && total > 1, 'one dataset shown by default',
       shown(ds).length + '/' + total);
    ds.querySelector('.dim-all').click();
    ds = blockOf(d, 'Dataset');
    ok(shown(ds).length === total, 'all restores the whole set', shown(ds).length);
    ok(d.querySelectorAll('#plots .facet-card').length === total,
       'and one facet card per value, as a full set implies',
       d.querySelectorAll('#plots .facet-card').length);
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  failures++;
  console.log('  FAIL: crashed — ' + e.message);
  console.log(e.stack);
  process.exit(1);
});