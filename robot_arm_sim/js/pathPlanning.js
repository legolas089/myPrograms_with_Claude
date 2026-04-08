// pathPlanning.js — 6 path generation strategies + cost metric

import { inverseKinematics, forwardKinematics, isReachable, shortestAngleDiff } from './kinematics.js';

const PATH_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
  '#fd79a8', '#6c5ce7', '#00b894', '#e17055', '#0984e3',
  '#fdcb6e', '#e056fd', '#686de0', '#a29bfe', '#55efc4',
  '#fab1a0', '#74b9ff', '#ffa502', '#2ed573', '#ff4757'
];

const NUM_WAYPOINTS = 80;

// ── Strategy 1: Joint-Space Linear Interpolation (MoveJ / PTP) ──
function jointLinear(ikA, ikB, _posA, _posB, _L1, _L2, configLabel) {
  const waypoints = [];
  const d1 = shortestAngleDiff(ikA.theta1, ikB.theta1);
  const d2 = shortestAngleDiff(ikA.theta2, ikB.theta2);
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    waypoints.push({
      theta1: ikA.theta1 + d1 * t,
      theta2: ikA.theta2 + d2 * t,
      t
    });
  }
  return { name: `Joint Linear (${configLabel})`, strategy: 'jointLinear', waypoints };
}

// ── Strategy 2: Cartesian Linear Interpolation (MoveL / LIN) ──
function cartesianLinear(ikA, _ikB, posA, posB, L1, L2, configLabel, elbowMode) {
  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    const x = posA.x + (posB.x - posA.x) * t;
    const y = posA.y + (posB.y - posA.y) * t;
    const ik = inverseKinematics(x, y, L1, L2);
    if (!ik) return null;
    const sol = elbowMode === 'up' ? ik.elbowUp : ik.elbowDown;
    waypoints.push({ theta1: sol.theta1, theta2: sol.theta2, t });
  }
  return { name: `Cartesian Linear (${configLabel})`, strategy: 'cartesianLinear', waypoints };
}

// ── Strategy 3: Via-Point Paths (Catmull-Rom Spline) ──
function viaPoint(ikA, _ikB, posA, posB, L1, L2, elbowMode, viaIdx) {
  const midX = (posA.x + posB.x) / 2;
  const midY = (posA.y + posB.y) / 2;
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const perpX = -dy;
  const perpY = dx;
  const pLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;

  // Generate offset via-point
  const offset = (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? 1 : -1);
  const reach = L1 + L2;
  let vx = midX + perpX / pLen * reach * offset * 0.4;
  let vy = midY + perpY / pLen * reach * offset * 0.4;

  // Clamp to workspace
  const vd = Math.sqrt(vx * vx + vy * vy);
  if (vd > reach * 0.95) {
    vx = vx / vd * reach * 0.95;
    vy = vy / vd * reach * 0.95;
  }
  const rInner = Math.abs(L1 - L2);
  if (vd < rInner + 5) {
    vx = vx / (vd || 1) * (rInner + 10);
    vy = vy / (vd || 1) * (rInner + 10);
  }

  if (!isReachable(vx, vy, L1, L2)) return null;

  // Three control points in Cartesian: A → via → B
  const pts = [
    { x: posA.x, y: posA.y },
    { x: vx, y: vy },
    { x: posB.x, y: posB.y }
  ];

  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    // Quadratic Bezier interpolation
    const u = 1 - t;
    const x = u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x;
    const y = u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y;
    const ik = inverseKinematics(x, y, L1, L2);
    if (!ik) return null;
    const sol = elbowMode === 'up' ? ik.elbowUp : ik.elbowDown;
    waypoints.push({ theta1: sol.theta1, theta2: sol.theta2, t });
  }
  return { name: `Via-Point #${viaIdx}`, strategy: 'viaPoint', waypoints };
}

// ── Strategy 4: Elbow Configuration Switching ──
function elbowSwitch(ikAUp, ikADown, ikBUp, ikBDown, posA, posB, L1, L2) {
  // Start elbow-up, end elbow-down
  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    const x = posA.x + (posB.x - posA.x) * t;
    const y = posA.y + (posB.y - posA.y) * t;
    const ik = inverseKinematics(x, y, L1, L2);
    if (!ik) return null;

    // Sigmoid blend between elbow-up and elbow-down
    const blend = 1 / (1 + Math.exp(-8 * (t - 0.5)));
    const theta1 = ik.elbowUp.theta1 * (1 - blend) + ik.elbowDown.theta1 * blend;
    const theta2 = ik.elbowUp.theta2 * (1 - blend) + ik.elbowDown.theta2 * blend;
    waypoints.push({ theta1, theta2, t });
  }
  return { name: 'Elbow Switch (Up→Down)', strategy: 'elbowSwitch', waypoints };
}

