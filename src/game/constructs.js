import * as THREE from 'three';
import { Enemy } from './enemies.js';
import { buildChassis } from './chassis.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { moveBody, clamp } from '../core/collide.js';

// Shootable, short-lived pieces that attack modules deploy: shield drones that orbit their
// owner, flickering decoys, chain pylons and egg sacs. They live in the enemy list so every
// weapon can hit them, die with their owner, and expire on their own so a fight can never
// stall on one. Expiring is silent (no kill credit, no director side effects).

const geos = {};
const G = (k, f) => geos[k] || (geos[k] = f());
const mats = new Map();
function lit(color, tex = 'panel', em = 0.25) {
  const k = 'l' + color + tex + em;
  if (!mats.has(k)) mats.set(k, psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color, emissive: new THREE.Color(color).multiplyScalar(em) })));
  return mats.get(k);
}
function glow(color) { const k = 'g' + color; if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial({ color })); return mats.get(k); }
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData.mat = mat; return m; }
const BOX = (w, h, d) => G(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const OCT = (r) => G('o' + r, () => new THREE.OctahedronGeometry(r, 0));

const BUILD = {
  drone(e, o) {
    e.flying = true;
    e.radius = 0.6; e.bodyY0 = -0.45; e.bodyY1 = 0.45; e.headY = 0; e.headR = 0.42;
    const dark = lit(0x4a4e58, 'gun', 0.15);
    const core = mesh(OCT(0.42), glow(e.color));
    const shell = mesh(BOX(0.95, 0.16, 0.95), dark);
    const fins = [mesh(BOX(0.12, 0.45, 0.7), dark, 0, -0.28, 0), mesh(BOX(0.7, 0.45, 0.12), dark, 0, -0.28, 0)];
    const eye = mesh(BOX(0.3, 0.12, 0.06), glow(0xffffff), 0, 0, 0.5);
    e.group.add(core, shell, ...fins, eye);
    e.parts = { core, shell };
    e.orbitR = o.orbitR || 3; e.ang = o.ang || 0; e.spin = o.spin || 1.1; e.bob = Math.random() * 6;
    e.fireT = 1.6 + Math.random() * 2;
  },
  pylon(e) {
    e.radius = 0.65; e.bodyY0 = 0; e.bodyY1 = 2.9; e.headY = 3.45; e.headR = 0.6;
    const dark = lit(0x3a3e48, 'gun', 0.15), body = lit(0x6a6e78, 'panel', 0.2);
    const crystal = mesh(OCT(0.55), glow(e.color), 0, 3.45, 0);
    e.group.add(mesh(BOX(1.3, 0.5, 1.3), dark, 0, 0.25, 0), mesh(BOX(0.8, 2.4, 0.8), body, 0, 1.6, 0), mesh(BOX(1.1, 0.3, 1.1), dark, 0, 2.85, 0), crystal,
      mesh(BOX(0.9, 0.1, 0.1), glow(e.color), 0, 1.4, 0.41), mesh(BOX(0.9, 0.1, 0.1), glow(e.color), 0, 2.0, -0.41));
    e.parts = { crystal };
  },
  egg(e) {
    e.radius = 0.75; e.bodyY0 = 0; e.bodyY1 = 1.7; e.headY = 0.95; e.headR = 0.6;
    const sac = mesh(G('egg', () => new THREE.IcosahedronGeometry(0.75, 0)), lit(0x7a6a50, 'skin', 0.3), 0, 0.95, 0);
    sac.scale.set(1, 1.35, 1);
    const core = mesh(OCT(0.4), glow(e.color), 0, 0.95, 0);
    e.group.add(sac, core);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      const v = mesh(BOX(0.08, 1.2, 0.08), glow(e.color), Math.cos(a) * 0.62, 0.95, Math.sin(a) * 0.62);
      v.rotation.z = Math.cos(a) * 0.3; v.rotation.x = -Math.sin(a) * 0.3;
      e.group.add(v, mesh(BOX(0.25, 0.25, 0.9), lit(0x3a2a20, 'gun', 0.1), Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7));
    }
    e.parts = { sac, core };
  },
  decoy(e, o) {
    const ow = e.owner;
    const def = ow.def || {};
    const ch = buildChassis(o.chassis || def.chassis || 'hover', o.colors || def.colors || [0x808080, 0x202020, e.color], o.scale || ow.chassisScale || 1.6);
    e.ch = ch;
    e.group.add(ch.group);
    e.flying = !!ch.flying;
    const s = ch.scale;
    const weak = ch.hit.find((h) => h.weak) || ch.hit[0];
    if (e.flying) { e.radius = ch.radius * s; e.bodyY0 = -e.radius; e.bodyY1 = e.radius; }
    else { e.radius = ch.radius * s * 0.9; e.bodyY0 = 0; e.bodyY1 = ch.height * s * 0.85; }
    e.headY = weak.y * s; e.headR = weak.r * s;
    e.height = ch.height * s;
    e.hoverH = ow.hoverH || (ch.hover || 3) + s * 0.4;
    e.fireT = 0.9 + Math.random() * 1.2;
    e.strafe = Math.random() < 0.5 ? 1 : -1;
  },
};

