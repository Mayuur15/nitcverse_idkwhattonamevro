import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeHumanoid } from './character.js';
import { pointInPoly, segDist } from './geo.js';

const RADIUS = 0.4;

export class Player {
  constructor({ scene, camera, dom, world, audio }) {
    this.world = world; this.audio = audio; this.camera = camera;
    this.human = makeHumanoid({ shirt: '#2f6fed', pants: '#23263a', skin: '#e0b18a', hair: '#1a1410', backpack: '#e0483a' });
    this.obj = this.human.group; scene.add(this.obj);
    this.keys = {}; this.vy = 0; this.walkT = 0; this.stepIdx = 0; this.moving = false;
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3(); this.move = new THREE.Vector3(); this.prev = new THREE.Vector3();

    addEventListener('keydown', (e) => { this.keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    addEventListener('blur', () => (this.keys = {}));

    this.controls = new OrbitControls(camera, dom);
    this.controls.enablePan = false; this.controls.minDistance = 3.5; this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04; this.controls.enableDamping = false;
  }

  get x() { return this.obj.position.x; }
  get n() { return -this.obj.position.z; }

  teleport(x, n) {
    this.obj.position.set(x, 0, -n); this.obj.rotation.y = Math.PI;
    this.camera.position.set(x, 5.5, -n + 11);
    this.controls.target.set(x, 1.5, -n); this.controls.update();
  }

  blocked(x, z) {
    const n = -z, w = this.world;
    for (const c of w.colliders) {
      if (x < c.minX - RADIUS || x > c.maxX + RADIUS || n < c.minY - RADIUS || n > c.maxY + RADIUS) continue;
      if (pointInPoly(x, n, c.poly) || pointInPoly(x + RADIUS, n, c.poly) || pointInPoly(x - RADIUS, n, c.poly) || pointInPoly(x, n + RADIUS, c.poly) || pointInPoly(x, n - RADIUS, c.poly)) return true;
    }
    for (const s of w.segColliders) if (segDist(x, n, s.x1, s.y1, s.x2, s.y2) < RADIUS + 0.2) return true;
    return false;
  }

  update(dt) {
    const k = this.keys, cam = this.camera;
    cam.getWorldDirection(this.fwd); this.fwd.y = 0; this.fwd.normalize();
    this.right.crossVectors(this.fwd, cam.up).normalize();
    this.move.set(0, 0, 0);
    if (k.KeyW || k.ArrowUp) this.move.add(this.fwd);
    if (k.KeyS || k.ArrowDown) this.move.sub(this.fwd);
    if (k.KeyD || k.ArrowRight) this.move.add(this.right);
    if (k.KeyA || k.ArrowLeft) this.move.sub(this.right);

    const p = this.obj.position; this.prev.copy(p);
    this.moving = this.move.lengthSq() > 0;
    const run = !!(k.ShiftLeft || k.ShiftRight);
    if (this.moving) {
      this.move.normalize();
      const sp = run ? 8.5 : 4.2;
      const nx = p.x + this.move.x * sp * dt, nz = p.z + this.move.z * sp * dt;
      if (!this.blocked(nx, p.z)) p.x = nx;                    // slide along walls: test axes separately
      if (!this.blocked(p.x, nz)) p.z = nz;
      let d = Math.atan2(this.move.x, this.move.z) - this.obj.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.obj.rotation.y += d * Math.min(1, dt * 12);
      this.walkT += dt * (run ? 12 : 8);
      const idx = Math.floor(this.walkT / Math.PI);
      if (idx !== this.stepIdx) { this.stepIdx = idx; if (p.y < 0.05) this.audio.step(run); }
    }

    const wasAir = p.y > 0.001;
    if (k.Space && p.y <= 0.001) this.vy = 6.2;
    this.vy -= 18 * dt; p.y = Math.max(0, p.y + this.vy * dt);
    if (p.y === 0) { if (wasAir && this.vy < -5) this.audio.thud(); this.vy = 0; }

    this.human.pose(this.walkT, this.moving ? 1 : 0);

    cam.position.add(p.clone().sub(this.prev));                // camera rides along, still orbitable
    this.controls.target.set(p.x, p.y + 1.5, p.z); this.controls.update();
  }
}
