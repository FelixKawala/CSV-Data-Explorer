// TikZ export (walks the rendered DOM)
// ================= TikZ EXPORT =================
// Emitted from the rendered SVG rather than re-deriving the layout, so the PDF is
// exactly the figure you approved on screen. Colours are read back through
// getComputedStyle, which resolves the CSS custom properties for us.

const TIKZ_COLORS = {};   // hex -> macro name, per export
// Our textures, named as the tikz patterns library knows them. Anything without
// a counterpart there is left solid rather than approximated with the wrong one.
const TIKZ_PATTERNS = {
  diagonal: 'north east lines',
  backdiagonal: 'north west lines',
  crosshatch: 'crosshatch',
  dots: 'dots',
  grid: 'grid',
  horizontal: 'horizontal lines',
  vertical: 'vertical lines',
};
const tikzPatternsUsed = {};
let tikzColorSeq = 0;

function rgbToHex(str) {
  if (!str) return null;
  const t = String(str).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (m) {
    const h = m[1];
    return (h.length === 3 ? h.split('').map(c => c + c).join('') : h).toUpperCase();
  }
  m = /rgba?\(([^)]+)\)/.exec(t);
  if (!m) return null;
  const p = m[1].split(/[ ,\/]+/).map(v => parseFloat(v)).filter(v => isFinite(v));
  if (p.length > 3 && p[3] < 0.02) return null;      // fully transparent
  if (p.length < 3) return null;
  return p.slice(0, 3).map(v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('').toUpperCase();
}
// "var(--series-base)" only becomes a colour once the custom property is looked up
// on the element itself; a presentation attribute is not folded into computed style.
function resolveVar(node, win, raw) {
  if (!raw) return null;
  const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(String(raw).trim());
  if (!m) return raw;
  try { return win.getComputedStyle(node).getPropertyValue(m[1]).trim() || null; } catch (e) { return null; }
}
function tikzColor(cssValue) {
  const hex = rgbToHex(cssValue);
  if (!hex) return null;
  if (!TIKZ_COLORS[hex]) TIKZ_COLORS[hex] = 'vizc' + String.fromCharCode(97 + (tikzColorSeq++ % 26)) + (tikzColorSeq > 26 ? tikzColorSeq : '');
  return TIKZ_COLORS[hex];
}
function latexEscape(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/−/g, '-')          // unicode minus
    .replace(/·/g, '$\\cdot$')   // the composite-label separator
    .replace(/Δ/g, '$\\Delta$')
    .replace(/×/g, '$\\times$')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/″/g, '$\\prime\\prime$')   // the repeated-value ditto mark
    .replace(/°/g, '$^\\circ$')
    .replace(/[–—]/g, '--')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // catch-all: pdflatex rejects any undeclared non-ASCII, so nothing may slip past
    .replace(/[^\x00-\x7F]/g, '');
}
const n2 = v => (Math.round(v * 100) / 100);

