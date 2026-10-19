// 설계 중 형상 검사 — 열린(찢어진) 면, 면 방향, 비다양체 모서리, Boolean 실패를 노드마다 찾아낸다.
// 결과는 노드 내용(자식 포함) 키로 캐시하므로 바뀌지 않은 노드는 다시 계산하지 않는다.
import { evaluateNode, isBooleanNode, isStepNode, nodeInputs, nodeKey as kernelKey } from './kernel.js';
import { meshToFaces } from './stepwriter.js';

const VOL_REL = 1e-5;  // Boolean 부피 규칙 허용 오차 (상대, float 오차 수준)

// ── 메쉬 검사 ──
// STEP 내보내기와 같은 정리(정점 합치기 → 겹친 삼각형 제거 → T-접합 보수 → 틈 메우기 → 평면 병합)를 거친 뒤의
// 면 경계로 판단한다. 즉 "내보낸 STEP 이 닫힌 솔리드인가"와 같은 기준이다.
export function meshHealth(geom) {
  const { points: P, faces, stats } = meshToFaces(geom);
  const count = new Map(); // "u_v" → 그 방향으로 쓰인 횟수
  let volume = 0;
  for (const f of faces) for (const l of f.loops) {
    const o = P[l[0]];
    for (let i = 0; i < l.length; i++) {
      const u = l[i], v = l[(i + 1) % l.length];
      count.set(`${u}_${v}`, (count.get(`${u}_${v}`) || 0) + 1);
      if (i > 0 && i < l.length - 1) {
        const B = P[u], C = P[v];
        volume += (o[0] * (B[1] * C[2] - B[2] * C[1]) - o[1] * (B[0] * C[2] - B[2] * C[0]) + o[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
      }
    }
  }
  let openEdges = 0, openLength = 0, nonManifold = 0, flipped = 0;
  let openBox = null, nmBox = null;
  const grow = (box, pts) => {
    box = box || { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const p of pts) for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i], p[i]); box.max[i] = Math.max(box.max[i], p[i]); }
    return box;
  };
  const seen = new Set();
  for (const [k, f] of count) {
    const [u, v] = k.split('_');
    const back = `${v}_${u}`;
    if (seen.has(back)) continue;
    seen.add(k);
    const r = count.get(back) || 0;
    if (f === r) {
      // 10 µm 보다 짧은 비다양체 모서리는 CSG 부동소수 잔여물이라 형상 의미가 없다 (일반 CAD 공차 0.01 mm 이하)
      const A = P[+u], B = P[+v];
      if (f > 1 && Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) >= 0.01) { nonManifold++; nmBox = grow(nmBox, [A, B]); }
      continue;
    }
    if (Math.min(f, r) === 0 && Math.max(f, r) === 1) {
      openEdges++;
      const A = P[+u], B = P[+v];
      openLength += Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      openBox = grow(openBox, [A, B]);
    } else flipped++;
  }
  // 떨어진 솔리드(셸) 개수 — 모서리를 공유하는 면끼리 묶는다
  const parent = faces.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const owner = new Map();
  faces.forEach((f, fi) => { for (const l of f.loops) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length], k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const o = owner.get(k);
    if (o === undefined) owner.set(k, fi); else parent[find(o)] = find(fi);
  } });
  const shells = new Set(faces.map((_, i) => find(i))).size;
  return { triangles: stats.triangles, faces: faces.length, volume, shells, openEdges, openLength, openBox, nonManifold, nmBox, flipped };
}

