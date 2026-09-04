// boot
//
// Two paths, and the synchronous one is load-bearing. A page built with data
// embedded (the fixture, the demo, a shared single file) must come up with its
// charts already drawn, without awaiting anything -- that is what lets the test
// suites drive it, and what makes a self-contained export behave like a picture
// rather than an app. Only when there is no embedded data do we wait on storage.

// Show a dataset on the builder.
//
// A page with nothing pinned behaves exactly as it always has: the plots are
// rebuilt and the autosave decides what they are. A page that has plots reading
// datasets of their own does not -- those were pinned deliberately, and
// throwing them away because a different dataset was opened would make "Open"
// the one control that can silently delete work. They are kept as they are, and
// only the plots that follow the page follow it.
function startWithDataset(ds) {
  const pinned = plots.some(p => p.datasetId);
  const onScreen = pinned ? serializePlots() : null;
  useDataset(ds);
  if (pinned) {
    applyConfig(onScreen);   // the same repair a saved view gets, per plot
    releaseUnusedDatasets();
  } else {
    resetPlots();
    loadAutosave();          // falls back to the default plot when nothing is stored
  }
  renderDataPanel();
  renderBuilder();
}

function bootSync() {
  if (!DATA) return false;
  startWithDataset(makeDataset(datasetSpecFromBundle(DATA)));
  showMode('builder');
  return true;
}

function bootAsync() {
  renderDataPanel();                       // empty state first, so nothing blocks
  showMode('data');
  return Promise.resolve()
    .then(() => STORE.list())
    .then(records => {
      if (!records || !records.length) return null;
      const wanted = activeDatasetId();
      const pick = records.find(r => r.id === wanted) || records[records.length - 1];
      return STORE.get(pick.id);
    })
    .then(full => {
      if (!full) return;
      startWithDataset(registerDataset(datasetFromRecord(full)));
      setActiveDatasetId(full.id);
      // The autosave may hold plots pinned to other datasets. Those are records
      // in the store, so they arrive after the first paint: the page comes up
      // as it always did and the pinned plots resolve a moment later, rather
      // than everything waiting on however many datasets were open last time.
      const missing = datasetIdsIn(plots).filter(id => !loadedDataset(id));
      renderDataPanel();
      showMode('builder');
      if (missing.length) {
        return ensureDatasetsLoaded(missing).then(() => {
          plots.forEach(p => {
            if (p.datasetId && loadedDataset(p.datasetId)) bindPlotToDataset(p, p.datasetId);
          });
          renderBuilder();
        });
      }
      return null;
    })
    .catch(e => setDataStatus('Could not restore the last dataset: ' + e.message));
}

if (!bootSync()) bootAsync();
