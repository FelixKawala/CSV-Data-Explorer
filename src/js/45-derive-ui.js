// define a comparison measure from the page
//
// A derived measure compares one measure between two values of one dimension:
// "Rate A, Tuned versus Base". The model has supported that since the schema
// became data (it is how the bundle's Δ measures are built); this is the form
// that lets a user declare one for an imported CSV, where nothing is hardcoded.

// A ratio and a share are the same arithmetic read two ways: 0.92 and 92%. Both
// are offered because which one belongs in a figure is a question about the
// figure, not about the numbers -- "0.92× the baseline" and "92% of the
// baseline" are not interchangeable in a caption.
const DERIVE_OPS = [
  { key: 'diff', label: 'difference (a − b)', format: 'delta' },
  { key: 'reldiff', label: 'relative change ((a − b) / b)', format: 'reldelta' },
  { key: 'share', label: 'share (a as % of b)', format: 'pct' },
  { key: 'ratio', label: 'ratio (a / b)', format: 'number' },
];

let deriveOpen = false;

function derivedMeasureLabel(op, baseLabel, aLabel, bLabel) {
  if (op === 'share') return baseLabel + ' (' + aLabel + ' as % of ' + bLabel + ')';
  if (op === 'ratio') return baseLabel + ' (' + aLabel + ' / ' + bLabel + ')';
  const sign = op === 'reldiff' ? ' vs ' : ' − ';
  return 'Δ ' + baseLabel + ' (' + aLabel + sign + bLabel + ')';
}

// A comparison only makes sense over a dimension with at least two values, and
// only for a measure that is not itself a comparison.
function derivableMeasures() { return METRICS.filter(m => !m.derived); }
function comparableDims() {
  return DS ? DS.dims.filter(d => d.values.length >= 2) : [];
}

function addDerivedMeasure(spec) {
  const base = METRIC_BY_KEY[spec.base];
  const dim = DIM_BY_KEY[spec.over];
  if (!base || !dim) return null;
  const opDef = DERIVE_OPS.find(o => o.key === spec.op) || DERIVE_OPS[0];
  const held = (spec.hold || []).filter(k => DIM_BY_KEY[k]);
  const label = spec.label || (derivedMeasureLabel(
    spec.op, base.label, dim.labelFor(spec.a), dim.labelFor(spec.b))
    // averaging over a dimension changes what the number means, so it belongs
    // in the name rather than only in the definition
    + (held.length ? ', mean over ' + held.map(k => DIM_BY_KEY[k].label).join(' & ') : ''));
  const key = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const derived = { op: spec.op, base: spec.base, over: spec.over, a: spec.a, b: spec.b };
  if (spec.hold && spec.hold.length) derived.hold = spec.hold.slice();
  return addCustomMeasure({
    key,
    label,
    format: makeFormat(opDef.format),
    derived,
  });
}

