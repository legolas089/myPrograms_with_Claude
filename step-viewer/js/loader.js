import * as THREE from 'three';

let occtPromise = null;

function waitForOcctScript() {
  return new Promise((resolve) => {
    if (window.occtimportjs) return resolve();
    const check = setInterval(() => {
      if (window.occtimportjs) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

function initOcct() {
  if (!occtPromise) {
    occtPromise = waitForOcctScript().then(() => window.occtimportjs());
  }
  return occtPromise;
}

// Eagerly start loading WASM
initOcct();

function buildThreeMesh(meshData, partId) {
  const geometry = new THREE.BufferGeometry();

  // Position
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(meshData.attributes.position.array, 3)
  );

  // Normals
  if (meshData.attributes.normal) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3)
    );
  } else {
    geometry.computeVertexNormals();
  }

  // Index
  geometry.setIndex(new THREE.BufferAttribute(
    new Uint32Array(meshData.index.array), 1
  ));

  // Materials from brep_faces
  const materials = [];
  const defaultColor = meshData.color
    ? new THREE.Color(meshData.color[0], meshData.color[1], meshData.color[2])
    : new THREE.Color(0.7, 0.7, 0.7);

  const defaultMaterial = new THREE.MeshPhongMaterial({
    color: defaultColor,
    side: THREE.DoubleSide,
  });

  if (meshData.brep_faces && meshData.brep_faces.length > 0) {
    for (const face of meshData.brep_faces) {
      const start = face.first;
      const count = face.last - face.first;

      let mat;
      if (face.color) {
        mat = new THREE.MeshPhongMaterial({
          color: new THREE.Color(face.color[0], face.color[1], face.color[2]),
          side: THREE.DoubleSide,
        });
      } else {
        mat = defaultMaterial;
      }

      let matIndex = materials.indexOf(mat);
      if (matIndex === -1) {
        matIndex = materials.length;
        materials.push(mat);
      }
      geometry.addGroup(start * 3, count * 3, matIndex);
    }
  } else {
    materials.push(defaultMaterial);
  }

  const mesh = new THREE.Mesh(
    geometry,
    materials.length === 1 ? materials[0] : materials
  );
  mesh.userData.partId = partId;
  return mesh;
}

export async function loadStepFile(arrayBuffer, scene) {
  const occt = await initOcct();
  const fileData = new Uint8Array(arrayBuffer);
  const result = occt.ReadStepFile(fileData, null);

  if (!result.success) {
    throw new Error('STEP 파일을 읽지 못했습니다.');
  }

  // Clear previous model
  const toRemove = [];
  scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else if (obj.material) {
        obj.material.dispose();
      }
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => obj.parent?.remove(obj));

  // Remove old groups
  const groupsToRemove = [];
  scene.children.forEach(child => {
    if (child.isGroup) groupsToRemove.push(child);
  });
  groupsToRemove.forEach(g => scene.remove(g));

  const rootGroup = new THREE.Group();
  rootGroup.name = 'step-model';
  // Z-up to Y-up
  rootGroup.rotation.x = -Math.PI / 2;

  const partMeshes = new Map();
  let partCounter = 0;

  function processNode(node, parentGroup, pathPrefix) {
    const name = node.name || `Part_${partCounter++}`;
    const partId = pathPrefix ? `${pathPrefix}/${name}` : name;

    const group = new THREE.Group();
    group.name = name;
    group.userData.partId = partId;

    // Build meshes for this node
    if (node.meshes && node.meshes.length > 0) {
      const meshes = [];
      for (const meshIndex of node.meshes) {
        const meshData = result.meshes[meshIndex];
        if (!meshData) continue;
        const threeMesh = buildThreeMesh(meshData, partId);
        group.add(threeMesh);
        meshes.push(threeMesh);
      }
      if (meshes.length > 0) {
        partMeshes.set(partId, meshes);
      }
    }

    // Process children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        processNode(child, group, partId);
      }
    }

    parentGroup.add(group);
  }

  // The root node from occt
  if (result.root) {
    processNode(result.root, rootGroup, '');
  }

  scene.add(rootGroup);

  // Compute bounding box
  const box = new THREE.Box3().setFromObject(rootGroup);

  return { rootNode: result.root, partMeshes, boundingBox: box };
}
