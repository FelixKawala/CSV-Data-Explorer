// marker shapes and bar fill patterns
//
// Colour alone is not enough for a figure that ends up printed in greyscale,
// photocopied, or read by someone with a colour vision deficiency. A shape per
// series on a line chart, and a texture per series on a bar chart, carry the
// same distinction through all of that -- and through a black-and-white journal
// page, which is where these charts are going.
//
// Everything here draws with `<circle>` and `<polygon>` only, never `<path>`.
// That is not an aesthetic choice: those are the two primitives all three
// exporters already walk, so a shape drawn here survives into TikZ, SVG and PNG
// without teaching any of them a new element.

// Assignment is by the series' slot, matching how `dimValueColor` keeps a colour
// attached to the entity rather than to its position in the current filter. A
// series keeps its shape when other series are toggled off.
const MARK_SHAPES = [
  { key: 'circle', label: 'Circle' },
  { key: 'square', label: 'Square' },
  { key: 'diamond', label: 'Diamond' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'triangle-down', label: 'Triangle (down)' },
  { key: 'plus', label: 'Plus' },
  { key: 'cross', label: 'Cross' },
  { key: 'star', label: 'Star' },
];
const MARK_SHAPE_KEYS = MARK_SHAPES.map(s => s.key);
function markShapeAt(i) { return MARK_SHAPE_KEYS[((i % MARK_SHAPE_KEYS.length) + MARK_SHAPE_KEYS.length) % MARK_SHAPE_KEYS.length]; }

// Points for the polygon shapes, on a unit radius about the origin. Scaled and
// translated at draw time so one table serves every size.
function markPoints(shape) {
  const pts = [];
  const poly = (n, rot, r2) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      pts.push([Math.cos(a) * (r2 || 1), Math.sin(a) * (r2 || 1)]);
    }
  };
  const spokes = (rot, arm, thick) => {
    // a plus/cross as one closed 12-gon, so it is a single fillable polygon
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pa = Math.cos(a + Math.PI / 2), pb = Math.sin(a + Math.PI / 2);
      pts.push([ca * thick + pa * thick, sa * thick + pb * thick]);
      pts.push([ca * arm + pa * thick, sa * arm + pb * thick]);
      pts.push([ca * arm - pa * thick, sa * arm - pb * thick]);
    }
  };
  switch (shape) {
    case 'square': poly(4, Math.PI / 4); break;
    case 'diamond': poly(4, 0); break;
    case 'triangle': poly(3, -Math.PI / 2); break;
    case 'triangle-down': poly(3, Math.PI / 2); break;
    case 'plus': spokes(0, 1.15, 0.38); break;
    case 'cross': spokes(Math.PI / 4, 1.15, 0.38); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 1.15 : 0.5;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      break;
    default: return null;                       // circle has no points
  }
  return pts;
}

// Draw one marker. Returns the element so a caller can attach its own handlers.
//
// Every marker carries its centre, radius and shape name as data attributes.
// A polygon has no cx/cy to read back, and an exporter that can say "a square
// mark at this point" should not have to infer that from twelve coordinates --
// pgfplots and TikZ both want the name and the point, not the outline.
function drawMark(parent, shape, cx, cy, r, attrs) {
  const round = n => Math.round(n * 100) / 100;
  const base = Object.assign({
    class: 'series-dot',
    'data-shape': shape,
    'data-cx': round(cx), 'data-cy': round(cy), 'data-r': round(r),
  }, attrs || {});
  const pts = markPoints(shape);
  if (!pts) {
    return el('circle', Object.assign({ cx: cx, cy: cy, r: r }, base), parent);
  }
  return el('polygon', Object.assign({
    points: pts.map(p => round(cx + p[0] * r) + ',' + round(cy + p[1] * r)).join(' '),
  }, base), parent);
}

// ---- bar fill patterns ------------------------------------------------------
// A patterned bar is drawn as TWO rects: the solid colour, then a texture on
// top. That keeps `fill` a plain colour for any exporter that cannot resolve a
// url(#id) reference, and keeps one `rect.bar` per drawn bar for anything
// counting them.
const BAR_PATTERNS = [
  { key: 'none', label: 'Solid' },
  { key: 'diagonal', label: 'Diagonal ///' },
  { key: 'backdiagonal', label: 'Diagonal \\\\\\' },
  { key: 'crosshatch', label: 'Crosshatch' },
  { key: 'dots', label: 'Dots' },
  { key: 'grid', label: 'Grid' },
  { key: 'horizontal', label: 'Horizontal' },
  { key: 'vertical', label: 'Vertical' },
];
const BAR_PATTERN_KEYS = BAR_PATTERNS.filter(p => p.key !== 'none').map(p => p.key);
function barPatternAt(i) {
  return BAR_PATTERN_KEYS[((i % BAR_PATTERN_KEYS.length) + BAR_PATTERN_KEYS.length) % BAR_PATTERN_KEYS.length];
}

