import * as THREE from 'three';
import { setOrigin, project, pointInPoly, mulberry32, hashStr, segDist } from './geo.js';
import { CONFIG, PALETTE, BUILDING_STYLE } from './config.js';
import { buildGraph, WALKABLE, DRIVABLE } from './graph.js';

const BAY_W = 4, FLOOR_H = 3.4, BAYS_X = 4, BAYS_Y = 2;
const ROAD_W = { primary: 9, secondary: 8, tertiary: 7, unclassified: 5.5, residential: 5.5, living_street: 4.5, service: 4, track: 3, footway: 1.8, path: 1.6, pedestrian: 3, steps: 1.6, cycleway: 2 };
const NARROW = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);
const LAMP_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service']);
const CELL = 25;

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------- procedural facade: 4x2 window bays, random lit windows for night ----------
function facadeTextures(renderer) {
  const W = 512, H = 256, bw = W / BAYS_X, bh = H / BAYS_Y;
  const a = mkCanvas(W, H), e = mkCanvas(W, H);
  const g = a.getContext('2d'), ge = e.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 8, 2 + Math.random() * 8);
  }
  const rnd = mulberry32(7);
  for (let by = 0; by < BAYS_Y; by++) for (let bx = 0; bx < BAYS_X; bx++) {
    const x0 = bx * bw, y0 = by * bh;
    g.fillStyle = '#d2d2d2'; g.fillRect(x0, y0, bw, 7); g.fillRect(x0, y0 + bh - 7, bw, 7);   // slab ledges
    const wx = x0 + bw * 0.2, wy = y0 + bh * 0.24, ww = bw * 0.6, wh = bh * 0.52;
    g.fillStyle = '#f4f4f4'; g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);                       // frame
    g.fillStyle = '#2f465b'; g.fillRect(wx, wy, ww, wh);                                          // glass
    g.fillStyle = '#f4f4f4'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh);                              // mullion
    if (rnd() < 0.62) {
      ge.fillStyle = '#ffcf85'; ge.fillRect(wx, wy, ww, wh);
      ge.fillStyle = '#000'; ge.fillRect(wx + ww / 2 - 2, wy, 4, wh);
    }
  }
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / (BAY_W * BAYS_X), 1 / (FLOOR_H * BAYS_Y));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    return t;
  };
  return { map: mk(a), emissive: mk(e) };
}

function glowTexture() {
  const c = mkCanvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function label(text, color = '#ffffff', scale = 1) {
  const c = mkCanvas(512, 96), g = c.getContext('2d');
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.length > 28 ? text.slice(0, 27) + '…' : text, 256, 50);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, fog: false }));
  s.scale.set(22 * scale, 4.1 * scale, 1);
  s.renderOrder = 20;
  return s;
}

