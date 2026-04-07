import { runBumpSweep, computeAtBump, computeLoadTransfer, computeJackingForce } from './geometry.js';
import { AnimationRenderer } from './animation.js';
import { RCHeightGraphRenderer, SAAngleGraphRenderer, CamberGraphRenderer, ScrubGraphRenderer } from './graphs.js';

// ── State ──
const PARAM_KEYS = [
  'halfTrack', 'bodyHeight',
  'lowerPivotX', 'lowerPivotY', 'lowerArmLen', 'lowerArmAngle',
  'upperPivotX', 'upperPivotY', 'upperArmLen', 'upperArmAngle',
  'bumpRange', 'bumpPos'
];

const VEHICLE_PARAM_KEYS = ['cgHeight', 'mass', 'latG'];

const DECIMAL_KEYS = new Set(['lowerArmAngle', 'upperArmAngle', 'latG']);

const configSets = {
  A: {
    halfTrack: 750, bodyHeight: 200,
    lowerPivotX: 200, lowerPivotY: 0, lowerArmLen: 350, lowerArmAngle: -2,
    upperPivotX: 200, upperPivotY: 200, upperArmLen: 280, upperArmAngle: -8,
    bumpRange: 50, bumpPos: 0,
    cgHeight: 500, mass: 1400, latG: 1.0
  },
  B: {
    halfTrack: 750, bodyHeight: 200,
    lowerPivotX: 200, lowerPivotY: 0, lowerArmLen: 350, lowerArmAngle: -2,
    upperPivotX: 200, upperPivotY: 200, upperArmLen: 280, upperArmAngle: -8,
    bumpRange: 50, bumpPos: 0,
    cgHeight: 500, mass: 1400, latG: 1.0
  }
};

const PRESETS = {
  'stock-sedan': {
    halfTrack: 750, bodyHeight: 200,
    lowerPivotX: 200, lowerPivotY: 0, lowerArmLen: 350, lowerArmAngle: -2,
    upperPivotX: 200, upperPivotY: 200, upperArmLen: 280, upperArmAngle: -8,
    bumpRange: 50
  },
  'lowered': {
    halfTrack: 740, bodyHeight: 180,
    lowerPivotX: 200, lowerPivotY: 0, lowerArmLen: 350, lowerArmAngle: 3,
    upperPivotX: 200, upperPivotY: 190, upperArmLen: 280, upperArmAngle: -3,
    bumpRange: 40
  },
  'high-rc': {
    halfTrack: 750, bodyHeight: 200,
    lowerPivotX: 250, lowerPivotY: 0, lowerArmLen: 300, lowerArmAngle: -8,
    upperPivotX: 250, upperPivotY: 220, upperArmLen: 250, upperArmAngle: -12,
    bumpRange: 50
  },
  'parallel': {
    halfTrack: 750, bodyHeight: 200,
    lowerPivotX: 200, lowerPivotY: 0, lowerArmLen: 350, lowerArmAngle: 0,
    upperPivotX: 200, upperPivotY: 200, upperArmLen: 350, upperArmAngle: 0,
    bumpRange: 50
  },
  'custom': null
};

let activeSet = 'A';
let compareMode = false;
let isRunning = false;
let animFrame = null;
let sweepProgress = 0; // 0..1

let resultA = null, resultB = null;
let currentBumpVal = 0;

// ── DOM Elements ──
const presetSelect = document.getElementById('preset-select');
const configTabs = document.querySelectorAll('.config-tab');
const compareToggle = document.getElementById('compare-toggle');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');
const vehicleSpecToggle = document.getElementById('vehicle-spec-toggle');
const vehicleSpecPanel = document.getElementById('vehicle-spec-panel');
const compareLegends = document.querySelectorAll('.compare-legend');

// Sliders
const sliders = {};
const vals = {};
for (const key of [...PARAM_KEYS, ...VEHICLE_PARAM_KEYS]) {
  sliders[key] = document.getElementById('param-' + key);
  vals[key] = document.getElementById('val-' + key);
}

