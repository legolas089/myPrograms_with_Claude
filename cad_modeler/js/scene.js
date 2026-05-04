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

export function setGridVisible(scene, visible) {
  const g = scene.getObjectByName('__grid__');
  const a = scene.getObjectByName('__axes__');
  if (g) g.visible = visible;
  if (a) a.visible = visible;
}
