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
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
function exportParts(d) {
  const m = d.getElementById('tex-modal');
  const tabs = Array.from(m.querySelectorAll('.tex-tab'));
  const out = {};
  tabs.forEach(t => { t.click(); out[t.textContent] = m.querySelector('textarea').value; });
  return out;
}
const nonAscii = t => { const m = t.match(/[^\x00-\x7F]/g); return m ? Array.from(new Set(m)).join('') : ''; };

console.log('\n=== 1. The unicode that broke pdflatex is gone ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  add(d, 'Δ Rate A (Tuned−Base)');
  setZone(w, d, 'metric', 'x');
  ok(d.querySelectorAll('#plots .plot-table td.repeat').length > 0, 'the table does contain ditto marks');
  Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Export TikZ').click();
  const parts = exportParts(d);
  Object.keys(parts).forEach(k => {
    ok(nonAscii(parts[k]) === '', k + ' is pure ASCII', nonAscii(parts[k]) || 'clean');
  });
  const tex = parts[Object.keys(parts)[0]];
  ok(/\$\\prime\\prime\$/.test(tex), 'the ditto mark became math double-prime');
  ok(/\$\\Delta\$/.test(tex), 'and Delta is still a math symbol');
  w.close();
}

console.log('\n=== 2. Every chart type exports pure ASCII ===');
{
  for (const t of ['bars', 'lines', 'diverging', 'matrix', 'table']) {
    const { w, d } = boot();
    if (t === 'diverging') { rm(d, 'Rate A'); add(d, 'Δ Count A (Tuned vs Base)'); }
    setType(w, d, t);
    Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Export TikZ').click();
    const parts = exportParts(d);
    const bad = Object.keys(parts).map(k => nonAscii(parts[k])).join('');
    ok(bad === '', t + ' exports clean', bad || 'ok, ' + Object.keys(parts).length + ' file(s)');
    w.close();
  }
}

console.log('\n=== 3. The panel is styled, not a grey void ===');
{
  const { w, d } = boot();
  d.querySelector('#plots .leaf-tools button').click();
  const modal = d.getElementById('tex-modal');
  ok(!!modal.closest('.viz-root'), 'the panel sits inside .viz-root, where the theme lives');
  const card = modal.querySelector('.tex-card');
  const cs = w.getComputedStyle(card);
  ok(cs.getPropertyValue('--surface-1').trim() !== '', 'so its custom properties resolve',
     cs.getPropertyValue('--surface-1').trim());
  ok(cs.getPropertyValue('--text-primary').trim() !== '', 'including the text colour');
  w.close();
}

console.log('\n=== 4. pgfplots + CSV is offered alongside the standalone TikZ ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  setZone(w, d, 'app', 'facet');
  setZone(w, d, 'device', 'facet');
  d.querySelector('#plots .leaf-tools button').click();
  const parts = exportParts(d);
  const names = Object.keys(parts);
  ok(names.length === 3, 'three files: standalone, pgfplots, data', names.join(' | '));
  ok(names.some(n => /-pgfplots\.tex$/.test(n)) && names.some(n => /\.csv$/.test(n)), 'named clearly');

  const pgf = parts[names.find(n => /-pgfplots\.tex$/.test(n))];
  const csv = parts[names.find(n => /\.csv$/.test(n))];
  ok(/\\usepackage\{pgfplots\}/.test(pgf), 'the preamble requirement is stated');
  ok(/\\pgfplotstableread\[col sep=comma\]\{[\w-]+\.csv\}/.test(pgf), 'it reads the csv by name');
  ok(new RegExp('\\{' + names.find(n => /\.csv$/.test(n)).replace('.', '\\.') + '\\}').test(pgf),
     'and the name matches the file actually offered');
  ok((pgf.match(/\\addplot table /g) || []).length === 3, 'one addplot per series', (pgf.match(/\\addplot table /g) || []).length);
  ok(/\\addlegendentry\{Base\}/.test(pgf), 'with legend entries');
  ok(/xticklabels from table=/.test(pgf), 'tick labels come from the data, not hardcoded');

  const lines = csv.trim().split('\n');
  ok(/^index,label,/.test(lines[0]), 'the csv has a header', lines[0]);
  ok(lines.length === 4, 'a row per x position', lines.length - 1 + ' rows');
  const cells = lines[1].split(',');
  ok(cells[0] === '0' && cells[1] === '512', 'index and label first', cells.slice(0, 2).join(','));
  // check the value against the page's own data rather than a baked-in number,
  // so the assertion survives a regenerated fixture
  const DATA = JSON.parse(d.querySelector('script[type="application/json"]').textContent);
  const expect = DATA['setA'].data.alpha['dev1_512'].rateA.base;
  ok(Math.abs(parseFloat(cells[3]) - expect) < 0.01, 'and the real value', cells[3] + ' vs ' + expect);
  w.close();
}