// 가벼운 검사: 부피와 떨어진 솔리드 개수만 (정점을 공유하는 삼각형끼리 한 덩어리 — T-접합이 있어도 이어진다).
// 위상 검사(meshToFaces)는 무거우므로 최상위 결과에만 하고, 그 아래 중간 노드는 이것으로 Boolean 규칙만 본다
export function meshLight(geom) {
  const pos = geom.attributes.position, idx = geom.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const Q = 1e-4;
  const vid = new Map();
  const id = i => {
    const k = `${Math.round(pos.getX(i) / Q)},${Math.round(pos.getY(i) / Q)},${Math.round(pos.getZ(i) / Q)}`;
    let v = vid.get(k); if (v === undefined) { v = vid.size; vid.set(k, v); } return v;
  };
  const parent = [];
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const tris = [];
  let volume = 0;
  for (let t = 0; t < nTri; t++) {
    const ii = [0, 1, 2].map(k => idx ? idx.getX(3 * t + k) : 3 * t + k);
    const v = ii.map(id);
    for (const x of v) if (parent[x] === undefined) parent[x] = x;
    parent[find(v[0])] = find(v[1]); parent[find(v[1])] = find(v[2]);
    const [A, B, C] = ii.map(i => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const dv = (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    volume += dv;
    tris.push([v[0], dv]);
  }
  const comp = new Map();
  for (const [v, dv] of tris) { const r = find(v); comp.set(r, (comp.get(r) || 0) + dv); }
  const eps = 1e-3 + 1e-7 * Math.abs(volume);
  let shells = 0;
  for (const cv of comp.values()) if (Math.abs(cv) > eps) shells++;
  return { triangles: nTri, volume, shells };
}

// ── 노드 검사 (캐시) ──
// full: 위상까지 (열린 면·면 방향·비다양체) + Boolean 규칙, light: 부피·조각 수 + Boolean 규칙

const cache = new Map(); // 'F|' or 'L|' + nodeKey → report (id/name 제외)

export const nodeKey = kernelKey;

const r3 = v => Math.round(v * 1000) / 1000;
const fmtBox = b => `x ${r3(b.min[0])}~${r3(b.max[0])}, y ${r3(b.min[1])}~${r3(b.max[1])}, z ${r3(b.min[2])}~${r3(b.max[2])}`;

function computeReport(node, nodeMap, memo, full) {
  const issues = [];
  let h = null;
  let geom = null;
  try {
    geom = evaluateNode(node, nodeMap);
    if (!geom) {
      if (isStepNode(node)) return { issues: [{ level: 'warn', code: 'step-missing', message: 'STEP 원본이 로드되지 않아 검사하지 못함' }], volume: null, full };
      issues.push({ level: 'error', code: 'eval-failed', message: '형상을 계산하지 못함 (입력 노드가 없음)' });
    }
  } catch (err) {
    issues.push({ level: 'error', code: 'eval-failed', message: `형상 계산 실패: ${err.message}` });
  }
  if (geom) {
    h = full ? meshHealth(geom) : meshLight(geom);
    if (full) h.shells = meshLight(geom).shells; // 조각 수는 두 방식에서 같은 기준으로
    geom.dispose();
  }

  if (h) {
    if (h.triangles === 0) {
      issues.push({ level: 'error', code: 'empty', message: isBooleanNode(node)
        ? `Boolean ${node.op} 결과가 비어 있음 (입력이 겹치지 않거나 연산 실패)`
        : '형상이 비어 있음' });
    }
    if (h.openEdges) issues.push({ level: 'error', code: 'open',
      message: `열린/찢어진 면: 열린 모서리 ${h.openEdges}개 (길이 합 ${r3(h.openLength)} mm, 위치 ${fmtBox(h.openBox)})` });
    if (h.flipped) issues.push({ level: 'error', code: 'flipped', message: `면 방향이 어긋난 모서리 ${h.flipped}개 (안팎이 뒤집힌 면)` });
    if (h.triangles && h.volume < 0) issues.push({ level: 'error', code: 'inverted', message: `부피가 음수 (${r3(h.volume)} mm³) — 안팎이 뒤집힌 솔리드` });
    if (h.nonManifold) issues.push({ level: 'warn', code: 'nonmanifold',
      message: `한 모서리를 면 3개 이상이 공유 ${h.nonManifold}곳 (솔리드끼리 모서리·면으로만 맞닿음, 위치 ${fmtBox(h.nmBox)}) — 0.5~1 mm 겹치게 수정 권장` });
  }

  // Boolean 부피 규칙: 입력이 정상일 때만 판단 (입력 오류는 입력 노드에 표시됨)
  if (h && h.triangles && isBooleanNode(node)) {
    const ra = reportFor(nodeMap.get(node.a), nodeMap, memo, false), rb = reportFor(nodeMap.get(node.b), nodeMap, memo, false);
    const ok = r => r && r.volume !== null && !r.issues.some(i => i.level === 'error');
    if (ok(ra) && ok(rb)) {
      const V = h.volume, Va = ra.volume, Vb = rb.volume, tol = VOL_REL * Math.max(Va, Vb, 1);
      const bad = msg => issues.push({ level: 'error', code: 'bool-volume', message: `Boolean ${node.op} 실패 의심: ${msg} (A ${r3(Va)}, B ${r3(Vb)}, 결과 ${r3(V)} mm³)` });
      if (node.op === 'union') {
        if (V < Math.max(Va, Vb) - tol || V > Va + Vb + tol) bad('합집합 부피가 범위를 벗어남');
        else if (h.shells >= ra.shells + rb.shells) issues.push({ level: 'warn', code: 'bool-disjoint', message: `Union 의 두 입력이 이어지지 않음 — 떨어진 솔리드 ${h.shells}개. 0.5~1 mm 겹치게 수정 권장` });
      } else if (node.op === 'subtract') {
        if (V > Va + tol || V < Va - Vb - tol) bad('차집합 부피가 범위를 벗어남');
        else if (V > Va - tol) issues.push({ level: 'warn', code: 'bool-noeffect', message: 'Cut 이 아무것도 깎지 않음 — 빼는 형상이 겹치지 않음' });
        else if (h.shells > ra.shells) issues.push({ level: 'warn', code: 'bool-split', message: `Cut 으로 형상이 ${h.shells}조각으로 나뉨` });
      } else if (node.op === 'intersect') {
        if (V > Math.min(Va, Vb) + tol) bad('교집합 부피가 입력보다 큼');
      }
    }
  }
  return { issues, full, volume: h ? h.volume : null, shells: h ? h.shells : 0, triangles: h ? h.triangles : 0, openEdges: h ? h.openEdges : 0 };
}

// full 결과가 캐시에 있으면 light 요청에도 그것을 쓴다 (더 많은 것을 검사한 결과)
function reportFor(node, nodeMap, memo, full) {
  if (!node) return null;
  const key = nodeKey(node, nodeMap, memo);
  let r = cache.get('F|' + key) || (!full && cache.get('L|' + key));
  if (!r) {
    r = computeReport(node, nodeMap, memo, full);
    cache.set((full ? 'F|' : 'L|') + key, r);
    if (cache.size > 4000) cache.delete(cache.keys().next().value);
  }
  return r;
}

// 노드 하나 (Boolean 이면 입력의 부피도 필요해 입력까지 가볍게 검사된다). full=false 면 위상 검사 생략
export function checkNode(node, nodeMap, memo = new Map(), full = true) {
  const r = reportFor(node, nodeMap, memo, full);
  return r && { id: node.id, name: node.name || node.type, ...r };
}

// 계산 없이 캐시에 있는 결과만 (Outliner 표시용). 없으면 undefined
export function cachedReport(node, nodeMap, memo = new Map()) {
  const key = nodeKey(node, nodeMap, memo);
  return cache.get('F|' + key) || cache.get('L|' + key);
}

// 노드들(최상위 결과, 위상까지 검사)과 그 하위 트리(가벼운 검사, 이미 위상 검사한 결과가 있으면 그것)의 문제 목록
export function collectIssues(nodes, nodeMap) {
  const memo = new Map(), seen = new Set(), out = [];
  const walk = (n, root) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    for (const id of nodeInputs(n)) walk(nodeMap.get(id), false);
    const r = checkNode(n, nodeMap, memo, root);
    if (r) for (const i of r.issues) out.push({ id: n.id, name: r.name, ...i });
  };
  nodes.forEach(n => walk(n, true));
  return out;
}
