import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x1e1e1e);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    10000
  );
  camera.position.set(80, 80, 80);
  camera.up.set(0, 0, 1);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(120, 200, 180);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-100, -50, -100);
  scene.add(fill);

  // Grid (XY plane, Z up)
  const grid = new THREE.GridHelper(200, 20, 0x4ec9b0, 0x444444);
  grid.rotation.x = Math.PI / 2;
  grid.name = '__grid__';
  scene.add(grid);

  // Axes
  const axes = new THREE.AxesHelper(30);
  axes.name = '__axes__';
  scene.add(axes);

  // Controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const container = canvas.parentElement;
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return { scene, camera, renderer, controls, grid, axes };
}

// 장면 크기에 맞춰 그리드를 다시 만든다 (칸 간격은 1·2·5×10ⁿ mm 중 하나, 약 20칸)
export function fitGrid(scene, box) {
  const old = scene.getObjectByName('__grid__');
  if (!old) return;
  const ext = box.isEmpty() ? 100 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.y), Math.abs(box.max.y), 10);
  const raw = (ext * 2.4) / 20;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= raw);
  const div = Math.ceil((ext * 2.4) / step / 2) * 2;
  if (old.userData.step === step && old.userData.div === div) return;
  const grid = new THREE.GridHelper(step * div, div, 0x4ec9b0, 0x444444);
  grid.rotation.x = Math.PI / 2;
  grid.name = '__grid__';
  grid.visible = old.visible;
  grid.userData = { step, div };
  scene.remove(old);
  old.geometry.dispose();
  old.material.dispose?.();
  scene.add(grid);
  const axes = scene.getObjectByName('__axes__');
  if (axes) axes.scale.setScalar(Math.max(1, (step * div) / 200));
}

export function setGridVisible(scene, visible) {
  const g = scene.getObjectByName('__grid__');
  const a = scene.getObjectByName('__axes__');
  if (g) g.visible = visible;
  if (a) a.visible = visible;
}
