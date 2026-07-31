// a calculator: define a measure as arithmetic over other measures
//
//   (100% - [L2 Hit Rate]) * [L2 Accesses]      -> the miss count
//
// The comparison form next door builds one fixed shape (a measure compared
// between two values of a dimension). This is the open version: any expression
// over any measures, evaluated per dimension tuple like any other measure.
//
// The hard part is not parsing, it is units. A hit rate is stored as 62.13
// because that is how an axis reads it, so the naive reading of the expression
// above is a hundred times the miss count -- and it would look plausible.
// So every operand is converted to its dimensionless value before any
// arithmetic (`ratioScale`), the result's kind is inferred from the operands
// (`quantityClass`), and the single conversion back happens at the end. That is
// why `ratio x count` yields a count, and why the expression above is right
// whether the rate is stored as 62.13 or as 0.6213.

const FORMULA_FUNCS = {
  abs: { arity: [1, 1], cls: 'same', fn: a => Math.abs(a[0]) },
  min: { arity: [2, 9], cls: 'same', fn: a => Math.min.apply(null, a) },
  max: { arity: [2, 9], cls: 'same', fn: a => Math.max.apply(null, a) },
  clamp: { arity: [3, 3], cls: 'same', fn: a => Math.min(Math.max(a[0], a[1]), a[2]) },
  sqrt: { arity: [1, 1], cls: 'number', fn: a => (a[0] < 0 ? null : Math.sqrt(a[0])) },
  ln: { arity: [1, 1], cls: 'number', fn: a => (a[0] <= 0 ? null : Math.log(a[0])) },
  log10: { arity: [1, 1], cls: 'number', fn: a => (a[0] <= 0 ? null : Math.log10(a[0])) },
  exp: { arity: [1, 1], cls: 'number', fn: a => Math.exp(a[0]) },
};

function formulaError(message, pos) {
  const e = new Error(message);
  e.pos = pos;
  e.formula = true;
  return e;
}

