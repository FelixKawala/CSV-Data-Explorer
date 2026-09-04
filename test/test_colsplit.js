// Labels that carry dimensions: a column's values, and the column names.
//
// The melt splits the header labels; this splits the row labels -- `16x4` is a
// block width and a height, `harris-corner-tiled` an application and a variant.
// Same pattern language, same preview, other axis.
//
// The second half is the collision it uncovered: a melted level whose text is
// "value" is the default name of the melt's own fallback measure, and the two
// were reconciled by dropping one of them.

const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(__dirname + '/../dist/fixture.html', 'utf8');

let failures = 0;
function ok(c, m, e) {
  if (!c) { failures++; console.log('  FAIL: ' + m + (e !== undefined ? '  [' + e + ']' : '')); }
  else console.log('  ok: ' + m + (e !== undefined ? '  (' + e + ')' : ''));
}
function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  w.eval('setStore(makeMemoryStore());');
  return { w, d: w.document };
}
function build(w, sources, recipe) {
  return JSON.parse(w.eval('(function(){'
    + ' const ds = datasetFromRecord({ id:"t", name:"t", sources:'
    + JSON.stringify(sources) + ', recipe:' + JSON.stringify(recipe) + ' });'
    + ' return JSON.stringify({'
    + '   dims: ds.dims.map(d => d.key),'
    + '   dimLabels: ds.dims.map(d => d.label),'
    + '   values: ds.dims.reduce((o,d) => { o[d.key] = d.values; return o; }, {}),'
    + '   measures: ds.measures.map(m => m.key),'
    + '   nRows: ds.nRows, collapsed: ds.stats.collapsed, filled: ds.stats.filled }); })()'));
}
function valueAt(w, sources, recipe, ctx) {
  return w.eval('(function(){ const ds = datasetFromRecord({ id:"t", name:"t", sources:'
    + JSON.stringify(sources) + ', recipe:' + JSON.stringify(recipe) + ' });'
    + ' return datasetValueAt(ds, ' + JSON.stringify(ctx) + '); })()');
}

// one row per block configuration, which is two numbers written as one label
const BLOCKS = 'block-config,l1hitrate,l2hitrate\n16x4,1,25\n16x8,2,26\n32x8,3,27\n';
const BLOCK_SRC = [{ filename: 'mk.csv', text: BLOCKS }];
const splitCol = (role, fields, text) => ({
  source: 'block-config', name: 'block-config', label: 'Block config', role: role,
  split: { pattern: { kind: 'template', text: text || '{bx:d}x{by:d}' }, fields: fields },
});
const BX_BY = [{ field: 'bx', key: 'bx', label: 'Block X' }, { field: 'by', key: 'by', label: 'Block Y' }];
const BLOCK_RECIPE = {
  columns: [
    splitCol('ignore', BX_BY),
    { source: 'l1hitrate', name: 'l1hitrate', role: 'measure', format: 'pct' },
    { source: 'l2hitrate', name: 'l2hitrate', role: 'measure', format: 'pct' },
  ],
};

console.log('\n=== 1. A column\'s values become dimensions of their own ===');
{
  const { w } = boot();
  const r = build(w, BLOCK_SRC, BLOCK_RECIPE);
  ok(r.dims.join(',') === 'bx,by', 'the parts are the dimensions', r.dims.join(','));
  ok(r.dimLabels.join(',') === 'Block X,Block Y', 'named as the recipe named them', r.dimLabels.join(','));
  ok(r.values.bx.join(',') === '16,32' && r.values.by.join(',') === '4,8',
     'each part has its own domain, deduplicated', JSON.stringify(r.values));
  ok(r.nRows === 3 && r.collapsed === 0, 'one row per label, nothing folded together',
     r.nRows + '/' + r.collapsed);
  ok(valueAt(w, BLOCK_SRC, BLOCK_RECIPE, { bx: '32', by: '8', metric: 'l2hitrate' }) === 27,
     'and a value is reachable by the parts of its label');
  w.close();
}