function parseTranslate(node) {
  const t = node.getAttribute && node.getAttribute('transform');
  if (!t) return [0, 0];
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(t);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
}
function parseRotate(node) {
  const t = node.getAttribute && node.getAttribute('transform');
  if (!t) return 0;
  const m = /rotate\(\s*(-?[\d.]+)/.exec(t);
  return m ? parseFloat(m[1]) : 0;
}
function dashPattern(cs) {
  const da = cs.strokeDasharray;
  if (!da || da === 'none') return null;
  const nums = da.split(/[ ,]+/).map(parseFloat).filter(v => isFinite(v));
  if (nums.length < 2) return null;
  return 'dash pattern=on ' + n2(nums[0]) + 'pt off ' + n2(nums[1]) + 'pt';
}
const ANCHOR = { start: 'base west', middle: 'base', end: 'base east' };

// A presentation attribute may be a raw "var(--x)", which only getComputedStyle can
// resolve. Prefer the computed value whenever the attribute is not a literal colour.
// Try the presentation attribute first, then the computed value; either may still be
// an unresolved custom property, so run both through resolveVar.
function resolvePaint(node, win, attr, computed) {
  const a = node.getAttribute && node.getAttribute(attr);
  if (a && a !== 'none') {
    const hex = tikzColor(resolveVar(node, win, a));
    if (hex) return hex;
  }
  if (computed && computed !== 'none') {
    const hex = tikzColor(resolveVar(node, win, computed));
    if (hex) return hex;
  }
  return null;
}

// Re-draw one legend key at (cx, cy) in the picture's coordinates. The swatch is
// a 14x14 mini-SVG holding either a marker (centred at 7,7) or a pair of rects,
// so it is re-emitted rather than walked: two shapes, no general machinery.
function swatchToTikz(swSvg, win, cx, cy) {
  const out = [];
  const mark = swSvg.querySelector('.swatch-mark');
  if (mark) {
    const col = resolvePaint(mark, win, 'fill', win.getComputedStyle(mark).fill);
    if (!col) return out;
    const r = 4;
    const pts = markPoints(mark.getAttribute('data-shape'));
    if (!pts) {
      out.push('  \\path[fill=' + col + '] (' + n2(cx + 4.5) + ',' + n2(cy)
        + ') circle[radius=' + n2(r) + 'pt];');
    } else {
      out.push('  \\fill[' + col + '] '
        + pts.map(pt => '(' + n2(cx + 4.5 + pt[0] * r) + ',' + n2(cy + pt[1] * r) + ')').join(' -- ')
        + ' -- cycle;');
    }
    return out;
  }
  const rects = swSvg.querySelectorAll('rect');
  if (!rects.length) return out;
  const base = resolvePaint(rects[0], win, 'fill', null);
  if (base) {
    out.push('  \\fill[' + base + ', rounded corners=1pt] (' + n2(cx) + ',' + n2(cy - 4)
      + ') rectangle (' + n2(cx + 9) + ',' + n2(cy + 4) + ');');
  }
  const texRect = swSvg.querySelector('rect[fill^="url("]');
  const patKey = texRect && swSvg.querySelector('pattern') ? legendPatternKey(swSvg) : null;
  if (patKey && TIKZ_PATTERNS[patKey]) {
    tikzPatternsUsed[patKey] = true;
    const ink = tikzColor(resolveVar(swSvg, win, 'var(--text-primary)')) || tikzColor('rgb(0,0,0)');
    out.push('  \\fill[pattern=' + TIKZ_PATTERNS[patKey] + ', pattern color=' + ink
      + ', rounded corners=1pt] (' + n2(cx) + ',' + n2(cy - 4)
      + ') rectangle (' + n2(cx + 9) + ',' + n2(cy + 4) + ');');
  }
  return out;
}
// The swatch carries the pattern by reference; the name comes off the chart's
// own texture rects, matched by the url the swatch points at.
function legendPatternKey(swSvg) {
  const shell = swSvg.closest && swSvg.closest('.leaf-shell, .facet-card, .metric-panel, .plot-render');
  const host = shell || (swSvg.ownerDocument && swSvg.ownerDocument.body);
  if (!host) return null;
  const idx = Array.prototype.indexOf.call(
    swSvg.parentNode.parentNode.querySelectorAll('.swatch-svg'), swSvg);
  const tex = host.querySelectorAll ? host.querySelectorAll('.bar-texture') : [];
  const seen = [];
  for (let i = 0; i < tex.length; i++) {
    const k = tex[i].getAttribute('data-pattern');
    if (k && seen.indexOf(k) === -1) seen.push(k);
  }
  return seen[idx] || seen[0] || null;
}

// The legend is HTML next to the chart, so it would otherwise be lost. Draw it into
// the picture underneath the plot: a figure without its key is not a figure.
function legendToTikz(legendEl, win, y0, width) {
  const out = [];
  // `.legend-shared` carries what the trimmed labels have in common; without it
  // the key names a series by only the part that varies.
  const items = legendEl.querySelectorAll('.item, .legend-shared');
  if (!items.length) return out;
  let x = 0, y = y0 + 14, rowH = 14;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sw = item.querySelector('.swatch');
    const text = Array.from(item.querySelectorAll('span'))
      .filter(sp => !sp.classList.contains('swatch'))
      .map(sp => sp.textContent).join(' ').trim() || item.textContent.trim();
    if (!text) continue;
    const drawn = item.querySelector('.swatch-svg');
    const est = 6 + (sw || drawn ? 14 : 0) + text.length * 5.2;
    if (x > 0 && x + est > width) { x = 0; y += rowH; }
    if (drawn) {
      // The key is a drawn shape or a texture, not a colour square, and the
      // export has to say the same thing the chart does.
      out.push.apply(out, swatchToTikz(drawn, win, x, y - 3));
      x += 13;
    } else if (sw) {
      const col = tikzColor(resolveVar(sw, win, sw.style.background || sw.style.backgroundColor))
        || tikzColor(win.getComputedStyle(sw).backgroundColor);
      if (col) {
        out.push('  \\fill[' + col + ', rounded corners=1pt] (' + n2(x) + ',' + n2(y - 7)
          + ') rectangle (' + n2(x + 9) + ',' + n2(y + 1) + ');');
      }
      x += 13;
    }
    const ink = resolvePaint(item, win, 'color', win.getComputedStyle(item).color) || tikzColor('rgb(0,0,0)');
    out.push('  \\node[anchor=base west, text=' + ink
      + ', font=\\fontsize{8pt}{9.6pt}\\selectfont] at (' + n2(x) + ',' + n2(y) + ') {'
      + latexEscape(text) + '};');
    x += est - (sw ? 13 : 0) + 10;
  }
  return out;
}

