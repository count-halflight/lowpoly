import * as THREE from 'three';
import { moveBody, clamp, angleDiff, segPointDist2, bodyOverlapsAny } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { sharedMaterials } from '../render/materials.js';

// ---------------------------------------------------------------------------------------
// Shared assets
// ---------------------------------------------------------------------------------------
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
const matCache = new Map();
function bodyMat(color) {
  const k = 'b' + color;
  if (!matCache.has(k)) matCache.set(k, psxify(new THREE.MeshLambertMaterial({ map: getTexture('skin'), color, emissive: new THREE.Color(color).multiplyScalar(0.22) })));
  return matCache.get(k);
}
function glowMat(color) {
  const k = 'g' + color;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color }));
  return matCache.get(k);
}
let shadowGeo = null, ringGeo = null, shellGeo = null, wispGeo = null;

export const ENEMY_INFO = {
  husk: { name: 'HUSK', desc: 'Basic ranged trooper' },
  ripper: { name: 'RIPPER', desc: 'Fast melee lunger' },
  gunner: { name: 'GUNNER', desc: 'Telegraphed burst fire' },
  lancer: { name: 'LANCER', desc: 'Laser-sighted sniper' },
  bulwark: { name: 'BULWARK', desc: 'Front-shielded heavy' },
  signaller: { name: 'SIGNALLER', desc: 'Calls in backup' },
  wisp: { name: 'WISP', desc: 'Kamikaze drone' },
};

export const ELITE_MODS = {
  shielded: { name: 'SHIELDED', color: 0x40e0ff },
  frenzied: { name: 'FRENZIED', color: 0xff3040 },
  volatile: { name: 'VOLATILE', color: 0xff9020 },
  blinking: { name: 'BLINKING', color: 0xc060ff },
};

function part(w, h, d, mat, px, py, pz, ox = 0, oy = 0, oz = 0) {
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
  mesh.position.set(ox, oy, oz);
  mesh.userData.mat = mat;
  pivot.add(mesh);
  return pivot;
}

// ---------------------------------------------------------------------------------------
// Base enemy
// ---------------------------------------------------------------------------------------
export class Enemy {
  constructor(game, type, pos, opts) {
    this.game = game;
    this.type = type;
    this.body = { pos: pos.clone(), vel: new THREE.Vector3(), r: 0.4, h: 1.9, grounded: false, step: 0.45 };
    this.pos = this.body.pos;
    this.yaw = Math.atan2(game.player.body.pos.x - pos.x, game.player.body.pos.z - pos.z);
    this.alive = true;
    this.targetable = false;
    this.spawnT = 0.9;
    this.state = 'idle'; this.stateT = 0;
    this.attackCd = 1 + Math.random() * 1.2;
    this.stagger = 0;
    this.flashT = 0;
    this.airTime = 0;
    this.radius = 0.42; this.headY = 1.68; this.headR = 0.24; this.bodyY0 = 0; this.bodyY1 = 1.5;
    this.styleValue = 20;
    this.bloodColor = [0.7, 0.06, 0.08];
    this.shield = 0; this.shieldMax = 0; this.shieldDelay = 0;
    this.elite = opts.elite || null;
    this.perch = opts.perch || null;
    this.hpMul = opts.hpMul || 1;
    this.dmgMul = opts.dmgMul || 1;
    this.aggr = opts.aggr || 1; // cooldown multiplier (<1 = more aggressive)
    this.speedMul = 1;
    this.windMul = 1;
    this.canSee = false; this.seeT = Math.random() * 0.2;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.walk = 0;
    this.stuckT = 0;
    this.blinkCd = 3;
    this.recentDmg = 0;
    this.v = new THREE.Vector3(); this.c = new THREE.Vector3(); this.h = new THREE.Vector3(); this.wp = { x: 0, z: 0 };
    this.group = new THREE.Group();
    this.parts = {};
    this.meshes = [];
  }

