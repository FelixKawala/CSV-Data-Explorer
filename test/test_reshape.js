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

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
