// 측정 도구 (step_viewer 에서 이식·일반화)
// - 점/선/면 두 개를 골라 최단거리, ΔX/ΔY/ΔZ, 두 면·선 사이 각도 표시
// - 면 분할: STEP 파트는 B-rep 면 정보, 일반 도형은 인접 삼각형 법선이 10° 이내면 같은 면으로 묶음
// - 선을 고르면 길이, 닫힌 원형 모서리면 지름(Ø)과 중심도 표시
import * as THREE from 'three';
import { getMeshGroup, getSceneBox } from './visualize.js';

const COLOR_PICK = [0xff3333, 0xff9900];
const COLOR_HOVER = [0xff6666, 0xffbb44];
const SMOOTH_DEG = 10;

export class Measure {
  constructor(ctx, ui) {
    this.ctx = ctx;
    this.ui = ui; // { panel, step1, step2, info1, info2, result, viewer }
    this.active = false;
    this.pickType = [null, null];
    this.picks = [];
    this.waiting = -1;      // 0/1: 해당 단계 클릭 대기, -1: 대기 없음
    this.hoverObjs = [];
    this.resultObjs = [];
    this.overlay = new THREE.Group();
    this.overlay.name = '__measure__';
    ctx.scene.add(this.overlay);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    this.label = document.createElement('div');
    this.label.id = 'measure-label';
    ui.viewer.appendChild(this.label);

    const canvas = ctx.renderer.domElement;
    let down = null;
    canvas.addEventListener('pointerdown', e => { if (this.active) down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', e => {
      if (!this.active || !down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this._click(e);
      down = null;
    });
    canvas.addEventListener('pointermove', e => { if (this.active) this._hover(e); });

    ui.panel.querySelectorAll('.pick-type-btn').forEach(btn => {
      btn.addEventListener('click', () => this.choose(Number(btn.dataset.step) - 1, btn.dataset.type));
    });

    const loop = () => { this._placeLabel(); requestAnimationFrame(loop); };
    loop();
  }

  setActive(v) {
    this.active = v;
    this.ui.panel.classList.toggle('active', v);
    this.clear();
    if (v) this.choose(0, 'point');
  }

  // step: 0 또는 1, type: 'point' | 'edge' | 'face'
  choose(step, type) {
    if (step === 0) {
      this.clear();
      this.pickType[0] = type;
      this.waiting = 0;
      this.ui.info1.textContent = `${typeLabel(type)}을(를) 클릭하세요`;
      this.ui.step2.classList.add('disabled');
    } else {
      if (this.picks.length < 1) return;
      this._clearResult();
      if (this.picks.length > 1) {
        this._disposeAll(this.picks[1].marker);
        this.picks.length = 1;
      }
      this.pickType[1] = type;
      this.waiting = 1;
      this.ui.info2.textContent = `${typeLabel(type)}을(를) 클릭하세요`;
      this.ui.step2.classList.remove('disabled', 'done');
    }
    this.ui.panel.querySelectorAll(`.pick-type-btn[data-step="${step + 1}"]`)
      .forEach(b => b.classList.toggle('active', b.dataset.type === type));
    this.ctx.renderer.domElement.classList.add('measure-cursor');
  }

  clear() {
    this._clearHover();
    for (const p of this.picks) this._disposeAll(p.marker);
    this._clearResult();
    this.picks = [];
    this.pickType = [null, null];
    this.waiting = -1;
    this.ui.panel.querySelectorAll('.pick-type-btn').forEach(b => b.classList.remove('active'));
    this.ui.step1.classList.remove('done');
    this.ui.step2.classList.add('disabled');
    this.ui.step2.classList.remove('done');
    this.ui.info1.textContent = '유형을 선택하세요';
    this.ui.info2.textContent = '유형을 선택하세요';
    this.ctx.renderer.domElement.classList.remove('measure-cursor');
  }

  // 씬이 다시 그려지면 이전 메쉬 참조가 무효 → 결과만 남기고 표시는 유지
  onSceneRebuilt() { this._clearHover(); }

  _clearResult() {
    this._disposeAll(this.resultObjs);
    this.resultObjs = [];
    this.ui.result.classList.remove('active');
    this.ui.result.innerHTML = '';
    this.labelPts = null;
    this.label.style.display = 'none';
  }

  _disposeAll(objs) {
    for (const o of objs || []) {
      this.overlay.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    }
  }

  _clearHover() { this._disposeAll(this.hoverObjs); this.hoverObjs = []; }

  _cast(e) {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hits = this.raycaster.intersectObjects(getMeshGroup().children, false);
    return hits.find(h => h.object.visible) || null;
  }

  _hover(e) {
    this._clearHover();
    if (this.waiting < 0) return;
    const hit = this._cast(e);
    if (!hit) return;
    const elem = identify(hit, this.pickType[this.waiting]);
    if (!elem) return;
    this.hoverObjs = this._visual(elem, COLOR_HOVER[this.waiting], 0.45);
  }

  _click(e) {
    if (this.waiting < 0) return;
    const step = this.waiting;
    const hit = this._cast(e);
    if (!hit) return;
    const elem = identify(hit, this.pickType[step]);
    if (!elem) return;
    this._clearHover();
    elem.marker = this._visual(elem, COLOR_PICK[step], 0.7);
    this.picks[step] = elem;
    this.waiting = -1;
    this.ctx.renderer.domElement.classList.remove('measure-cursor');
    const info = step === 0 ? this.ui.info1 : this.ui.info2;
    info.innerHTML = describe(elem);
    (step === 0 ? this.ui.step1 : this.ui.step2).classList.add('done');
    if (step === 0) {
      this.ui.step2.classList.remove('disabled');
      this.ui.info2.textContent = '유형을 선택하세요';
    } else {
      this._showResult();
    }
  }

  _markerSize() {
    const s = getSceneBox().getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z, 1) * 0.006;
  }