function svgToTikz(svg, win) {
  const out = [];
  const cs = el => win.getComputedStyle(el);

  function walk(node, dx, dy) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase();
      if (tag === 'g') {
        const t = parseTranslate(c);
        walk(c, dx + t[0], dy + t[1]);
        continue;
      }
      const style = cs(c);
      const num = a => parseFloat(c.getAttribute(a));
      if (tag === 'rect') {
        const x = dx + num('x'), y = dy + num('y'), w = num('width'), h = num('height');
        const rx = parseFloat(c.getAttribute('rx') || 0);
        const patName = c.getAttribute('data-pattern');
        if (patName) {
          // The texture overlay: its fill is a url(#id) that means nothing to
          // TikZ, so it is re-expressed as one of tikz's own patterns over the
          // solid rect that was already emitted underneath it.
          const tp = TIKZ_PATTERNS[patName];
          if (!tp) continue;
          tikzPatternsUsed[patName] = true;
          const ink = resolvePaint(c, win, 'fill', null)
            || tikzColor(resolveVar(c, win, 'var(--text-primary)')) || tikzColor('rgb(0,0,0)');
          const opts = ['pattern=' + tp, 'pattern color=' + ink]
            .concat(rx ? ['rounded corners=' + n2(rx) + 'pt'] : []);
          out.push('  \\fill[' + opts.join(', ') + '] (' + n2(x) + ',' + n2(y) + ') rectangle ('
            + n2(x + w) + ',' + n2(y + h) + ');');
          continue;
        }
        const fill = resolvePaint(c, win, 'fill', style.fill);
        if (!fill) continue;
        const opts = [fill].concat(rx ? ['rounded corners=' + n2(rx) + 'pt'] : []);
        out.push('  \\fill[' + opts.join(', ') + '] (' + n2(x) + ',' + n2(y) + ') rectangle ('
          + n2(x + w) + ',' + n2(y + h) + ');');
      } else if (tag === 'circle') {
        const fill = resolvePaint(c, win, 'fill', style.fill);
        if (!fill) continue;
        const stroke = resolvePaint(c, win, 'stroke', style.stroke);
        const opts = ['fill=' + fill];
        if (stroke) opts.push('draw=' + stroke, 'line width=' + n2(parseFloat(style.strokeWidth) || 1) + 'pt');
        out.push('  \\path[' + opts.join(', ') + '] (' + n2(dx + num('cx')) + ',' + n2(dy + num('cy'))
          + ') circle[radius=' + n2(num('r')) + 'pt];');
      } else if (tag === 'polygon') {
        // marker shapes. A closed filled path -- which is why every shape is
        // built out of polygons rather than <path> in the first place.
        const fill = resolvePaint(c, win, 'fill', style.fill);
        if (!fill) continue;
        const pts = (c.getAttribute('points') || '').trim().split(/\s+/).map(p => {
          const xy = p.split(',');
          return '(' + n2(dx + parseFloat(xy[0])) + ',' + n2(dy + parseFloat(xy[1])) + ')';
        });
        if (pts.length < 3) continue;
        out.push('  \\fill[' + fill + '] ' + pts.join(' -- ') + ' -- cycle;');
      } else if (tag === 'line') {
        const stroke = resolvePaint(c, win, 'stroke', style.stroke);
        if (!stroke) continue;
        const opts = [stroke, 'line width=' + n2(parseFloat(style.strokeWidth) || 1) + 'pt'];
        const dash = dashPattern(style);
        if (dash) opts.push(dash);
        if (parseFloat(style.opacity) < 1) opts.push('opacity=' + n2(parseFloat(style.opacity)));
        out.push('  \\draw[' + opts.join(', ') + '] (' + n2(dx + num('x1')) + ',' + n2(dy + num('y1'))
          + ') -- (' + n2(dx + num('x2')) + ',' + n2(dy + num('y2')) + ');');
      } else if (tag === 'polyline') {
        const stroke = resolvePaint(c, win, 'stroke', style.stroke);
        if (!stroke) continue;
        const pts = (c.getAttribute('points') || '').trim().split(/\s+/).map(p => {
          const xy = p.split(',');
          return '(' + n2(dx + parseFloat(xy[0])) + ',' + n2(dy + parseFloat(xy[1])) + ')';
        });
        if (pts.length < 2) continue;
        const opts = [stroke, 'line width=' + n2(parseFloat(c.getAttribute('stroke-width')) || 2) + 'pt',
          'line join=round', 'line cap=round'];
        const dash = c.getAttribute('stroke-dasharray');
        if (dash) {
          const nums = dash.split(/[ ,]+/).map(parseFloat);
          opts.push('dash pattern=on ' + n2(nums[0]) + 'pt off ' + n2(nums[1] || nums[0]) + 'pt');
        }
        out.push('  \\draw[' + opts.join(', ') + '] ' + pts.join(' -- ') + ';');
      } else if (tag === 'text') {
        const txt = (c.textContent || '').trim();
        if (!txt) continue;
        const fill = resolvePaint(c, win, 'fill', style.fill) || tikzColor('rgb(0,0,0)');
        const size = parseFloat(style.fontSize) || 10;
        const anchor = ANCHOR[c.getAttribute('text-anchor') || 'start'] || 'base west';
        const rot = parseRotate(c);
        const opts = ['anchor=' + anchor, 'text=' + fill,
          'font=\\fontsize{' + n2(size) + 'pt}{' + n2(size * 1.2) + 'pt}\\selectfont'];
        if (rot) opts.push('rotate=' + n2(rot));
        const fwRaw = String(style.fontWeight || '');
        const weight = /^\d+$/.test(fwRaw) ? parseInt(fwRaw, 10)
          : (fwRaw === 'bold' || fwRaw === 'bolder' ? 700 : 400);
        if (weight >= 600) opts[2] = opts[2].replace('\\selectfont', '\\bfseries\\selectfont');
        out.push('  \\node[' + opts.join(', ') + '] at (' + n2(dx + (parseFloat(c.getAttribute('x')) || 0))
          + ',' + n2(dy + (parseFloat(c.getAttribute('y')) || 0)) + ') {' + latexEscape(txt) + '};');
      }
    }
  }
  walk(svg, 0, 0);
  return out;
}

