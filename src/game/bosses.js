import * as THREE from 'three';
import { moveBody, clamp, angleDiff, segPointDist2 } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { sharedMaterials } from '../render/materials.js';
import { makeBox } from '../core/collide.js';

export const BOSS_INFO = {
  grindhammer: { name: 'GRINDHAMMER', title: 'FURNACE BULL OF THE LOWER WORKS', color: '#ff8a1a' },
  vesper: { name: 'VESPER', title: 'THE HUNTER IN THE RAFTERS', color: '#40c8ff' },
  crucible: { name: 'THE CRUCIBLE', title: 'HEART OF THE MACHINE', color: '#6aff5a' },
  scythewright: { name: 'SCYTHEWRIGHT', title: 'THE MANTIS OF THE BREACH', color: '#ff3df0' },
};
export const BOSS_ORDER = ['grindhammer', 'vesper', 'crucible', 'scythewright'];

const mats = {};
function M(color, tex = 'skin') {
  const k = color + tex;
  if (!mats[k]) mats[k] = psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color, emissive: new THREE.Color(color).multiplyScalar(0.2) }));
  return mats[k];
}
function G(color) {
  const k = 'g' + color;
  if (!mats[k]) mats[k] = new THREE.MeshBasicMaterial({ color });
  return mats[k];
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.userData.mat = mat;
  return m;
}

// ---------------------------------------------------------------------------------------
export class Boss {
  constructor(game, room, type, tier, info) {
    this.game = game;
    this.room = room;
    this.type = type;
    this.tier = tier;
    this.info = info || BOSS_INFO[type];
    this.name = this.info.name + (tier > 0 ? ' ' + ['', 'MK-II', 'MK-III', 'MK-IV', 'MK-V'][Math.min(4, tier)] : '');
    if (tier > 4) this.name = this.info.name + ' MK-' + (tier + 1);
    this.title = this.info.title;
    this.hpMul = 1 + 0.5 * tier;
    this.speedMul = 1 + 0.08 * Math.min(tier, 5);
    this.cdMul = Math.max(0.6, 1 - 0.08 * tier);
    this.dmgMul = 1 + 0.12 * Math.min(tier, 6);
    this.alive = true;
    this.phase = 1;
    this.intro = 2.4;
    this.state = 'intro'; this.stateT = 0;
    this.flashT = 0;
    this.invuln = 0;
    this.group = new THREE.Group();
    this.meshes = [];
    this.pos = new THREE.Vector3(room.wx(0), 0, room.wz(-room.D / 2 + 9));
    this.yaw = 0;
    this.hbs = [];
    this.attackCount = 0;
    this.escortT = 14;
    this.tmp = new THREE.Vector3();
  }
  setHp(base) { this.maxHp = base * this.hpMul; this.hp = this.maxHp; }
  finish() {
    this.group.traverse((o) => { if (o.isMesh) { if (!o.userData.mat) o.userData.mat = o.material; this.meshes.push(o); } });
    this.game.scene.add(this.group);
    this.sync();
  }
  hitboxes() { return this.hbs; }
  get vulnerable() { return this.state !== 'intro' && this.invuln <= 0 && this.alive; }

  applyDamage(amount, info, part) {
    if (!this.vulnerable) return 0;
    if (part.pylon) return this.damagePart(part, amount);
    this.hp -= amount;
    this.flashT = 0.06;
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) this.enterPhase2();
    else if (this.phase === 2 && this.maxPhase >= 3 && this.hp < this.maxHp * 0.22) this.enterPhase3 && this.enterPhase3();
    if (this.hp <= 0) { this.hp = 0; this.defeat(); }
    return amount;
  }
  damagePart() { return 0; }

  enterPhase2() {
    const g = this.game;
    this.phase = 2;
    this.invuln = 1.4;
    this.state = 'phase'; this.stateT = 1.4;
    g.audio.play('bossPhase', this.pos, 1);
    g.flash(0xffffff, 0.35);
    g.addShake(0.6);
    g.hitstop(0.15);
    g.hud.banner('PHASE II', this.info.name + ' IS ENRAGED', this.info.color);
    g.fx.sparksBurst(this.center(), 0xffffff, 40, 14, 0.8, 0.15);
  }

  center() { return this.tmp.set(this.pos.x, this.pos.y + 2, this.pos.z); }

  defeat() {
    if (!this.alive) return;
    const g = this.game;
    this.alive = false;
    if (this.onDefeatExtra) this.onDefeatExtra();
    g.bosses.onDefeated(this);
    const c = this.center().clone();
    let i = 0;
    const boom = () => {
      if (i >= 6) {
        g.fx.explosion(c, 8, 0xffffff);
        g.fx.chunks(c, 0x666666, 30, 14, 0.4);
        g.audio.play('explosion', c, 1);
        g.addShake(0.8);
        this.remove();
        return;
      }
      const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4));
      g.fx.explosion(p, 2.5 + Math.random() * 2, 0xff8a30);
      g.audio.play('explosion', p, 0.7);
      i++;
      g.enemies.delayed(0.22, boom);
    };
    boom();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.game.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    if (this.extraRemove) this.extraRemove();
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const flash = this.flashT > 0;
    if (flash !== this.flashing) {
      this.flashing = flash;
      for (const m of this.meshes) m.material = flash ? sharedMaterials().flash : m.userData.mat;
    }
  }

  playerVec() {
    const p = this.game.player.body.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    return { dx, dz, d: Math.hypot(dx, dz), p };
  }

  face(x, z, dt, rate) {
    const t = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw += angleDiff(this.yaw, t) * Math.min(1, rate * dt);
  }

  clampArena(margin = 2) {
    const r = this.room;
    this.pos.x = clamp(this.pos.x, r.origin.x - r.W / 2 + margin, r.origin.x + r.W / 2 - margin);
    this.pos.z = clamp(this.pos.z, r.origin.z - r.D / 2 + margin, r.origin.z + r.D / 2 - margin);
  }

  // keep the player out of the boss body
  pushPlayer(radius) {
    const pp = this.game.player.body.pos;
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < radius && pp.y < this.pos.y + 3) {
      const k = (radius - d) / (d || 1);
      pp.x += dx * k; pp.z += dz * k;
    }
  }

  update(dt) {
    const g = this.game;
    this.flashT -= dt;
    this.invuln -= dt;
    this.stateT -= dt;
    if (this.state === 'intro') {
      this.intro -= dt;
      const { p } = this.playerVec();
      this.face(p.x, p.z, dt, 3);
      if (this.intro <= 0) { this.state = 'idle'; this.stateT = 0.6; }
    } else if (this.state === 'phase') {
      if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 0.3; }
    } else this.think(dt);
    // escorts on higher tiers
    if (this.tier >= 1 && this.state !== 'intro') {
      this.escortT -= dt;
      if (this.escortT <= 0 && g.enemies.aliveCount < 4) {
        this.escortT = 16 - Math.min(6, this.tier * 1.5);
        g.director.spawnEscort(this.tier);
      }
    }
    this.sync();
    this.animate(dt);
  }
}

