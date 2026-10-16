// 스크립트 API — 브라우저 콘솔(또는 Claude)에서 window.cad 로 모델링을 조작한다.
// 모든 변경은 History 를 거치므로 화면의 Undo/Redo 로 되돌릴 수 있다.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { defaultParams, evaluateNode, PRIMITIVE_FIELDS, isBooleanNode } from './kernel.js';
import { cmdAddNode, cmdDeleteNode, cmdBoolean, cmdReplaceState, cmdSetTransforms } from './history.js';
import { serialize } from './persistence.js';
import { getMeshForNode } from './visualize.js';
import { composeDelta } from './gizmo.js';

const HELP = `window.cad — Simple CAD Modeler 스크립트 API (단위 mm, Z-up, 회전은 XYZ 오일러 °)
  cad.list()                         노드 요약 [{id,type,name,params,transform,bbox,...}]
  cad.get(id)                        노드 하나 요약
  cad.add(type, params?, opts?)      type: box|cylinder|sphere|cone, opts: {pos,rot,scale,name} → id
  cad.boolean(op, a, b, name?)       op: union|subtract|intersect → id  (a 에서 b 를 뺌)
  cad.update(id, {params,pos,rot,scale,name,visible})
  cad.move(ids, [dx,dy,dz])          노드들을 상대 이동 (한 번의 Undo)
  cad.moveTo(ids, [x,y,z], anchor?)  bbox 중심(anchor='bottom' 이면 바닥 중심)을 해당 좌표로
  cad.rotate(ids, [rx,ry,rz], pivot?) 세계 축 기준 회전 (기본 pivot = bbox 중심). Y-up 모델 → Z-up: [90,0,0]
  cad.remove(...ids)
  cad.select(...ids)                 화면 선택 (빈 인자 = 선택 해제)
  await cad.importStep(url)          서버 경로의 STEP 을 참조 모델로 가져오기 → [ids]
  cad.bbox(...ids)                   세계 좌표 bbox {min,max,size,center}
  cad.distance(a, b)                 두 노드 최소거리 {distance, intersects, pointA, pointB}
  cad.view(name?, ids?)              iso|top|bottom|front|back|left|right (+ids 로 해당 노드만 프레이밍)
  cad.lastMeasure()                  측정 패널의 마지막 결과
  cad.undo() / cad.redo() / cad.newScene() / cad.toJSON()`;

// 거리/간섭 계산용 BVH. 화면용 BVH 는 삼각형 순서를 보존하는 indirect 모드인데,
// three-mesh-bvh 의 geometry 간 거리 계산은 indirect 에서 결과가 틀리므로 별도의 일반 BVH 를 만들어 캐시한다.
const distCache = new WeakMap();
function distanceGeometry(geom) {
  let g = distCache.get(geom);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', geom.attributes.position);
    if (geom.index) g.setIndex(geom.index.clone());
    g.boundsTree = new MeshBVH(g);
    distCache.set(geom, g);
  }
  return g;
}

