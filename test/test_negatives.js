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
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const toggle = (w, d, txt) => {
  const l = Array.from(d.querySelectorAll('#plots .head-toggle')).find(x => x.textContent.indexOf(txt) !== -1);
  if (!l) return false;
  const c = l.querySelector('input'); c.checked = !c.checked; c.dispatchEvent(new w.Event('change')); return true;
};

// every drawn mark must sit inside its own svg's plot box
function escapes(d) {
  const bad = [];
  d.querySelectorAll('#plots .metric-panel, #plots .plot-render').forEach(() => {});
  d.querySelectorAll('#plots svg').forEach(svg => {
    const vb = (svg.getAttribute('viewBox') || '0 0 0 0').split(' ').map(parseFloat);
    const H = vb[3];
    svg.querySelectorAll('rect.bar').forEach(r => {
      const y = parseFloat(r.getAttribute('y')), h = parseFloat(r.getAttribute('height'));
      if (!isFinite(y) || !isFinite(h)) bad.push('NaN rect');
      else if (y < -1 || y + h > H + 1) bad.push('rect ' + y.toFixed(0) + '+' + h.toFixed(0) + ' vs H' + H);
    });
    svg.querySelectorAll('circle.series-dot').forEach(c => {
      const y = parseFloat(c.getAttribute('cy'));
      if (!isFinite(y)) bad.push('NaN dot');
      else if (y < -1 || y > H + 1) bad.push('dot y=' + y.toFixed(0) + ' vs H' + H);
    });
    svg.querySelectorAll('polyline').forEach(p => {
      (p.getAttribute('points') || '').trim().split(' ').forEach(pt => {
        const y = parseFloat(pt.split(',')[1]);
        if (!isFinite(y)) bad.push('NaN point');
        else if (y < -1 || y > H + 1) bad.push('point y=' + y.toFixed(0) + ' vs H' + H);
      });
    });
  });
  return bad;
}
const ticks = (d, sel) => Array.from(d.querySelectorAll('#plots ' + (sel || 'text.axis-label'))).map(t => t.textContent);

console.log('\n=== 1. Bar chart of a delta: bars hang below a real zero line ===');
{
  const { w, d } = boot();
  rm(d, 'L1 hit rate'); add(d, 'Δ L1 (TAPAS−KbK)');
  const t = ticks(d);
  ok(t.some(x => x.indexOf('-') === 0), 'the axis has a negative tick', t.join(' '));
  ok(t.indexOf('0pt') !== -1, 'and a zero tick', t.join(' '));
  const zeroY = parseFloat(d.querySelector('#plots line.baseline').getAttribute('y1'));
  ok(zeroY > 5 && zeroY < 165, 'the zero line sits inside the frame, not on the floor', zeroY.toFixed(1));
  const bars = Array.from(d.querySelectorAll('#plots rect.bar'));
  const below = bars.filter(r => parseFloat(r.getAttribute('y')) + parseFloat(r.getAttribute('height')) > zeroY + 0.5);
  const above = bars.filter(r => parseFloat(r.getAttribute('y')) < zeroY - 0.5);
  ok(below.length > 0 && above.length > 0, 'bars go both ways from zero', above.length + ' up / ' + below.length + ' down');
  ok(escapes(d).length === 0, 'nothing is drawn outside the frame', escapes(d).slice(0, 3).join('; '));
  w.close();
}

console.log('\n=== 2. Line chart of a delta stays a line chart ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  rm(d, 'L1 hit rate'); add(d, 'Δ L1 (TAPAS−KbK)');
  ok(d.querySelectorAll('#plots polyline.series-line').length > 0, 'it draws lines');
  ok(d.querySelectorAll('#plots circle.series-dot').length === 55, 'with a marker per point', d.querySelectorAll('#plots circle.series-dot').length);
  ok(d.querySelectorAll('#plots text.row-label').length === 0, 'and is no longer silently swapped for horizontal bars');
  const t = ticks(d);
  ok(t.some(x => x.indexOf('-') === 0) && t.indexOf('0pt') !== -1, 'negative and zero ticks present', t.join(' '));
  ok(escapes(d).length === 0, 'nothing outside the frame', escapes(d).slice(0, 3).join('; '));
  w.close();
}

