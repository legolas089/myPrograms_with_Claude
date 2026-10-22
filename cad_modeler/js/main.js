import * as THREE from 'three';
import { initScene, setGridVisible, fitGrid } from './scene.js';
import { defaultParams, PRIMITIVE_FIELDS, evaluateNode, isStepNode, nodeInputs } from './kernel.js';
import {
  attachMeshGroup, rebuildScene, highlightSelection, frameAll, frameBox, pickMeshAt,
  getMeshForNode, getSceneBox, setStepOpacity, updateGhosts, getGhostForNode,
} from './visualize.js';
import { History, cmdAddNode, cmdAddNodes, cmdBoolean, cmdReplaceState, cmdSetTransforms } from './history.js';
import { renderOutliner } from './outliner.js';
import { TransformPanel } from './transform.js';
import { serialize, deserialize, downloadJSON } from './persistence.js';
import { exportSTL, exportSTEP, stepExportPlan } from './exporters.js';
import { parseStep, saveBytes, uniqueKey, hasSource, restoreSources, migrateStepNodes } from './stepstore.js';
import { Gizmo } from './gizmo.js';
import { Measure } from './measure.js';
import { createApi } from './api.js';
import { checkNode, cachedReport } from './health.js';
import { checkRules } from './params.js';

const state = {
  nodes: [],
  selection: [],
  nextId: 1,
  params: {},     // 설계 파라미터 (params.js)
  sketches: {},
  rules: [],
  specs: [],     // 도면 치수 검증표
};

const canvas = document.getElementById('viewer-canvas');
const ctx = initScene(canvas);
attachMeshGroup(ctx.scene);

const treeEl = document.getElementById('tree-container');
const statusText = document.getElementById('status-text');
const statusCount = document.getElementById('status-count');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const tpanel = new TransformPanel({
  title: document.getElementById('tp-title'),
  px: document.getElementById('tp-px'), py: document.getElementById('tp-py'), pz: document.getElementById('tp-pz'),
  rx: document.getElementById('tp-rx'), ry: document.getElementById('tp-ry'), rz: document.getElementById('tp-rz'),
  sx: document.getElementById('tp-sx'), sy: document.getElementById('tp-sy'), sz: document.getElementById('tp-sz'),
  params: document.getElementById('tp-params'),
  dims: document.getElementById('tp-dims'),
}, state, /*history (set later)*/ null, redraw);

const history = new History(state, redraw);
tpanel.history = history;

// 선택 노드의 세계 bbox — 그려진 메쉬가 있으면 그것, 없으면 평가
function nodeBox(id) {
  const mesh = getMeshForNode(id);
  if (mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox.clone();
  }
  const node = state.nodes.find(n => n.id === id);
  if (!node) return null;
  try {
    const g = evaluateNode(node, new Map(state.nodes.map(n => [n.id, n])));
    if (!g) return null;
    g.computeBoundingBox();
    const b = g.boundingBox.clone();
    g.dispose();
    return b;
  } catch { return null; }
}

const gizmo = new Gizmo({
  ctx, state,
  // 미리보기용: 실제 메쉬가 없으면(Boolean 입력) 선택 윤곽선을 움직인다
  getMesh: id => getMeshForNode(id) || getGhostForNode(id),
  getNodeBox: nodeBox,
  onCommit: updates => history.apply(cmdSetTransforms(updates, 'Gizmo')),
});

const measure = new Measure(ctx, {
  panel: document.getElementById('measure-panel'),
  step1: document.getElementById('m-step1'),
  step2: document.getElementById('m-step2'),
  info1: document.getElementById('m-info1'),
  info2: document.getElementById('m-info2'),
  result: document.getElementById('measure-result'),
  viewer: document.getElementById('viewer-container'),
});

function redraw() {
  rebuildScene(state);
  fitGrid(ctx.scene, getSceneBox());
  refreshSelectionUI();
  measure.onSceneRebuilt();
  scheduleHealth();
}

// --- 파라미터 패널: 값을 바꾸면 수식으로 연결된 치수가 모두 따라 바뀐다 (params.js) ---

