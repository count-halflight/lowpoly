import * as THREE from 'three';
import { GeoBuilder } from '../world/builder.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { damp, clamp, raySphere } from '../core/collide.js';

export const WEAPON_ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];

export const DEFS = {
  hammer: {
    name: 'HAMMER', full: 'HAMMER .50 REVOLVER', desc: 'Heavy six-shooter. Brutal headshots, never runs dry. ALT: flip a coin and shoot it to ricochet a guaranteed headshot.', kind: 'hitscan',
    mag: 6, reserve: Infinity, maxReserve: Infinity, rate: 3.4, auto: false, dmg: 44, head: 2.5, spread: 0.002, moveSpread: 0.01,
    recoil: 0.09, kick: 0.07, reload: 1.15, range: 160, tracer: 0xfff0b0, sound: 'pistol', flash: 0xffc070, shake: 0.13, color: '#ffd27a',
    alt: 'COIN', altDesc: 'Coin toss: shoot a coin to ricochet into the nearest head (x2, chains).',
  },
  ripsaw: {
    name: 'RIPSAW', full: 'RIPSAW BATTLE RIFLE', desc: 'Full-auto silver rifle. Spread blooms on long bursts. ALT: launch a bouncing sawblade (4 rounds).', kind: 'hitscan',
    mag: 30, reserve: 150, maxReserve: 270, rate: 11, auto: true, dmg: 14, head: 1.9, spread: 0.008, moveSpread: 0.01, bloom: 0.0045, maxBloom: 0.05,
    recoil: 0.024, kick: 0.025, reload: 1.5, range: 120, tracer: 0xffd890, sound: 'rifle', flash: 0xffb060, shake: 0.035, color: '#8ff4e4',
    alt: 'SAWBLADE', altDesc: 'Sawblade: bounces off walls 3 times and shreds everything it passes.',
  },
  breacher: {
    name: 'BREACHER', full: 'BREACHER PUMP SHOTGUN', desc: 'Nine pellets of close-range deletion. ALT: eject a live core shell; shoot it mid-air for a huge blast.', kind: 'hitscan',
    mag: 6, reserve: 30, maxReserve: 54, rate: 1.3, auto: false, dmg: 11, head: 1.4, pellets: 9, spread: 0.075, moveSpread: 0.0, falloff: [9, 24],
    recoil: 0.2, kick: 0.12, reloadShell: 0.42, range: 60, tracer: 0xffc070, sound: 'shotgun', flash: 0xffa040, shake: 0.28, knock: 7, color: '#ff8a3a',
    alt: 'CORE EJECT', altDesc: 'Core eject (2 shells): lobbed explosive. Shoot it in the air to detonate it bigger.',
  },
  lance: {
    name: 'LUMEN LANCE', full: 'LUMEN LANCE RAILCANNON', desc: 'Hold to charge, release to fire a beam that pierces every enemy and shield. ALT: scope in for +25% headshots.', kind: 'beam',
    mag: 6, reserve: 24, maxReserve: 42, chargeTime: 0.6, dmgMin: 32, dmgMax: 125, head: 1.6, rate: 2.2,
    recoil: 0.14, kick: 0.1, reload: 1.8, range: 160, sound: 'lance', flash: 0x40e0ff, shake: 0.3, color: '#40e0ff',
    alt: 'SCOPE', altDesc: 'Hold to scope. Scoped headshots deal +25%.',
  },
  thumper: {
    name: 'THUMPER', full: 'THUMPER DRUM LAUNCHER', desc: 'Arcing grenades, 4.5m blast. Rocket-jump off your own explosions. ALT: sticky mines, ALT again to detonate.', kind: 'grenade',
    mag: 5, reserve: 15, maxReserve: 30, rate: 1.4, dmg: 95, radius: 4.5, speed: 30,
    recoil: 0.16, kick: 0.12, reload: 2.0, sound: 'launcher', flash: 0xff8030, shake: 0.2, color: '#ff5a3a',
    alt: 'STICKY', altDesc: 'Sticky mine: clings to walls and enemies. Press ALT again to detonate all.',
  },
  arc: {
    name: 'ARC CASTER', full: 'ARC CASTER TESLA PROJECTOR', desc: 'Auto-targets the nearest threat and chains lightning. ALT: EMP overload stuns everything nearby and erases enemy shots.', kind: 'arc',
    mag: 48, reserve: 96, maxReserve: 192, rate: 8.5, auto: true, dmg: 10, range: 16, jumps: 3, jumpRange: 7,
    recoil: 0.02, kick: 0.015, reload: 1.6, sound: 'arc', flash: 0x9a80ff, shake: 0.03, color: '#b0a0ff',
    alt: 'EMP', altDesc: 'EMP overload (12 cells, 6s cooldown): stun + projectile wipe in 7m.',
  },
};

// ---------------------------------------------------------------------------------------
// Viewmodels: built from boxes and cylinders, with separately animated parts.
// ---------------------------------------------------------------------------------------
function vmMaterials() {
  const L = (tex, color) => psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color, vertexColors: true }));
  return {
    chrome: L('gun', 0xdfe3ea),
    metal: L('gun', 0xa8acb6),
    dark: L('gun', 0x2c2e36),
    wood: L('crate', 0x7a4428),
    glove: L('skin', 0x1d1d24),
    sleeve: L('skin', 0x34303a),
    brass: L('gun', 0xd8b060),
    red: L('gun', 0xb02020),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
  };
}

