// Headless sanity test: builds the world, trees, people, sky and runs a few hundred frames of logic.
import fs from 'node:fs';
import * as THREE from 'three';

const green = new Uint8ClampedArray(256 * 256 * 4);
for (let i = 0; i < green.length; i += 4) { green[i] = 40; green[i + 1] = 80; green[i + 2] = 35; green[i + 3] = 255; }
const ctx = new Proxy({}, { get: (_, k) => (k === 'getImageData' ? () => ({ data: green }) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };

const { buildWorld } = await import('../src/world.js');
const { Trees } = await import('../src/trees.js');
const { Pedestrians, Cars } = await import('../src/people.js');
const { Atmosphere } = await import('../src/atmosphere.js');
const { lonLatToTileF, tileCornerLonLat, project, unproject } = await import('../src/geo.js');

const data = JSON.parse(fs.readFileSync(new URL('../src/nitc.geojson', import.meta.url)));
const fakeRenderer = { capabilities: { getMaxAnisotropy: () => 4 }, toneMappingExposure: 1 };
const world = buildWorld(data, fakeRenderer);
console.log('buildings', world.buildingCount, 'lamps', world.lamps.length, 'segs', world.segs.length,
  'walk nodes', world.walkGraph.list.length, 'car nodes', world.carGraph.list.length, 'spawn', world.spawn);
if (!world.buildingCount || !world.lamps.length || !world.walkGraph.list.length) throw new Error('world empty');

const scene = new THREE.Scene(); scene.add(world.group);
const trees = new Trees(scene, world);
const [lon, lat] = unproject(world.spawn.x, world.spawn.n);
const [fx, fy] = lonLatToTileF(lon, lat, 18);
const [l1, a1] = tileCornerLonLat(Math.floor(fx), Math.floor(fy), 18), [l2, a2] = tileCornerLonLat(Math.floor(fx) + 1, Math.floor(fy) + 1, 18);
const [x1, n1] = project(l1, a1), [x2, n2] = project(l2, a2);
console.log('z18 tile size m', (x2 - x1).toFixed(1), (n1 - n2).toFixed(1));
for (const readable of [true, false]) {
  trees.addTile({ key: 't' + readable, x1, x2, n1, n2, img: {}, readable });
}
console.log('trees (green-pixel + noise fallback)', trees.count);
trees.removeTile('ttrue'); trees.removeTile('tfalse');

const peds = new Pedestrians(scene, world, 50, world.spawn), cars = new Cars(scene, world, 10, world.spawn);
const atmos = new Atmosphere(scene, fakeRenderer);
const cam = new THREE.PerspectiveCamera();
const pp = new THREE.Vector3(world.spawn.x, 0, -world.spawn.n);
for (let i = 0; i < 3000; i++) {
  const h = (i / 3000) * 24;
  peds.update(0.05, pp); cars.update(0.05, pp, 0.5); atmos.update(h, pp, cam); world.update(0.05, atmos.night, pp.x, pp.z);
  for (const p of peds.list) if (!Number.isFinite(p.obj.position.x + p.obj.position.z)) throw new Error('NaN ped');
  for (const c of cars.list) if (!Number.isFinite(c.obj.position.x + c.obj.position.z)) throw new Error('NaN car');
}
console.log('3000 frames OK; peds near', peds.countNear(pp.x, pp.z, 60), 'nearest car', cars.nearestDist(pp.x, pp.z).toFixed(0), 'm');
console.log('night@3h', (atmos.update(3, pp, cam), atmos.night).toFixed(2), 'night@12h', (atmos.update(12, pp, cam), atmos.night).toFixed(2));
