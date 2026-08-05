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
const setType = (w, d, t) => { const s = d.querySelectorAll('#plots .plot-head select')[0]; s.value = t; s.dispatchEvent(new w.Event('change')); };
const openStyle = d => d.querySelector('#plots .style-toggle').click();
const ctl = (d, cls) => d.querySelector('#plots .' + cls);
const set = (w, d, cls, v) => { const e = ctl(d, cls); e.value = v; e.dispatchEvent(new w.Event('change')); };
const marks = d => Array.from(d.querySelectorAll('#plots .series-dot'));
const shapes = d => Array.from(new Set(marks(d).map(m => m.getAttribute('data-shape'))));
const bars = d => Array.from(d.querySelectorAll('#plots rect.bar'));
const shown = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const addMeasure = (d, p) => Array.from(shown(d)[1].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const rmMeasure = (d, p) => Array.from(shown(d)[0].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.indexOf(p) !== -1).querySelector('button').click();
const toggle = (w, d, text) => {
  const lab = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => l.textContent.indexOf(text) !== -1);
  if (!lab) return false;
  const cb = lab.querySelector('input');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new w.Event('change'));
  return true;
};
const values = d => Array.from(d.querySelectorAll('#plots text.bar-value'));

console.log('\n=== 1. A line series is told apart by shape as well as colour ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const s = shapes(d);
  ok(marks(d).length === 121, 'every point has a marker', marks(d).length);
  ok(s.length === 3, 'the three series take three different shapes', s.join(','));
  ok(s[0] === 'circle', 'the first is still a circle, as it always was', s[0]);
  ok(marks(d).every(m => m.getAttribute('data-cy') !== null),
     'and each carries its centre, which a polygon cannot otherwise report');

  // shape follows the entity, not its position among the survivors
  const before = {};
  marks(d).forEach(m => { before[m.getAttribute('fill')] = m.getAttribute('data-shape'); });
  const chip = Array.from(d.querySelectorAll('#plots .data-shown-block .dnd-chip'))
    .concat(Array.from(d.querySelectorAll('#plots .dim-block .dnd-chip')))
    .find(c => /^Base/.test(c.textContent.trim()));
  if (chip) chip.click();
  const after = {};
  marks(d).forEach(m => { after[m.getAttribute('fill')] = m.getAttribute('data-shape'); });
  const kept = Object.keys(after).filter(k => before[k]);
  ok(kept.length > 0 && kept.every(k => after[k] === before[k]),
     'removing one series does not reshuffle the shapes of the others',
     kept.map(k => before[k] + '->' + after[k]).join(' '));
  w.close();
}

console.log('\n=== 2. Every shape is a circle or a polygon, and nothing else ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  openStyle(d);
  const drawn = [];
  w.eval('MARK_SHAPE_KEYS').length;
  const keys = JSON.parse(w.eval('JSON.stringify(MARK_SHAPE_KEYS)'));
  ok(keys.length === 8, 'eight shapes are offered', keys.length);
  keys.forEach(k => {
    set(w, d, 'style-markers', k);
    const m = marks(d)[0];
    drawn.push(m.tagName.toLowerCase());
    const pts = m.getAttribute('points');
    if (pts) {
      const bad = pts.split(' ').filter(p => !/^-?[\d.]+,-?[\d.]+$/.test(p));
      ok(bad.length === 0, k + ' has clean coordinates', bad.join(' '));
    } else {
      ok(k === 'circle', k + ' is the circle');
    }
  });
  ok(drawn.every(t => t === 'circle' || t === 'polygon'),
     'nothing needs a <path> — the exporters already carry these two',
     Array.from(new Set(drawn)).join(','));
  w.close();
}

