// renderer3d.js — Three.js scene for 3D 3-DOF robot arm
// Z-up world, default iso view, OrbitControls.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { forwardKinematics3D } from './kinematics.js';

const COLOR_BG          = 0x1a1a1a;
const COLOR_BASE        = 0x808890;
const COLOR_LINK1       = 0x4ecdc4;
const COLOR_LINK2       = 0xffa94d;
const COLOR_PARALLEL    = 0x6c7280;
const COLOR_JOINT       = 0xffe066;
const COLOR_END_EFF     = 0xff6b6b;
const COLOR_BOX         = 0xfff066;
const COLOR_GRID        = 0x303030;
const COLOR_WORKSPACE   = 0x4a90e2;
const COLOR_PATH_DEFAULT = 0x666666;
const COLOR_MARKER_A    = 0xff6b6b;
const COLOR_MARKER_B    = 0x4ade80;

export class Renderer3D {
  constructor(container) {
    this.container = container;
    this._initScene();
    this._initRobot();
    this._pathLines = [];
    this._markerA = this._makeMarker(COLOR_MARKER_A);
    this._markerB = this._makeMarker(COLOR_MARKER_B);
    this._workspaceMesh = null;
    this._lastWorkspaceKey = '';
    this._currentPose = { t1: 0, t2: Math.PI / 4, t3: -Math.PI / 2 };
    this._boxAttached = false;

    window.addEventListener('resize', () => this._onResize());
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR_BG);