  _visual(elem, color, opacity) {
    const out = [];
    const ms = this._markerSize();
    const basic = (extra = {}) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, ...extra });
    if (elem.type === 'point') {
      const s = new THREE.Mesh(new THREE.SphereGeometry(ms * 1.5, 16, 16), basic());
      s.position.copy(elem.point);
      out.push(s);
    } else if (elem.type === 'edge') {
      for (const seg of elem.segments) out.push(tube(seg.a, seg.b, ms * 0.35, basic()));
      if (elem.circle) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(ms, 12, 12), basic());
        c.position.copy(elem.circle.center);
        out.push(c);
      }
    } else if (elem.type === 'face') {
      const off = elem.normal.clone().multiplyScalar(ms * 0.3);
      const verts = [];
      for (const t of elem.triangles) for (const v of [t.a, t.b, t.c]) verts.push(v.x + off.x, v.y + off.y, v.z + off.z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      out.push(new THREE.Mesh(g, basic({ side: THREE.DoubleSide, transparent: true, opacity })));
      const x = axisOf(elem);
      if (x) out.push(tube(x.a.clone().addScaledVector(x.d, -ms * 4), x.b.clone().addScaledVector(x.d, ms * 4), ms * 0.25, basic()));
    }
    for (const o of out) { o.renderOrder = 1000; o.frustumCulled = false; this.overlay.add(o); }
    return out;
  }

  _showResult() {
    const [a, b] = this.picks;
    const r = computeDistance(a, b);
    const ms = this._markerSize();

    const lineMat = new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: ms * 3, gapSize: ms * 1.5, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([r.pointA, r.pointB]), lineMat);
    line.computeLineDistances();
    line.renderOrder = 1001;
    this.overlay.add(line);
    this.resultObjs.push(line);
    for (const p of [r.pointA, r.pointB]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(ms * 0.8, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, depthWrite: false }));
      s.position.copy(p);
      s.renderOrder = 1001;
      this.overlay.add(s);
      this.resultObjs.push(s);
    }

    const d = r.pointB.clone().sub(r.pointA);
    let html = `<div class="mr-main">${r.distance.toFixed(3)} mm</div>
      <div class="mr-sub">ΔX ${f3(d.x)} · ΔY ${f3(d.y)} · ΔZ ${f3(d.z)}</div>`;
    const ang = angleBetween(a, b);
    if (ang !== null) html += `<div class="mr-sub">방향 사이 각도 ${ang.toFixed(2)}° (면=법선, 원통=축)</div>`;
    if (r.note) html += `<div class="mr-sub">${r.note}</div>`;
    this.ui.result.innerHTML = html;
    this.ui.result.classList.add('active');
    this.labelPts = [r.pointA, r.pointB];
    this.label.textContent = `${r.distance.toFixed(3)} mm`;
    this.label.style.display = 'block';
    this.last = { distance: r.distance, pointA: r.pointA.toArray(), pointB: r.pointB.toArray(), delta: d.toArray(), angle: ang };
  }

  _placeLabel() {
    if (!this.labelPts) return;
    const mid = this.labelPts[0].clone().add(this.labelPts[1]).multiplyScalar(0.5).project(this.ctx.camera);
    const c = this.ctx.renderer.domElement;
    this.label.style.left = `${(mid.x * 0.5 + 0.5) * c.clientWidth}px`;
    this.label.style.top = `${(-mid.y * 0.5 + 0.5) * c.clientHeight + c.offsetTop}px`;
  }
}

