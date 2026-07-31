// the Data tab: import CSVs, review the columns, keep or drop datasets
//
// The import is deliberately a review step rather than a drop-and-guess. Every
// inference -- is this a dimension or a measure, is it a percentage or a count --
// is shown as a pre-filled control, never applied silently, because a wrong
// guess here produces a chart that is plausible and wrong.
//
// A CSV is not always tidy, so two reshapes are offered, both driven by a
// pattern the user writes and can see the effect of before committing:
//   * column names   2080c512kbki  -> device, threads, variant  (a melt)
//   * file paths     defBlock/RTX2080/kbk/...  -> constant per file
// Neither is inferred. The pattern is typed, previewed against the real names,
// and saved with the dataset so it replays on every load.

let pendingImport = null;
let dataStatus = '';
let reshapeTimer = null;

// Storage and file reads are async, so a handler can land after the page is gone.
// Every DOM touch behind a promise checks first.
function domAlive() {
  return typeof document !== 'undefined' && !!document && !!document.body;
}

function setDataStatus(msg) {
  dataStatus = msg || '';
  if (!domAlive()) return;
  const el = document.getElementById('data-status');
  if (el) el.textContent = dataStatus;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error('could not read ' + file.name));
    fr.readAsText(file);
  });
}

function stemOf(name) { return String(name).replace(/\.[^.]+$/, ''); }
function lastSegment(path) {
  const s = String(path || '').split('/');
  return s[s.length - 1] || '';
}

// ---- staging: reading is separate from deriving -----------------------------
// The reshape pattern arrives after the files do, so everything derived from it
// has to be recomputable. `stageFiles` only reads; `restagePending` derives, and
// runs again on every edit.
const MAX_IMPORT_FILES = 500;
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function stageFiles(files, note) {
  let list = files;
  if (list.length > MAX_IMPORT_FILES) {
    setDataStatus('That is ' + list.length + ' files — more than this page will hold. '
      + 'Pick a narrower folder (the limit is ' + MAX_IMPORT_FILES + ').');
    renderDataPanel();
    return Promise.resolve();
  }
  return Promise.all(list.map(f => readFileText(f).then(text => ({
    filename: f.name,
    path: f.webkitRelativePath || f.name,
    text,
    parsed: parseCsv(text),
  })))).then(staged => {
    const usable = staged.filter(s => s.parsed.header.length && s.parsed.rows.length);
    if (!usable.length) {
      setDataStatus('No rows found in ' + staged.map(s => s.filename).join(', ') + '.');
      renderDataPanel();
      return;
    }
    const bytes = usable.reduce((n, s) => n + s.text.length, 0);
    if (bytes > MAX_IMPORT_BYTES) {
      setDataStatus('That is ' + Math.round(bytes / 1048576) + ' MB of CSV — more than the '
        + 'browser will comfortably store. Import a subset.');
      renderDataPanel();
      return;
    }
    pendingImport = {
      files: usable,
      // what the user has decided; everything else below is derived from it
      melt: { on: false, kind: 'template', text: '', fieldCfg: {}, measureCfg: {},
        fallback: { name: 'Value', format: 'number' } },
      path: { levelCfg: {}, stem: { on: false, kind: 'template', text: '', fieldCfg: {} } },
      union: false,
      addSourceDim: false,
      name: usable.length === 1 ? stemOf(usable[0].filename) : usable.length + ' files',
      ragged: usable.reduce((n, s) => n + s.parsed.ragged.length, 0),
      comments: usable[0].parsed.comments,
      skipped: staged.length - usable.length,
    };
    restagePending();
    // Same-shaped files describe the same thing and can be unioned; otherwise
    // each becomes its own dataset, which is the safe default.
    pendingImport.union = pendingImport.sameShape && usable.length > 1;
    pendingImport.addSourceDim = pendingImport.union && !pendingImport.pathDims.length;
    restagePending();
    setDataStatus(note || '');
    renderDataPanel();
  }).catch(e => {
    setDataStatus('Import failed: ' + e.message);
    renderDataPanel();
  });
}

