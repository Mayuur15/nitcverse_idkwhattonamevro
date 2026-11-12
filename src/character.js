import * as THREE from 'three';

// Blocky humanoid with swinging limbs. Geometry/materials are shared so dozens are cheap.
const matCache = new Map();
const mat = (c) => { let m = matCache.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }); matCache.set(c, m); } return m; };
const limb = (w, h) => { const g = new THREE.BoxGeometry(w, h, w); g.translate(0, -h / 2, 0); return g; };
const GEO = {
  torso: new THREE.BoxGeometry(0.5, 0.65, 0.28), head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  hair: new THREE.BoxGeometry(0.32, 0.13, 0.32), eye: new THREE.BoxGeometry(0.05, 0.05, 0.02),
  arm: limb(0.15, 0.62), leg: limb(0.2, 0.78), pack: new THREE.BoxGeometry(0.36, 0.46, 0.18),
};

export function makeHumanoid({ shirt, pants, skin, hair, backpack = null, scale = 1 }) {
  const group = new THREE.Group();
  const add = (geo, color, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  add(GEO.torso, shirt, 0, 1.1, 0);
  add(GEO.head, skin, 0, 1.58, 0);
  add(GEO.hair, hair, 0, 1.74, -0.01);
  add(GEO.eye, '#111111', -0.07, 1.6, 0.152); add(GEO.eye, '#111111', 0.07, 1.6, 0.152);
  if (backpack) add(GEO.pack, backpack, 0, 1.15, -0.23);
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); group.add(p); return p; };
  const armL = pivot(-0.33, 1.42), armR = pivot(0.33, 1.42), legL = pivot(-0.13, 0.78), legR = pivot(0.13, 0.78);
  add(GEO.arm, shirt, 0, 0, 0, armL); add(GEO.arm, shirt, 0, 0, 0, armR);
  add(GEO.leg, pants, 0, 0, 0, legL); add(GEO.leg, pants, 0, 0, 0, legR);
  group.scale.setScalar(scale);
  return {
    group,
    pose(phase, amp = 1) {
      const s = Math.sin(phase) * 0.85 * amp;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.9; armR.rotation.x = s * 0.9;
    },
  };
}
