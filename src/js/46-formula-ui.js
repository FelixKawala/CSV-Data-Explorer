// the calculator: write an expression, see what it computes, add it as a measure
//
// Two things make an expression editor trustworthy rather than a guessing game.
// First, every error names the character it happened at, so "No measure called
// L2Hitrate" points at the word rather than at the whole line. Second, the
// preview evaluates against a real row of the data and shows the operands it
// used -- if the number is wrong, it is visibly wrong here rather than three
// charts later.

let formulaOpen = false;
let formulaDraft = { expr: '', name: '', format: '' };

const FORMULA_FORMAT_CHOICES = [
  ['', 'automatic'],
  ['pct', 'percentage (0–100)'],
  ['fraction', 'fraction (0–1)'],
  ['count', 'count (log axis)'],
  ['number', 'plain number'],
  ['bytes', 'bytes'],
  ['duration', 'duration'],
  ['delta', 'change in points (diverging)'],
  ['reldelta', 'relative change % (diverging)'],
];

// How a measure is written in an expression: bare when it is a single word,
// bracketed otherwise. This is also what the chips insert.
function formulaToken(m) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(m.label) ? m.label : '[' + m.label + ']';
}

// A row that actually exists, so the preview is arithmetic on real numbers.
function sampleCtx() {
  return DS && DS.nRows ? datasetCtxAtRow(DS, 0) : null;
}

function describeFormulaUnits(compiled) {
  const parts = [];
  const kind = compiled.cls === 'plain' ? 'number' : compiled.cls;
  parts.push('result: ' + kind + ', shown as ' + compiled.format.axisLabel);
  compiled.notes.forEach(n => parts.push(n));
  return parts.join(' · ');
}