// ── 면/모서리 위상 (메쉬별 1회 계산 후 캐시) ──

function triVerts(geom, t) {
  const idx = geom.index;
  return idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
}

export function faceData(mesh) {
  if (mesh.userData._faces) return mesh.userData._faces;
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const triCount = geom.index ? geom.index.count / 3 : pos.count / 3;

  // 위치 기준 정점 ID (STEP 은 B-rep 면마다 정점이 따로 있어 index 만으로는 이웃을 못 찾음)
  const keyToId = new Map();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keyToId.get(k);
    if (id === undefined) { id = keyToId.size; keyToId.set(k, id); }
    vid[i] = id;
  }
  const N = keyToId.size;
  const edges = new Map(); // edgeKey -> [tri, tri, ...]
  const triIds = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const vs = triVerts(geom, t);
    for (let k = 0; k < 3; k++) triIds[t * 3 + k] = vs[k];
    for (let k = 0; k < 3; k++) {
      const a = vid[vs[k]], b = vid[vs[(k + 1) % 3]];
      if (a === b) continue;
      const key = a < b ? a * N + b : b * N + a;
      let arr = edges.get(key);
      if (!arr) { arr = []; edges.set(key, arr); }
      arr.push(t);
    }
  }

  const triFace = new Int32Array(triCount).fill(-1);
  const brep = mesh.userData.brepFaces;
  if (brep && brep.length) {
    // occt-import-js 의 brep_faces.last 는 마지막 삼각형을 포함하는 인덱스
    brep.forEach((f, i) => { for (let t = f.first; t <= f.last && t < triCount; t++) triFace[t] = i; });
  } else {
    // 법선이 SMOOTH_DEG 이내인 이웃 삼각형끼리 묶기
    const normals = new Float32Array(triCount * 3);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      A.fromBufferAttribute(pos, triIds[t * 3]); B.fromBufferAttribute(pos, triIds[t * 3 + 1]); C.fromBufferAttribute(pos, triIds[t * 3 + 2]);
      const n = B.sub(A).cross(C.sub(A)).normalize();
      normals.set([n.x, n.y, n.z], t * 3);
    }
    // 정점 공유 기준 이웃 — CSG 결과는 T-접합(변 중간에 다른 삼각형 꼭짓점)이 많아 변 공유만으로는 면이 쪼개진다
    const byVertex = Array.from({ length: N }, () => []);
    for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) byVertex[vid[triIds[t * 3 + k]]].push(t);
    const cosT = Math.cos(THREE.MathUtils.degToRad(SMOOTH_DEG));
    let fid = 0;
    for (let s = 0; s < triCount; s++) {
      if (triFace[s] !== -1) continue;
      triFace[s] = fid;
      const stack = [s];
      while (stack.length) {
        const t = stack.pop();
        const nbs = [];
        for (let k = 0; k < 3; k++) for (const u of byVertex[vid[triIds[t * 3 + k]]]) nbs.push(u);
        for (const u of nbs) {
          if (triFace[u] !== -1) continue;
          const dot = normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2];
          if (dot >= cosT) { triFace[u] = fid; stack.push(u); }
        }
      }
      fid++;
    }
  }

  const faceTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const f = triFace[t];
    if (!faceTris.has(f)) faceTris.set(f, []);
    faceTris.get(f).push(t);
  }

  // 한 삼각형에만 속한 변이 T-접합 때문에 생긴 "가짜 경계"인지: 변 바깥쪽 바로 옆 점이 같은 면의 다른 삼각형 안에 있으면 내부
  const triOf = t => [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, triIds[t * 3 + k]));
  const _tr = new THREE.Triangle(), _cp = new THREE.Vector3();
  function isInteriorEdge(t, a, b) {
    const tris = faceTris.get(triFace[t]);
    if (!tris || tris.length > 4000) return false;
    const [p0, p1, p2] = triOf(t);
    const third = [p0, p1, p2].reduce((best, p) => (p.distanceTo(a) + p.distanceTo(b) > best.distanceTo(a) + best.distanceTo(b) ? p : best));
    const ab = b.clone().sub(a);
    const len = ab.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // 변에 수직이고 삼각형 평면 위에 있는, 세 번째 꼭짓점 반대쪽 방향
    const out = third.clone().sub(mid);
    out.addScaledVector(ab, -out.dot(ab) / (len * len)).normalize().negate();
    const probe = mid.clone().addScaledVector(out, Math.max(len * 1e-3, 1e-4));
    for (const u of tris) {
      if (u === t) continue;
      const [q0, q1, q2] = triOf(u);
      _tr.set(q0, q1, q2);
      _tr.closestPointToPoint(probe, _cp);
      if (_cp.distanceToSquared(probe) < 1e-10) return true;
    }
    return false;
  }

  const triNormal = t => {
    const [p0, p1, p2] = triOf(t);
    return p1.sub(p0).cross(p2.sub(p0)).normalize();
  };
  const cosSmooth = Math.cos(THREE.MathUtils.degToRad(SMOOTH_DEG));

  // 면별 경계 모서리: 서로 다른 면 사이의 모서리 또는 열린 모서리.
  // 단, 양쪽 삼각형이 거의 같은 방향이면(동일 평면으로 쪼개진 B-rep 면 등) 실제 모서리가 아니므로 제외
  const boundary = new Map();
  for (const [key, tris] of edges) {
    const faces = new Set(tris.map(t => triFace[t]));
    if (faces.size < 2 && tris.length > 1) continue;
    if (tris.length === 2 && triNormal(tris[0]).dot(triNormal(tris[1])) > cosSmooth) continue;
    // 실제 정점 좌표 찾기
    const t0 = tris[0];
    const vs = [triIds[t0 * 3], triIds[t0 * 3 + 1], triIds[t0 * 3 + 2]];
    const a = Math.floor(key / N), b = key % N;
    const ia = vs.find(v => vid[v] === a), ib = vs.find(v => vid[v] === b);
    const seg = { a: new THREE.Vector3().fromBufferAttribute(pos, ia), b: new THREE.Vector3().fromBufferAttribute(pos, ib) };
    if (tris.length === 1 && !(brep && brep.length) && isInteriorEdge(t0, seg.a, seg.b)) continue;
    for (const f of faces) {
      if (!boundary.has(f)) boundary.set(f, []);
      boundary.get(f).push(seg);
    }
  }
  const data = { triFace, faceTris, boundary, triIds };
  mesh.userData._faces = data;
  return data;
}

