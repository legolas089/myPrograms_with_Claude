// renderer.js — Main canvas: robot arm, workspace, paths, markers

import { forwardKinematics, RAD2DEG } from './kinematics.js';

const COLORS = {
  bg: '#1e1e1e',
  grid: '#2a2a2a',
  workspace: 'rgba(255,255,255,0.03)',
  workspaceBorder: 'rgba(255,255,255,0.08)',
  link1: '#4fc3f7',
  link2: '#ff8a65',
  baseJoint: '#ffffff',
  elbowJoint: '#ffb74d',
  endEffector: '#ce93d8',
  posA: '#ff6b6b',
  posB: '#4ade80',
  box: '#fbbf24',
  ghostArm: 'rgba(255,255,255,0.12)',
  trail: '#ce93d8',
};

export class ArmRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.cx = 0;
    this.cy = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h * 0.55;
  }

  toCanvasX(wx) { return this.cx + wx * this.scale; }
  toCanvasY(wy) { return this.cy - wy * this.scale; }
  toWorldX(cx) { return (cx - this.cx) / this.scale; }
  toWorldY(cy) { return (this.cy - cy) / this.scale; }

  draw(state) {
    const ctx = this.ctx;
    const { L1, L2, posA, posB, paths, selectedPathIndex, isPlaying, animProgress } = state;

    this.scale = Math.min(this.w, this.h) * 0.32 / (L1 + L2);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    this._drawGrid(ctx);
    this._drawWorkspace(ctx, state.workspace);
    if (state.jointLimitsEnabled) {
      this._drawJointLimitWorkspace(ctx, L1, L2, state.jointLimits);
    }
    this._drawAllPaths(ctx, paths, selectedPathIndex, L1, L2);
    this._drawMarker(ctx, posA, COLORS.posA, 'A');
    this._drawMarker(ctx, posB, COLORS.posB, 'B');

    // Determine current arm pose
    let currentTheta1, currentTheta2;
    if (isPlaying && paths.length > 0 && paths[selectedPathIndex]) {
      const path = paths[selectedPathIndex];
      const idx = Math.min(Math.floor(animProgress * (path.waypoints.length - 1)), path.waypoints.length - 1);
      const wp = path.waypoints[idx];
      currentTheta1 = wp.theta1;
      currentTheta2 = wp.theta2;

      // Draw ghost arm at start
      if (animProgress > 0.05) {
        const startWp = path.waypoints[0];
        this._drawArm(ctx, startWp.theta1, startWp.theta2, L1, L2, true);
      }

      // Draw trailing dots
      this._drawTrail(ctx, path, animProgress, L1, L2);

      // Draw box
      const fk = forwardKinematics(currentTheta1, currentTheta2, L1, L2);
      this._drawBox(ctx, fk.endEffector, animProgress);
    } else if (state.ikA) {
      currentTheta1 = state.ikA.theta1;
      currentTheta2 = state.ikA.theta2;

      // Draw box at position A
      this._drawBox(ctx, posA, 0);
    } else {
      currentTheta1 = 0;
      currentTheta2 = 0;
    }

    this._drawArm(ctx, currentTheta1, currentTheta2, L1, L2, false);
    this._drawAngleInfo(ctx, currentTheta1, currentTheta2, L1, L2);
  }

  _drawGrid(ctx) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    const step = 50 * this.scale;
    for (let x = this.cx % step; x < this.w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.h); ctx.stroke();
    }
    for (let y = this.cy % step; y < this.h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
    }
    // Axes
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, this.cy); ctx.lineTo(this.w, this.cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.cx, 0); ctx.lineTo(this.cx, this.h); ctx.stroke();
  }

  _drawWorkspace(ctx, ws) {
    if (!ws) return;
    ctx.fillStyle = COLORS.workspace;
    ctx.strokeStyle = COLORS.workspaceBorder;
    ctx.lineWidth = 1;

    // Outer boundary
    ctx.beginPath();
    ws.outer.forEach((p, i) => {
      const x = this.toCanvasX(p.x), y = this.toCanvasY(p.y);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();

    if (ws.inner.length > 0) {
      // Cut inner hole (reverse winding)
      for (let i = ws.inner.length - 1; i >= 0; i--) {
        const p = ws.inner[i];
        const x = this.toCanvasX(p.x), y = this.toCanvasY(p.y);
        i === ws.inner.length - 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }

  _drawAllPaths(ctx, paths, selectedIdx, L1, L2) {
    if (!paths || paths.length === 0) return;

    // Draw unselected paths first
    paths.forEach((path, i) => {
      if (i === selectedIdx) return;
      this._drawPathTrace(ctx, path, L1, L2, 0.3, 1);
    });
    // Draw selected path on top
    if (paths[selectedIdx]) {
      this._drawPathTrace(ctx, paths[selectedIdx], L1, L2, 1.0, 2.5);
    }
  }

  _drawPathTrace(ctx, path, L1, L2, alpha, lineWidth) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = path.color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    path.waypoints.forEach((wp, i) => {
      const fk = forwardKinematics(wp.theta1, wp.theta2, L1, L2);
      const x = this.toCanvasX(fk.endEffector.x);
      const y = this.toCanvasY(fk.endEffector.y);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  _drawMarker(ctx, pos, color, label) {
    const x = this.toCanvasX(pos.x);
    const y = this.toCanvasY(pos.y);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  _drawArm(ctx, theta1, theta2, L1, L2, ghost) {
    const fk = forwardKinematics(theta1, theta2, L1, L2);
    const bx = this.toCanvasX(0), by = this.toCanvasY(0);
    const jx = this.toCanvasX(fk.joint.x), jy = this.toCanvasY(fk.joint.y);
    const ex = this.toCanvasX(fk.endEffector.x), ey = this.toCanvasY(fk.endEffector.y);

    if (ghost) {
      ctx.save();
      ctx.globalAlpha = 0.12;
    }

    // Link 1
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(jx, jy);
    ctx.strokeStyle = ghost ? '#aaa' : COLORS.link1;
    ctx.lineWidth = ghost ? 4 : 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Link 2
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = ghost ? '#aaa' : COLORS.link2;
    ctx.lineWidth = ghost ? 3.5 : 5;
    ctx.stroke();

    // Joints
    if (!ghost) {
      // Base
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.baseJoint;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#333';
      ctx.fill();

      // Elbow
      ctx.beginPath();
      ctx.arc(jx, jy, 6, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.elbowJoint;
      ctx.fill();

      // End effector
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.endEffector;
      ctx.fill();
    }

    if (ghost) ctx.restore();
  }

  _drawBox(ctx, pos, progress) {
    const x = this.toCanvasX(pos.x);
    const y = this.toCanvasY(pos.y);
    const size = 14;
    ctx.save();
    ctx.fillStyle = COLORS.box;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - size / 2, y - size / 2 - 12, size, size);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - size / 2, y - size / 2 - 12, size, size);
    ctx.restore();
  }

  _drawTrail(ctx, path, progress, L1, L2) {
    const totalWp = path.waypoints.length;
    const currentIdx = Math.floor(progress * (totalWp - 1));
    const trailLen = 20;
    const startIdx = Math.max(0, currentIdx - trailLen);

    for (let i = startIdx; i <= currentIdx; i++) {
      const wp = path.waypoints[i];
      const fk = forwardKinematics(wp.theta1, wp.theta2, L1, L2);
      const x = this.toCanvasX(fk.endEffector.x);
      const y = this.toCanvasY(fk.endEffector.y);
      const alpha = 0.1 + 0.5 * ((i - startIdx) / trailLen);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.trail;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  _drawAngleInfo(ctx, theta1, theta2, L1, L2) {
    const fk = forwardKinematics(theta1, theta2, L1, L2);
    const lines = [
      `θ1: ${(theta1 * RAD2DEG).toFixed(1)}°`,
      `θ2: ${(theta2 * RAD2DEG).toFixed(1)}°`,
      `EE: (${fk.endEffector.x.toFixed(1)}, ${fk.endEffector.y.toFixed(1)})`,
    ];
    ctx.save();
    ctx.fillStyle = '#888';
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'left';
    lines.forEach((txt, i) => {
      ctx.fillText(txt, 10, 20 + i * 16);
    });
    ctx.restore();
  }

  _drawJointLimitWorkspace(ctx, L1, L2, limits) {
    // Draw the reachable workspace boundary considering joint limits
    // by sampling FK at the boundary of the joint limit rectangle
    const D = Math.PI / 180;
    const t1min = limits.t1min * D, t1max = limits.t1max * D;
    const t2min = limits.t2min * D, t2max = limits.t2max * D;
    const steps = 60;

    // Collect boundary points of the constrained workspace
    // Trace 4 edges of the joint limit rectangle in (θ1, θ2) space
    const points = [];
    // Edge 1: θ2 = t2min, θ1 varies
    for (let i = 0; i <= steps; i++) {
      const t1 = t1min + (t1max - t1min) * i / steps;
      const fk = forwardKinematics(t1, t2min, L1, L2);
      points.push(fk.endEffector);
    }
    // Edge 2: θ1 = t1max, θ2 varies
    for (let i = 0; i <= steps; i++) {
      const t2 = t2min + (t2max - t2min) * i / steps;
      const fk = forwardKinematics(t1max, t2, L1, L2);
      points.push(fk.endEffector);
    }
    // Edge 3: θ2 = t2max, θ1 varies (reverse)
    for (let i = steps; i >= 0; i--) {
      const t1 = t1min + (t1max - t1min) * i / steps;
      const fk = forwardKinematics(t1, t2max, L1, L2);
      points.push(fk.endEffector);
    }
    // Edge 4: θ1 = t1min, θ2 varies (reverse)
    for (let i = steps; i >= 0; i--) {
      const t2 = t2min + (t2max - t2min) * i / steps;
      const fk = forwardKinematics(t1min, t2, L1, L2);
      points.push(fk.endEffector);
    }

    // Draw the constrained workspace boundary
    ctx.save();
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = this.toCanvasX(p.x);
      const y = this.toCanvasY(p.y);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 160, 60, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 160, 60, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  hitTestMarker(canvasX, canvasY, worldPos, radius = 15) {
    const mx = this.toCanvasX(worldPos.x);
    const my = this.toCanvasY(worldPos.y);
    const dx = canvasX - mx;
    const dy = canvasY - my;
    return dx * dx + dy * dy <= radius * radius;
  }
}
