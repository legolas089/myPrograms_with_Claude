// STEP 참조 모델 저장소
// - occt-import-js(WASM)로 STEP 을 읽어 파트별 BufferGeometry 로 보관
// - 원본 STEP 바이트는 IndexedDB 에 저장 → 새로고침/JSON 불러오기 후에도 자동 복원
import * as THREE from 'three';

const OCCT_URL = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js';

// sourceKey -> { name, parts: [{ meshIndex, name, path, geometry, brepFaces, color }] }
const sources = new Map();

let occtPromise = null;

function loadOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      if (window.occtimportjs) return resolve();
      const s = document.createElement('script');
      s.src = OCCT_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('occt-import-js 로드 실패 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    }).then(() => window.occtimportjs({
      locateFile: (f) => OCCT_URL.replace(/[^/]+$/, '') + f,
    }));
  }
  return occtPromise;
}

export function hasSource(key) { return sources.has(key); }
export function getSource(key) { return sources.get(key); }
export function listSources() { return [...sources.keys()]; }

// merged: 노드가 "합쳐진 파트 전체"를 가리키는지 (새로 가져온 노드는 true).
// 예전 장면의 노드는 메쉬 하나씩을 가리키므로, 합쳐진 그룹 안의 그 메쉬만 잘라서 돌려준다
export function getPart(key, meshIndex, merged = false) {
  const src = sources.get(key);
  if (!src) return null;
  const part = src.parts.find(p => p.meshIndices.includes(meshIndex));
  if (!part) return null;
  if (merged || part.meshIndices.length === 1) return part;
  part.singles ??= new Map();
  if (!part.singles.has(meshIndex)) part.singles.set(meshIndex, sliceMesh(part, meshIndex));
  return part.singles.get(meshIndex);
}

// 불러온 장면의 STEP 노드 정리: merged 표시가 없는 노드라도, 같은 그룹의 다른 메쉬를 가리키는 노드가
// 장면에 하나도 없으면 그룹 전체를 뜻하는 것으로 본다 (합치기 도입 직후 버전에서 가져온 노드)
export function migrateStepNodes(nodes) {
  const refs = new Map();
  for (const n of nodes) if (n.type === 'step') {
    if (!refs.has(n.source)) refs.set(n.source, new Set());
    refs.get(n.source).add(n.mesh);
  }
  for (const n of nodes) {
    if (n.type !== 'step' || n.merged) continue;
    const part = sources.get(n.source)?.parts.find(p => p.meshIndices.includes(n.mesh));
    if (!part || part.meshIndices.length < 2 || part.meshIndex !== n.mesh) continue;
    const others = part.meshIndices.slice(1);
    if (!others.some(mi => refs.get(n.source).has(mi))) n.merged = true;
  }
}

function sliceMesh(part, meshIndex) {
  const r = part.ranges.find(x => x.meshIndex === meshIndex);
  const g = new THREE.BufferGeometry();
  const pos = part.geometry.attributes.position.array, nrm = part.geometry.attributes.normal?.array;
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(r.vo * 3, (r.vo + r.vCount) * 3), 3));
  if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(r.vo * 3, (r.vo + r.vCount) * 3), 3));
  const src = part.geometry.index.array, idx = new Uint32Array(r.iCount);
  for (let k = 0; k < r.iCount; k++) idx[k] = src[r.io + k] - r.vo;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!nrm) g.computeVertexNormals();
  return { ...part, meshIndex, meshIndices: [meshIndex], geometry: g, brepFaces: r.brepFaces, color: r.color ?? part.color, singles: undefined };
}

// 같은 이름의 파일을 다시 넣으면 name#2, name#3 ... 으로 구분.
// 파싱이 끝나기 전에도 키를 예약해 두어, 같은 이름을 동시에 가져와도 서로 덮어쓰지 않게 한다
const reserved = new Set();
export function uniqueKey(name) {
  const taken = k => sources.has(k) || reserved.has(k);
  let key = name;
  for (let i = 2; taken(key); i++) key = `${name}#${i}`;
  reserved.add(key);
  return key;
}

