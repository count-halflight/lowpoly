// Fully synthesized audio (WebAudio). No external assets. Positional via distance + stereo pan.

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ok = false;
    this.last = new Map();
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.music = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 10; this.comp.ratio.value = 6;
      this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
      this.master = c.createGain();
      this.sfx = c.createGain();
      this.mus = c.createGain();
      // shared low-pass: muffles everything for a moment when hurt and stays dull at low health
      this.lp = c.createBiquadFilter();
      this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.6;
      this.baseCut = 20000;
      this.sfx.connect(this.lp);
      this.mus.connect(this.lp);
      this.lp.connect(this.comp);
      this.comp.connect(this.master);
      this.master.connect(c.destination);
      // noise buffer
      const len = c.sampleRate * 1.5;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.ok = true;
      this.music = new Music(this);
    } catch (e) {
      this.ok = false;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.get('master');
    this.sfx.gain.value = s.get('sfx');
    this.mus.gain.value = s.get('music') * 0.55;
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  setListener(x, y, z, yaw) { const l = this.listener; l.x = x; l.y = y; l.z = z; l.yaw = yaw; }

  // Hit muffle: dip the master low-pass and let it recover (k 0..1 = hit strength).
  hurt(k) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, f = this.lp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(200, f.value), t);
    f.exponentialRampToValueAtTime(Math.max(380, 1600 - 1200 * k), t + 0.03);
    f.exponentialRampToValueAtTime(this.baseCut, t + 0.35 + 0.5 * k);
  }

  // 0 = healthy, 1 = hurt, 2 = critical: the world sounds duller the closer you are to death.
  // Called every gameplay frame; the muffle lifts on its own once gameplay stops calling it
  // (menus, results, pause), see Music.tick.
  setLowHp(bucket) {
    if (!this.ok) return;
    this.lowHpAt = this.ctx.currentTime;
    const cut = [20000, 7000, 2400][bucket] || 20000;
    if (cut === this.baseCut) return;
    this.baseCut = cut;
    const t = this.ctx.currentTime, f = this.lp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(200, f.value), t);
    f.exponentialRampToValueAtTime(this.baseCut, t + 0.4);
  }

  setRush(on) { this.rushOn = !!on; }

  throttle(key, ms) {
    const now = performance.now();
    const t = this.last.get(key) || 0;
    if (now - t < ms) return false;
    this.last.set(key, now);
    return true;
  }

  // Returns an output node (gain->panner) for a world position (or null pos for 2D).
  out(vol, pos) {
    const c = this.ctx;
    const g = c.createGain();
    let v = vol;
    if (pos) {
      const l = this.listener;
      const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      v *= 1 / (1 + dist * 0.09);
      if (v < 0.01) return null;
      if (c.createStereoPanner) {
        const p = c.createStereoPanner();
        // listener right vector = (cos yaw, -sin yaw) in xz for yaw rotating about y with forward (-sin, -cos)
        const rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
        const pan = dist > 0.01 ? (dx * rx + dz * rz) / dist : 0;
        p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
        g.connect(p); p.connect(this.sfx);
      } else g.connect(this.sfx);
    } else g.connect(this.sfx);
    g.gain.value = v;
    return g;
  }

  noise(dest, t, dur, type, freq, q, a = 0.002, peak = 1, freqEnd) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.0); src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, type, f0, f1, peak = 1, a = 0.003) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== undefined && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // p: optional per-sound parameter (pump level, streak count, variant...)
  play(name, pos = null, vol = 1, p = 0) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    const o = this.out(vol, pos);
    if (!o) return;
    fn(this, o, this.ctx.currentTime, p);
  }
}