export function identify(hit, type) {
  const mesh = hit.object;
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const t = hit.faceIndex;
  const toWorld = v => v.applyMatrix4(mesh.matrixWorld);
  const local = hit.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  const nodeId = mesh.userData.nodeId;

  if (type === 'point') {
    const vs = triVerts(geom, t).map(i => new THREE.Vector3().fromBufferAttribute(pos, i));
    let best = vs[0];
    for (const v of vs) if (v.distanceTo(local) < best.distanceTo(local)) best = v;
    return { type: 'point', point: toWorld(best.clone()), nodeId };
  }

  const fd = faceData(mesh);
  const f = fd.triFace[t];

  if (type === 'edge') {
    const segs = fd.boundary.get(f) || [];
    if (!segs.length) return null;
    let bestSeg = segs[0], bestD = Infinity;
    for (const s of segs) {
      const d = local.distanceTo(closestOnSeg(local, s.a, s.b));
      if (d < bestD) { bestD = d; bestSeg = s; }
    }
    const chain = edgeChain(segs, bestSeg).map(s => ({ a: toWorld(s.a.clone()), b: toWorld(s.b.clone()) }));
    return { type: 'edge', segments: chain, circle: fitCircle(chain), length: chain.reduce((L, s) => L + s.a.distanceTo(s.b), 0), nodeId };
  }

  if (type === 'face') {
    const tris = (fd.faceTris.get(f) || []).map(tt => ({
      a: toWorld(new THREE.Vector3().fromBufferAttribute(pos, fd.triIds[tt * 3])),
      b: toWorld(new THREE.Vector3().fromBufferAttribute(pos, fd.triIds[tt * 3 + 1])),
      c: toWorld(new THREE.Vector3().fromBufferAttribute(pos, fd.triIds[tt * 3 + 2])),
    }));
    if (!tris.length) return null;
    const normal = new THREE.Vector3(), centroid = new THREE.Vector3();
    let area = 0;
    for (const tr of tris) {
      const n = tr.b.clone().sub(tr.a).cross(tr.c.clone().sub(tr.a));
      const ar = n.length() / 2;
      normal.add(n);
      area += ar;
      centroid.addScaledVector(tr.a.clone().add(tr.b).add(tr.c).divideScalar(3), ar);
    }
    centroid.divideScalar(area || 1);
    // 평면 여부: 모든 삼각형 법선이 평균 법선과 거의 평행
    const avgN = normal.clone().normalize();
    const planar = tris.every(tr => {
      const n = tr.b.clone().sub(tr.a).cross(tr.c.clone().sub(tr.a));
      return n.lengthSq() < 1e-18 || Math.abs(n.normalize().dot(avgN)) > 0.9995;
    });
    const cyl = planar ? null : fitCylinder(tris);
    return { type: 'face', triangles: tris, normal: avgN, centroid, area, planar, cyl, nodeId };
  }
  return null;
}

