/**
 * 2D Canvas Animation for Quarter-Car Model
 * Textbook-style schematic: ms box — ks/cs — mu box — kt — tire circle — road
 */

const COLORS = {
  body: '#4fc3f7',
  unsprung: '#ff8a65',
  road: '#888',
  spring: '#81c784',
  damper: '#ce93d8',
  tire: '#ffcc80',
  tireSpring: '#aaa',
  label: '#999',
  bodyB: '#81c784',
  unsprungB: '#ffb74d',
  bg: '#1e1e1e',
  text: '#ccc',
  dim: '#777'
};

export class AnimationRenderer {
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

  draw(stateA, stateB, roadFn, speed, labelA, labelB) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const scale = 800; // px per meter

    // Road baseline
    const roadBaseY = h * 0.88;

    // Draw road across full width
    this.drawRoad(ctx, roadFn, stateA.t, roadBaseY, w, scale);

    // Car positions
    const carAx = stateB ? w * 0.32 : w * 0.5;

    this.drawSchematic(ctx, stateA, carAx, roadBaseY, scale, COLORS.body, COLORS.unsprung, labelA || 'A');

    if (stateB) {
      const carBx = w * 0.68;
      this.drawSchematic(ctx, stateB, carBx, roadBaseY, scale, COLORS.bodyB, COLORS.unsprungB, labelB || 'B');
    }

