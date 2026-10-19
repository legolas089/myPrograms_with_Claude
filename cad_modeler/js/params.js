// 파라미터 · 수식 · 스케치 · 규칙 — CATIA 의 Parameters / Formulas / Sketch / Check 에 해당
//
//   state.params   { 이름: { value, unit, note } }        설계 치수 (예: hub_d = 62 mm)
//   state.sketches { 이름: '함수 본문' }                   파라미터로 2D 점열을 만드는 코드 (extrude points 용)
//   state.rules    [{ name, expr, message }]              파라미터가 지켜야 할 조건 (예: boss_d < hub_d)
//   node.expr      { 'params.radius': 'hub_d/2', 'pos.2': 'hub_l/2', 'params.points': 'sketch.blade()' }
//
// 파라미터가 바뀌면 applyFormulas() 가 모든 node.expr 를 다시 계산해 node.params / transform 에 숫자로 써 넣는다.
// 커널·화면·내보내기는 숫자만 보므로 수식이 있는지 몰라도 된다.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['p', 'sketch', 'geo', 'Math', 'PI', 'D', 'abs', 'min', 'max', 'sqrt', 'sin', 'cos', 'tan', 'atan2', 'round', 'ceil', 'floor', 'hypot']);

// 스케치 코드에서 쓰는 2D 도우미 (각도는 도)
export const geo = {
  D: Math.PI / 180,
  pol: (r, a) => [r * Math.cos(a * Math.PI / 180), r * Math.sin(a * Math.PI / 180)],
  rot: (q, a) => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return [q[0] * c - q[1] * s, q[0] * s + q[1] * c]; },
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  len: a => Math.hypot(a[0], a[1]),
  unit: a => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; },
  ang: a => Math.atan2(a[1], a[0]) * 180 / Math.PI,
  // 중심 C, 반지름 r 의 원호를 from→to 짧은 방향으로 n 등분한 점들 (끝점 포함)
  arcBetween(C, r, from, to, n) {
    const a0 = Math.atan2(from[1] - C[1], from[0] - C[0]);
    let d = Math.atan2(to[1] - C[1], to[0] - C[0]) - a0;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    return Array.from({ length: n + 1 }, (_, i) => [C[0] + r * Math.cos(a0 + d * i / n), C[1] + r * Math.sin(a0 + d * i / n)]);
  },
  // 원점 중심 원호 a0→a1(도, 증가 방향), n 등분, 끝점 포함
  arc(r, a0, a1, n) { return Array.from({ length: n + 1 }, (_, i) => geo.pol(r, a0 + (a1 - a0) * i / n)); },
  // 직선(점 p, 방향 d)과 원(중심 c, 반지름 r)의 교점들 (직선 매개변수 t 오름차순)
  lineCircle(p, d, c, r) {
    const u = geo.unit(d), w = geo.sub(p, c), b = geo.dot(w, u), k = geo.dot(w, w) - r * r, disc = b * b - k;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [-b - s, -b + s].map(t => geo.add(p, geo.mul(u, t)));
  },
  // 두 직선 (p1 + t·d1, p2 + s·d2) 의 교점 (평행이면 null)
  lineLine(p1, d1, p2, d2) {
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return null;
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return geo.add(p1, geo.mul(d1, t));
  },
  // 스케치 프로파일: 선·원호를 이어 그리고 꼭짓점에 필렛 R 을 걸면 접점을 계산해 점열을 만든다
  //   geo.profile([x0, y0]).line([x1, y1]).fillet(15).arc({ center: [0, 0], to: [x2, y2], ccw: true }).line(...).close().points()
  profile(start, opts = {}) { return new Profile(start, opts); },
};