const paramsEl = document.getElementById('params-panel');
function renderParamsPanel() {
  const entries = Object.entries(state.params || {});
  paramsEl.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = `파라미터 (${entries.length})`;
  paramsEl.appendChild(h);
  if (!entries.length) {
    const e = document.createElement('div');
    e.className = 'pp-empty';
    e.textContent = '없음 — cad.params({...}) 로 정의';
    paramsEl.appendChild(e);
    return;
  }
  for (const [name, p] of entries) {
    const row = document.createElement('div');
    row.className = 'pp-row';
    const lbl = document.createElement('span');
    lbl.className = 'pp-name';
    lbl.textContent = name;
    lbl.title = p.note || name;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = p.value;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) { inp.value = p.value; return; }
      try {
        const r = api.params({ [name]: v });
        const c = r.check;
        const bad = r.formulaErrors.length || (c && !c.ok);
        toast(`${name} = ${v} → 노드 ${r.changed.length}개 갱신`
          + (r.healed ? ` · 메쉬 수치 문제 회피: ${r.healed.param} ${r.healed.from}→${r.healed.to}` : '')
          + (r.formulaErrors.length ? ` · 수식 오류 ${r.formulaErrors.length}` : '')
          + (c ? (c.ok ? ' · ✓ 형상 정상' : ` · ⚠ 오류 ${c.errors} 경고 ${c.warnings}: ${c.issues[0].message}`) : ''), bad ? 'error' : 'success');
      } catch (err) {
        inp.value = p.value;
        toast(err.message, 'error');
      }
    });
    const unit = document.createElement('span');
    unit.className = 'pp-unit';
    unit.textContent = p.unit || '';
    row.append(lbl, inp, unit);
    paramsEl.appendChild(row);
  }
  for (const r of checkRules(state)) {
    const e = document.createElement('div');
    e.className = 'pp-rule bad';
    e.textContent = `⚠ ${r.expr} — ${r.message}`;
    paramsEl.appendChild(e);
  }
  // 도면 치수 검증표 (마지막 형상 검사 때 계산한 값)
  const sp = healthSummary.specs;
  if (sp && sp.rows.length) {
    const h2 = document.createElement('h3');
    h2.textContent = `도면 치수 검증 (${sp.rows.filter(r => r.ok).length}/${sp.rows.length})`;
    paramsEl.appendChild(h2);
    for (const r of sp.rows) {
      const row = document.createElement('div');
      row.className = `pp-row pp-spec ${r.ok ? 'ok' : 'bad'}`;
      row.title = r.error || `기대 ${r.expect} · 차이 ${r.delta} · 허용 ±${r.tol}${r.note ? ' · ' + r.note : ''}`;
      row.innerHTML = '<span class="pp-name"></span><span class="pp-val"></span><span class="pp-unit"></span>';
      row.children[0].textContent = r.name;
      row.children[1].textContent = r.error ? (r.error.startsWith('측정 위치에 대상이 없음') ? '대상 없음' : '오류') : String(r.actual);
      row.children[2].textContent = r.ok ? '✓' : '✗';
      paramsEl.appendChild(row);
    }
  }
}

// --- 형상 검사 (열린 면·Boolean 실패 등) ---
// 장면이 바뀔 때마다 아직 검사하지 않은 노드를 한 개씩 나눠 검사하고 Outliner 에 ⚠ 로 표시한다.
// 결과는 노드 내용 키로 캐시되므로 보통은 방금 바뀐 노드만 계산한다

let _healthTimer = null, _healthGen = 0;
const healthSummary = { errors: 0, warnings: 0, pending: false, issues: [] };
let _lastIssueSig = '';
function scheduleHealth() {
  clearTimeout(_healthTimer);
  const gen = ++_healthGen;
  healthSummary.pending = true;
  _healthTimer = setTimeout(() => runHealth(gen), 300);
}
async function runHealth(gen) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
  const consumed = new Set(state.nodes.flatMap(nodeInputs));
  for (const n of state.nodes) {
    if (gen !== _healthGen) return;
    const top = !consumed.has(n.id); // 최상위 결과는 위상까지, 입력으로 쓰인 중간 노드는 가볍게
    const cached = cachedReport(n, nodeMap);
    if (cached && (cached.full || !top)) continue;
    try { checkNode(n, nodeMap, new Map(), top); } catch (err) { console.warn('형상 검사 실패:', n.id, err); }
    renderOutliner(treeEl, state, outlinerCallbacks);
    await new Promise(r => setTimeout(r, 0));
  }
  if (gen !== _healthGen) return;
  const issues = [];
  for (const n of state.nodes) {
    const r = cachedReport(n, nodeMap);
    if (r) for (const i of r.issues) issues.push({ id: n.id, name: n.name || n.type, ...i });
  }
  // 도면 치수 검증표도 함께 (파라미터 패널 아래 표시)
  let specs = null;
  if ((state.specs || []).length) { try { specs = api.specs(); } catch (err) { console.warn('검증표 계산 실패:', err); } }
  Object.assign(healthSummary, {
    pending: false, issues, specs,
    errors: issues.filter(i => i.level === 'error').length,
    warnings: issues.filter(i => i.level !== 'error').length,
  });
  renderOutliner(treeEl, state, outlinerCallbacks);
  renderParamsPanel();
  updateStatus();
  const sig = issues.map(i => `${i.id}:${i.code}`).join(',');
  if (sig && sig !== _lastIssueSig) {
    const first = issues.find(i => i.level === 'error') || issues[0];
    toast(`형상 검사: 오류 ${healthSummary.errors} · 경고 ${healthSummary.warnings} — ${first.name}: ${first.message}`, healthSummary.errors ? 'error' : 'info');
  }
  _lastIssueSig = sig;
}
window.__health = healthSummary;

