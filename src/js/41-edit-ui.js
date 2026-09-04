// editing a dataset that has already been imported
//
// Every part of an import is a decision -- which columns come in, what each is
// called, whether it is something to group by or something to plot, and how the
// labels were cut into pieces -- and every one of them is made in the first
// thirty seconds of meeting a file. The role guess is wrong often enough to
// matter, a name is only wrong once it is in a caption, and a split is
// something you get right on the second try.
//
// Nothing here is new machinery. A stored dataset is its raw text plus the
// recipe that read it, so re-opening one is not a re-import: it is the same
// review screen, over the same bytes, with the switches where they were left.
// What comes out is the same record -- same id, same imported-on date, same
// custom measures wherever they still resolve -- which is the whole difference
// between this and importing the file a second time. The dataset the plots are
// built on stays the dataset the plots are built on.

// Two kinds of record cannot go back through the review, and both say why
// rather than being quietly missing a button.
function editableRecordProblem(rec) {
  if (!rec) return 'That dataset is no longer stored.';
  if (Array.isArray(rec.parts) && rec.parts.length) {
    return '"' + rec.name + '" was combined from ' + rec.parts.length + ' datasets, each '
      + 'read by its own recipe. Edit those and combine them again.';
  }
  const sources = rec.sources || [];
  if (!sources.length || sources.some(s => !s || !s.text)) {
    return '"' + rec.name + '" has no stored text to re-read — it cannot be edited.';
  }
  return null;
}

// A measure renamed or retyped from the builder is stored as a difference from
// what the recipe declared, so the review -- which shows what the recipe
// declared -- would open showing the name the user replaced. Fold those in on
// the way in, and the review shows what the page shows; the save then writes
// them as declarations and drops the differences, which are differences from
// themselves by then.
function foldMeasureOverrides(pend, overrides) {
  const folded = {};
  Object.keys(overrides || {}).forEach(key => {
    const o = overrides[key];
    if (!o) return;
    const col = pend.columns.filter(c => c.role === 'measure' && c.name === key)[0];
    if (col) {
      if (o.label) col.label = o.label;
      if (o.format) col.format = o.format;
      folded[key] = true;
      return;
    }
    if (!pend.melt.on) return;
    // A melted measure is named by the level that produced it, or by the
    // fallback -- whose key is its name put through the same slugging.
    if (key === meltFallbackKey(pend)) {
      if (o.label) pend.melt.fallback.name = o.label;
      const cfg = pend.melt.measureCfg[''] || (pend.melt.measureCfg[''] = {});
      if (o.label) cfg.label = o.label;
      if (o.format) { cfg.format = o.format; cfg.formatTouched = true; }
      folded[key] = true;
    } else if (pend.melt.measureCfg[key]) {
      const cfg = pend.melt.measureCfg[key];
      if (o.label) cfg.label = o.label;
      if (o.format) { cfg.format = o.format; cfg.formatTouched = true; }
      folded[key] = true;
    }
  });
  return folded;
}

// The stored record, as the review's own state. The files are re-parsed rather
// than stored parsed: parsing is milliseconds and a parse tree is the one thing
// here that can always be derived again.
function pendingFromRecord(rec) {
  const recipe = rec.recipe || {};
  const files = (rec.sources || []).map(s => {
    const parsed = parseCsv(s.text, recipe.parse);
    // The stored selection is replayed onto the re-parsed file, exactly as the
    // recipe replay does on load, so the grid reopens with the same bands out.
    const stored = ((recipe.parse || {}).preselect || {})[s.path || s.filename];
    const selection = stored
      ? { total: parsed.rows.length, rows: stored.rows, cols: stored.cols }
      : defaultSelection(parsed.rows.length, parsed.header.length);
    return {
      filename: s.filename || s.path || 'source.csv',
      path: s.path || s.filename || 'source.csv',
      text: s.text,
      rawParsed: parsed,
      selection,
      parsed,
    };
  });
  const ui = rec.ui || importUiFromRecipe(recipe, rec.sources);
  const pend = {
    files,
    melt: ui.melt,
    split: ui.split,
    path: ui.path,
    union: !!ui.union,
    forceUnion: !!ui.forceUnion,
    fill: ui.fill === undefined ? 'n/a' : ui.fill,
    addSourceDim: !!ui.addSourceDim,
    // only a reconstructed state has gaps to interpret; a stored one is complete
    reconstructed: !!ui.reconstructed,
    name: rec.name,
    ragged: files.reduce((n, f) => n + f.parsed.ragged.length, 0),
    comments: files[0].parsed.comments,
    skipped: 0,
    // The columns are the recipe's, verbatim: source, name, label, role and
    // format are exactly the five things the column table edits.
    columns: (recipe.columns || []).map(c => ({
      source: c.source, name: c.name, label: c.label, role: c.role,
      format: c.format, agg: c.agg,
    })),
    editing: { id: rec.id, createdAt: rec.createdAt },
  };
  pend.editing.folded = foldMeasureOverrides(pend, recipe.measureOverrides);
  return pend;
}

function editDataset(id) {
  return Promise.resolve(STORE.get(id)).then(rec => {
    const problem = editableRecordProblem(rec);
    if (problem) { setDataStatus(problem); renderDataPanel(); return; }
    pendingImport = pendingFromRecord(rec);
    pgReset();
    restagePending();
    setDataStatus('Editing "' + rec.name + '". Nothing changes until you save.');
    renderDataPanel();
    showMode('data');
  }).catch(e => {
    setDataStatus('Could not open that import: ' + e.message);
    renderDataPanel();
  });
}

