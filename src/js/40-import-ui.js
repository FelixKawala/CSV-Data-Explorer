// the Data tab: import CSVs, review the columns, keep or drop datasets
//
// The import is deliberately a review step rather than a drop-and-guess. Every
// inference -- is this a dimension or a measure, is it a percentage or a count --
// is shown as a pre-filled control, never applied silently, because a wrong
// guess here produces a chart that is plausible and wrong.
//
// A CSV is not always tidy, so three reshapes are offered, all driven by a
// pattern the user writes and can see the effect of before committing:
//   * column names   2080c512kbki  -> device, threads, variant  (a melt)
//   * a column's values   16x4  -> block width, block height     (a split)
//   * file paths     defBlock/RTX2080/kbk/...  -> constant per file
// None is inferred. The pattern is typed, previewed against the real names,
// and saved with the dataset so it replays on every load.

let pendingImport = null;
let dataStatus = '';
let reshapeTimer = null;
// Which stored datasets are ticked for combining. Module-level, because the
// list is re-rendered on every change and the ticks have to outlive that.
const datasetPicks = {};
// Which cards have their provenance open. Module-level for the same reason: the
// list is rebuilt on every change and the disclosure has to outlive that.
const datasetFilesOpen = {};

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
  return Promise.all(list.map(f => readFileText(f).then(text => {
    const parsed = parseCsv(text);
    return {
      filename: f.name,
      path: f.webkitRelativePath || f.name,
      text,
      // The file as read, the user's selection over it, and the file as the
      // import will read it -- which restagePending recomputes from the other
      // two on every change.
      rawParsed: parsed,
      selection: defaultSelection(parsed.rows.length, parsed.header.length),
      parsed,
    };
  }))).then(staged => {
    pgReset();
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
      // the row labels, split the same way the column labels are
      split: { on: false, source: null, kind: 'template', text: '', fieldCfg: {} },
      path: { levelCfg: {}, stem: { on: false, kind: 'template', text: '', fieldCfg: {} } },
      union: false,
      // combining files that do not agree on their columns is a decision, not a
      // default -- and then the gaps need a value
      forceUnion: false,
      fill: 'n/a',
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
  // The preselect is the first reading of the file: everything below works on
  // the selected rows and columns, so a band dragged off the grid is gone from
  // the profiles, the counts and the emitted rows alike.
  files.forEach(f => { f.parsed = applySelection(f.rawParsed, f.selection); });

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
      // ignored; one that varies is offered as a dimension. A reconstructed
      // import proposes nothing: a level its recipe does not mention is one
      // that was turned off, and re-proposing it would reinstate it.
      pend.path.levelCfg[i] = {
        key: !pend.reconstructed && values.length > 1 ? 'dir' + (i + 1) : null,
        label: 'Folder ' + (i + 1),
      };
    }
    pend.levels.push({ index: i, values, constant: values.length <= 1,
      cfg: pend.path.levelCfg[i] });
  }

  // ---- the pattern over each file's own name -------------------------------
  const stems = files.map(f => stemOf(lastSegment(f.path || f.filename)));
  pend.stemInputs = stems;
  pend.stemPat = pend.path.stem.on ? compilePattern(pend.path.stem) : null;
  pend.stemPreview = pend.stemPat && pend.stemPat.ok ? patternPreview(pend.stemPat, stems) : null;
  pend.stemDims = [];
  if (pend.stemPreview) {
    pend.stemPat.fields.forEach(field => {
      const cfg = pend.path.stem.fieldCfg[field]
        || (pend.path.stem.fieldCfg[field] = {
          key: field, label: field, include: !pend.reconstructed,
        });
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
  pend.meltInputs = rawUnion;
  // A header with no value under it anywhere is not a value column, so its
  // words are not part of the vocabulary the others are written in. Leaving it
  // in gave a parts melt a part that claimed exactly one empty column, and the
  // measure that column fell back to then collided with a real one.
  const emptyHeader = {};
  rawUnion.forEach(name => {
    let seen = false;
    files.forEach(f => {
      const i = f.parsed.header.indexOf(name);
      if (i === -1) return;
      f.parsed.rows.forEach(r => { if (String(r[i] === undefined ? '' : r[i]).trim() !== '') seen = true; });
    });
    if (!seen) emptyHeader[name] = true;
  });
  const partInputs = rawUnion.filter(n => !emptyHeader[n]);
  const meltParts = pend.melt.on && pend.melt.kind === 'parts';
  pend.meltPat = pend.melt.on && !meltParts ? compilePattern(pend.melt) : null;
  const live = pend.meltPat && pend.meltPat.ok ? pend.meltPat : null;
  pend.meltPreview = live ? patternPreview(live, rawUnion) : null;
  // The column names read as a set of parts rather than as a sequence: the
  // same two proposals, against the header instead of against a column.
  pend.meltParts = null;
  pend.meltPartGroups = [];
  if (meltParts && partInputs.length) {
    const mcfg = pend.melt.parts
      || (pend.melt.parts = { seps: PART_SEPS_DEFAULT, assign: {}, groupCfg: {}, measureGid: null });
    const got = derivePartGroups(partInputs, mcfg);
    pend.meltParts = got.found;
    pend.meltPartInputs = partInputs;
    pend.meltPartGroups = got.groups;
    if (mcfg.measureGid && !got.groups.some(g => g.gid === mcfg.measureGid)) mcfg.measureGid = null;
  }
  // A column is claimed by a parts melt when it carries a part that is still in
  // play. That is what keeps the id columns out of it: `execution_name` has
  // parts of its own, and ignoring them is what says it is not a value column.
  const claimsByParts = name => {
    if (!meltParts || !pend.meltPartGroups.length || emptyHeader[name]) return false;
    const seps = pend.melt.parts.seps;
    return pend.meltPartGroups.some(g => g.parts.some(p => labelHasPart(name, p.name, seps)));
  };

  // ---- columns the melt did not claim, profiled as before -------------------
  const idNames = [];
  files.forEach(f => {
    const raw = f.parsed.header;
    const ded = dedupeHeader(raw);
    for (let i = 0; i < raw.length; i++) {
      if (live && matchPattern(live, raw[i])) continue;
      if (claimsByParts(raw[i])) continue;
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

  // ---- the pattern over one column's values --------------------------------
  // The row labels are as often compound as the column labels: `16x4` is a
  // width and a height. Same pattern language, same preview, but written
  // against the column's distinct values rather than against header names.
  pend.splitCandidates = pend.columns.filter(c => c.role !== 'measure');
  if (pend.split.on && !pend.splitCandidates.some(c => c.source === pend.split.source)) {
    // the chosen column became a measure, or the melt claimed it
    pend.split.source = pend.splitCandidates.length ? pend.splitCandidates[0].source : null;
  }
  pend.splitInputs = pend.split.on && pend.split.source
    ? columnValues(pend, pend.split.source) : [];
  const asParts = pend.split.on && pend.split.kind === 'parts';
  pend.splitPat = pend.split.on && pend.split.source && !asParts
    ? compilePattern(pend.split) : null;
  pend.splitPreview = pend.splitPat && pend.splitPat.ok
    ? patternPreview(pend.splitPat, pend.splitInputs) : null;
  pend.splitDims = [];
  pend.splitMisses = pend.splitPreview
    ? pend.splitPreview.rows.filter(r => !r.ok).map(r => r.input) : [];
  pend.parts = null;
  if (asParts && pend.splitInputs.length) {
    const cfg = pend.split.parts || (pend.split.parts = { seps: PART_SEPS_DEFAULT, assign: {}, groupCfg: {} });
    const got = derivePartGroups(pend.splitInputs, cfg);
    pend.parts = got.found;
    pend.partGroups = got.groups;
    // every group is a dimension, and reads exactly like a pattern field below
    pend.partGroups.forEach(g => {
      pend.splitDims.push({ field: g.gid, cfg: g.cfg, values: g.values, group: g });
    });
  }
  if (pend.splitPreview) {
    pend.splitPat.fields.forEach((field, i) => {
      const cfg = pend.split.fieldCfg[field]
        || (pend.split.fieldCfg[field] = {
          key: field, label: field, include: !pend.reconstructed, labelOverride: {},
        });
      // a value the pattern missed keeps its whole text under the first field,
      // so those are values of it and belong in its domain here too
      const values = (pend.splitPreview.values[field] || [])
        .concat(i === 0 ? pend.splitMisses.filter(v => (pend.splitPreview.values[field] || []).indexOf(v) === -1) : []);
      if (values.indexOf('') !== -1 && cfg.labelOverride[''] === undefined) cfg.labelOverride[''] = 'base';
      pend.splitDims.push({ field, cfg, values });
    });
  }

  // ---- melt dimensions and measures ----------------------------------------
  pend.meltDims = [];
  pend.meltMeasures = [];
  pend.meltGroupsPerFile = files.map(() => 1);
  if (live && pend.meltPreview) {
    live.fields.forEach(field => {
      if (field === PATTERN_MEASURE_FIELD) return;
      const cfg = pend.melt.fieldCfg[field]
        || (pend.melt.fieldCfg[field] = {
          key: field, label: field, include: !pend.reconstructed, labelOverride: {},
        });
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
        const sig = pend.meltDims.map(d => m.fields[d.field] || '').join(SIG_SEP);
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
  } else if (meltParts && pend.meltPartGroups.length) {
    // The same shape from the other reading: every group is a dimension, except
    // the one told to pick the measure -- which is `{measure}` by another name.
    const mcfg = pend.melt.parts;
    const seps = mcfg.seps;
    const measureGroup = pend.meltPartGroups.filter(g => g.gid === mcfg.measureGid)[0] || null;
    pend.meltPartGroups.forEach(g => {
      if (measureGroup && g.gid === measureGroup.gid) return;
      pend.meltDims.push({ field: g.gid, cfg: g.cfg, values: g.values, group: g });
    });
    const order = [];
    const pools = {};
    let usesFallback = false;
    files.forEach((f, fi) => {
      const raw = f.parsed.header;
      const sigs = {};
      let groups = 0;
      for (let i = 0; i < raw.length; i++) {
        if (!claimsByParts(raw[i])) continue;
        const captured = measureGroup
          ? (measureGroup.parts.filter(p => labelHasPart(raw[i], p.name, seps))[0] || { name: '' }).name
          : '';
        if (!captured) usesFallback = true;
        else if (order.indexOf(captured) === -1) order.push(captured);
        const sig = pend.meltDims.map(d => partValueAt(
          { parts: d.group.parts.map(p => p.name) }, raw[i], seps)).join(SIG_SEP);
        if (!sigs[sig]) { sigs[sig] = 1; groups++; }
        const pool = pools[captured] || (pools[captured] = []);
        f.parsed.rows.forEach(r => pool.push(r[i]));
      }
      pend.meltGroupsPerFile[fi] = groups;
    });
    const mk = (value, fallback) => {
      const cfg = pend.melt.measureCfg[value] || (pend.melt.measureCfg[value] = {});
      if (cfg.label === undefined) cfg.label = value || meltFallbackName(pend);
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
      else if (claimsByParts(raw[i])) ms[meltPartMeasureAt(pend, raw[i])] = 1;
      else ids.push(ded[i]);
    }
    return ids.sort().join(SIG_SEP) + SIG_GROUP + Object.keys(ms).sort().join(SIG_SEP);
  };
  pend.sameShape = files.every(f => sig(f) === sig(files[0]));
  // Refusing outright was too strong: two runs of the same experiment where one
  // recorded a column the other did not are still one dataset, and pasting them
  // together by hand is the alternative. So it stays off by default and asks.
  if (!pend.sameShape && !pend.forceUnion) pend.union = false;
  pend.partialCols = pend.columns.filter(
    c => c.role !== 'ignore' && c.profile.files !== undefined && c.profile.files < files.length);

  pend.rowCount = files.reduce((n, f) => n + f.parsed.rows.length, 0);
  pend.emitted = files.reduce((n, f, i) => n + f.parsed.rows.length * pend.meltGroupsPerFile[i], 0);

  // a filled gap is a value of that dimension like any other, so it counts
  const filling = pend.union && !pend.sameShape;
  const dimCounts = pend.columns.filter(c => c.role === 'dimension')
    .map(c => Math.max(c.profile.distinct, 1)
      + (filling && pend.partialCols.indexOf(c) !== -1 ? 1 : 0))
    .concat(pend.pathDims.map(d => Math.max(d.values.length, 1)))
    .concat(pend.splitDims.filter(d => d.cfg.include).map(d => Math.max(d.values.length, 1)))
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
  pend.splitDims.forEach(d => { if (d.cfg.include) claim(d.cfg.key); });
  pend.meltDims.forEach(d => { if (d.cfg.include) claim(d.cfg.key); });
  pend.meltMeasures.forEach(m => claim(m.value || meltFallbackKey(pend)));
}

// Every distinct value of one column, in the order the files give them: what a
// split pattern is written against, the way the header names are what the melt
// pattern is written against.
function columnValues(pend, source) {
  const out = [];
  const seen = {};
  pend.files.forEach(f => {
    const i = dedupeHeader(f.parsed.header).indexOf(source);
    if (i === -1) return;
    f.parsed.rows.forEach(r => {
      const v = String(r[i] === undefined ? '' : r[i]).trim();
      if (seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
  });
  return out;
}

// Which measure a header lands in under a parts melt: the part of the group
// told to pick the measure, or nothing, which means the one measure it melts to.
function meltPartMeasureAt(pend, name) {
  const cfg = pend.melt.parts;
  if (!cfg || !cfg.measureGid) return '';
  const g = (pend.meltPartGroups || []).filter(x => x.gid === cfg.measureGid)[0];
  if (!g) return '';
  const hit = g.parts.filter(p => labelHasPart(name, p.name, cfg.seps))[0];
  return hit ? hit.name : '';
}

// The parts of a set of labels, grouped into the dimensions they suggest.
//
// The proposal is recomputed from the labels every time, but every decision the
// user has made about it is kept -- which group a part is in, and what that
// group is called -- so editing one row does not re-shuffle the others. Shared
// by the column names and a column's values, which read their labels the same
// way and differ only in which labels they are.
function derivePartGroups(inputs, cfg) {
  const found = analyseParts(inputs, cfg.seps);
  if (!cfg.assign) cfg.assign = {};
  if (!cfg.groupCfg) cfg.groupCfg = {};
  const auto = {};
  found.groups.forEach((g, gi) => g.parts.forEach(p => { auto[p] = 'g' + gi; }));
  const order = [];
  const byGid = {};
  found.parts.forEach(p => {
    if (p.everywhere) return;              // in every label: distinguishes nothing
    let gid = cfg.assign[p.name];
    // `defaultOff` is a reconstructed config, whose groups name every part that
    // was in play: anything else was put aside, and proposing a group for it
    // would put it back.
    if (gid === undefined) {
      gid = cfg.assign[p.name] = cfg.defaultOff ? 'off' : (auto[p.name] || 'g0');
    }
    if (gid === 'off') return;
    if (!byGid[gid]) { byGid[gid] = { gid: gid, parts: [] }; order.push(byGid[gid]); }
    byGid[gid].parts.push(p);
  });
  const groups = order.map(g => {
    // the config object itself, not a copy: the column table edits it
    const gc = cfg.groupCfg[g.gid] || (cfg.groupCfg[g.gid] = { include: true, labelOverride: {} });
    // The name follows the membership until it is typed. A group named after
    // the parts it had keeps that name when they leave, and then reads as a
    // dimension of something it no longer contains.
    if (gc.label === undefined || !gc.labelTouched) {
      gc.label = partGroupName(g.parts.map(p => p.name));
      gc.key = keyFromLabel(gc.label, g.gid);
    }
    if (gc.key === undefined) gc.key = keyFromLabel(gc.label, g.gid);
    if (gc.include === undefined) gc.include = true;
    if (!gc.labelOverride) gc.labelOverride = {};
    const names = g.parts.map(p => p.name);
    const covered = g.parts.reduce((n, p) => n + p.count, 0);
    const values = names.length === 1
      ? [names[0], partAbsent(names[0])]
      : names.concat(covered < found.total ? [PART_NONE] : []);
    return { gid: g.gid, cfg: gc, parts: g.parts, values: values };
  });
  return { found: found, groups: groups };
}

// What to call a dimension made of several parts. What they have in common, if
// that is anything to speak of -- three kernels called posterization-something
// are a "posterization" -- and otherwise the first of them, which at least
// names one real value of it. Either way it is a proposal the review can rename.
function partGroupName(names) {
  if (names.length === 1) return names[0];
  let prefix = names[0] || '';
  names.forEach(n => {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  });
  prefix = prefix.replace(/[-_/\s]+$/, '');
  return prefix.length >= 3 ? prefix : names[0];
}

// A display name, as a key: lower case, one underscore per run of anything else.
function keyFromLabel(label, fallback) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    || fallback;
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
  const splitReady = pend.split.kind === 'parts'
    ? !!(pend.parts && pend.partGroups && pend.partGroups.length)
    : !!(pend.splitPat && pend.splitPat.ok);
  const liveSplit = splitReady && pend.splitDims.some(d => d.cfg.include)
    ? pend.split.source : null;
  const recipe = {
    columns: pend.columns.filter(c => present[c.source]).map(c => {
      const out = {
        source: c.source, name: c.name, label: c.label, role: c.role,
        format: c.format, agg: c.agg,
      };
      // written only where there is one, so a tidy import still stores exactly
      // the recipe it always stored
      if (c.source === liveSplit && pend.split.kind === 'parts') {
        // the groups as they stand, not the rule that proposed them: the
        // proposal was a starting point the user may have changed, and
        // re-deriving it on load would undo that the moment a value was added
        out.split = {
          parts: {
            seps: pend.split.parts.seps,
            groups: pend.partGroups.filter(g => g.cfg.include !== false).map(g => ({
              key: g.cfg.key, label: g.cfg.label,
              parts: g.parts.map(p => p.name),
              labelOverride: g.cfg.labelOverride || {},
            })),
          },
        };
      } else if (c.source === liveSplit) {
        out.split = {
          pattern: { kind: pend.split.kind, text: pend.split.text },
          fields: pend.splitDims.filter(d => d.cfg.include).map(d => ({
            field: d.field, key: d.cfg.key, label: d.cfg.label, labelOverride: d.cfg.labelOverride,
          })),
        };
      }
      return out;
    }),
    sourceDim: pend.addSourceDim && files.length > 1 ? '__source' : null,
    sourceLabel: 'Source',
    parse: {},
  };
  // Only files whose selection is not "everything" are written, so a tidy
  // import still stores exactly the recipe it always stored.
  const presel = {};
  let anyPresel = false;
  files.forEach(f => {
    if (selectionIsDefault(f.selection, f.rawParsed)) return;
    presel[f.path || f.filename] = {
      total: f.selection.total,
      rows: f.selection.rows.map(r => r.slice()),
      cols: f.selection.cols.slice(),
    };
    anyPresel = true;
  });
  if (anyPresel) recipe.parse.preselect = presel;
  // only when it can do something: a tidy import must still write the recipe it
  // always wrote, so that reading one back proves nothing changed
  if (pend.union && !pend.sameShape) recipe.fill = pend.fill;

  const live = pend.meltPat && pend.meltPat.ok ? pend.meltPat : null;
  const liveMeltParts = pend.melt.on && pend.melt.kind === 'parts' && pend.meltPartGroups.length;
  if (liveMeltParts) {
    const fallbackKey = meltFallbackKey(pend);
    const mcfg = pend.melt.parts;
    recipe.melt = {
      parts: {
        seps: mcfg.seps,
        groups: pend.meltPartGroups.map(g => ({
          key: g.cfg.key, label: g.cfg.label, parts: g.parts.map(p => p.name),
          labelOverride: g.cfg.labelOverride || {},
          measure: g.gid === mcfg.measureGid,
        })),
      },
      measure: { key: fallbackKey, label: meltFallbackName(pend),
        format: (pend.melt.measureCfg[''] || {}).format || 'number', agg: 'mean' },
      measures: pend.meltMeasures.filter(m => !m.fallback).map(m => ({
        value: m.value, key: m.value, label: m.cfg.label || m.value,
        format: m.cfg.format || 'number', agg: 'mean',
      })),
    };
  } else if (live) {
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

// The decisions themselves, stored beside the recipe they produced.
//
// A recipe is what the row loop needs; this is what the review needs, and the
// two are not the same thing -- the recipe records what was included and is
// silent about what was not, which is exactly the half a re-opened review has
// to show. Reconstructing it from the recipe is possible and is what a dataset
// imported before this existed gets, but storing it is exact, so a dataset
// imported since is never reconstructed at all.
//
// Detached, because everything below is edited in place while the review is
// open: a live reference would keep changing after it was stored.
function importUiState(pend) {
  return JSON.parse(JSON.stringify({
    melt: pend.melt, split: pend.split, path: pend.path,
    union: pend.union, forceUnion: pend.forceUnion, fill: pend.fill,
    addSourceDim: pend.addSourceDim,
  }));
}

function commitImport() {
  const pend = pendingImport;
  if (!pend) return Promise.resolve();
  // The name typed in the review is the name it is stored under. It used to be
  // read only when several files were being unioned, so for the commonest
  // import of all -- one file -- the field did nothing and the dataset arrived
  // called after the file anyway, to be renamed on the Data tab afterwards.
  // Several files kept apart become one dataset each and are still named after
  // their own file, since one typed name cannot name all of them.
  const typed = (pend.name || '').trim();
  const groups = pend.union
    ? [{ name: typed || pend.name, files: pend.files }]
    : pend.files.map(f => ({
      name: (pend.files.length === 1 && typed) ? typed : stemOf(f.filename),
      files: [f],
    }));

  const records = groups.map(g => ({
    id: newDatasetId(),
    name: g.name,
    createdAt: Date.now(),
    recipe: recipeFromPending(pend, g.files),
    ui: importUiState(pend),
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
    forgetDataset(id);
    // A plot pinned to it is not removed -- it falls back to the page's data
    // and says on its own card what happened, which is recoverable; deleting
    // someone's plot because they deleted a dataset is not.
    //
    // It has to be REPAIRED, though, not merely redrawn: its filters still name
    // measures and values of the dataset that just went away, and the page's
    // has never heard of them. That is what the restore path is for, so the
    // plots go back through it -- keeping the pin, so the card can still say
    // which dataset it is missing.
    if (plots.some(p => p.datasetId === id)) applyConfig(serializePlots());
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
    // a tick that outlived its dataset would silently combine the wrong things
    Object.keys(datasetPicks).forEach(id => {
      if (!records.some(r => r.id === id)) delete datasetPicks[id];
    });
    records.forEach(rec => {
      const card = html('div', 'dataset-card' + (rec.id === active ? ' active' : ''), wrap);
      card.setAttribute('data-id', rec.id);
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'dataset-pick';
      pick.id = 'dataset-pick-' + rec.id;
      pick.checked = !!datasetPicks[rec.id];
      pick.title = 'Select to combine with another dataset';
      pick.addEventListener('change', () => {
        if (pick.checked) datasetPicks[rec.id] = true; else delete datasetPicks[rec.id];
        renderDataPanel();
      });
      card.appendChild(pick);
      const title = html('div', 'dataset-name', card);
      title.textContent = rec.name;
      // Renaming swaps the caption for a field in place rather than opening
      // anything: the name is one word and a dialog for it would be theatre.
      const startRename = () => {
        if (card.querySelector('.dataset-rename')) return;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'name-input dataset-rename';
        inp.id = 'dataset-rename-' + rec.id;
        inp.value = rec.name;
        let done = false;
        const finish = save => {
          if (done) return;
          done = true;
          const next = inp.value.trim();
          if (!save || !next || next === rec.name) { renderDataPanel(); return; }
          renameDataset(rec.id, next).then(okDone => {
            setDataStatus(okDone ? 'Renamed to "' + next + '".' : 'Could not rename that dataset.');
            renderDataPanel();
          });
        };
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        inp.addEventListener('blur', () => finish(true));
        card.replaceChild(inp, title);
        try { inp.focus(); inp.select(); } catch (e) {}
      };
      title.title = 'Click to rename';
      title.addEventListener('click', startRename);
      const meta = html('div', 'dataset-meta', card);
      const shape = recordShape(rec);
      meta.textContent = shape.dims + ' dimension' + (shape.dims === 1 ? '' : 's') + ' · '
        + shape.measures + ' measure' + (shape.measures === 1 ? '' : 's') + ' · '
        + shape.files + ' file' + (shape.files === 1 ? '' : 's')
        + (shape.parts > 1 ? ' · combined from ' + shape.parts + ' datasets' : '')
        + (rec.createdAt ? ' · imported ' + importedWhen(rec.createdAt) : '');
      // Which bytes this came from, on request. A dataset is renamed as soon as
      // it arrives -- the name it came with says where the file was, and this is
      // then the only thing that still does.
      const filesOpen = !!datasetFilesOpen[rec.id];
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn small ghost dataset-files-toggle';
      more.setAttribute('data-id', rec.id);
      more.textContent = (filesOpen ? '▾' : '▸') + ' Where from';
      more.title = 'The files this was built from, and how they were read';
      more.addEventListener('click', () => {
        if (filesOpen) delete datasetFilesOpen[rec.id]; else datasetFilesOpen[rec.id] = true;
        renderDataPanel();
      });
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(more);
      if (filesOpen) renderDatasetSources(card, rec);
      const acts = html('div', 'dataset-actions', card);
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn small'; open.textContent = 'Open';
      open.title = 'Show this dataset on the builder; plots that follow the page will read it';
      open.addEventListener('click', () => activateDataset(rec.id));
      acts.appendChild(open);
      // The other way in, and the one that does not disturb anything: a plot of
      // its own, pinned to this dataset, added after whatever is already there.
      const addPlot = document.createElement('button');
      addPlot.type = 'button'; addPlot.className = 'btn small dataset-add-plot';
      addPlot.textContent = 'Add a plot from this';
      addPlot.title = 'Add a plot reading this dataset, leaving the plots already on the page alone';
      addPlot.addEventListener('click', () => addPlotFromDataset(rec.id));
      acts.appendChild(addPlot);
      const ren = document.createElement('button');
      ren.type = 'button'; ren.className = 'btn small'; ren.textContent = 'Rename';
      ren.addEventListener('click', startRename);
      acts.appendChild(ren);
      // The recipe, back on the screen it was written on. Offered on every card
      // -- including the ones it cannot serve, which say why when asked, since
      // a button that is missing on some cards and not others explains nothing.
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'btn small dataset-edit';
      edit.textContent = 'Edit import';
      edit.title = 'Re-open the review: rename columns, change roles, redo a split';
      edit.addEventListener('click', () => editDataset(rec.id));
      acts.appendChild(edit);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn small danger'; del.textContent = 'Delete';
      del.addEventListener('click', () => deleteDataset(rec.id));
      acts.appendChild(del);
    });
    renderCombineBar(wrap, records);
  }).catch(() => {});
}

// When it was imported, written so it sorts and reads the same everywhere: a
// locale-formatted date would say 07/08 to one reader and 08/07 to another, and
// this is a provenance line.
function importedWhen(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'at an unknown time';
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// A one-line account of how a recipe read its files, so the card says what was
// done to the bytes and not only which bytes they were.
function recipeSummary(recipe) {
  const bits = [];
  const r = recipe || {};
  if (r.melt && r.melt.pattern) {
    bits.push(r.melt.pattern.kind === 'parts'
      ? 'column names cut into parts'
      : 'column names split by ' + r.melt.pattern.text);
  }
  (r.columns || []).forEach(c => {
    if (!c.split) return;
    bits.push(c.split.parts
      ? 'values of ' + c.source + ' cut into parts on "' + c.split.parts.seps + '"'
      : 'values of ' + c.source + ' split by ' + c.split.pattern.text);
  });
  if (r.path && (r.path.levels || []).length) {
    bits.push((r.path.levels || []).length + ' folder level'
      + ((r.path.levels || []).length === 1 ? '' : 's') + ' read as dimensions');
  }
  if (r.path && r.path.pattern) bits.push('file names split by ' + r.path.pattern.spec.text);
  if (r.sourceDim) bits.push('a Source dimension naming each file');
  if (r.fill !== undefined && r.fill !== null) bits.push('gaps filled with "' + r.fill + '"');
  return bits;
}

function renderDatasetSources(card, rec) {
  const box = html('div', 'dataset-sources', card);
  box.setAttribute('data-id', rec.id);
  const parts = recordParts(rec);
  parts.forEach(p => {
    if (parts.length > 1) html('div', 'dataset-part-name', box).textContent = p.name;
    if (!p.sources.length) {
      html('div', 'import-note', box).textContent = 'no files recorded';
    }
    p.sources.forEach(s => {
      const row = html('div', 'dataset-file', box);
      html('span', 'dataset-file-name', row).textContent = s.filename || s.path || 'source.csv';
      // The path is what says WHICH of the six files called results.csv this is.
      if (s.path && s.path !== s.filename) {
        html('span', 'dataset-file-path', row).textContent = s.path;
      }
      if (s.text) {
        html('span', 'dataset-file-size', row).textContent =
          Math.max(1, Math.round(s.text.length / 1024)) + ' KB';
      }
    });
    recipeSummary(p.recipe).forEach(t => {
      html('div', 'dataset-file-note', box).textContent = t;
    });
  });
}

// Two or more picked: what combining them would produce, and the button that
// does it. It appears only once there is something to combine, because a form
// that is disabled nine visits in ten is furniture.
function renderCombineBar(wrap, records) {
  const picked = records.filter(r => datasetPicks[r.id]);
  if (picked.length < 2) {
    if (picked.length === 1) {
      html('div', 'dataset-hint', wrap).textContent =
        'Tick a second dataset to combine it with "' + picked[0].name + '".';
    }
    return;
  }
  const bar = html('div', 'dataset-combine', wrap);
  bar.id = 'dataset-combine';
  html('div', 'dim-label', bar).textContent = 'Combine ' + picked.length + ' datasets';
  html('div', 'import-note', bar).textContent =
    picked.map(r => r.name).join(' + ') + ' — rows appended on the union of their '
    + 'dimensions and measures. What one of them has not got is filled in; the '
    + 'originals are kept.';

  const nameRow = html('label', 'radio-row', bar);
  html('span', null, nameRow).textContent = 'Call it';
  const nameInput = textField(nameRow, 'combine-name', picked.map(r => r.name).join(' + '),
    () => {});

  const dimRow = html('label', 'radio-row', bar);
  const dimCb = document.createElement('input');
  dimCb.type = 'checkbox'; dimCb.checked = true; dimCb.id = 'combine-dim';
  dimRow.appendChild(dimCb);
  html('span', null, dimRow).textContent = 'add a Dataset dimension naming each';
  html('span', 'radio-hint', dimRow).textContent =
    'without it, rows that agree on every dimension are averaged together';

  const fillRow = html('label', 'radio-row', bar);
  html('span', null, fillRow).textContent = 'Fill what one of them has not got with';
  const fillInput = textField(fillRow, 'combine-fill', 'n/a', () => {});

  const go = document.createElement('button');
  go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Combine';
  go.addEventListener('click', () => {
    go.disabled = true;
    combineDatasets(picked.map(r => r.id), {
      name: nameInput.value.trim() || picked.map(r => r.name).join(' + '),
      partDim: dimCb.checked,
      fill: fillInput.value,
    }).then(made => {
      if (!made) { setDataStatus('Could not combine those datasets.'); renderDataPanel(); return; }
      Object.keys(datasetPicks).forEach(k => delete datasetPicks[k]);
      setActiveDatasetId(made.rec.id);
      startWithDataset(made.ds);
      setDataStatus('Combined into "' + made.rec.name + '" — '
        + made.ds.nRows + ' rows over ' + made.ds.dims.length + ' dimensions.');
      renderDataPanel();
      showMode('builder');
    }).catch(e => {
      setDataStatus('Could not combine those datasets: ' + e.message);
      renderDataPanel();
    });
  });
  html('div', 'import-actions', bar).appendChild(go);
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
function patternBox(host, id, cfg, inputs, onChange, subject, opts) {
  const o = opts || {};
  const row = html('div', 'reshape-row', host);
  if (!o.noDialect) {
    selectField(row, [['template', 'Template'], ['regex', 'Regular expression']], cfg.kind, v => {
      cfg.kind = v;
      onChange();
    });
  }
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

  // The list is what you write the pattern AGAINST, so it is shown from the
  // start and stays put when the pattern is wrong -- the error belongs beside
  // the names, not instead of them.
  const live = compiled && compiled.ok ? compiled : null;
  const preview = patternPreview(live, inputs || []);
  const head = html('div', 'import-summary', host);
  head.textContent = !cfg.text.trim()
    ? preview.total + ' ' + subject + ' — type a pattern above to split them'
    : !live
      ? preview.total + ' ' + subject + ', nothing split yet: the pattern above is not valid'
      : preview.matched + ' of ' + preview.total + ' ' + subject + ' matched'
        + (preview.matched < preview.total
          ? '; ' + (preview.total - preview.matched) + ' left alone' : '');
  const table = html('table', 'melt-preview', host);
  const hr = html('tr', null, html('thead', null, table));
  html('th', null, hr).textContent = o.head
    || (subject === 'column names' ? 'Column' : 'File');
  preview.fields.forEach(f => { html('th', null, hr).textContent = f; });
  const tb = html('tbody', null, table);
  preview.rows.slice(0, 40).forEach(r => {
    const tr = html('tr', r.ok ? null : 'melt-miss', tb);
    tr.setAttribute('data-name', r.input);
    html('td', 'col-source', tr).textContent = r.input;
    if (!r.ok) {
      const td = html('td', 'col-profile', tr);
      td.colSpan = Math.max(preview.fields.length, 1);
      td.textContent = live ? (o.miss || 'no match — kept as it is') : '—';
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

  // The same three readings the values get: a header is a label like any other.
  const dial = html('div', 'reshape-row', wrap);
  const dsel = selectField(dial,
    [['template', 'Template'], ['regex', 'Regular expression'], ['parts', 'Parts (separators)']],
    pend.melt.kind, v => { pend.melt.kind = v; refreshReshape(); });
  dsel.id = 'melt-kind';
  html('span', 'radio-hint', dial).textContent = pend.melt.kind === 'parts'
    ? 'for headers built from a fixed vocabulary in any order — total_acc_variance_avg'
    : 'for headers whose pieces are always in the same places';

  if (pend.melt.kind === 'parts') {
    renderPartsBox(wrap, {
      cfg: pend.melt.parts, found: pend.meltParts, groups: pend.meltPartGroups,
      inputs: pend.meltPartInputs, idPrefix: 'melt', subject: 'column names',
      measure: true,
    });
  } else {
    patternBox(wrap, 'melt-pattern', pend.melt, pend.meltInputs, () => refreshReshape(),
      'column names', { noDialect: true });
    if (pend.meltPreview && pend.meltPreview.matched === 0) {
      html('div', 'import-warn', wrap).textContent =
        'That pattern matches none of the column names, so there would be nothing to plot.';
    }
  }
  if (pend.melt.kind === 'parts' && !(pend.melt.parts || {}).measureGid) {
    const row = html('label', 'radio-row', wrap);
    html('span', 'derive-label', row).textContent = 'Call the value';
    textField(row, 'melt-fallback-name', pend.melt.fallback.name, v => {
      pend.melt.fallback.name = v;
      const m = pend.meltMeasures[0];
      if (m) m.cfg.label = v;
      refreshReshapeSoon();
    });
    html('span', 'radio-hint', row).textContent =
      'or set one of the parts above to pick the measure instead';
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

// The same block again for the other axis: one column whose VALUES carry
// dimensions. It is one column rather than all of them because a compound row
// label is one column's habit -- the first one -- and a pattern box per column
// would be a screen of them.
function renderSplitBlock(box, pend) {
  const wrap = html('div', 'import-split', box);
  const head = html('label', 'radio-row', wrap);
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'split-enable';
  cb.checked = pend.split.on;
  cb.addEventListener('change', () => {
    pend.split.on = cb.checked;
    const col = splitColumn(pend);
    if (cb.checked) {
      if (!pend.split.source && pend.splitCandidates.length) pend.split.source = pend.splitCandidates[0].source;
      const first = splitColumn(pend);
      if (first) first.role = 'ignore';
    } else if (col && col.role === 'ignore') { col.role = 'dimension'; }
    refreshReshape();
  });
  head.appendChild(cb);
  html('span', null, head).textContent = 'A column\'s values carry dimensions';
  html('span', 'radio-hint', head).textContent = 'e.g. 16x4 is a block width and a height';
  if (!pend.split.on) return;

  if (!pend.splitCandidates.length) {
    html('div', 'import-warn', wrap).textContent =
      'Every column is a measure — there is no column of labels to split.';
    return;
  }

  const pickRow = html('label', 'radio-row', wrap);
  html('span', 'derive-label', pickRow).textContent = 'Split the values in';
  const sel = selectField(pickRow, pend.splitCandidates.map(c => [c.source, c.source]),
    pend.split.source, v => {
      const was = splitColumn(pend);
      if (was && was.role === 'ignore') was.role = 'dimension';
      pend.split.source = v;
      pend.split.fieldCfg = {};
      pend.split.parts = null;             // another column, other parts
      const now = splitColumn(pend);
      if (now) now.role = 'ignore';
      refreshReshape();
    });
  sel.id = 'split-column';

  // Two ways to read a label, offered side by side because they suit different
  // labels: a pattern reads one by position, parts read one as a set of flags.
  const dial = html('div', 'reshape-row', wrap);
  const dsel = selectField(dial,
    [['template', 'Template'], ['regex', 'Regular expression'], ['parts', 'Parts (separators)']],
    pend.split.kind, v => { pend.split.kind = v; refreshReshape(); });
  dsel.id = 'split-kind';
  html('span', 'radio-hint', dial).textContent = pend.split.kind === 'parts'
    ? 'for a label that is a base name with flags stuck on it, in any number and any order'
    : 'for a label whose pieces are always in the same places';

  if (pend.split.kind === 'parts') {
    renderPartsBox(wrap, {
      cfg: pend.split.parts, found: pend.parts, groups: pend.partGroups,
      inputs: pend.splitInputs, idPrefix: 'split', subject: 'values',
    });
  } else {
    patternBox(wrap, 'split-pattern', pend.split, pend.splitInputs, () => refreshReshape(),
      'values', { head: 'Value', noDialect: true,
        miss: 'no match — kept whole under {' + (pend.splitPat && pend.splitPat.fields[0]
          ? pend.splitPat.fields[0] : '…') + '}' });
    if (pend.splitPreview && pend.splitPreview.matched === 0) {
      html('div', 'import-warn', wrap).textContent =
        'That pattern matches none of the values in that column, so it would split nothing.';
    }
  }

  const col = splitColumn(pend);
  if (col) {
    const keepRow = html('label', 'radio-row', wrap);
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.id = 'split-keep';
    keep.checked = col.role !== 'ignore';
    keep.addEventListener('change', () => { col.role = keep.checked ? 'dimension' : 'ignore'; refreshReshape(); });
    keepRow.appendChild(keep);
    html('span', null, keepRow).textContent = 'keep "' + col.source + '" itself as a dimension too';
    html('span', 'radio-hint', keepRow).textContent = pend.splitMisses.length
      ? 'the parts already tell the rows apart, including the ' + pend.splitMisses.length
        + ' the pattern did not match'
      : 'the parts already tell the rows apart';
  }
}

function splitColumn(pend) {
  return (pend.columns || []).filter(c => c.source === pend.split.source)[0] || null;
}

// Reading a label as a set of parts rather than as a sequence of fields.
//
// Two proposals are made and both are shown as the controls that undo them:
// parts never seen apart are one part (`cu` and `mode` are `cu_mode`), and
// parts never seen together are one dimension (`s2000` and `s5000` are two
// sleeps, not two flags). A part in every label is dropped, since it
// distinguishes nothing -- the same rule the folder levels use.
function renderPartsBox(host, o) {
  const cfg = o.cfg;
  const subject = o.subject || 'values';
  const row = html('div', 'reshape-row', host);
  html('span', 'derive-label', row).textContent = 'Separators';
  const inp = textField(row, o.idPrefix + '-seps', cfg.seps, v => {
    cfg.seps = v;
    // the parts are different now, so the old grouping is about other things
    cfg.assign = {};
    cfg.groupCfg = {};
    cfg.measureGid = null;
    refreshReshapeSoon();
  }, 'pattern-input');
  inp.spellcheck = false;
  html('span', 'radio-hint', row).textContent = 'each of these characters cuts the label';

  const found = o.found;
  if (!found || !found.parts.length) {
    html('div', 'import-warn', host).textContent =
      'Those separators do not cut these ' + subject + ' into anything.';
    return;
  }
  const kept = found.parts.filter(p => !p.everywhere);
  const groups = o.groups || [];
  const dimCount = groups.filter(g => !(o.measure && g.gid === cfg.measureGid)).length;
  html('div', 'import-summary', host).textContent =
    found.total + ' ' + subject + ' → ' + kept.length + ' part' + (kept.length === 1 ? '' : 's')
    + ' → ' + dimCount + ' dimension' + (dimCount === 1 ? '' : 's')
    + (o.measure && cfg.measureGid ? ', one of them picking the measure' : '');
  const everywhere = found.parts.filter(p => p.everywhere);
  if (everywhere.length) {
    html('div', 'import-note', host).textContent =
      everywhere.map(p => p.name).join(', ') + (everywhere.length === 1 ? ' is' : ' are')
      + ' in every value, so ' + (everywhere.length === 1 ? 'it names' : 'they name')
      + ' nothing and ' + (everywhere.length === 1 ? 'is' : 'are') + ' left out.';
  }

  // Which group names the measure. `{measure}` by another name: a part of that
  // group picks which column the number lands in rather than which row.
  if (o.measure) {
    const mrow = html('label', 'radio-row', host);
    html('span', 'derive-label', mrow).textContent = 'The measure is named by';
    const msel = selectField(mrow,
      [['', 'nothing — one measure']].concat(groups.map(g => [g.gid, g.cfg.label])),
      cfg.measureGid || '', v => { cfg.measureGid = v || null; refreshReshape(); });
    msel.id = o.idPrefix + '-measure-group';
    html('span', 'radio-hint', mrow).textContent =
      'its parts become the measures, each with its own format';
  }

  const table = html('table', 'melt-preview parts-table', host);
  const hr = html('tr', null, html('thead', null, table));
  ['Part', 'In', 'Part of'].forEach(h => { html('th', null, hr).textContent = h; });
  const tb = html('tbody', null, table);
  let nextGid = 0;
  Object.keys(cfg.assign).forEach(k => {
    const m = /^g(\d+)$/.exec(cfg.assign[k]);
    if (m) nextGid = Math.max(nextGid, Number(m[1]) + 1);
  });
  kept.forEach(p => {
    const tr = html('tr', null, tb);
    tr.setAttribute('data-part', p.name);
    html('td', 'col-source', tr).textContent = p.name;
    html('td', 'col-profile', tr).textContent = p.count + ' of ' + found.total;
    const td = html('td', null, tr);
    // Every dimension by name, including the one this part is already in and
    // the one it is alone in. Describing a group by its role instead ("its own
    // dimension") left the list with an entry that named no dimension, so the
    // one you wanted to move a part into was the one you could not see.
    const opts = groups.map(g => ['gid:' + g.gid, 'a value of ' + g.cfg.label])
      .concat([['new', '— a dimension of its own —'], ['off', '— ignore it —']]);
    const cur = cfg.assign[p.name];
    const mine = groups.filter(g => g.gid === cur)[0];
    const value = cur === 'off' ? 'off' : (mine ? 'gid:' + mine.gid : 'new');
    const s = selectField(td, opts, value, v => {
      if (v === 'off') cfg.assign[p.name] = 'off';
      else if (v === 'new') cfg.assign[p.name] = 'g' + nextGid;
      else cfg.assign[p.name] = v.slice(4);
      refreshReshape();
    });
    s.className = 'part-group';
  });

  // What it will do, on the real labels, before committing to it.
  const inputs = o.inputs || [];
  if (groups.length) {
    const prev = html('table', 'melt-preview parts-preview', host);
    const ph = html('tr', null, html('thead', null, prev));
    html('th', null, ph).textContent = subject === 'column names' ? 'Column' : 'Value';
    groups.forEach(g => {
      html('th', null, ph).textContent = g.cfg.label
        + (o.measure && g.gid === cfg.measureGid ? ' (measure)' : '');
    });
    const pb = html('tbody', null, prev);
    inputs.slice(0, 12).forEach(v => {
      const claimed = groups.some(g => g.parts.some(p => labelHasPart(v, p.name, cfg.seps)));
      const tr = html('tr', claimed ? null : 'melt-miss', pb);
      tr.setAttribute('data-name', v);
      html('td', 'col-source', tr).textContent = v;
      if (!claimed && subject === 'column names') {
        // nothing of it is in play, which is what keeps an id column out of a
        // melt that would otherwise claim every header
        const td = html('td', 'col-profile', tr);
        td.colSpan = groups.length;
        td.textContent = 'no part in play — kept as a column';
        return;
      }
      groups.forEach(g => {
        html('td', 'col-profile', tr).textContent = partValueAt(
          { parts: g.parts.map(p => p.name) }, v, cfg.seps);
      });
    });
    if (inputs.length > 12) {
      html('div', 'import-note', host).textContent =
        '… and ' + (inputs.length - 12) + ' more.';
    }
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
    patternBox(wrap, 'stem-pattern', pend.path.stem, pend.stemInputs, () => refreshReshape(), 'file names');
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
    html('td', 'col-profile', tr).textContent = !p.filled
      ? 'empty in every row — nothing to plot or group by'
      : p.numeric
        ? ('numeric, ' + p.distinct + ' distinct, ' + fmtAccess(p.min) + '…' + fmtAccess(p.max))
        : (p.distinct + ' distinct: ' + p.sample.slice(0, 3).join(', ') + (p.distinct > 3 ? '…' : ''));
    if (!p.filled) tr.classList.add('col-partial');
  });

  pend.splitDims.forEach(d => {
    const tr = addRow('split:' + d.cfg.key, '{' + d.field + '} of ' + pend.split.source, 'split');
    if (!d.cfg.include) tr.classList.add('col-partial');
    textField(html('td', null, tr), null, d.cfg.label, v => {
      d.cfg.label = v;
      d.cfg.key = keyFromLabel(v, d.field);
      // named by hand, so it stops following what is in the group
      d.cfg.labelTouched = true;
    });
    selectField(html('td', null, tr), [['dimension', 'Dimension'], ['ignore', 'Ignore']],
      d.cfg.include ? 'dimension' : 'ignore', v => { d.cfg.include = v === 'dimension'; refreshReshape(); });
    html('td', null, tr).textContent = '—';
    const prof = html('td', 'col-profile', tr);
    prof.textContent = d.values.length + ' distinct: '
      + d.values.map(v => (v === '' ? '(empty)' : v)).slice(0, 3).join(', ')
      + (d.values.length > 3 ? '…' : '');
    if (d.values.indexOf('') !== -1) {
      const lab = html('label', 'empty-label', prof);
      html('span', null, lab).textContent = 'empty shown as';
      textField(lab, 'split-empty-' + d.field, d.cfg.labelOverride[''],
        v => { d.cfg.labelOverride[''] = v; }, 'name-input');
    }
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
      d.cfg.key = keyFromLabel(v, d.field);
      // named by hand, so it stops following what is in the group
      d.cfg.labelTouched = true;
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
  if (pend.editing) box.classList.add('import-edit');
  html('h4', null, box).textContent = pend.editing
    ? 'Edit the import — "' + pend.name + '"'
    : 'Review the import';

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

  renderPreselectBlock(box, pend);
  renderReshapeBlock(box, pend);
  renderSplitBlock(box, pend);
  renderPathBlock(box, pend);

  // several files: keep separate, or union them
  if (pend.files.length > 1) {
    const opts = html('div', 'import-target', box);
    html('div', 'dim-label', opts).textContent = pend.editing
      ? 'These ' + pend.files.length + ' files are one dataset'
      : 'These files should become';
    const mk = (val, text, hint) => {
      const lab = html('label', 'radio-row', opts);
      const r = document.createElement('input');
      r.type = 'radio'; r.name = 'import-target'; r.value = val;
      r.checked = (val === 'union') === pend.union;
      r.addEventListener('change', () => {
        pend.union = (val === 'union');
        pend.forceUnion = pend.union && !pend.sameShape;
        pend.addSourceDim = pend.union && !pend.pathDims.length;
        refreshReshape();
      });
      lab.appendChild(r);
      html('span', null, lab).textContent = text;
      if (hint) html('span', 'radio-hint', lab).textContent = hint;
    };
    // Pulling them apart again would make one record into several, each with a
    // history that says it was imported as part of something else. Importing
    // the files again is the honest way to do that, and is offered as words
    // rather than as a control that would half-work.
    if (pend.editing) {
      html('div', 'import-note', opts).textContent =
        'Import them again to keep them apart as separate datasets.';
    } else {
      mk('separate', 'separate datasets', 'one per file, switch between them');
      if (pend.sameShape) {
        mk('union', 'one dataset', 'rows appended, kept apart by where they came from');
      } else {
        mk('union', 'one dataset anyway', 'the columns do not match; the gaps get filled in');
      }
    }
    if (!pend.sameShape && !pend.editing) {
      html('div', 'import-note', opts).textContent = (pend.melt.on
        ? 'The files do not produce the same columns even after the split. '
        : 'The files do not have the same columns. ')
        + (pend.partialCols.length
          ? pend.partialCols.length + ' of them are not in every file: '
            + pend.partialCols.slice(0, 6).map(c => c.name).join(', ')
            + (pend.partialCols.length > 6 ? '…' : '') + '.'
          : '');
    }
    if (pend.union && !pend.sameShape) {
      const lab = html('label', 'radio-row', opts);
      html('span', 'derive-label', lab).textContent = 'Fill what a file has not got with';
      textField(lab, 'fill-value', pend.fill, v => { pend.fill = v; refreshReshapeSoon(); });
      html('span', 'radio-hint', lab).textContent =
        'a dimension is labelled with it; a measure takes it only if it is a number, '
        + 'so "n/a" leaves a gap and "0" fills it';
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
  const meltBroken = pend.melt.on && (pend.melt.kind === 'parts'
    ? !(pend.meltParts && pend.meltPartGroups.length && pend.meltMeasures.length)
    : (!pend.meltPat || !pend.meltPat.ok || pend.meltPreview.matched === 0));
  const splitBroken = pend.split.on && (!pend.splitCandidates.length || (pend.split.kind === 'parts'
    ? !(pend.parts && pend.partGroups && pend.partGroups.length)
    : (!pend.splitPat || !pend.splitPat.ok || pend.splitPreview.matched === 0)));
  const outcome = html('div', 'import-outcome', box);
  let blocked = true;
  if (meltBroken) {
    outcome.className = 'import-warn';
    outcome.textContent = pend.melt.kind === 'parts'
      ? 'The separators above cut the column names into nothing to plot — change them, or turn the split off.'
      : 'Fix the column-name pattern above, or turn it off.';
  } else if (splitBroken) {
    outcome.className = 'import-warn';
    outcome.textContent = pend.split.kind === 'parts'
      ? 'The separators above cut those values into nothing — change them, or turn the split off.'
      : 'Fix the pattern for the column values above, or turn it off.';
  } else if (pend.keyClash) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Two things are both called "' + pend.keyClash + '" — rename one of them.';
  } else if (!pend.measureCount) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to plot: mark at least one column as a measure.';
  } else if (!pend.dimCount) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing to group by: mark at least one column as a dimension.';
  } else if (!pend.rowCount) {
    outcome.className = 'import-warn';
    outcome.textContent = 'Nothing is selected: pick some rows above to import.';
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
  go.type = 'button'; go.className = 'btn primary';
  go.textContent = pend.editing ? 'Save changes' : 'Import';
  go.disabled = blocked;
  go.addEventListener('click', () => (pend.editing ? saveEdit() : commitImport()));
  acts.appendChild(go);
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn small';
  cancel.textContent = pend.editing ? 'Discard changes' : 'Cancel';
  cancel.addEventListener('click', () => {
    const was = pend.editing ? 'Left "' + pend.name + '" as it was.' : '';
    pendingImport = null;
    setDataStatus(was);
    renderDataPanel();
  });
  acts.appendChild(cancel);
}
