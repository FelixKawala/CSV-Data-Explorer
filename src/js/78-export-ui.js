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

// The .csv a figure reads is named in the .tex that reads it, so renaming one
// without the other produces a document that compiles to a missing-file error.
// Every reference is rewritten with the name, which is the only thing that makes
// the field safe to offer at all.
function renameExportPart(parts, i, next) {
  const from = parts[i].name;
  const to = String(next || '').trim();
  if (!to || to === from) return false;
  parts[i].name = to;
  if (!/\.csv$/i.test(from)) return true;      // a .tex is referenced by nothing
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  parts.forEach((p, j) => {
    if (j === i || p.kind === 'csv' || p.kind === 'source') return;
    p.text = p.text.replace(re, to);
  });
  return true;
}

// parts: [{name, text, kind, tab, row}] - the panel is the reliable delivery
// path, the download button is the convenience on top of it. `row: 2` puts a
// part on a second tab row: the imported files are a different kind of thing
// from the figure and its data, and eight of them crowded out the three that
// most visits are here for.
function showTexPanel(parts, note) {
  const old = document.getElementById('tex-modal');
  if (old) old.remove();
  const back = html('div', 'tex-modal', document.querySelector('.viz-root') || document.body);
  back.id = 'tex-modal';
  const card = html('div', 'tex-card', back);
  const head = html('div', 'tex-head', card);
  const nameEl = document.createElement('input');
  nameEl.type = 'text';
  nameEl.className = 'tex-name';
  nameEl.id = 'tex-filename';
  nameEl.spellcheck = false;
  nameEl.title = 'The filename this downloads as. Renaming a .csv renames it in the'
    + ' figure that reads it.';
  head.appendChild(nameEl);

  let active = 0;
  const tabs = html('div', 'tex-tabs', card);
  const extra = html('div', 'tex-tabs tex-tabs-extra', card);
  const buttons = [];
  const area = document.createElement('textarea');
  area.className = 'tex-source';
  area.readOnly = true;
  const noteEl = html('div', 'tex-note', null);

  function label(i) {
    return parts[i].tab || parts[i].name;
  }
  function show(i) {
    active = i;
    nameEl.value = parts[i].name;
    area.value = parts[i].text;
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    noteEl.textContent = parts[i].text.split('\n').length + ' lines'
      + (note ? ' — ' + note : '') + ' — select all and copy, or use Download.';
    try { area.focus(); area.select(); } catch (e) {}
  }

  nameEl.addEventListener('change', () => {
    const was = parts[active].name;
    if (!renameExportPart(parts, active, nameEl.value)) { nameEl.value = was; return; }
    buttons.forEach((b, j) => { b.title = parts[j].name; b.textContent = label(j); });
    area.value = parts[active].text;
    noteEl.textContent = /\.csv$/i.test(parts[active].name)
      ? 'Renamed to ' + parts[active].name + ' — the figures that read it now say so too.'
      : 'It will download as ' + parts[active].name + '.';
  });

  parts.forEach((p, i) => {
    const b = document.createElement('button');
    // The tab says what the thing IS; the filename is what it downloads as.
    // "plot-1.tex" next to "plot-1-pgfplots.tex" made the reader work out the
    // difference from a suffix.
    b.type = 'button'; b.className = 'tex-tab'; b.textContent = label(i);
    b.title = p.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => show(i));
    (p.row === 2 ? extra : tabs).appendChild(b);
    buttons.push(b);
  });
  if (parts.length < 2) tabs.style.display = 'none';
  if (!extra.children.length) extra.style.display = 'none';

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
  // Every one of these buttons is built during a render -- there are six call
  // sites, all inside one -- and clicked long afterwards. What it exports is
  // decided then: the dimension labels for the .csv header and the imported
  // files below it both come from the live schema. Binding at creation is what
  // makes a button on a chart export that chart's data rather than the page's.
  btn.addEventListener('click', bindDataset(e => {
    e.preventDefault(); e.stopPropagation();
    const root = getRoot();
    const tex = buildTikzDocument(root, window, name);
    if (!tex) { setStatus('Nothing to export here yet.', false); return; }
    const base = slugify(name);
    const parts = [{ name: base + '.tex', text: tex, tab: 'TikZ (drawn)', kind: 'tex' }];
    const pgf = buildPgfplotsDocument(root, name, base, window);
    if (pgf) {
      if (pgf.tex) parts.push({ name: base + '-pgfplots.tex', text: pgf.tex, tab: 'pgfplots (reads the .csv)', kind: 'tex' });
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
    src.forEach(s => parts.push({
      name: s.name, text: s.text, tab: 'imported: ' + s.name, kind: 'source', row: 2,
    }));
    showTexPanel(parts, pgf
      ? 'TikZ redraws the figure; pgfplots plots the exported .csv'
        + (src.length ? '; the imported files are on the row below, unchanged' : '')
      : null);
    setStatus('Export ready — ' + base + '.tex', false);
  }));
  host.appendChild(btn);
  addImageButtons(host, getRoot, name, cls);
  return btn;
}
