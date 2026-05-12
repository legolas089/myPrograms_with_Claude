// pathPlanning.js — 6 path generation strategies + cost metric for 3-DOF robot
// Waypoint shape: { t1, t2, t3, t } with t in [0, 1].

import {
  inverseKinematics3D, forwardKinematics3D, isReachable3D, shortestAngleDiff
} from './kinematics.js';

const PATH_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
  '#fd79a8', '#6c5ce7', '#00b894', '#e17055', '#0984e3',
  '#fdcb6e', '#e056fd', '#686de0', '#a29bfe', '#55efc4',
  '#fab1a0', '#74b9ff', '#ffa502', '#2ed573', '#ff4757'
];

// ── Timing policy ──
// Each waypoint represents DT_SECONDS of real motion. The slowest joint moves at
// at most MAX_JOINT_SPEED_RAD; total path time scales with the largest |Δθ|.
// Path shape is unchanged per strategy — only the waypoint count and the
// associated real-time duration vary.
export const DT_SECONDS = 0.01;                        // 10 ms time step
export const MAX_JOINT_SPEED_DEG = 20;                 // deg / s
export const MAX_JOINT_SPEED_RAD = MAX_JOINT_SPEED_DEG * Math.PI / 180;
const MIN_WAYPOINTS = 2;
const MAX_WAYPOINTS = 5000;                            // safety cap (~50 s)

// Compute (N waypoints, totalTime in seconds) so that the slowest joint runs at
// MAX_JOINT_SPEED_RAD. The path is sampled at DT_SECONDS intervals.
function computeTiming(qA, qB) {
  const d1 = Math.abs(shortestAngleDiff(qA.t1, qB.t1));
  const d2 = Math.abs(shortestAngleDiff(qA.t2, qB.t2));
  const d3 = Math.abs(shortestAngleDiff(qA.t3, qB.t3));
  const dmax = Math.max(d1, d2, d3);
  // Floor to one dt so trivial (zero-displacement) paths still produce 2 waypoints.
  const totalTime = Math.max(DT_SECONDS, dmax / MAX_JOINT_SPEED_RAD);
  const N = Math.max(MIN_WAYPOINTS, Math.min(MAX_WAYPOINTS, Math.round(totalTime / DT_SECONDS) + 1));
  return { N, totalTime };
}

// ── Strategy 1: Joint-Space Linear Interpolation (MoveJ / PTP) ──
function jointLinear(qA, qB, configLabel) {
  const d1 = shortestAngleDiff(qA.t1, qB.t1);
  const d2 = shortestAngleDiff(qA.t2, qB.t2);
  const d3 = shortestAngleDiff(qA.t3, qB.t3);
  const { N, totalTime } = computeTiming(qA, qB);
  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    waypoints.push({
      t1: qA.t1 + d1 * t,
      t2: qA.t2 + d2 * t,
      t3: qA.t3 + d3 * t,
      t
    });
  }
  return { name: `Joint Linear (${configLabel})`, strategy: 'jointLinear', waypoints, totalTime };
}

// ── Strategy 2: Cartesian Linear Interpolation (MoveL / LIN) ──
function cartesianLinear(posA, posB, h0, L1, L2, configLabel, elbowMode, ikA, ikB) {
  const qA = elbowMode === 'up' ? ikA.elbowUp : ikA.elbowDown;
  const qB = elbowMode === 'up' ? ikB.elbowUp : ikB.elbowDown;
  const { N, totalTime } = computeTiming(qA, qB);
  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = posA.x + (posB.x - posA.x) * t;
    const y = posA.y + (posB.y - posA.y) * t;
    const z = posA.z + (posB.z - posA.z) * t;
    const ik = inverseKinematics3D(x, y, z, h0, L1, L2);
    if (!ik) return null;
    const sol = elbowMode === 'up' ? ik.elbowUp : ik.elbowDown;
    waypoints.push({ t1: sol.t1, t2: sol.t2, t3: sol.t3, t });
  }
  return { name: `Cartesian Linear (${configLabel})`, strategy: 'cartesianLinear', waypoints, totalTime };
}