// Everything derived from the files plus the current reshape settings.
// Idempotent, and cheap enough to run on a keystroke: it re-profiles but never
// re-parses, because `parsed` is cached on each staged file.
function restagePending() {
  const pend = pendingImport;
  if (!pend) return;
  const files = pend.files;

  // ---- directory levels ----------------------------------------------------
  // A file's own name is the last segment and is not a level; it gets the stem
  // pattern instead. So only indices up to the shallowest path's parent count.
  const segs = files.map(f => String(f.path || f.filename).split('/'));
  const depths = segs.map(s => s.length);
  const minDepth = Math.min.apply(null, depths);
  pend.mixedDepth = minDepth !== Math.max.apply(null, depths);
  pend.levels = [];
  for (let i = 0; i < minDepth - 1; i++) {
    const values = [];
    segs.forEach(s => { if (values.indexOf(s[i]) === -1) values.push(s[i]); });
    if (!pend.path.levelCfg[i]) {
      // A level every file shares says nothing about any of them, so it starts
      // ignored; one that varies is offered as a dimension.
      pend.path.levelCfg[i] = { key: values.length > 1 ? 'dir' + (i + 1) : null,
        label: 'Folder ' + (i + 1) };
    }
    pend.levels.push({ index: i, values, constant: values.length <= 1,
      cfg: pend.path.levelCfg[i] });
  }

  // ---- the pattern over each file's own name -------------------------------
  const stems = files.map(f => stemOf(lastSegment(f.path || f.filename)));
  pend.stemPat = pend.path.stem.on ? compilePattern(pend.path.stem) : null;
  pend.stemPreview = pend.stemPat && pend.stemPat.ok ? patternPreview(pend.stemPat, stems) : null;
  pend.stemDims = [];
  if (pend.stemPreview) {
    pend.stemPat.fields.forEach(field => {
      const cfg = pend.path.stem.fieldCfg[field]
        || (pend.path.stem.fieldCfg[field] = { key: field, label: field, include: true });
      pend.stemDims.push({ field, cfg, values: pend.stemPreview.values[field] || [] });
    });
  }
  pend.pathDims = pend.levels.filter(l => l.cfg.key)
    .map(l => ({ key: l.cfg.key, label: l.cfg.label, values: l.values, level: l }))
    .concat(pend.stemDims.filter(d => d.cfg.include)
      .map(d => ({ key: d.cfg.key, label: d.cfg.label, values: d.values, stem: d })));

  // ---- the pattern over the column names -----------------------------------
  const rawUnion = [];
  files.forEach(f => f.parsed.header.forEach(h => {
    if (rawUnion.indexOf(h) === -1) rawUnion.push(h);
  }));
  pend.meltPat = pend.melt.on ? compilePattern(pend.melt) : null;
  const live = pend.meltPat && pend.meltPat.ok ? pend.meltPat : null;
  pend.meltPreview = live ? patternPreview(live, rawUnion) : null;

  // ---- columns the melt did not claim, profiled as before -------------------
  const idNames = [];
  files.forEach(f => {
    const raw = f.parsed.header;
    const ded = dedupeHeader(raw);
    for (let i = 0; i < raw.length; i++) {
      if (live && matchPattern(live, raw[i])) continue;
      if (idNames.indexOf(ded[i]) === -1) idNames.push(ded[i]);
    }
  });
  const prev = {};
  (pend.columns || []).forEach(c => { prev[c.source] = c; });
  pend.columns = idNames.map(name => {
    const values = [];
    let inFiles = 0;
    files.forEach(f => {
      const i = dedupeHeader(f.parsed.header).indexOf(name);
      if (i === -1) return;
      inFiles++;
      f.parsed.rows.forEach(r => values.push(r[i]));
    });
    const p = profileColumn(name, values);
    p.files = inFiles;
    if (prev[name]) return Object.assign({}, prev[name], { profile: p });
    const role = suggestRole(p);
    return {
      source: name, name, label: name, role,
      format: role === 'measure' ? suggestFormat(p) : 'number',
      agg: 'mean', profile: p,
    };
  });

  // ---- melt dimensions and measures ----------------------------------------
  pend.meltDims = [];
  pend.meltMeasures = [];
  pend.meltGroupsPerFile = files.map(() => 1);
  if (live && pend.meltPreview) {
    live.fields.forEach(field => {
      if (field === PATTERN_MEASURE_FIELD) return;
      const cfg = pend.melt.fieldCfg[field]
        || (pend.melt.fieldCfg[field] = { key: field, label: field, include: true, labelOverride: {} });
      const values = pend.meltPreview.values[field] || [];
      // An empty capture would otherwise draw a chip with no text on it.
      if (values.indexOf('') !== -1 && cfg.labelOverride[''] === undefined) cfg.labelOverride[''] = 'base';
      pend.meltDims.push({ field, cfg, values });
    });

    // Which measures the pattern produces, and the values that feed each.
    const order = [];
    const pools = {};
    let usesFallback = false;
    files.forEach((f, fi) => {
      const raw = f.parsed.header;
      const sigs = {};
      let groups = 0;
      for (let i = 0; i < raw.length; i++) {
        const m = matchPattern(live, raw[i]);
        if (!m) continue;
        const captured = live.hasMeasure ? (m.fields[PATTERN_MEASURE_FIELD] || '') : '';
        if (!captured) usesFallback = true;
        else if (order.indexOf(captured) === -1) order.push(captured);
        const sig = pend.meltDims.map(d => m.fields[d.field] || '').join(' ');
        if (!sigs[sig]) { sigs[sig] = 1; groups++; }
        const pool = pools[captured] || (pools[captured] = []);
        f.parsed.rows.forEach(r => pool.push(r[i]));
      }
      pend.meltGroupsPerFile[fi] = groups;
    });
    const mk = (value, fallback) => {
      const cfg = pend.melt.measureCfg[value] || (pend.melt.measureCfg[value] = {});
      if (cfg.label === undefined) cfg.label = value || meltFallbackName(pend);
      // Profile under the name it will be shown as, not under the capture: the
      // format guess reads the name, so a melted column called "Value" would be
      // proposed as a plain number even when every value is a percentage.
      // Naming it "Hit rate" re-proposes -- until the format is set by hand.
      const p = profileColumn(cfg.label, pools[value] || []);
      if (!cfg.formatTouched) cfg.format = suggestFormat(p);
      return { value, cfg, profile: p, fallback: !!fallback, key: value || 'value' };
    };
    if (usesFallback) pend.meltMeasures.push(mk('', true));
    order.forEach(v => pend.meltMeasures.push(mk(v, false)));
  }

  // ---- shape, counts, guards ------------------------------------------------
  // Two files can have different raw headers and the same melted schema -- a
  // `defbl` prefix on one of them, say -- so this is decided after the reshape,
  // not before it. That is what lets them be unioned at all.
  const sig = f => {
    const raw = f.parsed.header;
    const ded = dedupeHeader(raw);
    const ids = [];
    const ms = {};
    for (let i = 0; i < raw.length; i++) {
      const m = live && matchPattern(live, raw[i]);
      if (m) ms[live.hasMeasure ? (m.fields[PATTERN_MEASURE_FIELD] || '') : ''] = 1;
      else ids.push(ded[i]);
    }
    return ids.sort().join('') + '' + Object.keys(ms).sort().join('');
  };
  pend.sameShape = files.every(f => sig(f) === sig(files[0]));
  if (!pend.sameShape) pend.union = false;

  pend.rowCount = files.reduce((n, f) => n + f.parsed.rows.length, 0);
  pend.emitted = files.reduce((n, f, i) => n + f.parsed.rows.length * pend.meltGroupsPerFile[i], 0);

  const dimCounts = pend.columns.filter(c => c.role === 'dimension')
    .map(c => Math.max(c.profile.distinct, 1))
    .concat(pend.pathDims.map(d => Math.max(d.values.length, 1)))
    .concat(pend.meltDims.filter(d => d.cfg.include).map(d => Math.max(d.values.length, 1)));
  if (pend.addSourceDim && files.length > 1) dimCounts.push(files.length);
  pend.dimCount = dimCounts.length;
  pend.cells = dimCounts.reduce((n, k) => n * k, 1);
  pend.measureCount = pend.columns.filter(c => c.role === 'measure').length + pend.meltMeasures.length;

  // keys must be unique across everything that becomes a dimension or a measure
  const taken = {};
  pend.keyClash = null;
  const claim = name => {
    if (!name) return;
    if (taken[name]) { pend.keyClash = pend.keyClash || name; }
    taken[name] = true;
  };
  pend.columns.forEach(c => { if (c.role !== 'ignore') claim(c.name); });
  pend.pathDims.forEach(d => claim(d.key));
  pend.meltDims.forEach(d => { if (d.cfg.include) claim(d.cfg.key); });
  pend.meltMeasures.forEach(m => claim(m.value || meltFallbackKey(pend)));
}

