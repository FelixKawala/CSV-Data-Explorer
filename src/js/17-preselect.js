// Preselecting what an import reads
//
// Before any column is profiled or any pattern written, the user can say which
// rows and columns of each file should come in at all. Everything is selected
// by default and the panel is folded away; expanded, a virtualised grid shows
// the file as it was read, and dragging across the row numbers or the column
// headers includes or excludes a band -- the gesture's polarity comes from the
// cell it starts on, so dragging across what is selected takes it out and
// dragging across what is missing puts it back.
//
// The selection is kept as an ordered list of inclusive [lo, hi] row intervals
// plus one boolean per column: a file can have arbitrarily many rows, so a flag
// per row would not scale, while there are rarely more than a few dozen columns.
// The grid renders only the rows in view, so a hundred thousand rows cost no
// more than a hundred.

const PG_ROW_H = 24, PG_COL_W = 130, PG_HEAD_H = 28, PG_GUT_W = 56, PG_VIEW_H = 300;

// ---- the selection itself ---------------------------------------------------

function defaultSelection(nRows, nCols) {
  return {
    total: nRows,
    rows: nRows > 0 ? [[0, nRows - 1]] : [],
    cols: Array.from({ length: nCols }, () => true),
  };
}

function selectionIsDefault(sel, raw) {
  if (!sel || sel.cols.length !== raw.header.length || sel.cols.some(c => !c)) return false;
  if (!raw.rows.length) return sel.rows.length === 0;
  return sel.rows.length === 1 && sel.rows[0][0] === 0 && sel.rows[0][1] === raw.rows.length - 1;
}

function rowSelected(sel, i) {
  return sel.rows.some(r => i >= r[0] && i <= r[1]);
}

function selRowCount(sel) {
  let n = 0;
  sel.rows.forEach(r => { n += r[1] - r[0] + 1; });
  return n;
}

function colSelected(sel, i) { return !!sel.cols[i]; }

function selColCount(sel) {
  let n = 0;
  sel.cols.forEach(c => { if (c) n++; });
  return n;
}

// Set every row in [lo, hi] selected (on) or not (off), keeping the interval
// list ordered and disjoint. On is a union that also merges touching intervals;
// off is a subtraction that splits them.
function setRowRange(sel, lo, hi, on) {
  lo = Math.max(0, Math.min(lo, sel.total - 1));
  hi = Math.max(0, Math.min(hi, sel.total - 1));
  if (lo > hi) return;
  if (on) {
    let merged = null;
    const out = [];
    sel.rows.forEach(r => {
      if (r[1] < lo - 1) { out.push(r); return; }
      if (r[0] > hi + 1) {
        if (!merged) { merged = [lo, hi]; out.push(merged); }
        out.push(r);
        return;
      }
      if (!merged) merged = [Math.min(lo, r[0]), Math.max(hi, r[1])];
      else merged = [Math.min(merged[0], r[0]), Math.max(merged[1], r[1])];
    });
    if (!merged) merged = [lo, hi];
    out.push(merged);
    sel.rows = out;
  } else {
    const out = [];
    sel.rows.forEach(r => {
      if (r[1] < lo || r[0] > hi) { out.push(r); return; }
      if (r[0] < lo) out.push([r[0], lo - 1]);
      if (r[1] > hi) out.push([hi + 1, r[1]]);
    });
    sel.rows = out;
  }
}

function setColRange(sel, lo, hi, on) {
  lo = Math.max(0, lo);
  hi = Math.min(sel.cols.length - 1, hi);
  for (let i = lo; i <= hi; i++) sel.cols[i] = on;
}

// The file as the import will read it: the selected rows, the selected columns
// only. Row arrays are shared with the original; nothing downstream mutates them.
function applySelection(raw, sel) {
  const keep = [];
  raw.header.forEach((h, i) => { if (sel.cols[i]) keep.push(i); });
  const allCols = keep.length === raw.header.length;
  const header = allCols ? raw.header : keep.map(i => raw.header[i]);
  const rows = [];
  sel.rows.forEach(([lo, hi]) => {
    for (let i = lo; i <= hi; i++) {
      const r = raw.rows[i];
      if (r === undefined) continue;
      rows.push(allCols ? r : keep.map(k => r[k]));
    }
  });
  return { header, rows, comments: raw.comments, delimiter: raw.delimiter, ragged: [] };
}