// Result elements
const resEls = {
  rcHeight: document.getElementById('res-rc-height'),
  icPos: document.getElementById('res-ic-pos'),
  saLength: document.getElementById('res-sa-length'),
  saAngle: document.getElementById('res-sa-angle'),
  camber: document.getElementById('res-camber'),
  camberGain: document.getElementById('res-camber-gain'),
  kpi: document.getElementById('res-kpi'),
  scrubRadius: document.getElementById('res-scrub-radius'),
  scrub: document.getElementById('res-scrub'),
  geoTransfer: document.getElementById('res-geo-transfer'),
  elasticTransfer: document.getElementById('res-elastic-transfer'),
  geoRatio: document.getElementById('res-geo-ratio'),
  jacking: document.getElementById('res-jacking')
};

// ── Renderers ──
const animRenderer = new AnimationRenderer(document.getElementById('anim-canvas'));
const rcHeightRenderer = new RCHeightGraphRenderer(document.getElementById('rc-height-canvas'));
const saAngleRenderer = new SAAngleGraphRenderer(document.getElementById('sa-angle-canvas'));
const camberRenderer = new CamberGraphRenderer(document.getElementById('camber-canvas'));
const scrubRenderer = new ScrubGraphRenderer(document.getElementById('scrub-canvas'));

// ── Config Tab Switching ──
configTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    saveCurrentToSet(activeSet);
    configTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSet = tab.dataset.set;
    loadSetToSliders(activeSet);
  });
});

function saveCurrentToSet(set) {
  for (const key of [...PARAM_KEYS, ...VEHICLE_PARAM_KEYS]) {
    configSets[set][key] = parseFloat(sliders[key].value);
  }
}

function loadSetToSliders(set) {
  const params = configSets[set];
  for (const key of [...PARAM_KEYS, ...VEHICLE_PARAM_KEYS]) {
    if (sliders[key]) {
      sliders[key].value = params[key];
      updateValDisplay(key);
    }
  }
  updateBumpSliderRange();
  updateAtCurrentBump();
}

// ── Slider events ──
for (const key of [...PARAM_KEYS, ...VEHICLE_PARAM_KEYS]) {
  if (!sliders[key]) continue;
  sliders[key].addEventListener('input', () => {
    updateValDisplay(key);
    configSets[activeSet][key] = parseFloat(sliders[key].value);

    if (key === 'bumpRange') {
      updateBumpSliderRange();
    }

    if (key === 'bumpPos') {
      currentBumpVal = parseFloat(sliders.bumpPos.value);
      updateAtCurrentBump();
    } else {
      presetSelect.value = 'custom';
      // Recompute sweep if geometry changed
      if (!VEHICLE_PARAM_KEYS.includes(key) && key !== 'bumpPos') {
        computeAndDraw();
      }
      // Update dynamics if vehicle spec changed
      if (VEHICLE_PARAM_KEYS.includes(key)) {
        updateDynamics();
      }
    }
  });
}

function updateValDisplay(key) {
  if (!sliders[key] || !vals[key]) return;
  const v = parseFloat(sliders[key].value);
  vals[key].textContent = DECIMAL_KEYS.has(key) ? v.toFixed(1) : v.toFixed(0);
}

function updateBumpSliderRange() {
  const range = parseFloat(sliders.bumpRange.value);
  sliders.bumpPos.min = -range;
  sliders.bumpPos.max = range;
  // Clamp current value
  const cur = parseFloat(sliders.bumpPos.value);
  if (cur < -range) sliders.bumpPos.value = -range;
  if (cur > range) sliders.bumpPos.value = range;
  currentBumpVal = parseFloat(sliders.bumpPos.value);
  updateValDisplay('bumpPos');
}