export class Construct extends Enemy {
  constructor(game, kind, pos, owner, opts = {}) {
    super(game, 'construct', pos, { dmgMul: owner.dmgMul || 1 });
    this.kind = kind;
    this.owner = owner;
    this.construct = true;
    this.heavy = true;
    this.staggerable = false;
    this.color = opts.color != null ? opts.color : owner.color || 0xff3050;
    this.life = opts.life || 10;
    this.age = 0;
    this.opts = opts;
    this.name = (owner.name || 'BOSS') + ' ' + kind.toUpperCase();
    this.styleValue = 12;
    this.bloodColor = [0.55, 0.55, 0.6];
    this.spawnT = opts.spawnT != null ? opts.spawnT : 0.6;
    BUILD[kind](this, opts);
    this.finishSetup((opts.hp || 60) * (owner.hpMul || 1));
    this.shadow.scale.setScalar(this.radius * 1.2);
    if (this.flying) this.groundLevel = this.floorY();
  }

  floorY() { const r = this.game.level.current; return r ? r.floorAt(this.pos.x, this.pos.z) : 0; }

  // removed without kill credit (timed out, hatched, or its owner died)
  expire(quiet = false) {
    if (!this.alive) return;
    this.alive = false;
    this.targetable = false;
    if (!quiet) {
      const c = this.centerPos();
      this.game.fx.sparksBurst(c, this.color, 10, 5, 0.4);
      this.game.fx.spawnColumn(this.pos.x, this.flying ? this.groundLevel || 0 : this.pos.y, this.pos.z, this.color, 0.4, 2);
    }
    this.remove();
  }