function pgNum(n) { return n.toLocaleString('en-US'); }

// "all 12,345 rows · all 32 columns" or the precise counts where not all are in.
function selectionSummary(sel) {
  const rows = selRowCount(sel), cols = selColCount(sel);
  return (rows === sel.total ? 'all ' + pgNum(rows) + ' rows' : pgNum(rows) + ' of ' + pgNum(sel.total) + ' rows')
    + ' · '
    + (cols === sel.cols.length ? 'all ' + pgNum(cols) + ' columns' : pgNum(cols) + ' of ' + pgNum(sel.cols.length) + ' columns');
}

// ---- the grid ---------------------------------------------------------------
// One scrolling pane. The header row is sticky at the top, the row-number
// gutter cells stick to the left, and only the rows inside the viewport exist
// in the DOM -- the pane's height is what scrolls, not its children.
function renderPreselectGrid(host, o) {
  const raw = o.raw, sel = o.sel;
  const nCols = raw.header.length, nRows = raw.rows.length;
  const contentW = PG_GUT_W + nCols * PG_COL_W;
  const contentH = PG_HEAD_H + nRows * PG_ROW_H;

  const scroller = html('div', 'preselect-grid pg-scroll', host);
  const inner = html('div', 'pg-inner', scroller);
  inner.style.width = contentW + 'px';
  inner.style.height = contentH + 'px';

  const head = html('div', 'pg-head', inner);
  const corner = html('div', 'pg-corner', head);
  corner.textContent = '#';
  raw.header.forEach((h, i) => {
    const c = html('div', 'pg-col' + (sel.cols[i] ? '' : ' off'), head);
    c.setAttribute('data-col', i);
    c.textContent = h;
    c.title = h;
  });

  const paint = () => {
    Array.from(inner.querySelectorAll('.pg-row')).forEach(r => r.remove());
    const top = Math.max(0, scroller.scrollTop - PG_HEAD_H);
    const first = Math.floor(top / PG_ROW_H);
    const last = Math.min(nRows, first + Math.ceil(PG_VIEW_H / PG_ROW_H) + 2);
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const rowOff = !rowSelected(sel, i);
      const row = html('div', 'pg-row' + (rowOff ? ' off' : ''), null);
      row.style.top = (PG_HEAD_H + i * PG_ROW_H) + 'px';
      row.setAttribute('data-row', i);
      // The row's own state dims every cell in it, on top of whatever the
      // columns say: an unselected row has to look unselected, not just be one.
      const g = html('div', 'pg-gut' + (rowOff ? ' off' : ''), row);
      g.textContent = i + 1;
      const cells = raw.rows[i] || [];
      for (let c = 0; c < nCols; c++) {
        const cell = html('div', 'pg-cell' + (rowOff || !sel.cols[c] ? ' off' : ''), row);
        cell.textContent = cells[c];
      }
      frag.appendChild(row);
    }
    inner.appendChild(frag);
  };
  scroller.addEventListener('scroll', paint);
  paint();
  if (o.initial) {
    scroller.scrollTop = o.initial.top;
    scroller.scrollLeft = o.initial.left;
  }

  // The band drag. Which cell the gesture starts on decides its polarity: grab
  // a selected row and you are removing a band, grab an empty one and you are
  // adding it. Row indices come from geometry rather than from the hovered
  // element, so the band keeps working while auto-scroll moves the viewport.
  let band = null, lastPos = null, scrollStep = null, autoTimer = null;

  // Element-first so it works on any element under the pointer (and in tests);
  // geometry is the fallback for a pointer that has left the grid, and for the
  // auto-scroll tick whose coordinates are the last real ones.
  const rowIndexAt = e => {
    const el = e.target && e.target.closest ? e.target.closest('.pg-row') : null;
    if (el) return Math.min(nRows - 1, Math.max(0, +el.getAttribute('data-row')));
    const rect = scroller.getBoundingClientRect();
    const contentY = e.clientY - rect.top + scroller.scrollTop;
    if (contentY < PG_HEAD_H) return null;
    return Math.min(nRows - 1, Math.max(0, Math.floor((contentY - PG_HEAD_H) / PG_ROW_H)));
  };
  const colIndexAt = e => {
    const el = e.target && e.target.closest ? e.target.closest('.pg-col') : null;
    if (el) return Math.min(nCols - 1, Math.max(0, +el.getAttribute('data-col')));
    const rect = scroller.getBoundingClientRect();
    const x = e.clientX - rect.left + scroller.scrollLeft - PG_GUT_W;
    if (x < 0) return null;
    return Math.min(nCols - 1, Math.floor(x / PG_COL_W));
  };

  const applyBand = () => {
    const lo = Math.min(band.anchor, band.last), hi = Math.max(band.anchor, band.last);
    if (band.axis === 'row') setRowRange(sel, lo, hi, band.on);
    else setColRange(sel, lo, hi, band.on);
  };

  const paintBand = next => {
    band.last = next;
    applyBand();
    paint();
  };

  const autoTick = () => {
    if (!scrollStep) { clearInterval(autoTimer); autoTimer = null; return; }
    scroller.scrollTop += scrollStep.dy;
    scroller.scrollLeft += scrollStep.dx;
    if (band && lastPos) {
      const next = band.axis === 'row' ? rowIndexAt(lastPos) : colIndexAt(lastPos);
      if (next !== null && next !== band.last) paintBand(next);
    }
  };
  const updateAutoScroll = e => {
    const rect = scroller.getBoundingClientRect();
    const m = 36;
    let dx = 0, dy = 0;
    if (band && band.axis === 'col') {
      if (e.clientX < rect.left + m) dx = -PG_COL_W * 2;
      else if (e.clientX > rect.right - m) dx = PG_COL_W * 2;
    }
    if (e.clientY < rect.top + m) dy = -PG_ROW_H * 2;
    else if (e.clientY > rect.bottom - m) dy = PG_ROW_H * 2;
    if (!dx && !dy) { scrollStep = null; return; }
    scrollStep = { dx, dy };
    if (!autoTimer) autoTimer = setInterval(autoTick, 40);
  };

  const bandMove = e => {
    if (!band) return;
    lastPos = { clientX: e.clientX, clientY: e.clientY };
    updateAutoScroll(e);
    const next = band.axis === 'row' ? rowIndexAt(e) : colIndexAt(e);
    if (next !== null && next !== band.last) paintBand(next);
  };
  const bandUp = () => {
    if (!band) return;
    document.removeEventListener('mousemove', bandMove);
    document.removeEventListener('mouseup', bandUp);
    document.body.classList.remove('pg-dragging');
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    band = null; lastPos = null; scrollStep = null;
    if (o.onChange) o.onChange();
  };
  const beginBand = (axis, anchor, on) => {
    if (band) bandUp();
    band = { axis, anchor, last: anchor, on };
    applyBand();
    paint();
    document.body.classList.add('pg-dragging');
    document.addEventListener('mousemove', bandMove);
    document.addEventListener('mouseup', bandUp);
  };

  head.addEventListener('mousedown', e => {
    const colEl = e.target.closest('.pg-col');
    if (!colEl) return;
    e.preventDefault();
    const anchor = +colEl.getAttribute('data-col');
    beginBand('col', anchor, !sel.cols[anchor]);
  });
  inner.addEventListener('mousedown', e => {
    const rowEl = e.target.closest('.pg-row');
    if (!rowEl) return;
    e.preventDefault();
    const anchor = +rowEl.getAttribute('data-row');
    beginBand('row', anchor, !rowSelected(sel, anchor));
  });
}