// 곡면이 원통인지 판정하고 축/반지름 추정. 원통면의 법선은 모두 축에 수직이라는 성질을 이용.
function fitCylinder(tris) {
  const normals = [];
  const pts = [];
  for (const t of tris) {
    const n = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a));
    if (n.lengthSq() < 1e-18) continue;
    normals.push(n.normalize());
    pts.push(t.a, t.b, t.c);
  }
  if (normals.length < 4) return null;
  // 서로 가장 덜 평행한 두 법선의 외적 = 축 방향
  const n0 = normals[0];
  let n1 = normals[1], best = 1;
  for (const n of normals) { const d = Math.abs(n.dot(n0)); if (d < best) { best = d; n1 = n; } }
  if (best > 0.995) return null;
  const axis = n0.clone().cross(n1).normalize();
  if (normals.some(n => Math.abs(n.dot(axis)) > 0.05)) return null;

  // 축에 수직인 평면에 투영해 2D 원 맞춤 (Kasa 최소자승)
  const u = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
  const v = axis.clone().cross(u);
  let tMin = Infinity, tMax = -Infinity;
  for (const p of pts) { const t = p.dot(axis); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
  const fit = fitCircle2D(pts.map(p => [p.dot(u), p.dot(v)]));
  if (!fit) return null;
  const center = u.clone().multiplyScalar(fit.cx).addScaledVector(v, fit.cy).addScaledVector(axis, (tMin + tMax) / 2);
  return { axis, center, radius: fit.r, length: tMax - tMin };
}

