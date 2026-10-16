// 선택 도형을 X/Y/Z 축 화살표(이동) 또는 링(회전)으로 끌어 옮기는 기즈모.
// 드래그 중에는 메쉬만 미리보기로 움직이고, 놓는 순간 노드 transform 을 한 번의 명령으로 커밋한다.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class Gizmo {
  // opts: { ctx, state, getMesh(id), getNodeBox(id) -> Box3|null, onCommit(updates[]) }
  constructor(opts) {
    Object.assign(this, opts);
    this.mode = 'translate';   // 'translate' | 'rotate' | 'off'
    this.suspended = false;    // 측정 모드 등에서 일시 해제
    this.pivot = new THREE.Object3D();
    this.ctx.scene.add(this.pivot);

    const tc = new TransformControls(this.ctx.camera, this.ctx.renderer.domElement);
    tc.setSpace('world');
    tc.setSize(0.9);
    this.tc = tc;
    this.ctx.scene.add(tc.getHelper());

    tc.addEventListener('dragging-changed', e => { this.ctx.controls.enabled = !e.value; });
    tc.addEventListener('mouseDown', () => this._begin());
    tc.addEventListener('objectChange', () => this._preview());
    tc.addEventListener('mouseUp', () => this._end());

    this.setSnap(1, 15);
  }

  // 포인터가 기즈모 축 위에 있거나 드래그 중이면 true → 일반 클릭 선택을 막는 데 사용
  isActive() {
    return !!this.tc.object && (this.tc.dragging || this.tc.axis !== null);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'off') this.tc.setMode(mode);
    this.refresh();
  }

  setSnap(mm, deg) {
    this.tc.setTranslationSnap(mm > 0 ? mm : null);
    this.tc.setRotationSnap(deg > 0 ? THREE.MathUtils.degToRad(deg) : null);
  }

  setSuspended(v) {
    this.suspended = v;
    this.refresh();
  }

  // 선택이 바뀌거나 씬이 다시 그려진 뒤 호출: 피벗을 선택 bbox 중심으로
  refresh() {
    if (this.tc.dragging) return;
    const ids = this.state.selection;
    if (this.mode === 'off' || this.suspended || ids.length === 0) {
      this.tc.detach();
      return;
    }
    const box = new THREE.Box3();
    for (const id of ids) {
      const b = this.getNodeBox(id);
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) { this.tc.detach(); return; }
    box.getCenter(this.pivot.position);
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld();
    this.tc.attach(this.pivot);
  }

  _begin() {
    this._p0 = this.pivot.position.clone();
    this._ids = [...this.state.selection];
  }

  // 현재 피벗 상태로부터 세계 좌표 변환 D = T(p1)·R·T(-p0)
  _delta() {
    const q = this.pivot.quaternion.clone();
    const p1 = this.pivot.position.clone();
    const m = new THREE.Matrix4().makeTranslation(p1.x, p1.y, p1.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-this._p0.x, -this._p0.y, -this._p0.z));
    return { m, q, p1 };
  }

  _preview() {
    if (!this._p0) return;
    const { q, p1 } = this._delta();
    const pos = p1.clone().sub(this._p0.clone().applyQuaternion(q));
    for (const id of this._ids) {
      const mesh = this.getMesh(id);
      if (!mesh) continue;
      mesh.quaternion.copy(q);
      mesh.position.copy(pos);
    }
  }

  _end() {
    if (!this._p0) return;
    const { m, q, p1 } = this._delta();
    const moved = p1.distanceTo(this._p0) > 1e-9 || Math.abs(q.w) < 1 - 1e-12;
    // 미리보기 원복 (커밋 후 redraw 가 새 메쉬를 만든다)
    for (const id of this._ids) {
      const mesh = this.getMesh(id);
      if (mesh) { mesh.position.set(0, 0, 0); mesh.quaternion.identity(); }
    }
    const ids = this._ids;
    this._p0 = null;
    this._ids = null;
    if (!moved) { this.refresh(); return; }

    const updates = [];
    for (const id of ids) {
      const node = this.state.nodes.find(n => n.id === id);
      if (!node) continue;
      updates.push({ id, transform: composeDelta(m, node.transform) });
    }
    this.onCommit(updates);
  }
}

// 노드 transform(위치/오일러XYZ°/스케일) 앞에 세계 변환 D 를 곱한 결과
export function composeDelta(D, t) {
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    ...t.rot.map(THREE.MathUtils.degToRad), 'XYZ'));
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(...t.pos), q0, new THREE.Vector3(1, 1, 1));
  const M2 = D.clone().multiply(M);
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  M2.decompose(pos, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return {
    pos: [round(pos.x), round(pos.y), round(pos.z)],
    rot: [round(THREE.MathUtils.radToDeg(e.x)), round(THREE.MathUtils.radToDeg(e.y)), round(THREE.MathUtils.radToDeg(e.z))],
    scale: [...t.scale],
  };
}

function round(v) {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}
