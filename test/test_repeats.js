const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/cache_explorer.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot(blockDownload) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(win) {
      win.__files = [];
      win.URL.createObjectURL = b => { win.__b = b; return 'blob:x'; };
      win.URL.revokeObjectURL = () => {};
      const rc = win.HTMLAnchorElement.prototype.click;
      win.HTMLAnchorElement.prototype.click = function () {
        // a sandboxed page silently ignores the click instead of raising
        if (this.download) { if (!blockDownload) win.__files.push(this.download); return; }
        return rc.apply(this, arguments);
      };
    },
  });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const rows = d => Array.from(d.querySelectorAll('#plots .plot-table tbody tr'))
  .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));

console.log('\n=== 1. Export shows the source, not just a silent download ===');
{
  const { w, d } = boot(false);
  d.querySelector('#plots .leaf-tools button').click();
  const modal = d.getElementById('tex-modal');
  ok(!!modal, 'a panel opens with the export');
  const area = modal.querySelector('textarea.tex-source');
  ok(!!area && area.readOnly, 'the source is shown in a read-only box');
  ok(/\\begin\{tikzpicture\}/.test(area.value), 'and it is the TikZ source', area.value.split('\n')[0]);
  ok(/\.tex$/.test(modal.querySelector('.tex-name').textContent), 'the filename is shown', modal.querySelector('.tex-name').textContent);
  const btns = Array.from(modal.querySelectorAll('.tex-head button')).map(b => b.textContent);
  ok(btns.indexOf('Download') !== -1 && btns.indexOf('Select all') !== -1 && btns.indexOf('Close') !== -1,
     'download, select-all and close are offered', btns.join(' | '));
  const tabs = Array.from(modal.querySelectorAll('.tex-tab')).map(b => b.textContent);
  ok(tabs.length === 3, 'and a tab per exported file', tabs.join(' | '));

  Array.from(modal.querySelectorAll('button')).find(b => b.textContent === 'Download').click();
  ok(w.__files.length === 1 && /\.tex$/.test(w.__files[0]), 'the download fires when allowed', w.__files.join(','));
  Array.from(modal.querySelectorAll('button')).find(b => b.textContent === 'Close').click();
  ok(!d.getElementById('tex-modal'), 'and it closes');
  w.close();
}

console.log('\n=== 2. A blocked download still leaves the source reachable ===');
{
  const { w, d } = boot(true);
  d.querySelector('#plots .leaf-tools button').click();
  const modal = d.getElementById('tex-modal');
  ok(!!modal && modal.querySelector('textarea').value.length > 200, 'the panel still carries the full source',
     modal.querySelector('textarea').value.length + ' chars');
  Array.from(modal.querySelectorAll('button')).find(b => b.textContent === 'Download').click();
  ok(w.__files.length === 0, 'the download really was blocked');
  ok(/sandboxed|refused/.test(modal.querySelector('.tex-note').textContent),
     'and the note says so instead of claiming success', modal.querySelector('.tex-note').textContent.slice(0, 70));
  w.close();
}

console.log('\n=== 3. The duplicated delta values ===');
{
  const { w, d } = boot(false);
  setType(w, d, 'table');
  add(d, 'Δ L1 (TAPAS−KbK)');
  setZone(w, d, 'metric', 'x');
  // columns are ... x Variant x Metric, so each delta appears once per variant
  const all = rows(d);
  const perRow = all.map(r => r.filter(t => t === '″').length);
  const dittos = perRow.reduce((a, b) => a + b, 0);
  ok(dittos > 0, 'repeats are marked rather than printed again', dittos + ' cells over ' + all.length + ' rows');
  ok(perRow[0] === 0, 'the first variant keeps every number', perRow.join('/'));

  const cells = Array.from(d.querySelectorAll('#plots .plot-table td.repeat'));
  ok(cells.length === dittos, 'they carry a class for styling', cells.length);
  ok(/does not vary by Variant/.test(cells[0].title), 'and the reason on hover', cells[0].title.slice(0, 70));
  ok(/pt$/.test(cells[0].title.split(' —')[0]), 'the real number is still available', cells[0].title.split(' —')[0]);

  // hit-rate columns must be untouched: they genuinely differ per variant
  const shown = all[1].filter(t => /%$/.test(t)).length;
  ok(shown > 0, 'hit-rate values are all still printed', shown);
  const note = Array.from(d.querySelectorAll('#plots .chart-note')).map(n => n.textContent).join(' ');
  ok(/repeats because the metric does not vary/.test(note), 'the table explains the marker');
  w.close();
}