// An HTML table becomes a booktabs tabular rather than a picture.
function tableToTikz(table) {
  const headRows = Array.from(table.querySelectorAll('thead tr'));
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  const width = bodyRows.length ? Array.from(bodyRows[0].children).length : 0;
  if (!width) return [];
  const leading = Array.from(bodyRows[0].children).filter(td => td.classList.contains('rowhead')).length;
  const cols = 'l'.repeat(leading) + 'r'.repeat(width - leading);
  const lines = ['\\begin{tabular}{' + cols + '}', '\\toprule'];
  headRows.forEach((tr, ri) => {
    const cells = Array.from(tr.children).map(th => {
      const span = th.colSpan || 1;
      const body = '\\textbf{' + latexEscape(th.textContent) + '}';
      return span > 1 ? '\\multicolumn{' + span + '}{c}{' + body + '}' : body;
    });
    lines.push(cells.join(' & ') + ' \\\\');
    if (ri === headRows.length - 1) lines.push('\\midrule');
  });
  bodyRows.forEach(tr => {
    lines.push(Array.from(tr.children).map(td => latexEscape(td.textContent)).join(' & ') + ' \\\\');
  });
  lines.push('\\bottomrule', '\\end{tabular}');
  return lines;
}

// Caption for one figure: the facet headings and panel title stacked above it. The
// walk always runs to the top of the plot, not to the export root, so exporting a
// single chart out of a facet still records which facet it came from.
function captionFor(node) {
  const parts = [];
  let cur = node;
  while (cur && !(cur.classList && cur.classList.contains('plot-render'))) {
    // read the stored label, never the DOM text: the heading also contains the
    // export button, whose own label would otherwise end up in the caption
    if (cur.getAttribute) {
      const cap = cur.getAttribute('data-caption');
      if (cap) parts.unshift(cap);
    }
    cur = cur.parentNode;
  }
  return parts.join(' — ');
}