function piece(build, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const gb = new GeoBuilder(0.4);
  build(gb);
  const g = gb.build().group;
  const grp = new THREE.Group();
  grp.add(g);
  grp.position.set(...pos);
  grp.rotation.set(...rot);
  return grp;
}

function buildViewmodel(id, M) {
  const root = new THREE.Group();
  const anim = {};
  const add = (p) => { root.add(p); return p; };
  const B = (gb, x0, y0, z0, x1, y1, z1, m, tint) => gb.box(x0, y0, z0, x1, y1, z1, m, { tint });
  const C = (gb, x, y, z, r, len, axis, segs, m, tint) => gb.cylinder(x, y, z, r, len, axis, segs, m, { tint });
  const rightHand = (gripPos, gripRot) => add(piece((gb) => {
    B(gb, -0.042, -0.115, -0.03, 0.042, -0.02, 0.07, M.glove);
    B(gb, -0.044, -0.03, -0.035, 0.044, -0.005, 0.02, M.glove, 0.85);
    B(gb, -0.05, -0.2, 0.05, 0.05, -0.08, 0.5, M.sleeve);
    B(gb, -0.052, -0.13, 0.04, 0.052, -0.09, 0.09, M.dark);
  }, gripPos, gripRot));
  const leftHand = (pos, len = 0.38) => add(piece((gb) => {
    B(gb, -0.045, -0.06, -0.05, 0.035, 0.0, 0.05, M.glove);
    B(gb, -0.03, -0.05, -0.065, 0.03, 0.015, -0.04, M.glove, 0.8);
    B(gb, -0.2, -0.16, -0.02, -0.045, -0.06, len - 0.05, M.sleeve);
  }, pos, [0, 0.35, 0]));
  let muzzle;

  if (id === 'hammer') {
    add(piece((gb) => {
      B(gb, -0.02, 0.035, -0.42, 0.02, 0.07, -0.06, M.chrome);
      B(gb, -0.008, 0.07, -0.42, 0.008, 0.082, -0.08, M.dark);
      B(gb, -0.016, 0.012, -0.3, 0.016, 0.036, -0.06, M.chrome, 0.85);
      B(gb, -0.004, 0.082, -0.41, 0.004, 0.1, -0.385, M.dark);
      B(gb, -0.024, -0.01, -0.07, 0.024, 0.085, 0.12, M.chrome, 0.9);
      B(gb, -0.006, -0.05, 0.02, 0.006, -0.042, 0.09, M.dark);
      B(gb, -0.006, -0.05, 0.02, 0.006, -0.01, 0.03, M.dark);
      B(gb, -0.004, -0.035, 0.05, 0.004, -0.005, 0.06, M.dark);
      B(gb, 0.024, 0.04, -0.2, 0.027, 0.05, -0.08, M.glow, [1, 0.75, 0.35]);
    }));
    anim.cyl = add(piece((gb) => {
      C(gb, 0, 0, 0, 0.044, 0.1, 'z', 8, M.chrome, 0.72);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; B(gb, Math.cos(a) * 0.04 - 0.006, Math.sin(a) * 0.04 - 0.006, -0.052, Math.cos(a) * 0.04 + 0.006, Math.sin(a) * 0.04 + 0.006, 0.052, M.dark); }
    }, [0, 0.036, -0.01]));
    anim.hammerSpur = add(piece((gb) => B(gb, -0.007, 0, 0, 0.007, 0.045, 0.028, M.dark), [0, 0.07, 0.11], [-0.5, 0, 0]));
    add(piece((gb) => { B(gb, -0.022, -0.14, -0.03, 0.022, 0.0, 0.035, M.wood); B(gb, -0.023, -0.145, -0.032, 0.023, -0.13, 0.037, M.dark); }, [0, -0.005, 0.1], [0.35, 0, 0]));
    rightHand([0, -0.005, 0.1], [0.35, 0, 0]);
    muzzle = new THREE.Vector3(0, 0.052, -0.44);
  } else if (id === 'ripsaw') {
    add(piece((gb) => {
      B(gb, -0.035, -0.015, -0.32, 0.035, 0.06, 0.1, M.chrome);
      B(gb, 0.035, 0.0, -0.25, 0.038, 0.04, 0.0, M.dark);
      B(gb, -0.04, -0.03, -0.62, 0.04, 0.055, -0.32, M.dark, 0.9);
      for (let z = -0.6; z < -0.35; z += 0.05) { B(gb, 0.04, 0.0, z, 0.042, 0.03, z + 0.025, M.chrome, 0.7); B(gb, -0.042, 0.0, z, -0.04, 0.03, z + 0.025, M.chrome, 0.7); }
      C(gb, 0, 0.02, -0.77, 0.014, 0.3, 'z', 6, M.chrome);
      C(gb, 0, 0.02, -0.93, 0.022, 0.06, 'z', 6, M.dark);
      B(gb, -0.004, 0.035, -0.9, 0.004, 0.07, -0.88, M.dark);
      B(gb, -0.018, 0.06, -0.6, 0.018, 0.072, 0.05, M.dark);
      C(gb, 0, 0.1, -0.15, 0.026, 0.22, 'z', 8, M.dark);
      B(gb, -0.012, 0.07, -0.08, 0.012, 0.085, -0.02, M.dark); B(gb, -0.012, 0.07, -0.27, 0.012, 0.085, -0.21, M.dark);
      B(gb, -0.016, 0.088, -0.262, 0.016, 0.112, -0.258, M.glow, [0.4, 1, 0.85]);
      B(gb, -0.03, -0.04, 0.1, 0.03, 0.05, 0.36, M.dark);
      B(gb, -0.032, -0.06, 0.34, 0.032, 0.06, 0.38, M.dark, 0.7);
      B(gb, 0.036, 0.02, -0.3, 0.039, 0.03, -0.05, M.glow, [0.35, 0.95, 0.8]);
    }));
    anim.mag = add(piece((gb) => { B(gb, -0.022, -0.17, -0.04, 0.022, 0, 0.04, M.dark); B(gb, -0.023, -0.18, -0.045, 0.023, -0.165, 0.045, M.metal); }, [0, -0.015, -0.17], [0.25, 0, 0]));
    anim.bolt = add(piece((gb) => B(gb, 0.036, 0.0, 0, 0.055, 0.016, 0.03, M.metal), [0, 0.03, -0.05]));
    add(piece((gb) => B(gb, -0.022, -0.12, -0.025, 0.022, 0, 0.03, M.dark), [0, -0.015, 0.04], [0.3, 0, 0]));
    rightHand([0, -0.015, 0.04], [0.3, 0, 0]);
    leftHand([-0.005, -0.03, -0.5]);
    muzzle = new THREE.Vector3(0, 0.02, -0.97);
  } else if (id === 'breacher') {
    add(piece((gb) => {
      B(gb, -0.04, -0.02, -0.2, 0.04, 0.06, 0.08, M.dark);
      C(gb, 0, 0.045, -0.47, 0.021, 0.55, 'z', 8, M.chrome);
      C(gb, 0, 0.004, -0.42, 0.017, 0.45, 'z', 8, M.chrome, 0.8);
      B(gb, -0.003, 0.066, -0.74, 0.003, 0.074, -0.73, M.brass);
      B(gb, -0.032, -0.06, 0.08, 0.032, 0.05, 0.38, M.wood);
      B(gb, -0.034, -0.08, 0.36, 0.034, 0.06, 0.4, M.dark);
      for (let i = 0; i < 4; i++) { B(gb, -0.052, 0.0, -0.17 + i * 0.045, -0.04, 0.035, -0.135 + i * 0.045, M.red); B(gb, -0.053, 0.0, -0.17 + i * 0.045, -0.05, 0.035, -0.16 + i * 0.045, M.brass); }
    }));
    anim.pump = add(piece((gb) => {
      B(gb, -0.036, -0.022, -0.09, 0.036, 0.034, 0.09, M.wood, 0.9);
      for (let z = -0.08; z < 0.08; z += 0.025) B(gb, -0.038, -0.024, z, 0.038, 0.036, z + 0.01, M.dark, 0.9);
    }, [0, 0, -0.42]));
    add(piece((gb) => B(gb, -0.024, -0.13, -0.025, 0.024, 0, 0.035, M.wood), [0, -0.02, 0.07], [0.4, 0, 0]));
    rightHand([0, -0.02, 0.07], [0.4, 0, 0]);
    anim.leftHand = leftHand([-0.005, -0.03, -0.42]);
    muzzle = new THREE.Vector3(0, 0.045, -0.76);
  } else if (id === 'lance') {
    add(piece((gb) => {
      B(gb, -0.05, -0.03, -0.35, 0.05, 0.08, 0.15, M.chrome);
      B(gb, -0.035, 0.0, -0.76, -0.02, 0.03, -0.35, M.dark); B(gb, 0.02, 0.0, -0.76, 0.035, 0.03, -0.35, M.dark);
      B(gb, -0.008, 0.045, -0.72, 0.008, 0.06, -0.35, M.dark);
      for (let z = -0.3; z < 0.1; z += 0.06) B(gb, -0.055, 0.08, z, 0.055, 0.1, z + 0.03, M.dark);
      B(gb, -0.03, -0.09, -0.25, 0.03, -0.03, -0.05, M.dark);
      B(gb, -0.031, -0.08, -0.24, 0.031, -0.04, -0.06, M.glow, [0.3, 0.85, 1]);
      B(gb, -0.03, -0.05, 0.15, 0.03, 0.06, 0.4, M.dark);
    }));
    anim.coils = add(piece((gb) => { for (let i = 0; i < 4; i++) C(gb, 0, 0.025, -0.33 + i * 0.07, 0.058, 0.025, 'z', 8, M.glow, [0.25, 0.85, 1]); }));
    add(piece((gb) => B(gb, -0.024, -0.13, -0.025, 0.024, 0, 0.035, M.dark), [0, -0.03, 0.06], [0.3, 0, 0]));
    rightHand([0, -0.03, 0.06], [0.3, 0, 0]);
    leftHand([-0.01, -0.03, -0.3]);
    muzzle = new THREE.Vector3(0, 0.015, -0.78);
  } else if (id === 'thumper') {
    add(piece((gb) => {
      C(gb, 0, 0.025, -0.36, 0.05, 0.42, 'z', 10, M.chrome, 0.9);
      C(gb, 0, 0.025, -0.58, 0.058, 0.04, 'z', 10, M.dark);
      B(gb, -0.03, 0.08, -0.32, 0.03, 0.1, 0.1, M.dark);
      B(gb, -0.02, 0.1, -0.12, 0.02, 0.15, -0.1, M.dark); B(gb, -0.02, 0.1, -0.3, 0.02, 0.14, -0.28, M.dark);
      B(gb, -0.03, -0.07, 0.08, 0.03, 0.04, 0.12, M.dark); B(gb, -0.012, -0.03, 0.12, 0.012, 0.0, 0.36, M.dark);
      B(gb, 0.05, 0.0, -0.45, 0.054, 0.04, -0.2, M.glow, [1, 0.35, 0.2]);
    }));
    anim.drum = add(piece((gb) => {
      C(gb, 0, 0, 0, 0.078, 0.14, 'z', 10, M.dark);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; B(gb, Math.cos(a) * 0.05 - 0.012, Math.sin(a) * 0.05 - 0.012, 0.069, Math.cos(a) * 0.05 + 0.012, Math.sin(a) * 0.05 + 0.012, 0.072, M.glow, [1, 0.4, 0.2]); }
    }, [0, 0.0, -0.06]));
    add(piece((gb) => B(gb, -0.024, -0.13, -0.025, 0.024, 0, 0.035, M.dark), [0, -0.07, 0.09], [0.3, 0, 0]));
    rightHand([0, -0.07, 0.09], [0.3, 0, 0]);
    leftHand([-0.01, -0.03, -0.38]);
    muzzle = new THREE.Vector3(0, 0.025, -0.62);
  } else if (id === 'arc') {
    add(piece((gb) => {
      B(gb, -0.07, -0.1, -0.2, 0.07, 0.03, 0.12, M.chrome, 0.9);
      B(gb, -0.08, -0.12, 0.1, 0.08, 0.04, 0.45, M.dark);
      for (const [x, y] of [[-0.04, 0.03], [0.04, 0.03], [0, -0.07]]) B(gb, x - 0.012, y - 0.012, -0.42, x + 0.012, y + 0.012, -0.2, M.dark);
      B(gb, -0.02, -0.04, -0.44, 0.02, 0.0, -0.4, M.glow, [0.8, 0.65, 1]);
      for (let i = 0; i < 3; i++) B(gb, -0.081, -0.11, 0.15 + i * 0.09, 0.081, -0.09, 0.19 + i * 0.09, M.metal);
    }));
    anim.coils = add(piece((gb) => { for (const x of [-0.04, 0.04]) { C(gb, x, 0.07, -0.05, 0.022, 0.08, 'y', 6, M.glow, [0.75, 0.6, 1]); C(gb, x, 0.115, -0.05, 0.03, 0.015, 'y', 6, M.metal); } }));
    muzzle = new THREE.Vector3(0, -0.02, -0.45);
  }

  const fm = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  const q1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
  const q2 = q1.clone(); q2.rotation.y = Math.PI / 2;
  const q3 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm); q3.rotation.x = Math.PI / 2;
  flash.add(q1, q2, q3);
  flash.position.copy(muzzle);
  flash.visible = false;
  root.add(flash);
  root.userData = { muzzle, flash, flashMat: fm, anim };
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
    this.holder.position.set(0.21, -0.2, -0.4);
    this.holder.scale.setScalar(0.82);
    this.scene.add(this.holder);
    for (const id of WEAPON_ORDER) { this.models[id] = buildViewmodel(id, this.mats); this.holder.add(this.models[id]); }
    const gb = new GeoBuilder(0.4);
    gb.box(-0.06, -0.06, -0.1, 0.06, 0.06, 0.04, this.mats.glove);
    gb.box(-0.07, -0.08, 0.04, 0.07, 0.07, 0.5, this.mats.sleeve);
    gb.box(-0.062, 0.0, -0.11, 0.062, 0.03, -0.06, this.mats.metal, { tint: 0.7 });
    this.fist = gb.build().group;
    this.fist.position.set(-0.22, -0.2, -0.2);
    this.fist.visible = false;
    this.scene.add(this.fist);
    this.coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.018, 10);
    this.coinMat = new THREE.MeshBasicMaterial({ color: 0xffd040 });
    this.coins = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.coinGeo, this.coinMat);
      m.visible = false;
      game.scene.add(m);
      this.coins.push({ mesh: m, alive: false, pos: m.position, vel: new THREE.Vector3(), t: 0 });
    }
    this.tmpV = new THREE.Vector3(); this.tmpD = new THREE.Vector3(); this.muzzleW = new THREE.Vector3();
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
    this.recoilP = 0; this.recoilV = 0; this.recoilAccum = 0;
    this.swayX = 0; this.swayY = 0;
    this.flashT = 0; this.punchAnim = 0; this.pumpT = 0; this.autoReloadT = 0;
    this.cylAngle = 0; this.cylTarget = 0; this.drumAngle = 0; this.boltT = 0;
    this.coinCharges = 4;
    for (const c of this.coins) { c.alive = false; c.mesh.visible = false; }
    for (const id of WEAPON_ORDER) this.models[id].visible = id === this.current;
  }

  // checkpoint support
  snapshot() { return { owned: this.owned.slice(), ammo: JSON.parse(JSON.stringify(this.ammo, (k, v) => (v === Infinity ? 'INF' : v))), current: this.current }; }
  restore(s) {
    this.reset();
    this.owned = s.owned.slice();
    for (const id of WEAPON_ORDER) {
      const a = s.ammo[id];
      if (a) this.ammo[id] = { mag: a.mag, reserve: a.reserve === 'INF' ? Infinity : a.reserve };
    }
    for (const id of WEAPON_ORDER) this.models[id].visible = false;
    this.current = this.owned.includes(s.current) ? s.current : this.owned[0];
    this.models[this.current].visible = true;
  }

  def(id = this.current) { return DEFS[id]; }
  magSize(id = this.current) { return Math.max(1, Math.round(DEFS[id].mag * this.game.player.stats.magMul)); }

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

  onPunch() { this.punchAnim = 0.28; }

  altInfo() {
    if (this.current === 'hammer') return 'COINS ' + Math.floor(this.coinCharges);
    if (this.current === 'arc') return this.empCd > 0 ? 'EMP ' + this.empCd.toFixed(1) + 's' : 'EMP READY';
    if (this.current === 'thumper') { const n = this.game.projectiles.list.filter((p) => p.active && p.kind === 'sticky').length; return n ? 'MINES ' + n + ' - ALT TO BLOW' : ''; }
    return '';
  }

  startReload() {
    const id = this.current, d = DEFS[id], a = this.ammo[id];
    if (this.reloading || this.switchTo || a.mag >= this.magSize() || a.reserve <= 0) return;
    this.reloading = true;
    this.charging = false; this.charge = 0;
    this.reloadTotal = this.reloadT = (d.reloadShell || d.reload) / this.game.player.stats.reloadMul;
    this.game.audio.play('reload', null, 0.7);
    this.game.emit('reload');
  }

  update(dt, input) {
    const g = this.game;
    const p = g.player;
    this.cooldown -= dt; this.altCd -= dt; this.empCd -= dt;
    this.flashT -= dt; this.punchAnim -= dt; this.pumpT -= dt; this.boltT -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.coinCharges = Math.min(p.stats.coinMax, this.coinCharges + dt * 0.9);
    if (this.recoilAccum > 0) {
      const rec = this.recoilAccum * Math.min(1, dt * (input.fire && DEFS[this.current].auto ? 3 : 7));
      p.pitch -= rec; this.recoilAccum -= rec;
      if (this.recoilAccum < 1e-4) this.recoilAccum = 0;
    }
    this.updateCoins(dt);

    if (input.slot >= 0 && input.slot < WEAPON_ORDER.length) this.select(WEAPON_ORDER[input.slot]);
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
      }
      if (this.switchT <= 0) this.switchTo = null;
    }

    const id = this.current, d = DEFS[id], a = this.ammo[id];
    input.ads = (id === 'lance' && input.alt && !this.reloading) || input.isHeld('zoom');

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

    if (input.usingTouch && g.settings.get('aimAssist') && input.fire) this.aimAssist(dt);
    if (input.wasPressed('altTap') && !this.switchTo && p.alive) this.altFire(id, d, a);

    const canFire = !this.switchTo && this.cooldown <= 0 && p.alive;
    const rateMul = p.stats.fireRateMul * (p.stats.adrenaline && g.style.rankIndex >= 3 ? 1 + 0.25 * p.stats.adrenaline : 1);
    if (d.kind === 'beam') {
      if (input.fire && canFire && a.mag > 0 && !this.reloading) {
        if (!this.charging) { this.charging = true; this.charge = 0; g.audio.play('lanceCharge', null, 0.6); }
        this.charge = Math.min(1, this.charge + dt / (d.chargeTime / p.stats.lanceCharge));
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

  // ---------------------------------------------------------------- alt fires
  altFire(id, d, a) {
    const g = this.game, p = g.player;
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const o = cam.position.clone();
    if (id === 'hammer') {
      if (this.coinCharges < 1) { g.audio.play('dry', null, 0.4); return; }
      const c = this.coins.find((x) => !x.alive) || this.coins[0];
      this.coinCharges -= 1;
      c.alive = true; c.t = 0; c.mesh.visible = true;
      c.pos.copy(o).addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
      c.vel.copy(dir).multiplyScalar(7).add(new THREE.Vector3(0, 7.5, 0)).addScaledVector(p.body.vel, 0.9);
      g.audio.play('coin', null, 0.8);
      this.punchAnim = 0.2;
      g.emit('coin');
      return;
    }
    if (id === 'lance') return; // scope is a hold, handled in update
    if (this.altCd > 0) return;
    if (id === 'ripsaw') {
      if (a.mag < 4) { g.audio.play('dry', null, 0.4); this.startReload(); return; }
      a.mag -= 4;
      this.altCd = 0.7;
      g.projectiles.spawn({ pos: o.clone().addScaledVector(dir, 0.8), vel: dir.clone().multiplyScalar(26), dmg: 20 * p.stats.dmgMul, radius: 0.3, size: 0.28, color: 0xc8f8ff, life: 2.4, kind: 'saw', friendly: true, parryable: false });
      g.audio.play('saw', null, 0.9);
      this.kick({ ...d, kick: 0.05, recoil: 0.05, shake: 0.06, flash: 0x9ff4ff });
      g.emit('alt', id);
    } else if (id === 'breacher') {
      if (a.mag < 2) { g.audio.play('dry', null, 0.4); this.startReload(); return; }
      a.mag -= 2;
      this.altCd = 0.9;
      g.projectiles.spawn({ pos: o.clone().addScaledVector(dir, 0.7), vel: dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 4, 0)).addScaledVector(p.body.vel, 0.5), dmg: 70 * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: 0.18, size: 0.16, color: 0xffb030, life: 3, kind: 'core', friendly: true, gravity: 16, explode: 3.6 * p.stats.explosiveRadiusMul, parryable: false });
      g.audio.play('launcher', null, 0.7);
      this.pumpT = 0.45;
      this.kick({ ...d, kick: 0.08, recoil: 0.08, shake: 0.1 });
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
      g.emit('emp');
      g.emit('alt', id);
    }
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
      if (c.t > 2.6) this.breakCoin(c);
      else if (Math.random() < 0.3) g.fx.sparks.spawn(c.pos.x, c.pos.y, c.pos.z, 0, 0, 0, 1, 0.8, 0.2, 1, 0.06, 0.15, 0, 0);
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
    g.style.add(chain > 0 ? 'RICOSHOT x' + (chain + 1) : 'RICOSHOT', 35 + chain * 25);
    g.emit('ricoshot', chain + 1);
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

  muzzleWorld() {
    const cam = this.game.camera;
    const m = this.models[this.current].userData.muzzle;
    return this.muzzleW.set(this.holder.position.x + m.x * 0.9, this.holder.position.y + m.y + 0.05, -0.75).applyMatrix4(cam.matrixWorld);
  }

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

  kick(d) {
    const p = this.game.player;
    this.recoilV += d.kick * (p.stats.spreadMul < 1 ? 0.7 : 1);
    const rk = d.recoil * (p.stats.spreadMul < 1 ? 0.6 : 1);
    const kickUp = rk * (0.7 + Math.random() * 0.3);
    p.pitch = Math.min(1.5, p.pitch + kickUp);
    this.recoilAccum += kickUp;
    p.yaw += (Math.random() - 0.5) * rk * 0.4;
    this.flashT = 0.05;
    const ud = this.models[this.current].userData;
    ud.flash.visible = true;
    ud.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.6;
    ud.flash.scale.set(s, s, s);
    ud.flashMat.color.setHex(d.flash);
    this.muzzleLight.color.setHex(d.flash);
    this.muzzleLight.intensity = 3;
    const mw = this.muzzleWorld();
    this.game.fx.muzzle(mw.x, mw.y, mw.z, d.flash, 1);
    this.game.addShake(d.shake);
    this.game.run.shots++;
  }

  ejectBrass(big = false) {
    const g = this.game;
    const cam = g.camera;
    const p = new THREE.Vector3(0.18, -0.08, -0.45).applyMatrix4(cam.matrixWorld);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const v = r.multiplyScalar(2.5 + Math.random()).add(new THREE.Vector3(0, 2.5 + Math.random(), 0)).add(g.player.body.vel.clone().multiplyScalar(0.8));
    g.fx.dust.spawn(p.x, p.y, p.z, v.x, v.y, v.z, big ? 0.75 : 0.85, big ? 0.15 : 0.65, big ? 0.1 : 0.25, 1, big ? 0.07 : 0.05, 0.8, 14, 0.5, g.player.body.pos.y + 0.02);
  }

  fire(d, a) {
    const g = this.game, p = g.player, cam = g.camera, id = this.current;
    a.mag = Math.max(0, a.mag - 1);
    g.audio.play(d.sound, null, 0.9);
    this.kick(d);
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
      g.projectiles.spawnGrenade(origin.clone().addScaledVector(base, 0.6).add(new THREE.Vector3(0, -0.1, 0)), base.clone().multiplyScalar(d.speed).add(new THREE.Vector3(0, 3.2, 0)).add(p.body.vel.clone().multiplyScalar(0.4)), {
        dmg: d.dmg * p.stats.dmgMul * p.stats.explosiveDmgMul, radius: d.radius * p.stats.explosiveRadiusMul, cluster: p.stats.cluster,
      });
      return;
    }
    if (d.kind === 'arc') { this.fireArc(d, origin, base, muzzle); return; }
    const pellets = (d.pellets || 1) + (id === 'breacher' ? p.stats.shotgunPellets : 0);
    const moving = Math.min(1, p.speedNow / 8) * (p.body.grounded ? 1 : 1.5);
    const spread = (d.spread + (d.moveSpread || 0) * moving + this.bloom) * p.stats.spreadMul;
    if (d.bloom) this.bloom = Math.min(d.maxBloom, this.bloom + d.bloom);
    const dir = new THREE.Vector3();
    const dmgMul = p.stats.dmgMul * (id === 'ripsaw' ? p.stats.rifleDmg : 1) * (p.stats.momentumDmg && p.speedNow > 14 ? 1.25 : 1);
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      this.spreadDir(base, spread, dir);
      if (pellets === 1) this.magnet(dir);
      let skip = null;
      const pierceLeft = id === 'ripsaw' ? p.stats.riflePierce : 0;
      let o = origin;
      for (let k = 0; k < 1 + pierceLeft; k++) {
        const hit = this.trace(o, dir, d.range, skip);
        const end = hit ? hit.point : origin.clone().addScaledVector(dir, d.range);
        if (k === 0 && (pellets === 1 || i % 2 === 0)) g.fx.tracer(muzzle, end, d.tracer, pellets > 1 ? 0.05 : 0.07);
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
          g.combat.damageEnemy(e, dmg, { source: 'hitscan', part: hit.part, headMul: d.head, point: hit.point, dir: dir.clone(), knock: d.knock ? d.knock / pellets * 3 : 1.2, stagger: id === 'breacher' ? 0.12 : id === 'hammer' ? 0.25 : 0.05, dist: hit.t, dmg, quiet: pellets > 1 && i > 0 });
          if (p.stats.explosiveEvery) this.countExplosive(hit.point);
          if (!skip) skip = new Set();
          skip.add(e);
          o = hit.point.clone().addScaledVector(dir, 0.05);
        } else if (hit.kind === 'boss') {
          g.combat.damageBoss(hit.boss, dmg, { source: 'hitscan', part: hit.part, point: hit.point, dir: dir.clone(), quiet: pellets > 1 && i > 0 });
          if (p.stats.explosiveEvery) this.countExplosive(hit.point);
          break;
        }
      }
    }
    if (anyHit && pellets > 1) g.audio.play('hit', null, 0.5);
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
    g.audio.play('lance', null, 1);
    this.kick(d);
    g.emit('fire', 'lance');
    const cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.magnet(dir);
    const o = cam.position.clone();
    const res = g.combat.raycastPierce(o, dir, d.range);
    const dmg = (d.dmgMin + (d.dmgMax - d.dmgMin) * this.charge) * p.stats.dmgMul;
    let kills = 0;
    for (const h of res.hits) {
      const wasAlive = h.enemy.alive;
      g.combat.damageEnemy(h.enemy, dmg, { source: 'hitscan', part: h.part, headMul: d.head * (scoped ? 1.25 : 1), point: h.point, dir, knock: 6 * this.charge, stagger: 0.4, energy: true, pierce: true, dist: h.t });
      if (wasAlive && !h.enemy.alive) kills++;
    }
    if (res.bossHit && res.bossHit.t < res.end) g.combat.damageBoss(g.bosses.active, dmg, { source: 'beam', part: res.bossHit.part, point: res.bossHit.point, energy: true });
    for (const c of this.coins) if (c.alive && raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y, c.pos.z, 0.5, res.end) >= 0) this.ricoshot(c, dmg * 0.8);
    if (kills >= 2) g.style.add('SKEWERED x' + kills, 20 * kills);
    if (kills >= 2 && p.stats.lanceCharge > 1) a.mag = Math.min(this.magSize(), a.mag + 1);
    const end = o.clone().addScaledVector(dir, res.world ? res.world.t : d.range);
    const muzzle = this.muzzleWorld().clone();
    g.fx.beam(muzzle, end, 0x40e0ff, 0.12 + this.charge * 0.18, 0.35);
    g.fx.beam(muzzle, end, 0xffffff, 0.04 + this.charge * 0.05, 0.2);
    if (res.world) { g.fx.impact(end, new THREE.Vector3(res.world.nx, res.world.ny, res.world.nz), 'energy', 2); g.fx.sparksBurst(end, 0x40e0ff, 14, 6, 0.4); }
    if (this.charge > 0.95) g.style.add('FULL CHARGE', 5, true);
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
    const dmg = d.dmg * p.stats.dmgMul;
    const jumps = d.jumps + p.stats.arcJumps;
    if (!target) {
      const hit = g.combat.rayWorld(origin, base, d.range * 0.6);
      const end = origin.clone().addScaledVector(base, hit ? hit.t : d.range * 0.6);
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
      } else if (cur.hb) { g.combat.damageBoss(boss, dmg, { source: 'arc', part: cur.hb, point: cur.pt, energy: true, quiet: j > 0 }); break; }
      from = cur.pt;
      let next = null, nd = d.jumpRange;
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

  lightning(a, b) {
    const fx = this.game.fx;
    let prev = a.clone();
    for (let i = 1; i <= 5; i++) {
      const p = a.clone().lerp(b, i / 5);
      if (i < 5) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      fx.tracer(prev, p, 0xb0a0ff, 0.09);
      prev = p;
    }
    fx.sparksBurst(b, 0xb0a0ff, 4, 3, 0.2, 0.07);
  }

  // ---------------------------------------------------------------- animation
  animate(dt, input) {
    const g = this.game, p = g.player;
    const m = this.models[this.current];
    const an = m.userData.anim;
    this.recoilP += this.recoilV; this.recoilV = 0;
    this.recoilP = damp(this.recoilP, 0, 14, dt);
    this.swayX = damp(this.swayX, clamp(-input.lookDX * 4, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.lookDY * 4, -0.06, 0.06), 10, dt);
    const t = g.time;
    const bob = p.bobAmp;
    const bx = Math.cos(p.bob) * 0.012 * bob;
    const by = -Math.abs(Math.sin(p.bob)) * 0.016 * bob;
    const idle = Math.sin(t * 1.6) * 0.004;
    let sw = 0;
    if (this.switchTo) sw = this.switchT > 0.16 ? 1 - (this.switchT - 0.16) / 0.16 : this.switchT / 0.16;
    let rl = 0, rk = 0;
    if (this.reloading) {
      rk = 1 - this.reloadT / this.reloadTotal;
      rl = DEFS[this.current].reloadShell ? 0.35 + Math.sin(rk * Math.PI) * 0.25 : Math.sin(rk * Math.PI);
    }
    this.adsK = damp(this.adsK || 0, input.ads ? 1 : 0, 12, dt);
    const sprintK = p.sprint && p.body.grounded && p.speedNow > 6 && !input.fire ? 1 : 0;
    this.sprintK = damp(this.sprintK || 0, sprintK, 8, dt);
    this.slideK = damp(this.slideK || 0, p.sliding ? 1 : 0, 10, dt);
    const h = this.holder;
    h.position.set(
      0.21 - this.adsK * 0.21 + bx + this.swayX - this.sprintK * 0.04 + this.slideK * 0.03,
      -0.2 + this.adsK * 0.09 + by + idle - sw * 0.35 - rl * 0.08 + this.swayY + p.landDip * 0.5 - this.sprintK * 0.03 - this.slideK * 0.04,
      -0.4 + this.recoilP * 1.6 + this.adsK * 0.06,
    );
    h.rotation.set(this.recoilP * 2.2 + rl * 0.5 + sw * 0.6 - this.sprintK * 0.25, 0.09 * (1 - this.adsK) + this.swayX * 1.5 + this.sprintK * 0.5, 0.06 * (1 - this.adsK) + rl * 0.6 + this.sprintK * 0.15 + p.roll * 2 + this.slideK * 0.25);
    if (an.cyl) {
      if (this.reloading) { an.cyl.rotation.z += dt * 18; an.cyl.position.x = Math.sin(rk * Math.PI) * 0.05; this.cylAngle = an.cyl.rotation.z; this.cylTarget = this.cylAngle; }
      else { this.cylAngle += (this.cylTarget - this.cylAngle) * Math.min(1, dt * 25); an.cyl.rotation.z = this.cylAngle; an.cyl.position.x = 0; }
      an.hammerSpur.rotation.x = this.flashT > 0 ? 0 : -0.5;
    }
    if (an.pump) {
      const k = this.pumpT > 0 ? Math.sin((1 - this.pumpT / 0.45) * Math.PI) : 0;
      an.pump.position.z = -0.42 + k * 0.09;
      if (an.leftHand) an.leftHand.position.z = -0.42 + k * 0.09;
    }
    if (an.bolt) an.bolt.position.z = -0.05 + (this.boltT > 0 ? 0.04 : 0) + (this.reloading && rk > 0.7 && rk < 0.9 ? 0.05 : 0);
    if (an.mag) an.mag.position.y = -0.015 - (this.reloading ? Math.sin(Math.min(1, rk * 1.5) * Math.PI) * 0.18 : 0);
    if (an.drum) an.drum.rotation.z += (this.drumAngle - an.drum.rotation.z) * Math.min(1, dt * 14);
    if (an.coils) {
      if (this.current === 'arc') an.coils.rotation.y += dt * (input.fire ? 30 : 3);
      an.coils.scale.setScalar(this.current === 'lance' && this.charging ? 1 + this.charge * 0.15 + Math.random() * 0.03 : 1);
    }
    if (this.current === 'lance' && this.charging) { h.position.x += (Math.random() - 0.5) * this.charge * 0.006; h.position.y += (Math.random() - 0.5) * this.charge * 0.006; }
    this.mats.glow.color.setScalar(this.current === 'lance' && this.charging ? 0.6 + this.charge * 1.4 : 1);
    m.userData.flash.visible = this.flashT > 0;
    this.muzzleLight.intensity = this.flashT > 0 ? 3 : 0;
    if (this.punchAnim > 0) {
      const ext = Math.sin((1 - this.punchAnim / 0.28) * Math.PI);
      this.fist.visible = true;
      this.fist.position.set(-0.18 + ext * 0.08, -0.2 + ext * 0.08, -0.25 - ext * 0.35);
    } else this.fist.visible = false;
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  setTheme(theme) { this.hemi.color.setHex(theme.sky); this.hemi.groundColor.setHex(theme.ground); }

  setSkin(skin) {
    const col = { default: 0xdfe3ea, gilded: 0xffd070, bloodline: 0xd04040, void: 0x7a6ab0, verdigris: 0x6ad0a0, obsidian: 0x404048 }[skin || 'default'] || 0xdfe3ea;
    this.mats.chrome.color.setHex(col);
  }
}
