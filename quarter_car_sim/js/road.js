/**
 * Road profile generators
 * All return a function: (t) => displacement
 *
 * @param {string} type - 'bump', 'step', 'sine', 'random'
 * @param {number} height - bump height in meters
 * @param {number} speed - vehicle speed in m/s
 */

export function createRoadProfile(type, height, speed) {
  switch (type) {
    case 'bump':
      return createBumpProfile(height, speed);
    case 'step':
      return createStepProfile(height, speed);
    case 'sine':
      return createSineProfile(height, speed);
    case 'random':
      return createRandomProfile(height, speed);
    default:
      return () => 0;
  }
}

/**
 * Speed bump: half-sine shape, 0.3m long
 */
function createBumpProfile(height, speed) {
  const bumpLength = 0.3; // meters
  const bumpDuration = bumpLength / speed;
  const startTime = 1.0;

  return (t) => {
    const dt = t - startTime;
    if (dt < 0 || dt > bumpDuration) return 0;
    return height * Math.sin(Math.PI * dt / bumpDuration);
  };
}

/**
 * Step: sudden height change
 */
function createStepProfile(height, speed) {
  const rampDuration = 0.02; // 20ms ramp (for numerical stability)
  const startTime = 1.0;

  return (t) => {
    const dt = t - startTime;
    if (dt < 0) return 0;
    if (dt < rampDuration) return height * (dt / rampDuration);
    return height;
  };
}

/**
 * Sine wave: continuous sinusoidal road
 * Wavelength = 3m (typical corrugation)
 */
function createSineProfile(height, speed) {
  const wavelength = 3.0; // meters
  const freq = speed / wavelength;

  return (t) => {
    return height * Math.sin(2 * Math.PI * freq * t);
  };
}

/**
 * Random: sum of multiple sine waves with random phases
 */
function createRandomProfile(height, speed) {
  // Pre-generate random components
  const numComponents = 15;
  const components = [];

  // Use a simple seeded random for reproducibility within a session
  let seed = 12345;
  function seededRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = 0; i < numComponents; i++) {
    const wavelength = 0.5 + seededRandom() * 5; // 0.5 to 5.5m
    const freq = speed / wavelength;
    const phase = seededRandom() * 2 * Math.PI;
    const amp = height * (0.3 + 0.7 * seededRandom()) / numComponents * 3;
    components.push({ freq, phase, amp });
  }

  return (t) => {
    let sum = 0;
    for (const c of components) {
      sum += c.amp * Math.sin(2 * Math.PI * c.freq * t + c.phase);
    }
    return sum;
  };
}

/**
 * Get road profile data for animation visualization
 * Returns array of {x, y} points representing road ahead
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
