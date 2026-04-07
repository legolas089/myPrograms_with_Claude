/**
 * Real-time graph renderer for displacement plots
 */

const COLORS = {
  zsA: '#4fc3f7',
  zuA: '#ff8a65',
  zr: '#aaa',
  zsB: '#81c784',
  zuB: '#ffb74d',
  grid: '#333',
  axis: '#555',
  text: '#888',
  bg: '#1a1a1a'
};

export class GraphRenderer {
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

  /**
   * Draw displacement vs time graph
   * @param {object} resultA - simulation result { time, zs, zu, zr }
   * @param {object|null} resultB - comparison result
   * @param {number} currentTime - current playback time
   */
  draw(resultA, resultB, currentTime) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    // Margins
    const ml = 55, mr = 15, mt = 25, mb = 30;
    const pw = w - ml - mr;
    const ph = h - mt - mb;

    // Clear
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!resultA || resultA.time.length === 0) return;

    // Time range
    const tMax = resultA.time[resultA.time.length - 1];
    const tMin = 0;

    // Find displacement range
    let yMin = Infinity, yMax = -Infinity;
    const datasets = [resultA.zs, resultA.zu, resultA.zr];
    if (resultB) {
      datasets.push(resultB.zs, resultB.zu);
    }
    for (const data of datasets) {
      for (const v of data) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }

    // Add padding
    const yPad = Math.max((yMax - yMin) * 0.15, 0.005);
    yMin -= yPad;
    yMax += yPad;

    // Map functions
    const mapX = (t) => ml + (t - tMin) / (tMax - tMin) * pw;
    const mapY = (v) => mt + ph - (v - yMin) / (yMax - yMin) * ph;

    // Grid
    this.drawGrid(ctx, ml, mt, pw, ph, tMin, tMax, yMin, yMax, mapX, mapY);

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();

    // Draw data up to currentTime
    const endIdx = this.findTimeIndex(resultA.time, currentTime);

    // Road profile
    this.drawLine(ctx, resultA.time, resultA.zr, endIdx, mapX, mapY, COLORS.zr, 1);

    // Set A
    this.drawLine(ctx, resultA.time, resultA.zu, endIdx, mapX, mapY, COLORS.zuA, 1.5);
    this.drawLine(ctx, resultA.time, resultA.zs, endIdx, mapX, mapY, COLORS.zsA, 2);

    // Set B
    if (resultB) {
      const endIdxB = this.findTimeIndex(resultB.time, currentTime);
      this.drawLine(ctx, resultB.time, resultB.zu, endIdxB, mapX, mapY, COLORS.zuB, 1.5);
      this.drawLine(ctx, resultB.time, resultB.zs, endIdxB, mapX, mapY, COLORS.zsB, 2);
    }

    // Current time indicator
    if (currentTime > 0 && currentTime <= tMax) {
      const cx = mapX(currentTime);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, mt);
      ctx.lineTo(cx, mt + ph);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Title
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Displacement', ml, mt - 8);
  }

  drawGrid(ctx, ml, mt, pw, ph, tMin, tMax, yMin, yMax, mapX, mapY) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px monospace';

    // Time grid
    const tRange = tMax - tMin;
    const tStep = this.niceStep(tRange, 8);
    ctx.textAlign = 'center';
    for (let t = 0; t <= tMax; t += tStep) {
      const x = mapX(t);
      ctx.beginPath();
      ctx.moveTo(x, mt);
      ctx.lineTo(x, mt + ph);
      ctx.stroke();
      ctx.fillText(t.toFixed(1) + 's', x, mt + ph + 15);
    }

    // Y grid
    const yRange = yMax - yMin;
    const yStep = this.niceStep(yRange, 6);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(ml, y);
      ctx.lineTo(ml + pw, y);
      ctx.stroke();
      ctx.fillText((v * 1000).toFixed(0) + 'mm', ml - 5, y + 3);
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      const y0 = mapY(0);
      ctx.strokeStyle = COLORS.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ml, y0);
      ctx.lineTo(ml + pw, y0);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);
  }

  drawLine(ctx, times, values, endIdx, mapX, mapY, color, lineWidth) {
    if (endIdx < 1) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(mapX(times[0]), mapY(values[0]));
    for (let i = 1; i <= endIdx; i++) {
      ctx.lineTo(mapX(times[i]), mapY(values[i]));
    }
    ctx.stroke();
  }

  findTimeIndex(times, t) {
    // Binary search
    let lo = 0, hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  niceStep(range, maxTicks) {
    const rough = range / maxTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3.5) step = 2;
    else if (norm < 7.5) step = 5;
    else step = 10;
    return step * mag;
  }
}

