// main.js — State management, UI events, animation loop

import { inverseKinematics, isReachable, workspaceBoundary } from './kinematics.js';
import { generateAllPaths } from './pathPlanning.js';
import { ArmRenderer } from './renderer.js';
import { JointSpaceGraph, CartesianGraph } from './graphs.js';

// ── State ──
const state = {
  L1: 150, L2: 120,
  posA: { x: 200, y: 50 },
  posB: { x: -150, y: 180 },
  ikA: null,
  ikB: null,
  workspace: null,
  paths: [],
  selectedPathIndex: 0,
  numPaths: 8,
  enabledStrategies: {
    jointLinear: true, cartesianLinear: true, viaPoint: true,
    elbowSwitch: true, cubicPoly: true, circularArc: true
  },
  isPlaying: false,
  animProgress: 0,
  animSpeed: 1.0,
  dragging: null,
  jointLimitsEnabled: false,
  jointLimits: {
    t1min: -135, t1max: 135,
    t2min: -150, t2max: 150
  }
};

// ── DOM Elements ──
const sliders = {};
const vals = {};
const SLIDER_KEYS = ['L1', 'L2', 'xA', 'yA', 'xB', 'yB', 'numPaths', 'speed', 't1min', 't1max', 't2min', 't2max'];

SLIDER_KEYS.forEach(key => {
  sliders[key] = document.getElementById(`param-${key}`);
  vals[key] = document.querySelector(`[data-val-${key}]`);
});

const btnExplore = document.getElementById('btn-explore');
const btnReset = document.getElementById('btn-reset');
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const warningMsg = document.getElementById('warning-msg');
const pathListContainer = document.getElementById('path-list-container');

// Result display
const resStrategy = document.getElementById('res-strategy');
const resJointTravel = document.getElementById('res-joint-travel');
const resCartesianLen = document.getElementById('res-cartesian-len');
const resSmoothness = document.getElementById('res-smoothness');
const resCost = document.getElementById('res-cost');
const resRank = document.getElementById('res-rank');
const resLimitStatus = document.getElementById('res-limit-status');
const cbJointLimits = document.getElementById('cb-joint-limits');
const jointLimitsGroup = document.getElementById('joint-limits-group');

// ── Renderers ──
const armRenderer = new ArmRenderer(document.getElementById('anim-canvas'));
const jointGraph = new JointSpaceGraph(document.getElementById('graph-joint'));
const cartesianGraph = new CartesianGraph(document.getElementById('graph-cartesian'));

// ── Helpers ──
function updateSliderDisplay(key, value) {
  if (vals[key]) vals[key].textContent = typeof value === 'number' && !Number.isInteger(value)
    ? value.toFixed(1) : value;
}

function syncSlidersFromState() {
  sliders.L1.value = state.L1; updateSliderDisplay('L1', state.L1);
  sliders.L2.value = state.L2; updateSliderDisplay('L2', state.L2);
  sliders.xA.value = state.posA.x; updateSliderDisplay('xA', state.posA.x);
  sliders.yA.value = state.posA.y; updateSliderDisplay('yA', state.posA.y);
  sliders.xB.value = state.posB.x; updateSliderDisplay('xB', state.posB.x);
  sliders.yB.value = state.posB.y; updateSliderDisplay('yB', state.posB.y);
  sliders.numPaths.value = state.numPaths; updateSliderDisplay('numPaths', state.numPaths);
  sliders.speed.value = state.animSpeed; updateSliderDisplay('speed', state.animSpeed);
  sliders.t1min.value = state.jointLimits.t1min; updateSliderDisplay('t1min', state.jointLimits.t1min);
  sliders.t1max.value = state.jointLimits.t1max; updateSliderDisplay('t1max', state.jointLimits.t1max);
  sliders.t2min.value = state.jointLimits.t2min; updateSliderDisplay('t2min', state.jointLimits.t2min);
  sliders.t2max.value = state.jointLimits.t2max; updateSliderDisplay('t2max', state.jointLimits.t2max);
  cbJointLimits.checked = state.jointLimitsEnabled;
  jointLimitsGroup.className = state.jointLimitsEnabled ? 'joint-limits-visible' : 'joint-limits-hidden';
}

function getJointLimitsRad() {
  if (!state.jointLimitsEnabled) return null;
  const D = Math.PI / 180;
  return {
    t1min: state.jointLimits.t1min * D,
    t1max: state.jointLimits.t1max * D,
    t2min: state.jointLimits.t2min * D,
    t2max: state.jointLimits.t2max * D
  };
}

function computeIK() {
  const reachA = isReachable(state.posA.x, state.posA.y, state.L1, state.L2);
  const reachB = isReachable(state.posB.x, state.posB.y, state.L1, state.L2);

  let warning = '';
  if (!reachA) warning += 'Position A is unreachable. ';
  if (!reachB) warning += 'Position B is unreachable. ';

  warningMsg.textContent = warning;
  warningMsg.classList.toggle('visible', warning.length > 0);
  btnExplore.disabled = warning.length > 0;

  state.ikA = reachA ? inverseKinematics(state.posA.x, state.posA.y, state.L1, state.L2)?.elbowUp : null;
  state.ikB = reachB ? inverseKinematics(state.posB.x, state.posB.y, state.L1, state.L2)?.elbowUp : null;
  state.workspace = workspaceBoundary(state.L1, state.L2);
}

