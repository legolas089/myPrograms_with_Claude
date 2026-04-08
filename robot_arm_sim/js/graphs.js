// graphs.js — Joint-space plot + Cartesian trajectory plot

import { forwardKinematics, RAD2DEG } from './kinematics.js';

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
    this.ml = 50; // margin left
    this.mt = 28; // margin top
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

  drawGrid(xMin, xMax, yMin, yMax) {
    const ctx = this.ctx;
    const { ml, mt, pw, ph } = this;
    const mapX = x => ml + (x - xMin) / (xMax - xMin) * pw;
    const mapY = y => mt + (1 - (y - yMin) / (yMax - yMin)) * ph;
    this._mapX = mapX;
    this._mapY = mapY;

    // Grid lines
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
      ctx.fillText(x.toFixed(0), px, mt + ph + 4);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      const py = mapY(y);
      ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke();
      ctx.fillText(y.toFixed(0), ml - 4, py);
    }

    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);
  }

  drawPath(path, dataFn, selectedIdx, pathIdx) {
    const ctx = this.ctx;
    const isSelected = pathIdx === selectedIdx;
    ctx.save();
    ctx.globalAlpha = isSelected ? 1.0 : 0.3;
    ctx.strokeStyle = path.color;
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.beginPath();
    path.waypoints.forEach((wp, i) => {
      const { x, y } = dataFn(wp);
      const px = this._mapX(x);
      const py = this._mapY(y);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Start/end markers for selected
    if (isSelected && path.waypoints.length > 0) {
      const first = dataFn(path.waypoints[0]);
      const last = dataFn(path.waypoints[path.waypoints.length - 1]);
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

  drawAnimDot(path, progress, dataFn) {
    if (!path || path.waypoints.length === 0) return;
    const idx = Math.min(Math.floor(progress * (path.waypoints.length - 1)), path.waypoints.length - 1);
    const { x, y } = dataFn(path.waypoints[idx]);
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this._mapX(x), this._mapY(y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class JointSpaceGraph extends BaseGraph {
  draw(state) {
    this.clear();
    const { paths, selectedPathIndex, isPlaying, animProgress, jointLimitsEnabled, jointLimits } = state;
    if (!paths || paths.length === 0) {
      this.ctx.fillStyle = '#555';
      this.ctx.font = '12px Segoe UI';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Click "Explore Paths" to generate', this.w / 2, this.h / 2);
      return;
    }

    // Compute bounds in degrees
    let minT1 = Infinity, maxT1 = -Infinity, minT2 = Infinity, maxT2 = -Infinity;
    for (const p of paths) {
      for (const wp of p.waypoints) {
        const d1 = wp.theta1 * RAD2DEG, d2 = wp.theta2 * RAD2DEG;
        if (d1 < minT1) minT1 = d1;
        if (d1 > maxT1) maxT1 = d1;
        if (d2 < minT2) minT2 = d2;
        if (d2 > maxT2) maxT2 = d2;
      }
    }
    // Include joint limits in view bounds if enabled
    if (jointLimitsEnabled) {
      minT1 = Math.min(minT1, jointLimits.t1min);
      maxT1 = Math.max(maxT1, jointLimits.t1max);
      minT2 = Math.min(minT2, jointLimits.t2min);
      maxT2 = Math.max(maxT2, jointLimits.t2max);
    }
    const pad = 15;
    minT1 -= pad; maxT1 += pad; minT2 -= pad; maxT2 += pad;

    this.drawGrid(minT1, maxT1, minT2, maxT2);

    // Draw joint limit region
    if (jointLimitsEnabled) {
      this._drawJointLimitRegion(minT1, maxT1, minT2, maxT2, jointLimits);
    }

    // Axis labels
    this.ctx.fillStyle = '#888';
    this.ctx.font = '10px Segoe UI';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('θ1 (deg)', this.ml + this.pw / 2, this.h - 2);
    this.ctx.save();
    this.ctx.translate(10, this.mt + this.ph / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillText('θ2 (deg)', 0, 0);
    this.ctx.restore();

    const dataFn = wp => ({ x: wp.theta1 * RAD2DEG, y: wp.theta2 * RAD2DEG });
    paths.forEach((p, i) => this.drawPath(p, dataFn, selectedPathIndex, i));

    if (isPlaying && paths[selectedPathIndex]) {
      this.drawAnimDot(paths[selectedPathIndex], animProgress, dataFn);
    }
  }

  _drawJointLimitRegion(viewMinT1, viewMaxT1, viewMinT2, viewMaxT2, limits) {
    const ctx = this.ctx;
    const { ml, mt, pw, ph } = this;

    // Shade forbidden region (outside the limit box) with red overlay
    // The allowed region is the rectangle [t1min, t1max] x [t2min, t2max]
    const lx1 = this._mapX(limits.t1min);
    const lx2 = this._mapX(limits.t1max);
    const ly1 = this._mapY(limits.t2max); // note: mapY inverts
    const ly2 = this._mapY(limits.t2min);

    // Draw forbidden overlay on entire plot area
    ctx.save();
    ctx.fillStyle = 'rgba(255, 80, 80, 0.08)';

    // Clip to plot area
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();

    // Fill entire area, then clear allowed region
    ctx.fillRect(ml, mt, pw, ph);
    ctx.clearRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    ctx.fillStyle = 'rgba(80, 255, 80, 0.04)';
    ctx.fillRect(lx1, ly1, lx2 - lx1, ly2 - ly1);

    ctx.restore();

    // Draw allowed region border
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    ctx.setLineDash([]);
    ctx.restore();

    // Labels
    ctx.save();
    ctx.fillStyle = 'rgba(255, 120, 120, 0.6)';
    ctx.font = '9px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(`θ1: [${limits.t1min}°, ${limits.t1max}°]`, (lx1 + lx2) / 2, ly1 - 3);
    ctx.save();
    ctx.translate(lx2 + 10, (ly1 + ly2) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`θ2: [${limits.t2min}°, ${limits.t2max}°]`, 0, 0);
    ctx.restore();
    ctx.restore();
  }
}

export class CartesianGraph extends BaseGraph {
  draw(state) {
    this.clear();
    const { paths, selectedPathIndex, isPlaying, animProgress, L1, L2, posA, posB } = state;
    if (!paths || paths.length === 0) {
      this.ctx.fillStyle = '#555';
      this.ctx.font = '12px Segoe UI';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Click "Explore Paths" to generate', this.w / 2, this.h / 2);
      return;
    }

    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const allFks = paths.map(p =>
      p.waypoints.map(wp => forwardKinematics(wp.theta1, wp.theta2, L1, L2).endEffector)
    );
    for (const fks of allFks) {
      for (const ee of fks) {
        if (ee.x < minX) minX = ee.x;
        if (ee.x > maxX) maxX = ee.x;
        if (ee.y < minY) minY = ee.y;
        if (ee.y > maxY) maxY = ee.y;
      }
    }
    // Include A and B
    minX = Math.min(minX, posA.x, posB.x);
    maxX = Math.max(maxX, posA.x, posB.x);
    minY = Math.min(minY, posA.y, posB.y);
    maxY = Math.max(maxY, posA.y, posB.y);
    const padX = (maxX - minX) * 0.15 + 20;
    const padY = (maxY - minY) * 0.15 + 20;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;

    this.drawGrid(minX, maxX, minY, maxY);

    // Axis labels
    this.ctx.fillStyle = '#888';
    this.ctx.font = '10px Segoe UI';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('X', this.ml + this.pw / 2, this.h - 2);
    this.ctx.save();
    this.ctx.translate(10, this.mt + this.ph / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillText('Y', 0, 0);
    this.ctx.restore();

    // Draw paths
    paths.forEach((p, pi) => {
      const fks = allFks[pi];
      const dataFn = (wp, idx) => fks[idx] || forwardKinematics(wp.theta1, wp.theta2, L1, L2).endEffector;
      const isSelected = pi === selectedPathIndex;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = isSelected ? 1.0 : 0.3;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.beginPath();
      fks.forEach((ee, i) => {
        const px = this._mapX(ee.x);
        const py = this._mapY(ee.y);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
      if (isSelected && fks.length > 0) {
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(this._mapX(fks[0].x), this._mapY(fks[0].y), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(this._mapX(fks[fks.length - 1].x), this._mapY(fks[fks.length - 1].y), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Animated dot
    if (isPlaying && paths[selectedPathIndex]) {
      const selFks = allFks[selectedPathIndex];
      const idx = Math.min(Math.floor(animProgress * (selFks.length - 1)), selFks.length - 1);
      const ee = selFks[idx];
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.arc(this._mapX(ee.x), this._mapY(ee.y), 4, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
}
