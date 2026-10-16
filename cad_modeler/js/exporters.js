// STL: Three.js STLExporter / STEP: stepwriter.js (faceted B-rep, 파트 .stp · 어셈블리 .step)
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { evaluateNode, isBooleanNode } from './kernel.js';
import { triggerDownload } from './persistence.js';
import { meshToFaces, writeStep } from './stepwriter.js';

export function safeFileName(s) {
  return String(s || 'model').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'model';
}

// 내보낼 노드 (STL·STEP 공통 규칙)
//  - 선택이 있으면 선택한 것 그대로 (숨김·Boolean 입력이어도). 단, 선택한 Boolean 에 이미 들어 있는 입력은 빼서 중복을 막는다
//  - 선택이 없으면 화면에 보이는 최상위 노드 전체 (includeStep=false 면 STEP 참조 모델 제외)
export function exportNodes(state, { includeStep }) {
  const byId = new Map(state.nodes.map(n => [n.id, n]));
  const sel = state.selection.map(id => byId.get(id)).filter(Boolean);
  if (sel.length) {
    const inside = new Set();
    const walk = n => {
      if (!isBooleanNode(n)) return;
      for (const c of [n.a, n.b]) { inside.add(c); const cn = byId.get(c); if (cn) walk(cn); }
    };
    sel.forEach(walk);
    return sel.filter(n => !inside.has(n.id));
  }
  const consumed = new Set();
  for (const n of state.nodes) if (isBooleanNode(n)) { consumed.add(n.a); consumed.add(n.b); }
  return state.nodes.filter(n => !consumed.has(n.id) && n.visible !== false && (includeStep || n.type !== 'step'));
}

// STEP 내보내기 대상:
//  - 선택 1개 → 그 파트 하나를 <이름>.stp
//  - 선택 여러 개 → 선택한 것들을 구성품으로 한 어셈블리 selection.step
//  - 선택 없음 → 화면에 보이는 전체(STEP 참조 모델 포함)를 어셈블리 assembly.step
export function stepExportPlan(state) {
  const nodes = exportNodes(state, { includeStep: true });
  if (state.selection.length && nodes.length === 1) return { nodes, assembly: false, fileName: `${safeFileName(nodes[0].name || nodes[0].type)}.stp` };
  return { nodes, assembly: true, fileName: state.selection.length ? 'selection.step' : 'assembly.step' };
}

export function buildStepText(state, plan = stepExportPlan(state)) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
  const components = [];
  const stats = { triangles: 0, faces: 0, repaired: 0, fallbackRegions: 0, open: 0 };
  for (const node of plan.nodes) {
    const geom = evaluateNode(node, nodeMap);
    if (!geom) continue;
    const body = meshToFaces(geom);
    geom.dispose();
    if (!body.faces.length) continue;
    for (const k of Object.keys(stats)) stats[k] += body.stats[k];
    components.push({ name: node.name || node.type, body });
  }
  if (!components.length) throw new Error('내보낼 도형이 없습니다');
  const text = writeStep({ fileName: plan.fileName, rootName: plan.fileName.replace(/\.[^.]+$/, ''), components, assembly: plan.assembly });
  return { text, components: components.length, ...stats };
}

export function exportSTEP(state, plan = stepExportPlan(state)) {
  const r = buildStepText(state, plan);
  triggerDownload(new Blob([r.text], { type: 'application/step' }), plan.fileName);
  return { ...r, fileName: plan.fileName, text: undefined };
}

export function exportSTL(state, filename) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
  const nodes = exportNodes(state, { includeStep: false });
  const group = new THREE.Group();
  for (const node of nodes) {
    const geom = evaluateNode(node, nodeMap);
    if (!geom) continue;
    group.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial()));
  }
  if (!group.children.length) throw new Error('내보낼 도형이 없습니다');
  const ascii = new STLExporter().parse(group, { binary: false });
  const blob = new Blob([ascii], { type: 'model/stl' });
  const name = filename || (state.selection.length && nodes.length === 1 ? `${safeFileName(nodes[0].name || nodes[0].type)}.stl` : 'scene.stl');
  triggerDownload(blob, name);
  group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return name;
}

