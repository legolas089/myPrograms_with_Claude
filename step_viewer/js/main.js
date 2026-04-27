import { initScene, frameBoundingBox } from './scene.js';
import { loadStepFile } from './loader.js';
import { buildTree, resetTree } from './tree.js';
import { initSelection, selectPart } from './selection.js';
import { initMeasurement, clearMeasurement, setMeasurementMode } from './measurement.js';

// App state
const appState = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  partMeshes: new Map(),
  selectedPartId: null,
  originalMaterials: new Map(),
  measurementMode: false,
};

// Init scene
const canvas = document.getElementById('viewer-canvas');
const { scene, camera, renderer, controls } = initScene(canvas);
Object.assign(appState, { scene, camera, renderer, controls });

// Init selection (3D click)
initSelection(appState);

// Init measurement
initMeasurement(appState);

// Measurement toolbar
const btnMeasure = document.getElementById('btn-measure');
const btnClearMeasure = document.getElementById('btn-clear-measure');

function toggleMeasureMode() {
  appState.measurementMode = !appState.measurementMode;
  btnMeasure.classList.toggle('active', appState.measurementMode);
  setMeasurementMode(appState.measurementMode);
  if (appState.measurementMode) {
    selectPart(null, appState);
  }
}

btnMeasure.addEventListener('click', toggleMeasureMode);

btnClearMeasure.addEventListener('click', () => {
  clearMeasurement();
});

// Keyboard shortcut: M to toggle measurement
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'm' || e.key === 'M') {
    toggleMeasureMode();
  }
  if (e.key === 'Escape' && appState.measurementMode) {
    toggleMeasureMode();
  }
});

// UI elements
const dropOverlay = document.getElementById('drop-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const treeContainer = document.getElementById('tree-container');
const initialMessage = document.getElementById('initial-message');
const fileOpenBtn = document.getElementById('file-open-btn');
const fileInput = document.getElementById('file-input');

// File open button
fileOpenBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await loadFile(file);
  fileInput.value = '';
});

// Prevent browser from opening dropped files
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// Drag and drop
let dragCounter = 0;

document.body.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.body.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('active');
  }
});

document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'step' && ext !== 'stp') {
    alert('.STEP 또는 .STP 파일만 지원합니다.');
    return;
  }

  await loadFile(file);
});

async function loadFile(file) {
  loadingOverlay.classList.add('active');
  initialMessage.style.display = 'none';

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Reset state
    appState.selectedPartId = null;
    appState.originalMaterials = new Map();
    clearMeasurement();
    resetTree();

    const { rootNode, partMeshes, boundingBox } = await loadStepFile(arrayBuffer, scene);

    appState.partMeshes = partMeshes;

    // Frame camera to model
    frameBoundingBox(camera, controls, boundingBox);

    // Build tree
    buildTree(rootNode, treeContainer, (partId) => {
      selectPart(partId, appState);
    });

  } catch (err) {
    console.error('STEP 파일 로드 실패:', err);
    alert('STEP 파일을 로드하는 데 실패했습니다: ' + err.message);
  } finally {
    loadingOverlay.classList.remove('active');
  }
}
