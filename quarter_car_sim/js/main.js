import { runSimulation, computeComfort, computeDerived, computeFrequencyResponse } from './simulation.js';
import { createRoadProfile } from './road.js';
import { AnimationRenderer } from './animation.js';
import { GraphRenderer, FreqResponseRenderer, ForceGraphRenderer } from './graphs.js';

// ── State ──
const configSets = {
  A: { ms: 250, mu: 35, ks: 15000, cs: 1500, kt: 150000 },
  B: { ms: 250, mu: 35, ks: 15000, cs: 1500, kt: 150000 }
};

let activeSet = 'A';
let compareMode = false;
let isRunning = false;
let animFrame = null;
let currentTime = 0;
let playbackSpeed = 1;

let resultA = null;
let resultB = null;
let roadFnA = null;
let roadFnB = null;
let freqRespA = null;
let freqRespB = null;

// Loaded JSON state
let loadedData = null;
let activeForceData = null; // u(t) from loaded JSON

// Presets
const PRESETS = {
  sedan:  { ms: 250, mu: 35, ks: 15000, cs: 1500, kt: 150000 },
  suv:    { ms: 350, mu: 45, ks: 20000, cs: 2000, kt: 180000 },
  racing: { ms: 180, mu: 25, ks: 35000, cs: 3000, kt: 200000 },
  custom: null
};

// ── DOM ──
const presetSelect = document.getElementById('preset-select');
const configTabs = document.querySelectorAll('.config-tab');
const compareToggle = document.getElementById('compare-toggle');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');

const sliders = {
  ms: document.getElementById('param-ms'),
  mu: document.getElementById('param-mu'),
  ks: document.getElementById('param-ks'),
  cs: document.getElementById('param-cs'),
  kt: document.getElementById('param-kt')
};

const vals = {
  ms: document.getElementById('val-ms'),
  mu: document.getElementById('val-mu'),
  ks: document.getElementById('val-ks'),
  cs: document.getElementById('val-cs'),
  kt: document.getElementById('val-kt')
};

const dampingRatioEl = document.getElementById('damping-ratio');
const naturalFreqEl = document.getElementById('natural-freq');

const roadSelect = document.getElementById('road-select');
const roadHSlider = document.getElementById('param-road-h');
const roadHVal = document.getElementById('val-road-h');
const speedSlider = document.getElementById('param-speed');
const speedVal = document.getElementById('val-speed');

// Comfort
const comfortEls = {
  sprungAcc: document.getElementById('comfort-sprung-acc'),
  rattle: document.getElementById('comfort-rattle'),
  tireDef: document.getElementById('comfort-tire-def')
};

// Compare legend
const compareLegends = document.querySelectorAll('.compare-legend');

// Load JSON
const btnLoadJson = document.getElementById('btn-load-json');
const jsonFileInput = document.getElementById('json-file-input');
const loadedInfo = document.getElementById('loaded-info');
const loadedLabel = document.getElementById('loaded-label');
const btnClearLoaded = document.getElementById('btn-clear-loaded');

// Force graph container
const forceContainer = document.getElementById('force-container');

// Python controller
const pythonToggle = document.getElementById('python-toggle');
const pythonStatus = document.getElementById('python-status');
let pythonMode = false;
const PYTHON_URL = 'http://localhost:8000/simulate';

// ── Canvas setup ──
const animCanvas = document.getElementById('anim-canvas');
const graphCanvas = document.getElementById('graph-canvas');
const freqCanvas = document.getElementById('freq-canvas');
const forceCanvas = document.getElementById('force-canvas');
const animRenderer = new AnimationRenderer(animCanvas);
const graphRenderer = new GraphRenderer(graphCanvas);
const freqRenderer = new FreqResponseRenderer(freqCanvas);
const forceRenderer = new ForceGraphRenderer(forceCanvas);

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
  for (const key of Object.keys(sliders)) {
    configSets[set][key] = parseFloat(sliders[key].value);
  }
}

function loadSetToSliders(set) {
  const params = configSets[set];
  for (const key of Object.keys(sliders)) {
    sliders[key].value = params[key];
    updateValDisplay(key);
  }
  updateDerived();
}

// ── Slider events ──
for (const key of Object.keys(sliders)) {
  sliders[key].addEventListener('input', () => {
    updateValDisplay(key);
    configSets[activeSet][key] = parseFloat(sliders[key].value);
    updateDerived();
    presetSelect.value = 'custom';
  });
}

function updateValDisplay(key) {
  vals[key].textContent = parseFloat(sliders[key].value).toFixed(0);
}

