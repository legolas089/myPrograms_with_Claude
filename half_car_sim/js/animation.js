/**
 * 2D Canvas Animation for Half-Car Model
 * Schematic: sprung mass beam (tilted) — front/rear suspensions — unsprung masses — tires — road
 */

const COLORS = {
  body: '#4fc3f7',
  bodyB: '#81c784',
  frontUnsprung: '#ff8a65',
  rearUnsprung: '#ce93d8',
  frontUnsprungB: '#ffb74d',
  rearUnsprungB: '#ba68c8',
  spring: '#81c784',
  damper: '#ce93d8',
  tireSpring: '#aaa',
  road: '#888',
  label: '#999',
  bg: '#1e1e1e',
  text: '#ccc',
  dim: '#777',
  cg: '#ffd54f'
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

  draw(stateA, stateB, roadFrontFn, params, t) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const roadBaseY = h * 0.88;
    const scale = 800;

    // Draw road
    this.drawRoad(ctx, roadFrontFn, t, roadBaseY, w, scale);

    // Draw schematic(s)
    const cx = stateB ? w * 0.3 : w * 0.5;
    this.drawHalfCar(ctx, stateA, params, cx, roadBaseY, scale,
      COLORS.body, COLORS.frontUnsprung, COLORS.rearUnsprung, 'A');

    if (stateB) {
      this.drawHalfCar(ctx, stateB, params, w * 0.7, roadBaseY, scale,
        COLORS.bodyB, COLORS.frontUnsprungB, COLORS.rearUnsprungB, 'B');
    }

    // Time display
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`t = ${t.toFixed(2)}s`, 10, 20);
  }

  drawRoad(ctx, roadFn, t, roadBaseY, w, scale) {
    const windowTime = 2.5;
    const carRatio = 0.3;
    const tStart = t - windowTime * carRatio;
    const currentZr = roadFn(Math.max(0, t));
    const numPts = 300;

    ctx.beginPath();
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = 2;

    for (let i = 0; i <= numPts; i++) {
      const frac = i / numPts;
      const ti = tStart + frac * windowTime;
      const x = frac * w;
      const zr = ti <= t ? roadFn(Math.max(0, ti)) : currentZr;
      const y = roadBaseY - zr * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Ground fill
    ctx.lineTo(w, roadBaseY + 30);
    ctx.lineTo(0, roadBaseY + 30);
    ctx.closePath();
    ctx.fillStyle = '#232323';
    ctx.fill();

    // Hatching
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let x = -30; x < w + 30; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, roadBaseY + 1);
      ctx.lineTo(x - 15, roadBaseY + 18);
      ctx.stroke();
    }
  }

  drawHalfCar(ctx, state, params, cx, roadBaseY, scale, bodyColor, frontColor, rearColor, label) {
    const { y1, y2, y3, phi3, u1, u2 } = state;
    const { b1, b2 } = params;

    // Layout constants
    const wheelSpacing = 180;
    const L = b1 + b2;
    const frontX = cx + wheelSpacing / 2;
    const rearX = cx - wheelSpacing / 2;
    const cgFrac = b2 / L;
    const cgX = rearX + cgFrac * (frontX - rearX);

    const msH = 28;
    const muW = 50, muH = 24;
    const tireR = 13;
    const suspGap = 75;
    const tireGap = 40;
    const sdSpacing = 22; // spring-damper horizontal spacing

    // Front axle positions
    const frontRoadY = roadBaseY - u1 * scale;
    const frontTireContactY = frontRoadY;
    const frontTireCenterY = frontTireContactY - tireR;
    const frontTireSpringTop = frontTireCenterY - tireR - 2;
    const frontMuBottom = frontTireSpringTop - tireGap + (y1 - u1) * scale;
    const frontMuTop = frontMuBottom - muH;

    // Rear axle positions
    const rearRoadY = roadBaseY - u2 * scale;
    const rearTireContactY = rearRoadY;
    const rearTireCenterY = rearTireContactY - tireR;
    const rearTireSpringTop = rearTireCenterY - tireR - 2;
    const rearMuBottom = rearTireSpringTop - tireGap + (y2 - u2) * scale;
    const rearMuTop = rearMuBottom - muH;

    // Body attachment points (bottom of body at each axle)
    const frontBodyRelDisp = (y3 - b1 * phi3 - y1);
    const rearBodyRelDisp = (y3 + b2 * phi3 - y2);
    const frontBodyBottom = frontMuTop - suspGap + frontBodyRelDisp * scale;
    const rearBodyBottom = rearMuTop - suspGap + rearBodyRelDisp * scale;
    const frontBodyTop = frontBodyBottom - msH;
    const rearBodyTop = rearBodyBottom - msH;

    // ── Draw from bottom to top ──

    // Tires
    this.drawTire(ctx, frontX, frontTireCenterY, tireR, frontTireContactY, frontColor);
    this.drawTire(ctx, rearX, rearTireCenterY, tireR, rearTireContactY, rearColor);

    // Tire springs
    this.drawZigzagSpring(ctx, frontX, frontMuBottom, frontX, frontTireCenterY - tireR, 5, 6, COLORS.tireSpring, 1.5);
    this.drawZigzagSpring(ctx, rearX, rearMuBottom, rearX, rearTireCenterY - tireR, 5, 6, COLORS.tireSpring, 1.5);

    // Tire spring labels
    ctx.fillStyle = COLORS.label;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('kₜ₁', frontX + 12, (frontMuBottom + frontTireCenterY - tireR) / 2 + 3);
    ctx.fillText('kₜ₂', rearX + 12, (rearMuBottom + rearTireCenterY - tireR) / 2 + 3);

    // Unsprung masses
    this.drawMassBox(ctx, frontX, frontMuTop, muW, muH, frontColor, 'm₁');
    this.drawMassBox(ctx, rearX, rearMuTop, muW, muH, rearColor, 'm₂');

    // Front suspension (spring left, damper right)
    const fSpX = frontX - sdSpacing;
    const fDmX = frontX + sdSpacing;
    this.drawZigzagSpring(ctx, fSpX, frontBodyBottom, fSpX, frontMuTop, 6, 8, COLORS.spring, 1.5);
    this.drawDashpotDamper(ctx, fDmX, frontBodyBottom, fDmX, frontMuTop, COLORS.damper, 1.5);

    // Front suspension connectors
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(frontX - muW / 2, frontMuTop); ctx.lineTo(fSpX, frontMuTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(frontX + muW / 2, frontMuTop); ctx.lineTo(fDmX, frontMuTop); ctx.stroke();

    // Front suspension labels
    ctx.fillStyle = COLORS.label;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('K₁', fSpX - 10, (frontMuTop + frontBodyBottom) / 2 + 3);
    ctx.textAlign = 'left';
    ctx.fillText('C₁', fDmX + 10, (frontMuTop + frontBodyBottom) / 2 + 3);

    // Rear suspension (spring left, damper right)
    const rSpX = rearX - sdSpacing;
    const rDmX = rearX + sdSpacing;
    this.drawZigzagSpring(ctx, rSpX, rearBodyBottom, rSpX, rearMuTop, 6, 8, COLORS.spring, 1.5);
    this.drawDashpotDamper(ctx, rDmX, rearBodyBottom, rDmX, rearMuTop, COLORS.damper, 1.5);

    // Rear suspension connectors
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(rearX - muW / 2, rearMuTop); ctx.lineTo(rSpX, rearMuTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rearX + muW / 2, rearMuTop); ctx.lineTo(rDmX, rearMuTop); ctx.stroke();

    // Rear suspension labels
    ctx.fillStyle = COLORS.label;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('K₂', rSpX - 10, (rearMuTop + rearBodyBottom) / 2 + 3);
    ctx.textAlign = 'left';
    ctx.fillText('C₂', rDmX + 10, (rearMuTop + rearBodyBottom) / 2 + 3);

    // Body connectors from body to spring/damper
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1.2;
    // Front
    ctx.beginPath(); ctx.moveTo(frontX - muW / 2 - 8, frontBodyBottom); ctx.lineTo(fSpX, frontBodyBottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(frontX + muW / 2 + 8, frontBodyBottom); ctx.lineTo(fDmX, frontBodyBottom); ctx.stroke();
    // Rear
    ctx.beginPath(); ctx.moveTo(rearX - muW / 2 - 8, rearBodyBottom); ctx.lineTo(rSpX, rearBodyBottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rearX + muW / 2 + 8, rearBodyBottom); ctx.lineTo(rDmX, rearBodyBottom); ctx.stroke();

    // Body (tilted rectangle)
    const bodyExtendL = 20; // extra extension beyond axle positions
    const bfl = frontBodyBottom;
    const bft = frontBodyTop;
    const brl = rearBodyBottom;
    const brt = rearBodyTop;

    ctx.beginPath();
    ctx.moveTo(rearX - bodyExtendL, brl);
    ctx.lineTo(frontX + bodyExtendL, bfl);
    ctx.lineTo(frontX + bodyExtendL, bft);
    ctx.lineTo(rearX - bodyExtendL, brt);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Body label (offset right from CG to avoid overlap with CG marker)
    ctx.fillStyle = bodyColor;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    const bodyCenterY = (brt + brl + bft + bfl) / 4;
    ctx.fillText('m₃, I₃', cgX + 12, bodyCenterY + 4);

    // CG marker (circle with dot)
    const cgY = rearBodyBottom + cgFrac * (frontBodyBottom - rearBodyBottom) - msH / 2;
    ctx.beginPath();
    ctx.arc(cgX, cgY, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.cg;
    ctx.fill();
    ctx.strokeStyle = COLORS.cg;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pitch angle arc at CG
    if (Math.abs(phi3) > 0.0005) {
      const arcR = 22;
      const startAngle = 0;
      const endAngle = -phi3 * 5; // exaggerate for visibility
      ctx.beginPath();
      ctx.arc(cgX, cgY - msH - 5, arcR, startAngle, endAngle, phi3 > 0);
      ctx.strokeStyle = COLORS.cg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Arrow at end of arc
      const arrowAngle = endAngle;
      const ax = cgX + arcR * Math.cos(arrowAngle);
      const ay = (cgY - msH - 5) + arcR * Math.sin(arrowAngle);
      ctx.beginPath();
      ctx.arc(ax, ay, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // φ₃ label (above CG)
    ctx.fillStyle = COLORS.cg;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('φ₃', cgX, cgY - msH - 30);

    // Set label (top-left of body, away from φ₃)
    ctx.fillStyle = bodyColor;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, rearX - bodyExtendL, rearBodyTop - 12);

    // Annotations
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const annotX = frontX + muW / 2 + 25;
    ctx.fillStyle = bodyColor;
    ctx.fillText(`y₃ = ${(y3 * 1000).toFixed(1)}mm`, annotX, bodyCenterY);
    ctx.fillStyle = COLORS.cg;
    ctx.fillText(`φ₃ = ${(phi3 * 180 / Math.PI).toFixed(2)}°`, annotX, bodyCenterY + 14);
    ctx.fillStyle = frontColor;
    ctx.fillText(`y₁ = ${(y1 * 1000).toFixed(1)}mm`, annotX, (frontMuTop + frontMuBottom) / 2 + 4);
    ctx.fillStyle = rearColor;
    const annotXR = rearX - muW / 2 - 90;
    ctx.fillText(`y₂ = ${(y2 * 1000).toFixed(1)}mm`, annotXR, (rearMuTop + rearMuBottom) / 2 + 4);

    // b1, b2 dimension lines
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    const dimY = frontBodyBottom + 12;
    // b1 line (CG to front)
    ctx.beginPath(); ctx.moveTo(cgX, dimY); ctx.lineTo(frontX, dimY); ctx.stroke();
    // b2 line (CG to rear)
    ctx.beginPath(); ctx.moveTo(rearX, dimY); ctx.lineTo(cgX, dimY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = COLORS.dim;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('b₁', (cgX + frontX) / 2, dimY + 12);
    ctx.fillText('b₂', (rearX + cgX) / 2, dimY + 12);
  }

  drawTire(ctx, cx, cy, r, contactY, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#444';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Ground contact
    ctx.beginPath();
    ctx.moveTo(cx - r - 3, contactY);
    ctx.lineTo(cx + r + 3, contactY);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawMassBox(ctx, cx, top, w, h, color, label) {
    const x = cx - w / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x, top, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, top + h / 2);
    ctx.textBaseline = 'alphabetic';
  }

  drawZigzagSpring(ctx, x1, yTop, x2, yBottom, coils, amplitude, color, lineWidth) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    const leadIn = 5;
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

  drawDashpotDamper(ctx, x1, yTop, x2, yBottom, color, lineWidth) {
    const totalLen = yBottom - yTop;
    const cylW = 14;
    const cylH = totalLen * 0.32;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    const cylTopY = yTop + totalLen * 0.28;
    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x1, cylTopY + cylH * 0.3);
    ctx.stroke();

    const pistonY = cylTopY + cylH * 0.3;
    ctx.beginPath();
    ctx.moveTo(x1 - cylW / 2 + 2, pistonY);
    ctx.lineTo(x1 + cylW / 2 - 2, pistonY);
    ctx.lineWidth = lineWidth + 0.5;
    ctx.stroke();
    ctx.lineWidth = lineWidth;

    const cylBottomY = cylTopY + cylH;
    ctx.beginPath();
    ctx.moveTo(x1 - cylW / 2, cylTopY);
    ctx.lineTo(x1 - cylW / 2, cylBottomY);
    ctx.lineTo(x1 + cylW / 2, cylBottomY);
    ctx.lineTo(x1 + cylW / 2, cylTopY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, cylBottomY);
    ctx.lineTo(x2, yBottom);
    ctx.stroke();
  }
}
