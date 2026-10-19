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
    if (this._group) { this._group.push(cmd); return; }
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  // fn 안의 변경을 Undo 한 단계로 묶고 화면 갱신(onChange)은 끝에 한 번만 한다. 중첩되면 바깥 묶음에 합쳐진다
  async group(label, fn) {
    if (this._group) return fn();
    this._group = [];
    try {
      return await fn();
    } finally {
      const cmds = this._group;
      this._group = null;
      if (cmds.length) {
        this.undoStack.push({
          label,
          do: s => { for (const c of cmds) c.do(s); },
          undo: s => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(s); },
        });
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack.length = 0;
      }
      this.onChange();
    }
  }

  undo() {
    if (this._group) { // 묶음 안에서의 Undo 는 묶음의 마지막 변경만 되돌린다
      const cmd = this._group.pop();
      if (!cmd) return false;
      cmd.undo(this.state);
      return true;
    }
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

// STEP 가져오기처럼 여러 노드를 한 번의 Undo 단위로 추가
export function cmdAddNodes(nodes, label = 'Add nodes') {
  const ids = new Set(nodes.map(n => n.id));
  return {
    label,
    do(state) { state.nodes.push(...nodes); state.selection = []; },
    undo(state) {
      state.nodes = state.nodes.filter(n => !ids.has(n.id));
      state.selection = state.selection.filter(id => !ids.has(id));
    },
  };
}

// 여러 노드의 transform 을 한 번에 교체 (기즈모 커밋, API)
// 직접 움직인 축에 파라미터 수식(node.expr)이 걸려 있으면 그 수식은 해제한다 — 남겨 두면
// 다음 파라미터 변경 때 수식 값으로 되돌아가 버린다
export function cmdSetTransforms(updates, label = 'Transform') {
  const prev = new Map();
  const prevExpr = new Map();
  return {
    label,
    do(state) {
      for (const u of updates) {
        const n = state.nodes.find(x => x.id === u.id);
        if (!n) continue;
        prev.set(u.id, n.transform);
        if (n.expr) {
          const drop = [];
          for (const path of Object.keys(n.expr)) {
            const [head, i] = path.split('.');
            if (head !== 'params' && n.transform[head]?.[+i] !== u.transform[head]?.[+i]) drop.push(path);
          }
          if (drop.length) {
            prevExpr.set(u.id, n.expr);
            const rest = { ...n.expr };
            for (const p of drop) delete rest[p];
            if (Object.keys(rest).length) n.expr = rest; else delete n.expr;
            console.warn(`${n.name || n.id}: 직접 옮긴 값의 파라미터 수식을 해제했습니다 (${drop.map(p => `${p} = ${prevExpr.get(u.id)[p]}`).join(', ')})`);
          }
        }
        n.transform = u.transform;
      }
    },
    undo(state) {
      for (const [id, t] of prev) {
        const n = state.nodes.find(x => x.id === id);
        if (!n) continue;
        n.transform = t;
        if (prevExpr.has(id)) n.expr = prevExpr.get(id);
      }
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
      prev = { nodes: state.nodes, selection: state.selection, nextId: state.nextId, params: state.params, sketches: state.sketches, rules: state.rules, specs: state.specs };
      // 매번 새 복사본 — 같은 배열을 쓰면 이후 추가된 노드가 Redo 때 되살아난다
      state.nodes = structuredClone(newState.nodes);
      state.selection = newState.selection || [];
      state.nextId = newState.nextId;
      state.params = structuredClone(newState.params || {});
      state.sketches = structuredClone(newState.sketches || {});
      state.rules = structuredClone(newState.rules || []);
      state.specs = structuredClone(newState.specs || []);
    },
    undo(state) {
      if (prev) Object.assign(state, prev);
    },
  };
}

// 파라미터·스케치·규칙 변경 (params.js). mutate 로 바꾼 뒤 수식을 다시 계산한다.
// Undo 는 이전 파라미터로 되돌리고 다시 계산 — 노드 값은 수식에서 나오므로 따로 보관하지 않는다
export function cmdParams(label, mutate, applyFormulas) {
  const snap = s => structuredClone({ params: s.params || {}, sketches: s.sketches || {}, rules: s.rules || [], specs: s.specs || [] });
  let before = null, after = null;
  return {
    label,
    do(state) {
      if (!before) { before = snap(state); mutate(state); after = snap(state); }
      else Object.assign(state, structuredClone(after));
      state.formulaErrors = applyFormulas(state).errors;
    },
    undo(state) {
      Object.assign(state, structuredClone(before));
      state.formulaErrors = applyFormulas(state).errors;
    },
  };
}