function updateDerived() {
  const params = configSets[activeSet];
  const { fn, zeta } = computeDerived(params);
  dampingRatioEl.textContent = zeta.toFixed(3);
  naturalFreqEl.textContent = fn.toFixed(1);

  if (zeta < 0.2) dampingRatioEl.style.color = '#ef5350';
  else if (zeta < 0.5) dampingRatioEl.style.color = '#81c784';
  else if (zeta < 0.8) dampingRatioEl.style.color = '#ffb74d';
  else dampingRatioEl.style.color = '#ef5350';
}

// Road sliders
roadHSlider.addEventListener('input', () => {
  roadHVal.textContent = parseFloat(roadHSlider.value).toFixed(3);
});
speedSlider.addEventListener('input', () => {
  speedVal.textContent = parseFloat(speedSlider.value).toFixed(0);
});

// ── Preset ──
presetSelect.addEventListener('change', () => {
  const preset = PRESETS[presetSelect.value];
  if (!preset) return;
  configSets[activeSet] = { ...preset };
  loadSetToSliders(activeSet);
});

// ── Compare mode ──
compareToggle.addEventListener('change', () => {
  compareMode = compareToggle.checked;
  compareLegends.forEach(el => {
    el.classList.toggle('visible', compareMode);
  });
});

// ── Python controller toggle ──
pythonToggle.addEventListener('change', () => {
  pythonMode = pythonToggle.checked;
  if (pythonMode) {
    pythonStatus.textContent = 'server.py를 실행하세요';
    pythonStatus.className = 'server-status disconnected';
  } else {
    pythonStatus.textContent = '';
    pythonStatus.className = 'server-status';
  }
});

// ── Road height display ──
roadHVal.textContent = parseFloat(roadHSlider.value).toFixed(3);

// ── Start / Reset ──
btnStart.addEventListener('click', () => {
  if (isRunning) stopSimulation();
  else startSimulation();
});

btnReset.addEventListener('click', () => {
  stopSimulation();
  resultA = null;
  resultB = null;
  freqRespA = null;
  freqRespB = null;
  activeForceData = null;
  currentTime = 0;
  clearComfort();
  hideForceGraph();
  drawIdle();
});

function startSimulation() {
  saveCurrentToSet(activeSet);

  const roadType = roadSelect.value;
  const roadH = parseFloat(roadHSlider.value);
  const speedKmh = parseFloat(speedSlider.value);
  const speedMs = speedKmh / 3.6;
  const duration = 4.0;

  // If loaded JSON data exists, use it
  if (loadedData) {
    startFromLoadedData();
    return;
  }

  // If Python controller mode, delegate to server
  if (pythonMode) {
    startFromPythonServer(roadType, roadH, speedMs, duration);
    return;
  }

  // Run simulation A
  const paramsA = { ...configSets.A };
  roadFnA = createRoadProfile(roadType, roadH, speedMs);
  resultA = runSimulation(paramsA, roadFnA, duration);
  const comfortA = computeComfort(resultA, paramsA);
  displayComfort(comfortA);

  freqRespA = computeFrequencyResponse(paramsA);

  // Run simulation B if compare mode
  if (compareMode) {
    const paramsB = { ...configSets.B };
    roadFnB = createRoadProfile(roadType, roadH, speedMs);
    resultB = runSimulation(paramsB, roadFnB, duration);
    freqRespB = computeFrequencyResponse(paramsB);
  } else {
    resultB = null;
    freqRespB = null;
  }

  activeForceData = null;
  hideForceGraph();

  freqRenderer.resize();
  freqRenderer.draw(freqRespA, freqRespB);

  beginPlayback();
}

/**
 * Send road profile to Python server, receive passive+active results
 */
async function startFromPythonServer(roadType, roadH, speedMs, duration) {
  const paramsA = { ...configSets.A };

  // Generate road profile as time series to send to Python
  roadFnA = createRoadProfile(roadType, roadH, speedMs);
  const dt = 0.001; // road sampling interval
  const numPts = Math.ceil(duration / dt);
  const roadTime = [];
  const roadZr = [];
  for (let i = 0; i <= numPts; i++) {
    const t = i * dt;
    roadTime.push(Math.round(t * 1e6) / 1e6);
    roadZr.push(roadFnA(t));
  }

  pythonStatus.textContent = 'Simulating...';
  pythonStatus.className = 'server-status loading';
  btnStart.disabled = true;

  try {
    const resp = await fetch(PYTHON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: paramsA,
        road_time: roadTime,
        road_zr: roadZr,
        duration: duration,
        dt: 0.0005,
      }),
    });

    if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

    const data = await resp.json();

    pythonStatus.textContent = data.controller || 'Connected';
    pythonStatus.className = 'server-status connected';

    // Passive → Set A
    resultA = {
      time: data.passive.time,
      zs: data.passive.zs, zu: data.passive.zu,
      zr: data.passive.zr, ddzs: data.passive.ddzs,
    };

    // Active → Set B
    resultB = {
      time: data.active.time,
      zs: data.active.zs, zu: data.active.zu,
      zr: data.active.zr, ddzs: data.active.ddzs,
    };

    // Force data
    activeForceData = { time: data.active.time, u: data.active.u };

    // Comfort
    if (data.active.comfort && data.passive.comfort) {
      displayComfortFromLoaded(data.passive.comfort, data.active.comfort);
    }

    // Frequency response
    freqRespA = computeFrequencyResponse(paramsA);
    freqRespB = null;
    freqRenderer.resize();
    freqRenderer.draw(freqRespA, freqRespB);

    // Show force graph & compare legends
    showForceGraph();
    forceRenderer.resize();
    compareLegends.forEach(el => el.classList.add('visible'));

    beginPlayback();

  } catch (err) {
    pythonStatus.textContent = 'Connection failed: ' + err.message;
    pythonStatus.className = 'server-status disconnected';
  } finally {
    btnStart.disabled = false;
  }
}

