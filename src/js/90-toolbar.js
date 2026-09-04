// builder toolbar and status line
function sep() { const s = document.createElement('div'); s.className = 'toolbar-sep'; return s; }

// one-line feedback strip; carries the Undo affordance for destructive actions
function setStatus(msg, undoable) {
  const host = document.getElementById('builder-status');
  if (!host) return;
  host.innerHTML = '';
  if (!msg) return;
  html('span', null, host).textContent = msg;
  if (undoable && undoSnapshot) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button'; undoBtn.className = 'btn small'; undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      const snap = undoSnapshot;
      undoSnapshot = null;
      applyConfig(snap);
      setStatus('Restored the previous plots', false);
    });
    host.appendChild(undoBtn);
  }
}

// Side by side or stacked. Stored rather than derived: it is a choice about the
// screen it is being read on, and it should survive a reload of it.
const LS_SIDE_BY_SIDE = 'viz-side-by-side';
let sideBySideMode = null;
function sideBySide() {
  if (sideBySideMode === null) {
    try { sideBySideMode = localStorage.getItem(LS_SIDE_BY_SIDE) === '1'; } catch (e) { sideBySideMode = false; }
  }
  return sideBySideMode;
}
function setSideBySide(on) {
  sideBySideMode = !!on;
  try { localStorage.setItem(LS_SIDE_BY_SIDE, on ? '1' : '0'); } catch (e) {}
}

// Plots in a row, or stacked. Stored for the same reason as the side-by-side
// choice above: it is about the screen, not about a plot.
const LS_ROW_LAYOUT = 'viz-row-layout';
let rowLayoutMode = null;
function rowLayout() {
  if (rowLayoutMode === null) {
    try { rowLayoutMode = localStorage.getItem(LS_ROW_LAYOUT) === '1'; } catch (e) { rowLayoutMode = false; }
  }
  return rowLayoutMode;
}
function setRowLayout(on) {
  rowLayoutMode = !!on;
  try { localStorage.setItem(LS_ROW_LAYOUT, on ? '1' : '0'); } catch (e) {}
}