// 선택한 선분에서 끝점이 이어지는 선분들을 따라가 하나의 모서리 체인 구성
function edgeChain(segs, start) {
  const key = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const byV = new Map();
  for (const s of segs) for (const v of [s.a, s.b]) {
    const k = key(v);
    if (!byV.has(k)) byV.set(k, []);
    byV.get(k).push(s);
  }
  const cosStop = Math.cos(THREE.MathUtils.degToRad(40));
  const used = new Set([start]);
  const chain = [start];
  // 양 끝으로 확장. 분기점이나 40° 넘게 꺾이는 꼭짓점(박스 모서리 등)에서 멈춘다
  for (const endSel of ['b', 'a']) {
    let tip = start[endSel];
    let dir = tip.clone().sub(endSel === 'b' ? start.a : start.b).normalize();
    while (chain.length < 2048) {
      const atTip = byV.get(key(tip)) || [];
      const cand = atTip.filter(s => !used.has(s));
      if (cand.length !== 1 || atTip.length > 2) break;
      const nxt = cand[0];
      const far = key(nxt.a) === key(tip) ? nxt.b : nxt.a;
      const ndir = far.clone().sub(tip).normalize();
      if (ndir.dot(dir) < cosStop) break;
      used.add(nxt);
      if (endSel === 'b') chain.push(nxt); else chain.unshift(nxt);
      tip = far;
      dir = ndir;
    }
  }
  return chain;
}

// 모서리 체인이 원 또는 원호면 {center, radius, normal, closed, sweep(°)}
function fitCircle(chain) {
  if (chain.length < 4) return null;
  const pts = chain.flatMap(s => [s.a, s.b]);
  const first = chain[0], last = chain[chain.length - 1];
  const closed = chain.length > 2 && [first.a, first.b].some(p => [last.a, last.b].some(q => p.distanceTo(q) < 1e-3));
  // 체인이 놓인 평면: 서로 떨어진 세 점으로 법선
  const p0 = pts[0], p1 = pts[Math.floor(pts.length / 3)], p2 = pts[Math.floor((2 * pts.length) / 3)];
  const n = p1.clone().sub(p0).cross(p2.clone().sub(p0));
  if (n.lengthSq() < 1e-14) return null; // 직선
  n.normalize();
  if (pts.some(p => Math.abs(p.clone().sub(p0).dot(n)) > 1e-3)) return null; // 평면 곡선 아님
  const u = p1.clone().sub(p0).normalize();
  const v = n.clone().cross(u);
  const fit = fitCircle2D(pts.map(p => [p.clone().sub(p0).dot(u), p.clone().sub(p0).dot(v)]));
  if (!fit) return null;
  const center = p0.clone().addScaledVector(u, fit.cx).addScaledVector(v, fit.cy);
  // 원호가 차지하는 각도 (열린 경우)
  let sweep = 360;
  if (!closed) {
    sweep = 0;
    for (const s of chain) sweep += s.a.clone().sub(center).angleTo(s.b.clone().sub(center));
    sweep = THREE.MathUtils.radToDeg(sweep);
    if (sweep < 30) return null; // 너무 짧은 호는 직선과 구분이 어렵다
  }
  return { center, radius: fit.r, normal: n, closed, sweep };
}

// 2D 점들에 원 맞춤 (Kasa 최소자승). 모든 점이 반지름 ±2% 안이어야 원으로 인정
function fitCircle2D(xy) {
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z;
  }
  // 원: x²+y² = a x + b y + c
  const M = new THREE.Matrix3().set(Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, xy.length);
  if (Math.abs(M.determinant()) < 1e-12) return null;
  const sol = new THREE.Vector3(Sxz, Syz, Sz).applyMatrix3(M.clone().invert());
  const cx = sol.x / 2, cy = sol.y / 2;
  const r = Math.sqrt(Math.max(0, sol.z + cx * cx + cy * cy));
  if (!(r > 1e-6)) return null;
  if (xy.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r) / r > 0.02)) return null;
  return { cx, cy, r };
}

function describe(e) {
  if (e.type === 'point') return `점 (${f3(e.point.x)}, ${f3(e.point.y)}, ${f3(e.point.z)})`;
  if (e.type === 'edge') {
    if (e.circle) {
      const c = e.circle.center;
      const kind = e.circle.closed
        ? `원 Ø${(e.circle.radius * 2).toFixed(3)}`
        : `원호 R${e.circle.radius.toFixed(3)} (${e.circle.sweep.toFixed(0)}°, Ø${(e.circle.radius * 2).toFixed(3)})`;
      return `${kind} · 중심 (${f3(c.x)}, ${f3(c.y)}, ${f3(c.z)})`;
    }
    return `선 길이 ${e.length.toFixed(3)} mm`;
  }
  if (e.cyl) {
    const c = e.cyl.center, a = e.cyl.axis;
    return `원통면 Ø${(e.cyl.radius * 2).toFixed(3)} · 길이 ${e.cyl.length.toFixed(2)}<br>축 중심 (${f3(c.x)}, ${f3(c.y)}, ${f3(c.z)}) · 방향 (${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)})`;
  }
  const n = e.normal;
  return `${e.planar ? '평면' : '곡면'} · 면적 ${e.area.toFixed(2)} mm² · 법선 (${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)})`;
}