function meltFallbackName(pend) { return pend.melt.fallback.name || 'Value'; }
function meltFallbackKey(pend) {
  const n = meltFallbackName(pend).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return n || 'value';
}

// ---- recipe ----------------------------------------------------------------
function recipeFromPending(pend, files) {
  // only the columns these files actually have
  const present = {};
  files.forEach(f => dedupeHeader(f.parsed.header).forEach(h => { present[h] = true; }));
  const recipe = {
    columns: pend.columns.filter(c => present[c.source]).map(c => ({
      source: c.source, name: c.name, label: c.label, role: c.role,
      format: c.format, agg: c.agg,
    })),
    sourceDim: pend.addSourceDim && files.length > 1 ? '__source' : null,
    sourceLabel: 'Source',
    parse: {},
  };

  const live = pend.meltPat && pend.meltPat.ok ? pend.meltPat : null;
  if (live) {
    const fallbackKey = meltFallbackKey(pend);
    recipe.melt = {
      pattern: { kind: pend.melt.kind, text: pend.melt.text },
      fields: pend.meltDims.filter(d => d.cfg.include).map(d => ({
        field: d.field, key: d.cfg.key, label: d.cfg.label, labelOverride: d.cfg.labelOverride,
      })),
      measure: { key: fallbackKey, label: meltFallbackName(pend),
        format: (pend.melt.measureCfg[''] || {}).format || 'number', agg: 'mean' },
      measures: pend.meltMeasures.filter(m => !m.fallback).map(m => ({
        value: m.value, key: m.value, label: m.cfg.label || m.value,
        format: m.cfg.format || 'number', agg: 'mean',
      })),
    };
  }

  const levels = pend.levels.filter(l => l.cfg.key)
    .map(l => ({ index: l.index, key: l.cfg.key, label: l.cfg.label }));
  const stemFields = pend.stemDims.filter(d => d.cfg.include)
    .map(d => ({ field: d.field, key: d.cfg.key, label: d.cfg.label }));
  if (levels.length || stemFields.length) {
    recipe.path = {
      levels,
      pattern: stemFields.length
        ? { on: 'stem', spec: { kind: pend.path.stem.kind, text: pend.path.stem.text }, fields: stemFields }
        : null,
    };
  }
  return recipe;
}

