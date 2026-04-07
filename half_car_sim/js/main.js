import { runSimulation, computeComfort, computeDerived, computeFrequencyResponse } from './simulation.js';
import { createHalfCarRoadProfile } from './road.js';
import { AnimationRenderer } from './animation.js';
import { DisplacementGraphRenderer, PitchGraphRenderer, SuspStrokeGraphRenderer, FreqResponseRenderer } from './graphs.js';

// ── State ──
const PARAM_KEYS = ['m3', 'I3', 'b1', 'b2', 'm1', 'K1', 'C1', 'kt1', 'm2', 'K2', 'C2', 'kt2'];

const configSets = {
  A: { m3: 1200, I3: 1500, b1: 1.2, b2: 1.4, m1: 40, K1: 20000, C1: 1500, kt1: 180000, m2: 40, K2: 18000, C2: 1400, kt2: 180000 },
  B: { m3: 1200, I3: 1500, b1: 1.2, b2: 1.4, m1: 40, K1: 20000, C1: 1500, kt1: 180000, m2: 40, K2: 18000, C2: 1400, kt2: 180000 }
};

const PRESETS = {
  sedan:  { m3: 1200, I3: 1500, b1: 1.2, b2: 1.4, m1: 40, K1: 20000, C1: 1500, kt1: 180000, m2: 40, K2: 18000, C2: 1400, kt2: 180000 },
  suv:    { m3: 1600, I3: 2500, b1: 1.3, b2: 1.5, m1: 50, K1: 25000, C1: 2000, kt1: 200000, m2: 50, K2: 22000, C2: 1800, kt2: 200000 },
  sports: { m3: 1000, I3: 1200, b1: 1.1, b2: 1.3, m1: 30, K1: 35000, C1: 3000, kt1: 220000, m2: 30, K2: 32000, C2: 2800, kt2: 220000 },
  custom: null
};

let activeSet = 'A';
let compareMode = false;
let isRunning = false;
let animFrame = null;
let currentTime = 0;
const playbackSpeed = 1;

let resultA = null, resultB = null;
let roadFnA = null;
let freqRespA = null, freqRespB = null;

// ── DOM ──
const presetSelect = document.getElementById('preset-select');
const configTabs = document.querySelectorAll('.config-tab');
const compareToggle = document.getElementById('compare-toggle');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');

const sliders = {};
const vals = {};
for (const key of PARAM_KEYS) {
  sliders[key] = document.getElementById('param-' + key);
  vals[key] = document.getElementById('val-' + key);
}

const roadSelect = document.getElementById('road-select');
const roadHSlider = document.getElementById('param-road-h');
const roadHVal = document.getElementById('val-road-h');
const speedSlider = document.getElementById('param-speed');
const speedVal = document.getElementById('val-speed');

const derivedEls = {
  zetaF: document.getElementById('zeta-f'),
  fnF: document.getElementById('fn-f'),
  zetaR: document.getElementById('zeta-r'),
  fnR: document.getElementById('fn-r'),
  fnPitch: document.getElementById('fn-pitch')
};

const comfortEls = {
  cgAcc: document.getElementById('comfort-cg-acc'),
  pitchAcc: document.getElementById('comfort-pitch-acc'),
  rattleF: document.getElementById('comfort-rattle-f'),
  rattleR: document.getElementById('comfort-rattle-r'),
  tireF: document.getElementById('comfort-tire-f'),
  tireR: document.getElementById('comfort-tire-r')
};

const compareLegends = document.querySelectorAll('.compare-legend');

// ── Renderers ──
const animRenderer = new AnimationRenderer(document.getElementById('anim-canvas'));
const dispRenderer = new DisplacementGraphRenderer(document.getElementById('disp-canvas'));
const pitchRenderer = new PitchGraphRenderer(document.getElementById('pitch-canvas'));
const strokeRenderer = new SuspStrokeGraphRenderer(document.getElementById('stroke-canvas'));
const freqRenderer = new FreqResponseRenderer(document.getElementById('freq-canvas'));

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
  for (const key of PARAM_KEYS) {
    configSets[set][key] = parseFloat(sliders[key].value);
  }
}

function loadSetToSliders(set) {
  const params = configSets[set];
  for (const key of PARAM_KEYS) {
    sliders[key].value = params[key];
    updateValDisplay(key);
  }
  updateDerived();
}

// ── Slider events ──
const DECIMAL_KEYS = new Set(['b1', 'b2']);

for (const key of PARAM_KEYS) {
  sliders[key].addEventListener('input', () => {
    updateValDisplay(key);
    configSets[activeSet][key] = parseFloat(sliders[key].value);
    updateDerived();
    presetSelect.value = 'custom';
  });
}

function updateValDisplay(key) {
  const v = parseFloat(sliders[key].value);
  vals[key].textContent = DECIMAL_KEYS.has(key) ? v.toFixed(2) : v.toFixed(0);
}

