const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
// capture downloads instead of performing them
function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(win) {
      win.__files = [];
      win.URL.createObjectURL = blob => { win.__lastBlob = blob; return 'blob:fake'; };
      win.URL.revokeObjectURL = () => {};
      const realClick = win.HTMLAnchorElement.prototype.click;
      win.HTMLAnchorElement.prototype.click = function () {
        if (this.download) { win.__files.push({ name: this.download, blob: win.__lastBlob }); return; }
        return realClick.apply(this, arguments);
      };
    },
  });
  dom.window.document.querySelector('.mode-tab[data-mode="builder"]').click();
  return { w: dom.window, d: dom.window.document };
}
// the export opens a panel holding the source; read it from there and close it
async function grab(w, fn) {
  const d = w.document;
  const old = d.getElementById('tex-modal');
  if (old) old.remove();
  fn();
  const modal = d.getElementById('tex-modal');
  if (!modal) return null;
  const out = {
    name: modal.querySelector('.tex-name').textContent,
    text: modal.querySelector('textarea.tex-source').value,
  };
  modal.remove();
  return out;
}
const setType = (w, d, t) => { const s = d.querySelector('#plots .plot-head select'); s.value = t; s.dispatchEvent(new w.Event('change')); };
const setZone = (w, d, dim, z) => { const s = d.querySelector('#plots .zone-chip[data-dim="' + dim + '"] select'); s.value = z; s.dispatchEvent(new w.Event('change')); };
const ds = d => d.querySelectorAll('#plots .data-shown-block .dual-col');
const add = (d, p) => Array.from(ds(d)[1].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();
const rm = (d, p) => Array.from(ds(d)[0].querySelectorAll('.dnd-chip')).find(c => c.textContent.indexOf(p) !== -1).click();

// structural checks a compiler would catch
function texProblems(tex) {
  const bad = [];
  const opens = (tex.match(/\\begin\{tikzpicture\}/g) || []).length;
  const closes = (tex.match(/\\end\{tikzpicture\}/g) || []).length;
  if (opens !== closes) bad.push('tikzpicture ' + opens + '/' + closes);
  const to = (tex.match(/\\begin\{tabular\}/g) || []).length;
  const tc = (tex.match(/\\end\{tabular\}/g) || []).length;
  if (to !== tc) bad.push('tabular ' + to + '/' + tc);
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) { bad.push('unbalanced brace at ' + i); break; } }
  }
  if (depth !== 0) bad.push('brace depth ' + depth);
  if (/NaN|undefined|Infinity/.test(tex)) bad.push('bad number: ' + (/(\S*(?:NaN|undefined|Infinity)\S*)/.exec(tex) || [])[1]);
  // every colour used must be defined
  const defined = {};
  (tex.match(/\\definecolor\{(\w+)\}/g) || []).forEach(m => { defined[/\{(\w+)\}/.exec(m)[1]] = 1; });
  (tex.match(/\bvizc\w+/g) || []).forEach(c => { if (!defined[c]) bad.push('undefined colour ' + c); });
  // raw unicode that pdflatex would reject
  const uni = tex.replace(/^%.*$/gm, '').match(/[^\x00-\x7F]/g);
  if (uni) bad.push('non-ascii ' + Array.from(new Set(uni)).join(''));
  return bad;
}