// ---------------------------------------------------------------------------------------
// 1. GRINDHAMMER — charges, slams, breaks pillars, exposes its furnace vent when stunned
// ---------------------------------------------------------------------------------------
class Grindhammer extends Boss {
  constructor(game, room, tier) {
    super(game, room, 'grindhammer', tier);
    this.setHp(2600);
    const body = M(0x8a6040, 'panel'), dark = M(0x2a2420, 'gun'), glow = G(0xff7a10);
    this.chassis = new THREE.Group();
    this.chassis.add(box(3.2, 1.8, 4.4, body, 0, 2.2, 0));
    this.chassis.add(box(3.4, 0.4, 4.6, dark, 0, 3.2, 0));
    this.chassis.add(box(2.2, 1.2, 1.0, dark, 0, 2.0, 2.5));       // head / ram
    this.mouth = box(1.6, 0.5, 0.1, glow, 0, 2.0, 3.02);
    this.chassis.add(this.mouth);
    this.chassis.add(box(0.5, 1.6, 0.5, dark, -1.2, 3.8, 1.2));     // horns / stacks
    this.chassis.add(box(0.5, 1.6, 0.5, dark, 1.2, 3.8, 1.2));
    this.vent = box(1.8, 1.0, 0.1, G(0xff3010), 0, 2.4, -2.26);
    this.chassis.add(this.vent);
    this.chassis.add(box(3.25, 0.25, 0.2, sharedMaterials().door, 0, 1.5, 2.25));
    this.legs = [];
    for (const [x, z] of [[-1.5, 1.5], [1.5, 1.5], [-1.5, -1.5], [1.5, -1.5]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 1.4, z);
      leg.add(box(0.7, 1.4, 0.7, dark, 0, -0.7, 0));
      this.legs.push(leg);
      this.chassis.add(leg);
    }
    this.group.add(this.chassis);
    this.body = { pos: this.pos, vel: new THREE.Vector3(), r: 1.7, h: 3.5, grounded: true, step: 0.3 };
    this.finish();
  }
  hitboxes() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const p = this.pos;
    const stunned = this.state === 'stunned';
    this.hbs = [
      { x: p.x + s * 0.8, y: p.y + 2.2, z: p.z + c * 0.8, r: 1.8, mul: 0.8 },
      { x: p.x - s * 1.2, y: p.y + 2.2, z: p.z - c * 1.2, r: 1.6, mul: 1 },
      { x: p.x + s * 2.6, y: p.y + 2.0, z: p.z + c * 2.6, r: 0.9, mul: 1.2 },
      { x: p.x - s * 2.3, y: p.y + 2.4, z: p.z - c * 2.3, r: 0.85, mul: stunned ? 3 : 2, weak: true },
    ];
    return this.hbs;
  }
  think(dt) {
    const g = this.game;
    const { dx, dz, d, p } = this.playerVec();
    const sp = this.speedMul;
    this.body.vel.set(0, 0, 0);
    switch (this.state) {
      case 'idle':
        this.face(p.x, p.z, dt, 3);
        this.walk(dt, dx, dz, d, 3.2 * sp);
        if (this.stateT <= 0) {
          this.attackCount++;
          if (this.phase === 2 && this.attackCount % 3 === 0) { this.state = 'spewWind'; this.stateT = 0.6 * this.cdMul; this.volleys = 3; }
          else if (d > 7.5 || Math.random() < 0.35) { this.state = 'chargeWind'; this.stateT = 0.95 * this.cdMul; this.charges = this.phase === 2 ? 2 : 1; g.audio.play('bossCharge', this.pos, 1); }
          else { this.state = 'slamWind'; this.stateT = 0.85 * this.cdMul; g.audio.play('windup', this.pos, 1); }
        }
        break;
      case 'chargeWind': {
        if (this.stateT > 0.25) this.face(p.x, p.z, dt, 6);
        this.chassis.rotation.x = -0.08;
        const len = 40;
        const a = this.pos.clone().setY(0.06);
        const b = a.clone().add(new THREE.Vector3(Math.sin(this.yaw) * len, 0, Math.cos(this.yaw) * len));
        g.fx.beam(a, b, 0xff3020, 2.6, 0.03, false);
        if (this.stateT <= 0) { this.state = 'charging'; this.stateT = 2.2; this.hitPlayer = false; this.chassis.rotation.x = 0; g.audio.play('lunge', this.pos, 1); }
        break;
      }
      case 'charging': {
        const v = 26 * sp;
        const vx = Math.sin(this.yaw) * v, vz = Math.cos(this.yaw) * v;
        const before = this.pos.clone();
        const hit = moveBody(this.body, vx * dt, 0, vz * dt, g.level.colliders);
        g.fx.dust.spawn(this.pos.x, 0.2, this.pos.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.3, 0.25, 0.2, 0.6, 0.5, 0.6, 1, 2);
        if (!this.hitPlayer && d < 2.8 && p.y < this.pos.y + 3.2) {
          this.hitPlayer = true;
          if (g.player.damage(30 * this.dmgMul, this.pos, 'GRINDHAMMER CHARGE', 'Grindhammer paints a red lane before charging. Dash out of the lane, and bait it into pillars or walls to stun it.')) {
            g.player.knock(Math.sin(this.yaw) * 14 + dx / (d || 1) * 6, 7, Math.cos(this.yaw) * 14 + dz / (d || 1) * 6);
          }
        }
        if (hit & 1 || before.distanceTo(this.pos) < v * dt * 0.3 || this.stateT <= 0) {
          // check for breakable pillar in front
          let broke = false;
          for (const br of this.room.breakables) {
            if (br.broken) continue;
            const bx = this.room.wx(br.x), bz = this.room.wz(br.z);
            if (Math.hypot(bx - this.pos.x, bz - this.pos.z) < 4.2) { this.room.breakPillar(br); broke = true; }
          }
          if (this.stateT > 0) {
            g.addShake(0.6);
            g.audio.play('slam', this.pos, 1);
            g.fx.chunks(this.pos.clone().setY(2), 0x777777, 10, 8, 0.25);
            this.charges--;
            if (this.charges > 0 && !broke) { this.state = 'chargeWind'; this.stateT = 0.6 * this.cdMul; }
            else { this.state = 'stunned'; this.stateT = broke ? 3.4 : 2.0; g.hud.toast(broke ? 'PILLAR SMASHED - VENT EXPOSED' : 'STUNNED - HIT THE VENT', '#ffb040'); }
          } else { this.state = 'idle'; this.stateT = 0.8; }
        }
        break;
      }
      case 'stunned':
        this.chassis.rotation.z = Math.sin(g.time * 30) * 0.03;
        this.vent.scale.setScalar(1 + Math.sin(g.time * 12) * 0.15);
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 1.0; this.chassis.rotation.z = 0; this.vent.scale.setScalar(1); }
        break;
      case 'slamWind':
        this.face(p.x, p.z, dt, 2);
        this.chassis.rotation.x = -0.35 * (1 - Math.max(0, this.stateT) / 0.85);
        this.chassis.position.y = 0.8 * (1 - Math.max(0, this.stateT) / 0.85);
        if (this.stateT <= 0) {
          this.chassis.rotation.x = 0; this.chassis.position.y = 0;
          g.enemies.shockwave(this.pos.clone(), 18, 11 * sp, 22 * this.dmgMul, 0xff7a10, 'GRINDHAMMER SHOCKWAVE', 'Jump over the expanding shockwave rings.');
          if (this.phase === 2) g.enemies.delayed(0.55, () => g.enemies.shockwave(this.pos.clone(), 18, 11 * sp, 22 * this.dmgMul, 0xff7a10, 'GRINDHAMMER SHOCKWAVE', 'Phase two slams send two rings. Jump twice.'));
          g.audio.play('slam', this.pos, 1);
          g.addShake(0.5);
          this.state = 'recover'; this.stateT = 1.1;
        }
        break;
      case 'spewWind':
        this.face(p.x, p.z, dt, 4);
        this.mouth.scale.set(1, 1 + Math.random(), 1);
        if (this.stateT <= 0) {
          const from = this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 3.2, 2, Math.cos(this.yaw) * 3.2));
          const base = Math.atan2(dx, dz);
          for (let i = -3; i <= 3; i++) {
            const a = base + i * 0.13 + (this.volleys % 2) * 0.065;
            const dy = (g.camera.position.y - 0.4 - from.y) / Math.max(1, d);
            g.projectiles.spawnEnemy(from.clone(), new THREE.Vector3(Math.sin(a), dy, Math.cos(a)).normalize().multiplyScalar(17), 11 * this.dmgMul, { color: 0xff6010, radius: 0.28, size: 0.3, cause: 'FURNACE SPEW', tip: 'Strafe between the gaps in the fire fan.' });
          }
          g.audio.play('enemyShot', this.pos, 1);
          this.volleys--;
          this.stateT = 0.45;
          if (this.volleys <= 0) { this.state = 'recover'; this.stateT = 0.9; this.mouth.scale.set(1, 1, 1); }
        }
        break;
      case 'recover':
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = (1.4 + Math.random()) * this.cdMul; }
        break;
    }
    this.pushPlayer(2.2);
    this.clampArena(2.2);
  }
  walk(dt, dx, dz, d, speed) {
    if (d < 5) return;
    moveBody(this.body, Math.sin(this.yaw) * speed * dt, 0, Math.cos(this.yaw) * speed * dt, this.game.level.colliders);
    this.stride = (this.stride || 0) + dt * speed * 1.2;
  }
  animate() {
    const s = this.stride || 0;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(s + (i % 2) * Math.PI) * (this.state === 'charging' ? 0.8 : 0.35); });
    if (this.state === 'charging') this.stride = (this.stride || 0) + 0.6;
  }
}

