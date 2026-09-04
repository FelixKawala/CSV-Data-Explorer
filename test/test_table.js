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
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const addMetric = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const rmMetric = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const zoneOf = (d, z) => Array.from(d.querySelectorAll('#plots .zone[data-zone="' + z + '"] .zone-chip')).map(c => c.getAttribute('data-dim'));
const tbl = d => d.querySelector('#plots .plot-render .plot-table');
const headRows = d => Array.from(tbl(d).querySelectorAll('thead tr')).map(tr =>
  Array.from(tr.querySelectorAll('th')).map(th => th.textContent + (th.colSpan > 1 ? '/' + th.colSpan : '')));
const bodyRows = d => Array.from(tbl(d).querySelectorAll('tbody tr')).map(tr =>
  Array.from(tr.querySelectorAll('td')).map(td => td.textContent));
const nudge = (d, dim, dir) => {
  const chip = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"]');
  Array.from(chip.querySelectorAll('button.mini')).find(b => b.textContent === dir).click();
};

console.log('\n=== 1. Metric can be reordered inside its zone ===');
{
  const { w, d } = boot();
  addMetric(d, 'Rate B');
  ok(zoneOf(d, 'series').join(',') === 'variant,metric', 'Metric starts at the end of Series', zoneOf(d, 'series').join(','));
  const mchip = d.querySelector('#plots .zone-chip[data-dim="metric"]');
  const minis = Array.from(mchip.querySelectorAll('button.mini')).map(b => b.textContent);
  ok(minis.join('') === '◀▶', 'the Metric chip now has move buttons', minis.join(''));
  nudge(d, 'metric', '◀');
  ok(zoneOf(d, 'series').join(',') === 'metric,variant', 'Metric moved outward', zoneOf(d, 'series').join(','));
  nudge(d, 'metric', '▶');
  ok(zoneOf(d, 'series').join(',') === 'variant,metric', 'and back inward', zoneOf(d, 'series').join(','));

  // it also orders inside the X-axis zone, changing which dim is innermost
  setZone(w, d, 'metric', 'x');
  ok(zoneOf(d, 'x').join(',') === 'device,size,app,metric', 'Metric lands last on the X-axis', zoneOf(d, 'x').join(','));
  nudge(d, 'metric', '◀'); nudge(d, 'metric', '◀');
  ok(zoneOf(d, 'x').join(',') === 'device,metric,size,app', 'and moves outward two slots', zoneOf(d, 'x').join(','));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'chart still renders');
  w.close();
}

console.log('\n=== 2. Table plot type ===');
{
  const { w, d } = boot();
  // the chart-type select specifically -- the plot head has other selects now
  const opts = Array.from(d.querySelectorAll('#plots .plot-head select')[0].querySelectorAll('option'))
    .map(o => o.value);
  ok(opts.join(',') === 'bars,lines,diverging,correlation,matrix,table', 'Table is offered as a plot type', opts.join(','));
  setType(w, d, 'table');
  ok(!!tbl(d), 'a table renders');
  ok(d.querySelector('#plots .zone[data-zone="x"] .zone-name').textContent === 'Columns', 'the X zone is called Columns');
  ok(d.querySelector('#plots .zone[data-zone="series"] .zone-name').textContent === 'Rows', 'the Series zone is called Rows');

  // default: columns = device x size x app -> 3 header levels; rows = variant
  const hr = headRows(d);
  ok(hr.length === 3, 'one header row per column dimension', hr.length);
  ok(hr[0][0] === 'Variant', 'first column describes the row grouping', hr[0][0]);
  ok(hr[0].slice(1).some(t => t.indexOf('dev1/') === 0), 'Device heading spans its columns', hr[0].slice(1, 4).join(' '));
  ok(hr[2].indexOf('beta') !== -1, 'innermost heading is the Application', hr[2].slice(0, 5).join(' '));

  const br = bodyRows(d);
  ok(br.length === 3, 'one row per variant', br.length);
  ok(br[0][0] === 'Base' && br[1][0] === 'Tuned', 'leading cells name the row', br.map(r => r[0]).join('/'));
  ok(/%$/.test(br[0][1]), 'value cells are formatted', br[0][1]);
  ok(br[0].length === 1 + 55, 'value column per Device/size/app combination', br[0].length);
  w.close();
}