// ---- tokenizer --------------------------------------------------------------
// `[Bracketed Name]` is how a measure whose label has spaces is referenced; a
// bare identifier works when the name is a single word.
function tokenizeFormula(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') {
      const end = src.indexOf(']', i + 1);
      if (end === -1) throw formulaError('Unclosed "[" — a name in brackets needs a closing "]".', i);
      out.push({ t: 'name', v: src.slice(i + 1, end).trim(), pos: i });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      const pos = i;
      i += m[0].length;
      if (src[i] === '%') { i++; out.push({ t: 'pct', v: Number(m[0]), pos }); }
      else out.push({ t: 'num', v: Number(m[0]), pos });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      out.push({ t: 'ident', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^(),'.indexOf(c) !== -1) { out.push({ t: c, pos: i }); i++; continue; }
    throw formulaError('I do not know what to do with "' + c + '".', i);
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

// ---- parser -----------------------------------------------------------------
// expr := term (('+'|'-') term)*     term  := unary (('*'|'/') unary)*
// unary := ('-'|'+') unary | power   power := primary ('^' unary)?
function parseFormula(src, resolve) {
  const toks = tokenizeFormula(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];

  function expect(t, what) {
    if (toks[p].t !== t) throw formulaError('Expected ' + what + '.', toks[p].pos);
    return take();
  }

  function primary() {
    const tok = peek();
    if (tok.t === 'num') { take(); return { t: 'num', v: tok.v, cls: 'plain', pos: tok.pos }; }
    if (tok.t === 'pct') { take(); return { t: 'num', v: tok.v / 100, cls: 'ratio', pct: true, pos: tok.pos }; }
    if (tok.t === '(') {
      take();
      const inner = expr();
      if (peek().t !== ')') throw formulaError('Missing a closing ")".', peek().pos);
      take();
      return inner;
    }
    if (tok.t === 'ident' && FORMULA_FUNCS[tok.v.toLowerCase()] && toks[p + 1] && toks[p + 1].t === '(') {
      const name = tok.v.toLowerCase();
      take(); take();
      const args = [];
      if (peek().t !== ')') {
        for (;;) {
          args.push(expr());
          if (peek().t === ',') { take(); continue; }
          break;
        }
      }
      if (peek().t !== ')') throw formulaError('Missing a closing ")" after ' + name + '(.', peek().pos);
      take();
      const def = FORMULA_FUNCS[name];
      if (args.length < def.arity[0] || args.length > def.arity[1]) {
        throw formulaError(name + '() takes ' + (def.arity[0] === def.arity[1]
          ? def.arity[0] + ' argument' + (def.arity[0] === 1 ? '' : 's')
          : def.arity[0] + ' to ' + def.arity[1] + ' arguments') + ', not ' + args.length + '.', tok.pos);
      }
      return { t: 'fn', name, args, pos: tok.pos };
    }
    if (tok.t === 'name' || tok.t === 'ident') {
      take();
      const key = resolve(tok.v);
      if (!key) throw formulaError('No measure called "' + tok.v + '".', tok.pos);
      return { t: 'ref', key, name: tok.v, pos: tok.pos };
    }
    if (tok.t === 'end') throw formulaError('The expression stops early — something is missing at the end.', tok.pos);
    throw formulaError('Unexpected "' + tok.t + '".', tok.pos);
  }

  function power() {
    const base = primary();
    if (peek().t === '^') { const op = take(); return { t: 'bin', op: '^', a: base, b: unary(), pos: op.pos }; }
    return base;
  }
  function unary() {
    const tok = peek();
    if (tok.t === '-') { take(); return { t: 'neg', a: unary(), pos: tok.pos }; }
    if (tok.t === '+') { take(); return unary(); }
    return power();
  }
  function term() {
    let left = unary();
    while (peek().t === '*' || peek().t === '/') {
      const op = take();
      left = { t: 'bin', op: op.t, a: left, b: unary(), pos: op.pos };
    }
    return left;
  }
  function expr() {
    let left = term();
    while (peek().t === '+' || peek().t === '-') {
      const op = take();
      left = { t: 'bin', op: op.t, a: left, b: term(), pos: op.pos };
    }
    return left;
  }

  const ast = expr();
  if (peek().t !== 'end') throw formulaError('Unexpected "' + (peek().v || peek().t) + '" after the expression.', peek().pos);
  return ast;
}

// ---- unit inference ---------------------------------------------------------
// `plain` is a bare number: dimensionless and unit-neutral, so it adopts whatever
// it meets. `ratio` is a proportion: also dimensionless, but it is a quantity in
// its own right, and multiplying by it preserves the other operand's kind.
function combineAdd(a, b, notes) {
  if (a === b) return a;
  if (a === 'plain') return b;
  if (b === 'plain') return a;
  notes.push('adding ' + a + ' and ' + b + ' — the result is just a number');
  return 'number';
}
function combineMul(a, b, notes) {
  if (a === 'plain') return b;
  if (b === 'plain') return a;
  if (a === 'ratio') return b;
  if (b === 'ratio') return a;
  notes.push(a + ' × ' + b + ' — the result is just a number');
  return 'number';
}
function combineDiv(a, b, notes) {
  if (b === 'plain') return a;
  if (a === 'plain') return 'number';
  if (b === 'ratio') return a;
  if (a === b) return 'ratio';          // hits / accesses is a rate
  notes.push(a + ' ÷ ' + b + ' — the result is just a number');
  return 'number';
}

// Annotates every node with `cls` and returns the root's class.
function classifyFormula(ast, byKey, notes) {
  const walk = n => {
    if (n.t === 'num') return n.cls;
    if (n.t === 'ref') { n.cls = quantityClass((byKey[n.key] || {}).format); return n.cls; }
    if (n.t === 'neg') { n.cls = walk(n.a); return n.cls; }
    if (n.t === 'fn') {
      const cs = n.args.map(walk);
      const def = FORMULA_FUNCS[n.name];
      n.cls = def.cls === 'same' ? cs.reduce((x, y) => combineAdd(x, y, notes)) : def.cls;
      return n.cls;
    }
    const a = walk(n.a);
    const b = walk(n.b);
    n.cls = n.op === '+' || n.op === '-' ? combineAdd(a, b, notes)
      : n.op === '*' ? combineMul(a, b, notes)
        : n.op === '/' ? combineDiv(a, b, notes)
          : 'number';
    return n.cls;
  };
  return walk(ast);
}

function formulaRefs(ast) {
  const out = [];
  const walk = n => {
    if (!n) return;
    if (n.t === 'ref') { if (out.indexOf(n.key) === -1) out.push(n.key); return; }
    if (n.t === 'neg') return walk(n.a);
    if (n.t === 'fn') return n.args.forEach(walk);
    if (n.t === 'bin') { walk(n.a); walk(n.b); }
  };
  walk(ast);
  return out;
}

// ---- evaluation -------------------------------------------------------------
// `get(key)` returns the measure's dimensionless value at one dimension tuple,
// or null when it is missing. A missing operand makes the whole result missing:
// a gap in a chart is honest, a zero is a claim nobody made.
function evalFormulaNode(n, get) {
  if (n.t === 'num') return n.v;
  if (n.t === 'ref') return get(n.key);
  if (n.t === 'neg') { const a = evalFormulaNode(n.a, get); return a === null ? null : -a; }
  if (n.t === 'fn') {
    const args = [];
    for (let i = 0; i < n.args.length; i++) {
      const v = evalFormulaNode(n.args[i], get);
      if (v === null) return null;
      args.push(v);
    }
    const out = FORMULA_FUNCS[n.name].fn(args);
    return out === null || !Number.isFinite(out) ? null : out;
  }
  const a = evalFormulaNode(n.a, get);
  if (a === null) return null;
  const b = evalFormulaNode(n.b, get);
  if (b === null) return null;
  let v;
  if (n.op === '+') v = a + b;
  else if (n.op === '-') v = a - b;
  else if (n.op === '*') v = a * b;
  else if (n.op === '/') v = b === 0 ? null : a / b;
  else v = Math.pow(a, b);
  return v === null || !Number.isFinite(v) ? null : v;
}

// ---- compile ----------------------------------------------------------------
// Names are matched against a measure's key first, then its label, then its
// label with case and spacing ignored -- so `[L2 Hit Rate]`, `l2hitrate` and the
// underlying column name all reach the same measure.
function squash(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function formulaResolver(measures) {
  const byKey = {};
  const byLabel = {};
  const bySquash = {};
  measures.forEach(m => {
    byKey[m.key] = m.key;
    byLabel[m.label] = m.key;
    const s = squash(m.label);
    if (!(s in bySquash)) bySquash[s] = m.key;
    const k = squash(m.key);
    if (!(k in bySquash)) bySquash[k] = m.key;
  });
  return name => byKey[name] || byLabel[name] || bySquash[squash(name)] || null;
}

// Returns { expr, ast, refs, cls, notes, format, outScale } or throws a
// formulaError carrying the offset of the offending character.
function compileFormula(exprText, measures, formatPreset) {
  const text = String(exprText || '').trim();
  if (!text) throw formulaError('Write an expression first.', 0);
  const byKey = {};
  measures.forEach(m => { byKey[m.key] = m; });
  const ast = parseFormula(text, formulaResolver(measures));
  const notes = [];
  const cls = classifyFormula(ast, byKey, notes);
  const refs = formulaRefs(ast);
  if (!refs.length) notes.push('this refers to no measure, so it is the same number everywhere');
  const format = formatPreset ? makeFormat(formatPreset) : formatForClass(cls);
  return {
    expr: text,
    ast,
    refs,
    cls,
    notes,
    format,
    // The one conversion out of dimensionless space. A proportion shown as a
    // percentage is the only case that moves.
    outScale: 1 / ratioScale(format),
  };
}