function startFromLoadedData() {
  const d = loadedData;

  // Passive → Set A
  resultA = {
    time: d.passive.time,
    zs: d.passive.zs,
    zu: d.passive.zu,
    zr: d.passive.zr,
    ddzs: d.passive.ddzs,
  };

  // Active → Set B
  resultB = {
    time: d.active.time,
    zs: d.active.zs,
    zu: d.active.zu,
    zr: d.active.zr,
    ddzs: d.active.ddzs,
  };

  // Road function from passive data (for animation)
  const zrData = d.passive.zr;
  const timeData = d.passive.time;
  roadFnA = (t) => {
    const idx = binarySearch(timeData, t);
    if (idx >= timeData.length - 1) return zrData[zrData.length - 1];
    const frac = (t - timeData[idx]) / (timeData[idx + 1] - timeData[idx]);
    return zrData[idx] + frac * (zrData[idx + 1] - zrData[idx]);
  };

  // Actuator force data
  activeForceData = { time: d.active.time, u: d.active.u };

  // Display comfort from loaded data
  if (d.active.comfort) {
    displayComfortFromLoaded(d.passive.comfort, d.active.comfort);
  }

  // Frequency response
  const params = d.params;
  freqRespA = computeFrequencyResponse(params);
  freqRespB = null;
  freqRenderer.resize();
  freqRenderer.draw(freqRespA, freqRespB);

  // Show force graph
  showForceGraph();
  forceRenderer.resize();

  // Enable compare visuals
  compareLegends.forEach(el => el.classList.add('visible'));

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
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  btnStart.innerHTML = '&#9654; 시작';
  btnStart.style.background = '';
}

function drawFrame() {
  if (!resultA) return;

  const speedMs = parseFloat(speedSlider.value) / 3.6;

  const stateA = interpolateState(resultA, currentTime);
  let stateB = null;
  if (resultB) {
    stateB = interpolateState(resultB, currentTime);
  }

  // Determine labels: show Passive/Active when active control data exists
  const hasActiveControl = activeForceData !== null;
  const labelA = hasActiveControl ? 'Passive' : 'A';
  const labelB = hasActiveControl ? 'Active' : 'B';

  animRenderer.draw(
    { ...stateA, t: currentTime },
    stateB ? { ...stateB, t: currentTime } : null,
    roadFnA,
    speedMs,
    labelA,
    labelB
  );

  graphRenderer.draw(resultA, resultB, currentTime);

  // Draw force graph if active data exists
  if (activeForceData) {
    forceRenderer.draw(activeForceData.time, activeForceData.u, currentTime);
  }
}

