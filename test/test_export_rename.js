// The export dialog: the filename is editable, and renaming the .csv renames it
// everywhere the figure refers to it. Plus the second tab row for imported files.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function boot(seed) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: 'https://example.com/', beforeParse(w) { if (seed) seed(w); },
  });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
const openExport = d =>
  Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'TikZ').click();
const tabs = d => Array.from(d.querySelectorAll('#tex-modal .tex-tab'));
const tabNamed = (d, re) => tabs(d).find(t => re.test(t.title));
function textOf(d, re) {
  const t = tabNamed(d, re);
  t.click();
  return d.querySelector('#tex-modal textarea').value;
}
function rename(w, d, next) {
  const inp = d.getElementById('tex-filename');
  inp.value = next;
  inp.dispatchEvent(new w.Event('change'));
}

(async () => {
  console.log('\n=== 1. The name is an editable field showing the active part ===');
  {
    const { w, d } = boot();
    openExport(d);
    const inp = d.getElementById('tex-filename');
    ok(!!inp && inp.tagName === 'INPUT', 'the filename is an input, not a caption');
    ok(/\.tex$/.test(inp.value), 'showing the first part', inp.value);
    tabNamed(d, /\.csv$/).click();
    ok(/\.csv$/.test(inp.value), 'and following the tab that is open', inp.value);
    w.close();
  }

  console.log('\n=== 2. Renaming the .csv renames it in the figure that reads it ===');
  {
    const { w, d } = boot();
    openExport(d);
    const before = textOf(d, /pgfplots\.tex$/);
    const oldCsv = tabNamed(d, /\.csv$/).title;
    ok(before.indexOf(oldCsv) !== -1, 'the pgfplots source names the csv', oldCsv);

    tabNamed(d, /\.csv$/).click();
    rename(w, d, 'l1-hit-rate.csv');
    ok(!!tabNamed(d, /^l1-hit-rate\.csv$/), 'the tab carries the new filename');

    const after = textOf(d, /pgfplots\.tex$/);
    ok(after.indexOf(oldCsv) === -1, 'the old name is gone from the pgfplots source');
    ok(/\\pgfplotstableread\[col sep=comma\]\{l1-hit-rate\.csv\}/.test(after),
       'the \\pgfplotstableread reads the new one');
    ok(/table \[[^\]]*\] \{l1-hit-rate\.csv\}/.test(after), 'and so does every \\addplot');
    ok(after.split('l1-hit-rate.csv').length - 1 === before.split(oldCsv).length - 1,
       'every reference was rewritten, not just the first',
       after.split('l1-hit-rate.csv').length - 1 + ' of ' + (before.split(oldCsv).length - 1));
    w.close();
  }

  console.log('\n=== 3. Renaming a .tex changes only what it downloads as ===');
  {
    const { w, d } = boot();
    openExport(d);
    const csvBefore = textOf(d, /\.csv$/);
    tabNamed(d, /pgfplots\.tex$/).click();
    rename(w, d, 'figure-3.tex');
    ok(!!tabNamed(d, /^figure-3\.tex$/), 'the .tex is renamed');
    ok(textOf(d, /\.csv$/) === csvBefore, 'and the .csv is untouched by it');
    w.close();
  }

  console.log('\n=== 4. An empty or unchanged name is refused, not applied ===');
  {
    const { w, d } = boot();
    openExport(d);
    tabNamed(d, /\.csv$/).click();
    const was = d.getElementById('tex-filename').value;
    rename(w, d, '   ');
    ok(d.getElementById('tex-filename').value === was, 'the field snaps back', was);
    ok(!!tabNamed(d, new RegExp('^' + was.replace('.', '\\.') + '$')), 'and the part keeps its name');
    w.close();
  }

  console.log('\n=== 5. Imported files sit on a second tab row ===');
  {
    const CSV = 'app,device,rate\nalpha,d1,10\nalpha,d2,20\nbeta,d1,30\nbeta,d2,40\n';
    const { w, d } = boot(win => { win.__seedStore = true; });
    d.querySelector('.mode-tab[data-mode="data"]').click();
    const input = d.getElementById('csv-input');
    Object.defineProperty(input, 'files', {
      value: [new w.File([CSV], 'measured.csv', { type: 'text/csv' })], configurable: true,
    });
    input.dispatchEvent(new w.Event('change'));
    await wait(80);
    d.querySelector('.import-actions .btn.primary').click();
    await wait(80);

    openExport(d);
    const rows = Array.from(d.querySelectorAll('#tex-modal .tex-tabs'));
    ok(rows.length === 2, 'there are two tab rows');
    const extra = Array.from(rows[1].querySelectorAll('.tex-tab'));
    ok(extra.length === 1 && extra[0].title === 'measured.csv',
       'the imported file is on the second row', extra.map(t => t.title).join(', '));
    const first = Array.from(rows[0].querySelectorAll('.tex-tab'));
    ok(first.every(t => t.title !== 'measured.csv'), 'and not on the first');
    ok(first.length >= 3, 'which still holds the figure and its data', first.length + ' tabs');

    // renaming the exported .csv must not touch the imported one that shares no bytes
    const importedBefore = (extra[0].click(), d.querySelector('#tex-modal textarea').value);
    first.find(t => /-1?\.csv$/.test(t.title) || /\.csv$/.test(t.title)).click();
    rename(w, d, 'exported.csv');
    extra[0].click();
    ok(d.querySelector('#tex-modal textarea').value === importedBefore,
       'the imported file is left exactly as it was imported');
    w.close();
  }

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