function elbowSwitchReverse(ikAUp, ikADown, ikBUp, ikBDown, posA, posB, L1, L2) {
  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    const x = posA.x + (posB.x - posA.x) * t;
    const y = posA.y + (posB.y - posA.y) * t;
    const ik = inverseKinematics(x, y, L1, L2);
    if (!ik) return null;

    const blend = 1 / (1 + Math.exp(-8 * (t - 0.5)));
    const theta1 = ik.elbowDown.theta1 * (1 - blend) + ik.elbowUp.theta1 * blend;
    const theta2 = ik.elbowDown.theta2 * (1 - blend) + ik.elbowUp.theta2 * blend;
    waypoints.push({ theta1, theta2, t });
  }
  return { name: 'Elbow Switch (Down→Up)', strategy: 'elbowSwitch', waypoints };
}

// ── Strategy 5: Cubic Polynomial with Varied Boundary Velocities ──
function cubicPolynomial(ikA, ikB, label, v0Scale, v1Scale) {
  const d1 = shortestAngleDiff(ikA.theta1, ikB.theta1);
  const d2 = shortestAngleDiff(ikA.theta2, ikB.theta2);

  // q(t) = a0 + a1*t + a2*t^2 + a3*t^3
  // q(0) = qA, q(1) = qB, q'(0) = v0, q'(1) = v1
  function cubicCoeffs(q0, q1, v0, v1) {
    const a0 = q0;
    const a1 = v0;
    const a2 = 3 * (q1 - q0) - 2 * v0 - v1;
    const a3 = 2 * (q0 - q1) + v0 + v1;
    return [a0, a1, a2, a3];
  }

  const v0_1 = d1 * v0Scale;
  const v1_1 = d1 * v1Scale;
  const v0_2 = d2 * v0Scale;
  const v1_2 = d2 * v1Scale;

  const c1 = cubicCoeffs(ikA.theta1, ikA.theta1 + d1, v0_1, v1_1);
  const c2 = cubicCoeffs(ikA.theta2, ikA.theta2 + d2, v0_2, v1_2);

  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    const theta1 = c1[0] + c1[1] * t + c1[2] * t * t + c1[3] * t * t * t;
    const theta2 = c2[0] + c2[1] * t + c2[2] * t * t + c2[3] * t * t * t;
    waypoints.push({ theta1, theta2, t });
  }
  return { name: `Cubic Poly (${label})`, strategy: 'cubicPoly', waypoints };
}

// ── Strategy 6: Circular Arc in Joint Space ──
function circularArc(ikA, ikB, offsetFactor) {
  const d1 = shortestAngleDiff(ikA.theta1, ikB.theta1);
  const d2 = shortestAngleDiff(ikA.theta2, ikB.theta2);
  const midTheta1 = ikA.theta1 + d1 * 0.5;
  const midTheta2 = ikA.theta2 + d2 * 0.5;

  // Perpendicular offset in joint space
  const perpTheta1 = -d2;
  const perpTheta2 = d1;
  const pLen = Math.sqrt(perpTheta1 * perpTheta1 + perpTheta2 * perpTheta2) || 1;

  const arcMidTheta1 = midTheta1 + (perpTheta1 / pLen) * offsetFactor;
  const arcMidTheta2 = midTheta2 + (perpTheta2 / pLen) * offsetFactor;

  // Quadratic Bezier in joint space through 3 points
  const waypoints = [];
  for (let i = 0; i < NUM_WAYPOINTS; i++) {
    const t = i / (NUM_WAYPOINTS - 1);
    const u = 1 - t;
    const theta1 = u * u * ikA.theta1 + 2 * u * t * arcMidTheta1 + t * t * (ikA.theta1 + d1);
    const theta2 = u * u * ikA.theta2 + 2 * u * t * arcMidTheta2 + t * t * (ikA.theta2 + d2);
    waypoints.push({ theta1, theta2, t });
  }

  const label = offsetFactor > 0 ? '+' : '-';
  return { name: `Arc ${label}${Math.abs(offsetFactor).toFixed(1)}`, strategy: 'circularArc', waypoints };
}

// ── Cost Metric ──
export function computePathCost(path, L1, L2) {
  let jointTravel = 0;
  let cartesianLen = 0;
  let maxJointVel = 0;
  let smoothness = 0;

  const wps = path.waypoints;
  const fks = wps.map(wp => forwardKinematics(wp.theta1, wp.theta2, L1, L2));

  for (let i = 1; i < wps.length; i++) {
    const dth1 = wps[i].theta1 - wps[i - 1].theta1;
    const dth2 = wps[i].theta2 - wps[i - 1].theta2;
    const jd = Math.sqrt(dth1 * dth1 + dth2 * dth2);
    jointTravel += jd;
    maxJointVel = Math.max(maxJointVel, jd);

    const dx = fks[i].endEffector.x - fks[i - 1].endEffector.x;
    const dy = fks[i].endEffector.y - fks[i - 1].endEffector.y;
    cartesianLen += Math.sqrt(dx * dx + dy * dy);
  }

  for (let i = 2; i < wps.length; i++) {
    const dd1 = (wps[i].theta1 - 2 * wps[i - 1].theta1 + wps[i - 2].theta1);
    const dd2 = (wps[i].theta2 - 2 * wps[i - 1].theta2 + wps[i - 2].theta2);
    smoothness += Math.sqrt(dd1 * dd1 + dd2 * dd2);
  }

  const cost = jointTravel * 1.0 + cartesianLen * 0.005 + maxJointVel * 5.0 + smoothness * 3.0;
  return { jointTravel, cartesianLen, maxJointVel, smoothness, cost };
}

