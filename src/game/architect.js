import * as THREE from 'three';
import { Boss } from './bosses.js';
import { Brain } from './abilities.js';
import { Miniboss } from './kit.js';
import { clamp } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { BOSSES } from '../data/bossdata.js';

// THE ARCHITECT. Three acts:
//   I   THE HANDS     - two colossal hands slam and sweep; break a hand to stagger the core.
//   II  THE CHOIR     - it summons echoes of bosses you killed; the floor turns live.
//   III BLACKOUT      - the lights die; the core only cracks under parries, coins and blasts.
// Then it falls, and you walk up and pull the breaker yourself.

const lam = (tex, color, emissive = 0) => psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color, emissive: new THREE.Color(color).multiplyScalar(emissive) }));
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData.mat = mat; return m; };

export class Architect extends Boss {
  constructor(game, room, tier, opts = {}) {
    const ng = !!opts.ngPlus;
    super(game, room, 'architect', tier, { name: ng ? 'THE ARCHITECT · REBOOTED' : 'THE ARCHITECT', title: ng ? 'IT LEARNED YOUR SHAPE' : 'KEEPER OF ELEVEN MILLION LIGHTS', color: '#f4f0e0' });
    this.name = this.info.name;
    this.ng = ng;
    this.final = true;
    this.isBoss = true;
    this.flying = true;
    this.maxPhase = 3;
    this.hpMul = 1;
    this.setHp(ng ? 12000 : 9000);
    this.hpSegments = [0.4, 0.7];
    this.color = 0xf4f0e0;
    this.radius = 3; this.height = 7; this.size = 4;
    this.moveStyle = 'hover'; this.moveSpeed = 4; this.prefDist = 20;
    this.speedMul = 1; this.cdMul = ng ? 0.8 : 1; this.dmgMul = ng ? 1.25 : 1;
    this.anim = { wind: false, act: false, moving: false };
    this.hoverH = 8.5;
    this.pos.set(room.wx(0), this.hoverH, room.wz(-room.D / 2 + 9));
    this.body = { pos: this.pos, vel: new THREE.Vector3(), r: 3, h: 6, grounded: false, step: 0 };
    this.brain = new Brain(this,
      [['fan', { n: 7, volleys: 3, speed: 22, dmg: 11, cd: 3 }], ['homing', { n: 3, cd: 6 }], ['orbital', { cd: 9 }]],
      [['spiral', { cd: 5 }], ['rain', { n: 9, cd: 6 }], ['ring', { n: 20, cd: 5 }]],
      [['laser', { cd: 5 }], ['spokes', { n: 4, cd: 8 }], ['homing', { n: 5, cd: 4 }], ['bounce', { n: 6, cd: 6 }]]);
    this.brain.idleT = 2.5;
    this.buildBody();
    this.hands = [this.buildHand(-1), this.buildHand(1)];
    this.handT = 3;
    this.handTurn = 0;
    this.staggerT = 0;
    this.echoes = [];
    this.collapseT = 8;
    this.crackAt = 0.25; // fraction marks in phase 3 that trigger a crack stagger
    this.finish();
  }