const SFX = {
  pistol(a, o, t) {
    a.noise(o, t, 0.02, 'highpass', 5000, 0.7, 0.0005, 0.9);
    a.noise(o, t, 0.22, 'bandpass', 1800, 0.8, 0.001, 1.2, 500);
    a.tone(o, t, 0.16, 'sine', 160, 40, 1.1);
    a.tone(o, t, 0.05, 'square', 900, 300, 0.25);
    a.noise(o, t + 0.03, 0.45, 'lowpass', 900, 0.7, 0.02, 0.22, 120);
  },
  piercerCharge(a, o, t) { a.tone(o, t, 0.55, 'sawtooth', 220, 1400, 0.12, 0.05); a.tone(o, t, 0.55, 'square', 110, 700, 0.06, 0.05); },
  piercer(a, o, t) {
    a.noise(o, t, 0.02, 'highpass', 6000, 0.7, 0.0005, 1.0);
    a.tone(o, t, 0.4, 'sawtooth', 2200, 90, 0.45);
    a.tone(o, t, 0.3, 'sine', 120, 30, 1.4);
    a.noise(o, t, 0.5, 'bandpass', 2600, 0.6, 0.001, 1.0, 400);
    a.noise(o, t + 0.04, 0.7, 'lowpass', 700, 0.7, 0.02, 0.3, 90);
  },
  rifle(a, o, t) {
    a.noise(o, t, 0.012, 'highpass', 6000, 0.7, 0.0005, 0.6);
    a.noise(o, t, 0.1, 'bandpass', 2400, 0.9, 0.001, 0.9, 900);
    a.tone(o, t, 0.08, 'sine', 140, 50, 0.8);
    a.noise(o, t + 0.05, 0.03, 'bandpass', 3500, 6, 0.001, 0.15);
  },
  rifleHot(a, o, t) {
    a.noise(o, t, 0.1, 'bandpass', 1700, 0.9, 0.001, 0.9, 600);
    a.tone(o, t, 0.08, 'sine', 120, 45, 0.85);
    a.noise(o, t, 0.16, 'highpass', 4000, 0.5, 0.001, 0.25, 9000);
  },
  shotgun(a, o, t) {
    a.noise(o, t, 0.02, 'highpass', 4500, 0.7, 0.0005, 1.0);
    a.noise(o, t, 0.45, 'lowpass', 3000, 0.7, 0.001, 1.5, 300);
    a.tone(o, t, 0.25, 'sine', 110, 30, 1.4);
    a.tone(o, t, 0.12, 'square', 70, 40, 0.35);
    a.noise(o, t + 0.04, 0.6, 'lowpass', 700, 0.7, 0.03, 0.3, 80);
    a.noise(o, t + 0.32, 0.06, 'highpass', 3000, 1, 0.001, 0.4);
    a.noise(o, t + 0.42, 0.07, 'bandpass', 1400, 2, 0.001, 0.4);
  },
  // pumped shotgun blast: heavier and lower the more charges were packed in (p = 1..3)
  shotgunPumped(a, o, t, p) {
    a.noise(o, t, 0.55, 'lowpass', 2600 - p * 300, 0.7, 0.001, 1.6, 200);
    a.tone(o, t, 0.35, 'sine', 95 - p * 10, 25, 1.6);
    a.tone(o, t, 0.2, 'sawtooth', 160, 40, 0.3 + p * 0.1);
    a.noise(o, t + 0.05, 0.7, 'lowpass', 600, 0.7, 0.03, 0.4, 70);
  },
  pump(a, o, t, p) {
    a.noise(o, t, 0.05, 'bandpass', 1300 + p * 500, 4, 0.001, 0.7);
    a.noise(o, t + 0.09, 0.06, 'bandpass', 2200 + p * 500, 4, 0.001, 0.6);
    a.tone(o, t + 0.09, 0.08, 'square', 300 + p * 180, 300 + p * 180, 0.1 + p * 0.04);
  },
  overpump(a, o, t) { a.tone(o, t, 0.15, 'square', 1800, 2400, 0.25); a.tone(o, t + 0.12, 0.15, 'square', 1800, 2600, 0.25); },
  lanceCharge(a, o, t) { a.tone(o, t, 0.6, 'sawtooth', 120, 900, 0.15, 0.05); },
  lance(a, o, t) {
    a.tone(o, t, 0.35, 'sawtooth', 1400, 80, 0.5);
    a.tone(o, t, 0.3, 'square', 300, 60, 0.35);
    a.noise(o, t, 0.3, 'highpass', 2000, 0.5, 0.001, 0.8);
  },
  launcher(a, o, t) {
    a.tone(o, t, 0.2, 'sine', 90, 40, 1.4);
    a.noise(o, t, 0.25, 'bandpass', 600, 1, 0.003, 0.8, 200);
    a.noise(o, t + 0.02, 0.3, 'bandpass', 1800, 1.5, 0.02, 0.2, 600);
  },
  rocket(a, o, t) {
    a.tone(o, t, 0.18, 'sine', 120, 50, 1.2);
    a.noise(o, t, 0.5, 'bandpass', 900, 0.8, 0.005, 0.9, 2600);
    a.noise(o, t, 0.06, 'highpass', 4000, 0.7, 0.001, 0.5);
  },
  freeze(a, o, t) { a.tone(o, t, 0.3, 'triangle', 2400, 600, 0.3); a.noise(o, t, 0.3, 'highpass', 6000, 1, 0.005, 0.3); },
  unfreeze(a, o, t) { a.tone(o, t, 0.25, 'triangle', 500, 2200, 0.3); a.noise(o, t, 0.35, 'bandpass', 1200, 1, 0.005, 0.5, 3000); },
  vent(a, o, t) {
    a.noise(o, t, 0.7, 'bandpass', 700, 0.6, 0.01, 1.3, 2500);
    a.noise(o, t, 0.5, 'lowpass', 400, 1, 0.01, 0.9, 120);
    a.tone(o, t, 0.4, 'sawtooth', 80, 40, 0.4);
  },
  ignite(a, o, t) { a.noise(o, t, 0.2, 'bandpass', 1500, 1, 0.005, 0.35, 600); },
  overheat(a, o, t) { a.tone(o, t, 0.12, 'square', 1200, 1200, 0.18); a.tone(o, t + 0.14, 0.12, 'square', 900, 900, 0.18); a.noise(o, t, 0.6, 'highpass', 5000, 1, 0.01, 0.25); },
  scatter(a, o, t) { for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.02, 0.25, 'sawtooth', 1800 - i * 300, 120, 0.25); a.noise(o, t, 0.25, 'highpass', 2500, 0.5, 0.001, 0.6); },
  split(a, o, t) { a.tone(o, t, 0.2, 'triangle', 2600, 3600, 0.2); a.tone(o, t + 0.03, 0.2, 'triangle', 3100, 4200, 0.15); },
  tether(a, o, t) { a.tone(o, t, 0.3, 'sawtooth', 120, 900, 0.3); a.noise(o, t, 0.3, 'highpass', 3500, 0.7, 0.001, 0.5); },
  tetherHum(a, o, t) { a.tone(o, t, 0.12, 'square', 90 + Math.random() * 40, 70, 0.1); a.noise(o, t, 0.08, 'highpass', 5000, 0.7, 0.001, 0.12); },
  discharge(a, o, t) { a.tone(o, t, 0.4, 'square', 1600, 80, 0.4); a.noise(o, t, 0.35, 'highpass', 3000, 0.7, 0.001, 0.7); },
  variant(a, o, t) { a.noise(o, t, 0.05, 'bandpass', 2400, 4, 0.001, 0.6); a.tone(o, t + 0.06, 0.08, 'square', 700, 1400, 0.12); a.tone(o, t + 0.13, 0.1, 'square', 1400, 1400, 0.1); },
  boost(a, o, t) {
    a.tone(o, t, 0.12, 'sine', 180, 60, 1.2);
    a.noise(o, t, 0.06, 'highpass', 3000, 0.7, 0.001, 0.8);
    a.tone(o, t, 0.35, 'triangle', 900, 2200, 0.3);
  },
  finisher(a, o, t) {
    a.tone(o, t, 0.4, 'sine', 90, 28, 1.6);
    a.noise(o, t, 0.4, 'lowpass', 1400, 1, 0.001, 1.4, 120);
    a.noise(o, t + 0.05, 0.35, 'lowpass', 700, 2, 0.002, 1.0, 100);
    a.tone(o, t + 0.02, 0.5, 'triangle', 1400, 700, 0.25);
  },
  perfectDodge(a, o, t) {
    a.tone(o, t, 0.5, 'triangle', 2800, 1400, 0.3);
    a.tone(o, t + 0.04, 0.5, 'triangle', 4200, 2100, 0.15);
    a.noise(o, t, 0.4, 'bandpass', 3000, 1, 0.01, 0.4, 600);
  },
  rush(a, o, t) {
    a.tone(o, t, 0.9, 'sawtooth', 55, 220, 0.6, 0.02);
    a.tone(o, t, 0.9, 'sawtooth', 56, 225, 0.4, 0.02);
    [440, 554, 659, 880].forEach((f, i) => a.tone(o, t + 0.1 + i * 0.05, 0.4, 'square', f, f, 0.1));
    a.noise(o, t, 0.8, 'lowpass', 3000, 1, 0.01, 0.8, 150);
  },
  rushReady(a, o, t) { [659, 880, 1318].forEach((f, i) => a.tone(o, t + i * 0.06, 0.18, 'square', f, f, 0.1)); },
  rushEnd(a, o, t) { a.tone(o, t, 0.5, 'sawtooth', 220, 55, 0.3); },
  // streak-stepped confirm tick layered over the kill thump (p = streak 1..6)
  killConfirm(a, o, t, p) {
    const f = 880 * Math.pow(1.122, Math.max(0, (p || 1) - 1));
    a.tone(o, t + 0.01, 0.09, 'square', f, f, 0.12);
    a.tone(o, t + 0.05, 0.14, 'triangle', f * 1.5, f * 1.5, 0.12);
  },
  step(a, o, t) { a.noise(o, t, 0.05, 'lowpass', 500 + Math.random() * 300, 1, 0.002, 0.35); a.tone(o, t, 0.04, 'sine', 90, 60, 0.15); },
  arc(a, o, t) {
    a.tone(o, t, 0.09, 'square', 180 + Math.random() * 300, 60, 0.35);
    a.noise(o, t, 0.08, 'highpass', 4000, 0.5, 0.001, 0.5);
  },
  dry(a, o, t) { a.tone(o, t, 0.04, 'square', 1200, 1100, 0.15); },
  reload(a, o, t) {
    a.noise(o, t, 0.05, 'bandpass', 2500, 4, 0.001, 0.6);
    a.noise(o, t + 0.12, 0.06, 'bandpass', 1500, 4, 0.001, 0.6);
  },
  reloadEnd(a, o, t) {
    a.noise(o, t, 0.05, 'bandpass', 3200, 5, 0.001, 0.7);
    a.tone(o, t, 0.04, 'square', 600, 500, 0.12);
  },
  shell(a, o, t) { a.noise(o, t, 0.05, 'bandpass', 2000, 4, 0.001, 0.6); },
  swap(a, o, t) { a.noise(o, t, 0.07, 'bandpass', 1800, 3, 0.001, 0.5); a.noise(o, t + 0.08, 0.05, 'bandpass', 2600, 3, 0.001, 0.4); },
  hit(a, o, t) { a.tone(o, t, 0.05, 'square', 520, 300, 0.25); a.noise(o, t, 0.05, 'bandpass', 1200, 2, 0.001, 0.4); },
  headshot(a, o, t) { a.tone(o, t, 0.12, 'triangle', 1800, 1500, 0.4); a.tone(o, t, 0.06, 'square', 600, 300, 0.2); },
  shieldHit(a, o, t) { a.tone(o, t, 0.08, 'triangle', 2200, 1800, 0.3); },
  kill(a, o, t) {
    a.tone(o, t, 0.25, 'sine', 110, 35, 1.0);
    a.noise(o, t, 0.25, 'lowpass', 1500, 1, 0.001, 0.9, 200);
    a.tone(o, t + 0.02, 0.18, 'triangle', 900, 450, 0.2);
  },
  gib(a, o, t) { a.noise(o, t, 0.3, 'lowpass', 900, 2, 0.002, 1.0, 150); },
  explosion(a, o, t) {
    a.noise(o, t, 0.9, 'lowpass', 2400, 0.5, 0.002, 1.6, 90);
    a.tone(o, t, 0.6, 'sine', 80, 25, 1.6);
    a.noise(o, t, 0.2, 'highpass', 2000, 0.5, 0.001, 0.6);
  },
  enemyShot(a, o, t) { a.tone(o, t, 0.18, 'square', 700, 180, 0.3); a.noise(o, t, 0.08, 'bandpass', 1200, 2, 0.001, 0.4); },
  enemyBurst(a, o, t) { a.noise(o, t, 0.07, 'bandpass', 2000, 1, 0.001, 0.7); a.tone(o, t, 0.05, 'square', 400, 200, 0.2); },
  windup(a, o, t) { a.tone(o, t, 0.35, 'sawtooth', 200, 700, 0.18, 0.05); },
  sniperAim(a, o, t) { a.tone(o, t, 0.12, 'sine', 1400, 1400, 0.18); },
  sniperLock(a, o, t) { a.tone(o, t, 0.3, 'square', 2200, 2200, 0.18); },
  sniperFire(a, o, t) {
    a.noise(o, t, 0.5, 'bandpass', 1400, 0.6, 0.001, 1.6, 300);
    a.tone(o, t, 0.3, 'sawtooth', 600, 60, 0.5);
  },
  lunge(a, o, t) { a.noise(o, t, 0.25, 'bandpass', 800, 1, 0.01, 0.8, 2400); a.tone(o, t, 0.2, 'sawtooth', 200, 90, 0.3); },
  slash(a, o, t) { a.noise(o, t, 0.15, 'highpass', 3000, 1, 0.001, 0.8, 6000); },
  slam(a, o, t) { a.tone(o, t, 0.6, 'sine', 70, 25, 1.6); a.noise(o, t, 0.5, 'lowpass', 600, 1, 0.002, 1.2, 80); },
  radio(a, o, t) {
    for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.09, 0.06, 'square', 1500 + i * 200, 1500 + i * 200, 0.15);
    a.noise(o, t, 0.3, 'bandpass', 2500, 3, 0.01, 0.15);
  },
  backup(a, o, t) { a.tone(o, t, 0.5, 'square', 440, 440, 0.25); a.tone(o, t + 0.5, 0.5, 'square', 330, 330, 0.25); },
  beep(a, o, t) { a.tone(o, t, 0.08, 'square', 1800, 1800, 0.25); },
  droneDive(a, o, t) { a.tone(o, t, 0.5, 'sawtooth', 300, 1500, 0.25); },
  spawn(a, o, t) { a.tone(o, t, 0.5, 'sine', 200, 1200, 0.3, 0.1); a.noise(o, t, 0.5, 'bandpass', 3000, 3, 0.2, 0.25); },
  hurt(a, o, t) { a.tone(o, t, 0.2, 'square', 140, 60, 0.6); a.noise(o, t, 0.15, 'lowpass', 800, 1, 0.001, 0.6); },
  shieldBreak(a, o, t) { a.tone(o, t, 0.3, 'triangle', 1200, 200, 0.5); a.noise(o, t, 0.3, 'highpass', 2500, 1, 0.001, 0.5); },
  pickupHp(a, o, t) { a.tone(o, t, 0.08, 'triangle', 660, 660, 0.3); a.tone(o, t + 0.07, 0.12, 'triangle', 990, 990, 0.3); },
  pickupAmmo(a, o, t) { a.noise(o, t, 0.05, 'bandpass', 2800, 4, 0.001, 0.6); a.tone(o, t + 0.04, 0.08, 'square', 520, 520, 0.12); },
  cache(a, o, t) { [523, 659, 784, 1046].forEach((f, i) => a.tone(o, t + i * 0.07, 0.25, 'triangle', f, f, 0.3)); },
  upgrade(a, o, t) { [392, 523, 659, 784, 1046].forEach((f, i) => a.tone(o, t + i * 0.05, 0.35, 'square', f, f, 0.14)); },
  jump(a, o, t) { a.noise(o, t, 0.08, 'bandpass', 900, 2, 0.002, 0.25); },
  land(a, o, t) { a.tone(o, t, 0.1, 'sine', 120, 50, 0.5); a.noise(o, t, 0.08, 'lowpass', 600, 1, 0.001, 0.3); },
  dash(a, o, t) { a.noise(o, t, 0.25, 'bandpass', 600, 1.5, 0.01, 0.8, 3000); },
  slide(a, o, t) { a.noise(o, t, 0.4, 'bandpass', 900, 0.8, 0.02, 0.35, 500); },
  slamDown(a, o, t) { a.noise(o, t, 0.2, 'bandpass', 2000, 1, 0.01, 0.5, 300); },
  punch(a, o, t) { a.noise(o, t, 0.08, 'lowpass', 1500, 1, 0.001, 0.6); a.tone(o, t, 0.08, 'sine', 160, 70, 0.6); },
  parry(a, o, t) {
    a.tone(o, t, 0.6, 'triangle', 2400, 2300, 0.5);
    a.tone(o, t, 0.6, 'triangle', 3600, 3500, 0.25);
    a.tone(o, t, 0.15, 'sine', 140, 50, 1.0);
  },
  door(a, o, t) { a.tone(o, t, 0.5, 'sawtooth', 70, 110, 0.25, 0.05); a.noise(o, t, 0.5, 'bandpass', 400, 2, 0.05, 0.3); },
  alert(a, o, t) { a.tone(o, t, 0.12, 'square', 880, 880, 0.2); a.tone(o, t + 0.15, 0.12, 'square', 660, 660, 0.2); },
  clear(a, o, t) { [659, 784, 988, 1318].forEach((f, i) => a.tone(o, t + i * 0.09, 0.4, 'square', f, f, 0.12)); },
  rankUp(a, o, t) { a.tone(o, t, 0.15, 'square', 880, 1320, 0.15); },
  ui(a, o, t) { a.tone(o, t, 0.05, 'square', 1000, 1000, 0.12); },
  uiBack(a, o, t) { a.tone(o, t, 0.05, 'square', 600, 600, 0.12); },
  uiHover(a, o, t) { a.tone(o, t, 0.02, 'square', 1800, 1800, 0.05); },
  swing(a, o, t) { a.noise(o, t, 0.5, 'bandpass', 500, 1.5, 0.05, 1.0, 1400); a.tone(o, t, 0.5, 'sawtooth', 90, 50, 0.4); },
  bossRoar(a, o, t) {
    a.tone(o, t, 1.4, 'sawtooth', 110, 45, 0.7, 0.05);
    a.tone(o, t, 1.4, 'sawtooth', 113, 47, 0.6, 0.05);
    a.noise(o, t, 1.2, 'lowpass', 800, 2, 0.05, 0.8, 100);
  },
  bossCharge(a, o, t) { a.tone(o, t, 0.9, 'sawtooth', 60, 240, 0.5, 0.1); },
  bossPhase(a, o, t) { a.tone(o, t, 1.2, 'square', 220, 55, 0.4); a.noise(o, t, 1.0, 'lowpass', 2000, 1, 0.01, 1.0, 100); },
  laser(a, o, t) { a.tone(o, t, 0.6, 'sawtooth', 220, 230, 0.25, 0.05); },
  zap(a, o, t) { a.noise(o, t, 0.12, 'highpass', 3000, 1, 0.001, 0.5); a.tone(o, t, 0.1, 'square', 90, 60, 0.4); },
  sizzle(a, o, t) { a.noise(o, t, 0.15, 'highpass', 5000, 1, 0.005, 0.25); },
  coin(a, o, t) { a.tone(o, t, 0.25, 'triangle', 2600, 3400, 0.25); a.tone(o, t + 0.04, 0.2, 'triangle', 3900, 3900, 0.12); },
  ricochet(a, o, t) { a.tone(o, t, 0.35, 'triangle', 3200, 900, 0.4); a.tone(o, t, 0.12, 'square', 1800, 600, 0.2); a.noise(o, t, 0.08, 'highpass', 5000, 1, 0.001, 0.4); },
  saw(a, o, t) { a.tone(o, t, 0.5, 'sawtooth', 900, 1300, 0.2); a.noise(o, t, 0.4, 'bandpass', 4000, 2, 0.01, 0.3); },
  stick(a, o, t) { a.noise(o, t, 0.06, 'bandpass', 1200, 3, 0.001, 0.5); a.tone(o, t, 0.06, 'square', 300, 200, 0.2); },
  hook(a, o, t) { a.tone(o, t, 0.25, 'sawtooth', 300, 1600, 0.25); a.noise(o, t, 0.15, 'highpass', 3000, 1, 0.001, 0.3); },
  emp(a, o, t) { a.tone(o, t, 0.8, 'sine', 1200, 60, 0.7); a.noise(o, t, 0.6, 'bandpass', 2500, 0.8, 0.002, 0.7, 200); a.tone(o, t, 0.3, 'square', 80, 40, 0.5); },
  terminal(a, o, t) { for (let i = 0; i < 4; i++) a.tone(o, t + i * 0.05, 0.04, 'square', 900 + (i % 2) * 400, 900 + (i % 2) * 400, 0.12); },
  type(a, o, t) { a.tone(o, t, 0.02, 'square', 1400 + Math.random() * 300, 1400, 0.05); },
  sting(a, o, t) { a.tone(o, t, 1.6, 'sawtooth', 55, 52, 0.5, 0.02); a.tone(o, t, 1.6, 'sawtooth', 82, 80, 0.35, 0.02); a.noise(o, t, 1.4, 'lowpass', 400, 2, 0.02, 0.6, 80); a.tone(o, t + 0.05, 0.6, 'square', 880, 440, 0.12); },
  miniSting(a, o, t) { a.tone(o, t, 0.6, 'sawtooth', 110, 90, 0.4, 0.01); a.tone(o, t, 0.25, 'square', 660, 330, 0.15); a.noise(o, t, 0.4, 'lowpass', 900, 1, 0.01, 0.4, 100); },
  levelClear(a, o, t) { [523, 659, 784, 1046, 1318].forEach((f, i) => a.tone(o, t + i * 0.08, 0.6, 'square', f, f, 0.1)); a.tone(o, t, 1.0, 'triangle', 130, 130, 0.3); },
  rank(a, o, t) { a.tone(o, t, 0.5, 'square', 220, 880, 0.2); a.noise(o, t, 0.3, 'lowpass', 2000, 1, 0.001, 0.6, 200); },
  pad(a, o, t) { a.tone(o, t, 0.4, 'sine', 200, 900, 0.5); a.noise(o, t, 0.2, 'bandpass', 1500, 1, 0.001, 0.3); },
  barrel(a, o, t) { a.noise(o, t, 0.06, 'bandpass', 1500, 4, 0.001, 0.5); a.tone(o, t, 0.08, 'square', 180, 120, 0.3); },
  glitch(a, o, t) { for (let i = 0; i < 5; i++) a.tone(o, t + i * 0.03, 0.03, 'square', 200 + Math.random() * 3000, 200, 0.1); },
  heartbeat(a, o, t) { a.tone(o, t, 0.15, 'sine', 70, 40, 0.8); a.tone(o, t + 0.22, 0.15, 'sine', 65, 38, 0.6); },
  death(a, o, t) {
    a.tone(o, t, 1.6, 'sawtooth', 300, 30, 0.6);
    a.noise(o, t, 1.2, 'lowpass', 1200, 1, 0.01, 0.8, 60);
  },
};

