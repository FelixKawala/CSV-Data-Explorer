// boot
//
// Two paths, and the synchronous one is load-bearing. A page built with data
// embedded (the fixture, the demo, a shared single file) must come up with its
// charts already drawn, without awaiting anything -- that is what lets the test
// suites drive it, and what makes a self-contained export behave like a picture
// rather than an app. Only when there is no embedded data do we wait on storage.

function startWithDataset(ds) {
  useDataset(ds);
  resetPlots();
  loadAutosave();          // falls back to the default plot when nothing is stored
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
      startWithDataset(datasetFromRecord(full));
      setActiveDatasetId(full.id);
      renderDataPanel();
      showMode('builder');
    })
    .catch(e => setDataStatus('Could not restore the last dataset: ' + e.message));
}

if (!bootSync()) bootAsync();
