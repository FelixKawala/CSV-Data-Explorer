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

// compile a pattern inside the page and bring the result back as plain data
function compile(w, kind, text) {
  return JSON.parse(w.eval('(function(){ const p = compilePattern('
    + JSON.stringify({ kind, text }) + ');'
    + ' return JSON.stringify({ ok: p.ok, source: p.source, fields: p.fields,'
    + '   hasMeasure: p.hasMeasure, warnings: p.warnings, error: p.error }); })()'));
}
function match(w, kind, text, input) {
  return JSON.parse(w.eval('(function(){ const m = matchPattern(compilePattern('
    + JSON.stringify({ kind, text }) + '), ' + JSON.stringify(input) + ');'
    + ' return JSON.stringify(m); })()'));
}

console.log('\n=== 1. The template compiles to what it says ===');
{
  const { w } = boot();
  const p = compile(w, 'template', '{device:d}c{threads:d}{variant}');
  ok(p.ok, 'it compiles', p.error);
  ok(p.fields.join(',') === 'device,threads,variant', 'with the fields in written order', p.fields.join(','));
  ok(p.source === '^(?<device>\\d+)c(?<threads>\\d+)(?<variant>[A-Za-z0-9]*)$',
     'anchored, digits where asked, trailing field optional', p.source);
  ok(!p.hasMeasure, 'and no measure capture unless one is named');
  ok(p.warnings.length === 0, 'no warnings for a well-formed pattern', p.warnings.join('; '));

  const m = match(w, 'template', '{device:d}c{threads:d}{variant}', '2080c512kbk');
  ok(m && m.fields.device === '2080' && m.fields.threads === '512' && m.fields.variant === 'kbk',
     'it splits a real header', m && JSON.stringify(m.fields));
  const bare = match(w, 'template', '{device:d}c{threads:d}{variant}', '2080c512');
  ok(bare && bare.fields.variant === '', 'the trailing field may capture nothing',
     bare && JSON.stringify(bare.fields));
  ok(match(w, 'template', '{device:d}c{threads:d}{variant}', 'app') === null,
     'and a header that does not fit does not match — so it stays a column');
  w.close();
}

console.log('\n=== 2. The field types mean what they say ===');
{
  const { w } = boot();
  ok(match(w, 'template', '{n:d}', '2080') !== null, '{n:d} takes digits');
  ok(match(w, 'template', '{a:d}c{b:d}', '2080cABC') === null, 'and refuses letters');
  ok(match(w, 'template', '{a}', 'K0_L1') === null, '{a} is a word, so it stops at punctuation');
  ok(match(w, 'template', '{a:*}', 'K0_L1') !== null, '{a:*} takes anything');
  // a digits field is never allowed to match empty, even in the trailing slot
  ok(match(w, 'template', 'cc{n:d}', 'cc') === null, 'a trailing digits field still needs a digit');
  // literal text is escaped, not treated as a regex
  ok(match(w, 'template', 'a.b{x}', 'axbY') === null, 'a literal dot means a dot');
  ok(match(w, 'template', 'a.b{x}', 'a.bY') !== null, 'and matches one');
  w.close();
}

console.log('\n=== 3. It refuses what it cannot do, and warns about what it can do wrongly ===');
{
  const { w } = boot();
  const dup = compile(w, 'template', '{a}x{a}');
  ok(!dup.ok && /used twice/.test(dup.error), 'a repeated field name is refused, not thrown', dup.error);
  const stray = compile(w, 'template', '{a}}b');
  ok(!stray.ok && /Stray/.test(stray.error), 'a stray brace is named', stray.error);
  ok(!compile(w, 'template', '   ').ok, 'an empty pattern is not an internal error');

  // Adjacency is only ambiguous when the first field is not narrower than the
  // second. {a:d}{b} splits cleanly; {a}{b:d} on "abc123" gives a="abc12", b="3".
  const adj = compile(w, 'template', '{a}{b}');
  ok(adj.ok, 'two adjacent fields of the same width still compile');
  ok(/side by side/.test(adj.warnings.join(' ')), 'but are warned about', adj.warnings.join('; '));
  ok(/side by side/.test(compile(w, 'template', '{a}{b:d}').warnings.join(' ')),
     'so is a wide field before a narrow one');
  ok(compile(w, 'template', '{a:d}{b}').warnings.length === 0,
     'but digits-then-word splits cleanly and is not',
     compile(w, 'template', '{a:d}{b}').warnings.join('; '));
  const split = match(w, 'template', '{a:d}{b}', '2080kbk');
  ok(split && split.a === undefined && split.fields.a === '2080' && split.fields.b === 'kbk',
     'and it really does split there', split && JSON.stringify(split.fields));

  const bad = compile(w, 'regex', '^(?<a>[)$');
  ok(!bad.ok && !!bad.error, 'a broken regex comes back as an error, not an exception', bad.error);
  const loose = compile(w, 'regex', '(?<a>\\d+)');
  ok(loose.ok && /unanchored/.test(loose.warnings.join(' ')),
     'an unanchored regex is warned about but honoured', loose.warnings.join('; '));
  const nogroups = compile(w, 'regex', '^\\d+$');
  ok(/captures nothing/.test(nogroups.warnings.join(' ')), 'a regex with no groups says so');
  w.close();
}