console.log('\n=== 2. The column itself can be kept, or dropped ===');
{
  const { w } = boot();
  const kept = JSON.parse(JSON.stringify(BLOCK_RECIPE));
  kept.columns[0].role = 'dimension';
  const r = build(w, BLOCK_SRC, kept);
  ok(r.dims.join(',') === 'block-config,bx,by',
     'kept, the column comes first and its parts follow it', r.dims.join(','));
  ok(r.nRows === 3, 'the parts add no rows: they are the same label read twice', r.nRows);
  ok(valueAt(w, BLOCK_SRC, kept, { 'block-config': '16x8', bx: '16', by: '8', metric: 'l1hitrate' }) === 2,
     'and the value sits at the tuple that spells both');
  ok(build(w, BLOCK_SRC, BLOCK_RECIPE).dims.indexOf('block-config') === -1,
     'ignored, only the parts are left');
  w.close();
}

console.log('\n=== 3. A value the pattern misses keeps its whole text ===');
{
  const { w } = boot();
  const src = [{ filename: 'a.csv',
    text: 'app,rate\nharris-corner-tiled,1\nharris-corner-kbk,2\nhotspot,3\nposterization,4\n' }];
  const recipe = {
    columns: [
      { source: 'app', name: 'app', role: 'ignore',
        split: { pattern: { kind: 'template', text: 'harris-corner-{variant}' },
          fields: [{ field: 'variant', key: 'kernel', label: 'Kernel' }] } },
      { source: 'rate', name: 'rate', role: 'measure' },
    ],
  };
  const r = build(w, src, recipe);
  ok(r.values.kernel.join(',') === 'tiled,kbk,hotspot,posterization',
     'the two that matched are their capture; the two that did not are themselves',
     r.values.kernel.join(','));
  ok(r.nRows === 4 && r.collapsed === 0,
     'so two unmatched labels stay two rows rather than folding onto one blank',
     r.nRows + '/' + r.collapsed);
  ok(valueAt(w, src, recipe, { kernel: 'posterization', metric: 'rate' }) === 4,
     'and an unmatched row keeps its number');
  w.close();
}

console.log('\n=== 4. A split and a melt, on the same file ===');
{
  const { w } = boot();
  const src = [{ filename: 'b.csv', text: 'cfg,2080c512kbk,4070c512kbk\n16x4,1,2\n32x8,3,4\n' }];
  const recipe = {
    columns: [{ source: 'cfg', name: 'cfg', role: 'ignore',
      split: { pattern: { kind: 'template', text: '{bx:d}x{by:d}' },
        fields: [{ field: 'bx', key: 'bx' }, { field: 'by', key: 'by' }] } }],
    melt: {
      pattern: { kind: 'template', text: '{device:d}c{threads:d}{variant}' },
      fields: [{ field: 'device', key: 'device' }, { field: 'threads', key: 'threads' },
        { field: 'variant', key: 'variant' }],
      measure: { key: 'rate', label: 'Hit rate', format: 'pct' },
    },
  };
  const r = build(w, src, recipe);
  ok(r.dims.join(',') === 'bx,by,device,threads,variant',
     'the row label splits first, the header label last', r.dims.join(','));
  ok(r.nRows === 4 && r.collapsed === 0, '2 labels x 2 columns, nothing averaged',
     r.nRows + '/' + r.collapsed);
  ok(valueAt(w, src, recipe,
    { bx: '32', by: '8', device: '4070', threads: '512', variant: 'kbk', metric: 'rate' }) === 4,
     'and both halves of the tuple point at one cell');
  w.close();
}

console.log('\n=== 5. What a file has not got, and what a recipe cannot compile ===');
{
  const { w } = boot();
  // one file has the column, the other has not: the fill is a label like any
  // other, and it is what the split reads
  const two = [
    { filename: 'has.csv', text: 'cfg,rate\n16x4,1\n' },
    { filename: 'not.csv', text: 'rate\n2\n' },
  ];
  const recipe = {
    columns: [
      { source: 'cfg', name: 'cfg', role: 'ignore',
        split: { pattern: { kind: 'template', text: '{bx:d}x{by:d}' },
          fields: [{ field: 'bx', key: 'bx' }, { field: 'by', key: 'by' }] } },
      { source: 'rate', name: 'rate', role: 'measure' },
    ],
    fill: 'n/a',
  };
  const r = build(w, two, recipe);
  ok(r.values.bx.join(',') === '16,n/a', 'the missing column fills the first part', r.values.bx.join(','));
  ok(r.nRows === 2, 'and the row survives instead of falling outside the domain', r.nRows);
  ok(valueAt(w, two, recipe, { bx: 'n/a', by: '', metric: 'rate' }) === 2,
     'with its number where the fill put it');

  const broken = JSON.parse(JSON.stringify(BLOCK_RECIPE));
  broken.columns[0].split.pattern.text = '{a}x{a}';
  const rb = build(w, BLOCK_SRC, broken);
  ok(rb.dims.join(',') === '', 'a pattern that will not compile splits nothing', rb.dims.join(','));
  const noFields = JSON.parse(JSON.stringify(BLOCK_RECIPE));
  noFields.columns[0].split.fields = [];
  ok(build(w, BLOCK_SRC, noFields).dims.join(',') === '',
     'and neither does one with every field left out');
  w.close();
}