// ---- the panel in the review ------------------------------------------------
// Folded by default, as the whole screen is: a control that starts open for a
// file nobody has seen yet would take over the review. Expanded, it edits one
// file at a time -- a file selector appears when there are several.

let pgOpen = false;
let pgFile = 0;
const pgScroll = {};

function pgReset() {
  pgOpen = false;
  pgFile = 0;
  Object.keys(pgScroll).forEach(k => delete pgScroll[k]);
}

function renderPreselectBlock(box, pend) {
  const wrap = html('div', 'import-preselect', box);
  const head = html('button', 'preselect-toggle', wrap);
  head.type = 'button';
  head.addEventListener('click', () => { pgOpen = !pgOpen; renderDataPanel(); });
  html('span', 'preselect-arrow', head).textContent = pgOpen ? '▾' : '▸';
  html('span', 'preselect-title', head).textContent = 'Select which rows and columns to import';
  const headSummary = html('span', 'preselect-summary', head);
  headSummary.textContent = ' · ' + pgTotalsSummary(pend);
  if (!pgOpen) return;

  if (pend.files.length > 1) {
    const row = html('div', 'preselect-file', wrap);
    html('span', 'dim-label', row).textContent = 'File';
    const s = selectField(row, pend.files.map((f, i) => [String(i),
      f.filename + (f.path && f.path !== f.filename ? '  · ' + f.path : '')]),
      String(pgFile), v => { pgFile = +v; renderDataPanel(); });
    s.id = 'preselect-file';
  }

  const file = pend.files[pgFile] || pend.files[0];
  const tools = html('div', 'preselect-tools', wrap);
  const btn = (text, fn, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.addEventListener('click', fn);
    tools.appendChild(b);
    return b;
  };
  btn('Select all rows', () => {
    setRowRange(file.selection, 0, file.selection.total - 1, true);
    pgCommit();
  });
  btn('Unselect all rows', () => {
    setRowRange(file.selection, 0, file.selection.total - 1, false);
    pgCommit();
  });
  btn('Select all columns', () => {
    setColRange(file.selection, 0, file.selection.cols.length - 1, true);
    pgCommit();
  });
  btn('Unselect all columns', () => {
    setColRange(file.selection, 0, file.selection.cols.length - 1, false);
    pgCommit();
  });
  btn('Export selected rows as CSV', () => {
    const eff = applySelection(file.rawParsed, file.selection);
    const lines = [eff.header.join(file.rawParsed.delimiter)];
    eff.rows.forEach(r => lines.push(r.join(file.rawParsed.delimiter)));
    downloadText(stemOf(file.filename) + '-selected.csv', lines.join('\n') + '\n');
  }, 'ghost');

  html('div', 'preselect-note', wrap).textContent =
    'Drag across the row numbers or the column headers: dragging out of a selected '
    + 'band removes it, dragging out of an empty one adds it. Everything starts selected.';

  const gridHost = html('div', 'preselect-grid-host', wrap);
  renderPreselectGrid(gridHost, {
    raw: file.rawParsed,
    sel: file.selection,
    initial: pgScroll[pgFile] || null,
    onChange: () => {
      const sc = gridHost.querySelector('.pg-scroll');
      if (sc) pgScroll[pgFile] = { top: sc.scrollTop, left: sc.scrollLeft };
      refreshReshape();
    },
  });
}

function pgCommit() {
  const sc = document.querySelector('.preselect-grid-host .pg-scroll');
  if (sc) pgScroll[pgFile] = { top: sc.scrollTop, left: sc.scrollLeft };
  refreshReshape();
}

function pgTotalsSummary(pend) {
  let selRows = 0, totRows = 0, selCols = 0, totCols = 0;
  pend.files.forEach(f => {
    const s = f.selection;
    selRows += selRowCount(s); totRows += s.total;
    selCols += selColCount(s); totCols += s.cols.length;
  });
  return (selRows === totRows ? 'all ' + pgNum(totRows) + ' rows' : pgNum(selRows) + ' of ' + pgNum(totRows) + ' rows')
    + ' · '
    + (selCols === totCols ? 'all ' + pgNum(totCols) + ' columns' : pgNum(selCols) + ' of ' + pgNum(totCols) + ' columns')
    + ' selected';
}