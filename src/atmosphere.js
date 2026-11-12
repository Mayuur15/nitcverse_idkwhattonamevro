import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { smoothstep, lerp } from './geo.js';
import { CONFIG } from './config.js';

const C = (h) => new THREE.Color(h);
const DAY_FOG = C('#bcd7ee'), DUSK_FOG = C('#f0b58a'), NIGHT_FOG = C('#0b1220');
const SUN_LOW = C('#ff9a50'), SUN_HIGH = C('#fff3df');
const HEMI_SKY_D = C('#bfd9ff'), HEMI_SKY_N = C('#1d2a4d'), HEMI_G_D = C('#6b6a52'), HEMI_G_N = C('#0a0c14');

export class Atmosphere {
  constructor(scene, renderer) {
    this.renderer = renderer; this.night = 0; this.dayT = 1; this.elev = 40;
    this.sky = new Sky(); this.sky.scale.setScalar(2600); scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = CONFIG.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 500 });
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.35;
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6b6a52, 1.5);
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    scene.fog = new THREE.Fog(0xbcd7ee, 220, 1700); this.fog = scene.fog;

    const sp = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.05; v.multiplyScalar(2400); sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; scene.add(this.stars);
    this.dir = new THREE.Vector3(); this.tmp = new THREE.Color();
  }

  update(hour, focus, camera) {
    const elev = 65 * Math.sin(((hour - 6) / 24) * Math.PI * 2);          // degrees; sunrise 6h, noon 12h, sunset 18h
    const az = 90 - (hour - 6) * 15;                                       // east -> south -> west
    this.elev = elev;
    this.dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    this.sky.material.uniforms.sunPosition.value.copy(this.dir);
    this.sky.position.copy(camera.position);

    const dayT = smoothstep(-8, 12, elev), night = 1 - smoothstep(-8, 3, elev);
    this.dayT = dayT; this.night = night;

    this.sun.position.copy(focus).addScaledVector(this.dir, 220); this.sun.target.position.copy(focus);
    this.sun.intensity = 3.6 * smoothstep(-1, 12, elev);
    this.sun.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0, 28, elev));
    this.moon.position.copy(focus).addScaledVector(this.dir, -220); this.moon.target.position.copy(focus);
    this.moon.intensity = 0.7 * night;

    this.hemi.intensity = lerp(0.4, 1.5, dayT);
    this.hemi.color.copy(HEMI_SKY_N).lerp(HEMI_SKY_D, dayT);
    this.hemi.groundColor.copy(HEMI_G_N).lerp(HEMI_G_D, dayT);

    const f = this.tmp.copy(NIGHT_FOG).lerp(DUSK_FOG, smoothstep(-10, 0, elev)).lerp(DAY_FOG, smoothstep(0, 18, elev));
    this.fog.color.copy(f);
    this.renderer.toneMappingExposure = lerp(0.9, 0.55, dayT);
    this.stars.material.opacity = Math.max(0, night - 0.15);
    this.stars.position.copy(camera.position);
  }
}

export function formatHour(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
