// 평가된 BufferGeometry 들을 씬에 반영하고 선택 하이라이트 관리
import * as THREE from 'three';
import { evaluateNode, isBooleanNode } from './kernel.js';

const NORMAL_COLOR = 0x4ec9b0;
const SELECTED_COLOR = 0xffa500;
const BOOL_COLOR = 0x6699ff;

const meshGroup = new THREE.Group();
meshGroup.name = '__cad_meshes__';

const nodeMeshMap = new Map(); // nodeId -> THREE.Mesh

export function attachMeshGroup(scene) {
  if (!scene.getObjectByName('__cad_meshes__')) {
    scene.add(meshGroup);
  }
}

// 모든 노드를 다시 평가하여 씬을 갱신.
// boolean 노드의 자식은 결과에만 포함되고 개별 렌더링되지 않는다.
export function rebuildScene(state) {
  // 정리
  for (const m of nodeMeshMap.values()) {
    meshGroup.remove(m);
    m.geometry?.dispose();
    m.material?.dispose();
  }
  nodeMeshMap.clear();

  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));

  // boolean에 의해 "소비된" 노드 ID 모음
  const consumed = new Set();
  for (const n of state.nodes) {
    if (isBooleanNode(n)) {
      consumed.add(n.a);
      consumed.add(n.b);
    }
  }

  for (const node of state.nodes) {
    if (consumed.has(node.id)) continue;
    if (!node.visible) continue;
    let geom;
    try {
      geom = evaluateNode(node, nodeMap);
    } catch (err) {
      console.error(`Failed to evaluate node ${node.id}:`, err);
      continue;
    }
    if (!geom) continue;
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: isBooleanNode(node) ? BOOL_COLOR : NORMAL_COLOR,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.nodeId = node.id;
    meshGroup.add(mesh);
    nodeMeshMap.set(node.id, mesh);
  }
}

export function getMeshForNode(nodeId) {
  return nodeMeshMap.get(nodeId);
}

export function highlightSelection(selectedIds) {
  for (const [id, mesh] of nodeMeshMap.entries()) {
    const isSel = selectedIds.includes(id);
    const baseColor = mesh.userData.baseColor ?? mesh.material.color.getHex();
    if (mesh.userData.baseColor === undefined) mesh.userData.baseColor = baseColor;
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
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = camera.fov * (Math.PI / 180);
  const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.7;
  camera.position.set(
    center.x + distance * 0.7,
    center.y + distance * 0.7,
    center.z + distance * 0.6
  );
  controls.target.copy(center);
  camera.near = Math.max(0.1, distance * 0.001);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

export function getMeshGroup() { return meshGroup; }

export function pickMeshAt(camera, raycaster, ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshGroup.children, false);
  return hits.length > 0 ? hits[0] : null;
}