function refreshSelectionUI() {
  highlightSelection(state.selection);
  updateGhosts(state);
  renderOutliner(treeEl, state, outlinerCallbacks);
  renderParamsPanel();
  tpanel.refresh();
  gizmo.refresh();
  updateStatus();
}

function updateStatus() {
  const total = state.nodes.length;
  const missing = new Set(state.nodes.filter(n => isStepNode(n) && !hasSource(n.source)).map(n => n.source));
  statusCount.textContent = `${total}개 노드${state.selection.length ? ` · ${state.selection.length}개 선택` : ''}`
    + (missing.size ? ` · STEP 파일 필요: ${[...missing].join(', ')}` : '')
    + (healthSummary.pending ? ' · 형상 검사 중…'
      : (healthSummary.errors || healthSummary.warnings ? ` · ⚠ 오류 ${healthSummary.errors} · 경고 ${healthSummary.warnings}` : (total ? ' · ✓ 형상 정상' : '')))
    + (healthSummary.specs ? ` · 치수 ${healthSummary.specs.rows.filter(r => r.ok).length}/${healthSummary.specs.rows.length}${healthSummary.specs.ok ? ' ✓' : ' ✗'}` : '');
}

function setStatus(msg) { statusText.textContent = msg; }

function showLoading(msg) {
  loadingText.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}
function hideLoading() { loadingOverlay.classList.add('hidden'); }

// --- 도구바 액션 ---

const toolbar = document.getElementById('toolbar');
// 툴바가 줄바꿈되면 높이가 바뀌므로 떠 있는 패널 위치를 CSS 변수로 맞춘다
new ResizeObserver(() => {
  document.getElementById('viewer-container').style.setProperty('--tb-h', `${toolbar.offsetHeight}px`);
}).observe(toolbar);
toolbar.addEventListener('click', e => {
  const btn = e.target.closest('.tb-btn');
  if (!btn) return;
  handleAction(btn.dataset.action, btn);
});

