import * as THREE from 'three';
import { makeHumanoid } from './character.js';

// ---------- random walker on a road graph ----------
function pickNext(node, prev) {
  const opts = prev && node.adj.length > 1 ? node.adj.filter((n) => n !== prev) : node.adj;
  return opts[(Math.random() * opts.length) | 0];
}
class Walker {
  constructor(node) { this.reset(node); }
  reset(node) { this.a = node; this.b = pickNext(node, null) || node; this.s = 0; this.len = this.edgeLen(); }
  edgeLen() { return Math.max(0.01, Math.hypot(this.b.x - this.a.x, this.b.n - this.a.n)); }
  advance(d) {                           // returns true if we passed a junction
    this.s += d; let passed = false;
    while (this.s >= this.len) {
      this.s -= this.len;
      const next = pickNext(this.b, this.a) || this.a;
      this.a = this.b; this.b = next; this.len = this.edgeLen(); passed = true;
    }
    return passed;
  }
  sample(out) {
    const t = this.s / this.len;
    out.x = this.a.x + (this.b.x - this.a.x) * t; out.n = this.a.n + (this.b.n - this.a.n) * t;
    out.dx = (this.b.x - this.a.x) / this.len; out.dn = (this.b.n - this.a.n) / this.len;
  }
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const tmp = { x: 0, n: 0, dx: 1, dn: 0 };
const turn = (cur, target, k) => { let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * k; };

function nodesInRing(graph, cx, cn, rMin, rMax) {
  const out = graph.list.filter((n) => { const d = Math.hypot(n.x - cx, n.n - cn); return d >= rMin && d <= rMax; });
  return out.length ? out : graph.list;
}

// ================= pedestrians =================
const SHIRTS = ['#d94f4f', '#3d7bd9', '#f2c94c', '#4fb286', '#ffffff', '#9b59b6', '#ee8434', '#2b2d42', '#e07a9f', '#5bc0be'];
const PANTS = ['#26293a', '#3b4a6b', '#4a3f35', '#1f1f1f', '#566573', '#6b705c'];
const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#a86b3c', '#6f4423'];
const HAIR = ['#0f0a08', '#1b130e', '#2a1c12'];

class Pedestrian {
  constructor(scene, graph, node) {
    this.h = makeHumanoid({ shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), hair: pick(HAIR), backpack: Math.random() < 0.55 ? pick(SHIRTS) : null, scale: 0.93 + Math.random() * 0.15 });
    this.obj = this.h.group; scene.add(this.obj);
    this.walker = new Walker(node);
    this.speed = 1.0 + Math.random() * 0.8; this.phase = Math.random() * 6; this.amp = 1;
    this.lat = (Math.random() - 0.5) * 1.6; this.pause = 0; this.heading = Math.random() * 6;
    this.place();
  }
  place() {
    this.walker.sample(tmp);
    const px = -tmp.dn, pn = tmp.dx;                                   // left normal in (x, n)
    this.obj.position.set(tmp.x + px * this.lat, 0, -(tmp.n + pn * this.lat));
    this.target = Math.atan2(tmp.dx, -tmp.dn);
  }
  teleport(node) { this.walker.reset(node); this.pause = 0; this.place(); this.heading = this.target; this.obj.rotation.y = this.heading; }
  update(dt) {
    if (this.pause > 0) { this.pause -= dt; this.amp = Math.max(0, this.amp - dt * 4); this.h.pose(this.phase, this.amp); return; }
    this.amp = Math.min(1, this.amp + dt * 4);
    if (this.walker.advance(this.speed * dt) && Math.random() < 0.12) this.pause = 3 + Math.random() * 7;
    this.place();
    this.heading = turn(this.heading, this.target, Math.min(1, dt * 8)); this.obj.rotation.y = this.heading;
    this.phase += this.speed * dt * 4.6; this.h.pose(this.phase, this.amp);
  }
}

export class Pedestrians {
  constructor(scene, world, count, spawn) {
    this.graph = world.walkGraph; this.list = [];
    if (!this.graph.list.length) return;
    const pool = nodesInRing(this.graph, spawn.x, spawn.n, 0, 260);
    for (let i = 0; i < count; i++) this.list.push(new Pedestrian(scene, this.graph, pick(pool)));
  }
  update(dt, pp) {
    for (const p of this.list) {
      p.update(dt);
      if (Math.hypot(p.obj.position.x - pp.x, p.obj.position.z - pp.z) > 450) p.teleport(pick(nodesInRing(this.graph, pp.x, -pp.z, 80, 300)));
    }
  }
  countNear(x, z, r) { let c = 0; for (const p of this.list) if (Math.hypot(p.obj.position.x - x, p.obj.position.z - z) < r) c++; return c; }
}

// ================= cars =================
const CAR_COLORS = ['#f2f2f2', '#f2f2f2', '#c0c4c8', '#b0302f', '#2a4d8f', '#222428', '#e0b030'];
const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b0, emissiveIntensity: 0 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2020, emissiveIntensity: 0 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.2 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515 });
const G = {
  body: new THREE.BoxGeometry(1.8, 0.75, 4.2), cabin: new THREE.BoxGeometry(1.6, 0.6, 2.2),
  wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10).rotateZ(Math.PI / 2), lamp: new THREE.BoxGeometry(0.4, 0.18, 0.06),
};

function makeCar() {
  const g = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: pick(CAR_COLORS), roughness: 0.4, metalness: 0.3 });
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); };
  add(G.body, body, 0, 0.65, 0); add(G.cabin, glassMat, 0, 1.25, -0.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(G.wheel, wheelMat, sx * 0.9, 0.34, sz * 1.35);
  for (const sx of [-0.55, 0.55]) { add(G.lamp, headMat, sx, 0.75, 2.12); add(G.lamp, tailMat, sx, 0.75, -2.12); }
  return g;
}

export class Cars {
  constructor(scene, world, count, spawn) {
    this.graph = world.carGraph; this.list = [];
    if (!this.graph.list.length) return;
    const pool = nodesInRing(this.graph, spawn.x, spawn.n, 0, 450);
    for (let i = 0; i < count; i++) {
      const obj = makeCar(); scene.add(obj);
      const c = { obj, walker: new Walker(pick(pool)), speed: 4.5 + Math.random() * 3.5, heading: 0 };
      this.place(c, true); this.list.push(c);
    }
  }
  place(c, snap) {
    c.walker.sample(tmp);
    const off = 1.3;                                                   // keep left (India)
    c.obj.position.set(tmp.x + (-tmp.dn) * off, 0, -(tmp.n + tmp.dx * off));
    const target = Math.atan2(tmp.dx, -tmp.dn);
    c.heading = snap ? target : turn(c.heading, target, 0.12);
    c.obj.rotation.y = c.heading;
  }
  update(dt, pp, night) {
    headMat.emissiveIntensity = night * 3; tailMat.emissiveIntensity = 0.4 + night * 2;
    for (const c of this.list) {
      c.walker.advance(c.speed * dt); this.place(c, false);
      if (Math.hypot(c.obj.position.x - pp.x, c.obj.position.z - pp.z) > 700) { c.walker.reset(pick(nodesInRing(this.graph, pp.x, -pp.z, 120, 450))); this.place(c, true); }
    }
  }
  nearestDist(x, z) { let d = 1e9; for (const c of this.list) d = Math.min(d, Math.hypot(c.obj.position.x - x, c.obj.position.z - z)); return d; }
}
