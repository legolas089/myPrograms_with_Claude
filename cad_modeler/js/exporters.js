// STL: Three.js STLExporter / STEP: Faceted BREP AP214 writer
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { evaluateNode, isBooleanNode } from './kernel.js';
import { triggerDownload } from './persistence.js';

// 출력 대상 결정: boolean 노드 + 어디에도 소비되지 않은 primitive 노드
function topLevelNodes(state) {
  const consumed = new Set();
  for (const n of state.nodes) {
    if (isBooleanNode(n)) { consumed.add(n.a); consumed.add(n.b); }
  }
  return state.nodes.filter(n => !consumed.has(n.id) && n.visible !== false);
}

export function exportSTL(state, filename) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
  const group = new THREE.Group();
  for (const node of topLevelNodes(state)) {
    const geom = evaluateNode(node, nodeMap);
    if (!geom) continue;
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    group.add(mesh);
  }
  const exporter = new STLExporter();
  const ascii = exporter.parse(group, { binary: false });
  const blob = new Blob([ascii], { type: 'model/stl' });
  triggerDownload(blob, filename || 'scene.stl');
  // dispose
  group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
}

// --- STEP AP214 Faceted BREP writer ---

class StepBuilder {
  constructor() {
    this.entries = [];
    this.id = 0;
  }
  add(line) { // returns the id assigned
    this.id += 1;
    this.entries.push(`#${this.id}=${line};`);
    return this.id;
  }
  // 세 vertex 의 좌표로 평면 normal 을 계산해 face 추가
  addTriangle(v0, v1, v2) {
    const p0 = this.add(`CARTESIAN_POINT('',(${fmt(v0[0])},${fmt(v0[1])},${fmt(v0[2])}))`);
    const p1 = this.add(`CARTESIAN_POINT('',(${fmt(v1[0])},${fmt(v1[1])},${fmt(v1[2])}))`);
    const p2 = this.add(`CARTESIAN_POINT('',(${fmt(v2[0])},${fmt(v2[1])},${fmt(v2[2])}))`);
    // normal = (v1-v0) x (v2-v0)
    const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
    const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
    let nx = ay*bz - az*by;
    let ny = az*bx - ax*bz;
    let nz = ax*by - ay*bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // ref direction perpendicular to normal
    let rx = bx, ry = by, rz = bz;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;

    const origin = p0; // reuse v0
    const dirN = this.add(`DIRECTION('',(${fmt(nx)},${fmt(ny)},${fmt(nz)}))`);
    const dirR = this.add(`DIRECTION('',(${fmt(rx)},${fmt(ry)},${fmt(rz)}))`);
    const axis = this.add(`AXIS2_PLACEMENT_3D('',#${origin},#${dirN},#${dirR})`);
    const plane = this.add(`PLANE('',#${axis})`);
    const loop = this.add(`POLY_LOOP('',(#${p0},#${p1},#${p2}))`);
    const fb = this.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    const af = this.add(`ADVANCED_FACE('',(#${fb}),#${plane},.T.)`);
    return af;
  }
  build(headerName) {
    const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Simple CAD Modeler faceted brep'),'2;1');
FILE_NAME('${headerName || 'scene.step'}','${new Date().toISOString()}',(''),(''),'Simple CAD Modeler','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;`;
    const footer = `ENDSEC;
END-ISO-10303-21;
`;
    return [header, ...this.entries, footer].join('\n');
  }
}

function fmt(n) {
  if (!Number.isFinite(n)) return '0.';
  // STEP requires floats with a decimal point and no trailing whitespace
  let s = n.toFixed(6);
  // trim trailing zeros but keep at least one digit after the dot
  s = s.replace(/0+$/,'').replace(/\.$/, '.0');
  return s;
}

export function exportSTEP(state, filename) {
  const sb = new StepBuilder();
  // Common app context entries
  const ctx = sb.add(`APPLICATION_CONTEXT('automotive design')`);
  sb.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctx})`);
  const prodCtx = sb.add(`PRODUCT_CONTEXT('',#${ctx},'mechanical')`);
  const prod = sb.add(`PRODUCT('Scene','Scene','',(#${prodCtx}))`);
  const prodFormation = sb.add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const designCtx = sb.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ctx},'design')`);
  const prodDef = sb.add(`PRODUCT_DEFINITION('design','',#${prodFormation},#${designCtx})`);
  const prodDefShape = sb.add(`PRODUCT_DEFINITION_SHAPE('','',#${prodDef})`);

  // Units
  const lenUnit = sb.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angUnit = sb.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solidUnit = sb.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const uncertainty = sb.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#${lenUnit},'distance_accuracy_value','')`);
  const geomCtx = sb.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${angUnit},#${solidUnit}))REPRESENTATION_CONTEXT('Context','3D'))`);

  // Origin axis placement (referenced by shape repr)
  const o0 = sb.add(`CARTESIAN_POINT('',(0.0,0.0,0.0))`);
  const dz = sb.add(`DIRECTION('',(0.0,0.0,1.0))`);
  const dx = sb.add(`DIRECTION('',(1.0,0.0,0.0))`);
  const originAxis = sb.add(`AXIS2_PLACEMENT_3D('',#${o0},#${dz},#${dx})`);

  // 각 top-level node 마다 manifold solid brep 생성
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
  const breps = [];
  let triangleCount = 0;
  for (const node of topLevelNodes(state)) {
    const geom = evaluateNode(node, nodeMap);
    if (!geom) continue;
    const faceIds = [];
    const pos = geom.attributes.position;
    const idx = geom.index;
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.array[i], b = idx.array[i+1], c = idx.array[i+2];
        const v0 = [pos.getX(a), pos.getY(a), pos.getZ(a)];
        const v1 = [pos.getX(b), pos.getY(b), pos.getZ(b)];
        const v2 = [pos.getX(c), pos.getY(c), pos.getZ(c)];
        if (degenerate(v0, v1, v2)) continue;
        faceIds.push(sb.addTriangle(v0, v1, v2));
        triangleCount++;
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const v0 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const v1 = [pos.getX(i+1), pos.getY(i+1), pos.getZ(i+1)];
        const v2 = [pos.getX(i+2), pos.getY(i+2), pos.getZ(i+2)];
        if (degenerate(v0, v1, v2)) continue;
        faceIds.push(sb.addTriangle(v0, v1, v2));
        triangleCount++;
      }
    }
    if (faceIds.length === 0) continue;
    const shell = sb.add(`CLOSED_SHELL('',(${faceIds.map(f => '#'+f).join(',')}))`);
    const brep = sb.add(`MANIFOLD_SOLID_BREP('${(node.name || node.type).replace(/'/g,'')}',#${shell})`);
    breps.push(brep);
    geom.dispose();
  }

  if (breps.length === 0) {
    throw new Error('내보낼 도형이 없습니다');
  }

  const items = [`#${originAxis}`, ...breps.map(b => '#'+b)].join(',');
  const repr = sb.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('Scene',(${items}),#${geomCtx})`);
  sb.add(`SHAPE_DEFINITION_REPRESENTATION(#${prodDefShape},#${repr})`);

  const text = sb.build(filename);
  const blob = new Blob([text], { type: 'application/step' });
  triggerDownload(blob, filename || 'scene.step');
  return { triangleCount, breps: breps.length };
}

function degenerate(v0, v1, v2) {
  const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
  const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
  const nx = ay*bz - az*by;
  const ny = az*bx - ax*bz;
  const nz = ax*by - ay*bx;
  return Math.hypot(nx, ny, nz) < 1e-9;
}