  finishSetup(maxHp) {
    this.maxHp = maxHp * this.hpMul * (this.elite ? 1.6 : 1);
    this.hp = this.maxHp;
    if (this.elite === 'shielded') { this.shieldMax = this.maxHp * 0.5; this.shield = this.shieldMax; }
    if (this.elite === 'frenzied') { this.speedMul = 1.35; this.aggr *= 0.65; this.windMul = 0.75; }
    this.group.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    if (!shadowGeo) { shadowGeo = new THREE.CircleGeometry(1, 10); shadowGeo.rotateX(-Math.PI / 2); }
    this.shadow = new THREE.Mesh(shadowGeo, sharedMaterials().shadow);
    this.shadow.scale.setScalar(this.radius * 1.3);
    this.game.scene.add(this.shadow);
    if (this.elite) {
      if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.8, 1, 16); ringGeo.rotateX(-Math.PI / 2); }
      const col = ELITE_MODS[this.elite].color;
      this.eliteRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.eliteRing.scale.setScalar(this.radius * 2.2);
      this.game.scene.add(this.eliteRing);
      this.group.scale.setScalar(1.12);
      this.headY *= 1.12; this.bodyY1 *= 1.12; this.radius *= 1.1;
      if (this.elite === 'shielded') {
        if (!shellGeo) shellGeo = new THREE.IcosahedronGeometry(1, 1);
        this.shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.game.scene.add(this.shell);
      }
    }
    this.group.visible = false;
    this.game.scene.add(this.group);
    this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, this.elite ? ELITE_MODS[this.elite].color : 0xff3050, this.spawnT, this.bodyY1 + 1.5);
    this.game.audio.play('spawn', this.pos, 0.6);
  }

  centerPos() { return this.c.set(this.pos.x, this.pos.y + (this.bodyY0 + this.bodyY1) * 0.5, this.pos.z); }
  headPos() { return this.h.set(this.pos.x, this.pos.y + this.headY, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y + this.headY, this.pos.z); }

  playerDist() {
    const p = this.game.player.body.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  faceToward(x, z, dt, rate = 8) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw += angleDiff(this.yaw, target) * Math.min(1, rate * dt);
  }

  // Steering toward a point using the room flow field when needed.
  navMove(dt, tx, tz, speed, direct = false) {
    const room = this.game.level.current;
    let gx = tx, gz = tz;
    if (this.perch) {
      gx = clamp(tx, this.perch.x0, this.perch.x1);
      gz = clamp(tz, this.perch.z0, this.perch.z1);
    } else if (!direct && room && room.nav) {
      const s = room.nav.step(this.pos.x, this.pos.z, this.wp);
      if (s) { gx = s.x; gz = s.z; }
    }
    let dx = gx - this.pos.x, dz = gz - this.pos.z;
    const l = Math.hypot(dx, dz);
    let vx = 0, vz = 0;
    if (l > 0.15) { vx = dx / l * speed; vz = dz / l * speed; }
    this.applySteer(dt, vx, vz);
  }

  applySteer(dt, vx, vz) {
    // separation
    for (const o of this.game.enemies.list) {
      if (o === this || !o.alive || o.flying) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + o.radius + 0.3);
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        vx += dx / d * 2.5; vz += dz / d * 2.5;
      }
    }
    const k = 1 - Math.exp(-10 * dt);
    this.body.vel.x += (vx - this.body.vel.x) * k;
    this.body.vel.z += (vz - this.body.vel.z) * k;
  }

  stop(dt) { this.applySteer(dt, 0, 0); }

  physics(dt) {
    const b = this.body;
    if (!this.flying) b.vel.y -= 25 * dt;
    const before = this.pos.clone();
    moveBody(b, b.vel.x * dt, b.vel.y * dt, b.vel.z * dt, this.game.level.colliders);
    if (!this.flying) this.game.level.applyEnemyProps(this, dt);
    if (this.perch) {
      this.pos.x = clamp(this.pos.x, this.perch.wx0, this.perch.wx1);
      this.pos.z = clamp(this.pos.z, this.perch.wz0, this.perch.wz1);
    }
    if (b.grounded) this.airTime = 0; else this.airTime += dt;
    // keep inside current room
    const room = this.game.level.current;
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 0.3)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 0.6, room.origin.x + room.W / 2 - 0.6);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 0.6, room.origin.z + room.D / 2 - 0.6);
    }
    if (this.pos.y < -10 && room) {
      const k = room.nav.nearestFree(room.origin.x, room.origin.z, 8);
      if (k >= 0) { room.nav.center(k, this.wp); this.pos.set(this.wp.x, 0.2, this.wp.z); b.vel.set(0, 0, 0); }
    }
    const moved = before.distanceTo(this.pos);
    this.walk += moved * 2.2;
  }

  updateSight(dt) {
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.2 + Math.random() * 0.1;
      const cam = this.game.camera.position;
      this.canSee = this.game.combat.losClear(this.eyePos(this.v), cam);
    }
  }

  onHit(info, amount) {
    this.flashT = 0.07;
    this.recentDmg += amount;
    if (info.stagger && this.stagger < info.stagger && this.staggerable !== false) {
      this.stagger = info.stagger * (this.heavy ? 0.4 : 1);
    }
    if (info.knock && info.dir) {
      const k = info.knock * (this.heavy ? 0.25 : 1);
      this.body.vel.x += info.dir.x * k;
      this.body.vel.z += info.dir.z * k;
      if (k > 6 && !this.flying) this.body.vel.y = Math.max(this.body.vel.y, k * 0.3);
    }
    if (this.elite === 'blinking' && this.recentDmg > this.maxHp * 0.22 && this.blinkCd <= 0 && this.hp > 0) this.blink();
  }

  blink() {
    const room = this.game.level.current;
    if (!room) return;
    const p = this.game.player.body.pos;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 6;
      const k = room.nav.idx(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      if (k >= 0 && room.nav.free(k)) {
        room.nav.center(k, this.wp);
        this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, 0xc060ff, 0.4, 3);
        this.pos.set(this.wp.x, this.flying ? this.pos.y : 0.05, this.wp.z);
        this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, 0xc060ff, 0.4, 3);
        this.game.audio.play('spawn', this.pos, 0.5);
        this.blinkCd = 3.5;
        this.recentDmg = 0;
        this.stagger = 0.4;
        break;
      }
    }
  }

  update(dt) {
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      this.group.visible = this.spawnT < 0.45 && Math.random() < 0.85;
      if (this.spawnT <= 0) { this.group.visible = true; this.targetable = true; }
      this.syncVisual(dt);
      if (this.spawnT > 0.45) return;
    }
    this.flashT -= dt;
    this.stateT -= dt;
    this.attackCd -= dt;
    this.blinkCd -= dt;
    this.recentDmg = Math.max(0, this.recentDmg - dt * this.maxHp * 0.2);
    if (this.shieldMax > 0) {
      this.shieldDelay -= dt;
      if (this.shieldDelay <= 0) this.shield = Math.min(this.shieldMax, this.shield + this.shieldMax * 0.3 * dt);
    }
    this.updateSight(dt);
    if (this.spawnT <= 0) {
      if (this.stagger > 0) {
        this.stagger -= dt;
        this.stop(dt);
        this.onStagger && this.onStagger();
      } else this.think(dt);
    }
    this.physics(dt);
    this.syncVisual(dt);
  }

  syncVisual(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.shadow.position.set(this.pos.x, this.groundY() + 0.03, this.pos.z);
    if (this.eliteRing) {
      this.eliteRing.position.set(this.pos.x, this.groundY() + 0.05, this.pos.z);
      this.eliteRing.rotation.y += dt * 2;
      this.eliteRing.material.opacity = 0.5 + 0.3 * Math.sin(this.game.time * 6);
    }
    if (this.shell) {
      this.shell.position.copy(this.centerPos());
      const s = (this.bodyY1 - this.bodyY0) * 0.75;
      this.shell.scale.set(s * 0.8, s, s * 0.8);
      this.shell.visible = this.shield > 0 && this.group.visible;
      this.shell.material.opacity = 0.1 + 0.25 * (this.shield / this.shieldMax) + (this.flashT > 0 ? 0.3 : 0);
    }
    const flash = this.flashT > 0;
    if (flash !== this.flashing) {
      this.flashing = flash;
      const fm = sharedMaterials().flash;
      for (const m of this.meshes) m.material = flash ? fm : m.userData.mat;
    }
    this.animate(dt);
  }

  groundY() { return this.flying ? this.groundLevel || 0 : this.pos.y; }

  animate(dt) {
    const P = this.parts;
    const s = Math.sin(this.walk) * Math.min(1, Math.hypot(this.body.vel.x, this.body.vel.z) / 2);
    if (P.legL) { P.legL.rotation.x = s * 0.7; P.legR.rotation.x = -s * 0.7; }
    if (P.armL && !this.armPose) { P.armL.rotation.x = -s * 0.5; }
    if (P.torso) P.torso.position.y = P.torso.userData.y0 + Math.abs(Math.cos(this.walk)) * 0.04;
  }

  // shoot an orb at the player with lead
  shootAt(speed, dmg, opts = {}) {
    const g = this.game;
    const from = opts.from || this.muzzlePos();
    const target = g.camera.position.clone();
    target.y -= 0.35;
    const pv = g.player.body.vel;
    const dist = from.distanceTo(target);
    const lead = (opts.lead !== undefined ? opts.lead : 0.35) * dist / speed;
    target.x += pv.x * lead; target.z += pv.z * lead;
    const dir = target.sub(from).normalize();
    if (opts.spread) {
      dir.x += (Math.random() - 0.5) * opts.spread; dir.y += (Math.random() - 0.5) * opts.spread * 0.5; dir.z += (Math.random() - 0.5) * opts.spread;
      dir.normalize();
    }
    g.projectiles.spawnEnemy(from, dir.multiplyScalar(speed), dmg * this.dmgMul, {
      color: opts.color || 0xff5030, radius: opts.radius || 0.2, size: opts.size || 0.2, owner: this,
      cause: opts.cause || ENEMY_INFO[this.type].name, tip: opts.tip, explode: opts.explode || 0, homing: opts.homing || 0, life: opts.life || 4,
    });
  }

  muzzlePos() {
    const out = new THREE.Vector3(0.35, 1.35, 0.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return out.add(this.pos);
  }

  die(info) {
    const g = this.game;
    this.alive = false;
    this.targetable = false;
    const dir = info.dir ? info.dir.clone() : new THREE.Vector3(0, 0, 0);
    const force = Math.min(14, (info.knock || 3) + (info.source === 'explosion' ? 6 : 2));
    // restore materials before handing meshes to the corpse system
    for (const m of this.meshes) m.material = m.userData.mat;
    const gib = info.source === 'explosion' || force > 10;
    for (const m of this.meshes.slice()) {
      if (m.userData.noCorpse) continue;
      const v = new THREE.Vector3(dir.x * force + (Math.random() - 0.5) * 3, 2 + Math.random() * 3 + (gib ? 4 : 0), dir.z * force + (Math.random() - 0.5) * 3);
      if (info.part === 'head' && m === this.headMesh) { v.y += 6; v.x += dir.x * 4; v.z += dir.z * 4; }
      g.fx.addCorpsePiece(m, v, new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
    }
    g.fx.chunks(this.centerPos(), 0x5a1010, gib ? 10 : 5, gib ? 9 : 5, 0.12);
    g.fx.blood(this.centerPos(), dir.setY(0.5).normalize(), gib ? 3 : 1.6, this.bloodColor);
    g.scene.remove(this.group);
    this.cleanupExtras();
    if (this.elite === 'volatile') {
      const p = this.centerPos().clone();
      g.fx.telegraphDisc(p.x, this.pos.y, p.z, 4, 0xff9020, 0.8);
      g.audio.play('windup', p, 0.8);
      g.enemies.delayed(0.8, () => {
        g.fx.explosion(p, 4, 0xff9020);
        g.audio.play('explosion', p, 1);
        g.combat.radialDamage(p, 4, 30 * this.dmgMul, { source: 'explosion', friendly: true, cause: 'VOLATILE ELITE', tip: 'Volatile elites detonate a second after death. Back off from the orange circle.' });
      });
    }
    if (this.onDeath) this.onDeath(info);
  }

  cleanupExtras() {
    this.game.scene.remove(this.shadow);
    if (this.eliteRing) { this.game.scene.remove(this.eliteRing); this.eliteRing.material.dispose(); }
    if (this.shell) { this.game.scene.remove(this.shell); this.shell.material.dispose(); }
    if (this.extraCleanup) this.extraCleanup();
  }

  remove() {
    this.game.scene.remove(this.group);
    this.cleanupExtras();
  }
}

// ---------------------------------------------------------------------------------------
// Humanoid builder
// ---------------------------------------------------------------------------------------
function humanoid(e, o) {
  const body = bodyMat(o.body), dark = bodyMat(o.dark), glow = glowMat(o.glow);
  const g = e.group;
  const legH = o.legH || 0.85, torsoH = o.torsoH || 0.7, w = o.w || 0.5;
  const legL = part(0.18, legH, 0.2, dark, -0.13, legH, 0, 0, -legH / 2, 0);
  const legR = part(0.18, legH, 0.2, dark, 0.13, legH, 0, 0, -legH / 2, 0);
  const torso = part(w, torsoH, 0.32, body, 0, legH, 0, 0, torsoH / 2, 0);
  torso.userData.y0 = legH;
  const headY = legH + torsoH + 0.18;
  const head = part(0.28, 0.3, 0.3, body, 0, headY, 0, 0, 0, 0);
  const visor = new THREE.Mesh(boxGeo(0.22, 0.07, 0.04), glow);
  visor.position.set(0, 0.03, 0.155);
  visor.userData.mat = glow;
  head.add(visor);
  const armL = part(0.14, 0.62, 0.16, body, -w / 2 - 0.08, legH + torsoH - 0.05, 0, 0, -0.28, 0);
  const armR = part(0.14, 0.62, 0.16, body, w / 2 + 0.08, legH + torsoH - 0.05, 0, 0, -0.28, 0);
  // silhouette details: shoulder pads, belt, helmet ridge
  for (const arm of [armL, armR]) {
    const pad = new THREE.Mesh(boxGeo(0.24, 0.14, 0.26), dark);
    pad.position.set(0, 0.02, 0);
    pad.userData.mat = dark;
    arm.add(pad);
  }
  const belt = new THREE.Mesh(boxGeo(w + 0.04, 0.1, 0.36), dark);
  belt.position.set(0, 0.05, 0); belt.userData.mat = dark;
  torso.add(belt);
  if (o.helmet !== false) {
    const ridge = new THREE.Mesh(boxGeo(0.32, 0.08, 0.34), dark);
    ridge.position.set(0, 0.17, 0); ridge.userData.mat = dark;
    head.add(ridge);
  }
  g.add(legL, legR, torso, head, armL, armR);
  e.parts = { legL, legR, torso, head, armL, armR, visor };
  e.headMesh = head.children[0];
  e.headY = headY; e.bodyY1 = legH + torsoH; e.headR = 0.22;
  return e.parts;
}

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------
class Husk extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'husk', pos, opts);
    const P = humanoid(this, { body: 0xc0b4a4, dark: 0x4a4440, glow: 0xff8a20 });
    const gun = new THREE.Mesh(boxGeo(0.1, 0.12, 0.5), bodyMat(0x2a2a2a));
    gun.position.set(0, -0.55, 0.2);
    gun.userData.mat = gun.material;
    P.armR.add(gun);
    this.speed = 3.4;
    this.styleValue = 18;
    this.finishSetup(60);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.faceToward(p.x, p.z, dt, 6);
    if (this.state === 'aim') {
      this.stop(dt);
      this.parts.armR.rotation.x = -1.5;
      if (this.stateT <= 0) {
        this.shootAt(21, 9, { color: 0xff7020, tip: 'Husks fire slow orange orbs. Strafe or dash sideways, or parry them back.' });
        g.audio.play('enemyShot', this.pos, 0.7);
        this.state = 'move';
        this.attackCd = (1.5 + Math.random() * 1.2) * this.aggr;
      }
      return;
    }
    this.parts.armR.rotation.x = this.canSee ? -1.2 : -0.3;
    if (this.attackCd <= 0 && this.canSee && d < 32) { this.state = 'aim'; this.stateT = 0.45 * this.windMul; this.parts.visor.scale.set(1.5, 1.5, 1.5); return; }
    this.parts.visor.scale.set(1, 1, 1);
    const sp = this.speed * this.speedMul;
    if (!this.canSee || d > 15) this.navMove(dt, p.x, p.z, sp);
    else if (d < 6) this.navMove(dt, this.pos.x - (p.x - this.pos.x), this.pos.z - (p.z - this.pos.z), sp, true);
    else this.strafe(dt, sp * 0.8);
  }
  strafe(dt, sp) {
    const p = this.game.player.body.pos;
    this.strafeT -= dt;
    if (this.strafeT <= 0 || this.body.wallNormalX || this.body.wallNormalZ) { this.strafeDir *= -1; this.strafeT = 1.2 + Math.random() * 1.8; }
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    this.applySteer(dt, -dz / l * sp * this.strafeDir, dx / l * sp * this.strafeDir);
  }
}