function commitImport() {
  const pend = pendingImport;
  if (!pend) return Promise.resolve();
  const groups = pend.union
    ? [{ name: pend.name, files: pend.files }]
    : pend.files.map(f => ({ name: stemOf(f.filename), files: [f] }));

  const records = groups.map(g => ({
    id: newDatasetId(),
    name: g.name,
    createdAt: Date.now(),
    recipe: recipeFromPending(pend, g.files),
    sources: g.files.map(f => ({
      filename: f.filename, path: f.path, text: f.text, label: stemOf(f.filename),
    })),
  }));

  // Build before storing: a dataset that cannot be rebuilt should never be saved.
  let built;
  try {
    built = records.map(datasetFromRecord);
  } catch (e) {
    setDataStatus('Could not build a dataset from those columns: ' + e.message);
    renderDataPanel();
    return Promise.resolve();
  }
  // A recipe can produce rows and still carry nothing: a column marked as a measure
  // whose values are not numbers yields a grid of blanks. Refuse that too, rather
  // than storing a dataset that will only ever draw an empty chart.
  const bad = built.findIndex(b => b.nRows === 0 || b.stats.filled === 0);
  if (bad !== -1) {
    setDataStatus('"' + records[bad].name + '" produced '
      + (built[bad].nRows === 0 ? 'no rows' : 'no numeric values')
      + ' — check the column roles.');
    renderDataPanel();
    return Promise.resolve();
  }

  return Promise.all(records.map(r => STORE.put(r)))
    .then(() => {
      pendingImport = null;
      const last = records[records.length - 1];
      setActiveDatasetId(last.id);
      startWithDataset(built[built.length - 1]);
      setDataStatus('Imported ' + records.map(r => r.name).join(', ') + '.');
      renderDataPanel();
      showMode('builder');
    })
    .catch(e => {
      setDataStatus('Could not save: ' + e.message);
      renderDataPanel();
    });
}

function activateDataset(id) {
  return STORE.get(id).then(rec => {
    if (!rec) return;
    startWithDataset(datasetFromRecord(rec));
    setActiveDatasetId(id);
    renderDataPanel();
    showMode('builder');
  }).catch(e => setDataStatus('Could not open that dataset: ' + e.message));
}

function deleteDataset(id) {
  return STORE.remove(id).then(() => {
    if (activeDatasetId() === id) setActiveDatasetId(null);
    renderDataPanel();
  });
}

// ---- rendering --------------------------------------------------------------
function fileInput(bar, id, text, directory) {
  const label = html('label', 'btn' + (directory ? ' small' : ' primary'), bar);
  label.textContent = text;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.id = id;
  input.style.display = 'none';
  if (directory) {
    input.webkitdirectory = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  } else {
    input.accept = '.csv,text/csv,text/plain';
  }
  input.addEventListener('change', e => {
    let files = Array.prototype.slice.call(e.target.files || []);
    // `accept` is ignored for a directory pick, so a folder arrives with its
    // images and logs in it; parseCsv would make nonsense headers out of those.
    let note = '';
    if (directory) {
      const all = files.length;
      files = files.filter(f => /\.(csv|tsv|txt)$/i.test(f.name));
      if (all !== files.length) {
        note = all + ' files in that folder, ' + files.length + ' of them CSVs.';
      }
    }
    if (files.length) stageFiles(files, note);
    else if (directory) { setDataStatus(note || 'No CSVs in that folder.'); renderDataPanel(); }
    input.value = '';
  });
  label.appendChild(input);
  return input;
}

function renderDataPanel() {
  if (!domAlive()) return;
  const host = document.getElementById('data-panel');
  if (!host) return;
  host.innerHTML = '';

  const bar = html('div', 'data-actions', host);
  fileInput(bar, 'csv-input', 'Import CSV…', false);
  fileInput(bar, 'csv-dir-input', 'Import folder…', true);

  if (DATA) {
    const demo = document.createElement('button');
    demo.type = 'button'; demo.className = 'btn small'; demo.textContent = 'Load the demo dataset';
    demo.addEventListener('click', () => {
      startWithDataset(makeDataset(datasetSpecFromBundle(DATA)));
      showMode('builder');
    });
    bar.appendChild(demo);
  }

  html('div', 'data-status', host).id = 'data-status';
  setDataStatus(dataStatus);

  const holder = html('div', 'import-holder', host);
  holder.id = 'import-holder';
  if (pendingImport) renderImportReview(holder);
  renderDatasetList(host);

  if (!pendingImport && !hasDataset()) {
    const empty = html('div', 'data-empty', host);
    html('p', null, empty).textContent =
      'No data yet. Import a CSV with one row per observation: some columns naming '
      + 'what the row is about, and some holding numbers to plot. If the columns or the '
      + 'folders carry part of the story, the review step can pull those out too.';
  }
}

