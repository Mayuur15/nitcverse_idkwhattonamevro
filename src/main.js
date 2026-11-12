import * as THREE from 'three';
import geojsonRaw from './nitc.geojson?raw';
import { CONFIG } from './config.js';
import { buildWorld } from './world.js';
import { Imagery } from './imagery.js';
import { Trees } from './trees.js';
import { Atmosphere, formatHour } from './atmosphere.js';
import { Player } from './player.js';
import { Pedestrians, Cars } from './people.js';
import { AudioSys } from './audio.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = CONFIG.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'main';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.8, 3000);

// ---------- build everything ----------
const world = buildWorld(JSON.parse(geojsonRaw), renderer);
scene.add(world.group);

const atmos = new Atmosphere(scene, renderer);
const audio = new AudioSys();
const player = new Player({ scene, camera, dom: renderer.domElement, world, audio });
player.teleport(world.spawn.x, world.spawn.n);
const peds = new Pedestrians(scene, world, CONFIG.pedestrians, world.spawn);
const cars = new Cars(scene, world, CONFIG.cars, world.spawn);
const trees = new Trees(scene, world);
const imagery = new Imagery({
  scene, renderer, bounds: world.bounds,
  onTile: (t) => { try { trees.addTile(t); } catch (e) { console.warn('tree tile', e); } },
  onTileRemoved: (k) => trees.removeTile(k),
});
imagery.start(player.x, player.n);
imagery.update(player.x, player.n, 0, true);
const minimap = new Minimap($('mini'), world);

let satellite = imagery.enabled, hour = CONFIG.startHour, note = '';
const setSatellite = (on) => { satellite = on; imagery.setVisible(on); world.setSatellite(on); };
setSatellite(satellite);

// ---------- keys ----------
addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') setSatellite(!satellite);
  if (e.code === 'KeyM') { audio.toggleMute(); note = audio.muted ? 'muted' : ''; }
  if (e.code === 'KeyN') { const presets = [7, 12, 17.5, 21]; hour = presets.find((h) => h > hour + 0.01) ?? presets[0]; }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ---------- start overlay (also unlocks audio) ----------
const go = $('go');
go.disabled = false; go.textContent = 'Click to start';
go.onclick = () => { audio.start(); $('overlay').style.display = 'none'; };

// If satellite tiles can't be fetched (offline / blocked), fall back to the flat map automatically.
setTimeout(() => {
  if (satellite && imagery.stats.loaded === 0 && imagery.stats.failed > 0) { setSatellite(false); note = 'satellite unavailable – showing map'; }
}, 9000);

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsT = 0, frames = 0, fps = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (CONFIG.dayLengthMinutes > 0) hour = (hour + (dt * 24) / (CONFIG.dayLengthMinutes * 60)) % 24;

  player.update(dt);
  const pp = player.obj.position;
  peds.update(dt, pp);
  cars.update(dt, pp, atmos.night);
  atmos.update(hour, pp, camera);
  world.update(dt, atmos.night, pp.x, pp.z);
  imagery.update(player.x, player.n, dt);
  audio.update(dt, { night: atmos.night, pedsNear: peds.countNear(pp.x, pp.z, 30), carDist: cars.nearestDist(pp.x, pp.z) });
  minimap.update(dt, player.x, player.n, player.obj.rotation.y, peds, cars);

  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    $('clock').textContent = formatHour(hour);
    $('status').textContent = `${fps} fps · ${trees.count} trees · satellite ${imagery.enabled ? imagery.stats.loaded + ' tiles' : 'off'}${note ? ' · ' + note : ''}`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