function addRibbon(pos, idx, pts, w, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
    const b = pos.length / 3;
    pos.push(x1 + nx, y, -(y1 + ny), x1 - nx, y, -(y1 - ny), x2 + nx, y, -(y2 + ny), x2 - nx, y, -(y2 - ny));
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
}
function ribbonMesh(pos, idx, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

export function buildWorld(data, renderer) {
  const F = data.features;

  // ---- bounds & origin ----
  let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
  const scan = (c) => (typeof c[0] === 'number'
    ? (minLon = Math.min(minLon, c[0]), maxLon = Math.max(maxLon, c[0]), minLat = Math.min(minLat, c[1]), maxLat = Math.max(maxLat, c[1]))
    : c.forEach(scan));
  F.forEach((f) => scan(f.geometry.coordinates));
  setOrigin((minLon + maxLon) / 2, (minLat + maxLat) / 2);
  const bounds = { minLon, maxLon, minLat, maxLat };

  const group = new THREE.Group();
  const mapGroup = new THREE.Group();   // flat "map mode" layers (shown when satellite is off)
  group.add(mapGroup);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x6f905b }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.15; ground.receiveShadow = true;
  group.add(ground);

  // ---- shared materials ----
  const fac = facadeTextures(renderer);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3b3b40, side: THREE.DoubleSide });
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xc2b393, side: THREE.DoubleSide });
  const parkMat = new THREE.MeshLambertMaterial({ color: 0x4d8a42, side: THREE.DoubleSide });
  const pitchMat = new THREE.MeshLambertMaterial({ color: 0x5aa04c, side: THREE.DoubleSide });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f7fb0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const plain = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });

  // ---- collections ----
  const colliders = [], segColliders = [], segs = [], grid = new Map();
  const roadPos = [], roadIdx = [], pathPos = [], pathIdx = [];
  const buildingMats = [], labels = [], lamps = [];
  let towerBlink = null;
  const bPoints = [];   // building bbox centres (for spawn fallback)

  const cellKey = (ix, iy) => ix + ',' + iy;
  function indexSeg(s) {
    const m = s.hw + 12;
    const x0 = Math.floor((Math.min(s.x1, s.x2) - m) / CELL), x1 = Math.floor((Math.max(s.x1, s.x2) + m) / CELL);
    const y0 = Math.floor((Math.min(s.y1, s.y2) - m) / CELL), y1 = Math.floor((Math.max(s.y1, s.y2) + m) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = cellKey(ix, iy); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(s);
    }
  }
  function nearestRoad(x, n, maxD = 12) {
    const a = grid.get(cellKey(Math.floor(x / CELL), Math.floor(n / CELL)));
    let best = null, bd = maxD;
    if (a) for (const s of a) {
      const d = segDist(x, n, s.x1, s.y1, s.x2, s.y2) - s.hw;
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { d: bd, seg: best } : null;
  }
  const nearRoad = (x, n, extra = 0) => { const r = nearestRoad(x, n, extra); return !!r && r.d <= extra; };

  function insideBuilding(x, n, m = 0) {
    for (const c of colliders) {
      if (x < c.minX - m || x > c.maxX + m || n < c.minY - m || n > c.maxY + m) continue;
      if (pointInPoly(x, n, c.poly)) return true;
      if (m > 0 && (pointInPoly(x + m, n, c.poly) || pointInPoly(x - m, n, c.poly) || pointInPoly(x, n + m, c.poly) || pointInPoly(x, n - m, c.poly))) return true;
    }
    return false;
  }

  // ======================= pass over features =======================
  for (const f of F) {
    const p = f.properties, g = f.geometry;
    if (p.indoor) continue;

    // ---------- roads & paths ----------
    if (g.type === 'LineString' && p.highway) {
      const w = ROAD_W[p.highway] ?? 3.5;
      const pts = g.coordinates.map((c) => project(c[0], c[1]));
      const narrow = NARROW.has(p.highway);
      addRibbon(narrow ? pathPos : roadPos, narrow ? pathIdx : roadIdx, pts, w, narrow ? 0.05 : 0.04);
      for (let i = 0; i < pts.length - 1; i++) {
        const s = { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], hw: w / 2 };
        segs.push(s); indexSeg(s);
      }
      if (LAMP_ROADS.has(p.highway)) {
        const step = 38; let d = step / 2, side = 1;
        for (let i = 0; i < pts.length - 1; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
          const L = Math.hypot(x2 - x1, y2 - y1); if (L < 1e-6) continue;
          while (d <= L) {
            const t = d / L, off = w / 2 + 1.1;
            const lx = x1 + (x2 - x1) * t + (-(y2 - y1) / L) * off * side;
            const ly = y1 + (y2 - y1) * t + ((x2 - x1) / L) * off * side;
            lamps.push({ x: lx, n: ly }); side = -side; d += step;
          }
          d -= L;
        }
      }
    }

    // ---------- barriers (walls/fences/hedges) if the data ever has them ----------
    if (g.type === 'LineString' && p.barrier && ['wall', 'fence', 'retaining_wall', 'hedge', 'city_wall'].includes(p.barrier)) {
      const h = p.barrier === 'hedge' ? 1.3 : p.barrier === 'fence' ? 1.6 : 2.2;
      const mat = plain(p.barrier === 'hedge' ? '#3f7a3a' : '#d9d2c2');
      const pts = g.coordinates.map((c) => project(c[0], c[1]));
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
        if (L < 0.05) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, 0.35), mat);
        m.position.set((x1 + x2) / 2, h / 2, -(y1 + y2) / 2);
        m.rotation.y = -Math.atan2(-(y2 - y1), x2 - x1);
        m.castShadow = m.receiveShadow = true; group.add(m);
        segColliders.push({ x1, y1, x2, y2 });
      }
    }

    // ---------- polygons ----------
    if (g.type === 'Polygon') {
      const ring = g.coordinates[0].map((c) => project(c[0], c[1]));
      const xs = ring.map((r) => r[0]), ys = ring.map((r) => r[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const mkShape = () => {
        const s = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
        for (let h = 1; h < g.coordinates.length; h++) s.holes.push(new THREE.Path(g.coordinates[h].map((c) => new THREE.Vector2(...project(c[0], c[1])))));
        return s;
      };

      if (p.building) {
        const id = String(p.osm_id), rnd = mulberry32(hashStr(id));
        const over = BUILDING_STYLE[id] || (p.name && BUILDING_STYLE[p.name.toLowerCase()]) || {};
        let levels = over.levels ?? parseInt(p['building:levels']);
        if (!levels) {
          levels = { dormitory: 4, university: 3, retail: 1, commercial: 2, shed: 1, ruins: 1, construction: 3, private: 2 }[p.building] ?? (2 + (rnd() < 0.4 ? 1 : 0));
        }
        let h = over.height ?? parseFloat(p.height) ?? NaN;
        if (!Number.isFinite(h)) h = levels * FLOOR_H;
        if (p.building === 'ruins') h = 2.6;

        let color = over.color;
        if (!color) {
          if (p.building === 'construction') color = '#a3a39d';
          else if (p.building === 'shed') color = '#8d9298';
          else if (p.building === 'retail' || p.building === 'commercial') color = ['#e9c46a', '#e76f51', '#f4a261', '#8ecae6', '#e9d8a6'][Math.floor(rnd() * 5)];
          else if (p.building === 'dormitory') color = ['#e3c9a5', '#d8b08c', '#e8d5b5'][Math.floor(rnd() * 3)];
          else color = PALETTE[Math.floor(rnd() * PALETTE.length)];
        }
        const roofColor = over.roof ?? (rnd() < 0.3 ? '#9c5b43' : '#6d7075');
        const windowed = !['shed', 'ruins'].includes(p.building);
        const wall = new THREE.MeshStandardMaterial({
          color, roughness: 0.92,
          ...(windowed ? { map: fac.map, emissive: 0xffffff, emissiveMap: fac.emissive, emissiveIntensity: 0 } : {}),
        });
        const roof = plain(roofColor);
        const geo = new THREE.ExtrudeGeometry(mkShape(), { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);                         // (x, north, up) -> (X, Y up, -Z)
        const mesh = new THREE.Mesh(geo, [roof, wall]);    // group 0 = caps, group 1 = side walls
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        if (windowed) buildingMats.push({ mat: wall, lit: rnd() < 0.18 ? 0.15 : 0.55 + rnd() * 0.6 });

        colliders.push({ poly: ring, minX, maxX, minY, maxY });
        bPoints.push([(minX + maxX) / 2, (minY + maxY) / 2]);

        // roof water tank
        if (h > 6 && rnd() < 0.5) {
          for (let tries = 0; tries < 6; tries++) {
            const tx = minX + rnd() * (maxX - minX), ty = minY + rnd() * (maxY - minY);
            if (pointInPoly(tx, ty, ring)) {
              const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), plain('#2d6a8a'));
              tank.position.set(tx, h + 0.8, -ty); tank.castShadow = true; group.add(tank); break;
            }
          }
        }
        if (p.name) {
          const s = label(p.name);
          s.position.set((minX + maxX) / 2, h + 6, -(minY + maxY) / 2);
          s.userData = { maxDist: 170, name: p.name.toLowerCase() };
          labels.push(s); group.add(s);
        }
      } else if (p.natural === 'water') {
        const geo = new THREE.ShapeGeometry(mkShape()); geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, waterMat); m.position.y = 0.07; mapGroup.add(m);
      } else if (p.leisure === 'pitch' || p.leisure === 'park') {
        const geo = new THREE.ShapeGeometry(mkShape()); geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, p.leisure === 'pitch' ? pitchMat : parkMat); m.position.y = p.leisure === 'pitch' ? 0.045 : 0.03;
        m.receiveShadow = true; mapGroup.add(m);
      } else if (p.man_made === 'storage_tank') {
        const geo = new THREE.ExtrudeGeometry(mkShape(), { depth: 7, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, plain('#9aa4ad')); m.castShadow = true; group.add(m);
        colliders.push({ poly: ring, minX, maxX, minY, maxY });
      }
    }
  }

  // ---------- roads meshes ----------
  const roadsMesh = ribbonMesh(roadPos, roadIdx, roadMat);
  const pathsMesh = ribbonMesh(pathPos, pathIdx, pathMat);
  mapGroup.add(roadsMesh, pathsMesh);

  // ---------- points: POIs, gates, tower, benches ----------
  const benches = [];
  for (const f of F) {
    const p = f.properties, g = f.geometry;
    if (g.type !== 'Point' || p.indoor) continue;
    const [x, n] = project(g.coordinates[0], g.coordinates[1]);

    if (p.amenity === 'bench') benches.push([x, n]);

    if (p.barrier === 'gate') {
      const r = nearestRoad(x, n, 30);
      const dx = r ? r.seg.x2 - r.seg.x1 : 1, dy = r ? r.seg.y2 - r.seg.y1 : 0, L = Math.hypot(dx, dy) || 1;
      const px = -dy / L, py = dx / L, half = (r ? r.seg.hw : 3) + 1.6;
      const stone = plain('#e4dfd2'), beam = plain('#b8463a');
      for (const s of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(1, 4.2, 1), stone);
        pil.position.set(x + px * half * s, 2.1, -(n + py * half * s)); pil.castShadow = true; group.add(pil);
      }
      const bm = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 1, 0.7, 0.8), beam);
      bm.position.set(x, 4.5, -n); bm.rotation.y = -Math.atan2(-py, px); bm.castShadow = true; group.add(bm);
    }

    if (p.man_made === 'tower') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 34, 6), plain('#b9bec4'));
      mast.position.set(x, 17, -n); mast.castShadow = true; group.add(mast);
      towerBlink = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      towerBlink.position.set(x, 34.5, -n); group.add(towerBlink);
    }

    if (p.name) {
      const low = p.name.toLowerCase();
      if (labels.some((l) => l.userData.name === low)) continue;
      const s = label(p.name, '#ffe08a', 0.8);
      s.position.set(x, 5, -n); s.userData = { maxDist: 70, name: low };
      labels.push(s); group.add(s);
    }
  }
  if (benches.length) {
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.45, 0.5), plain('#7a5a3a'), benches.length);
    const o = new THREE.Object3D();
    benches.forEach(([x, n], i) => {
      const r = nearestRoad(x, n, 30);
      const ang = r ? Math.atan2(r.seg.y2 - r.seg.y1, r.seg.x2 - r.seg.x1) : 0;
      o.position.set(x, 0.3, -n); o.rotation.set(0, -ang, 0); o.updateMatrix(); bm.setMatrixAt(i, o.matrix);
    });
    bm.castShadow = true; group.add(bm);
  }

  // ---------- street lamps ----------
  const goodLamps = lamps.filter((l) => !insideBuilding(l.x, l.n, 0.5));
  lamps.length = 0; lamps.push(...goodLamps);
  let lampHeads = null, lampGlow = null;
  if (lamps.length) {
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), plain('#3d4046'), lamps.length);
    lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 8, 6).translate(0, 6.1, 0), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.1 }), lamps.length);
    const o = new THREE.Object3D();
    lamps.forEach((l, i) => { o.position.set(l.x, 0, -l.n); o.updateMatrix(); poles.setMatrixAt(i, o.matrix); lampHeads.setMatrixAt(i, o.matrix); });
    poles.castShadow = true; group.add(poles, lampHeads);
    const pos = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => pos.set([l.x, 6.1, -l.n], i * 3));
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lampGlow = new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTexture(), size: 9, color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    lampGlow.frustumCulled = false; group.add(lampGlow);
  }
  // real light pool that hops between the lamps nearest to you
  const pool = [];
  for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 32, 2); l.position.set(0, -50, 0); group.add(l); pool.push(l); }

  // ---------- graphs & spawn ----------
  const walkGraph = buildGraph(F, WALKABLE), carGraph = buildGraph(F, DRIVABLE);
  let sx = 0, sn = 0;
  const spawnPt = F.find((f) => f.geometry.type === 'Point' && f.properties.name && f.properties.name.toLowerCase().includes(CONFIG.spawnName));
  if (spawnPt) [sx, sn] = project(spawnPt.geometry.coordinates[0], spawnPt.geometry.coordinates[1]);
  else if (bPoints.length) { sx = bPoints.reduce((a, b) => a + b[0], 0) / bPoints.length; sn = bPoints.reduce((a, b) => a + b[1], 0) / bPoints.length; }
  let best = null, bd = 1e12;
  for (const nd of walkGraph.list) { const d = (nd.x - sx) ** 2 + (nd.n - sn) ** 2; if (d < bd) { bd = d; best = nd; } }
  const spawn = best ? { x: best.x, n: best.n } : { x: sx, n: sn };

  // ======================= runtime =======================
  let labelT = 0, poolT = 0, time = 0;
  const api = {
    group, bounds, colliders, segColliders, segs, walkGraph, carGraph, lamps, spawn, buildingCount: colliders.length,
    insideBuilding, nearRoad, nearestRoad,
    setSatellite(on) { mapGroup.visible = !on; ground.material.color.set(on ? 0x55703f : 0x6f905b); },
    update(dt, night, px, pz) {
      time += dt;
      for (const b of buildingMats) b.mat.emissiveIntensity = night * 1.3 * b.lit;
      if (lampHeads) lampHeads.material.emissiveIntensity = 0.1 + night * 4;
      if (lampGlow) lampGlow.material.opacity = night * 0.85;
      if (towerBlink) towerBlink.visible = Math.sin(time * 3) > 0;

      labelT -= dt;
      if (labelT <= 0) {
        labelT = 0.25;
        for (const s of labels) {
          const d = Math.hypot(s.position.x - px, s.position.z - pz);
          const m = s.userData.maxDist;
          s.visible = d < m; s.material.opacity = Math.min(1, (m - d) / (m * 0.35));
        }
      }
      poolT -= dt;
      if (poolT <= 0) {
        poolT = 0.35;
        if (night < 0.05 || !lamps.length) pool.forEach((l) => (l.intensity = 0));
        else {
          const near = lamps.map((l, i) => [(l.x - px) ** 2 + (-l.n - pz) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, pool.length);
          pool.forEach((l, k) => { const e = near[k]; if (!e) { l.intensity = 0; return; } const lp = lamps[e[1]]; l.position.set(lp.x, 5.6, -lp.n); l.intensity = 38 * night; });
        }
      }
    },
  };
  return api;
}