(async () => {
  console.log('\n=== 1. Export at chart level ===');
  {
    const { w, d } = boot();
    const btns = d.querySelectorAll('#plots .leaf-tools button');
    ok(btns.length === 1, 'each chart carries its own TikZ button', btns.length);
    const f = await grab(w, () => btns[0].click());
    ok(!!f, 'clicking it produces a file');
    ok(/\.tex$/.test(f.name), 'named as a .tex', f.name);
    ok(texProblems(f.text).length === 0, 'structurally sound', texProblems(f.text).join('; '));
    ok(/\\begin\{tikzpicture\}\[x=1pt,y=-1pt\]/.test(f.text), 'a tikzpicture with the flipped y axis');
    ok((f.text.match(/\\fill\[/g) || []).length >= 121, 'a fill per bar', (f.text.match(/\\fill\[/g) || []).length);
    ok(/\\definecolor\{\w+\}\{HTML\}\{[0-9A-F]{6}\}/.test(f.text), 'colours resolved to hex and defined');
    ok(/\\node\[.*rotate=-40/.test(f.text), 'rotated tick labels carry their rotation');
    ok(/\\usepackage\{tikz\}/.test(f.text), 'the preamble requirement is stated');
    // colours resolved from CSS variables, not fallen back to black
    const defs = (f.text.match(/\\definecolor\{\w+\}\{HTML\}\{([0-9A-F]{6})\}/g) || []);
    ok(defs.length >= 5, 'several distinct colours resolved', defs.length);
    ok(!/\{000000\}/.test(f.text), 'nothing fell back to plain black');
    ok((f.text.match(/\\draw\[/g) || []).length >= 4, 'grid lines and the baseline are drawn',
       (f.text.match(/\\draw\[/g) || []).length);
    // weight must follow the CSS: tick labels regular, nested band labels semibold
    const tickNode = (f.text.match(/^.*\{\d+\\%\};$/m) || [''])[0];
    ok(tickNode && !/bfseries/.test(tickNode), 'tick labels are not spuriously bolded', tickNode.slice(0, 80));
    const bandNode = (f.text.match(/^.*\{dev3\};$/m) || [''])[0];
    ok(bandNode && /bfseries/.test(bandNode), 'but the grouping band labels keep their weight', bandNode.slice(0, 80));
    w.close();
  }

  console.log('\n=== 2. Export at facet, panel and plot level ===');
  {
    const { w, d } = boot();
    setZone(w, d, 'device', 'facet');
    const facetBtns = d.querySelectorAll('#plots .facet-card > h5 button');
    ok(facetBtns.length === 3, 'a button per facet card', facetBtns.length);
    const one = await grab(w, () => facetBtns[0].click());
    ok((one.text.match(/\\begin\{tikzpicture\}/g) || []).length === 1, 'a facet exports just its own charts');
    ok(/Device: dev1/.test(one.text), 'and captions it', (/% --- (.*) ---/.exec(one.text) || [])[1]);

    const whole = await grab(w, () => Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Export TikZ').click());
    ok((whole.text.match(/\\begin\{tikzpicture\}/g) || []).length === 3, 'the plot-level button exports all three facets',
       (whole.text.match(/\\begin\{tikzpicture\}/g) || []).length);
    ok(texProblems(whole.text).length === 0, 'still sound', texProblems(whole.text).join('; '));
    const caps = whole.text.match(/% --- (.*) ---/g) || [];
    ok(caps.length === 3, 'each picture is captioned with its facet', caps.join(' | '));
    w.close();
  }

  console.log('\n=== 3. Panels ===');
  {
    const { w, d } = boot();
    add(d, 'Count A');
    const panelBtns = d.querySelectorAll('#plots .metric-panel .panel-title button');
    ok(panelBtns.length === 2, 'a button per stacked panel', panelBtns.length);
    const p = await grab(w, () => panelBtns[1].click());
    ok((p.text.match(/\\begin\{tikzpicture\}/g) || []).length === 1, 'exports that panel alone');
    ok(/Count A/.test(p.text), 'captioned with the metric');
    ok(texProblems(p.text).length === 0, 'sound', texProblems(p.text).join('; '));
    w.close();
  }

  console.log('\n=== 4. Every chart type exports ===');
  {
    for (const t of ['bars', 'lines', 'diverging', 'matrix']) {
      const { w, d } = boot();
      if (t === 'diverging') { rm(d, 'Rate A'); add(d, 'Δ Rate A (Tuned−Base)'); }
      setType(w, d, t);
      const f = await grab(w, () => d.querySelector('#plots .leaf-tools button').click());
      const probs = texProblems(f.text);
      const marks = (f.text.match(/\\(fill|draw|path|node)\[/g) || []).length;
      ok(!!f && probs.length === 0 && marks > 20, t + ' exports cleanly', marks + ' commands' + (probs.length ? ' | ' + probs.join('; ') : ''));
      w.close();
    }
  }

  console.log('\n=== 5. A table exports as booktabs, not a picture ===');
  {
    const { w, d } = boot();
    setType(w, d, 'table');
    const btn = Array.from(d.querySelectorAll('#plots .plot-head button')).find(b => b.textContent === 'Export TikZ');
    const f = await grab(w, () => btn.click());
    ok(/\\begin\{tabular\}/.test(f.text), 'a tabular is emitted');
    ok(/\\toprule[\s\S]*\\midrule[\s\S]*\\bottomrule/.test(f.text), 'with booktabs rules');
    ok(/\\multicolumn\{\d+\}\{c\}/.test(f.text), 'and spanning header cells for the nested grouping');
    ok(/\\usepackage\{booktabs\}/.test(f.text), 'the booktabs requirement is stated');
    ok(!/\\begin\{tikzpicture\}/.test(f.text), 'no empty picture wrapper');
    ok(texProblems(f.text).length === 0, 'sound', texProblems(f.text).join('; '));
    const cols = (/\\begin\{tabular\}\{([^}]*)\}/.exec(f.text) || [])[1];
    ok(/^l+r+$/.test(cols), 'descriptor columns left-aligned, values right', cols.slice(0, 12));
    w.close();
  }

  console.log('\n=== 6. LaTeX-hostile characters are escaped, and the legend travels ===');
  {
    const { w, d } = boot();
    rm(d, 'Rate A');
    add(d, 'Δ Rate A (Tuned−Base)');
    add(d, 'Δ Rate B (Tuned−Base)');      // two delta series -> legend carries their labels
    const f = await grab(w, () => d.querySelector('#plots .leaf-tools button').click());
    ok(/\$\\Delta\$/.test(f.text), 'Delta becomes a math symbol');
    ok(!/[^\x00-\x7F]/.test(f.text.replace(/^%.*$/gm, '')), 'no raw unicode survives');
    ok(/Tuned/.test(f.text) && /Base/.test(f.text), 'the legend labels are in the picture');
    ok(texProblems(f.text).length === 0, 'sound', texProblems(f.text).join('; '));
    w.close();
  }

  console.log('\n=== 6b. Percent signs and the legend of a normal chart ===');
  {
    const { w, d } = boot();
    const f = await grab(w, () => d.querySelector('#plots .leaf-tools button').click());
    ok(/\\%/.test(f.text), 'percent signs on the axis are escaped');
    ok(/\{Base\}/.test(f.text) && /Tuned-alt/.test(f.text.replace(/\\/g, '')),
       'every series in the legend is drawn into the figure');
    const legendFills = (f.text.match(/rounded corners=1pt/g) || []).length;
    ok(legendFills === 3, 'with a swatch each', legendFills);
    ok(texProblems(f.text).length === 0, 'sound', texProblems(f.text).join('; '));
    w.close();
  }

  console.log('\n=== 7. Dual axis and line breaks survive the round trip ===');
  {
    const { w, d } = boot();
    setType(w, d, 'lines');
    add(d, 'Count A');
    const cb = Array.from(d.querySelectorAll('#plots .head-toggle')).find(l => /second y-axis/.test(l.textContent)).querySelector('input');
    cb.checked = true; cb.dispatchEvent(new w.Event('change'));
    const f = await grab(w, () => d.querySelector('#plots .leaf-tools button').click());
    ok(/dash pattern=on/.test(f.text), 'the dashed secondary series keeps its dash pattern');
    const draws = (f.text.match(/\\draw\[/g) || []).length;
    ok(draws > 20, 'many separate line segments, matching the per-group breaks', draws);
    ok(texProblems(f.text).length === 0, 'sound', texProblems(f.text).join('; '));
    w.close();
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