function typeLabel(t) { return { point: '점', edge: '선', face: '면' }[t] || t; }
function f3(v) { return (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3); }

function tube(a, b, r, mat) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, Math.max(len, 1e-6), 6, 1);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a);
  m.lookAt(b);
  return m;
}

// ── 거리 계산 ──

// 원형 모서리는 중심점을 대표점으로 쓰는 편이 실용적 (구멍 중심 간 거리)
function asPoint(e) {
  if (e.type === 'point') return e.point;
  if (e.type === 'edge' && e.circle) return e.circle.center;
  return null;
}

// 원통면은 축(중심선) 기준으로 잰다: 축–축(볼트 패턴 간격), 점/원 중심–축, 축–평면
function axisOf(e) {
  if (e.type === 'face' && e.cyl) {
    const { center, axis, length } = e.cyl;
    return { c: center, d: axis, a: center.clone().addScaledVector(axis, -length / 2), b: center.clone().addScaledVector(axis, length / 2) };
  }
  return null;
}

function computeDistance(a, b) {
  const xa = axisOf(a), xb = axisOf(b);
  if (xa || xb) {
    const r = axisDistance(a, xa, b, xb);
    if (r) return r;
  }
  const pa = asPoint(a), pb = asPoint(b);
  const circleNote = (a.circle || b.circle) ? '원형 모서리는 중심 기준' : null;
  if (pa && pb) return { distance: pa.distanceTo(pb), pointA: pa.clone(), pointB: pb.clone(), note: circleNote };
  if (pa) return withNote(distPointElem(pa, b), circleNote);
  if (pb) return withNote(swap(distPointElem(pb, a)), circleNote);
  if (a.type === 'edge' && b.type === 'edge') return distSegsSegs(a.segments, b.segments);
  if (a.type === 'edge' && b.type === 'face') return distSegsTris(a.segments, b.triangles);
  if (a.type === 'face' && b.type === 'edge') return swap(distSegsTris(b.segments, a.triangles));
  return distFaceFace(a, b);
}

function axisDistance(a, xa, b, xb) {
  const projOnLine = (p, x) => x.c.clone().addScaledVector(x.d, p.clone().sub(x.c).dot(x.d));
  if (xa && xb) {
    if (Math.abs(xa.d.dot(xb.d)) > 0.9995) {
      const pB = projOnLine(xa.c, xb);
      return { distance: xa.c.distanceTo(pB), pointA: xa.c.clone(), pointB: pB, note: '평행한 두 원통 축 사이 거리' };
    }
    const r = segSeg(xa.a, xa.b, xb.a, xb.b);
    return { distance: r.d, pointA: r.p, pointB: r.q, note: '두 원통 축(중심선) 사이 최단거리' };
  }
  const [x, other, flip] = xa ? [xa, b, false] : [xb, a, true];
  let r = null;
  const p = asPoint(other);
  if (p) {
    const q = projOnLine(p, x);
    r = { distance: p.distanceTo(q), pointA: q, pointB: p.clone(), note: '원통 축까지 거리' };
  } else if (other.type === 'face' && other.planar && Math.abs(x.d.dot(other.normal)) < 0.0005) {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(other.normal, other.centroid);
    const sd = plane.distanceToPoint(x.c);
    r = { distance: Math.abs(sd), pointA: x.c.clone(), pointB: x.c.clone().addScaledVector(other.normal, -sd), note: '원통 축–평면 거리' };
  } else if (other.type === 'edge') {
    r = distSegsSegs([{ a: x.a, b: x.b }], other.segments);
    r.note = '원통 축–선 최단거리';
  }
  if (!r) return null;
  return flip ? swap(r) : r;
}