// `initial` carries the choices forward when changing the compared dimension
// forces a re-render; without it the form would silently reset to the first one.
function renderDeriveForm(host, initial) {
  host.innerHTML = '';
  const box = html('div', 'derive-form', host);
  const measures = derivableMeasures();
  const dims = comparableDims();
  if (!measures.length || !dims.length) {
    html('div', 'import-note', box).textContent =
      'A comparison needs a measure and a dimension with at least two values.';
    return;
  }

  const state = Object.assign({ op: 'diff', base: measures[0].key, over: dims[0].key, hold: [] }, initial || {});
  if (!Array.isArray(state.hold)) state.hold = [];
  if (!DIM_BY_KEY[state.over] || DIM_BY_KEY[state.over].values.length < 2) state.over = dims[0].key;
  if (!METRIC_BY_KEY[state.base] || METRIC_BY_KEY[state.base].derived) state.base = measures[0].key;
  const overValues = DIM_BY_KEY[state.over].values;
  if (overValues.indexOf(state.a) === -1) state.a = overValues[0];
  if (overValues.indexOf(state.b) === -1 || state.b === state.a) {
    state.b = overValues.find(v => v !== state.a);
  }

  const row = (labelText) => {
    const l = html('label', 'radio-row', box);
    html('span', 'derive-label', l).textContent = labelText;
    return l;
  };
  const select = (parent, options, value, onChange) => {
    const sel = document.createElement('select');
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', () => { onChange(sel.value); });
    parent.appendChild(sel);
    return sel;
  };

  const preview = html('div', 'derive-preview', null);
  const coverage = html('div', 'derive-coverage', null);
  const holdRow = html('div', 'derive-hold', null);
  // A comparison holds every dimension but the compared one fixed, so it is
  // perfectly possible to define one that can never be computed anywhere. That
  // used to be discoverable only by adding the measure and finding an empty
  // chart, so the count -- and the dimension responsible -- is shown here.
  const renderHold = (cov) => {
    holdRow.innerHTML = '';
    const others = DS.dims.filter(d => d.key !== state.over);
    if (!others.length) return;
    html('span', 'derive-label', holdRow).textContent = 'not holding fixed';
    others.forEach(d => {
      const l = html('label', 'derive-hold-item', holdRow);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-dim', d.key);
      cb.checked = state.hold.indexOf(d.key) !== -1;
      cb.title = 'Average over ' + d.label + ' instead of matching it, so the two '
        + 'sides need not agree on it.';
      cb.addEventListener('change', () => {
        state.hold = cb.checked
          ? state.hold.concat([d.key])
          : state.hold.filter(k => k !== d.key);
        refresh();
      });
      l.appendChild(cb);
      const name = html('span', null, l);
      name.textContent = d.label;
      if (cov && cov.blockers.indexOf(d.key) !== -1) {
        l.classList.add('blocker');
        name.textContent = d.label + ' ←';
      }
    });
  };
  const refresh = () => {
    const base = METRIC_BY_KEY[state.base];
    const dim = DIM_BY_KEY[state.over];
    preview.textContent = derivedMeasureLabel(state.op, base.label,
      dim.labelFor(state.a), dim.labelFor(state.b));
    const cov = derivedCoverage(DS, state);
    coverage.classList.toggle('bad', cov.both === 0);
    if (cov.both > 0) {
      coverage.textContent = 'Computable at ' + cov.both + ' point'
        + (cov.both === 1 ? '' : 's')
        + (cov.aOnly + cov.bOnly
          ? ' — ' + (cov.aOnly + cov.bOnly) + ' more have only one side and stay empty.'
          : '.');
    } else if (cov.blockers.length) {
      const one = cov.blockers.length === 1;
      coverage.textContent = 'Nothing to compare: no two rows differ only in '
        + dim.label + '. ' + cov.blockers.map(k => DIM_BY_KEY[k].label).join(' and ')
        + (one ? ' changes' : ' change') + ' with it — tick ' + (one ? 'it' : 'them')
        + ' below to average over ' + (one ? 'it' : 'them') + ' instead.';
    } else {
      coverage.textContent = 'Nothing to compare: no tuple has both '
        + dim.labelFor(state.a) + ' and ' + dim.labelFor(state.b) + '.';
    }
    renderHold(cov);
  };

  const r1 = row('Compare');
  select(r1, measures.map(m => ({ value: m.key, label: m.label })), state.base,
    v => { state.base = v; refresh(); });

  const r2 = row('across');
  const dimSel = select(r2, dims.map(d => ({ value: d.key, label: d.label })), state.over, v => {
    // the value pickers below depend on this, so rebuild carrying the rest across
    // hold is a set of dimension keys chosen against the old compared
    // dimension, so it does not carry: the new one may itself be in it
    renderDeriveForm(host, { op: state.op, base: state.base, over: v, hold: [] });
  });
  dimSel.setAttribute('data-role', 'over');

  const r3 = row('taking');
  const aSel = select(r3, DIM_BY_KEY[state.over].values.map(v => ({ value: v, label: dimValueLabel(state.over, v) })),
    state.a, v => { state.a = v; refresh(); });
  aSel.setAttribute('data-role', 'a');
  html('span', 'derive-label', r3).textContent = 'against';
  const bSel = select(r3, DIM_BY_KEY[state.over].values.map(v => ({ value: v, label: dimValueLabel(state.over, v) })),
    state.b, v => { state.b = v; refresh(); });
  bSel.setAttribute('data-role', 'b');

  const r4 = row('as');
  select(r4, DERIVE_OPS.map(o => ({ value: o.key, label: o.label })), state.op,
    v => { state.op = v; refresh(); });

  box.appendChild(holdRow);
  refresh();
  box.appendChild(preview);
  box.appendChild(coverage);
  // The same list the calculator shows. A measure defined on this page should
  // be removable from any form that defines one, not only from the one that
  // happened to create it.
  renderCustomMeasureList(box);

  const acts = html('div', 'import-actions', box);
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'btn primary'; add.textContent = 'Add measure';
  add.addEventListener('click', () => {
    if (state.a === state.b) { setStatus('Pick two different values to compare.', false); return; }
    const m = addDerivedMeasure(state);
    if (!m) return;
    deriveOpen = false;
    renderBuilder();
    setStatus('Added "' + m.label + '" — it is now in every plot\'s Data shown list.', false);
  });
  acts.appendChild(add);
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn small'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { deriveOpen = false; renderBuilder(); });
  acts.appendChild(cancel);
}