class Ripper extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'ripper', pos, opts);
    const P = humanoid(this, { body: 0xa0a8b8, dark: 0x30323a, glow: 0xff2040, legH: 0.8, torsoH: 0.6, w: 0.42 });
    const bladeM = bodyMat(0xd0d0d8);
    for (const arm of [P.armL, P.armR]) {
      const blade = new THREE.Mesh(boxGeo(0.04, 0.12, 0.7), bladeM);
      blade.position.set(0, -0.6, 0.3);
      blade.userData.mat = bladeM;
      arm.add(blade);
    }
    this.speed = 7.4;
    this.radius = 0.38;
    this.styleValue = 22;
    this.bloodColor = [0.65, 0.05, 0.1];
    this.finishSetup(45);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    if (this.state === 'windup') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 12);
      this.parts.torso.rotation.x = 0.5;
      this.parts.armL.rotation.x = this.parts.armR.rotation.x = -2.2;
      if (this.stateT <= 0) {
        this.state = 'lunge'; this.stateT = 0.32; this.hitDone = false;
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
        this.lungeX = dx / l; this.lungeZ = dz / l;
        g.audio.play('lunge', this.pos, 0.8);
      }
      return;
    }
    if (this.state === 'lunge') {
      const sp = 17 * this.speedMul;
      this.body.vel.x = this.lungeX * sp; this.body.vel.z = this.lungeZ * sp;
      this.parts.armL.rotation.x = this.parts.armR.rotation.x = -0.4;
      if (!this.hitDone) {
        const pp = g.player.body.pos;
        if (Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < 1.5 && Math.abs(pp.y - this.pos.y) < 1.8) {
          this.hitDone = true;
          if (g.player.damage(18 * this.dmgMul, this.pos, 'RIPPER', 'Rippers crouch before lunging. Dash sideways when you see them crouch, then punish the recovery.')) {
            g.player.knock(this.lungeX * 8, 3, this.lungeZ * 8);
            g.audio.play('slash', this.pos, 1);
          }
        }
      }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.75; }
      return;
    }
    if (this.state === 'recover') {
      this.stop(dt);
      this.parts.torso.rotation.x = 0.3;
      if (this.stateT <= 0) { this.state = 'chase'; this.parts.torso.rotation.x = 0; this.attackCd = 0.5 * this.aggr; }
      return;
    }
    this.parts.torso.rotation.x = 0.25;
    this.faceToward(p.x, p.z, dt, 10);
    this.parts.armL.rotation.x = this.parts.armR.rotation.x = -0.9;
    if (d < 4.6 && this.canSee && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 2) {
      this.state = 'windup'; this.stateT = 0.38 * this.windMul;
      g.audio.play('windup', this.pos, 0.6);
      return;
    }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 5);
  }
}

