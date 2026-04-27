import * as THREE from 'three';

// ── State ──
let appState = null;
let currentStep = 0;       // 0=idle, 1=waiting pick1, 2=waiting pick2
let pickType = [null, null]; // 'point'|'edge'|'face' for each step
let picks = [];              // [{type, data, marker}] max 2
let hoverVisuals = [];
let resultVisuals = [];
const overlayGroup = new THREE.Group();
overlayGroup.name = 'measurement-overlay';
overlayGroup.renderOrder = 999;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ── Colors ──
const COLOR_PICK1 = 0xff3333;     // red for first pick
const COLOR_PICK2 = 0xff9900;     // orange for second pick
const COLOR_HOVER1 = 0xff6666;    // light red hover
const COLOR_HOVER2 = 0xffbb44;    // light orange hover

function getPickColor(step) { return step === 0 ? COLOR_PICK1 : COLOR_PICK2; }
function getHoverColor(step) { return step === 0 ? COLOR_HOVER1 : COLOR_HOVER2; }

const DIST_LINE_MAT = new THREE.LineDashedMaterial({
  color: 0xffff00, dashSize: 2, gapSize: 1, depthTest: false, depthWrite: false
});

// ── Init ──
export function initMeasurement(state) {
  appState = state;
  appState.scene.add(overlayGroup);

  const canvas = appState.renderer.domElement;
  let pointerDownPos = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!appState.measurementMode || currentStep === 0) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!appState.measurementMode || currentStep === 0 || !pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) < 5) {
      onMeasureClick(e);
    }
    pointerDownPos = null;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!appState.measurementMode || currentStep === 0) return;
    onMeasureHover(e);
  });

  // Wire up pick-type buttons
  document.querySelectorAll('.pick-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step);
      const type = btn.dataset.type;
      onPickTypeSelected(step, type);
    });
  });
}

function onPickTypeSelected(step, type) {
  if (step === 1) {
    // If re-selecting step1 type, clear everything
    if (picks.length > 0) clearMeasurement();
    pickType[0] = type;
    currentStep = 1;

    // Update button states
    document.querySelectorAll('.pick-type-btn[data-step="1"]').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    // Update info
    document.getElementById('step1-info').textContent = `${typeLabel(type)}을(를) 클릭하세요`;

    // Enable step1, disable step2
    document.getElementById('step1').classList.remove('disabled', 'done');
    document.getElementById('step2').classList.add('disabled');
    document.getElementById('step2').classList.remove('done');
    document.querySelectorAll('.pick-type-btn[data-step="2"]').forEach(b => b.classList.remove('active'));
    document.getElementById('step2-info').textContent = '유형을 선택하세요';
    document.getElementById('measure-result').classList.remove('active');

    // Set cursor
    appState.renderer.domElement.classList.add('measure-cursor');

  } else if (step === 2 && picks.length === 1) {
    pickType[1] = type;
    currentStep = 2;

    document.querySelectorAll('.pick-type-btn[data-step="2"]').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    document.getElementById('step2-info').textContent = `${typeLabel(type)}을(를) 클릭하세요`;
    document.getElementById('step2').classList.remove('disabled', 'done');

    appState.renderer.domElement.classList.add('measure-cursor');
  }
}

// ── Raycast helper ──
function castRay(e) {
  const canvas = appState.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, appState.camera);
  return raycaster.intersectObjects(appState.scene.children, true);
}