// 두 삼각형 사이 거리 (교차하지 않는다는 가정): 꼭짓점–면 6쌍, 변–변 9쌍 중 최소.
// three-mesh-bvh 의 distanceToTriangle 은 같은 평면 위의 떨어진 두 삼각형(동축 구멍 벽 등)을 0 으로 내므로 직접 계산한다.
const _ta = new THREE.Triangle(), _tb = new THREE.Triangle(), _q = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
function segSegClosest(p1, q1, p2, q2, outA, outB) {
  const d1 = _s1.subVectors(q1, p1), d2 = _s2.subVectors(q2, p2);
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.x * rx + d2.y * ry + d2.z * rz;
  let s = 0, t = 0;
  if (a > 1e-14 || e > 1e-14) {
    if (a <= 1e-14) t = Math.min(1, Math.max(0, f / e));
    else {
      const c = d1.x * rx + d1.y * ry + d1.z * rz;
      if (e <= 1e-14) s = Math.min(1, Math.max(0, -c / a));
      else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-14 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
        else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      }
    }
  }
  outA.copy(p1).addScaledVector(d1, s);
  outB.copy(p2).addScaledVector(d2, t);
  return outA.distanceTo(outB);
}
function triTriDistance(A, B, outA, outB) {
  _ta.set(A.a, A.b, A.c); _tb.set(B.a, B.b, B.c);
  let best = Infinity;
  const ca = new THREE.Vector3(), cb = new THREE.Vector3();
  for (const v of [B.a, B.b, B.c]) {
    _ta.closestPointToPoint(v, _q);
    const d = _q.distanceTo(v);
    if (d < best) { best = d; outA.copy(_q); outB.copy(v); }
  }
  for (const v of [A.a, A.b, A.c]) {
    _tb.closestPointToPoint(v, _q);
    const d = _q.distanceTo(v);
    if (d < best) { best = d; outA.copy(v); outB.copy(_q); }
  }
  const ea = [[A.a, A.b], [A.b, A.c], [A.c, A.a]], eb = [[B.a, B.b], [B.b, B.c], [B.c, B.a]];
  for (const [p1, q1] of ea) for (const [p2, q2] of eb) {
    const d = segSegClosest(p1, q1, p2, q2, ca, cb);
    if (d < best) { best = d; outA.copy(ca); outB.copy(cb); }
  }
  return best;
}

// 두 메쉬 표면 사이 최단거리. 삼각형 수가 적은 쪽의 각 삼각형에 대해
// 다른 쪽 BVH 를 현재 최솟값보다 가까운 노드만 탐색하며 삼각형–삼각형 거리를 잰다.
// (three-mesh-bvh 0.7.8 의 closestPointToGeometry 도 같은 이유로 결과가 틀려 쓰지 않는다)
function triCount(g) { return g.index ? g.index.count / 3 : g.attributes.position.count / 3; }
function boxGap(a, b) {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}
function meshDistance(gA, gB) {
  const swap = triCount(gA) < triCount(gB);
  const [big, small] = swap ? [gB, gA] : [gA, gB];
  const pos = small.attributes.position, idx = small.index;
  const tri = new THREE.Triangle();
  const triBox = new THREE.Box3();
  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  let best = Infinity;
  const bestS = new THREE.Vector3(), bestB = new THREE.Vector3();
  const n = triCount(small);
  for (let t = 0; t < n && best > 0; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    tri.a.fromBufferAttribute(pos, i0); tri.b.fromBufferAttribute(pos, i1); tri.c.fromBufferAttribute(pos, i2);
    triBox.setFromPoints([tri.a, tri.b, tri.c]);
    big.boundsTree.shapecast({
      intersectsBounds: box => boxGap(box, triBox) < best,
      boundsTraverseOrder: box => boxGap(box, triBox),
      intersectsTriangle: other => {
        const d = triTriDistance(other, tri, p1, p2);
        if (d < best) { best = d; bestB.copy(p1); bestS.copy(p2); }
        return d === 0;
      },
    });
  }
  return swap
    ? { distance: best, pointA: bestS, pointB: bestB }
    : { distance: best, pointA: bestB, pointB: bestS };
}

// 두 닫힌 메쉬의 교집합 체적 (mm³). 계산 실패(열린 메쉬 등) 시 null
const csgEval = new Evaluator();
csgEval.attributes = ['position'];
csgEval.useGroups = false;
function intersectionVolume(gA, gB) {
  try {
    const bare = g => {
      const x = new THREE.BufferGeometry();
      x.setAttribute('position', g.attributes.position);
      if (g.index) x.setIndex(g.index.clone());
      return x;
    };
    const a = new Brush(bare(gA)), b = new Brush(bare(gB));
    a.updateMatrixWorld(); b.updateMatrixWorld();
    const res = csgEval.evaluate(a, b, INTERSECTION);
    const pos = res.geometry.attributes.position, idx = res.geometry.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), w = new THREE.Vector3();
    let vol = 0;
    for (let t = 0; t < n; t++) {
      p.fromBufferAttribute(pos, idx ? idx.getX(3 * t) : 3 * t);
      q.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 1) : 3 * t + 1);
      w.fromBufferAttribute(pos, idx ? idx.getX(3 * t + 2) : 3 * t + 2);
      vol += p.dot(q.cross(w)) / 6;
    }
    res.geometry.dispose(); a.geometry.dispose(); b.geometry.dispose();
    return Math.abs(vol);
  } catch (err) {
    console.warn('교집합 체적 계산 실패:', err);
    return null;
  }
}