    // Time
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`t = ${stateA.t.toFixed(2)}s`, 10, 20);
  }

  drawRoad(ctx, roadFn, t, roadBaseY, w, scale) {
    // Road window: show past road (left of car) and current zr at car.
    // Right of car = "upcoming" road the car hasn't reached yet, shown as flat line at current zr.
    const windowTime = 2.5;
    const carRatio = 0.3;
    const tStart = t - windowTime * carRatio;
    const tEnd = t + windowTime * (1 - carRatio);
    const numPts = 300;
    const carX = w * carRatio;
    const currentZr = roadFn(Math.max(0, t));

    ctx.beginPath();
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = 2;

    for (let i = 0; i <= numPts; i++) {
      const frac = i / numPts;
      const ti = tStart + frac * windowTime;
      const x = frac * w;

      // Past & present: show actual road. Future: show flat at current road level.
      let zr;
      if (ti <= t) {
        zr = roadFn(Math.max(0, ti));
      } else {
        zr = currentZr;
      }
      const y = roadBaseY - zr * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Ground hatching below road
    ctx.lineTo(w, roadBaseY + 30);
    ctx.lineTo(0, roadBaseY + 30);
    ctx.closePath();
    ctx.fillStyle = '#232323';
    ctx.fill();

    // Hatching lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let x = -30; x < w + 30; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, roadBaseY + 1);
      ctx.lineTo(x - 15, roadBaseY + 18);
      ctx.stroke();
    }
  }

  drawSchematic(ctx, state, cx, roadBaseY, scale, bodyColor, unsprungColor, label) {
    const { zs, zu, zr } = state;

    // Geometry constants
    const msW = 80, msH = 36;      // sprung mass box
    const muW = 60, muH = 28;      // unsprung mass box
    const tireR = 14;               // tire circle radius
    const suspGap = 90;             // nominal spring/damper length
    const tireGap = 50;             // nominal tire spring length
    const springDamperSpacing = 30; // horizontal distance between spring & damper centers

    // Road surface Y at this car's position
    const roadY = roadBaseY - zr * scale;

    // Tire contact point on road
    const tireContactY = roadY;

    // Tire circle center
    const tireCenterY = tireContactY - tireR;

    // mu box: bottom sits on top of tire spring zone
    // tire spring goes from tire circle top to mu box bottom
    const tireSpringTop = tireCenterY - tireR - 2;
    const muBottom = tireSpringTop - tireGap + (zu - zr) * scale;
    const muTop = muBottom - muH;
    const muCenterY = (muTop + muBottom) / 2;

    // ms box: bottom sits above suspension spring/damper
    const msBottom = muTop - suspGap + (zs - zu) * scale;
    const msTop = msBottom - msH;
    const msCenterY = (msTop + msBottom) / 2;

    // ── Draw from bottom to top ──

    // 1. Tire (filled circle at road contact)
    ctx.beginPath();
    ctx.arc(cx, tireCenterY, tireR, 0, Math.PI * 2);
    ctx.fillStyle = '#444';
    ctx.fill();
    ctx.strokeStyle = unsprungColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Ground contact line
    ctx.beginPath();
    ctx.moveTo(cx - tireR - 3, tireContactY);
    ctx.lineTo(cx + tireR + 3, tireContactY);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Tire spring (kt) — from top of tire circle to bottom of mu box
    const ktTop = tireCenterY - tireR;
    const ktBottom = muBottom;
    this.drawZigzagSpring(ctx, cx, ktBottom, cx, ktTop, 5, 7, COLORS.tireSpring, 1.5);

    // kt label
    ctx.fillStyle = COLORS.label;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('kₜ', cx + 14, (ktTop + ktBottom) / 2 + 4);

    // 3. Unsprung mass box (mu)
    this.drawMassBox(ctx, cx, muTop, muW, muH, unsprungColor, 'mᵤ');

    // 4. Suspension spring (ks) — LEFT side, from mu top to ms bottom
    const springX = cx - springDamperSpacing;
    this.drawZigzagSpring(ctx, springX, msBottom, springX, muTop, 7, 10, COLORS.spring, 2);

    // Horizontal connector lines from boxes to spring/damper
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1.5;
    // From mu box top-left to spring bottom
    ctx.beginPath();
    ctx.moveTo(cx - muW / 2, muTop);
    ctx.lineTo(springX, muTop);
    ctx.stroke();
    // From ms box bottom-left to spring top
    ctx.beginPath();
    ctx.moveTo(cx - msW / 2, msBottom);
    ctx.lineTo(springX, msBottom);
    ctx.stroke();

    // ks label
    ctx.fillStyle = COLORS.label;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('kₛ', springX - 14, (muTop + msBottom) / 2 + 4);

    // 5. Damper (cs) — RIGHT side
    const damperX = cx + springDamperSpacing;
    this.drawDashpotDamper(ctx, damperX, msBottom, damperX, muTop, COLORS.damper, 2);

    // Horizontal connector lines to damper
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1.5;
    // From mu box top-right to damper bottom
    ctx.beginPath();
    ctx.moveTo(cx + muW / 2, muTop);
    ctx.lineTo(damperX, muTop);
    ctx.stroke();
    // From ms box bottom-right to damper top
    ctx.beginPath();
    ctx.moveTo(cx + msW / 2, msBottom);
    ctx.lineTo(damperX, msBottom);
    ctx.stroke();

    // cs label
    ctx.fillStyle = COLORS.label;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('cₛ', damperX + 14, (muTop + msBottom) / 2 + 4);

    // 6. Sprung mass box (ms)
    this.drawMassBox(ctx, cx, msTop, msW, msH, bodyColor, 'mₛ');

    // 7. Label (A / B / Passive / Active)
    ctx.fillStyle = bodyColor;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, msTop - 10);

    // 8. Displacement annotations on right side
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = bodyColor;
    const annotX = cx + msW / 2 + 20;
    ctx.fillText(`zₛ = ${(zs * 1000).toFixed(1)}mm`, annotX, msCenterY + 4);
    ctx.fillStyle = unsprungColor;
    ctx.fillText(`zᵤ = ${(zu * 1000).toFixed(1)}mm`, annotX, muCenterY + 4);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`zᵣ = ${(zr * 1000).toFixed(1)}mm`, annotX, tireContactY - 4);
  }

  /**
   * Draw a mass box with label
   */
  drawMassBox(ctx, cx, top, w, h, color, label) {
    const x = cx - w / 2;
    // Fill
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x, top, w, h);
    ctx.globalAlpha = 1;
    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, top, w, h);
    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, top + h / 2);
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Zigzag spring (like the reference image)
   * Draws from (x, yTop) down to (x, yBottom)
   */
  drawZigzagSpring(ctx, x1, yTop, x2, yBottom, coils, amplitude, color, lineWidth) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    const leadIn = 6;
    const startY = yTop + leadIn;
    const endY = yBottom - leadIn;
    const segLen = (endY - startY) / (coils * 2);

    ctx.moveTo(x1, yTop);
    ctx.lineTo(x1, startY);

    for (let i = 0; i < coils * 2; i++) {
      const yy = startY + (i + 1) * segLen;
      const xx = x1 + (i % 2 === 0 ? -amplitude : amplitude);
      ctx.lineTo(xx, yy);
    }

    ctx.lineTo(x2, yBottom);
    ctx.stroke();
  }

  /**
   * Dashpot damper symbol (like the reference image)
   * Piston rod from top, cylinder open at top, rod from bottom
   */
  drawDashpotDamper(ctx, x1, yTop, x2, yBottom, color, lineWidth) {
    const totalLen = yBottom - yTop;
    const cylW = 16;
    const cylH = totalLen * 0.32;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    // Piston rod from top down into cylinder
    const cylTopY = yTop + totalLen * 0.28;
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x1, cylTopY + cylH * 0.3);
    ctx.stroke();

    // Piston head (horizontal line inside cylinder)
    const pistonY = cylTopY + cylH * 0.3;
    ctx.beginPath();
    ctx.moveTo(x1 - cylW / 2 + 2, pistonY);
    ctx.lineTo(x1 + cylW / 2 - 2, pistonY);
    ctx.lineWidth = lineWidth + 0.5;
    ctx.stroke();
    ctx.lineWidth = lineWidth;

    // Cylinder body (U shape, open top)
    const cylBottomY = cylTopY + cylH;
    ctx.beginPath();
    ctx.moveTo(x1 - cylW / 2, cylTopY);
    ctx.lineTo(x1 - cylW / 2, cylBottomY);
    ctx.lineTo(x1 + cylW / 2, cylBottomY);
    ctx.lineTo(x1 + cylW / 2, cylTopY);
    ctx.stroke();

    // Rod from cylinder bottom down
    ctx.beginPath();
    ctx.moveTo(x2, cylBottomY);
    ctx.lineTo(x2, yBottom);
    ctx.stroke();
  }
}