function interpolateState(result, t) {
  const { time, zs, zu, zr } = result;
  const idx = binarySearch(time, t);
  if (idx >= time.length - 1) {
    return { zs: zs[time.length - 1], zu: zu[time.length - 1], zr: zr[time.length - 1] };
  }
  const t0 = time[idx], t1 = time[idx + 1];
  const frac = (t - t0) / (t1 - t0);
  return {
    zs: zs[idx] + frac * (zs[idx + 1] - zs[idx]),
    zu: zu[idx] + frac * (zu[idx + 1] - zu[idx]),
    zr: zr[idx] + frac * (zr[idx + 1] - zr[idx])
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

// ── Force graph show/hide ──
function showForceGraph() {
  forceContainer.style.display = '';
}

function hideForceGraph() {
  forceContainer.style.display = 'none';
}

// ── Comfort display ──
function displayComfort(comfort) {
  comfortEls.sprungAcc.textContent = comfort.rmsAcc.toFixed(3) + ' m/s\u00B2';
  comfortEls.rattle.textContent = (comfort.rmsRattle * 1000).toFixed(2) + ' mm (max ' + (comfort.maxRattle * 1000).toFixed(1) + ')';
  comfortEls.tireDef.textContent = (comfort.rmsTireDef * 1000).toFixed(2) + ' mm (max ' + (comfort.maxTireDef * 1000).toFixed(1) + ')';

  setComfortColor(comfortEls.sprungAcc, comfort.rmsAcc, [0.315, 0.63]);
  setComfortColor(comfortEls.rattle, comfort.maxRattle * 1000, [30, 60]);
  setComfortColor(comfortEls.tireDef, comfort.maxTireDef * 1000, [10, 25]);
}

function displayComfortFromLoaded(passiveC, activeC) {
  // Show active comfort with comparison to passive
  const acc = activeC.rmsAcc;
  const accImp = passiveC.rmsAcc > 0 ? ((1 - acc / passiveC.rmsAcc) * 100) : 0;
  comfortEls.sprungAcc.innerHTML = acc.toFixed(3) + ' m/s\u00B2 <small style="color:#81c784">(' + (accImp >= 0 ? '-' : '+') + Math.abs(accImp).toFixed(0) + '%)</small>';

  const rat = activeC.maxRattle * 1000;
  comfortEls.rattle.textContent = (activeC.rmsRattle * 1000).toFixed(2) + ' mm (max ' + rat.toFixed(1) + ')';

  const td = activeC.maxTireDef * 1000;
  comfortEls.tireDef.textContent = (activeC.rmsTireDef * 1000).toFixed(2) + ' mm (max ' + td.toFixed(1) + ')';

  setComfortColor(comfortEls.sprungAcc, acc, [0.315, 0.63]);
  setComfortColor(comfortEls.rattle, rat, [30, 60]);
  setComfortColor(comfortEls.tireDef, td, [10, 25]);
}

function setComfortColor(el, value, [warn, bad]) {
  el.classList.remove('comfort-good', 'comfort-warn', 'comfort-bad');
  if (value < warn) el.classList.add('comfort-good');
  else if (value < bad) el.classList.add('comfort-warn');
  else el.classList.add('comfort-bad');
}

function clearComfort() {
  comfortEls.sprungAcc.textContent = '-';
  comfortEls.rattle.textContent = '-';
  comfortEls.tireDef.textContent = '-';
  for (const el of Object.values(comfortEls)) {
    el.classList.remove('comfort-good', 'comfort-warn', 'comfort-bad');
  }
}

// ── JSON Load ──
btnLoadJson.addEventListener('click', () => jsonFileInput.click());

jsonFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.passive || !data.active) {
        alert('유효하지 않은 JSON 형식입니다.\npassive / active 데이터가 필요합니다.');
        return;
      }
      loadedData = data;
      loadedInfo.style.display = 'flex';
      const ctrl = data.metadata?.controller || 'Unknown';
      loadedLabel.textContent = '\u2705 ' + ctrl;

      // Apply params from JSON to sliders
      if (data.params) {
        configSets.A = { ...data.params };
        loadSetToSliders('A');
      }
      if (data.road) {
        if (data.road.type) roadSelect.value = data.road.type;
        if (data.road.height) {
          roadHSlider.value = data.road.height;
          roadHVal.textContent = data.road.height.toFixed(3);
        }
        if (data.road.speed) {
          const kmh = Math.round(data.road.speed * 3.6);
          speedSlider.value = kmh;
          speedVal.textContent = kmh;
        }
      }
    } catch (err) {
      alert('JSON 파싱 오류: ' + err.message);
    }
  };
  reader.readAsText(file);
  jsonFileInput.value = ''; // reset for re-select
});

btnClearLoaded.addEventListener('click', () => {
  loadedData = null;
  activeForceData = null;
  loadedInfo.style.display = 'none';
  hideForceGraph();
  compareLegends.forEach(el => {
    el.classList.toggle('visible', compareMode);
  });
});

// ── Idle state drawing ──
function drawIdle() {
  animRenderer.resize();
  graphRenderer.resize();
  freqRenderer.resize();

  const ctx = animRenderer.ctx;
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, animRenderer.w, animRenderer.h);
  ctx.fillStyle = '#555';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('파라미터를 설정하고 [시작] 버튼을 누르세요', animRenderer.w / 2, animRenderer.h / 2);

  const gctx = graphRenderer.ctx;
  gctx.fillStyle = '#1a1a1a';
  gctx.fillRect(0, 0, graphRenderer.w, graphRenderer.h);

  const fctx = freqRenderer.ctx;
  fctx.fillStyle = '#1a1a1a';
  fctx.fillRect(0, 0, freqRenderer.w, freqRenderer.h);
}

// ── Resize handling ──
window.addEventListener('resize', () => {
  animRenderer.resize();
  graphRenderer.resize();
  freqRenderer.resize();
  if (activeForceData) forceRenderer.resize();
  if (resultA && !isRunning) {
    drawFrame();
    freqRenderer.draw(freqRespA, freqRespB);
  } else if (!resultA) {
    drawIdle();
  }
});

// ── Tooltip hover logic ──
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