function renderFormulaForm(host) {
  host.innerHTML = '';
  const box = html('div', 'derive-form formula-form', host);
  if (!hasDataset() || !METRICS.length) {
    html('div', 'import-note', box).textContent = 'Import a dataset first — a calculation needs measures to work with.';
    return;
  }

  // ---- the measures available, as clickable chips
  const palette = html('div', 'formula-palette', box);
  html('span', 'derive-label', palette).textContent = 'Insert';
  METRICS.forEach(m => {
    const chip = html('button', 'dnd-chip formula-chip', palette);
    chip.type = 'button';
    chip.textContent = m.label;
    chip.title = formulaToken(m) + ' — ' + m.format.axisLabel;
    chip.addEventListener('click', () => insertAtCursor(input, formulaToken(m)));
  });

  const r1 = html('label', 'radio-row', box);
  html('span', 'derive-label', r1).textContent = 'Calculate';
  const input = document.createElement('textarea');
  input.className = 'formula-input';
  input.id = 'formula-expr';
  input.rows = 2;
  input.spellcheck = false;
  input.placeholder = '(100% - [Rate A]) * [Count A]';
  input.value = formulaDraft.expr;
  r1.appendChild(input);

  const r2 = html('label', 'radio-row', box);
  html('span', 'derive-label', r2).textContent = 'called';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'formula-name';
  nameInput.id = 'formula-name';
  nameInput.placeholder = 'name for this measure';
  nameInput.value = formulaDraft.name;
  r2.appendChild(nameInput);

  html('span', 'derive-label', r2).textContent = 'shown as';
  const fmtSel = document.createElement('select');
  fmtSel.id = 'formula-format';
  FORMULA_FORMAT_CHOICES.forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    fmtSel.appendChild(o);
  });
  fmtSel.value = formulaDraft.format;
  r2.appendChild(fmtSel);

  const preview = html('div', 'derive-preview formula-preview', box);
  const units = html('div', 'formula-units', box);
  const acts = html('div', 'import-actions', box);
  const add = html('button', 'btn primary', acts);
  add.type = 'button';
  add.textContent = 'Add measure';
  const cancel = html('button', 'btn small', acts);
  cancel.type = 'button';
  cancel.textContent = 'Cancel';

  html('div', 'import-note', box).textContent =
    'Operators + − * / ^ and brackets; abs, min, max, clamp, sqrt, ln, log10, exp. '
    + 'A percentage like 100% is a proportion, so it works whether a rate is stored as 62.13 or as 0.6213.';

  renderCustomMeasureList(box);

  // ---- live checking
  let compiled = null;
  const check = () => {
    formulaDraft = { expr: input.value, name: nameInput.value, format: fmtSel.value };
    units.textContent = '';
    if (!input.value.trim()) {
      preview.textContent = 'Write an expression, or click a measure above to insert it.';
      preview.classList.remove('bad');
      compiled = null;
      add.disabled = true;
      return;
    }
    try {
      compiled = compileFormula(input.value, METRICS, fmtSel.value || null);
    } catch (e) {
      compiled = null;
      add.disabled = true;
      preview.classList.add('bad');
      preview.textContent = e.formula && typeof e.pos === 'number'
        ? e.message + '  (at character ' + (e.pos + 1) + ')'
        : e.message;
      return;
    }
    preview.classList.remove('bad');
    add.disabled = false;
    units.textContent = describeFormulaUnits(compiled);

    const ctx = sampleCtx();
    if (!ctx) { preview.textContent = 'Valid — no rows to preview against.'; return; }
    const get = key => {
      const m = METRIC_BY_KEY[key];
      const c = Object.assign({}, ctx);
      c[MEASURE_DIM] = key;
      const v = metricValueAt(c);
      return v === null ? null : v * ratioScale(m.format);
    };
    const raw = evalFormulaNode(compiled.ast, get);
    const value = raw === null ? null : raw * compiled.outScale;
    const where = DS.dims.map(d => d.labelFor(ctx[d.key])).join(' · ');
    const operands = compiled.refs.map(k => {
      const m = METRIC_BY_KEY[k];
      const c = Object.assign({}, ctx);
      c[MEASURE_DIM] = k;
      return m.label + ' = ' + formatValue(m.format, metricValueAt(c));
    });
    preview.textContent = 'At ' + where + ': ' + formatValue(compiled.format, value)
      + (operands.length ? '   (' + operands.join(', ') + ')' : '');
  };

  input.addEventListener('input', check);
  nameInput.addEventListener('input', check);
  fmtSel.addEventListener('change', check);
  check();

  add.addEventListener('click', () => {
    if (!compiled) { setStatus('That expression is not valid yet.', false); return; }
    const label = (nameInput.value || '').trim() || compiled.expr;
    if (METRICS.some(m => m.label === label)) {
      setStatus('There is already a measure called "' + label + '" — give this one another name.', false);
      return;
    }
    const m = addCustomMeasure({
      key: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      label,
      format: compiled.format,
      formula: compiled,
    });
    if (!m) return;
    formulaDraft = { expr: '', name: '', format: '' };
    formulaOpen = false;
    renderBuilder();
    setStatus('Added "' + m.label + '" — it is now in every plot\'s Data shown list.', false);
  });

  cancel.addEventListener('click', () => {
    formulaOpen = false;
    renderBuilder();
  });
}

// The measures defined on the page, with a way to take one back. Removing one
// that another is built on would leave the other quietly returning nothing, so
// that case names the dependants instead of doing it.
function renderCustomMeasureList(host) {
  const mine = customMeasures();
  if (!mine.length) return;
  const box = html('div', 'formula-list', host);
  html('span', 'derive-label', box).textContent = 'Defined here';
  mine.forEach(m => {
    const chip = html('span', 'dnd-chip formula-defined', box);
    const name = html('span', '', chip);
    name.textContent = m.label;
    chip.title = m.formula ? m.formula.expr : 'comparison measure';
    const x = html('button', '', chip);
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remove ' + m.label;
    x.addEventListener('click', () => {
      const r = removeCustomMeasure(m.key);
      if (r === true) {
        renderBuilder();
        setStatus('Removed "' + m.label + '".', false);
      } else if (Array.isArray(r)) {
        setStatus('"' + m.label + '" is used by ' + r.join(', ') + ' — remove those first.', false);
      }
    });
  });
}

function insertAtCursor(input, text) {
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
  // Two adjacent names would parse as one, so separate them when needed.
  const before = input.value.slice(0, start);
  const lead = before && !/[\s(,+\-*/^]$/.test(before) ? ' * ' : '';
  input.value = before + lead + text + input.value.slice(end);
  const caret = start + lead.length + text.length;
  input.focus();
  if (input.setSelectionRange) input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
