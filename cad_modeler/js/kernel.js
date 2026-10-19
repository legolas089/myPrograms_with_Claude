// 도형 노드의 BufferGeometry 를 Three.js primitive로 만들고
// three-bvh-csg 로 boolean 연산을 수행하는 모델링 커널
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { getPart } from './stepstore.js';

const evaluator = new Evaluator();
evaluator.useGroups = false;
// 두 입력의 속성 구성이 같아야 한다 — STEP 메쉬에는 uv 가 없으므로 position/normal 만 쓴다
evaluator.attributes = ['position', 'normal'];

function csgReady(geom) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geom.attributes.position);
  if (geom.attributes.normal) g.setAttribute('normal', geom.attributes.normal);
  else g.computeVertexNormals();
  if (geom.index) g.setIndex(geom.index);
  return g;
}

const PRIMITIVE_DEFAULTS = {
  box:      { x: 20, y: 20, z: 20 },
  cylinder: { radius: 10, height: 20, segments: 48 },
  sphere:   { radius: 12, segments: 32 },
  cone:     { radius: 10, height: 20, segments: 48 },
  // points: XY 평면의 단순 다각형 [[x,y],...] (API 로 지정). z=0 에서 z=height 까지 돌출하며
  // 높이 전체에 걸쳐 Z축으로 twist(°) 만큼 회전 → twist≠0 이면 헬리컬 스윕 (twist = height/pitch·360)
  extrude:  { points: [[-10, -10], [10, -10], [10, 10], [-10, 10]], height: 20, twist: 0, slices: 1 },
  // points: (r, z) 반단면 다각형 [[r,z],...] (r ≥ 0). Z축을 중심으로 angle(°) 만큼 회전 — 모따기·홈·단차 있는 축 등
  revolve:  { points: [[0, 0], [10, 0], [10, 20], [0, 20]], angle: 360, segments: 96 },
};

export const PRIMITIVE_FIELDS = {
  box: [
    { key: 'x', label: 'X 길이', step: 1, min: 0.1 },
    { key: 'y', label: 'Y 길이', step: 1, min: 0.1 },
    { key: 'z', label: 'Z 길이', step: 1, min: 0.1 },
  ],
  cylinder: [
    { key: 'radius',   label: '반지름', step: 0.5, min: 0.1 },
    { key: 'height',   label: '높이',   step: 0.5, min: 0.1 },
    { key: 'segments', label: '분할수', step: 1, min: 6, integer: true },
  ],
  sphere: [
    { key: 'radius',   label: '반지름', step: 0.5, min: 0.1 },
    { key: 'segments', label: '분할수', step: 1, min: 6, integer: true },
  ],
  cone: [
    { key: 'radius',   label: '밑면반지름', step: 0.5, min: 0.1 },
    { key: 'height',   label: '높이',       step: 0.5, min: 0.1 },
    { key: 'segments', label: '분할수',     step: 1, min: 6, integer: true },
  ],
  revolve: [
    { key: 'angle',    label: '회전각°', step: 15, min: 1 },
    { key: 'segments', label: '분할수',  step: 1, min: 6, integer: true },
  ],
  extrude: [
    { key: 'height', label: '높이',     step: 0.5, min: 0.1 },
    { key: 'twist',  label: '비틀림°',  step: 5 },
    { key: 'slices', label: '층수',     step: 1, min: 1, integer: true },
  ],
};

// 패턴 노드의 패널 필드 (primitive 가 아니라 PRIMITIVE_FIELDS 에 넣지 않는다)
export const PATTERN_FIELDS = [
  { key: 'count', label: '개수',    step: 1, min: 1, integer: true },
  { key: 'angle', label: '전체각°', step: 15, min: 1 },
];

export function defaultParams(type) {
  return JSON.parse(JSON.stringify(PRIMITIVE_DEFAULTS[type]));
}

// 다각형 돌출 (+twist). 옆면은 프로파일 변마다 정점을 따로 두어 모서리는 각지고
// 비틀림 방향으로는 부드럽게 보이게 하고, 위·아래 캡은 삼각분할로 닫는다 (CSG 입력용 닫힌 메쉬).
const TWIST_MAX_STEP = 2;    // ° — 한 층의 최대 회전 (slices 가 모자라면 늘린다)
const TWIST_TOL = 0.05;      // mm — 비틀린 옆면을 삼각형으로 근사할 때 허용 오차 (더 작게 하면 STEP 이 커져 다시 불러오기가 매우 느려진다)