// ── Element identification ──
function identifyElement(intersect, type) {
  const mesh = intersect.object;
  if (!mesh.isMesh || !mesh.userData.partId) return null;

  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  const idx = geom.index.array;
  const faceIdx = intersect.faceIndex;
  const hitPoint = intersect.point.clone();

  const invMatrix = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localHit = hitPoint.clone().applyMatrix4(invMatrix);

  const i0 = idx[faceIdx * 3];
  const i1 = idx[faceIdx * 3 + 1];
  const i2 = idx[faceIdx * 3 + 2];

  if (type === 'point') {
    const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
    let closest = v0, minD = localHit.distanceTo(v0);
    if (localHit.distanceTo(v1) < minD) { closest = v1; minD = localHit.distanceTo(v1); }
    if (localHit.distanceTo(v2) < minD) { closest = v2; }
    const worldPt = closest.clone().applyMatrix4(mesh.matrixWorld);
    return { type: 'point', point: worldPt, mesh };
  }

  if (type === 'edge') {
    const groupIdx = findBrepGroupIndex(geom, faceIdx);
    const boundaryEdges = mesh.userData.boundaryEdges;
    if (boundaryEdges && boundaryEdges.has(groupIdx)) {
      const edges = boundaryEdges.get(groupIdx);
      const chain = findClosestEdgeChain(edges, localHit);
      const worldChain = chain.map(seg => ({
        a: seg.a.clone().applyMatrix4(mesh.matrixWorld),
        b: seg.b.clone().applyMatrix4(mesh.matrixWorld)
      }));
      return { type: 'edge', segments: worldChain, mesh, groupIdx };
    }
    return fallbackEdge(posAttr, i0, i1, i2, localHit, mesh);
  }

  if (type === 'face') {
    const groupIdx = findBrepGroupIndex(geom, faceIdx);
    const brepFaces = mesh.userData.brepFaces;
    if (brepFaces && groupIdx >= 0 && groupIdx < brepFaces.length) {
      const face = brepFaces[groupIdx];
      const triangles = [];
      for (let t = face.first; t < face.last; t++) {
        const a = new THREE.Vector3().fromBufferAttribute(posAttr, idx[t * 3]);
        const b = new THREE.Vector3().fromBufferAttribute(posAttr, idx[t * 3 + 1]);
        const c = new THREE.Vector3().fromBufferAttribute(posAttr, idx[t * 3 + 2]);
        triangles.push({ a, b, c });
      }
      const worldTris = triangles.map(tri => ({
        a: tri.a.clone().applyMatrix4(mesh.matrixWorld),
        b: tri.b.clone().applyMatrix4(mesh.matrixWorld),
        c: tri.c.clone().applyMatrix4(mesh.matrixWorld),
      }));
      const normal = computeFaceNormal(worldTris);
      const centroid = computeFaceCentroid(worldTris);
      return { type: 'face', triangles: worldTris, normal, centroid, mesh, groupIdx };
    }
    // Fallback: single triangle as face
    return { type: 'point', point: hitPoint, mesh };
  }

  return null;
}

function findBrepGroupIndex(geom, faceIdx) {
  const triStart = faceIdx * 3;
  const groups = geom.groups;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (triStart >= g.start && triStart < g.start + g.count) return i;
  }
  return -1;
}

function findClosestEdgeChain(edges, localHit) {
  let bestDist = Infinity, bestSeg = null;
  for (const seg of edges) {
    const d = distPointToSegment(localHit, seg.a, seg.b);
    if (d < bestDist) { bestDist = d; bestSeg = seg; }
  }
  if (!bestSeg) return edges.slice(0, 1);

  const used = new Set();
  const chain = [bestSeg];
  used.add(bestSeg);

  function vertKey(v) { return `${v.x.toFixed(6)}_${v.y.toFixed(6)}_${v.z.toFixed(6)}`; }

  let changed = true;
  while (changed) {
    changed = false;
    const headKey = vertKey(chain[0].a);
    const tailKey = vertKey(chain[chain.length - 1].b);
    for (const seg of edges) {
      if (used.has(seg)) continue;
      if (vertKey(seg.a) === tailKey) {
        chain.push(seg); used.add(seg); changed = true;
      } else if (vertKey(seg.b) === headKey) {
        chain.unshift(seg); used.add(seg); changed = true;
      }
    }
  }
  return chain;
}

function fallbackEdge(posAttr, i0, i1, i2, localHit, mesh) {
  const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
  const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
  const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
  const edges = [[v0, v1], [v1, v2], [v2, v0]];
  let bestD = Infinity, bestE = 0;
  edges.forEach(([a, b], i) => {
    const d = distPointToSegment(localHit, a, b);
    if (d < bestD) { bestD = d; bestE = i; }
  });
  const [a, b] = edges[bestE];
  const seg = {
    a: a.clone().applyMatrix4(mesh.matrixWorld),
    b: b.clone().applyMatrix4(mesh.matrixWorld)
  };
  return { type: 'edge', segments: [seg], mesh };
}

// ── Hover ──
function onMeasureHover(e) {
  clearHoverVisuals();
  const intersects = castRay(e);
  if (intersects.length === 0) return;

  const hit = intersects.find(i => i.object.isMesh && i.object.userData.partId);
  if (!hit) return;

  const stepIdx = picks.length; // 0 or 1
  const type = pickType[stepIdx];
  if (!type) return;

  const elem = identifyElement(hit, type);
  if (!elem) return;

  showHoverVisual(elem, stepIdx);
}

function showHoverVisual(elem, stepIdx) {
  const color = getHoverColor(stepIdx);
  const visuals = createElementVisual(elem, color, 0.5);
  for (const v of visuals) {
    overlayGroup.add(v);
    hoverVisuals.push(v);
  }
}

