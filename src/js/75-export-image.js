// image export: SVG, and PNG rasterised from it
//
// The charts are already SVG, but not portable SVG: their colours come from CSS
// custom properties and their strokes from stylesheet rules, none of which
// survive being lifted out of the page. So the export clones each chart and
// bakes every computed value onto the element as a presentation attribute.
//
// Colour resolution is the same problem the TikZ exporter solved -- a paint may
// be a literal, a var(--x) on an attribute, or a stylesheet rule -- so this
// reuses rgbToHex and resolveVar from 70-export-tikz.js rather than repeating
// their logic. Only the output differs: #RRGGBB here, a macro name there.

const IMG_STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor',
];

function hexPaint(node, win, attr, computed) {
  const a = node.getAttribute && node.getAttribute(attr);
  if (a && a !== 'none') {
    const hex = rgbToHex(resolveVar(node, win, a));
    if (hex) return '#' + hex;
  }
  if (computed && computed !== 'none') {
    const hex = rgbToHex(resolveVar(node, win, computed));
    if (hex) return '#' + hex;
  }
  return null;
}

// Copy the values the stylesheet supplies onto the clone, so the file stands
// alone. Anything left as `none` or absent stays absent.
function inlineComputedStyles(srcEl, dstEl, win) {
  const cs = win.getComputedStyle(srcEl);
  IMG_STYLE_PROPS.forEach(prop => {
    if (prop === 'fill' || prop === 'stroke') {
      const hex = hexPaint(srcEl, win, prop, cs[prop === 'fill' ? 'fill' : 'stroke']);
      const attr = srcEl.getAttribute(prop);
      if (hex) dstEl.setAttribute(prop, hex);
      else if (attr === 'none' || cs[prop] === 'none') dstEl.setAttribute(prop, 'none');
      return;
    }
    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const v = cs[camel] || cs.getPropertyValue(prop);
    if (v && v !== 'normal' && v !== 'auto' && v !== '') dstEl.setAttribute(prop, v);
  });
}

function cloneWithStyles(srcRoot, win) {
  const clone = srcRoot.cloneNode(true);
  const src = [srcRoot].concat(Array.prototype.slice.call(srcRoot.querySelectorAll('*')));
  const dst = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
  for (let i = 0; i < src.length && i < dst.length; i++) {
    if (dst[i].nodeType === 1) inlineComputedStyles(src[i], dst[i], win);
  }
  return clone;
}

// The legend is HTML beside the chart, so it would be lost. Draw it into the SVG,
// as the TikZ exporter does -- a figure without its key is not a figure.
function legendToSvg(legendEl, win, doc, width, y0) {
  const g = doc.createElementNS(SVGNS, 'g');
  const items = legendEl.querySelectorAll('.item');
  let x = 0;
  let y = y0 + 14;
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sw = item.querySelector('.swatch');
    const text = Array.prototype.slice.call(item.querySelectorAll('span'))
      .filter(sp => !sp.classList.contains('swatch'))
      .map(sp => sp.textContent).join(' ').trim() || item.textContent.trim();
    if (!text) continue;
    const est = 6 + (sw ? 14 : 0) + text.length * 5.4;
    if (x > 0 && x + est > width) { x = 0; y += 14; }
    if (sw) {
      const col = rgbToHex(resolveVar(sw, win, sw.style.background || sw.style.backgroundColor))
        || rgbToHex(win.getComputedStyle(sw).backgroundColor);
      if (col) {
        const r = doc.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y - 8);
        r.setAttribute('width', 9); r.setAttribute('height', 9);
        r.setAttribute('rx', 2); r.setAttribute('fill', '#' + col);
        g.appendChild(r);
      }
      x += 13;
    }
    const t = doc.createElementNS(SVGNS, 'text');
    const ink = rgbToHex(resolveVar(item, win, win.getComputedStyle(item).color));
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', '11');
    t.setAttribute('font-family', 'system-ui, -apple-system, "Segoe UI", sans-serif');
    if (ink) t.setAttribute('fill', '#' + ink);
    t.textContent = text;
    g.appendChild(t);
    x += est - (sw ? 13 : 0) + 10;
    used = y;
  }
  return { g, height: used ? used - y0 + 8 : 0 };
}