// Redraw only the review, keeping the caret where it was. A full renderDataPanel
// on every keystroke would destroy the pattern input being typed into.
function refreshReshape() {
  if (!domAlive() || !pendingImport) return;
  const holder = document.getElementById('import-holder');
  if (!holder) { renderDataPanel(); return; }
  const active = document.activeElement;
  const id = active && active.id ? active.id : null;
  const caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  restagePending();
  holder.innerHTML = '';
  renderImportReview(holder);
  if (id) {
    const back = document.getElementById(id);
    if (back && back.focus) {
      back.focus();
      if (caret !== null && back.setSelectionRange) back.setSelectionRange(caret, caret);
    }
  }
}
function refreshReshapeSoon() {
  clearTimeout(reshapeTimer);
  reshapeTimer = setTimeout(refreshReshape, 150);
}

function renderDatasetList(host) {
  const wrap = html('div', 'dataset-list', host);
  Promise.resolve(STORE.list()).then(records => {
    if (!domAlive() || !records || !records.length) return;
    html('h4', null, wrap).textContent = 'Stored datasets';
    const active = activeDatasetId();
    records.forEach(rec => {
      const card = html('div', 'dataset-card' + (rec.id === active ? ' active' : ''), wrap);
      card.setAttribute('data-id', rec.id);
      const title = html('div', 'dataset-name', card);
      title.textContent = rec.name;
      const meta = html('div', 'dataset-meta', card);
      const shape = recipeShape(rec.recipe);
      meta.textContent = shape.dims + ' dimension' + (shape.dims === 1 ? '' : 's') + ' · '
        + shape.measures + ' measure' + (shape.measures === 1 ? '' : 's') + ' · '
        + rec.sources.length + ' file' + (rec.sources.length === 1 ? '' : 's');
      const acts = html('div', 'dataset-actions', card);
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn small'; open.textContent = 'Open';
      open.addEventListener('click', () => activateDataset(rec.id));
      acts.appendChild(open);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn small danger'; del.textContent = 'Delete';
      del.addEventListener('click', () => deleteDataset(rec.id));
      acts.appendChild(del);
    });
  }).catch(() => {});
}

// ---- the review -------------------------------------------------------------
function textField(parent, id, value, onInput, cls) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = cls || 'name-input';
  if (id) inp.id = id;
  inp.value = value === undefined || value === null ? '' : value;
  inp.addEventListener('input', () => onInput(inp.value));
  parent.appendChild(inp);
  return inp;
}
function selectField(parent, options, value, onChange) {
  const sel = document.createElement('select');
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o[0]; opt.textContent = o[1];
    sel.appendChild(opt);
  });
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  parent.appendChild(sel);
  return sel;
}
const FORMAT_OPTIONS = () => Object.keys(FORMATS).map(k => [k, k]);

// A pattern box: the dialect, the text, what it compiled to, and what it did to
// every name it was given. The preview shows captured values rather than a tick,
// because a pattern can match and still be wrong.
function patternBox(host, id, cfg, preview, onChange, subject) {
  const row = html('div', 'reshape-row', host);
  selectField(row, [['template', 'Template'], ['regex', 'Regular expression']], cfg.kind, v => {
    cfg.kind = v;
    onChange();
  });
  const inp = textField(row, id, cfg.text, v => { cfg.text = v; refreshReshapeSoon(); }, 'pattern-input');
  inp.placeholder = cfg.kind === 'regex'
    ? '^(?<device>\\d+)c(?<threads>\\d+)(?<variant>.*)$'
    : '{device:d}c{threads:d}{variant}';
  inp.spellcheck = false;

  const compiled = cfg.text.trim() ? compilePattern(cfg) : null;
  if (compiled && compiled.error) {
    html('div', 'import-warn', host).textContent = compiled.error;
  }
  if (compiled && compiled.warnings.length) {
    html('div', 'import-note', host).textContent = compiled.warnings.join(' · ');
  }
  html('div', 'import-note', host).textContent = patternHelp(cfg.kind);

  if (!preview) return;
  const head = html('div', 'import-summary', host);
  head.textContent = preview.matched + ' of ' + preview.total + ' ' + subject + ' matched'
    + (preview.matched < preview.total
      ? '; ' + (preview.total - preview.matched) + ' left alone' : '');
  const table = html('table', 'melt-preview', host);
  const hr = html('tr', null, html('thead', null, table));
  html('th', null, hr).textContent = subject === 'names' ? 'Name' : 'File';
  preview.fields.forEach(f => { html('th', null, hr).textContent = f; });
  const tb = html('tbody', null, table);
  preview.rows.slice(0, 40).forEach(r => {
    const tr = html('tr', r.ok ? null : 'melt-miss', tb);
    tr.setAttribute('data-name', r.input);
    html('td', 'col-source', tr).textContent = r.input;
    if (!r.ok) {
      const td = html('td', 'col-profile', tr);
      td.colSpan = Math.max(preview.fields.length, 1);
      td.textContent = 'no match — kept as it is';
      return;
    }
    preview.fields.forEach(f => {
      const td = html('td', 'col-profile', tr);
      td.textContent = r.fields[f] === '' ? '(empty)' : r.fields[f];
    });
  });
  if (preview.rows.length > 40) {
    html('div', 'import-note', host).textContent = '… and ' + (preview.rows.length - 40) + ' more.';
  }
}