function buildExtrudeGeometry({ points, height, twist = 0, slices = 1 }) {
  if (!(height > 0)) throw new Error('extrude: 높이는 0보다 커야 합니다');
  const pts = [];
  for (const [x, y] of points) {
    const p = new THREE.Vector2(x, y);
    if (!pts.length || p.distanceTo(pts[pts.length - 1]) > 1e-9) pts.push(p);
  }
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) <= 1e-9) pts.pop();
  if (pts.length < 3) throw new Error('extrude: 점이 3개 이상 필요합니다');
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const n = pts.length;
  const layers = Math.max(1, Math.round(slices), Math.ceil(Math.abs(twist) / TWIST_MAX_STEP));
  const tw = THREE.MathUtils.degToRad(twist);
  const step = Math.abs(tw) / layers;

  // 비틀린 옆면은 쌍곡포물면이라 칸 하나를 삼각형 둘로 나누면 가운데가 (층 회전각 × 칸 폭 / 4) 만큼
  // 한쪽으로 쏠려 얇은 판의 두께가 틀어진다. 칸 가운데에 실제 곡면 위의 점을 넣어 삼각형 넷으로 나누면
  // 오차가 (회전각 × 칸 폭 / 16) 로 줄고 방향도 번갈아 부피 오차가 상쇄된다. 변은 그 오차가 TWIST_TOL 안이 되게 나눈다
  const ring = []; // 캡 둘레 (나눈 점 포함)
  const edges = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const m = step > 0 ? Math.max(1, Math.ceil(step * p.distanceTo(q) / (16 * TWIST_TOL))) : 1;
    const e = [];
    for (let j = 0; j <= m; j++) e.push(new THREE.Vector2().lerpVectors(p, q, j / m));
    edges.push(e);
    ring.push(...e.slice(0, m));
  }

  const pos = [];
  const index = [];
  const vert = (p, k) => {
    const a = tw * k / layers, c = Math.cos(a), s = Math.sin(a);
    pos.push(p.x * c - p.y * s, p.x * s + p.y * c, height * k / layers);
    return pos.length / 3 - 1;
  };

  // 옆면: 변마다 (layers+1)×(m+1) 정점 격자. 비틀림이 없으면 칸이 평면이라 삼각형 둘로 충분하다
  for (const e of edges) {
    const w = e.length, base = pos.length / 3;
    for (let k = 0; k <= layers; k++) for (const p of e) vert(p, k);
    for (let k = 0; k < layers; k++) for (let j = 0; j < w - 1; j++) {
      const a = base + k * w + j, b = a + 1, d = a + w, c = d + 1;
      if (step === 0) { index.push(a, b, c, a, c, d); continue; }
      const o = vert(new THREE.Vector2().lerpVectors(e[j], e[j + 1], 0.5), k + 0.5);
      index.push(a, b, o, b, c, o, c, d, o, d, a, o);
    }
  }

  // 캡: 아래(-Z 향함)는 뒤집고, 위(+Z 향함)는 그대로
  const tris = THREE.ShapeUtils.triangulateShape(ring, []);
  const bottom = ring.map(p => vert(p, 0));
  const top = ring.map(p => vert(p, layers));
  for (const [a, b, c] of tris) {
    index.push(bottom[a], bottom[c], bottom[b]);
    index.push(top[a], top[b], top[c]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}

// (r, z) 반단면을 Z축 둘레로 회전. 360° 가 아니면 양 끝을 단면으로 막는다. 닫힌 메쉬가 되도록 방향을 맞춘다
function buildRevolveGeometry({ points, angle = 360, segments = 96 }) {
  const pts = [];
  for (const [r, z] of points) {
    if (!(r >= -1e-9)) throw new Error('revolve: 반지름(r)은 0 이상이어야 합니다');
    const p = new THREE.Vector2(Math.max(0, r), z);
    if (!pts.length || p.distanceTo(pts[pts.length - 1]) > 1e-9) pts.push(p);
  }
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) <= 1e-9) pts.pop();
  if (pts.length < 3) throw new Error('revolve: 점이 3개 이상 필요합니다');
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const full = angle >= 360 - 1e-9;
  const total = THREE.MathUtils.degToRad(Math.min(angle, 360));
  const steps = Math.max(3, Math.round(segments * Math.min(angle, 360) / 360));
  const n = pts.length;
  const pos = [], index = [];
  const vert = (p, k) => {
    const a = total * k / steps;
    pos.push(p.x * Math.cos(a), p.x * Math.sin(a), p.y);
    return pos.length / 3 - 1;
  };
  // 옆면: 단면 변마다 (steps+1) × 2 정점 띠. 축(r=0) 위의 점에서는 삼각형 하나만 만든다
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if (p.x < 1e-9 && q.x < 1e-9) continue; // 축 위의 변은 면이 없다
    const base = pos.length / 3;
    for (let k = 0; k <= steps; k++) { vert(p, k); vert(q, k); }
    for (let k = 0; k < steps; k++) {
      const a = base + 2 * k, b = a + 1, d = a + 2, c = a + 3;
      if (q.x > 1e-9) index.push(a, c, b);
      if (p.x > 1e-9) index.push(a, d, c);
    }
  }
  if (!full) {
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const start = pts.map(p => vert(p, 0)), end = pts.map(p => vert(p, steps));
    for (const [a, b, c] of tris) { index.push(start[a], start[b], start[c]); index.push(end[a], end[c], end[b]); }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 부피가 음수면 안팎이 뒤집힌 것 → 삼각형 방향을 모두 뒤집는다
  let vol = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map(i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (vol < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}

export function buildPrimitiveGeometry(type, params) {
  let geom;
  switch (type) {
    case 'box':
      geom = new THREE.BoxGeometry(params.x, params.y, params.z);
      break;
    case 'cylinder':
      geom = new THREE.CylinderGeometry(
        params.radius, params.radius, params.height, params.segments
      );
      // Three.js cylinder is along Y; rotate to Z-up convention
      geom.rotateX(Math.PI / 2);
      break;
    case 'sphere':
      geom = new THREE.SphereGeometry(params.radius, params.segments, params.segments);
      break;
    case 'cone':
      geom = new THREE.ConeGeometry(params.radius, params.height, params.segments);
      geom.rotateX(Math.PI / 2);
      break;
    case 'extrude':
      geom = buildExtrudeGeometry(params);
      break;
    case 'revolve':
      geom = buildRevolveGeometry(params);
      break;
    default:
      throw new Error(`Unknown primitive type: ${type}`);
  }
  return geom;
}

export function applyTransformToGeometry(geometry, transform) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(transform.rot[0]),
      THREE.MathUtils.degToRad(transform.rot[1]),
      THREE.MathUtils.degToRad(transform.rot[2]),
      'XYZ'
    )
  );
  m.compose(
    new THREE.Vector3(...transform.pos),
    q,
    new THREE.Vector3(...transform.scale)
  );
  const out = geometry.clone();
  out.applyMatrix4(m);
  return out;
}