// ── 스케치 프로파일 ──
// 요소: { t: 'line', p0, p1 } | { t: 'arc', c, r, p0, p1, ccw }. fillet(R) 은 지금 끝점(앞 요소와 다음 요소 사이 꼭짓점)에 건다
class Profile {
  constructor(start, opts) {
    this.start = [...start]; this.cur = [...start];
    this.ents = []; this.fil = new Map();
    if (opts.fillet) this.fil.set(0, opts.fillet);
  }
  line(to) { this.ents.push({ t: 'line', p0: this.cur, p1: [...to] }); this.cur = [...to]; return this; }
  lineBy(dx, dy) { return this.line([this.cur[0] + dx, this.cur[1] + dy]); }
  polar(len, angDeg) { return this.line(geo.add(this.cur, geo.pol(len, angDeg))); }
  // 중심 center 둘레로 지금 점에서 to 방향까지 (to 는 반지름에 맞춰 투영). ccw 기본 true. 또는 { center, sweep: 각도(°, 음수=시계) }
  arc({ center, to, ccw = true, sweep }) {
    const r = geo.len(geo.sub(this.cur, center));
    let p1;
    if (sweep !== undefined) { p1 = geo.add(center, geo.rot(geo.sub(this.cur, center), sweep)); ccw = sweep > 0; }
    else p1 = geo.add(center, geo.mul(geo.unit(geo.sub(to, center)), r));
    this.ents.push({ t: 'arc', c: [...center], r, p0: this.cur, p1, ccw });
    this.cur = p1;
    return this;
  }
  fillet(R) { this.fil.set(this.ents.length, R); return this; }
  close() {
    if (geo.len(geo.sub(this.cur, this.start)) > 1e-9) this.line(this.start);
    this.closed = true;
    return this;
  }
  // tol: 원호를 선분으로 나눌 때 허용 오차(mm)
  points({ tol = 0.02 } = {}) {
    if (!this.closed) this.close();
    const ents = this.ents.map(e => ({ ...e, p0: [...e.p0], p1: [...e.p1] }));
    const n = ents.length;
    const fillets = [];
    for (const [v, R] of this.fil) {
      const i1 = (v - 1 + n) % n, i2 = v % n;
      fillets.push({ after: i1, arc: filletBetween(ents[i1], ents[i2], R, v) });
    }
    const out = [];
    const emit = e => {
      if (e.t === 'line') { out.push(e.p0); return; }
      let a0 = Math.atan2(e.p0[1] - e.c[1], e.p0[0] - e.c[0]), a1 = Math.atan2(e.p1[1] - e.c[1], e.p1[0] - e.c[0]);
      let sw = a1 - a0;
      if (e.ccw) { while (sw <= 1e-12) sw += 2 * Math.PI; } else { while (sw >= -1e-12) sw -= 2 * Math.PI; }
      const step = 2 * Math.acos(Math.max(-1, 1 - tol / e.r));
      const k = Math.max(1, Math.ceil(Math.abs(sw) / step));
      for (let i = 0; i < k; i++) out.push([e.c[0] + e.r * Math.cos(a0 + sw * i / k), e.c[1] + e.r * Math.sin(a0 + sw * i / k)]);
    };
    ents.forEach((e, i) => {
      emit(e);
      const f = fillets.find(x => x.after === i);
      if (f) emit(f.arc);
    });
    // 연속 중복점 제거
    return out.filter((q, i) => geo.len(geo.sub(q, out[(i + 1) % out.length])) > 1e-9);
  }
}

