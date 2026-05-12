// main.js — State management, UI events, animation loop (3D 3-DOF)

import {
  inverseKinematics3D, isReachable3D, workspaceBoundary3D,
  forwardKinematics3D, RAD2DEG, DEG2RAD
} from './kinematics.js';
import { generateAllPaths } from './pathPlanning.js';
import { Renderer3D } from './renderer3d.js';
import { JointSpaceGraph12, JointSpaceGraph23, CartesianTopGraph } from './graphs.js';
import { initHelp } from './help.js';

initHelp();

// ── Default configuration ──
const DEFAULTS = {
  h0: 0.5, L1: 0.7, L2: 0.6,
  posA: { x: 0.7,  y: 0.0,  z: 0.5 },
  posB: { x: -0.4, y: 0.5,  z: 0.9 },
  // 14 paths surfaces all distinct duration tiers (≈6.4 s / 9 s / 12 s / 28 s)
  // that the 6 strategies produce for the default A→B. Going below ~12 hides
  // the longer Via-Point detours and Elbow Switch behind cost-rank cutoffs.
  numPaths: 14,
  jointLimits: { t1min: -180, t1max: 180, t2min: -90, t2max: 135, t3min: -150, t3max: 30 }
};

const state = {
  h0: DEFAULTS.h0, L1: DEFAULTS.L1, L2: DEFAULTS.L2,
  posA: { ...DEFAULTS.posA },
  posB: { ...DEFAULTS.posB },
  ikA: null,
  ikB: null,
  workspace: null,
  paths: [],
  selectedPathIndex: 0,
  numPaths: DEFAULTS.numPaths,
  enabledStrategies: {
    jointLinear: true, cartesianLinear: true, viaPoint: true,
    elbowSwitch: true, cubicPoly: true, circularArc: true
  },
  isPlaying: false,
  animProgress: 0,
  animSpeed: 1.0,
  dragging: null,
  jointLimitsEnabled: false,
  jointLimits: { ...DEFAULTS.jointLimits },
  showWorkspace: true,
  showGrid: true,
  currentPose: { t1: 0, t2: 30 * DEG2RAD, t3: -60 * DEG2RAD }
};

// ── DOM lookups ──
const SLIDER_KEYS = [
  'h0', 'L1', 'L2',
  'xA', 'yA', 'zA', 'xB', 'yB', 'zB',
  'numPaths', 'speed',
  't1min', 't1max', 't2min', 't2max', 't3min', 't3max'
];
const sliders = {}, vals = {};
SLIDER_KEYS.forEach(k => {
  sliders[k] = document.getElementById(`param-${k}`);
  vals[k]    = document.querySelector(`[data-val-${k}]`);
});

const btnExplore = document.getElementById('btn-explore');
const btnReset   = document.getElementById('btn-reset');
const btnPlay    = document.getElementById('btn-play');
const btnPrev    = document.getElementById('btn-prev');
const btnNext    = document.getElementById('btn-next');
const btnExportCsv = document.getElementById('btn-export-csv');
const warningMsg = document.getElementById('warning-msg');
const pathListContainer = document.getElementById('path-list-container');

const cbJointLimits = document.getElementById('cb-joint-limits');
const jointLimitsGroup = document.getElementById('joint-limits-group');
const cbShowWorkspace = document.getElementById('cb-show-workspace');
const cbShowGrid = document.getElementById('cb-show-grid');

const resStrategy = document.getElementById('res-strategy');
const resDuration = document.getElementById('res-duration');
const resWaypoints = document.getElementById('res-waypoints');
const resJointTravel = document.getElementById('res-joint-travel');
const resCartesianLen = document.getElementById('res-cartesian-len');
const resSmoothness = document.getElementById('res-smoothness');
const resCost = document.getElementById('res-cost');
const resRank = document.getElementById('res-rank');
const resLimitStatus = document.getElementById('res-limit-status');
const poseInfo = document.getElementById('pose-info');

// ── Renderers ──
const viewContainer = document.getElementById('view-container');
const renderer3d = new Renderer3D(viewContainer);
const graphT12 = new JointSpaceGraph12(document.getElementById('graph-t12'));
const graphT23 = new JointSpaceGraph23(document.getElementById('graph-t23'));
const graphXY  = new CartesianTopGraph(document.getElementById('graph-xy'));

