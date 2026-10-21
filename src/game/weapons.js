import * as THREE from 'three';
import { damp, clamp, raySphere } from '../core/collide.js';
import { Viewmodel } from './viewmodel.js';

export const WEAPON_ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];

// Each weapon has two variants that swap its alt-fire and tweak its behaviour. Press the
// weapon's number again (or tap its chip again) to cycle. Variant 0 is the classic weapon.
export const DEFS = {
  hammer: {
    name: 'HAMMER', full: 'HAMMER .50 REVOLVER', desc: 'Heavy six-shooter. Brutal headshots, never runs dry. ALT: flip a coin and shoot it to ricochet a guaranteed headshot.', kind: 'hitscan',
    mag: 6, reserve: Infinity, maxReserve: Infinity, rate: 3.4, auto: false, dmg: 44, head: 2.5, spread: 0.002, moveSpread: 0.01,
    recoil: 0.09, kick: 0.07, reload: 1.15, range: 160, tracer: 0xfff0b0, sound: 'pistol', flash: 0xffc070, shake: 0.13, color: '#ffd27a',
    alt: 'COIN', altDesc: 'Coin toss: shoot a coin to ricochet into the nearest head (x2, chains).',
    punch: [0.32, 0.22], fovKick: 1.2, flashScale: 1.15,
    variants: [
      { id: 'marksman', name: 'MARKSMAN', desc: 'Coin-flipping trick revolver.', altDesc: 'ALT flips a coin. Shoot it to ricochet a guaranteed headshot; coins chain.', color: '#ffd27a' },
      { id: 'piercer', name: 'PIERCER', desc: 'Charged penetrator rounds.', altDesc: 'Hold ALT to charge, then FIRE or let go: a 2.6x round that pierces every enemy in line.', color: '#5ad8ff' },
    ],
  },
  ripsaw: {
    name: 'RIPSAW', full: 'RIPSAW BATTLE RIFLE', desc: 'Full-auto silver rifle. Spread blooms on long bursts. ALT: launch a bouncing sawblade (4 rounds).', kind: 'hitscan',
    mag: 30, reserve: 150, maxReserve: 270, rate: 11, auto: true, dmg: 14, head: 1.9, spread: 0.008, moveSpread: 0.01, bloom: 0.0045, maxBloom: 0.05,
    recoil: 0.024, kick: 0.025, reload: 1.5, range: 120, tracer: 0xffd890, sound: 'rifle', flash: 0xffb060, shake: 0.035, color: '#8ff4e4',
    alt: 'SAWBLADE', altDesc: 'Sawblade: bounces off walls 3 times and shreds everything it passes.',
    punch: [0.05, 0.05], fovKick: 0, flashScale: 0.8,
    variants: [
      { id: 'sawblade', name: 'SAWBLADE', desc: 'Ricocheting saw launcher.', altDesc: 'ALT spends 4 rounds on a sawblade that bounces off walls 3 times and shreds everything.', color: '#8ff4e4' },
      { id: 'inferno', name: 'INFERNO', desc: 'Firing builds heat; hot rounds set targets ablaze.', altDesc: 'ALT vents all heat as a cone of fire that ignites everything ahead. At full heat the rifle slows until vented.', color: '#ff7a2a' },
    ],
  },
  breacher: {
    name: 'BREACHER', full: 'BREACHER PUMP SHOTGUN', desc: 'Nine pellets of close-range deletion. ALT: eject a live core shell; shoot it mid-air for a huge blast.', kind: 'hitscan',
    mag: 6, reserve: 30, maxReserve: 54, rate: 1.3, auto: false, dmg: 11, head: 1.4, pellets: 9, spread: 0.075, moveSpread: 0.0, falloff: [9, 24],
    recoil: 0.2, kick: 0.12, reloadShell: 0.42, range: 60, tracer: 0xffc070, sound: 'shotgun', flash: 0xffa040, shake: 0.28, knock: 7, color: '#ff8a3a',
    alt: 'CORE EJECT', altDesc: 'Core eject (2 shells): lobbed explosive. Shoot it in the air to detonate it bigger.',
    punch: [0.55, 0.4], fovKick: 2.5, flashScale: 1.6,
    variants: [
      { id: 'core', name: 'CORE EJECT', desc: 'Lobs a live core shell.', altDesc: 'ALT ejects a core shell (2 shells). Shoot it mid-air to detonate it bigger, or punch it.', color: '#ff8a3a' },
      { id: 'pump', name: 'PUMP CHARGE', desc: 'Pack extra charges into the next blast.', altDesc: 'ALT pumps a charge (up to 3) for a harder, wider blast with recoil. A 4th pump overloads and explodes in your hands.', color: '#ff4a6a' },
    ],
  },
  lance: {
    name: 'LUMEN LANCE', full: 'LUMEN LANCE RAILCANNON', desc: 'Hold to charge, release to fire a beam that pierces every enemy and shield. ALT: scope in for +25% headshots.', kind: 'beam',
    mag: 6, reserve: 24, maxReserve: 42, chargeTime: 0.6, dmgMin: 32, dmgMax: 125, head: 1.6, rate: 2.2,
    recoil: 0.14, kick: 0.1, reload: 1.8, range: 160, sound: 'lance', flash: 0x40e0ff, shake: 0.3, color: '#40e0ff',
    alt: 'SCOPE', altDesc: 'Hold to scope. Scoped headshots deal +25%.',
    punch: [0.45, 0.2], fovKick: 3, flashScale: 1.3,
    variants: [
      { id: 'scope', name: 'SCOPE', desc: 'Precision railcannon.', altDesc: 'Hold ALT to scope in. Scoped headshots deal +25%.', color: '#40e0ff' },
      { id: 'splitter', name: 'SPLITTER', desc: 'Charged beams fork into seekers on impact.', altDesc: 'ALT fires an instant five-beam fan (1 cell). Charged beams split where they land and seek nearby enemies.', color: '#c070ff' },
    ],
  },
  thumper: {
    name: 'THUMPER', full: 'THUMPER DRUM LAUNCHER', desc: 'Arcing grenades, 4.5m blast. Rocket-jump off your own explosions. ALT: sticky mines, ALT again to detonate.', kind: 'grenade',
    mag: 5, reserve: 15, maxReserve: 30, rate: 1.4, dmg: 95, radius: 4.5, speed: 30,
    recoil: 0.16, kick: 0.12, reload: 2.0, sound: 'launcher', flash: 0xff8030, shake: 0.2, color: '#ff5a3a',
    alt: 'STICKY', altDesc: 'Sticky mine: clings to walls and enemies. Press ALT again to detonate all.',
    punch: [0.4, 0.2], fovKick: 1.5, flashScale: 1.2,
    variants: [
      { id: 'sticky', name: 'STICKY', desc: 'Arcing grenades and remote mines.', altDesc: 'ALT throws a sticky mine; ALT again detonates every mine. Punch a fresh grenade to bat it.', color: '#ff5a3a' },
      { id: 'freeze', name: 'FREEZEFRAME', desc: 'Straight-flying rockets you can stop in mid-air.', altDesc: 'Fires rockets. ALT freezes them in mid-air; ALT again sends every frozen rocket at your crosshair. Punch a rocket to bat it.', color: '#6ad0ff' },
    ],
  },
  arc: {
    name: 'ARC CASTER', full: 'ARC CASTER TESLA PROJECTOR', desc: 'Auto-targets the nearest threat and chains lightning. ALT: EMP overload stuns everything nearby and erases enemy shots.', kind: 'arc',
    mag: 48, reserve: 96, maxReserve: 192, rate: 8.5, auto: true, dmg: 10, range: 16, jumps: 3, jumpRange: 7,
    recoil: 0.02, kick: 0.015, reload: 1.6, sound: 'arc', flash: 0x9a80ff, shake: 0.03, color: '#b0a0ff',
    alt: 'EMP', altDesc: 'EMP overload (12 cells, 6s cooldown): stun + projectile wipe in 7m.',
    punch: [0.03, 0.03], fovKick: 0, flashScale: 0.7,
    variants: [
      { id: 'emp', name: 'EMP', desc: 'Area overload.', altDesc: 'ALT: EMP overload (12 cells, 6s cooldown) stuns everything in 7m and erases enemy shots.', color: '#b0a0ff' },
      { id: 'tether', name: 'TESLA TETHER', desc: 'Lock a lightning tether onto one target.', altDesc: 'ALT tethers the enemy you aim at (6 cells): constant shocks, and every arc starts from it with +2 jumps. It discharges when the target dies.', color: '#7affd8' },
    ],
  },
};

const VFLASH = { piercer: 0x80e0ff, inferno: 0xff7a2a, pump: 0xff6a4a, splitter: 0xc070ff, freeze: 0x8ae0ff, tether: 0x7affd8 };
const PREF_KEY = 'vg-variants';
const PUMP_MUL = [1, 1.35, 1.75, 2.3];