function createTube(pointA, pointB, radius, color) {
  const dir = new THREE.Vector3().subVectors(pointB, pointA);
  const len = dir.length();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 8, 1);
  geom.translate(0, len / 2, 0);
  geom.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pointA);
  mesh.lookAt(pointB);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  return mesh;
}

function clearHoverVisuals() {
  for (const obj of hoverVisuals) {
    overlayGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material && !obj.material._shared) obj.material.dispose();
  }
  hoverVisuals = [];
}

// ── Click / Pick ──
function onMeasureClick(e) {
  const stepIdx = picks.length; // 0 or 1
  const type = pickType[stepIdx];
  if (!type) return;

  const intersects = castRay(e);
  if (intersects.length === 0) return;

  const hit = intersects.find(i => i.object.isMesh && i.object.userData.partId);
  if (!hit) return;

  const elem = identifyElement(hit, type);
  if (!elem) return;

  clearHoverVisuals();

  // Create pick visual
  const color = getPickColor(stepIdx);
  const marker = createPickVisual(elem, color);
  picks.push({ ...elem, marker });

  if (stepIdx === 0) {
    // First pick done
    document.getElementById('step1').classList.add('done');
    document.getElementById('step1-info').textContent = `${typeLabel(type)} 선택됨 ✓`;
    document.getElementById('step2').classList.remove('disabled');
    appState.renderer.domElement.classList.remove('measure-cursor');
    currentStep = 0; // Wait for step2 type selection
  } else {
    // Second pick done → compute distance
    document.getElementById('step2').classList.add('done');
    document.getElementById('step2-info').textContent = `${typeLabel(type)} 선택됨 ✓`;
    appState.renderer.domElement.classList.remove('measure-cursor');
    currentStep = 0;
    computeAndShowDistance();
  }
}

function createPickVisual(elem, color) {
  const visuals = createElementVisual(elem, color, 0.7);
  for (const v of visuals) {
    overlayGroup.add(v);
  }
  return visuals;
}

function createElementVisual(elem, color, opacity) {
  const visuals = [];
  const offset = getMarkerSize() * 0.5;

  if (elem.type === 'point') {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(getMarkerSize() * 1.5, 16, 16), mat);
    sphere.position.copy(elem.point);
    sphere.renderOrder = 1000;
    sphere.frustumCulled = false;
    visuals.push(sphere);
  } else if (elem.type === 'edge') {
    for (const seg of elem.segments) {
      const tube = createTube(seg.a, seg.b, getMarkerSize() * 0.35, color);
      visuals.push(tube);
    }
  } else if (elem.type === 'face') {
    const normal = elem.normal || computeFaceNormal(elem.triangles);
    const offsetVec = normal.clone().multiplyScalar(offset);

    const mat = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide,
      transparent: true, opacity,
      depthTest: false, depthWrite: false,
    });
    const geom = new THREE.BufferGeometry();
    const verts = [];
    for (const tri of elem.triangles) {
      const a = tri.a.clone().add(offsetVec);
      const b = tri.b.clone().add(offsetVec);
      const c = tri.c.clone().add(offsetVec);
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.computeBoundingSphere();
    const overlay = new THREE.Mesh(geom, mat);
    overlay.renderOrder = 1000;
    overlay.frustumCulled = false;
    visuals.push(overlay);
  }
  return visuals;
}

// ── Distance computation ──
function computeAndShowDistance() {
  const a = picks[0], b = picks[1];
  const { distance, pointA, pointB } = computeDistance(a, b);

  // Draw distance line
  const lineGeom = new THREE.BufferGeometry().setFromPoints([pointA, pointB]);
  const line = new THREE.Line(lineGeom, DIST_LINE_MAT);
  line.computeLineDistances();
  line.renderOrder = 1001;
  overlayGroup.add(line);
  resultVisuals.push(line);

  // Endpoint markers
  for (const pt of [pointA, pointB]) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(getMarkerSize() * 0.8, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, depthWrite: false })
    );
    s.position.copy(pt);
    s.renderOrder = 1001;
    s.frustumCulled = false;
    overlayGroup.add(s);
    resultVisuals.push(s);
  }

  // Show result in panel
  const resultEl = document.getElementById('measure-result');
  resultEl.textContent = `${distance.toFixed(3)} mm`;
  resultEl.classList.add('active');

  // Distance label on 3D view
  showDistanceLabel(distance, pointA, pointB);
}