// ---------------------------------------------------------------------------------------
// 2. VESPER — hovering hunter: projectile fans, homing seekers (parry them), barriers,
//    phase 2 blinks and a sweeping laser you slide under or jump over.
// ---------------------------------------------------------------------------------------
class Vesper extends Boss {
  constructor(game, room, tier) {
    super(game, room, 'vesper', tier);
    this.setHp(2100);
    const body = M(0x404a6a, 'panel'), dark = M(0x1a1c28, 'gun'), glow = G(0x40c8ff);
    this.rig = new THREE.Group();
    this.rig.add(box(0.9, 1.3, 0.6, body, 0, 0.4, 0));
    this.rig.add(box(0.6, 0.6, 0.5, dark, 0, -0.5, 0));
    this.head = box(0.5, 0.55, 0.5, body, 0, 1.4, 0);
    this.rig.add(this.head);
    this.rig.add(box(0.42, 0.1, 0.05, glow, 0, 1.45, 0.27));
    this.wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.5, 0.8, -0.3);
      w.add(box(1.8, 0.08, 0.7, dark, s * 0.9, 0, 0));
      w.add(box(1.6, 0.04, 0.1, glow, s * 0.9, 0, 0.36));
      this.wings.push(w);
      this.rig.add(w);
    }
    this.armL = box(0.2, 0.9, 0.2, dark, -0.6, 0.2, 0.2);
    this.armR = box(0.2, 0.9, 0.2, dark, 0.6, 0.2, 0.2);
    this.rig.add(this.armL, this.armR);
    this.rig.scale.setScalar(1.4);
    this.group.add(this.rig);
    this.pos.y = 3;
    this.hoverY = 3;
    this.strafe = 1; this.strafeT = 2;
    this.finish();
  }
  hitboxes() {
    const p = this.pos;
    this.hbs = [
      { x: p.x, y: p.y + 0.56, z: p.z, r: 1.15, mul: 1 },
      { x: p.x, y: p.y + 1.96, z: p.z, r: 0.55, mul: 2.2, weak: true },
      { x: p.x, y: p.y - 0.56, z: p.z, r: 0.7, mul: 0.9 },
    ];
    return this.hbs;
  }
  think(dt) {
    const g = this.game;
    const { dx, dz, d, p } = this.playerVec();
    this.face(p.x, p.z, dt, 5);
    const sp = this.speedMul;
    // movement: orbit-strafe at 12-18 m, hovering
    if (this.state !== 'sweep' && this.state !== 'sweepWind') {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.5 + Math.random() * 2; }
      const l = d || 1;
      let vx = -dz / l * this.strafe * 6 * sp, vz = dx / l * this.strafe * 6 * sp;
      if (d < 11) { vx -= dx / l * 5; vz -= dz / l * 5; }
      if (d > 19) { vx += dx / l * 5; vz += dz / l * 5; }
      this.pos.x += vx * dt; this.pos.z += vz * dt;
      this.pos.y += (this.hoverY + Math.sin(g.time * 1.7) * 0.4 - this.pos.y) * Math.min(1, dt * 3);
      this.clampArena(3);
    }
    switch (this.state) {
      case 'idle':
        if (this.stateT <= 0) {
          this.attackCount++;
          const r = Math.random();
          if (this.phase === 2 && this.attackCount % 4 === 0) { this.state = 'blinkWind'; this.stateT = 0.6; this.pickBlink(); }
          else if (this.phase === 2 && this.attackCount % 4 === 2) { this.state = 'sweepWind'; this.stateT = 1.1; g.audio.play('laser', this.pos, 1); }
          else if (r < 0.3 && g.bosses.barriers.length === 0) this.deployBarrier();
          else if (r < 0.62) { this.state = 'fanWind'; this.stateT = 0.55 * this.cdMul; this.volleys = this.phase === 2 ? 3 : 2; }
          else { this.state = 'seekWind'; this.stateT = 0.6 * this.cdMul; }
        }
        break;
      case 'fanWind':
        this.armL.rotation.z = -1.2; this.armR.rotation.z = 1.2;
        if (this.stateT <= 0) {
          const n = this.phase === 2 ? 7 : 5;
          const from = this.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
          const to = g.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0));
          const base = Math.atan2(to.x - from.x, to.z - from.z);
          const flat = Math.hypot(to.x - from.x, to.z - from.z);
          const dy = (to.y - from.y) / Math.max(1, flat);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.14 + (this.volleys % 2 ? 0.07 : 0);
            g.projectiles.spawnEnemy(from.clone(), new THREE.Vector3(Math.sin(a), dy, Math.cos(a)).normalize().multiplyScalar(21), 10 * this.dmgMul, { color: 0x40c8ff, radius: 0.22, size: 0.22, cause: 'VESPER FAN', tip: 'Vesper fires fans with gaps. Strafe between them or dash through.' });
          }
          g.audio.play('enemyShot', this.pos, 1);
          this.volleys--;
          this.stateT = 0.5;
          if (this.volleys <= 0) { this.state = 'idle'; this.stateT = (1.3 + Math.random()) * this.cdMul; this.armL.rotation.z = 0; this.armR.rotation.z = 0; }
        }
        break;
      case 'seekWind':
        this.armR.rotation.x = -1.4;
        if (this.stateT <= 0) {
          const n = this.phase === 2 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const a = this.yaw + (i - (n - 1) / 2) * 0.7;
            g.projectiles.spawnEnemy(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(Math.sin(a) * 8, 4, Math.cos(a) * 8), 14 * this.dmgMul, { color: 0xffe23a, radius: 0.3, size: 0.3, homing: 1.5, life: 6, cause: 'VESPER SEEKER', tip: 'Seekers are slow and parryable: punch them back at Vesper for huge damage.' });
          }
          g.audio.play('radio', this.pos, 1);
          this.armR.rotation.x = 0;
          this.state = 'idle'; this.stateT = (1.6 + Math.random()) * this.cdMul;
        }
        break;
      case 'blinkWind':
        g.fx.spawnColumn(this.blinkTo.x, 0, this.blinkTo.z, 0x40c8ff, 0.05, 6);
        if (this.stateT <= 0) {
          g.fx.spawnColumn(this.pos.x, 0, this.pos.z, 0x40c8ff, 0.4, 6);
          this.pos.x = this.blinkTo.x; this.pos.z = this.blinkTo.z;
          g.audio.play('spawn', this.pos, 1);
          this.state = 'fanWind'; this.stateT = 0.35; this.volleys = 2;
        }
        break;
      case 'sweepWind': {
        // descend to sweep height, telegraph the beam plane
        this.pos.y += (1.0 - this.pos.y) * Math.min(1, dt * 5);
        const a0 = Math.atan2(dx, dz) - 1.9 * this.sweepDirSign();
        this.sweepA = a0;
        const from = this.pos.clone().setY(1.0);
        const to = from.clone().add(new THREE.Vector3(Math.sin(a0) * 40, 0, Math.cos(a0) * 40));
        g.fx.beam(from, to, 0xff40a0, 0.04, 0.03, false);
        if (this.stateT <= 0) { this.state = 'sweep'; this.stateT = 2.0; this.sweepHit = false; }
        break;
      }
      case 'sweep': {
        this.sweepA += this.sweepDirSign() * 1.9 * dt;
        const from = this.pos.clone().setY(1.0);
        const dir = new THREE.Vector3(Math.sin(this.sweepA), 0, Math.cos(this.sweepA));
        const w = g.combat.rayWorld(from, dir, 40);
        const to = from.clone().addScaledVector(dir, w ? w.t : 40);
        g.fx.beam(from, to, 0xff40a0, 0.28, 0.03, false);
        g.fx.beam(from, to, 0xffffff, 0.1, 0.03, false);
        const pp = g.player.body.pos;
        if (!this.sweepHit && segPointDist2(from.x, 1, from.z, to.x, 1, to.z, pp.x, 1, pp.z) < 0.5 * 0.5 && pp.y < 1.12 && pp.y + g.player.body.h > 0.9) {
          this.sweepHit = true;
          g.player.damage(26 * this.dmgMul, from, 'VESPER SWEEP LASER', 'The pink sweep laser is at waist height: slide under it or jump over it.');
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 1.2 * this.cdMul; }
        break;
      }
    }
  }
  sweepDirSign() { return this.phase === 2 && this.attackCount % 8 === 2 ? -1 : 1; }
  pickBlink() {
    const p = this.game.player.body.pos;
    const a = Math.random() * Math.PI * 2;
    this.blinkTo = new THREE.Vector3(p.x + Math.cos(a) * 14, this.pos.y, p.z + Math.sin(a) * 14);
    const r = this.room;
    this.blinkTo.x = clamp(this.blinkTo.x, r.origin.x - r.W / 2 + 3, r.origin.x + r.W / 2 - 3);
    this.blinkTo.z = clamp(this.blinkTo.z, r.origin.z - r.D / 2 + 3, r.origin.z + r.D / 2 - 3);
  }
  deployBarrier() {
    const g = this.game;
    const { dx, dz, d } = this.playerVec();
    const l = d || 1;
    const cx = this.pos.x + dx / l * 4, cz = this.pos.z + dz / l * 4;
    const w = 7, h = 4.5;
    const nx = -dz / l, nz = dx / l;
    // axis-aligned approximation: choose the dominant axis
    const alongX = Math.abs(nx) > Math.abs(nz);
    const bx = makeBox(cx - (alongX ? w / 2 : 0.25), 0, cz - (alongX ? 0.25 : w / 2), cx + (alongX ? w / 2 : 0.25), h, cz + (alongX ? 0.25 : w / 2), { surface: 'energy', tag: 'barrier' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bx.maxX - bx.minX, h, bx.maxZ - bx.minZ), new THREE.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.set(cx, h / 2, cz);
    g.scene.add(mesh);
    const barrier = { box: bx, mesh, t: 7, hp: 220 * this.hpMul };
    bx.ref = barrier;
    g.bosses.barriers.push(barrier);
    g.audio.play('shieldBreak', mesh.position, 0.8);
    g.hud.toast('BARRIER UP - FLANK IT OR BREAK IT', '#40c8ff');
    this.state = 'fanWind'; this.stateT = 0.8; this.volleys = 2;
  }
  animate() {
    const t = this.game.time;
    this.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.2 + Math.sin(t * 3) * 0.15); });
    this.rig.rotation.x = this.state === 'sweep' ? 0.3 : 0.1;
  }
  extraRemove() {
    for (const b of this.game.bosses.barriers) { this.game.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.game.bosses.barriers = [];
  }
}