console.log('\n=== 6. The split is counted, stored and replayed ===');
{
  const { w } = boot();
  const shape = r => JSON.parse(w.eval('JSON.stringify(recipeShape(' + JSON.stringify(r) + '))'));
  ok(JSON.stringify(shape(BLOCK_RECIPE)) === '{"dims":2,"measures":2}',
     'the Data tab counts the parts as the dimensions they are',
     JSON.stringify(shape(BLOCK_RECIPE)));
  const kept = JSON.parse(JSON.stringify(BLOCK_RECIPE));
  kept.columns[0].role = 'dimension';
  ok(shape(kept).dims === 3, 'three when the column is kept as well', shape(kept).dims);
  w.close();
}

// ---- labels that are a set of flags rather than a sequence ------------------
// A pattern reads a label by position. Some labels are a base name with flags
// stuck on it, in whatever number and order the run happened to have, and there
// is no positional pattern for that: `prefetch` is missing from half of them and
// `s2000` is a value where `prefetch` is a yes/no.
const FLAGS = 'run,ms\n'
  + 'kernelA/cu_mode,1.0\n'
  + 'kernelA/no_barriers,2.0\n'
  + 'kernelA_prefetch/cu_mode,3.0\n'
  + 'kernelA_prefetch/no_barriers,4.0\n'
  + 'kernelB/cu_mode,5.0\n'
  + 'kernelB/no_barriers,6.0\n'
  + 'kernelB_prefetch_s2000/cu_mode,7.0\n'
  + 'kernelB_prefetch_s5000/no_barriers,8.0\n';
const FLAGS_SRC = [{ filename: 'runs.csv', text: FLAGS }];

console.log('\n=== 7. The parts of a label, and the dimensions they suggest ===');
{
  const { w } = boot();
  const found = JSON.parse(w.eval('JSON.stringify(analyseParts('
    + JSON.stringify(FLAGS.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[0]))
    + ', "_/"))'));
  const names = found.parts.map(p => p.name);
  ok(names.indexOf('cu_mode') !== -1 && names.indexOf('no_barriers') !== -1,
     'parts never seen apart are one part again — the separator cut cu_mode in half',
     names.join(' '));
  ok(names.indexOf('cu') === -1 && names.indexOf('mode') === -1,
     'and the halves are not offered separately');
  ok(found.parts.filter(p => p.name === 'prefetch')[0].count === 4,
     'each part carries how many labels have it',
     found.parts.filter(p => p.name === 'prefetch')[0].count);
  const groups = found.groups.map(g => g.parts.join('|'));
  ok(groups.indexOf('kernelA|kernelB') !== -1,
     'parts never seen together are one dimension: two kernels, not two flags', groups.join(' · '));
  ok(groups.indexOf('s2000|s5000') !== -1, 'so are two sleeps', groups.join(' · '));
  ok(groups.indexOf('prefetch') !== -1, 'and a part that overlaps everything is a flag of its own');
  ok(groups.length === 4, 'four dimensions out of one column', groups.join(' · '));
  w.close();
}