function renderReshapeBlock(box, pend) {
  const wrap = html('div', 'import-reshape', box);
  const head = html('label', 'radio-row', wrap);
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'melt-enable';
  cb.checked = pend.melt.on;
  cb.addEventListener('change', () => { pend.melt.on = cb.checked; refreshReshape(); });
  head.appendChild(cb);
  html('span', null, head).textContent = 'The column names carry dimensions';
  html('span', 'radio-hint', head).textContent = 'e.g. 2080c512kbki is a device, a size and a variant';
  if (!pend.melt.on) return;

  patternBox(wrap, 'melt-pattern', pend.melt, pend.meltPreview, () => refreshReshape(), 'names');

  if (pend.meltPreview && pend.meltPreview.matched === 0) {
    html('div', 'import-warn', wrap).textContent =
      'That pattern matches none of the column names, so there would be nothing to plot.';
  }
  if (pend.meltPat && pend.meltPat.ok && !pend.meltPat.hasMeasure) {
    const row = html('label', 'radio-row', wrap);
    html('span', 'derive-label', row).textContent = 'Call the value';
    textField(row, 'melt-fallback-name', pend.melt.fallback.name, v => {
      pend.melt.fallback.name = v;
      const m = pend.meltMeasures[0];
      if (m) m.cfg.label = v;
      refreshReshapeSoon();
    });
    html('span', 'radio-hint', row).textContent =
      'name a field {measure} instead to have its text pick the measure';
  }
}

function renderPathBlock(box, pend) {
  if (!pend.levels.length && pend.files.length < 2) return;
  const wrap = html('div', 'import-path', box);
  html('div', 'dim-label', wrap).textContent = 'Where the files came from';
  if (pend.mixedDepth) {
    html('div', 'import-note', wrap).textContent =
      'The files are not all the same number of folders deep, so the levels below line up '
      + 'from the top and may not mean the same thing in every file.';
  }

  if (pend.levels.length) {
    const table = html('table', 'path-levels', wrap);
    const hr = html('tr', null, html('thead', null, table));
    ['Folder level', 'Role', 'Called', 'Values'].forEach(h => { html('th', null, hr).textContent = h; });
    const tb = html('tbody', null, table);
    pend.levels.forEach(l => {
      const tr = html('tr', l.constant ? 'col-partial' : null, tb);
      tr.setAttribute('data-level', String(l.index));
      html('td', 'col-source', tr).textContent = 'level ' + (l.index + 1);
      selectField(html('td', null, tr), [['ignore', 'Ignore'], ['dimension', 'Dimension']],
        l.cfg.key ? 'dimension' : 'ignore', v => {
          l.cfg.key = v === 'dimension' ? (l.cfg.key || 'dir' + (l.index + 1)) : null;
          refreshReshape();
        });
      const nameTd = html('td', null, tr);
      if (l.cfg.key) {
        textField(nameTd, 'path-name-' + l.index, l.cfg.label, v => {
          l.cfg.label = v;
          l.cfg.key = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
            || 'dir' + (l.index + 1);
          refreshReshapeSoon();
        });
      } else { nameTd.textContent = '—'; }
      html('td', 'col-profile', tr).textContent = l.constant
        ? 'the same in every file: ' + l.values[0]
        : l.values.length + ' distinct: ' + l.values.slice(0, 3).join(', ')
          + (l.values.length > 3 ? '…' : '');
    });
  }

  const head = html('label', 'radio-row', wrap);
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'stem-enable';
  cb.checked = pend.path.stem.on;
  cb.addEventListener('change', () => { pend.path.stem.on = cb.checked; refreshReshape(); });
  head.appendChild(cb);
  html('span', null, head).textContent = 'The file names carry dimensions too';
  if (pend.path.stem.on) {
    patternBox(wrap, 'stem-pattern', pend.path.stem, pend.stemPreview, () => refreshReshape(), 'files');
  }
}