class Gunner extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'gunner', pos, opts);
    const P = humanoid(this, { body: 0x98a884, dark: 0x3a4036, glow: 0xffe23a, legH: 0.9, torsoH: 0.8, w: 0.66 });
    const mg = new THREE.Mesh(boxGeo(0.2, 0.2, 0.75), bodyMat(0x303030));
    mg.position.set(0, -0.55, 0.3);
    mg.userData.mat = mg.material;
    P.armR.add(mg);
    const pack = new THREE.Mesh(boxGeo(0.5, 0.55, 0.25), bodyMat(0x3a4030));
    pack.position.set(0, 0.4, -0.28);
    pack.userData.mat = pack.material;
    P.torso.add(pack);
    this.radius = 0.5;
    this.speed = 2.6;
    this.styleValue = 30;
    this.finishSetup(95);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.faceToward(p.x, p.z, dt, this.state === 'burst' ? 3 : 6);
    if (this.state === 'windup') {
      this.stop(dt);
      this.parts.armR.rotation.x = -1.5;
      // flickering laser sight telegraph
      if (Math.random() < 0.7) g.fx.beam(this.muzzlePos(), g.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0)), 0xffe23a, 0.025, 0.05);
      if (this.stateT <= 0) { this.state = 'burst'; this.shots = 4 + (this.elite ? 2 : 0); this.shotT = 0; }
      return;
    }
    if (this.state === 'burst') {
      this.stop(dt);
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = 0.1;
        this.shots--;
        this.shootAt(36, 6, { color: 0xffe23a, radius: 0.12, size: 0.11, spread: 0.08, lead: 0.2, tip: 'Gunners flash a yellow laser before a burst. Break line of sight when you see it.' });
        g.audio.play('enemyBurst', this.pos, 0.6);
        if (this.shots <= 0) { this.state = 'move'; this.attackCd = (2.4 + Math.random()) * this.aggr; }
      }
      return;
    }
    this.parts.armR.rotation.x = -1.1;
    if (this.attackCd <= 0 && this.canSee && d < 30) { this.state = 'windup'; this.stateT = 0.75 * this.windMul; g.audio.play('windup', this.pos, 0.5); return; }
    if (!this.canSee || d > 13) this.navMove(dt, p.x, p.z, this.speed * this.speedMul);
    else this.stop(dt);
  }
}

