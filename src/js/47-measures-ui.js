// rename a measure and change what kind of thing it is
//
// A CSV column arrives named whatever the file called it -- `2080c512kbkMemAcc`,
// or `ratioL1` -- and typed by a guess from the numbers in it. Neither survives
// contact with a figure caption, and the guess is wrong often enough to matter:
// a column of 0..100 that is not a percentage, a duration read as a plain
// number. Both are presentation, not data, so both are editable here and the
// change is stored as a difference from what the recipe declared.
//
// Changing the format is the more consequential edit: it decides the units on
// the axis, whether the scale is logarithmic, and -- through axisGroup -- which
// other measures this one is allowed to share a y-axis with. That last one is
// why this sits next to the comparison and calculator forms rather than being
// buried in the import review: it is a plotting decision as much as an import one.

let measuresOpen = false;

// Removing a measure another one is built on would leave that other quietly
// returning nothing, so that case names the dependants instead of doing it.
// Shared by every list that shows a user-defined measure.
function addMeasureRemoveButton(host, m) {
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'btn small danger measure-remove';
  x.textContent = 'Remove';
  x.setAttribute('data-measure', m.key);
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
  host.appendChild(x);
  return x;
}

// Only the presets a measure can sensibly be retyped as. `fraction` is offered
// because a 0..1 column read as `number` is the commonest wrong guess after
// `pct`, and the two differ only in where the hundred goes.
const MEASURE_FORMAT_CHOICES = [
  ['pct', 'percentage (0–100)'],
  ['fraction', 'fraction (0–1)'],
  ['count', 'count (log scale)'],
  ['number', 'plain number'],
  ['duration', 'duration (seconds)'],
  ['bytes', 'bytes'],
  ['delta', 'change in points'],
  ['reldelta', 'relative change %'],
];

// Which measures would end up sharing an axis with this one, said in the form
// so the consequence of a retype is visible before it is made.
function measuresSharingAxis(m) {
  return METRICS.filter(o => o.key !== m.key && sameAxis(o.format, m.format))
    .map(o => o.label);
}

function renderMeasureForm(host) {
  host.innerHTML = '';
  const box = html('div', 'derive-form measure-form', host);
  if (!METRICS.length) {
    html('div', 'import-note', box).textContent = 'No measures to edit yet.';
    return;
  }
  html('div', 'import-note', box).textContent =
    'The name is what every axis, legend and chip reads. The kind decides the '
    + 'units, the scale, and which other measures may share a y-axis with it.';

  const list = html('div', 'measure-list', box);
  METRICS.forEach(m => {
    const r = html('div', 'measure-row', list);
    r.setAttribute('data-measure', m.key);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'name-input measure-name';
    name.value = m.label;
    name.setAttribute('data-measure', m.key);
    // on change, not on input: renaming re-renders every plot, and doing that
    // per keystroke would fight the caret
    name.addEventListener('change', () => {
      if (!name.value.trim()) { name.value = m.label; return; }
      editMeasure(m.key, { label: name.value });
      renderBuilder();
      setStatus('Renamed to "' + m.label + '"', false);
    });
    r.appendChild(name);

    const sel = document.createElement('select');
    sel.className = 'measure-format';
    sel.setAttribute('data-measure', m.key);
    const choices = MEASURE_FORMAT_CHOICES.slice();
    if (!choices.some(c => c[0] === m.format.key)) choices.push([m.format.key, m.format.key]);
    choices.forEach(c => {
      const o = document.createElement('option');
      o.value = c[0]; o.textContent = c[1];
      sel.appendChild(o);
    });
    sel.value = m.format.key;
    // A comparison's format is decided by the operation that defines it --
    // a difference is in points, a relative change is a percentage -- so it is
    // shown but not editable, rather than silently ignoring the change.
    if (m.derived) {
      sel.disabled = true;
      sel.title = 'A comparison is typed by its operation.';
    }
    sel.addEventListener('change', () => {
      editMeasure(m.key, { format: sel.value });
      renderBuilder();
      setStatus('"' + m.label + '" is now ' + axisLabelOf(m.format), false);
    });
    r.appendChild(sel);

    const shares = measuresSharingAxis(m);
    const note = html('span', 'measure-note', r);
    note.textContent = shares.length
      ? 'shares an axis with ' + (shares.length > 2
        ? shares.slice(0, 2).join(', ') + ' +' + (shares.length - 2)
        : shares.join(', '))
      : 'its own axis';
    if (shares.length) note.title = shares.join(', ');

    if (m.userDefined) {
      const tag = html('span', 'role-badge', r);
      tag.textContent = m.derived ? 'comparison' : 'calculated';
      // A measure defined on the page can be taken back from wherever it is
      // listed, not only from the form that happened to create it.
      addMeasureRemoveButton(r, m);
    }
  });

  const acts = html('div', 'import-actions', box);
  const done = document.createElement('button');
  done.type = 'button'; done.className = 'btn primary'; done.textContent = 'Done';
  done.addEventListener('click', () => { measuresOpen = false; renderBuilder(); });
  acts.appendChild(done);
}
