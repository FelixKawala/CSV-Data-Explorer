// the Data tab: import CSVs, review the columns, keep or drop datasets
//
// The import is deliberately a review step rather than a drop-and-guess. Every
// inference -- is this a dimension or a measure, is it a percentage or a count --
// is shown as a pre-filled control, never applied silently, because a wrong
// guess here produces a chart that is plausible and wrong.

let pendingImport = null;   // { files: [{filename, text, parsed}], columns, target, name }
let dataStatus = '';

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

// ---- staging ---------------------------------------------------------------
function stageFiles(files) {
  return Promise.all(files.map(f => readFileText(f).then(text => ({
    filename: f.name,
    text,
    parsed: parseCsv(text),
  })))).then(staged => {
    const usable = staged.filter(s => s.parsed.header.length && s.parsed.rows.length);
    if (!usable.length) {
      setDataStatus('No rows found in ' + staged.map(s => s.filename).join(', ') + '.');
      renderDataPanel();
      return;
    }
    // Files with the same header describe the same thing and can be unioned;
    // otherwise each becomes its own dataset, which is the safe default.
    const sig = s => dedupeHeader(s.parsed.header).join('');
    const sameShape = usable.every(s => sig(s) === sig(usable[0]));
    // The column list is the union of every file's header, in order of first
    // appearance. Profiling only the first file's columns would hand the other
    // files a recipe naming columns they do not have.
    const header = [];
    usable.forEach(f => dedupeHeader(f.parsed.header).forEach(h => {
      if (header.indexOf(h) === -1) header.push(h);
    }));
    const columns = header.map(name => {
      const values = [];
      let inFiles = 0;
      usable.forEach(f => {
        const i = dedupeHeader(f.parsed.header).indexOf(name);
        if (i === -1) return;
        inFiles++;
        f.parsed.rows.forEach(r => values.push(r[i]));
      });
      const p = profileColumn(name, values);
      p.files = inFiles;
      const role = suggestRole(p);
      return {
        source: name, name, label: name, role,
        format: role === 'measure' ? suggestFormat(p) : 'number',
        agg: 'mean', profile: p,
      };
    });
    pendingImport = {
      files: usable,
      columns,
      sameShape,
      union: sameShape && usable.length > 1,
      addSourceDim: sameShape && usable.length > 1,
      name: usable.length === 1
        ? usable[0].filename.replace(/\.[^.]+$/, '')
        : usable.length + ' files',
      ragged: usable.reduce((n, s) => n + s.parsed.ragged.length, 0),
      comments: usable[0].parsed.comments,
    };
    setDataStatus('');
    renderDataPanel();
  }).catch(e => {
    setDataStatus('Import failed: ' + e.message);
    renderDataPanel();
  });
}

function recipeFromPending(pend, files) {
  // only the columns these files actually have
  const present = {};
  files.forEach(f => dedupeHeader(f.parsed.header).forEach(h => { present[h] = true; }));
  return {
    columns: pend.columns.filter(c => present[c.source]).map(c => ({
      source: c.source, name: c.name, label: c.label, role: c.role,
      format: c.format, agg: c.agg,
    })),
    sourceDim: pend.addSourceDim && files.length > 1 ? '__source' : null,
    sourceLabel: 'Source',
    parse: {},
  };
}