    // Z-up world: tell THREE we want +Z up before constructing camera/controls.
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 50);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.0, -1.1, 0.8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0.15);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 0.85);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, -3, 4);
    this.scene.add(dir);

    // Ground grid + floor — created at unit size, scaled per frame from L1+L2.
    // Unit grid is 1 m × 1 m with 0.05 m subdivisions; mesh.scale.x/y resizes it.
    this.gridHelper = new THREE.GridHelper(1, 20, COLOR_GRID, COLOR_GRID);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.scene.add(this.gridHelper);

    // Axes helper — scaled per frame too
    this.axesHelper = new THREE.AxesHelper(1);
    this.scene.add(this.axesHelper);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.95, side: THREE.DoubleSide })
    );
    this.floor.position.set(0, 0, -0.001);
    this.scene.add(this.floor);

    // Track last reach so we only resize when arm changes
    this._lastReach = -1;

    // Path group (parent for all path lines)
    this._pathGroup = new THREE.Group();
    this.scene.add(this._pathGroup);
  }

  _initRobot() {
    const mat = (color) => new THREE.MeshStandardMaterial({
      color, roughness: 0.5, metalness: 0.15
    });

    this.robotGroup = new THREE.Group();
    this.scene.add(this.robotGroup);

    // Base column — rebuilt when h0 changes (keep handle to recreate)
    this.baseMesh = null;
    this._h0 = null;

    // Upper arm (L1) — capsule oriented along its local +Y, length set per frame
    this.l1Mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 16), mat(COLOR_LINK1));
    this.l1Mesh.geometry.translate(0, 0.5, 0); // origin at one end
    this.robotGroup.add(this.l1Mesh);

    // Forearm (L2)
    this.l2Mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 16), mat(COLOR_LINK2));
    this.l2Mesh.geometry.translate(0, 0.5, 0);
    this.robotGroup.add(this.l2Mesh);

    // Parallel link Lp (visual only) — a slimmer rod parallel to L1, offset to the side
    this.lpMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 12), mat(COLOR_PARALLEL));
    this.lpMesh.geometry.translate(0, 0.5, 0);
    this.robotGroup.add(this.lpMesh);

    // Cross bars connecting L1 ↔ Lp at both ends
    this.crossA = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), mat(COLOR_PARALLEL));
    this.crossA.geometry.translate(0, 0.5, 0);
    this.robotGroup.add(this.crossA);
    this.crossB = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), mat(COLOR_PARALLEL));
    this.crossB.geometry.translate(0, 0.5, 0);
    this.robotGroup.add(this.crossB);

    // Joints
    const jointGeo = new THREE.SphereGeometry(0.05, 16, 12);
    const eeGeo = new THREE.SphereGeometry(0.04, 16, 12);
    this.j2Sphere = new THREE.Mesh(jointGeo, mat(COLOR_JOINT));
    this.j3Sphere = new THREE.Mesh(jointGeo, mat(COLOR_JOINT));
    this.eeSphere = new THREE.Mesh(eeGeo, mat(COLOR_END_EFF));
    this.robotGroup.add(this.j2Sphere, this.j3Sphere, this.eeSphere);

    // Box (carried payload)
    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: COLOR_BOX, roughness: 0.7 })
    );
    this.box.visible = false;
    this.scene.add(this.box);
  }

  _buildBase(h0) {
    if (this.baseMesh) {
      this.robotGroup.remove(this.baseMesh);
      this.baseMesh.geometry.dispose();
      this.baseMesh.material.dispose();
    }
    const geo = new THREE.CylinderGeometry(0.06, 0.09, h0, 24);
    geo.translate(0, h0 / 2, 0);
    geo.rotateX(Math.PI / 2); // align along +Z
    const mat = new THREE.MeshStandardMaterial({ color: COLOR_BASE, roughness: 0.5, metalness: 0.3 });
    this.baseMesh = new THREE.Mesh(geo, mat);
    this.robotGroup.add(this.baseMesh);
    this._h0 = h0;
  }

  _makeMarker(color) {
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.4 })
    );
    group.add(sphere);
    // Vertical ground stem — cylinder geometry extends from local y=0 down to y=-1.
    // We rotate the MESH (not the geometry) so its local -Y axis maps to world -Z;
    // mesh.scale.y still controls the stem length in this rotated frame.
    const stemGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 8);
    stemGeo.translate(0, -0.5, 0);
    const stem = new THREE.Mesh(
      stemGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 })
    );
    stem.rotation.x = Math.PI / 2;  // local -Y → world -Z (down to floor)
    group.add(stem);
    group.userData.sphere = sphere;
    group.userData.stem = stem;
    this.scene.add(group);
    return group;
  }

  // Visual scale factor in [0.2, 1.5] derived from the smaller link length.
  // Reference 0.3 m corresponds to scale 1.0 (the original hard-coded sizing).
  _visualScale(L1, L2) {
    const minL = Math.min(L1, L2);
    return Math.max(0.2, Math.min(1.5, minL / 0.3));
  }

  _orientCylinderBetween(mesh, a, b, radialScale = 1) {
    // Cylinder is a capsule along local +Y of length 1, origin at the 'a' end.
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    mesh.position.set(a.x, a.y, a.z);
    if (len < 1e-6) {
      mesh.scale.set(radialScale, 1e-3, radialScale);
      return;
    }
    mesh.scale.set(radialScale, len, radialScale);
    const dirVec = new THREE.Vector3(dx, dy, dz).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dirVec);
    mesh.quaternion.copy(q);
  }

  setRobotPose(state) {
    const { h0, L1, L2 } = state;
    if (this._h0 !== h0) this._buildBase(h0);

    const s = this._visualScale(L1, L2);
    const reach = L1 + L2;

    // Rescale floor/grid/axes only when reach changes meaningfully.
    if (Math.abs(reach - this._lastReach) > 1e-4) {
      const gridSize = Math.max(0.4, reach * 3.5);   // floor side length (m)
      this.gridHelper.scale.set(gridSize, 1, gridSize);
      this.floor.scale.set(gridSize, gridSize, 1);
      const axisLen = Math.max(0.05, reach * 0.4);
      this.axesHelper.scale.set(axisLen, axisLen, axisLen);
      this._lastReach = reach;
    }

    const pose = state.currentPose || this._currentPose;
    this._currentPose = pose;
    const fk = forwardKinematics3D(pose.t1, pose.t2, pose.t3, h0, L1, L2);

    // Link cylinders — radial dimension scales with s, length set inside helper.
    this._orientCylinderBetween(this.l1Mesh, fk.J2, fk.J3, s);
    this._orientCylinderBetween(this.l2Mesh, fk.J3, fk.P,  s);

    // Parallel link Lp — perpendicular offset scales with arm size too.
    const offset = 0.06 * s;
    const ox = -Math.sin(pose.t1) * offset;
    const oy =  Math.cos(pose.t1) * offset;
    const a = { x: fk.J2.x + ox, y: fk.J2.y + oy, z: fk.J2.z };
    const b = { x: fk.J3.x + ox, y: fk.J3.y + oy, z: fk.J3.z };
    this._orientCylinderBetween(this.lpMesh, a, b, s);
    this._orientCylinderBetween(this.crossA, fk.J2, a, s);
    this._orientCylinderBetween(this.crossB, fk.J3, b, s);

    // Joint / EE spheres — uniform scaling
    this.j2Sphere.scale.setScalar(s);
    this.j3Sphere.scale.setScalar(s);
    this.eeSphere.scale.setScalar(s);
    this.j2Sphere.position.set(fk.J2.x, fk.J2.y, fk.J2.z);
    this.j3Sphere.position.set(fk.J3.x, fk.J3.y, fk.J3.z);
    this.eeSphere.position.set(fk.P.x, fk.P.y, fk.P.z);

    // Box (if attached)
    if (this._boxAttached) {
      this.box.visible = true;
      this.box.scale.setScalar(s);
      this.box.position.set(fk.P.x, fk.P.y, fk.P.z + 0.06 * s);
    } else {
      this.box.visible = false;
    }

    // Cache scale for setMarkers to consume on next call
    this._markerScale = s;
  }

  setMarkers(posA, posB, h0) {
    const s = this._markerScale ?? 1;
    const place = (marker, p) => {
      marker.position.set(p.x, p.y, p.z);
      marker.userData.sphere.scale.setScalar(s);
      // Stem: scale.x and scale.z = radial (s), scale.y = world-Z length (p.z).
      // Use max(1e-3, p.z) so a marker at z=0 still has a non-degenerate cylinder.
      marker.userData.stem.scale.set(s, Math.max(1e-3, p.z), s);
    };
    place(this._markerA, posA);
    place(this._markerB, posB);
  }

  setShowGrid(show) {
    this.gridHelper.visible = show;
    this.axesHelper.visible = show;
  }

  setShowWorkspace(show, h0, L1, L2) {
    const key = show ? `${h0.toFixed(3)}_${L1.toFixed(3)}_${L2.toFixed(3)}` : 'off';
    if (key === this._lastWorkspaceKey) return;
    if (this._workspaceMesh) {
      this.scene.remove(this._workspaceMesh);
      this._workspaceMesh.geometry.dispose();
      this._workspaceMesh.material.dispose();
      this._workspaceMesh = null;
    }
    this._lastWorkspaceKey = key;
    if (!show) return;

    const rMid  = (Math.abs(L1 - L2) + (L1 + L2)) / 2;
    const tube  = ((L1 + L2) - Math.abs(L1 - L2)) / 2;
    const geo = new THREE.TorusGeometry(rMid, tube, 16, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_WORKSPACE,
      wireframe: true,
      transparent: true,
      opacity: 0.18
    });
    this._workspaceMesh = new THREE.Mesh(geo, mat);
    // Torus by default lies in XY plane (correct for Z-up)
    this._workspaceMesh.position.set(0, 0, h0);
    this.scene.add(this._workspaceMesh);
  }

  setPaths(paths, selectedIndex, h0, L1, L2) {
    // Cache key based on identity of paths array, geometry params, and length.
    // Caller mutates state.paths by replacement (not in-place), so reference equality works.
    const geomKey = `${paths.length}|${h0}|${L1}|${L2}|${paths === this._lastPathsRef ? 1 : 0}`;
    const needsRebuild = paths !== this._lastPathsRef
      || this._lastGeomKey !== geomKey
      || this._pathLines.length !== paths.length;

    if (needsRebuild) {
      while (this._pathGroup.children.length > 0) {
        const c = this._pathGroup.children.pop();
        c.geometry?.dispose();
        c.material?.dispose();
      }
      this._pathLines = [];

      paths.forEach((p) => {
        const positions = new Float32Array(p.waypoints.length * 3);
        p.waypoints.forEach((wp, j) => {
          const fk = forwardKinematics3D(wp.t1, wp.t2, wp.t3, h0, L1, L2);
          positions[j * 3]     = fk.P.x;
          positions[j * 3 + 1] = fk.P.y;
          positions[j * 3 + 2] = fk.P.z;
        });
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({
          color: new THREE.Color(p.color),
          transparent: true,
          opacity: 0.35
        });
        const line = new THREE.Line(geom, mat);
        this._pathGroup.add(line);
        this._pathLines.push(line);
      });
      this._lastPathsRef = paths;
      this._lastGeomKey = geomKey;
      this._lastSelectedIndex = -1;
    }

    // Update only opacity / linewidth if selection changed (cheap)
    if (this._lastSelectedIndex !== selectedIndex) {
      this._pathLines.forEach((line, i) => {
        const isSel = i === selectedIndex;
        line.material.opacity = isSel ? 1.0 : 0.35;
      });
      this._lastSelectedIndex = selectedIndex;
    }
  }

  setBoxAttached(attached) {
    this._boxAttached = attached;
  }

  cameraPreset(preset, h0, reach = 0.55) {
    // Camera distance scales smoothly with reach. Min 0.3 m so a 5 cm arm
    // still has room between near plane (1 cm) and the geometry.
    const d = Math.max(0.3, reach * 1.7);
    const target = new THREE.Vector3(0, 0, h0 * 0.6);
    let pos;
    switch (preset) {
      case 'top':   pos = new THREE.Vector3(0.001, 0.0, h0 + d * 1.1); break;
      case 'front': pos = new THREE.Vector3(0.0, -d * 1.05, h0 * 0.6); break;
      case 'side':  pos = new THREE.Vector3(d * 1.05, 0.0, h0 * 0.6); break;
      case 'iso':
      default:      pos = new THREE.Vector3(d * 0.85, -d * 0.85, h0 + d * 0.4); break;
    }
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  // Raycast a screen click onto the horizontal plane at z = z0.
  // Returns world (x, y) on that plane, or null.
  pickOnPlaneZ(clientX, clientY, z0) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  * 2 - 1,
      -((clientY - rect.top)  / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0);
    const out = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, out)) {
      return { x: out.x, y: out.y };
    }
    return null;
  }

  // Returns 'A', 'B', or null based on screen-space distance to marker.
  hitTestMarker(clientX, clientY, posA, posB) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const project = (p) => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
      return {
        x: (v.x + 1) / 2 * rect.width,
        y: (1 - v.y) / 2 * rect.height
      };
    };
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const dA = project(posA);
    const dB = project(posB);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const tA = dist({ x: cx, y: cy }, dA);
    const tB = dist({ x: cx, y: cy }, dB);
    const THRESH = 18;
    if (tA < THRESH && tA <= tB) return 'A';
    if (tB < THRESH) return 'B';
    return null;
  }

  resetCamera(h0) { this.cameraPreset('iso', h0); }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate = () => {
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