console.log('\n=== 4. The regex escape hatch handles what the template cannot ===');
{
  const { w } = boot();
  const RE = '^defbl(?<device>\\d+)c(?<threads>\\d+)(?<variant>kbki|kbk|)(?<measure>MemAcc)?$';
  const p = compile(w, 'regex', RE);
  ok(p.ok && p.hasMeasure, 'a {measure} group is recognised in regex mode too');

  const plain = match(w, 'regex', RE, 'defbl2080c512kbk');
  ok(plain && plain.fields.variant === 'kbk', 'the variant is captured', plain && plain.fields.variant);
  ok(plain && plain.fields.measure === '', 'and an optional group that did not fire reads as empty',
     plain && JSON.stringify(plain.fields.measure));

  const mem = match(w, 'regex', RE, 'defbl2080c512kbkMemAcc');
  ok(mem && mem.fields.variant === 'kbk' && mem.fields.measure === 'MemAcc',
     'while the same pattern separates the count column', mem && JSON.stringify(mem.fields));

  // this is exactly what the template gets wrong, and why the hatch exists
  const naive = match(w, 'template', '{device:d}c{threads:d}{variant}', '2080c512kbkMemAcc');
  ok(naive && naive.fields.variant === 'kbkMemAcc',
     'the template would have swallowed it into the variant — silently',
     naive && naive.fields.variant);
  w.close();
}

console.log('\n=== 5. The preview shows values, because a match can still be wrong ===');
{
  const { w } = boot();
  const pv = JSON.parse(w.eval('JSON.stringify(patternPreview('
    + 'compilePattern({kind:"template",text:"{device:d}c{threads:d}{variant}"}),'
    + ' ["app","2080c512","2080c512kbk","4070c256kbki"]))'));
  ok(pv.total === 4 && pv.matched === 3, '3 of 4 matched', pv.matched + '/' + pv.total);
  ok(pv.rows[0].ok === false && pv.rows[0].fields === null, 'the non-matching one is marked');
  ok(pv.rows[2].fields.variant === 'kbk', 'and every captured value is reported',
     JSON.stringify(pv.rows[2].fields));
  ok(pv.values.device.join(',') === '2080,4070', 'distinct values per field, in first-seen order',
     pv.values.device.join(','));
  ok(pv.values.variant.join('|') === '|kbk|kbki', 'including the empty one', pv.values.variant.join('|'));
  w.close();
}


// ---- driving the rebuild directly, before any UI exists ---------------------
// A record is { id, name, sources:[{filename, path, text}], recipe }. Building
// one by hand is how the reshape is tested independently of the review screen.
function build(w, sources, recipe) {
  return JSON.parse(w.eval('(function(){'
    + ' const ds = datasetFromRecord({ id:"t", name:"t", sources:'
    + JSON.stringify(sources) + ', recipe:' + JSON.stringify(recipe) + ' });'
    + ' return JSON.stringify({'
    + '   dims: ds.dims.map(d => d.key),'
    + '   dimLabels: ds.dims.map(d => d.label),'
    + '   values: ds.dims.reduce((o,d) => { o[d.key] = d.values; return o; }, {}),'
    + '   measures: ds.measures.map(m => m.key),'
    + '   formats: ds.measures.reduce((o,m) => { o[m.key] = m.format.key; return o; }, {}),'
    + '   nRows: ds.nRows, collapsed: ds.stats.collapsed, filled: ds.stats.filled }); })()'));
}
function valueAt(w, sources, recipe, ctx) {
  return w.eval('(function(){'
    + ' const ds = datasetFromRecord({ id:"t", name:"t", sources:'
    + JSON.stringify(sources) + ', recipe:' + JSON.stringify(recipe) + ' });'
    + ' return datasetValueAt(ds, ' + JSON.stringify(ctx) + '); })()');
}

const WIDE = 'app,2080c512,2080c512kbk,4070c512,4070c512kbk\n'
  + 'A,10,11,12,13\nB,20,21,22,23\nC,30,31,32,33\n';
const WIDE_SRC = [{ filename: 'w.csv', text: WIDE }];
const WIDE_RECIPE = {
  columns: [{ source: 'app', name: 'app', label: 'App', role: 'dimension' }],
  melt: {
    pattern: { kind: 'template', text: '{device:d}c{threads:d}{variant}' },
    fields: [
      { field: 'device', key: 'device', label: 'Device' },
      { field: 'threads', key: 'threads', label: 'Threads' },
      { field: 'variant', key: 'variant', label: 'Variant', labelOverride: { '': 'base' } },
    ],
    measure: { key: 'rate', label: 'Hit rate', format: 'pct' },
  },
};

console.log('\n=== 6. Wide columns melt into rows ===');
{
  const { w } = boot();
  const r = build(w, WIDE_SRC, WIDE_RECIPE);
  ok(r.dims.join(',') === 'app,device,threads,variant',
     'the id column comes first, then the pattern fields in written order', r.dims.join(','));
  ok(r.measures.join(',') === 'rate', 'one measure, as named', r.measures.join(','));
  ok(r.formats.rate === 'pct', 'in the format the recipe asked for');
  ok(r.nRows === 12, '3 rows x 4 matched columns = 12 tuples', r.nRows);
  ok(r.collapsed === 0, 'and nothing collapsed — every column had its own tuple', r.collapsed);
  ok(r.values.variant.join('|') === '|kbk', 'the empty capture is a real value', r.values.variant.join('|'));
  ok(r.values.device.join(',') === '2080,4070', 'devices came out of the names', r.values.device.join(','));

  const v = valueAt(w, WIDE_SRC, WIDE_RECIPE,
    { app: 'A', device: '4070', threads: '512', variant: 'kbk', metric: 'rate' });
  ok(v === 13, 'and a value lands where the header said it would', v);
  const bare = valueAt(w, WIDE_SRC, WIDE_RECIPE,
    { app: 'C', device: '2080', threads: '512', variant: '', metric: 'rate' });
  ok(bare === 30, 'including one from a column with no variant suffix', bare);
  w.close();
}

