// CSV parsing
//
// Small and strict rather than clever: RFC4180 quoting, a sniffed delimiter, a
// comment prefix, and honest reporting of ragged rows. A parser that silently
// repairs malformed input produces charts nobody can account for.

const CSV_DELIMS = [',', ';', '\t', '|'];

function sniffDelimiter(text) {
  const line = text.split('\n').find(l => l.trim() && l[0] !== '#') || '';
  let best = ',';
  let bestN = 0;
  CSV_DELIMS.forEach(d => {
    // count only separators outside quotes
    let n = 0;
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    if (n > bestN) { bestN = n; best = d; }
  });
  return best;
}

// -> { header: [string], rows: [[string]], comments: [string], ragged: [{line, got, want}] }
function parseCsv(text, opts) {
  opts = opts || {};
  let src = String(text || '');
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);          // BOM
  const delim = opts.delimiter || sniffDelimiter(src);
  const commentPrefix = opts.commentPrefix === undefined ? '#' : opts.commentPrefix;

  const comments = [];
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  let started = false;

  const endField = () => { record.push(field); field = ''; started = false; };
  const endRecord = () => {
    endField();
    // a trailing newline produces one empty record; drop it
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !started) { quoted = true; started = true; continue; }
    if (c === delim) { endField(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { endRecord(); continue; }
    field += c;
    started = true;
  }
  if (field !== '' || record.length) endRecord();

  // comment lines are only comments before any data
  const body = [];
  records.forEach(r => {
    if (!body.length && commentPrefix && r.length && r[0].slice(0, commentPrefix.length) === commentPrefix) {
      comments.push(r.join(delim).slice(commentPrefix.length).trim());
      return;
    }
    body.push(r);
  });

  const header = (body.shift() || []).map((h, i) => h.trim() || ('column ' + (i + 1)));
  const ragged = [];
  const rows = body.filter((r, i) => {
    if (r.length === header.length) return true;
    ragged.push({ line: i + 2, got: r.length, want: header.length });
    return r.length > 1;                       // keep it, padded/truncated below
  }).map(r => {
    if (r.length === header.length) return r;
    const out = r.slice(0, header.length);
    while (out.length < header.length) out.push('');
    return out;
  });

  return { header, rows, comments, delimiter: delim, ragged };
}

// Duplicate header names would silently shadow each other in a record object.
function dedupeHeader(header) {
  const seen = {};
  return header.map(h => {
    if (!seen[h]) { seen[h] = 1; return h; }
    seen[h] += 1;
    return h + ' (' + seen[h] + ')';
  });
}

const NUMERIC_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
function isNumeric(v) {
  const t = String(v).trim();
  return t !== '' && NUMERIC_RE.test(t);
}

// What a column looks like, so the import can propose a role and a format
// rather than making the user classify every column from scratch.
function profileColumn(name, values) {
  const nonEmpty = values.filter(v => String(v).trim() !== '');
  const nums = nonEmpty.filter(isNumeric).map(Number);
  const numeric = nonEmpty.length > 0 && nums.length === nonEmpty.length;
  const distinct = new Set(nonEmpty.map(String));
  const p = {
    name,
    numeric,
    distinct: distinct.size,
    filled: nonEmpty.length,
    total: values.length,
    sample: Array.from(distinct).slice(0, 5),
  };
  if (numeric && nums.length) {
    p.min = Math.min.apply(null, nums);
    p.max = Math.max.apply(null, nums);
    p.allInt = nums.every(n => Number.isInteger(n));
    // Written with a decimal point, even "10.0", it is a measurement. Identifiers
    // are not written that way, and Number.isInteger cannot tell the difference.
    p.written = nonEmpty.some(v => /[.eE]/.test(String(v)));
  }
  return p;
}

// Deliberately excludes 'size' and 'bytes': a configuration size is a dimension
// as often as a byte count is a measure, and the structural rule below decides
// that case better than the name does.
const MEASURE_NAME_RE = /rate|ratio|pct|percent|count|latency|throughput|bandwidth|score|mean|median|avg|hits|misses/i;
function suggestRole(p) {
  // A column with no value in any row is neither. Proposed as a dimension -- as
  // every non-numeric column was -- it becomes a real dimension with one empty
  // value, which then takes a zone, an axis band and a chip with nothing written
  // on it. A file with several (a trailing comma on every line makes one; so do
  // the placeholder columns an exporter leaves behind) filled the default layout
  // with them and pushed the column that mattered into Facets, so the first
  // thing seen was one bar.
  if (!p.filled) return 'ignore';
  if (!p.numeric) return 'dimension';
  if (p.written) return 'measure';                 // a decimal point settles it
  if (MEASURE_NAME_RE.test(p.name)) return 'measure';
  // a small-range integer column with few distinct values reads as an identifier
  // (a configuration, a size, a year) far more often than as a measurement
  if (p.allInt && p.distinct <= 12 && (p.max === undefined || p.max < 4096)) return 'dimension';
  return 'measure';
}

function suggestFormat(p) {
  const n = p.name.toLowerCase();
  if (!p.numeric) return 'number';
  if (p.min !== undefined && p.min >= 0 && p.max <= 1 && /%|rate|ratio|frac|share/.test(n)) return 'fraction';
  if (p.min !== undefined && p.min >= 0 && p.max <= 100 && /%|pct|rate|percent/.test(n)) return 'pct';
  if (p.min !== undefined && p.min < 0) return 'delta';
  if (/byte|size|mem/.test(n)) return 'bytes';
  if (/time|dur|latency|ms$|sec/.test(n)) return 'duration';
  if (p.allInt && p.max !== undefined && p.min > 0 && p.max / Math.max(p.min, 1) >= 100) return 'count';
  if (/count|accesses|hits|misses|ops/.test(n)) return 'count';
  return 'number';
}