// Stack every chart under `root` into one standalone SVG document.
function nodeToSvgDocument(root, win) {
  const doc = win.document;
  const svgs = root.matches && root.matches('svg')
    ? [root] : Array.prototype.slice.call(root.querySelectorAll('svg'));
  if (!svgs.length) return null;

  const out = doc.createElementNS(SVGNS, 'svg');
  out.setAttribute('xmlns', SVGNS);
  out.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  out.setAttribute('version', '1.1');

  let y = 0;
  let width = 0;
  svgs.forEach(svg => {
    const w = parseFloat(svg.getAttribute('width')) || 0;
    const h = parseFloat(svg.getAttribute('height')) || 0;
    const g = doc.createElementNS(SVGNS, 'g');
    g.setAttribute('transform', 'translate(0,' + y + ')');

    // a caption, when this chart sits inside a facet or a panel
    const cap = captionFor(svg);
    let dy = 0;
    if (cap) {
      const t = doc.createElementNS(SVGNS, 'text');
      t.setAttribute('x', 0); t.setAttribute('y', 11);
      t.setAttribute('font-size', '11');
      t.setAttribute('font-weight', '600');
      t.setAttribute('font-family', 'system-ui, -apple-system, "Segoe UI", sans-serif');
      const capInk = rgbToHex(resolveVar(root, win, 'var(--text-secondary)'));
      t.setAttribute('fill', capInk ? '#' + capInk : '#333333');
      t.textContent = cap;
      g.appendChild(t);
      dy = 16;
    }

    const clone = cloneWithStyles(svg, win);
    clone.removeAttribute('style');
    const inner = doc.createElementNS(SVGNS, 'g');
    inner.setAttribute('transform', 'translate(0,' + dy + ')');
    while (clone.firstChild) inner.appendChild(clone.firstChild);
    g.appendChild(inner);
    y += h + dy + 6;

    // the legend that belongs to this chart, if any
    const shell = svg.parentNode && svg.parentNode.parentNode;
    const legend = shell && shell.parentNode
      && Array.prototype.filter.call(shell.parentNode.children,
        e => e.classList && e.classList.contains('legend'))[0];
    if (legend) {
      const built = legendToSvg(legend, win, doc, Math.max(w, 200), 0);
      if (built.height) {
        built.g.setAttribute('transform', 'translate(0,' + (dy + h) + ')');
        g.appendChild(built.g);
        y += built.height;
      }
    }

    out.appendChild(g);
    width = Math.max(width, w);
    y += 10;
  });

  const pad = 8;
  out.setAttribute('width', width + pad * 2);
  out.setAttribute('height', y + pad);
  out.setAttribute('viewBox', [-pad, -pad, width + pad * 2, y + pad].join(' '));
  return { node: out, width: width + pad * 2, height: y + pad };
}

function svgSource(root, win) {
  const built = nodeToSvgDocument(root, win);
  if (!built) return null;
  const xml = new win.XMLSerializer().serializeToString(built.node);
  return {
    text: '<?xml version="1.0" encoding="UTF-8"?>\n' + xml + '\n',
    width: built.width,
    height: built.height,
  };
}

function downloadBlob(filename, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    return false;
  }
}

// Everything is inlined and nothing external is referenced, so the canvas is not
// tainted and this works from file:// as well as over http.
function exportPng(root, win, name, scale) {
  const src = svgSource(root, win);
  if (!src) { setStatus('Nothing to export here yet.', false); return; }
  const blob = new Blob([src.text], { type: 'image/svg+xml;charset=utf-8' });
  let url;
  try {
    url = URL.createObjectURL(blob);
  } catch (e) {
    setStatus('This browser cannot rasterise here — use the SVG export instead.', false);
    return;
  }
  const img = new win.Image();
  img.onload = () => {
    const k = scale || 2;
    const canvas = win.document.createElement('canvas');
    canvas.width = Math.round(src.width * k);
    canvas.height = Math.round(src.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) { setStatus('This browser has no canvas — use the SVG export.', false); return; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(png => {
      if (!png) { setStatus('Could not encode the image — use the SVG export.', false); return; }
      const okDl = downloadBlob(slugify(name) + '.png', png);
      setStatus(okDl ? ('Exported ' + slugify(name) + '.png at ' + k + '×')
        : 'The browser refused the download — use the SVG export instead.', false);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Could not rasterise here — the SVG export has the same figure.', false);
  };
  img.src = url;
}

function addImageButtons(host, getRoot, name, cls) {
  const svgBtn = document.createElement('button');
  svgBtn.type = 'button';
  svgBtn.className = cls || 'btn small';
  svgBtn.textContent = 'SVG';
  svgBtn.title = 'Export this as a standalone SVG';
  svgBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const src = svgSource(getRoot(), window);
    if (!src) { setStatus('Nothing to export here yet.', false); return; }
    showTexPanel([{ name: slugify(name) + '.svg', text: src.text }],
      src.width + '×' + src.height + ' px, self-contained');
    setStatus('SVG ready — ' + slugify(name) + '.svg', false);
  });
  host.appendChild(svgBtn);

  const pngBtn = document.createElement('button');
  pngBtn.type = 'button';
  pngBtn.className = cls || 'btn small';
  pngBtn.textContent = 'PNG';
  pngBtn.title = 'Export this as a PNG at 2× scale';
  pngBtn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    exportPng(getRoot(), window, name, 2);
  });
  host.appendChild(pngBtn);
}