function withNote(r, note) { r.note = note; return r; }
function swap(r) { return { ...r, pointA: r.pointB, pointB: r.pointA }; }

function distPointElem(p, e) {
  let best = Infinity, bp = null;
  if (e.type === 'edge') {
    for (const s of e.segments) { const c = closestOnSeg(p, s.a, s.b); const d = p.distanceTo(c); if (d < best) { best = d; bp = c; } }
  } else {
    for (const t of e.triangles) { const c = closestOnTri(p, t.a, t.b, t.c); const d = p.distanceTo(c); if (d < best) { best = d; bp = c; } }
  }
  return { distance: best, pointA: p.clone(), pointB: bp };
}

function distSegsSegs(A, B) {
  let best = Infinity, pa = null, pb = null;
  for (const s of A) for (const t of B) {
    const r = segSeg(s.a, s.b, t.a, t.b);
    if (r.d < best) { best = r.d; pa = r.p; pb = r.q; }
  }
  return { distance: best, pointA: pa, pointB: pb };
}

function distSegsTris(segs, tris) {
  let best = Infinity, pa = null, pb = null;
  for (const s of segs) for (const t of tris) {
    for (const p of [s.a, s.b]) { const c = closestOnTri(p, t.a, t.b, t.c); const d = p.distanceTo(c); if (d < best) { best = d; pa = p.clone(); pb = c; } }
    for (const v of [t.a, t.b, t.c]) { const c = closestOnSeg(v, s.a, s.b); const d = v.distanceTo(c); if (d < best) { best = d; pa = c; pb = v.clone(); } }
  }
  return { distance: best, pointA: pa, pointB: pb };
}

function distFaceFace(a, b) {
  // 평행한 두 평면: 평면 간 수직 거리
  if (a.planar && b.planar && Math.abs(a.normal.dot(b.normal)) > 0.9995) {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(b.normal, b.centroid);
    const sd = plane.distanceToPoint(a.centroid);
    return { distance: Math.abs(sd), pointA: a.centroid.clone(), pointB: a.centroid.clone().addScaledVector(b.normal, -sd), note: '평행 평면 간 수직거리' };
  }
  let best = Infinity, pa = null, pb = null;
  for (const s of a.triangles) for (const t of b.triangles) {
    for (const p of [s.a, s.b, s.c]) { const c = closestOnTri(p, t.a, t.b, t.c); const d = p.distanceTo(c); if (d < best) { best = d; pa = p.clone(); pb = c; } }
    for (const p of [t.a, t.b, t.c]) { const c = closestOnTri(p, s.a, s.b, s.c); const d = p.distanceTo(c); if (d < best) { best = d; pa = c; pb = p.clone(); } }
  }
  return { distance: best, pointA: pa, pointB: pb };
}

function dirOf(e) {
  if (e.type === 'face') return e.planar ? e.normal : (e.cyl ? e.cyl.axis : null);
  if (e.type === 'edge') {
    if (e.circle) return e.circle.normal;
    // 직선 모서리: 가장 긴 선분의 방향
    let best = null, L = 0;
    for (const s of e.segments) {
      const d = s.b.clone().sub(s.a);
      if (d.length() > L) { L = d.length(); best = d; }
    }
    return best && L > 1e-9 ? best.normalize() : null;
  }
  return null;
}

function angleBetween(a, b) {
  const da = dirOf(a), db = dirOf(b);
  if (!da || !db) return null;
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(da.dot(db)))));
}

function closestOnSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  if (l2 < 1e-12) return a.clone();
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / l2));
  return a.clone().addScaledVector(ab, t);
}

const _tri = new THREE.Triangle();
function closestOnTri(p, a, b, c) {
  _tri.set(a, b, c);
  return _tri.closestPointToPoint(p, new THREE.Vector3());
}

function segSeg(p1, p2, p3, p4) {
  const d1 = p2.clone().sub(p1), d2 = p4.clone().sub(p3), r = p1.clone().sub(p3);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) { s = 0; t = 0; }
  else if (a < 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1.dot(r);
    if (e < 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const p = p1.clone().addScaledVector(d1, s), q = p3.clone().addScaledVector(d2, t);
  return { d: p.distanceTo(q), p, q };
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