// ── Preset ──
presetSelect.addEventListener('change', () => {
  const preset = PRESETS[presetSelect.value];
  if (!preset) return;
  // Keep vehicle spec, only update geometry
  const vehicleParams = {};
  for (const key of VEHICLE_PARAM_KEYS) {
    vehicleParams[key] = configSets[activeSet][key];
  }
  configSets[activeSet] = { ...configSets[activeSet], ...preset, bumpPos: 0 };
  Object.assign(configSets[activeSet], vehicleParams);
  loadSetToSliders(activeSet);
  computeAndDraw();
});

// ── Compare mode ──
compareToggle.addEventListener('change', () => {
  compareMode = compareToggle.checked;
  compareLegends.forEach(el => el.classList.toggle('visible', compareMode));
  computeAndDraw();
});

// ── Vehicle Spec toggle ──
vehicleSpecToggle.addEventListener('change', () => {
  vehicleSpecPanel.classList.toggle('hidden', !vehicleSpecToggle.checked);
  if (vehicleSpecToggle.checked) updateDynamics();
});

// ── Start / Reset ──
btnStart.addEventListener('click', () => {
  if (isRunning) stopSweep();
  else startSweep();
});

btnReset.addEventListener('click', () => {
  stopSweep();
  sliders.bumpPos.value = 0;
  currentBumpVal = 0;
  updateValDisplay('bumpPos');
  computeAndDraw();
});

function startSweep() {
  saveCurrentToSet(activeSet);
  computeResults();
  isRunning = true;
  sweepProgress = 0;
  btnStart.innerHTML = '&#9646;&#9646; Stop';
  btnStart.style.background = '#d32f2f';

  let lastTimestamp = null;
  const sweepDuration = 3.0; // seconds to complete one sweep

  function animate(timestamp) {
    if (!isRunning) return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dtReal = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    sweepProgress += dtReal / sweepDuration;

    if (sweepProgress >= 1) {
      sweepProgress = 1;
      drawAtProgress(sweepProgress);
      stopSweep();
      return;
    }

    drawAtProgress(sweepProgress);
    animFrame = requestAnimationFrame(animate);
  }
  animFrame = requestAnimationFrame(animate);
}

function stopSweep() {
  isRunning = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  btnStart.innerHTML = '&#9654; Sweep';
  btnStart.style.background = '';
}

function drawAtProgress(progress) {
  if (!resultA) return;
  const bumpRange = parseFloat(sliders.bumpRange.value);
  // Sweep from -range to +range
  const bumpVal = -bumpRange + progress * 2 * bumpRange;

  // Update bump slider to match
  sliders.bumpPos.value = bumpVal;
  updateValDisplay('bumpPos');
  currentBumpVal = bumpVal;

  updateAtCurrentBump();
}

// ── Core computation ──
function getGeometryParams(set) {
  const p = configSets[set];
  return {
    halfTrack: p.halfTrack,
    bodyHeight: p.bodyHeight || 0,
    lowerPivotX: p.lowerPivotX,
    lowerPivotY: p.lowerPivotY,
    lowerArmLen: p.lowerArmLen,
    lowerArmAngle: p.lowerArmAngle,
    upperPivotX: p.upperPivotX,
    upperPivotY: p.upperPivotY,
    upperArmLen: p.upperArmLen,
    upperArmAngle: p.upperArmAngle
  };
}

function computeResults() {
  const paramsA = getGeometryParams('A');
  const bumpRangeA = configSets.A.bumpRange;
  resultA = runBumpSweep(paramsA, bumpRangeA, 200);

  if (compareMode) {
    const paramsB = getGeometryParams('B');
    const bumpRangeB = configSets.B.bumpRange;
    resultB = runBumpSweep(paramsB, bumpRangeB, 200);
  } else {
    resultB = null;
  }
}

function computeAndDraw() {
  saveCurrentToSet(activeSet);
  computeResults();
  updateAtCurrentBump();
}

