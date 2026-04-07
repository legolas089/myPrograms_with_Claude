/**
 * Graph renderers for Half-Car Simulator
 * 4 graphs: Displacement, Pitch, Suspension Stroke, Frequency Response
 */

/* ── Shared utilities ── */
function niceStep(range, maxTicks) {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

function findTimeIndex(times, t) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function drawLine(ctx, times, values, endIdx, mapX, mapY, color, lineWidth) {
  if (endIdx < 1) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.moveTo(mapX(times[0]), mapY(values[0]));
  for (let i = 1; i <= endIdx; i++) ctx.lineTo(mapX(times[i]), mapY(values[i]));
  ctx.stroke();
}

function drawTimeGrid(ctx, ml, mt, pw, ph, tMax, yMin, yMax, mapX, mapY, yLabel, yUnit) {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  ctx.fillStyle = '#999';
  ctx.font = '11px monospace';

  // Time
  const tStep = niceStep(tMax, 6);
  ctx.textAlign = 'center';
  for (let t = 0; t <= tMax; t += tStep) {
    const x = mapX(t);
    ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
    ctx.fillText(t.toFixed(1) + 's', x, mt + ph + 14);
  }

  // Y
  const yRange = yMax - yMin;
  const yStep = niceStep(yRange, 5);
  ctx.textAlign = 'right';
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = mapY(v);
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
    ctx.fillText(yLabel(v), ml - 5, y + 4);
  }

  // Zero line
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

function drawTimeCursor(ctx, currentTime, tMax, ml, mt, pw, ph, mapX) {
  if (currentTime > 0 && currentTime <= tMax) {
    const cx = mapX(currentTime);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, mt); ctx.lineTo(cx, mt + ph); ctx.stroke();
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
}

/* ── Displacement Graph ── */
const DISP_COLORS = {
  y3A: '#4fc3f7', y1A: '#ff8a65', y2A: '#ce93d8', road: '#aaa',
  y3B: '#81c784', y1B: '#ffb74d', y2B: '#ba68c8'
};

export class DisplacementGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, currentTime) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    if (!resultA || resultA.time.length === 0) return;

    const tMax = resultA.time[resultA.time.length - 1];

    // Y range
    let yMin = Infinity, yMax = -Infinity;
    const datasets = [resultA.y3, resultA.y1, resultA.y2, resultA.u1];
    if (resultB) datasets.push(resultB.y3);
    for (const d of datasets) for (const v of d) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 0.005);
    yMin -= yPad; yMax += yPad;

    const mapX = (t) => ml + t / tMax * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawTimeGrid(ctx, ml, mt, pw, ph, tMax, yMin, yMax, mapX, mapY, v => (v * 1000).toFixed(0) + 'mm');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    const endIdx = findTimeIndex(resultA.time, currentTime);
    drawLine(ctx, resultA.time, resultA.u1, endIdx, mapX, mapY, DISP_COLORS.road, 1);
    drawLine(ctx, resultA.time, resultA.y2, endIdx, mapX, mapY, DISP_COLORS.y2A, 1.5);
    drawLine(ctx, resultA.time, resultA.y1, endIdx, mapX, mapY, DISP_COLORS.y1A, 1.5);
    drawLine(ctx, resultA.time, resultA.y3, endIdx, mapX, mapY, DISP_COLORS.y3A, 2);

    if (resultB) {
      const endB = findTimeIndex(resultB.time, currentTime);
      drawLine(ctx, resultB.time, resultB.y3, endB, mapX, mapY, DISP_COLORS.y3B, 2);
    }

    drawTimeCursor(ctx, currentTime, tMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Displacement', ml, mt - 6);
  }
}

/* ── Pitch Angle Graph ── */
export class PitchGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, currentTime) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    if (!resultA || resultA.time.length === 0) return;

    const tMax = resultA.time[resultA.time.length - 1];
    const toDeg = 180 / Math.PI;

    // Convert to degrees for display
    const phi3DegA = resultA.phi3.map(v => v * toDeg);
    let yMin = Infinity, yMax = -Infinity;
    const datasets = [phi3DegA];
    let phi3DegB = null;
    if (resultB) {
      phi3DegB = resultB.phi3.map(v => v * toDeg);
      datasets.push(phi3DegB);
    }
    for (const d of datasets) for (const v of d) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 0.05);
    yMin -= yPad; yMax += yPad;

    const mapX = (t) => ml + t / tMax * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawTimeGrid(ctx, ml, mt, pw, ph, tMax, yMin, yMax, mapX, mapY, v => v.toFixed(2) + '°');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    const endIdx = findTimeIndex(resultA.time, currentTime);
    drawLine(ctx, resultA.time, phi3DegA, endIdx, mapX, mapY, '#ffd54f', 2);

    if (resultB && phi3DegB) {
      const endB = findTimeIndex(resultB.time, currentTime);
      drawLine(ctx, resultB.time, phi3DegB, endB, mapX, mapY, '#ffab40', 2);
    }

    drawTimeCursor(ctx, currentTime, tMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Pitch Angle (deg)', ml, mt - 6);
  }
}

