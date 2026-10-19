// 좌측 Outliner 트리: 노드 리스트 표시, 선택, 표시/숨김 토글
// STEP 참조 파트는 원본 파일 단위로 접을 수 있는 그룹으로 묶어 보여준다.
import { isBooleanNode, isStepNode, nodeInputs } from './kernel.js';
import { hasSource } from './stepstore.js';

const ICONS = {
  box: '□',
  cylinder: '○',
  revolve: '◎',
  pattern: '❋',
  sphere: '●',
  cone: '▲',
  extrude: '⬒',
  boolean: '⋈',
  step: '⬡',
};

const collapsed = new Set(); // 접힌 STEP 그룹(source key)

export function renderOutliner(container, state, callbacks) {
  const scroll = container.scrollTop;
  container.innerHTML = '';
  if (state.nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '12px';
    empty.style.color = '#666';
    empty.style.fontSize = '12px';
    empty.textContent = '도형 없음 — 도구바에서 추가하거나 STEP 파일을 끌어다 놓으세요';
    container.appendChild(empty);
    return;
  }

  // boolean에 의해 소비된 자식 도형은 boolean 노드 아래에 자식 형태로 보여준다.
  const consumedBy = new Map(); // childId -> parentId
  for (const n of state.nodes) {
    if (nodeInputs(n).length) {
      for (const id of nodeInputs(n)) consumedBy.set(id, n.id);
    }
  }

  const groupsDone = new Set();
  for (const node of state.nodes) {
    if (consumedBy.has(node.id)) continue; // child 로 표시
    if (isStepNode(node)) {
      if (groupsDone.has(node.source)) continue;
      groupsDone.add(node.source);
      const members = state.nodes.filter(n => isStepNode(n) && n.source === node.source && !consumedBy.has(n.id));
      container.appendChild(renderStepGroup(node.source, members, state, callbacks, consumedBy));
      continue;
    }
    container.appendChild(renderNode(node, state, callbacks, consumedBy, 0));
  }
  container.scrollTop = scroll;
}

function renderStepGroup(source, members, state, cb, consumedBy) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'tree-node tree-group';
  const ids = members.map(m => m.id);
  if (ids.length && ids.every(id => state.selection.includes(id))) row.classList.add('selected');
  if (members.every(m => m.visible === false)) row.classList.add('hidden-node');

  const isCollapsed = collapsed.has(source);
  const arrow = document.createElement('span');
  arrow.className = 'node-arrow';
  arrow.textContent = isCollapsed ? '▸' : '▾';
  arrow.addEventListener('click', e => {
    e.stopPropagation();
    if (collapsed.has(source)) collapsed.delete(source); else collapsed.add(source);
    cb.onRerender();
  });
  row.appendChild(arrow);

  const icon = document.createElement('span');
  icon.className = 'node-icon';
  icon.textContent = '📦';
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = `${source} (${members.length})`;
  if (!hasSource(source)) {
    name.textContent += ' — 파일 필요';
    row.classList.add('missing');
    row.title = '원본 STEP 파일을 다시 불러오면 연결됩니다';
  }
  row.appendChild(name);

  const vis = document.createElement('button');
  vis.className = 'vis-toggle';
  const anyVisible = members.some(m => m.visible !== false);
  vis.textContent = anyVisible ? '◉' : '◌';
  vis.title = anyVisible ? '전체 숨김' : '전체 표시';
  vis.addEventListener('click', e => {
    e.stopPropagation();
    cb.onSetVisibility(ids, !anyVisible);
  });
  row.appendChild(vis);

  row.addEventListener('click', e => cb.onSelectMany(ids, e.ctrlKey || e.metaKey));
  wrap.appendChild(row);

  if (!isCollapsed) {
    for (const m of members) wrap.appendChild(renderNode(m, state, cb, consumedBy, 1));
  }
  return wrap;
}

function renderNode(node, state, cb, consumedBy, depth) {
  const row = document.createElement('div');
  row.className = 'tree-node';
  if (state.selection.includes(node.id)) row.classList.add('selected');
  if (node.visible === false) row.classList.add('hidden-node');
  row.style.paddingLeft = `${12 + depth * 14}px`;
  if (isStepNode(node) && node.path) row.title = node.path;

  const icon = document.createElement('span');
  icon.className = 'node-icon';
  icon.textContent = isBooleanNode(node) ? ICONS.boolean : (ICONS[node.type] || '◆');
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = node.name || `${node.type}_${node.id}`;
  if (isBooleanNode(node)) name.textContent += ` (${node.op})`;
  if (node.type === 'pattern') name.textContent += ` (×${node.params?.count})`;
  row.appendChild(name);

  // 형상 검사 결과 (health.js) — 오류는 빨강, 경고는 주황, 마우스를 올리면 내용
  const report = cb.healthOf ? cb.healthOf(node) : null;
  if (report && report.issues.length) {
    const err = report.issues.some(i => i.level === 'error');
    const warn = document.createElement('span');
    warn.className = `node-warn ${err ? 'error' : 'warn'}`;
    warn.textContent = '⚠';
    warn.title = report.issues.map(i => `[${i.level === 'error' ? '오류' : '경고'}] ${i.message}`).join('\n');
    row.appendChild(warn);
  }

  const idTag = document.createElement('span');
  idTag.className = 'node-id';
  idTag.textContent = node.id;
  row.appendChild(idTag);

  const vis = document.createElement('button');
  vis.className = 'vis-toggle';
  vis.textContent = node.visible === false ? '◌' : '◉';
  vis.title = node.visible === false ? '표시' : '숨김';
  vis.addEventListener('click', e => {
    e.stopPropagation();
    cb.onToggleVisibility(node.id);
  });
  row.appendChild(vis);

  row.addEventListener('click', e => {
    cb.onSelect(node.id, e.ctrlKey || e.metaKey);
  });
  row.addEventListener('dblclick', e => {
    e.stopPropagation();
    cb.onRename(node.id);
  });

  const wrap = document.createElement('div');
  wrap.appendChild(row);

  if (nodeInputs(node).length) {
    for (const childId of nodeInputs(node)) {
      const child = state.nodes.find(n => n.id === childId);
      if (child) wrap.appendChild(renderNode(child, state, cb, consumedBy, depth + 1));
    }
  }
  return wrap;
}