// ── Helpers ──
function fmt(value) {
  if (typeof value !== 'number') return String(value);
  if (Number.isInteger(value)) return String(value);
  return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function setSlider(key, value) {
  if (sliders[key]) sliders[key].value = value;
  writeDisplay(key, value);
}

function updateSliderDisplay(key, value) {
  writeDisplay(key, value);
}

// Write a value into the display element (either a span or a number input).
// Skip writing while the user is actively editing the input to avoid
// stomping on their typing cursor.
function writeDisplay(key, value) {
  const el = vals[key];
  if (!el) return;
  if (el.tagName === 'INPUT') {
    if (document.activeElement === el) return;
    el.value = fmt(value);
  } else {
    el.textContent = fmt(value);
  }
}

// Wire number-input editors for the 9 arm/position parameters.
// Typing fires `change` (on blur/Enter) and routes through the existing
// slider's `input` handler after clamping to slider min/max.
const NUM_INPUT_KEYS = ['h0', 'L1', 'L2', 'xA', 'yA', 'zA', 'xB', 'yB', 'zB'];
NUM_INPUT_KEYS.forEach(k => {
  const input = vals[k];
  const slider = sliders[k];
  if (!input || input.tagName !== 'INPUT' || !slider) return;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) {
      input.value = fmt(parseFloat(slider.value));
      return;
    }
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    v = Math.min(max, Math.max(min, v));
    slider.value = v;
    slider.dispatchEvent(new Event('input'));
  });
  // Select all on focus for easy overwrite typing
  input.addEventListener('focus', () => input.select());
});

function syncSlidersFromState() {
  setSlider('h0', state.h0);
  setSlider('L1', state.L1);
  setSlider('L2', state.L2);
  setSlider('xA', state.posA.x);
  setSlider('yA', state.posA.y);
  setSlider('zA', state.posA.z);
  setSlider('xB', state.posB.x);
  setSlider('yB', state.posB.y);
  setSlider('zB', state.posB.z);
  setSlider('numPaths', state.numPaths);
  setSlider('speed', state.animSpeed);
  setSlider('t1min', state.jointLimits.t1min);
  setSlider('t1max', state.jointLimits.t1max);
  setSlider('t2min', state.jointLimits.t2min);
  setSlider('t2max', state.jointLimits.t2max);
  setSlider('t3min', state.jointLimits.t3min);
  setSlider('t3max', state.jointLimits.t3max);
  cbJointLimits.checked = state.jointLimitsEnabled;
  jointLimitsGroup.className = state.jointLimitsEnabled ? 'joint-limits-visible' : 'joint-limits-hidden';
  cbShowWorkspace.checked = state.showWorkspace;
  cbShowGrid.checked = state.showGrid;
}

function getJointLimitsRad() {
  if (!state.jointLimitsEnabled) return null;
  const L = state.jointLimits;
  return {
    t1min: L.t1min * DEG2RAD, t1max: L.t1max * DEG2RAD,
    t2min: L.t2min * DEG2RAD, t2max: L.t2max * DEG2RAD,
    t3min: L.t3min * DEG2RAD, t3max: L.t3max * DEG2RAD
  };
}

function computeIK() {
  const reachA = isReachable3D(state.posA.x, state.posA.y, state.posA.z, state.h0, state.L1, state.L2);
  const reachB = isReachable3D(state.posB.x, state.posB.y, state.posB.z, state.h0, state.L1, state.L2);

  let warning = '';
  if (!reachA) warning += 'Position A is unreachable. ';
  if (!reachB) warning += 'Position B is unreachable. ';
  warningMsg.textContent = warning;
  warningMsg.classList.toggle('visible', warning.length > 0);
  btnExplore.disabled = warning.length > 0;

  state.ikA = reachA ? inverseKinematics3D(state.posA.x, state.posA.y, state.posA.z, state.h0, state.L1, state.L2)?.elbowUp : null;
  state.ikB = reachB ? inverseKinematics3D(state.posB.x, state.posB.y, state.posB.z, state.h0, state.L1, state.L2)?.elbowUp : null;
  state.workspace = workspaceBoundary3D(state.h0, state.L1, state.L2);

  // Set current pose from ikA when not animating
  if (!state.isPlaying && state.ikA) {
    state.currentPose = { ...state.ikA };
  }
}

