import * as THREE from 'three';
import { GeoBuilder } from '../world/builder.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { damp, clamp } from '../core/collide.js';

export const WEAPON_ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];

export const DEFS = {
  hammer: {
    name: 'HAMMER', full: 'HAMMER .50 SIDEARM', desc: 'Heavy semi-auto. Brutal headshots. Never runs dry.', kind: 'hitscan',
    mag: 8, reserve: Infinity, maxReserve: Infinity, rate: 3.6, auto: false, dmg: 40, head: 2.5, spread: 0.0025, moveSpread: 0.012,
    recoil: 0.085, kick: 0.07, reload: 1.05, range: 160, tracer: 0xfff0b0, sound: 'pistol', flash: 0xffc070, shake: 0.12, color: '#ffd27a',
  },
  ripsaw: {
    name: 'RIPSAW', full: 'RIPSAW ASSAULT RIFLE', desc: 'Full-auto workhorse. Spread blooms if you hold the trigger.', kind: 'hitscan',
    mag: 32, reserve: 128, maxReserve: 256, rate: 11, auto: true, dmg: 14, head: 1.9, spread: 0.008, moveSpread: 0.01, bloom: 0.0045, maxBloom: 0.05,
    recoil: 0.024, kick: 0.025, reload: 1.5, range: 120, tracer: 0xffd890, sound: 'rifle', flash: 0xffb060, shake: 0.035, color: '#3ef0d0',
  },
  breacher: {
    name: 'BREACHER', full: 'BREACHER PUMP SHOTGUN', desc: 'Nine pellets of close-range deletion. Knocks enemies back.', kind: 'hitscan',
    mag: 6, reserve: 30, maxReserve: 54, rate: 1.3, auto: false, dmg: 11, head: 1.4, pellets: 9, spread: 0.075, moveSpread: 0.0, falloff: [9, 24],
    recoil: 0.2, kick: 0.12, reloadShell: 0.42, range: 60, tracer: 0xffc070, sound: 'shotgun', flash: 0xffa040, shake: 0.28, knock: 7, color: '#ff8a3a',
  },
  lance: {
    name: 'LUMEN LANCE', full: 'LUMEN LANCE ENERGY RIFLE', desc: 'Hold to charge, release to fire a beam that pierces every enemy and shield.', kind: 'beam',
    mag: 6, reserve: 24, maxReserve: 42, chargeTime: 0.6, dmgMin: 32, dmgMax: 125, head: 1.6, rate: 2.2,
    recoil: 0.14, kick: 0.1, reload: 1.8, range: 160, sound: 'lance', flash: 0x40e0ff, shake: 0.3, color: '#40e0ff',
  },
  thumper: {
    name: 'THUMPER', full: 'THUMPER GRENADE LAUNCHER', desc: 'Arcing grenades, 4.5m blast. Rocket-jump off your own explosions.', kind: 'grenade',
    mag: 4, reserve: 12, maxReserve: 28, rate: 1.4, dmg: 95, radius: 4.5, speed: 30,
    recoil: 0.16, kick: 0.12, reload: 2.0, sound: 'launcher', flash: 0xff8030, shake: 0.2, color: '#ff5a3a',
  },
  arc: {
    name: 'ARC CASTER', full: 'ARC CASTER TESLA PROJECTOR', desc: 'Auto-targets the nearest threat and chains lightning between enemies. Short range.', kind: 'arc',
    mag: 48, reserve: 96, maxReserve: 192, rate: 8.5, auto: true, dmg: 10, range: 16, jumps: 3, jumpRange: 7,
    recoil: 0.02, kick: 0.015, reload: 1.6, sound: 'arc', flash: 0x9a80ff, shake: 0.03, color: '#a890ff',
  },
};

// ---------------------------------------------------------------------------------------
// Viewmodels
// ---------------------------------------------------------------------------------------
function vmMaterials() {
  const metal = psxify(new THREE.MeshLambertMaterial({ map: getTexture('gun'), color: 0xc8ccd4, vertexColors: true }));
  const dark = psxify(new THREE.MeshLambertMaterial({ map: getTexture('gun'), color: 0x3a3c44, vertexColors: true }));
  const glove = psxify(new THREE.MeshLambertMaterial({ map: getTexture('skin'), color: 0x2a2a30, vertexColors: true }));
  const sleeve = psxify(new THREE.MeshLambertMaterial({ map: getTexture('skin'), color: 0x4a4038, vertexColors: true }));
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  return { metal, dark, glove, sleeve, glow };
}