console.log('\n=== 3. The horizontal view is still available, on purpose ===');
{
  const { w, d } = boot();
  setType(w, d, 'diverging');
  rm(d, 'L1 hit rate'); add(d, 'Δ L1 (TAPAS−KbK)');
  ok(d.querySelectorAll('#plots text.row-label').length > 0, 'Diverging bars gives the ranked horizontal view');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and renders');
  w.close();
}

console.log('\n=== 4. Dual axis with a negative secondary scale ===');
{
  const { w, d } = boot();
  add(d, 'Δ L1 (TAPAS−KbK)');
  ok(toggle(w, d, 'second y-axis'), 'offered for hit rate + delta');
  const right = ticks(d, 'text.axis-right');
  ok(right.some(x => x.indexOf('-') === 0), 'the right axis now shows its negative range', right.join(' '));
  ok(right.some(x => x.indexOf('0') === 0 || x === '0pt'), 'including zero', right.join(' '));
  ok(d.querySelectorAll('#plots line.zero-line-right').length === 1,
     'the right-hand zero is marked, since it differs from the left one');
  ok(escapes(d).length === 0, 'nothing outside the frame', escapes(d).slice(0, 4).join('; '));

  setType(w, d, 'lines');
  ok(escapes(d).length === 0, 'same as a line chart', escapes(d).slice(0, 4).join('; '));
  w.close();
}

console.log('\n=== 5. Three kinds at once: panels are consistent and aligned ===');
{
  const { w, d } = boot();
  add(d, 'L1 access count');
  add(d, 'Δ L1 (TAPAS−KbK)');
  const panels = d.querySelectorAll('#plots .metric-panel');
  ok(panels.length === 3, 'one panel per metric', panels.length);
  const widths = Array.from(panels).map(p => p.querySelector('svg').getAttribute('width'));
  ok(new Set(widths).size === 1, 'all panels share one width so they line up', widths.join(' / '));
  ok(d.querySelectorAll('#plots text.row-label').length === 0,
     'the delta panel matches the others instead of being a horizontal chart');
  ok(Array.from(panels).every(p => p.querySelectorAll('rect.bar').length > 0), 'every panel draws vertical bars',
     Array.from(panels).map(p => p.querySelectorAll('rect.bar').length).join('/'));
  const gxs = Array.from(panels).map(p => p.querySelector('text.group-label,rect.bar'));
  ok(escapes(d).length === 0, 'nothing outside any frame', escapes(d).slice(0, 4).join('; '));

  // and the shared x-axis really is shared
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /every panel/.test(l.textContent));
  const cb = lab.querySelector('input'); cb.checked = true; cb.dispatchEvent(new w.Event('change'));
  const perPanel = Array.from(d.querySelectorAll('#plots .metric-panel')).map(p => p.querySelectorAll('text.group-label').length);
  ok(new Set(perPanel).size === 1 && perPanel[0] > 0, 'each panel repeats the same tick set', perPanel.join('/'));
  w.close();
}

console.log('\n=== 6. Relative access-count deltas (large negative %) ===');
{
  const { w, d } = boot();
  rm(d, 'L1 hit rate'); add(d, 'Δ L2 accesses (TAPAS vs KbK)');
  const t = ticks(d);
  ok(t.some(x => /^-/.test(x) && /%$/.test(x)), 'negative percent ticks', t.join(' '));
  ok(escapes(d).length === 0, 'nothing outside the frame', escapes(d).slice(0, 3).join('; '));
  setType(w, d, 'lines');
  ok(escapes(d).length === 0, 'as a line chart too', escapes(d).slice(0, 3).join('; '));
  setType(w, d, 'matrix');
  ok(d.querySelectorAll('#plots rect.cell').length > 0, 'and as a matrix');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
