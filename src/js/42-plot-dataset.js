// which dataset a plot reads
//
// A plot follows the page unless it is told not to. Telling it not to is this
// file: a select in the plot head, and a button on each stored dataset that
// adds a plot already pinned to it. Two datasets on one page is that button
// pressed twice.
//
// Binding is not a re-derivation. A plot pointed at other data goes through
// exactly the path a saved view goes through -- serialise, then restore against
// the new dataset -- so a dimension both datasets have keeps its zone and its
// filters, and only what the new one has not got falls away. That path is well
// worn, and it is undoable, which is what makes this safe to try.

function plotDatasetOptions(plot) {
  const out = [['', 'follow the page dataset']];
  LOADED.forEach((ds, id) => { out.push([id, ds.name]); });
  // A plot may name a dataset that is not in memory -- deleted, or simply not
  // loaded yet. It still says which, or the select would silently read as
  // "follow the page" while the card says otherwise.
  if (plotDatasetMissing(plot)) {
    out.push([plot.datasetId, (plot.datasetName || 'a dataset that is gone') + ' (not loaded)']);
  }
  return out;
}

// The plot, repaired against the dataset it now reads. Its id is kept so the
// card it is drawn in is the same card, and its place in the list so it does
// not jump while you are looking at it.
function bindPlotToDataset(plot, datasetId) {
  const idx = plots.indexOf(plot);
  if (idx === -1) return plot;
  const snap = serializePlots()[idx];
  if (datasetId) {
    snap.datasetId = datasetId;
    snap.datasetName = (loadedDataset(datasetId) || {}).name || plot.datasetName || null;
  } else {
    delete snap.datasetId;
    delete snap.datasetName;
  }
  const next = deserializePlots([snap])[0];
  next.id = plot.id;
  plots[idx] = next;
  releaseUnusedDatasets();
  return next;
}

function renderPlotDatasetPicker(head, plot, rerender) {
  const opts = plotDatasetOptions(plot);
  const missing = plotDatasetMissing(plot);
  // One dataset in memory and nothing pinned is the ordinary case, and a select
  // with one option in it is furniture.
  if (opts.length < 2 && !plot.datasetId) return;

  const sel = document.createElement('select');
  sel.className = 'plot-dataset';
  sel.setAttribute('data-plot', plot.id);
  sel.title = 'Which dataset this plot reads';
  opts.forEach(pair => {
    const o = document.createElement('option');
    o.value = pair[0]; o.textContent = pair[1];
    sel.appendChild(o);
  });
  sel.value = plot.datasetId || '';
  // Deliberately NOT bound to this plot's dataset, unlike the other controls on
  // the card. Binding is for a handler whose work stays inside one plot; this
  // one redraws the page, and every other card has to be drawn under its own
  // dataset. Bound, it would render all of them under this one's -- which is
  // the very thing the binding exists to prevent.
  sel.addEventListener('change', () => {
    // The largest change a control on a card can make: every zone and every
    // filter is re-decided against other data. Snapshot first, same as a drag.
    undoSnapshot = serializePlots();
    const next = bindPlotToDataset(plot, sel.value || null);
    renderPlots();
    setStatus('Plot ' + (plots.indexOf(next) + 1) + ' now reads '
      + (sel.value ? '"' + plotDatasetName(next) + '"' : 'the page dataset') + '.', true);
  });
  head.appendChild(sel);

  if (missing) {
    const note = html('span', 'plot-dataset-missing', head);
    note.textContent = 'reading the page dataset — "'
      + (plot.datasetName || 'the one it was made on') + '" is not loaded';
    const load = document.createElement('button');
    load.type = 'button'; load.className = 'btn small ghost';
    load.textContent = 'Load it';
    load.addEventListener('click', () => {
      ensureDatasetsLoaded([plot.datasetId]).then(() => {
        if (!loadedDataset(plot.datasetId)) {
          setStatus('"' + (plot.datasetName || 'That dataset') + '" is not stored any more.', false);
          return;
        }
        bindPlotToDataset(plot, plot.datasetId);
        renderPlots();
      });
    });
    note.appendChild(load);
  }
}

// A plot of a dataset that is not the one on screen. The dataset is loaded
// first, because a plot cannot be drawn from a record: rendering is synchronous
// and reading the store is not.
function addPlotFromDataset(id) {
  return ensureDatasetsLoaded([id]).then(() => {
    const ds = loadedDataset(id);
    if (!ds) {
      setDataStatus('Could not read that dataset.');
      renderDataPanel();
      return;
    }
    // With nothing open at all, this is simply how you open something -- a page
    // whose only plot is pinned and whose toolbar acts on nothing would be a
    // strange thing to hand someone.
    if (!hasDataset()) {
      setActiveDatasetId(id);
      startWithDataset(ds);
      showMode('builder');
      setDataStatus('');
      return;
    }
    plots.push(makeDefaultPlot(id));
    renderPlots();
    showMode('builder');
    setStatus('Added a plot reading "' + ds.name + '". The rest of the page is unchanged.', false);
  }).catch(e => {
    setDataStatus('Could not read that dataset: ' + e.message);
    renderDataPanel();
  });
}