// ── Strategy 3: Via-Point (3D quadratic Bezier through random offset point) ──
function viaPoint(posA, posB, h0, L1, L2, elbowMode, viaIdx, ikA, ikB) {
  const reach = L1 + L2;
  const rInner = Math.abs(L1 - L2);
  const mid = {
    x: (posA.x + posB.x) / 2,
    y: (posA.y + posB.y) / 2,
    z: (posA.z + posB.z) / 2
  };
  const dx = posB.x - posA.x, dy = posB.y - posA.y, dz = posB.z - posA.z;

  // Build a 3D unit vector orthogonal to (dx, dy, dz)
  let ax, ay, az;
  if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
    // Use cross product with world Z = (0, 0, 1)
    ax = -dy; ay = dx; az = 0;
  } else {
    // Path is vertical → use world X
    ax = 0; ay = 1; az = 0;
  }
  const aLen = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  ax /= aLen; ay /= aLen; az /= aLen;

  // Random magnitude / sign / direction blend with vertical
  const sign = Math.random() < 0.5 ? 1 : -1;
  const mag = (0.25 + Math.random() * 0.45) * reach * sign;
  // Mix in a vertical component
  const verticalFrac = (Math.random() - 0.5) * 0.6;

  let vx = mid.x + ax * mag;
  let vy = mid.y + ay * mag;
  let vz = mid.z + verticalFrac * mag + az * mag;

  // Clamp via-point to torus workspace (best-effort)
  const vr = Math.sqrt(vx * vx + vy * vy);
  if (vr > reach * 0.9) {
    const k = (reach * 0.9) / vr;
    vx *= k; vy *= k;
  }
  if (vr < rInner + 0.01 && (vr > 1e-6)) {
    const k = (rInner + 0.05) / vr;
    vx *= k; vy *= k;
  }
  vz = Math.max(h0 - reach * 0.9, Math.min(h0 + reach * 0.9, vz));

  if (!isReachable3D(vx, vy, vz, h0, L1, L2)) return null;

  const pts = [
    { x: posA.x, y: posA.y, z: posA.z },
    { x: vx,     y: vy,     z: vz     },
    { x: posB.x, y: posB.y, z: posB.z }
  ];

  const qA = elbowMode === 'up' ? ikA.elbowUp : ikA.elbowDown;
  const qB = elbowMode === 'up' ? ikB.elbowUp : ikB.elbowDown;
  const { N, totalTime } = computeTiming(qA, qB);

  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const u = 1 - t;
    const x = u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x;
    const y = u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y;
    const z = u * u * pts[0].z + 2 * u * t * pts[1].z + t * t * pts[2].z;
    const ik = inverseKinematics3D(x, y, z, h0, L1, L2);
    if (!ik) return null;
    const sol = elbowMode === 'up' ? ik.elbowUp : ik.elbowDown;
    waypoints.push({ t1: sol.t1, t2: sol.t2, t3: sol.t3, t });
  }
  return { name: `Via-Point #${viaIdx}`, strategy: 'viaPoint', waypoints, totalTime };
}

// ── Strategy 4: Elbow Configuration Switching ──
// Cartesian-linear position with sigmoid blend between elbow-up and elbow-down IK solutions.
function elbowSwitch(posA, posB, h0, L1, L2, reverse, ikA, ikB) {
  // Endpoints cross the elbow configuration, so timing is computed against
  // the actual start/end joint configs (e.g. ikA.elbowUp → ikB.elbowDown).
  const qStart = reverse ? ikA.elbowDown : ikA.elbowUp;
  const qEnd   = reverse ? ikB.elbowUp   : ikB.elbowDown;
  const { N, totalTime } = computeTiming(qStart, qEnd);

  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = posA.x + (posB.x - posA.x) * t;
    const y = posA.y + (posB.y - posA.y) * t;
    const z = posA.z + (posB.z - posA.z) * t;
    const ik = inverseKinematics3D(x, y, z, h0, L1, L2);
    if (!ik) return null;

    const blend = 1 / (1 + Math.exp(-8 * (t - 0.5)));
    const a = reverse ? ik.elbowDown : ik.elbowUp;
    const b = reverse ? ik.elbowUp   : ik.elbowDown;

    const t1 = a.t1 * (1 - blend) + b.t1 * blend;
    const t2 = a.t2 * (1 - blend) + b.t2 * blend;
    const t3 = a.t3 * (1 - blend) + b.t3 * blend;
    waypoints.push({ t1, t2, t3, t });
  }
  const name = reverse ? 'Elbow Switch (Down→Up)' : 'Elbow Switch (Up→Down)';
  return { name, strategy: 'elbowSwitch', waypoints, totalTime };
}

// ── Strategy 5: Cubic Polynomial with varied boundary velocities ──
function cubicCoeffs(q0, q1, v0, v1) {
  return [
    q0,
    v0,
    3 * (q1 - q0) - 2 * v0 - v1,
    2 * (q0 - q1) + v0 + v1
  ];
}

