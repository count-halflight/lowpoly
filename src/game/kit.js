import * as THREE from 'three';
import { Enemy } from './enemies.js';
import { Boss } from './bosses.js';
import { buildChassis } from './chassis.js';
import { Brain, slideBody } from './abilities.js';
import { moveBody, clamp, angleDiff } from '../core/collide.js';
import { sharedMaterials } from '../render/materials.js';
import { psxify } from '../render/renderer.js';

// Shared behaviour for data-driven minibosses and bosses: chassis + ability brain.

function hexToNum(h) { return typeof h === 'number' ? h : parseInt(String(h).replace('#', ''), 16); }

function serpentInit(actor, chassis) {
  actor.trail = [];
  actor.segs = chassis.parts.segs;
  for (const s of actor.segs) { s.scale.setScalar(chassis.scale); actor.game.scene.add(s); }
}
function serpentUpdate(actor) {
  const t = actor.trail;
  const head = actor.pos.clone();
  if (!t.length || t[0].distanceTo(head) > 0.25) { t.unshift(head); if (t.length > 120) t.pop(); }
  const spacing = 4 * (actor.chassisScale || 1);
  actor.segs.forEach((s, i) => {
    const p = t[Math.min(t.length - 1, (i + 1) * spacing)] || head;
    const q = t[Math.min(t.length - 1, (i + 1) * spacing + 2)] || p;
    s.position.copy(p);
    s.lookAt(q);
  });
}
function serpentRemove(actor) { for (const s of actor.segs || []) actor.game.scene.remove(s); }

