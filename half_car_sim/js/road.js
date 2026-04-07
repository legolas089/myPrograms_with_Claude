/**
 * Road profile generators for Half-Car Model
 * Returns { front, rear } functions with wheelbase time delay
 */

export function createHalfCarRoadProfile(type, height, speed, wheelbase) {
  const baseFn = createBaseProfile(type, height, speed);
  const delay = wheelbase / speed;

  return {
    front: baseFn,
    rear: (t) => baseFn(Math.max(0, t - delay))
  };
}

function createBaseProfile(type, height, speed) {
  switch (type) {
    case 'bump': return createBumpProfile(height, speed);
    case 'step': return createStepProfile(height, speed);
    case 'sine': return createSineProfile(height, speed);
    case 'random': return createRandomProfile(height, speed);
    default: return () => 0;
  }
}

function createBumpProfile(height, speed) {
  const bumpLength = 0.3;
  const bumpDuration = bumpLength / speed;
  const startTime = 1.0;
  return (t) => {
    const dt = t - startTime;
    if (dt < 0 || dt > bumpDuration) return 0;
    return height * Math.sin(Math.PI * dt / bumpDuration);
  };
}

function createStepProfile(height, speed) {
  const rampDuration = 0.02;
  const startTime = 1.0;
  return (t) => {
    const dt = t - startTime;
    if (dt < 0) return 0;
    if (dt < rampDuration) return height * (dt / rampDuration);
    return height;
  };
}

function createSineProfile(height, speed) {
  const wavelength = 3.0;
  const freq = speed / wavelength;
  return (t) => height * Math.sin(2 * Math.PI * freq * t);
}

function createRandomProfile(height, speed) {
  const numComponents = 15;
  const components = [];
  let seed = 12345;
  function seededRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let i = 0; i < numComponents; i++) {
    const wl = 0.5 + seededRandom() * 5;
    const freq = speed / wl;
    const phase = seededRandom() * 2 * Math.PI;
    const amp = height * (0.3 + 0.7 * seededRandom()) / numComponents * 3;
    components.push({ freq, phase, amp });
  }
  return (t) => {
    let sum = 0;
    for (const c of components) sum += c.amp * Math.sin(2 * Math.PI * c.freq * t + c.phase);
    return sum;
  };
}

/**
 * Get road segment for animation (front wheel road)
 */
export function getRoadSegment(roadFn, tCenter, windowSec, numPoints) {
  const points = [];
  const dt = windowSec / numPoints;
  const tStart = tCenter - windowSec / 2;
  for (let i = 0; i <= numPoints; i++) {
    const t = tStart + i * dt;
    points.push({ t, y: roadFn(Math.max(0, t)) });
  }
  return points;
}