function handleAction(action, btn) {
  switch (action) {
    case 'add-box': openPrimDialog('box'); break;
    case 'add-cylinder': openPrimDialog('cylinder'); break;
    case 'add-sphere': openPrimDialog('sphere'); break;
    case 'add-cone': openPrimDialog('cone'); break;
    case 'bool-union': doBoolean('union'); break;
    case 'bool-subtract': doBoolean('subtract'); break;
    case 'bool-intersect': doBoolean('intersect'); break;
    case 'gizmo-translate': setGizmoMode(gizmo.mode === 'translate' ? 'off' : 'translate'); break;
    case 'gizmo-rotate': setGizmoMode(gizmo.mode === 'rotate' ? 'off' : 'rotate'); break;
    case 'measure': toggleMeasure(); break;
    case 'to-origin':
      if (!state.selection.length) { toast('원점으로 옮길 도형을 선택하세요', 'error'); break; }
      api.moveTo(state.selection, [0, 0, 0], 'center');
      setView(null);
      break;
    case 'undo': history.undo(); break;
    case 'redo': history.redo(); break;
    case 'new-scene':
      if (state.nodes.length && !confirm('현재 장면을 비우고 새로 시작할까요? (Undo 로 되돌릴 수 있음)')) break;
      history.apply(cmdReplaceState({ nodes: [], nextId: 1, selection: [] }));
      setView('iso'); // 빈 장면 기본 시점 (이전 모델 위치에 머물러 그리드가 아주 작게 보이던 문제)
      setStatus('새 장면');
      break;
    case 'import-step':
      document.getElementById('step-file-input').click();
      break;
    case 'save-json':
      try { downloadJSON(state, 'scene.json'); toast('저장 완료', 'success'); }
      catch (err) { toast('저장 실패: ' + err.message, 'error'); }
      break;
    case 'load-json':
      document.getElementById('json-file-input').click();
      break;
    case 'export-stl':
      try {
        if (state.nodes.length === 0) throw new Error('내보낼 도형이 없습니다');
        const name = exportSTL(state);
        toast(`${name} 저장${state.selection.length ? ' (선택 항목)' : ''}`, 'success');
      } catch (err) { toast('STL 내보내기 실패: ' + err.message, 'error'); }
      break;
    case 'export-step':
      try {
        if (state.nodes.length === 0) throw new Error('내보낼 도형이 없습니다');
        const plan = stepExportPlan(state);
        // 큰 STEP 참조 모델까지 포함하면 파일이 매우 커지고 다른 CAD 에서 열기도 느리다 → 미리 확인
        const tris = plan.nodes.reduce((s, n) => {
          const m = getMeshForNode(n.id);
          return s + (m ? (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 : 0);
        }, 0);
        if (tris > 300000 && !confirm(`${plan.fileName}: 구성품 ${plan.nodes.length}개, 삼각형 약 ${Math.round(tris / 1000)}k개입니다.\n파일이 크고 변환에 시간이 걸릴 수 있습니다. 계속할까요?\n(파트 하나만 내보내려면 먼저 그 파트를 선택하세요)`)) break;
        const r = exportSTEP(state, plan);
        toast(`${r.fileName} 저장 — ${plan.assembly ? `어셈블리 구성품 ${r.components}개, ` : ''}면 ${r.faces}개 (삼각형 ${r.triangles}개)`, 'success');
        if (healthSummary.errors || healthSummary.warnings) {
          toast(`주의: 형상 검사 오류 ${healthSummary.errors} · 경고 ${healthSummary.warnings} 이 남은 채 저장했습니다 (Outliner 의 ⚠ 참고)`, 'error');
        }
      } catch (err) {
        console.error(err);
        toast('STEP 내보내기 실패: ' + err.message, 'error');
      }
      break;
    case 'view-iso': setView('iso'); break;
    case 'view-top': setView('top'); break;
    case 'view-front': setView('front'); break;
    case 'view-right': setView('right'); break;
    case 'view-fit': setView(null); break;
    case 'toggle-grid': {
      const next = btn.dataset.pressed !== 'true';
      btn.dataset.pressed = String(next);
      setGridVisible(ctx.scene, next);
      break;
    }
    case 'toggle-dims': {
      const next = btn.dataset.pressed !== 'true';
      btn.dataset.pressed = String(next);
      tpanel.setDimsVisible(next);
      break;
    }
    case 'toggle-xray': {
      const next = btn.dataset.pressed !== 'true';
      btn.dataset.pressed = String(next);
      setStepOpacity(next ? 0.35 : 1);
      break;
    }
  }
}

function setGizmoMode(mode) {
  gizmo.setMode(mode);
  document.querySelector('[data-action="gizmo-translate"]').dataset.pressed = String(mode === 'translate');
  document.querySelector('[data-action="gizmo-rotate"]').dataset.pressed = String(mode === 'rotate');
}

document.getElementById('snap-input').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  gizmo.setSnap(Number.isFinite(v) ? v : 0, 15);
});

function toggleMeasure(force) {
  const on = force ?? !measure.active;
  measure.setActive(on);
  gizmo.setSuspended(on);
  document.querySelector('[data-action="measure"]').dataset.pressed = String(on);
  setStatus(on ? '측정 모드 — 점/선/면을 차례로 클릭 (Esc 종료)' : '준비됨');
}

const VIEW_DIRS = {
  iso: [0.7, -0.7, 0.6], top: [0, 0, 1], bottom: [0, 0, -1],
  front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0],
};