function updateResults() {
  const path = state.paths[state.selectedPathIndex];
  if (!path) {
    resStrategy.textContent = '-';
    resDuration.textContent = '-';
    resWaypoints.textContent = '-';
    resJointTravel.textContent = '-';
    resCartesianLen.textContent = '-';
    resSmoothness.textContent = '-';
    resCost.textContent = '-';
    resRank.textContent = '-';
    resLimitStatus.textContent = '-';
    resLimitStatus.className = 'result-value';
    btnExportCsv.disabled = true;
    return;
  }
  resStrategy.textContent = path.name;
  resDuration.textContent = (path.totalTime ?? 0).toFixed(2) + ' s';
  resWaypoints.textContent = String(path.waypoints.length);
  resJointTravel.textContent = path.jointTravel.toFixed(2) + ' rad';
  resCartesianLen.textContent = path.cartesianLen.toFixed(3) + ' m';
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
  btnExportCsv.disabled = state.paths.length === 0;
}

function updatePoseInfo() {
  const p = state.currentPose;
  if (!p) { poseInfo.textContent = ''; return; }
  const fk = forwardKinematics3D(p.t1, p.t2, p.t3, state.h0, state.L1, state.L2);
  poseInfo.textContent =
    `θ1=${(p.t1 * RAD2DEG).toFixed(1)}°  θ2=${(p.t2 * RAD2DEG).toFixed(1)}°  θ3=${(p.t3 * RAD2DEG).toFixed(1)}°` +
    `   |   P=(${fk.P.x.toFixed(2)}, ${fk.P.y.toFixed(2)}, ${fk.P.z.toFixed(2)}) m`;
}