class Lancer extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'lancer', pos, opts);
    const P = humanoid(this, { body: 0x8a8ab0, dark: 0x2a2a3a, glow: 0xff2040, legH: 0.95, torsoH: 0.7, w: 0.44 });
    const rifle = new THREE.Mesh(boxGeo(0.08, 0.1, 1.1), bodyMat(0x202028));
    rifle.position.set(0, -0.5, 0.45);
    rifle.userData.mat = rifle.material;
    P.armR.add(rifle);
    this.speed = 2.4;
    this.styleValue = 30;
    this.aim = new THREE.Vector3();
    this.finishSetup(55);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    const cam = g.camera.position;
    if (this.state === 'aim' || this.state === 'lock') {
      this.stop(dt);
      this.parts.armR.rotation.x = -1.55;
      const from = this.eyePos(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, 0));
      if (this.state === 'aim') {
        // tracks with lag
        this.aim.lerp(cam.clone().add(new THREE.Vector3(0, -0.3, 0)), Math.min(1, dt * 3));
        this.faceToward(this.aim.x, this.aim.z, dt, 8);
        if (!this.canSee) this.losT = (this.losT || 0) + dt; else this.losT = 0;
        if (this.losT > 0.6) { this.state = 'move'; this.attackCd = 1.2; return; }
        if (Math.random() < 0.15) g.audio.play('sniperAim', this.pos, 0.4);
        if (this.stateT <= 0) { this.state = 'lock'; this.stateT = 0.4 * this.windMul; g.audio.play('sniperLock', this.pos, 0.9); }
      } else if (this.stateT <= 0) {
        // fire along locked line
        const dir = this.aim.clone().sub(from).normalize();
        const w = g.combat.rayWorld(from, dir, 200);
        const end = from.clone().addScaledVector(dir, w ? w.t : 200);
        g.fx.beam(from, end, 0xffffff, 0.12, 0.25);
        g.fx.beam(from, end, 0xff2040, 0.25, 0.35);
        g.audio.play('sniperFire', this.pos, 1);
        const pp = g.player.body.pos;
        const d2 = segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 0.9, pp.z);
        if (d2 < 0.6 * 0.6 || segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 1.5, pp.z) < 0.45 * 0.45) {
          g.player.damage(32 * this.dmgMul, from, 'LANCER', 'Lancers paint you with a red laser, then it flashes white right before the shot. Move or break line of sight.');
        }
        if (w) g.fx.impact(end, new THREE.Vector3(w.nx, w.ny, w.nz), 'energy', 1.5);
        this.state = 'move';
        this.attackCd = (3.2 + Math.random()) * this.aggr;
        return;
      }
      // laser sight beam (thin while aiming, thick flicker on lock)
      const dir = this.aim.clone().sub(from).normalize();
      const w = g.combat.rayWorld(from, dir, 200);
      const end = from.clone().addScaledVector(dir, w ? w.t : 200);
      if (this.state === 'aim') g.fx.beam(from, end, 0xff2040, 0.02 + (1 - Math.max(0, this.stateT) / 1.6) * 0.03, 0.03, false);
      else g.fx.beam(from, end, Math.random() < 0.5 ? 0xffffff : 0xff2040, 0.06, 0.03, false);
      return;
    }
    this.parts.armR.rotation.x = -0.8;
    this.faceToward(p.x, p.z, dt, 5);
    if (this.attackCd <= 0 && this.canSee) {
      this.state = 'aim'; this.stateT = 1.6 * this.windMul;
      this.aim.copy(this.eyePos(new THREE.Vector3())).add(new THREE.Vector3(Math.sin(this.yaw) * 5, -1, Math.cos(this.yaw) * 5));
      return;
    }
    if (d < 11) this.navMove(dt, this.pos.x - (p.x - this.pos.x), this.pos.z - (p.z - this.pos.z), this.speed * this.speedMul, true);
    else if (!this.canSee) this.navMove(dt, p.x, p.z, this.speed * this.speedMul);
    else this.stop(dt);
  }
}