function renderBuilderToolbar() {
  const bar = document.getElementById('builder-toolbar');
  if (!bar) return;
  bar.innerHTML = '';

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn primary'; addBtn.textContent = '+ Add plot';
  addBtn.addEventListener('click', () => { plots.push(makeDefaultPlot()); renderPlots(); });
  bar.appendChild(addBtn);

  // Where the controls sit. Stacked, changing a grouping means scrolling down
  // to the chart to see what it did; beside it, the chart is in view the whole
  // time. It is a property of the screen rather than of a plot, so it is one
  // switch here and it is remembered.
  const sideBtn = document.createElement('button');
  sideBtn.type = 'button';
  sideBtn.className = 'btn small side-by-side-toggle';
  sideBtn.textContent = sideBySide() ? 'Controls beside the chart' : 'Controls above the chart';
  sideBtn.title = 'Put the controls in a column next to the chart, with a divider you can drag';
  sideBtn.setAttribute('aria-pressed', sideBySide() ? 'true' : 'false');
  sideBtn.addEventListener('click', () => { setSideBySide(!sideBySide()); renderBuilder(); });
  bar.appendChild(sideBtn);

  const rowBtn = document.createElement('button');
  rowBtn.type = 'button';
  rowBtn.className = 'btn small row-layout-toggle';
  rowBtn.textContent = rowLayout() ? 'Plots stacked' : 'Plots in a row';
  rowBtn.title = 'Put the plot cards side by side, wrapping into rows, instead of one below the other';
  rowBtn.setAttribute('aria-pressed', rowLayout() ? 'true' : 'false');
  rowBtn.addEventListener('click', () => { setRowLayout(!rowLayout()); renderBuilder(); });
  bar.appendChild(rowBtn);

  bar.appendChild(sep());

  const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.className = 'name-input'; nameInput.placeholder = 'View name';
  bar.appendChild(nameInput);
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn small'; saveBtn.textContent = 'Save view';
  saveBtn.title = 'Save the current plots under the name on the left';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { setStatus('Type a name first, or use Overwrite to update the selected view.', false); return; }
    const existed = Object.prototype.hasOwnProperty.call(readNamedViews(), name);
    saveNamedView(name);
    nameInput.value = '';
    refreshSavedViewsSelect();
    const select = document.getElementById('saved-views-select');
    if (select) select.value = name;
    setStatus((existed ? 'Overwrote' : 'Saved') + ' "' + name + '" (' + plots.length + ' plot' + (plots.length === 1 ? '' : 's') + ')', false);
  });
  bar.appendChild(saveBtn);

  const overwriteBtn = document.createElement('button'); overwriteBtn.type = 'button'; overwriteBtn.className = 'btn small'; overwriteBtn.textContent = 'Overwrite';
  overwriteBtn.title = 'Replace the selected saved view with the plots currently on the page';
  overwriteBtn.addEventListener('click', () => {
    const select = document.getElementById('saved-views-select');
    const name = select && select.value;
    if (!name || !readNamedViews()[name]) { setStatus('No saved view selected to overwrite.', false); return; }
    saveNamedView(name);
    setStatus('Overwrote "' + name + '" (' + plots.length + ' plot' + (plots.length === 1 ? '' : 's') + ')', false);
  });
  bar.appendChild(overwriteBtn);

  const viewSelect = document.createElement('select'); viewSelect.className = 'view-select'; viewSelect.id = 'saved-views-select';
  bar.appendChild(viewSelect);
  const loadBtn = document.createElement('button'); loadBtn.type = 'button'; loadBtn.className = 'btn small'; loadBtn.textContent = 'Load';
  loadBtn.title = 'Replace every plot on the page with this view';
  loadBtn.addEventListener('click', () => {
    const name = viewSelect.value;
    if (!name || !readNamedViews()[name]) return;
    const replaced = plots.length;
    undoSnapshot = serializePlots();
    // A view of one dataset lands synchronously, exactly as before. Only a view
    // holding plots pinned to datasets that are not in memory waits, and only
    // for those.
    loadNamedView(name);
    setStatus('Loaded "' + name + '"' + (replaced > 1 ? ' — replaced ' + replaced + ' plots' : ''), true);
  });
  bar.appendChild(loadBtn);
  const appendBtn = document.createElement('button'); appendBtn.type = 'button'; appendBtn.className = 'btn small'; appendBtn.textContent = 'Add';
  appendBtn.title = 'Append this view\'s plots below the ones already on the page';
  appendBtn.addEventListener('click', () => {
    const name = viewSelect.value;
    if (!name || !readNamedViews()[name]) return;
    appendNamedView(name);
    setStatus('Added "' + name + '" below the existing plots', false);
  });
  bar.appendChild(appendBtn);
  const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'btn small danger'; delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    const name = viewSelect.value;
    if (!name || !readNamedViews()[name]) return;
    deleteNamedView(name);
    refreshSavedViewsSelect();
    setStatus('Deleted "' + name + '"', false);
  });
  bar.appendChild(delBtn);
  bar.appendChild(sep());

  const exportBtn = document.createElement('button'); exportBtn.type = 'button'; exportBtn.className = 'btn small'; exportBtn.textContent = 'Export JSON';
  exportBtn.addEventListener('click', exportCurrentConfig);
  bar.appendChild(exportBtn);

  const importLabel = document.createElement('label'); importLabel.className = 'btn small'; importLabel.style.cursor = 'pointer'; importLabel.textContent = 'Import JSON';
  const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = 'application/json'; importInput.style.display = 'none';
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(reader.result);
        const replaced = plots.length;
        undoSnapshot = serializePlots();
        loadConfig(cfg);
        setStatus('Imported "' + file.name + '"' + (replaced > 1 ? ' — replaced ' + replaced + ' plots' : ''), true);
      }
      catch (err) { alert('Could not read that file as a saved view.'); }
    };
    reader.readAsText(file);
    importInput.value = '';
  });
  importLabel.appendChild(importInput);
  bar.appendChild(importLabel);

  const deriveBtn = document.createElement('button');
  deriveBtn.type = 'button'; deriveBtn.className = 'btn small'; deriveBtn.id = 'derive-toggle';
  deriveBtn.textContent = deriveOpen ? 'Close comparison' : '+ Comparison measure';
  deriveBtn.title = 'Define a measure that compares another one across two values of a dimension';
  deriveBtn.addEventListener('click', () => {
    deriveOpen = !deriveOpen;
    if (deriveOpen) { formulaOpen = false; measuresOpen = false; }
    renderBuilder();
  });
  bar.appendChild(deriveBtn);

  const calcBtn = document.createElement('button');
  calcBtn.type = 'button'; calcBtn.className = 'btn small'; calcBtn.id = 'formula-toggle';
  calcBtn.textContent = formulaOpen ? 'Close calculator' : '+ Calculated measure';
  calcBtn.title = 'Define a measure as arithmetic over the existing ones';
  calcBtn.addEventListener('click', () => {
    formulaOpen = !formulaOpen;
    if (formulaOpen) { deriveOpen = false; measuresOpen = false; }
    renderBuilder();
  });
  bar.appendChild(calcBtn);

  const editBtn = document.createElement('button');
  editBtn.type = 'button'; editBtn.className = 'btn small'; editBtn.id = 'measures-toggle';
  editBtn.textContent = measuresOpen ? 'Close measures' : 'Rename / retype measures';
  editBtn.title = 'Change what a measure is called and what kind of quantity it is';
  editBtn.addEventListener('click', () => {
    measuresOpen = !measuresOpen;
    if (measuresOpen) { deriveOpen = false; formulaOpen = false; }
    renderBuilder();
  });
  bar.appendChild(editBtn);

  const status = html('div', 'builder-status', bar);
  status.id = 'builder-status';

  if (deriveOpen) {
    const holder = html('div', 'derive-holder', bar);
    renderDeriveForm(holder);
  }
  if (formulaOpen) {
    const holder = html('div', 'derive-holder', bar);
    holder.id = 'formula-holder';
    renderFormulaForm(holder);
  }
  if (measuresOpen) {
    const holder = html('div', 'derive-holder', bar);
    holder.id = 'measures-holder';
    renderMeasureForm(holder);
  }

  refreshSavedViewsSelect();
}

function renderBuilder() {
  renderBuilderToolbar();
  renderPlots();
}
