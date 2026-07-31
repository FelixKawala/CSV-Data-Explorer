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
const set = (w, d, cls, v) => { const e = d.querySelector('#plots .' + cls); e.value = v; e.dispatchEvent(new w.Event('change')); };
const tikz = w => w.eval('buildTikzDocument(document.querySelector("#plots .leaf-shell"), window, "c")');
const svg = w => w.eval('svgSource(document.querySelector("#plots .leaf-shell"), window).text');
const pgf = w => w.eval('(buildPgfplotsDocument(document.querySelector("#plots .leaf-shell"), "t", "d", window) || {}).tex');

console.log('\n=== 1. Marker shapes reach TikZ as closed polygons ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const t = tikz(w);
  const polys = (t.match(/-- cycle;/g) || []).length;
  const circles = (t.match(/circle\[radius/g) || []).length;
  ok(polys > 0, 'the shaped series are emitted as filled polygons', polys);
  ok(circles > 0, 'and the circle series as circles', circles);
  ok(polys + circles === 124, 'one mark per drawn point, plus the three legend keys',
     polys + circles);
  ok(!/\\path\[fill=\]/.test(t), 'no mark came out with an empty colour');
  ok(!/NaN|undefined/.test(t), 'and no bad numbers reached the file');
  ok(!/[^\x00-\x7F]/.test(t), 'still pure ASCII, so pdflatex will take it');
  w.close();
}

console.log('\n=== 2. Bar textures reach TikZ as tikz patterns ===');
{
  const { w, d } = boot();
  const plain = tikz(w);
  ok(!/usetikzlibrary\{patterns\}/.test(plain),
     'a solid chart does not ask for the patterns library');

  openStyle(d);
  set(w, d, 'style-pattern', 'auto');
  const t = tikz(w);
  ok(/% Requires:.*usetikzlibrary\{patterns\}/.test(t),
     'a textured one does, and says so in the preamble',
     (t.match(/% Requires:.*/) || [])[0]);
  const pats = (t.match(/pattern=([a-z ]+)/g) || []);
  ok(pats.length === 124, 'a pattern fill per bar, plus one per legend key', pats.length);
  const names = Array.from(new Set(pats.map(p => p.replace('pattern=', ''))));
  ok(names.length === 3, 'three textures for three series', names.join(' | '));
  ok(names.every(n => /^(north east lines|north west lines|crosshatch|dots|grid|horizontal lines|vertical lines)$/.test(n)),
     'each one a pattern tikz actually defines', names.join(' | '));
  ok((t.match(/\\fill\[vizc/g) || []).length >= 121,
     'the solid colour is still drawn underneath', (t.match(/\\fill\[vizc/g) || []).length);
  ok(/pattern color=vizc/.test(t), 'and the texture has a declared ink');
  w.close();
}

console.log('\n=== 3. The legend key travels, drawn rather than flattened ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const t = tikz(w);
  ok(/Base/.test(t) && /Tuned/.test(t), 'the legend text is there');
  // three keys drawn as marks, on top of the 121 data marks
  const marks = (t.match(/-- cycle;/g) || []).length + (t.match(/circle\[radius/g) || []).length;
  ok(marks === 124, '121 data marks plus one drawn key per series', marks);

  const s = svg(w);
  ok((s.match(/data-shape/g) || []).length >= 121, 'the SVG export carries the shapes',
     (s.match(/data-shape/g) || []).length);
  ok(/swatch-mark/.test(s), 'including the legend keys');
  w.close();
}

console.log('\n=== 4. The SVG export keeps a pattern reference intact ===');
{
  const { w, d } = boot();
  openStyle(d);
  set(w, d, 'style-pattern', 'auto');
  const s = svg(w);
  const defs = (s.match(/<pattern/g) || []).length;
  const urls = (s.match(/fill="url\(#[^"]*"/g) || []).length;
  ok(defs > 0, 'the pattern definitions are in the file', defs);
  ok(urls === defs, 'and every one is actually referenced', urls + '/' + defs);
  // this is the failure mode: resolving url(#…) as a colour paints a flat rect
  // over every bar, and the export silently stops being a textured chart
  ok(urls === 124, 'one per bar plus one per legend key', urls);
  ok(!/var\(--/.test(s), 'nothing else was left unresolved');

  const ids = (s.match(/<pattern[^>]*id="([^"]+)"/g) || []).map(m => /id="([^"]+)"/.exec(m)[1]);
  ok(ids.length === new Set(ids).size, 'ids are unique, so stacking charts cannot cross-reference',
     ids.length);
  const paints = (s.match(/(?:fill|stroke)="([^"]*)"/g) || []).map(m => /"([^"]*)"/.exec(m)[1]);
  const bad = paints.filter(v => v !== 'none' && !/^#[0-9A-Fa-f]{6}$/.test(v) && !/^url\(#/.test(v));
  ok(bad.length === 0, 'every other paint is a literal hex', Array.from(new Set(bad)).join(' '));
  w.close();
}

console.log('\n=== 5. pgfplots carries the colours, marks and textures ===');
{
  const { w, d } = boot();
  setType(w, d, 'lines');
  const t = pgf(w);
  ok(/\\definecolor\{pgfc1\}\{HTML\}\{[0-9A-F]{6}\}/.test(t), 'colours are declared once at the top',
     (t.match(/\\definecolor.*/) || [])[0]);
  ok((t.match(/\\addplot\[/g) || []).length === 3, 'every series carries options',
     (t.match(/\\addplot\[/g) || []).length);
  ok(/mark=\*/.test(t) && /mark=square\*/.test(t), 'with pgfplots\' own mark names',
     (t.match(/mark=[^,\]]*/g) || []).join(' '));
  ok(/color=pgfc/.test(t), 'and the declared colours');

  const { w: w2, d: d2 } = boot();
  openStyle(d2);
  set(w2, d2, 'style-pattern', 'auto');
  const t2 = pgf(w2);
  ok(/postaction=\{pattern=/.test(t2), 'a textured bar chart emits a pattern postaction',
     (t2.match(/postaction=\{[^}]*\}/) || [])[0]);
  ok(/usetikzlibrary\{patterns\}/.test(t2), 'and asks for the library');
  ok(/fill=pgfc/.test(t2), 'with the series colour underneath it');
  w.close(); w2.close();
}

console.log('\n=== 6. The y-axis override reaches pgfplots too ===');
{
  const { w, d } = boot();
  const plain = pgf(w);
  ok(!/ymin=/.test(plain), 'no bounds are written while the axis is automatic');

  const b = d.querySelectorAll('#plots .yaxis-bound');
  b[0].value = '0'; b[0].dispatchEvent(new w.Event('change'));
  b[1].value = '80'; b[1].dispatchEvent(new w.Event('change'));
  const t = pgf(w);
  ok(/ymin=0,/.test(t) && /ymax=80,/.test(t), 'a set range is written out',
     (t.match(/ym(in|ax)=[^,]*/g) || []).join(' '));

  const sc = d.querySelector('#plots .yaxis-scale');
  sc.value = 'log'; sc.dispatchEvent(new w.Event('change'));
  ok(/ymode=log/.test(pgf(w)), 'and so is a forced log scale');
  sc.value = 'linear'; sc.dispatchEvent(new w.Event('change'));
  ok(!/ymode=log/.test(pgf(w)), 'and a forced linear one suppresses it');
  w.close();
}

console.log('\n=== 7. A greyscale export still tells the series apart ===');
{
  // the point of the whole exercise: a figure printed without colour
  const { w, d } = boot();
  openStyle(d);
  set(w, d, 'style-palette', 'grey');
  set(w, d, 'style-pattern', 'auto');
  const t = tikz(w);
  const names = Array.from(new Set((t.match(/pattern=([a-z ]+)/g) || [])));
  ok(names.length === 3, 'three distinct textures survive into TikZ', names.join(' | '));
  const s = svg(w);
  ok((s.match(/<pattern/g) || []).length > 0, 'and into the SVG');
  ok(/#1A1A1A|#1a1a1a/.test(s), 'with the greyscale ramp, not the colour one',
     (s.match(/#[0-9a-fA-F]{6}/g) || []).slice(0, 4).join(' '));
  w.close();
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