// ---------------------------------------------------------------------------------------
export class Miniboss extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'husk', pos, opts);
    const def = opts.def;
    this.def = def;
    this.type = 'mini';
    this.mini = true;
    this.heavy = true;
    this.name = def.name;
    this.title = def.title;
    this.color = hexToNum(def.colors[2]);
    this.colorHex = '#' + this.color.toString(16).padStart(6, '0');
    const scale = def.scale || 1.6;
    this.chassisScale = scale;
    const ch = buildChassis(def.chassis, def.colors, scale);
    this.ch = ch;
    this.group.add(ch.group);
    this.flying = !!ch.flying;
    this.size = scale;
    const weak = ch.hit.find((h) => h.weak) || ch.hit[0];
    if (this.flying) {
      this.hoverH = (ch.hover || 3) + scale * 0.4;
      this.pos.y = this.hoverH;
      this.radius = ch.radius * scale;
      this.bodyY0 = -ch.radius * scale; this.bodyY1 = ch.radius * scale;
      this.headY = weak.y * scale; this.headR = weak.r * scale;
      this.body.r = Math.min(1.2, this.radius * 0.7); this.body.h = this.radius;
    } else {
      this.radius = ch.radius * scale * 0.9;
      this.bodyY0 = 0; this.bodyY1 = ch.height * scale * 0.85;
      this.headY = weak.y * scale; this.headR = weak.r * scale;
      this.body.r = Math.min(1.3, this.radius * 0.75); this.body.h = ch.height * scale;
    }
    this.height = ch.height * scale;
    this.moveStyle = def.move || (this.flying ? 'hover' : 'chase');
    this.moveSpeed = def.speed || (this.flying ? 5 : 3.6);
    this.prefDist = def.prefDist || 12;
    this.anim = { wind: false, act: false, moving: false };
    this.brain = new Brain(this, def.abilities, def.enrage || []);
    this.phase = 1;
    this.styleValue = 120;
    this.bloodColor = [0.3, 0.3, 0.32];
    this.isEnemy = true;
    this.staggerable = false;
    this.stunT = 0;
    this.spawnT = 1.0;
    if (ch.serpent) serpentInit(this, ch);
    this.finishSetup((def.hp || 900) * (opts.miniHpMul || 1));
    this.shadow.scale.setScalar(this.radius * 1.2);
    this.attackCd = 1.2;
  }
  get groundY() { const r = this.game.level.current; return this.flying ? (r ? r.floorAt(this.pos.x, this.pos.z) : 0) : this.pos.y; }
  get dmgMulA() { return this.dmgMul; }
  centerPos() { return this.flying ? this.c.copy(this.pos) : this.c.set(this.pos.x, this.pos.y + this.bodyY1 * 0.55, this.pos.z); }
  headPos() { return this.flying ? this.h.set(this.pos.x, this.pos.y + this.headY, this.pos.z) : this.h.set(this.pos.x, this.pos.y + this.headY, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y + (this.flying ? 0 : this.headY), this.pos.z); }
  center() { return this.centerPos().clone(); }
  muzzle() {
    const m = this.ch.muzzle || [0, 1.5, 0.8];
    const s = this.chassisScale;
    const v = new THREE.Vector3(m[0] * s, m[1] * s, m[2] * s).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return v.add(this.pos);
  }
  faceTarget(dt, rate) { const p = this.game.player.body.pos; this.faceToward(p.x, p.z, dt, rate); }
  face(x, z, dt, rate) { this.faceToward(x, z, dt, rate); }
  moveVel(dt, vx, vz) {
    if (!this.flying && this.moveStyle === 'chase' && !this.canSee) {
      const p = this.game.player.body.pos;
      this.navMove(dt, p.x, p.z, Math.hypot(vx, vz));
    } else this.applySteer(dt, vx, vz);
  }
  slide(dx, dz) { return slideBody(this.body, dx, dz, this.game.level.colliders); }
  teleport(v) { this.pos.copy(v); if (this.flying) this.pos.y = Math.max(v.y, this.hoverH); this.body.vel.set(0, 0, 0); }
  stun(t) { this.stunT = t; }
  armorFactor(info) {
    if (this.shieldUp && info.source !== 'parry') { if (info.point) this.game.fx.sparksBurst(info.point, 0xffe23a, 3, 4, 0.2, 0.07); return 0.05; }
    let k = 1;
    if (this.stunT > 0 && info.part === 'head') k *= 1.5;
    if (this.ch.frontShield && info.dir && !(info.source === 'explosion' || info.energy || info.source === 'parry')) {
      const dot = info.dir.x * Math.sin(this.yaw) + info.dir.z * Math.cos(this.yaw);
      if (dot < -0.45 && info.part !== 'head') k *= 0.2;
    }
    return k;
  }
  onHit(info, amount) {
    super.onHit(info, amount);
    if (info.source === 'parry' && this.shieldUp) {
      this.shieldUp = false; this.stun(2.2);
      this.game.hud.toast('SHIELD SHATTERED', '#ffe23a');
      this.game.audio.play('shieldBreak', this.pos, 1);
      this.game.style.add('SHIELD BREAKER', 40);
    }
    if (this.phase === 1 && this.hp > 0 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.speedMul *= 1.18;
      this.cdMul = 0.85;
      this.game.hud.toast(this.name + ' IS ENRAGED', this.colorHex);
      this.game.audio.play('bossPhase', this.pos, 0.7);
      this.game.fx.sparksBurst(this.centerPos().clone(), this.color, 24, 10, 0.5);
    }
  }
  think(dt) {
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.stop(dt);
      if (Math.random() < 0.3) this.game.fx.sparks.spawn(this.pos.x, this.pos.y + this.headY, this.pos.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1, 0.9, 0.3, 1, 0.1, 0.4, 6, 0);
      return;
    }
    this.brain.update(dt);
    if (this.brain.cur) this.stop(dt);
  }
  physics(dt) {
    if (!this.flying) { super.physics(dt); return; }
    const room = this.game.level.current;
    const floor = room ? room.floorAt(this.pos.x, this.pos.z) : 0;
    const ty = floor + this.hoverH + Math.sin(this.game.time * 1.7) * 0.3;
    this.body.vel.y += ((ty - this.pos.y) * 2 - this.body.vel.y) * Math.min(1, dt * 4);
    moveBody(this.body, this.body.vel.x * dt, this.body.vel.y * dt, this.body.vel.z * dt, this.game.level.colliders);
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 1)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 1.5, room.origin.x + room.W / 2 - 1.5);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 1.5, room.origin.z + room.D / 2 - 1.5);
    }
    if (room) this.pos.y = Math.min(this.pos.y, room.spec.H - this.radius - 0.3);
  }
  groundYForShadow() { return this.groundY; }
  syncVisual(dt) {
    super.syncVisual(dt);
    if (this.flying) this.shadow.position.y = this.groundY + 0.03;
    if (this.spin) this.ch.group.rotation.y = this.spin;
    else this.ch.group.rotation.y = 0;
    if (this.segs) serpentUpdate(this);
  }
  animate() { this.ch.animate(this.game.time, { ...this.anim, moving: this.anim.moving || Math.hypot(this.body.vel.x, this.body.vel.z) > 0.5 }); }
  die(info) {
    const g = this.game;
    const c = this.centerPos().clone();
    super.die({ ...info, knock: 8 });
    g.fx.explosion(c, 3 + this.size, this.color);
    g.audio.play('explosion', c, 1);
    g.addShake(0.4);
    g.hitstop(0.08);
    g.style.add('MINIBOSS DOWN', 150);
    g.hud.banner(this.name, 'NEUTRALIZED', this.colorHex, 1.8);
    for (let i = 0; i < 3; i++) g.pickups.spawn('hp', c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)));
    const need = g.weapons.neediest();
    if (need) g.pickups.spawn('ammo', c.clone(), { weapon: need });
    g.emit('minibossKilled', this.def.id);
    if (this.segs) serpentRemove(this);
  }
  remove() { super.remove(); if (this.segs) serpentRemove(this); }
}

