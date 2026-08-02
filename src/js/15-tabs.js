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


// ---- light / dark -----------------------------------------------------------
// The stylesheet has always supported a `data-theme` attribute on <html>; there
// was simply nothing to set it, so the page could only ever follow the system.
// Auto keeps doing that -- the attribute is removed rather than pinned, so a
// machine that switches at sunset still switches.
const LS_THEME = 'viz-theme';
const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
}
function currentTheme() {
  try { return localStorage.getItem(LS_THEME) || 'auto'; } catch (e) { return 'auto'; }
}
function setTheme(mode) {
  applyTheme(mode);
  try { localStorage.setItem(LS_THEME, mode); } catch (e) { /* private mode */ }
}

function renderThemeToggle() {
  const host = document.getElementById('mode-tabs');
  if (!host || document.getElementById('theme-toggle')) return;
  const wrap = html('div', 'theme-toggle', host);
  wrap.id = 'theme-toggle';
  const cur = currentTheme();
  THEMES.forEach(([key, label]) => {
    const b = html('button', 'theme-btn' + (key === cur ? ' on' : ''), wrap);
    b.type = 'button';
    b.setAttribute('data-theme-choice', key);
    b.setAttribute('aria-pressed', key === cur ? 'true' : 'false');
    b.textContent = label;
    b.addEventListener('click', () => {
      setTheme(key);
      wrap.querySelectorAll('.theme-btn').forEach(o => {
        const on = o.getAttribute('data-theme-choice') === key;
        o.classList.toggle('on', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });
}

applyTheme(currentTheme());
renderThemeToggle();