console.log('\n=== 3. Column headings are a mix of dimensions incl. Metric ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  addMetric(d, 'Rate B');
  setZone(w, d, 'metric', 'x');            // metric joins the column headings
  setZone(w, d, 'app', 'series');          // application becomes a row descriptor
  setZone(w, d, 'device', 'series');
  const hr = headRows(d);
  ok(hr[0].slice(0, 2).join(',') === 'Variant,Application' || hr[0].slice(0, 3).indexOf('Device') !== -1,
     'row dimensions become the leading columns', hr[0].slice(0, 4).join(','));
  const last = hr[hr.length - 1];
  ok(last.indexOf('Rate A') !== -1 && last.indexOf('Rate B') !== -1,
     'both metrics appear as column headings', last.slice(0, 6).join(' '));
  const br = bodyRows(d);
  const lead = br[0].slice(0, 3);
  ok(lead.length === 3 && lead.every(t => t.length > 0), 'each row carries its full descriptor', lead.join(' | '));
  w.close();
}

console.log('\n=== 4. A table may mix scales a chart cannot ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  addMetric(d, 'Count A');
  setZone(w, d, 'metric', 'x');
  ok(d.querySelectorAll('#plots .metric-panel').length === 0, 'no forced panels in a table');
  ok(!!tbl(d), 'the table renders');
  const last = headRows(d)[headRows(d).length - 1];
  ok(last.indexOf('Rate A') !== -1 && last.indexOf('Count A') !== -1,
     'both a percentage and a count are columns', last.slice(0, 4).join(' '));
  const row = bodyRows(d)[0];
  const pct = row.filter(t => /%$/.test(t)).length;
  const counts = row.filter(t => /[KM]$/.test(t)).length;
  ok(pct > 0 && counts > 0, 'each cell formats itself by its own metric', pct + ' pct cells, ' + counts + ' count cells');
  w.close();
}

console.log('\n=== 5. Delta cells and gaps ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  rmMetric(d, 'Rate A');
  addMetric(d, 'Δ Rate A (Tuned−Base)');
  const cells = Array.from(tbl(d).querySelectorAll('tbody td.num'));
  ok(cells.some(c => c.classList.contains('pos')) && cells.some(c => c.classList.contains('neg')),
     'improvements and regressions are marked');
  ok(cells.some(c => /pt$/.test(c.textContent)), 'delta cells keep their unit', cells.find(c => /pt$/.test(c.textContent)).textContent);

  // a column present for some rows but not others must read as a gap, not a wrong
  // number: Tuned-altnterleaved only exists for alpha
  const { w: w2, d: d2 } = boot();
  setType(w2, d2, 'table');
  const rows2 = bodyRows(d2);
  const tunedAlt = rows2.find(r => r[0] === 'Tuned-alt');
  ok(!!tunedAlt, 'the sparse-variant row is present');
  const gaps = tunedAlt.filter(t => t === '—').length;
  const vals = tunedAlt.slice(1).filter(t => t !== '—').length;
  ok(gaps > 0 && vals > 0, 'it has values for alpha and gaps elsewhere', vals + ' values, ' + gaps + ' gaps');
  const emptyCells = Array.from(tbl(d2).querySelectorAll('tbody td.num.empty'));
  ok(emptyCells.length === gaps && emptyCells.every(c => c.textContent === '—'), 'gaps render as —', emptyCells.length);
  // and the columns that do have data are never blanked
  ok(rows2[0].slice(1).every(t => t !== '—'), 'the Base row is fully populated');
  w.close(); w2.close();
}

console.log('\n=== 6. Table persists and survives a reload ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  addMetric(d, 'Rate B');
  setZone(w, d, 'metric', 'x');
  nudge(d, 'metric', '◀');
  const order = zoneOf(d, 'x').join(',');
  setTimeout(() => {
    const raw = w.localStorage.getItem('viz-builder-autosave-v1');
    const saved = JSON.parse(raw);
    ok(saved[0].chartType === 'table', 'chart type persisted', saved[0].chartType);
    ok(typeof saved[0].metricPos === 'number', 'metric position persisted', saved[0].metricPos);
    w.close();

    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('viz-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(!!d2.querySelector('#plots .plot-table'), 'table restored after reload');
    ok(zoneOf(d2, 'x').join(',') === order, 'metric position restored', zoneOf(d2, 'x').join(','));
    dom2.window.close();

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