function commitImport() {
  const pend = pendingImport;
  if (!pend) return Promise.resolve();
  const groups = pend.union
    ? [{ name: pend.name, files: pend.files }]
    : pend.files.map(f => ({ name: f.filename.replace(/\.[^.]+$/, ''), files: [f] }));

  const records = groups.map(g => ({
    id: newDatasetId(),
    name: g.name,
    createdAt: Date.now(),
    recipe: recipeFromPending(pend, g.files),
    sources: g.files.map(f => ({ filename: f.filename, text: f.text, label: f.filename.replace(/\.[^.]+$/, '') })),
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
function renderDataPanel() {
  if (!domAlive()) return;
  const host = document.getElementById('data-panel');
  if (!host) return;
  host.innerHTML = '';

  const bar = html('div', 'data-actions', host);
  const label = html('label', 'btn primary', bar);
  label.textContent = 'Import CSV…';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv,text/plain';
  input.multiple = true;
  input.id = 'csv-input';
  input.style.display = 'none';
  input.addEventListener('change', e => {
    const files = Array.prototype.slice.call(e.target.files || []);
    if (files.length) stageFiles(files);
    input.value = '';
  });
  label.appendChild(input);

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

  if (pendingImport) renderImportReview(host);
  renderDatasetList(host);

  if (!pendingImport && !hasDataset()) {
    const empty = html('div', 'data-empty', host);
    html('p', null, empty).textContent =
      'No data yet. Import a CSV with one row per observation: some columns naming '
      + 'what the row is about, and some holding numbers to plot.';
  }
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
      const dims = rec.recipe.columns.filter(c => c.role === 'dimension').length;
      const meas = rec.recipe.columns.filter(c => c.role === 'measure').length;
      meta.textContent = dims + ' dimension' + (dims === 1 ? '' : 's') + ' · '
        + meas + ' measure' + (meas === 1 ? '' : 's') + ' · '
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

function renderImportReview(host) {
  const pend = pendingImport;
  const box = html('div', 'import-review', host);
  html('h4', null, box).textContent = 'Review the import';

  const summary = html('div', 'import-summary', box);
  const rowCount = pend.files.reduce((n, f) => n + f.parsed.rows.length, 0);
  summary.textContent = pend.files.length + ' file' + (pend.files.length === 1 ? '' : 's') + ' · '
    + rowCount + ' rows · ' + pend.columns.length + ' columns · delimiter "'
    + (pend.files[0].parsed.delimiter === '\t' ? '\\t' : pend.files[0].parsed.delimiter) + '"';
  if (pend.ragged) {
    html('div', 'import-warn', box).textContent =
      pend.ragged + ' row' + (pend.ragged === 1 ? '' : 's') + ' had the wrong number of fields; '
      + 'they were padded or truncated to fit the header.';
  }
  if (pend.comments.length) {
    html('div', 'import-note', box).textContent = 'Comment line: ' + pend.comments[0];
  }

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
        pend.addSourceDim = pend.union;
        renderDataPanel();
      });
      lab.appendChild(r);
      html('span', null, lab).textContent = text;
      if (hint) html('span', 'radio-hint', lab).textContent = hint;
    };
    mk('separate', 'separate datasets', 'one per file, switch between them');
    if (pend.sameShape) {
      mk('union', 'one dataset', 'rows appended, with a Source dimension naming the file');
    } else {
      html('div', 'import-note', opts).textContent =
        'The files have different columns, so they cannot be combined into one dataset.';
    }
    if (pend.union) {
      const lab = html('label', 'radio-row', opts);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = pend.addSourceDim;
      cb.addEventListener('change', () => { pend.addSourceDim = cb.checked; });
      lab.appendChild(cb);
      html('span', null, lab).textContent = 'add a Source dimension naming each file';
    }
  }

  if (pend.union || pend.files.length === 1) {
    const nameRow = html('label', 'radio-row', box);
    html('span', null, nameRow).textContent = 'Name';
    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'name-input'; nameIn.value = pend.name;
    nameIn.addEventListener('input', () => { pend.name = nameIn.value; });
    nameRow.appendChild(nameIn);
  }

  // the column table: one row per column, every inference pre-filled
  const table = html('table', 'import-table', box);
  const thead = html('thead', null, table);
  const hr = html('tr', null, thead);
  ['Column', 'Shown as', 'Role', 'Format', 'Looks like'].forEach(h => {
    html('th', null, hr).textContent = h;
  });
  const tbody = html('tbody', null, table);
  pend.columns.forEach(col => {
    const tr = html('tr', null, tbody);
    tr.setAttribute('data-col', col.source);
    html('td', 'col-source', tr).textContent = col.source;

    const nameTd = html('td', null, tr);
    const nameIn = document.createElement('input');
    nameIn.type = 'text'; nameIn.className = 'name-input'; nameIn.value = col.label;
    nameIn.addEventListener('input', () => { col.label = nameIn.value; });
    nameTd.appendChild(nameIn);

    const roleTd = html('td', null, tr);
    const roleSel = document.createElement('select');
    [['dimension', 'Dimension'], ['measure', 'Measure'], ['ignore', 'Ignore']].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      roleSel.appendChild(opt);
    });
    roleSel.value = col.role;
    roleSel.addEventListener('change', () => { col.role = roleSel.value; renderDataPanel(); });
    roleTd.appendChild(roleSel);

    const fmtTd = html('td', null, tr);
    if (col.role === 'measure') {
      const fmtSel = document.createElement('select');
      Object.keys(FORMATS).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        fmtSel.appendChild(opt);
      });
      fmtSel.value = col.format;
      fmtSel.addEventListener('change', () => { col.format = fmtSel.value; });
      fmtTd.appendChild(fmtSel);
    } else {
      fmtTd.textContent = '—';
    }

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

  // what this will produce, before committing to it
  const dims = pend.columns.filter(c => c.role === 'dimension');
  const meas = pend.columns.filter(c => c.role === 'measure');
  const cells = dims.reduce((n, c) => n * Math.max(c.profile.distinct, 1), 1);
  const rows = pend.files.reduce((n, f) => n + f.parsed.rows.length, 0);
  const outcome = html('div', 'import-outcome', box);
  if (!meas.length) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to plot: mark at least one column as a measure.';
  } else if (!dims.length) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to group by: mark at least one column as a dimension.';
  } else if (rows > cells) {
    outcome.textContent = rows + ' rows collapse onto ' + cells + ' combinations — '
      + 'duplicates are averaged. Mark another column as a dimension to keep them apart.';
  } else {
    outcome.textContent = dims.length + ' dimensions × ' + meas.length + ' measures, '
      + rows + ' rows.';
  }

  const acts = html('div', 'import-actions', box);
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Import';
  go.disabled = !meas.length || !dims.length;
  go.addEventListener('click', () => commitImport());
  acts.appendChild(go);
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn small'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { pendingImport = null; setDataStatus(''); renderDataPanel(); });
  acts.appendChild(cancel);
}