function updateAtCurrentBump() {
  const paramsA = getGeometryParams('A');
  const pointA = computeAtBump(paramsA, currentBumpVal);

  let pointB = null;
  if (compareMode) {
    const paramsB = getGeometryParams('B');
    pointB = computeAtBump(paramsB, currentBumpVal);
  }

  // Update animation
  animRenderer.resize();
  animRenderer.draw(
    pointA ? { P1: pointA.P1, P2: pointA.P2, P3: pointA.P3, P4: pointA.P4, IC: pointA.IC, RC: pointA.RC, contactX: pointA.contactX } : null,
    pointB ? { P1: pointB.P1, P2: pointB.P2, P3: pointB.P3, P4: pointB.P4, IC: pointB.IC, RC: pointB.RC, contactX: pointB.contactX } : null,
    paramsA,
    currentBumpVal
  );

  // Update graphs
  if (!resultA || resultA.bump.length === 0) computeResults();

  rcHeightRenderer.resize();
  saAngleRenderer.resize();
  camberRenderer.resize();
  scrubRenderer.resize();

  rcHeightRenderer.draw(resultA, resultB, currentBumpVal);
  saAngleRenderer.draw(resultA, resultB, currentBumpVal);
  camberRenderer.draw(resultA, resultB, currentBumpVal);
  scrubRenderer.draw(resultA, resultB, currentBumpVal);

  // Update results panel
  updateResultsPanel(pointA);

  // Update dynamics
  if (vehicleSpecToggle.checked && pointA) {
    updateDynamics(pointA);
  }
}

function updateResultsPanel(point) {
  if (!point || !point.RC) {
    for (const el of Object.values(resEls)) {
      if (el) el.textContent = '-';
    }
    return;
  }

  resEls.rcHeight.textContent = point.rcHeight.toFixed(1) + ' mm';
  resEls.icPos.textContent = `(${point.IC.x.toFixed(0)}, ${point.IC.y.toFixed(0)}) mm`;
  resEls.saLength.textContent = point.saLength.toFixed(0) + ' mm';
  resEls.saAngle.textContent = point.saAngle.toFixed(2) + '°';
  resEls.camber.textContent = point.camber.toFixed(2) + '°';
  resEls.camberGain.textContent = (point.camberGain >= 0 ? '+' : '') + point.camberGain.toFixed(2) + '°';
  resEls.kpi.textContent = point.kpi.toFixed(2) + '°';
  resEls.scrubRadius.textContent = point.scrubRadius.toFixed(1) + ' mm';
  resEls.scrub.textContent = (point.scrub >= 0 ? '+' : '') + point.scrub.toFixed(2) + ' mm';
}

function updateDynamics(point) {
  if (!vehicleSpecToggle.checked) return;

  const p = configSets[activeSet];
  if (!point) {
    const paramsA = getGeometryParams(activeSet);
    point = computeAtBump(paramsA, currentBumpVal);
  }
  if (!point || !point.RC) return;

  const trackWidth = p.halfTrack * 2;
  const lt = computeLoadTransfer(point.rcHeight, p.cgHeight, trackWidth, p.mass, p.latG);
  const lateralForce = p.mass * 9.81 * p.latG;
  const jackForce = computeJackingForce(point.saAngle, lateralForce);

  resEls.geoTransfer.textContent = lt.geoTransfer.toFixed(0) + ' N';
  resEls.elasticTransfer.textContent = lt.elasticTransfer.toFixed(0) + ' N';
  resEls.geoRatio.textContent = (lt.geoRatio * 100).toFixed(1) + '%';
  resEls.jacking.textContent = jackForce.toFixed(0) + ' N';
}

// ── Resize ──
window.addEventListener('resize', () => {
  if (resultA) {
    updateAtCurrentBump();
  } else {
    animRenderer.resize();
    animRenderer.draw(null, null, null, 0);
    for (const r of [rcHeightRenderer, saAngleRenderer, camberRenderer, scrubRenderer]) {
      r.resize();
      r.clear();
    }
  }
});

// ── Init ──
updateBumpSliderRange();
// Initial computation
computeAndDraw();
