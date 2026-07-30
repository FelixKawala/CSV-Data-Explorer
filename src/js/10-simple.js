// Simple mode (removed in Phase 3)
// ---------------- state ----------------
const state = {
  dataset: 'setA',
  groupBy: 'app', // 'app' | 'category'
  gpus: new Set(DEVICES),
  variants: new Set(VARIANTS),
  categories: new Set(['rateA', 'rateB']),
  apps: new Set(),
};
const GROUP_BY_OPTIONS = [
  { key: 'app', label: 'Application' },
  { key: 'category', label: 'Category' },
  { key: 'config', label: 'Device + config' },
];

const dsSel = document.getElementById('ctl-dataset');
Object.keys(DATA).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; dsSel.appendChild(o); });
dsSel.value = state.dataset;
dsSel.addEventListener('change', () => { state.dataset = dsSel.value; state.apps = new Set(currentDataset().apps); renderApps(); render(); });

function currentDataset() { return DATA[state.dataset]; }

function buildChipGroup(container, items, activeSet, labelFn, colorFn, onChange) {
  container.innerHTML = '';
  items.forEach(item => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.setAttribute('aria-pressed', activeSet.has(item) ? 'true' : 'false');
    if (colorFn) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorFn(item);
      chip.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = labelFn(item);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      if (activeSet.has(item)) activeSet.delete(item); else activeSet.add(item);
      chip.setAttribute('aria-pressed', activeSet.has(item) ? 'true' : 'false');
      onChange();
    });
    container.appendChild(chip);
  });
}

function buildRadioChipGroup(container, items, activeKey, labelFn, onChange) {
  container.innerHTML = '';
  items.forEach(item => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.setAttribute('aria-pressed', item.key === activeKey ? 'true' : 'false');
    const label = document.createElement('span');
    label.textContent = labelFn(item);
    chip.appendChild(label);
    chip.addEventListener('click', () => onChange(item.key));
    container.appendChild(chip);
  });
}

function renderGroupByChips() {
  buildRadioChipGroup(document.getElementById('ctl-groupby'), GROUP_BY_OPTIONS, state.groupBy, o => o.label, key => {
    state.groupBy = key;
    renderGroupByChips();
    render();
  });
}

function renderGpuChips() {
  buildChipGroup(document.getElementById('ctl-device'), DEVICES, state.gpus, g => g, null, render);
}
function renderVariantChips() {
  buildChipGroup(document.getElementById('ctl-variant'), VARIANTS, state.variants, v => VARIANT_LABEL_SHORT[v], v => VARIANT_COLOR[v], render);
}
function renderCategoryChips() {
  buildChipGroup(document.getElementById('ctl-category'), CATEGORIES.map(c => c.key), state.categories, k => CATEGORIES.find(c => c.key === k).label, null, render);
}
function renderAppChips() {
  buildChipGroup(document.getElementById('ctl-app'), currentDataset().apps, state.apps, a => a, null, render);
}

document.getElementById('app-all').addEventListener('click', () => { state.apps = new Set(currentDataset().apps); renderAppChips(); render(); });
document.getElementById('app-none').addEventListener('click', () => { state.apps.clear(); renderAppChips(); render(); });

function renderLegend() {
  const box = document.getElementById('legend');
  box.innerHTML = '';
  if (state.groupBy === 'config') {
    // bars are colored by application in this mode.
    const ds = currentDataset();
    ds.apps.forEach(app => {
      const item = document.createElement('div'); item.className = 'item';
      const dot = document.createElement('span'); dot.className = 'swatch'; dot.style.background = appColor(ds, app);
      const label = document.createElement('span'); label.textContent = app;
      item.appendChild(dot); item.appendChild(label);
      box.appendChild(item);
    });
  } else {
    VARIANTS.forEach(v => {
      const item = document.createElement('div'); item.className = 'item';
      const dot = document.createElement('span'); dot.className = 'swatch'; dot.style.background = VARIANT_COLOR[v];
      const label = document.createElement('span'); label.textContent = VARIANT_LABEL[v];
      item.appendChild(dot); item.appendChild(label);
      box.appendChild(item);
    });
  }
}

