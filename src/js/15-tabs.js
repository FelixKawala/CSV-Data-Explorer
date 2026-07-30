// mode tab switching
function showMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  });
  document.getElementById('data-view').classList.toggle('hidden', mode !== 'data');
  document.getElementById('builder-view').classList.toggle('hidden', mode !== 'builder');
  // the Builder nests several dimensions on one axis and gets wide; the Data tab
  // is a reading column
  document.querySelector('.viz-root').classList.toggle('wide', mode === 'builder');
  if (mode === 'builder') renderBuilder();
  else if (mode === 'data') renderDataPanel();
}

document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => showMode(btn.dataset.mode));
});
