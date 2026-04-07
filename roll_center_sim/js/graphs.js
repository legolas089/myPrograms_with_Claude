/**
 * Graph renderers for Roll Center Simulator
 * 4 graphs: RC Height vs Bump, SA Angle vs Bump, Camber vs Bump, Track Change vs Bump
 */

/* ── Shared utilities ── */
function niceStep(range, maxTicks) {
  if (range === 0) return 1;
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

function findBumpIndex(bumps, val) {
  let lo = 0, hi = bumps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bumps[mid] <= val) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function drawXYLine(ctx, xArr, yArr, endIdx, mapX, mapY, color, lineWidth) {
  if (endIdx < 1) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.moveTo(mapX(xArr[0]), mapY(yArr[0]));
  for (let i = 1; i <= endIdx; i++) {
    ctx.lineTo(mapX(xArr[i]), mapY(yArr[i]));
  }
  ctx.stroke();
}

function drawFullLine(ctx, xArr, yArr, mapX, mapY, color, lineWidth) {
  if (xArr.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.moveTo(mapX(xArr[0]), mapY(yArr[0]));
  for (let i = 1; i < xArr.length; i++) {
    ctx.lineTo(mapX(xArr[i]), mapY(yArr[i]));
  }
  ctx.stroke();
}

function drawGrid(ctx, ml, mt, pw, ph, xMin, xMax, yMin, yMax, mapX, mapY, xLabel, yLabel) {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  ctx.fillStyle = '#999';
  ctx.font = '11px monospace';

  // X grid (bump)
  const xRange = xMax - xMin;
  const xStep = niceStep(xRange, 6);
  ctx.textAlign = 'center';
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) {
    const x = mapX(v);
    ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
    ctx.fillText(xLabel(v), x, mt + ph + 14);
  }

  // Y grid
  const yRange = yMax - yMin;
  const yStep = niceStep(yRange, 5);
  ctx.textAlign = 'right';
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = mapY(v);
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
    ctx.fillText(yLabel(v), ml - 5, y + 4);
  }

  // Zero lines
  if (xMin < 0 && xMax > 0) {
    const x0 = mapX(0);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, mt); ctx.lineTo(x0, mt + ph); ctx.stroke();
  }
  if (yMin < 0 && yMax > 0) {
    const y0 = mapY(0);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ml, y0); ctx.lineTo(ml + pw, y0); ctx.stroke();
  }

  // Border
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(ml, mt, pw, ph);
}

function drawBumpCursor(ctx, bumpVal, bumpMin, bumpMax, ml, mt, pw, ph, mapX) {
  if (bumpVal !== null && bumpVal >= bumpMin && bumpVal <= bumpMax) {
    const cx = mapX(bumpVal);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, mt);
    ctx.lineTo(cx, mt + ph);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

class BaseRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  clear() {
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }
}

/* ── RC Height Graph ── */
export class RCHeightGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, bumpVal) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    this.clear();
    if (!resultA || resultA.bump.length === 0) return;

    // Ranges
    const bumpMin = resultA.bump[0], bumpMax = resultA.bump[resultA.bump.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const v of resultA.rcHeight) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    if (resultB) for (const v of resultB.rcHeight) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 5);
    yMin -= yPad; yMax += yPad;

    const mapX = (v) => ml + (v - bumpMin) / (bumpMax - bumpMin) * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawGrid(ctx, ml, mt, pw, ph, bumpMin, bumpMax, yMin, yMax, mapX, mapY,
      v => v.toFixed(0), v => v.toFixed(1) + 'mm');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    drawFullLine(ctx, resultA.bump, resultA.rcHeight, mapX, mapY, '#ffd54f', 2);
    if (resultB) {
      drawFullLine(ctx, resultB.bump, resultB.rcHeight, mapX, mapY, '#ffab40', 2);
    }

    drawBumpCursor(ctx, bumpVal, bumpMin, bumpMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RC Height (mm)', ml, mt - 6);
  }
}

/* ── SA Angle Graph ── */
export class SAAngleGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, bumpVal) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    this.clear();
    if (!resultA || resultA.bump.length === 0) return;

    const bumpMin = resultA.bump[0], bumpMax = resultA.bump[resultA.bump.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const v of resultA.saAngle) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    if (resultB) for (const v of resultB.saAngle) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 0.5);
    yMin -= yPad; yMax += yPad;

    const mapX = (v) => ml + (v - bumpMin) / (bumpMax - bumpMin) * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawGrid(ctx, ml, mt, pw, ph, bumpMin, bumpMax, yMin, yMax, mapX, mapY,
      v => v.toFixed(0), v => v.toFixed(1) + '°');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    drawFullLine(ctx, resultA.bump, resultA.saAngle, mapX, mapY, '#4fc3f7', 2);
    if (resultB) {
      drawFullLine(ctx, resultB.bump, resultB.saAngle, mapX, mapY, '#81c784', 2);
    }

    drawBumpCursor(ctx, bumpVal, bumpMin, bumpMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SA Angle (deg)', ml, mt - 6);
  }
}

/* ── Camber Graph ── */
export class CamberGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, bumpVal) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    this.clear();
    if (!resultA || resultA.bump.length === 0) return;

    const bumpMin = resultA.bump[0], bumpMax = resultA.bump[resultA.bump.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const v of resultA.camber) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    if (resultB) for (const v of resultB.camber) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 0.2);
    yMin -= yPad; yMax += yPad;

    const mapX = (v) => ml + (v - bumpMin) / (bumpMax - bumpMin) * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawGrid(ctx, ml, mt, pw, ph, bumpMin, bumpMax, yMin, yMax, mapX, mapY,
      v => v.toFixed(0), v => v.toFixed(2) + '°');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    drawFullLine(ctx, resultA.bump, resultA.camber, mapX, mapY, '#ce93d8', 2);
    if (resultB) {
      drawFullLine(ctx, resultB.bump, resultB.camber, mapX, mapY, '#ba68c8', 2);
    }

    drawBumpCursor(ctx, bumpVal, bumpMin, bumpMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Camber (deg)', ml, mt - 6);
  }
}

/* ── Track Change (Scrub) Graph ── */
export class ScrubGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, bumpVal) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    this.clear();
    if (!resultA || resultA.bump.length === 0) return;

    const bumpMin = resultA.bump[0], bumpMax = resultA.bump[resultA.bump.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const v of resultA.scrub) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    if (resultB) for (const v of resultB.scrub) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 0.5);
    yMin -= yPad; yMax += yPad;

    const mapX = (v) => ml + (v - bumpMin) / (bumpMax - bumpMin) * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawGrid(ctx, ml, mt, pw, ph, bumpMin, bumpMax, yMin, yMax, mapX, mapY,
      v => v.toFixed(0), v => v.toFixed(1) + 'mm');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    drawFullLine(ctx, resultA.bump, resultA.scrub, mapX, mapY, '#ff8a65', 2);
    if (resultB) {
      drawFullLine(ctx, resultB.bump, resultB.scrub, mapX, mapY, '#ffb74d', 2);
    }

    drawBumpCursor(ctx, bumpVal, bumpMin, bumpMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Track Change (mm)', ml, mt - 6);
  }
}