// ── 노드 입력 · 내용 키 ──
// Boolean 은 a/b, 패턴은 src 를 입력으로 쓴다. 입력으로 쓰인 노드는 화면에서 따로 그리지 않는다
export function nodeInputs(node) {
  if (!node) return [];
  if (node.type === 'boolean') return [node.a, node.b];
  if (node.type === 'pattern') return [node.src];
  return [];
}

// 노드(와 입력 트리)의 형상을 결정하는 내용만으로 만든 키 — 같으면 형상도 같다
export function nodeKey(node, nodeMap, memo = new Map()) {
  if (!node) return 'missing';
  if (memo.has(node.id)) return memo.get(node.id);
  const own = { type: node.type, op: node.op, params: node.params, transform: node.transform, source: node.source, mesh: node.mesh, merged: node.merged };
  if (node.type === 'step') own.loaded = !!getPart(node.source, node.mesh, node.merged);
  let key = JSON.stringify(own);
  const inputs = nodeInputs(node);
  if (inputs.length) key += `(${inputs.map(id => nodeKey(nodeMap.get(id), nodeMap, memo)).join('|')})`;
  memo.set(node.id, key);
  return key;
}

// ── 평가 캐시 ──
// 같은 키의 결과를 다시 계산하지 않는다. 화면·형상 검사·내보내기가 함께 쓰므로 파라미터 하나를 바꾸면
// 그 노드와 위쪽(조상) 노드만 다시 계산된다. 꺼낼 때는 복제본을 주므로 받은 쪽이 dispose/변형해도 된다
const EVAL_CACHE_BYTES = 384 * 1024 * 1024;
const evalCache = new Map(); // key → { geom, bytes }
let evalBytes = 0;
const evalStats = { hits: 0, misses: 0 };
function geomBytes(g) {
  let b = 0;
  for (const a of Object.values(g.attributes)) b += a.array.byteLength;
  if (g.index) b += g.index.array.byteLength;
  return b;
}
function cacheGet(key) {
  const e = evalCache.get(key);
  if (!e) return null;
  evalCache.delete(key); evalCache.set(key, e); // 최근 사용으로
  return e.geom;
}
function cachePut(key, geom) {
  const bytes = geomBytes(geom);
  if (bytes > EVAL_CACHE_BYTES / 4) return;
  evalCache.set(key, { geom, bytes });
  evalBytes += bytes;
  for (const [k, e] of evalCache) {
    if (evalBytes <= EVAL_CACHE_BYTES) break;
    evalCache.delete(k); evalBytes -= e.bytes; e.geom.dispose();
  }
}
export function evalCacheStats() { return { ...evalStats, entries: evalCache.size, mb: Math.round(evalBytes / 1048576 * 10) / 10 }; }
export function clearEvalCache() { for (const e of evalCache.values()) e.geom.dispose(); evalCache.clear(); evalBytes = 0; }