console.log('\n=== 7. A {measure} capture splits the value into several measures ===');
{
  const { w } = boot();
  const src = [{ filename: 'l.csv',
    text: 'app,2080c512ratioL1,2080c512ratioL2,4070c256ratioL1,4070c256ratioL2\nA,1,2,3,4\nB,5,6,7,8\n' }];
  const recipe = {
    columns: [{ source: 'app', name: 'app', label: 'App', role: 'dimension' }],
    melt: {
      pattern: { kind: 'template', text: '{device:d}c{threads:d}ratio{measure}' },
      fields: [{ field: 'device', key: 'device' }, { field: 'threads', key: 'threads' }],
      measures: [{ value: 'L1', key: 'L1', format: 'number' }, { value: 'L2', key: 'L2', format: 'number' }],
    },
  };
  const r = build(w, src, recipe);
  ok(r.measures.join(',') === 'L1,L2', 'each captured level is its own measure', r.measures.join(','));
  ok(r.dims.join(',') === 'app,device,threads', 'and it is not a dimension', r.dims.join(','));
  ok(r.nRows === 4, 'the two levels share a row, so 2 apps x 2 tuples = 4', r.nRows);
  ok(r.collapsed === 0, 'not 8 rows averaged down to 4', r.collapsed);
  ok(valueAt(w, src, recipe, { app: 'A', device: '4070', threads: '256', metric: 'L2' }) === 4,
     'and both land correctly');
  ok(valueAt(w, src, recipe, { app: 'B', device: '2080', threads: '512', metric: 'L1' }) === 5,
     'from either level');

  // declared order decides METRICS[0], so it must not depend on iteration order
  const flipped = JSON.parse(JSON.stringify(recipe));
  flipped.melt.measures.reverse();
  ok(build(w, src, flipped).measures.join(',') === 'L2,L1',
     'the declared order is the measure order', build(w, src, flipped).measures.join(','));
  w.close();
}

console.log('\n=== 8. The regex hatch separates mixed units in one row ===');
{
  const { w } = boot();
  const src = [{ filename: 'e.csv',
    text: 'app,defbl2080c512kbk,defbl2080c512kbkMemAcc,defbl2080c512kbki\nA,9.8,104.9,7.1\n' }];
  const recipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      pattern: { kind: 'regex',
        text: '^defbl(?<device>\\d+)c(?<threads>\\d+)(?<variant>kbki|kbk|)(?<measure>MemAcc)?$' },
      fields: [{ field: 'device', key: 'device' }, { field: 'threads', key: 'threads' },
        { field: 'variant', key: 'variant' }],
      measure: { key: 'rate', label: 'Hit rate', format: 'pct' },
      measures: [{ value: 'MemAcc', key: 'MemAcc', label: 'Accesses', format: 'count' }],
    },
  };
  const r = build(w, src, recipe);
  ok(r.measures.join(',') === 'rate,MemAcc', 'the fallback measure comes first', r.measures.join(','));
  ok(r.formats.rate === 'pct' && r.formats.MemAcc === 'count',
     'and they keep their own formats', JSON.stringify(r.formats));
  ok(r.values.variant.join('|') === 'kbk|kbki',
     'the variant is kbk, not kbkMemAcc — the count suffix was taken off it',
     r.values.variant.join('|'));
  ok(r.nRows === 2, 'two tuples, because the rate and the count share one', r.nRows);
  ok(valueAt(w, src, recipe, { app: 'A', device: '2080', threads: '512', variant: 'kbk', metric: 'rate' }) === 9.8,
     'the rate is the rate');
  ok(valueAt(w, src, recipe, { app: 'A', device: '2080', threads: '512', variant: 'kbk', metric: 'MemAcc' }) === 104.9,
     'and the count is the count, at the same tuple');
  ok(valueAt(w, src, recipe, { app: 'A', device: '2080', threads: '512', variant: 'kbki', metric: 'MemAcc' }) === null,
     'where a file has no count, there is a gap rather than a zero');
  w.close();
}

console.log('\n=== 9. An undeclared level imports rather than being dropped ===');
{
  const { w } = boot();
  const src = [{ filename: 'l.csv', text: 'app,c1ratioL1,c1ratioL3\nA,1,3\n' }];
  const recipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      pattern: { kind: 'template', text: 'c{n:d}ratio{measure}' },
      fields: [{ field: 'n', key: 'n' }],
      measures: [{ value: 'L1', key: 'L1', format: 'pct' }],
    },
  };
  const r = build(w, src, recipe);
  ok(r.measures.join(',') === 'L1,L3', 'the undeclared level is appended after the declared one',
     r.measures.join(','));
  ok(r.formats.L1 === 'pct' && r.formats.L3 === 'number',
     'the declared one keeps its format, the new one gets a plain default', JSON.stringify(r.formats));
  ok(valueAt(w, src, recipe, { app: 'A', n: '1', metric: 'L3' }) === 3, 'and its data is there');
  w.close();
}