// name 이 null 이면 현재 시점 방향 유지하고 프레이밍만
function setView(name, ids = null) {
  let box;
  if (ids && ids.length) {
    box = new THREE.Box3();
    for (const id of ids) { const b = nodeBox(id); if (b) box.union(b); }
  } else {
    box = getSceneBox();
  }
  if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
  const dir = name && VIEW_DIRS[name]
    ? new THREE.Vector3(...VIEW_DIRS[name])
    : ctx.camera.position.clone().sub(ctx.controls.target);
  frameBox(ctx.camera, ctx.controls, box, dir);
}

// --- Primitive 다이얼로그 ---

const dialog = document.getElementById('prim-dialog');
const dlgTitle = document.getElementById('prim-title');
const dlgFields = document.getElementById('prim-fields');
let _pendingType = null;

document.getElementById('prim-cancel').addEventListener('click', () => closePrimDialog());
document.getElementById('prim-ok').addEventListener('click', () => confirmPrimDialog());
dialog.addEventListener('click', e => { if (e.target === dialog) closePrimDialog(); });
dlgFields.addEventListener('keydown', e => { if (e.key === 'Enter') confirmPrimDialog(); });

function openPrimDialog(type) {
  _pendingType = type;
  const labels = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', cone: 'Cone' };
  dlgTitle.textContent = `${labels[type]} 추가`;
  const fields = PRIMITIVE_FIELDS[type];
  const params = defaultParams(type);
  dlgFields.innerHTML = '';
  for (const f of fields) {
    const lbl = document.createElement('label');
    lbl.textContent = f.label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = f.step;
    if (f.min !== undefined) inp.min = f.min;
    inp.value = params[f.key];
    inp.dataset.key = f.key;
    if (f.integer) inp.dataset.integer = '1';
    dlgFields.appendChild(lbl);
    dlgFields.appendChild(inp);
  }
  dialog.classList.remove('hidden');
  dlgFields.querySelector('input')?.focus();
}

function closePrimDialog() {
  dialog.classList.add('hidden');
  _pendingType = null;
}

function confirmPrimDialog() {
  if (!_pendingType) return;
  const params = {};
  for (const inp of dlgFields.querySelectorAll('input')) {
    let v = parseFloat(inp.value);
    if (Number.isNaN(v)) v = 0;
    if (inp.dataset.integer) v = Math.round(v);
    if (inp.min !== '' && v < parseFloat(inp.min)) v = parseFloat(inp.min);
    params[inp.dataset.key] = v;
  }
  const id = `n${state.nextId++}`;
  const node = {
    id,
    type: _pendingType,
    params,
    transform: { pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] },
    name: `${_pendingType}_${state.nodes.length + 1}`,
    visible: true,
  };
  history.apply(cmdAddNode(node));
  closePrimDialog();
  // 첫 도형이면 카메라 자동 프레이밍
  if (state.nodes.length === 1) frameAll(ctx.camera, ctx.controls);
}

// --- Boolean ---

function doBoolean(opName) {
  if (state.selection.length !== 2) {
    toast('두 개의 도형을 선택해 주세요 (Ctrl+클릭)', 'error');
    return;
  }
  const [aId, bId] = state.selection;
  const id = `n${state.nextId++}`;
  history.apply(cmdBoolean(opName, aId, bId, id, (op) => `${op}_${state.nodes.length + 1}`));
  toast(`Boolean ${opName} 완료`, 'success');
}

// --- STEP 가져오기 ---

async function importStepBytes(fileName, bytes, url = null) {
  showLoading(`STEP 읽는 중: ${fileName} (최초 1회 OCCT 커널 다운로드)`);
  try {
    // 장면이 이 파일 이름을 이미 참조하는데 원본이 없으면 → 다시 연결만
    const relink = state.nodes.some(n => isStepNode(n) && n.source === fileName) && !hasSource(fileName);
    const key = relink ? fileName : uniqueKey(fileName);
    const parts = await parseStep(key, bytes);
    await saveBytes(key, bytes);
    if (relink) {
      migrateStepNodes(state.nodes);
      redraw();
      toast(`${fileName} 다시 연결됨`, 'success');
      return state.nodes.filter(n => isStepNode(n) && n.source === key).map(n => n.id);
    }
    const nodes = parts.map(p => ({
      id: `n${state.nextId++}`,
      type: 'step',
      source: key,
      url,
      mesh: p.meshIndex,
      ...(p.meshIndices.length > 1 ? { merged: true } : {}),
      name: p.name,
      path: p.path,
      transform: { pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] },
      visible: true,
    }));
    history.apply(cmdAddNodes(nodes, `Import ${key}`));
    setView('iso');
    const box = getSceneBox().getSize(new THREE.Vector3());
    toast(`${key}: ${parts.length}개 파트 (${box.x.toFixed(1)} × ${box.y.toFixed(1)} × ${box.z.toFixed(1)} mm)`, 'success');
    return nodes.map(n => n.id);
  } catch (err) {
    console.error(err);
    toast('STEP 불러오기 실패: ' + err.message, 'error');
    throw err;
  } finally {
    hideLoading();
  }
}