// ── Joint Limit Check ──
function checkJointLimits(path, limits) {
  if (!limits) return false;
  for (const wp of path.waypoints) {
    if (wp.theta1 < limits.t1min || wp.theta1 > limits.t1max ||
        wp.theta2 < limits.t2min || wp.theta2 > limits.t2max) {
      return true; // violation
    }
  }
  return false;
}

// ── Main Path Generation ──
export function generateAllPaths(posA, posB, L1, L2, numPaths, enabledStrategies, jointLimits = null) {
  const ikA = inverseKinematics(posA.x, posA.y, L1, L2);
  const ikB = inverseKinematics(posB.x, posB.y, L1, L2);
  if (!ikA || !ikB) return [];

  const paths = [];
  let colorIdx = 0;

  function addPath(result) {
    if (!result) return;
    result.color = PATH_COLORS[colorIdx % PATH_COLORS.length];
    result.id = colorIdx;
    const metrics = computePathCost(result, L1, L2);
    Object.assign(result, metrics);
    paths.push(result);
    colorIdx++;
  }

  // Strategy 1: Joint-Space Linear
  if (enabledStrategies.jointLinear) {
    addPath(jointLinear(ikA.elbowUp, ikB.elbowUp, posA, posB, L1, L2, 'Up'));
    addPath(jointLinear(ikA.elbowDown, ikB.elbowDown, posA, posB, L1, L2, 'Down'));
  }

  // Strategy 2: Cartesian Linear
  if (enabledStrategies.cartesianLinear) {
    addPath(cartesianLinear(ikA.elbowUp, ikB.elbowUp, posA, posB, L1, L2, 'Up', 'up'));
    addPath(cartesianLinear(ikA.elbowDown, ikB.elbowDown, posA, posB, L1, L2, 'Down', 'down'));
  }

  // Strategy 3: Via-Point
  if (enabledStrategies.viaPoint) {
    const nVia = Math.max(1, Math.floor((numPaths - 6) * 0.4));
    for (let v = 0; v < nVia; v++) {
      const mode = v % 2 === 0 ? 'up' : 'down';
      addPath(viaPoint(ikA, ikB, posA, posB, L1, L2, mode, v + 1));
    }
  }

  // Strategy 4: Elbow Switch
  if (enabledStrategies.elbowSwitch) {
    addPath(elbowSwitch(ikA.elbowUp, ikA.elbowDown, ikB.elbowUp, ikB.elbowDown, posA, posB, L1, L2));
    addPath(elbowSwitchReverse(ikA.elbowUp, ikA.elbowDown, ikB.elbowUp, ikB.elbowDown, posA, posB, L1, L2));
  }

  // Strategy 5: Cubic Polynomial
  if (enabledStrategies.cubicPoly) {
    addPath(cubicPolynomial(ikA.elbowUp, ikB.elbowUp, 'Smooth', 0, 0));
    addPath(cubicPolynomial(ikA.elbowUp, ikB.elbowUp, 'Fast Start', 2.5, 0));
    if (paths.length < numPaths) {
      addPath(cubicPolynomial(ikA.elbowDown, ikB.elbowDown, 'Overshoot', 3.0, -1.5));
    }
  }

  // Strategy 6: Circular Arc
  if (enabledStrategies.circularArc) {
    addPath(circularArc(ikA.elbowUp, ikB.elbowUp, 0.5));
    addPath(circularArc(ikA.elbowUp, ikB.elbowUp, -0.5));
    if (paths.length < numPaths) {
      addPath(circularArc(ikA.elbowDown, ikB.elbowDown, 0.8));
    }
  }

  // Check joint limit violations
  paths.forEach(p => {
    p.limitViolation = checkJointLimits(p, jointLimits);
  });

  // Sort: valid paths first (by cost), then violated paths (by cost)
  paths.sort((a, b) => {
    if (a.limitViolation !== b.limitViolation) return a.limitViolation ? 1 : -1;
    return a.cost - b.cost;
  });

  // Assign rank
  paths.forEach((p, i) => { p.rank = i + 1; });

  // Trim to requested count
  return paths.slice(0, numPaths);
}
