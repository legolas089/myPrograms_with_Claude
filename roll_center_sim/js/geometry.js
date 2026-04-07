/**
 * Double Wishbone Suspension Geometry (Front View, 2D)
 *
 * Coordinate system:
 *   x: lateral (0 = vehicle centerline, positive = outboard/right)
 *   y: vertical (0 = ground, positive = up)
 *
 * Parameters (one side, mirrored for symmetry):
 *   P1 = lower arm inner pivot (chassis side)
 *   P2 = upper arm inner pivot (chassis side)
 *   P3 = lower arm outer pivot (lower ball joint)
 *   P4 = upper arm outer pivot (upper ball joint)
 *   Ll = lower arm length |P3-P1|
 *   Lu_arm = upper arm length |P4-P2|
 *   Lk = upright/knuckle length |P4-P3|
 *   thetaL = lower arm angle from horizontal (positive = outboard-up)
 *   thetaU = upper arm angle from horizontal (positive = outboard-up)
 */

/**
 * Compute initial geometry from input parameters
 */
export function computeStaticGeometry(params) {
  const { halfTrack, lowerPivotX, lowerPivotY, lowerArmLen, lowerArmAngle,
          upperPivotX, upperPivotY, upperArmLen, upperArmAngle } = params;
  const bodyHeight = params.bodyHeight || 0;

  const thetaL = lowerArmAngle * Math.PI / 180;
  const thetaU = upperArmAngle * Math.PI / 180;

  // Inner pivots (chassis side) — shifted by bodyHeight offset
  const P1 = { x: lowerPivotX, y: lowerPivotY + bodyHeight };
  const P2 = { x: upperPivotX, y: upperPivotY + bodyHeight };

  // Outer pivots (ball joints)
  const P3 = {
    x: P1.x + lowerArmLen * Math.cos(thetaL),
    y: P1.y + lowerArmLen * Math.sin(thetaL)
  };
  const P4 = {
    x: P2.x + upperArmLen * Math.cos(thetaU),
    y: P2.y + upperArmLen * Math.sin(thetaU)
  };

  // Upright (knuckle) length — derived, stays constant during bump
  const knuckleLen = dist(P3, P4);

  return { P1, P2, P3, P4, knuckleLen, halfTrack };
}

/**
 * Solve 4-bar linkage for a given lower arm angle.
 * Given: P1, P2 fixed; lower arm length Ll, upper arm length Lu, knuckle length Lk
 * Input: thetaL (lower arm angle in radians)
 * Output: P3, P4 positions (or null if impossible)
 */
export function solve4Bar(P1, P2, Ll, Lu, Lk, thetaL) {
  // P3 from lower arm
  const P3 = {
    x: P1.x + Ll * Math.cos(thetaL),
    y: P1.y + Ll * Math.sin(thetaL)
  };

  // P4 must be at distance Lk from P3 AND distance Lu from P2
  // Circle-circle intersection
  const solutions = circleCircleIntersect(P3, Lk, P2, Lu);
  if (!solutions) return null;

  // Pick the solution that's more outboard (larger x) and above P3
  // Typically the upper ball joint is above the lower and more inboard
  // We pick the solution that's above P3
  const [s1, s2] = solutions;
  const P4 = (s1.y > s2.y) ? s1 : s2;

  return { P3, P4 };
}

/**
 * Intersection of two circles
 * Circle 1: center c1, radius r1
 * Circle 2: center c2, radius r2
 * Returns [point1, point2] or null
 */
function circleCircleIntersect(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return null;

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  if (hSq < 0) return null;
  const h = Math.sqrt(hSq);

  const mx = c1.x + a * dx / d;
  const my = c1.y + a * dy / d;

  return [
    { x: mx + h * dy / d, y: my - h * dx / d },
    { x: mx - h * dy / d, y: my + h * dx / d }
  ];
}

/**
 * Compute Instant Center: intersection of lines through P1-P3 and P2-P4
 */
export function computeIC(P1, P3, P2, P4) {
  return lineLineIntersect(P1, P3, P2, P4);
}

/**
 * Line-line intersection (2D)
 * Line 1 through a1, a2; Line 2 through b1, b2
 * Returns intersection point or null (parallel)
 */
function lineLineIntersect(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;

  if (Math.abs(cross) < 1e-10) return null; // parallel

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
  return {
    x: a1.x + t * d1x,
    y: a1.y + t * d1y
  };
}

/**
 * Compute Roll Center from left and right side geometry
 * For symmetric suspension: mirror the right side
 */