const READ_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  // 0.25 rad(≈14°) → 작은 구멍도 원 하나가 25분할 이상이 되어 원형 모서리 인식·간섭 계산이 정확해진다
  angularDeflection: 0.25,
};

// STEP 읽기는 큰 파일에서 수십 초 걸리는 동기 WASM 호출이라 Web Worker 에서 돌린다 (화면 멈춤 방지)
const WORKER_SRC = `
importScripts(${JSON.stringify(OCCT_URL)});
let occtP = null;
self.onmessage = async (e) => {
  const { id, bytes, params } = e.data;
  try {
    if (!occtP) occtP = occtimportjs({ locateFile: f => ${JSON.stringify(OCCT_URL.replace(/[^/]+$/, ''))} + f });
    const occt = await occtP;
    const r = occt.ReadStepFile(new Uint8Array(bytes), params);
    if (!r.success) throw new Error('STEP 파일을 읽지 못했습니다');
    const meshes = r.meshes.map(m => ({
      name: m.name, color: m.color, brep_faces: m.brep_faces,
      position: Float32Array.from(m.attributes.position.array),
      normal: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
      index: Uint32Array.from(m.index.array),
    }));
    const transfer = [];
    for (const m of meshes) { transfer.push(m.position.buffer, m.index.buffer); if (m.normal) transfer.push(m.normal.buffer); }
    self.postMessage({ id, ok: true, root: r.root, meshes }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};`;

let worker = null;
let workerFailed = false;
let reqId = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    worker.onmessage = e => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error));
    };
    worker.onerror = e => {
      console.warn('STEP 워커 오류, 메인 스레드로 전환:', e.message);
      workerFailed = true;
      worker = null;
      for (const p of pending.values()) p.reject(new Error('worker failed'));
      pending.clear();
    };
  } catch (err) {
    console.warn('Web Worker 생성 실패, 메인 스레드에서 읽음:', err);
    workerFailed = true;
  }
  return worker;
}

async function readStep(bytes) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++reqId;
        pending.set(id, { resolve, reject });
        const copy = new Uint8Array(bytes).slice();
        w.postMessage({ id, bytes: copy.buffer, params: READ_PARAMS }, [copy.buffer]);
      });
    } catch (err) {
      if (!workerFailed) throw err; // 파일 자체 문제
    }
  }
  // 대체 경로: 메인 스레드
  const occt = await loadOcct();
  const r = occt.ReadStepFile(new Uint8Array(bytes), READ_PARAMS);
  if (!r.success) throw new Error('STEP 파일을 읽지 못했습니다');
  return {
    root: r.root,
    meshes: r.meshes.map(m => ({
      name: m.name, color: m.color, brep_faces: m.brep_faces,
      position: Float32Array.from(m.attributes.position.array),
      normal: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
      index: Uint32Array.from(m.index.array),
    })),
  };
}

// STEP 바이트를 파싱하여 sources 에 등록. 반환: 파트 목록
export async function parseStep(key, bytes) {
  try {
    return await parseStepInner(key, bytes);
  } finally {
    reserved.delete(key);
  }
}