// ---------------------------------------------------------------------------------------
// 3. THE CRUCIBLE — shielded core fed by 4 pylons. Break pylons to expose the core.
// ---------------------------------------------------------------------------------------
class Crucible extends Boss {
  constructor(game, room, tier) {
    super(game, room, 'crucible', tier);
    this.setHp(2000);
    this.pos.set(room.wx(0), 0, room.wz(0));
    const glow = G(0x6aff5a);
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(2.0, 0), M(0x50705a, 'panel'));
    this.core.userData.mat = this.core.material;
    this.coreGlow = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), glow);
    this.coreGlow.userData.mat = glow;
    this.shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 1), new THREE.MeshBasicMaterial({ color: 0x6aff5a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    this.shieldMesh.userData.mat = this.shieldMesh.material;
    this.coreY = 5;
    this.group.add(this.core, this.coreGlow, this.shieldMesh);
    this.pylons = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 11, z = Math.sin(a) * 11;
      const grp = new THREE.Group();
      grp.position.set(x, 0, z);
      grp.add(box(1.4, 3.2, 1.4, M(0x3a4a40, 'panel'), 0, 1.6, 0));
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glow);
      crystal.position.y = 4;
      crystal.userData.mat = glow;
      grp.add(crystal);
      this.group.add(grp);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), new THREE.MeshBasicMaterial({ color: 0x6aff5a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }));
      beam.userData.mat = beam.material;
      game.scene.add(beam);
      this.pylons.push({ grp, crystal, beam, x, z, hp: 0, max: 260 * this.hpMul, alive: true, id: i });
    }
    for (const p of this.pylons) p.hp = p.max;
    this.exposedT = 0;
    this.spiralA = 0;
    this.summonT = 10;
    this.spokesA = 0;
    this.spokeHitCd = 0;
    this.finish();
  }
  get shielded() { return this.pylons.some((p) => p.alive); }
  hitboxes() {
    const p = this.pos;
    this.hbs = [{ x: p.x, y: this.coreY, z: p.z, r: 2.0, mul: this.exposedT > 0 ? 1.5 : 1, weak: this.exposedT > 0, shielded: this.shielded, core: true }];
    for (const py of this.pylons) if (py.alive) this.hbs.push({ x: p.x + py.x, y: 3.9, z: p.z + py.z, r: 1.0, mul: 1, pylon: py });
    return this.hbs;
  }
  damagePart(part, amount) {
    const py = part.pylon;
    if (!py || !py.alive) return 0;
    py.hp -= amount;
    this.flashT = 0.04;
    if (py.hp <= 0) {
      py.alive = false;
      py.grp.visible = false;
      py.beam.visible = false;
      const wp = new THREE.Vector3(this.pos.x + py.x, 3, this.pos.z + py.z);
      this.game.fx.explosion(wp, 3.5, 0x6aff5a);
      this.game.fx.chunks(wp, 0x3a4a40, 12, 8, 0.3);
      this.game.audio.play('explosion', wp, 1);
      this.game.style.add('PYLON DOWN', 50);
      if (!this.shielded) {
        this.exposedT = 9;
        this.game.hud.toast('CORE EXPOSED', '#6aff5a');
        this.game.audio.play('shieldBreak', this.pos, 1);
      } else this.game.hud.toast(this.pylons.filter((q) => q.alive).length + ' PYLONS REMAIN', '#6aff5a');
    }
    return amount;
  }
  think(dt) {
    const g = this.game;
    const t = g.time;
    const sp = this.speedMul;
    this.summonT -= dt;
    this.spokeHitCd -= dt;
    if (this.exposedT > 0) {
      this.exposedT -= dt;
      this.coreY += (2.6 - this.coreY) * Math.min(1, dt * 3);
      if (this.exposedT <= 0) {
        // pylons reboot
        for (const p of this.pylons) { p.alive = true; p.hp = p.max * 0.6; p.grp.visible = true; p.beam.visible = true; p.max *= 1; }
        g.hud.toast('PYLONS REBOOTING', '#6aff5a');
        g.audio.play('spawn', this.pos, 1);
      }
    } else this.coreY += (5 - this.coreY) * Math.min(1, dt * 2);
    if (this.summonT <= 0 && g.enemies.aliveCount < 5) {
      this.summonT = (15 - Math.min(5, this.tier * 1.5)) * this.cdMul;
      g.director.spawnEscort(this.tier + 1, true);
      g.hud.toast('THE CRUCIBLE SUMMONS DEFENDERS', '#6aff5a');
    }
    switch (this.state) {
      case 'idle':
        if (this.stateT <= 0) {
          this.attackCount++;
          const r = Math.random();
          if (r < 0.45) { this.state = 'spiral'; this.stateT = 3.2; this.spiralT = 0; }
          else if (r < 0.75) { this.state = 'pulseWind'; this.stateT = 0.9; g.audio.play('windup', this.pos, 1); }
          else { this.state = 'volley'; this.stateT = 0.4; this.volleys = 4; }
        }
        break;
      case 'spiral':
        this.spiralT -= dt;
        if (this.spiralT <= 0) {
          this.spiralT = (this.phase === 2 ? 0.11 : 0.15) / sp;
          const arms = this.phase === 2 ? 4 : 3;
          for (let k = 0; k < arms; k++) {
            const a = this.spiralA + (k / arms) * Math.PI * 2;
            g.projectiles.spawnEnemy(new THREE.Vector3(this.pos.x, Math.min(this.coreY, 3) - 1.4, this.pos.z), new THREE.Vector3(Math.sin(a) * 11, 0, Math.cos(a) * 11), 9 * this.dmgMul, { color: 0x6aff5a, radius: 0.24, size: 0.24, life: 4, cause: 'CRUCIBLE SPIRAL', tip: 'Spiral orbs fly at chest height in rotating arms: move with the rotation and slip through the gaps.', trail: false });
          }
          this.spiralA += 0.23;
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 1.4 * this.cdMul; }
        break;
      case 'pulseWind':
        this.coreGlow.scale.setScalar(1 + (0.9 - this.stateT) * 0.8);
        if (this.stateT <= 0) {
          this.coreGlow.scale.setScalar(1);
          g.enemies.shockwave(this.pos.clone(), 20, 10 * sp, 18 * this.dmgMul, 0x6aff5a, 'CRUCIBLE PULSE', 'Jump over the green pulse rings.');
          g.audio.play('slam', this.pos, 1);
          g.addShake(0.3);
          this.state = 'idle'; this.stateT = 1.4 * this.cdMul;
        }
        break;
      case 'volley':
        if (this.stateT <= 0) {
          this.stateT = 0.5;
          const from = new THREE.Vector3(this.pos.x, this.coreY, this.pos.z);
          const target = g.player.body.pos.clone();
          g.projectiles.spawnMortar(from, target.setY(0), 18 * this.dmgMul, 3.2, 1.2, { color: 0x6aff5a, cause: 'CRUCIBLE BOMBARD' });
          this.volleys--;
          if (this.volleys <= 0) { this.state = 'idle'; this.stateT = 1.2 * this.cdMul; }
        }
        break;
    }
    // phase 2: rotating floor spokes (jump them)
    if (this.phase === 2) {
      this.spokesA += dt * 0.55 * sp;
      const n = 3;
      const pp = g.player.body.pos;
      for (let k = 0; k < n; k++) {
        const a = this.spokesA + (k / n) * Math.PI * 2;
        const from = new THREE.Vector3(this.pos.x, 0.4, this.pos.z);
        const to = from.clone().add(new THREE.Vector3(Math.sin(a) * 19, 0, Math.cos(a) * 19));
        g.fx.beam(from, to, 0xff3050, 0.2, 0.03, false);
        if (this.spokeHitCd <= 0 && segPointDist2(from.x, 0.4, from.z, to.x, 0.4, to.z, pp.x, 0.4, pp.z) < 0.45 * 0.45 && pp.y < 0.55) {
          this.spokeHitCd = 0.7;
          g.player.damage(16 * this.dmgMul, from, 'CRUCIBLE SPOKE', 'In phase two, red spokes sweep the floor. Hop over them as they pass.');
        }
      }
    }
    this.pushPlayer(2.4);
  }
  animate(dt) {
    const t = this.game.time;
    this.core.position.y = this.coreY;
    this.coreGlow.position.y = this.coreY;
    this.shieldMesh.position.y = this.coreY;
    this.core.rotation.y = t * 0.6; this.core.rotation.x = Math.sin(t * 0.5) * 0.3;
    this.coreGlow.rotation.y = -t * 1.5;
    this.shieldMesh.visible = this.shielded;
    this.shieldMesh.rotation.y = t * 0.3;
    for (const p of this.pylons) {
      p.crystal.rotation.y = t * 2;
      p.crystal.position.y = 4 + Math.sin(t * 2 + p.id) * 0.2;
      if (!p.alive) continue;
      const a = new THREE.Vector3(this.pos.x + p.x, 4, this.pos.z + p.z);
      const b = new THREE.Vector3(this.pos.x, this.coreY, this.pos.z);
      p.beam.position.copy(a).lerp(b, 0.5);
      p.beam.lookAt(b);
      p.beam.scale.set(1 + Math.sin(t * 20) * 0.3, 1, a.distanceTo(b));
    }
    void dt;
  }
  extraRemove() {
    for (const p of this.pylons) { this.game.scene.remove(p.beam); p.beam.geometry.dispose(); p.beam.material.dispose(); }
  }
  center() { return this.tmp.set(this.pos.x, this.coreY, this.pos.z); }
}