console.log('\n=== 4. The user can switch it off ===');
{
  const { w, d } = boot(false);
  setType(w, d, 'table');
  add(d, 'Δ L1 (TAPAS−KbK)');
  setZone(w, d, 'metric', 'x');
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /collapse repeated/.test(l.textContent));
  ok(!!lab, 'the toggle is offered');
  ok(lab.querySelector('input').checked, 'on by default');
  const cb = lab.querySelector('input');
  cb.checked = false; cb.dispatchEvent(new w.Event('change'));
  ok(d.querySelectorAll('#plots .plot-table td.repeat').length === 0, 'switching it off prints every value again');
  const r = rows(d)[0];
  ok(r.filter(t => t === '″').length === 0, 'no ditto marks remain');
  ok(r.filter(t => /pt$/.test(t)).length > 1, 'the delta value appears once per variant, as before',
     r.filter(t => /pt$/.test(t)).length);
  w.close();
}

console.log('\n=== 5. Not offered when it cannot apply ===');
{
  const { w, d } = boot(false);
  setType(w, d, 'table');
  ok(!Array.from(d.querySelectorAll('#plots .head-toggle')).some(l => /collapse repeated/.test(l.textContent)),
     'hidden with no delta metric');

  const b2 = boot(false);
  setType(b2.w, b2.d, 'table');
  add(b2.d, 'Δ L1 (TAPAS−KbK)');
  setZone(b2.w, b2.d, 'metric', 'x');
  setZone(b2.w, b2.d, 'variant', 'facet');
  ok(!Array.from(b2.d.querySelectorAll('#plots .head-toggle')).some(l => /collapse repeated/.test(l.textContent)),
     'hidden when Variant is not part of the table grouping');
  ok(b2.d.querySelectorAll('#plots .plot-table td.repeat').length === 0, 'and nothing is collapsed');
  b2.w.close(); w.close();
}

console.log('\n=== 6. Works with Variant on the rows instead of the columns ===');
{
  const { w, d } = boot(false);
  setType(w, d, 'table');
  add(d, 'Δ L1 (TAPAS−KbK)');
  setZone(w, d, 'metric', 'x');
  setZone(w, d, 'variant', 'series');   // variant becomes the row dimension
  const marked = d.querySelectorAll('#plots .plot-table td.repeat').length;
  ok(marked > 0, 'vertical repeats are caught too', marked);
  const first = rows(d).map(r => r.filter(t => t === '″').length);
  ok(first[0] === 0 && first[1] > 0, 'the first variant row keeps the numbers, later ones are marked', first.join('/'));
  w.close();
}

console.log('\n=== 7. Persists ===');
{
  const { w, d } = boot(false);
  setType(w, d, 'table');
  add(d, 'Δ L1 (TAPAS−KbK)');
  setZone(w, d, 'metric', 'x');
  const cb = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /collapse repeated/.test(l.textContent)).querySelector('input');
  cb.checked = false; cb.dispatchEvent(new w.Event('change'));
  setTimeout(() => {
    const raw = w.localStorage.getItem('cache-explorer-builder-autosave-v1');
    ok(JSON.parse(raw)[0].collapseRepeats === false, 'the choice is saved');
    w.close();
    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('cache-explorer-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(d2.querySelectorAll('#plots .plot-table td.repeat').length === 0, 'and restored');
    dom2.window.close();
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
