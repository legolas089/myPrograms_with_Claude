/**
 * Half-Car 4-DOF Suspension Model
 *
 * State vector: [y1, dy1, y2, dy2, y3, dy3, phi3, dphi3]
 *   y1    = front unsprung mass displacement
 *   y2    = rear unsprung mass displacement
 *   y3    = sprung mass CG vertical displacement
 *   phi3  = pitch angle (positive = nose down)
 *
 * Equations of motion:
 *   F_f = K1*(y3 - b1*phi3 - y1) + C1*(dy3 - b1*dphi3 - dy1)
 *   F_r = K2*(y3 + b2*phi3 - y2) + C2*(dy3 + b2*dphi3 - dy2)
 *
 *   m1*ddy1   = F_f - kt1*(y1 - u1)
 *   m2*ddy2   = F_r - kt2*(y2 - u2)
 *   m3*ddy3   = -F_f - F_r
 *   I3*ddphi3 = b1*F_f - b2*F_r
 */

export function createSimulation(params) {
  const { m1, m2, m3, I3, K1, C1, kt1, K2, C2, kt2, b1, b2 } = params;

  function deriv(state, u1, u2) {
    const [y1, dy1, y2, dy2, y3, dy3, phi3, dphi3] = state;

    const relDispF = y3 - b1 * phi3 - y1;
    const relVelF = dy3 - b1 * dphi3 - dy1;
    const Ff = K1 * relDispF + C1 * relVelF;

    const relDispR = y3 + b2 * phi3 - y2;
    const relVelR = dy3 + b2 * dphi3 - dy2;
    const Fr = K2 * relDispR + C2 * relVelR;

    const tireFf = kt1 * (y1 - u1);
    const tireFr = kt2 * (y2 - u2);

    const ddy1 = (Ff - tireFf) / m1;
    const ddy2 = (Fr - tireFr) / m2;
    const ddy3 = (-Ff - Fr) / m3;
    const ddphi3 = (b1 * Ff - b2 * Fr) / I3;

    return [dy1, ddy1, dy2, ddy2, dy3, ddy3, dphi3, ddphi3];
  }

  return { deriv, params };
}

export function rk4Step(sim, state, u1, u1Mid, u1Next, u2, u2Mid, u2Next, dt) {
  const { deriv } = sim;

  const k1 = deriv(state, u1, u2);
  const s2 = state.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = deriv(s2, u1Mid, u2Mid);
  const s3 = state.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = deriv(s3, u1Mid, u2Mid);
  const s4 = state.map((v, i) => v + dt * k3[i]);
  const k4 = deriv(s4, u1Next, u2Next);

  return state.map((v, i) =>
    v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  );
}

/**
 * Run full simulation
 */
export function runSimulation(params, roadFront, roadRear, duration, dtSim = 0.0005) {
  const sim = createSimulation(params);
  const steps = Math.ceil(duration / dtSim);
  const outputInterval = Math.max(1, Math.floor(steps / 2000));

  const time = [], y1Arr = [], y2Arr = [], y3Arr = [], phi3Arr = [];
  const dy3Arr = [], dphi3Arr = [], ddy3Arr = [], ddphi3Arr = [];
  const u1Arr = [], u2Arr = [];

  let state = [0, 0, 0, 0, 0, 0, 0, 0];
  let prevDy3 = 0, prevDphi3 = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i * dtSim;
    const u1 = roadFront(t);
    const u2 = roadRear(t);

    if (i % outputInterval === 0) {
      const ddy3 = i === 0 ? 0 : (state[5] - prevDy3) / dtSim;
      const ddphi3 = i === 0 ? 0 : (state[7] - prevDphi3) / dtSim;
      time.push(t);
      y1Arr.push(state[0]);
      y2Arr.push(state[2]);
      y3Arr.push(state[4]);
      phi3Arr.push(state[6]);
      dy3Arr.push(state[5]);
      dphi3Arr.push(state[7]);
      ddy3Arr.push(ddy3);
      ddphi3Arr.push(ddphi3);
      u1Arr.push(u1);
      u2Arr.push(u2);
    }

    prevDy3 = state[5];
    prevDphi3 = state[7];

    if (i < steps) {
      const tMid = t + 0.5 * dtSim;
      const tNext = t + dtSim;
      state = rk4Step(sim, state,
        u1, roadFront(tMid), roadFront(tNext),
        u2, roadRear(tMid), roadRear(tNext),
        dtSim
      );
    }
  }

  return {
    time, y1: y1Arr, y2: y2Arr, y3: y3Arr, phi3: phi3Arr,
    dy3: dy3Arr, dphi3: dphi3Arr, ddy3: ddy3Arr, ddphi3: ddphi3Arr,
    u1: u1Arr, u2: u2Arr
  };
}

/**
 * Ride comfort metrics
 */