  // ---------------------------------------------------------------- visuals
  buildBody() {
    const bone = lam('panel', 0xd8d2c0, 0.05), dark = lam('gun', 0x1a1a22), gold = basic(0xffd27a);
    this.coreMat = basic(0xffffff);
    const g = this.group;
    const head = new THREE.Group();
    head.add(mesh(new THREE.BoxGeometry(5.2, 6.4, 1.6), bone));          // mask slab
    head.add(mesh(new THREE.BoxGeometry(5.8, 0.8, 1.9), dark, 0, 1.6, 0.05)); // brow
    head.add(mesh(new THREE.BoxGeometry(3.6, 1.6, 1.4), bone, 0, -3.6, 0.2)); // jaw
    head.add(mesh(new THREE.BoxGeometry(1.4, 0.35, 0.2), dark, -1.4, 0.9, 0.82)); // eye slits
    head.add(mesh(new THREE.BoxGeometry(1.4, 0.35, 0.2), dark, 1.4, 0.9, 0.82));
    for (let i = -2; i <= 2; i++) head.add(mesh(new THREE.BoxGeometry(0.35, 1.2, 0.2), dark, i * 0.6, -3.6, 0.95)); // teeth grille
    for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI - Math.PI; head.add(mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), gold, Math.cos(a) * 3.2, 3.6 + Math.sin(-a) * 1.6, -0.3)); } // crown
    this.core = mesh(new THREE.IcosahedronGeometry(0.9, 0), this.coreMat, 0, -0.6, 1.0);
    head.add(this.core);
    this.coreGlow = mesh(new THREE.IcosahedronGeometry(1.4, 1), basic(0xbfe8ff, { transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -0.6, 1.0);
    head.add(this.coreGlow);
    g.add(head);
    this.head = head;
    // halo
    this.halo = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.halo.add(mesh(new THREE.BoxGeometry(1.2, 0.35, 0.35), i % 3 === 0 ? gold : dark, Math.cos(a) * 5.4, Math.sin(a) * 5.4, -1.2));
      this.halo.children[i].rotation.z = a;
    }
    g.add(this.halo);
    // collar + hanging cables
    g.add(mesh(new THREE.BoxGeometry(9, 0.8, 2.4), dark, 0, -4.8, -0.4));
    this.cables = [];
    for (let i = 0; i < 6; i++) {
      const c = mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 5), dark, -3.8 + i * 1.5, 7.5, -1.2 + (i % 2) * 0.6);
      g.add(c);
    }
    this.shield = mesh(new THREE.IcosahedronGeometry(4.6, 1), basic(0x9fd8ff, { transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    this.shield.visible = false;
    g.add(this.shield);
  }

  buildHand(side) {
    const bone = lam('panel', 0xcac4b2, 0.06), dark = lam('gun', 0x222230);
    const grp = new THREE.Group();
    grp.add(mesh(new THREE.BoxGeometry(2.6, 0.9, 3.0), bone));
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group();
      f.position.set(-0.95 + i * 0.63, 0, 1.5);
      f.add(mesh(new THREE.BoxGeometry(0.42, 0.42, 1.5), dark, 0, 0, 0.75));
      f.add(mesh(new THREE.BoxGeometry(0.38, 0.38, 1.1), bone, 0, -0.1, 1.9));
      grp.add(f);
    }
    grp.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 1.4), dark, side * -1.55, 0, 0.6));
    const gem = mesh(new THREE.OctahedronGeometry(0.45, 0), basic(0xffd27a), 0, 0.6, -0.2);
    grp.add(gem);
    grp.scale.setScalar(1.25);
    this.game.scene.add(grp);
    const room = this.room;
    const home = new THREE.Vector3(room.wx(side * 9), 6, room.wz(-room.D / 2 + 12));
    grp.position.copy(home);
    const meshes = [];
    grp.traverse((o) => { if (o.isMesh) meshes.push(o); });
    return { grp, side, home: home.clone(), pos: grp.position, hp: this.maxHp * 0.11, max: this.maxHp * 0.11, alive: true, state: 'idle', t: 0, target: new THREE.Vector3(), meshes, flashT: 0, gem, regenT: 0 };
  }

  // ---------------------------------------------------------------- combat interface
  get vulnerable() { return this.state !== 'intro' && this.invuln <= 0 && this.alive && this.state !== 'transition'; }
  get shielded() { return this.phase === 2 && this.echoes.some((e) => e.alive); }
  get groundY() { return this.room.floorAt(this.pos.x, this.pos.z); }
  center() { return this.coreWorld(); }
  coreWorld() { return this.core.getWorldPosition(new THREE.Vector3()); }
  muzzle() { return this.coreWorld().add(new THREE.Vector3(Math.sin(this.yaw) * 1.2, -0.3, Math.cos(this.yaw) * 1.2)); }
  faceTarget(dt, rate) { const p = this.game.player.body.pos; this.face(p.x, p.z, dt, rate); }
  moveVel(dt, vx, vz) {
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    const r = this.room;
    const zMax = this.phase >= 3 ? r.D / 2 - 8 : 0;
    this.pos.x = clamp(this.pos.x, r.origin.x - r.W / 2 + 7, r.origin.x + r.W / 2 - 7);
    this.pos.z = clamp(this.pos.z, r.origin.z - r.D / 2 + 7, r.origin.z + zMax);
  }
  slide() { return false; }
  teleport(v) { this.pos.x = v.x; this.pos.z = v.z; }
  stun(t) { this.staggerT = Math.max(this.staggerT, t); }

  hitboxes() {
    const c = this.coreWorld();
    const hb = this.hbs;
    hb.length = 0;
    const shielded = this.shielded;
    let coreMul = 1;
    if (this.phase === 1) coreMul = this.hands.some((h) => h.alive) && this.staggerT <= 0 ? 0.2 : 2.2;
    if (this.phase === 3) coreMul = this.staggerT > 0 ? 1.6 : 0.4;
    hb.push({ x: c.x, y: c.y, z: c.z, r: 1.3, weak: true, mul: coreMul, shielded, core: true });
    const p = this.pos;
    hb.push({ x: p.x, y: p.y + 0.4, z: p.z - 0.2, r: 3.0, mul: 0.08, shielded });
    for (const h of this.hands) if (h.alive) hb.push({ x: h.pos.x, y: h.pos.y, z: h.pos.z, r: 2.2, mul: 1, hand: h });
    return hb;
  }

  applyDamage(amount, info, part) {
    if (!this.vulnerable) return 0;
    const g = this.game;
    if (part.hand) {
      const h = part.hand;
      if (!h.alive) return 0;
      h.hp -= amount; h.flashT = 0.06;
      if (h.hp <= 0) this.breakHand(h);
      return amount;
    }
    if (this.phase === 3 && part.core) {
      if (info.source === 'parry') amount *= 3.5;
      else if (info.ricochet || info.coin) amount *= 2.2;
      else if (info.source === 'explosion') amount *= 1.6;
    }
    this.hp -= amount;
    this.flashT = 0.06;
    if (this.phase === 1 && this.hp < this.maxHp * 0.7) { this.hp = this.maxHp * 0.7; this.toPhase(2); }
    else if (this.phase === 2 && this.hp < this.maxHp * 0.4) { this.hp = this.maxHp * 0.4; this.toPhase(3); }
    else if (this.phase === 3 && this.hp < this.maxHp * this.crackAt && this.hp > 0) {
      this.crackAt -= 0.12;
      this.staggerT = 4;
      g.hud.toast('THE CORE CRACKS - HIT IT NOW', '#ffffff');
      g.audio.play('shieldBreak', this.coreWorld(), 1);
      g.addShake(0.5);
    }
    if (this.hp <= 0) { this.hp = 0; this.defeat(); }
    return amount;
  }

  breakHand(h) {
    const g = this.game;
    h.alive = false;
    h.grp.visible = false;
    h.regenT = 16;
    g.fx.explosion(h.pos.clone(), 4, 0xffd27a);
    g.fx.chunks(h.pos.clone(), 0xcac4b2, 22, 12, 0.4);
    g.audio.play('explosion', h.pos, 1);
    g.addShake(0.6);
    g.style.add('HAND SEVERED', 120);
    this.staggerT = 5;
    this.brain.cur = null;
    g.hud.toast('THE CORE IS EXPOSED', '#ffffff');
    g.emit('architectHand');
  }

  // ---------------------------------------------------------------- phases
  toPhase(n) {
    const g = this.game;
    this.phase = n;
    this.state = 'transition';
    this.brain.cur = null;
    g.projectiles.clear();
    const cs = g.cutscene;
    const room = this.room;
    const c = this.coreWorld();
    const pp = g.player.body.pos.clone();
    if (n === 2) {
      for (const h of this.hands) { h.state = 'retreat'; h.t = 0; }
      cs.play([
        { dur: 2.2, cam: { from: c.clone().add(new THREE.Vector3(10, -2, 16)), to: c.clone().add(new THREE.Vector3(6, -1, 11)), look: c, fov: 60 }, sfx: 'bossPhase', shake: 0.6, say: { speaker: this.name, text: this.ng ? 'I kept copies of everything you broke. I kept a copy of you.' : 'You have met my children. They were proud of their work. Meet them again.', color: '#f4f0e0' } },
        { dur: 2.2, cam: { from: pp.clone().add(new THREE.Vector3(0, 9, 8)), to: pp.clone().add(new THREE.Vector3(0, 12, 4)), look: room.origin.clone(), fov: 70 }, say: { speaker: '', text: 'The floor of the Core begins to come apart. The current is showing through.', color: '#9fb' }, fn: () => this.summonEchoes(), must: true },
      ], () => { this.state = 'idle'; this.invuln = 0.5; });
    } else if (n === 3) {
      cs.play([
        { dur: 2.4, cam: { from: c.clone().add(new THREE.Vector3(-6, -3, 9)), to: c.clone().add(new THREE.Vector3(-3, -2, 6)), look: c, fov: 56 }, sfx: 'bossPhase', flash: 0xffffff, say: { speaker: this.name, text: 'Then let us see how you do in the dark. Everyone else was afraid of it.', color: '#f4f0e0' }, fn: () => g.level.setDarkness(true), must: true },
        { dur: 2.0, cam: { from: c.clone().add(new THREE.Vector3(0, -5, 12)), to: c.clone().add(new THREE.Vector3(0, -6, 8)), look: c, fov: 64 }, say: { speaker: 'MARA VOSS', text: 'Its core only cracks from its own power. Parry it back. Flip a coin. Blow it up.', color: '#7fe0b8' } },
      ], () => { this.state = 'idle'; this.invuln = 0.5; this.hoverH = 5.5; this.moveSpeed = 6; for (const h of this.hands) { h.alive = false; h.grp.visible = false; } });
    }
  }

  summonEchoes() {
    const g = this.game;
    const room = this.room;
    const met = (g.run.defeatedBosses || []).map((id) => BOSSES.find((b) => b.id === id)).filter((b) => b && !b.bespoke && b.chassis);
    const pool = met.length >= 2 ? met : BOSSES.filter((b) => !b.bespoke && b.chassis);
    const picks = [];
    while (picks.length < 2 && pool.length) { const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; picks.push(b); }
    picks.forEach((b, i) => {
      const def = {
        ...b, id: 'echo-' + b.id, name: 'ECHO OF ' + b.name, title: 'A COPY THE ARCHITECT KEPT',
        scale: (b.scale || 2.2) * 0.7, enrage: b.phase2 || [], hp: this.ng ? 1700 : 1300, lore: b.lore,
        colors: [0xe8e8f0, 0x202028, 0xffffff],
      };
      const pos = new THREE.Vector3(room.wx(i ? 12 : -12), 0.05, room.wz(2));
      const e = new Miniboss(g, pos, { def, hpMul: 1, dmgMul: this.dmgMul, aggr: 0.9 });
      e.echo = true;
      g.enemies.list.push(e);
      this.echoes.push(e);
    });
    g.hud.toast('ECHOES PROTECT THE CORE', '#9fd8ff');
  }

  // ---------------------------------------------------------------- hands
  updateHands(dt) {
    const g = this.game;
    const pp = g.player.body.pos;
    const room = this.room;
    for (const h of this.hands) {
      h.flashT -= dt;
      const flash = h.flashT > 0;
      if (flash !== h.flashing) { h.flashing = flash; for (const m of h.meshes) m.material = flash ? this.flashMat() : m.userData.mat; }
      if (!h.alive) {
        if (this.phase === 1) { h.regenT -= dt; if (h.regenT <= 0) { h.alive = true; h.hp = h.max * 0.7; h.grp.visible = true; h.pos.copy(h.home); h.state = 'idle'; g.hud.toast('THE HAND REFORMS', '#ffd27a', true); } }
        continue;
      }
      h.t += dt;
      const bob = Math.sin(this.game.time * 1.6 + h.side) * 0.4;
      if (h.state === 'idle') {
        const tgt = h.home.clone(); tgt.y += bob;
        tgt.x += (this.pos.x - room.wx(0)) * 0.6;
        h.pos.lerp(tgt, Math.min(1, dt * 2.5));
        h.grp.rotation.set(0, 0, 0);
      } else if (h.state === 'rise') { // track above the player
        h.target.set(pp.x, 8.5, pp.z);
        h.pos.lerp(h.target, Math.min(1, dt * 5));
        h.grp.rotation.x = -0.3;
        if (h.t > 0.9) {
          h.state = 'slamwind'; h.t = 0;
          h.slamAt = new THREE.Vector3(pp.x, room.floorAt(pp.x, pp.z), pp.z);
          g.fx.telegraphDisc(h.slamAt.x, h.slamAt.y + 0.05, h.slamAt.z, 4, 0xffd27a, 0.75);
          g.audio.play('windup', h.pos, 0.9);
        }
      } else if (h.state === 'slamwind') {
        h.pos.x += (h.slamAt.x - h.pos.x) * Math.min(1, dt * 8);
        h.pos.z += (h.slamAt.z - h.pos.z) * Math.min(1, dt * 8);
        h.pos.y = 8.5 + Math.sin(h.t * 30) * 0.08 + h.t * 1.5;
        if (h.t > 0.75) { h.state = 'slam'; h.t = 0; }
      } else if (h.state === 'slam') {
        h.pos.y = Math.max(h.slamAt.y + 0.7, h.pos.y - dt * 70);
        if (h.pos.y <= h.slamAt.y + 0.71) {
          h.state = 'rest'; h.t = 0;
          const d = Math.hypot(pp.x - h.pos.x, pp.z - h.pos.z);
          if (d < 4.2 && pp.y < h.slamAt.y + 2.2) g.player.damage(32 * this.dmgMul, h.pos, 'THE ARCHITECT\'S HAND', 'Leave the gold circle before the hand comes down, then punish it while it rests.');
          g.enemies.shockwave(h.slamAt.clone(), 14, 16, 16 * this.dmgMul, 0xffd27a, 'HAND SHOCKWAVE', 'Jump the ring that spreads from each slam.');
          g.fx.explosion(h.slamAt.clone().setY(h.slamAt.y + 0.5), 3, 0xffd27a);
          g.audio.play('slam', h.pos, 1);
          g.addShake(0.7);
        }
      } else if (h.state === 'rest') {
        if (h.t > 1.6) { h.state = 'idle'; h.t = 0; }
      } else if (h.state === 'sweepwind') {
        h.target.set(room.wx(h.side * (room.W / 2 - 3)), 1.3, h.sweepZ);
        h.pos.lerp(h.target, Math.min(1, dt * 6));
        h.grp.rotation.set(0, -h.side * Math.PI / 2, 0);
        if (h.t > 1.0) { h.state = 'sweep'; h.t = 0; g.audio.play('swing', h.pos, 1); }
      } else if (h.state === 'sweep') {
        const k = Math.min(1, h.t / 1.3);
        h.pos.x = room.wx(h.side * (room.W / 2 - 3) * (1 - 2 * k));
        h.pos.y = 1.3;
        if (Math.abs(pp.x - h.pos.x) < 2.2 && Math.abs(pp.z - h.sweepZ) < 2.6 && pp.y < 1.9 && !h.hitDone) {
          h.hitDone = true;
          g.player.damage(26 * this.dmgMul, h.pos, 'THE ARCHITECT\'S SWEEP', 'The gold beam on the floor marks the sweep. Jump over the hand.');
          g.player.knock(-h.side * 14, 6, 0);
        }
        if (k >= 1) { h.state = 'idle'; h.t = 0; h.hitDone = false; }
      } else if (h.state === 'retreat') {
        h.pos.lerp(h.home.clone().setY(18), Math.min(1, dt * 1.5));
        if (h.t > 2) { h.alive = false; h.grp.visible = false; }
      }
    }
    // schedule hand attacks (phase 1 only)
    if (this.phase !== 1 || this.state !== 'idle') return;
    this.handT -= dt;
    const avail = this.hands.filter((h) => h.alive && h.state === 'idle');
    if (this.handT <= 0 && avail.length) {
      this.handTurn++;
      const h = avail[this.handTurn % avail.length];
      h.t = 0;
      if (this.handTurn % 3 === 0) {
        h.state = 'sweepwind';
        h.sweepZ = clamp(pp.z, room.wz(-room.D / 2 + 4), room.wz(room.D / 2 - 4));
        g.fx.beam(new THREE.Vector3(room.wx(-room.W / 2), 0.06, h.sweepZ), new THREE.Vector3(room.wx(room.W / 2), 0.06, h.sweepZ), 0xffd27a, 0.25, 1.0);
      } else h.state = 'rise';
      this.handT = (this.ng ? 2.2 : 2.9) * (avail.length === 1 ? 0.8 : 1);
    }
  }

  flashMat() { if (!this._flash) this._flash = basic(0xffffff); return this._flash; }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const g = this.game;
    this.flashT -= dt;
    this.invuln -= dt;
    if (this.dying) { this.updateDeath(dt); return; }
    if (this.state === 'intro') {
      this.intro -= dt;
      this.faceTarget(dt, 2);
      if (this.intro <= 0) { this.state = 'idle'; }
    } else if (this.state === 'idle') {
      if (this.staggerT > 0) {
        this.staggerT -= dt;
        this.pos.y += (this.groundY + 3.5 - this.pos.y) * Math.min(1, dt * 2);
        if (Math.random() < 0.4) g.fx.sparks.spawn(this.pos.x + (Math.random() - 0.5) * 4, this.pos.y, this.pos.z, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3, 1, 0.9, 0.6, 1, 0.12, 0.5, 9, 0);
      } else {
        this.brain.update(dt);
        const floor = this.groundY;
        this.pos.y += (floor + this.hoverH + Math.sin(g.time * 1.2) * 0.5 - this.pos.y) * Math.min(1, dt * 2);
      }
      if (this.phase === 2) {
        this.collapseT -= dt;
        if (this.collapseT <= 0) { this.collapseT = this.ng ? 7 : 9; this.room.addDynamicHazards('electric', 2); }
        if (this.echoes.length && !this.shielded && !this.exposedSaid) { this.exposedSaid = true; g.hud.toast('THE ECHOES ARE GONE - THE CORE IS OPEN', '#ffffff'); }
      }
    }
    this.updateHands(dt);
    this.sync();
    this.animate(dt);
  }

  animate() {
    const t = this.game.time;
    this.halo.rotation.z = t * (this.phase === 3 ? 0.9 : 0.35);
    const pulse = 0.85 + 0.15 * Math.sin(t * 6);
    this.core.scale.setScalar(pulse * (this.staggerT > 0 ? 1.3 : 1));
    this.coreGlow.scale.setScalar(1 + 0.2 * Math.sin(t * 3));
    this.coreMat.color.setHex(this.staggerT > 0 ? 0xffe27a : this.phase === 3 ? 0xff5070 : 0xffffff);
    this.shield.visible = this.shielded;
    this.shield.rotation.y = t * 0.5;
    this.head.rotation.x = this.staggerT > 0 ? 0.35 : Math.sin(t * 0.7) * 0.05;
    for (const h of this.hands) if (h.alive) { h.gem.rotation.y = t * 2; for (let i = 1; i <= 4; i++) { const f = h.grp.children[i]; if (f) f.rotation.x = h.state === 'slam' || h.state === 'rest' ? 0.5 : h.state === 'sweep' ? 0.2 : Math.sin(t * 2 + i) * 0.1; } }
  }

  // ---------------------------------------------------------------- the fall
  defeat() {
    if (!this.alive) return;
    const g = this.game;
    this.alive = false;
    this.dying = true;
    this.deathT = 0;
    g.projectiles.clear();
    for (const e of g.enemies.list) if (e.alive) g.combat.damageEnemy(e, 1e6, { source: 'explosion', fromPlayer: false, quiet: true });
    g.bosses.onDefeated(this);
  }

  updateDeath(dt) {
    const g = this.game;
    this.deathT += dt;
    const floor = this.groundY;
    this.pos.y += (floor + 2.2 - this.pos.y) * Math.min(1, dt * 0.8);
    this.head.rotation.x = Math.min(1.1, this.deathT * 0.35);
    this.halo.rotation.z += dt * (3 - Math.min(2.9, this.deathT));
    if (Math.random() < 0.25 && this.deathT < 4) {
      const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3));
      g.fx.explosion(p, 2 + Math.random() * 2, 0xffd27a);
      g.audio.play('explosion', p, 0.6);
    }
    for (const h of this.hands) if (h.alive && h.grp.visible) { h.pos.y = Math.max(0.5, h.pos.y - dt * 3); }
    this.sync();
  }

  remove() {
    super.remove();
    for (const h of this.hands) { this.game.scene.remove(h.grp); h.grp.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    for (const e of this.echoes) if (e.alive) e.remove && e.remove();
  }
}

// The breaker the player pulls at the very end.
export function buildBreaker(scene, pos) {
  const grp = new THREE.Group();
  const dark = lam('gun', 0x2a2a34), bone = lam('panel', 0xd8d2c0, 0.05), red = basic(0xff3050), glow = basic(0xffd27a);
  grp.add(mesh(new THREE.BoxGeometry(2.4, 2.6, 1.0), dark, 0, 1.3, 0));
  grp.add(mesh(new THREE.BoxGeometry(2.0, 0.2, 0.2), glow, 0, 2.7, 0.45));
  const lever = new THREE.Group();
  lever.position.set(0, 1.7, 0.55);
  lever.add(mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), bone, 0, 0.75, 0));
  lever.add(mesh(new THREE.BoxGeometry(0.6, 0.3, 0.3), red, 0, 1.5, 0));
  lever.rotation.x = -0.6;
  grp.add(lever);
  grp.position.copy(pos);
  scene.add(grp);
  return { grp, lever, pos: pos.clone() };
}
