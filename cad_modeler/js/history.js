// 명령(Command) 패턴 기반 Undo/Redo 스택
// 각 명령은 { do(state), undo(state), label } 형태
const MAX_HISTORY = 100;

export class History {
  constructor(state, onChange) {
    this.state = state;
    this.onChange = onChange || (() => {});
    this.undoStack = [];
    this.redoStack = [];
  }

  apply(cmd) {
    cmd.do(this.state);
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(this.state);
    this.redoStack.push(cmd);
    this.onChange();
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do(this.state);
    this.undoStack.push(cmd);
    this.onChange();
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
}

// --- 명령 팩토리 ---

export function cmdAddNode(node) {
  return {
    label: `Add ${node.type}`,
    do(state) { state.nodes.push(node); state.selection = [node.id]; },
    undo(state) {
      state.nodes = state.nodes.filter(n => n.id !== node.id);
      state.selection = state.selection.filter(id => id !== node.id);
    },
  };
}

export function cmdDeleteNode(nodeId) {
  let removed = null;
  let index = -1;
  return {
    label: 'Delete',
    do(state) {
      index = state.nodes.findIndex(n => n.id === nodeId);
      if (index < 0) return;
      removed = state.nodes[index];
      state.nodes.splice(index, 1);
      state.selection = state.selection.filter(id => id !== nodeId);
    },
    undo(state) {
      if (removed && index >= 0) state.nodes.splice(index, 0, removed);
    },
  };
}

export function cmdUpdateNode(nodeId, patch) {
  let prev = null;
  return {
    label: 'Update',
    do(state) {
      const n = state.nodes.find(n => n.id === nodeId);
      if (!n) return;
      prev = JSON.parse(JSON.stringify(n));
      Object.assign(n, deepMerge(n, patch));
    },
    undo(state) {
      const i = state.nodes.findIndex(n => n.id === nodeId);
      if (i >= 0 && prev) state.nodes[i] = prev;
    },
  };
}

export function cmdBoolean(opName, idA, idB, newId, getName) {
  // Boolean 노드를 새로 만들고, 두 입력은 보이지만 visualize 단계에서 자동으로 숨겨짐
  const node = {
    id: newId,
    type: 'boolean',
    op: opName,
    a: idA,
    b: idB,
    name: getName(opName),
    visible: true,
    transform: { pos: [0,0,0], rot: [0,0,0], scale: [1,1,1] },
  };
  return {
    label: `Boolean ${opName}`,
    do(state) {
      state.nodes.push(node);
      state.selection = [newId];
    },
    undo(state) {
      state.nodes = state.nodes.filter(n => n.id !== newId);
      state.selection = state.selection.filter(id => id !== newId);
    },
  };
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = deepMerge(target[k], sv);
    } else {
      out[k] = Array.isArray(sv) ? [...sv] : sv;
    }
  }
  return out;
}

export function cmdReplaceState(newState) {
  let prev = null;
  return {
    label: 'Load',
    do(state) {
      prev = { nodes: state.nodes, selection: state.selection, nextId: state.nextId };
      state.nodes = newState.nodes;
      state.selection = newState.selection || [];
      state.nextId = newState.nextId;
    },
    undo(state) {
      if (prev) {
        state.nodes = prev.nodes;
        state.selection = prev.selection;
        state.nextId = prev.nextId;
      }
    },
  };
}