// Procedural soundtrack: industrial breakbeat in a minor key. Intensity 0 = ambient drone,
// 1 = combat, 2 = boss.
class Music {
  constructor(audio) {
    this.a = audio;
    this.intensity = 0;
    this.target = 0;
    this.bpm = 138;
    this.step = 0;
    this.nextTime = 0;
    this.root = 45; // A2
    this.prog = [0, 0, -4, -2];
    this.bar = 0;
    this.enabled = true;
    this.heat = 0; this.rush = false;
  }
  midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  set(intensity) { this.target = intensity; }
  // style rank 0..6 adds layers in combat; RUSH adds a driving lead
  setHeat(rank, rush) { this.heat = rank; this.rush = !!rush; }
  tick() {
    const a = this.a;
    if (a.ok && a.baseCut < 20000 && a.ctx.currentTime - (a.lowHpAt || 0) > 0.4) a.setLowHp(0);
    if (!a.ok || a.ctx.state !== 'running' || !this.enabled) return;
    const c = a.ctx;
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.05;
    const spb = 60 / (this.target === 2 ? 156 : this.bpm) / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      this.play(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) { this.bar++; this.intensity = this.target; }
    }
  }
  play(s, t, spb) {
    const a = this.a, o = a.mus, I = this.intensity;
    const chordRoot = this.root + this.prog[this.bar % 4];
    if (I === 0) {
      if (s === 0 && this.bar % 2 === 0) {
        a.tone(o, t, spb * 30, 'triangle', this.midi(chordRoot - 12), undefined, 0.22, 0.8);
        a.tone(o, t, spb * 30, 'sine', this.midi(chordRoot + 7 - 12), undefined, 0.12, 1.2);
      }
      if (s % 4 === 2 && Math.random() < 0.25) a.tone(o, t, 0.3, 'sine', this.midi(chordRoot + 24 + [0, 3, 7, 10][Math.floor(Math.random() * 4)]), undefined, 0.04, 0.02);
      return;
    }
    // kick
    const kickPat = I === 2 ? [0, 3, 6, 8, 10, 14] : [0, 6, 8, 11];
    if (kickPat.includes(s)) a.tone(o, t, 0.22, 'sine', 150, 38, 0.9);
    // snare
    if (s === 4 || s === 12) { a.noise(o, t, 0.18, 'bandpass', 1800, 0.7, 0.001, 0.55); a.tone(o, t, 0.08, 'triangle', 220, 160, 0.3); }
    if (I === 2 && (s === 15) && this.bar % 2 === 1) a.noise(o, t, 0.1, 'bandpass', 1800, 0.7, 0.001, 0.4);
    // hats
    if (s % 2 === 0 || I === 2) a.noise(o, t, s % 4 === 2 ? 0.08 : 0.03, 'highpass', 7000, 0.7, 0.001, s % 4 === 2 ? 0.2 : 0.1);
    // bass
    const bassPat = [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 3, 0, 7, 10];
    if (s % 2 === 0 || I === 2) {
      const n = chordRoot - 12 + bassPat[s];
      a.tone(o, t, spb * 0.9, 'sawtooth', this.midi(n), undefined, 0.16, 0.004);
    }
    // lead arp in boss mode
    if (I === 2 && s % 2 === 1) {
      const arp = [0, 3, 7, 12, 15, 12, 7, 3];
      a.tone(o, t, spb * 0.8, 'square', this.midi(chordRoot + 12 + arp[(s >> 1) % 8]), undefined, 0.05);
    }
    // style layers: ghost hats (B), chord stabs (A), arp (S), sub + fills (SS)
    const H = this.heat;
    if (H >= 2 && s % 2 === 1 && I !== 2) a.noise(o, t, 0.02, 'highpass', 8000, 0.7, 0.001, 0.06);
    if (H >= 3 && (s === 0 || s === 10)) for (const iv of [0, 3, 7]) a.tone(o, t, spb * 1.6, 'square', this.midi(chordRoot + 12 + iv), undefined, 0.035, 0.004);
    if (H >= 4 && I !== 2 && s % 2 === 1) {
      const arp = [0, 7, 3, 10, 12, 7, 3, 0];
      a.tone(o, t, spb * 0.7, 'square', this.midi(chordRoot + 24 + arp[(s >> 1) % 8]), undefined, 0.03);
    }
    if (H >= 5 && s % 4 === 0) a.tone(o, t, spb * 2, 'sine', this.midi(chordRoot - 24), undefined, 0.22, 0.004);
    if (H >= 5 && this.bar % 4 === 3 && s >= 12) a.noise(o, t, 0.07, 'bandpass', 1900, 0.7, 0.001, 0.25 + (s - 12) * 0.06);
    if (this.rush && s % 2 === 0) {
      const lead = [12, 12, 15, 12, 19, 17, 15, 10];
      a.tone(o, t, spb * 1.4, 'sawtooth', this.midi(chordRoot + lead[(s >> 1) % 8]), undefined, 0.045, 0.004);
    }
  }
}
