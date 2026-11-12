import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32, hashStr } from './geo.js';

// Trees are placed where the satellite image is dark green (so they match the real campus).
// If pixels can't be read (offline / CORS), a noise scatter is used instead.
const crownGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, r = mulberry32(5);
  for (let i = 0; i < p.count; i++) { const k = 0.82 + r() * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k); }
  g.computeVertexNormals(); return g;
})();
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 5, 1, true);
const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 1 });

let sharedCanvas = null;
function readPixels(img) {
  try {
    if (typeof document === 'undefined') return null;
    sharedCanvas = sharedCanvas || Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 256, 256);
    return ctx.getImageData(0, 0, 256, 256).data;
  } catch { return null; }          // tainted canvas
}

export class Trees {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.tiles = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
  }

  addTile(t) {
    if (!CONFIG.trees.enabled || this.tiles.has(t.key)) return;
    const rnd = mulberry32(hashStr(t.key));
    const W = t.x2 - t.x1, H = t.n1 - t.n2, step = CONFIG.trees.stepPx, max = CONFIG.trees.maxPerTile;
    const data = t.readable && t.img ? readPixels(t.img) : null;
    const spots = [];

    for (let py = step / 2; py < 256 && spots.length < max; py += step) {
      for (let px = step / 2; px < 256 && spots.length < max; px += step) {
        let density;
        if (data) {
          let r = 0, g = 0, b = 0;
          for (let oy = -2; oy <= 2; oy += 2) for (let ox = -2; ox <= 2; ox += 2) {
            const i = (Math.min(255, Math.floor(py + oy)) * 256 + Math.min(255, Math.floor(px + ox))) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2];
          }
          r /= 9; g /= 9; b /= 9;
          const luma = (r + g + b) / 3;
          if (!(g > r + 4 && g > b + 8 && luma < 118)) continue;      // not tree-green
          density = luma < 80 ? 0.85 : 0.5;
        } else {
          const wx = t.x1 + (px / 256) * W, wy = t.n2 + (1 - py / 256) * H;
          const nz = Math.sin(wx * 0.021) * Math.cos(wy * 0.017) + Math.sin(wx * 0.07 + wy * 0.05) * 0.4;
          if (nz < 0.25) continue; density = 0.55;
        }
        if (rnd() > density) continue;
        const x = t.x1 + ((px + (rnd() - 0.5) * step) / 256) * W;
        const n = t.n1 - ((py + (rnd() - 0.5) * step) / 256) * H;
        if (this.world.insideBuilding(x, n, 2.2) || this.world.nearRoad(x, n, data ? 0.3 : 2.5)) continue;
        spots.push([x, n]);
      }
    }
    if (!spots.length) { this.tiles.set(t.key, null); return; }

    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const o = new THREE.Object3D(), col = new THREE.Color();
    spots.forEach(([x, n], i) => {
      const s = 0.8 + rnd() * 0.9, trunkH = 2.4 * s, cr = 2.0 * s * (0.85 + rnd() * 0.35);
      o.rotation.set(0, rnd() * 6.28, 0);
      o.scale.set(s, trunkH, s); o.position.set(x, trunkH / 2, -n); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
      o.scale.set(cr, cr * 0.95, cr); o.position.set(x, trunkH + cr * 0.55, -n); o.updateMatrix(); crowns.setMatrixAt(i, o.matrix);
      col.setHSL(0.24 + rnd() * 0.09, 0.42 + rnd() * 0.2, 0.2 + rnd() * 0.13); crowns.setColorAt(i, col);
    });
    for (const m of [crowns, trunks]) { m.frustumCulled = false; m.castShadow = true; this.group.add(m); }
    this.tiles.set(t.key, { crowns, trunks });
  }

  removeTile(key) {
    const e = this.tiles.get(key);
    if (e) for (const m of [e.crowns, e.trunks]) { this.group.remove(m); m.dispose(); }
    this.tiles.delete(key);
  }

  get count() { let c = 0; for (const e of this.tiles.values()) if (e) c += e.crowns.count; return c; }
}
