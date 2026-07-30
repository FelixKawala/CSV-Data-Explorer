// categorical colour for a dimension value
//
// The first eight slots are the validated palette. Past that the app used to
// refuse to draw; arbitrary CSV columns hit that constantly, so further slots
// are generated instead.
//
// Trade-off, stated plainly: generated hues are not as reliably distinguishable
// as the validated eight, especially under colour-vision deficiency. Hues are
// spaced by the golden angle rather than sequentially so that neighbours in the
// legend are far apart on the wheel, and lightness alternates to give a second
// channel of separation, but past roughly a dozen series a chart is asking the
// reader to do something a chart cannot do. `renderZonesUI` says so.

const CAT_PALETTE = [
  'var(--series-base)', 'var(--series-tuned)', 'var(--series-tuned-alt)',
  'var(--app-4)', 'var(--app-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)',
];
const PALETTE_COMFORTABLE = CAT_PALETTE.length + 4;

const GOLDEN_ANGLE = 137.508;
const generatedCache = [];
function generatedColor(i) {
  if (generatedCache[i]) return generatedCache[i];
  const n = i - CAT_PALETTE.length;
  const hue = (200 + n * GOLDEN_ANGLE) % 360;
  const light = n % 2 === 0 ? 58 : 42;      // alternate so adjacent hues differ twice over
  const chroma = n % 3 === 0 ? 62 : 52;
  const c = `hsl(${hue.toFixed(1)} ${chroma}% ${light}%)`;
  generatedCache[i] = c;
  return c;
}

function seriesColor(i) {
  return i < CAT_PALETTE.length ? CAT_PALETTE[i] : generatedColor(i);
}

function dimValueColor(dimKey, value) {
  const dim = DIM_BY_KEY[dimKey];
  const idx = dim ? dim.values.indexOf(value) : -1;
  return seriesColor(idx < 0 ? 0 : idx);
}
