// kinematics.js — FK, IK, workspace boundary for 2-joint planar arm

export function forwardKinematics(theta1, theta2, L1, L2) {
  const jx = L1 * Math.cos(theta1);
  const jy = L1 * Math.sin(theta1);
  const ex = jx + L2 * Math.cos(theta1 + theta2);
  const ey = jy + L2 * Math.sin(theta1 + theta2);
  return {
    joint: { x: jx, y: jy },
    endEffector: { x: ex, y: ey }
  };
}

export function inverseKinematics(x, y, L1, L2) {
  const dSq = x * x + y * y;
  const d = Math.sqrt(dSq);
  if (d > L1 + L2 + 1e-6 || d < Math.abs(L1 - L2) - 1e-6) return null;

  let cosTheta2 = (dSq - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  cosTheta2 = Math.max(-1, Math.min(1, cosTheta2));

  const theta2_down = Math.acos(cosTheta2);
  const theta2_up = -theta2_down;

  const solutions = [];
  for (const theta2 of [theta2_up, theta2_down]) {
    const k1 = L1 + L2 * Math.cos(theta2);
    const k2 = L2 * Math.sin(theta2);
    const theta1 = Math.atan2(y, x) - Math.atan2(k2, k1);
    solutions.push({ theta1, theta2 });
  }

  return { elbowUp: solutions[0], elbowDown: solutions[1] };
}

export function isReachable(x, y, L1, L2) {
  const d = Math.sqrt(x * x + y * y);
  return d <= L1 + L2 + 1e-6 && d >= Math.abs(L1 - L2) - 1e-6;
}

export function workspaceBoundary(L1, L2, numPoints = 120) {
  const outer = [];
  const inner = [];
  const rOuter = L1 + L2;
  const rInner = Math.abs(L1 - L2);
  for (let i = 0; i <= numPoints; i++) {
    const a = (2 * Math.PI * i) / numPoints;
    outer.push({ x: rOuter * Math.cos(a), y: rOuter * Math.sin(a) });
    if (rInner > 1e-6) {
      inner.push({ x: rInner * Math.cos(a), y: rInner * Math.sin(a) });
    }
  }
  return { outer, inner, rOuter, rInner };
}

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
