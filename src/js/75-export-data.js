// CSV + pgfplots export
// ---- CSV + pgfplots export ----
// The alternative to shipping geometry: write the numbers to a .csv and let pgfplots
// draw them, so the figure restyles with the document instead of being frozen pixels.

function csvCell(v) {
  const t = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function csvName(s) {
  return String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim() || 'series';
}

// pgfplots pulls the tick labels straight out of this file, so every string in it
// has to survive LaTeX: swap the composite separator for a plain slash and escape
// the rest. That keeps the csv readable in a spreadsheet too.
function csvLabel(s) {
  return latexEscape(String(s === null || s === undefined ? '' : s).replace(/\s*·\s*/g, ' / '));
}

function tableDataToCsv(data) {
  const head = data.rowDims.map(k => csvName(DIM_BY_KEY[k].label));
  if (head.length === 0) head.push('row');
  const lines = [head.concat(data.colLabels.map(csvLabel)).map(csvCell).join(',')];
  data.rows.forEach(r => {
    const cells = r.parts.map(csvLabel).concat(
      r.values.map(v => (v === null || v === undefined) ? 'nan' : (Math.round(v * 10000) / 10000)));
    lines.push(cells.map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}

// wide format: one row per x position, one column per series
//
// A scatter carries two numbers per series per row rather than one, so its
// header tail widens to a pair of columns each. The body needs no branch: the
// values are already flat and still line up with the header one for one.
function dataToCsv(data) {
  const cols = data.pointCols === 2
    ? data.seriesLabels.reduce((acc, n) => acc.concat([csvName(n) + ' x', csvName(n) + ' y']), [])
    : data.seriesLabels.map(csvName);
  const head = ['index', 'label'].concat(data.xDims.map(k => csvName(DIM_BY_KEY[k].label)))
    .concat(cols);
  const lines = [head.map(csvCell).join(',')];
  data.rows.forEach((r, i) => {
    const cells = [i, csvLabel(r.label)].concat(r.parts.map(csvLabel)).concat(
      r.values.map(v => (v === null || v === undefined) ? 'nan' : (Math.round(v * 10000) / 10000)));
    lines.push(cells.map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}

// pgfplots' own names for the marks we draw.
const PGF_MARKS = {
  circle: '*', square: 'square*', diamond: 'diamond*', triangle: 'triangle*',
  'triangle-down': 'triangle*', plus: '+', cross: 'x', star: 'star',
};

// How one series is drawn: filled bar, or line with a mark. Shared so the
// second axis of a dual-axis figure styles its series the same way the first
// one does, and so its legend key can be built from the identical option list.
function pgfSeriesOpts(data, i, colors, win, asBar) {
  const st = (data.seriesStyles || [])[i] || {};
  const col = colors && win ? pgfColorName(colors, st.color, win, data.__ctx) : null;
  const opts = [];
  if (asBar) {
    if (col) opts.push('fill=' + col, 'draw=' + col);
    const tp = st.pattern && TIKZ_PATTERNS[st.pattern];
    if (tp) opts.push('postaction={pattern=' + tp + ', pattern color=black}');
  } else {
    if (col) opts.push('color=' + col);
    if (data.markers === 'none') opts.push('no marks');
    else {
      const mk = PGF_MARKS[st.shape || 'circle'];
      if (mk) opts.push('mark=' + mk);
      if (st.shape === 'triangle-down') opts.push('mark options={rotate=180}');
    }
  }
  return opts.filter(Boolean);
}

// ymode / ymin / ymax for one axis, from that axis's own settings. `letter` is
// there for the correlation plot, whose horizontal axis is a measured quantity
// with a scale and bounds of its own; everything else asks about y.
function pgfAxisScale(kind, ax, letter) {
  const a = ax || {};
  const L = letter || 'y';
  const out = [];
  const isLog = a.scale === 'log' ? true : a.scale === 'linear' ? false : useLog(kind);
  if (isLog) out.push(L + 'mode=log, log basis ' + L + '=10,');
  if (a.min !== null && a.min !== undefined) out.push(L + 'min=' + a.min + ',');
  if (a.max !== null && a.max !== undefined) out.push(L + 'max=' + a.max + ',');
  return out;
}

// A scatter reads two columns per series, not one column against the row
// number. Emitting it as the line plot below would not be a plainer figure, it
// would be a different and false one -- the x-axis would become the order the
// tuples happen to sit in.
function pgfplotsScatter(data, csvFile, caption, win, colors) {
  const base = 2 + data.xDims.length;
  const lo = (data.range || [0, 1])[0];
  const hi = (data.range || [0, 1])[1];
  const out = [];
  if (caption) out.push('% --- ' + caption + ' ---');
  out.push('% One mark per combination: x and y are the same measure read at the');
  out.push('% two values the plot pins, so a mark above the diagonal is one whose');
  out.push('% y reading is the larger.');
  out.push('\\begin{tikzpicture}');
  out.push('  \\begin{axis}[');
  out.push('    width=\\linewidth, height=' + (data.diagonal ? '8cm' : '6cm') + ',');
  // one range on both axes, so that 45 degrees on paper really is y = x
  if (data.diagonal) out.push('    axis equal image,');
  pgfAxisScale(data.xKind, data.xAxis, 'x').forEach(l => out.push('    ' + l));
  pgfAxisScale(data.kind, data.yAxis, 'y').forEach(l => out.push('    ' + l));
  out.push('    xlabel={' + latexEscape(data.xAxisLabel || '') + '},');
  out.push('    ylabel={' + latexEscape(data.yAxisLabel || '') + '},');
  out.push('    tick label style={font=\\scriptsize},');
  out.push('    legend style={font=\\scriptsize, at={(0.5,-0.25)}, anchor=north, legend columns=-1},');
  out.push('  ]');
  data.seriesLabels.forEach((name, i) => {
    const st = (data.seriesStyles || [])[i] || {};
    const col = colors && win ? pgfColorName(colors, st.color, win, data.__ctx) : null;
    // never "no marks" here, whatever the marker setting says: a scatter
    // without marks is an empty axis
    const opts = ['only marks', 'mark=' + (PGF_MARKS[st.shape || 'circle'] || '*')];
    if (col) opts.push('color=' + col);
    if (st.shape === 'triangle-down') opts.push('mark options={rotate=180}');
    out.push('    \\addplot[' + opts.join(', ') + '] table [col sep=comma, x index='
      + (base + 2 * i) + ', y index=' + (base + 2 * i + 1) + '] {' + csvFile + '};');
    out.push('    \\addlegendentry{' + latexEscape(name) + '}');
  });
  if (data.diagonal) {
    const dom = 'domain=' + lo + ':' + hi + ', samples=2, no marks, forget plot';
    out.push('    \\addplot[' + dom + ', dashed, black!45] {x};');
    if (data.band) {
      out.push('    \\addplot[' + dom + ', dotted, black!25] {1.1*x};');
      out.push('    \\addplot[' + dom + ', dotted, black!25] {0.9*x};');
    }
  }
  out.push('  \\end{axis}');
  out.push('\\end{tikzpicture}');
  return out;
}

// Two y-scales are two `axis` environments stacked in one picture: the second
// draws only its right-hand axis line and reuses the first one's x range. The
// legend lives on the first, with \addlegendimage standing in for the plots
// that are not drawn there.
function pgfplotsDual(data, csvFile, caption, win, colors) {
  const out = [];
  const xcol = 2 + data.xDims.length;
  const n = data.rows.length;
  const xspan = ['xmin=-0.75, xmax=' + (n - 1 + 0.75) + ',',
    'xtick=data,'];
  const left = [], right = [];
  data.seriesLabels.forEach((name, i) => {
    ((data.seriesAxis || [])[i] === 1 ? right : left).push({ name: name, i: i });
  });
  const leftIsBar = !data.asLines;

  if (caption) out.push('% --- ' + caption + ' ---');
  out.push('% Two y-scales, so two axis environments in one picture. The second');
  out.push('% draws only the right-hand axis and shares the first one\'s x range.');
  out.push('% Heights are not comparable across the two.');
  out.push('\\begin{tikzpicture}');
  out.push('  \\begin{axis}[');
  out.push('    width=\\linewidth, height=5cm,');
  if (leftIsBar) {
    out.push('    ybar' + (left.length > 1
      ? '=0pt, bar width=' + Math.max(1, Math.round(60 / Math.max(n, 1))) + 'pt,' : ','));
  }
  out.push('    axis y line*=left,');
  pgfAxisScale(data.axisKinds && data.axisKinds[0], data.yAxis).forEach(l => out.push('    ' + l));
  out.push('    ylabel={' + latexEscape(axisLabelOf(data.axisKinds && data.axisKinds[0])) + '},');
  out.push('    ' + xspan.join('\n    '));
  out.push('    xticklabels from table={\\vizdata}{label},');
  out.push('    x tick label style={rotate=40, anchor=east, font=\\scriptsize},');
  out.push('    tick label style={font=\\scriptsize},');
  out.push('    legend style={font=\\scriptsize, at={(0.5,-0.35)}, anchor=north, legend columns=-1},');
  out.push('  ]');
  left.forEach(s => {
    const opts = pgfSeriesOpts(data, s.i, colors, win, leftIsBar);
    out.push('    \\addplot[' + opts.join(', ') + '] table [col sep=comma, x expr=\\coordindex, y index='
      + (xcol + s.i) + '] {' + csvFile + '};');
    out.push('    \\addlegendentry{' + latexEscape(s.name) + '}');
  });
  if (right.length) {
    out.push('    % drawn on the axis below, listed here so there is one legend');
    right.forEach(s => {
      const opts = pgfSeriesOpts(data, s.i, colors, win, false).concat(['dashed']);
      out.push('    \\addlegendimage{' + opts.join(', ') + '}');
      out.push('    \\addlegendentry{' + latexEscape(s.name) + ' (right)}');
    });
  }
  out.push('  \\end{axis}');

  out.push('  \\begin{axis}[');
  out.push('    width=\\linewidth, height=5cm,');
  out.push('    axis y line*=right, axis x line=none, xtick=\\empty,');
  pgfAxisScale(data.axisKinds && data.axisKinds[1], data.yAxisRight).forEach(l => out.push('    ' + l));
  out.push('    ylabel={' + latexEscape(axisLabelOf(data.axisKinds && data.axisKinds[1])) + '},');
  out.push('    xmin=-0.75, xmax=' + (n - 1 + 0.75) + ',');
  out.push('    tick label style={font=\\scriptsize},');
  out.push('  ]');
  right.forEach(s => {
    const opts = pgfSeriesOpts(data, s.i, colors, win, false).concat(['dashed']);
    out.push('    \\addplot[' + opts.join(', ') + '] table [col sep=comma, x expr=\\coordindex, y index='
      + (xcol + s.i) + '] {' + csvFile + '};');
  });
  out.push('  \\end{axis}');
  out.push('\\end{tikzpicture}');
  return out;
}

function pgfplotsFor(data, csvFile, caption, win, colors) {
  if (data.dual) return pgfplotsDual(data, csvFile, caption, win, colors);
  if (data.scatter) return pgfplotsScatter(data, csvFile, caption, win, colors);
  const bar = data.chartType === 'bars';
  const diverging = isDiverging(data.kind);
  const ylabel = axisLabelOf(data.kind);
  const out = [];
  if (caption) out.push('% --- ' + caption + ' ---');
  if (data.colourPerPoint) {
    // one \addplot carries one colour, and the chart on screen changes colour
    // per point. Saying so beats a figure that quietly disagrees with it.
    out.push('% On screen the colour follows the metric, which changes within a');
    out.push('% series. pgfplots draws one colour per series, so the colours here');
    out.push('% follow the series instead. Put Metric in the Series zone to match.');
  }
  out.push('\\begin{tikzpicture}');
  out.push('  \\begin{axis}[');
  out.push('    width=\\linewidth, height=5cm,');
  if (bar) out.push('    ybar' + (data.seriesLabels.length > 1 ? '=0pt, bar width=' + Math.max(1, Math.round(60 / Math.max(data.rows.length, 1))) + 'pt,' : ','));
  pgfAxisScale(data.kind, data.yAxis).forEach(l => out.push('    ' + l));
  out.push('    ylabel={' + latexEscape(ylabel) + '},');
  out.push('    xtick=data,');
  out.push('    xticklabels from table={\\vizdata}{label},');
  out.push('    x tick label style={rotate=40, anchor=east, font=\\scriptsize},');
  out.push('    tick label style={font=\\scriptsize},');
  out.push('    legend style={font=\\scriptsize, at={(0.5,-0.35)}, anchor=north, legend columns=-1},');
  out.push('    enlarge x limits=0.03,');
  if (diverging) out.push('    extra y ticks={0}, extra y tick style={grid=major},');
  out.push('  ]');
  data.seriesLabels.forEach((name, i) => {
    const opts = pgfSeriesOpts(data, i, colors, win, bar);
    const optStr = opts.length ? '[' + opts.join(', ') + '] ' : '';
    out.push('    \\addplot' + optStr + ' table [col sep=comma, x expr=\\coordindex, y index='
      + (2 + data.xDims.length + i) + '] {' + csvFile + '};');
    out.push('    \\addlegendentry{' + latexEscape(name) + '}');
  });
  out.push('  \\end{axis}');
  out.push('\\end{tikzpicture}');
  return out;
}

// Colours are collected as the figures are built, then declared once at the top:
// pgfplots has no notion of a CSS variable, and \definecolor is the only way to
// say "this series is this colour" without repeating the hex everywhere.
function pgfColorName(colors, paint, win, ctx) {
  if (!paint) return null;
  const host = ctx || win.document.querySelector('.viz-root') || win.document.body;
  const hex = rgbToHex(resolveVar(host, win, paint));
  if (!hex) return null;
  if (!colors[hex]) colors[hex] = 'pgfc' + (Object.keys(colors).length + 1);
  return colors[hex];
}

function buildPgfplotsDocument(root, title, csvBase, win) {
  // the root may itself be a leaf, or an ancestor holding several
  const shells = (root.classList && root.classList.contains('leaf-shell'))
    ? [root] : Array.prototype.slice.call(root.querySelectorAll('.leaf-shell'));
  const datas = [];
  for (let i = 0; i < shells.length; i++) {
    const dt = shells[i].__vizData;
    if (dt && dt.rows && dt.rows.length) {
      datas.push({ data: dt, cap: captionFor(shells[i]), node: shells[i] });
    }
  }
  if (datas.length === 0) return null;
  const anyChart = datas.some(e => !e.data.isTable);

  const files = [];
  const tex = [];
  const colors = {};
  const body = [];
  tex.push('% ' + title);
  tex.push('% Generated by the data explorer.');
  tex.push('% Requires: \\usepackage{pgfplots}  \\pgfplotsset{compat=1.18}');
  tex.push('% The numbers live in the .csv next to this file, so restyling the figure');
  tex.push('% never means regenerating the data.');
  tex.push('');
  datas.forEach((entry, i) => {
    const csvFile = csvBase + (datas.length > 1 ? '-' + (i + 1) : '') + '.csv';
    files.push({
      name: csvFile,
      text: entry.data.isTable ? tableDataToCsv(entry.data) : dataToCsv(entry.data),
      kind: 'csv',
    });
    if (entry.data.isTable) return;   // a pivot table has no pgfplots axis
    tex.push('\\pgfplotstableread[col sep=comma]{' + csvFile + '}\\vizdata');
    entry.data.__ctx = entry.node || null;
    Array.prototype.push.apply(tex, pgfplotsFor(entry.data, csvFile, entry.cap, win, colors));
    tex.push('');
  });
  const defs = Object.keys(colors).map(hex => '\\definecolor{' + colors[hex] + '}{HTML}{' + hex + '}');
  const usesPatterns = tex.some(l => l.indexOf('pattern=') !== -1);
  if (usesPatterns) tex.splice(2, 0, '% Requires also: \\usetikzlibrary{patterns}');
  if (defs.length) tex.splice(usesPatterns ? 3 : 2, 0, '', ...defs);
  return { tex: anyChart ? tex.join('\n') : null, files: files };
}