class Bulwark extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'bulwark', pos, opts);
    const P = humanoid(this, { body: 0xb09a78, dark: 0x403a32, glow: 0x40e0ff, legH: 1.0, torsoH: 0.9, w: 0.85 });
    this.parts.head.scale.set(1.2, 1, 1.2);
    // front shield slab
    const sm = bodyMat(0x606878);
    const shield = new THREE.Mesh(boxGeo(1.25, 1.6, 0.14), sm);
    shield.position.set(0, -0.5, 0.42);
    shield.userData.mat = sm;
    P.armL.add(shield);
    P.armL.position.x = -0.15;
    const stripe = new THREE.Mesh(boxGeo(1.26, 0.18, 0.15), sharedMaterials().door);
    stripe.position.set(0, -1.0, 0.42); stripe.userData.mat = stripe.material;
    P.armL.add(stripe);
    this.radius = 0.68;
    this.body.r = 0.55;
    this.heavy = true;
    this.speed = 1.9;
    this.styleValue = 45;
    this.headR = 0.26;
    this.finishSetup(280);
  }
  armorFactor(info) {
    if (!info.dir || info.source === 'explosion' || info.energy || info.source === 'punch' || info.source === 'parry' || info.source === 'slam') return 1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dot = info.dir.x * fx + info.dir.z * fz; // bullet travel vs facing; front hits travel opposite to facing
    if (dot < -0.45 && info.part !== 'head') {
      if (info.point) this.game.fx.sparksBurst(info.point, 0xffd080, 3, 4, 0.2, 0.07);
      return 0.12;
    }
    return 1;
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    if (this.state === 'slamWind') {
      this.stop(dt);
      this.parts.armR.rotation.x = -2.8;
      if (this.stateT <= 0) {
        g.enemies.shockwave(this.pos.clone(), 7.5, 11, 20 * this.dmgMul, 0x40e0ff, 'BULWARK SLAM', 'Jump over Bulwark shockwaves. Hit them from behind or with explosives and energy beams.');
        g.audio.play('slam', this.pos, 1);
        g.addShake(0.2);
        this.state = 'move'; this.attackCd = 2.8 * this.aggr;
      }
      return;
    }
    if (this.state === 'mortarWind') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 4);
      this.parts.armR.rotation.x = -2.4;
      if (this.stateT <= 0) {
        const target = p.clone();
        const pv = g.player.body.vel;
        target.x += pv.x * 0.6; target.z += pv.z * 0.6;
        const room = g.level.current;
        target.y = 0;
        if (room) { target.x = clamp(target.x, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1); target.z = clamp(target.z, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1); }
        g.projectiles.spawnMortar(this.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), target, 24 * this.dmgMul, 3.2, 1.35, { cause: 'BULWARK MORTAR' });
        g.audio.play('launcher', this.pos, 0.8);
        this.state = 'move'; this.attackCd = 3.2 * this.aggr;
      }
      return;
    }
    this.parts.armR.rotation.x = -0.3;
    this.faceToward(p.x, p.z, dt, 2.5);
    if (this.attackCd <= 0 && d < 5.5) { this.state = 'slamWind'; this.stateT = 0.8 * this.windMul; g.audio.play('windup', this.pos, 0.8); return; }
    if (this.attackCd <= 0 && this.canSee && d < 30) { this.state = 'mortarWind'; this.stateT = 0.6 * this.windMul; return; }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 6);
  }
}

class Signaller extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'signaller', pos, opts);
    const P = humanoid(this, { body: 0xa898b8, dark: 0x3a3440, glow: 0x3ef0d0, legH: 0.85, torsoH: 0.65, w: 0.48 });
    const pack = new THREE.Mesh(boxGeo(0.42, 0.5, 0.25), bodyMat(0x3a3a3a));
    pack.position.set(0, 0.35, -0.28); pack.userData.mat = pack.material;
    P.torso.add(pack);
    const ant = new THREE.Mesh(boxGeo(0.03, 0.9, 0.03), bodyMat(0x888888));
    ant.position.set(0.15, 1.0, -0.3); ant.userData.mat = ant.material;
    P.torso.add(ant);
    this.beacon = new THREE.Mesh(boxGeo(0.09, 0.09, 0.09), glowMat(0xff3050));
    this.beacon.position.set(0.15, 1.48, -0.3); this.beacon.userData.mat = this.beacon.material;
    P.torso.add(this.beacon);
    this.speed = 3.4;
    this.progress = 0;
    this.called = false;
    this.calling = false;
    this.callDelay = 2.0 + Math.random();
    this.styleValue = 25;
    this.finishSetup(50);
  }
  onStagger() { this.calling = false; }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.callDelay -= dt;
    if (!this.called && (this.canSee || this.callDelay <= 0)) {
      this.calling = true;
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 3);
      this.parts.armL.rotation.x = -2.6; // hand to ear
      const rate = 1 / 7.5 / this.aggr;
      this.progress += dt * rate;
      this.beacon.visible = Math.sin(g.time * 20) > 0;
      if (Math.random() < dt * 2) g.audio.play('radio', this.pos, 0.5);
      if (this.progress >= 1) {
        this.called = true; this.calling = false; this.progress = 1;
        g.director.callBackup(this);
      }
      return;
    }
    this.calling = false;
    this.beacon.visible = true;
    this.parts.armL.rotation.x = 0;
    // after calling: keep distance and plink
    if (d < 9) this.navMove(dt, this.pos.x - (p.x - this.pos.x), this.pos.z - (p.z - this.pos.z), this.speed * this.speedMul, true);
    else this.stop(dt);
    this.faceToward(p.x, p.z, dt, 5);
    if (this.called && this.attackCd <= 0 && this.canSee) {
      this.shootAt(20, 7, { color: 0x3ef0d0, tip: 'Kill Signallers first: if their uplink reaches 100% they call backup.' });
      g.audio.play('enemyShot', this.pos, 0.5);
      this.attackCd = 2.2 * this.aggr;
    }
  }
}

