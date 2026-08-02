const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style'), HTML.indexOf('</style>'));

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  return { w: dom.window, d: dom.window.document };
}
const cols = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(cols(d)[1].querySelectorAll('.dnd-chip'))
  .find(c => c.textContent.trim().indexOf(p) === 0).click();
const setType = (w, d, t) => { const s = d.querySelectorAll('#plots .plot-head select')[0]; s.value = t; s.dispatchEvent(new w.Event('change')); };

console.log('\n=== 1. The theme variables reach the element that uses them ===');
{
  // They were declared on .viz-root while `body` used var(--page) and
  // var(--text-primary). Custom properties inherit downward, so at body level
  // both were undefined: the background fell back to white and the colour to
  // BLACK -- and everything that does not set its own colour inherits that
  // black from body. Invisible on a light page, unreadable on a dark one.
  ok(/:root,\s*\.viz-root\s*\{/.test(CSS),
     'the light palette is declared on :root as well as .viz-root');
  const darkAt = CSS.indexOf('prefers-color-scheme: dark');
  const darkBlock = CSS.slice(darkAt, darkAt + 400);
  ok(/:root:where\(:not\(\[data-theme="light"\]\)\),/.test(darkBlock),
     'and so is the dark one', darkBlock.split('\n').slice(1, 3).join(' ').trim());
  ok(/:root\[data-theme="dark"\],/.test(CSS), 'including the explicit dark override');

  // nothing in the stylesheets pins a colour that cannot follow the theme
  const litColours = (CSS.match(/(?:^|[;{\s])(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb)/g) || [])
    .filter(m => !/rgba\(0,0,0,\.45\)/.test(m));
  ok(litColours.length === 0, 'no literal text or surface colour is hardcoded',
     litColours.slice(0, 3).join(' | '));
}

console.log('\n=== 2. There is a theme toggle, and it does something ===');
{
  const { w, d } = boot();
  const toggle = d.getElementById('theme-toggle');
  ok(!!toggle, 'the toggle exists');
  const btns = Array.from(toggle.querySelectorAll('.theme-btn'));
  ok(btns.map(b => b.textContent).join(',') === 'Auto,Light,Dark', 'with three choices',
     btns.map(b => b.textContent).join(','));
  ok(btns[0].classList.contains('on'), 'starting on Auto');
  ok(d.documentElement.getAttribute('data-theme') === null,
     'which sets no attribute, so the system still decides');

  btns[2].click();
  ok(d.documentElement.getAttribute('data-theme') === 'dark', 'Dark pins the attribute');
  ok(btns[2].classList.contains('on') && !btns[0].classList.contains('on'), 'and moves the marker');
  ok(w.localStorage.getItem('viz-theme') === 'dark', 'remembered for next time');

  btns[1].click();
  ok(d.documentElement.getAttribute('data-theme') === 'light', 'Light pins it the other way');
  btns[0].click();
  ok(d.documentElement.getAttribute('data-theme') === null,
     'and Auto removes it rather than pinning whatever is current — a machine that '
     + 'switches at sunset still switches');
  w.close();
}

console.log('\n=== 3. Two kinds can be forced onto one axis ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  add(d, 'Δ Count A (Tuned vs Base)');       // a rate and a relative change: both %
  ok(w.eval('!!computeAxisPlan(plots[0]).metricPanels'),
     'by default they are split into panels');
  const cb = d.querySelector('#plots .one-axis-toggle');
  ok(!!cb, 'and a "one shared y-axis" control is offered');
  ok(!cb.checked, 'off to begin with — splitting stays the default');

  cb.checked = true; cb.dispatchEvent(new w.Event('change'));
  ok(!w.eval('computeAxisPlan(plots[0]).metricPanels'), 'switching it on drops the panels');
  ok(d.querySelectorAll('#plots text.axis-right').length === 0, 'and draws no second axis');
  ok(d.querySelectorAll('#plots .series-dot').length > 0, 'both measures are drawn',
     d.querySelectorAll('#plots .series-dot').length);
  const note = d.querySelector('#plots .chart-note').textContent;
  ok(/different scales/.test(note) && /may be hard to read/.test(note),
     'with the cost stated on the chart, not left to be discovered', note);
  ok(/rate %/.test(note) && /relative change %/.test(note),
     'naming the scales as a reader knows them, not as internal keys', note);
  ok(!/\|/.test(note), 'so no axisGroup key leaks into the text', note);

  ok(w.eval('JSON.stringify(serializePlots()[0].forceOneAxis)') === 'true', 'it is saved');
  w.eval('applyConfig(' + w.eval('JSON.stringify(serializePlots())') + ')');
  ok(w.eval('plots[0].forceOneAxis') === true, 'and restored');
  w.close();
}

console.log('\n=== 4. A dual-axis legend shows the shapes too ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  add(d, 'Δ Count A (Tuned vs Base)');
  const dual = Array.from(d.querySelectorAll('#plots .head-toggle'))
    .find(l => /second y-axis/.test(l.textContent));
  const i = dual.querySelector('input');
  i.checked = true; i.dispatchEvent(new w.Event('change'));
  ok(w.eval('computeAxisPlan(plots[0]).dualAxis'), 'the dual axis is on');

  const keys = d.querySelectorAll('#plots .legend .swatch-svg .swatch-mark');
  ok(keys.length > 0, 'the legend keys are drawn marks, not flat squares', keys.length);
  const shapes = Array.from(new Set(Array.from(keys).map(k => k.getAttribute('data-shape'))));
  ok(shapes.length > 1, 'showing more than one shape', shapes.join(','));
  const onChart = Array.from(new Set(Array.from(d.querySelectorAll('#plots .series-dot'))
    .map(m => m.getAttribute('data-shape'))));
  ok(shapes.every(sh => onChart.indexOf(sh) !== -1),
     'and every one of them is a shape actually on the chart',
     shapes.join(',') + ' vs ' + onChart.join(','));
  w.close();
}

console.log('\n=== 5. The style panel is findable ===');
{
  const { w, d } = boot();
  const t = d.querySelector('#plots .style-toggle');
  ok(!!t, 'there is a control for it');
  ok(/Style/.test(t.textContent) && t.textContent.length > 10,
     'labelled with what it holds rather than one muted word', t.textContent.trim());
  ok(t.tagName.toLowerCase() === 'button', 'and it is a button');
  t.click();
  ok(!!d.querySelector('#plots .style-body'), 'clicking it opens the panel');
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