function cubicPolynomial(qA, qB, label, v0Scale, v1Scale) {
  const d1 = shortestAngleDiff(qA.t1, qB.t1);
  const d2 = shortestAngleDiff(qA.t2, qB.t2);
  const d3 = shortestAngleDiff(qA.t3, qB.t3);

  const c1 = cubicCoeffs(qA.t1, qA.t1 + d1, d1 * v0Scale, d1 * v1Scale);
  const c2 = cubicCoeffs(qA.t2, qA.t2 + d2, d2 * v0Scale, d2 * v1Scale);
  const c3 = cubicCoeffs(qA.t3, qA.t3 + d3, d3 * v0Scale, d3 * v1Scale);

  const { N, totalTime } = computeTiming(qA, qB);
  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const tt = t * t, ttt = tt * t;
    waypoints.push({
      t1: c1[0] + c1[1] * t + c1[2] * tt + c1[3] * ttt,
      t2: c2[0] + c2[1] * t + c2[2] * tt + c2[3] * ttt,
      t3: c3[0] + c3[1] * t + c3[2] * tt + c3[3] * ttt,
      t
    });
  }
  return { name: `Cubic Poly (${label})`, strategy: 'cubicPoly', waypoints, totalTime };
}

// ── Strategy 6: Circular Arc in joint-space ──
// Quadratic Bezier with a perpendicular offset in q-space. The offset direction
// is one of two basis vectors orthogonal to the q_AB direction (in 3D q-space).
function circularArc(qA, qB, offsetFactor, axisIdx) {
  const d1 = shortestAngleDiff(qA.t1, qB.t1);
  const d2 = shortestAngleDiff(qA.t2, qB.t2);
  const d3 = shortestAngleDiff(qA.t3, qB.t3);
  const dlen = Math.sqrt(d1 * d1 + d2 * d2 + d3 * d3) || 1;
  const u = [d1 / dlen, d2 / dlen, d3 / dlen];

  // Build an orthonormal basis (u, v, w) in joint space
  // Pick a helper not parallel to u
  let helper = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  // v = normalize(helper - (helper·u) u)
  const dot = helper[0]*u[0] + helper[1]*u[1] + helper[2]*u[2];
  let vx = helper[0] - dot * u[0];
  let vy = helper[1] - dot * u[1];
  let vz = helper[2] - dot * u[2];
  let vLen = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
  vx /= vLen; vy /= vLen; vz /= vLen;
  // w = u × v
  const wx = u[1]*vz - u[2]*vy;
  const wy = u[2]*vx - u[0]*vz;
  const wz = u[0]*vy - u[1]*vx;

  const axis = axisIdx === 0 ? [vx, vy, vz] : [wx, wy, wz];

  const mid1 = qA.t1 + d1 * 0.5 + axis[0] * offsetFactor;
  const mid2 = qA.t2 + d2 * 0.5 + axis[1] * offsetFactor;
  const mid3 = qA.t3 + d3 * 0.5 + axis[2] * offsetFactor;

  const { N, totalTime } = computeTiming(qA, qB);
  const waypoints = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const ut = 1 - t;
    waypoints.push({
      t1: ut*ut * qA.t1 + 2*ut*t * mid1 + t*t * (qA.t1 + d1),
      t2: ut*ut * qA.t2 + 2*ut*t * mid2 + t*t * (qA.t2 + d2),
      t3: ut*ut * qA.t3 + 2*ut*t * mid3 + t*t * (qA.t3 + d3),
      t
    });
  }
  const sign = offsetFactor > 0 ? '+' : '-';
  const ax = axisIdx === 0 ? 'v' : 'w';
  return {
    name: `Arc ${ax}${sign}${Math.abs(offsetFactor).toFixed(1)}`,
    strategy: 'circularArc',
    waypoints,
    totalTime
  };
}