function computeDistance(a, b) {
  const key = `${a.type}-${b.type}`;
  switch (key) {
    case 'point-point':
      return { distance: a.point.distanceTo(b.point), pointA: a.point, pointB: b.point };
    case 'point-edge':
      return distPointEdge(a.point, b.segments);
    case 'edge-point':
      return swap(distPointEdge(b.point, a.segments));
    case 'point-face':
      return distPointFace(a.point, b.triangles);
    case 'face-point':
      return swap(distPointFace(b.point, a.triangles));
    case 'edge-edge':
      return distEdgeEdge(a.segments, b.segments);
    case 'edge-face':
      return distEdgeFace(a.segments, b.triangles);
    case 'face-edge':
      return swap(distEdgeFace(b.segments, a.triangles));
    case 'face-face':
      return distFaceFace(a, b);
    default:
      return { distance: 0, pointA: new THREE.Vector3(), pointB: new THREE.Vector3() };
  }
}

function swap(r) {
  return { distance: r.distance, pointA: r.pointB, pointB: r.pointA };
}

// ── Distance algorithms ──
function distPointEdge(point, segments) {
  let bestD = Infinity, bestPt = null;
  for (const seg of segments) {
    const cp = closestPointOnSegment(point, seg.a, seg.b);
    const d = point.distanceTo(cp);
    if (d < bestD) { bestD = d; bestPt = cp; }
  }
  return { distance: bestD, pointA: point.clone(), pointB: bestPt };
}

function distPointFace(point, triangles) {
  let bestD = Infinity, bestPt = null;
  for (const tri of triangles) {
    const cp = closestPointOnTriangle(point, tri.a, tri.b, tri.c);
    const d = point.distanceTo(cp);
    if (d < bestD) { bestD = d; bestPt = cp; }
  }
  return { distance: bestD, pointA: point.clone(), pointB: bestPt };
}

function distEdgeEdge(segsA, segsB) {
  let bestD = Infinity, bestA = null, bestB = null;
  for (const sa of segsA) {
    for (const sb of segsB) {
      const { dist, p1, p2 } = closestPointsSegSeg(sa.a, sa.b, sb.a, sb.b);
      if (dist < bestD) { bestD = dist; bestA = p1; bestB = p2; }
    }
  }
  return { distance: bestD, pointA: bestA, pointB: bestB };
}

function distEdgeFace(segments, triangles) {
  let bestD = Infinity, bestA = null, bestB = null;
  for (const seg of segments) {
    for (const tri of triangles) {
      for (const pt of [seg.a, seg.b]) {
        const cp = closestPointOnTriangle(pt, tri.a, tri.b, tri.c);
        const d = pt.distanceTo(cp);
        if (d < bestD) { bestD = d; bestA = pt.clone(); bestB = cp; }
      }
      for (const tv of [tri.a, tri.b, tri.c]) {
        const cp = closestPointOnSegment(tv, seg.a, seg.b);
        const d = tv.distanceTo(cp);
        if (d < bestD) { bestD = d; bestA = cp; bestB = tv.clone(); }
      }
    }
  }
  return { distance: bestD, pointA: bestA, pointB: bestB };
}

function distFaceFace(faceA, faceB) {
  if (faceA.normal && faceB.normal) {
    const dot = Math.abs(faceA.normal.dot(faceB.normal));
    if (dot > 0.99) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(faceB.normal, faceB.centroid);
      const dist = Math.abs(plane.distanceToPoint(faceA.centroid));
      const projPt = faceA.centroid.clone().addScaledVector(faceB.normal, -plane.distanceToPoint(faceA.centroid));
      return { distance: dist, pointA: faceA.centroid.clone(), pointB: projPt };
    }
  }

  let bestD = Infinity, bestA = null, bestB = null;
  for (const tA of faceA.triangles) {
    for (const tB of faceB.triangles) {
      for (const pt of [tA.a, tA.b, tA.c]) {
        const cp = closestPointOnTriangle(pt, tB.a, tB.b, tB.c);
        const d = pt.distanceTo(cp);
        if (d < bestD) { bestD = d; bestA = pt.clone(); bestB = cp; }
      }
      for (const pt of [tB.a, tB.b, tB.c]) {
        const cp = closestPointOnTriangle(pt, tA.a, tA.b, tA.c);
        const d = pt.distanceTo(cp);
        if (d < bestD) { bestD = d; bestA = cp; bestB = pt.clone(); }
      }
    }
  }
  return { distance: bestD, pointA: bestA, pointB: bestB };
}

// ── Geometry math helpers ──
function distPointToSegment(p, a, b) {
  return p.distanceTo(closestPointOnSegment(p, a, b));
}

function closestPointOnSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-10) return a.clone();
  let t = new THREE.Vector3().subVectors(p, a).dot(ab) / len2;
  t = Math.max(0, Math.min(1, t));
  return a.clone().addScaledVector(ab, t);
}