function buildPathList() {
  pathListContainer.innerHTML = '';
  state.paths.forEach((path, i) => {
    const item = document.createElement('div');
    item.className = 'path-item' + (i === state.selectedPathIndex ? ' selected' : '');
    const violation = path.limitViolation ? ' <span style="color:#ff6b6b;font-size:10px;">✗</span>' : '';
    const dur = (path.totalTime ?? 0).toFixed(1);
    item.innerHTML = `
      <span class="path-color-dot" style="background:${path.color}"></span>
      <span class="path-name">${path.name}${violation}</span>
      <span class="path-duration">${dur}s</span>
      <span class="path-cost">${path.cost.toFixed(2)}</span>
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

function setBoxAttachment() {
  if (!state.isPlaying || state.paths.length === 0) {
    renderer3d.setBoxAttached(false);
    return;
  }
  // Attach the box during the middle 80% of the path.
  const t = state.animProgress;
  renderer3d.setBoxAttached(t > 0.1 && t < 0.9);
}

function redraw() {
  renderer3d.setShowGrid(state.showGrid);
  renderer3d.setShowWorkspace(state.showWorkspace, state.h0, state.L1, state.L2);
  renderer3d.setMarkers(state.posA, state.posB, state.h0);
  renderer3d.setPaths(state.paths, state.selectedPathIndex, state.h0, state.L1, state.L2);
  renderer3d.setRobotPose(state);
  setBoxAttachment();
  graphT12.draw(state);
  graphT23.draw(state);
  graphXY.draw(state);
  updatePoseInfo();
}

function invalidatePathsAndRedraw() {
  computeIK();
  state.paths = [];
  state.selectedPathIndex = 0;
  state.isPlaying = false;
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  buildPathList();
  updateResults();
  redraw();
}

// Arm parameters
sliders.h0.addEventListener('input', () => {
  state.h0 = +sliders.h0.value;
  updateSliderDisplay('h0', state.h0);
  invalidatePathsAndRedraw();
});
sliders.L1.addEventListener('input', () => {
  state.L1 = +sliders.L1.value;
  updateSliderDisplay('L1', state.L1);
  invalidatePathsAndRedraw();
});
sliders.L2.addEventListener('input', () => {
  state.L2 = +sliders.L2.value;
  updateSliderDisplay('L2', state.L2);
  invalidatePathsAndRedraw();
});

// Positions
function bindPosSlider(key, posKey, axis) {
  sliders[key].addEventListener('input', () => {
    state[posKey][axis] = +sliders[key].value;
    updateSliderDisplay(key, state[posKey][axis]);
    invalidatePathsAndRedraw();
  });
}
bindPosSlider('xA', 'posA', 'x');
bindPosSlider('yA', 'posA', 'y');
bindPosSlider('zA', 'posA', 'z');
bindPosSlider('xB', 'posB', 'x');
bindPosSlider('yB', 'posB', 'y');
bindPosSlider('zB', 'posB', 'z');

// Path planning controls
sliders.numPaths.addEventListener('input', () => {
  state.numPaths = +sliders.numPaths.value;
  updateSliderDisplay('numPaths', state.numPaths);
});
sliders.speed.addEventListener('input', () => {
  state.animSpeed = +sliders.speed.value;
  updateSliderDisplay('speed', state.animSpeed);
});

// Joint limit sliders + min/max enforcement
const LIMIT_PAIRS = [
  ['t1min', 't1max'],
  ['t2min', 't2max'],
  ['t3min', 't3max']
];
function bindLimit(key) {
  sliders[key].addEventListener('input', () => {
    state.jointLimits[key] = +sliders[key].value;
    updateSliderDisplay(key, state.jointLimits[key]);

    LIMIT_PAIRS.forEach(([mn, mx]) => {
      if (state.jointLimits[mn] > state.jointLimits[mx]) {
        if (key === mn) {
          state.jointLimits[mx] = state.jointLimits[mn];
          setSlider(mx, state.jointLimits[mx]);
        } else {
          state.jointLimits[mn] = state.jointLimits[mx];
          setSlider(mn, state.jointLimits[mn]);
        }
      }
    });
    invalidatePathsAndRedraw();
  });
}
['t1min', 't1max', 't2min', 't2max', 't3min', 't3max'].forEach(bindLimit);

cbJointLimits.addEventListener('change', () => {
  state.jointLimitsEnabled = cbJointLimits.checked;
  jointLimitsGroup.className = state.jointLimitsEnabled ? 'joint-limits-visible' : 'joint-limits-hidden';
  invalidatePathsAndRedraw();
});

cbShowWorkspace.addEventListener('change', () => {
  state.showWorkspace = cbShowWorkspace.checked;
  redraw();
});
cbShowGrid.addEventListener('change', () => {
  state.showGrid = cbShowGrid.checked;
  redraw();
});

// Strategy checkboxes
document.querySelectorAll('[data-strategy]').forEach(cb => {
  cb.addEventListener('change', () => {
    state.enabledStrategies[cb.dataset.strategy] = cb.checked;
  });
});

// Camera presets
document.querySelectorAll('[data-camera]').forEach(btn => {
  btn.addEventListener('click', () => {
    renderer3d.cameraPreset(btn.dataset.camera, state.h0, state.h0 + state.L1 + state.L2);
  });
});

// ── Buttons ──
btnExplore.addEventListener('click', () => {
  state.paths = generateAllPaths(
    state.posA, state.posB,
    state.h0, state.L1, state.L2,
    state.numPaths, state.enabledStrategies, getJointLimitsRad()
  );
  state.selectedPathIndex = 0;
  state.animProgress = 0;
  state.isPlaying = false;
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  if (state.ikA) state.currentPose = { ...state.ikA };
  updateResults();
  buildPathList();
  redraw();
});

btnReset.addEventListener('click', () => {
  state.h0 = DEFAULTS.h0; state.L1 = DEFAULTS.L1; state.L2 = DEFAULTS.L2;
  state.posA = { ...DEFAULTS.posA };
  state.posB = { ...DEFAULTS.posB };
  state.paths = [];
  state.selectedPathIndex = 0;
  state.isPlaying = false;
  state.animProgress = 0;
  state.animSpeed = 1.0;
  state.numPaths = DEFAULTS.numPaths;
  state.jointLimitsEnabled = false;
  state.jointLimits = { ...DEFAULTS.jointLimits };
  state.showWorkspace = true;
  state.showGrid = true;
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  syncSlidersFromState();
  computeIK();
  renderer3d.cameraPreset('iso', state.h0, state.h0 + state.L1 + state.L2);
  buildPathList();
  updateResults();
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

function exportSelectedPathAsCsv() {
  const path = state.paths[state.selectedPathIndex];
  if (!path) return;

  // Each waypoint is dt=0.01s apart; total time comes from the timing policy
  // (max(|Δθ_i|) / 20°/s). The animation speed slider does not affect CSV time.
  const totalTime = path.totalTime || (path.waypoints.length - 1) * 0.01;
  const header = [
    't', 'time_s',
    't1_rad', 't1_deg', 't2_rad', 't2_deg', 't3_rad', 't3_deg',
    'J1_x', 'J1_y', 'J1_z',           // base joint (always at origin)
    'J2_x', 'J2_y', 'J2_z',           // shoulder joint (always at (0, 0, h0))
    'J3_x', 'J3_y', 'J3_z',           // elbow joint (variable)
    'P_x', 'P_y', 'P_z'               // end-effector P (variable, load point)
  ].join(',');
  const rows = path.waypoints.map(wp => {
    const fk = forwardKinematics3D(wp.t1, wp.t2, wp.t3, state.h0, state.L1, state.L2);
    return [
      wp.t, wp.t * totalTime,
      wp.t1, wp.t1 * RAD2DEG,
      wp.t2, wp.t2 * RAD2DEG,
      wp.t3, wp.t3 * RAD2DEG,
      fk.J1.x, fk.J1.y, fk.J1.z,
      fk.J2.x, fk.J2.y, fk.J2.z,
      fk.J3.x, fk.J3.y, fk.J3.z,
      fk.P.x,  fk.P.y,  fk.P.z
    ].map(v => v.toFixed(6)).join(',');
  });
  const csv = [header, ...rows].join('\n') + '\n';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `robot3d_path_${path.strategy}_${ts}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
btnExportCsv.addEventListener('click', exportSelectedPathAsCsv);

// ── Pointer drag on 3D canvas (XY-plane drag, z held constant) ──
const canvas = renderer3d.renderer.domElement;
canvas.style.touchAction = 'none';

let dragOriginalControlsEnabled = true;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const hit = renderer3d.hitTestMarker(e.clientX, e.clientY, state.posA, state.posB);
  if (!hit) return;
  state.dragging = hit;
  dragOriginalControlsEnabled = renderer3d.controls.enabled;
  renderer3d.controls.enabled = false;
  canvas.style.cursor = 'grabbing';
  e.preventDefault();
});
canvas.addEventListener('mousemove', (e) => {
  if (!state.dragging) {
    const hit = renderer3d.hitTestMarker(e.clientX, e.clientY, state.posA, state.posB);
    canvas.style.cursor = hit ? 'grab' : 'default';
    return;
  }
  const z = state.dragging === 'A' ? state.posA.z : state.posB.z;
  const p = renderer3d.pickOnPlaneZ(e.clientX, e.clientY, z);
  if (!p) return;
  // Snap to ~1 cm
  const sx = Math.round(p.x * 100) / 100;
  const sy = Math.round(p.y * 100) / 100;
  if (state.dragging === 'A') {
    state.posA.x = sx; state.posA.y = sy;
    setSlider('xA', state.posA.x); setSlider('yA', state.posA.y);
  } else {
    state.posB.x = sx; state.posB.y = sy;
    setSlider('xB', state.posB.x); setSlider('yB', state.posB.y);
  }
  invalidatePathsAndRedraw();
});
function endDrag() {
  if (!state.dragging) return;
  state.dragging = null;
  renderer3d.controls.enabled = dragOriginalControlsEnabled;
  canvas.style.cursor = 'default';
}
canvas.addEventListener('mouseup', endDrag);
canvas.addEventListener('mouseleave', endDrag);

// ── Animation loop ──
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);

  if (state.isPlaying && state.paths.length > 0) {
    const dt = lastTime ? (time - lastTime) / 1000 : 0;
    const path = state.paths[state.selectedPathIndex];
    // Real-time playback: path.totalTime is the duration at 1× speed (derived from
    // max(|Δθ|) / 20°/s policy). animSpeed lets the user override.
    const T = Math.max(0.001, path.totalTime || 1.0);
    state.animProgress += (dt * state.animSpeed) / T;
    if (state.animProgress >= 1) {
      state.animProgress = 1;
      state.isPlaying = false;
      btnPlay.textContent = '▶ Play';
      btnPlay.classList.remove('playing');
    }
    // Update current pose from selected path waypoint
    const idx = Math.min(Math.floor(state.animProgress * (path.waypoints.length - 1)), path.waypoints.length - 1);
    const wp = path.waypoints[idx];
    state.currentPose = { t1: wp.t1, t2: wp.t2, t3: wp.t3 };
    redraw();
  }
  lastTime = time;
}

// ── Resize ──
window.addEventListener('resize', () => {
  graphT12.resize();
  graphT23.resize();
  graphXY.resize();
  redraw();
});

// ── Init ──
syncSlidersFromState();
computeIK();
renderer3d.cameraPreset('iso', state.h0, state.h0 + state.L1 + state.L2);
updateResults();
buildPathList();
redraw();
requestAnimationFrame(animate);
