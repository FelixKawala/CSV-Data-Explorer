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
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const toggle = (w, d, text) => {
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => l.textContent.indexOf(text) !== -1);
  if (!lab) return false;
  const cb = lab.querySelector('input');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new w.Event('change'));
  return true;
};
function anomalies(d) {
  const bad = [];
  d.querySelectorAll('polyline').forEach(pl => {
    (pl.getAttribute('points') || '').split(' ').forEach(pt => {
      pt.split(',').forEach(n => { if (n && !isFinite(parseFloat(n))) bad.push('point ' + pt); });
    });
  });
  d.querySelectorAll('circle').forEach(c => ['cx', 'cy', 'r'].forEach(a => {
    if (!isFinite(parseFloat(c.getAttribute(a)))) bad.push(a + '=' + c.getAttribute(a));
  }));
  d.querySelectorAll('rect.bar').forEach(r => ['x', 'y', 'width', 'height'].forEach(a => {
    const v = parseFloat(r.getAttribute(a));
    if (!isFinite(v) || ((a === 'width' || a === 'height') && v <= 0)) bad.push(a + '=' + r.getAttribute(a));
  }));
  d.querySelectorAll('text').forEach(t => { if (/NaN|undefined/.test(t.textContent)) bad.push('text=' + t.textContent); });
  return bad;
}

console.log('\n=== 1. Line chart ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const lines = d.querySelectorAll('#plots polyline.series-line');
  const dots = d.querySelectorAll('#plots .series-dot');
  ok(dots.length === 121, 'a marker per data point, same count as the bars had', dots.length);
  ok(lines.length === 22, 'lines break per (Device, size) block by default', lines.length);
  ok(d.querySelectorAll('#plots rect.bar').length === 0, 'no bars in line mode');
  const bands = Array.from(d.querySelectorAll('#plots text.axis-band-label')).map(t => t.textContent);
  ok(bands.indexOf('dev3') !== -1, 'nested grouping bands still drawn', bands.slice(0, 4).join(' '));
  const legend = Array.from(d.querySelectorAll('#plots .legend .item')).map(i => i.textContent);
  ok(legend.join(',') === 'Base,Tuned,Tuned-alt', 'legend names all three series', legend.join(','));
  ok(anomalies(d).length === 0, 'no coordinate anomalies', anomalies(d).slice(0, 3).join('; '));
  w.close();
}

console.log('\n=== 2. Isolated points are never joined across a gap ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  // the sparse variant exists only for alpha, so its points are isolated: it must
  // get markers but no segments, rather than a line implying data it does not have
  const counts = Array.from(d.querySelectorAll('#plots polyline.series-line'))
    .map(l => l.getAttribute('points').trim().split(' ').length);
  ok(counts.every(c => c === 5), 'every segment covers one block of 5 applications', Array.from(new Set(counts)).join(','));
  const dots = d.querySelectorAll('#plots .series-dot').length;
  ok(dots === 121, 'every real point still has a marker', dots);
  ok(dots - counts.reduce((a, b) => a + b, 0) === 11, 'the 11 sparse-variant points are drawn unconnected',
     dots - counts.reduce((a, b) => a + b, 0));
  w.close();
}

console.log('\n=== 2b. Lines over an ordered inner axis (the real use case) ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  // x = size only, one chart per app+Device: now a line means something
  setZone(w, d, 'app', 'facet');
  setZone(w, d, 'device', 'facet');
  const lines = Array.from(d.querySelectorAll('#plots polyline.series-line'));
  ok(lines.length >= 30, 'a line per variant per facet', lines.length);
  const pts = lines.map(l => l.getAttribute('points').trim().split(' ').length);
  ok(pts.some(c => c === 4) || pts.some(c => c === 3), 'each traces the size sweep', Array.from(new Set(pts)).join(','));
  // read one leaf only: the dev1 has no 1024-line config, so facets differ in length
  const leaves = Array.from(d.querySelectorAll('#plots .facet-card')).filter(c => c.querySelector('svg'));
  const ticksOf = card => Array.from(card.querySelectorAll('text.group-label')).map(t => t.textContent);
  const sweeps = leaves.map(ticksOf).map(t => t.join(','));
  ok(sweeps.indexOf('1024,512,256,128') !== -1, 'a full size sweep in order', sweeps[0] + ' | ' + sweeps[1]);
  ok(sweeps.indexOf('512,256,128') !== -1, 'and the dev1 sweep without its missing 1024', sweeps.filter(x => x === '512,256,128').length + ' facets');
  ok(anomalies(d).length === 0, 'no anomalies');
  w.close();
}