console.log('\n=== 8. A parts split builds the dimensions it declared ===');
{
  const { w } = boot();
  const recipe = {
    columns: [
      { source: 'run', name: 'run', role: 'ignore',
        split: { parts: { seps: '_/', groups: [
          { key: 'kernel', label: 'Kernel', parts: ['kernelA', 'kernelB'] },
          { key: 'prefetch', label: 'Prefetch', parts: ['prefetch'] },
          { key: 'sleep', label: 'Sleep', parts: ['s2000', 's5000'] },
        ] } } },
      { source: 'ms', name: 'ms', role: 'measure' },
    ],
  };
  const r = build(w, FLAGS_SRC, recipe);
  ok(r.dims.join(',') === 'kernel,prefetch,sleep', 'one dimension per declared group', r.dims.join(','));
  ok(r.values.kernel.join(',') === 'kernelA,kernelB', 'a group of parts takes the part as its value',
     r.values.kernel.join(','));
  ok(r.values.prefetch.join(',') === 'no prefetch,prefetch',
     'a flag says its own name, so a legend reading it alone still says which flag',
     r.values.prefetch.join(','));
  ok(r.values.sleep.join(',') === 'none,s2000,s5000',
     'and a label with none of them says none', r.values.sleep.join(','));
  ok(r.nRows === 5 && r.collapsed === 3,
     'the three groups declared here do not tell every label apart, so the ones that '
     + 'agree on all three land together and are counted',
     r.nRows + ' rows, ' + r.collapsed + ' collapsed');
  ok(valueAt(w, FLAGS_SRC, recipe,
    { kernel: 'kernelB', prefetch: 'prefetch', sleep: 's2000', metric: 'ms' }) === 7,
     'and a value is reachable by the flags it was labelled with');
  ok(valueAt(w, FLAGS_SRC, recipe,
    { kernel: 'kernelA', prefetch: 'no prefetch', sleep: 'none', metric: 'ms' }) === 1.5,
     'while a combination that two labels share is their mean — cu_mode and no_barriers '
     + 'are not a dimension here, so those two rows land together');
  w.close();
}

// ---- the review screen ------------------------------------------------------
const wait = ms => new Promise(r => setTimeout(r, ms));
function pick(w, files, inputId) {
  const input = w.document.getElementById(inputId || 'csv-input');
  const list = files.map(f => {
    const file = new w.File([f.text], f.name, { type: 'text/csv' });
    if (f.path) Object.defineProperty(file, 'webkitRelativePath', { value: f.path, configurable: true });
    return file;
  });
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  input.dispatchEvent(new w.Event('change'));
}
const review = d => d.querySelector('.import-review');
const importBtn = d => Array.from(review(d).querySelectorAll('button')).find(b => b.textContent === 'Import');
const outcome = d => d.querySelector('.import-outcome, .import-review .import-warn').textContent;
const colRow = (d, k) => d.querySelector('.import-table tr[data-col="' + k + '"]');
function setPattern(w, d, id, text) {
  const inp = d.getElementById(id);
  inp.value = text;
  inp.dispatchEvent(new w.Event('input'));
}
function enable(w, d, id) {
  const cb = d.getElementById(id);
  cb.checked = true;
  cb.dispatchEvent(new w.Event('change'));
}