function csgOp(a, b, op) {
  const brushA = new Brush(csgReady(a));
  brushA.updateMatrixWorld();
  const brushB = new Brush(csgReady(b));
  brushB.updateMatrixWorld();
  return evaluator.evaluate(brushA, brushB, op).geometry.clone();
}

function withTransform(geom, transform) {
  if (!transform || isIdentityTransform(transform)) return geom;
  const next = applyTransformToGeometry(geom, transform);
  geom.dispose();
  return next;
}

// node가 primitive면 build, boolean·pattern이면 입력을 재귀적으로 평가하여 BufferGeometry 반환 (호출자 소유의 새 객체)
export function evaluateNode(node, nodeMap, memo = new Map()) {
  if (!node) return null; // 입력이 사라진 Boolean (예전 장면)
  const key = nodeKey(node, nodeMap, memo);
  const hit = cacheGet(key);
  if (hit) { evalStats.hits++; return hit.clone(); }
  evalStats.misses++;
  const geom = evaluateUncached(node, nodeMap, memo);
  if (geom) cachePut(key, geom.clone());
  return geom;
}

function evaluateUncached(node, nodeMap, memo) {
  if (node.type === 'boolean') {
    const a = evaluateNode(nodeMap.get(node.a), nodeMap, memo);
    const b = evaluateNode(nodeMap.get(node.b), nodeMap, memo);
    if (!a || !b) return null;
    const opMap = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };
    const op = opMap[node.op];
    if (op === undefined) throw new Error(`Unknown boolean op: ${node.op}`);
    const geom = csgOp(a, b, op);
    a.dispose();
    b.dispose();
    return withTransform(geom, node.transform);
  }
  if (node.type === 'pattern') {
    // 원형 패턴: src 를 Z축 둘레로 count 개 (angle 이 360 이면 등분, 아니면 처음과 끝 포함). 복사본끼리는 CSG 합집합
    const src = evaluateNode(nodeMap.get(node.src), nodeMap, memo);
    if (!src) return null;
    const count = Math.max(1, Math.round(node.params?.count ?? 1));
    const angle = node.params?.angle ?? 360;
    const stepDeg = angle >= 360 - 1e-9 ? 360 / count : (count > 1 ? angle / (count - 1) : 0);
    let acc = src.clone();
    for (let i = 1; i < count; i++) {
      const copy = src.clone();
      copy.applyMatrix4(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(stepDeg * i)));
      const next = csgOp(acc, copy, ADDITION);
      acc.dispose(); copy.dispose();
      acc = next;
    }
    src.dispose();
    return withTransform(acc, node.transform);
  }
  if (node.type === 'step') {
    // STEP 참조 파트: 원본 메쉬가 아직 로드되지 않았으면 null
    const part = getPart(node.source, node.mesh, node.merged);
    if (!part) return null;
    return applyTransformToGeometry(part.geometry, node.transform);
  }
  // primitive
  const geom = buildPrimitiveGeometry(node.type, node.params);
  return applyTransformToGeometry(geom, node.transform);
}

export function isBooleanNode(node) { return node.type === 'boolean'; }
export function isPatternNode(node) { return node.type === 'pattern'; }
export function isStepNode(node) { return node.type === 'step'; }
export function isPrimitiveNode(node) { return PRIMITIVE_FIELDS[node.type] !== undefined; }

export function identityTransform() {
  return { pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] };
}

function isIdentityTransform(t) {
  return t.pos[0]===0 && t.pos[1]===0 && t.pos[2]===0
      && t.rot[0]===0 && t.rot[1]===0 && t.rot[2]===0
      && t.scale[0]===1 && t.scale[1]===1 && t.scale[2]===1;
}