// A4 text widths in points, for telling the user how far over the page they are.
const PAGE_W = { 'one-column article': 345, 'full-width A4': 469, 'landscape A4': 700 };
function fitAdvice(w) {
  if (!w) return [];
  const col = PAGE_W['one-column article'];
  const ratio = w / col;
  const out = [];
  out.push('% Natural width ' + Math.round(w) + 'pt. A one-column A4 \\textwidth is about '
    + col + 'pt, a full-width figure about ' + PAGE_W['full-width A4'] + 'pt.');
  if (ratio <= 1.02) {
    out.push('% It already fits a single column. No scaling needed.');
  } else if (ratio <= 1.4) {
    out.push('% About ' + ratio.toFixed(1) + 'x a column: use the full text width, or wrap in');
    out.push('%   \\resizebox{\\linewidth}{!}{ ... }   (text shrinks by the same factor)');
  } else if (ratio <= 2.2) {
    out.push('% About ' + ratio.toFixed(1) + 'x a column. \\resizebox would shrink 10pt labels to '
      + (10 / ratio).toFixed(1) + 'pt, which is below the ~6pt floor for readable print.');
    out.push('% Prefer a full-width figure (figure*), or rotate it:');
    out.push('%   \\usepackage{rotating} ... \\begin{sidewaysfigure} ... \\end{sidewaysfigure}');
  } else {
    out.push('% About ' + ratio.toFixed(1) + 'x a column: no scaling will save this. \\resizebox');
    out.push('% would drop 10pt labels to ' + (10 / ratio).toFixed(1) + 'pt, far below legibility.');
    out.push('% Reduce what the figure carries instead - move a dimension from the x-axis');
    out.push('% into Facets (one figure each), or narrow its included values, then re-export.');
  }
  return out;
}

function buildTikzDocument(root, win, title) {
  for (const k in TIKZ_COLORS) delete TIKZ_COLORS[k];
  for (const k in tikzPatternsUsed) delete tikzPatternsUsed[k];
  tikzColorSeq = 0;

  const figures = [];
  const targets = root.querySelectorAll('svg, table.plot-table');
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const cap = captionFor(t);
    if (t.tagName.toLowerCase() === 'table') {
      const nCols = t.querySelector('tbody tr')
        ? t.querySelector('tbody tr').children.length : 0;
      figures.push({ cap: cap, body: tableToTikz(t), kind: 'table', cols: nCols });
    } else {
      const w = parseFloat(t.getAttribute('width')) || 0;
      const h = parseFloat(t.getAttribute('height')) || 0;
      const body = svgToTikz(t, win);
      const shell = t.parentNode && t.parentNode.parentNode;   // svg -> .svg-scroll -> .leaf-shell
      // every key, not the first: a chart coloured by metric has two
      const legends = (shell && shell.parentNode)
        ? Array.prototype.filter.call(shell.parentNode.children,
          e => e.classList && e.classList.contains('legend'))
        : [];
      let ly = h;
      legends.forEach(legend => {
        const drawn = legendToTikz(legend, win, ly, w);
        if (!drawn.length) return;
        Array.prototype.push.apply(body, drawn);
        ly += 14 * Math.max(1, Math.ceil(legend.querySelectorAll('.item').length / 4));
      });
      figures.push({ cap: cap, body: body, kind: 'picture', w: w });
    }
  }
  if (figures.length === 0) return null;

  const defs = Object.keys(TIKZ_COLORS).map(hex => '\\definecolor{' + TIKZ_COLORS[hex] + '}{HTML}{' + hex + '}');
  const out = [];
  out.push('% ' + title);
  out.push('% Generated by the data explorer.');
  const needsPatterns = Object.keys(tikzPatternsUsed).length > 0;
  out.push('% Requires: \\usepackage{tikz}'
    + (figures.some(f => f.kind === 'table') ? ', \\usepackage{booktabs}' : '')
    + (needsPatterns ? ', \\usetikzlibrary{patterns}' : ''));
  out.push('% Coordinates are in points with the y axis flipped, so the figure matches the');
  out.push('% on-screen layout exactly. Each figure below is preceded by its natural size');
  out.push('% and what to do if it does not fit the page.');
  out.push('');
  out.push.apply(out, defs);
  out.push('');
  figures.forEach((f, i) => {
    if (f.cap) out.push('% --- ' + f.cap + ' ---');
    if (f.kind === 'table') {
      out.push('% ' + f.cols + ' columns. A tabular this wide does not fit A4 upright;');
      if (f.cols > 12) {
        out.push('% move a dimension from Columns into Rows (and use longtable for the length),');
        out.push('% or into Facets for one table each. Failing that: \\begin{sidewaystable},');
        out.push('% or {\\footnotesize ...} / \\resizebox{\\linewidth}{!}{...} if it is only slightly over.');
      } else {
        out.push('% if it is slightly over, try {\\footnotesize ...} before \\resizebox.');
      }
      out.push.apply(out, f.body);
    } else {
      out.push.apply(out, fitAdvice(f.w));
      out.push('\\begin{tikzpicture}[x=1pt,y=-1pt]');
      out.push.apply(out, f.body);
      out.push('\\end{tikzpicture}');
    }
    if (i < figures.length - 1) out.push('');
  });
  out.push('');
  return out.join('\n');
}