(async function section12() {
  console.log('\n=== 9. The review screen splits a column\'s values ===');
  const { w, d } = boot();
  d.querySelector('.mode-tab[data-mode="data"]').click();
  pick(w, [{ name: 'mk.csv', text: BLOCKS }]);
  await wait(60);
  ok(!!d.getElementById('split-enable'), 'the review offers to split a column');
  enable(w, d, 'split-enable');
  await wait(30);
  ok(d.getElementById('split-column').value === 'block-config',
     'the first column that is not a measure is proposed',
     d.getElementById('split-column').value);
  ok(importBtn(d).disabled && /pattern for the column values/.test(outcome(d)),
     'and the import waits for a pattern', outcome(d));

  setPattern(w, d, 'split-pattern', '{bx:d}x{by:d}');
  await wait(250);
  const pv = d.querySelectorAll('.import-split .melt-preview tbody tr');
  ok(pv.length === 3, 'every distinct value is listed, once', pv.length);
  ok(/3 of 3 values matched/.test(d.querySelector('.import-split .import-summary').textContent),
     'with the count stated', d.querySelector('.import-split .import-summary').textContent);
  ok(!!colRow(d, 'split:bx') && !!colRow(d, 'split:by'),
     'the captured parts appear in the column table');
  ok(colRow(d, 'split:bx').getAttribute('data-synthetic') === 'split',
     'marked as coming from the values, not from a header');
  ok(d.getElementById('split-keep') && !d.getElementById('split-keep').checked,
     'and the column itself is dropped by default, since its parts say it all');
  ok(!importBtn(d).disabled && /2 dimensions × 2 measures/.test(outcome(d)),
     'the import is unblocked', outcome(d));

  const lbl = colRow(d, 'split:bx').querySelector('input');
  lbl.value = 'Block X';
  lbl.dispatchEvent(new w.Event('input'));
  importBtn(d).click();
  await wait(80);
  ok(w.eval('DS.dims.map(x=>x.key).join(",")') === 'block_x,by',
     'the dataset has the two parts, renaming one of them as the table did',
     w.eval('DS.dims.map(x=>x.key).join(",")'));
  ok(w.eval('DIM_BY_KEY.block_x.label') === 'Block X', 'under the name given there',
     w.eval('DIM_BY_KEY.block_x.label'));
  ok(w.eval('metricValueAt({block_x:"32",by:"8",metric:"l2hitrate"})') === 27,
     'the numbers landed where the label said');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
     d.querySelectorAll('#plots rect.bar').length);

  const recs = JSON.parse(await w.eval('STORE.list().then(r => JSON.stringify(r))'));
  const col = recs[0].recipe.columns[0];
  ok(col.split.pattern.text === '{bx:d}x{by:d}', 'the recipe holds the pattern as typed',
     col.split && col.split.pattern.text);
  ok(col.role === 'ignore' && col.split.fields.map(f => f.key).join(',') === 'block_x,by',
     'with the fields, on the column they came from',
     col.role + ':' + col.split.fields.map(f => f.key).join(','));
  ok(col.split.fields[0].field === 'bx',
     'each keeping the name of the capture it reads', col.split.fields[0].field);
  ok(recs[0].sources[0].text === BLOCKS, 'and the raw file is what is stored');
  const back = JSON.parse(w.eval('(function(){ const ds = datasetFromRecord('
    + JSON.stringify(recs[0]) + ');'
    + ' return JSON.stringify({ dims: ds.dims.map(x => x.key), nRows: ds.nRows,'
    + '   v: datasetValueAt(ds, {block_x:"16",by:"4",metric:"l1hitrate"}) }); })()'));
  ok(back.dims.join(',') === 'block_x,by' && back.nRows === 3 && back.v === 1,
     'reloading replays the split down to the same value', JSON.stringify(back));
  w.close();
  await section10();
})();