export function computeRollCenter(IC_right, tireContact_right, halfTrack) {
  // Right side: IC and tire contact as given
  // Left side: mirror across x=0
  const IC_left = { x: -IC_right.x, y: IC_right.y };
  const tireContact_left = { x: -halfTrack, y: 0 };
  const tireContact_rightPt = { x: halfTrack, y: 0 };

  // Line from right tire contact through right IC
  // Line from left tire contact through left IC
  const RC = lineLineIntersect(tireContact_rightPt, IC_right, tireContact_left, IC_left);
  return RC; // should be on centerline (x≈0) for symmetric case
}

/**
 * Compute Swing Arm: from IC to tire contact point
 */
export function computeSwingArm(IC, tireContactX) {
  const tireContact = { x: tireContactX, y: 0 };
  const length = dist(IC, tireContact);
  const angle = Math.atan2(IC.y - 0, IC.x - tireContactX) * 180 / Math.PI;
  // Angle from horizontal at tire contact to IC
  const saAngle = Math.atan2(IC.y, Math.abs(IC.x - tireContactX)) * 180 / Math.PI;
  return { length, angle: saAngle };
}

/**
 * Compute Camber Angle: angle of upright (P3-P4 line) from vertical
 * Positive = top of wheel tilted outboard
 */
export function computeCamber(P3, P4) {
  const dx = P4.x - P3.x;
  const dy = P4.y - P3.y;
  // Upright direction angle from vertical
  // If perfectly vertical, dx=0, angle=0
  // Positive camber: top tilts outboard (dx > 0 means P4 more outboard than P3)
  const camber = Math.atan2(-dx, dy) * 180 / Math.PI;
  return camber;
}

/**
 * Compute KPI (Kingpin Inclination): angle of P3-P4 line from vertical
 * KPI is typically positive (top tilts inboard)
 */
export function computeKPI(P3, P4) {
  const dx = P4.x - P3.x;
  const dy = P4.y - P3.y;
  // KPI = angle from vertical, positive when top tilts inboard (dx < 0 relative to outboard)
  const kpi = Math.atan2(dx, dy) * 180 / Math.PI;
  return kpi;
}

/**
 * Compute Scrub Radius: distance from KPI line ground intersection to tire contact center
 */
export function computeScrubRadius(P3, P4, halfTrack) {
  // KPI line: through P3 and P4, find where y=0
  if (Math.abs(P4.y - P3.y) < 1e-10) return halfTrack; // horizontal upright edge case
  const t = -P3.y / (P4.y - P3.y);
  const xGround = P3.x + t * (P4.x - P3.x);
  return halfTrack - xGround; // positive = KPI line hits ground inboard of tire center
}

/**
 * Compute tire contact X position (scrub/track change)
 * For simplicity: tire contact is directly below wheel center
 * Wheel center is midpoint of P3-P4 (approximation) offset outboard
 * More accurate: contact is where KPI line meets ground, but for double wishbone
 * the contact patch is at the tire, which maintains its position at halfTrack in static
 * During bump, the actual contact X shifts with wheel center lateral movement
 */
export function computeContactX(P3, P4, staticHalfTrack) {
  // Wheel center approximation: midpoint of ball joints
  const wheelCenterX = (P3.x + P4.x) / 2;
  return wheelCenterX;
}

/**
 * Run full bump sweep: compute all kinematic results for a range of bump travel
 */