function updateDerived() {
  const p = configSets[activeSet];
  const d = computeDerived(p);
  derivedEls.fnF.textContent = d.fnF.toFixed(1);
  derivedEls.zetaF.textContent = d.zetaF.toFixed(3);
  derivedEls.fnR.textContent = d.fnR.toFixed(1);
  derivedEls.zetaR.textContent = d.zetaR.toFixed(3);
  derivedEls.fnPitch.textContent = d.fnPitch.toFixed(1);

  setDampingColor(derivedEls.zetaF, d.zetaF);
  setDampingColor(derivedEls.zetaR, d.zetaR);
}

function setDampingColor(el, zeta) {
  if (zeta < 0.2) el.style.color = '#ef5350';
  else if (zeta < 0.5) el.style.color = '#81c784';
  else if (zeta < 0.8) el.style.color = '#ffb74d';
  else el.style.color = '#ef5350';
}

// Road sliders
roadHSlider.addEventListener('input', () => { roadHVal.textContent = parseFloat(roadHSlider.value).toFixed(3); });
speedSlider.addEventListener('input', () => { speedVal.textContent = parseFloat(speedSlider.value).toFixed(0); });

// Preset
presetSelect.addEventListener('change', () => {
  const preset = PRESETS[presetSelect.value];
  if (!preset) return;
  configSets[activeSet] = { ...preset };
  loadSetToSliders(activeSet);
});

// Compare mode
compareToggle.addEventListener('change', () => {
  compareMode = compareToggle.checked;
  compareLegends.forEach(el => el.classList.toggle('visible', compareMode));
});

// Road height display
roadHVal.textContent = parseFloat(roadHSlider.value).toFixed(3);

// ── Start / Reset ──
btnStart.addEventListener('click', () => {
  if (isRunning) stopSimulation();
  else startSimulation();
});

btnReset.addEventListener('click', () => {
  stopSimulation();
  resultA = null; resultB = null;
  freqRespA = null; freqRespB = null;
  currentTime = 0;
  clearComfort();
  drawIdle();
});

function startSimulation() {
  saveCurrentToSet(activeSet);

  const roadType = roadSelect.value;
  const roadH = parseFloat(roadHSlider.value);
  const speedMs = parseFloat(speedSlider.value) / 3.6;
  const duration = 4.0;

  // Run simulation A
  const paramsA = { ...configSets.A };
  const wheelbaseA = paramsA.b1 + paramsA.b2;
  const roadA = createHalfCarRoadProfile(roadType, roadH, speedMs, wheelbaseA);
  roadFnA = roadA.front;
  resultA = runSimulation(paramsA, roadA.front, roadA.rear, duration);
  displayComfort(computeComfort(resultA, paramsA));
  freqRespA = computeFrequencyResponse(paramsA);

  // Run simulation B if compare mode
  if (compareMode) {
    const paramsB = { ...configSets.B };
    const wheelbaseB = paramsB.b1 + paramsB.b2;
    const roadB = createHalfCarRoadProfile(roadType, roadH, speedMs, wheelbaseB);
    resultB = runSimulation(paramsB, roadB.front, roadB.rear, duration);
    freqRespB = computeFrequencyResponse(paramsB);
  } else {
    resultB = null;
    freqRespB = null;
  }

  // Draw frequency response (static, not animated)
  freqRenderer.resize();
  freqRenderer.draw(freqRespA, freqRespB);

  beginPlayback();
}

function beginPlayback() {
  isRunning = true;
  currentTime = 0;
  btnStart.innerHTML = '&#9646;&#9646; 정지';
  btnStart.style.background = '#d32f2f';

  let lastTimestamp = null;
  function animate(timestamp) {
    if (!isRunning) return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dtReal = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    currentTime += dtReal * playbackSpeed;

    const maxTime = resultA.time[resultA.time.length - 1];
    if (currentTime >= maxTime) {
      currentTime = maxTime;
      drawFrame();
      stopSimulation();
      return;
    }
    drawFrame();
    animFrame = requestAnimationFrame(animate);
  }
  animFrame = requestAnimationFrame(animate);
}

function stopSimulation() {
  isRunning = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  btnStart.innerHTML = '&#9654; 시작';
  btnStart.style.background = '';
}

function drawFrame() {
  if (!resultA) return;

  const paramsA = configSets.A;
  const stateA = interpolateState(resultA, paramsA, currentTime);
  let stateB = null;
  if (resultB) stateB = interpolateState(resultB, configSets.B, currentTime);

  animRenderer.draw(stateA, stateB, roadFnA, paramsA, currentTime);
  dispRenderer.draw(resultA, resultB, currentTime);
  pitchRenderer.draw(resultA, resultB, currentTime);
  strokeRenderer.draw(resultA, resultB, paramsA, currentTime);
}