async function section10() {
  console.log('\n=== 10. Guards: a name used twice, and a pattern that fits nothing ===');
  const { w, d } = boot();
  d.querySelector('.mode-tab[data-mode="data"]').click();
  pick(w, [{ name: 'x.csv', text: 'app,2080c512kbk,4070c512kbk\nharris-tiled,1,2\nharris-kbk,3,4\n' }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(30);
  setPattern(w, d, 'melt-pattern', '{device:d}c{threads:d}{variant}');
  await wait(250);
  enable(w, d, 'split-enable');
  await wait(30);
  setPattern(w, d, 'split-pattern', 'zzz{a}');
  await wait(250);
  ok(importBtn(d).disabled && /matches none of the values/.test(review(d).textContent),
     'a pattern that matches no value blocks the import and says so', outcome(d));

  setPattern(w, d, 'split-pattern', 'harris-{variant}');
  await wait(250);
  ok(importBtn(d).disabled && /both called "variant"/.test(outcome(d)),
     'a part named the same as a melted field blocks it too', outcome(d));

  const lbl = colRow(d, 'split:variant').querySelector('input');
  lbl.value = 'Kernel';
  lbl.dispatchEvent(new w.Event('input'));
  setPattern(w, d, 'split-pattern', 'harris-{variant}');
  await wait(250);
  ok(!importBtn(d).disabled, 'renaming one of them clears it', outcome(d));

  const keep = d.getElementById('split-keep');
  keep.checked = true;
  keep.dispatchEvent(new w.Event('change'));
  await wait(60);
  ok(colRow(d, 'app').querySelectorAll('select')[0].value === 'dimension',
     'keeping the column is the same switch as its role in the table',
     colRow(d, 'app').querySelectorAll('select')[0].value);
  importBtn(d).click();
  await wait(80);
  ok(w.eval('DS.dims.map(x=>x.key).join(",")') === 'app,kernel,device,threads,variant',
     'and both the column and its part are dimensions',
     w.eval('DS.dims.map(x=>x.key).join(",")'));
  w.close();
  await section11();
}

async function section11() {
  console.log('\n=== 11. The review screen reads a label as a set of parts ===');
  const { w, d } = boot();
  d.querySelector('.mode-tab[data-mode="data"]').click();
  pick(w, [{ name: 'runs.csv', text: FLAGS }]);
  await wait(60);
  enable(w, d, 'split-enable');
  await wait(30);
  const kind = d.getElementById('split-kind');
  ok(!!kind && Array.from(kind.options).map(o => o.value).join(',') === 'template,regex,parts',
     'the split offers a third way of reading a label',
     kind && Array.from(kind.options).map(o => o.value).join(','));
  kind.value = 'parts';
  kind.dispatchEvent(new w.Event('change'));
  await wait(60);

  ok(d.getElementById('split-seps').value === '_/', 'with the separators pre-filled',
     d.getElementById('split-seps').value);
  const parts = Array.from(d.querySelectorAll('.parts-table tbody tr')).map(t => t.getAttribute('data-part'));
  ok(parts.indexOf('cu_mode') !== -1 && parts.indexOf('cu') === -1,
     'the parts listed are the merged ones', parts.join(' '));
  ok(/8 values → 7 parts → 4 dimensions/.test(d.querySelector('.import-split .import-summary').textContent),
     'and the summary counts what it will make',
     d.querySelector('.import-split .import-summary').textContent);
  ok(!!colRow(d, 'split:kernel') && !!colRow(d, 'split:prefetch'),
     'each proposed dimension is a row of the column table');
  ok(colRow(d, 'split:kernel').querySelectorAll('td')[4].textContent.indexOf('kernelA') !== -1,
     'named after what its parts have in common, and listing them',
     colRow(d, 'split:kernel').querySelectorAll('td')[4].textContent);

  // Every dimension is offered by name, including the one this part is already
  // in: a row that described its group by its role instead ("its own
  // dimension") named no dimension, so the one you wanted was the one you could
  // not see.
  const cuOpts = Array.from(d.querySelector('.parts-table tr[data-part="cu_mode"] select').options)
    .map(o => o.textContent);
  ok(cuOpts.indexOf('a value of cu_mode') !== -1,
     'a part alone in its dimension still names it', cuOpts.join(' | '));
  ok(cuOpts.filter(t => /^a value of /.test(t)).length === 4,
     'and every other dimension is offered too', cuOpts.join(' | '));

  // the proposal is a proposal: pull a part out of its group, and drop one
  const row = d.querySelector('.parts-table tr[data-part="s5000"] select');
  row.value = 'new';
  row.dispatchEvent(new w.Event('change'));
  await wait(60);
  ok(!!colRow(d, 'split:s5000'), 's5000 can be pulled out into a dimension of its own');
  ok(colRow(d, 'split:s2000').querySelectorAll('td')[4].textContent.indexOf('s5000') === -1,
     'and it leaves the group it was in',
     colRow(d, 'split:s2000').querySelectorAll('td')[4].textContent);
  const drop = d.querySelector('.parts-table tr[data-part="s5000"] select');
  drop.value = 'off';
  drop.dispatchEvent(new w.Event('change'));
  await wait(60);
  ok(!colRow(d, 'split:s5000'), 'or ignored altogether');

  ok(!importBtn(d).disabled, 'the import is ready', outcome(d));
  importBtn(d).click();
  await wait(80);
  const dims = w.eval('DS.dims.map(x => x.key).join(",")');
  ok(dims === 'kernel,cu_mode,prefetch,s2000', 'the dataset has a dimension per group', dims);
  ok(w.eval('JSON.stringify(DIM_BY_KEY.prefetch.values)') === '["no prefetch","prefetch"]',
     'a flag names itself in both its values', w.eval('JSON.stringify(DIM_BY_KEY.prefetch.values)'));
  // s5000 was pulled out and then dropped, so s2000 is a group of one and reads
  // as a yes / no like any other flag — the name it was given when it was a
  // group of two stays until it is renamed
  ok(w.eval('metricValueAt({kernel:"kernelB",cu_mode:"cu_mode",prefetch:"prefetch",s2000:"s2000",metric:"ms"})') === 7,
     'and a number is reachable by the flags its label carried');
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
     d.querySelectorAll('#plots rect.bar').length);

  const recs = JSON.parse(await w.eval('STORE.list().then(r => JSON.stringify(r))'));
  const sp = recs[0].recipe.columns[0].split;
  ok(sp && sp.parts && sp.parts.groups.length === 4,
     'the recipe stores the groups as they stand, not the rule that proposed them',
     sp && sp.parts && sp.parts.groups.length);
  ok(sp.parts.groups[0].parts.join('|') === 'kernelA|kernelB', 'with the parts in each',
     sp.parts.groups[0].parts.join('|'));
  const back = JSON.parse(w.eval('(function(){ const ds = datasetFromRecord('
    + JSON.stringify(recs[0]) + ');'
    + ' return JSON.stringify({ dims: ds.dims.map(x => x.key), nRows: ds.nRows }); })()'));
  ok(back.dims.join(',') === dims, 'and reloading replays them', back.dims.join(','));
  w.close();
  await section12();
}

async function section12() {
  console.log('\n=== 12. A melted level called "value" is a measure like any other ===');
  // It collided with the name of the melt's own fallback measure, which is
  // "value" unless it is named, and the collision was resolved by dropping the
  // level -- so a whole column of numbers left the dataset without a word.
  const { w } = boot();
  const src = [{ filename: 'v.csv', text: 'app,c512value,c512count\nA,10,11\nB,20,21\n' }];
  const recipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      pattern: { kind: 'template', text: 'c{threads:d}{measure}' },
      fields: [{ field: 'threads', key: 'threads' }],
      measures: [{ value: 'value', key: 'value' }, { value: 'count', key: 'count' }],
    },
  };
  const r = build(w, src, recipe);
  ok(r.measures.join(',') === 'value,count', 'both levels arrive', r.measures.join(','));
  ok(r.filled === 4, 'with every number in them', r.filled);
  ok(valueAt(w, src, recipe, { app: 'B', threads: '512', metric: 'value' }) === 20,
     'and the one that shares the fallback\'s name is readable');

  // the other half: a DIMENSION on that key. The fallback measure used to
  // overwrite it in every row, which put every tuple outside the declared
  // domain and dropped all of them.
  const dimSrc = [{ filename: 'd.csv', text: 'app,2080c512kbk,2080c512tapas\nA,10,11\n' }];
  const dimRecipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      pattern: { kind: 'template', text: '{device:d}c{threads:d}{variant}' },
      fields: [{ field: 'device', key: 'device' }, { field: 'threads', key: 'threads' },
        { field: 'variant', key: 'value', label: 'Value' }],
      measure: { key: 'value', label: 'Value', format: 'number' },
    },
  };
  const rd = build(w, dimSrc, dimRecipe);
  ok(rd.nRows === 2 && rd.filled === 2,
     'a dimension and the fallback measure on one key still keeps every row',
     rd.nRows + '/' + rd.filled);
  ok(rd.values.value.join(',') === 'kbk,tapas', 'the dimension keeps the key it was given',
     rd.values.value.join(','));
  ok(rd.measures.length === 1 && rd.measures[0] !== 'value',
     'and the measure moves aside instead', rd.measures.join(','));
  w.close();

  w.close();
  await section13();
}