// Aiming down sights (any weapon, fire freely while aiming): zoom = FOV factor, spread = spread
// factor, move = ground speed factor. The railcannon's SCOPE variant gets a real scope.
const ADS = {
  hammer: { zoom: 0.78, spread: 0.3, move: 1 },
  ripsaw: { zoom: 0.8, spread: 0.4, move: 0.95 },
  breacher: { zoom: 0.9, spread: 0.72, move: 1 },
  lance: { zoom: 0.4, spread: 1, move: 0.85, scope: true },
  thumper: { zoom: 0.86, spread: 1, move: 1 },
  arc: { zoom: 0.86, spread: 1, move: 1 },
};
const QUICKSCOPE_WINDOW = 0.6; // seconds after the sights come up
// ---------------------------------------------------------------------------------------
export class Weapons {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xb0b8ff, 0x302830, 1.5);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.4);
    this.dir.position.set(-0.4, 1, 0.6);
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 2.5, 1.5);
    this.muzzleLight.position.set(0.25, -0.1, -0.8);
    // a cool rim from behind-right so chrome edges read against dark rooms (fixed light count)
    this.rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
    this.rim.position.set(0.8, 0.3, -1);
    this.scene.add(this.hemi, this.dir, this.muzzleLight, this.rim);
    this.vm = new Viewmodel(this);
    this.models = this.vm.models;
    this.holder = this.vm.holder;
    this.mats = this.vm.M;
    this.coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.018, 10);
    this.coinMat = this.vm.brassMat; // polished gold matcap, reads under any room light
    this.coins = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.coinGeo, this.coinMat);
      m.visible = false;
      game.scene.add(m);
      this.coins.push({ mesh: m, alive: false, pos: m.position, vel: new THREE.Vector3(), t: 0, glintT: 0 });
    }
    this.tmpV = new THREE.Vector3(); this.tmpD = new THREE.Vector3(); this.muzzleW = new THREE.Vector3();
    this.tmpC = new THREE.Color(); this.accBase = new THREE.Color();
    this.variant = {};
    this.reset();
  }

  reset() {
    this.owned = ['hammer', 'ripsaw'];
    this.ammo = {};
    for (const id of WEAPON_ORDER) this.ammo[id] = { mag: DEFS[id].mag, reserve: DEFS[id].reserve };
    this.current = 'hammer';
    this.last = 'ripsaw';
    this.cooldown = 0; this.altCd = 0; this.empCd = 0;
    this.reloadT = 0; this.reloading = false; this.reloadTotal = 1;
    this.switchT = 0; this.switchTo = null;
    this.charge = 0; this.charging = false;
    this.bloom = 0;
    this.hitCounter = 0;
    this.recoilAccum = 0;
    this.punchAnim = 0; this.kickAnim = false; this.pumpT = 0; this.autoReloadT = 0;
    this.cylAngle = 0; this.cylTarget = 0; this.drumAngle = 0; this.boltT = 0;
    this.coinCharges = 4;
    // variant state
    this.pierceCharge = 0;
    this.heat = 0; this.heatIdle = 0; this.overheated = false;
    this.pumpLevel = 0;
    this.freezeOn = false; this.freezeT = 0;
    this.tether = null;
    this.flourish = 0; this.finisherGlow = 0;
    this.adsK = 0; this.adsOn = false; this.adsStart = -9; this.qsUsed = false; this.scopeK = 0;
    for (const c of this.coins) { c.alive = false; c.mesh.visible = false; }
    this.vm.reset();
    // remembered variant picks carry between runs; the training deck always uses the classics
    const pref = this.game.mode === 'tutorial' ? {} : this.loadPrefs();
    for (const id of WEAPON_ORDER) this.variant[id] = clamp(pref[id] | 0, 0, DEFS[id].variants.length - 1);
    for (const id of WEAPON_ORDER) { this.models[id].visible = id === this.current; this.applyVariantVisual(id); }
  }

  // checkpoint support
  snapshot() { return { owned: this.owned.slice(), ammo: JSON.parse(JSON.stringify(this.ammo, (k, v) => (v === Infinity ? 'INF' : v))), current: this.current, variant: { ...this.variant } }; }
  restore(s) {
    this.reset();
    this.owned = s.owned.slice();
    for (const id of WEAPON_ORDER) {
      const a = s.ammo[id];
      if (a) this.ammo[id] = { mag: a.mag, reserve: a.reserve === 'INF' ? Infinity : a.reserve };
      if (s.variant && s.variant[id] !== undefined) this.variant[id] = clamp(s.variant[id] | 0, 0, DEFS[id].variants.length - 1);
      this.applyVariantVisual(id);
    }
    for (const id of WEAPON_ORDER) this.models[id].visible = false;
    this.current = this.owned.includes(s.current) ? s.current : this.owned[0];
    this.models[this.current].visible = true;
  }

  def(id = this.current) { return DEFS[id]; }
  magSize(id = this.current) { return Math.max(1, Math.round(DEFS[id].mag * this.game.player.stats.magMul)); }

  // ---------------------------------------------------------------- variants
  /** Current variant object { id, name, desc, altDesc, color } of a weapon (or null). */
  variantInfo(id = this.current) {
    const d = DEFS[id];
    if (!d || !d.variants) return null;
    return d.variants[this.variant[id] || 0] || null;
  }
  // ---------------------------------------------------------------- aiming
  hasScope() { return this.current === 'lance' && this.variantId('lance') !== 'splitter'; }
  // FOV factor for the camera (1 = hip fire)
  get adsZoom() {
    const z = this.current === 'lance' && !this.hasScope() ? 0.62 : (ADS[this.current] || ADS.hammer).zoom;
    return 1 - (1 - z) * (this.adsK || 0);
  }
  get adsMove() { return 1 - (1 - (ADS[this.current] || ADS.hammer).move) * (this.adsK || 0); }
  // inside the quick-scope window right now (sights just came up, nothing fired from it yet)
  quickScopeLive() { return this.adsOn && !this.qsUsed && this.adsK > 0.5 && this.game.time - this.adsStart <= QUICKSCOPE_WINDOW; }

  variantId(id = this.current) { const v = this.variantInfo(id); return v ? v.id : ''; }

  cycleVariant(id = this.current) {
    const g = this.game, d = DEFS[id];
    if (!d || !d.variants || d.variants.length < 2 || this.switchTo) return;
    this.clearVariantState(id);
    this.variant[id] = (this.variant[id] + 1) % d.variants.length;
    this.applyVariantVisual(id);
    const v = this.variantInfo(id);
    this.flourish = 0.32;
    this.cooldown = Math.max(this.cooldown, 0.15);
    g.audio.play('variant', null, 0.7);
    g.hud.toast(d.name + ' · ' + v.name, v.color);
    if (g.mode !== 'tutorial' && g.hint) g.hint(v.name + ': ' + v.altDesc, 4.5);
    this.savePrefs();
    g.emit('variant', { weapon: id, variant: v.id });
  }

  clearVariantState(id) {
    if (id === 'hammer') this.pierceCharge = 0;
    else if (id === 'ripsaw') { this.heat = 0; this.overheated = false; }
    else if (id === 'breacher') this.pumpLevel = 0;
    else if (id === 'thumper' && this.freezeOn) this.releaseRockets(false);
    else if (id === 'arc') this.tether = null;
  }

  applyVariantVisual(id) {
    const m = this.models[id];
    if (!m) return;
    const an = m.userData.anim, vid = this.variantId(id);
    for (const k in an.var) for (const pc of an.var[k]) pc.visible = k === vid;
    const v = this.variantInfo(id);
    if (!m.userData.accBase) m.userData.accBase = new THREE.Color();
    m.userData.accBase.set(v ? v.color : '#ffffff');
    m.userData.acc.color.copy(m.userData.accBase);
  }

  loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; }
  }
  savePrefs() {
    if (this.game.mode === 'tutorial') return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.variant)); } catch { /* storage blocked */ }
  }

  give(id) {
    if (!this.owned.includes(id)) {
      this.owned.push(id);
      this.owned.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b));
      this.ammo[id].mag = this.magSize(id);
      this.ammo[id].reserve = DEFS[id].reserve;
    }
    this.select(id);
  }

  select(id) {
    if (!this.owned.includes(id) || id === this.current || this.switchTo) return;
    this.switchTo = id;
    this.switchT = 0.32;
    this.reloading = false;
    this.charging = false; this.charge = 0;
    this.pierceCharge = 0;
    this.game.audio.play('swap', null, 0.6);
    this.game.emit('swap', id);
  }

  addAmmo(id, frac) {
    const d = DEFS[id];
    if (!isFinite(d.maxReserve)) return 0;
    const a = this.ammo[id];
    const amt = Math.ceil(d.mag * frac * this.game.player.stats.pickupMul);
    const before = a.reserve;
    a.reserve = Math.min(d.maxReserve * this.game.player.stats.magMul, a.reserve + amt);
    return a.reserve - before;
  }

  neediest() {
    let best = null, bf = 2;
    for (const id of this.owned) {
      const d = DEFS[id];
      if (!isFinite(d.maxReserve)) continue;
      const f = (this.ammo[id].reserve + this.ammo[id].mag) / (d.maxReserve + d.mag);
      if (f < bf) { bf = f; best = id; }
    }
    return best;
  }

  onPunch() { this.punchAnim = 0.28; this.kickAnim = false; }
  // slide kick: same timing as a punch, but the strike comes in low from below the frame
  onKick() { this.kickAnim = true; }
  onParry() { this.vm.onParry(); }
  // movement feedback for the viewmodel: 'land' (k = impact 0..1), 'jump', 'dash', 'vault'
  onMove(kind, k) { this.vm.onMove(kind, k); }

  // Finisher reward: a full magazine now, a little reserve for everything else.
  onFinisher() {
    const a = this.ammo[this.current];
    a.mag = Math.max(a.mag, this.magSize());
    this.reloading = false;
    for (const id of this.owned) if (id !== this.current) this.addAmmo(id, 0.25);
    this.coinCharges = Math.min(this.game.player.stats.coinMax, this.coinCharges + 1);
    this.finisherGlow = 0.5;
  }

  // RUSH start: topped-up magazine, coins and EMP ready.
  onRush() {
    const a = this.ammo[this.current];
    a.mag = Math.max(a.mag, this.magSize());
    this.reloading = false;
    this.coinCharges = this.game.player.stats.coinMax;
    this.empCd = 0;
    this.flourish = 0.32;
  }

  altInfo() {
    const id = this.current, v = this.variantId(id);
    if (id === 'hammer') {
      if (v === 'piercer') return this.pierceCharge > 0 ? (this.pierceCharge >= 1 ? 'PIERCER READY' : 'PIERCER ' + Math.round(this.pierceCharge * 100) + '%') : 'HOLD ALT: PIERCER';
      return 'COINS ' + Math.floor(this.coinCharges);
    }
    if (id === 'ripsaw' && v === 'inferno') return this.overheated ? 'OVERHEAT · ALT TO VENT' : 'HEAT ' + Math.round(this.heat * 100) + '%';
    if (id === 'breacher' && v === 'pump') return this.pumpLevel ? 'PUMP ' + this.pumpLevel + '/3' + (this.pumpLevel >= 3 ? ' · MAX' : '') : 'ALT: PUMP';
    if (id === 'lance' && v === 'splitter') return this.altCd > 0 ? 'SCATTER ' + this.altCd.toFixed(1) + 's' : 'SCATTER READY';
    if (id === 'arc') {
      if (v === 'tether') return this.tether ? 'TETHER ' + Math.max(0, this.tether.t).toFixed(1) + 's' : 'ALT: TETHER';
      return this.empCd > 0 ? 'EMP ' + this.empCd.toFixed(1) + 's' : 'EMP READY';
    }
    if (id === 'thumper') {
      if (v === 'freeze') { if (!this.freezeOn) return 'ALT: FREEZE'; const n = this.game.projectiles.list.filter((p) => p.active && p.kind === 'rocket' && p.frozen).length; return 'FROZEN ' + n + ' · ALT FIRE'; }
      const n = this.game.projectiles.list.filter((p) => p.active && p.kind === 'sticky').length; return n ? 'MINES ' + n + ' - ALT TO BLOW' : '';
    }
    return '';
  }

  startReload() {
    const id = this.current, d = DEFS[id], a = this.ammo[id];
    if (this.reloading || this.switchTo || a.mag >= this.magSize() || a.reserve <= 0) return false;
    this.reloading = true;
    this.charging = false; this.charge = 0; this.pierceCharge = 0;
    this.reloadTotal = this.reloadT = (d.reloadShell || d.reload) / this.game.player.stats.reloadMul;
    this.game.audio.play('reload', null, 0.7);
    this.game.emit('reload');
    return true;
  }

  update(dt, input) {
    const g = this.game;
    const p = g.player;
    this.cooldown -= dt; this.altCd -= dt; this.empCd -= dt;
    this.punchAnim -= dt; this.pumpT -= dt; this.boltT -= dt; this.flourish -= dt; this.finisherGlow -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.coinCharges = Math.min(p.stats.coinMax, this.coinCharges + dt * 0.9);
    if (this.recoilAccum > 0) {
      const rec = this.recoilAccum * Math.min(1, dt * (input.fire && DEFS[this.current].auto ? 3 : 7));
      p.pitch -= rec; this.recoilAccum -= rec;
      if (this.recoilAccum < 1e-4) this.recoilAccum = 0;
    }
    this.updateCoins(dt);
    this.updateStatus(dt);

    // weapon select; picking the weapon you already hold cycles its variant
    if (input.slot >= 0 && input.slot < WEAPON_ORDER.length) {
      const sid = WEAPON_ORDER[input.slot];
      if (sid === this.current && !this.switchTo) this.cycleVariant(sid); else this.select(sid);
    }
    if (input.chipTap && input.chipTap === this.current && !this.switchTo) this.cycleVariant(this.current);
    if (input.wheel) {
      const i = this.owned.indexOf(this.current);
      this.select(this.owned[(i + (input.wheel > 0 ? 1 : -1) + this.owned.length) % this.owned.length]);
    }
    if (input.wasPressed('lastWeapon')) {
      if (input.usingTouch) { const i = this.owned.indexOf(this.current); this.select(this.owned[(i + 1) % this.owned.length]); }
      else if (this.owned.includes(this.last)) this.select(this.last);
    }
    if (this.switchTo) {
      this.switchT -= dt;
      if (this.switchT <= 0.16 && this.current !== this.switchTo) {
        this.models[this.current].visible = false;
        this.last = this.current;
        this.current = this.switchTo;
        this.models[this.current].visible = true;
        this.cooldown = Math.max(this.cooldown, 0.12);
        this.vm.onDraw(this.current);
      }
      if (this.switchT <= 0) {
        this.switchTo = null;
        if (p.tipOnce && this.owned.length > 1) p.tipOnce('variant', 'Every weapon has two VARIANTS. Press the number of the weapon you are holding again to swap.', 'Every weapon has two VARIANTS. Tap the icon of the weapon you are holding to swap.');
      }
    }

    const id = this.current, d = DEFS[id], a = this.ammo[id];
    const vid = this.variantId(id);
    // ADS: the AIM input (or the SCOPE variant's ALT) brings the sights up; firing stays live
    const wantAds = input.aiming || (id === 'lance' && vid !== 'splitter' && input.alt);
    const adsOn = wantAds && !this.reloading && !this.switchTo && p.alive;
    if (adsOn && !this.adsOn) { this.adsStart = g.time; this.qsUsed = false; g.audio.play('scopeIn', null, this.hasScope() ? 0.8 : 0.35); }
    else if (!adsOn && this.adsOn) g.audio.play('scopeOut', null, this.hasScope() ? 0.6 : 0.25);
    this.adsOn = adsOn;
    input.ads = adsOn;
    this.adsK = damp(this.adsK || 0, adsOn ? 1 : 0, id === 'lance' ? 16 : 13, dt);
    this.scopeK = this.hasScope() ? clamp((this.adsK - 0.55) / 0.35, 0, 1) : 0;

    // RELOAD with a full magazine inspects the gun instead
    if (input.wasPressed('reload') && !this.startReload() && a.mag >= this.magSize()) this.vm.inspect();
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (d.reloadShell) {
          a.mag++; a.reserve--;
          g.audio.play('shell', null, 0.7);
          if (a.mag < this.magSize() && a.reserve > 0 && !(input.fire && a.mag > 0)) this.reloadT = this.reloadTotal;
          else { this.reloading = false; this.pumpT = 0.3; g.audio.play('reloadEnd', null, 0.6); }
        } else {
          const take = Math.min(this.magSize() - a.mag, a.reserve);
          a.mag += take;
          if (isFinite(a.reserve)) a.reserve -= take;
          this.reloading = false;
          g.audio.play('reloadEnd', null, 0.7);
        }
      }
    }
    if (a.mag <= 0 && !this.reloading && !this.switchTo && a.reserve > 0) {
      this.autoReloadT += dt;
      if (this.autoReloadT > 0.18) { this.autoReloadT = 0; this.startReload(); }
    } else this.autoReloadT = 0;

    // ripsaw heat bleeds off once you stop shooting
    if (this.heat > 0) {
      if (id === 'ripsaw' && input.fire) this.heatIdle = 0; else this.heatIdle += dt;
      if (this.heatIdle > 0.5) this.heat = Math.max(0, this.heat - dt * 0.2);
      if (this.overheated && this.heat < 0.45) this.overheated = false;
    }
    // freezeframe auto-release
    if (this.freezeOn) { this.freezeT -= dt; if (this.freezeT <= 0) this.releaseRockets(true); }

    if (input.usingTouch && g.settings.get('aimAssist') && input.fire) this.aimAssist(dt);
    if (input.wasPressed('altTap') && !this.switchTo && p.alive) this.altFire(id, d, a);

    // PIERCER: hold ALT to charge, release ALT or press FIRE to loose the round
    if (id === 'hammer' && vid === 'piercer' && !this.switchTo && p.alive) {
      if (input.alt && a.mag > 0 && !this.reloading) {
        if (this.pierceCharge <= 0) g.audio.play('piercerCharge', null, 0.6);
        const was = this.pierceCharge;
        this.pierceCharge = Math.min(1, this.pierceCharge + dt / 0.55);
        if (was < 1 && this.pierceCharge >= 1) g.audio.play('beep', null, 0.4);
      }
      if (this.pierceCharge >= 1 && (input.firePressed || !input.alt) && this.cooldown <= 0 && a.mag > 0) {
        this.firePiercer(d, a);
        this.pierceCharge = 0;
        this.cooldown = 0.5;
      } else if (!input.alt && this.pierceCharge < 1) this.pierceCharge = 0;
    }

    const canFire = !this.switchTo && this.cooldown <= 0 && p.alive;
    const rateMul = p.stats.fireRateMul * (p.stats.adrenaline && g.style.rankIndex >= 3 ? 1 + 0.25 * p.stats.adrenaline : 1) *
      (p.rushT > 0 ? 1.4 : 1) * (id === 'ripsaw' && this.overheated ? 0.6 : 1);
    if (d.kind === 'beam') {
      if (input.fire && canFire && a.mag > 0 && !this.reloading) {
        if (!this.charging) { this.charging = true; this.charge = 0; g.audio.play('lanceCharge', null, 0.6); }
        this.charge = Math.min(1, this.charge + dt / (d.chargeTime / p.stats.lanceCharge) * (p.rushT > 0 ? 1.3 : 1) * (input.ads ? 1.35 : 1));
      } else if (this.charging && (!input.fire || a.mag <= 0)) {
        if (this.charge > 0.12 && canFire && a.mag > 0) this.fireBeam(d, a, input.ads);
        this.charging = false; this.charge = 0;
        this.cooldown = 1 / (d.rate * rateMul);
      }
    } else if (input.fire && canFire) {
      const pressedNow = input.firePressed || d.auto || this.wantSemi || input.usingTouch;
      if (pressedNow) {
        if (a.mag > 0) {
          if (this.reloading && d.reloadShell) this.reloading = false;
          if (!this.reloading) {
            this.fire(d, a);
            this.wantSemi = false;
            this.cooldown = 1 / (d.rate * rateMul * (id === 'thumper' ? p.stats.launcherRateMul : 1));
          }
        } else if (input.firePressed) { g.audio.play('dry', null, 0.5); this.startReload(); }
      }
    }
    if (!d.auto && input.firePressed && this.cooldown > 0 && this.cooldown < 0.15) this.wantSemi = true;
    if (!input.fire) this.wantSemi = false;

    this.animate(dt, input);
  }

  // Burning enemies (INFERNO) and the TESLA tether tick here, on the live enemy list only.
  updateStatus(dt) {
    const g = this.game;
    for (const e of g.enemies.list) {
      if (!e.alive || !(e.burnT > 0)) continue;
      e.burnT -= dt;
      e.burnTick = (e.burnTick || 0) - dt;
      if (Math.random() < (g.lowPower ? 0.3 : 0.6)) {
        const c = e.centerPos();
        g.fx.sparks.spawn(c.x + (Math.random() - 0.5) * e.radius * 1.6, c.y + (Math.random() - 0.3) * 0.9, c.z + (Math.random() - 0.5) * e.radius * 1.6, 0, 2 + Math.random() * 2, 0, 1, 0.45 + Math.random() * 0.3, 0.1, 1, 0.12, 0.35, -3, 0);
      }
      if (e.burnTick <= 0) {
        e.burnTick = 0.3;
        g.combat.damageEnemy(e, e.burnDps * 0.3, { source: 'fire', quiet: true, part: 'body', point: e.centerPos().clone() });
      }
      if (e.burnT <= 0) e.burnDps = 0;
    }
    const t = this.tether;
    if (!t) return;
    const e = t.e;
    if (!e.alive) { this.discharge(e); this.tether = null; return; }
    if (!e.group.parent || t.t <= 0 || e.centerPos().distanceTo(g.player.body.pos) > 32) { this.tether = null; return; }
    t.t -= dt; t.tick -= dt; t.fx -= dt;
    if (t.tick <= 0) {
      t.tick = 0.2;
      const c = e.centerPos().clone();
      g.combat.damageEnemy(e, 8 * g.player.stats.dmgMul, { source: 'arc', energy: true, quiet: true, part: 'body', point: c, stagger: e.heavy ? 0 : 0.22 });
      if (e.flying) e.stun = Math.max(e.stun || 0, 0.25);
      if (g.audio.throttle && g.audio.throttle('tether', 180)) g.audio.play('tetherHum', null, 0.5);
    }
    if (t.fx <= 0 && e.alive) { t.fx = 0.06; this.lightning(this.muzzleWorld().clone(), e.centerPos().clone(), 0x7affd8); }
  }

  ignite(e, dur, dps) {
    if (!e.alive || e.boss) return;
    if (!(e.burnT > 0)) this.game.audio.play('ignite', e.pos, 0.5);
    e.burnT = Math.max(e.burnT || 0, dur);
    e.burnDps = Math.max(e.burnDps || 0, dps);
  }

  // Tethered target died: the stored charge jumps to everything nearby.
  discharge(dead) {
    const g = this.game, p = g.player;
    const from = dead.centerPos().clone();
    let n = 0;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable || n >= 4) continue;
      const c = e.centerPos();
      if (c.distanceTo(from) > 10 || !g.combat.losClear(from, c)) continue;
      this.lightning(from, c.clone(), 0x7affd8);
      g.combat.damageEnemy(e, 32 * p.stats.dmgMul, { source: 'arc', energy: true, part: 'body', point: c.clone(), stagger: 0.5, quiet: n > 0 });
      n++;
    }
    g.fx.sparksBurst(from, 0x7affd8, 24, 9, 0.45);
    g.audio.play('discharge', from, 0.9);
    if (n) g.style.add('DISCHARGE x' + n, 15 * n);
  }

  // ---------------------------------------------------------------- alt fires
  altFire(id, d, a) {
    const g = this.game, p = g.player;
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const o = cam.position.clone();
    const vid = this.variantId(id);
    if (id === 'hammer') {
      if (vid === 'piercer') return; // charge is a hold, handled in update
      if (this.coinCharges < 1) { g.audio.play('dry', null, 0.4); return; }
      const c = this.coins.find((x) => !x.alive) || this.coins[0];
      this.coinCharges -= 1;
      c.alive = true; c.t = 0; c.mesh.visible = true;
      c.pos.copy(o).addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
      c.vel.copy(dir).multiplyScalar(7).add(new THREE.Vector3(0, 7.5, 0)).addScaledVector(p.body.vel, 0.9);
      g.audio.play('coin', null, 0.8);
      g.fx.glint(c.pos, 0xffe080, 0.5, 0.12);
      this.vm.onCoin();
      g.emit('coin');
      return;
    }
    if (id === 'lance' && vid !== 'splitter') return; // scope is a hold, handled in update
    if (this.altCd > 0) return;
    if (id === 'ripsaw' && vid === 'inferno') {
      this.vent(o, dir);
    } else if (id === 'ripsaw') {
      if (a.mag < 4) { g.audio.play('dry', null, 0.4); this.startReload(); return; }
      a.mag -= 4;
      this.altCd = 0.7;
      g.projectiles.spawn({ pos: o.clone().addScaledVector(dir, 0.8), vel: dir.clone().multiplyScalar(26), dmg: 20 * p.stats.dmgMul, radius: 0.3, size: 0.28, color: 0xc8f8ff, life: 2.4, kind: 'saw', friendly: true, parryable: false });
      g.audio.play('saw', null, 0.9);
      this.kick({ ...d, kick: 0.05, recoil: 0.05, shake: 0.06, flash: 0x9ff4ff, punch: [0.15, 0.1] });
      g.emit('alt', id);
    } else if (id === 'breacher' && vid === 'pump') {
      this.pumpAlt(d);
    } else if (id === 'breacher') {
      if (a.mag < 2) { g.audio.play('dry', null, 0.4); this.startReload(); return; }
      a.mag -= 2;
      this.altCd = 0.9;
      g.projectiles.spawn({ pos: o.clone().addScaledVector(dir, 0.7), vel: dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 4, 0)).addScaledVector(p.body.vel, 0.5), dmg: 70 * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: 0.18, size: 0.16, color: 0xffb030, life: 3, kind: 'core', friendly: true, gravity: 16, explode: 3.6 * p.stats.explosiveRadiusMul, parryable: false });
      g.audio.play('launcher', null, 0.7);
      this.pumpT = 0.45;
      this.kick({ ...d, kick: 0.08, recoil: 0.08, shake: 0.1, punch: [0.25, 0.15] });
      g.emit('alt', id);
    } else if (id === 'lance') {
      this.scatter(d, a, o, dir);
    } else if (id === 'thumper' && vid === 'freeze') {
      if (this.freezeOn) this.releaseRockets(true);
      else {
        this.freezeOn = true; this.freezeT = 5;
        let n = 0;
        for (const pr of g.projectiles.list) if (pr.active && pr.friendly && pr.kind === 'rocket') { pr.frozen = true; n++; }
        g.audio.play('freeze', null, 0.8);
        if (n) g.fx.sparksBurst(o.clone().addScaledVector(dir, 2), 0x8ae0ff, 8, 4, 0.3);
      }
      this.altCd = 0.25;
      g.emit('alt', id);
    } else if (id === 'thumper') {
      const mines = g.projectiles.list.filter((pp) => pp.active && pp.kind === 'sticky');
      if (mines.length) {
        for (const m of mines) g.projectiles.detonate(m, null);
        if (mines.length >= 2) g.style.add('CHAIN BLAST', 15 * mines.length);
        this.altCd = 0.3;
        return;
      }
      if (a.mag < 1) { this.startReload(); return; }
      a.mag -= 1;
      this.altCd = 0.5;
      g.projectiles.spawn({ pos: o.clone().addScaledVector(dir, 0.7), vel: dir.clone().multiplyScalar(24).add(new THREE.Vector3(0, 2, 0)), dmg: 85 * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: 0.16, size: 0.15, color: 0xff3020, life: 14, kind: 'sticky', friendly: true, gravity: 10, explode: 4 * p.stats.explosiveRadiusMul, parryable: false });
      g.audio.play('launcher', null, 0.6);
      this.drumAngle += Math.PI * 2 / 5;
      g.emit('alt', id);
    } else if (id === 'arc' && vid === 'tether') {
      this.fireTether(a, o, dir);
    } else if (id === 'arc') {
      if (this.empCd > 0 || a.mag < 12) { g.audio.play('dry', null, 0.4); return; }
      a.mag -= 12;
      this.empCd = 6;
      const c = p.body.pos.clone().setY(p.body.pos.y + 1);
      g.fx.ring(c.x, p.body.pos.y + 0.1, c.z, 7, 0xb0a0ff, 0.45, 0.05);
      g.fx.sparksBurst(c, 0xb0a0ff, 40, 12, 0.6);
      g.audio.play('emp', null, 1);
      g.flash(0xb0a0ff, 0.15);
      let wiped = 0;
      for (const pr of g.projectiles.list) if (pr.active && !pr.friendly && pr.pos.distanceTo(c) < 7) { g.projectiles.kill(pr); wiped++; g.fx.sparksBurst(pr.pos, 0xb0a0ff, 4, 3, 0.2); }
      for (const e of g.enemies.list) {
        if (!e.alive || e.centerPos().distanceTo(c) > 7) continue;
        e.stun = Math.max(e.stun || 0, e.mini ? 0.6 : 1.4);
        e.stagger = Math.max(e.stagger, e.mini ? 0.4 : 1.4);
        g.combat.damageEnemy(e, 20 * p.stats.dmgMul, { source: 'arc', energy: true, point: e.centerPos().clone(), part: 'body', quiet: true });
      }
      if (wiped >= 3) g.style.add('EMP WIPE x' + wiped, 10 * wiped);
      this.kick({ ...d, kick: 0.06, recoil: 0.04, shake: 0.2, punch: [0.3, 0.2] });
      g.emit('emp');
      g.emit('alt', id);
    }
  }

  // INFERNO vent: dump all heat as a cone of fire.
  vent(o, dir) {
    const g = this.game, p = g.player;
    if (this.heat < 0.12) { g.audio.play('dry', null, 0.4); return; }
    const h = this.heat;
    this.heat = 0; this.overheated = false;
    this.altCd = 0.8;
    const range = 8 + h * 3, cosA = Math.cos(0.62);
    const dmg = (18 + 110 * h) * p.stats.dmgMul;
    let hits = 0;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      const c = e.centerPos();
      const v = this.tmpV.subVectors(c, o);
      const dist = v.length();
      if (dist > range + e.radius || v.dot(dir) / Math.max(0.01, dist) < cosA || !g.combat.losClear(o, c)) continue;
      const k = 1 - Math.max(0, dist - 2) / range * 0.5;
      g.combat.damageEnemy(e, dmg * k, { source: 'fire', part: 'body', point: c.clone(), dir: v.clone().normalize(), knock: 6, stagger: 0.35, quiet: hits > 0 });
      this.ignite(e, 3 + 2 * h, 10 + 16 * h);
      hits++;
    }
    const boss = g.bosses.active;
    if (boss && boss.alive) {
      for (const hb of boss.hitboxes()) {
        const v = this.tmpV.set(hb.x - o.x, hb.y - o.y, hb.z - o.z);
        const dist = v.length() - hb.r;
        if (dist < range && v.dot(dir) / Math.max(0.01, v.length()) > cosA) { g.combat.damageBoss(boss, dmg * 0.8, { source: 'fire', part: hb, point: new THREE.Vector3(hb.x, hb.y, hb.z) }); break; }
      }
    }
    // flame cone
    const mw = this.muzzleWorld().clone();
    const n = g.lowPower ? 26 : 48;
    for (let i = 0; i < n; i++) {
      const sp = this.spreadDir(dir, 0.5, this.tmpD);
      const s = 9 + Math.random() * 9;
      g.fx.sparks.spawn(mw.x, mw.y, mw.z, sp.x * s, sp.y * s + 1, sp.z * s, 1, 0.35 + Math.random() * 0.45, 0.08, 1, 0.16 + Math.random() * 0.14, 0.35 + Math.random() * 0.3, -2, 2.5);
    }
    for (let i = 0; i < (g.lowPower ? 4 : 8); i++) {
      const sp = this.spreadDir(dir, 0.4, this.tmpD);
      g.fx.dust.spawn(mw.x, mw.y, mw.z, sp.x * 6, sp.y * 6 + 1, sp.z * 6, 0.2, 0.18, 0.16, 0.6, 0.5, 0.9, -0.6, 2);
    }
    // the blast shoves you back a little (vent-jumping is allowed)
    p.body.vel.x -= dir.x * 4 * h; p.body.vel.z -= dir.z * 4 * h;
    if (dir.y < -0.6 && !p.body.grounded) p.body.vel.y = Math.max(p.body.vel.y, 5 * h);
    g.audio.play('vent', null, 1);
    g.flash(0xff7a2a, 0.12 * h);
    this.kick({ ...DEFS.ripsaw, kick: 0.06, recoil: 0.04, shake: 0.2 + h * 0.2, flash: 0xff7a2a, punch: [0.2, 0.3] });
    if (hits >= 3) g.style.add('BONFIRE x' + hits, 12 * hits);
    g.emit('alt', 'ripsaw');
  }

  // PUMP CHARGE: up to three pumps, the fourth overloads.
  pumpAlt(d) {
    const g = this.game, p = g.player;
    if (this.reloading) this.reloading = false;
    if (this.pumpLevel >= 3) {
      const pos = this.muzzleWorld().clone();
      g.fx.explosion(pos, 4.2, 0xff4a6a);
      g.audio.play('explosion', null, 1);
      g.combat.radialDamage(pos, 4.5, 110 * p.stats.dmgMul * p.stats.explosiveDmgMul, { source: 'explosion', knock: 12, selfKnock: 22 });
      this.pumpLevel = 0;
      this.altCd = 0.7;
      this.cooldown = Math.max(this.cooldown, 0.4);
      g.style.add('OVERPUMPED', 20);
      g.addShake(0.5);
      p.camPunch(0.9, 0.8);
      g.emit('alt', 'breacher');
      return;
    }
    this.pumpLevel++;
    this.pumpT = 0.45;
    this.altCd = 0.3;
    g.audio.play('pump', null, 0.8, this.pumpLevel);
    if (this.pumpLevel === 3) g.audio.play('overpump', null, 0.35);
    p.camPunch(0.08, 0.1);
    g.emit('alt', 'breacher');
  }

  // SPLITTER alt: an instant five-beam fan.
  scatter(d, a, o, dir) {
    const g = this.game, p = g.player, cam = g.camera;
    if (a.mag < 1 || this.reloading) { g.audio.play('dry', null, 0.4); if (a.mag < 1) this.startReload(); return; }
    a.mag -= 1;
    this.altCd = 1.1;
    this.charging = false; this.charge = 0;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const muzzle = this.muzzleWorld().clone();
    const dmg = 26 * p.stats.dmgMul;
    let kills = 0;
    for (let k = -2; k <= 2; k++) {
      const bd = dir.clone().applyAxisAngle(up, k * 0.075);
      const res = g.combat.raycastPierce(o, bd, d.range * 0.6);
      for (const h of res.hits) {
        const was = h.enemy.alive;
        g.combat.damageEnemy(h.enemy, dmg, { source: 'hitscan', part: h.part, headMul: 1.4, point: h.point, dir: bd, knock: 3, stagger: 0.25, energy: true, pierce: true, quiet: k !== 0, dist: h.t });
        if (was && !h.enemy.alive) kills++;
      }
      if (res.bossHit && res.bossHit.t < res.end) g.combat.damageBoss(g.bosses.active, dmg, { source: 'beam', part: res.bossHit.part, point: res.bossHit.point, energy: true, quiet: k !== 0 });
      const end = o.clone().addScaledVector(bd, res.world ? res.world.t : d.range * 0.6);
      g.fx.beam(muzzle, end, 0xc070ff, 0.06, 0.22);
      if (res.world) g.fx.sparksBurst(end, 0xc070ff, 4, 4, 0.25);
    }
    if (kills >= 2) g.style.add('FANNED x' + kills, 15 * kills);
    g.audio.play('scatter', null, 0.9);
    this.kick({ ...d, kick: 0.07, recoil: 0.06, shake: 0.15, flash: 0xc070ff, punch: [0.3, 0.15], fovKick: 1.5 });
    g.emit('fire', 'lance');
    g.emit('alt', 'lance');
  }

  // FREEZEFRAME: send every frozen rocket at whatever the crosshair is on.
  releaseRockets(aimed) {
    const g = this.game, cam = g.camera;
    this.freezeOn = false;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = aimed ? g.combat.raycast(cam.position, dir, 120) : null;
    const target = hit ? hit.point : cam.position.clone().addScaledVector(dir, 120);
    let n = 0;
    for (const pr of g.projectiles.list) {
      if (!pr.active || !pr.friendly || pr.kind !== 'rocket' || !(pr.frozen || pr.freezeAt > 0)) continue;
      pr.frozen = false; pr.freezeAt = 0;
      const sp = Math.max(38, pr.vel.length());
      if (aimed) pr.vel.subVectors(target, pr.pos).normalize().multiplyScalar(sp * 1.15);
      n++;
    }
    if (n) g.audio.play('unfreeze', null, 0.9);
    if (n >= 3) g.style.add('BARRAGE x' + n, 10 * n);
  }

  // TESLA TETHER: latch onto the enemy under (or nearest to) the crosshair.
  fireTether(a, o, dir) {
    const g = this.game;
    if (a.mag < 6) { g.audio.play('dry', null, 0.4); return; }
    let target = null;
    const hit = g.combat.raycast(o, dir, 26);
    if (hit && hit.kind === 'enemy') target = hit.enemy;
    else {
      let ba = 0.14;
      for (const e of g.enemies.list) {
        if (!e.alive || !e.targetable) continue;
        const c = e.centerPos();
        const v = this.tmpV.subVectors(c, o);
        const dist = v.length();
        if (dist > 26) continue;
        const ang = Math.acos(clamp(v.dot(dir) / dist, -1, 1));
        if (ang < ba && g.combat.losClear(o, c)) { ba = ang; target = e; }
      }
    }
    if (!target) { g.audio.play('dry', null, 0.4); g.fx.sparksBurst(this.muzzleWorld().clone(), 0x7affd8, 6, 3, 0.2); return; }
    a.mag -= 6;
    this.altCd = 1.0;
    this.tether = { e: target, t: 4.5, tick: 0, fx: 0 };
    if (!target.heavy) target.stagger = Math.max(target.stagger, 0.4);
    g.audio.play('tether', null, 0.9);
    g.style.add('TETHERED', 10, true);
    this.kick({ ...DEFS.arc, kick: 0.05, recoil: 0.03, shake: 0.1, flash: 0x7affd8, punch: [0.15, 0.1] });
    g.emit('alt', 'arc');
  }

  updateCoins(dt) {
    const g = this.game;
    for (const c of this.coins) {
      if (!c.alive) continue;
      c.t += dt;
      c.vel.y -= 14 * dt;
      const before = c.pos.clone();
      c.pos.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += dt * 22; c.mesh.rotation.z += dt * 5;
      const d = c.pos.clone().sub(before);
      const len = d.length();
      if (len > 0 && g.combat.rayWorld(before, d.multiplyScalar(1 / len), len)) { this.breakCoin(c); continue; }
      if (c.t > 2.6) { this.breakCoin(c); continue; }
      if (Math.random() < 0.3) g.fx.sparks.spawn(c.pos.x, c.pos.y, c.pos.z, 0, 0, 0, 1, 0.8, 0.2, 1, 0.06, 0.15, 0, 0);
      // a star glint as it tumbles: easy to track and to shoot against busy rooms
      c.glintT -= dt;
      if (c.glintT <= 0) { c.glintT = 0.14 + Math.random() * 0.1; g.fx.glint(c.pos, 0xffe080, 0.5, 0.08); }
    }
  }
  breakCoin(c) { c.alive = false; c.mesh.visible = false; }
  clearCoins() { for (const c of this.coins) this.breakCoin(c); }

  punchCoin(eye, dir) {
    for (const c of this.coins) {
      if (!c.alive || c.pos.distanceTo(eye) > 3) continue;
      c.vel.copy(dir).multiplyScalar(20);
      this.game.style.add('COIN PUNCH', 10);
      return true;
    }
    return false;
  }

  // Coin ricochet: chains through other coins, then hits the best head in range.
  ricoshot(coin, dmg, chain = 0) {
    const g = this.game;
    this.breakCoin(coin);
    if (chain === 0) g.emit('coinhit');
    const from = coin.pos.clone();
    g.fx.sparksBurst(from, 0xffd040, 10, 6, 0.3);
    g.audio.play('ricochet', from, 0.9);
    let next = null, nd = 20;
    for (const c of this.coins) {
      if (!c.alive || c === coin) continue;
      const dd = c.pos.distanceTo(from);
      if (dd < nd && g.combat.losClear(from, c.pos)) { nd = dd; next = c; }
    }
    if (next && chain < 5) {
      g.fx.tracer(from, next.pos.clone(), 0xffe060, 0.18);
      return this.ricoshot(next, dmg, chain + 1);
    }
    let best = null, bd = 70;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      const h = e.headPos().clone();
      const dd = h.distanceTo(from) - (e.mini ? 6 : 0);
      if (dd < bd && g.combat.losClear(from, h)) { bd = dd; best = { e, pt: h }; }
    }
    const boss = g.bosses.active;
    if (boss && boss.alive) for (const hb of boss.hitboxes()) {
      if (hb.shielded) continue;
      const pt = new THREE.Vector3(hb.x, hb.y, hb.z);
      const dd = pt.distanceTo(from) - (hb.weak ? 8 : 0);
      if (dd < bd && g.combat.losClear(from, pt)) { bd = dd; best = { hb, pt }; }
    }
    const mul = 2 + chain * 0.5;
    if (!best) { g.style.add('NICE TRY', 1, true); return; }
    g.fx.tracer(from, best.pt, 0xffe060, 0.2);
    g.fx.beam(from, best.pt, 0xffd040, 0.05, 0.15);
    if (best.e) g.combat.damageEnemy(best.e, dmg * mul, { source: 'hitscan', part: 'head', headMul: 1.25, point: best.pt, dir: best.pt.clone().sub(from).normalize(), knock: 4, stagger: 0.5, ricoshot: true });
    else g.combat.damageBoss(boss, dmg * mul, { source: 'hitscan', part: best.hb, point: best.pt, ricochet: true });
    g.hitstop(0.03 + chain * 0.01);
    g.style.add(chain > 0 ? 'RICOSHOT x' + (chain + 1) : 'RICOSHOT', 35 + chain * 25);
    g.emit('ricoshot', chain + 1);
  }

  // A shot fired right after the sights came up that connected: bonus style, and a heavier hit.
  quickScoped(kill, point) {
    const g = this.game;
    if (kill) { g.style.add('QUICKSCOPED', 90); g.hitstop(0.05); } else g.style.add('QUICKSCOPE', 25);
    g.audio.play('headshot', null, 0.8);
    g.audio.play('quickscope', null, kill ? 1 : 0.7);
    if (point) g.fx.sparksBurst(point, 0x9ff8ff, 10, 5, 0.25);
    g.emit('quickscope', kill);
  }

  // Trace a hitscan ray that may first strike a coin or a shootable core shell.
  trace(o, dir, range, skip) {
    const g = this.game;
    const hit = g.combat.raycast(o, dir, range, { skip });
    let maxT = hit ? hit.t : range;
    let special = null;
    for (const c of this.coins) {
      if (!c.alive) continue;
      const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y, c.pos.z, 0.45, maxT);
      if (t >= 0 && t < maxT) { maxT = t; special = { kind: 'coin', coin: c, t }; }
    }
    for (const pr of g.projectiles.list) {
      if (!pr.active || !pr.friendly || pr.kind !== 'core') continue;
      const t = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, pr.pos.x, pr.pos.y, pr.pos.z, 0.55, maxT);
      if (t >= 0 && t < maxT) { maxT = t; special = { kind: 'core', proj: pr, t }; }
    }
    if (special) { special.point = o.clone().addScaledVector(dir, special.t); return special; }
    return hit;
  }

  // ---------------------------------------------------------------- primary fire
  aimAssist(dt) {
    const g = this.game, cam = g.camera;
    const dir = cam.getWorldDirection(this.tmpD);
    let best = null, ba = 0.11;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      const c = e.centerPos();
      const v = this.tmpV.subVectors(c, cam.position);
      const dist = v.length();
      if (dist > 45) continue;
      v.multiplyScalar(1 / dist);
      const ang = Math.acos(clamp(v.dot(dir), -1, 1));
      if (ang < ba) { ba = ang; best = c.clone(); }
    }
    if (!best) return;
    const p = g.player;
    const v = best.sub(cam.position).normalize();
    let dy = Math.atan2(-v.x, -v.z) - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = Math.min(1, dt * 5);
    p.yaw += dy * k * 0.6;
    p.pitch += (Math.asin(clamp(v.y, -1, 1)) - p.pitch) * k * 0.5;
  }

  muzzleWorld() { return this.vm.muzzleWorld(this.muzzleW); }

  spreadDir(base, spread, out) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const up = Math.abs(base.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(base, up).normalize();
    const v = new THREE.Vector3().crossVectors(base, u).normalize();
    return out.copy(base).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
  }

  magnet(dir) {
    const g = this.game;
    if (!g.input.usingTouch || !g.settings.get('aimAssist')) return dir;
    const cam = g.camera.position;
    let best = null, ba = 0.055;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      for (const pt of [e.headPos(), e.centerPos()]) {
        const ang = Math.acos(clamp(this.tmpV.subVectors(pt, cam).normalize().dot(dir), -1, 1));
        if (ang < ba) { ba = ang; best = pt.clone(); }
      }
    }
    const boss = g.bosses.active;
    if (boss && boss.alive) for (const hb of boss.hitboxes()) {
      const ang = Math.acos(clamp(this.tmpV.set(hb.x - cam.x, hb.y - cam.y, hb.z - cam.z).normalize().dot(dir), -1, 1));
      if (ang < ba && !hb.shielded) { ba = ang; best = new THREE.Vector3(hb.x, hb.y, hb.z); }
    }
    if (best) dir.copy(best).sub(cam).normalize();
    return dir;
  }

  // Shot feedback: view recoil (aim), viewmodel spring kick, camera punch, FOV kick, flash.
  kick(d) {
    const g = this.game, p = g.player;
    const steady = p.stats.spreadMul < 1;
    const rk = d.recoil * (steady ? 0.6 : 1);
    const kickUp = rk * (0.7 + Math.random() * 0.3);
    p.pitch = Math.min(1.5, p.pitch + kickUp);
    this.recoilAccum += kickUp;
    p.yaw += (Math.random() - 0.5) * rk * 0.4;
    const fs = d.flashScale || 1;
    const vid = this.variantId();
    const base = DEFS[this.current];
    const fcol = p.rushT > 0 ? 0xff5ae8 : d.flash !== base.flash ? d.flash : (VFLASH[vid] || d.flash);
    this.vm.recoil(steady ? { kick: d.kick * 0.7 } : d, this.current, fcol, fs);
    this.muzzleLight.color.setHex(fcol);
    this.muzzleLight.intensity = 3;
    const mw = this.muzzleWorld();
    g.fx.muzzle(mw.x, mw.y, mw.z, fcol, 1);
    g.addShake(d.shake);
    const sh = g.settings.get('shake');
    const feel = typeof sh === 'number' ? Math.min(1, sh) : 1;
    if (d.punch && p.camPunch) p.camPunch(d.punch[0] * (0.8 + Math.random() * 0.4), d.punch[1] * (Math.random() < 0.5 ? -1 : 1));
    if (d.fovKick && feel > 0) { g.camera.fov += d.fovKick * feel; g.camera.updateProjectionMatrix(); }
    g.run.shots++;
  }

  ejectBrass(big = false) {
    const g = this.game;
    const cam = g.camera;
    const p = new THREE.Vector3(0.18, -0.08, -0.45).applyMatrix4(cam.matrixWorld);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const v = r.multiplyScalar(2.5 + Math.random()).add(new THREE.Vector3(0, 2.5 + Math.random(), 0)).add(g.player.body.vel.clone().multiplyScalar(0.8));
    g.fx.dust.spawn(p.x, p.y, p.z, v.x, v.y, v.z, big ? 0.75 : 0.85, big ? 0.15 : 0.65, big ? 0.1 : 0.25, 1, big ? 0.07 : 0.05, 0.8, 14, 0.5, g.player.body.pos.y + 0.02);
  }

  // Perfect-dodge COUNTERSTRIKE: the next shot after a dodge hits twice as hard.
  takeCounter(at) {
    const g = this.game, p = g.player;
    if (!(p.counterT > 0)) return 1;
    p.counterT = 0;
    g.fx.sparksBurst(at, 0x7fe0ff, 12, 6, 0.3);
    g.style.add('COUNTER', 20);
    return 2;
  }

  fire(d, a) {
    const g = this.game, p = g.player, cam = g.camera, id = this.current;
    const vid = this.variantId(id);
    a.mag = Math.max(0, a.mag - 1);
    const pumped = id === 'breacher' && vid === 'pump' ? this.pumpLevel : 0;
    if (id === 'ripsaw' && vid === 'inferno') {
      g.audio.play(this.heat > 0.5 ? 'rifleHot' : 'rifle', null, 0.9);
      this.heat = Math.min(1, this.heat + 0.034);
      if (this.heat >= 1 && !this.overheated) { this.overheated = true; g.audio.play('overheat', null, 0.7); g.hud.toast('OVERHEAT · ALT TO VENT', '#ff7a2a', true); }
    } else if (id === 'thumper' && vid === 'freeze') g.audio.play('rocket', null, 0.9);
    else g.audio.play(d.sound, null, 0.9);
    if (pumped) g.audio.play('shotgunPumped', null, 0.9, pumped);
    this.kick(pumped ? { ...d, kick: d.kick * (1 + pumped * 0.3), recoil: d.recoil * (1 + pumped * 0.35), shake: d.shake + pumped * 0.1, punch: [d.punch[0] * (1 + pumped * 0.4), d.punch[1] * (1 + pumped * 0.4)], fovKick: d.fovKick + pumped } : d);
    if (id === 'breacher') { this.pumpT = 0.45; setTimeout(() => this.ejectBrass(true), 150); }
    if (id === 'hammer') this.cylTarget += Math.PI / 3;
    if (id === 'ripsaw') { this.boltT = 0.06; this.ejectBrass(); }
    if (id === 'thumper') this.drumAngle += Math.PI * 2 / 5;
    g.emit('fire', id);
    const base = cam.getWorldDirection(new THREE.Vector3());
    const origin = cam.position.clone();
    const muzzle = this.muzzleWorld().clone();
    if (d.kind === 'grenade') {
      this.magnet(base);
      const cm = this.takeCounter(muzzle);
      if (vid === 'freeze') {
        g.projectiles.spawn({
          pos: origin.clone().addScaledVector(base, 0.8).add(new THREE.Vector3(0, -0.12, 0)), vel: base.clone().multiplyScalar(38),
          dmg: 80 * cm * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: 0.2, size: 0.16, color: 0x6ad0ff, life: 4, kind: 'rocket', friendly: true, gravity: 0,
          explode: 3.4 * p.stats.explosiveRadiusMul, parryable: false, cluster: p.stats.cluster, direct: 30 * cm * p.stats.dmgMul, freezeAt: this.freezeOn ? 0.12 : 0,
        });
        return;
      }
      g.projectiles.spawnGrenade(origin.clone().addScaledVector(base, 0.6).add(new THREE.Vector3(0, -0.1, 0)), base.clone().multiplyScalar(d.speed).add(new THREE.Vector3(0, 3.2, 0)).add(p.body.vel.clone().multiplyScalar(0.4)), {
        dmg: d.dmg * cm * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: d.radius * p.stats.explosiveRadiusMul, cluster: p.stats.cluster,
      });
      return;
    }
    if (d.kind === 'arc') { this.fireArc(d, origin, base, muzzle); return; }
    const pellets = (d.pellets || 1) + (id === 'breacher' ? p.stats.shotgunPellets + pumped * 2 : 0);
    const moving = Math.min(1, p.speedNow / 8) * (p.body.grounded ? 1 : 1.5);
    const adsSpread = 1 - (1 - (ADS[id] || ADS.hammer).spread) * this.adsK;
    const spread = (d.spread + (d.moveSpread || 0) * moving * (1 - 0.5 * this.adsK) + this.bloom) * p.stats.spreadMul * (1 + pumped * 0.15) * adsSpread;
    if (d.bloom) this.bloom = Math.min(d.maxBloom, this.bloom + d.bloom * (1 - 0.4 * this.adsK));
    const qs = id === 'hammer' && this.quickScopeLive();
    if (this.adsOn) this.qsUsed = true;
    const dir = new THREE.Vector3();
    const dmgMul = p.stats.dmgMul * (id === 'ripsaw' ? p.stats.rifleDmg : 1) * (p.stats.momentumDmg && p.speedNow > 14 ? 1.25 : 1) * PUMP_MUL[pumped] * this.takeCounter(muzzle);
    const hot = id === 'ripsaw' && vid === 'inferno' && this.heat >= 0.5;
    let anyHit = false, enemyHits = 0, nearest = 99, headHit = false;
    for (let i = 0; i < pellets; i++) {
      this.spreadDir(base, spread, dir);
      if (pellets === 1) this.magnet(dir);
      let skip = null;
      const pierceLeft = id === 'ripsaw' ? p.stats.riflePierce : 0;
      let o = origin;
      for (let k = 0; k < 1 + pierceLeft; k++) {
        const hit = this.trace(o, dir, d.range, skip);
        const end = hit ? hit.point : origin.clone().addScaledVector(dir, d.range);
        if (k === 0 && (pellets === 1 || i % 2 === 0)) g.fx.tracer(muzzle, end, hot ? 0xff9a40 : d.tracer, pellets > 1 ? 0.05 : 0.07);
        if (!hit) break;
        let dmg = d.dmg * dmgMul;
        if (d.falloff) dmg *= 1 - clamp((hit.t - d.falloff[0]) / (d.falloff[1] - d.falloff[0]), 0, 1) * 0.7;
        if (hit.kind === 'coin') { this.ricoshot(hit.coin, d.dmg * dmgMul * (id === 'hammer' ? 1 : 0.6)); anyHit = true; break; }
        if (hit.kind === 'core') {
          const pr = hit.proj;
          pr.explode *= 1.45; pr.dmg *= 1.8;
          g.projectiles.detonate(pr, null);
          g.style.add('CORE DETONATED', 40);
          g.emit('coreshot');
          anyHit = true; break;
        }
        if (hit.kind === 'world') {
          g.fx.impact(hit.point, hit.normal, hit.surface, pellets > 1 ? 0.5 : 1);
          if (hit.box.tag === 'barrier' && hit.box.ref) { hit.box.ref.hp -= dmg; g.hud.hitMarker('shield'); }
          if (hit.box.tag === 'barrel' && hit.box.ref) g.level.hitBarrel(hit.box.ref);
          break;
        }
        anyHit = true;
        if (hit.kind === 'enemy') {
          const e = hit.enemy;
          if (id === 'hammer' && hit.part === 'head' && p.stats.deadeye) { dmg *= 1 + 0.5 * p.stats.deadeye; a.mag = Math.min(this.magSize(), a.mag + 1); }
          if (qs && hit.part === 'head') dmg *= 1.25;
          const wasAlive = e.alive;
          const knock = (d.knock ? d.knock / pellets * 3 : 1.2) * (1 + pumped * 0.5);
          g.combat.damageEnemy(e, dmg, { source: 'hitscan', part: hit.part, headMul: d.head, point: hit.point, dir: dir.clone(), knock, stagger: id === 'breacher' ? 0.12 + pumped * 0.06 : id === 'hammer' ? 0.25 : 0.05, dist: hit.t, dmg, quiet: pellets > 1 && i > 0 });
          if (hot) this.ignite(e, 2, 6 + 10 * this.heat);
          if (p.stats.explosiveEvery) this.countExplosive(hit.point);
          enemyHits++; nearest = Math.min(nearest, hit.t);
          if (hit.part === 'head') headHit = true;
          if (qs && hit.part === 'head') this.quickScoped(wasAlive && !e.alive, hit.point);
          if (!skip) skip = new Set();
          skip.add(e);
          o = hit.point.clone().addScaledVector(dir, 0.05);
        } else if (hit.kind === 'boss') {
          g.combat.damageBoss(hit.boss, dmg, { source: 'hitscan', part: hit.part, point: hit.point, dir: dir.clone(), quiet: pellets > 1 && i > 0 });
          if (p.stats.explosiveEvery) this.countExplosive(hit.point);
          enemyHits++; nearest = Math.min(nearest, hit.t);
          break;
        }
      }
    }
    if (anyHit && pellets > 1) g.audio.play('hit', null, 0.5);
    // weapon-specific hit-stop: a point-blank shotgun blast or a revolver headshot lands heavier
    if (id === 'breacher' && enemyHits >= 5 && nearest < 7) { g.hitstop(0.035 + pumped * 0.01); p.camPunch(0.25, 0); }
    else if (id === 'hammer' && headHit) g.hitstop(0.02);
    if (pumped) {
      // pumped blasts shove you backwards (aim down in the air for a shotgun jump)
      p.body.vel.x -= base.x * 2.5 * pumped; p.body.vel.z -= base.z * 2.5 * pumped;
      if (base.y < -0.6 && !p.body.grounded) p.body.vel.y = Math.max(p.body.vel.y, 4 * pumped);
      this.pumpLevel = 0;
    }
  }

  // PIERCER: a charged revolver round that passes through every enemy in line.
  firePiercer(d, a) {
    const g = this.game, p = g.player, cam = g.camera;
    a.mag = Math.max(0, a.mag - 1);
    g.audio.play('piercer', null, 1);
    this.cylTarget += Math.PI / 3;
    this.kick({ ...d, kick: 0.14, recoil: 0.16, shake: 0.32, flash: 0x80e0ff, punch: [0.6, 0.35], fovKick: 3, flashScale: 1.8 });
    g.emit('fire', 'hammer');
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.magnet(dir);
    const o = cam.position.clone();
    const muzzle = this.muzzleWorld().clone();
    const dmg = d.dmg * 2.6 * p.stats.dmgMul * this.takeCounter(muzzle);
    const res = g.combat.raycastPierce(o, dir, d.range);
    let kills = 0;
    for (const h of res.hits) {
      const was = h.enemy.alive;
      g.combat.damageEnemy(h.enemy, dmg, { source: 'hitscan', part: h.part, headMul: d.head, point: h.point, dir, knock: 9, stagger: 0.6, pierce: true, dist: h.t });
      if (was && !h.enemy.alive) kills++;
    }
    if (res.bossHit && res.bossHit.t < res.end) g.combat.damageBoss(g.bosses.active, dmg, { source: 'hitscan', part: res.bossHit.part, point: res.bossHit.point });
    for (const c of this.coins) if (c.alive && raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y, c.pos.z, 0.5, res.end) >= 0) this.ricoshot(c, dmg * 0.6);
    const end = o.clone().addScaledVector(dir, res.world ? res.world.t : d.range);
    g.fx.beam(muzzle, end, 0x5ad8ff, 0.09, 0.3);
    g.fx.beam(muzzle, end, 0xffffff, 0.035, 0.18);
    if (res.world) g.fx.impact(end, new THREE.Vector3(res.world.nx, res.world.ny, res.world.nz), 'energy', 1.6);
    if (res.hits.length) g.hitstop(0.05);
    if (kills >= 2) g.style.add('PIERCED x' + kills, 20 * kills);
  }

  countExplosive(point) {
    const p = this.game.player;
    this.hitCounter++;
    if (this.hitCounter >= Math.max(2, 7 - p.stats.explosiveEvery * 2)) {
      this.hitCounter = 0;
      const g = this.game;
      g.fx.explosion(point, 2.2, 0xffb040);
      g.audio.play('explosion', point, 0.45);
      g.combat.radialDamage(point, 2.6 * p.stats.explosiveRadiusMul, 32 * p.stats.explosiveDmgMul * p.stats.dmgMul, { source: 'explosion', noSelf: true, knock: 5 });
    }
  }

  fireBeam(d, a, scoped) {
    const g = this.game, p = g.player;
    a.mag = Math.max(0, a.mag - 1);
    g.audio.play('lance', null, 1, this.charge);
    const ck = 0.5 + this.charge * 0.5;
    this.kick({ ...d, kick: d.kick * ck, recoil: d.recoil * ck, punch: [d.punch[0] * ck, d.punch[1] * ck], fovKick: d.fovKick * this.charge });
    g.emit('fire', 'lance');
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.magnet(dir);
    const o = cam.position.clone();
    const muzzle = this.muzzleWorld().clone();
    const res = g.combat.raycastPierce(o, dir, d.range);
    const qs = scoped && this.quickScopeLive();
    if (scoped) this.qsUsed = true;
    const noScope = !scoped && this.adsK < 0.1 && this.charge > 0.95;
    const dmg = (d.dmgMin + (d.dmgMax - d.dmgMin) * this.charge) * p.stats.dmgMul * this.takeCounter(muzzle) * (qs ? 1.3 : 1);
    let kills = 0, far = 0;
    for (const h of res.hits) {
      const wasAlive = h.enemy.alive;
      g.combat.damageEnemy(h.enemy, dmg, { source: 'hitscan', part: h.part, headMul: d.head * (scoped ? 1.25 : 1), point: h.point, dir, knock: 6 * this.charge, stagger: 0.4, energy: true, pierce: true, dist: h.t });
      if (wasAlive && !h.enemy.alive) { kills++; far = Math.max(far, h.t); }
    }
    if (qs && (res.hits.length || (res.bossHit && res.bossHit.t < res.end))) this.quickScoped(kills > 0, res.hits.length ? res.hits[0].point : res.bossHit.point);
    else if (noScope && kills && far > 15) { g.style.add('NO SCOPE', 70); g.emit('noscope', far); g.audio.play('headshot', null, 0.7); }
    if (res.bossHit && res.bossHit.t < res.end) g.combat.damageBoss(g.bosses.active, dmg, { source: 'beam', part: res.bossHit.part, point: res.bossHit.point, energy: true });
    for (const c of this.coins) if (c.alive && raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y, c.pos.z, 0.5, res.end) >= 0) this.ricoshot(c, dmg * 0.8);
    if (kills >= 2) g.style.add('SKEWERED x' + kills, 20 * kills);
    if (kills >= 2 && p.stats.lanceCharge > 1) a.mag = Math.min(this.magSize(), a.mag + 1);
    const end = o.clone().addScaledVector(dir, res.world ? res.world.t : d.range);
    const split = this.variantId('lance') === 'splitter';
    g.fx.beam(muzzle, end, split ? 0xc070ff : 0x40e0ff, 0.12 + this.charge * 0.18, 0.35);
    g.fx.beam(muzzle, end, 0xffffff, 0.04 + this.charge * 0.05, 0.2);
    if (res.world) { g.fx.impact(end, new THREE.Vector3(res.world.nx, res.world.ny, res.world.nz), 'energy', 2); g.fx.sparksBurst(end, split ? 0xc070ff : 0x40e0ff, 14, 6, 0.4); }
    if (res.hits.length && this.charge > 0.95) g.hitstop(0.05);
    if (this.charge > 0.95) g.style.add('FULL CHARGE', 5, true);
    // SPLITTER: the beam forks where it lands and the forks seek fresh targets
    if (split && this.charge > 0.4) {
      const last = res.hits.length ? res.hits[res.hits.length - 1].point : null;
      const from = res.world ? end.clone().addScaledVector(dir, -0.3) : last || end;
      const done = new Set(res.hits.map((h) => h.enemy));
      let forks = this.charge > 0.95 ? 3 : 2, n = 0;
      while (forks-- > 0) {
        let best = null, bd = 18;
        for (const e of g.enemies.list) {
          if (!e.alive || !e.targetable || done.has(e)) continue;
          const c = e.centerPos();
          const dd = c.distanceTo(from);
          if (dd < bd && g.combat.losClear(from, c)) { bd = dd; best = e; }
        }
        if (!best) break;
        done.add(best);
        const c = best.centerPos().clone();
        g.fx.beam(from, c, 0xc070ff, 0.07, 0.3);
        g.fx.beam(from, c, 0xffffff, 0.025, 0.18);
        g.combat.damageEnemy(best, dmg * 0.5, { source: 'hitscan', part: 'body', point: c, dir: c.clone().sub(from).normalize(), knock: 4, stagger: 0.3, energy: true, quiet: n > 0 });
        n++;
      }
      if (n) { g.audio.play('split', null, 0.8); g.style.add('SPLIT x' + n, 8 * n, n < 2); }
    }
  }

  fireArc(d, origin, base, muzzle) {
    const g = this.game, p = g.player;
    let target = null, bestScore = -1;
    const cands = [];
    for (const e of g.enemies.list) if (e.alive && e.targetable) cands.push({ pt: e.centerPos().clone(), e });
    const boss = g.bosses.active;
    if (boss && boss.alive) for (const hb of boss.hitboxes()) cands.push({ pt: new THREE.Vector3(hb.x, hb.y, hb.z), hb });
    for (const c of cands) {
      const v = this.tmpV.subVectors(c.pt, origin);
      const dist = v.length();
      if (dist > d.range) continue;
      const dot = v.dot(base) / dist;
      if (dot < 0.94) continue;
      const score = dot - dist * 0.002;
      if (score > bestScore && g.combat.losClear(origin, c.pt)) { bestScore = score; target = c; }
    }
    // a live tether pulls every arc through its target
    const t = this.tether;
    const tethered = t && t.e.alive && t.e.targetable;
    if (tethered) {
      const c = t.e.centerPos();
      if (c.distanceTo(origin) < d.range * 1.6 && g.combat.losClear(origin, c)) target = { pt: c.clone(), e: t.e };
    }
    const dmg = d.dmg * p.stats.dmgMul;
    const jumps = d.jumps + p.stats.arcJumps + (tethered ? 2 : 0);
    const col = tethered ? 0x7affd8 : 0xb0a0ff;
    if (!target) {
      const hit = g.combat.rayWorld(origin, base, d.range * 0.6);
      const end = origin.clone().addScaledVector(base, hit ? hit.t : d.range * 0.6);
      this.lightning(muzzle, end, col);
      if (hit) g.fx.impact(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz), 'energy', 0.6);
      return;
    }
    let from = muzzle;
    const visited = new Set();
    let cur = target;
    for (let j = 0; j <= jumps && cur; j++) {
      this.lightning(from, cur.pt, col);
      if (cur.e) {
        visited.add(cur.e);
        g.combat.damageEnemy(cur.e, dmg * (j === 0 ? 1 : 0.8), { source: 'arc', part: 'body', point: cur.pt, dir: base, knock: 0.5, stagger: 0.15, energy: true, quiet: j > 0 });
        if (cur.e.flying) cur.e.stun = 0.5;
      } else if (cur.hb) { g.combat.damageBoss(boss, dmg, { source: 'arc', part: cur.hb, point: cur.pt, energy: true, quiet: j > 0 }); break; }
      from = cur.pt;
      let next = null, nd = d.jumpRange * (tethered ? 1.3 : 1);
      for (const e of g.enemies.list) {
        if (!e.alive || visited.has(e)) continue;
        const c = e.centerPos();
        const dist = c.distanceTo(from);
        if (dist < nd) { nd = dist; next = { pt: c.clone(), e }; }
      }
      if (next && j < jumps) g.style.add('CHAIN', 3, true);
      cur = next;
    }
  }

  lightning(a, b, color = 0xb0a0ff) {
    const fx = this.game.fx;
    let prev = a.clone();
    for (let i = 1; i <= 5; i++) {
      const p = a.clone().lerp(b, i / 5);
      if (i < 5) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      fx.tracer(prev, p, color, 0.09);
      prev = p;
    }
    fx.sparksBurst(b, color, 4, 3, 0.2, 0.07);
  }

  // ---------------------------------------------------------------- animation
  animate(dt, input) { this.vm.update(dt, input); }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  setTheme(theme) { this.hemi.color.setHex(theme.sky); this.hemi.groundColor.setHex(theme.ground); this.vm.setTheme(theme); }

  setSkin(skin) {
    const col = { default: 0xdfe3ea, gilded: 0xffd070, bloodline: 0xd04040, void: 0x7a6ab0, verdigris: 0x6ad0a0, obsidian: 0x404048 }[skin || 'default'] || 0xdfe3ea;
    this.vm.setSkin(col);
  }
}
