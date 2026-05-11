// kinematics.js — 3D Forward / Inverse Kinematics for 3-DOF vertical articulated arm
// Joint definition (per spec):
//   J1 (theta1) : base rotation about Z0 (vertical)
//   J2 (theta2) : shoulder pitch (absolute angle from horizontal plane)
//   J3 (theta3) : elbow pitch (relative to upper arm)
// Forward kinematics:
//   r = L1*cos(theta2) + L2*cos(theta2 + theta3)
//   x = r*cos(theta1)
//   y = r*sin(theta1)
//   z = h0 + L1*sin(theta2) + L2*sin(theta2 + theta3)

export function forwardKinematics3D(t1, t2, t3, h0, L1, L2) {
  const c1 = Math.cos(t1), s1 = Math.sin(t1);
  const c2 = Math.cos(t2), s2 = Math.sin(t2);
  const c23 = Math.cos(t2 + t3), s23 = Math.sin(t2 + t3);

  const r1 = L1 * c2;                  // horizontal distance from J1 to J3
  const r  = r1 + L2 * c23;            // horizontal distance from J1 to P
  const z3 = h0 + L1 * s2;             // z of J3
  const z  = z3 + L2 * s23;            // z of P

  const J1 = { x: 0, y: 0, z: 0 };                       // base on floor
  const J2 = { x: 0, y: 0, z: h0 };                      // shoulder
  const J3 = { x: r1 * c1, y: r1 * s1, z: z3 };          // elbow
  const P  = { x: r  * c1, y: r  * s1, z };              // end-effector

  return { J1, J2, J3, P, r };
}

// Inverse kinematics — solves planar 2R in (r, z') after fixing theta1 from atan2(y, x).
// Returns { elbowUp, elbowDown } each as { t1, t2, t3 } (all radians).
// Returns null when target is outside reachable torus.
export function inverseKinematics3D(x, y, z, h0, L1, L2) {
  const r = Math.sqrt(x * x + y * y);
  const t1 = Math.atan2(y, x);
  const zp = z - h0;

  const dSq = r * r + zp * zp;
  const d = Math.sqrt(dSq);
  if (d > L1 + L2 + 1e-6 || d < Math.abs(L1 - L2) - 1e-6) return null;

  let cosT3 = (dSq - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  cosT3 = Math.max(-1, Math.min(1, cosT3));

  const t3_down = Math.acos(cosT3);     // elbow-down: t3 > 0  (J3 bent below)
  const t3_up   = -t3_down;             // elbow-up:   t3 < 0  (J3 bent above)

  const solutions = {};
  for (const [label, t3] of [['elbowUp', t3_up], ['elbowDown', t3_down]]) {
    const k1 = L1 + L2 * Math.cos(t3);
    const k2 = L2 * Math.sin(t3);
    const t2 = Math.atan2(zp, r) - Math.atan2(k2, k1);
    solutions[label] = { t1, t2, t3 };
  }
  return solutions;
}

export function isReachable3D(x, y, z, h0, L1, L2) {
  const r = Math.sqrt(x * x + y * y);
  const zp = z - h0;
  const d = Math.sqrt(r * r + zp * zp);
  return d <= L1 + L2 + 1e-6 && d >= Math.abs(L1 - L2) - 1e-6;
}

export function workspaceBoundary3D(h0, L1, L2) {
  return {
    rMin: Math.abs(L1 - L2),
    rMax: L1 + L2,
    zMin: h0 - (L1 + L2),
    zMax: h0 + (L1 + L2),
    h0
  };
}

// ── Angle utilities (radians) ──
export function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function shortestAngleDiff(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;