  think(dt) {
    const g = this.game;
    this.age += dt;
    const o = this.owner;
    if (!o || !o.alive || this.age > this.life) { this.expire(); return; }
    const pp = g.player.body.pos;
    if (this.kind === 'drone') {
      this.ang += dt * this.spin;
      const c = o.center();
      const R = this.orbitR;
      this.pos.set(c.x + Math.cos(this.ang) * R, c.y + 0.4 + Math.sin(this.age * 2.2 + this.bob) * 0.45, c.z + Math.sin(this.ang) * R);
      const room = g.level.current;
      if (room) { this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 0.8, room.origin.x + room.W / 2 - 0.8); this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 0.8, room.origin.z + room.D / 2 - 0.8); }
      this.groundLevel = this.floorY();
      o.guardT = 0.25; // owner takes reduced damage while any drone lives
      g.bosses.field.beam(this.pos.x, this.pos.y, this.pos.z, c.x, c.y, c.z, 0.07, this.color, 0.45 + 0.25 * Math.sin(this.age * 20));
      this.faceToward(pp.x, pp.z, dt, 6);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = (this.opts.fire || 3.2) + Math.random() * 1.2;
        const to = g.camera.position.clone(); to.y -= 0.4;
        const dir = to.sub(this.pos).normalize().multiplyScalar(14);
        g.projectiles.spawnEnemy(this.pos.clone(), dir, (this.opts.dmg || 9) * this.dmgMul, { color: this.color, radius: 0.2, size: 0.2, owner: this, cause: this.name, tip: 'Shield drones protect their owner. Shoot the drones down first.' });
        g.audio.play('enemyShot', this.pos, 0.4);
      }
    } else if (this.kind === 'egg') {
      const left = this.life - this.age;
      if (left <= 0.05) {
        const types = this.opts.types || ['ripper'];
        const room = g.level.current;
        if (room && room.state === 'combat') g.director.spawnSummons(types, 1, this.pos);
        g.fx.explosion(this.centerPos().clone(), 1.6, 0x9aa040);
        g.audio.play('gib', this.pos, 0.8);
        this.expire(true);
      }
    } else if (this.kind === 'decoy') {
      this.faceToward(pp.x, pp.z, dt, 6);
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      const sp = 3;
      const k = d < 7 ? -1 : d > 16 ? 1 : 0;
      if (!this.flying) this.applySteer(dt, dx / d * sp * k - dz / d * sp * 0.6 * this.strafe, dz / d * sp * k + dx / d * sp * 0.6 * this.strafe);
      else { this.body.vel.x = dx / d * sp * k - dz / d * sp * 0.6 * this.strafe; this.body.vel.z = dz / d * sp * k + dx / d * sp * 0.6 * this.strafe; }
      this.fireT -= dt;
      this.firing = this.fireT < 0.45;
      if (this.fireT <= 0) {
        this.fireT = (this.opts.fire || 2.4) + Math.random();
        const from = this.centerPos().clone();
        const to = g.camera.position.clone(); to.y -= 0.4;
        const base = Math.atan2(to.x - from.x, to.z - from.z);
        const dy = (to.y - from.y) / Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
        for (let i = -1; i <= 1; i++) {
          const a = base + i * 0.2;
          g.projectiles.spawnEnemy(from.clone(), new THREE.Vector3(Math.sin(a), dy, Math.cos(a)).normalize().multiplyScalar(15), (this.opts.dmg || 7) * this.dmgMul, { color: this.color, radius: 0.22, size: 0.22, owner: this, cause: this.name, tip: 'Decoys flicker. The real one does not.' });
        }
        g.audio.play('enemyShot', this.pos, 0.5);
      }
    }
  }

  physics(dt) {
    if (this.kind === 'decoy') {
      if (!this.flying) { super.physics(dt); return; }
      const room = this.game.level.current;
      const floor = this.floorY();
      this.groundLevel = floor;
      const ty = floor + this.hoverH + Math.sin(this.game.time * 1.7 + this.strafe) * 0.3;
      this.body.vel.y += ((ty - this.pos.y) * 2 - this.body.vel.y) * Math.min(1, dt * 4);
      moveBody(this.body, this.body.vel.x * dt, this.body.vel.y * dt, this.body.vel.z * dt, this.game.level.colliders);
      if (room) {
        this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 1.5, room.origin.x + room.W / 2 - 1.5);
        this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 1.5, room.origin.z + room.D / 2 - 1.5);
        this.pos.y = Math.min(this.pos.y, room.spec.H - this.radius - 0.3);
      }
    }
    // drones, pylons and eggs are placed directly
  }

  animate() {
    const t = this.game.time;
    const P = this.parts;
    if (this.kind === 'drone') { P.core.rotation.y = t * 4; P.shell.rotation.y = -t * 2; }
    else if (this.kind === 'pylon') { P.crystal.rotation.y = t * 2.5; P.crystal.position.y = 3.45 + Math.sin(t * 3 + this.pos.x) * 0.12; }
    else if (this.kind === 'egg') {
      const k = Math.min(1, this.age / this.life);
      const rate = 3 + k * 16;
      P.sac.scale.set(1 + Math.sin(t * rate) * 0.05 * (1 + k * 2), 1.35 + Math.sin(t * rate + 1) * 0.07 * (1 + k * 2), 1 + Math.sin(t * rate) * 0.05 * (1 + k * 2));
      P.core.scale.setScalar(0.8 + k * 0.8 + Math.sin(t * rate) * 0.15);
    } else if (this.kind === 'decoy' && this.ch) {
      this.ch.animate(t, { wind: this.firing, act: false, moving: Math.hypot(this.body.vel.x, this.body.vel.z) > 0.5, hp: 1 });
      // decoys glitch: they drop frames and jitter, the real actor never does
      if (this.spawnT <= 0) {
        const glitch = Math.random() < 0.12;
        this.group.visible = !glitch || Math.random() < 0.4;
        if (glitch) { this.group.position.x += (Math.random() - 0.5) * 0.35; this.group.position.y += (Math.random() - 0.5) * 0.2; }
      }
    }
  }

  die(info) {
    const g = this.game;
    this.alive = false;
    this.targetable = false;
    for (const m of this.meshes) m.material = m.userData.mat;
    const c = this.centerPos().clone();
    g.fx.explosion(c, this.kind === 'decoy' ? 2.4 : 1.5, this.color);
    g.fx.chunks(c, this.kind === 'egg' ? 0x7a6a50 : 0x5a5e68, this.kind === 'decoy' ? 4 : 7, 6, 0.14);
    g.audio.play(this.kind === 'decoy' ? 'glitch' : 'explosion', c, 0.6);
    const label = { drone: 'DRONE DOWN', pylon: 'PYLON DOWN', egg: 'EGG CRACKED', decoy: 'DECOY POPPED' }[this.kind];
    if (label && info.fromPlayer !== false) g.style.add(label, 15);
    g.scene.remove(this.group);
    this.cleanupExtras();
  }
}

// Remove every construct an actor owns (on death or when a fight is reset).
export function expireOwned(game, owner, quiet = false) {
  for (const e of game.enemies.list) if (e.alive && e.construct && e.owner === owner) e.expire(quiet);
}

export function countOwned(game, owner, kind) {
  let n = 0;
  for (const e of game.enemies.list) if (e.alive && e.construct && e.owner === owner && (!kind || e.kind === kind)) n++;
  return n;
}
