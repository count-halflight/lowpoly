import * as THREE from 'three';
import { moveBody, clamp, angleDiff, segPointDist2 } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { sharedMaterials } from '../render/materials.js';
import { makeBox } from '../core/collide.js';
import { MODULES, slideBody } from './abilities.js';

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

// ---- shared body language for the bespoke bosses (visual only: hitboxes come from pos/yaw)
// frame-rate independent ease toward a target
const ez = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
const smooth = (k) => k * k * (3 - 2 * k);
const _bv = new THREE.Vector3();
const WRECK = { own: true }, WRECK_SPARK = { own: true, spark: true };
let wreckMat = null;
// Boot: dormant through the intro (the establishing shot), lights stutter on, then it rises
// and roars as the hero shot cuts in. Returns 0..1.
function bootStep(b, dt) {
  if (b.boot >= 1) return 1;
  b.boot = Math.min(1, (b.boot || 0) + dt * (b.state === 'intro' ? 1 / 2.4 : 3));
  const on = b.boot >= 1 || (b.boot > 0.45 && Math.random() < (b.boot - 0.35) * 1.6);
  for (const m of b.glows) m.visible = on;
  if (b.boot >= 1) b.roarT = b.roar0 = 1.1;
  return b.boot;
}
// per-frame beat every bespoke animate() runs first: boot, roar (intro and phase changes,
// sparks off the body, lands with a dust ring) and a jolt when shot. Returns the roar 0..1.
function bodyBeat(b, dt) {
  const g = b.game;
  bootStep(b, dt);
  let roar = 0;
  if (b.roarT > 0) {
    b.roarT -= dt;
    roar = Math.sin(clamp(b.roarT / b.roar0, 0, 1) * Math.PI);
    if (Math.random() < 0.45) {
      const p = b.deathPoint(_bv);
      g.fx.sparks.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 7, 1, 0.85, 0.5, 1, 0.1, 0.5, 12, 0.5);
    }
    if (b.roarT <= 0) {
      const gy = b.room.floorAt(b.pos.x, b.pos.z);
      g.fx.ring(b.pos.x, gy + 0.1, b.pos.z, 4 + b.size * 2, b.color, 0.45, 0.1);
      for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2; g.fx.dust.spawn(b.pos.x + Math.cos(a) * b.radius, gy + 0.1, b.pos.z + Math.sin(a) * b.radius, Math.cos(a) * 4, 0.6, Math.sin(a) * 4, 0.35, 0.33, 0.3, 0.7, 0.3, 0.7, -0.3, 2.5); }
    }
  }
  b.joltT = Math.max(0, (b.joltT || 0) - dt * 6);
  if (b.joltT > 0 && b.alive) { const j = b.joltT * 0.07 * b.size; b.group.position.x += (Math.random() - 0.5) * j; b.group.position.z += (Math.random() - 0.5) * j; }
  return roar;
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
    // actor interface shared with the attack modules (kit bosses override most of it)
    this.colorHex = this.info.color || '#ff3050';
    this.color = parseInt(String(this.colorHex).replace('#', ''), 16);
    this.anim = { wind: false, act: false, moving: false, mod: null };
    this.radius = 1.6; this.height = 4; this.size = 2;
    this.stunT = 0;
    this.modRun = null;
    this.modStunT = 0;
    this.sig = null; // bespoke signature: { name, id, p, over }
    this.sigT = 8;
    this.sigUses = 0;
  }
  setHp(base) { this.maxHp = base * this.hpMul; this.hp = this.maxHp; }

  // ---------------------------------------------------------------- module adapter
  get groundY() { return this.flying ? this.room.floorAt(this.pos.x, this.pos.z) : this.pos.y; }
  muzzle() { const c = this.center(); return new THREE.Vector3(c.x + Math.sin(this.yaw) * this.radius, c.y, c.z + Math.cos(this.yaw) * this.radius); }
  faceTarget(dt, rate) { const p = this.game.player.body.pos; this.face(p.x, p.z, dt, rate); }
  slide(dx, dz) { if (!this.body) { this.pos.x += dx; this.pos.z += dz; this.clampArena(2); return false; } const b = slideBody(this.body, dx, dz, this.game.level.colliders); this.clampArena(this.radius); return b; }
  teleport(v) { this.pos.x = v.x; this.pos.z = v.z; if (!this.flying) this.pos.y = v.y; }
  stun(t) { this.modStunT = Math.max(this.modStunT, t); }
  // run one attack module as a bespoke state; returns to idle (or a stagger) when it ends
  runModule(id, params, label, big = false) {
    const mod = MODULES[id];
    if (!mod) return false;
    const p = { ...mod.def, ...(params || {}) };
    const s = { t: 0 };
    this.modRun = { mod, s, p, id };
    this.state = 'module';
    this.anim.mod = id;
    if (label) { this.game.hud.toast(label, this.colorHex, !big); if (big) this.game.audio.play('alert', null, 0.5); }
    try { mod.start(this, s, p); } catch (e) { this.game.lastError = String(e && e.stack || e); this.modRun = null; this.state = 'idle'; this.stateT = 0.5; return false; }
    return true;
  }
  abortModule() {
    const r = this.modRun;
    if (r && r.mod.end) { try { r.mod.end(this, r.s, r.p); } catch (e) { /* ignore */ } }
    this.modRun = null;
    this.anim.wind = false; this.anim.act = false; this.anim.mod = null;
  }
  // states every bespoke boss shares; returns true when it consumed the frame
  sharedThink(dt) {
    if (this.state === 'module' && this.modRun) {
      const r = this.modRun;
      r.s.t += dt;
      let done = false;
      try { done = r.mod.update(this, r.s, r.p, dt); } catch (e) { done = true; this.game.lastError = String(e && e.stack || e); }
      if (done) {
        this.abortModule();
        if (this.modStunT > 0) { this.state = 'modstun'; this.stateT = this.modStunT; this.modStunT = 0; this.game.hud.toast(this.info.name + ' IS STAGGERED - HIT THE WEAK POINT', '#ffd060', true); }
        else { this.state = 'idle'; this.stateT = (0.9 + Math.random() * 0.5) * this.cdMul; }
      }
      return true;
    }
    if (this.state === 'module') { this.state = 'idle'; this.stateT = 0.5; return true; }
    if (this.state === 'modstun') {
      if (Math.random() < 0.3) this.game.fx.sparks.spawn(this.pos.x + (Math.random() - 0.5) * 2, this.pos.y + this.height * 0.8, this.pos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1, 0.9, 0.3, 1, 0.1, 0.4, 6, 0);
      if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 0.6; }
      return true;
    }
    return false;
  }
  // bespoke signature: announced loudly the first time, OVERDRIVE variant in phase III
  trySignature() {
    if (!this.sig || this.sigT > 0) return false;
    const over = this.phase >= 3 && this.sig.over;
    const name = over ? 'OVERDRIVE · ' + this.sig.name : this.sig.name;
    const first = this.sigUses === 0;
    this.sigUses++;
    this.sigT = (this.sig.cd || 16) * this.cdMul * (over ? 0.75 : 1);
    if (this.game.emit) this.game.emit('bossSignature', { name: this.sig.name, actor: this.type });
    return this.runModule(this.sig.id, over ? { ...this.sig.p, ...this.sig.over } : this.sig.p, name, first || !!over);
  }
  finish() {
    this.group.traverse((o) => { if (o.isMesh) { if (!o.userData.mat) o.userData.mat = o.material; this.meshes.push(o); } });
    // lit parts (they stutter on while it boots, and go dark as wreckage)
    this.glows = this.meshes.filter((m) => m.userData.mat.isMeshBasicMaterial && !m.userData.mat.transparent);
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
    this.joltT = Math.min(1, (this.joltT || 0) + 0.2 + amount / Math.max(1, this.maxHp) * 20);
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) this.enterPhase2();
    else if (this.phase === 2 && this.maxPhase >= 3 && this.hp < this.maxHp * 0.22) this.enterPhase3 && this.enterPhase3();
    if (this.hp <= 0) { this.hp = 0; this.defeat(); }
    return amount;
  }
  damagePart() { return 0; }

  enterPhase2() {
    const g = this.game;
    this.abortModule();
    this.phase = 2;
    this.invuln = 1.4;
    this.state = 'phase'; this.stateT = 1.4;
    g.audio.play('bossPhase', this.pos, 1);
    g.flash(0xffffff, 0.35);
    g.addShake(0.6);
    g.hitstop(0.15);
    g.hud.banner('PHASE II', this.info.name + ' IS ENRAGED', this.info.color);
    g.fx.sparksBurst(this.center(), 0xffffff, 40, 14, 0.8, 0.15);
    this.sigT = Math.min(this.sigT, 3);
    this.roarT = this.roar0 = 1.4;
  }

  // bespoke bosses get a third phase in NG+ and on overclocked tiers (kit bosses override)
  enterPhase3() {
    const g = this.game;
    this.abortModule();
    this.phase = 3;
    this.invuln = 1.4;
    this.state = 'phase'; this.stateT = 1.4;
    this.speedMul *= 1.1;
    this.cdMul = Math.max(0.5, this.cdMul * 0.85);
    this.phaseName = 'PHASE III';
    g.audio.play('bossPhase', this.pos, 1);
    g.flash(0xff3050, 0.4);
    g.addShake(0.7);
    g.hitstop(0.15);
    g.hud.banner('PHASE III', this.info.name + ' OVERLOADS', this.info.color);
    g.fx.sparksBurst(this.center(), 0xff3050, 40, 14, 0.8, 0.15);
    g.fx.ring(this.pos.x, this.groundY + 0.2, this.pos.z, 12, 0xff3050, 0.6, 0.05);
    this.sigT = Math.min(this.sigT, 1.5);
    this.roarT = this.roar0 = 1.4;
  }

  center() { return this.tmp.set(this.pos.x, this.pos.y + 2, this.pos.z); }

  defeat() {
    if (!this.alive) return;
    const g = this.game;
    this.alive = false;
    this.abortModule();
    if (this.brain && this.brain.abort) this.brain.abort();
    if (this.onDefeatExtra) this.onDefeatExtra();
    g.bosses.onDefeated(this);
    g.bosses.field.clearOwner(this);
    // staged collapse: popping explosions speed up while the body buckles, then one big blast
    this.dying = true;
    this.deathT = 0;
    this.deathPop = 0.05;
    this.deathTilt = Math.random() < 0.5 ? -1 : 1;
    this.deathY0 = this.pos.y;
    this.flashT = 0;
    g.audio.play('bossPhase', this.pos, 0.9);
    g.addShake(0.6);
    g.fx.sparksBurst(this.center().clone(), 0xffffff, 30, 12, 0.6);
  }

  // a random point on the body for death explosions (kit bosses use their hitboxes)
  deathPoint(out) {
    const c = this.center();
    return out.set(c.x + (Math.random() - 0.5) * this.size * 1.6, c.y + (Math.random() - 0.4) * this.height * 0.6, c.z + (Math.random() - 0.5) * this.size * 1.6);
  }

  updateDeath(dt) {
    if (!this.dying || this.removed) return;
    const g = this.game;
    this.deathT += dt;
    const T = 2.6;
    const k = Math.min(1, this.deathT / T);
    // buckle: tilt, sink (fliers fall out of the air), shudder
    const floor = this.room.floorAt(this.pos.x, this.pos.z);
    const drop = this.flying ? Math.max(0, this.deathY0 - floor - 0.6) : this.height * 0.18;
    this.group.position.set(this.pos.x + (Math.random() - 0.5) * 0.18 * (1 - k * 0.5), this.deathY0 - drop * k * k - (this.sinkY || 0), this.pos.z + (Math.random() - 0.5) * 0.18 * (1 - k * 0.5));
    this.group.rotation.set(0, this.yaw, 0);
    // it staggers: sways, catches itself, then the lean wins
    this.group.rotateZ(this.deathTilt * k * k * 0.45 + Math.sin(this.deathT * 6.5) * 0.09 * (1 - k));
    this.group.rotateX(-k * 0.2 + Math.sin(this.deathT * 4.3) * 0.05 * (1 - k));
    // the lights fail: glow parts stutter and go dark toward the end
    if (this.ch && this.ch.glowMat) {
      if (Math.random() < 0.35) this.ch.glowMat.color.copy(this.ch.baseGlow).multiplyScalar(Math.random() < 0.25 + k * 0.6 ? 0.08 : 1.2);
    } else if (this.glows && Math.random() < 0.35) {
      const off = Math.random() < 0.25 + k * 0.6;
      for (const m of this.glows) m.visible = !off;
    }
    if (Math.random() < 0.6) {
      const vp = this.deathPoint(new THREE.Vector3());
      g.fx.sparks.spawn(vp.x, vp.y, vp.z, (Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7, 1, 0.8, 0.4, 1, 0.1, 0.5, 14, 0.5);
    }
    if (this.flashing) { this.flashing = false; for (const m of this.meshes) m.material = m.userData.mat; }
    if (this.onDeathTick) this.onDeathTick(k);
    this.deathPop -= dt;
    if (this.deathPop <= 0 && k < 1) {
      this.deathPop = 0.3 - 0.2 * k;
      const p = this.deathPoint(new THREE.Vector3());
      const big = Math.random() < 0.3;
      g.fx.explosion(p, (big ? 2.4 : 1.4) + Math.random() * 1.2 + this.size * 0.2, Math.random() < 0.5 ? this.color : 0xffa040);
      g.fx.chunks(p, 0x5a5650, big ? 6 : 3, 7, 0.18 + this.size * 0.04);
      g.audio.play('explosion', p, big ? 0.8 : 0.5);
      g.addShake(big ? 0.35 : 0.15);
      if (big) g.fx.sparksBurst(p, 0xffe0a0, 16, 10, 0.5);
    }
    if (Math.random() < 0.5) {
      const p = this.deathPoint(new THREE.Vector3());
      g.fx.dust.spawn(p.x, p.y, p.z, (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), 0.12, 0.11, 0.1, 0.8, 0.7, 1.4, -0.6, 1);
    }
    if (k >= 1) {
      const c = this.center().clone();
      g.fx.explosion(c, 6 + this.size * 1.5, 0xffffff);
      g.fx.explosion(c.clone().add(new THREE.Vector3(0, 1.5, 0)), 4 + this.size, this.color);
      g.fx.chunks(c, 0x6a6660, 30, 15, 0.3 + this.size * 0.05);
      g.fx.ring(c.x, floor + 0.15, c.z, 16 + this.size * 2, this.color, 0.7, 0.05);
      g.fx.ring(c.x, floor + 0.6, c.z, 11 + this.size * 2, 0xffffff, 0.5, 0.05);
      g.fx.spawnColumn(c.x, floor, c.z, this.color, 1.0, 14);
      g.fx.sparksBurst(c, 0xffffff, 50, 18, 0.9, 0.16);
      g.audio.play('explosion', c, 1);
      g.audio.play('slam', c, 1);
      g.addShake(1.0);
      g.flash(0xffffff, 0.3);
      g.hitstop(0.12);
      if (this.onDeathEnd) this.onDeathEnd(c, floor);
      this.dying = false;
      this.remove();
    }
  }

  // the final blast tears the body apart: a handful of parts fly out and litter the arena
  // (bespoke bosses own their geometry, so the pieces free it when they are cleared)
  onDeathEnd(c) {
    const g = this.game;
    if (!wreckMat) wreckMat = psxify(new THREE.MeshLambertMaterial({ map: getTexture('gun'), color: 0x1c1a1a }));
    this.group.updateMatrixWorld(true);
    const parts = this.meshes.filter((m) => m.visible && m.parent && m.geometry && !m.userData.shared && !m.userData.mat.transparent);
    const n = Math.min(parts.length, g.lowPower ? 10 : 18);
    for (let i = 0; i < n; i++) {
      const m = parts.splice(Math.floor(Math.random() * parts.length), 1)[0];
      if (m.userData.mat.isMeshBasicMaterial) m.userData.mat = wreckMat;
      m.material = m.userData.mat;
      m.getWorldPosition(_bv);
      const dx = _bv.x - c.x, dz = _bv.z - c.z, l = Math.hypot(dx, dz) || 1, sp = 5 + Math.random() * 8;
      const v = new THREE.Vector3(dx / l * sp + (Math.random() - 0.5) * 3, 4 + Math.random() * 7, dz / l * sp + (Math.random() - 0.5) * 3);
      const w = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      g.fx.addCorpsePiece(m, v, w, i < 4 ? WRECK_SPARK : WRECK);
    }
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.dying = false;
    this.abortModule();
    this.game.scene.remove(this.group);
    // chassis geometry is cached and shared between actors: only dispose what is ours
    this.group.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose(); });
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
    const pb = this.game.player.body, pp = pb.pos;
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < radius && pp.y < this.pos.y + 3) {
      const k = (radius - d) / (d || 1);
      // swept: a boss backing the player against a wall must not shove them into (or through) it
      moveBody(pb, dx * k, 0, dz * k, this.game.level.colliders);
    }
  }

  update(dt) {
    const g = this.game;
    this.flashT -= dt;
    this.invuln -= dt;
    this.stateT -= dt;
    if (this.state !== 'intro') this.sigT -= dt;
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
    this.radius = 2.0; this.height = 3.6; this.size = 2.6;
    // signature: three chained charges that leave a molten wake behind them
    this.sig = { name: 'FURNACE STAMPEDE', id: 'charge', p: { count: 3, speed: 27, wind: 0.85, wake: 16, stun: 2.6, maxT: 2.2, dmg: 30 }, over: { count: 4, speed: 30, wake: 20 }, cd: 18 };
    this.sigT = 9;
    this.finish();
  }
  onWallImpact() {
    for (const br of this.room.breakables) {
      if (br.broken) continue;
      if (Math.hypot(this.room.wx(br.x) - this.pos.x, this.room.wz(br.z) - this.pos.z) < 4.2) { this.room.breakPillar(br); this.brokePillar = true; }
    }
  }
  hitboxes() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const p = this.pos;
    const stunned = this.state === 'stunned' || this.state === 'modstun';
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
    if (this.sharedThink(dt)) {
      if (this.state === 'modstun') { this.vent.scale.setScalar(1 + Math.sin(g.time * 12) * 0.15); this.chassis.rotation.z = Math.sin(g.time * 30) * 0.03; }
      this.pushPlayer(2.2); this.clampArena(2.2);
      return;
    }
    this.chassis.rotation.z = 0;
    switch (this.state) {
      case 'idle':
        this.face(p.x, p.z, dt, 3);
        this.walk(dt, dx, dz, d, 3.2 * sp);
        if (this.stateT <= 0) {
          this.attackCount++;
          if (this.trySignature()) break;
          // phase III (NG+): the furnace boils over into meteor rain and star fissures
          if (this.phase >= 3 && this.attackCount % 3 === 1) { this.runModule(this.attackCount % 2 ? 'meteor' : 'fissure', this.attackCount % 2 ? { n: 7, radius: 2.4, dmg: 22 } : { mode: 'star', n: 8, speed: 16, dmg: 20 }, this.attackCount % 2 ? 'SLAG RAIN' : 'FAULT LINES'); break; }
          if (this.phase >= 2 && this.attackCount % 3 === 0) { this.state = 'spewWind'; this.stateT = 0.6 * this.cdMul; this.volleys = 3; }
          else if (d > 7.5 || Math.random() < 0.35) { this.state = 'chargeWind'; this.stateT = 0.95 * this.cdMul; this.charges = this.phase >= 2 ? 2 : 1; g.audio.play('bossCharge', this.pos, 1); }
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
          if (this.phase >= 2) g.enemies.delayed(0.55, () => g.enemies.shockwave(this.pos.clone(), 18, 11 * sp, 22 * this.dmgMul, 0xff7a10, 'GRINDHAMMER SHOCKWAVE', 'Phase two slams send two rings. Jump twice.'));
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
  // A heavy trotting bull: diagonal leg pairs, a plodding bob and roll; it paws the floor and
  // squats before a charge, gallops nose-down, rears up before a slam, sags when stunned.
  // Owns the chassis pose every frame (think() only sets state).
  animate(dt = 0.016) {
    const g = this.game, t = g.time, st = this.state, an = this.anim;
    const P = this.pose || (this.pose = { pitch: 0, roll: 0, lift: 0, fl: 0, splay: 0, paw: 0 });
    const roar = bodyBeat(this, dt);
    const charging = st === 'charging' || (st === 'module' && an.act && an.mod === 'charge');
    if (charging || (st === 'module' && an.moving)) this.stride = (this.stride || 0) + dt * (charging ? 22 : 8);
    const s = this.stride || 0;
    let pitch = 0, roll = 0, lift = 0, fl = 0, splay = 0, paw = 0;
    if (st === 'chargeWind' || (st === 'module' && an.wind)) { pitch = -0.1; lift = -0.18; paw = 1; roll = Math.sin(t * 40) * 0.015; }
    else if (charging) { pitch = 0.12; lift = Math.abs(Math.sin(s)) * 0.2; }
    else if (st === 'slamWind') { const k = 1 - clamp(this.stateT / (0.85 * this.cdMul), 0, 1); pitch = -0.42 * k; lift = 0.9 * k; fl = -0.9 * k; }
    else if (st === 'recover') { pitch = 0.07; lift = -0.15; }
    else if (st === 'spewWind') { pitch = 0.08; roll = Math.sin(t * 50) * 0.02; }
    else if (st === 'stunned' || st === 'modstun') { pitch = 0.16; lift = -0.45; splay = 0.35; roll = Math.sin(t * 30) * 0.03; }
    else { lift = Math.abs(Math.sin(s)) * 0.07 + Math.sin(t * 1.8) * 0.03; roll = Math.sin(s) * 0.035; }
    if (this.boot < 1) { const d = 1 - smooth(clamp((this.boot - 0.55) / 0.4, 0, 1)); pitch += 0.22 * d; lift -= 0.75 * d; splay += 0.35 * d; }
    pitch -= roar * 0.35; lift += roar * 0.55; fl -= roar * 0.8; roll += roar * Math.sin(t * 38) * 0.03;
    const r = st === 'slamWind' ? 30 : 12;
    P.pitch = ez(P.pitch, pitch, r, dt); P.roll = ez(P.roll, roll, 20, dt); P.lift = ez(P.lift, lift, r, dt);
    P.fl = ez(P.fl, fl, r, dt); P.splay = ez(P.splay, splay, 8, dt); P.paw = ez(P.paw, paw, 10, dt);
    this.chassis.rotation.set(P.pitch, 0, P.roll);
    this.chassis.position.y = P.lift;
    const amp = charging ? 0.9 : 0.35;
    this.legs.forEach((l, i) => {
      let a = Math.sin(s + (i === 0 || i === 3 ? 0 : Math.PI)) * amp;
      if (i < 2) a += P.fl;
      // the front-left hoof scrapes back and forth
      if (i === 0) a += P.paw * (-0.45 + Math.sin(t * 11) * 0.5);
      l.rotation.x = a;
      l.rotation.z = (i % 2 ? 1 : -1) * P.splay;
    });
    if (paw && Math.random() < 0.25) {
      this.legs[0].localToWorld(_bv.set(0, -1.4, 0));
      g.fx.dust.spawn(_bv.x, this.pos.y + 0.15, _bv.z, -Math.sin(this.yaw) * 2 + (Math.random() - 0.5), 0.8, -Math.cos(this.yaw) * 2 + (Math.random() - 0.5), 0.3, 0.26, 0.22, 0.7, 0.35, 0.6, 0.5, 1.5);
    }
    this.mouth.scale.y = an.wind ? 1 + Math.random() : st === 'spewWind' ? this.mouth.scale.y : 1 + roar * Math.random() * 1.5;
  }
  onDeathTick(k) {
    // the legs give out: it sags onto its belly with the legs splayed
    const e = smooth(Math.min(1, k * 1.6));
    this.legs.forEach((l, i) => { l.rotation.z = (i % 2 ? 1 : -1) * 0.7 * e; l.rotation.x = (i < 2 ? -0.3 : 0.3) * e; });
    this.chassis.position.y = -0.8 * e;
    this.mouth.scale.y = Math.random() < 0.3 ? 0.2 : 1;
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
    this.flying = true;
    this.radius = 1.2; this.height = 2.6; this.size = 1.6;
    this.decoyLook = { chassis: 'hover', colors: [0x404a6a, 0x1a1c28, 0x40c8ff], scale: 1.4 };
    // signature: a climbing salvo of missiles that dive in from above
    this.sig = { name: 'TALON SALVO', id: 'missiles', p: { n: 8, speed: 18, turn: 1.3, dmg: 12, color: 0x40c8ff, size: 0.26 }, over: { n: 12, turn: 1.5 }, cd: 15 };
    this.sigT = 7;
    this.finish();
  }
  center() { return this.tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z); }
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
    if (this.sharedThink(dt)) { this.pos.y += (this.hoverY + Math.sin(g.time * 1.7) * 0.4 - this.pos.y) * Math.min(1, dt * 3); this.clampArena(3); return; }
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
          if (this.trySignature()) break;
          // phase II: she splits into hologram decoys; phase III: shard dives from the rafters
          if (this.phase >= 2 && this.attackCount % 5 === 3 && this.runModule('decoys', { n: 2, hp: 40, life: 9, dmg: 7 }, 'MIRAGE')) break;
          if (this.phase >= 3 && this.attackCount % 4 === 1 && this.runModule('swarmdive', { n: 6, dmg: 15 }, 'SKYFALL')) break;
          if (this.phase >= 2 && this.attackCount % 4 === 0) { this.state = 'blinkWind'; this.stateT = 0.6; this.pickBlink(); }
          else if (this.phase >= 2 && this.attackCount % 4 === 2) { this.state = 'sweepWind'; this.stateT = 1.1; g.audio.play('laser', this.pos, 1); }
          else if (r < 0.3 && g.bosses.barriers.length === 0) this.deployBarrier();
          else if (r < 0.62) { this.state = 'fanWind'; this.stateT = 0.55 * this.cdMul; this.volleys = this.phase >= 2 ? 3 : 2; }
          else { this.state = 'seekWind'; this.stateT = 0.6 * this.cdMul; }
        }
        break;
      case 'fanWind':
        this.armL.rotation.z = -1.2; this.armR.rotation.z = 1.2;
        if (this.stateT <= 0) {
          const n = this.phase >= 2 ? 7 : 5;
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
          const n = this.phase >= 2 ? 4 : 3;
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
  sweepDirSign() { return this.phase >= 2 && this.attackCount % 8 === 2 ? -1 : 1; }
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
  // A hunting bird: wingbeats that quicken with effort (the body lifts on each down-stroke),
  // banks into her strafes, spreads her arms to fan, raises one to loose seekers, folds
  // thin before a blink and turns her whole body along the sweep laser.
  animate(dt = 0.016) {
    const g = this.game, t = g.time, st = this.state, an = this.anim;
    const P = this.pose || (this.pose = { bank: 0, pitch: 0, aLz: 0, aRz: 0, aRx: 0, aLx: 0, fold: 0, look: 0, head: 0, px: this.pos.x, pz: this.pos.z, ph: 0, thin: 0 });
    const roar = bodyBeat(this, dt);
    const idt = 1 / Math.max(dt, 1e-4);
    const vx = clamp((this.pos.x - P.px) * idt, -20, 20), vz = clamp((this.pos.z - P.pz) * idt, -20, 20);
    P.px = this.pos.x; P.pz = this.pos.z;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const vf = vx * sy + vz * cy, vl = vx * cy - vz * sy;
    const busy = st === 'fanWind' || st === 'seekWind' || st === 'sweepWind' || st === 'sweep' || an.wind;
    const rate = busy ? 9 : 4 + Math.min(4, Math.hypot(vx, vz) * 0.5);
    P.ph += dt * rate;
    let aLz = 0, aRz = 0, aRx = 0, aLx = 0, fold = 0, look = 0, head = 0, thin = 0;
    if (st === 'fanWind' || (st === 'module' && an.wind)) { aLz = -1.2; aRz = 1.2; }
    else if (st === 'seekWind') { aRx = -2.4; aRz = 0.3; }
    else if (st === 'sweepWind' || st === 'sweep') { aRx = -1.5; aLx = -1.5; look = angleDiff(this.yaw, this.sweepA || this.yaw); head = 0.3; }
    else if (st === 'blinkWind') { fold = 1; thin = 1; }
    else if (st === 'module' && an.act) { aRx = -1.4; }
    if (this.boot < 1) { const d = 1 - smooth(clamp((this.boot - 0.5) / 0.45, 0, 1)); fold = Math.max(fold, d); head += 0.6 * d; }
    aLz -= roar * 1.3; aRz += roar * 1.3; aRx -= roar * 0.6; aLx -= roar * 0.6; head -= roar * 0.5;
    P.bank = ez(P.bank, clamp(-vl * 0.045, -0.45, 0.45), 4, dt);
    P.pitch = ez(P.pitch, clamp(vf * 0.025, -0.3, 0.3) + (st === 'sweep' ? 0.2 : 0.1), 4, dt);
    P.aLz = ez(P.aLz, aLz, 12, dt); P.aRz = ez(P.aRz, aRz, 12, dt); P.aRx = ez(P.aRx, aRx, 12, dt); P.aLx = ez(P.aLx, aLx, 12, dt);
    P.fold = ez(P.fold, fold, 12, dt); P.head = ez(P.head, head, 12, dt); P.thin = ez(P.thin, thin, 12, dt);
    P.look = ez(P.look, look, 10, dt);
    const flap = Math.sin(P.ph);
    // folded wings hang straight down; open ones beat
    this.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * ((0.15 + flap * (busy ? 0.35 : 0.25)) * (1 - P.fold) + 1.25 * P.fold); });
    this.rig.position.y = -Math.cos(P.ph) * 0.08 * (1 - P.fold) - 0.5 * (this.boot < 1 ? 1 - this.boot : 0);
    this.rig.rotation.set(P.pitch, P.look, P.bank + roar * Math.sin(t * 36) * 0.05);
    this.rig.scale.set(1.4 * (1 - 0.6 * P.thin), 1.4 * (1 + 0.25 * P.thin), 1.4 * (1 - 0.6 * P.thin));
    this.head.rotation.x = P.head;
    this.armL.rotation.set(P.aLx, 0, P.aLz); this.armR.rotation.set(P.aRx, 0, P.aRz);
  }
  onDeathTick(k) {
    // the wings go limp and it falls nose-first
    const e = smooth(Math.min(1, k * 1.4));
    this.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (1.3 * e + Math.sin(this.deathT * 20) * 0.1 * (1 - e)); });
    this.rig.rotation.x = 0.1 + 0.8 * e;
    this.armL.rotation.set(-0.3 * e, 0, 0); this.armR.rotation.set(-0.3 * e, 0, 0);
    this.head.rotation.x = 0.7 * e;
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
    // a ring of slag shards orbits the core: it speeds up as the core works and flares out when it roars
    this.shards = [];
    const shardGeo = new THREE.OctahedronGeometry(0.45, 0), shardMat = M(0x5a8a64, 'panel');
    for (let i = 0; i < 7; i++) {
      const sh = new THREE.Mesh(shardGeo, shardMat);
      sh.userData.mat = shardMat;
      sh.userData.shared = true; // one geometry for all seven: freed once in extraRemove
      sh.scale.set(0.7, 1.6, 0.7);
      this.shards.push(sh);
      this.group.add(sh);
    }
    this.shardGeo = shardGeo;
    this.orbitA = 0;
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
    this.radius = 2.4; this.height = 7; this.size = 3;
    // signature: lightning closes the circuit between neighbouring pylons
    this.sig = { name: 'SOUL CIRCUIT', cd: 17 };
    this.sigT = 8;
    this.finish();
  }
  trySignature() {
    if (this.sigT > 0 || this.pylons.filter((q) => q.alive).length < 2) return false;
    const first = this.sigUses === 0;
    this.sigUses++;
    this.sigT = 17 * this.cdMul;
    const over = this.phase >= 3;
    this.game.hud.toast(over ? 'OVERDRIVE · SOUL CIRCUIT' : 'SOUL CIRCUIT', '#6aff5a', !(first || over));
    if (first) this.game.audio.play('alert', null, 0.5);
    if (this.game.emit) this.game.emit('bossSignature', { name: 'SOUL CIRCUIT', actor: this.type });
    this.game.bosses.field.push(soulCircuit(this, over ? 6 : 4.5));
    this.game.audio.play('zap', this.pos, 1);
    return true;
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
    if (this.sharedThink(dt)) { this.pushPlayer(2.4); return; }
    switch (this.state) {
      case 'idle':
        if (this.stateT <= 0) {
          this.attackCount++;
          const r = Math.random();
          this.trySignature();
          // phase III (NG+): the core blooms into petals of current
          if (this.phase >= 3 && this.attackCount % 3 === 0 && this.runModule('pattern', { shape: 'flower', n: 26, bursts: 4, speed: 9, dmg: 9, petals: 6 }, 'BLOOM')) break;
          if (r < 0.45) { this.state = 'spiral'; this.stateT = 3.2; this.spiralT = 0; }
          else if (r < 0.75) { this.state = 'pulseWind'; this.stateT = 0.9; g.audio.play('windup', this.pos, 1); }
          else { this.state = 'volley'; this.stateT = 0.4; this.volleys = 4; }
        }
        break;
      case 'spiral':
        this.spiralT -= dt;
        if (this.spiralT <= 0) {
          this.spiralT = (this.phase >= 2 ? 0.11 : 0.15) / sp;
          const arms = this.phase >= 2 ? 4 : 3;
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
    // phase 2+: rotating floor spokes (jump them)
    if (this.phase >= 2) {
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
  // The core rests on the floor until it boots, then floats up; its spin and the shard ring
  // speed up while it fires, it swells before a pulse and recoils with every mortar.
  animate(dt = 0.016) {
    const t = this.game.time, st = this.state;
    const P = this.pose || (this.pose = { spin: 0.6, swell: 0, flare: 0, cy: 0 });
    const roar = bodyBeat(this, dt);
    const boot = smooth(clamp((this.boot - 0.5) / 0.45, 0, 1));
    const work = st === 'spiral' ? 3.5 : st === 'pulseWind' ? 2.2 : st === 'volley' ? 1.6 : st === 'module' ? 2 : 0.6;
    P.spin = ez(P.spin, work * (0.3 + 0.7 * boot), 3, dt);
    P.swell = ez(P.swell, st === 'pulseWind' ? 0.25 : 0, 6, dt);
    P.flare = ez(P.flare, roar + (this.exposedT > 0 ? 0.4 : 0), 6, dt);
    // mortar recoil: the volley timer resets per shot
    const kick = st === 'volley' ? Math.max(0, this.stateT - 0.35) * 2.5 : 0;
    P.cy = this.coreY - (1 - boot) * 3.4 + Math.sin(t * 1.3) * 0.15 + kick * 0.4;
    this.core.position.y = P.cy;
    this.coreGlow.position.y = P.cy;
    this.shieldMesh.position.y = P.cy;
    this.core.rotation.y += P.spin * dt; this.core.rotation.x = Math.sin(t * 0.5) * 0.3;
    this.core.scale.setScalar(1 + P.swell + roar * 0.12 - kick * 0.1);
    this.coreGlow.rotation.y = -t * 1.5;
    this.orbitA += dt * (0.5 + P.spin * 0.8);
    const n = this.shards.length, rad = 3.2 + P.flare * 2.2 + P.swell * 2;
    for (let i = 0; i < n; i++) {
      const sh = this.shards[i], a = this.orbitA + i / n * Math.PI * 2;
      sh.position.set(Math.cos(a) * rad, P.cy + Math.sin(a * 2 + t) * 0.6 - (1 - boot) * 0.6, Math.sin(a) * rad);
      sh.rotation.set(t * 2 + i, a, 0.4);
    }
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
    this.shardGeo.dispose();
  }
  onDeathTick(k) {
    // the core loses lift and drops; the shard ring spins down and falls
    const e = smooth(Math.min(1, k * 1.3)), P = this.pose;
    const cy = (P ? P.cy : this.coreY) * (1 - e) + 1.6 * e;
    this.core.position.y = cy; this.coreGlow.position.y = cy; this.shieldMesh.visible = false;
    this.core.rotation.z = e * 0.6;
    this.coreGlow.scale.setScalar(Math.random() < 0.3 + k * 0.5 ? 0.3 : 1);
    this.orbitA += 0.016 * 3 * (1 - e);
    const n = this.shards.length, rad = 3.2 + e * 1.5;
    for (let i = 0; i < n; i++) {
      const sh = this.shards[i], a = this.orbitA + i / n * Math.PI * 2;
      sh.position.set(Math.cos(a) * rad, cy * (1 - e) + 0.4 * e, Math.sin(a) * rad);
      sh.rotation.z = 0.4 + e * 1.1;
    }
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
    this.radius = 1.2; this.height = 4.5; this.size = 1.8;
    // signature: it steps through space behind you and reaps, three times
    this.sig = { name: 'REAPING STEP', id: 'blinkstrike', p: { n: 3, radius: 3.6, dmg: 24, wind: 0.62 }, over: { n: 5, wind: 0.52 }, cd: 14 };
    this.sigT = 8;
    this.finish();
  }
  hitboxes() {
    const p = this.pos, s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const hot = this.state === 'overheat' || this.state === 'stuck' || this.state === 'modstun';
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
    const sp = this.speedMul * (this.phase >= 2 ? 1.2 : 1);
    if (this.sharedThink(dt)) { this.pushPlayer(1.7); this.clampArena(1.8); return; }
    switch (this.state) {
      case 'idle': {
        this.face(p.x, p.z, dt, 6);
        if (d > 3) moveBody(this.body, dx / d * 6.5 * sp * dt, 0, dz / d * 6.5 * sp * dt, g.level.colliders);
        this.stride = (this.stride || 0) + dt * 8;
        if (this.stateT <= 0) {
          if (this.trySignature()) break;
          // phase III (NG+): harvest lines split the floor in eight directions
          if (this.phase >= 3 && this.combo === 2 && this.runModule('fissure', { mode: 'star', n: 8, speed: 17, dmg: 20 }, 'HARVEST LINES')) { this.combo++; break; }
          this.combo++;
          if (this.combo > 3) { this.combo = 0; this.state = 'overheat'; this.stateT = 2.6; g.hud.toast('OVERHEATED - SHOOT THE CORE', '#ff3df0'); g.audio.play('sizzle', this.pos, 1); break; }
          if (d < 5) { this.state = 'sweepWind'; this.stateT = 0.65 * this.cdMul; g.fx.telegraphDisc(this.pos.x, 0, this.pos.z, 4.8, 0xff3df0, 0.65 * this.cdMul); g.audio.play('windup', this.pos, 1); }
          else if (d > 14 || Math.random() < 0.35) { this.state = 'throwWind'; this.stateT = 0.5 * this.cdMul; }
          else { this.state = 'lungeWind'; this.stateT = 0.55 * this.cdMul; this.lunges = this.phase >= 2 ? 2 : 1; g.audio.play('windup', this.pos, 1); }
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
          const n = this.phase >= 2 ? 2 : 1;
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
  // A mantis: it stalks with a low, swaying gait and blades held up; folds into a crouch with
  // the blades cocked overhead before a lunge and strikes down through it; spreads both blades
  // flat for the spin; cocks one back to throw; buckles and hangs its arms while it overheats.
  animate(dt = 0.016) {
    const g = this.game, t = g.time, st = this.state, an = this.anim;
    const P = this.pose || (this.pose = { tx: 0, ty: 0, crouch: 0, a0x: -0.6, a1x: -0.6, a0z: 0, a1z: 0, leg: 0, px: this.pos.x, pz: this.pos.z });
    const roar = bodyBeat(this, dt);
    const moved = Math.hypot(this.pos.x - P.px, this.pos.z - P.pz) / Math.max(dt, 1e-4);
    P.px = this.pos.x; P.pz = this.pos.z;
    const s = this.stride || 0;
    const walking = st === 'idle' && moved > 1;
    let tx = 0.15, ty = 0, crouch = 0, a0x = -0.7 + Math.sin(s + 1) * 0.15, a1x = -0.7 + Math.sin(s) * 0.15, a0z = 0, a1z = 0, leg = walking ? 0.55 : 0.08;
    let rate = 12;
    if (st === 'lungeWind') { tx = 0.55; crouch = 0.35; a0x = a1x = -2.4; leg = 0; }
    else if (st === 'lunge') { tx = 0.75; crouch = 0.15; a0x = a1x = 0.6; leg = 0.9; rate = 30; }
    else if (st === 'sweepWind' || st === 'sweep') { tx = 0.1; crouch = 0.25; a0x = a1x = -1.5; a0z = 1.3; a1z = -1.3; leg = 0; rate = 20; }
    else if (st === 'throwWind') { tx = 0.05; ty = -0.45; a1x = -2.7; a0x = -0.4; leg = 0; }
    else if (st === 'stuck') { tx = 0.65; crouch = 0.1; a0x = a1x = 0.9; leg = 0; }
    else if (st === 'overheat' || st === 'modstun') { tx = -0.25; crouch = 0.4; a0x = a1x = 0.3; a0z = -0.2; a1z = 0.2; leg = 0; }
    else if (st === 'recover') { tx = 0.3; crouch = 0.1; a0x = a1x = -0.2; leg = 0; }
    else if (st === 'module') { if (an.wind) { tx = 0.45; crouch = 0.3; a0x = a1x = -2.3; } else if (an.act) { tx = 0.6; a0x = a1x = 0.5; rate = 30; } }
    if (this.boot < 1) { const d = 1 - smooth(clamp((this.boot - 0.5) / 0.45, 0, 1)); tx += 0.85 * d; crouch += 0.5 * d; a0x += 0.9 * d; a1x += 0.9 * d; }
    tx -= roar * 0.6; a0x -= roar * 1.8; a1x -= roar * 1.8; a0z += roar * 0.6; a1z -= roar * 0.6;
    P.tx = ez(P.tx, tx, rate, dt); P.ty = ez(P.ty, ty, rate, dt); P.crouch = ez(P.crouch, crouch, rate, dt);
    P.a0x = ez(P.a0x, a0x, rate, dt); P.a1x = ez(P.a1x, a1x, rate, dt); P.a0z = ez(P.a0z, a0z, rate, dt); P.a1z = ez(P.a1z, a1z, rate, dt);
    P.leg = ez(P.leg, leg, 8, dt);
    const shiver = st === 'stuck' || st === 'overheat' ? Math.sin(t * 45) * 0.04 : roar * Math.sin(t * 36) * 0.05;
    this.torso.rotation.set(P.tx + shiver, P.ty + (walking ? Math.sin(s) * 0.12 : 0), walking ? Math.sin(s) * 0.05 : 0);
    // crouching drops the hips; the straight legs splay fore and aft so the feet stay planted
    const hip = 1.6 - P.crouch * 0.6, stance = Math.acos(clamp(hip / 1.6, 0, 1));
    this.torso.position.y = hip + (walking ? Math.abs(Math.cos(s)) * 0.06 : 0);
    this.legs.forEach((l, i) => { l.rotation.x = (i ? stance : -stance) + Math.sin(s + i * Math.PI) * P.leg; l.position.y = hip; });
    this.arms[0].rotation.set(P.a0x, 0, P.a0z); this.arms[1].rotation.set(P.a1x, 0, P.a1z);
    if (st === 'modstun') this.coreMesh.scale.setScalar(1.3 + Math.sin(t * 14) * 0.3);
  }
  onDeathTick(k) {
    // the legs fold and the blades drop
    const e = smooth(Math.min(1, k * 1.5));
    const hip = 1.6 - 0.8 * e, stance = Math.acos(hip / 1.6);
    this.legs.forEach((l, i) => { l.rotation.x = i ? stance : -stance; l.position.y = hip; });
    this.torso.position.y = hip;
    this.torso.rotation.x = 0.15 + 0.6 * e;
    this.arms.forEach((a, i) => a.rotation.set(0.9 * e, 0, (i ? -0.4 : 0.4) * e));
    this.coreMesh.scale.setScalar(Math.random() < 0.3 + k * 0.5 ? 0.3 : 1);
  }
}

// Crucible signature: arcs close between neighbouring live pylons. Breaking a pylon opens
// the two links it anchors.
function soulCircuit(boss, dur) {
  const g = boss.game;
  const warn = 1.3;
  let t = 0, cd = 0;
  const seg = (F, ax, ay, az, bx, by, bz, live) => {
    if (!live) { F.beam(ax, ay, az, bx, by, bz, 0.06, 0x6aff5a, 0.35 + 0.3 * Math.sin(t * 40)); return; }
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= 4; i++) {
      const k = i / 4, j = i < 4 ? 0.6 : 0;
      const nx = ax + (bx - ax) * k + (Math.random() - 0.5) * j, ny = ay + (by - ay) * k + (Math.random() - 0.5) * j, nz = az + (bz - az) * k + (Math.random() - 0.5) * j;
      F.beam(px, py, pz, nx, ny, nz, 0.26, 0x6aff5a, 0.9);
      F.beam(px, py, pz, nx, ny, nz, 0.09, 0xffffff, 1);
      px = nx; py = ny; pz = nz;
    }
  };
  return {
    owner: boss,
    update(dt, F) {
      t += dt; cd -= dt;
      const live = t > warn;
      const pp = g.player.body;
      const P = boss.pylons;
      let links = 0;
      for (let i = 0; i < P.length; i++) {
        const A = P[i], B = P[(i + 1) % P.length];
        if (!A.alive || !B.alive) continue;
        links++;
        const ax = boss.pos.x + A.x, az = boss.pos.z + A.z, bx = boss.pos.x + B.x, bz = boss.pos.z + B.z;
        const y = 1.3;
        seg(F, ax, y, az, bx, y, bz, live);
        if (live && cd <= 0 && segPointDist2(ax, 0, az, bx, 0, bz, pp.pos.x, 0, pp.pos.z) < 0.55 * 0.55 && pp.pos.y < y + 0.6 && pp.pos.y + pp.h > y - 0.6) {
          cd = 0.6;
          if (g.player.damage(18 * boss.dmgMul, new THREE.Vector3(pp.pos.x, y, pp.pos.z), 'SOUL CIRCUIT', 'Lightning links neighbouring pylons. Do not cross a live link: break one of its pylons to open it.')) g.audio.play('zap', null, 0.6);
        }
      }
      if (live && Math.random() < 0.12) g.audio.play('zap', boss.pos, 0.3);
      return t > warn + dur || links === 0;
    },
  };
}

export const BESPOKE = { grindhammer: Grindhammer, vesper: Vesper, crucible: Crucible, scythewright: Scythewright };