console.log('\n=== 3. Second y-axis is opt-in and only offered where it applies ===');
{
  const { w, d } = boot();
  ok(!toggle(w, d, 'second y-axis'), 'not offered with a single metric');

  const b = boot();
  add(b.d, 'Rate B');
  ok(!Array.from(b.d.querySelectorAll('#plots .head-toggle')).some(l => /second y-axis/.test(l.textContent)),
     'not offered when both metrics share a scale');
  b.w.close();

  const c = boot();
  add(c.d, 'Count A');
  ok(c.d.querySelectorAll('#plots .metric-panel').length === 2, 'mixed scales default to panels');
  ok(toggle(c.w, c.d, 'second y-axis'), 'offered once the scales differ');
  ok(c.d.querySelectorAll('#plots .metric-panel').length === 0, 'switching it on replaces the panels');
  ok(anomalies(c.d).length === 0, 'no anomalies', anomalies(c.d).slice(0, 3).join('; '));
  c.w.close();
}

console.log('\n=== 4. What the dual-axis chart actually draws ===');
{
  const { w, d } = boot();
  add(d, 'Count A');
  toggle(w, d, 'second y-axis');
  const right = Array.from(d.querySelectorAll('#plots text.axis-right')).map(t => t.textContent);
  ok(right.length > 0, 'a right-hand axis is labelled', right.join(' '));
  ok(right.some(t => /[KM]$/.test(t)), 'the right axis carries the access-count scale', right.join(' '));
  const left = Array.from(d.querySelectorAll('#plots text.axis-label:not(.axis-right)')).map(t => t.textContent);
  ok(left.some(t => /%$/.test(t)), 'the left axis keeps the percentage scale', left.slice(0, 4).join(' '));

  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the primary metric stays as bars');
  const dashed = Array.from(d.querySelectorAll('#plots polyline.series-line'))
    .filter(p => p.getAttribute('stroke-dasharray'));
  ok(dashed.length > 0, 'the secondary metric is drawn as a dashed line', dashed.length + ' dashed lines');

  const caps = Array.from(d.querySelectorAll('#plots .axis-legend .legend-cap')).map(c => c.textContent);
  ok(caps.length === 2, 'the legend splits into two labelled clusters', caps.join('  ||  '));
  ok(/^Left axis/.test(caps[0]) && /rate %/.test(caps[0]), 'left cluster names its scale', caps[0]);
  ok(/^Right axis/.test(caps[1]) && /counts \(log\)/.test(caps[1]) && /dashed/.test(caps[1]),
     'right cluster names its scale and mark style', caps[1]);
  const groups = d.querySelectorAll('#plots .axis-legend .legend-group');
  ok(groups.length === 2 && groups[1].classList.contains('right'),
     'the right cluster is separated by its own group', groups.length);
  const items = Array.from(groups[0].querySelectorAll('.item')).map(i => i.textContent);
  ok(items.every(t => !/axis/.test(t)), 'per-item "(left axis)" suffixes are gone, the cluster label carries it', items[0]);
  ok(/not comparable across axes/.test(d.querySelector('#plots .axis-legend .legend-note').textContent),
     'and it warns that heights are not comparable');
  ok(anomalies(d).length === 0, 'no anomalies', anomalies(d).slice(0, 3).join('; '));
  w.close();
}

console.log('\n=== 5. Dual axis with a line chart, and moving Metric now matters ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  add(d, 'Count A');
  toggle(w, d, 'second y-axis');
  ok(d.querySelectorAll('#plots rect.bar').length === 0, 'no bars when the chart type is lines');
  const solid = Array.from(d.querySelectorAll('#plots polyline.series-line')).filter(p => !p.getAttribute('stroke-dasharray'));
  const dashed = Array.from(d.querySelectorAll('#plots polyline.series-line')).filter(p => p.getAttribute('stroke-dasharray'));
  ok(solid.length > 0 && dashed.length > 0, 'both scales drawn as lines, secondary dashed', solid.length + ' solid / ' + dashed.length + ' dashed');

  // with a second axis in play, the Metric chip's zone is no longer inert
  const before = d.querySelectorAll('#plots text.axis-right').length;
  setZone(w, d, 'metric', 'x');
  const after = d.querySelectorAll('#plots text.axis-right').length;
  ok(before > 0 && after === 0, 'moving Metric off Series drops the second axis, so the move is visible', before + ' -> ' + after);
  ok(d.querySelectorAll('#plots .metric-panel').length === 2, 'and it goes back to panels', d.querySelectorAll('#plots .metric-panel').length);
  w.close();
}

console.log('\n=== 6. Persistence ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  add(d, 'Count A');
  toggle(w, d, 'second y-axis');
  setTimeout(() => {
    const raw = w.localStorage.getItem('viz-builder-autosave-v1');
    const saved = JSON.parse(raw);
    ok(saved[0].chartType === 'lines' && saved[0].dualAxis === true, 'line type and dual axis saved',
       saved[0].chartType + '/' + saved[0].dualAxis);
    w.close();
    const dom2 = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(win) { win.localStorage.setItem('viz-builder-autosave-v1', raw); },
    });
    const d2 = dom2.window.document;
    d2.querySelector('.mode-tab[data-mode="builder"]').click();
    ok(d2.querySelectorAll('#plots text.axis-right').length > 0, 'restored with its second axis');
    ok(d2.querySelectorAll('#plots polyline.series-line').length > 0, 'and as a line chart');
    dom2.window.close();
    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  }, 600);
}
