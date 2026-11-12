import * as THREE from 'three';
import { CONFIG } from './config.js';
import { project, unproject, lonLatToTileF, tileCornerLonLat } from './geo.js';

// Streams real satellite tiles onto the ground:
//   base layer  – whole campus at a low zoom
//   near layer  – sharp tiles in a ring around the player (also feeds the tree placer)
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const attempt = (cors) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';           // lets us read pixels (tree detection)
      img.onload = () => resolve({ img, readable: cors });
      img.onerror = () => (cors ? attempt(false) : reject(new Error('tile failed')));
      img.src = url;
    };
    attempt(true);
  });
}

export class Imagery {
  constructor({ scene, renderer, bounds, onTile, onTileRemoved }) {
    this.cfg = CONFIG.imagery;
    this.enabled = this.cfg.enabled;
    this.renderer = renderer; this.bounds = bounds;
    this.onTile = onTile || (() => {}); this.onTileRemoved = onTileRemoved || (() => {});
    this.group = new THREE.Group(); scene.add(this.group);
    this.baseGroup = new THREE.Group(); this.nearGroup = new THREE.Group();
    this.group.add(this.baseGroup, this.nearGroup);
    this.near = new Map();
    this.stats = { loaded: 0, failed: 0 };
    this.timer = 0;
  }

  setVisible(v) { this.group.visible = v; }
  url(z, x, y) { return this.cfg.url.replace('{z}', z).replace('{x}', x).replace('{y}', y); }

  tileRect(z, x, y) {
    const [lon1, lat1] = tileCornerLonLat(x, y, z), [lon2, lat2] = tileCornerLonLat(x + 1, y + 1, z);
    const [x1, n1] = project(lon1, lat1), [x2, n2] = project(lon2, lat2);
    return { x1, x2, n1, n2 };
  }

  makeMesh(z, x, y, img, yPos, offset) {
    const r = this.tileRect(z, x, y);
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
    const geo = new THREE.PlaneGeometry(r.x2 - r.x1 + 0.05, r.n1 - r.n2 + 0.05);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((r.x1 + r.x2) / 2, yPos, -(r.n1 + r.n2) / 2);
    m.receiveShadow = true;
    return { mesh: m, rect: r };
  }

  start(px, pn) {
    if (!this.enabled) return;
    const z = this.cfg.baseZoom, b = this.bounds;
    const [fx0, fy1] = lonLatToTileF(b.minLon, b.minLat, z), [fx1, fy0] = lonLatToTileF(b.maxLon, b.maxLat, z);
    const list = [];
    for (let x = Math.floor(fx0) - 1; x <= Math.floor(fx1) + 1; x++)
      for (let y = Math.floor(fy0) - 1; y <= Math.floor(fy1) + 1; y++) {
        const r = this.tileRect(z, x, y);
        list.push({ x, y, d: Math.hypot((r.x1 + r.x2) / 2 - px, (r.n1 + r.n2) / 2 - pn) });
      }
    list.sort((a, c) => a.d - c.d);                       // closest first
    for (const t of list) {
      loadImage(this.url(z, t.x, t.y)).then(({ img }) => {
        const { mesh } = this.makeMesh(z, t.x, t.y, img, -0.02, 0);
        this.baseGroup.add(mesh); this.stats.loaded++;
      }).catch(() => { this.stats.failed++; });
    }
  }

  update(px, pn, dt, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.5;
    const z = this.cfg.nearZoom, R = this.cfg.nearRadius;
    const [lon, lat] = unproject(px, pn);
    const [fx, fy] = lonLatToTileF(lon, lat, z);
    const cx = Math.floor(fx), cy = Math.floor(fy);
    const want = new Set();
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const x = cx + dx, y = cy + dy, key = `${z}/${x}/${y}`;
      want.add(key);
      if (this.near.has(key)) continue;
      const entry = { key, x, y, mesh: null, alive: true };
      this.near.set(key, entry);
      const r = this.tileRect(z, x, y);
      const info = { key, ...r, img: null, readable: false };
      if (!this.enabled) { this.onTile(info); continue; }
      loadImage(this.url(z, x, y)).then(({ img, readable }) => {
        if (!entry.alive) return;
        const { mesh } = this.makeMesh(z, x, y, img, 0, -2);
        entry.mesh = mesh; this.nearGroup.add(mesh); this.stats.loaded++;
        this.onTile({ ...info, img, readable });
      }).catch(() => {
        this.stats.failed++;
        if (entry.alive) this.onTile(info);               // still give the tree placer a chance (noise fallback)
      });
    }
    for (const [key, e] of this.near) {
      if (want.has(key)) continue;
      const [, x, y] = key.split('/').map(Number);
      if (Math.abs(x - cx) <= R + 1 && Math.abs(y - cy) <= R + 1) continue;   // hysteresis
      e.alive = false;
      if (e.mesh) { this.nearGroup.remove(e.mesh); e.mesh.material.map.dispose(); e.mesh.material.dispose(); e.mesh.geometry.dispose(); }
      this.onTileRemoved(key); this.near.delete(key);
    }
  }
}