// 두 요소 E1(끝이 꼭짓점) · E2(시작이 꼭짓점) 에 접하는 반지름 R 원호. E1 끝과 E2 시작을 접점으로 잘라 낸다
function filletBetween(E1, E2, R, v) {
  const V = E1.p1;
  const offsets = E => {
    if (E.t === 'line') {
      const d = geo.unit(geo.sub(E.p1, E.p0)), nrm = [-d[1], d[0]];
      return [1, -1].map(s => ({ t: 'line', p: geo.add(E.p0, geo.mul(nrm, s * R)), d }));
    }
    return [1, -1].filter(s => E.r + s * R > 1e-9).map(s => ({ t: 'circle', c: E.c, r: E.r + s * R }));
  };
  const meet = (A, B) => {
    if (A.t === 'line' && B.t === 'line') { const q = geo.lineLine(A.p, A.d, B.p, B.d); return q ? [q] : []; }
    if (A.t === 'line') return geo.lineCircle(A.p, A.d, B.c, B.r);
    if (B.t === 'line') return geo.lineCircle(B.p, B.d, A.c, A.r);
    const d = geo.len(geo.sub(B.c, A.c));
    if (d < 1e-12 || d > A.r + B.r || d < Math.abs(A.r - B.r)) return [];
    const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
    const u = geo.unit(geo.sub(B.c, A.c)), m = geo.add(A.c, geo.mul(u, a));
    return [geo.add(m, geo.mul([-u[1], u[0]], h)), geo.add(m, geo.mul([u[1], -u[0]], h))];
  };
  const foot = (E, C) => {
    if (E.t === 'line') { const d = geo.sub(E.p1, E.p0), t = geo.dot(geo.sub(C, E.p0), d) / geo.dot(d, d); return { q: geo.add(E.p0, geo.mul(d, t)), on: t > -1e-9 && t < 1 + 1e-9 }; }
    const q = geo.add(E.c, geo.mul(geo.unit(geo.sub(C, E.c)), E.r));
    return { q, on: onArc(E, q) };
  };
  let best = null;
  for (const A of offsets(E1)) for (const B of offsets(E2)) for (const C of meet(A, B)) {
    const f1 = foot(E1, C), f2 = foot(E2, C);
    if (!f1.on || !f2.on) continue;
    const dist = geo.len(geo.sub(C, V));
    if (!best || dist < best.dist) best = { C, T1: f1.q, T2: f2.q, dist };
  }
  if (!best) throw new Error(`꼭짓점 ${v} 에 필렛 R${R} 을 걸 수 없음 (요소가 너무 짧거나 R 이 너무 큼)`);
  E1.p1 = best.T1; E2.p0 = best.T2;
  const c1 = geo.sub(best.T1, best.C), c2 = geo.sub(best.T2, best.C);
  return { t: 'arc', c: best.C, r: R, p0: best.T1, p1: best.T2, ccw: c1[0] * c2[1] - c1[1] * c2[0] > 0 };
}

// 점 q 가 원호 E 위(시작~끝 사이)에 있는지
function onArc(E, q) {
  const ang = p => Math.atan2(p[1] - E.c[1], p[0] - E.c[0]);
  const norm = x => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
  const a0 = ang(E.p0), a1 = ang(E.p1), aq = ang(q);
  const sweep = E.ccw ? norm(a1 - a0) || 2 * Math.PI : norm(a0 - a1) || 2 * Math.PI;
  const at = E.ccw ? norm(aq - a0) : norm(a0 - aq);
  return at <= sweep + 1e-9 || at >= 2 * Math.PI - 1e-9;
}

function values(state) {
  const p = {};
  for (const [k, v] of Object.entries(state.params || {})) p[k] = v.value;
  return p;
}

function makeContext(state) {
  const p = values(state);
  const names = Object.keys(p);
  const memo = new Map();
  const sketch = new Proxy({}, {
    get(_, name) {
      return (...args) => {
        const code = state.sketches?.[name];
        if (code === undefined) throw new Error(`스케치 없음: ${String(name)}`);
        const key = `${String(name)}(${JSON.stringify(args)})`;
        if (!memo.has(key)) {
          const fn = new Function('p', 'geo', 'args', ...names, code);
          memo.set(key, fn(p, geo, args, ...names.map(n => p[n])));
        }
        return memo.get(key);
      };
    },
  });
  const cache = new Map();
  const evaluate = expr => {
    let fn = cache.get(expr);
    if (!fn) {
      fn = new Function('p', 'sketch', 'geo', 'Math', ...names,
        `const {PI, abs, min, max, sqrt, sin, cos, tan, atan2, round, ceil, floor, hypot} = Math; const D = PI / 180; return (${expr});`);
      cache.set(expr, fn);
    }
    return fn(p, sketch, geo, Math, ...names.map(n => p[n]));
  };
  return { p, evaluate };
}