console.log('\n=== 3. Bars can carry a texture, and do not by default ===');
{
  const { w, d } = boot();
  ok(d.querySelectorAll('#plots .bar-texture').length === 0, 'solid bars to begin with');
  ok(d.querySelectorAll('#plots defs pattern').length === 0, 'and no patterns defined');

  openStyle(d);
  set(w, d, 'style-pattern', 'auto');
  const tex = d.querySelectorAll('#plots .bar-texture');
  ok(tex.length === bars(d).length, 'a texture over every bar', tex.length + '/' + bars(d).length);
  ok(bars(d).every(b => /^var\(--|^#|^hsl/.test(b.getAttribute('fill'))),
     'the bar itself keeps a plain colour fill, not a url(#…)',
     bars(d)[0].getAttribute('fill'));
  ok(tex[0].getAttribute('fill').indexOf('url(#') === 0, 'the texture is the one carrying the pattern',
     tex[0].getAttribute('fill'));
  const pats = Array.from(new Set(Array.from(tex).map(t => t.getAttribute('data-pattern'))));
  ok(pats.length === 3, 'one texture per series', pats.join(','));

  const ids = Array.from(d.querySelectorAll('#plots defs pattern')).map(p => p.id);
  ok(ids.length === new Set(ids).size, 'every pattern id is unique across the page', ids.length);
  ok(tex[0].getAttribute('pointer-events') === 'none',
     'and the overlay does not steal the tooltip from the bar under it');
  w.close();
}

console.log('\n=== 4. Corners, palette and widths ===');
{
  const { w, d } = boot();
  openStyle(d);
  const rx = () => bars(d)[0].getAttribute('rx');
  ok(Number(rx()) > 0, 'bars start rounded', rx());
  set(w, d, 'style-corner', 'square');
  ok(Number(rx()) === 0, 'and can be square', rx());
  set(w, d, 'style-corner', 'pill');
  ok(Number(rx()) > 0, 'or a pill', rx());

  set(w, d, 'style-palette', 'grey');
  const fills = Array.from(new Set(bars(d).map(b => b.getAttribute('fill'))));
  ok(fills.every(f => /^#[0-9a-f]{6}$/i.test(f)), 'a chosen palette gives literal colours', fills.join(' '));
  ok(fills.length === 3, 'still one per series', fills.length);
  ok(new Set(fills).size === fills.length, 'and they are distinct');

  set(w, d, 'style-palette', 'okabe');
  ok(bars(d)[0].getAttribute('fill') === '#0072B2', 'the colourblind-safe palette starts at its first hue',
     bars(d)[0].getAttribute('fill'));
  w.close();
}

console.log('\n=== 5. Line width and marker size ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  openStyle(d);
  const line = () => d.querySelector('#plots polyline.series-line');
  ok(line().getAttribute('stroke-width') === '2', 'lines start at 2', line().getAttribute('stroke-width'));
  const lw = ctl(d, 'style-linewidth');
  lw.value = '4'; lw.dispatchEvent(new w.Event('change'));
  ok(d.querySelector('#plots polyline.series-line').getAttribute('stroke-width') === '4',
     'and take a new width');

  const sz = ctl(d, 'style-size');
  sz.value = '7'; sz.dispatchEvent(new w.Event('change'));
  ok(marks(d)[0].getAttribute('data-r') === '7', 'markers take a new size', marks(d)[0].getAttribute('data-r'));

  set(w, d, 'style-markers', 'none');
  ok(marks(d).length === 0, 'or can be turned off entirely');
  ok(d.querySelectorAll('#plots polyline.series-line').length > 0, 'leaving the lines');
  w.close();
}

console.log('\n=== 6. The legend shows whatever tells the series apart ===');
{
  const { w, d } = boot();
  const flat = d.querySelectorAll('#plots .legend .swatch').length;
  ok(flat > 0, 'a flat swatch while colour is the only difference', flat);
  ok(d.querySelectorAll('#plots .legend .swatch-svg').length === 0, 'and no drawn key');

  openStyle(d);
  set(w, d, 'style-pattern', 'auto');
  ok(d.querySelectorAll('#plots .legend .swatch-svg').length === 3,
     'once bars are textured the key is drawn, not a colour square',
     d.querySelectorAll('#plots .legend .swatch-svg').length);
  ok(d.querySelectorAll('#plots .legend .swatch-svg pattern').length === 3,
     'with the texture in it');

  const { w: w2, d: d2 } = boot();
  setType(w2, d2, 'lines');
  const keys = d2.querySelectorAll('#plots .legend .swatch-svg .swatch-mark');
  ok(keys.length === 3, 'a line chart keys by shape', keys.length);
  ok(Array.from(keys).map(k => k.getAttribute('data-shape')).join(',') === 'circle,square,diamond',
     'matching the shapes on the chart',
     Array.from(keys).map(k => k.getAttribute('data-shape')).join(','));
  ok(d2.querySelectorAll('#plots .series-dot').length === 121,
     'and the key is not counted as a data point',
     d2.querySelectorAll('#plots .series-dot').length);
  w.close(); w2.close();
}

console.log('\n=== 7. One series can be overridden by hand ===');
{
  const { w, d } = boot();
  openStyle(d);
  const rows = d.querySelectorAll('#plots .style-series');
  ok(rows.length === 3, 'a row per drawn series', rows.length);
  ok(rows[0].textContent.indexOf('Base') === 0, 'named by the series', rows[0].textContent.slice(0, 12));

  const col = rows[0].querySelector('.style-color');
  ok(/^#[0-9a-f]{6}$/i.test(col.value), 'the colour box starts on the series colour', col.value);
  col.value = '#ff0000';
  col.dispatchEvent(new w.Event('change'));
  ok(bars(d).some(b => b.getAttribute('fill') === '#ff0000'), 'setting it repaints that series');
  ok(bars(d).some(b => b.getAttribute('fill') !== '#ff0000'), 'and only that one');

  // the override is keyed by the series, so a change of grouping keeps it
  const sig = w.eval('Object.keys(plots[0].style.series)[0]');
  ok(sig.indexOf('variant=base') !== -1, 'keyed by what the series is, not where it sits', sig);

  const auto = Array.from(d.querySelectorAll('#plots .style-series')[0].querySelectorAll('button'))
    .find(b => b.textContent === 'auto');
  auto.click();
  ok(!bars(d).some(b => b.getAttribute('fill') === '#ff0000'), 'and it can be dropped again');
  w.close();
}

console.log('\n=== 8. Style survives a save, and a bad one does not reach the chart ===');
{
  const { w, d } = boot();
  openStyle(d);
  set(w, d, 'style-pattern', 'crosshatch');
  set(w, d, 'style-corner', 'square');
  set(w, d, 'style-palette', 'okabe');
  const saved = w.eval('JSON.stringify(serializePlots()[0].style)');
  ok(/"barPattern":"crosshatch"/.test(saved) && /"palette":"okabe"/.test(saved), 'it serialises', saved);

  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('plots[0].style.barPattern') === 'crosshatch', 'and comes back');
  ok(d.querySelectorAll('#plots .bar-texture').length > 0, 'still drawn');

  w.eval('applyConfig([{"chartType":"bars"}])');
  ok(w.eval('JSON.stringify(plots[0].style) === JSON.stringify(defaultPlotStyle())'),
     'a view saved before styling existed reads as the defaults');
  w.eval('applyConfig([{"chartType":"bars","style":{"palette":"neon","barCorner":9,"markerSize":"big","barPattern":"tartan"}}])');
  ok(w.eval('plots[0].style.palette') === 'default' && w.eval('plots[0].style.barCorner') === 'rounded'
     && w.eval('plots[0].style.markerSize') === 3.5 && w.eval('plots[0].style.barPattern') === 'none',
     'and nonsense in a stored style is replaced rather than drawn',
     w.eval('JSON.stringify(plots[0].style)'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'the chart still draws');
  w.close();
}

console.log('\n=== 9. A second axis does not put the chart outside the style block ===');
{
  const { w, d } = boot();
  addMeasure(d, 'Count A');
  ok(toggle(w, d, 'second y-axis'), 'the second axis is on');
  ok(d.querySelectorAll('#plots text.axis-right').length > 0, 'and drawn');
  openStyle(d);

  ok(Number(bars(d)[0].getAttribute('rx')) > 0, 'its bars start rounded like any other',
     bars(d)[0].getAttribute('rx'));
  set(w, d, 'style-corner', 'square');
  ok(bars(d).every(b => Number(b.getAttribute('rx')) === 0), 'and square when asked',
     bars(d)[0].getAttribute('rx'));

  set(w, d, 'style-pattern', 'auto');
  const tex = d.querySelectorAll('#plots .bar-texture');
  ok(tex.length === bars(d).length, 'a texture over every bar on the left axis',
     tex.length + '/' + bars(d).length);
  ok(d.querySelectorAll('#plots .axis-legend .swatch-svg pattern').length > 0,
     'and the axis legend shows it, rather than a plain colour square');

  const vl = ctl(d, 'style-value-labels');
  vl.checked = true; vl.dispatchEvent(new w.Event('change'));
  ok(values(d).length === bars(d).length, 'the numbers go on the bars', values(d).length);
  ok(values(d).every(t => /\d/.test(t.textContent) && !/NaN|undefined/.test(t.textContent)),
     'each reading as a number', values(d)[0].textContent);

  set(w, d, 'style-palette', 'okabe');
  ok(bars(d).some(b => b.getAttribute('fill') === '#0072B2'), 'and the palette still reaches it',
     bars(d)[0].getAttribute('fill'));
  w.close();
}

console.log('\n=== 10. The horizontal chart is inside it as well ===');
{
  const { w, d } = boot();
  setType(w, d, 'diverging');
  rmMeasure(d, 'Rate A');
  addMeasure(d, 'Δ Rate A (Tuned−Base)');
  addMeasure(d, 'Δ Count A (Tuned vs Base)');
  ok(toggle(w, d, 'second'), 'a diverging chart takes a second scale too');
  ok(d.querySelectorAll('#plots rect.bar-secondary').length > 0, 'and puts bars on it');
  openStyle(d);

  set(w, d, 'style-corner', 'square');
  ok(bars(d).every(b => Number(b.getAttribute('rx')) === 0), 'square corners reach the horizontal bars',
     bars(d)[0].getAttribute('rx'));
  set(w, d, 'style-pattern', 'auto');
  ok(d.querySelectorAll('#plots .bar-texture').length === bars(d).length, 'as do textures',
     d.querySelectorAll('#plots .bar-texture').length + '/' + bars(d).length);

  const vl = ctl(d, 'style-value-labels');
  vl.checked = true; vl.dispatchEvent(new w.Event('change'));
  const vals = values(d);
  ok(vals.length === bars(d).length, 'and the numbers', vals.length);
  ok(vals.every(t => isFinite(parseFloat(t.getAttribute('x'))) && isFinite(parseFloat(t.getAttribute('y')))),
     'each placed at a real coordinate');
  ok(vals.some(t => t.getAttribute('text-anchor') === 'start')
     && vals.some(t => t.getAttribute('text-anchor') === 'end'),
     'written off the end the bar grew towards, so it is never over its neighbour');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
