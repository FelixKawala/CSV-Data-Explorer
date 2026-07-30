// how a measure is scaled, coloured and printed
//
// This replaces a closed `kind` enum ('pct'|'count'|'delta'|'reldelta') that was
// switched on in about thirty places. A format is now an object, so an imported
// column can carry its own policy without every renderer learning a new name.
//
// `axisGroup` decides which measures may share a y-axis. Comparing formats by
// identity was wrong: two unrelated `number` measures (nanoseconds and bytes)
// would have been silently merged onto one scale.

const FORMATS = {
  fraction: {
    key: 'fraction', scale: 'linear', palette: 'sequential',
    domain: [0, 1], unit: '', signed: false,
    axisLabel: 'fraction', fmt: v => (v * 100).toFixed(1) + '%',
  },
  pct: {
    key: 'pct', scale: 'linear', palette: 'sequential',
    domain: [0, 100], unit: '%', signed: false,
    axisLabel: 'rate %', fmt: v => v.toFixed(2) + '%',
  },
  count: {
    key: 'count', scale: 'log', palette: 'sequential',
    domain: 'data', unit: '', signed: false,
    axisLabel: 'counts (log)', fmt: v => fmtAccess(v),
  },
  number: {
    key: 'number', scale: 'linear', palette: 'sequential',
    domain: 'data', unit: '', signed: false,
    axisLabel: 'value', fmt: v => (Math.abs(v) >= 1000 ? fmtAccess(v) : String(Math.round(v * 100) / 100)),
  },
  bytes: {
    key: 'bytes', scale: 'log', palette: 'sequential',
    domain: 'data', unit: 'B', signed: false,
    axisLabel: 'bytes (log)', fmt: v => fmtAccess(v) + 'B',
  },
  duration: {
    key: 'duration', scale: 'linear', palette: 'sequential',
    domain: 'data', unit: 's', signed: false,
    axisLabel: 'duration', fmt: v => (Math.round(v * 1000) / 1000) + 's',
  },
  delta: {
    key: 'delta', scale: 'linear', palette: 'diverging',
    domain: 'data', unit: 'pt', signed: true,
    axisLabel: 'change in points', fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + 'pt',
  },
  reldelta: {
    key: 'reldelta', scale: 'linear', palette: 'diverging',
    domain: 'data', unit: '%', signed: true,
    axisLabel: 'relative change %', fmt: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%',
  },
};

// A format spec may override any of these per measure, so two columns sharing a
// preset can still be told apart on the axis.
function makeFormat(preset, over) {
  const base = FORMATS[preset] || FORMATS.number;
  const f = Object.assign({}, base, over || {});
  if (!f.axisGroup) f.axisGroup = f.key + '|' + f.unit;
  return f;
}

function useLog(f) { return !!f && f.scale === 'log'; }
function isDiverging(f) { return !!f && f.palette === 'diverging'; }
function formatValue(f, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return f ? f.fmt(v) : String(v);
}
function axisLabelOf(f) { return f ? f.axisLabel : ''; }
function sameAxis(a, b) { return !!a && !!b && a.axisGroup === b.axisGroup; }

function tickLabel(f, t) {
  if (!f) return String(Math.round(t));
  if (useLog(f)) return fmtAccess(t);
  if (f.signed) {
    const r = Math.round(t * 10) / 10;
    return (r > 0 ? '+' : '') + r + f.unit;
  }
  if (f.key === 'pct') return Math.round(t) + '%';
  if (f.key === 'fraction') return Math.round(t * 100) + '%';
  return Math.round(t) + f.unit;
}

// Upper bound for a sequential colour ramp: a bounded format uses its declared
// domain, an open-ended one uses the data. The matrix used to hardcode 100 here.
function seqDomain(f, dataMax) {
  if (f && Array.isArray(f.domain)) return f.domain[1];
  return dataMax;
}