function checkValue(path, v) {
  if (path === 'params.points') {
    if (!Array.isArray(v) || v.length < 3 || v.some(q => !Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) {
      throw new Error('점열([[x,y],...], 3점 이상)이 아님');
    }
    return v;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`숫자가 아님 (${v})`);
  return v;
}

// 객체를 새로 만들어 바꾼다 — 같은 객체를 고치면 그 객체를 들고 있는 Undo 기록·요약이 함께 바뀐다
function setPath(node, path, v) {
  const [head, key] = path.split('.');
  if (head === 'params') node.params = { ...node.params, [key]: v };
  else {
    const arr = [...node.transform[head]];
    arr[+key] = v;
    node.transform = { ...node.transform, [head]: arr };
  }
}
function getPath(node, path) {
  const [head, key] = path.split('.');
  return head === 'params' ? node.params?.[key] : node.transform?.[head]?.[+key];
}

export function isFormula(v) { return typeof v === 'string' && v.trim().startsWith('='); }

// add/update 에 들어온 '=수식' 값들을 node.expr 로 옮기고 지금 값으로 계산해 둔다
export function attachFormulas(state, node, { params = {}, pos, rot, scale } = {}) {
  const expr = { ...(node.expr || {}) };
  for (const [k, v] of Object.entries(params)) if (isFormula(v)) expr[`params.${k}`] = v.trim().slice(1);
  for (const [head, arr] of [['pos', pos], ['rot', rot], ['scale', scale]]) {
    if (arr) arr.forEach((v, i) => { if (isFormula(v)) expr[`${head}.${i}`] = String(v).trim().slice(1); });
  }
  if (Object.keys(expr).length) node.expr = expr;
  // 숫자 자리에 남은 수식 문자열은 계산값으로 바꾼다
  const { evaluate } = makeContext(state);
  for (const [path, e] of Object.entries(node.expr || {})) {
    try { setPath(node, path, checkValue(path, evaluate(e))); }
    catch (err) { throw new Error(`${node.name || node.id} 의 ${path} = ${e} 계산 실패: ${err.message}`); }
  }
  return node;
}

// 모든 노드의 수식을 다시 계산 → { changed: [id], errors: [{id, path, expr, message}] }
export function applyFormulas(state) {
  const { evaluate } = makeContext(state);
  const changed = new Set(), errors = [];
  for (const node of state.nodes) {
    if (!node.expr) continue;
    for (const [path, e] of Object.entries(node.expr)) {
      try {
        const v = checkValue(path, evaluate(e));
        if (JSON.stringify(getPath(node, path)) !== JSON.stringify(v)) { setPath(node, path, v); changed.add(node.id); }
      } catch (err) {
        errors.push({ id: node.id, name: node.name || node.id, path, expr: e, message: err.message });
      }
    }
  }
  return { changed: [...changed], errors };
}

// 규칙 검사 → 어긴 규칙 목록
export function checkRules(state) {
  const { evaluate } = makeContext(state);
  const out = [];
  for (const r of state.rules || []) {
    let ok = false, msg = r.message || r.expr;
    try { ok = !!evaluate(r.expr); } catch (err) { msg = `${msg} (규칙 계산 실패: ${err.message})`; }
    if (!ok) out.push({ name: r.name, expr: r.expr, message: msg });
  }
  return out;
}

export function validateParamName(name) {
  if (!IDENT.test(name) || RESERVED.has(name)) throw new Error(`파라미터 이름으로 쓸 수 없음: ${name} (영문·숫자·_ , 예약어 제외)`);
}

// 마크다운 표 (작업 기록용)
export function paramsMarkdown(state) {
  const rows = Object.entries(state.params || {});
  if (!rows.length) return '(파라미터 없음)';
  const lines = ['| 이름 | 값 | 단위 | 설명 |', '|---|---|---|---|'];
  for (const [k, v] of rows) lines.push(`| ${k} | ${v.value} | ${v.unit || ''} | ${v.note || ''} |`);
  if ((state.rules || []).length) {
    lines.push('', '규칙:');
    for (const r of state.rules) lines.push(`- \`${r.expr}\` — ${r.message || r.name}`);
  }
  return lines.join('\n');
}