export function runBumpSweep(params, bumpRange, nPoints = 200) {
  const staticGeo = computeStaticGeometry(params);
  const { P1, P2, P3: P3_static, P4: P4_static, knuckleLen, halfTrack } = staticGeo;

  const Ll = params.lowerArmLen;
  const Lu = params.upperArmLen;
  const Lk = knuckleLen;

  // Static lower arm angle
  const thetaL_static = Math.atan2(P3_static.y - P1.y, P3_static.x - P1.x);

  // Static contact X (reference for scrub calculation)
  const staticContactX = computeContactX(P3_static, P4_static, halfTrack);
  const staticCamber = computeCamber(P3_static, P4_static);

  // Sweep: vary lower ball joint Y by bumpRange
  // Convert bump (vertical wheel travel) to lower arm angle change
  // We sweep thetaL to achieve desired P3.y range
  const results = {
    bump: [], rcHeight: [], rcLateral: [],
    saLength: [], saAngle: [],
    camber: [], camberGain: [],
    scrub: [], kpi: [], scrubRadius: [],
    icX: [], icY: [],
    // Per-point geometry for animation
    frames: []
  };

  // Find angle range: we want P3.y to span from P3_static.y - bumpRange to P3_static.y + bumpRange
  // P3.y = P1.y + Ll * sin(thetaL)
  // sin(thetaL) = (P3.y - P1.y) / Ll
  const targetYmin = P3_static.y - bumpRange;
  const targetYmax = P3_static.y + bumpRange;

  const sinMin = (targetYmin - P1.y) / Ll;
  const sinMax = (targetYmax - P1.y) / Ll;

  // Clamp to valid range
  const thetaMin = Math.abs(sinMin) <= 1 ? Math.asin(sinMin) : (sinMin < 0 ? -Math.PI / 2 : Math.PI / 2);
  const thetaMax = Math.abs(sinMax) <= 1 ? Math.asin(sinMax) : (sinMax < 0 ? -Math.PI / 2 : Math.PI / 2);

  for (let i = 0; i < nPoints; i++) {
    const frac = i / (nPoints - 1);
    const thetaL = thetaMin + frac * (thetaMax - thetaMin);

    const sol = solve4Bar(P1, P2, Ll, Lu, Lk, thetaL);
    if (!sol) continue;

    const { P3, P4 } = sol;
    const bumpVal = P3.y - P3_static.y; // bump travel (positive = up)

    // IC
    const IC = computeIC(P1, P3, P2, P4);
    if (!IC) continue;

    // Contact X (for scrub)
    const contactX = computeContactX(P3, P4, halfTrack);

    // Roll Center
    const RC = computeRollCenter(IC, contactX, contactX);
    if (!RC) continue;

    // Swing Arm
    const sa = computeSwingArm(IC, contactX);

    // Camber
    const camber = computeCamber(P3, P4);
    const camberChange = camber - staticCamber;

    // KPI & Scrub Radius
    const kpi = computeKPI(P3, P4);
    const scrubR = computeScrubRadius(P3, P4, contactX);

    // Scrub (track change from static)
    const scrub = contactX - staticContactX;

    results.bump.push(bumpVal);
    results.rcHeight.push(RC.y);
    results.rcLateral.push(RC.x);
    results.saLength.push(sa.length);
    results.saAngle.push(sa.angle);
    results.camber.push(camber);
    results.camberGain.push(camberChange);
    results.scrub.push(scrub);
    results.kpi.push(kpi);
    results.scrubRadius.push(scrubR);
    results.icX.push(IC.x);
    results.icY.push(IC.y);
    results.frames.push({ P1, P2, P3, P4, IC, RC, contactX });
  }

  return results;
}

/**
 * Compute single-point kinematic result at a specific bump position
 */
export function computeAtBump(params, bumpVal) {
  const staticGeo = computeStaticGeometry(params);
  const { P1, P2, P3: P3s, P4: P4s, knuckleLen } = staticGeo;

  const Ll = params.lowerArmLen;
  const Lu = params.upperArmLen;
  const Lk = knuckleLen;

  const targetY = P3s.y + bumpVal;
  const sinVal = (targetY - P1.y) / Ll;
  if (Math.abs(sinVal) > 1) return null;
  const thetaL = Math.asin(sinVal);

  const sol = solve4Bar(P1, P2, Ll, Lu, Lk, thetaL);
  if (!sol) return null;

  const { P3, P4 } = sol;
  const IC = computeIC(P1, P3, P2, P4);
  if (!IC) return null;

  const contactX = computeContactX(P3, P4, staticGeo.halfTrack);
  const RC = computeRollCenter(IC, contactX, contactX);
  const sa = computeSwingArm(IC, contactX);
  const camber = computeCamber(P3, P4);
  const staticCamber = computeCamber(P3s, P4s);
  const kpi = computeKPI(P3, P4);
  const scrubR = computeScrubRadius(P3, P4, contactX);
  const staticContactX = computeContactX(P3s, P4s, staticGeo.halfTrack);
  const scrub = contactX - staticContactX;

  return {
    P1, P2, P3, P4, IC, RC, contactX,
    saLength: sa.length, saAngle: sa.angle,
    camber, camberGain: camber - staticCamber,
    kpi, scrubRadius: scrubR, scrub,
    rcHeight: RC ? RC.y : 0, rcLateral: RC ? RC.x : 0
  };
}

/**
 * Vehicle dynamics calculations (Phase 2 - optional)
 */
export function computeLoadTransfer(rcHeight, cgHeight, trackWidth, mass, lateralG) {
  const totalLateralForce = mass * 9.81 * lateralG;
  const geoTransfer = totalLateralForce * rcHeight / trackWidth;
  const elasticTransfer = totalLateralForce * (cgHeight - rcHeight) / trackWidth;
  const totalTransfer = geoTransfer + elasticTransfer;
  const geoRatio = rcHeight / cgHeight;

  return { geoTransfer, elasticTransfer, totalTransfer, geoRatio };
}

export function computeJackingForce(saAngle, lateralForce) {
  return lateralForce * Math.tan(saAngle * Math.PI / 180);
}

/* Utility */
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