class Wisp extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'wisp', pos, opts);
    this.flying = true;
    this.staggerable = true;
    if (!wispGeo) wispGeo = new THREE.OctahedronGeometry(0.32, 0);
    const core = new THREE.Mesh(wispGeo, bodyMat(0x8a8aa0));
    core.userData.mat = core.material;
    const eye = new THREE.Mesh(boxGeo(0.16, 0.16, 0.1), glowMat(0xff3050));
    eye.position.set(0, 0, 0.26); eye.userData.mat = eye.material;
    const finM = bodyMat(0x404048);
    const finL = new THREE.Mesh(boxGeo(0.5, 0.04, 0.22), finM); finL.position.set(-0.36, 0, -0.05); finL.userData.mat = finM;
    const finR = finL.clone(); finR.position.x = 0.36; finR.userData.mat = finM;
    const rig = new THREE.Group();
    rig.add(core, eye, finL, finR);
    rig.position.y = 0;
    this.group.add(rig);
    this.rig = rig; this.eye = eye;
    this.headMesh = core;
    this.radius = 0.38; this.headY = 0.0; this.headR = 0.2; this.bodyY0 = -0.35; this.bodyY1 = 0.35;
    this.body.r = 0.3; this.body.h = 0.6;
    this.speed = 6;
    this.hoverH = 2.6 + Math.random() * 1.6;
    this.orbitA = Math.random() * Math.PI * 2;
    this.styleValue = 15;
    this.bloodColor = [0.9, 0.6, 0.2];
    this.attackCd = 2.5 + Math.random() * 2;
    this.pos.y = this.hoverH;
    this.finishSetup(28);
  }
  centerPos() { return this.c.set(this.pos.x, this.pos.y, this.pos.z); }
  headPos() { return this.h.set(this.pos.x, this.pos.y, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y, this.pos.z); }
  groundY() { return 0; }
  muzzlePos() { return this.pos.clone(); }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const cam = g.camera.position;
    if (this.stun > 0) { this.stun -= dt; this.body.vel.multiplyScalar(0.9); this.body.vel.y = -1; return; }
    if (this.state === 'dive') {
      const dir = new THREE.Vector3(cam.x - this.pos.x, cam.y - 0.4 - this.pos.y, cam.z - this.pos.z);
      const dist = dir.length();
      dir.normalize();
      const cur = this.body.vel.clone().normalize();
      cur.lerp(dir, Math.min(1, dt * 1.4)).normalize();
      this.body.vel.copy(cur.multiplyScalar(15 * this.speedMul));
      this.yaw = Math.atan2(this.body.vel.x, this.body.vel.z);
      if (dist < 1.2) { this.explodeSelf(true); return; }
      if (this.stateT <= 0) { this.state = 'orbit'; this.attackCd = 2; }
      return;
    }
    if (this.state === 'windup') {
      this.body.vel.multiplyScalar(0.85);
      this.eye.visible = Math.sin(g.time * 40) > 0;
      this.faceToward(p.x, p.z, dt, 10);
      if (this.stateT <= 0) {
        this.state = 'dive'; this.stateT = 2.2; this.eye.visible = true;
        const dir = new THREE.Vector3(cam.x - this.pos.x, cam.y - this.pos.y, cam.z - this.pos.z).normalize();
        this.body.vel.copy(dir.multiplyScalar(15));
        g.audio.play('droneDive', this.pos, 0.8);
      }
      return;
    }
    // orbit around the player at range, bobbing
    this.orbitA += dt * 0.6 * (this.strafeDir);
    const r = 9;
    const tx = p.x + Math.cos(this.orbitA) * r, tz = p.z + Math.sin(this.orbitA) * r;
    const ty = this.hoverH + Math.sin(g.time * 2 + this.orbitA) * 0.4;
    const dx = tx - this.pos.x, dz = tz - this.pos.z, dy = ty - this.pos.y;
    const l = Math.hypot(dx, dz) || 1;
    const sp = this.speed * this.speedMul * Math.min(1, l / 3);
    const k = 1 - Math.exp(-4 * dt);
    this.body.vel.x += (dx / l * sp - this.body.vel.x) * k;
    this.body.vel.z += (dz / l * sp - this.body.vel.z) * k;
    this.body.vel.y += (dy * 2 - this.body.vel.y) * k;
    this.faceToward(p.x, p.z, dt, 5);
    if (this.attackCd <= 0 && this.canSee) {
      this.state = 'windup'; this.stateT = 0.6 * this.windMul;
      g.audio.play('beep', this.pos, 0.7);
      this.attackCd = 3 * this.aggr;
    }
  }
  physics(dt) {
    const before = this.pos.clone();
    moveBody(this.body, this.body.vel.x * dt, this.body.vel.y * dt, this.body.vel.z * dt, this.game.level.colliders);
    const hitSomething = this.state === 'dive' && before.distanceTo(this.pos) < this.body.vel.length() * dt * 0.5;
    if (hitSomething) this.explodeSelf(false);
    this.pos.y = Math.max(0.4, this.pos.y);
    const room = this.game.level.current;
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 0.5)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 0.8, room.origin.x + room.W / 2 - 0.8);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 0.8, room.origin.z + room.D / 2 - 0.8);
    }
  }
  animate(dt) {
    if (this.rig) { this.rig.rotation.z = Math.sin(this.game.time * 5) * 0.2; this.rig.position.y = Math.sin(this.game.time * 3) * 0.05; }
  }
  explodeSelf(contact) {
    if (!this.alive) return;
    const g = this.game;
    this.hp = 0;
    const p = this.pos.clone();
    g.combat.killEnemy(this, { source: 'self', dir: new THREE.Vector3(0, 1, 0), knock: 4, fromPlayer: false });
    void contact;
    g.fx.explosion(p, 2.4, 0xff5030);
    g.audio.play('explosion', p, 0.8);
    g.combat.radialDamage(p, 2.6, 16 * this.dmgMul, { source: 'explosion', friendly: true, cause: 'WISP', tip: 'Wisps blink red and beep before diving at you. Shoot them in the air or dash out of the way.' });
  }
  onDeath(info) {
    if (info.source === 'self') return;
    const g = this.game;
    const p = this.pos.clone();
    g.fx.explosion(p, 2.0, 0xff8030);
    g.audio.play('explosion', p, 0.6);
    g.combat.radialDamage(p, 2.4, 14, { source: 'explosion', friendly: true, cause: 'WISP EXPLOSION', tip: 'Shot-down Wisps still explode. Do not kill them right next to you.' });
  }
}