// One table for everything that becomes a dimension or a measure, whether it was
// a column, a folder level or a piece of a name. Keeping the row shape identical
// means the same controls work on all of them.
function renderColumnTable(box, pend) {
  const table = html('table', 'import-table', box);
  const hr = html('tr', null, html('thead', null, table));
  ['Column', 'Shown as', 'Role', 'Format', 'Looks like'].forEach(h => {
    html('th', null, hr).textContent = h;
  });
  const tbody = html('tbody', null, table);

  const addRow = (key, source, synthetic) => {
    const tr = html('tr', null, tbody);
    tr.setAttribute('data-col', key);
    if (synthetic) tr.setAttribute('data-synthetic', synthetic);
    html('td', 'col-source', tr).textContent = source;
    return tr;
  };

  pend.columns.forEach(col => {
    const tr = addRow(col.source, col.source, null);
    textField(html('td', null, tr), null, col.label, v => { col.label = v; });
    selectField(html('td', null, tr),
      [['dimension', 'Dimension'], ['measure', 'Measure'], ['ignore', 'Ignore']],
      col.role, v => { col.role = v; refreshReshape(); });
    const fmtTd = html('td', null, tr);
    if (col.role === 'measure') {
      selectField(fmtTd, FORMAT_OPTIONS(), col.format, v => { col.format = v; });
    } else { fmtTd.textContent = '—'; }

    const p = col.profile;
    if (p.files !== undefined && p.files < pend.files.length) {
      tr.classList.add('col-partial');
      html('td', 'col-profile', tr).textContent = 'only in ' + p.files + ' of '
        + pend.files.length + ' files';
      return;
    }
    html('td', 'col-profile', tr).textContent = p.numeric
      ? ('numeric, ' + p.distinct + ' distinct, ' + fmtAccess(p.min) + '…' + fmtAccess(p.max))
      : (p.distinct + ' distinct: ' + p.sample.slice(0, 3).join(', ') + (p.distinct > 3 ? '…' : ''));
  });

  pend.pathDims.forEach(d => {
    const cfg = d.level ? d.level.cfg : d.stem.cfg;
    const tr = addRow('path:' + d.key, d.level ? 'folder level ' + (d.level.index + 1) : '{' + d.stem.field + '}', 'path');
    textField(html('td', null, tr), null, cfg.label, v => { cfg.label = v; });
    selectField(html('td', null, tr), [['dimension', 'Dimension'], ['ignore', 'Ignore']],
      'dimension', v => {
        if (v === 'ignore') { if (d.level) cfg.key = null; else cfg.include = false; }
        refreshReshape();
      });
    html('td', null, tr).textContent = '—';
    html('td', 'col-profile', tr).textContent = d.values.length + ' distinct: '
      + d.values.slice(0, 3).join(', ') + (d.values.length > 3 ? '…' : '');
  });

  pend.meltDims.forEach(d => {
    const tr = addRow('melt:' + d.cfg.key, '{' + d.field + '}', 'melt');
    if (!d.cfg.include) tr.classList.add('col-partial');
    textField(html('td', null, tr), null, d.cfg.label, v => {
      d.cfg.label = v;
      d.cfg.key = v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || d.field;
    });
    selectField(html('td', null, tr), [['dimension', 'Dimension'], ['ignore', 'Ignore']],
      d.cfg.include ? 'dimension' : 'ignore', v => { d.cfg.include = v === 'dimension'; refreshReshape(); });
    html('td', null, tr).textContent = '—';
    const prof = html('td', 'col-profile', tr);
    prof.textContent = d.values.length + ' distinct: '
      + d.values.map(v => (v === '' ? '(empty)' : v)).slice(0, 3).join(', ')
      + (d.values.length > 3 ? '…' : '');
    // A value captured as empty text would draw a chip with nothing written on
    // it, so it gets a label here rather than in a settings screen later.
    if (d.values.indexOf('') !== -1) {
      const lab = html('label', 'empty-label', prof);
      html('span', null, lab).textContent = 'empty shown as';
      textField(lab, 'melt-empty-' + d.field, d.cfg.labelOverride[''],
        v => { d.cfg.labelOverride[''] = v; }, 'name-input');
    }
  });

  pend.meltMeasures.forEach(m => {
    const tr = addRow('melt:' + (m.value || 'value'), m.fallback ? 'the value' : '{measure} = ' + m.value, 'melt');
    textField(html('td', null, tr), 'melt-measure-' + (m.value || 'value'), m.cfg.label, v => {
      m.cfg.label = v;
      if (m.fallback) pend.melt.fallback.name = v;
      refreshReshapeSoon();
    });
    const roleTd = html('td', null, tr);
    html('span', 'role-badge', roleTd).textContent = 'Measure';
    selectField(html('td', null, tr), FORMAT_OPTIONS(), m.cfg.format, v => {
      m.cfg.format = v;
      m.cfg.formatTouched = true;
    });
    const p = m.profile;
    html('td', 'col-profile', tr).textContent = p.numeric
      ? ('numeric, ' + p.distinct + ' distinct, ' + fmtAccess(p.min) + '…' + fmtAccess(p.max))
      : (p.distinct + ' distinct, not all numbers');
  });
}