export function computeComfort(result, params) {
  const { time, y1, y2, y3, phi3, ddy3, ddphi3, u1, u2 } = result;
  const { b1, b2 } = params;
  const n = time.length;
  const T = time[n - 1] - time[0];
  const dt = T / (n - 1);

  let sumAccSq = 0, sumPitchAccSq = 0;
  let sumFRS = 0, maxFR = 0, sumRRS = 0, maxRR = 0;
  let sumFTD = 0, maxFTD = 0, sumRTD = 0, maxRTD = 0;

  for (let i = 0; i < n; i++) {
    sumAccSq += ddy3[i] * ddy3[i];
    sumPitchAccSq += ddphi3[i] * ddphi3[i];

    const frs = y3[i] - b1 * phi3[i] - y1[i];
    sumFRS += frs * frs;
    if (Math.abs(frs) > maxFR) maxFR = Math.abs(frs);

    const rrs = y3[i] + b2 * phi3[i] - y2[i];
    sumRRS += rrs * rrs;
    if (Math.abs(rrs) > maxRR) maxRR = Math.abs(rrs);

    const ftd = y1[i] - u1[i];
    sumFTD += ftd * ftd;
    if (Math.abs(ftd) > maxFTD) maxFTD = Math.abs(ftd);

    const rtd = y2[i] - u2[i];
    sumRTD += rtd * rtd;
    if (Math.abs(rtd) > maxRTD) maxRTD = Math.abs(rtd);
  }

  return {
    rmsAcc: Math.sqrt(sumAccSq * dt / T),
    rmsPitchAcc: Math.sqrt(sumPitchAccSq * dt / T),
    rmsFrontRattle: Math.sqrt(sumFRS * dt / T), maxFrontRattle: maxFR,
    rmsRearRattle: Math.sqrt(sumRRS * dt / T), maxRearRattle: maxRR,
    rmsFrontTireDef: Math.sqrt(sumFTD * dt / T), maxFrontTireDef: maxFTD,
    rmsRearTireDef: Math.sqrt(sumRTD * dt / T), maxRearTireDef: maxRTD,
  };
}

/* ── Complex arithmetic helpers ── */
function cAdd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function cSub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function cMul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
function cDiv(a, b) {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
function cAbs(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
function cReal(r) { return [r, 0]; }
function cScale(a, s) { return [a[0] * s, a[1] * s]; }

/**
 * Solve 4x4 complex linear system Ax = b (Gaussian elimination with partial pivoting)
 */
function solveComplex4x4(A, b) {
  const n = 4;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxVal = cAbs(M[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const v = cAbs(M[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxRow !== col) [M[col], M[maxRow]] = [M[maxRow], M[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = cDiv(M[row][col], M[col][col]);
      for (let j = col; j <= n; j++) {
        M[row][j] = cSub(M[row][j], cMul(factor, M[col][j]));
      }
    }
  }

  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum = cSub(sum, cMul(M[i][j], x[j]));
    }
    x[i] = cDiv(sum, M[i][i]);
  }
  return x;
}

/**
 * Frequency response: in-phase road input (u1 = u2 = 1)
 * Returns transfer function magnitudes for CG accel, pitch accel, rattle, tire def
 */
export function computeFrequencyResponse(params, fMin = 0.1, fMax = 30, nPoints = 300) {
  const { m1, m2, m3, I3, K1, C1, kt1, K2, C2, kt2, b1, b2 } = params;

  const freqs = [], cgAccMag = [], pitchAccMag = [];
  const frontRattleMag = [], rearRattleMag = [];
  const frontTireDefMag = [], rearTireDefMag = [];

  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);

  for (let i = 0; i < nPoints; i++) {
    const f = Math.pow(10, logMin + (logMax - logMin) * i / (nPoints - 1));
    const w = 2 * Math.PI * f;
    const s = [0, w];           // jw
    const s2 = [-w * w, 0];     // -w²

    const S1 = cAdd(cReal(K1), cScale(s, C1));
    const S2 = cAdd(cReal(K2), cScale(s, C2));

    // 4x4 system: X = [Y1, Y2, Y3, Phi3]
    const A = [
      [cAdd(cAdd(cScale(s2, m1), S1), cReal(kt1)), cReal(0), cScale(S1, -1), cScale(S1, b1)],
      [cReal(0), cAdd(cAdd(cScale(s2, m2), S2), cReal(kt2)), cScale(S2, -1), cScale(S2, -b2)],
      [cScale(S1, -1), cScale(S2, -1), cAdd(cScale(s2, m3), cAdd(S1, S2)), cAdd(cScale(S1, -b1), cScale(S2, b2))],
      [cScale(S1, b1), cScale(S2, -b2), cAdd(cScale(S1, -b1), cScale(S2, b2)), cAdd(cScale(s2, I3), cAdd(cScale(S1, b1 * b1), cScale(S2, b2 * b2)))]
    ];

    const rhs = [cReal(kt1), cReal(kt2), cReal(0), cReal(0)];
    const [Y1, Y2, Y3, Phi3] = solveComplex4x4(A, rhs);

    cgAccMag.push(w * w * cAbs(Y3));
    pitchAccMag.push(w * w * cAbs(Phi3));
    frontRattleMag.push(cAbs(cSub(cSub(Y3, cScale(Phi3, b1)), Y1)));
    rearRattleMag.push(cAbs(cSub(cAdd(Y3, cScale(Phi3, b2)), Y2)));
    frontTireDefMag.push(cAbs(cSub(Y1, cReal(1))));
    rearTireDefMag.push(cAbs(cSub(Y2, cReal(1))));
    freqs.push(f);
  }

  return { freqs, cgAccMag, pitchAccMag, frontRattleMag, rearRattleMag, frontTireDefMag, rearTireDefMag };
}

/**
 * Derived parameters: front/rear damping ratio, natural freq, pitch freq
 */
export function computeDerived(params) {
  const { m3, I3, K1, C1, K2, C2, b1, b2 } = params;
  const L = b1 + b2;
  const mf = m3 * b2 / L;
  const mr = m3 * b1 / L;

  const fnF = Math.sqrt(K1 / mf) / (2 * Math.PI);
  const zetaF = C1 / (2 * Math.sqrt(K1 * mf));
  const fnR = Math.sqrt(K2 / mr) / (2 * Math.PI);
  const zetaR = C2 / (2 * Math.sqrt(K2 * mr));
  const fnPitch = Math.sqrt((K1 * b1 * b1 + K2 * b2 * b2) / I3) / (2 * Math.PI);

  return { fnF, zetaF, fnR, zetaR, fnPitch };
}
