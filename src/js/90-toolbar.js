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

function renderBuilderToolbar() {
  const bar = document.getElementById('builder-toolbar');
  if (!bar) return;
  bar.innerHTML = '';

  const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn primary'; addBtn.textContent = '+ Add plot';
  addBtn.addEventListener('click', () => { plots.push(makeDefaultPlot()); renderPlots(); });
  bar.appendChild(addBtn);
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
        applyConfig(cfg);
        setStatus('Imported "' + file.name + '"' + (replaced > 1 ? ' — replaced ' + replaced + ' plots' : ''), true);
      }
      catch (err) { alert('Could not read that file as a saved view.'); }
    };
    reader.readAsText(file);
    importInput.value = '';
  });
  importLabel.appendChild(importInput);
  bar.appendChild(importLabel);

  const status = html('div', 'builder-status', bar);
  status.id = 'builder-status';

  refreshSavedViewsSelect();
}

function renderBuilder() {
  renderBuilderToolbar();
  renderPlots();
}
