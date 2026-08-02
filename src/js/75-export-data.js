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
function dataToCsv(data) {
  const head = ['index', 'label'].concat(data.xDims.map(k => csvName(DIM_BY_KEY[k].label)))
    .concat(data.seriesLabels.map(csvName));
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

function pgfplotsFor(data, csvFile, caption, win, colors) {
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
  const ax = data.yAxis || {};
  const isLog = ax.scale === 'log' ? true : ax.scale === 'linear' ? false : useLog(data.kind);
  if (isLog) out.push('    ymode=log, log basis y=10,');
  if (ax.min !== null && ax.min !== undefined) out.push('    ymin=' + ax.min + ',');
  if (ax.max !== null && ax.max !== undefined) out.push('    ymax=' + ax.max + ',');
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
    const st = (data.seriesStyles || [])[i] || {};
    const opts = [];
    const col = colors && win ? pgfColorName(colors, st.color, win, data.__ctx) : null;
    if (col) opts.push(bar ? 'fill=' + col : 'color=' + col, bar ? 'draw=' + col : '');
    if (bar) {
      const tp = st.pattern && TIKZ_PATTERNS[st.pattern];
      if (tp) opts.push('postaction={pattern=' + tp + ', pattern color=black}');
    } else if (data.markers === 'none') {
      opts.push('no marks');
    } else {
      const mk = PGF_MARKS[st.shape || 'circle'];
      if (mk) opts.push('mark=' + mk);
      if (st.shape === 'triangle-down') opts.push('mark options={rotate=180}');
    }
    const optStr = opts.filter(Boolean).length ? '[' + opts.filter(Boolean).join(', ') + '] ' : '';
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