// ---------------------------------------------------------------------------------------
export class KitBoss extends Boss {
  constructor(game, room, def, tier, opts = {}) {
    super(game, room, def.id, tier, { name: def.name, title: def.title, color: def.uiColor || def.colors[2] });
    this.def = def;
    this.maxPhase = opts.ngPlus || tier >= 2 ? 3 : 2;
    const scale = def.scale || 2.4;
    this.chassisScale = scale;
    this.size = scale;
    const ch = buildChassis(def.chassis, def.colors, scale);
    this.ch = ch;
    this.group.add(ch.group);
    this.flying = !!ch.flying;
    this.radius = ch.radius * scale;
    this.height = ch.height * scale;
    this.color = hexToNum(def.colors[2]);
    this.setHp(def.hp || 2200);
    this.hpScale = this.hpMul;
    this.moveStyle = def.move || (this.flying ? 'hover' : 'chase');
    this.moveSpeed = def.speed || (this.flying ? 6 : 3.4);
    this.prefDist = def.prefDist || 14;
    this.anim = { wind: false, act: false, moving: false };
    this.brain = new Brain(this, def.abilities, def.phase2, def.phase3 || def.phase2);
    this.dmgMulBase = this.dmgMul;
    this.isBoss = true;
    this.stunT = 0;
    this.hoverH = (ch.hover || 3) + scale * 0.5;
    this.pos.set(room.wx(0), this.flying ? this.hoverH : 0, room.wz(-room.D / 2 + 10));
    this.body = { pos: this.pos, vel: new THREE.Vector3(), r: Math.min(2.2, this.radius * 0.8), h: Math.max(2, this.height), grounded: true, step: 0.45 };
    this.gimmick = def.gimmick || null;
    this.parts = [];
    this.linkedT = 0;
    this.ventT = 12;
    this.heat = 0;
    if (ch.serpent) serpentInit(this, ch);
    this.setupGimmick();
    this.finish();
  }
  get groundY() { return this.flying ? (this.room.floorAt(this.pos.x, this.pos.z)) : this.pos.y; }
  center() { return this.flying ? this.pos.clone() : this.pos.clone().setY(this.pos.y + this.height * 0.5); }
  muzzle() {
    const m = this.ch.muzzle || [0, 1.5, 0.8];
    const s = this.chassisScale;
    return new THREE.Vector3(m[0] * s, m[1] * s, m[2] * s).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.pos);
  }
  faceTarget(dt, rate) { const p = this.game.player.body.pos; this.face(p.x, p.z, dt, rate); }
  moveVel(dt, vx, vz) {
    if (this.flying) { this.pos.x += vx * dt; this.pos.z += vz * dt; this.clampArena(3); return; }
    slideBody(this.body, vx * dt, vz * dt, this.game.level.colliders);
    this.clampArena(this.radius * 0.8);
  }
  slide(dx, dz) { const b = slideBody(this.body, dx, dz, this.game.level.colliders); this.clampArena(this.radius * 0.8); return b; }
  teleport(v) { this.pos.copy(v); if (this.flying) this.pos.y = this.hoverH; }
  stun(t) { this.stunT = t; this.game.hud.toast(this.name + ' IS STAGGERED - HIT THE WEAK POINT', '#ffd060', true); }
  onWallImpact() {
    for (const br of this.room.breakables) {
      if (br.broken) continue;
      if (Math.hypot(this.room.wx(br.x) - this.pos.x, this.room.wz(br.z) - this.pos.z) < this.radius + 3) { this.room.breakPillar(br); this.brokePillar = true; }
    }
  }

  // ---------------------------------------------------------------- gimmicks
  setupGimmick() {
    const g = this.game, gm = this.gimmick;
    if (!gm) return;
    const room = this.room;
    if (gm === 'pylons') {
      this.pylons = [];
      const glow = new THREE.MeshBasicMaterial({ color: this.color });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = room.wx(Math.cos(a) * 12), z = room.wz(Math.sin(a) * 12);
        const grp = new THREE.Group();
        grp.position.set(x, 0, z);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.4), this.ch.mats.dark); base.position.y = 1.6;
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glow); crystal.position.y = 4;
        grp.add(base, crystal);
        g.scene.add(grp);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }));
        g.scene.add(beam);
        this.pylons.push({ grp, crystal, beam, x, z, hp: 0, max: 220 * this.hpMul, alive: true, id: i });
      }
      for (const p of this.pylons) p.hp = p.max;
      this.exposedT = 0;
    } else if (gm === 'armor') {
      this.plates = [];
      const s = this.chassisScale;
      const offs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [ox, oz] of offs) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), sharedMaterials().door);
        mesh.position.set(ox * this.ch.radius * 0.95, this.flying ? 0 : this.ch.height * 0.55, oz * this.ch.radius * 0.95);
        this.ch.group.add(mesh);
        this.plates.push({ mesh, ox, oz, hp: this.maxHp * 0.07, alive: true, s });
      }
    } else if (gm === 'parry') {
      this.shieldUp = true;
    } else if (gm === 'hazard') {
      room.addDynamicHazards('electric', 4);
    } else if (gm === 'darkness') {
      g.level.setDarkness(true);
    } else if (gm === 'rising') {
      room.addDynamicHazards('molten', 2);
    }
  }
  get shielded() {
    if (this.gimmick === 'pylons') return this.pylons.some((p) => p.alive);
    return !!this.shieldUp;
  }
  hitboxes() {
    const s = this.chassisScale, c = Math.cos(this.yaw), sn = Math.sin(this.yaw), p = this.pos;
    const shielded = this.shielded;
    const stunned = this.stunT > 0 || this.vented;
    this.hbs = this.ch.hit.map((h) => {
      const lx = h.x * s, lz = h.z * s;
      let mul = h.mul || 1;
      if (this.gimmick === 'weakpoint') mul = h.weak ? (stunned ? 3 : 1) : 0.3;
      else if (h.weak && stunned) mul *= 1.6;
      if (this.gimmick === 'armor' && this.plates.some((q) => q.alive)) mul *= 0.3;
      return { x: p.x + lx * c + lz * sn, y: (this.flying ? p.y : p.y) + h.y * s, z: p.z - lx * sn + lz * c, r: h.r * s, mul, weak: !!h.weak, shielded };
    });
    if (this.segs) for (const sg of this.segs) this.hbs.push({ x: sg.position.x, y: sg.position.y, z: sg.position.z, r: 0.55 * s, mul: 0.6, shielded });
    if (this.pylons) for (const py of this.pylons) if (py.alive) this.hbs.push({ x: py.x, y: 3.9, z: py.z, r: 1.0, mul: 1, pylon: py });
    if (this.plates) for (const pl of this.plates) if (pl.alive) {
      const lx = pl.ox * this.ch.radius * 0.95 * s, lz = pl.oz * this.ch.radius * 0.95 * s;
      this.hbs.push({ x: p.x + lx * c + lz * sn, y: p.y + (this.flying ? 0 : this.ch.height * 0.55 * s), z: p.z - lx * sn + lz * c, r: 0.45 * s, mul: 1, plate: pl });
    }
    return this.hbs;
  }
  applyDamage(amount, info, part) {
    if (!this.vulnerable) return 0;
    if (info && info.source === 'parry' && this.shieldUp) {
      this.shieldUp = false;
      this.shieldDownT = 6;
      this.stun(2.5);
      this.game.hud.toast('SHIELD SHATTERED', '#ffe23a');
      this.game.audio.play('shieldBreak', this.pos, 1);
      this.game.style.add('SHIELD BREAKER', 60);
    }
    if (part.pylon) {
      const py = part.pylon;
      py.hp -= amount; this.flashT = 0.04;
      if (py.hp <= 0) {
        py.alive = false; py.grp.visible = false; py.beam.visible = false;
        const wp = new THREE.Vector3(py.x, 3, py.z);
        this.game.fx.explosion(wp, 3.5, this.color);
        this.game.audio.play('explosion', wp, 1);
        this.game.style.add('PYLON DOWN', 50);
        if (!this.shielded) { this.exposedT = 9; this.game.hud.toast('CORE EXPOSED', '#ffd060'); }
      }
      return amount;
    }
    if (part.plate) {
      const pl = part.plate;
      pl.hp -= amount; this.flashT = 0.04;
      if (pl.hp <= 0) {
        pl.alive = false; this.ch.group.remove(pl.mesh);
        const wp = new THREE.Vector3(part.x, part.y, part.z);
        this.game.fx.chunks(wp, 0xd0b020, 10, 8, 0.25);
        this.game.audio.play('shieldBreak', wp, 1);
        this.game.style.add('ARMOR STRIPPED', 40);
        if (!this.plates.some((q) => q.alive)) this.game.hud.toast(this.name + ' ARMOR GONE', '#ffd060');
      }
      return amount;
    }
    if (this.gimmick === 'adds' && this.game.enemies.aliveCount > 0) amount *= 0.5;
    return super.applyDamage(amount, info, part);
  }
  enterPhase2() {
    super.enterPhase2();
    this.speedMul *= 1.12;
    if (this.gimmick === 'rising') this.room.addDynamicHazards('molten', 2);
    this.phaseName = this.def.phaseNames ? this.def.phaseNames[0] : 'PHASE II';
  }
  enterPhase3() {
    const g = this.game;
    this.phase = 3;
    this.invuln = 1.4;
    this.state = 'phase'; this.stateT = 1.4;
    this.speedMul *= 1.12;
    this.cdMul = Math.max(0.5, this.cdMul * 0.85);
    this.phaseName = this.def.phaseNames ? this.def.phaseNames[1] || 'PHASE III' : 'PHASE III';
    g.audio.play('bossPhase', this.pos, 1);
    g.flash(0xff3050, 0.4);
    g.addShake(0.7);
    g.hud.banner('PHASE III', this.info.name + ' OVERLOADS', this.info.color);
    if (this.gimmick === 'rising') this.room.addDynamicHazards('molten', 2);
  }
  think(dt) {
    const g = this.game;
    // gimmick upkeep
    if (this.pylons) {
      if (this.exposedT > 0) { this.exposedT -= dt; if (this.exposedT <= 0) { for (const p of this.pylons) { p.alive = true; p.hp = p.max * 0.6; p.grp.visible = true; p.beam.visible = true; } g.hud.toast('PYLONS REBOOTING', '#ffd060', true); } }
      const c = this.center();
      for (const p of this.pylons) {
        p.crystal.rotation.y += dt * 2;
        if (!p.alive) continue;
        const a = new THREE.Vector3(p.x, 4, p.z);
        p.beam.position.copy(a).lerp(c, 0.5); p.beam.lookAt(c); p.beam.scale.set(1, 1, a.distanceTo(c));
      }
    }
    if (this.gimmick === 'parry' && !this.shieldUp) { this.shieldDownT -= dt; if (this.shieldDownT <= 0) { this.shieldUp = true; g.hud.toast(this.name + ' RESHIELDS', '#ffe23a', true); } }
    if (this.gimmick === 'parry' && this.shieldUp) {
      this.parryShotT = (this.parryShotT || 3) - dt;
      if (this.parryShotT <= 0) { this.parryShotT = 3.5; const from = this.muzzle(); const to = g.camera.position.clone(); g.projectiles.spawnEnemy(from, to.sub(from).normalize().multiplyScalar(9), 12 * this.dmgMul, { color: 0xffe23a, radius: 0.34, size: 0.34, homing: 1.2, life: 7, cause: this.info.name + ' SEEKER', tip: 'Its shield only breaks when you parry its yellow seekers back into it.' }); }
    }
    if (this.gimmick === 'adds') { this.linkedT -= dt; if (this.linkedT <= 0 && g.enemies.aliveCount < 3) { this.linkedT = 13; g.director.spawnSummons(this.def.adds || ['husk', 'ripper', 'wisp'], 3, this.pos); g.hud.toast('LINKED SERVANTS ARRIVE - BOSS TAKES HALF DAMAGE WHILE THEY LIVE', '#ff8a3a', true); } }
    if (this.gimmick === 'overheat' || this.gimmick === 'weakpoint') {
      this.ventT -= dt;
      this.heat = Math.min(1, this.heat + dt / 14);
      this.speedMulHeat = 1 + this.heat * 0.35;
      if (this.ventT <= 0 && !this.vented && !this.brain.cur) { this.vented = 3; g.hud.toast(this.info.name + ' VENTING - WEAK POINT EXPOSED', '#ffd060', true); g.audio.play('sizzle', this.pos, 1); }
      if (this.vented) { this.vented -= dt; this.heat = 0; if (Math.random() < 0.4) g.fx.dust.spawn(this.pos.x, this.pos.y + this.height, this.pos.z, (Math.random() - 0.5), 2, (Math.random() - 0.5), 0.5, 0.5, 0.55, 0.6, 0.5, 0.8, -0.5, 1); if (this.vented <= 0) { this.vented = 0; this.ventT = 12; } return; }
    }
    if (this.stunT > 0) { this.stunT -= dt; return; }
    this.brain.update(dt);
    if (!this.flying) this.pushPlayer(this.radius + 0.6);
  }
  update(dt) {
    super.update(dt);
    if (this.segs) serpentUpdate(this);
    if (this.flying) {
      const floor = this.room.floorAt(this.pos.x, this.pos.z);
      const ty = floor + this.hoverH + Math.sin(this.game.time * 1.4) * 0.4;
      this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 3);
    }
  }
  sync() {
    super.sync();
    if (this.ch) this.ch.group.rotation.y = this.spin || 0;
  }
  animate() { if (this.ch) this.ch.animate(this.game.time, { ...this.anim }); }
  remove() {
    super.remove();
    if (this.segs) serpentRemove(this);
    if (this.pylons) for (const p of this.pylons) { this.game.scene.remove(p.grp, p.beam); }
    if (this.gimmick === 'darkness') this.game.level.setDarkness(false);
  }
}