console.log('\n=== 10. Repeated wide headers collapse loudly, not silently ===');
{
  const { w } = boot();
  const src = [{ filename: 'd.csv', text: 'app,c1x,c1x\nA,10,20\n' }];
  const recipe = {
    columns: [{ source: 'app', name: 'app', role: 'dimension' }],
    melt: {
      pattern: { kind: 'template', text: 'c{n:d}{tag}' },
      fields: [{ field: 'n', key: 'n' }, { field: 'tag', key: 'tag' }],
      measure: { key: 'v', format: 'number' },
    },
  };
  const r = build(w, src, recipe);
  ok(r.nRows === 1, 'the duplicate lands on the same tuple', r.nRows);
  ok(r.collapsed === 1, 'and is counted as a collapse rather than overwriting', r.collapsed);
  ok(valueAt(w, src, recipe, { app: 'A', n: '1', tag: 'x', metric: 'v' }) === 15,
     'the two are averaged, not last-write-wins');
  w.close();
}

console.log('\n=== 11. Directory levels become dimensions ===');
{
  const { w } = boot();
  const csv = 'app,rate\nA,1\nB,2\n';
  const src = [
    { filename: 'r.csv', path: 'eval/32x32/RTX2080/r.csv', text: csv },
    { filename: 'r.csv', path: 'eval/32x32/RTX4070/r.csv', text: csv },
    { filename: 'r.csv', path: 'eval/defBlock/RTX2080/r.csv', text: csv },
  ];
  const recipe = {
    columns: [
      { source: 'app', name: 'app', label: 'App', role: 'dimension' },
      { source: 'rate', name: 'rate', label: 'Rate', role: 'measure', format: 'pct' },
    ],
    path: {
      levels: [
        { index: 0, key: null },                              // "eval" — constant, ignored
        { index: 1, key: 'block', label: 'Block' },
        { index: 2, key: 'device', label: 'Device' },
      ],
    },
  };
  const r = build(w, src, recipe);
  ok(r.dims.join(',') === 'block,device,app',
     'path dimensions come before the row ones', r.dims.join(','));
  ok(r.dimLabels.slice(0, 2).join(',') === 'Block,Device', 'with the names given',
     r.dimLabels.join(','));
  ok(r.values.block.join(',') === '32x32,defBlock', 'level 1 became Block', r.values.block.join(','));
  ok(r.values.device.join(',') === 'RTX2080,RTX4070', 'level 2 became Device', r.values.device.join(','));
  ok(r.nRows === 6, '3 files x 2 rows, all kept apart', r.nRows);
  ok(valueAt(w, src, recipe, { block: 'defBlock', device: 'RTX2080', app: 'B', metric: 'rate' }) === 2,
     'and a value is reachable by its path');
  ok(valueAt(w, src, recipe, { block: 'defBlock', device: 'RTX4070', app: 'B', metric: 'rate' }) === null,
     'while a combination no file had is a gap');
  w.close();
}

console.log('\n=== 12. A pattern over the file name adds more ===');
{
  const { w } = boot();
  const csv = 'Config,rate\n0,1\n1,2\n';
  const src = [
    { filename: 'harris-corner-cc75_32B.csv', path: 'e/kbk/harris-corner-cc75_32B.csv', text: csv },
    { filename: 'hotspot-cc89_32B.csv', path: 'e/tiled/hotspot-cc89_32B.csv', text: csv },
  ];
  const recipe = {
    columns: [
      { source: 'Config', name: 'config', label: 'Config', role: 'dimension' },
      { source: 'rate', name: 'rate', role: 'measure', format: 'pct' },
    ],
    path: {
      levels: [{ index: 0, key: null }, { index: 1, key: 'variant', label: 'Variant' }],
      pattern: {
        on: 'stem',
        spec: { kind: 'template', text: '{app:*}-cc{cc:d}_32B' },
        fields: [{ field: 'app', key: 'app', label: 'App' }, { field: 'cc', key: 'cc', label: 'CC' }],
      },
    },
  };
  const r = build(w, src, recipe);
  ok(r.dims.join(',') === 'variant,app,cc,config',
     'directory levels first, then the name pattern, then the row columns', r.dims.join(','));
  ok(r.values.app.join(',') === 'harris-corner,hotspot',
     'the greedy {app:*} stopped at the LAST -cc', r.values.app.join(','));
  ok(r.values.cc.join(',') === '75,89', 'and the compute capability came out', r.values.cc.join(','));
  ok(valueAt(w, src, recipe, { variant: 'tiled', app: 'hotspot', cc: '89', config: '1', metric: 'rate' }) === 2,
     'a value is addressable by all four');
  w.close();
}