function updateResults() {
  const path = state.paths[state.selectedPathIndex];
  if (!path) {
    resStrategy.textContent = '-';
    resJointTravel.textContent = '-';
    resCartesianLen.textContent = '-';
    resSmoothness.textContent = '-';
    resCost.textContent = '-';
    resRank.textContent = '-';
    resLimitStatus.textContent = '-';
    resLimitStatus.className = 'result-value';
    return;
  }
  resStrategy.textContent = path.name;
  resJointTravel.textContent = path.jointTravel.toFixed(2) + ' rad';
  resCartesianLen.textContent = path.cartesianLen.toFixed(1) + ' px';
  resSmoothness.textContent = path.smoothness.toFixed(3);
  resCost.textContent = path.cost.toFixed(2);
  resRank.textContent = `${path.rank} / ${state.paths.length}`;
  if (path.limitViolation) {
    resLimitStatus.textContent = 'VIOLATION';
    resLimitStatus.className = 'result-value limit-violation';
  } else {
    resLimitStatus.textContent = state.jointLimitsEnabled ? 'OK' : '-';
    resLimitStatus.className = 'result-value' + (state.jointLimitsEnabled ? ' limit-ok' : '');
  }
}

function buildPathList() {
  pathListContainer.innerHTML = '';
  state.paths.forEach((path, i) => {
    const item = document.createElement('div');
    item.className = 'path-item' + (i === state.selectedPathIndex ? ' selected' : '');
    const violation = path.limitViolation ? ' <span style="color:#ff6b6b;font-size:10px;">✗</span>' : '';
    item.innerHTML = `
      <span class="path-color-dot" style="background:${path.color}"></span>
      <span class="path-name">${path.name}${violation}</span>
      <span class="path-cost">${path.cost.toFixed(1)}</span>
      ${path.rank === 1 ? '<span class="path-optimal">★</span>' : ''}
    `;
    item.addEventListener('click', () => {
      state.selectedPathIndex = i;
      state.animProgress = 0;
      updateResults();
      buildPathList();
      redraw();
    });
    pathListContainer.appendChild(item);
  });
}

function redraw() {
  armRenderer.draw(state);
  jointGraph.draw(state);
  cartesianGraph.draw(state);
}