console.log('\n=== 5. The pgfplots column indices actually line up ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  setZone(w, d, 'app', 'facet');
  setZone(w, d, 'device', 'facet');
  d.querySelector('#plots .leaf-tools button').click();
  const parts = exportParts(d);
  const pgf = parts[Object.keys(parts).find(n => /-pgfplots\.tex$/.test(n))];
  const csv = parts[Object.keys(parts).find(n => /\.csv$/.test(n))];
  const header = csv.trim().split('\n')[0].split(',');
  const idxs = (pgf.match(/y index=(\d+)/g) || []).map(m => parseInt(m.split('=')[1], 10));
  const legends = (pgf.match(/\\addlegendentry\{([^}]*)\}/g) || []).map(m => /\{([^}]*)\}/.exec(m)[1]);
  ok(idxs.length === legends.length, 'an index per legend entry', idxs.join(',') + ' / ' + legends.join(','));
  const matched = idxs.every((ix, i) => header[ix] && header[ix].replace(/[^A-Za-z0-9]/g, '') === legends[i].replace(/[^A-Za-z0-9]/g, ''));
  ok(matched, 'each y index points at that series column',
     idxs.map((ix, i) => ix + '->' + header[ix] + ' vs ' + legends[i]).join(' | '));
  w.close();
}

console.log('\n=== 6. Log scale and zero line are carried over ===');
{
  const { w, d } = boot();
  rm(d, 'Rate A'); add(d, 'Count A');
  setZone(w, d, 'app', 'facet'); setZone(w, d, 'device', 'facet');
  d.querySelector('#plots .leaf-tools button').click();
  let parts = exportParts(d);
  let pgf = parts[Object.keys(parts).find(n => /-pgfplots\.tex$/.test(n))];
  ok(/ymode=log/.test(pgf), 'an access-count axis is logarithmic');
  ok(/ylabel=\{counts \(log\)\}/.test(pgf), 'and labelled as such', (/ylabel=\{[^}]*\}/.exec(pgf) || [])[0]);
  w.close();

  const b = boot();
  rm(b.d, 'Rate A'); add(b.d, 'Δ Rate A (Tuned−Base)');
  setZone(b.w, b.d, 'app', 'facet'); setZone(b.w, b.d, 'device', 'facet');
  b.d.querySelector('#plots .leaf-tools button').click();
  pgf = exportParts(b.d)[Object.keys(exportParts(b.d)).find(n => /-pgfplots\.tex$/.test(n))];
  ok(/extra y ticks=\{0\}/.test(pgf), 'a delta axis gets an explicit zero line');
  b.w.close();
}

console.log('\n=== 7. Several charts, several csv files ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'facet');
  Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Export TikZ').click();
  const parts = exportParts(d);
  const csvs = Object.keys(parts).filter(n => /\.csv$/.test(n));
  ok(csvs.length === 3, 'one csv per facet', csvs.join(' | '));
  const pgf = parts[Object.keys(parts).find(n => /-pgfplots\.tex$/.test(n))];
  csvs.forEach(c => ok(pgf.indexOf(c) !== -1, 'the tex references ' + c));
  ok((pgf.match(/\\begin\{axis\}/g) || []).length === 3, 'and builds three axes');
  w.close();
}

console.log('\n=== 8. A table exports its data too ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  ok(Array.from(d.querySelectorAll('#plots .leaf-tools button')).map(b => b.textContent).join(' ')
     === 'TikZ + CSV SVG PNG', 'a table gets its own export row',
     Array.from(d.querySelectorAll('#plots .leaf-tools button')).map(b => b.textContent).join(' '));
  d.querySelector('#plots .leaf-tools button').click();
  const parts = exportParts(d);
  const names = Object.keys(parts);
  ok(names.length === 2, 'the tex and the csv are both offered', names.join(' | '));
  ok(names.some(n => /\.csv$/.test(n)), 'including a csv');
  ok(!names.some(n => /pgfplots/.test(n)), 'but no pgfplots axis, which a pivot table has no use for');
  const csv = parts[names.find(n => /\.csv$/.test(n))];
  const lines = csv.trim().split('\n');
  ok(/^Variant,/.test(lines[0]), 'row dimensions head the csv', lines[0].slice(0, 40));
  ok(lines.length === 4, 'a row per variant', lines.length - 1);
  ok(lines[0].split(',').length === 56, 'a column per value column', lines[0].split(',').length);
  ok(nonAscii(csv) === '', 'and it is LaTeX-safe', nonAscii(csv) || 'clean');
  w.close();
}

console.log('\n=== 9. Figures report how far over the page they are ===');
{
  const { w, d } = boot();
  d.querySelector('#plots .leaf-tools button').click();
  const wide = exportParts(d)[Object.keys(exportParts(d))[0]];
  ok(/Natural width \d+pt/.test(wide), 'the natural width is stated', (/% Natural width [^\n]*/.exec(wide) || [])[0]);
  ok(/no scaling will save this/.test(wide), 'and a 5x-over figure is told so plainly');
  ok(/move a dimension from the x-axis/.test(wide), 'with the actual remedy');
  w.close();

  const b = boot();
  ['app', 'device'].forEach(k => setZone(b.w, b.d, k, 'facet'));
  ['Application', 'Device'].forEach(lab => {
    const blk = Array.from(b.d.querySelectorAll('#plots .dim-block'))
      .find(x => x.querySelector('.dim-label').textContent.trim().indexOf(lab) === 0);
    Array.from(blk.querySelectorAll('.dual-col')[0].querySelectorAll('.dnd-chip')).slice(1).forEach(c => c.click());
  });
  b.d.querySelector('#plots .leaf-tools button').click();
  const narrow = exportParts(b.d)[Object.keys(exportParts(b.d))[0]];
  ok(/It already fits a single column/.test(narrow), 'a figure that fits is told that instead');
  ok(!/resizebox/.test(narrow), 'and is not offered a pointless resizebox');
  b.w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
