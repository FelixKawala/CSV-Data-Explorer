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
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();

// what a renderer would choke on
function svgProblems(t) {
  const bad = [];
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(t)) bad.push('no xmlns');
  if (/var\(--/.test(t)) bad.push('unresolved CSS variable');
  if (/NaN|undefined|Infinity/.test(t)) bad.push('bad number: ' + (/(\S*(?:NaN|undefined|Infinity)\S*)/.exec(t) || [])[1]);
  const opens = (t.match(/<svg\b/g) || []).length;
  const closes = (t.match(/<\/svg>/g) || []).length;
  if (opens !== closes) bad.push('svg ' + opens + '/' + closes);
  (t.match(/(?:fill|stroke)="([^"]*)"/g) || []).forEach(m => {
    const v = /"([^"]*)"/.exec(m)[1];
    if (v !== 'none' && !/^#[0-9A-Fa-f]{6}$/.test(v)) bad.push('non-hex paint ' + v);
  });
  return Array.from(new Set(bad));
}
const svgOf = (w, sel) => w.eval('svgSource(document.querySelector("' + sel + '"), window)');

console.log('\n=== 1. A chart exports as standalone SVG ===');
{
  const { w, d } = boot();
  const btns = Array.from(d.querySelectorAll('#plots .leaf-tools button')).map(b => b.textContent);
  ok(btns.join(' ') === 'TikZ SVG PNG', 'every chart offers TikZ, SVG and PNG', btns.join(' '));

  const src = svgOf(w, '#plots .leaf-shell');
  ok(!!src && src.text.length > 1000, 'an SVG is produced', src && src.text.length + ' chars');
  ok(svgProblems(src.text).length === 0, 'it is renderable', svgProblems(src.text).join('; '));
  ok(/^<\?xml/.test(src.text), 'with an XML declaration');
  ok(src.width > 0 && src.height > 0, 'and real dimensions', src.width + '×' + src.height);
  const bars = (src.text.match(/<rect[^>]*class="bar"/g) || []).length;
  ok(bars === d.querySelectorAll('#plots rect.bar').length, 'one rect per drawn bar', bars);
  w.close();
}

console.log('\n=== 2. Stylesheet colours are baked in ===');
{
  const { w, d } = boot();
  const t = svgOf(w, '#plots .leaf-shell').text;
  const barFills = Array.from(new Set((t.match(/<rect[^>]*class="bar"[^>]*>/g) || [])
    .map(b => (b.match(/fill="([^"]*)"/) || [])[1])));
  ok(barFills.length === 3, 'the three series keep three distinct fills', barFills.join(' '));
  ok(barFills.every(f => /^#[0-9A-F]{6}$/i.test(f)), 'as literal hex, not variables', barFills.join(' '));
  ok(barFills.indexOf('#000000') === -1, 'and nothing fell back to black');
  const strokes = Array.from(new Set((t.match(/<line[^>]*stroke="([^"]*)"/g) || [])
    .map(l => (l.match(/stroke="([^"]*)"/) || [])[1])));
  ok(strokes.length >= 2, 'grid and baseline keep their own greys', strokes.join(' '));
  ok(/font-family="[^"]*system-ui|font-size="/.test(t), 'and text carries its typography');
  w.close();
}

console.log('\n=== 3. The legend travels with the figure ===');
{
  const { w, d } = boot();
  const t = svgOf(w, '#plots .leaf-shell').text;
  ['Base', 'Tuned', 'Tuned-alt'].forEach(name => {
    ok(t.indexOf('>' + name + '<') !== -1, 'the legend names ' + name);
  });
  const swatches = (t.match(/<rect[^>]*rx="2"/g) || []).length;
  ok(swatches === 3, 'with a swatch each', swatches);
  w.close();
}

console.log('\n=== 4. Export at panel and facet level, captioned ===');
{
  const { w, d } = boot();
  setZone(w, d, 'device', 'facet');
  const facetBtns = Array.from(d.querySelectorAll('#plots .facet-card > h5 button')).map(b => b.textContent);
  ok(facetBtns.filter(t => t === 'SVG').length === 3, 'each of the three facet cards offers an SVG export', facetBtns.join(' '));
  const one = svgOf(w, '#plots .facet-card');
  ok((one.text.match(/<g transform="translate\(0,0\)"/g) || []).length === 1, 'a facet exports its own chart');
  ok(/Device: dev1/.test(one.text), 'captioned with the facet', (/>([^<]*Device[^<]*)</.exec(one.text) || [])[1]);
  ok(svgProblems(one.text).length === 0, 'renderable', svgProblems(one.text).join('; '));

  const whole = svgOf(w, '#plot-render-' + w.eval('plots[0].id'));
  const groups = (whole.text.match(/<g transform="translate\(0,[\d.]+\)"/g) || []).length;
  ok(groups >= 3, 'the whole plot stacks all three facets', groups);
  ok(whole.height > one.height * 2, 'and is taller than one of them', whole.height + ' vs ' + one.height);
  w.close();
}

console.log('\n=== 5. Every chart type exports ===');
{
  ['bars', 'lines', 'diverging', 'matrix'].forEach(type => {
    const { w, d } = boot();
    if (type === 'diverging') { rm(d, 'Rate A'); add(d, 'Δ Rate A (Tuned−Base)'); }
    setType(w, d, type);
    const src = svgOf(w, '#plots .leaf-shell');
    const marks = (src.text.match(/<(rect|circle|polyline|line|text)\b/g) || []).length;
    const probs = svgProblems(src.text);
    ok(!!src && probs.length === 0 && marks > 20, type + ' exports cleanly',
       marks + ' elements' + (probs.length ? ' | ' + probs.join('; ') : ''));
    w.close();
  });
}

console.log('\n=== 6. PNG degrades honestly where it cannot rasterise ===');
{
  const { w, d } = boot();
  // jsdom has no canvas; the export must report that, not throw
  let threw = null;
  try {
    w.eval('exportPng(document.querySelector("#plots .leaf-shell"), window, "chart", 2)');
  } catch (e) { threw = e.message; }
  ok(threw === null, 'clicking PNG does not throw', threw);
  const status = d.getElementById('builder-status');
  ok(!!status, 'and the status line exists to carry the message');
  w.close();
}

console.log('\n=== 7. A table has no SVG, and says so rather than emitting an empty one ===');
{
  const { w, d } = boot();
  setType(w, d, 'table');
  const src = w.eval('(function(){ const s = svgSource(document.querySelector("#plots .leaf-shell"), window); return s === null ? "null" : "produced"; })()');
  ok(src === 'null', 'no SVG document is invented for a table', src);
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