/**
 * Frequency response graph renderer (log-log Bode-style)
 */
const FREQ_COLORS = {
  sprungAcc: '#4fc3f7',
  rattleSpace: '#81c784',
  tireDef: '#ff8a65',
  sprungAccB: 'rgba(79,195,247,0.35)',
  rattleSpaceB: 'rgba(129,199,132,0.35)',
  tireDefB: 'rgba(255,138,101,0.35)',
  grid: '#333',
  axis: '#555',
  text: '#888',
  bg: '#1a1a1a'
};

export class FreqResponseRenderer {
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

  /**
   * Draw frequency response
   * @param {object} frA - { freqs, sprungAccMag, rattleSpaceMag, tireDeflMag }
   * @param {object|null} frB - same for Set B
   */
  draw(frA, frB) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    const ml = 50, mr = 15, mt = 25, mb = 30;
    const pw = w - ml - mr;
    const ph = h - mt - mb;

    ctx.fillStyle = FREQ_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!frA) return;

    // Log frequency range
    const fMin = frA.freqs[0];
    const fMax = frA.freqs[frA.freqs.length - 1];
    const logFMin = Math.log10(fMin);
    const logFMax = Math.log10(fMax);

    // Find magnitude range (log scale)
    const allMags = [
      ...frA.sprungAccMag, ...frA.rattleSpaceMag, ...frA.tireDeflMag
    ];
    if (frB) {
      allMags.push(...frB.sprungAccMag, ...frB.rattleSpaceMag, ...frB.tireDeflMag);
    }

    let magMin = Infinity, magMax = -Infinity;
    for (const m of allMags) {
      if (m > 0 && m < magMin) magMin = m;
      if (m > magMax) magMax = m;
    }

    // Use log scale for magnitude with padding
    const logMMin = Math.floor(Math.log10(magMin || 0.001));
    const logMMax = Math.ceil(Math.log10(magMax || 100));

    const mapX = (f) => ml + (Math.log10(f) - logFMin) / (logFMax - logFMin) * pw;
    const mapY = (m) => mt + ph - (Math.log10(m) - logMMin) / (logMMax - logMMin) * ph;

    // Grid
    this.drawLogGrid(ctx, ml, mt, pw, ph, fMin, fMax, logFMin, logFMax, logMMin, logMMax, mapX, mapY);

    // Clip
    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();

    // Set B (draw first, behind)
    if (frB) {
      this.drawLogLine(ctx, frB.freqs, frB.sprungAccMag, mapX, mapY, FREQ_COLORS.sprungAccB, 2);
      this.drawLogLine(ctx, frB.freqs, frB.rattleSpaceMag, mapX, mapY, FREQ_COLORS.rattleSpaceB, 2);
      this.drawLogLine(ctx, frB.freqs, frB.tireDeflMag, mapX, mapY, FREQ_COLORS.tireDefB, 2);
    }

    // Set A
    this.drawLogLine(ctx, frA.freqs, frA.sprungAccMag, mapX, mapY, FREQ_COLORS.sprungAcc, 2);
    this.drawLogLine(ctx, frA.freqs, frA.rattleSpaceMag, mapX, mapY, FREQ_COLORS.rattleSpace, 2);
    this.drawLogLine(ctx, frA.freqs, frA.tireDeflMag, mapX, mapY, FREQ_COLORS.tireDef, 2);

    ctx.restore();

    // Title
    ctx.fillStyle = FREQ_COLORS.text;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Frequency Response', ml, mt - 8);
  }

  drawLogGrid(ctx, ml, mt, pw, ph, fMin, fMax, logFMin, logFMax, logMMin, logMMax, mapX, mapY) {
    ctx.fillStyle = FREQ_COLORS.text;
    ctx.font = '10px monospace';

    // Frequency grid (decades + sub-decades)
    ctx.textAlign = 'center';
    for (let dec = Math.floor(logFMin); dec <= Math.ceil(logFMax); dec++) {
      for (let sub = 1; sub <= 9; sub++) {
        const f = sub * Math.pow(10, dec);
        if (f < fMin || f > fMax) continue;
        const x = mapX(f);
        ctx.strokeStyle = sub === 1 ? '#444' : '#2a2a2a';
        ctx.lineWidth = sub === 1 ? 0.8 : 0.4;
        ctx.beginPath();
        ctx.moveTo(x, mt);
        ctx.lineTo(x, mt + ph);
        ctx.stroke();
        if (sub === 1 || sub === 2 || sub === 5) {
          ctx.fillText(f >= 1 ? f.toFixed(0) : f.toFixed(1), x, mt + ph + 14);
        }
      }
    }

    // Frequency axis label
    ctx.fillText('Hz', ml + pw + 5, mt + ph + 14);

    // Magnitude grid (decades)
    ctx.textAlign = 'right';
    for (let dec = logMMin; dec <= logMMax; dec++) {
      for (let sub = 1; sub <= 9; sub++) {
        const m = sub * Math.pow(10, dec);
        const logM = Math.log10(m);
        if (logM < logMMin || logM > logMMax) continue;
        const y = mapY(m);
        ctx.strokeStyle = sub === 1 ? '#444' : '#2a2a2a';
        ctx.lineWidth = sub === 1 ? 0.8 : 0.4;
        ctx.beginPath();
        ctx.moveTo(ml, y);
        ctx.lineTo(ml + pw, y);
        ctx.stroke();
        if (sub === 1) {
          const label = m >= 1 ? m.toFixed(0) : m < 0.01 ? m.toExponential(0) : m.toFixed(2);
          ctx.fillText(label, ml - 5, y + 3);
        }
      }
    }

    // Border
    ctx.strokeStyle = FREQ_COLORS.axis;
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

/**
 * Actuator force u(t) graph renderer
 */
export class ForceGraphRenderer {
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

  /**
   * Draw actuator force vs time
   * @param {number[]} time
   * @param {number[]} force - u(t) in Newtons
   * @param {number} currentTime
   */
  draw(time, force, currentTime) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    const ml = 50, mr = 15, mt = 25, mb = 30;
    const pw = w - ml - mr;
    const ph = h - mt - mb;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    if (!time || time.length === 0) return;

    const tMin = 0, tMax = time[time.length - 1];

    // Find force range
    let fMin = 0, fMax = 0;
    for (const f of force) {
      if (f < fMin) fMin = f;
      if (f > fMax) fMax = f;
    }
    const fPad = Math.max((fMax - fMin) * 0.15, 10);
    fMin -= fPad;
    fMax += fPad;

    const mapX = (t) => ml + (t - tMin) / (tMax - tMin) * pw;
    const mapY = (v) => mt + ph - (v - fMin) / (fMax - fMin) * ph;

    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';

    // Time ticks
    const tStep = this.niceStep(tMax - tMin, 6);
    ctx.textAlign = 'center';
    for (let t = 0; t <= tMax; t += tStep) {
      const x = mapX(t);
      ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
      ctx.fillText(t.toFixed(1) + 's', x, mt + ph + 15);
    }

    // Force ticks
    const fStep = this.niceStep(fMax - fMin, 5);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(fMin / fStep) * fStep; v <= fMax; v += fStep) {
      const y = mapY(v);
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
      ctx.fillText(v.toFixed(0) + 'N', ml - 4, y + 3);
    }

    // Zero line
    if (fMin < 0 && fMax > 0) {
      const y0 = mapY(0);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ml, y0); ctx.lineTo(ml + pw, y0); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);

    // Clip & draw force line
    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();

    const endIdx = this.findTimeIndex(time, currentTime);
    ctx.beginPath();
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.moveTo(mapX(time[0]), mapY(force[0]));
    for (let i = 1; i <= endIdx; i++) {
      ctx.lineTo(mapX(time[i]), mapY(force[i]));
    }
    ctx.stroke();

    // Time indicator
    if (currentTime > 0 && currentTime <= tMax) {
      const cx = mapX(currentTime);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cx, mt); ctx.lineTo(cx, mt + ph); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Actuator Force u(t)', ml, mt - 8);
  }

  findTimeIndex(times, t) {
    let lo = 0, hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  niceStep(range, maxTicks) {
    const rough = range / maxTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    if (norm < 1.5) return mag;
    if (norm < 3.5) return 2 * mag;
    if (norm < 7.5) return 5 * mag;
    return 10 * mag;
  }
}
