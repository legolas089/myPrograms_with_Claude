let currentSelectedRow = null;

export function buildTree(rootNode, container, onSelectCallback) {
  container.innerHTML = '';
  if (!rootNode) return;

  const ul = document.createElement('ul');
  buildNodeElement(rootNode, ul, '', onSelectCallback, 0);
  container.appendChild(ul);

  // Event delegation
  container.addEventListener('click', (e) => {
    const toggle = e.target.closest('.tree-toggle');
    if (toggle && !toggle.classList.contains('leaf')) {
      toggle.classList.toggle('expanded');
      const li = toggle.closest('.tree-node');
      const childUl = li.querySelector(':scope > ul');
      if (childUl) {
        childUl.style.display = childUl.style.display === 'none' ? '' : 'none';
      }
      return;
    }

    const row = e.target.closest('.tree-row');
    if (row) {
      const partId = row.dataset.partId;
      if (partId) {
        onSelectCallback(partId);
      }
    }
  });
}

let nodeCounter = 0;

function buildNodeElement(node, parentUl, pathPrefix, onSelectCallback, depth) {
  const name = node.name || `Part_${nodeCounter++}`;
  const partId = pathPrefix ? `${pathPrefix}/${name}` : name;
  const hasChildren = node.children && node.children.length > 0;
  const hasMeshes = node.meshes && node.meshes.length > 0;

  const li = document.createElement('li');
  li.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.dataset.partId = partId;

  // Toggle arrow
  const toggle = document.createElement('span');
  toggle.className = hasChildren ? 'tree-toggle expanded' : 'tree-toggle leaf';
  toggle.textContent = '\u25B6'; // ▶
  row.appendChild(toggle);

  // Icon
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = hasChildren ? '\uD83D\uDCC1' : '\u2B1C'; // 📁 or ⬜
  row.appendChild(icon);

  // Label
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = name;
  label.title = partId;
  row.appendChild(label);

  li.appendChild(row);

  // Children
  if (hasChildren) {
    const childUl = document.createElement('ul');
    for (const child of node.children) {
      buildNodeElement(child, childUl, partId, onSelectCallback, depth + 1);
    }
    li.appendChild(childUl);
  }

  parentUl.appendChild(li);
}

export function highlightTreeNode(partId) {
  if (currentSelectedRow) {
    currentSelectedRow.classList.remove('selected');
  }

  if (!partId) {
    currentSelectedRow = null;
    return;
  }

  const row = document.querySelector(`.tree-row[data-part-id="${CSS.escape(partId)}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    currentSelectedRow = row;
  }
}

export function resetTree() {
  nodeCounter = 0;
  currentSelectedRow = null;
}