// ---------------- chart ----------------
// series: [{key, color, label}]; getValue(combo, seriesItem) -> number|null
function groupedBarPanel(container, combos, cat, series, getValue, emptyMsg, showSeriesTicks) {
  if (series.length === 0 || combos.length === 0) {
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;color:var(--text-muted);padding:20px 0;';
    msg.textContent = emptyMsg || 'Nothing to show — enable at least one series and one Device.';
    container.appendChild(msg);
    return;
  }

  const barW = 14, gap = 2, groupGap = 14;
  const groupW = series.length * barW + Math.max(series.length - 1, 0) * gap;
  const plotW = combos.length * groupW + Math.max(combos.length - 1, 0) * groupGap;
  // Series ticks (one short per-bar label under every bar, e.g. which
  // application a bar is) need extra vertical room above the group's
  // own Device·config label, which gets pushed further down to clear them.
  const seriesTickH = showSeriesTicks ? 24 : 0;
  const marginL = cat.log ? 46 : 38, marginR = 8, marginT = 10, marginB = 48 + seriesTickH;
  const plotH = 170;
  const w = plotW + marginL + marginR, h = plotH + marginT + marginB;

  let maxVal = 0, minPos = Infinity;
  combos.forEach(c => series.forEach(s => {
    const val = getValue(c, s);
    if (val !== null && val !== undefined) { maxVal = Math.max(maxVal, val); if (val > 0) minPos = Math.min(minPos, val); }
  }));
  if (maxVal <= 0) maxVal = 1;
  if (!isFinite(minPos)) minPos = 1;

  let scaleMax, logMin;
  if (cat.log) { logMin = Math.pow(10, Math.floor(Math.log10(minPos))); scaleMax = Math.pow(10, Math.ceil(Math.log10(maxVal))); }
  else { scaleMax = maxVal * 1.15; }

  function y(val) {
    if (val === null || val === undefined) return null;
    if (cat.log) {
      if (val <= 0) return plotH;
      const t = (Math.log10(val) - Math.log10(logMin)) / (Math.log10(scaleMax) - Math.log10(logMin));
      return plotH - t * plotH;
    }
    return plotH - (val / scaleMax) * plotH;
  }

  const svg = el('svg', { viewBox: `0 0 ${w} ${h}` });
  const plot = el('g', { transform: `translate(${marginL},${marginT})` }, svg);

  const ticks = cat.log
    ? Array.from({ length: Math.round(Math.log10(scaleMax) - Math.log10(logMin)) + 1 }, (_, i) => logMin * Math.pow(10, i))
    : [0, scaleMax * 0.5, scaleMax].map(v => v);

  ticks.forEach(t => {
    const ty = y(t);
    el('line', { class: 'grid-line', x1: 0, x2: plotW, y1: ty, y2: ty }, plot);
    const label = el('text', { class: 'axis-label', x: -6, y: ty + 3, 'text-anchor': 'end' }, plot);
    label.textContent = cat.log ? fmtAccess(t) : Math.round(t) + cat.unit;
  });
  el('line', { class: 'baseline', x1: 0, x2: plotW, y1: plotH, y2: plotH }, plot);

  combos.forEach((c, gi) => {
    const gx = gi * (groupW + groupGap);
    series.forEach((s, vi) => {
      const val = getValue(c, s);
      const bx = gx + vi * (barW + gap);
      if (val !== null && val !== undefined) {
        const barY = y(val);
        const barTop = cat.log ? barY : Math.min(barY, plotH);
        const barH = Math.max(plotH - barTop, 1);
        const rect = el('rect', { class: 'bar', fill: s.color, x: bx, y: barTop, width: barW, height: barH, rx: 3 }, plot);
        rect.addEventListener('mousemove', e => showTip(e, [`${c.device} · ${c.size} thr — ${s.label}`, cat.fmt(val)]));
        rect.addEventListener('mouseleave', hideTip);
      }
      if (showSeriesTicks) {
        // Per-bar identity label (e.g. which application) so the tick
        // itself says who the bar is, not just the color — color +
        // legend alone made the Device+config groups unreadable without
        // constantly cross-checking the legend.
        const bcx = bx + barW / 2;
        const seriesLabel = el('text', {
          class: 'series-tick-label', x: bcx, y: plotH + 8, 'text-anchor': 'end',
          transform: `rotate(-90 ${bcx} ${plotH + 8})`
        }, plot);
        seriesLabel.textContent = s.label.length > 4 ? s.label.slice(0, 3).toUpperCase() : s.label;
        seriesLabel.addEventListener('mousemove', e => showTip(e, [`${c.device} · ${c.size} thr`, s.label]));
        seriesLabel.addEventListener('mouseleave', hideTip);
      }
    });
    const label = el('text', {
      class: 'group-label', x: gx + groupW / 2, y: plotH + 14 + seriesTickH, 'text-anchor': 'end',
      transform: `rotate(-40 ${gx + groupW / 2} ${plotH + 14 + seriesTickH})`
    }, plot);
    label.textContent = `${c.device}·${c.size}`;
  });

  container.appendChild(svg);
}

// ---------------- render ----------------
function filteredCombos() {
  return currentDataset().combos.filter(c => state.gpus.has(c.device));
}

function activeVariants() { return VARIANTS.filter(v => state.variants.has(v)); }
function variantSeries() { return activeVariants().map(v => ({ key: v, color: VARIANT_COLOR[v], label: VARIANT_LABEL[v] })); }
function variantGetValue(appData, cat) { return (combo, s) => appData[combo.key][cat.field][s.key]; }
function appSeries(ds, activeApps) { return activeApps.map(app => ({ key: app, color: appColor(ds, app), label: app })); }
function appGetValue(ds, cat, variantKey) { return (combo, s) => ds.data[s.key][combo.key][cat.field][variantKey]; }
const VARIANT_EMPTY_MSG = 'Nothing to show — enable at least one variant and one Device.';
const APP_EMPTY_MSG = 'Nothing to show — enable at least one application and one Device.';