export function createApi(deps) {
  const { state, history, redraw, importStepFromUrl, measure, setView, toast } = deps;

  const node = id => {
    const n = state.nodes.find(x => x.id === id);
    if (!n) throw new Error(`노드 없음: ${id}`);
    return n;
  };
  const nodeMap = () => new Map(state.nodes.map(n => [n.id, n]));

  // 화면에 그려진 메쉬가 있으면 그 지오메트리, 없으면(숨김/boolean 자식) 새로 평가
  function worldGeometry(id) {
    const mesh = getMeshForNode(id);
    if (mesh && mesh.position.lengthSq() === 0) return { geom: mesh.geometry, temp: false };
    const g = evaluateNode(node(id), nodeMap());
    if (!g) throw new Error(`형상을 계산할 수 없음: ${id} (STEP 파일이 로드되지 않았을 수 있음)`);
    return { geom: g, temp: true };
  }

  function boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const { geom, temp } = worldGeometry(id);
      geom.computeBoundingBox();
      box.union(geom.boundingBox);
      if (temp) geom.dispose();
    }
    return box;
  }

  const r3 = v => Math.round(v * 1000) / 1000;
  const boxJSON = b => b.isEmpty() ? null : {
    min: b.min.toArray().map(r3), max: b.max.toArray().map(r3),
    size: b.getSize(new THREE.Vector3()).toArray().map(r3),
    center: b.getCenter(new THREE.Vector3()).toArray().map(r3),
  };

  function summary(n) {
    const out = { id: n.id, type: n.type, name: n.name, visible: n.visible !== false, transform: n.transform };
    if (n.params) out.params = n.params;
    if (isBooleanNode(n)) Object.assign(out, { op: n.op, a: n.a, b: n.b });
    if (n.type === 'step') Object.assign(out, { source: n.source, path: n.path });
    try { out.bbox = boxJSON(boxOf([n.id])); } catch { out.bbox = null; }
    return out;
  }

  function newId() { return `n${state.nextId++}`; }

  const api = {
    help() { console.log(HELP); return HELP; },
    list() { return state.nodes.map(summary); },
    get(id) { return summary(node(id)); },

    add(type, params = {}, opts = {}) {
      if (!PRIMITIVE_FIELDS[type]) throw new Error(`알 수 없는 type: ${type}`);
      const id = newId();
      const n = {
        id, type,
        params: { ...defaultParams(type), ...params },
        transform: { pos: opts.pos || [0, 0, 0], rot: opts.rot || [0, 0, 0], scale: opts.scale || [1, 1, 1] },
        name: opts.name || `${type}_${state.nodes.length + 1}`,
        visible: true,
      };
      history.apply(cmdAddNode(n));
      return id;
    },

    boolean(op, a, b, name) {
      node(a); node(b);
      const id = newId();
      history.apply(cmdBoolean(op, a, b, id, o => name || `${o}_${state.nodes.length + 1}`));
      return id;
    },

    update(id, patch) {
      const n = node(id);
      const prev = JSON.parse(JSON.stringify(n));
      const next = JSON.parse(JSON.stringify(n));
      if (patch.params) next.params = { ...next.params, ...patch.params };
      if (patch.pos) next.transform.pos = [...patch.pos];
      if (patch.rot) next.transform.rot = [...patch.rot];
      if (patch.scale) next.transform.scale = [...patch.scale];
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.visible !== undefined) next.visible = patch.visible;
      history.apply({
        label: 'API update',
        do: s => { const i = s.nodes.findIndex(x => x.id === id); if (i >= 0) s.nodes[i] = JSON.parse(JSON.stringify(next)); },
        undo: s => { const i = s.nodes.findIndex(x => x.id === id); if (i >= 0) s.nodes[i] = JSON.parse(JSON.stringify(prev)); },
      });
      return summary(state.nodes.find(x => x.id === id));
    },

    move(ids, d) {
      ids = [].concat(ids);
      const updates = ids.map(id => {
        const t = node(id).transform;
        return { id, transform: { ...t, pos: t.pos.map((v, i) => v + (d[i] || 0)) } };
      });
      history.apply(cmdSetTransforms(updates, 'API move'));
    },

    // ids 전체 bbox 의 기준점(anchor)이 target 에 오도록 이동. anchor: 'center' | 'bottom'(바닥면 중심)
    moveTo(ids, target = [0, 0, 0], anchor = 'center') {
      ids = [].concat(ids);
      const b = boxOf(ids);
      const ref = b.getCenter(new THREE.Vector3());
      if (anchor === 'bottom') ref.z = b.min.z;
      api.move(ids, [target[0] - ref.x, target[1] - ref.y, target[2] - ref.z]);
    },

    // ids 전체를 pivot(기본: bbox 중심) 기준으로 세계 X→Y→Z 순서로 회전 (deg). 예: Y-up 모델 → Z-up 은 [90,0,0]
    rotate(ids, deg, pivot = null) {
      ids = [].concat(ids);
      const c = pivot ? new THREE.Vector3(...pivot) : boxOf(ids).getCenter(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...deg.map(THREE.MathUtils.degToRad), 'ZYX'));
      const D = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      history.apply(cmdSetTransforms(ids.map(id => ({ id, transform: composeDelta(D, node(id).transform) })), 'API rotate'));
    },

    remove(...ids) { for (const id of ids.flat()) history.apply(cmdDeleteNode(id)); },

    select(...ids) {
      state.selection = ids.flat().filter(id => state.nodes.some(n => n.id === id));
      redraw();
    },

    async importStep(url) { return importStepFromUrl(url); },

    bbox(...ids) {
      ids = ids.flat();
      if (!ids.length) ids = state.nodes.filter(n => n.visible !== false).map(n => n.id);
      return boxJSON(boxOf(ids));
    },

    // BVH 기반 두 노드 간 최소거리 + 간섭 여부 (메쉬 근사이므로 곡면은 분할 오차 포함)
    distance(a, b) {
      const A = worldGeometry(a), B = worldGeometry(b);
      try {
        const gA = distanceGeometry(A.geom), gB = distanceGeometry(B.geom);
        const r = meshDistance(gA, gB);
        let hit = gA.boundsTree.intersectsGeometry(gB, new THREE.Matrix4());
        // 표면이 닿기만 해도(면 접촉) 교차로 잡히므로, 겹친 체적을 CSG 로 구해 실제 간섭인지 가린다
        let overlapVolume = null;
        if (hit) {
          overlapVolume = intersectionVolume(gA, gB);
          if (overlapVolume !== null && overlapVolume < 1e-3) hit = false;
        }
        return {
          distance: r3(hit ? 0 : r.distance),
          intersects: hit,
          touching: !hit && r.distance < 1e-3,
          overlapVolume: overlapVolume === null ? null : r3(overlapVolume),
          pointA: r.pointA.toArray().map(r3), pointB: r.pointB.toArray().map(r3),
        };
      } finally {
        if (A.temp) A.geom.dispose();
        if (B.temp) B.geom.dispose();
      }
    },

    view(name = 'iso', ids) { setView(name, ids ? [].concat(ids) : null); },
    lastMeasure() { return measure.last || null; },

    undo() { return history.undo(); },
    redo() { return history.redo(); },
    newScene() { history.apply(cmdReplaceState({ nodes: [], nextId: 1, selection: [] })); },
    toJSON() { return serialize(state); },
    toast,
  };
  return api;
}