console.log('\n=== 13. A recipe written before any of this still loads ===');
{
  const { w } = boot();
  // exactly the shape the importer wrote before melt/path existed
  const src = [{ filename: 'tidy.csv', text: 'device,size,rate\n2080,512,73.6\n4070,256,62.1\n' }];
  const recipe = {
    columns: [
      { source: 'device', name: 'device', label: 'Device', role: 'dimension' },
      { source: 'size', name: 'size', label: 'Size', role: 'dimension' },
      { source: 'rate', name: 'rate', label: 'Rate', role: 'measure', format: 'pct', agg: 'mean' },
    ],
    sourceDim: null, sourceLabel: 'Source', parse: {},
  };
  const r = build(w, src, recipe);
  ok(r.dims.join(',') === 'device,size', 'the dimensions are unchanged', r.dims.join(','));
  ok(r.measures.join(',') === 'rate' && r.nRows === 2 && r.collapsed === 0,
     'and so are the rows', r.measures + ' / ' + r.nRows + ' / ' + r.collapsed);
  ok(valueAt(w, src, recipe, { device: '2080', size: '512', metric: 'rate' }) === 73.6,
     'and the values');

  // and with the Source dimension, which is the degenerate path dimension
  const two = [{ filename: 'a.csv', text: 'k,v\nx,1\n', label: 'runA' },
    { filename: 'b.csv', text: 'k,v\nx,2\n', label: 'runB' }];
  const rec2 = {
    columns: [{ source: 'k', name: 'k', role: 'dimension' }, { source: 'v', name: 'v', role: 'measure' }],
    sourceDim: '__source', sourceLabel: 'Source', parse: {},
  };
  const r2 = build(w, two, rec2);
  ok(r2.dims.join(',') === '__source,k', 'Source is still first', r2.dims.join(','));
  ok(r2.values.__source.join(',') === 'runA,runB', 'and still named by the file', r2.values.__source.join(','));
  w.close();
}

console.log('\n=== 14. recipeShape counts what the recipe will produce ===');
{
  const { w } = boot();
  const shape = r => JSON.parse(w.eval('JSON.stringify(recipeShape(' + JSON.stringify(r) + '))'));
  ok(JSON.stringify(shape(WIDE_RECIPE)) === '{"dims":4,"measures":1}',
     'a melt contributes its fields and its measure', JSON.stringify(shape(WIDE_RECIPE)));
  ok(JSON.stringify(shape({ columns: [{ name: 'a', role: 'dimension' }, { name: 'b', role: 'measure' }] }))
     === '{"dims":1,"measures":1}', 'a plain recipe counts as before');
  ok(shape({ columns: [], sourceDim: '__source', path: { levels: [{ index: 1, key: 'x' }] } }).dims === 2,
     'Source and path levels both count');
  w.close();
}


// ---- driving the review screen ---------------------------------------------
const wait = ms => new Promise(r => setTimeout(r, ms));
function dataTab(d) { d.querySelector('.mode-tab[data-mode="data"]').click(); }
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
const shape = w => JSON.parse(w.eval('JSON.stringify({'
  + ' dims: DS.dims.map(d => d.key), labels: DS.dims.map(d => d.label),'
  + ' measures: DS.measures.map(m => m.key), nRows: DS.nRows,'
  + ' collapsed: DS.stats.collapsed })'));

const WIDE_CSV = 'app,2080c512,2080c512kbk,4070c512,4070c512kbk\n'
  + 'A,10,11,12,13\nB,20,21,22,23\nC,30,31,32,33\n';

console.log('\n=== 15. The review screen splits column names ===');
(async function () {
  const { w, d } = boot();
  dataTab(d);
  pick(w, [{ name: 'wide.csv', text: WIDE_CSV }]);
  await wait(60);
  ok(!!review(d), 'the review opens');
  ok(!!colRow(d, '2080c512'), 'and without a pattern every wide column is its own column');

  enable(w, d, 'melt-enable');
  await wait(20);
  ok(!!d.getElementById('melt-pattern'), 'switching the split on offers a pattern box');
  ok(importBtn(d).disabled, 'and blocks the import until it says something', outcome(d));
  // the names are what you write the pattern against, so they are listed first
  ok(d.querySelectorAll('.melt-preview tbody tr').length === 5,
     'every column name is listed before anything is typed',
     d.querySelectorAll('.melt-preview tbody tr').length);
  ok(/type a pattern above/.test(d.querySelector('.import-reshape .import-summary').textContent),
     'with an invitation rather than a count of nothing',
     d.querySelector('.import-reshape .import-summary').textContent);

  setPattern(w, d, 'melt-pattern', '{a}x{a}');
  await wait(220);
  ok(d.querySelectorAll('.melt-preview tbody tr').length === 5,
     'a pattern that will not compile does not take the names away',
     d.querySelectorAll('.melt-preview tbody tr').length);
  ok(/used twice/.test(review(d).textContent), 'the error is shown alongside them');

  setPattern(w, d, 'melt-pattern', '{device:d}c{threads:d}{variant}');
  await wait(220);          // the input is debounced
  const pv = d.querySelectorAll('.melt-preview tbody tr');
  ok(pv.length === 5, 'the preview lists every column name', pv.length);
  ok(d.querySelector('.melt-preview tr[data-name="app"]').classList.contains('melt-miss'),
     '"app" is shown as not matching');
  ok(/4 of 5 column names matched/.test(d.querySelector('.import-reshape .import-summary').textContent),
     'and the count is stated', d.querySelector('.import-reshape .import-summary').textContent);
  ok(d.querySelector('.melt-preview tr[data-name="2080c512"]').textContent.indexOf('(empty)') !== -1,
     'an empty capture is shown as empty, not as a blank cell');

  ok(!colRow(d, '2080c512'), 'the matched columns leave the column table');
  ok(!!colRow(d, 'app'), 'the unmatched one stays');
  ok(!!colRow(d, 'melt:device') && !!colRow(d, 'melt:threads') && !!colRow(d, 'melt:variant'),
     'and the captured fields appear as rows of their own');
  ok(colRow(d, 'melt:device').getAttribute('data-synthetic') === 'melt',
     'marked as coming from the split, not from a header');
  const emptyIn = d.getElementById('melt-empty-variant');
  ok(!!emptyIn && emptyIn.value === 'base', 'the empty variant is pre-named rather than left blank',
     emptyIn && emptyIn.value);

  ok(!importBtn(d).disabled, 'the import is unblocked', outcome(d));
  ok(/12 rows \(from 3 in the files\)/.test(outcome(d)),
     'and says how many rows the split will make', outcome(d));

  importBtn(d).click();
  await wait(60);
  const s = shape(w);
  ok(s.dims.join(',') === 'app,device,threads,variant', 'the dataset has the four dimensions',
     s.dims.join(','));
  ok(s.nRows === 12 && s.collapsed === 0, 'with a row per tuple and nothing averaged away',
     s.nRows + '/' + s.collapsed);
  ok(w.eval('metricValueAt({app:"A",device:"4070",threads:"512",variant:"kbk",metric:"value"})') === 13,
     'and the numbers landed where the headers said');
  ok(w.eval('dimValueLabel("variant","")') === 'base', 'the empty variant reads as "base"');
  ok(w.eval('JSON.stringify(defaultZones())')
     === '{"x":["device","threads"],"series":["variant"],"facet":["app"]}',
     'the pattern order became the axis order', w.eval('JSON.stringify(defaultZones())'));
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
     d.querySelectorAll('#plots rect.bar').length);
  w.close();
  await section16();
})();

