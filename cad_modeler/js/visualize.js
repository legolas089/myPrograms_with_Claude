// 평가된 BufferGeometry 들을 씬에 반영하고 선택 하이라이트 관리
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { evaluateNode, isBooleanNode, isStepNode } from './kernel.js';
import { getPart } from './stepstore.js';

// 큰 STEP 메쉬의 레이캐스트/거리계산을 BVH 로 가속
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const NORMAL_COLOR = 0x4ec9b0;
const SELECTED_COLOR = 0xffa500;
const BOOL_COLOR = 0x6699ff;
const STEP_COLOR = 0xb4b4b4;

const meshGroup = new THREE.Group();
meshGroup.name = '__cad_meshes__';

const nodeMeshMap = new Map(); // nodeId -> THREE.Mesh
let stepOpacity = 1;

export function attachMeshGroup(scene) {
  if (!scene.getObjectByName('__cad_meshes__')) {
    scene.add(meshGroup);
  }
}

// 노드(와 boolean 자식 트리)의 내용이 같으면 같은 키 → 메쉬 재사용
function nodeKey(node, nodeMap) {
  const { name, visible, _prevName, _prevT, _prevParams, ...rest } = node;
  if (isBooleanNode(node)) {
    const a = nodeMap.get(node.a), b = nodeMap.get(node.b);
    return JSON.stringify([rest, a && nodeKey(a, nodeMap), b && nodeKey(b, nodeMap)]);
  }
  if (isStepNode(node)) {
    return JSON.stringify([rest, !!getPart(node.source, node.mesh)]);
  }
  return JSON.stringify(rest);
}

function disposeMesh(m) {
  meshGroup.remove(m);
  m.geometry?.disposeBoundsTree?.();
  m.geometry?.dispose();
  m.material?.dispose();
}

// 모든 노드를 다시 평가하여 씬을 갱신.
// boolean 노드의 자식은 결과에만 포함되고 개별 렌더링되지 않는다.
export function rebuildScene(state) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));

  // boolean에 의해 "소비된" 노드 ID 모음
  const consumed = new Set();
  for (const n of state.nodes) {
    if (isBooleanNode(n)) {
      consumed.add(n.a);
      consumed.add(n.b);
    }
  }

  const keep = new Set();
  for (const node of state.nodes) {
    if (consumed.has(node.id)) continue;
    if (node.visible === false) continue;
    const key = nodeKey(node, nodeMap);
    const existing = nodeMeshMap.get(node.id);
    if (existing && existing.userData.key === key) {
      keep.add(node.id);
      continue;
    }
    if (existing) { disposeMesh(existing); nodeMeshMap.delete(node.id); }

    let geom;
    try {
      geom = evaluateNode(node, nodeMap);
    } catch (err) {
      console.error(`Failed to evaluate node ${node.id}:`, err);
      continue;
    }
    if (!geom) continue;

    const step = isStepNode(node);
    if (!step) geom.computeVertexNormals();
    const triCount = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
    // indirect: 삼각형 순서를 바꾸지 않는다 (STEP B-rep 면 범위가 삼각형 인덱스에 묶여 있음)
    if (triCount > 2000) geom.computeBoundsTree({ indirect: true });

    let color = NORMAL_COLOR;
    if (isBooleanNode(node)) color = BOOL_COLOR;
    if (step) color = getPart(node.source, node.mesh)?.color ?? STEP_COLOR;
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.1,
      roughness: 0.6,
      side: step ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.nodeId = node.id;
    mesh.userData.key = key;
    mesh.userData.baseColor = color;
    mesh.userData.isStep = step;
    if (step) mesh.userData.brepFaces = getPart(node.source, node.mesh)?.brepFaces || [];
    applyOpacity(mesh);
    meshGroup.add(mesh);
    nodeMeshMap.set(node.id, mesh);
    keep.add(node.id);
  }

  for (const [id, m] of [...nodeMeshMap.entries()]) {
    if (!keep.has(id)) { disposeMesh(m); nodeMeshMap.delete(id); }
  }
}

function applyOpacity(mesh) {
  if (!mesh.userData.isStep) return;
  const t = stepOpacity < 1;
  mesh.material.transparent = t;
  mesh.material.opacity = stepOpacity;
  mesh.material.depthWrite = !t;
  mesh.renderOrder = t ? 1 : 0;
  mesh.material.needsUpdate = true;
}

// STEP 참조 모델의 투명도 (1 = 불투명)
export function setStepOpacity(v) {
  stepOpacity = v;
  for (const m of nodeMeshMap.values()) applyOpacity(m);
}

export function getMeshForNode(nodeId) {
  return nodeMeshMap.get(nodeId);
}

export function highlightSelection(selectedIds) {
  for (const [id, mesh] of nodeMeshMap.entries()) {
    const isSel = selectedIds.includes(id);
    mesh.material.color.setHex(isSel ? SELECTED_COLOR : mesh.userData.baseColor);
    mesh.material.emissive?.setHex(isSel ? 0x553300 : 0x000000);
  }
}

// 카메라가 모든 도형을 담도록 프레이밍
export function frameAll(camera, controls) {
  const box = new THREE.Box3();
  let any = false;
  meshGroup.traverse(obj => {
    if (obj.isMesh) { box.expandByObject(obj); any = true; }
  });
  if (!any) return;
  frameBox(camera, controls, box);
}

// 지정한 방향(카메라 → 대상 방향의 반대)에서 bbox 를 프레이밍
export function frameBox(camera, controls, box, dir = new THREE.Vector3(0.7, 0.7, 0.6)) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = camera.fov * (Math.PI / 180);
  const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.7;
  const n = dir.clone().normalize();
  // 정확히 위/아래에서 보면 OrbitControls(Z-up)가 뒤집히므로 살짝 기울인다
  if (Math.abs(n.z) > 0.999) n.set(0, -0.002, Math.sign(n.z)).normalize();
  camera.position.copy(center).addScaledVector(n, distance);
  controls.target.copy(center);
  camera.near = Math.max(0.01, distance * 0.001);
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  controls.update();
}

export function getSceneBox() {
  const box = new THREE.Box3();
  meshGroup.traverse(obj => { if (obj.isMesh) box.expandByObject(obj); });
  return box;
}

export function getMeshGroup() { return meshGroup; }

export function pickMeshAt(camera, raycaster, ndc) {
  raycaster.setFromCamera(ndc, camera);
  raycaster.firstHitOnly = true;
  const hits = raycaster.intersectObjects(meshGroup.children, false);
  return hits.length > 0 ? hits[0] : null;
}