function closestPointOnTriangle(p, a, b, c) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);

  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();

  const cp2 = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp2), d6 = ac.dot(cp2);
  if (d6 >= 0 && d5 <= d6) return c.clone();

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return a.clone().addScaledVector(ab, v);
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return a.clone().addScaledVector(ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return b.clone().addScaledVector(new THREE.Vector3().subVectors(c, b), w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return a.clone().addScaledVector(ab, v).addScaledVector(ac, w);
}

function closestPointsSegSeg(p1, p2, p3, p4) {
  const d1 = new THREE.Vector3().subVectors(p2, p1);
  const d2 = new THREE.Vector3().subVectors(p4, p3);
  const r = new THREE.Vector3().subVectors(p1, p3);
  const a = d1.dot(d1), e = d2.dot(d2);
  const f = d2.dot(r);

  let s, t;
  if (a < 1e-10 && e < 1e-10) {
    return { dist: p1.distanceTo(p3), p1: p1.clone(), p2: p3.clone() };
  }
  if (a < 1e-10) {
    s = 0; t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e < 1e-10) {
      t = 0; s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }

  const closest1 = p1.clone().addScaledVector(d1, s);
  const closest2 = p3.clone().addScaledVector(d2, t);
  return { dist: closest1.distanceTo(closest2), p1: closest1, p2: closest2 };
}

function computeFaceNormal(triangles) {
  const normal = new THREE.Vector3();
  for (const tri of triangles) {
    const ab = new THREE.Vector3().subVectors(tri.b, tri.a);
    const ac = new THREE.Vector3().subVectors(tri.c, tri.a);
    normal.add(new THREE.Vector3().crossVectors(ab, ac));
  }
  normal.normalize();
  return normal;
}

function computeFaceCentroid(triangles) {
  const centroid = new THREE.Vector3();
  let count = 0;
  for (const tri of triangles) {
    centroid.add(tri.a).add(tri.b).add(tri.c);
    count += 3;
  }
  centroid.divideScalar(count);
  return centroid;
}

// ── Distance label (HTML overlay) ──
let labelDiv = null;

function showDistanceLabel(distance, ptA, ptB) {
  if (!labelDiv) {
    labelDiv = document.createElement('div');
    labelDiv.id = 'measure-label';
    document.getElementById('viewer-container').appendChild(labelDiv);
  }

  labelDiv.textContent = `${distance.toFixed(3)} mm`;
  labelDiv.style.display = 'block';

  function updateLabelPos() {
    if (!labelDiv || labelDiv.style.display === 'none') return;
    const mid = new THREE.Vector3().addVectors(ptA, ptB).multiplyScalar(0.5);
    mid.project(appState.camera);
    const canvas = appState.renderer.domElement;
    const x = (mid.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-mid.y * 0.5 + 0.5) * canvas.clientHeight;
    labelDiv.style.left = x + 'px';
    labelDiv.style.top = y + 'px';
    requestAnimationFrame(updateLabelPos);
  }
  updateLabelPos();
}

// ── Marker size relative to model ──
function getMarkerSize() {
  const box = new THREE.Box3().setFromObject(appState.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  return Math.max(size.x, size.y, size.z) * 0.008;
}

function typeLabel(type) {
  if (type === 'point') return '점';
  if (type === 'edge') return '선';
  if (type === 'face') return '면';
  return type;
}

// ── Clear ──
export function clearMeasurement() {
  clearHoverVisuals();
  for (const pick of picks) {
    if (pick.marker) {
      for (const obj of pick.marker) {
        overlayGroup.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
      }
    }
  }
  for (const obj of resultVisuals) {
    overlayGroup.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }
  picks = [];
  pickType = [null, null];
  currentStep = 0;
  resultVisuals = [];
  if (labelDiv) labelDiv.style.display = 'none';

  // Reset UI
  document.querySelectorAll('.pick-type-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('step1').classList.remove('done', 'disabled');
  document.getElementById('step1-info').textContent = '유형을 선택하세요';
  document.getElementById('step2').classList.add('disabled');
  document.getElementById('step2').classList.remove('done');
  document.getElementById('step2-info').textContent = '유형을 선택하세요';
  document.getElementById('measure-result').classList.remove('active');
  document.getElementById('measure-result').textContent = '';

  if (appState) {
    appState.renderer.domElement.classList.remove('measure-cursor');
  }
}

export function setMeasurementMode(active) {
  const panel = document.getElementById('measure-panel');
  if (active) {
    panel.classList.add('active');
    clearMeasurement();
  } else {
    panel.classList.remove('active');
    clearMeasurement();
  }
}