// Ids are sequenced across the whole page, not per chart: the image export
// stacks several charts into one document, and repeated ids there would make
// every bar take the first chart's texture.
let patternSeq = 0;
function ensureDefs(svg) {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = el('defs', {});
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

function patternGeometry(key, ink) {
  const stroke = { stroke: ink, 'stroke-width': 1.1, fill: 'none' };
  switch (key) {
    case 'diagonal': return [['path-line', { x1: 0, y1: 6, x2: 6, y2: 0 }, stroke],
      ['path-line', { x1: -1, y1: 1, x2: 1, y2: -1 }, stroke],
      ['path-line', { x1: 5, y1: 7, x2: 7, y2: 5 }, stroke]];
    case 'backdiagonal': return [['path-line', { x1: 0, y1: 0, x2: 6, y2: 6 }, stroke],
      ['path-line', { x1: -1, y1: 5, x2: 1, y2: 7 }, stroke],
      ['path-line', { x1: 5, y1: -1, x2: 7, y2: 1 }, stroke]];
    case 'crosshatch': return [['path-line', { x1: 0, y1: 6, x2: 6, y2: 0 }, stroke],
      ['path-line', { x1: 0, y1: 0, x2: 6, y2: 6 }, stroke]];
    case 'grid': return [['path-line', { x1: 0, y1: 0, x2: 0, y2: 6 }, stroke],
      ['path-line', { x1: 0, y1: 0, x2: 6, y2: 0 }, stroke]];
    case 'horizontal': return [['path-line', { x1: 0, y1: 3, x2: 6, y2: 3 }, stroke]];
    case 'vertical': return [['path-line', { x1: 3, y1: 0, x2: 3, y2: 6 }, stroke]];
    case 'dots': return [['dot', { cx: 2, cy: 2, r: 1.1 }, { fill: ink }],
      ['dot', { cx: 5, cy: 5, r: 1.1 }, { fill: ink }]];
    default: return [];
  }
}

// -> a `url(#id)` string, or null when this bar wants no texture
function patternFill(svg, key, ink) {
  if (!key || key === 'none') return null;
  const parts = patternGeometry(key, ink);
  if (!parts.length) return null;
  const id = 'viz-pat-' + (++patternSeq);
  const pat = el('pattern', {
    id: id, width: 6, height: 6, patternUnits: 'userSpaceOnUse',
  }, ensureDefs(svg));
  parts.forEach(([kind, geom, style]) => {
    el(kind === 'dot' ? 'circle' : 'line', Object.assign({}, geom, style), pat);
  });
  return 'url(#' + id + ')';
}

// Rounded is the house style; square is what most journals expect; pill is a
// full semicircle at each end, capped at half the bar height so a short bar
// does not turn into a lozenge.
function barCornerRadius(corner, w, h) {
  if (corner === 'square') return 0;
  if (corner === 'pill') return Math.min(w / 2, h / 2);
  return Math.min(3, w / 2);
}

// ---- the per-plot style record ---------------------------------------------
// Series overrides are keyed by the series' value signature (`variant=base`) so
// they survive filtering, reordering and a change of grouping -- an index would
// silently move the override to a different series.
function defaultPlotStyle() {
  return {
    palette: 'default',
    barCorner: 'rounded',
    barPattern: 'none',      // 'none' | 'auto' | a pattern key
    markers: 'auto',         // 'auto' (shape per series) | 'circle' | 'none'
    markerSize: 3.5,
    lineWidth: 2,
    series: {},              // sig -> { color?, shape?, pattern? }
  };
}
function normalisePlotStyle(s) {
  const d = defaultPlotStyle();
  if (!s || typeof s !== 'object') return d;
  const num = (v, dv, lo, hi) =>
    (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : dv;
  return {
    palette: PALETTES[s.palette] ? s.palette : d.palette,
    barCorner: ['rounded', 'square', 'pill'].indexOf(s.barCorner) !== -1 ? s.barCorner : d.barCorner,
    barPattern: (s.barPattern === 'auto' || BAR_PATTERNS.some(p => p.key === s.barPattern))
      ? s.barPattern : d.barPattern,
    markers: (s.markers === 'auto' || s.markers === 'none' || MARK_SHAPE_KEYS.indexOf(s.markers) !== -1)
      ? s.markers : d.markers,
    markerSize: num(s.markerSize, d.markerSize, 1.5, 9),
    lineWidth: num(s.lineWidth, d.lineWidth, 0.5, 6),
    series: (s.series && typeof s.series === 'object') ? s.series : {},
  };
}

function cloneStyle(st) {
  const out = normalisePlotStyle(st);
  out.series = {};
  const src = (st && st.series) || {};
  Object.keys(src).forEach(k => { out.series[k] = Object.assign({}, src[k]); });
  return out;
}

// A stable name for one series, used as the override key.
function seriesSignature(entry) {
  const vals = entry && entry.vals ? entry.vals : {};
  return Object.keys(vals).sort().map(k => k + '=' + vals[k]).join(SIG_SEP);
}

// ---- palettes ---------------------------------------------------------------
// Okabe-Ito is the standard colour-vision-deficiency-safe set; greyscale is for
// a figure that will be printed without colour at all, where the shapes and
// textures do the distinguishing.
const PALETTES = {
  default: { label: 'Default', colors: null },   // null = the app's own ramp
  okabe: {
    label: 'Colourblind-safe',
    colors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'],
  },
  grey: {
    label: 'Greyscale (print)',
    colors: ['#1a1a1a', '#767676', '#b0b0b0', '#4d4d4d', '#8f8f8f', '#d4d4d4', '#303030', '#a0a0a0'],
  },
};
function paletteDimValueColor(paletteKey, dimKey, value) {
  const dim = DIM_BY_KEY[dimKey];
  const idx = dim ? dim.values.indexOf(value) : -1;
  return paletteColorAt(paletteKey, idx < 0 ? 0 : idx);
}
function paletteColorAt(paletteKey, i) {
  const p = PALETTES[paletteKey];
  if (!p || !p.colors) return seriesColor(i);
  return p.colors[((i % p.colors.length) + p.colors.length) % p.colors.length];
}