async function importStepFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
  return importStepBytes(name, await r.arrayBuffer(), url);
}

async function importFiles(files) {
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'step' || ext === 'stp') {
      await importStepBytes(file.name, await file.arrayBuffer()).catch(() => {});
    } else if (ext === 'json') {
      await loadSceneJSON(await file.text());
    } else {
      toast(`지원하지 않는 파일: ${file.name}`, 'error');
    }
  }
}

document.getElementById('step-file-input').addEventListener('change', async e => {
  await importFiles([...e.target.files]);
  e.target.value = '';
});

// 드래그 & 드롭 (STEP / JSON)
const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; dropOverlay.classList.add('active'); });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', e => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('active'); }
});
document.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('active');
  await importFiles([...e.dataTransfer.files]);
});

// --- 마우스 픽킹 ---

const raycaster = new THREE.Raycaster();
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (measure.active || gizmo.isActive()) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  // 드래그와 구분: pointerup 까지 이동량 추적
  const startX = e.clientX, startY = e.clientY;
  const onUp = (eu) => {
    canvas.removeEventListener('pointerup', onUp);
    const moved = Math.hypot(eu.clientX - startX, eu.clientY - startY);
    if (moved > 4) return;
    const hit = pickMeshAt(ctx.camera, raycaster, ndc);
    if (hit) {
      const id = hit.object.userData.nodeId;
      if (eu.ctrlKey || eu.metaKey) {
        if (state.selection.includes(id)) state.selection = state.selection.filter(x => x !== id);
        else state.selection.push(id);
      } else {
        state.selection = [id];
      }
    } else if (!(eu.ctrlKey || eu.metaKey)) {
      state.selection = [];
    }
    refreshSelectionUI();
  };
  canvas.addEventListener('pointerup', onUp);
});

const outlinerCallbacks = {
  onSelect: (id, multi) => {
    if (multi) {
      if (state.selection.includes(id)) state.selection = state.selection.filter(x => x !== id);
      else state.selection.push(id);
    } else {
      state.selection = [id];
    }
    refreshSelectionUI();
  },
  onSelectMany: (ids, multi) => {
    state.selection = multi ? [...new Set([...state.selection, ...ids])] : [...ids];
    refreshSelectionUI();
  },
  onRerender: () => renderOutliner(treeEl, state, outlinerCallbacks),
  healthOf: (node) => cachedReport(node, new Map(state.nodes.map(n => [n.id, n]))),
  onToggleVisibility: (id) => {
    history.apply({
      label: 'Toggle visibility',
      do: (s) => { const x = s.nodes.find(y => y.id === id); if (x) x.visible = !(x.visible !== false); },
      undo: (s) => { const x = s.nodes.find(y => y.id === id); if (x) x.visible = !(x.visible !== false); },
    });
  },
  onSetVisibility: (ids, visible) => {
    const prev = new Map();
    history.apply({
      label: 'Set visibility',
      do: (s) => { for (const x of s.nodes) if (ids.includes(x.id)) { prev.set(x.id, x.visible); x.visible = visible; } },
      undo: (s) => { for (const x of s.nodes) if (prev.has(x.id)) x.visible = prev.get(x.id); },
    });
  },
  onRename: (id) => {
    const n = state.nodes.find(x => x.id === id);
    if (!n) return;
    const next = prompt('새 이름', n.name || n.type);
    if (next === null) return;
    history.apply({
      label: 'Rename',
      // 이전 값은 명령 안에 보관 — 노드에 두면 연속 변경 시 덮어써져 Undo 가 깨진다
      prev: undefined,
      do(s) { const x = s.nodes.find(y => y.id === id); if (x) { this.prev = x.name; x.name = next; } },
      undo(s) { const x = s.nodes.find(y => y.id === id); if (x) x.name = this.prev; },
    });
  },
};