async function parseStepInner(key, bytes) {
  const result = await readStep(bytes);

  // 이름 있는 메쉬 = 파트 하나 (어셈블리의 각 부품).
  // 한 노드 안의 이름 없는 메쉬들은 하나로 합친다 — 메쉬로 내보낸 STEP 은 연결이 끊긴 면 덩어리가 수백 개로 읽히기 때문
  const groups = [];
  const grouped = new Set();
  (function walk(node, prefix) {
    const name = node.name || '';
    const path = prefix ? (name ? `${prefix}/${name}` : prefix) : name;
    const meshes = (node.meshes || []).filter(mi => !grouped.has(mi));
    meshes.forEach(mi => grouped.add(mi));
    const unnamed = meshes.filter(mi => !result.meshes[mi].name);
    for (const mi of meshes) if (result.meshes[mi].name) groups.push({ path, name: '', meshes: [mi] });
    if (unnamed.length) groups.push({ path, name, meshes: unnamed });
    for (const c of node.children || []) walk(c, path);
  })(result.root || {}, '');
  result.meshes.forEach((m, i) => { if (!grouped.has(i)) groups.push({ path: '', name: '', meshes: [i] }); });

  const parts = groups.map(grp => {
    const ms = grp.meshes.map(i => result.meshes[i]);
    const hasNormals = ms.every(m => m.normal);
    const colorOf = m => (m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]).getHex() : null);
    let pos, nrm, idx;
    const brepFaces = [];
    const ranges = []; // 합친 경우 메쉬별 위치 — 예전 장면의 메쉬 단위 노드를 위해
    if (ms.length === 1) {
      ({ position: pos, normal: nrm, index: idx } = ms[0]);
      for (const f of ms[0].brep_faces || []) brepFaces.push({ first: f.first, last: f.last });
    } else {
      const vCount = ms.reduce((s, m) => s + m.position.length / 3, 0);
      const iCount = ms.reduce((s, m) => s + m.index.length, 0);
      pos = new Float32Array(vCount * 3); nrm = new Float32Array(vCount * 3); idx = new Uint32Array(iCount);
      let vo = 0, io = 0;
      ms.forEach((m, j) => {
        pos.set(m.position, vo * 3);
        if (hasNormals) nrm.set(m.normal, vo * 3);
        for (let k = 0; k < m.index.length; k++) idx[io + k] = m.index[k] + vo;
        const triOffset = io / 3;
        for (const f of m.brep_faces || []) brepFaces.push({ first: f.first + triOffset, last: f.last + triOffset });
        ranges.push({
          meshIndex: grp.meshes[j], vo, vCount: m.position.length / 3, io, iCount: m.index.length,
          brepFaces: (m.brep_faces || []).map(f => ({ first: f.first, last: f.last })), color: colorOf(m),
        });
        vo += m.position.length / 3;
        io += m.index.length;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (hasNormals) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (!hasNormals) g.computeVertexNormals();
    const first = ms[0];
    return {
      meshIndex: grp.meshes[0],   // 노드가 참조하는 키 (이전 버전과 같은 번호)
      meshIndices: grp.meshes,
      name: grp.name || first.name || grp.path.split('/').pop() || `part_${grp.meshes[0] + 1}`,
      path: grp.path,
      geometry: g,
      brepFaces,
      ranges,
      color: colorOf(first),
    };
  });
  // 같은 이름 파트가 여럿이면 _1, _2 ... 를 붙여 구분
  const count = new Map();
  for (const p of parts) count.set(p.name, (count.get(p.name) || 0) + 1);
  const seen = new Map();
  for (const p of parts) {
    if (count.get(p.name) < 2) continue;
    const k = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, k);
    p.name = `${p.name}_${k}`;
  }
  sources.set(key, { name: key, parts });
  return parts;
}

// --- IndexedDB (원본 STEP 바이트 보관) ---

const DB_NAME = 'cad_modeler';
const STORE = 'step_files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBytes(key, bytes) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.warn('STEP 캐시 저장 실패:', err);
  }
}

export async function loadBytes(key) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (err) {
    console.warn('STEP 캐시 읽기 실패:', err);
    return null;
  }
}

// 노드 목록이 참조하는 STEP 소스 중 아직 메모리에 없는 것을 캐시(또는 url)에서 복원.
// 반환: 복원하지 못한 소스 키 목록
export async function restoreSources(nodes) {
  const needed = new Map();
  for (const n of nodes) {
    if (n.type === 'step' && !sources.has(n.source)) needed.set(n.source, n.url || null);
  }
  const missing = [];
  for (const [key, url] of needed) {
    let bytes = await loadBytes(key);
    if (!bytes && url) {
      try {
        const r = await fetch(url);
        if (r.ok) bytes = await r.arrayBuffer();
      } catch { /* 아래에서 missing 처리 */ }
    }
    if (!bytes) { missing.push(key); continue; }
    try { await parseStep(key, bytes); }
    catch (err) { console.error(err); missing.push(key); }
  }
  return missing;
}