// What moved, in the terms the user chose things in. Read off the recipes
// rather than off the built datasets, so it says the same thing whether or not
// the edited dataset is the one currently open.
function describeRecipeChange(was, now) {
  const a = recipeNames(was);
  const b = recipeNames(now);
  const has = (n, k) => n.dims.indexOf(k) !== -1 || n.measures.indexOf(k) !== -1;
  const bits = [];
  a.measures.forEach(k => { if (b.dims.indexOf(k) !== -1) bits.push('"' + k + '" is now a dimension'); });
  a.dims.forEach(k => { if (b.measures.indexOf(k) !== -1) bits.push('"' + k + '" is now a measure'); });
  const gone = a.dims.concat(a.measures).filter(k => !has(b, k));
  const fresh = b.dims.concat(b.measures).filter(k => !has(a, k));
  if (gone.length) bits.push(gone.join(', ') + (gone.length === 1 ? ' is gone' : ' are gone'));
  if (fresh.length) bits.push(fresh.join(', ') + (fresh.length === 1 ? ' is new' : ' are new'));
  return bits;
}

// The open dataset, swapped for the rebuilt one without throwing the page away.
//
// An edit can add and remove both dimensions and measures, so the autosave --
// which is keyed to the shape it was written against -- would refuse to load
// and the plots would come back as one empty default. They are instead put
// through the same serialise/deserialise the saved views use, whose whole job
// is to drop what a dataset no longer has and keep the rest: a plot that
// grouped by a dimension that just became a measure loses that zone and keeps
// its type, its axes and its style.
function adoptEditedDataset(ds) {
  const before = serializePlots();
  useDataset(ds);
  applyConfig(before);
  persistPlotsDebounced();
  renderDataPanel();
  renderBuilder();
}

function saveEdit() {
  const pend = pendingImport;
  if (!pend || !pend.editing) return Promise.resolve();
  const id = pend.editing.id;
  return Promise.resolve(STORE.get(id)).then(rec => {
    if (!rec) {
      pendingImport = null;
      setDataStatus('That dataset is no longer stored; nothing was saved.');
      renderDataPanel();
      return;
    }
    const old = rec.recipe || {};
    const recipe = recipeFromPending(pend, pend.files);
    // Carried over, not re-derived: a comparison or a calculated measure is the
    // user's and has nothing to do with which columns were read. Both are
    // written only where there is something to write, so that a recipe an edit
    // produced is indistinguishable from one an import produced -- which is
    // what makes reading one back and saving it unchanged a no-op.
    const custom = (old.custom || []).slice();
    const overrides = {};
    Object.keys(old.measureOverrides || {}).forEach(k => {
      if (!pend.editing.folded[k]) overrides[k] = old.measureOverrides[k];
    });
    if (custom.length) recipe.custom = custom;
    if (Object.keys(overrides).length) recipe.measureOverrides = overrides;
    const next = Object.assign({}, rec, {
      name: (pend.name || '').trim() || rec.name,
      recipe: recipe,
      ui: importUiState(pend),
    });

    // Built before it is stored, exactly as on import: a record that cannot be
    // rebuilt is not saved, and here there is a working one to fall back to.
    let built;
    try {
      built = datasetFromRecord(next);
    } catch (e) {
      setDataStatus('Those settings do not build: ' + e.message + ' — nothing was saved.');
      renderDataPanel();
      return;
    }
    if (!built.nRows || !built.stats.filled) {
      setDataStatus('That would produce ' + (built.nRows ? 'no numeric values' : 'no rows')
        + ' — nothing was saved. Check the column roles.');
      renderDataPanel();
      return;
    }

    // What the new shape can no longer carry. A formula whose measure has just
    // become a dimension cannot be recompiled, and attachCustomMeasures has
    // already left it out of the build -- so the stored list follows, rather
    // than keeping a measure that will fail to appear on every future load.
    const lostCustom = custom.filter(c => !built.measureByKey[c.key]);
    if (lostCustom.length) {
      const kept = custom.filter(c => !!built.measureByKey[c.key]);
      if (kept.length) recipe.custom = kept; else delete recipe.custom;
    }
    Object.keys(overrides).forEach(k => {
      if (built.measureByKey[k]) return;
      delete overrides[k];
      if (!Object.keys(overrides).length) delete recipe.measureOverrides;
    });

    return Promise.resolve(STORE.put(next)).then(() => {
      const wasActive = activeDatasetId() === id;
      pendingImport = null;
      if (wasActive) adoptEditedDataset(built);
      const changes = describeRecipeChange(old, recipe);
      if (lostCustom.length) {
        changes.push(lostCustom.map(c => '"' + c.label + '"').join(', ')
          + ' could no longer be computed and ' + (lostCustom.length === 1 ? 'was' : 'were')
          + ' dropped');
      }
      setDataStatus('Saved "' + next.name + '"'
        + (changes.length ? ': ' + changes.join('; ') + '.' : ' — nothing about its shape changed.')
        + (wasActive && changes.length ? ' Plots using them were adjusted.' : ''));
      renderDataPanel();
      if (wasActive) showMode('builder');
    });
  }).catch(e => {
    setDataStatus('Could not save that edit: ' + e.message);
    renderDataPanel();
  });
}
