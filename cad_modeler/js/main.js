import * as THREE from 'three';
import { initScene, setGridVisible } from './scene.js';
import { defaultParams, PRIMITIVE_FIELDS, isBooleanNode } from './kernel.js';
import { attachMeshGroup, rebuildScene, highlightSelection, frameAll, pickMeshAt, getMeshGroup } from './visualize.js';
import { History, cmdAddNode, cmdDeleteNode, cmdBoolean, cmdReplaceState } from './history.js';
import { renderOutliner } from './outliner.js';
import { TransformPanel } from './transform.js';
import { serialize, deserialize, downloadJSON } from './persistence.js';
import { exportSTL, exportSTEP } from './exporters.js';

const state = {
  nodes: [],
  selection: [],
  nextId: 1,
};

const canvas = document.getElementById('viewer-canvas');
const ctx = initScene(canvas);
attachMeshGroup(ctx.scene);

const treeEl = document.getElementById('tree-container');
const statusText = document.getElementById('status-text');
const statusCount = document.getElementById('status-count');

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

function redraw() {
  rebuildScene(state);
  highlightSelection(state.selection);
  renderOutliner(treeEl, state, makeOutlinerCallbacks());
  tpanel.refresh();
  updateStatus();
}

function updateStatus() {
  const total = state.nodes.length;
  statusCount.textContent = `${total}개 도형${state.selection.length ? ` · ${state.selection.length}개 선택` : ''}`;
}

// --- 도구바 액션 ---

const toolbar = document.getElementById('toolbar');
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
    case 'undo': history.undo(); break;
    case 'redo': history.redo(); break;
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
        exportSTL(state, 'scene.stl');
        toast('STL 내보내기 완료', 'success');
      } catch (err) { toast('STL 내보내기 실패: ' + err.message, 'error'); }
      break;
    case 'export-step':
      try {
        if (state.nodes.length === 0) throw new Error('내보낼 도형이 없습니다');
        const r = exportSTEP(state, 'scene.step');
        toast(`STEP 내보내기 완료 (${r.triangleCount}개 삼각형, ${r.breps}개 솔리드)`, 'success');
      } catch (err) {
        console.error(err);
        toast('STEP 내보내기 실패: ' + err.message, 'error');
      }
      break;
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
  }
}

// --- Primitive 다이얼로그 ---

const dialog = document.getElementById('prim-dialog');
const dlgTitle = document.getElementById('prim-title');
const dlgFields = document.getElementById('prim-fields');
let _pendingType = null;

document.getElementById('prim-cancel').addEventListener('click', () => closePrimDialog());
document.getElementById('prim-ok').addEventListener('click', () => confirmPrimDialog());
dialog.addEventListener('click', e => { if (e.target === dialog) closePrimDialog(); });

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

// --- 마우스 픽킹 ---

const raycaster = new THREE.Raycaster();
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
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
    highlightSelection(state.selection);
    renderOutliner(treeEl, state, makeOutlinerCallbacks());
    tpanel.refresh();
    updateStatus();
  };
  canvas.addEventListener('pointerup', onUp);
});

function makeOutlinerCallbacks() {
  // 한 곳에서 콜백 빌더 — outliner click handler가 redraw 의 인자에 의존하지 않도록
  return {
    onSelect: (id, multi) => {
      if (multi) {
        if (state.selection.includes(id)) state.selection = state.selection.filter(x => x !== id);
        else state.selection.push(id);
      } else {
        state.selection = [id];
      }
      highlightSelection(state.selection);
      renderOutliner(treeEl, state, makeOutlinerCallbacks());
      tpanel.refresh();
      updateStatus();
    },
    onToggleVisibility: (id) => {
      history.apply({
        label: 'Toggle visibility',
        do: (s) => { const x = s.nodes.find(y => y.id === id); if (x) x.visible = !(x.visible !== false); },
        undo: (s) => { const x = s.nodes.find(y => y.id === id); if (x) x.visible = !(x.visible !== false); },
      });
    },
    onRename: (id) => {
      const n = state.nodes.find(x => x.id === id);
      if (!n) return;
      const next = prompt('새 이름', n.name || n.type);
      if (next === null) return;
      history.apply({
        label: 'Rename',
        do: (s) => { const x = s.nodes.find(y => y.id === id); if (x) { x._prevName = x.name; x.name = next; } },
        undo: (s) => { const x = s.nodes.find(y => y.id === id); if (x) { x.name = x._prevName; delete x._prevName; } },
      });
    },
  };
}

// --- 사이드바 푸터 버튼 ---

document.getElementById('btn-rename').addEventListener('click', () => {
  const id = state.selection[0]; if (!id) return;
  makeOutlinerCallbacks().onRename(id);
});
document.getElementById('btn-toggle-vis').addEventListener('click', () => {
  for (const id of state.selection) makeOutlinerCallbacks().onToggleVisibility(id);
});
document.getElementById('btn-delete').addEventListener('click', () => deleteSelection());

function deleteSelection() {
  if (state.selection.length === 0) return;
  for (const id of [...state.selection]) {
    history.apply(cmdDeleteNode(id));
  }
}

// --- 단축키 ---

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
  else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); history.redo(); }
  else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); downloadJSON(state, 'scene.json'); toast('저장 완료', 'success'); }
  else if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); document.getElementById('json-file-input').click(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); frameAll(ctx.camera, ctx.controls); }
});

// --- JSON 파일 입력 ---

document.getElementById('json-file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const next = deserialize(text);
    history.apply(cmdReplaceState(next));
    frameAll(ctx.camera, ctx.controls);
    toast(`불러오기 완료 (${next.nodes.length}개 도형)`, 'success');
  } catch (err) {
    toast('불러오기 실패: ' + err.message, 'error');
  }
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
  setTimeout(() => t.remove(), 2400);
}
window.__toast = toast;

// --- 부팅 ---

// 디버그/검증용: 외부에서 카메라 프레이밍 호출 가능
window.__cad = { state, history, frameAll: () => frameAll(ctx.camera, ctx.controls), ctx };

function boot() {
  document.getElementById('loading-overlay').classList.add('hidden');
  redraw();
  statusText.textContent = '준비됨 — 도구바에서 도형을 추가하세요';
}
if (document.readyState === 'complete') boot();
else window.addEventListener('load', boot);

