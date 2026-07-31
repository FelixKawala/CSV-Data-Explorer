// extracting dimension values from a string
//
// A CSV is not always tidy. Two places routinely carry dimensions that the rows
// themselves do not:
//
//   a column name    2080c512kbki   -> device 2080, threads 512, variant kbki
//   a file path      defBlock/RTX2080/kbk/harris-cc75.csv
//
// This module is the extractor both use. It knows nothing about CSVs, datasets
// or the DOM -- it turns a pattern plus a string into named fields, and reports
// honestly when it does not match.
//
// Two dialects. A template is for the common case and reads like the thing it
// matches; a raw regular expression is the escape hatch for when it does not.
// Both compile to a RegExp with named groups, so everything downstream sees one
// shape.

// The capture that names a measure rather than a dimension. Reserved: a field
// called `measure` selects which column the value lands in, not which row.
const PATTERN_MEASURE_FIELD = 'measure';

// `{name}`, `{name:d}`, `{name:*}`. The name grammar is exactly JavaScript's
// named-capture grammar, so an illegal name is rejected here with something
// readable rather than thrown by RegExp with something that is not.
const PATTERN_PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)(?::([d*]))?\}/g;
// `rank` orders the character classes by breadth: digits ⊂ word ⊂ anything.
// Two fields with nothing between them split the text only where the first one
// cannot reach any further, so the split is well defined exactly when the first
// class is strictly narrower than the second -- {a:d}{b} gives the digits to a
// and the rest to b, predictably. Otherwise the first is greedy over characters
// the second also wants and backtracks to the minimum, which surprises everyone:
// {a}{b:d} on "abc123" gives a="abc12" and b="3".
const PATTERN_TYPES = {
  d: { body: '\\d', rank: 0, hint: 'digits' },
  w: { body: '[A-Za-z0-9]', rank: 1, hint: 'a word' },
  '*': { body: '[\\s\\S]', rank: 2, hint: 'anything' },
};
function patternType(t) { return PATTERN_TYPES[t] || PATTERN_TYPES.w; }

function escapeLiteral(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function splitTemplate(text) {
  const toks = [];
  let last = 0;
  let m;
  PATTERN_PLACEHOLDER.lastIndex = 0;
  while ((m = PATTERN_PLACEHOLDER.exec(text))) {
    if (m.index > last) toks.push({ lit: text.slice(last, m.index) });
    toks.push({ name: m[1], type: m[2] || 'w' });
    last = m.index + m[0].length;
  }
  if (last < text.length) toks.push({ lit: text.slice(last) });
  return toks;
}

// spec: { kind: 'template' | 'regex', text }
// -> { ok, kind, text, source, re, fields, hasMeasure, warnings, error }
function compilePattern(spec) {
  const kind = (spec && spec.kind) === 'regex' ? 'regex' : 'template';
  const text = String((spec && spec.text) || '');
  const out = {
    ok: false, kind, text, source: '', re: null,
    fields: [], hasMeasure: false, warnings: [], error: null,
  };
  if (!text.trim()) { out.error = 'Write a pattern first.'; return out; }

  if (kind === 'regex') {
    out.source = text;
    const nameRe = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;
    let m;
    while ((m = nameRe.exec(text))) out.fields.push(m[1]);
    if (!out.fields.length) out.warnings.push('no (?<name>…) groups — this captures nothing');
    // Not auto-anchored: choosing the regex dialect means choosing to be in
    // control, and silently adding ^…$ would break a deliberate partial match.
    if (text.charAt(0) !== '^' || text.charAt(text.length - 1) !== '$') {
      out.warnings.push('unanchored — it will match part of a name, not the whole of it');
    }
  } else {
    const toks = splitTemplate(text);
    if (toks.some(t => t.lit !== undefined && /[{}]/.test(t.lit))) {
      out.error = 'Stray { or } — a placeholder looks like {name}, {name:d} or {name:*}.';
      return out;
    }
    let src = '';
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.lit !== undefined) { src += escapeLiteral(t.lit); continue; }
      if (out.fields.indexOf(t.name) !== -1) {
        out.error = '{' + t.name + '} is used twice — each name may appear once.';
        return out;
      }
      const prev = toks[i - 1];
      if (prev && prev.lit === undefined && patternType(prev.type).rank >= patternType(t.type).rank) {
        out.warnings.push('{' + prev.name + '} and {' + t.name
          + '} sit side by side with nothing between them, and {' + prev.name
          + '} is not narrower — it will take almost everything. Put some text between them,'
          + ' or narrow it with :d.');
      }
      out.fields.push(t.name);
      // Only the last field may match nothing, and never a digits field: a
      // number that captured no digits is never what was meant, and letting it
      // would make {a:d}{b:d} silently give everything to one of them.
      const trailing = i === toks.length - 1;
      src += '(?<' + t.name + '>' + patternType(t.type).body
        + (trailing && t.type !== 'd' ? '*' : '+') + ')';
    }
    // Anchoring is what makes "did not match" mean something. It is why a
    // header like `app` falls through and stays an ordinary column.
    out.source = '^' + src + '$';
  }

  try {
    out.re = new RegExp(out.source);
  } catch (e) {
    out.error = e.message;
    return out;
  }
  out.hasMeasure = out.fields.indexOf(PATTERN_MEASURE_FIELD) !== -1;
  out.ok = true;
  return out;
}

// -> null when it does not match, else { input, fields: { name: string } }.
// A group that did not participate reads as '' rather than undefined: that is
// what lets an optional `(?<measure>MemAcc)?` fall back to the default measure
// instead of inventing a measure called "undefined".
function matchPattern(pat, input) {
  if (!pat || !pat.ok) return null;
  const s = String(input);
  const m = pat.re.exec(s);
  if (!m) return null;
  const fields = {};
  for (let i = 0; i < pat.fields.length; i++) {
    const v = m.groups ? m.groups[pat.fields[i]] : undefined;
    fields[pat.fields[i]] = v === undefined ? '' : v;
  }
  return { input: s, fields };
}

// Everything the review UI needs to show what a pattern did. Deliberately
// returns the captured values for every input, not a match/no-match tick: a
// pattern can match and still be wrong -- {variant} happily swallows
// "kbkMemAcc" -- and only the values make that visible.
function patternPreview(pat, inputs) {
  const rows = [];
  const values = {};
  const fields = pat && pat.ok ? pat.fields : [];
  fields.forEach(f => { values[f] = []; });
  let matched = 0;
  (inputs || []).forEach(input => {
    const m = matchPattern(pat, input);
    if (m) {
      matched++;
      fields.forEach(f => {
        if (values[f].indexOf(m.fields[f]) === -1) values[f].push(m.fields[f]);
      });
    }
    rows.push({ input: String(input), ok: !!m, fields: m ? m.fields : null });
  });
  return { rows, values, fields, matched, total: rows.length };
}

// A short description of the dialect, for the help line under the input.
function patternHelp(kind) {
  if (kind === 'regex') {
    return 'A regular expression with named groups: ^(?<device>\\d+)c(?<threads>\\d+)(?<variant>.*)$';
  }
  return '{name} a word · {name:d} digits · {name:*} anything · other text matches itself. '
    + 'Name a field {measure} to have its text pick the measure instead of a dimension.';
}
