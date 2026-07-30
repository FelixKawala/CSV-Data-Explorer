// mode tab switching
// ================= BUILDER MODE =================

document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    document.getElementById('simple-view').classList.toggle('hidden', mode !== 'simple');
    document.getElementById('builder-view').classList.toggle('hidden', mode !== 'builder');
    document.querySelector('.viz-root').classList.toggle('wide', mode === 'builder');
    if (mode === 'builder') renderBuilder();
  });
});