/* ── Suspension Stroke Graph ── */
export class SuspStrokeGraphRenderer extends BaseRenderer {
  draw(resultA, resultB, params, currentTime) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 52, mr = 10, mt = 22, mb = 26;
    const pw = w - ml - mr, ph = h - mt - mb;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    if (!resultA || resultA.time.length === 0) return;

    const { b1, b2 } = params;
    const tMax = resultA.time[resultA.time.length - 1];
    const n = resultA.time.length;

    // Compute suspension strokes in mm
    const frontStrokeA = new Array(n), rearStrokeA = new Array(n);
    for (let i = 0; i < n; i++) {
      frontStrokeA[i] = (resultA.y3[i] - b1 * resultA.phi3[i] - resultA.y1[i]) * 1000;
      rearStrokeA[i] = (resultA.y3[i] + b2 * resultA.phi3[i] - resultA.y2[i]) * 1000;
    }

    let frontStrokeB = null, rearStrokeB = null;
    const datasets = [frontStrokeA, rearStrokeA];
    if (resultB) {
      const nB = resultB.time.length;
      frontStrokeB = new Array(nB);
      rearStrokeB = new Array(nB);
      for (let i = 0; i < nB; i++) {
        frontStrokeB[i] = (resultB.y3[i] - b1 * resultB.phi3[i] - resultB.y1[i]) * 1000;
        rearStrokeB[i] = (resultB.y3[i] + b2 * resultB.phi3[i] - resultB.y2[i]) * 1000;
      }
      datasets.push(frontStrokeB, rearStrokeB);
    }

    let yMin = Infinity, yMax = -Infinity;
    for (const d of datasets) for (const v of d) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    const yPad = Math.max((yMax - yMin) * 0.15, 1);
    yMin -= yPad; yMax += yPad;

    const mapX = (t) => ml + t / tMax * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    drawTimeGrid(ctx, ml, mt, pw, ph, tMax, yMin, yMax, mapX, mapY, v => v.toFixed(1) + 'mm');

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    const endIdx = findTimeIndex(resultA.time, currentTime);
    drawLine(ctx, resultA.time, frontStrokeA, endIdx, mapX, mapY, '#4fc3f7', 2);
    drawLine(ctx, resultA.time, rearStrokeA, endIdx, mapX, mapY, '#ce93d8', 2);

    if (resultB && frontStrokeB) {
      const endB = findTimeIndex(resultB.time, currentTime);
      drawLine(ctx, resultB.time, frontStrokeB, endB, mapX, mapY, '#81c784', 1.5);
      drawLine(ctx, resultB.time, rearStrokeB, endB, mapX, mapY, '#ffb74d', 1.5);
    }

    drawTimeCursor(ctx, currentTime, tMax, ml, mt, pw, ph, mapX);
    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Susp. Stroke (mm)', ml, mt - 6);
  }
}

/* ── Frequency Response Graph ── */
const FREQ_COLORS = {
  cgAcc: '#4fc3f7', pitchAcc: '#ffd54f',
  tireF: '#ff8a65', tireR: '#ce93d8',
  cgAccB: 'rgba(79,195,247,0.35)', pitchAccB: 'rgba(255,213,79,0.35)',
  tireFB: 'rgba(255,138,101,0.35)', tireRB: 'rgba(206,147,216,0.35)'
};

export class FreqResponseRenderer extends BaseRenderer {
  draw(frA, frB) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const ml = 42, mr = 10, mt = 18, mb = 22;
    const pw = w - ml - mr, ph = h - mt - mb;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    if (!frA) return;

    const fMin = frA.freqs[0], fMax = frA.freqs[frA.freqs.length - 1];
    const logFMin = Math.log10(fMin), logFMax = Math.log10(fMax);