function render() {
  renderLegend();
  const main = document.getElementById('main');
  main.innerHTML = '';
  const ds = currentDataset();
  const combos = filteredCombos();
  const activeApps = ds.apps.filter(a => state.apps.has(a));
  const activeCats = CATEGORIES.filter(c => state.categories.has(c.key));

  if (activeApps.length === 0 || activeCats.length === 0) {
    const empty = html('div', 'empty-state', main);
    empty.textContent = 'Select at least one application and one category above to see data.';
  } else if (state.groupBy === 'config') {
    // one card per category, one panel per variant inside — bars are
    // grouped by Device+config, one bar per application, so every app sits
    // right next to its peers for the same Device/config/variant.
    activeCats.forEach(cat => {
      const card = html('div', 'app-card', main);
      const heading = html('h2', null, card);
      heading.textContent = cat.label;
      const count = html('span', 'count', heading);
      count.textContent = `${activeApps.length} app${activeApps.length === 1 ? '' : 's'} · ${combos.length} config${combos.length === 1 ? '' : 's'}`;
      const variants = activeVariants();
      if (variants.length === 0) {
        const panel = html('div', 'cat-panel', card);
        groupedBarPanel(panel, combos, cat, [], () => null, APP_EMPTY_MSG, true);
      }
      variants.forEach(variant => {
        const panel = html('div', 'cat-panel', card);
        const h3 = html('h3', null, panel);
        h3.textContent = VARIANT_LABEL[variant];
        groupedBarPanel(panel, combos, cat, appSeries(ds, activeApps), appGetValue(ds, cat, variant), APP_EMPTY_MSG, true);
      });
    });
  } else if (state.groupBy === 'category') {
    // one card per category, one panel per application inside — lines up
    // the same metric across applications for direct comparison.
    activeCats.forEach(cat => {
      const card = html('div', 'app-card', main);
      const heading = html('h2', null, card);
      heading.textContent = cat.label;
      const count = html('span', 'count', heading);
      count.textContent = `${activeApps.length} app${activeApps.length === 1 ? '' : 's'} · ${combos.length} config${combos.length === 1 ? '' : 's'}`;
      activeApps.forEach(app => {
        const panel = html('div', 'cat-panel', card);
        const h3 = html('h3', null, panel);
        h3.textContent = app;
        groupedBarPanel(panel, combos, cat, variantSeries(), variantGetValue(ds.data[app], cat), VARIANT_EMPTY_MSG);
      });
    });
  } else {
    // one card per application, one panel per category inside.
    activeApps.forEach(app => {
      const card = html('div', 'app-card', main);
      const heading = html('h2', null, card);
      heading.textContent = app;
      const count = html('span', 'count', heading);
      count.textContent = `${activeCats.length} categor${activeCats.length === 1 ? 'y' : 'ies'} · ${combos.length} config${combos.length === 1 ? '' : 's'}`;
      activeCats.forEach(cat => {
        const panel = html('div', 'cat-panel', card);
        const h3 = html('h3', null, panel);
        h3.textContent = cat.label;
        groupedBarPanel(panel, combos, cat, variantSeries(), variantGetValue(ds.data[app], cat), VARIANT_EMPTY_MSG);
      });
    });
  }

  renderTable();
}

function renderTable() {
  const wrap = document.getElementById('table-wrap');
  if (wrap.classList.contains('hidden')) return;
  const ds = currentDataset();
  const combos = filteredCombos();
  const activeApps = ds.apps.filter(a => state.apps.has(a));
  const activeCats = CATEGORIES.filter(c => state.categories.has(c.key));
  const activeVariants = VARIANTS.filter(v => state.variants.has(v));

  let out = '<table class="data-table"><thead><tr><th>App</th><th>Device · size</th><th>Category</th>';
  activeVariants.forEach(v => { out += `<th>${VARIANT_LABEL[v]}</th>`; });
  out += '</tr></thead><tbody>';
  activeApps.forEach(app => {
    combos.forEach(c => {
      activeCats.forEach(cat => {
        out += `<tr><td>${app}</td><td>${c.device}·${c.size}</td><td>${cat.label}</td>`;
        activeVariants.forEach(v => {
          const val = ds.data[app][c.key][cat.field][v];
          out += `<td>${val === null || val === undefined ? '—' : cat.fmt(val)}</td>`;
        });
        out += '</tr>';
      });
    });
  });
  out += '</tbody></table>';
  wrap.innerHTML = out;
}

document.getElementById('table-toggle').addEventListener('click', () => {
  const wrap = document.getElementById('table-wrap');
  const btn = document.getElementById('table-toggle');
  const showing = !wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden');
  btn.textContent = showing ? 'Show as table' : 'Hide table';
  if (!showing) renderTable();
});

document.querySelectorAll('.controls').forEach(() => {});
document.body.addEventListener('mousemove', e => { if (tooltip.classList.contains('show')) moveTip(e); });

function renderApps() { renderAppChips(); }