const HEADER_PARTS = 'app,avg_CPU_value,run0_CPU_value,avg_GPU_value,avg_CPU_variance\n'
  + 'A,1.0,2.0,3.0,4.0\nB,5.0,6.0,7.0,8.0\n';
const HEADER_SRC = [{ filename: 'h.csv', text: HEADER_PARTS }];

async function section13() {
  console.log('\n=== 13. The column names read as parts too ===');
  const { w } = boot();
  const recipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      parts: { seps: '_', groups: [
        { key: 'agg', label: 'Aggregate', parts: ['avg', 'run0'] },
        { key: 'device', label: 'Device', parts: ['CPU', 'GPU'] },
        { key: 'stat', label: 'Statistic', parts: ['value', 'variance'], measure: true },
      ] },
      measures: [{ value: 'value', key: 'value', label: 'Value' },
        { value: 'variance', key: 'variance', label: 'Variance' }],
    },
  };
  const r = build(w, HEADER_SRC, recipe);
  ok(r.dims.join(',') === 'app,agg,device',
     'every group is a dimension except the one that names the measure', r.dims.join(','));
  ok(r.measures.join(',') === 'value,variance',
     'whose parts are the measures', r.measures.join(','));
  ok(r.values.agg.join(',') === 'avg,run0' && r.values.device.join(',') === 'CPU,GPU',
     'each dimension takes the parts it was given', JSON.stringify(r.values));
  ok(r.nRows === 6 && r.collapsed === 0, 'three column tuples per row of the file',
     r.nRows + '/' + r.collapsed);
  ok(valueAt(w, HEADER_SRC, recipe,
    { app: 'B', agg: 'avg', device: 'CPU', metric: 'variance' }) === 8,
     'and a number lands where its header said');
  ok(valueAt(w, HEADER_SRC, recipe,
    { app: 'A', agg: 'run0', device: 'GPU', metric: 'value' }) === null,
     'a column the file has not got is a gap, not a zero');
  // `app` carries no part of any group, which is what keeps it a column
  ok(r.values.app.join(',') === 'A,B', 'a header with no part in play stays an id column',
     r.values.app.join(','));
  w.close();
  await section14();
}

