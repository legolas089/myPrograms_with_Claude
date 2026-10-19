// STEP (AP214) 작성기 — 삼각형 메쉬를 faceted B-rep 으로 기록
//
// 메쉬를 삼각형 하나 = 면 하나로 쓰면 STEP 리더(OCCT, SolidWorks 등)가 면마다 다시 메쉬를 만들어
// 1만 개 남짓한 삼각형에도 수십 초씩 멈춘다. 그래서 쓰기 전에
//   1) 같은 좌표의 정점을 합치고 (출력 자릿수 기준)
//   2) T-접합(다른 삼각형의 꼭짓점이 변 중간에 놓인 곳)을 쪼개 이웃 삼각형끼리 변을 공유하게 만들고
//      그래도 짝 없이 남은 변(Boolean 이 남긴 바늘 모양 틈)만 골라 한 번 더 쪼갠 뒤
//   3) 같은 평면에서 이어진 삼각형들을 다각형 면 하나(구멍은 안쪽 경계)로 합친다.
// 한 파트는 .stp (제품 하나), 여러 파트는 .step (각 파트가 이름 있는 구성품인 어셈블리)로 쓴다.

const PLANE_TOL = 1e-4;   // mm — 같은 평면으로 볼 거리 허용치
const TJ_TOL = 1e-4;      // mm — 변 위에 놓인 정점으로 볼 거리 허용치

export function fmt(n) {
  if (!Number.isFinite(n)) return '0.';
  let s = n.toFixed(6);
  s = s.replace(/0+$/, '').replace(/\.$/, '.0');
  return s === '-0.0' ? '0.0' : s;
}

// STEP 문자열: 작은따옴표는 두 번, ASCII 밖의 문자(한글 등)는 \X2\XXXX\X0\ 로
function str(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else if (c < 0x10000) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += '_';
  }
  return `'${out}'`;
}

// ── 1. 메쉬 → 정점 병합 + 퇴화 삼각형 제거 ──

