// 수치 질의 — 형상에서 치수를 바로 숫자로 뽑는다 (cad.probe / cad.section / cad.mass)
// 모두 세계 좌표 mm. 메쉬 근사이므로 곡면 값에는 분할 오차가 들어간다 (원 맞춤 결과의 dev 로 확인)
import * as THREE from 'three';

const r4 = v => Math.round(v * 1e4) / 1e4;

function triangles(geom, fn) {
  const pos = geom.attributes.position, idx = geom.index;
  const n = (idx ? idx.count : pos.count) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, idx ? idx.getX(3 * t) : 3 * t);
    b.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 1) : 3 * t + 1);
    c.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 2) : 3 * t + 2);
    fn(a, b, c);
  }
}

// ── 광선 ──
// origin 에서 dir 방향 직선(양방향)과 만나는 모든 점. 면 법선과 광선 방향으로 들어감/나감을 판정해
// 재료 구간(두께) 목록을 만든다
export function probe(geoms, origin, dir) {
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir).normalize();
  const ray = new THREE.Ray(o.clone().addScaledVector(d, -1e5), d);
  const hits = [];
  const p = new THREE.Vector3();
  for (const g of geoms) triangles(g, (a, b, c) => {
    if (!ray.intersectTriangle(a, b, c, false, p)) return;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    hits.push({ t: p.clone().sub(o).dot(d), point: p.clone(), enter: n.dot(d) < 0 });
  });
  hits.sort((x, y) => x.t - y.t);
  // 모서리에서 같은 점이 두 번 잡히면 하나로
  const uniq = [];
  for (const h of hits) if (!uniq.length || Math.abs(h.t - uniq[uniq.length - 1].t) > 1e-6 || h.enter !== uniq[uniq.length - 1].enter) uniq.push(h);
  const segments = [];
  let depth = 0, start = null;
  for (const h of uniq) {
    if (h.enter) { if (depth === 0) start = h; depth++; }
    else if (depth > 0) { depth--; if (depth === 0) segments.push({ from: start.point.toArray().map(r4), to: h.point.toArray().map(r4), thickness: r4(h.t - start.t) }); }
  }
  return {
    origin, dir: d.toArray().map(r4),
    hits: uniq.map(h => ({ point: h.point.toArray().map(r4), t: r4(h.t), enter: h.enter })),
    segments,
  };
}