async function section16() {
  console.log('\n=== 16. A {measure} capture, and the format per measure ===');
  const { w, d } = boot();
  dataTab(d);
  pick(w, [{ name: 'lv.csv', text: 'app,c512ratioL1,c512ratioL2,c256ratioL1,c256ratioL2\nA,1,2,3,4\n' }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(20);
  setPattern(w, d, 'melt-pattern', 'c{threads:d}ratio{measure}');
  await wait(220);
  ok(!!colRow(d, 'melt:L1') && !!colRow(d, 'melt:L2'), 'each level becomes a measure row');
  ok(!colRow(d, 'melt:measure'), 'and {measure} is not offered as a dimension');
  ok(colRow(d, 'melt:L1').querySelectorAll('td')[2].textContent === 'Measure',
     'its role is fixed', colRow(d, 'melt:L1').querySelectorAll('td')[2].textContent);

  const fmt = colRow(d, 'melt:L2').querySelector('select');
  fmt.value = 'pct';
  fmt.dispatchEvent(new w.Event('change'));
  importBtn(d).click();
  await wait(60);
  const s = shape(w);
  ok(s.measures.join(',') === 'L1,L2', 'both measures arrive', s.measures.join(','));
  ok(w.eval('METRIC_BY_KEY.L2.format.key') === 'pct'
     && w.eval('METRIC_BY_KEY.L1.format.key') !== 'pct',
     'and the format was set on one of them alone',
     w.eval('METRIC_BY_KEY.L1.format.key + "/" + METRIC_BY_KEY.L2.format.key'));
  ok(s.nRows === 2, 'the two levels share a tuple', s.nRows);
  w.close();
  await section17();
}

async function section17() {
  console.log('\n=== 17. Folders become dimensions ===');
  const { w, d } = boot();
  dataTab(d);
  const csv = 'app,rate\nA,1\nB,2\n';
  pick(w, [
    { name: 'r.csv', path: 'eval/32x32/RTX2080/r.csv', text: csv },
    { name: 'r.csv', path: 'eval/32x32/RTX4070/r.csv', text: csv },
    { name: 'r.csv', path: 'eval/defBlock/RTX2080/r.csv', text: csv },
  ], 'csv-dir-input');
  await wait(60);
  const lv = d.querySelectorAll('.path-levels tbody tr');
  ok(lv.length === 3, 'the three folder levels above the file are listed', lv.length);
  ok(d.querySelector('.path-levels tr[data-level="0"]').classList.contains('col-partial'),
     'the level every file shares is dimmed');
  ok(d.querySelector('.path-levels tr[data-level="0"] select').value === 'ignore',
     'and defaults to being ignored');
  ok(d.querySelector('.path-levels tr[data-level="1"] select').value === 'dimension',
     'while a level that varies is offered as a dimension');

  d.getElementById('path-name-1').value = 'Block';
  d.getElementById('path-name-1').dispatchEvent(new w.Event('input'));
  d.getElementById('path-name-2').value = 'Device';
  d.getElementById('path-name-2').dispatchEvent(new w.Event('input'));
  await wait(220);
  ok(!!colRow(d, 'path:block') && !!colRow(d, 'path:device'),
     'naming them gives them keys');
  const src = d.getElementById('add-source-dim');
  ok(src && !src.checked, 'and the Source dimension is off, since the folders already separate them');

  importBtn(d).click();
  await wait(60);
  const s = shape(w);
  ok(s.dims.join(',') === 'block,device,app', 'folders come before the row dimensions', s.dims.join(','));
  ok(s.labels.slice(0, 2).join(',') === 'Block,Device', 'with the names given', s.labels.join(','));
  ok(s.nRows === 6, 'and every file kept its rows', s.nRows);
  ok(w.eval('metricValueAt({block:"defBlock",device:"RTX2080",app:"B",metric:"rate"})') === 2,
     'a value is reachable by its folder');
  w.close();
  await section18();
}

async function section18() {
  console.log('\n=== 18. Guards, and what the folder picker refuses ===');
  const { w, d } = boot();
  dataTab(d);
  pick(w, [{ name: 'wide.csv', text: WIDE_CSV }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(20);

  setPattern(w, d, 'melt-pattern', 'zzz{a}');
  await wait(220);
  ok(importBtn(d).disabled, 'a pattern that matches nothing blocks the import');
  ok(/matches none of the column names/.test(review(d).textContent),
     'and says exactly that', outcome(d));

  setPattern(w, d, 'melt-pattern', '{a}x{a}');
  await wait(220);
  ok(importBtn(d).disabled, 'so does one that will not compile');
  ok(/used twice/.test(review(d).textContent), 'with the compiler error shown');

  setPattern(w, d, 'melt-pattern', '{app:d}c{threads:d}{variant}');
  await wait(220);
  ok(importBtn(d).disabled, 'a field named the same as a column blocks it too');
  ok(/both called "app"/.test(outcome(d)), 'and names the collision', outcome(d));
  w.close();

  // the folder picker only takes CSVs
  const two = boot();
  dataTab(two.d);
  pick(two.w, [
    { name: 'a.csv', path: 'f/a.csv', text: 'k,v\nx,1\n' },
    { name: 'notes.png', path: 'f/notes.png', text: 'not a csv at all' },
  ], 'csv-dir-input');
  await wait(60);
  ok(/2 files in that folder, 1 of them CSVs/.test(two.d.getElementById('data-status').textContent),
     'a folder of mixed files is filtered, and says so',
     two.d.getElementById('data-status').textContent);
  ok(/1 file · 1 rows/.test(two.d.querySelector('.import-summary').textContent),
     'only the CSV was staged', two.d.querySelector('.import-summary').textContent);
  two.w.close();
  await section19();
}

async function section19() {
  console.log('\n=== 19. The reshape is stored, and replays on reload ===');
  const { w, d } = boot();
  dataTab(d);
  pick(w, [{ name: 'wide.csv', text: WIDE_CSV }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(20);
  setPattern(w, d, 'melt-pattern', '{device:d}c{threads:d}{variant}');
  await wait(220);
  importBtn(d).click();
  await wait(60);

  const recs = JSON.parse(await w.eval('STORE.list().then(r => JSON.stringify(r))'));
  ok(recs.length === 1, 'one dataset was stored', recs.length);
  const rec = recs[0];
  ok(rec.recipe.melt.pattern.text === '{device:d}c{threads:d}{variant}',
     'the recipe holds the pattern as typed', rec.recipe.melt.pattern.text);
  ok(rec.recipe.columns.map(c => c.source).join(',') === 'app',
     'and only the columns the split did not claim', rec.recipe.columns.map(c => c.source).join(','));
  ok(rec.recipe.melt.fields.map(f => f.key).join(',') === 'device,threads,variant',
     'with the captured fields', rec.recipe.melt.fields.map(f => f.key).join(','));
  ok(rec.recipe.melt.fields[2].labelOverride[''] === 'base', 'and the empty-value label');
  ok(rec.sources[0].text === WIDE_CSV, 'the raw file is what is stored, not the melted rows');

  // reload it the way a fresh visit would
  const back = JSON.parse(w.eval('(function(){'
    + ' const ds = datasetFromRecord(' + JSON.stringify(rec) + ');'
    + ' return JSON.stringify({ dims: ds.dims.map(x => x.key), nRows: ds.nRows,'
    + '   v: datasetValueAt(ds, {app:"A",device:"4070",threads:"512",variant:"kbk",metric:"value"}) }); })()'));
  ok(back.dims.join(',') === 'app,device,threads,variant', 'rebuilding replays the split',
     back.dims.join(','));
  ok(back.nRows === 12 && back.v === 13, 'down to the same value at the same tuple',
     back.nRows + '/' + back.v);
  w.close();
  await section20();
}

async function section20() {
  console.log('\n=== 20. A layout saved against other data does not empty the chart ===');
  // Found by section 15: the autosave is written 300ms after the page settles,
  // so importing after that restored the PREVIOUS dataset's layout, every value
  // was filtered away as unknown, and the chart came out blank with nothing said.
  const { w, d } = boot();
  await wait(400);                       // let the autosave debounce fire
  ok(!!w.localStorage.getItem('viz-builder-autosave-v1'),
     'the fixture wrote an autosave');
  ok(w.localStorage.getItem('viz-builder-autosave-shape-v1') === w.eval('datasetFingerprint()'),
     'tagged with the shape it belongs to');

  dataTab(d);
  pick(w, [{ name: 'other.csv', text: 'kind,score\np,1\nq,2\n' }]);
  await wait(60);
  importBtn(d).click();
  await wait(60);
  ok(w.eval('DS.dims.map(x=>x.key).join(",")') === 'kind', 'a different dataset is imported');
  ok(w.eval('JSON.stringify(plots[0].included.kind)') === '["p","q"]',
     'and it shows its own values rather than nothing', w.eval('JSON.stringify(plots[0].included)'));
  ok(d.querySelectorAll('#plots rect.bar').length === 2, 'so the chart draws',
     d.querySelectorAll('#plots rect.bar').length);

  // the repair also covers a named view loaded against data it was not saved for
  const stale = '[{"chartType":"bars","zones":{"x":["kind"],"series":[],"facet":[]},'
    + '"included":{"kind":["gone","missing"],"metric":["score"]}}]';
  w.eval('applyConfig(' + stale + ')');
  ok(w.eval('JSON.stringify(plots[0].included.kind)') === '["p","q"]',
     'a view naming values that no longer exist falls back to the defaults',
     w.eval('JSON.stringify(plots[0].included.kind)'));
  ok(d.querySelectorAll('#plots rect.bar').length === 2, 'rather than drawing nothing');

  // but a list the user deliberately emptied is still honoured
  const emptied = '[{"chartType":"bars","zones":{"x":["kind"],"series":[],"facet":[]},'
    + '"included":{"kind":[],"metric":["score"]}}]';
  w.eval('applyConfig(' + emptied + ')');
  ok(w.eval('JSON.stringify(plots[0].included.kind)') === '[]',
     'an empty list that was empty when saved is left empty',
     w.eval('JSON.stringify(plots[0].included.kind)'));
  w.close();
  await section21();
}

async function section21() {
  console.log('\n=== 21. Naming a melted measure re-proposes its format ===');
  // The format guess reads the column name, and a melted measure has no name
  // until it is given one -- so a column of percentages arrives as a plain
  // number until you say what it is.
  const { w, d } = boot();
  dataTab(d);
  pick(w, [{ name: 'w.csv', text: 'app,2080c512,2080c512kbk\nA,38.96,59.6\nB,55.53,70.1\n' }]);
  await wait(60);
  enable(w, d, 'melt-enable');
  await wait(20);
  setPattern(w, d, 'melt-pattern', '{device:d}c{threads:d}{variant}');
  await wait(220);
  const fmtOf = () => colRow(d, 'melt:value').querySelector('select').value;
  ok(fmtOf() === 'number', 'an unnamed measure is proposed as a plain number', fmtOf());

  const nameIn = d.getElementById('melt-measure-value');
  nameIn.value = 'Hit rate';
  nameIn.dispatchEvent(new w.Event('input'));
  await wait(220);
  ok(fmtOf() === 'pct', 'naming it "Hit rate" re-proposes a percentage', fmtOf());

  // ... but not once the format has been set by hand
  const sel = colRow(d, 'melt:value').querySelector('select');
  sel.value = 'fraction';
  sel.dispatchEvent(new w.Event('change'));
  const n2 = d.getElementById('melt-measure-value');
  n2.value = 'Access count';
  n2.dispatchEvent(new w.Event('input'));
  await wait(220);
  ok(fmtOf() === 'fraction', 'a format chosen by hand is not overwritten by a later rename', fmtOf());

  sel.value = 'pct';
  sel.dispatchEvent(new w.Event('change'));
  importBtn(d).click();
  await wait(60);
  ok(w.eval('METRICS[0].label') === 'Access count', 'the name is carried through', w.eval('METRICS[0].label'));
  ok(w.eval('METRICS[0].format.key') === 'pct', 'and so is the format');
  ok(w.eval('metricValueAt({app:"B",device:"2080",threads:"512",variant:"kbk",metric:METRICS[0].key})') === 70.1,
     'with the data behind it');
  w.close();
  await section22();
}

async function section22() {
  console.log('\n=== 22. A wide import still opens on a chart, not a refusal ===');
  // The x-axis nests, so its width is the product of its dimensions. Ten of them
  // ask for more cells than the renderer will draw, and the first thing after
  // importing would be "that would draw 1,234,926 cells" instead of a chart.
  const { w, d } = boot();
  dataTab(d);
  // eight dimensions plus a measure, in one tidy file
  const cols = ['a', 'b', 'c', 'e', 'f', 'g', 'h', 'i'];
  // four values each, so the axis product (4^8) is far past what will render
  let text = cols.join(',') + ',v\n';
  for (let n = 0; n < 64; n++) {
    text += cols.map((_, k) => 'x' + ((n + k) % 4)).join(',') + ',' + n + '\n';
  }
  pick(w, [{ name: 'wide8.csv', text }]);
  await wait(60);
  cols.forEach(k => {
    const sel = colRow(d, k).querySelectorAll('select')[0];
    sel.value = 'dimension';
    sel.dispatchEvent(new w.Event('change'));
  });
  await wait(30);
  importBtn(d).click();
  await wait(80);

  ok(w.eval('GROUPABLE_KEYS.length') === 8, 'eight groupable dimensions', w.eval('GROUPABLE_KEYS.length'));
  const z = JSON.parse(w.eval('JSON.stringify(plots[0].zones)'));
  ok(z.facet[0] === 'a', 'the first still facets', z.facet.join(','));
  ok(z.series.join(',') === 'i', 'the last still colours the series', z.series.join(','));
  ok(z.facet.length > 1, 'and what will not fit on the axis facets instead',
     JSON.stringify(z));
  const width = z.x.concat(z.series)
    .reduce((n, k) => n * w.eval('DIM_BY_KEY["' + k + '"].values.length'), 1);
  ok(width <= 500, 'the axis stays inside its budget', width);
  ok(!d.querySelector('#plots .plot-empty'), 'so nothing is refused',
     (d.querySelector('#plots .plot-empty') || {}).textContent);
  ok(d.querySelectorAll('#plots rect.bar').length > 0, 'and it draws',
     d.querySelectorAll('#plots rect.bar').length);

  // the refusal is still there for a layout the user builds themselves
  w.eval('plots[0].zones = { x: GROUPABLE_KEYS.slice(0, -1), series: [GROUPABLE_KEYS[7]], facet: [] };'
    + ' GROUPABLE_KEYS.forEach(k => { plots[0].included[k] = DIM_BY_KEY[k].values.slice(); });'
    + ' renderPlots();');
  const refused = d.querySelector('#plots .plot-empty');
  ok(!!refused && /would draw/.test(refused.textContent),
     'dragging everything onto the axis is still refused, with a reason',
     refused && refused.textContent);
  w.close();

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