function weld(geom) {
  const pos = geom.attributes.position, idx = geom.index;
  const n = idx ? idx.count / 3 : pos.count / 3;
  // 허용치(1e-4 mm) 안의 정점은 하나로 — CSG 결과에는 수십 nm 만 다른 사실상 같은 점이 많다
  const Q = 1e-4, TOL2 = Q ** 2;
  const grid = new Map();
  const P = [];
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const qx = Math.round(x / Q), qy = Math.round(y / Q), qz = Math.round(z / Q);
    let id = -1;
    for (let dx = -1; dx <= 1 && id < 0; dx++) for (let dy = -1; dy <= 1 && id < 0; dy++) for (let dz = -1; dz <= 1 && id < 0; dz++) {
      for (const j of grid.get(`${qx + dx},${qy + dy},${qz + dz}`) || []) {
        const p = P[j];
        if ((p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2 <= TOL2) { id = j; break; }
      }
    }
    if (id < 0) {
      id = P.length;
      P.push([Number(fmt(x)), Number(fmt(y)), Number(fmt(z))]);
      const k = `${qx},${qy},${qz}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(id);
    }
    vid[i] = id;
  }
  const T = [];
  for (let t = 0; t < n; t++) {
    const a = vid[idx ? idx.getX(3 * t) : 3 * t], b = vid[idx ? idx.getX(3 * t + 1) : 3 * t + 1], c = vid[idx ? idx.getX(3 * t + 2) : 3 * t + 2];
    if (a === b || b === c || a === c) continue;
    if (triArea2(P[a], P[b], P[c]) < 1e-12) continue;
    T.push([a, b, c]);
  }
  return { P, T };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function triArea2(a, b, c) { return len(cross(sub(b, a), sub(c, a))); }

// ── 2. T-접합 보수 ──

function repairTJunctions(P, T) {
  // 정점 공간 해시
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const h = Math.max(diag / 256, 1e-3);
  const cell = p => `${Math.floor((p[0] - min[0]) / h)},${Math.floor((p[1] - min[1]) / h)},${Math.floor((p[2] - min[2]) / h)}`;
  const grid = new Map();
  P.forEach((p, i) => { const k = cell(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });

  // 각 변 위에 놓인 다른 정점들 (a→b 방향 매개변수 순)
  const splits = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const tri of T) {
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = edgeKey(a, b);
      if (splits.has(key)) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const A = P[lo], B = P[hi], AB = sub(B, A), L2 = dot(AB, AB), L = Math.sqrt(L2);
      const found = new Map();
      const steps = Math.max(1, Math.ceil(L / h));
      for (let s = 0; s <= steps; s++) {
        const q = [A[0] + AB[0] * s / steps, A[1] + AB[1] * s / steps, A[2] + AB[2] * s / steps];
        const cx = Math.floor((q[0] - min[0]) / h), cy = Math.floor((q[1] - min[1]) / h), cz = Math.floor((q[2] - min[2]) / h);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
            if (v === lo || v === hi || found.has(v)) continue;
            const AV = sub(P[v], A);
            const t = dot(AV, AB) / L2;
            // 병합된 정점끼리는 이미 Q 보다 멀다. 끝점 근처(변 방향 거리 ≤ TJ_TOL)라고 빼 버리면
            // 끝점에서 1.1e-4 쯤 떨어진 정점이 병합도 분할도 안 돼 바늘 모양 구멍이 남는다
            if (t <= 0 || t >= 1) continue;
            const perp = sub(AV, [AB[0] * t, AB[1] * t, AB[2] * t]);
            if (len(perp) < TJ_TOL) found.set(v, t);
          }
        }
      }
      splits.set(key, { lo, list: [...found.entries()].sort((x, y) => x[1] - y[1]).map(e => e[0]) });
    }
  }

  const out = [];
  let repaired = 0;
  for (const tri of T) {
    const ring = [];
    let any = false;
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const s = splits.get(edgeKey(a, b));
      ring.push(a);
      if (s && s.list.length) {
        any = true;
        ring.push(...(s.lo === a ? s.list : [...s.list].reverse()));
      }
    }
    if (!any) { out.push(tri); continue; }
    // 변 위 점들을 포함한 볼록 다각형 → 무게중심 기준 부채꼴 (모든 작은 변이 그대로 보존됨)
    repaired++;
    const c = [0, 0, 0];
    for (const k of tri) for (let j = 0; j < 3; j++) c[j] += P[k][j] / 3;
    const ci = P.length;
    P.push(c.map(v => Number(fmt(v))));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (triArea2(P[ci], P[a], P[b]) > 1e-12) out.push([ci, a, b]);
    }
  }
  return { T: out, repaired };
}

// T-접합 보수 뒤에도 짝 없는 변(반대 방향 변이 모자란 변)이 남는 곳만 다시 본다.
// 쪼개서 생긴 짧은 변 위에 또 걸친 정점이나 TJ_TOL 을 살짝 넘는 정점이 그런 틈을 만든다.
// 짝 없는 변 위에 놓인 다른 경계 정점에서, 그 변을 가진 삼각형을 맞은편 꼭짓점 기준 부채꼴로 쪼갠다.
// 후보를 짝 없는 변의 끝점으로만 한정하므로 허용치를 넉넉히 둬도 멀쩡한 곳은 건드리지 않는다
const GAP_TOL = 1e-3;     // mm
function closeGaps(P, T) {
  let fixed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const owners = new Map(); // "u_v" → 그 방향 변을 가진 삼각형들
    T.forEach((tri, t) => {
      for (let k = 0; k < 3; k++) {
        const e = `${tri[k]}_${tri[(k + 1) % 3]}`;
        if (!owners.has(e)) owners.set(e, []);
        owners.get(e).push([t, k]);
      }
    });
    const open = [];
    for (const [e, list] of owners) {
      const [u, v] = e.split('_').map(Number);
      const excess = list.length - (owners.get(`${v}_${u}`)?.length || 0);
      if (excess > 0) open.push({ u, v, list });
    }
    if (!open.length || open.length > 4000) break; // 많이 열려 있으면 미세 틈이 아니라 원래 열린 메쉬
    const bverts = new Set(open.flatMap(o => [o.u, o.v]));
    const split = new Map(); // 삼각형 → { k, list } (한 번에 변 하나만)
    for (const { u, v, list } of open) {
      const A = P[u], AB = sub(P[v], A), L2 = dot(AB, AB);
      const found = [];
      for (const w of bverts) {
        if (w === u || w === v) continue;
        const AW = sub(P[w], A), t = dot(AW, AB) / L2;
        if (t <= 0 || t >= 1) continue;
        if (len(sub(AW, [AB[0] * t, AB[1] * t, AB[2] * t])) <= GAP_TOL) found.push([w, t]);
      }
      if (!found.length) continue;
      const own = list.find(([t]) => !split.has(t));
      if (!own) continue;
      split.set(own[0], { k: own[1], list: found.sort((x, y) => x[1] - y[1]).map(f => f[0]) });
    }
    if (!split.size) break;
    const out = [];
    T.forEach((tri, t) => {
      const s = split.get(t);
      if (!s) { out.push(tri); return; }
      const u = tri[s.k], v = tri[(s.k + 1) % 3], w = tri[(s.k + 2) % 3];
      const ring = [u, ...s.list, v];
      for (let i = 0; i + 1 < ring.length; i++) {
        if (triArea2(P[w], P[ring[i]], P[ring[i + 1]]) > 1e-12) out.push([w, ring[i], ring[i + 1]]);
      }
    });
    T = out;
    fixed += split.size;
  }
  return { T, fixed };
}

// ── 3. 동일 평면 삼각형 → 다각형 면 ──

function mergeCoplanar(P, T) {
  const normals = T.map(([a, b, c]) => { const n = cross(sub(P[b], P[a]), sub(P[c], P[a])); const l = len(n); return [n[0] / l, n[1] / l, n[2] / l]; });
  const areas = T.map(([a, b, c]) => triArea2(P[a], P[b], P[c]));
  const directed = new Map(); // "u_v" → tri
  T.forEach((tri, t) => { for (let k = 0; k < 3; k++) directed.set(`${tri[k]}_${tri[(k + 1) % 3]}`, t); });

  const region = new Int32Array(T.length).fill(-1);
  const order = [...T.keys()].sort((x, y) => areas[y] - areas[x]);
  const regions = [];
  for (const seed of order) {
    if (region[seed] !== -1) continue;
    const id = regions.length;
    const n0 = normals[seed], d0 = dot(n0, P[T[seed][0]]);
    const members = [seed];
    region[seed] = id;
    for (let i = 0; i < members.length; i++) {
      const tri = T[members[i]];
      for (let k = 0; k < 3; k++) {
        const u = tri[k], v = tri[(k + 1) % 3];
        const nb = directed.get(`${v}_${u}`);
        if (nb === undefined || region[nb] !== -1) continue;
        if (dot(normals[nb], n0) < 0.9999) continue;
        if (T[nb].some(p => Math.abs(dot(n0, P[p]) - d0) > PLANE_TOL)) continue;
        region[nb] = id;
        members.push(nb);
      }
    }
    regions.push({ normal: n0, members });
  }

  const faces = [];
  let fallback = 0;
  for (const r of regions) {
    if (r.members.length === 1) { faces.push({ normal: r.normal, loops: [T[r.members[0]]] }); continue; }
    const polys = regionLoops(P, T, r);
    if (polys) for (const loops of polys) faces.push({ normal: r.normal, loops });
    else {
      fallback++;
      for (const t of r.members) faces.push({ normal: normals[t], loops: [T[t]] });
    }
  }
  return { faces, fallback };
}

// 영역 경계를 따라 닫힌 고리들을 만든다. 반환: 면 목록 [[바깥 경계(법선 기준 반시계), 구멍...], ...]
// 경계가 닫히지 않는 등 처리할 수 없으면 null (호출 쪽에서 삼각형 그대로 기록)
function splitAtRepeats(loop) {
  const out = [], stack = [], at = new Map();
  for (const v of loop) {
    if (at.has(v)) {
      const sub = stack.splice(at.get(v));
      for (const x of sub) at.delete(x);
      if (sub.length >= 3) out.push(sub);
    }
    at.set(v, stack.length);
    stack.push(v);
  }
  if (stack.length >= 3) out.push(stack);
  return out;
}

export const debugReasons = {};
function fail(reason) { debugReasons[reason] = (debugReasons[reason] || 0) + 1; return null; }

function regionLoops(P, T, r) {
  const inRegion = new Set(r.members);
  const edgeSet = new Set();
  for (const t of r.members) { const tri = T[t]; for (let k = 0; k < 3; k++) edgeSet.add(`${tri[k]}_${tri[(k + 1) % 3]}`); }
  // 경계 변 (영역이 변의 왼쪽에 있도록 삼각형 방향 그대로)
  const out = new Map();
  const boundary = [];
  for (const t of inRegion) {
    const tri = T[t];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k + 1) % 3];
      if (edgeSet.has(`${v}_${u}`)) continue;
      if (!out.has(u)) out.set(u, []);
      out.get(u).push(v);
      boundary.push([u, v]);
    }
  }
  // 변을 따라 고리를 만든다. 두 경계가 한 점에서 만나는(pinch) 곳에서는 가장 왼쪽으로 꺾는 변을 골라
  // 영역을 왼쪽에 두고 도는 고리가 서로 교차하지 않게 한다
  const n = r.normal;
  const usedE = new Set();
  const loops = [];
  for (const [su, sv] of boundary) {
    if (usedE.has(`${su}_${sv}`)) continue;
    usedE.add(`${su}_${sv}`);
    const loop = [su];
    let prev = su, cur = sv;
    for (let guard = 0; cur !== su; guard++) {
      if (guard > boundary.length) return fail('notClosed');
      loop.push(cur);
      const cands = (out.get(cur) || []).filter(x => !usedE.has(`${cur}_${x}`));
      if (!cands.length) return fail('open');
      let nxt = cands[0];
      if (cands.length > 1) {
        const din = sub(P[cur], P[prev]);
        let best = -Infinity;
        for (const c of cands) {
          const dout = sub(P[c], P[cur]);
          const ang = Math.atan2(dot(cross(din, dout), n), dot(din, dout));
          if (ang > best) { best = ang; nxt = c; }
        }
      }
      usedE.add(`${cur}_${nxt}`);
      prev = cur;
      cur = nxt;
    }
    if (loop.length < 3) return fail('notClosed');
    // 같은 꼭짓점을 두 번 지나는 고리(구멍이 바깥 경계에 한 점으로 닿은 경우 등)는 단순 고리들로 쪼갠다
    loops.push(...splitAtRepeats(loop));
  }
  // 법선 방향으로 투영한 부호 있는 넓이로 바깥/구멍 구분
  const signed = loops.map(loop => {
    let s = [0, 0, 0];
    for (let i = 0; i < loop.length; i++) { const c = cross(P[loop[i]], P[loop[(i + 1) % loop.length]]); s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }
    return dot(s, r.normal) / 2;
  });
  if (signed.some(a => Math.abs(a) < 1e-10)) return fail('zeroArea');
  const outers = loops.filter((_, i) => signed[i] > 0);
  const holes = loops.filter((_, i) => signed[i] < 0);
  if (!outers.length) return fail('noOuter');
  if (outers.length === 1) return [[outers[0], ...holes]];
  // 바깥 경계가 여럿(경계가 한 점에서 스스로 맞닿은 경우) → 바깥 경계마다 면 하나, 구멍은 담고 있는 바깥 경계에 붙인다
  const u = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = cross(n, u), e2 = cross(n, e1);
  const to2 = i => [dot(P[i], e1), dot(P[i], e2)];
  const inside = (pt, loop) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = to2(loop[i]), [xj, yj] = to2(loop[j]);
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const faces = outers.map(o => [o]);
  for (const h of holes) {
    // 구멍의 한 점(꼭짓점끼리 겹칠 수 있어 변 중점)으로 판정
    const a = to2(h[0]), b = to2(h[1]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const k = outers.findIndex(o => inside(mid, o));
    if (k < 0) return fail('orphanHole');
    faces[k].push(h);
  }
  return faces;
}

// 같은 세 정점의 삼각형이 겹쳐 있으면(CSG 결과에 종종 생김) 하나만 남기고,
// 서로 반대 방향인 쌍은 두께 0 막이므로 둘 다 지운다
function dedupe(T) {
  const byKey = new Map();
  for (const t of T) {
    const k = [...t].sort((a, b) => a - b).join('_');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const out = [];
  const orient = t => { const m = t.indexOf(Math.min(...t)); return `${t[m]}_${t[(m + 1) % 3]}`; };
  for (const list of byKey.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const groups = new Map();
    for (const t of list) { const o = orient(t); groups.set(o, (groups.get(o) || []).concat([t])); }
    const [g1, g2] = [...groups.values()];
    const n1 = g1.length, n2 = g2 ? g2.length : 0;
    if (n1 > n2) out.push(g1[0]); else if (n2 > n1) out.push(g2[0]);
  }
  return out;
}

// CSG 가 남기는 부피 0 조각(서로 등을 맞댄 면 둘로 된 막)을 지운다 — 닫혀 있어도 솔리드가 아니고
// 본체와 모서리를 공유하지 않아 STEP 에서 떨어진 면 묶음으로 남는다
function dropSlivers(P, faces) {
  const parent = faces.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const owner = new Map();
  faces.forEach((f, fi) => { for (const l of f.loops) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length], key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const o = owner.get(key);
    if (o === undefined) owner.set(key, fi); else parent[find(o)] = find(fi);
  } });
  const vol = new Map();
  let total = 0;
  faces.forEach((f, fi) => {
    let v = 0;
    for (const l of f.loops) for (let i = 1; i < l.length - 1; i++) v += dot(P[l[0]], cross(P[l[i]], P[l[i + 1]])) / 6;
    const r = find(fi);
    vol.set(r, (vol.get(r) || 0) + v);
    total += v;
  });
  if (vol.size < 2) return { faces, removed: 0 };
  const eps = 1e-3 + 1e-7 * Math.abs(total);
  let removed = 0;
  for (const v of vol.values()) if (Math.abs(v) <= eps) removed++;
  return { faces: faces.filter((_, fi) => Math.abs(vol.get(find(fi))) > eps), removed };
}

// 지오메트리 하나를 STEP 면 목록으로 정리
export function meshToFaces(geom) {
  const { P, T } = weld(geom);
  const rep = repairTJunctions(P, dedupe(T));
  const gap = closeGaps(P, dedupe(rep.T));
  const merged = mergeCoplanar(P, dedupe(gap.T));
  const sliver = dropSlivers(P, merged.faces);
  const { faces } = sliver, { fallback } = merged;
  // 닫힌 솔리드인지: 모든 경계 변이 반대 방향으로 다른 면에서 한 번 더 쓰여야 한다
  const dir = new Set();
  for (const f of faces) for (const l of f.loops) for (let i = 0; i < l.length; i++) dir.add(`${l[i]}_${l[(i + 1) % l.length]}`);
  let closed = true;
  for (const e of dir) { const [a, b] = e.split('_'); if (!dir.has(`${b}_${a}`)) { closed = false; break; } }
  return { points: P, faces, closed, stats: { triangles: T.length, repaired: rep.repaired, gapsClosed: gap.fixed, slivers: sliver.removed, faces: faces.length, fallbackRegions: fallback, open: closed ? 0 : 1 } };
}

// ── 4. STEP 파일 쓰기 ──

class Builder {
  constructor() { this.lines = []; this.id = 0; }
  add(s) { this.lines.push(`#${++this.id}=${s};`); return this.id; }
}

function writeSolid(b, body, name) {
  const pid = new Map();
  const point = i => {
    let id = pid.get(i);
    if (id === undefined) { const p = body.points[i]; id = b.add(`CARTESIAN_POINT('',(${fmt(p[0])},${fmt(p[1])},${fmt(p[2])}))`); pid.set(i, id); }
    return id;
  };
  const faceIds = [];
  for (const f of body.faces) {
    const bounds = f.loops.map((loop, li) => {
      const pl = b.add(`POLY_LOOP('',(${loop.map(i => '#' + point(i)).join(',')}))`);
      return b.add(`${li === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${pl},.T.)`);
    });
    const p0 = body.points[f.loops[0][0]], p1 = body.points[f.loops[0][1]];
    const n = f.normal;
    let r = sub(p1, p0);
    r = sub(r, n.map(x => x * dot(r, n)));
    const rl = len(r) || 1;
    const dn = b.add(`DIRECTION('',(${fmt(n[0])},${fmt(n[1])},${fmt(n[2])}))`);
    const dr = b.add(`DIRECTION('',(${fmt(r[0] / rl)},${fmt(r[1] / rl)},${fmt(r[2] / rl)}))`);
    const ax = b.add(`AXIS2_PLACEMENT_3D('',#${point(f.loops[0][0])},#${dn},#${dr})`);
    const plane = b.add(`PLANE('',#${ax})`);
    faceIds.push(b.add(`FACE_SURFACE('',(${bounds.map(x => '#' + x).join(',')}),#${plane},.T.)`));
  }
  // 닫힌 메쉬 = 솔리드(faceted B-rep), 열린 메쉬(얇은 판·불완전한 STEP 파트) = 곡면 모델
  const list = faceIds.map(x => '#' + x).join(',');
  if (body.closed) return b.add(`FACETED_BREP(${str(name)},#${b.add(`CLOSED_SHELL('',(${list}))`)})`);
  return b.add(`SHELL_BASED_SURFACE_MODEL(${str(name)},(#${b.add(`OPEN_SHELL('',(${list}))`)}))`);
}

function originAxis(b) {
  const o = b.add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const z = b.add(`DIRECTION('',(0.,0.,1.))`);
  const x = b.add(`DIRECTION('',(1.,0.,0.))`);
  return b.add(`AXIS2_PLACEMENT_3D('',#${o},#${z},#${x})`);
}

// components: [{ name, body }] (body = meshToFaces 결과)
// assembly=false 이고 구성품이 하나면 단일 파트, 아니면 어셈블리(루트 제품 + 이름 있는 구성품)
export function writeStep({ fileName, rootName, components, assembly }) {
  const b = new Builder();
  const ctx = b.add(`APPLICATION_CONTEXT('automotive design')`);
  b.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctx})`);
  const pc = b.add(`PRODUCT_CONTEXT('',#${ctx},'mechanical')`);
  const pdc = b.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ctx},'design')`);
  const lu = b.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const au = b.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const su = b.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = b.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#${lu},'distance_accuracy_value','')`);
  const gc = b.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${au},#${su}))REPRESENTATION_CONTEXT('Context','3D'))`);

  const product = name => {
    const prod = b.add(`PRODUCT(${str(name)},${str(name)},'',(#${pc}))`);
    const pdf = b.add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
    const pd = b.add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdc})`);
    const pds = b.add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
    return { prod, pd, pds };
  };
  const partRep = (name, body) => {
    const ax = originAxis(b);
    const solid = writeSolid(b, body, name);
    const repType = body.closed ? 'FACETED_BREP_SHAPE_REPRESENTATION' : 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION';
    const rep = b.add(`${repType}(${str(name)},(#${ax},#${solid}),#${gc})`);
    return { ax, rep };
  };

  if (!assembly && components.length === 1) {
    const c = components[0];
    const p = product(c.name);
    const { rep } = partRep(c.name, c.body);
    b.add(`SHAPE_DEFINITION_REPRESENTATION(#${p.pds},#${rep})`);
  } else {
    const root = product(rootName || 'Assembly');
    const rootAx = originAxis(b);
    const rootRep = b.add(`SHAPE_REPRESENTATION(${str(rootName || 'Assembly')},(#${rootAx}),#${gc})`);
    b.add(`SHAPE_DEFINITION_REPRESENTATION(#${root.pds},#${rootRep})`);
    components.forEach((c, i) => {
      const p = product(c.name);
      const { ax, rep } = partRep(c.name, c.body);
      b.add(`SHAPE_DEFINITION_REPRESENTATION(#${p.pds},#${rep})`);
      const nauo = b.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}',${str(c.name)},'',#${root.pd},#${p.pd},$)`);
      const pdsN = b.add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
      const idt = b.add(`ITEM_DEFINED_TRANSFORMATION('','',#${ax},#${rootAx})`);
      const rr = b.add(`(REPRESENTATION_RELATIONSHIP('','',#${rep},#${rootRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
      b.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rr},#${pdsN})`);
    });
  }

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Simple CAD Modeler faceted brep'),'2;1');
FILE_NAME(${str(fileName || 'model.step')},'${new Date().toISOString().slice(0, 19)}',(''),(''),'Simple CAD Modeler','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
${b.lines.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}
