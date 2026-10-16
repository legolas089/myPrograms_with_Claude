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

export function getPart(key, meshIndex) {
  const src = sources.get(key);
  if (!src) return null;
  return src.parts.find(p => p.meshIndex === meshIndex) || null;
}

// 같은 이름의 파일을 다시 넣으면 name#2, name#3 ... 으로 구분
export function uniqueKey(name) {
  if (!sources.has(name)) return name;
  let i = 2;
  while (sources.has(`${name}#${i}`)) i++;
  return `${name}#${i}`;
}

// STEP 바이트를 파싱하여 sources 에 등록. 반환: 파트 목록
export async function parseStep(key, bytes) {
  const occt = await loadOcct();
  const result = occt.ReadStepFile(new Uint8Array(bytes), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    // 0.25 rad(≈14°) → 작은 구멍도 원 하나가 25분할 이상이 되어 원형 모서리 인식·간섭 계산이 정확해진다
    angularDeflection: 0.25,
  });
  if (!result.success) throw new Error('STEP 파일을 읽지 못했습니다');

  // 트리를 순회하며 mesh index 마다 경로 이름을 붙인다
  const pathOf = new Map();
  (function walk(node, prefix) {
    const name = node.name || '';
    const path = prefix ? (name ? `${prefix}/${name}` : prefix) : name;
    for (const mi of node.meshes || []) if (!pathOf.has(mi)) pathOf.set(mi, path);
    for (const c of node.children || []) walk(c, path);
  })(result.root || {}, '');

  const parts = [];
  result.meshes.forEach((m, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array), 1));
    if (!m.attributes.normal) g.computeVertexNormals();
    const path = pathOf.get(i) || '';
    const leaf = m.name || path.split('/').pop() || `part_${i + 1}`;
    parts.push({
      meshIndex: i,
      name: leaf,
      path,
      geometry: g,
      brepFaces: (m.brep_faces || []).map(f => ({ first: f.first, last: f.last })),
      color: m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]).getHex() : null,
    });
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
