/**
 * Quarter-Car 2-DOF Suspension Model
 *
 * State vector: [zs, dzs, zu, dzu]
 *   zs  = sprung mass displacement
 *   dzs = sprung mass velocity
 *   zu  = unsprung mass displacement
 *   dzu = unsprung mass velocity
 *
 * Equations of motion:
 *   ms * z̈s = -ks*(zs - zu) - cs*(żs - żu)
 *   mu * z̈u =  ks*(zs - zu) + cs*(żs - żu) - kt*(zu - zr)
 */

export function createSimulation(params) {
  const { ms, mu, ks, cs, kt } = params;

  // Derivatives function
  function deriv(state, zr) {
    const [zs, dzs, zu, dzu] = state;

    const springForce = ks * (zs - zu);
    const damperForce = cs * (dzs - dzu);
    const tireForce = kt * (zu - zr);

    const ddzs = (-springForce - damperForce) / ms;
    const ddzu = (springForce + damperForce - tireForce) / mu;

    return [dzs, ddzs, dzu, ddzu];
  }

  return { deriv, params: { ms, mu, ks, cs, kt } };
}

/**
 * RK4 integration step
 */
export function rk4Step(sim, state, zr, zrMid, zrNext, dt) {
  const { deriv } = sim;

  const k1 = deriv(state, zr);

  const s2 = state.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = deriv(s2, zrMid);

  const s3 = state.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = deriv(s3, zrMid);

  const s4 = state.map((v, i) => v + dt * k3[i]);
  const k4 = deriv(s4, zrNext);

  return state.map((v, i) =>
    v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  );
}

/**
 * Run a full simulation
 * @returns {{ time, zs, zu, zr, dzs, dzu, ddzs }} arrays of results
 */
export function runSimulation(params, roadFn, duration, dtSim = 0.0005) {
  const sim = createSimulation(params);
  const steps = Math.ceil(duration / dtSim);

  // Downsample for output (keep ~2000 points max)
  const outputInterval = Math.max(1, Math.floor(steps / 2000));

  const time = [];
  const zsArr = [];
  const zuArr = [];
  const zrArr = [];
  const dzsArr = [];
  const dzuArr = [];
  const ddzsArr = [];

  let state = [0, 0, 0, 0]; // [zs, dzs, zu, dzu]
  let prevDzs = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i * dtSim;
    const zr = roadFn(t);

    if (i % outputInterval === 0) {
      const ddzs = (state[1] - prevDzs) / dtSim;
      time.push(t);
      zsArr.push(state[0]);
      zuArr.push(state[2]);
      zrArr.push(zr);
      dzsArr.push(state[1]);
      dzuArr.push(state[3]);
      ddzsArr.push(i === 0 ? 0 : ddzs);
    }

    prevDzs = state[1];

    if (i < steps) {
      const tMid = t + 0.5 * dtSim;
      const tNext = t + dtSim;
      state = rk4Step(sim, state, zr, roadFn(tMid), roadFn(tNext), dtSim);
    }
  }

  return { time, zs: zsArr, zu: zuArr, zr: zrArr, dzs: dzsArr, dzu: dzuArr, ddzs: ddzsArr };
}

/**
 * Compute ride comfort metrics:
 *  - Sprung Mass Acceleration (RMS)
 *  - Rattle Space (suspension deflection zs - zu)
 *  - Tire Deflection (zu - zr)
 */
export function computeComfort(result, params) {
  const { time, zs, zu, zr, ddzs } = result;
  const n = time.length;
  const T = time[n - 1] - time[0];
  const dt = T / (n - 1);

  let sumAccSq = 0;
  let sumRattleSq = 0, maxRattle = 0;
  let sumTireDefSq = 0, maxTireDef = 0;

  for (let i = 0; i < n; i++) {
    // Sprung mass acceleration
    const a = ddzs[i];
    sumAccSq += a * a;

    // Rattle space (suspension deflection)
    const rs = zs[i] - zu[i];
    sumRattleSq += rs * rs;
    if (Math.abs(rs) > maxRattle) maxRattle = Math.abs(rs);

    // Tire deflection
    const td = zu[i] - zr[i];
    sumTireDefSq += td * td;
    if (Math.abs(td) > maxTireDef) maxTireDef = Math.abs(td);
  }

  const rmsAcc = Math.sqrt(sumAccSq * dt / T);
  const rmsRattle = Math.sqrt(sumRattleSq * dt / T);
  const rmsTireDef = Math.sqrt(sumTireDefSq * dt / T);

  return { rmsAcc, rmsRattle, maxRattle, rmsTireDef, maxTireDef };
}