const TYPES = { husk: Husk, ripper: Ripper, gunner: Gunner, lancer: Lancer, bulwark: Bulwark, signaller: Signaller, wisp: Wisp };

// ---------------------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------------------
export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.flowT = 0;
    this.waves = [];
    this.timers = [];
  }
  spawn(type, pos, opts = {}) {
    const C = TYPES[type];
    const e = new C(this.game, pos, opts);
    this.list.push(e);
    return e;
  }
  get aliveCount() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }

  delayed(t, fn) { this.timers.push({ t, fn }); }

  shockwave(center, maxR, speed, dmg, color, cause, tip) {
    const fx = this.game.fx;
    const it = fx.ring(center.x, center.y + 0.1, center.z, maxR, color, maxR / speed, 0);
    const it2 = fx.ring(center.x, center.y + 0.5, center.z, maxR, color, maxR / speed, 0);
    this.waves.push({ c: center.clone(), r: 0, maxR, speed, dmg, hit: false, cause, tip, ring: it, ring2: it2 });
  }

  update(dt) {
    const g = this.game;
    const room = g.level.current;
    this.flowT -= dt;
    if (this.flowT <= 0 && room && room.nav) {
      this.flowT = 0.25;
      const p = g.player.body.pos;
      room.nav.flow(p.x, p.z);
    }
    for (const e of this.list) if (e.alive) e.update(dt);
    // safety nets: free enemies wedged inside geometry, and mark stragglers if a fight drags on
    this.checkT = (this.checkT || 0) - dt;
    if (this.checkT <= 0 && room) {
      this.checkT = 1.5;
      const alive = this.list.filter((e) => e.alive && e.targetable);
      for (const e of alive) {
        if (!e.flying && !e.perch && bodyOverlapsAny(e.body, g.level.colliders)) {
          const k = room.nav.nearestFree(e.pos.x, e.pos.z, 8);
          if (k >= 0) { const c = room.nav.center(k, { x: 0, z: 0 }); e.pos.set(c.x, room.floorAt(c.x, c.z) + 0.05, c.z); e.body.vel.set(0, 0, 0); }
        }
      }
      if (alive.length && alive.length <= 2 && g.time - (this.lastKill || 0) > 12 && room.state === 'combat') {
        for (const e of alive) g.fx.spawnColumn(e.pos.x, e.pos.y, e.pos.z, 0xff3050, 1.2, 9);
      }
    }
    // remove dead (their meshes were handed to the corpse system)
    if (this.list.some((e) => !e.alive)) this.list = this.list.filter((e) => e.alive);
    // shockwaves
    const pp = g.player.body.pos;
    for (const w of this.waves) {
      w.r += w.speed * dt;
      const d = Math.hypot(pp.x - w.c.x, pp.z - w.c.z);
      if (!w.hit && Math.abs(d - w.r) < 0.7 && pp.y - w.c.y < 0.55) {
        w.hit = true;
        if (g.player.damage(w.dmg, w.c, w.cause, w.tip)) {
          const dx = (pp.x - w.c.x) / (d || 1), dz = (pp.z - w.c.z) / (d || 1);
          g.player.knock(dx * 7, 5, dz * 7);
        }
      }
    }
    this.waves = this.waves.filter((w) => w.r < w.maxR);
    for (const t of this.timers) { t.t -= dt; if (t.t <= 0) t.fn(); }
    this.timers = this.timers.filter((t) => t.t > 0);
  }

  onKilled(e) { this.lastKill = this.game.time; if (e) { this.game.director.onKill(e); this.game.emit('kill', e); } }

  clear() {
    for (const e of this.list) e.remove();
    this.list = [];
    this.waves = [];
    this.timers = [];
  }

  // Highest active signaller progress (for the HUD uplink panel)
  uplink() {
    let best = null;
    for (const e of this.list) if (e.alive && e.type === 'signaller' && !e.called && e.progress > 0) if (!best || e.progress > best.progress) best = e;
    return best;
  }
}
