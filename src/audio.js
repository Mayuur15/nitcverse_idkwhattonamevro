import { CONFIG } from './config.js';

// All sound is synthesised with the Web Audio API – no audio files needed.
export class AudioSys {
  constructor() { this.ctx = null; this.muted = false; this.birdT = 2; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }   // brown noise
    this.noise = buf;
    const loop = (off = 0) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, off); return s; };
    const filt = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    // wind with slow gusts
    this.windGain = gain(0.22);
    loop().connect(filt('lowpass', 520)).connect(this.windGain).connect(this.master);
    const gust = ctx.createOscillator(); gust.frequency.value = 0.08;
    const gustAmt = gain(0.1); gust.connect(gustAmt).connect(this.windGain.gain); gust.start();

    // crowd murmur
    this.murGain = gain(0);
    loop(1.3).connect(filt('bandpass', 380, 0.7)).connect(this.murGain).connect(this.master);

    // crickets (night)
    const cricket = ctx.createOscillator(); cricket.frequency.value = 4300;
    const mod = gain(0.5), lfo = ctx.createOscillator(), lfoAmt = gain(0.5);
    lfo.frequency.value = 22; lfo.connect(lfoAmt).connect(mod.gain);
    this.cricketGain = gain(0);
    cricket.connect(mod).connect(this.cricketGain).connect(this.master); cricket.start(); lfo.start();

    // engine hum (nearby cars)
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 55;
    this.engGain = gain(0);
    this.engOsc.connect(filt('lowpass', 220)).connect(this.engGain).connect(this.master); this.engOsc.start();

    if (CONFIG.musicUrl) { this.music = new Audio(CONFIG.musicUrl); this.music.loop = true; this.music.volume = 0.3; this.music.play().catch(() => {}); }
  }

  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.cricketGain.gain.setTargetAtTime(0.022 * s.night, t, 0.5);
    this.murGain.gain.setTargetAtTime(Math.min(0.1, 0.014 * s.pedsNear), t, 0.5);
    const near = Math.max(0, 1 - s.carDist / 45);
    this.engGain.gain.setTargetAtTime(0.1 * near * near, t, 0.2);
    this.engOsc.frequency.setTargetAtTime(52 + near * 14, t, 0.3);
    this.windGain.gain.setTargetAtTime(0.16 + 0.1 * (1 - s.night), t, 1);
    this.birdT -= dt;
    if (this.birdT <= 0) { this.birdT = 1.2 + Math.random() * 3.5; if (1 - s.night > 0.4) this.chirp(1 - s.night); }
  }

  chirp(vol) {
    const ctx = this.ctx, t0 = ctx.currentTime, pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1; pan.connect(this.master);
    const base = 2200 + Math.random() * 1800, n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.13;
      o.type = 'sine'; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.3), t + 0.09);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035 * vol, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.11);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 0.14);
    }
  }

  step(run) {
    if (!this.ctx) return;
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = (run ? 950 : 700) + Math.random() * 200; f.Q.value = 1.1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(run ? 0.5 : 0.38, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random() * 2, 0.1);
  }

  thud() {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
    g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    if (this.music) this.music.muted = this.muted;
    return this.muted;
  }
}
