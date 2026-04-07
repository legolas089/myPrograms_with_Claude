/**
 * Front-View Double Wishbone Suspension Animation
 * Draws both sides (symmetric), with IC construction lines, Swing Arm, Roll Center
 */

const COLORS = {
  lowerArm: '#4fc3f7',
  upperArm: '#ff8a65',
  upright: '#ce93d8',
  chassis: '#666',
  tire: '#888',
  tireRim: '#555',
  ground: '#888',
  groundFill: '#232323',
  icLine: 'rgba(255,213,79,0.4)',
  icPoint: '#ffd54f',
  rcPoint: '#ef5350',
  rcLine: 'rgba(239,83,80,0.35)',
  saLine: 'rgba(129,199,132,0.6)',
  saPoint: '#81c784',
  pivot: '#fff',
  ballJoint: '#ffb74d',
  centerline: 'rgba(255,255,255,0.15)',
  bg: '#1e1e1e',
  text: '#ccc',
  dim: '#777',
  setB_lowerArm: '#81c784',
  setB_upperArm: '#ffb74d',
  setB_upright: '#ba68c8',
  setB_icPoint: '#ffab40',
  setB_rcPoint: '#ff7043',
  setB_saLine: 'rgba(186,104,200,0.5)'
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

  /**
   * Draw the front-view suspension
   * @param {Object} frameA - {P1, P2, P3, P4, IC, RC, contactX} for Set A
   * @param {Object} frameB - same for Set B (or null)
   * @param {Object} paramsA - input params for A
   * @param {number} bumpVal - current bump value in mm
   */
  draw(frameA, frameB, paramsA, bumpVal) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!frameA) {
      ctx.fillStyle = '#555';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('파라미터를 설정하고 [Sweep] 버튼을 누르세요', w / 2, h / 2);
      return;
    }

    // Compute scale to fit the geometry
    // We need to show from -halfTrack to +halfTrack in X, and 0 to ~600mm in Y
    const halfTrack = paramsA.halfTrack;
    const viewPadX = 80; // px padding
    const viewPadTop = 40;
    const viewPadBottom = 50;

    // Scale: pixels per mm
    const xRange = halfTrack * 2 + 200; // extra for IC/RC labels
    const yRange = 650; // enough for upper arm pivots + some headroom
    const scaleX = (w - 2 * viewPadX) / xRange;
    const scaleY = (h - viewPadTop - viewPadBottom) / yRange;
    const scale = Math.min(scaleX, scaleY);

    // Transform: center of canvas = vehicle centerline at ground level
    const originX = w / 2;
    const groundY = h - viewPadBottom;

    // Convert geometry coords (mm, y-up) to canvas coords (px, y-down)
    const toCanvasX = (x) => originX + x * scale;
    const toCanvasY = (y) => groundY - y * scale;

    // Draw ground
    this.drawGround(ctx, w, groundY);

    // Draw centerline
    ctx.strokeStyle = COLORS.centerline;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(originX, viewPadTop);
    ctx.lineTo(originX, groundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CL', originX, viewPadTop - 4);

    // Draw Set B first (behind A) if present
    if (frameB) {
      this.drawSuspension(ctx, frameB, toCanvasX, toCanvasY, scale, true);
    }

    // Draw Set A
    this.drawSuspension(ctx, frameA, toCanvasX, toCanvasY, scale, false);

    // Bump display
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Bump: ${bumpVal >= 0 ? '+' : ''}${bumpVal.toFixed(1)} mm`, 10, 20);

    // Set labels
    if (frameB) {
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = COLORS.lowerArm;
      ctx.textAlign = 'left';
      ctx.fillText('A', 10, 40);
      ctx.fillStyle = COLORS.setB_lowerArm;
      ctx.fillText('B', 30, 40);
    }
  }

  drawGround(ctx, w, groundY) {
    // Ground line
    ctx.strokeStyle = COLORS.ground;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // Hatching
    ctx.fillStyle = COLORS.groundFill;
    ctx.fillRect(0, groundY, w, 30);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let x = -30; x < w + 30; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 1);
      ctx.lineTo(x - 15, groundY + 18);
      ctx.stroke();
    }
  }

  drawSuspension(ctx, frame, toCanvasX, toCanvasY, scale, isSetB) {
    const { P1, P2, P3, P4, IC, RC, contactX } = frame;

    // Mirror for left side
    const mP1 = { x: -P1.x, y: P1.y };
    const mP2 = { x: -P2.x, y: P2.y };
    const mP3 = { x: -P3.x, y: P3.y };
    const mP4 = { x: -P4.x, y: P4.y };

    const colors = isSetB ? {
      lower: COLORS.setB_lowerArm,
      upper: COLORS.setB_upperArm,
      upright: COLORS.setB_upright,
      icLine: 'rgba(255,171,64,0.25)',
      icPoint: COLORS.setB_icPoint,
      rcPoint: COLORS.setB_rcPoint,
      rcLine: 'rgba(255,112,67,0.25)',
      saLine: COLORS.setB_saLine
    } : {
      lower: COLORS.lowerArm,
      upper: COLORS.upperArm,
      upright: COLORS.upright,
      icLine: COLORS.icLine,
      icPoint: COLORS.icPoint,
      rcPoint: COLORS.rcPoint,
      rcLine: COLORS.rcLine,
      saLine: COLORS.saLine
    };

    const alpha = isSetB ? 0.5 : 1.0;
    const lineW = isSetB ? 2 : 3;

    // Draw tires (right and left)
    this.drawTire(ctx, toCanvasX(contactX), toCanvasY(0), scale, isSetB);
    this.drawTire(ctx, toCanvasX(-contactX), toCanvasY(0), scale, isSetB);

    // Draw chassis (simplified box between inner pivots)
    this.drawChassis(ctx, P1, P2, mP1, mP2, toCanvasX, toCanvasY, isSetB);

    // ── IC construction lines (dashed, extended from arms through ball joints) ──
    if (IC && Math.abs(IC.x) < 5000) {
      ctx.globalAlpha = alpha;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;

      // Right side: lower arm line P1→P3→IC, upper arm line P2→P4→IC
      ctx.strokeStyle = colors.icLine;
      ctx.beginPath();
      ctx.moveTo(toCanvasX(P1.x), toCanvasY(P1.y));
      ctx.lineTo(toCanvasX(IC.x), toCanvasY(IC.y));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toCanvasX(P2.x), toCanvasY(P2.y));
      ctx.lineTo(toCanvasX(IC.x), toCanvasY(IC.y));
      ctx.stroke();

      // Left side (mirrored)
      const mIC = { x: -IC.x, y: IC.y };
      ctx.beginPath();
      ctx.moveTo(toCanvasX(mP1.x), toCanvasY(mP1.y));
      ctx.lineTo(toCanvasX(mIC.x), toCanvasY(mIC.y));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toCanvasX(mP2.x), toCanvasY(mP2.y));
      ctx.lineTo(toCanvasX(mIC.x), toCanvasY(mIC.y));
      ctx.stroke();

      ctx.setLineDash([]);

      // IC points
      this.drawPoint(ctx, toCanvasX(IC.x), toCanvasY(IC.y), 5, colors.icPoint, alpha);
      this.drawPoint(ctx, toCanvasX(mIC.x), toCanvasY(mIC.y), 5, colors.icPoint, alpha);

      // IC label
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.icPoint;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('IC', toCanvasX(IC.x) + 8, toCanvasY(IC.y) - 4);

      // ── Roll Center construction lines (tire contact to IC) ──
      if (RC) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = colors.rcLine;
        ctx.lineWidth = 1.2;
        // Right: from tire contact through IC to RC
        ctx.beginPath();
        ctx.moveTo(toCanvasX(contactX), toCanvasY(0));
        ctx.lineTo(toCanvasX(RC.x), toCanvasY(RC.y));
        ctx.stroke();
        // Left: from tire contact through IC to RC
        ctx.beginPath();
        ctx.moveTo(toCanvasX(-contactX), toCanvasY(0));
        ctx.lineTo(toCanvasX(RC.x), toCanvasY(RC.y));
        ctx.stroke();
        ctx.setLineDash([]);

        // RC point
        this.drawPoint(ctx, toCanvasX(RC.x), toCanvasY(RC.y), 7, colors.rcPoint, alpha);
        // RC cross marker
        const rcCx = toCanvasX(RC.x), rcCy = toCanvasY(RC.y);
        ctx.strokeStyle = colors.rcPoint;
        ctx.lineWidth = 2;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(rcCx - 5, rcCy - 5); ctx.lineTo(rcCx + 5, rcCy + 5);
        ctx.moveTo(rcCx + 5, rcCy - 5); ctx.lineTo(rcCx - 5, rcCy + 5);
        ctx.stroke();

        // RC label
        ctx.fillStyle = colors.rcPoint;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('RC', rcCx + 10, rcCy + 4);

        // RC height annotation
        if (!isSetB) {
          ctx.font = '11px monospace';
          ctx.fillStyle = colors.rcPoint;
          ctx.fillText(`h=${RC.y.toFixed(1)}mm`, rcCx + 10, rcCy + 18);
        }
      }

      // ── Swing Arm line (IC to tire contact) ──
      ctx.strokeStyle = colors.saLine;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(toCanvasX(contactX), toCanvasY(0));
      ctx.lineTo(toCanvasX(IC.x), toCanvasY(IC.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = alpha;

    // ── Draw arms ── Right side
    // Lower arm
    ctx.strokeStyle = colors.lower;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(P1.x), toCanvasY(P1.y));
    ctx.lineTo(toCanvasX(P3.x), toCanvasY(P3.y));
    ctx.stroke();

    // Upper arm
    ctx.strokeStyle = colors.upper;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(P2.x), toCanvasY(P2.y));
    ctx.lineTo(toCanvasX(P4.x), toCanvasY(P4.y));
    ctx.stroke();

    // Upright (P3 to P4)
    ctx.strokeStyle = colors.upright;
    ctx.lineWidth = lineW + 1;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(P3.x), toCanvasY(P3.y));
    ctx.lineTo(toCanvasX(P4.x), toCanvasY(P4.y));
    ctx.stroke();

    // ── Left side (mirrored) ──
    ctx.strokeStyle = colors.lower;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(mP1.x), toCanvasY(mP1.y));
    ctx.lineTo(toCanvasX(mP3.x), toCanvasY(mP3.y));
    ctx.stroke();

    ctx.strokeStyle = colors.upper;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(mP2.x), toCanvasY(mP2.y));
    ctx.lineTo(toCanvasX(mP4.x), toCanvasY(mP4.y));
    ctx.stroke();

    ctx.strokeStyle = colors.upright;
    ctx.lineWidth = lineW + 1;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(mP3.x), toCanvasY(mP3.y));
    ctx.lineTo(toCanvasX(mP4.x), toCanvasY(mP4.y));
    ctx.stroke();

    // ── Pivot points ── Right side
    // Inner pivots (chassis mount) - squares
    this.drawSquare(ctx, toCanvasX(P1.x), toCanvasY(P1.y), 5, COLORS.pivot, alpha);
    this.drawSquare(ctx, toCanvasX(P2.x), toCanvasY(P2.y), 5, COLORS.pivot, alpha);
    // Ball joints - circles
    this.drawPoint(ctx, toCanvasX(P3.x), toCanvasY(P3.y), 4, COLORS.ballJoint, alpha);
    this.drawPoint(ctx, toCanvasX(P4.x), toCanvasY(P4.y), 4, COLORS.ballJoint, alpha);

    // Left side
    this.drawSquare(ctx, toCanvasX(mP1.x), toCanvasY(mP1.y), 5, COLORS.pivot, alpha);
    this.drawSquare(ctx, toCanvasX(mP2.x), toCanvasY(mP2.y), 5, COLORS.pivot, alpha);
    this.drawPoint(ctx, toCanvasX(mP3.x), toCanvasY(mP3.y), 4, COLORS.ballJoint, alpha);
    this.drawPoint(ctx, toCanvasX(mP4.x), toCanvasY(mP4.y), 4, COLORS.ballJoint, alpha);

    // Labels (right side only, not for setB to avoid clutter)
    if (!isSetB) {
      ctx.globalAlpha = 0.8;
      ctx.font = '10px sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = 'left';
      ctx.fillText('P1', toCanvasX(P1.x) + 6, toCanvasY(P1.y) + 4);
      ctx.fillText('P2', toCanvasX(P2.x) + 6, toCanvasY(P2.y) - 4);
      ctx.fillText('P3', toCanvasX(P3.x) + 6, toCanvasY(P3.y) + 4);
      ctx.fillText('P4', toCanvasX(P4.x) + 6, toCanvasY(P4.y) - 4);

      // Contact patch labels
      ctx.globalAlpha = 1;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = COLORS.ground;
      ctx.textAlign = 'center';
      ctx.fillText('T₁', toCanvasX(-contactX), toCanvasY(0) + 22);
      ctx.fillText('T₂', toCanvasX(contactX), toCanvasY(0) + 22);
    }

    ctx.globalAlpha = 1;
  }

  drawTire(ctx, cx, groundY, scale, isSetB) {
    const tireW = 35 * scale / 2; // tire width in px
    const tireH = 60 * scale / 2; // tire height in px (radius visual)
    const alpha = isSetB ? 0.3 : 0.5;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#444';
    ctx.strokeStyle = isSetB ? '#555' : COLORS.tire;
    ctx.lineWidth = 2;

    // Simplified tire as rounded rect
    const x = cx - tireW / 2;
    const y = groundY - tireH;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + tireW - r, y);
    ctx.quadraticCurveTo(x + tireW, y, x + tireW, y + r);
    ctx.lineTo(x + tireW, groundY - r);
    ctx.quadraticCurveTo(x + tireW, groundY, x + tireW - r, groundY);
    ctx.lineTo(x + r, groundY);
    ctx.quadraticCurveTo(x, groundY, x, groundY - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawChassis(ctx, P1, P2, mP1, mP2, toCanvasX, toCanvasY, isSetB) {
    const alpha = isSetB ? 0.08 : 0.12;
    const strokeAlpha = isSetB ? 0.2 : 0.4;

    // Simple chassis outline connecting inner pivots
    const pad = 15; // extra px inward
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.chassis;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(mP1.x) + pad, toCanvasY(mP1.y));
    ctx.lineTo(toCanvasX(P1.x) - pad, toCanvasY(P1.y));
    ctx.lineTo(toCanvasX(P2.x) - pad, toCanvasY(P2.y));
    ctx.lineTo(toCanvasX(mP2.x) + pad, toCanvasY(mP2.y));
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = COLORS.chassis;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawPoint(ctx, x, y, r, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawSquare(ctx, x, y, size, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }
}