// ── Slider Events ──
sliders.L1.addEventListener('input', () => {
  state.L1 = +sliders.L1.value;
  updateSliderDisplay('L1', state.L1);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.L2.addEventListener('input', () => {
  state.L2 = +sliders.L2.value;
  updateSliderDisplay('L2', state.L2);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.xA.addEventListener('input', () => {
  state.posA.x = +sliders.xA.value;
  updateSliderDisplay('xA', state.posA.x);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.yA.addEventListener('input', () => {
  state.posA.y = +sliders.yA.value;
  updateSliderDisplay('yA', state.posA.y);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.xB.addEventListener('input', () => {
  state.posB.x = +sliders.xB.value;
  updateSliderDisplay('xB', state.posB.x);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.yB.addEventListener('input', () => {
  state.posB.y = +sliders.yB.value;
  updateSliderDisplay('yB', state.posB.y);
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

sliders.numPaths.addEventListener('input', () => {
  state.numPaths = +sliders.numPaths.value;
  updateSliderDisplay('numPaths', state.numPaths);
});

sliders.speed.addEventListener('input', () => {
  state.animSpeed = +sliders.speed.value;
  updateSliderDisplay('speed', state.animSpeed);
});

// Joint limit sliders
const LIMIT_KEYS = ['t1min', 't1max', 't2min', 't2max'];
LIMIT_KEYS.forEach(key => {
  sliders[key].addEventListener('input', () => {
    state.jointLimits[key] = +sliders[key].value;
    updateSliderDisplay(key, state.jointLimits[key]);
    // Enforce min <= max
    if (key === 't1min' && state.jointLimits.t1min > state.jointLimits.t1max) {
      state.jointLimits.t1max = state.jointLimits.t1min;
      sliders.t1max.value = state.jointLimits.t1max;
      updateSliderDisplay('t1max', state.jointLimits.t1max);
    }
    if (key === 't1max' && state.jointLimits.t1max < state.jointLimits.t1min) {
      state.jointLimits.t1min = state.jointLimits.t1max;
      sliders.t1min.value = state.jointLimits.t1min;
      updateSliderDisplay('t1min', state.jointLimits.t1min);
    }
    if (key === 't2min' && state.jointLimits.t2min > state.jointLimits.t2max) {
      state.jointLimits.t2max = state.jointLimits.t2min;
      sliders.t2max.value = state.jointLimits.t2max;
      updateSliderDisplay('t2max', state.jointLimits.t2max);
    }
    if (key === 't2max' && state.jointLimits.t2max < state.jointLimits.t2min) {
      state.jointLimits.t2min = state.jointLimits.t2max;
      sliders.t2min.value = state.jointLimits.t2min;
      updateSliderDisplay('t2min', state.jointLimits.t2min);
    }
    state.paths = [];
    buildPathList();
    updateResults();
    redraw();
  });
});

cbJointLimits.addEventListener('change', () => {
  state.jointLimitsEnabled = cbJointLimits.checked;
  jointLimitsGroup.className = state.jointLimitsEnabled ? 'joint-limits-visible' : 'joint-limits-hidden';
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

// Strategy checkboxes
document.querySelectorAll('[data-strategy]').forEach(cb => {
  cb.addEventListener('change', () => {
    state.enabledStrategies[cb.dataset.strategy] = cb.checked;
  });
});

// ── Buttons ──
btnExplore.addEventListener('click', () => {
  state.paths = generateAllPaths(state.posA, state.posB, state.L1, state.L2, state.numPaths, state.enabledStrategies, getJointLimitsRad());
  state.selectedPathIndex = 0;
  state.animProgress = 0;
  state.isPlaying = false;
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  updateResults();
  buildPathList();
  redraw();
});

btnReset.addEventListener('click', () => {
  state.L1 = 150; state.L2 = 120;
  state.posA = { x: 200, y: 50 };
  state.posB = { x: -150, y: 180 };
  state.paths = [];
  state.selectedPathIndex = 0;
  state.isPlaying = false;
  state.animProgress = 0;
  state.animSpeed = 1.0;
  state.numPaths = 8;
  state.jointLimitsEnabled = false;
  state.jointLimits = { t1min: -135, t1max: 135, t2min: -150, t2max: 150 };
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  syncSlidersFromState();
  computeIK();
  updateResults();
  buildPathList();
  redraw();
});

btnPlay.addEventListener('click', () => {
  if (state.paths.length === 0) return;
  state.isPlaying = !state.isPlaying;
  if (state.isPlaying) {
    state.animProgress = 0;
    btnPlay.textContent = '■ Stop';
    btnPlay.classList.add('playing');
  } else {
    btnPlay.textContent = '▶ Play';
    btnPlay.classList.remove('playing');
  }
});

btnPrev.addEventListener('click', () => {
  if (state.paths.length === 0) return;
  state.selectedPathIndex = (state.selectedPathIndex - 1 + state.paths.length) % state.paths.length;
  state.animProgress = 0;
  updateResults();
  buildPathList();
  redraw();
});

btnNext.addEventListener('click', () => {
  if (state.paths.length === 0) return;
  state.selectedPathIndex = (state.selectedPathIndex + 1) % state.paths.length;
  state.animProgress = 0;
  updateResults();
  buildPathList();
  redraw();
});

// ── Canvas Dragging ──
const canvas = document.getElementById('anim-canvas');

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  if (armRenderer.hitTestMarker(cx, cy, state.posA)) {
    state.dragging = 'A';
  } else if (armRenderer.hitTestMarker(cx, cy, state.posB)) {
    state.dragging = 'B';
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // Cursor styling
  if (!state.dragging) {
    const overA = armRenderer.hitTestMarker(cx, cy, state.posA);
    const overB = armRenderer.hitTestMarker(cx, cy, state.posB);
    canvas.style.cursor = (overA || overB) ? 'grab' : 'default';
  }

  if (!state.dragging) return;
  canvas.style.cursor = 'grabbing';

  const wx = Math.round(armRenderer.toWorldX(cx) / 5) * 5;
  const wy = Math.round(armRenderer.toWorldY(cy) / 5) * 5;

  if (state.dragging === 'A') {
    state.posA.x = Math.max(-400, Math.min(400, wx));
    state.posA.y = Math.max(-400, Math.min(400, wy));
  } else {
    state.posB.x = Math.max(-400, Math.min(400, wx));
    state.posB.y = Math.max(-400, Math.min(400, wy));
  }

  syncSlidersFromState();
  computeIK();
  state.paths = [];
  buildPathList();
  updateResults();
  redraw();
});

canvas.addEventListener('mouseup', () => { state.dragging = null; });
canvas.addEventListener('mouseleave', () => { state.dragging = null; });

// ── Animation Loop ──
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);

  if (state.isPlaying && state.paths.length > 0) {
    const dt = lastTime ? (time - lastTime) / 1000 : 0;
    state.animProgress += dt * state.animSpeed * 0.5;
    if (state.animProgress >= 1) {
      state.animProgress = 1;
      state.isPlaying = false;
      btnPlay.textContent = '▶ Play';
      btnPlay.classList.remove('playing');
    }
    redraw();
  }
  lastTime = time;
}

// ── Resize ──
window.addEventListener('resize', () => {
  armRenderer.resize();
  jointGraph.resize();
  cartesianGraph.resize();
  redraw();
});

// ── Init ──
computeIK();
syncSlidersFromState();
redraw();
requestAnimationFrame(animate);
