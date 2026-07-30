// boot
// init
state.apps = new Set(currentDataset().apps);
renderGroupByChips();
renderGpuChips();
renderVariantChips();
renderCategoryChips();
renderAppChips();
render();
loadAutosave();