function buildViewmodel(id, M) {
  const gb = new GeoBuilder(0.4);
  const B = (x0, y0, z0, x1, y1, z1, m, tint) => gb.box(x0, y0, z0, x1, y1, z1, m, { tint });
  let muzzle = new THREE.Vector3(0, 0.03, -0.5);
  const glowParts = [];
  // right hand + sleeve (shared look)
  const hand = () => {
    B(-0.045, -0.13, 0.02, 0.045, -0.02, 0.12, M.glove);
    B(-0.06, -0.2, 0.08, 0.06, -0.08, 0.5, M.sleeve);
  };
  if (id === 'hammer') {
    B(-0.035, 0.0, -0.32, 0.035, 0.075, 0.06, M.metal);       // slide
    B(-0.028, 0.012, -0.36, 0.028, 0.06, -0.32, M.dark);     // barrel tip
    B(-0.03, -0.03, -0.26, 0.03, 0.0, 0.02, M.dark);         // frame
    B(-0.03, -0.14, -0.02, 0.03, -0.0, 0.06, M.dark);        // grip
    B(-0.012, 0.075, 0.02, 0.012, 0.09, 0.05, M.dark);       // rear sight
    B(-0.008, 0.075, -0.3, 0.008, 0.09, -0.28, M.dark);      // front sight
    B(0.036, 0.03, -0.25, 0.04, 0.045, -0.05, M.glow, [1, 0.8, 0.4]); // accent
    hand();
    muzzle = new THREE.Vector3(0, 0.04, -0.38);
  } else if (id === 'ripsaw') {
    B(-0.04, -0.02, -0.45, 0.04, 0.07, 0.12, M.metal);        // receiver
    B(-0.022, 0.005, -0.78, 0.022, 0.045, -0.45, M.metal);    // barrel
    B(-0.034, -0.01, -0.82, 0.034, 0.06, -0.76, M.dark);      // muzzle brake
    B(-0.045, -0.035, -0.62, 0.045, 0.06, -0.45, M.dark);     // handguard
    B(-0.03, -0.17, -0.3, 0.03, -0.02, -0.2, M.dark);         // mag
    B(-0.032, -0.14, 0.0, 0.032, -0.02, 0.06, M.dark);        // grip
    B(-0.035, -0.05, 0.12, 0.035, 0.06, 0.35, M.dark);        // stock
    B(-0.02, 0.07, -0.3, 0.02, 0.1, -0.05, M.dark);           // optic rail
    B(-0.025, 0.1, -0.22, 0.025, 0.14, -0.1, M.dark);         // optic
    B(-0.015, 0.105, -0.225, 0.015, 0.13, -0.221, M.glow, [0.3, 1, 0.85]);
    B(0.041, 0.02, -0.4, 0.045, 0.035, -0.05, M.glow, [0.25, 0.95, 0.8]);
    hand();
    // support hand under handguard
    B(-0.06, -0.09, -0.6, 0.03, -0.03, -0.5, M.glove);
    B(-0.2, -0.2, -0.55, -0.06, -0.08, -0.35, M.sleeve);
    muzzle = new THREE.Vector3(0, 0.025, -0.84);
  } else if (id === 'breacher') {
    B(-0.05, -0.01, -0.3, 0.05, 0.07, 0.1, M.dark);            // receiver
    B(-0.032, 0.025, -0.78, 0.032, 0.075, -0.3, M.metal);      // barrel
    B(-0.03, -0.025, -0.72, 0.03, 0.02, -0.3, M.metal);        // tube mag
    B(-0.045, -0.05, -0.6, 0.045, 0.03, -0.42, M.dark, 0.8);   // pump (animated separately below)
    B(-0.035, -0.15, 0.02, 0.035, -0.01, 0.09, M.dark);        // grip
    B(-0.04, -0.06, 0.1, 0.04, 0.05, 0.36, M.metal, 0.7);      // stock
    B(0.051, 0.0, -0.25, 0.055, 0.05, 0.05, M.glow, [1, 0.55, 0.2]);
    hand();
    B(-0.07, -0.1, -0.56, 0.03, -0.03, -0.46, M.glove);
    B(-0.22, -0.2, -0.5, -0.07, -0.08, -0.3, M.sleeve);
    muzzle = new THREE.Vector3(0, 0.05, -0.8);
  } else if (id === 'lance') {
    B(-0.05, -0.04, -0.4, 0.05, 0.08, 0.15, M.metal);
    B(-0.03, 0.0, -0.75, -0.012, 0.03, -0.4, M.dark);            // prong L
    B(0.012, 0.0, -0.75, 0.03, 0.03, -0.4, M.dark);              // prong R
    B(-0.012, 0.04, -0.72, 0.012, 0.06, -0.4, M.dark);           // prong top
    B(-0.035, -0.15, -0.02, 0.035, -0.04, 0.06, M.dark);
    B(-0.03, -0.06, 0.15, 0.03, 0.05, 0.38, M.dark);
    // coils (glow, animated by charge)
    for (let i = 0; i < 4; i++) B(-0.055, -0.02, -0.36 + i * 0.07, 0.055, 0.06, -0.33 + i * 0.07, M.glow, [0.25, 0.85, 1]);
    hand();
    B(-0.07, -0.1, -0.35, 0.03, -0.04, -0.25, M.glove);
    B(-0.22, -0.2, -0.3, -0.07, -0.08, -0.1, M.sleeve);
    muzzle = new THREE.Vector3(0, 0.015, -0.76);
  } else if (id === 'thumper') {
    gb.cylinder(0, 0.02, -0.28, 0.075, 0.6, 'z', 8, M.metal, { tint: 0.85 });
    gb.cylinder(0, 0.02, -0.6, 0.085, 0.06, 'z', 8, M.dark);
    B(-0.06, -0.08, -0.15, 0.06, 0.0, 0.1, M.dark);
    B(-0.035, -0.18, 0.0, 0.035, -0.05, 0.07, M.dark);
    B(-0.035, -0.07, 0.1, 0.035, 0.04, 0.3, M.dark);
    B(-0.02, 0.095, -0.4, 0.02, 0.13, -0.15, M.dark);
    B(0.075, 0.0, -0.45, 0.08, 0.04, -0.1, M.glow, [1, 0.35, 0.2]);
    hand();
    B(-0.08, -0.08, -0.45, 0.0, 0.0, -0.35, M.glove);
    B(-0.23, -0.2, -0.42, -0.08, -0.08, -0.2, M.sleeve);
    muzzle = new THREE.Vector3(0, 0.02, -0.64);
  } else if (id === 'arc') {
    // gauntlet with tesla prongs
    B(-0.07, -0.1, -0.2, 0.07, 0.03, 0.12, M.metal);
    B(-0.08, -0.12, 0.1, 0.08, 0.04, 0.4, M.dark);
    for (const [x, y] of [[-0.04, 0.03], [0.04, 0.03], [0, -0.07]]) B(x - 0.012, y - 0.012, -0.42, x + 0.012, y + 0.012, -0.2, M.dark);
    gb.cylinder(0, -0.02, -0.12, 0.05, 0.06, 'z', 6, M.glow, { tint: [0.65, 0.5, 1] });
    B(-0.02, -0.04, -0.44, 0.02, 0.0, -0.4, M.glow, [0.7, 0.55, 1]);
    muzzle = new THREE.Vector3(0, -0.02, -0.45);
  }
  const built = gb.build();
  const root = new THREE.Group();
  root.add(built.group);
  root.userData.muzzle = muzzle;
  // muzzle flash sprite (a pair of crossed quads)
  const fm = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  const q1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
  const q2 = q1.clone(); q2.rotation.y = Math.PI / 2;
  const q3 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm); q3.rotation.x = Math.PI / 2;
  flash.add(q1, q2, q3);
  flash.position.copy(muzzle);
  flash.visible = false;
  root.add(flash);
  root.userData.flash = flash;
  root.userData.flashMat = fm;
  root.visible = false;
  return root;
}

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
    this.scene.add(this.hemi, this.dir, this.muzzleLight);
    this.mats = vmMaterials();
    this.models = {};
    this.holder = new THREE.Group();
    this.holder.position.set(0.25, -0.24, -0.42);
    this.holder.scale.setScalar(0.82);
    this.scene.add(this.holder);
    for (const id of WEAPON_ORDER) { this.models[id] = buildViewmodel(id, this.mats); this.holder.add(this.models[id]); }
    // left fist for punch/parry
    const gb = new GeoBuilder(0.4);
    gb.box(-0.06, -0.06, -0.1, 0.06, 0.06, 0.04, this.mats.glove);
    gb.box(-0.07, -0.08, 0.04, 0.07, 0.07, 0.5, this.mats.sleeve);
    gb.box(-0.062, 0.0, -0.11, 0.062, 0.03, -0.06, this.mats.metal, { tint: 0.7 });
    this.fist = gb.build().group;
    this.fist.position.set(-0.22, -0.2, -0.2);
    this.fist.visible = false;
    this.scene.add(this.fist);
    this.reset();
    this.tmpV = new THREE.Vector3(); this.tmpD = new THREE.Vector3(); this.muzzleW = new THREE.Vector3();
  }

  reset() {
    this.owned = ['hammer', 'ripsaw'];
    this.ammo = {};
    for (const id of WEAPON_ORDER) this.ammo[id] = { mag: DEFS[id].mag, reserve: DEFS[id].reserve };
    this.current = 'hammer';
    this.last = 'ripsaw';
    this.cooldown = 0;
    this.reloadT = 0; this.reloading = false; this.reloadTotal = 1;
    this.switchT = 0; this.switchTo = null;
    this.charge = 0; this.charging = false; this.chargeSoundT = 0;
    this.bloom = 0;
    this.hitCounter = 0;
    this.recoilP = 0; this.recoilR = 0; this.recoilV = 0; this.recoilAccum = 0;
    this.swayX = 0; this.swayY = 0;
    this.flashT = 0;
    this.punchAnim = 0;
    this.pumpT = 0;
    this.autoReloadT = 0;
    for (const id of WEAPON_ORDER) this.models[id].visible = id === this.current;
  }

  def(id = this.current) { return DEFS[id]; }
  magSize(id = this.current) { const d = DEFS[id]; return Math.max(1, Math.round(d.mag * this.game.player.stats.magMul)); }

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
    this.game.audio.play('swap', null, 0.6);
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

  // Which owned weapon most needs ammo (for smart pickups)
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

  onPunch() { this.punchAnim = 0.28; }

  startReload() {
    const id = this.current, d = DEFS[id], a = this.ammo[id];
    if (this.reloading || this.switchTo || a.mag >= this.magSize() || a.reserve <= 0) return;
    this.reloading = true;
    this.charging = false; this.charge = 0;
    const mul = this.game.player.stats.reloadMul;
    if (d.reloadShell) this.reloadTotal = this.reloadT = d.reloadShell / mul;
    else this.reloadTotal = this.reloadT = d.reload / mul;
    this.game.audio.play('reload', null, 0.7);
  }

  update(dt, input) {
    const g = this.game;
    const p = g.player;
    this.cooldown -= dt;
    this.flashT -= dt;
    this.punchAnim -= dt;
    this.pumpT -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    // recoil recovery: the view settles back toward where the player was aiming
    if (this.recoilAccum > 0) {
      const rec = this.recoilAccum * Math.min(1, dt * (input.fire && DEFS[this.current].auto ? 3 : 7));
      p.pitch -= rec;
      this.recoilAccum -= rec;
      if (this.recoilAccum < 1e-4) this.recoilAccum = 0;
    }

    // selection
    if (input.slot >= 0 && input.slot < WEAPON_ORDER.length) this.select(WEAPON_ORDER[input.slot]);
    if (input.wheel) {
      const i = this.owned.indexOf(this.current);
      const n = (i + (input.wheel > 0 ? 1 : -1) + this.owned.length) % this.owned.length;
      this.select(this.owned[n]);
    }
    if (input.wasPressed('lastWeapon')) {
      if (input.usingTouch) {
        const i = this.owned.indexOf(this.current);
        this.select(this.owned[(i + 1) % this.owned.length]);
      } else if (this.owned.includes(this.last)) this.select(this.last);
    }
    if (this.switchTo) {
      this.switchT -= dt;
      if (this.switchT <= 0.16 && this.current !== this.switchTo) {
        this.models[this.current].visible = false;
        this.last = this.current;
        this.current = this.switchTo;
        this.models[this.current].visible = true;
        this.cooldown = Math.max(this.cooldown, 0.12);
      }
      if (this.switchT <= 0) this.switchTo = null;
    }

    const id = this.current, d = DEFS[id], a = this.ammo[id];

    // reload
    if (input.wasPressed('reload')) this.startReload();
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (d.reloadShell) {
          a.mag++; a.reserve--;
          g.audio.play('shell', null, 0.7);
          if (a.mag < this.magSize() && a.reserve > 0 && !(input.fire && a.mag > 0)) this.reloadT = this.reloadTotal;
          else { this.reloading = false; this.pumpT = 0.3; g.audio.play('reloadEnd', null, 0.6); }
        } else {
          const need = this.magSize() - a.mag;
          const take = Math.min(need, a.reserve);
          a.mag += take;
          if (isFinite(a.reserve)) a.reserve -= take;
          this.reloading = false;
          g.audio.play('reloadEnd', null, 0.7);
        }
      }
    }
    // auto reload when empty
    if (a.mag <= 0 && !this.reloading && !this.switchTo && a.reserve > 0) {
      this.autoReloadT += dt;
      if (this.autoReloadT > 0.18) { this.autoReloadT = 0; this.startReload(); }
    } else this.autoReloadT = 0;

    // touch aim assist (gentle rotation toward nearest target near crosshair while firing)
    if (input.usingTouch && g.settings.get('aimAssist') && input.fire) this.aimAssist(dt);

    // firing
    const canFire = !this.switchTo && this.cooldown <= 0 && p.alive;
    const rateMul = p.stats.fireRateMul * (p.stats.adrenaline && g.style.rankIndex >= 3 ? 1 + 0.25 * p.stats.adrenaline : 1);
    if (d.kind === 'beam') {
      if (input.fire && canFire && a.mag > 0 && !this.reloading) {
        if (!this.charging) { this.charging = true; this.charge = 0; g.audio.play('lanceCharge', null, 0.6); }
        this.charge = Math.min(1, this.charge + dt / (d.chargeTime / p.stats.lanceCharge));
      } else if (this.charging) {
        if (!input.fire || a.mag <= 0) {
          if (this.charge > 0.12 && canFire && a.mag > 0) this.fireBeam(d, a);
          this.charging = false; this.charge = 0;
          this.cooldown = 1 / (d.rate * rateMul);
        }
      }
    } else if (input.fire && canFire) {
      // semi-autos fire on press (or buffered press); on touch, holding fire repeats at the weapon's rate
      const pressedNow = input.firePressed || d.auto || this.wantSemi || input.usingTouch;
      if (pressedNow) {
        if (a.mag > 0) {
          if (this.reloading && d.reloadShell) this.reloading = false; // shotgun can interrupt reload
          if (!this.reloading) {
            this.fire(d, a);
            this.wantSemi = false;
            const rate = d.rate * rateMul * (id === 'thumper' ? p.stats.launcherRateMul : 1);
            this.cooldown = 1 / rate;
          }
        } else if (input.firePressed) {
          g.audio.play('dry', null, 0.5);
          this.startReload();
        }
      }
    }
    // buffer a semi-auto press that arrives slightly before the cooldown ends
    if (!d.auto && input.firePressed && this.cooldown > 0 && this.cooldown < 0.15) this.wantSemi = true;
    if (!input.fire) this.wantSemi = false;
    if (d.kind === 'hitscan' && d.auto && !input.fire) this.bloom = Math.max(0, this.bloom - dt * 0.2);

    this.animate(dt, input);
  }

  aimAssist(dt) {
    const g = this.game;
    const cam = g.camera;
    const dir = cam.getWorldDirection(this.tmpD);
    let best = null, ba = 0.11; // ~6 degrees
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
    const tyaw = Math.atan2(-v.x, -v.z);
    const tpitch = Math.asin(clamp(v.y, -1, 1));
    let dy = tyaw - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = Math.min(1, dt * 5);
    p.yaw += dy * k * 0.6;
    p.pitch += (tpitch - p.pitch) * k * 0.5;
  }

  muzzleWorld() {
    // Approximate muzzle position in world space (used for tracers / lights)
    const cam = this.game.camera;
    const m = this.models[this.current].userData.muzzle;
    const v = this.muzzleW.set(this.holder.position.x + m.x * 0.9, this.holder.position.y + m.y + 0.05, -0.75);
    return v.applyMatrix4(cam.matrixWorld);
  }

  spreadDir(base, spread, out) {
    // random direction within a cone
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const up = Math.abs(base.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(base, up).normalize();
    const v = new THREE.Vector3().crossVectors(base, u).normalize();
    out.copy(base).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
    return out;
  }

  magnet(dir) {
    // touch bullet magnetism: bend a shot toward an enemy within ~3 degrees of the aim
    const g = this.game;
    if (!g.input.usingTouch || !g.settings.get('aimAssist')) return dir;
    const cam = g.camera.position;
    let best = null, ba = 0.055;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      for (const pt of [e.headPos(), e.centerPos()]) {
        const v = this.tmpV.subVectors(pt, cam).normalize();
        const ang = Math.acos(clamp(v.dot(dir), -1, 1));
        if (ang < ba) { ba = ang; best = pt; }
      }
    }
    const boss = g.bosses.active;
    if (boss && boss.alive) for (const hb of boss.hitboxes()) {
      const v = this.tmpV.set(hb.x - cam.x, hb.y - cam.y, hb.z - cam.z).normalize();
      const ang = Math.acos(clamp(v.dot(dir), -1, 1));
      if (ang < ba && !hb.shielded) { ba = ang; best = new THREE.Vector3(hb.x, hb.y, hb.z); }
    }
    if (best) dir.copy(best).sub(cam).normalize();
    return dir;
  }

  consumeAmmo(a, n = 1) { a.mag = Math.max(0, a.mag - n); }

  kick(d) {
    this.recoilV += d.kick * (this.game.player.stats.spreadMul < 1 ? 0.7 : 1);
    const p = this.game.player;
    const rk = d.recoil * (p.stats.spreadMul < 1 ? 0.6 : 1);
    const kickUp = rk * (0.7 + Math.random() * 0.3);
    p.pitch = Math.min(1.5, p.pitch + kickUp);
    this.recoilAccum = (this.recoilAccum || 0) + kickUp;
    p.yaw += (Math.random() - 0.5) * rk * 0.4;
    this.flashT = 0.05;
    const fl = this.models[this.current].userData.flash;
    fl.visible = true;
    fl.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.6;
    fl.scale.set(s, s, s);
    this.models[this.current].userData.flashMat.color.setHex(d.flash);
    this.muzzleLight.color.setHex(d.flash);
    this.muzzleLight.intensity = 3;
    const mw = this.muzzleWorld();
    this.game.fx.muzzle(mw.x, mw.y, mw.z, d.flash, 1);
    this.game.addShake(d.shake);
    this.game.run.shots++;
  }

  fire(d, a) {
    const g = this.game;
    const p = g.player;
    const cam = g.camera;
    const id = this.current;
    this.consumeAmmo(a, 1);
    g.audio.play(d.sound, null, 0.9);
    this.kick(d);
    if (id === 'breacher') this.pumpT = 0.45;
    const base = cam.getWorldDirection(new THREE.Vector3());
    const origin = cam.position.clone();
    const muzzle = this.muzzleWorld().clone();
    if (d.kind === 'grenade') {
      this.magnet(base);
      g.projectiles.spawnGrenade(origin.clone().addScaledVector(base, 0.6).add(new THREE.Vector3(0, -0.1, 0)), base.clone().multiplyScalar(d.speed).add(new THREE.Vector3(0, 3.2, 0)).add(p.body.vel.clone().multiplyScalar(0.4)), {
        dmg: d.dmg * p.stats.dmgMul * p.stats.explosiveDmgMul,
        radius: d.radius * p.stats.explosiveRadiusMul,
        cluster: p.stats.cluster,
      });
      return;
    }
    if (d.kind === 'arc') { this.fireArc(d, origin, base, muzzle); return; }
    // hitscan
    const pellets = (d.pellets || 1) + (id === 'breacher' ? p.stats.shotgunPellets : 0);
    const moving = Math.min(1, p.speedNow / 8) * (p.body.grounded ? 1 : 1.5);
    let spread = (d.spread + (d.moveSpread || 0) * moving + this.bloom) * p.stats.spreadMul;
    if (g.input.ads && id !== 'breacher') spread *= 0.35;
    if (d.bloom) this.bloom = Math.min(d.maxBloom, this.bloom + d.bloom);
    const dir = new THREE.Vector3();
    const dmgMul = p.stats.dmgMul * (id === 'ripsaw' ? p.stats.rifleDmg : 1);
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      this.spreadDir(base, spread, dir);
      if (pellets === 1) this.magnet(dir);
      let skip = null;
      let pierceLeft = id === 'ripsaw' ? p.stats.riflePierce : 0;
      let o = origin;
      for (let k = 0; k < 1 + pierceLeft; k++) {
        const hit = g.combat.raycast(o, dir, d.range, { skip });
        const end = hit ? hit.point : origin.clone().addScaledVector(dir, d.range);
        if (k === 0 && (pellets === 1 || i % 2 === 0)) g.fx.tracer(muzzle, end, d.tracer, pellets > 1 ? 0.05 : 0.07);
        if (!hit) break;
        let dmg = d.dmg * dmgMul;
        if (d.falloff) {
          const t = clamp((hit.t - d.falloff[0]) / (d.falloff[1] - d.falloff[0]), 0, 1);
          dmg *= 1 - t * 0.7;
        }
        if (hit.kind === 'world') {
          g.fx.impact(hit.point, hit.normal, hit.surface, pellets > 1 ? 0.5 : 1);
          if (hit.box.tag === 'barrier' && hit.box.ref) { hit.box.ref.hp -= dmg; g.hud.hitMarker('shield'); }
          if (p.stats.explosiveEvery) this.countExplosive(hit.point, false);
          break;
        }
        anyHit = true;
        if (hit.kind === 'enemy') {
          const e = hit.enemy;
          const deadeye = id === 'hammer' && hit.part === 'head' && p.stats.deadeye;
          if (deadeye) { dmg *= 1 + 0.5 * p.stats.deadeye; a.mag = Math.min(this.magSize(), a.mag + 1); }
          g.combat.damageEnemy(e, dmg, { source: 'hitscan', part: hit.part, headMul: d.head, point: hit.point, dir: dir.clone(), knock: d.knock ? d.knock / pellets * 3 : 1.2, stagger: id === 'breacher' ? 0.12 : id === 'hammer' ? 0.25 : 0.05, dist: hit.t, dmg, quiet: pellets > 1 && i > 0 });
          if (p.stats.explosiveEvery) this.countExplosive(hit.point, true);
          if (!skip) skip = new Set();
          skip.add(e);
          o = hit.point.clone().addScaledVector(dir, 0.05);
          if (k === 0 && pierceLeft) g.fx.tracer(hit.point, hit.point.clone().addScaledVector(dir, 6), d.tracer, 0.05);
        } else if (hit.kind === 'boss') {
          g.combat.damageBoss(hit.boss, dmg, { source: 'hitscan', part: hit.part, point: hit.point, dir: dir.clone(), quiet: pellets > 1 && i > 0 });
          if (p.stats.explosiveEvery) this.countExplosive(hit.point, true);
          break;
        }
      }
    }
    if (anyHit && pellets > 1) g.audio.play('hit', null, 0.5);
  }

  countExplosive(point, onTarget) {
    const p = this.game.player;
    this.hitCounter++;
    const every = Math.max(2, 7 - p.stats.explosiveEvery * 2);
    if (this.hitCounter >= every && onTarget) {
      this.hitCounter = 0;
      const g = this.game;
      g.fx.explosion(point, 2.2, 0xffb040);
      g.audio.play('explosion', point, 0.45);
      g.combat.radialDamage(point, 2.6 * p.stats.explosiveRadiusMul, 32 * p.stats.explosiveDmgMul * p.stats.dmgMul, { source: 'explosion', noSelf: true, knock: 5 });
    }
  }

  fireBeam(d, a) {
    const g = this.game, p = g.player;
    this.consumeAmmo(a, 1);
    g.audio.play('lance', null, 1);
    this.kick(d);
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.magnet(dir);
    const o = cam.position.clone();
    const res = g.combat.raycastPierce(o, dir, d.range);
    const dmg = (d.dmgMin + (d.dmgMax - d.dmgMin) * this.charge) * p.stats.dmgMul;
    let kills = 0;
    for (const h of res.hits) {
      const wasAlive = h.enemy.alive;
      g.combat.damageEnemy(h.enemy, dmg, { source: 'hitscan', part: h.part, headMul: d.head, point: h.point, dir, knock: 6 * this.charge, stagger: 0.4, energy: true, pierce: true, dist: h.t });
      if (wasAlive && !h.enemy.alive) kills++;
    }
    if (res.bossHit && res.bossHit.t < res.end) {
      g.combat.damageBoss(g.bosses.active, dmg, { source: 'beam', part: res.bossHit.part, point: res.bossHit.point, energy: true });
    }
    if (kills >= 2) g.style.add('SKEWERED x' + kills, 20 * kills);
    if (kills >= 2 && p.stats.lanceCharge > 1) a.mag = Math.min(this.magSize(), a.mag + 1);
    const endT = res.world ? res.world.t : d.range;
    const end = o.clone().addScaledVector(dir, endT);
    const muzzle = this.muzzleWorld().clone();
    g.fx.beam(muzzle, end, 0x40e0ff, 0.12 + this.charge * 0.18, 0.35);
    g.fx.beam(muzzle, end, 0xffffff, 0.04 + this.charge * 0.05, 0.2);
    if (res.world) {
      g.fx.impact(end, new THREE.Vector3(res.world.nx, res.world.ny, res.world.nz), 'energy', 2);
      g.fx.sparksBurst(end, 0x40e0ff, 14, 6, 0.4);
    }
    if (this.charge > 0.95) g.style.add('FULL CHARGE', 5, true);
  }

  fireArc(d, origin, base, muzzle) {
    const g = this.game, p = g.player;
    // pick the enemy closest to the crosshair within range
    let target = null, bestScore = -1;
    const cands = [];
    for (const e of g.enemies.list) if (e.alive && e.targetable) cands.push({ pt: e.centerPos(), e });
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
    const dmg = d.dmg * p.stats.dmgMul;
    const jumps = d.jumps + p.stats.arcJumps;
    if (!target) {
      const hit = g.combat.rayWorld(origin, base, d.range * 0.6);
      const end = hit ? origin.clone().addScaledVector(base, hit.t) : origin.clone().addScaledVector(base, d.range * 0.6);
      this.lightning(muzzle, end);
      if (hit) g.fx.impact(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz), 'energy', 0.6);
      return;
    }
    let from = muzzle;
    const visited = new Set();
    let cur = target;
    for (let j = 0; j <= jumps && cur; j++) {
      this.lightning(from, cur.pt);
      if (cur.e) {
        visited.add(cur.e);
        g.combat.damageEnemy(cur.e, dmg * (j === 0 ? 1 : 0.8), { source: 'arc', part: 'body', point: cur.pt, dir: base, knock: 0.5, stagger: 0.15, energy: true, quiet: j > 0 });
        if (cur.e.flying) cur.e.stun = 0.5;
      } else if (cur.hb) {
        g.combat.damageBoss(boss, dmg, { source: 'arc', part: cur.hb, point: cur.pt, energy: true, quiet: j > 0 });
        break;
      }
      from = cur.pt;
      let next = null, nd = d.jumpRange;
      for (const e of g.enemies.list) {
        if (!e.alive || visited.has(e)) continue;
        const c = e.centerPos();
        const dist = c.distanceTo(from);
        if (dist < nd) { nd = dist; next = { pt: c, e }; }
      }
      if (next && j < jumps) g.style.add('CHAIN', 3, true);
      cur = next;
    }
  }

  lightning(a, b) {
    const fx = this.game.fx;
    const segs = 5;
    let prev = a.clone();
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().lerp(b, t);
      if (i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      fx.tracer(prev, p, 0xb0a0ff, 0.09);
      prev = p;
    }
    fx.sparksBurst(b, 0xb0a0ff, 4, 3, 0.2, 0.07);
  }

  animate(dt, input) {
    const g = this.game, p = g.player;
    const m = this.models[this.current];
    // recoil spring
    this.recoilP += this.recoilV;
    this.recoilV = 0;
    this.recoilP = damp(this.recoilP, 0, 14, dt);
    // sway from look
    this.swayX = damp(this.swayX, clamp(-input.lookDX * 4, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.lookDY * 4, -0.06, 0.06), 10, dt);
    const t = g.time;
    const bob = p.bobAmp;
    const bx = Math.cos(p.bob) * 0.012 * bob;
    const by = -Math.abs(Math.sin(p.bob)) * 0.016 * bob;
    const idle = Math.sin(t * 1.6) * 0.004;
    let sw = 0;
    if (this.switchTo) sw = this.switchT > 0.16 ? 1 - (this.switchT - 0.16) / 0.16 : this.switchT / 0.16;
    let rl = 0;
    if (this.reloading) {
      const k = 1 - this.reloadT / this.reloadTotal;
      rl = DEFS[this.current].reloadShell ? 0.35 + Math.sin(k * Math.PI) * 0.25 : Math.sin(k * Math.PI);
    }
    const ads = input.ads && !this.reloading ? 1 : 0;
    this.adsK = damp(this.adsK || 0, ads, 12, dt);
    const sprintK = p.sprint && p.body.grounded && p.speedNow > 6 && !input.fire ? 1 : 0;
    this.sprintK = damp(this.sprintK || 0, sprintK, 8, dt);
    const h = this.holder;
    h.position.set(
      0.21 - this.adsK * 0.21 + bx + this.swayX - this.sprintK * 0.04,
      -0.2 + this.adsK * 0.09 + by + idle - sw * 0.35 - rl * 0.08 + this.swayY + p.landDip * 0.5 - this.sprintK * 0.03,
      -0.4 + this.recoilP * 1.6 + this.adsK * 0.06,
    );
    h.rotation.set(this.recoilP * 2.2 + rl * 0.5 + sw * 0.6 - this.sprintK * 0.25, 0.09 * (1 - this.adsK) + this.swayX * 1.5 + this.sprintK * 0.5, 0.06 * (1 - this.adsK) + rl * 0.6 + this.sprintK * 0.15 + p.roll * 2);
    // shotgun pump
    if (this.current === 'breacher') m.children[0].position.z = this.pumpT > 0 ? Math.sin((1 - this.pumpT / 0.45) * Math.PI) * 0.05 : 0;
    // lance coil glow + shake while charging
    if (this.current === 'lance') {
      const c = this.charging ? this.charge : 0;
      h.position.x += (Math.random() - 0.5) * c * 0.006;
      h.position.y += (Math.random() - 0.5) * c * 0.006;
    }
    this.mats.glow.color.setScalar(this.current === 'lance' && this.charging ? 0.6 + this.charge * 1.4 : 1);
    // muzzle flash
    m.userData.flash.visible = this.flashT > 0;
    this.muzzleLight.intensity = this.flashT > 0 ? 3 : 0;
    // punch
    if (this.punchAnim > 0) {
      const k = this.punchAnim / 0.28;
      const ext = Math.sin((1 - k) * Math.PI);
      this.fist.visible = true;
      this.fist.position.set(-0.18 + ext * 0.08, -0.2 + ext * 0.08, -0.25 - ext * 0.35);
    } else this.fist.visible = false;
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  setTheme(theme) {
    this.hemi.color.setHex(theme.sky);
    this.hemi.groundColor.setHex(theme.ground);
  }
}
