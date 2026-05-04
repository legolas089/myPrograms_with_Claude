// 도형 노드의 BufferGeometry 를 Three.js primitive로 만들고
// three-bvh-csg 로 boolean 연산을 수행하는 모델링 커널
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

const evaluator = new Evaluator();
evaluator.useGroups = false;

const PRIMITIVE_DEFAULTS = {
  box:      { x: 20, y: 20, z: 20 },
  cylinder: { radius: 10, height: 20, segments: 48 },
  sphere:   { radius: 12, segments: 32 },
  cone:     { radius: 10, height: 20, segments: 48 },
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
};

export function defaultParams(type) {
  return { ...PRIMITIVE_DEFAULTS[type] };
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

// node가 primitive면 build, boolean이면 재귀적으로 평가하여 BufferGeometry 반환
export function evaluateNode(node, nodeMap) {
  if (node.type === 'boolean') {
    const a = evaluateNode(nodeMap.get(node.a), nodeMap);
    const b = evaluateNode(nodeMap.get(node.b), nodeMap);
    if (!a || !b) return null;
    const opMap = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };
    const op = opMap[node.op];
    if (op === undefined) throw new Error(`Unknown boolean op: ${node.op}`);

    const brushA = new Brush(a);
    brushA.updateMatrixWorld();
    const brushB = new Brush(b);
    brushB.updateMatrixWorld();
    const result = evaluator.evaluate(brushA, brushB, op);
    let geom = result.geometry.clone();
    a.dispose();
    b.dispose();
    if (node.transform && !isIdentityTransform(node.transform)) {
      const next = applyTransformToGeometry(geom, node.transform);
      geom.dispose();
      geom = next;
    }
    return geom;
  }
  // primitive
  const geom = buildPrimitiveGeometry(node.type, node.params);
  return applyTransformToGeometry(geom, node.transform);
}

export function isBooleanNode(node) { return node.type === 'boolean'; }
export function isPrimitiveNode(node) { return PRIMITIVE_FIELDS[node.type] !== undefined; }

export function identityTransform() {
  return { pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] };
}

function isIdentityTransform(t) {
  return t.pos[0]===0 && t.pos[1]===0 && t.pos[2]===0
      && t.rot[0]===0 && t.rot[1]===0 && t.rot[2]===0
      && t.scale[0]===1 && t.scale[1]===1 && t.scale[2]===1;
}
