// 좌측 Outliner 트리: 노드 리스트 표시, 선택, 표시/숨김 토글
import { isBooleanNode } from './kernel.js';

const ICONS = {
  box: '□',
  cylinder: '○',
  sphere: '●',
  cone: '▲',
  boolean: '⋈',
};

export function renderOutliner(container, state, callbacks) {
  container.innerHTML = '';
  if (state.nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '12px';
    empty.style.color = '#666';
    empty.style.fontSize = '12px';
    empty.textContent = '도형 없음 — 도구바에서 추가';
    container.appendChild(empty);
    return;
  }

  // boolean에 의해 소비된 자식 도형은 들여쓰기 없이 따로 표시하지 않고,
  // boolean 노드 아래에 자식 형태로 보여준다.
  const consumedBy = new Map(); // childId -> parentId
  for (const n of state.nodes) {
    if (isBooleanNode(n)) {
      consumedBy.set(n.a, n.id);
      consumedBy.set(n.b, n.id);
    }
  }

  for (const node of state.nodes) {
    if (consumedBy.has(node.id)) continue; // child 로 표시
    container.appendChild(renderNode(node, state, callbacks, consumedBy, 0));
  }
}

function renderNode(node, state, cb, consumedBy, depth) {
  const row = document.createElement('div');
  row.className = 'tree-node';
  if (state.selection.includes(node.id)) row.classList.add('selected');
  if (node.visible === false) row.classList.add('hidden-node');
  row.style.paddingLeft = `${12 + depth * 14}px`;

  const icon = document.createElement('span');
  icon.className = 'node-icon';
  icon.textContent = isBooleanNode(node) ? ICONS.boolean : (ICONS[node.type] || '◆');
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = node.name || `${node.type}_${node.id}`;
  if (isBooleanNode(node)) name.textContent += ` (${node.op})`;
  row.appendChild(name);

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

  if (isBooleanNode(node)) {
    for (const childId of [node.a, node.b]) {
      const child = state.nodes.find(n => n.id === childId);
      if (child) wrap.appendChild(renderNode(child, state, cb, consumedBy, depth + 1));
    }
  }
  return wrap;
}
