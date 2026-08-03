// download, the source panel, export buttons
// A download from a sandboxed page can be blocked without raising, so the source is
// always shown as well: the panel is the reliable path, the download is the
// convenience. This is where an export "goes".
function downloadText(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    return false;
  }
}

// parts: [{name, text, kind}] - the panel is the reliable delivery path, the
// download button is the convenience on top of it.
function showTexPanel(parts, note) {
  const old = document.getElementById('tex-modal');
  if (old) old.remove();
  const back = html('div', 'tex-modal', document.querySelector('.viz-root') || document.body);
  back.id = 'tex-modal';
  const card = html('div', 'tex-card', back);
  const head = html('div', 'tex-head', card);
  const nameEl = html('span', 'tex-name', head);

  let active = 0;
  const tabs = html('div', 'tex-tabs', card);
  const area = document.createElement('textarea');
  area.className = 'tex-source';
  area.readOnly = true;
  const noteEl = html('div', 'tex-note', null);

  function show(i) {
    active = i;
    nameEl.textContent = parts[i].name;
    area.value = parts[i].text;
    Array.prototype.forEach.call(tabs.children, (b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    noteEl.textContent = parts[i].text.split('\n').length + ' lines'
      + (note ? ' — ' + note : '') + ' — select all and copy, or use Download.';
    try { area.focus(); area.select(); } catch (e) {}
  }

  parts.forEach((p, i) => {
    const b = document.createElement('button');
    // The tab says what the thing IS; the filename is what it downloads as.
    // "plot-1.tex" next to "plot-1-pgfplots.tex" made the reader work out the
    // difference from a suffix.
    b.type = 'button'; b.className = 'tex-tab'; b.textContent = p.tab || p.name;
    b.title = p.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => show(i));
    tabs.appendChild(b);
  });
  if (parts.length < 2) tabs.style.display = 'none';

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button'; dlBtn.className = 'btn small primary'; dlBtn.textContent = 'Download';
  dlBtn.addEventListener('click', () => {
    const okDl = downloadText(parts[active].name, parts[active].text);
    noteEl.textContent = okDl
      ? 'Sent to your browser\'s downloads. If nothing arrived, this page is sandboxed — copy the source below instead.'
      : 'This browser refused the download. Copy the source below instead.';
  });
  head.appendChild(dlBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 'btn small'; copyBtn.textContent = 'Select all';
  copyBtn.addEventListener('click', () => { area.focus(); area.select(); });
  head.appendChild(copyBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'btn small'; closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => back.remove());
  head.appendChild(closeBtn);

  card.appendChild(area);
  card.appendChild(noteEl);
  show(0);

  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', esc); }
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'figure';
}

// `root` is whatever subtree the button sits on: one chart, one panel, one facet
// card, or the whole plot.
function addTikzButton(host, getRoot, label, name, cls) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls || 'btn small';
  btn.textContent = label;
  btn.title = 'Export this as TikZ source (.tex)';
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const root = getRoot();
    const tex = buildTikzDocument(root, window, name);
    if (!tex) { setStatus('Nothing to export here yet.', false); return; }
    const base = slugify(name);
    const parts = [{ name: base + '.tex', text: tex, tab: 'TikZ (drawn)' }];
    const pgf = buildPgfplotsDocument(root, name, base, window);
    if (pgf) {
      if (pgf.tex) parts.push({ name: base + '-pgfplots.tex', text: pgf.tex, tab: 'pgfplots (reads the .csv)' });
      // one .csv per chart when a plot holds several, and then the filename is
      // the only thing that tells them apart
      const many = pgf.files.length > 1;
      pgf.files.forEach(f => parts.push(Object.assign({ tab: many ? f.name : 'the .csv' }, f)));
    }
    // The files as imported, for a paper that wants to ship its inputs. They
    // are NOT what the pgfplots figure reads: what is plotted has been
    // filtered, aggregated and had its derived measures computed, and often
    // exists as no column in any of these.
    const src = (DS && DS.sources) || [];
    src.forEach(s => parts.push({ name: s.name, text: s.text, tab: 'imported: ' + s.name }));
    showTexPanel(parts, pgf
      ? 'TikZ redraws the figure; pgfplots plots the exported .csv'
        + (src.length ? '; the imported files are here too, unchanged' : '')
      : null);
    setStatus('Export ready — ' + base + '.tex', false);
  });
  host.appendChild(btn);
  addImageButtons(host, getRoot, name, cls);
  return btn;
}