async function section14() {
  console.log('\n=== 14. Driving a parts melt from the review ===');
  const { w, d } = boot();
  d.querySelector('.mode-tab[data-mode="data"]').click();
  pick(w, [{ name: 'h.csv', text: HEADER_PARTS }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(30);
  const kind = d.getElementById('melt-kind');
  ok(!!kind && Array.from(kind.options).map(o => o.value).join(',') === 'template,regex,parts',
     'the column names get the same three readings the values do',
     kind && Array.from(kind.options).map(o => o.value).join(','));
  kind.value = 'parts';
  kind.dispatchEvent(new w.Event('change'));
  await wait(60);
  const parts = Array.from(d.querySelectorAll('.import-reshape .parts-table tbody tr'))
    .map(t => t.getAttribute('data-part'));
  ok(parts.indexOf('app') !== -1 && parts.indexOf('avg') !== -1,
     'every word in the header is a part, the id column included', parts.join(' '));

  // the id column is only an id column once its own word is out of play
  const setPart = (name, v) => {
    const s = d.querySelector('.parts-table tr[data-part="' + name + '"] select');
    s.value = v; s.dispatchEvent(new w.Event('change'));
  };
  setPart('app', 'off');
  await wait(60);
  ok(!!colRow(d, 'app'), 'ignoring it puts the column back as a column');
  const mg = d.getElementById('melt-measure-group');
  ok(!!mg, 'one group may be told to name the measure');
  const stat = Array.from(mg.options).find(o => /value/.test(o.textContent));
  mg.value = stat.value;
  mg.dispatchEvent(new w.Event('change'));
  await wait(60);
  ok(/one of them picking the measure/.test(
    d.querySelector('.import-reshape .import-summary').textContent),
     'and the summary says so', d.querySelector('.import-reshape .import-summary').textContent);
  ok(!!colRow(d, 'melt:value') && !!colRow(d, 'melt:variance'),
     'its parts become the measures');
  ok(!importBtn(d).disabled, 'the import is ready', outcome(d));
  importBtn(d).click();
  await wait(80);
  ok(w.eval('DS.dims.map(x => x.key).join(",")') === 'app,avg,cpu',
     'the dataset has the id column and a dimension per remaining group',
     w.eval('DS.dims.map(x => x.key).join(",")'));
  ok(w.eval('METRICS.map(m => m.key).join(",")') === 'value,variance',
     'and the measures the naming group produced', w.eval('METRICS.map(m => m.key).join(",")'));
  ok(w.eval('metricValueAt({app:"B",avg:"avg",cpu:"CPU",metric:"variance"})') === 8,
     'with the numbers where the headers said');
  const recs = JSON.parse(await w.eval('STORE.list().then(r => JSON.stringify(r))'));
  ok(recs[0].recipe.melt.parts && recs[0].recipe.melt.parts.groups.some(g => g.measure),
     'the recipe stores the groups and which of them names the measure',
     JSON.stringify(recs[0].recipe.melt.parts && recs[0].recipe.melt.parts.groups.map(g => g.key)));
  w.close();

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}