function renderImportReview(host) {
  const pend = pendingImport;
  const box = html('div', 'import-review', host);
  html('h4', null, box).textContent = 'Review the import';

  const summary = html('div', 'import-summary', box);
  summary.textContent = pend.files.length + ' file' + (pend.files.length === 1 ? '' : 's') + ' · '
    + pend.rowCount + ' rows · ' + pend.columns.length + ' columns · delimiter "'
    + (pend.files[0].parsed.delimiter === '\t' ? '\\t' : pend.files[0].parsed.delimiter) + '"';
  if (pend.ragged) {
    html('div', 'import-warn', box).textContent =
      pend.ragged + ' row' + (pend.ragged === 1 ? '' : 's') + ' had the wrong number of fields; '
      + 'they were padded or truncated to fit the header.';
  }
  if (pend.comments.length) {
    html('div', 'import-note', box).textContent = 'Comment line: ' + pend.comments[0];
  }

  renderReshapeBlock(box, pend);
  renderPathBlock(box, pend);

  // several files: keep separate, or union them
  if (pend.files.length > 1) {
    const opts = html('div', 'import-target', box);
    html('div', 'dim-label', opts).textContent = 'These files should become';
    const mk = (val, text, hint) => {
      const lab = html('label', 'radio-row', opts);
      const r = document.createElement('input');
      r.type = 'radio'; r.name = 'import-target'; r.value = val;
      r.checked = (val === 'union') === pend.union;
      r.addEventListener('change', () => {
        pend.union = (val === 'union');
        pend.addSourceDim = pend.union && !pend.pathDims.length;
        refreshReshape();
      });
      lab.appendChild(r);
      html('span', null, lab).textContent = text;
      if (hint) html('span', 'radio-hint', lab).textContent = hint;
    };
    mk('separate', 'separate datasets', 'one per file, switch between them');
    if (pend.sameShape) {
      mk('union', 'one dataset', 'rows appended, kept apart by where they came from');
    } else {
      html('div', 'import-note', opts).textContent = pend.melt.on
        ? 'The files do not produce the same columns even after the split, so they cannot be combined.'
        : 'The files have different columns, so they cannot be combined into one dataset.';
    }
    if (pend.union) {
      const lab = html('label', 'radio-row', opts);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = pend.addSourceDim; cb.id = 'add-source-dim';
      cb.addEventListener('change', () => { pend.addSourceDim = cb.checked; refreshReshape(); });
      lab.appendChild(cb);
      html('span', null, lab).textContent = 'add a Source dimension naming each file';
      if (pend.pathDims.length) {
        html('span', 'radio-hint', lab).textContent = 'the folder levels already tell them apart';
      }
    }
  }

  if (pend.union || pend.files.length === 1) {
    const nameRow = html('label', 'radio-row', box);
    html('span', null, nameRow).textContent = 'Name';
    textField(nameRow, 'import-name', pend.name, v => { pend.name = v; });
  }

  renderColumnTable(box, pend);

  // what this will produce, before committing to it
  const meltBroken = pend.melt.on && (!pend.meltPat || !pend.meltPat.ok || pend.meltPreview.matched === 0);
  const outcome = html('div', 'import-outcome', box);
  let blocked = true;
  if (meltBroken) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Fix the column-name pattern above, or turn it off.';
  } else if (pend.keyClash) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Two things are both called "' + pend.keyClash + '" — rename one of them.';
  } else if (!pend.measureCount) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to plot: mark at least one column as a measure.';
  } else if (!pend.dimCount) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to group by: mark at least one column as a dimension.';
  } else if (pend.emitted > pend.cells) {
    blocked = false;
    outcome.textContent = pend.emitted + ' rows collapse onto ' + pend.cells + ' combinations — '
      + 'duplicates are averaged. Mark another column as a dimension to keep them apart.';
  } else {
    blocked = false;
    outcome.textContent = pend.dimCount + ' dimensions × ' + pend.measureCount + ' measures, '
      + pend.emitted + ' rows'
      + (pend.emitted !== pend.rowCount ? ' (from ' + pend.rowCount + ' in the files)' : '') + '.';
  }
  if (!blocked && pend.cells > 1e6) {
    html('div', 'import-note', box).textContent =
      'That is ' + Math.round(pend.cells / 1e6) + ' million combinations; the page will be slow.';
  }

  const acts = html('div', 'import-actions', box);
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Import';
  go.disabled = blocked;
  go.addEventListener('click', () => commitImport());
  acts.appendChild(go);
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn small'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { pendingImport = null; setDataStatus(''); renderDataPanel(); });
  acts.appendChild(cancel);
}