function interpolateState(result, params, t) {
  const { time, y1, y2, y3, phi3, u1, u2 } = result;
  const idx = binarySearch(time, t);
  if (idx >= time.length - 1) {
    const i = time.length - 1;
    return { y1: y1[i], y2: y2[i], y3: y3[i], phi3: phi3[i], u1: u1[i], u2: u2[i] };
  }
  const t0 = time[idx], t1 = time[idx + 1];
  const f = (t - t0) / (t1 - t0);
  return {
    y1: y1[idx] + f * (y1[idx + 1] - y1[idx]),
    y2: y2[idx] + f * (y2[idx + 1] - y2[idx]),
    y3: y3[idx] + f * (y3[idx + 1] - y3[idx]),
    phi3: phi3[idx] + f * (phi3[idx + 1] - phi3[idx]),
    u1: u1[idx] + f * (u1[idx + 1] - u1[idx]),
    u2: u2[idx] + f * (u2[idx + 1] - u2[idx])
  };
}

function binarySearch(arr, val) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= val) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── Comfort display ──
function displayComfort(c) {
  comfortEls.cgAcc.textContent = c.rmsAcc.toFixed(3) + ' m/s\u00B2';
  comfortEls.pitchAcc.textContent = c.rmsPitchAcc.toFixed(3) + ' rad/s\u00B2';
  comfortEls.rattleF.textContent = (c.rmsFrontRattle * 1000).toFixed(1) + ' mm (max ' + (c.maxFrontRattle * 1000).toFixed(1) + ')';
  comfortEls.rattleR.textContent = (c.rmsRearRattle * 1000).toFixed(1) + ' mm (max ' + (c.maxRearRattle * 1000).toFixed(1) + ')';
  comfortEls.tireF.textContent = (c.rmsFrontTireDef * 1000).toFixed(1) + ' mm (max ' + (c.maxFrontTireDef * 1000).toFixed(1) + ')';
  comfortEls.tireR.textContent = (c.rmsRearTireDef * 1000).toFixed(1) + ' mm (max ' + (c.maxRearTireDef * 1000).toFixed(1) + ')';

  setComfortColor(comfortEls.cgAcc, c.rmsAcc, [0.315, 0.63]);
  setComfortColor(comfortEls.pitchAcc, c.rmsPitchAcc, [0.5, 1.0]);
  setComfortColor(comfortEls.rattleF, c.maxFrontRattle * 1000, [30, 60]);
  setComfortColor(comfortEls.rattleR, c.maxRearRattle * 1000, [30, 60]);
  setComfortColor(comfortEls.tireF, c.maxFrontTireDef * 1000, [10, 25]);
  setComfortColor(comfortEls.tireR, c.maxRearTireDef * 1000, [10, 25]);
}

function setComfortColor(el, value, [warn, bad]) {
  el.classList.remove('comfort-good', 'comfort-warn', 'comfort-bad');
  if (value < warn) el.classList.add('comfort-good');
  else if (value < bad) el.classList.add('comfort-warn');
  else el.classList.add('comfort-bad');
}

function clearComfort() {
  for (const el of Object.values(comfortEls)) {
    el.textContent = '-';
    el.classList.remove('comfort-good', 'comfort-warn', 'comfort-bad');
  }
}

// ── Idle state ──
function drawIdle() {
  animRenderer.resize();
  dispRenderer.resize();
  pitchRenderer.resize();
  strokeRenderer.resize();
  freqRenderer.resize();

  const ctx = animRenderer.ctx;
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, animRenderer.w, animRenderer.h);
  ctx.fillStyle = '#555';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('파라미터를 설정하고 [시작] 버튼을 누르세요', animRenderer.w / 2, animRenderer.h / 2);

  for (const r of [dispRenderer, pitchRenderer, strokeRenderer, freqRenderer]) {
    r.ctx.fillStyle = '#1a1a1a';
    r.ctx.fillRect(0, 0, r.w, r.h);
  }
}

// ── Resize ──
window.addEventListener('resize', () => {
  animRenderer.resize();
  dispRenderer.resize();
  pitchRenderer.resize();
  strokeRenderer.resize();
  freqRenderer.resize();
  if (resultA && !isRunning) {
    drawFrame();
    freqRenderer.draw(freqRespA, freqRespB);
  } else if (!resultA) {
    drawIdle();
  }
});

// ── Tooltip hover ──
document.querySelectorAll('.has-tooltip').forEach(el => {
  const tipId = el.dataset.tooltip;
  const tip = document.getElementById('tip-' + tipId);
  if (!tip) return;
  el.addEventListener('mouseenter', () => { tip.style.display = 'block'; });
  el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
});

// ── Init ──
updateDerived();
requestAnimationFrame(() => drawIdle());
