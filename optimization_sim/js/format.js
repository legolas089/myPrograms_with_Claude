// Number formatting. The backend sends undefined statistics as null and
// infinities as the strings "inf" / "-inf".

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function fmt(v, digits = 5) {
  if (v === null || v === undefined) return '—';
  if (v === 'inf') return '∞';
  if (v === '-inf') return '−∞';
  if (typeof v !== 'number') return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  let s;
  if (a >= 1e6 || a < 1e-4) s = v.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  else if (Number.isInteger(v) && a < 1e6) s = String(v);
  else s = Number(v.toPrecision(digits)).toString();
  return s.replace(/-/g, '−');
}

export function fmtInt(v) {
  return isNum(v) ? v.toLocaleString('en-US') : fmt(v);
}

// Theory column: null means the population value is undefined (e.g. Cauchy mean).
export function fmtTheory(v) {
  return v === null ? '정의 안 됨' : fmt(v);
}

export function diff(est, th) {
  return isNum(est) && isNum(th) ? fmt(est - th, 3) : '';
}