// ---------------------------------------------------------------------------------------
// 4. SCYTHEWRIGHT — close-range mantis: lunges, 360 sweeps, thrown blades, overheat window
// ---------------------------------------------------------------------------------------
class Scythewright extends Boss {
  constructor(game, room, tier) {
    super(game, room, 'scythewright', tier);
    this.setHp(2300);
    const body = M(0x9a5a9a, 'panel'), dark = M(0x2a1430, 'gun'), glow = G(0xff3df0), blade = M(0xe8e0f0, 'gun');
    this.rig = new THREE.Group();
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.5, 1.6, 0);
      leg.add(box(0.3, 1.6, 0.3, dark, 0, -0.8, 0));
      this.rig.add(leg); this.legs.push(leg);
    }
    this.torso = new THREE.Group();
    this.torso.position.y = 1.6;
    this.torso.add(box(1.1, 1.3, 0.7, body, 0, 0.65, 0));
    this.coreMesh = box(0.5, 0.5, 0.1, glow, 0, 0.7, 0.36);
    this.torso.add(this.coreMesh);
    this.torso.add(box(0.6, 0.5, 0.8, dark, 0, 1.55, 0.2));
    this.torso.add(box(0.5, 0.06, 0.05, glow, 0, 1.6, 0.62));
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.75, 1.2, 0);
      arm.add(box(0.25, 1.0, 0.25, dark, 0, -0.5, 0));
      arm.add(box(0.08, 0.3, 1.9, blade, s * 0.05, -1.0, 0.9));
      arm.add(box(0.09, 0.06, 1.7, glow, s * 0.05, -0.85, 0.9));
      this.torso.add(arm); this.arms.push(arm);
    }
    this.rig.add(this.torso);
    this.rig.scale.setScalar(1.3);
    this.group.add(this.rig);
    this.body = { pos: this.pos, vel: new THREE.Vector3(), r: 1.1, h: 4.3, grounded: true, step: 0.4 };
    this.combo = 0;
    this.finish();
  }
  hitboxes() {
    const p = this.pos, s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const hot = this.state === 'overheat' || this.state === 'stuck';
    this.hbs = [
      { x: p.x, y: p.y + 3.0, z: p.z, r: 1.1, mul: 1 },
      { x: p.x + s * 0.4, y: p.y + 3.0, z: p.z + c * 0.4, r: 0.52, mul: hot ? 3 : 1.4, weak: hot },
      { x: p.x, y: p.y + 4.3, z: p.z, r: 0.58, mul: 1.6, weak: true },
      { x: p.x, y: p.y + 1.15, z: p.z, r: 0.8, mul: 0.8 },
    ];
    return this.hbs;
  }
  think(dt) {
    const g = this.game;
    const { dx, dz, d, p } = this.playerVec();
    const sp = this.speedMul * (this.phase === 2 ? 1.2 : 1);
    switch (this.state) {
      case 'idle': {
        this.face(p.x, p.z, dt, 6);
        if (d > 3) moveBody(this.body, dx / d * 6.5 * sp * dt, 0, dz / d * 6.5 * sp * dt, g.level.colliders);
        this.stride = (this.stride || 0) + dt * 8;
        if (this.stateT <= 0) {
          this.combo++;
          if (this.combo > 3) { this.combo = 0; this.state = 'overheat'; this.stateT = 2.6; g.hud.toast('OVERHEATED - SHOOT THE CORE', '#ff3df0'); g.audio.play('sizzle', this.pos, 1); break; }
          if (d < 5) { this.state = 'sweepWind'; this.stateT = 0.65 * this.cdMul; g.fx.telegraphDisc(this.pos.x, 0, this.pos.z, 4.8, 0xff3df0, 0.65 * this.cdMul); g.audio.play('windup', this.pos, 1); }
          else if (d > 14 || Math.random() < 0.35) { this.state = 'throwWind'; this.stateT = 0.5 * this.cdMul; }
          else { this.state = 'lungeWind'; this.stateT = 0.55 * this.cdMul; this.lunges = this.phase === 2 ? 2 : 1; g.audio.play('windup', this.pos, 1); }
        }
        break;
      }
      case 'lungeWind': {
        this.face(p.x, p.z, dt, 10);
        this.torso.rotation.x = 0.5;
        const a = this.pos.clone().setY(0.06);
        const len = Math.min(24, d + 4);
        g.fx.beam(a, a.clone().add(new THREE.Vector3(Math.sin(this.yaw) * len, 0, Math.cos(this.yaw) * len)), 0xff3df0, 1.4, 0.03, false);
        if (this.stateT <= 0) { this.state = 'lunge'; this.stateT = Math.min(0.7, (d + 4) / 24); this.hit = false; g.audio.play('lunge', this.pos, 1); }
        break;
      }
      case 'lunge': {
        const v = 24 * sp;
        const before = this.pos.clone();
        const hit = moveBody(this.body, Math.sin(this.yaw) * v * dt, 0, Math.cos(this.yaw) * v * dt, g.level.colliders);
        this.torso.rotation.x = 0.7;
        if (!this.hit && d < 2.4 && p.y < this.pos.y + 3) {
          this.hit = true;
          if (g.player.damage(26 * this.dmgMul, this.pos, 'SCYTHEWRIGHT LUNGE', 'Scythewright paints a magenta lane, then lunges. Sidestep or dash, then punish while it recovers or is stuck in a wall.')) g.player.knock(Math.sin(this.yaw) * 9, 4, Math.cos(this.yaw) * 9);
          g.audio.play('slash', this.pos, 1);
        }
        if ((hit & 1) && before.distanceTo(this.pos) < v * dt * 0.5) {
          this.state = 'stuck'; this.stateT = 1.8; g.addShake(0.4); g.audio.play('slam', this.pos, 1); g.hud.toast('BLADES STUCK - CORE EXPOSED', '#ff3df0');
          break;
        }
        if (this.stateT <= 0) {
          this.lunges--;
          if (this.lunges > 0) { this.state = 'lungeWind'; this.stateT = 0.35; }
          else { this.state = 'recover'; this.stateT = 0.8; this.torso.rotation.x = 0; }
        }
        break;
      }
      case 'sweepWind':
        this.rig.rotation.y = -0.6 * (1 - Math.max(0, this.stateT) / 0.65);
        if (this.stateT <= 0) { this.state = 'sweep'; this.stateT = 0.45; this.hit = false; g.audio.play('slash', this.pos, 1); }
        break;
      case 'sweep':
        this.rig.rotation.y += dt * 16;
        if (!this.hit && d < 4.8 && p.y < this.pos.y + 1.15) {
          this.hit = true;
          if (g.player.damage(24 * this.dmgMul, this.pos, 'SCYTHEWRIGHT SWEEP', 'A magenta circle means a spinning sweep: jump over the blades or dash out of the circle.')) g.player.knock(dx / (d || 1) * 10, 4, dz / (d || 1) * 10);
        }
        g.fx.sparksBurst(this.pos.clone().setY(1), 0xff3df0, 2, 10, 0.2);
        if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.6; this.rig.rotation.y = 0; }
        break;
      case 'throwWind':
        this.face(p.x, p.z, dt, 6);
        this.arms[1].rotation.x = -2.5;
        if (this.stateT <= 0) {
          const n = this.phase === 2 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const a = this.yaw + (i - (n - 1) / 2) * 0.6;
            g.projectiles.spawnEnemy(this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), new THREE.Vector3(Math.sin(a) * 13, 0, Math.cos(a) * 13), 18 * this.dmgMul, { color: 0xff3df0, radius: 0.5, size: 0.55, homing: 0.9, life: 3.5, cause: 'THROWN SCYTHE', tip: 'Thrown scythes home slowly. Dash sideways at the last moment or parry them.' });
          }
          g.audio.play('slash', this.pos, 1);
          this.arms[1].rotation.x = 0;
          this.state = 'recover'; this.stateT = 0.7;
        }
        break;
      case 'stuck':
      case 'overheat':
        this.coreMesh.scale.setScalar(1.3 + Math.sin(g.time * 14) * 0.3);
        if (this.state === 'overheat' && Math.random() < 0.3) g.fx.dust.spawn(this.pos.x, this.pos.y + 3.2, this.pos.z, (Math.random() - 0.5), 2, (Math.random() - 0.5), 0.4, 0.4, 0.45, 0.6, 0.4, 0.8, -0.5, 1);
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 0.6; this.coreMesh.scale.setScalar(1); this.torso.rotation.x = 0; }
        break;
      case 'recover':
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = (0.9 + Math.random() * 0.6) * this.cdMul; this.torso.rotation.x = 0; }
        break;
    }
    this.pushPlayer(1.7);
    this.clampArena(1.8);
  }
  animate() {
    const s = this.stride || 0;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(s + i * Math.PI) * 0.5; });
    if (this.state === 'idle') this.arms.forEach((a, i) => { a.rotation.x = -0.6 + Math.sin(s + i) * 0.2; });
  }
}

export const BESPOKE = { grindhammer: Grindhammer, vesper: Vesper, crucible: Crucible, scythewright: Scythewright };