// ── Cost Metric (3-DOF) ──
export function computePathCost(path, h0, L1, L2) {
  let jointTravel = 0;
  let cartesianLen = 0;
  let maxJointVel = 0;
  let smoothness = 0;

  const wps = path.waypoints;
  const fks = wps.map(wp => forwardKinematics3D(wp.t1, wp.t2, wp.t3, h0, L1, L2));

  for (let i = 1; i < wps.length; i++) {
    const dq1 = wps[i].t1 - wps[i - 1].t1;
    const dq2 = wps[i].t2 - wps[i - 1].t2;
    const dq3 = wps[i].t3 - wps[i - 1].t3;
    const jd = Math.sqrt(dq1 * dq1 + dq2 * dq2 + dq3 * dq3);
    jointTravel += jd;
    if (jd > maxJointVel) maxJointVel = jd;

    const dx = fks[i].P.x - fks[i - 1].P.x;
    const dy = fks[i].P.y - fks[i - 1].P.y;
    const dz = fks[i].P.z - fks[i - 1].P.z;
    cartesianLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  for (let i = 2; i < wps.length; i++) {
    const dd1 = wps[i].t1 - 2 * wps[i - 1].t1 + wps[i - 2].t1;
    const dd2 = wps[i].t2 - 2 * wps[i - 1].t2 + wps[i - 2].t2;
    const dd3 = wps[i].t3 - 2 * wps[i - 1].t3 + wps[i - 2].t3;
    smoothness += Math.sqrt(dd1 * dd1 + dd2 * dd2 + dd3 * dd3);
  }

  // Cartesian length is in meters here, so use a much larger weight than the 2D px version
  // to keep it on a comparable scale to joint-travel (radians).
  const cost = jointTravel * 1.0 + cartesianLen * 1.0 + maxJointVel * 5.0 + smoothness * 3.0;
  return { jointTravel, cartesianLen, maxJointVel, smoothness, cost };
}

// ── Joint Limit Check (3-DOF, all in radians) ──
function checkJointLimits3D(path, limits) {
  if (!limits) return false;
  for (const wp of path.waypoints) {
    if (wp.t1 < limits.t1min || wp.t1 > limits.t1max) return true;
    if (wp.t2 < limits.t2min || wp.t2 > limits.t2max) return true;
    if (wp.t3 < limits.t3min || wp.t3 > limits.t3max) return true;
  }
  return false;
}

// ── Main path generation ──
export function generateAllPaths(posA, posB, h0, L1, L2, numPaths, enabledStrategies, jointLimits = null) {
  const ikA = inverseKinematics3D(posA.x, posA.y, posA.z, h0, L1, L2);
  const ikB = inverseKinematics3D(posB.x, posB.y, posB.z, h0, L1, L2);
  if (!ikA || !ikB) return [];

  const paths = [];
  let colorIdx = 0;

  function addPath(result) {
    if (!result) return;
    result.color = PATH_COLORS[colorIdx % PATH_COLORS.length];
    result.id = colorIdx;
    const metrics = computePathCost(result, h0, L1, L2);
    Object.assign(result, metrics);
    paths.push(result);
    colorIdx++;
  }

  if (enabledStrategies.jointLinear) {
    addPath(jointLinear(ikA.elbowUp, ikB.elbowUp, 'Up'));
    addPath(jointLinear(ikA.elbowDown, ikB.elbowDown, 'Down'));
  }

  if (enabledStrategies.cartesianLinear) {
    addPath(cartesianLinear(posA, posB, h0, L1, L2, 'Up', 'up', ikA, ikB));
    addPath(cartesianLinear(posA, posB, h0, L1, L2, 'Down', 'down', ikA, ikB));
  }

  if (enabledStrategies.viaPoint) {
    const nVia = Math.max(1, Math.floor((numPaths - 6) * 0.4));
    for (let v = 0; v < nVia; v++) {
      const mode = v % 2 === 0 ? 'up' : 'down';
      addPath(viaPoint(posA, posB, h0, L1, L2, mode, v + 1, ikA, ikB));
    }
  }

  if (enabledStrategies.elbowSwitch) {
    addPath(elbowSwitch(posA, posB, h0, L1, L2, false, ikA, ikB));
    addPath(elbowSwitch(posA, posB, h0, L1, L2, true, ikA, ikB));
  }

  if (enabledStrategies.cubicPoly) {
    addPath(cubicPolynomial(ikA.elbowUp, ikB.elbowUp, 'Smooth', 0, 0));
    addPath(cubicPolynomial(ikA.elbowUp, ikB.elbowUp, 'Fast Start', 2.5, 0));
    if (paths.length < numPaths) {
      addPath(cubicPolynomial(ikA.elbowDown, ikB.elbowDown, 'Overshoot', 3.0, -1.5));
    }
  }

  if (enabledStrategies.circularArc) {
    addPath(circularArc(ikA.elbowUp, ikB.elbowUp, 0.5, 0));
    addPath(circularArc(ikA.elbowUp, ikB.elbowUp, -0.5, 1));
    if (paths.length < numPaths) {
      addPath(circularArc(ikA.elbowDown, ikB.elbowDown, 0.8, 0));
    }
  }

  paths.forEach(p => { p.limitViolation = checkJointLimits3D(p, jointLimits); });

  paths.sort((a, b) => {
    if (a.limitViolation !== b.limitViolation) return a.limitViolation ? 1 : -1;
    return a.cost - b.cost;
  });

  paths.forEach((p, i) => { p.rank = i + 1; });

  return paths.slice(0, numPaths);
}