    // Magnitude range
    const allMags = [...frA.cgAccMag, ...frA.pitchAccMag, ...frA.frontTireDefMag, ...frA.rearTireDefMag];
    if (frB) allMags.push(...frB.cgAccMag, ...frB.pitchAccMag, ...frB.frontTireDefMag, ...frB.rearTireDefMag);

    let magMin = Infinity, magMax = -Infinity;
    for (const m of allMags) {
      if (m > 0 && m < magMin) magMin = m;
      if (m > magMax) magMax = m;
    }

    const logMMin = Math.floor(Math.log10(magMin || 0.001));
    const logMMax = Math.ceil(Math.log10(magMax || 100));

    const mapX = (f) => ml + (Math.log10(f) - logFMin) / (logFMax - logFMin) * pw;
    const mapY = (m) => mt + ph - (Math.log10(m) - logMMin) / (logMMax - logMMin) * ph;

    // Log grid
    this.drawLogGrid(ctx, ml, mt, pw, ph, fMin, fMax, logFMin, logFMax, logMMin, logMMax, mapX, mapY);

    ctx.save();
    ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();

    if (frB) {
      this.drawLogLine(ctx, frB.freqs, frB.cgAccMag, mapX, mapY, FREQ_COLORS.cgAccB, 2);
      this.drawLogLine(ctx, frB.freqs, frB.pitchAccMag, mapX, mapY, FREQ_COLORS.pitchAccB, 2);
      this.drawLogLine(ctx, frB.freqs, frB.frontTireDefMag, mapX, mapY, FREQ_COLORS.tireFB, 2);
      this.drawLogLine(ctx, frB.freqs, frB.rearTireDefMag, mapX, mapY, FREQ_COLORS.tireRB, 2);
    }

    this.drawLogLine(ctx, frA.freqs, frA.cgAccMag, mapX, mapY, FREQ_COLORS.cgAcc, 2);
    this.drawLogLine(ctx, frA.freqs, frA.pitchAccMag, mapX, mapY, FREQ_COLORS.pitchAcc, 2);
    this.drawLogLine(ctx, frA.freqs, frA.frontTireDefMag, mapX, mapY, FREQ_COLORS.tireF, 2);
    this.drawLogLine(ctx, frA.freqs, frA.rearTireDefMag, mapX, mapY, FREQ_COLORS.tireR, 2);

    ctx.restore();

    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Freq Response', ml, mt - 6);
  }

  drawLogGrid(ctx, ml, mt, pw, ph, fMin, fMax, logFMin, logFMax, logMMin, logMMax, mapX, mapY) {
    ctx.fillStyle = '#999';
    ctx.font = '11px monospace';

    // Frequency grid
    ctx.textAlign = 'center';
    for (let dec = Math.floor(logFMin); dec <= Math.ceil(logFMax); dec++) {
      for (let sub = 1; sub <= 9; sub++) {
        const f = sub * Math.pow(10, dec);
        if (f < fMin || f > fMax) continue;
        const x = mapX(f);
        ctx.strokeStyle = sub === 1 ? '#444' : '#2a2a2a';
        ctx.lineWidth = sub === 1 ? 0.8 : 0.4;
        ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
        if (sub === 1 || sub === 2 || sub === 5) {
          ctx.fillText(f >= 1 ? f.toFixed(0) : f.toFixed(1), x, mt + ph + 14);
        }
      }
    }
    ctx.fillText('Hz', ml + pw + 5, mt + ph + 14);

    // Magnitude grid
    ctx.textAlign = 'right';
    for (let dec = logMMin; dec <= logMMax; dec++) {
      for (let sub = 1; sub <= 9; sub++) {
        const m = sub * Math.pow(10, dec);
        const logM = Math.log10(m);
        if (logM < logMMin || logM > logMMax) continue;
        const y = mapY(m);
        ctx.strokeStyle = sub === 1 ? '#444' : '#2a2a2a';
        ctx.lineWidth = sub === 1 ? 0.8 : 0.4;
        ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        if (sub === 1) {
          const label = m >= 1 ? m.toFixed(0) : m < 0.01 ? m.toExponential(0) : m.toFixed(2);
          ctx.fillText(label, ml - 5, y + 4);
        }
      }
    }

    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);
  }

  drawLogLine(ctx, freqs, mags, mapX, mapY, color, lineWidth) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    let started = false;
    for (let i = 0; i < freqs.length; i++) {
      if (mags[i] <= 0) continue;
      const x = mapX(freqs[i]);
      const y = mapY(mags[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