// --- 사이드바 푸터 버튼 ---

document.getElementById('btn-rename').addEventListener('click', () => {
  const id = state.selection[0]; if (!id) return;
  outlinerCallbacks.onRename(id);
});
document.getElementById('btn-toggle-vis').addEventListener('click', () => {
  for (const id of [...state.selection]) outlinerCallbacks.onToggleVisibility(id);
});
document.getElementById('btn-delete').addEventListener('click', () => deleteSelection());

function deleteSelection() {
  if (state.selection.length === 0) return;
  const blocked = api.remove(...state.selection);
  if (blocked.length) toast(`Boolean 의 입력 도형은 지울 수 없습니다 (${blocked.join(', ')}) — Boolean 을 먼저 지우세요`, 'error');
}

// --- 측정 패널: 선택한 두 노드 사이 최소거리 / 간섭 ---

document.getElementById('btn-node-distance').addEventListener('click', () => {
  const el = document.getElementById('node-distance-result');
  if (state.selection.length !== 2) {
    el.textContent = '도형 2개를 선택하세요 (측정 모드 밖에서 Ctrl+클릭)';
    return;
  }
  try {
    const r = api.distance(state.selection[0], state.selection[1]);
    el.innerHTML = r.intersects
      ? `<span class="bad">간섭 있음${r.overlapVolume ? ` — 겹친 체적 ${r.overlapVolume.toFixed(2)} mm³` : ''}</span>`
      : r.touching ? '접촉 (거리 0)' : `최소거리 <b>${r.distance.toFixed(3)} mm</b>`;
  } catch (err) {
    el.textContent = '계산 실패: ' + err.message;
  }
});

// --- 단축키 ---

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
  else if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) { e.preventDefault(); history.redo(); }
  else if (ctrl && k === 's') { e.preventDefault(); downloadJSON(state, 'scene.json'); toast('저장 완료', 'success'); }
  else if (ctrl && k === 'o') { e.preventDefault(); document.getElementById('json-file-input').click(); }
  else if (ctrl) return;
  else if (e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
  else if (k === 'f') { e.preventDefault(); setView(null); }
  else if (k === 'w') setGizmoMode(gizmo.mode === 'translate' ? 'off' : 'translate');
  else if (k === 'e') setGizmoMode(gizmo.mode === 'rotate' ? 'off' : 'rotate');
  else if (k === 'm') toggleMeasure();
  else if (e.key === 'Escape') {
    if (measure.active) toggleMeasure(false);
    else { state.selection = []; refreshSelectionUI(); }
  }
  else if (e.key === '1') setView('front');
  else if (e.key === '3') setView('right');
  else if (e.key === '7') setView('top');
  else if (e.key === '0') setView('iso');
});

// --- JSON 파일 입력 ---

async function loadSceneJSON(text) {
  try {
    const next = deserialize(text);
    const missing = await restoreSources(next.nodes);
    migrateStepNodes(next.nodes);
    history.apply(cmdReplaceState(next));
    setView('iso');
    toast(`불러오기 완료 (${next.nodes.length}개 노드)`, 'success');
    if (missing.length) toast(`STEP 파일을 다시 불러오세요: ${missing.join(', ')}`, 'error');
  } catch (err) {
    toast('불러오기 실패: ' + err.message, 'error');
  }
}

document.getElementById('json-file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadSceneJSON(await file.text());
  e.target.value = '';
});

// --- Toast ---

let toastContainer = null;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}
export function toast(msg, kind = 'info') {
  const c = ensureToastContainer();
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2800);
}
window.__toast = toast;

// --- 스크립트 API ---

const api = createApi({ state, history, redraw, importStepFromUrl, measure, setView, toast });
window.cad = api;
// 디버그/검증용
window.__cad = { state, history, ctx, gizmo, measure, frameAll: () => frameAll(ctx.camera, ctx.controls) };

// --- 부팅 ---
// 페이지를 열 때마다 빈 장면으로 시작한다. 이어서 작업할 때는 저장해 둔 STEP 을 다시 불러온다 (AGENTS.md)

async function boot() {
  try { localStorage.removeItem('cad_modeler_autosave_v1'); } catch { /* 예전 자동 저장 정리 */ }
  hideLoading();
  redraw();
  setGizmoMode('translate');
  setStatus('준비됨 — 도형을 추가하거나 STEP 파일을 끌어다 놓으세요');
}
if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot);