/**
 * Compute frequency response of the quarter-car model
 * Returns arrays of { freq, sprungAcc, rattleSpace, tireDeflection } magnitudes
 *
 * Transfer functions from road input Zr(jw):
 *   [ms*s² + cs*s + ks      -(cs*s + ks)          ] [Zs]   [    0     ]
 *   [-(cs*s + ks)       mu*s² + cs*s + ks + kt     ] [Zu] = [ kt * Zr  ]
 */
export function computeFrequencyResponse(params, fMin = 0.1, fMax = 30, nPoints = 300) {
  const { ms, mu, ks, cs, kt } = params;

  const freqs = [];
  const sprungAccMag = [];
  const rattleSpaceMag = [];
  const tireDeflMag = [];

  // Logarithmic frequency spacing
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);

  for (let i = 0; i < nPoints; i++) {
    const f = Math.pow(10, logMin + (logMax - logMin) * i / (nPoints - 1));
    const w = 2 * Math.PI * f;

    // s = jw → s² = -w²
    // Complex arithmetic: a + bj
    // A11 = ms*s² + cs*s + ks = (ks - ms*w²) + j*(cs*w)
    const a11r = ks - ms * w * w;
    const a11i = cs * w;

    // A12 = -(cs*s + ks) = -ks + j*(-cs*w)
    const a12r = -ks;
    const a12i = -cs * w;

    // A21 = -(cs*s + ks) = same as A12
    const a21r = a12r;
    const a21i = a12i;

    // A22 = mu*s² + cs*s + ks + kt = (ks + kt - mu*w²) + j*(cs*w)
    const a22r = ks + kt - mu * w * w;
    const a22i = cs * w;

    // RHS: b1 = 0, b2 = kt (real)
    // Solve 2x2 complex system: det = A11*A22 - A12*A21
    const detR = a11r * a22r - a11i * a22i - (a12r * a21r - a12i * a21i);
    const detI = a11r * a22i + a11i * a22r - (a12r * a21i + a12i * a21r);
    const detMagSq = detR * detR + detI * detI;

    // Zs = (A22 * b2) / det  (since b1 = 0)
    // A22 * kt = (a22r * kt, a22i * kt)
    const zsNumR = a22r * kt;
    const zsNumI = a22i * kt;
    const zsR = (zsNumR * detR + zsNumI * detI) / detMagSq;
    const zsI = (zsNumI * detR - zsNumR * detI) / detMagSq;

    // Zu = (-A21 * b2) / det  ... wait, Cramer's rule:
    // Zu = (A11 * b2 - A12 * 0) / det = A11 * kt / det
    const zuNumR = a11r * kt;
    const zuNumI = a11i * kt;
    const zuR = (zuNumR * detR + zuNumI * detI) / detMagSq;
    const zuI = (zuNumI * detR - zuNumR * detI) / detMagSq;

    // Zr = 1 (unit input)

    // Sprung mass acceleration: |s² * Zs / Zr| = w² * |Zs|
    const zsMag = Math.sqrt(zsR * zsR + zsI * zsI);
    const accMag = w * w * zsMag;

    // Rattle space: |(Zs - Zu) / Zr|
    const rsR = zsR - zuR;
    const rsI = zsI - zuI;
    const rsMag = Math.sqrt(rsR * rsR + rsI * rsI);

    // Tire deflection: |(Zu - Zr) / Zr| = |(Zu - 1)|
    const tdR = zuR - 1;
    const tdI = zuI;
    const tdMag = Math.sqrt(tdR * tdR + tdI * tdI);

    freqs.push(f);
    sprungAccMag.push(accMag);
    rattleSpaceMag.push(rsMag);
    tireDeflMag.push(tdMag);
  }

  return { freqs, sprungAccMag, rattleSpaceMag, tireDeflMag };
}

/**
 * Compute derived parameters
 */
export function computeDerived(params) {
  const { ms, ks, cs } = params;
  const wn = Math.sqrt(ks / ms); // natural frequency (rad/s)
  const fn = wn / (2 * Math.PI); // Hz
  const zeta = cs / (2 * Math.sqrt(ks * ms)); // damping ratio
  return { fn, zeta };
}
