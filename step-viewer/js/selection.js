import * as THREE from 'three';
import { highlightTreeNode } from './tree.js';

const GREEN_MATERIAL = new THREE.MeshPhongMaterial({
  color: 0x00cc44,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export function initSelection(appState) {
  const canvas = appState.renderer.domElement;
  let pointerDownPos = null;

  canvas.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    // Only treat as click if minimal movement (not orbit drag)
    if (Math.sqrt(dx * dx + dy * dy) < 5) {
      handleClick(e, appState);
    }
    pointerDownPos = null;
  });
}

function handleClick(e, appState) {
  const canvas = appState.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, appState.camera);
  const intersects = raycaster.intersectObjects(appState.scene.children, true);

  if (intersects.length > 0) {
    // Find the object with partId
    let obj = intersects[0].object;
    while (obj && !obj.userData.partId) {
      obj = obj.parent;
    }
    if (obj && obj.userData.partId) {
      selectPart(obj.userData.partId, appState);
      return;
    }
  }

  // Clicked empty space - deselect
  selectPart(null, appState);
}

export function selectPart(partId, appState) {
  // Deselect previous
  if (appState.selectedPartId && appState.originalMaterials) {
    const prevMeshes = appState.partMeshes.get(appState.selectedPartId);
    if (prevMeshes) {
      for (const mesh of prevMeshes) {
        const orig = appState.originalMaterials.get(mesh);
        if (orig !== undefined) {
          mesh.material = orig;
        }
      }
    }
  }

  // Select new
  if (partId) {
    const meshes = appState.partMeshes.get(partId);
    if (meshes) {
      if (!appState.originalMaterials) {
        appState.originalMaterials = new Map();
      }
      for (const mesh of meshes) {
        appState.originalMaterials.set(mesh, mesh.material);
        mesh.material = GREEN_MATERIAL;
      }
    }
  }

  appState.selectedPartId = partId;
  highlightTreeNode(partId);
}
