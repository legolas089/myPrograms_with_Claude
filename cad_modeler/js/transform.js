// 우측 Transform 패널: 선택된 노드의 위치/회전/스케일 + 파라미터 + 치수 표시
import * as THREE from 'three';
import { isBooleanNode, isPrimitiveNode, PRIMITIVE_FIELDS, evaluateNode } from './kernel.js';

export class TransformPanel {
  constructor(elements, state, history, onChange) {
    this.el = elements; // {title, px,py,pz, rx,ry,rz, sx,sy,sz, params, dims}
    this.state = state;
    this.history = history;
    this.onChange = onChange;
    this._currentNodeId = null;
    this._dimsVisible = true;
    this._bind();
  }

  _bind() {
    const all = ['px','py','pz','rx','ry','rz','sx','sy','sz'];
    for (const k of all) {
      this.el[k].addEventListener('change', () => this._commit());
    }
  }

  setDimsVisible(v) {
    this._dimsVisible = v;
    this.refresh();
  }

  refresh() {
    const id = this.state.selection[0];
    this._currentNodeId = id;
    const node = id ? this.state.nodes.find(n => n.id === id) : null;
    const all = ['px','py','pz','rx','ry','rz','sx','sy','sz'];

    if (!node) {
      this.el.title.textContent = '선택 없음';
      for (const k of all) { this.el[k].value = ''; this.el[k].disabled = true; }
      this.el.params.innerHTML = '';
      this.el.dims.innerHTML = '';
      return;
    }

    // primitive와 boolean 모두 transform 가능 — boolean은 자체 transform이 결과 mesh에 적용됨
    const t = node.transform || { pos:[0,0,0], rot:[0,0,0], scale:[1,1,1] };
    this.el.title.textContent = isBooleanNode(node) ? `Boolean: ${node.op}` : (node.name || node.type);
    this.el.px.value = t.pos[0]; this.el.py.value = t.pos[1]; this.el.pz.value = t.pos[2];
    this.el.rx.value = t.rot[0]; this.el.ry.value = t.rot[1]; this.el.rz.value = t.rot[2];
    this.el.sx.value = t.scale[0]; this.el.sy.value = t.scale[1]; this.el.sz.value = t.scale[2];
    for (const k of all) this.el[k].disabled = false;
    if (isBooleanNode(node)) {
      this.el.params.innerHTML = `<div style="font-size:11px;color:#888">자식: ${node.a}, ${node.b} (자식의 위치/크기는 자식을 직접 선택하여 편집)</div>`;
    } else {
      this._renderParams(node);
    }

    if (this._dimsVisible) this._renderDims(node);
    else this.el.dims.innerHTML = '';
  }

  _renderParams(node) {
    const fields = PRIMITIVE_FIELDS[node.type];
    if (!fields) { this.el.params.innerHTML = ''; return; }
    const wrap = document.createElement('div');
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'tp-row';
      const lbl = document.createElement('span');
      lbl.className = 'tp-lbl';
      lbl.textContent = f.label;
      row.appendChild(lbl);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = f.step;
      if (f.min !== undefined) inp.min = f.min;
      inp.value = node.params[f.key];
      inp.addEventListener('change', () => {
        let v = parseFloat(inp.value);
        if (f.integer) v = Math.round(v);
        if (Number.isNaN(v)) return;
        if (f.min !== undefined && v < f.min) v = f.min;
        const newParams = { ...node.params, [f.key]: v };
        this.history.apply({
          label: 'Edit param',
          do: (s) => { const n = s.nodes.find(x => x.id === node.id); if (n) { n._prevParams = n.params; n.params = newParams; } },
          undo: (s) => { const n = s.nodes.find(x => x.id === node.id); if (n && n._prevParams) { n.params = n._prevParams; delete n._prevParams; } },
        });
      });
      row.appendChild(inp);
      wrap.appendChild(row);
    }
    this.el.params.innerHTML = '';
    this.el.params.appendChild(wrap);
  }

  _renderDims(node) {
    try {
      const nodeMap = new Map(this.state.nodes.map(n => [n.id, n]));
      const geom = evaluateNode(node, nodeMap);
      if (!geom) { this.el.dims.innerHTML = ''; return; }
      geom.computeBoundingBox();
      const b = geom.boundingBox;
      const sz = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3());
      this.el.dims.innerHTML = `
        <div><span class="dim-label">크기:</span> ${fmt(sz.x)} × ${fmt(sz.y)} × ${fmt(sz.z)}</div>
        <div><span class="dim-label">중심:</span> (${fmt(c.x)}, ${fmt(c.y)}, ${fmt(c.z)})</div>
        <div><span class="dim-label">삼각형:</span> ${geom.index ? geom.index.count/3 : geom.attributes.position.count/3}</div>
      `;
      geom.dispose();
    } catch (err) {
      this.el.dims.innerHTML = `<div style="color:#ff6b5e">계산 오류</div>`;
    }
  }

  _commit() {
    if (!this._currentNodeId) return;
    const node = this.state.nodes.find(n => n.id === this._currentNodeId);
    if (!node) return;

    const get = (k, fb) => {
      const v = parseFloat(this.el[k].value);
      return Number.isFinite(v) ? v : fb;
    };
    const newT = {
      pos: [get('px', node.transform.pos[0]), get('py', node.transform.pos[1]), get('pz', node.transform.pos[2])],
      rot: [get('rx', node.transform.rot[0]), get('ry', node.transform.rot[1]), get('rz', node.transform.rot[2])],
      scale: [get('sx', node.transform.scale[0]) || 0.01, get('sy', node.transform.scale[1]) || 0.01, get('sz', node.transform.scale[2]) || 0.01],
    };
    const id = this._currentNodeId;
    this.history.apply({
      label: 'Transform',
      do: (s) => { const n = s.nodes.find(x => x.id === id); if (n) { n._prevT = n.transform; n.transform = newT; } },
      undo: (s) => { const n = s.nodes.find(x => x.id === id); if (n && n._prevT) { n.transform = n._prevT; delete n._prevT; } },
    });
  }
}

function fmt(n) { return Number(n).toFixed(2); }