// ── 단면 ──
// plane: {z: 값} | {x: 값} | {y: 값} | {point:[..], normal:[..]}
// → 닫힌 고리마다 넓이·둘레·중심·bbox·원 맞춤(반지름/지름/중심/최대편차), 구멍 여부, 전체 단면적
export function section(geoms, plane) {
  let n, p0;
  if (plane.z !== undefined) { n = new THREE.Vector3(0, 0, 1); p0 = new THREE.Vector3(0, 0, plane.z); }
  else if (plane.x !== undefined) { n = new THREE.Vector3(1, 0, 0); p0 = new THREE.Vector3(plane.x, 0, 0); }
  else if (plane.y !== undefined) { n = new THREE.Vector3(0, 1, 0); p0 = new THREE.Vector3(0, plane.y, 0); }
  else { n = new THREE.Vector3(...plane.normal).normalize(); p0 = new THREE.Vector3(...plane.point); }
  // 평면 위 2D 좌표계 (z 단면이면 u=x, v=y 그대로)
  const u = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : (Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  u.addScaledVector(n, -u.dot(n)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const to2 = q => [q.clone().sub(p0).dot(u), q.clone().sub(p0).dot(v)];
  const to3 = ([x, y]) => p0.clone().addScaledVector(u, x).addScaledVector(v, y);

  const segs = [];
  for (const g of geoms) triangles(g, (a, b, c) => {
    const pts = [a, b, c], ds = pts.map(q => q.clone().sub(p0).dot(n));
    const cut = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, di = ds[i], dj = ds[j];
      if ((di > 0) !== (dj > 0) && Math.abs(di - dj) > 1e-12) cut.push(pts[i].clone().lerp(pts[j], di / (di - dj)));
    }
    if (cut.length === 2) segs.push([to2(cut[0]), to2(cut[1])]);
  });

  // 끝점을 이어 사슬로 (양쪽으로 늘린다). CSG 메쉬는 T-접합·짧은 틈 때문에 사슬이 끊길 수 있으므로
  // 열린 사슬끼리는 가장 가까운 끝점을 이어(0.05 mm 이내) 닫힌 고리로 만든다
  const Q = 1e-4, key = q => `${Math.round(q[0] / Q)},${Math.round(q[1] / Q)}`;
  const adj = new Map();
  segs.forEach((s, i) => { if (key(s[0]) === key(s[1])) return; for (const e of [0, 1]) { const k = key(s[e]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push([i, e]); } });
  const used = new Uint8Array(segs.length);
  const grow = (chain, end) => {
    for (let guard = 0; guard < segs.length; guard++) {
      const cur = end ? chain[chain.length - 1] : chain[0];
      const next = (adj.get(key(cur)) || []).find(([j]) => !used[j]);
      if (!next) return;
      const [j, e] = next;
      used[j] = 1;
      const q = segs[j][1 - e];
      if (key(q) === key(end ? chain[0] : chain[chain.length - 1])) { chain.closed = true; return; }
      if (end) chain.push(q); else chain.unshift(q);
    }
  };
  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i] || key(segs[i][0]) === key(segs[i][1])) continue;
    used[i] = 1;
    const chain = [segs[i][0], segs[i][1]];
    grow(chain, true);
    if (!chain.closed) grow(chain, false);
    chains.push(chain);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const open = chains.filter(c => !c.closed);
  const loops = chains.filter(c => c.closed);
  while (open.length) {
    const c = open.shift();
    for (let guard = 0; guard < 1000; guard++) {
      const tail = c[c.length - 1];
      if (dist(tail, c[0]) < 0.05) break;
      let best = -1, bestD = 0.05, rev = false;
      open.forEach((o, i) => {
        const d0 = dist(tail, o[0]), d1 = dist(tail, o[o.length - 1]);
        if (d0 < bestD) { best = i; bestD = d0; rev = false; }
        if (d1 < bestD) { best = i; bestD = d1; rev = true; }
      });
      if (best < 0) break;
      const o = open.splice(best, 1)[0];
      c.push(...(rev ? o.reverse() : o));
    }
    if (c.length >= 3) loops.push(c);
  }

  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const out = loops.map(L => {
    let A = 0, per = 0, cx = 0, cy = 0;
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (let i = 0; i < L.length; i++) {
      const [x0, y0] = L[i], [x1, y1] = L[(i + 1) % L.length];
      const cr = x0 * y1 - x1 * y0;
      A += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
      per += Math.hypot(x1 - x0, y1 - y0);
      min[0] = Math.min(min[0], x0); min[1] = Math.min(min[1], y0); max[0] = Math.max(max[0], x0); max[1] = Math.max(max[1], y0);
    }
    A /= 2;
    const cen = Math.abs(A) > 1e-12 ? [cx / (6 * A), cy / (6 * A)] : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    // 원 맞춤: 넓이 중심에서의 거리
    const rs = L.map(([x, y]) => Math.hypot(x - cen[0], y - cen[1]));
    const rMean = rs.reduce((s, r) => s + r, 0) / rs.length;
    const dev = Math.max(...rs.map(r => Math.abs(r - rMean)));
    const circular = L.length >= 8 && dev < Math.max(0.01 * rMean, 0.02);
    const c3 = to3(cen);
    return {
      area: Math.abs(A), perimeter: per, points: L.length,
      centroid: c3.toArray().map(r4),
      bbox: { min: to3(min).toArray().map(r4), max: to3(max).toArray().map(r4), size: [r4(max[0] - min[0]), r4(max[1] - min[1])] },
      circle: circular ? { r: r4(rMean), d: r4(2 * rMean), center: c3.toArray().map(r4), dev: r4(dev) } : null,
      _poly: L,
    };
  });
  // 바깥/구멍: 다른 고리 안에 홀수 번 들어 있으면 구멍
  for (const a of out) {
    const depth = out.filter(b => b !== a && b.area > a.area && inside(a._poly[0], b._poly)).length;
    a.hole = depth % 2 === 1;
  }
  out.sort((a, b) => b.area - a.area);
  const net = out.reduce((s, l) => s + (l.hole ? -l.area : l.area), 0);
  return {
    plane, area: r4(net),
    loops: out.map(({ _poly, area, perimeter, ...rest }) => ({ ...rest, area: r4(area), perimeter: r4(perimeter) })),
    holes: out.filter(l => l.hole).map(l => l.circle ? l.circle.d : null),
  };
}

// ── Z축 기준 반지름 범위 (회전체·패턴 부품의 최대 반지름, 높이 범위) ──
export function radial(geoms) {
  let rmax = 0, rmin = Infinity, zmin = Infinity, zmax = -Infinity;
  for (const g of geoms) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i)), z = p.getZ(i);
      if (r > rmax) rmax = r; if (r < rmin) rmin = r;
      if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    }
  }
  return { rmax: r4(rmax), dmax: r4(2 * rmax), rmin: r4(rmin), zmin: r4(zmin), zmax: r4(zmax), length: r4(zmax - zmin) };
}

// ── 질량 특성 ──
export function massProps(geoms, density = null) {
  let V = 0, A = 0;
  const C = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const g of geoms) {
    g.computeBoundingBox(); box.union(g.boundingBox);
    triangles(g, (a, b, c) => {
      const v = a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
      V += v;
      C.addScaledVector(new THREE.Vector3().add(a).add(b).add(c), v / 4);
      A += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    });
  }
  const centroid = Math.abs(V) > 1e-12 ? C.divideScalar(V) : new THREE.Vector3();
  const out = {
    volume: r4(V), area: r4(A), centroid: centroid.toArray().map(r4),
    bbox: { min: box.min.toArray().map(r4), max: box.max.toArray().map(r4), size: box.getSize(new THREE.Vector3()).toArray().map(r4) },
  };
  if (density) out.mass = r4(V * density); // density 단위에 맞춘 질량 (예: g/mm³ → g)
  return out;
}
