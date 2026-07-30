// dataset handle, palette constants, DOM + tooltip helpers
// The built page carries its data inline. The unbuilt src/index.html cannot --
// fetch() is blocked over file:// -- so it falls back to a dev bundle written as
// a plain script by tools/make-fixture.mjs. Phase 3 replaces both with the store.
const DATA = (function () {
  const node = document.getElementById('dataset');
  const text = node ? node.textContent.trim() : '';
  if (text && text.slice(0, 2) !== '__') return JSON.parse(text);
  if (window.__VIZ_DATASET__) return window.__VIZ_DATASET__;
  throw new Error('no dataset: run `npm run build`, or `npm run fixture` for src/index.html');
})();
const tooltip = document.getElementById('tooltip');
const SVGNS = 'http://www.w3.org/2000/svg';

const VARIANTS = ['base', 'tuned', 'tunedAlt'];
const VARIANT_COLOR = { base: 'var(--series-base)', tuned: 'var(--series-tuned)', tunedAlt: 'var(--series-tuned-alt)' };
const VARIANT_LABEL = { base: 'Base', tuned: 'Tuned', tunedAlt: 'Tuned-alt' };
const VARIANT_LABEL_SHORT = { base: 'Base', tuned: 'Tuned', tunedAlt: 'Tuned-alt' };
const DEVICES = ['dev1', 'dev2', 'dev3'];

// Fixed categorical order (blue, orange, aqua, yellow, magenta) — color is
// assigned by an app's position in the dataset's canonical app list, never
// by its position in the current filtered subset, so toggling other apps
// on/off never repaints the ones still visible.
const APP_PALETTE = ['var(--series-base)', 'var(--series-tuned)', 'var(--series-tuned-alt)', 'var(--app-4)', 'var(--app-5)'];
function appColor(ds, app) {
  const idx = ds.apps.indexOf(app);
  return APP_PALETTE[idx % APP_PALETTE.length];
}

const CATEGORIES = [
  { key: 'rateA',        label: 'Rate A',    field: 'rateA',        unit: '%', log: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'rateB',        label: 'Rate B',    field: 'rateB',        unit: '%', log: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'countA', label: 'Count A', field: 'countA', unit: '',  log: true,  fmt: fmtAccess },
  { key: 'countB', label: 'Count B', field: 'countB', unit: '',  log: true,  fmt: fmtAccess },
];

function fmtAccess(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function html(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function showTip(evt, rows) {
  tooltip.innerHTML = '';
  rows.forEach((r, i) => {
    if (i === 0) { const b = document.createElement('b'); b.textContent = r; tooltip.appendChild(b); return; }
    const line = document.createElement('div');
    line.textContent = r;
    tooltip.appendChild(line);
  });
  tooltip.classList.add('show');
  moveTip(evt);
}
function moveTip(evt) { tooltip.style.left = evt.clientX + 'px'; tooltip.style.top = evt.clientY + 'px'; }
function hideTip() { tooltip.classList.remove('show'); }
