// graphs.js — Joint-space and Cartesian (top-view) plots for 3-DOF robot

import { forwardKinematics3D, RAD2DEG } from './kinematics.js';

function niceStep(range, maxTicks = 6) {
  const rough = range / maxTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let nice;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3.5) nice = 2;
  else if (norm <= 7.5) nice = 5;
  else nice = 10;
  return nice * pow;
}

class BaseGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.ml = 50;
    this.mt = 28;
    this.mr = 16;
    this.mb = 28;
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
    this.pw = this.w - this.ml - this.mr;
    this.ph = this.h - this.mt - this.mb;
  }

  clear() {
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  drawGrid(xMin, xMax, yMin, yMax, fmt = (v) => v.toFixed(0)) {
    const ctx = this.ctx;
    const { ml, mt, pw, ph } = this;
    const mapX = x => ml + (x - xMin) / (xMax - xMin) * pw;
    const mapY = y => mt + (1 - (y - yMin) / (yMax - yMin)) * ph;
    this._mapX = mapX;
    this._mapY = mapY;

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#777';
    ctx.font = '10px Segoe UI';

    const xStep = niceStep(xMax - xMin, 5);
    const yStep = niceStep(yMax - yMin, 5);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      const px = mapX(x);
      if (px < ml + 10 || px > ml + pw - 10) continue;
      ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke();
      ctx.fillText(fmt(x), px, mt + ph + 4);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      const py = mapY(y);
      ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke();
      ctx.fillText(fmt(y), ml - 4, py);
    }

    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);
  }

  drawAxisLabels(xLabel, yLabel) {
    this.ctx.fillStyle = '#888';
    this.ctx.font = '10px Segoe UI';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(xLabel, this.ml + this.pw / 2, this.h - 2);
    this.ctx.save();
    this.ctx.translate(10, this.mt + this.ph / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillText(yLabel, 0, 0);
    this.ctx.restore();
  }

  emptyMessage() {
    this.ctx.fillStyle = '#555';
    this.ctx.font = '12px Segoe UI';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Click "Explore Paths" to generate', this.w / 2, this.h / 2);
  }

  drawPathPoly(pts, color, isSelected) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = isSelected ? 1.0 : 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = this._mapX(p.x);
      const py = this._mapY(p.y);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    if (isSelected && pts.length > 0) {
      const first = pts[0], last = pts[pts.length - 1];
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(this._mapX(first.x), this._mapY(first.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(this._mapX(last.x), this._mapY(last.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAnimDot(pts, progress) {
    if (!pts || pts.length === 0) return;
    const idx = Math.min(Math.floor(progress * (pts.length - 1)), pts.length - 1);
    const p = pts[idx];
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this._mapX(p.x), this._mapY(p.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLimitBox(t_min, t_max, u_min, u_max, color = 'rgba(255,80,80,') {
    const ctx = this.ctx;
    const { ml, mt, pw, ph } = this;
    const lx1 = this._mapX(t_min);
    const lx2 = this._mapX(t_max);
    const ly1 = this._mapY(u_max);
    const ly2 = this._mapY(u_min);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();
    ctx.fillStyle = color + '0.08)';
    ctx.fillRect(ml, mt, pw, ph);
    ctx.clearRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    ctx.fillStyle = 'rgba(80, 255, 80, 0.04)';
    ctx.fillRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color + '0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ── Joint-space graph: θa vs θb (degrees) ──
function makeJointPairGraph(axisA, axisB, labelA, labelB) {
  return class extends BaseGraph {
    draw(state) {
      this.clear();
      const { paths, selectedPathIndex, isPlaying, animProgress, jointLimitsEnabled, jointLimits } = state;
      if (!paths || paths.length === 0) {
        this.emptyMessage();
        return;
      }

      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of paths) {
        for (const wp of p.waypoints) {
          const a = wp[axisA] * RAD2DEG;
          const b = wp[axisB] * RAD2DEG;
          if (a < minA) minA = a;
          if (a > maxA) maxA = a;
          if (b < minB) minB = b;
          if (b > maxB) maxB = b;
        }
      }
      if (jointLimitsEnabled) {
        const aMin = jointLimits[axisA + 'min'];
        const aMax = jointLimits[axisA + 'max'];
        const bMin = jointLimits[axisB + 'min'];
        const bMax = jointLimits[axisB + 'max'];
        minA = Math.min(minA, aMin); maxA = Math.max(maxA, aMax);
        minB = Math.min(minB, bMin); maxB = Math.max(maxB, bMax);
      }
      const pad = 15;
      minA -= pad; maxA += pad; minB -= pad; maxB += pad;

      this.drawGrid(minA, maxA, minB, maxB);

      if (jointLimitsEnabled) {
        this.drawLimitBox(
          jointLimits[axisA + 'min'], jointLimits[axisA + 'max'],
          jointLimits[axisB + 'min'], jointLimits[axisB + 'max']
        );
      }

      this.drawAxisLabels(`${labelA} (deg)`, `${labelB} (deg)`);

      paths.forEach((p, i) => {
        const pts = p.waypoints.map(wp => ({ x: wp[axisA] * RAD2DEG, y: wp[axisB] * RAD2DEG }));
        this.drawPathPoly(pts, p.color, i === selectedPathIndex);
      });

      if (isPlaying && paths[selectedPathIndex]) {
        const sel = paths[selectedPathIndex];
        const pts = sel.waypoints.map(wp => ({ x: wp[axisA] * RAD2DEG, y: wp[axisB] * RAD2DEG }));
        this.drawAnimDot(pts, animProgress);
      }
    }
  };
}

export const JointSpaceGraph12 = makeJointPairGraph('t1', 't2', 'θ1', 'θ2');
export const JointSpaceGraph23 = makeJointPairGraph('t2', 't3', 'θ2', 'θ3');

// ── Cartesian top-view: X vs Y in meters ──
export class CartesianTopGraph extends BaseGraph {
  draw(state) {
    this.clear();
    const { paths, selectedPathIndex, isPlaying, animProgress, h0, L1, L2, posA, posB, workspace } = state;
    if (!paths || paths.length === 0) {
      this.emptyMessage();
      return;
    }

    const allFks = paths.map(p =>
      p.waypoints.map(wp => forwardKinematics3D(wp.t1, wp.t2, wp.t3, h0, L1, L2).P)
    );

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const fks of allFks) {
      for (const ee of fks) {
        if (ee.x < minX) minX = ee.x;
        if (ee.x > maxX) maxX = ee.x;
        if (ee.y < minY) minY = ee.y;
        if (ee.y > maxY) maxY = ee.y;
      }
    }
    minX = Math.min(minX, posA.x, posB.x, -workspace.rMax);
    maxX = Math.max(maxX, posA.x, posB.x,  workspace.rMax);
    minY = Math.min(minY, posA.y, posB.y, -workspace.rMax);
    maxY = Math.max(maxY, posA.y, posB.y,  workspace.rMax);
    const padX = (maxX - minX) * 0.12 + 0.05;
    const padY = (maxY - minY) * 0.12 + 0.05;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;

    this.drawGrid(minX, maxX, minY, maxY, v => v.toFixed(2));
    this.drawAxisLabels('X (m)', 'Y (m)');

    // Workspace circles (top view)
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(74, 144, 226, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const drawCircle = (r) => {
      ctx.beginPath();
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = (2 * Math.PI * i) / N;
        const px = this._mapX(r * Math.cos(a));
        const py = this._mapY(r * Math.sin(a));
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    drawCircle(workspace.rMax);
    if (workspace.rMin > 1e-6) drawCircle(workspace.rMin);
    ctx.setLineDash([]);
    ctx.restore();

    // Paths (top-view projection of P)
    paths.forEach((p, pi) => {
      const pts = allFks[pi].map(ee => ({ x: ee.x, y: ee.y }));
      this.drawPathPoly(pts, p.color, pi === selectedPathIndex);
    });

    // Markers A (red) and B (green)
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(this._mapX(posA.x), this._mapY(posA.y), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(this._mapX(posB.x), this._mapY(posB.y), 5, 0, Math.PI * 2);
    ctx.fill();

    if (isPlaying && paths[selectedPathIndex]) {
      const pts = allFks[selectedPathIndex].map(ee => ({ x: ee.x, y: ee.y }));
      this.drawAnimDot(pts, animProgress);
    }
  }
}
