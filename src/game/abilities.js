import * as THREE from 'three';
import { segPointDist2, moveBody, clamp } from '../core/collide.js';

// Reusable, telegraphed attack modules shared by every boss and miniboss. Each module
// has a wind-up the player can read, an active part, and parameters that data entries
// tune (counts, speeds, damage). Modules return true from update() when finished.

const V = () => new THREE.Vector3();
const tip = {
  fan: 'Fans have gaps: strafe between the orbs or dash through.',
  burst: 'A flickering laser means a burst is coming. Break line of sight.',
  spiral: 'Spirals rotate: move with the rotation and slip through the gaps.',
  ring: 'Low orb rings can be jumped. Look for the gap.',
  homing: 'Yellow seekers are slow and parryable. Punch them back.',
  mortar: 'Leave the red circles before they fill.',
  shockwave: 'Jump over expanding shockwave rings.',
  charge: 'A painted lane means a charge. Sidestep or dash out of it.',
  lunge: 'Lunges follow the painted lane. Dash sideways at the last moment.',
  sweep: 'A circle around the enemy means a spin. Jump it or dash out.',
  laser: 'Sweeping lasers sit at waist height: slide under or jump over.',
  snipe: 'Red laser = aiming, white flash = firing. Break line of sight.',
  mines: 'Mines detonate after their circles flash. Keep moving.',
  eruption: 'Eruptions chase your position. Never stand still on a circle.',
  pull: 'The vortex drags you in. Dash away from it.',
  flame: 'Flame cones are short range. Keep your distance.',
  rain: 'Glowing circles mark where debris falls.',
  leap: 'It lands on the circle. Get off it.',
  zap: 'Flashing floor zones electrify. Get out, or stay airborne.',
  spokes: 'Jump the rotating floor beams.',
  orbital: 'The orbital beam follows you with a delay. Keep moving.',
  bounce: 'Bouncing orbs rebound off walls. Watch the angles.',
};

function aimAt(a, from) {
  const g = a.game;
  const t = g.camera.position.clone();
  t.y -= 0.4;
  const pv = g.player.body.vel;
  const dist = from.distanceTo(t);
  t.x += pv.x * dist * 0.012; t.z += pv.z * dist * 0.012;
  return t;
}

function shoot(a, from, dir, speed, dmg, opts = {}) {
  a.game.projectiles.spawnEnemy(from, dir.clone().normalize().multiplyScalar(speed), dmg * a.dmgMul, {
    color: opts.color || a.color, radius: opts.radius || 0.24, size: opts.size || 0.24, owner: a.isEnemy ? a : null,
    cause: a.name + (opts.what ? ' ' + opts.what : ''), tip: opts.tip, homing: opts.homing || 0, life: opts.life || 4, parryable: opts.parryable !== false,
    explode: opts.explode || 0, gravity: opts.gravity || 0, kind: opts.kind, bounces: opts.bounces || 0, trail: opts.trail,
  });
}

export const MODULES = {
  fan: {
    def: { n: 5, spread: 0.14, speed: 20, volleys: 2, dmg: 10, wind: 0.5, gap: 0.35, range: [0, 60], cd: 2.5 },
    start(a, s, p) { s.v = p.volleys; s.next = p.wind; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.6); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 5);
      if (s.t < s.next) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      const to = aimAt(a, from);
      const base = Math.atan2(to.x - from.x, to.z - from.z);
      const flat = Math.hypot(to.x - from.x, to.z - from.z);
      const dy = (to.y - from.y) / Math.max(1, flat);
      const off = (s.v % 2) * p.spread * 0.5;
      for (let i = 0; i < p.n; i++) {
        const ang = base + (i - (p.n - 1) / 2) * p.spread + off;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang), dy, Math.cos(ang)), p.speed, p.dmg, { tip: tip.fan, what: 'FAN' });
      }
      a.game.audio.play('enemyShot', a.pos, 0.9);
      s.v--; s.next += p.gap;
      return s.v <= 0;
    },
  },
  burst: {
    def: { n: 5, speed: 36, dmg: 7, wind: 0.7, gap: 0.1, spread: 0.06, range: [0, 45], cd: 2.6 },
    start(a, s) { s.fired = 0; s.next = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.5); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 6);
      const from = a.muzzle();
      if (s.t < p.wind) { if (Math.random() < 0.7) a.game.fx.beam(from, a.game.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0)), 0xffe23a, 0.03, 0.05); return false; }
      a.anim.wind = false; a.anim.act = true;
      if (s.t - p.wind >= s.next) {
        const to = aimAt(a, from);
        const dir = to.sub(from).normalize();
        dir.x += (Math.random() - 0.5) * p.spread; dir.y += (Math.random() - 0.5) * p.spread * 0.5; dir.z += (Math.random() - 0.5) * p.spread;
        shoot(a, from.clone(), dir, p.speed, p.dmg, { color: 0xffe23a, radius: 0.14, size: 0.13, tip: tip.burst, what: 'BURST' });
        a.game.audio.play('enemyBurst', a.pos, 0.6);
        s.fired++; s.next += p.gap;
      }
      return s.fired >= p.n;
    },
  },
  spiral: {
    def: { arms: 3, dur: 3, rate: 0.14, speed: 11, dmg: 8, turn: 0.24, range: [0, 50], cd: 4 },
    start(a, s) { s.a = Math.random() * 6; s.next = 0.3; a.anim.wind = true; },
    update(a, s, p) {
      if (s.t < 0.3) return false;
      a.anim.wind = false; a.anim.act = true;
      while (s.t >= s.next) {
        s.next += p.rate;
        const c = a.center();
        const y = Math.min(c.y, a.groundY + 1.3);
        for (let k = 0; k < p.arms; k++) {
          const ang = s.a + (k / p.arms) * Math.PI * 2;
          shoot(a, new THREE.Vector3(c.x, y, c.z), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { tip: tip.spiral, trail: false, what: 'SPIRAL' });
        }
        s.a += p.turn;
      }
      return s.t > p.dur;
    },
  },
  ring: {
    def: { n: 16, speed: 12, dmg: 10, rings: 2, gap: 0.7, wind: 0.6, range: [0, 40], cd: 3.5 },
    start(a, s) { s.r = 0; s.next = 0; a.anim.wind = true; a.game.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, 2.5, a.color, 0.6); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false;
      if (s.t - p.wind >= s.next) {
        const c = a.center();
        const gapAt = Math.floor(Math.random() * p.n);
        const off = Math.random() * 6;
        for (let i = 0; i < p.n; i++) {
          if (i === gapAt || i === (gapAt + 1) % p.n) continue;
          const ang = off + (i / p.n) * Math.PI * 2;
          shoot(a, new THREE.Vector3(c.x, a.groundY + 0.6, c.z), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { tip: tip.ring, what: 'RING', trail: false });
        }
        a.game.audio.play('enemyShot', a.pos, 0.8);
        s.r++; s.next += p.gap;
      }
      return s.r >= p.rings;
    },
  },
  homing: {
    def: { n: 3, speed: 10, turn: 1.5, dmg: 14, wind: 0.6, range: [0, 60], cd: 4 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      for (let i = 0; i < p.n; i++) {
        const ang = a.yaw + (i - (p.n - 1) / 2) * 0.7;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang) * 0.8, 0.5, Math.cos(ang) * 0.8), p.speed, p.dmg, { color: 0xffe23a, radius: 0.3, size: 0.3, homing: p.turn, life: 6, tip: tip.homing, what: 'SEEKER' });
      }
      a.game.audio.play('radio', a.pos, 0.8);
      return true;
    },
  },
  mortar: {
    def: { n: 3, radius: 3, flight: 1.2, dmg: 22, scatter: 4, wind: 0.5, range: [6, 60], cd: 3.5 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const g = a.game;
      const pp = g.player.body.pos;
      const room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const tgt = new THREE.Vector3(pp.x + (i ? (Math.random() - 0.5) * p.scatter * 2 : g.player.body.vel.x * 0.5), 0, pp.z + (i ? (Math.random() - 0.5) * p.scatter * 2 : g.player.body.vel.z * 0.5));
        if (room) { tgt.x = clamp(tgt.x, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1); tgt.z = clamp(tgt.z, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1); }
        tgt.y = room ? room.floorAt(tgt.x, tgt.z) : 0;
        g.projectiles.spawnMortar(a.muzzle(), tgt, p.dmg * a.dmgMul, p.radius, p.flight + i * 0.12, { cause: a.name + ' MORTAR', color: a.color });
      }
      g.audio.play('launcher', a.pos, 0.8);
      return true;
    },
  },
  shockwave: {
    def: { rings: 1, maxR: 16, speed: 11, dmg: 20, wind: 0.8, gap: 0.5, range: [0, 14], cd: 3.5 },
    start(a, s) { s.r = 0; s.next = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.9); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      if (s.t - p.wind >= s.next) {
        a.game.enemies.shockwave(a.pos.clone().setY(a.groundY), p.maxR, p.speed * a.speedMul, p.dmg * a.dmgMul, a.color, a.name + ' SHOCKWAVE', tip.shockwave);
        a.game.audio.play('slam', a.pos, 1);
        a.game.addShake(0.3);
        s.r++; s.next += p.gap;
      }
      return s.r >= p.rings;
    },
  },
  charge: {
    def: { speed: 24, maxT: 2, dmg: 28, wind: 0.9, stun: 2.0, count: 1, range: [6, 60], cd: 4, ground: true },
    start(a, s) { s.mode = 'wind'; s.c = 0; s.wt = 0; a.anim.wind = true; a.game.audio.play('bossCharge', a.pos, 0.9); },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        s.wt += dt;
        if (s.wt < p.wind - 0.2) a.faceTarget(dt, 7);
        const o = a.pos.clone().setY(a.groundY + 0.06);
        g.fx.beam(o, o.clone().add(new THREE.Vector3(Math.sin(a.yaw) * 40, 0, Math.cos(a.yaw) * 40)), 0xff3020, a.radius * 1.6, 0.03, false);
        if (s.wt >= p.wind) { s.mode = 'go'; s.gt = 0; s.hit = false; a.anim.wind = false; a.anim.act = true; a.anim.moving = true; g.audio.play('lunge', a.pos, 1); }
        return false;
      }
      if (s.mode === 'go') {
        s.gt += dt;
        const v = p.speed * a.speedMul;
        const blocked = a.slide(Math.sin(a.yaw) * v * dt, Math.cos(a.yaw) * v * dt);
        const pp = g.player.body.pos;
        if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < a.radius + 1.0 && pp.y < a.groundY + a.height) {
          s.hit = true;
          if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' CHARGE', tip.charge)) g.player.knock(Math.sin(a.yaw) * 12, 6, Math.cos(a.yaw) * 12);
        }
        if (blocked || s.gt > p.maxT) {
          if (blocked) { g.addShake(0.45); g.audio.play('slam', a.pos, 1); g.fx.chunks(a.center(), 0x777777, 8, 7, 0.25); a.onWallImpact && a.onWallImpact(); }
          s.c++;
          a.anim.moving = false;
          if (blocked && s.c >= p.count) { a.stun(p.stun * (a.brokePillar ? 1.7 : 1)); a.brokePillar = false; return true; }
          if (s.c < p.count) { s.mode = 'wind'; s.wt = 0.3; a.anim.wind = true; return false; }
          return true;
        }
      }
      return false;
    },
  },
  lunge: {
    def: { speed: 22, dist: 12, dmg: 24, wind: 0.5, count: 1, range: [3, 16], cd: 2.8, ground: true },
    start(a, s) { s.mode = 'wind'; s.c = 0; s.wt = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8); },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        s.wt += dt;
        a.faceTarget(dt, 10);
        const o = a.pos.clone().setY(a.groundY + 0.06);
        g.fx.beam(o, o.clone().add(new THREE.Vector3(Math.sin(a.yaw) * p.dist, 0, Math.cos(a.yaw) * p.dist)), a.color, a.radius * 1.2, 0.03, false);
        if (s.wt >= p.wind) { s.mode = 'go'; s.gt = 0; s.hit = false; a.anim.wind = false; a.anim.act = true; g.audio.play('lunge', a.pos, 1); }
        return false;
      }
      s.gt += dt;
      const v = p.speed * a.speedMul;
      const blocked = a.slide(Math.sin(a.yaw) * v * dt, Math.cos(a.yaw) * v * dt);
      const pp = g.player.body.pos;
      if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < a.radius + 1.2 && pp.y < a.groundY + a.height) {
        s.hit = true;
        if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' LUNGE', tip.lunge)) g.player.knock(Math.sin(a.yaw) * 9, 4, Math.cos(a.yaw) * 9);
        g.audio.play('slash', a.pos, 1);
      }
      if (blocked) { a.stun(1.6); return true; }
      if (s.gt > p.dist / v) { s.c++; if (s.c < p.count) { s.mode = 'wind'; s.wt = 0.25; a.anim.wind = true; return false; } return true; }
      return false;
    },
  },
  sweep: {
    def: { radius: 4.5, dmg: 24, wind: 0.65, range: [0, 6], cd: 3, ground: true },
    start(a, s, p) { a.anim.wind = true; a.game.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, p.radius * Math.max(1, a.size * 0.8), a.color, p.wind); a.game.audio.play('windup', a.pos, 0.9); },
    update(a, s, p, dt) {
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      a.spin = (a.spin || 0) + dt * 18;
      const g = a.game;
      const pp = g.player.body.pos;
      const r = p.radius * Math.max(1, a.size * 0.8);
      if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < r && pp.y < a.groundY + 1.15) {
        s.hit = true;
        if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' SWEEP', tip.sweep)) { const d = Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) || 1; g.player.knock((pp.x - a.pos.x) / d * 9, 4, (pp.z - a.pos.z) / d * 9); }
      }
      if (!s.snd) { s.snd = true; g.audio.play('slash', a.pos, 1); }
      g.fx.sparksBurst(a.pos.clone().setY(a.groundY + 1), a.color, 2, 10, 0.2);
      if (s.t > p.wind + 0.45) { a.spin = 0; return true; }
      return false;
    },
  },
  laser: {
    def: { arc: 3.6, dur: 2, height: 1.0, dmg: 26, wind: 1.0, length: 40, dir: 0, range: [0, 60], cd: 6 },
    start(a, s, p) { s.dir = p.dir || (Math.random() < 0.5 ? 1 : -1); a.anim.wind = true; a.game.audio.play('laser', a.pos, 1); s.base = null; },
    update(a, s, p) {
      const g = a.game;
      const pp = g.player.body.pos;
      if (s.base === null) s.base = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z) - s.dir * p.arc / 2;
      const y = a.groundY + p.height;
      const from = new THREE.Vector3(a.pos.x, y, a.pos.z);
      const prog = s.t < p.wind ? 0 : Math.min(1, (s.t - p.wind) / p.dur);
      const ang = s.base + s.dir * p.arc * prog;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const w = g.combat.rayWorld(from, dir, p.length);
      const to = from.clone().addScaledVector(dir, w ? w.t : p.length);
      if (s.t < p.wind) { g.fx.beam(from, to, a.color, 0.03, 0.03, false); return false; }
      a.anim.wind = false; a.anim.act = true;
      g.fx.beam(from, to, a.color, 0.28, 0.03, false);
      g.fx.beam(from, to, 0xffffff, 0.1, 0.03, false);
      if (!s.hit && segPointDist2(from.x, y, from.z, to.x, y, to.z, pp.x, y, pp.z) < 0.25 && pp.y < y + 0.12 && pp.y + g.player.body.h > y - 0.1) {
        s.hit = true;
        g.player.damage(p.dmg * a.dmgMul, from, a.name + ' LASER', tip.laser);
      }
      return prog >= 1;
    },
  },
  snipe: {
    def: { aim: 1.4, lock: 0.35, dmg: 30, range: [8, 80], cd: 4 },
    start(a, s) { s.aim = a.muzzle().clone().add(new THREE.Vector3(Math.sin(a.yaw) * 5, -1, Math.cos(a.yaw) * 5)); a.anim.wind = true; },
    update(a, s, p, dt) {
      const g = a.game;
      const from = a.muzzle();
      const cam = g.camera.position;
      if (s.t < p.aim) s.aim.lerp(cam.clone().add(new THREE.Vector3(0, -0.3, 0)), Math.min(1, dt * 3));
      a.face(s.aim.x, s.aim.z, dt, 8);
      const dir = s.aim.clone().sub(from).normalize();
      const w = g.combat.rayWorld(from, dir, 200);
      const end = from.clone().addScaledVector(dir, w ? w.t : 200);
      if (s.t < p.aim) { g.fx.beam(from, end, 0xff2040, 0.025, 0.03, false); if (Math.random() < 0.1) g.audio.play('sniperAim', a.pos, 0.4); return false; }
      if (s.t < p.aim + p.lock) { if (!s.locked) { s.locked = true; g.audio.play('sniperLock', a.pos, 0.9); } g.fx.beam(from, end, Math.random() < 0.5 ? 0xffffff : 0xff2040, 0.07, 0.03, false); return false; }
      a.anim.wind = false; a.anim.act = true;
      g.fx.beam(from, end, 0xffffff, 0.14, 0.25);
      g.fx.beam(from, end, 0xff2040, 0.3, 0.35);
      g.audio.play('sniperFire', a.pos, 1);
      const pp = g.player.body.pos;
      if (segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 0.9, pp.z) < 0.36 || segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 1.5, pp.z) < 0.2) {
        g.player.damage(p.dmg * a.dmgMul, from, a.name + ' RAIL', tip.snipe);
      }
      if (w) g.fx.impact(end, new THREE.Vector3(w.nx, w.ny, w.nz), 'energy', 1.5);
      return true;
    },
  },
  summon: {
    def: { types: ['husk', 'ripper'], n: 3, wind: 0.8, range: [0, 80], cd: 12 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('backup', a.pos, 0.8); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false;
      a.game.director.spawnSummons(p.types, p.n, a.pos);
      a.game.hud.toast(a.name + ' CALLS REINFORCEMENTS', '#ff8a3a', true);
      return true;
    },
  },
  blink: {
    def: { wind: 0.55, range: [0, 80], cd: 5, then: true },
    start(a, s) {
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      let best = null;
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2, r = 9 + Math.random() * 6;
        const x = pp.x + Math.cos(ang) * r, z = pp.z + Math.sin(ang) * r;
        if (room && !room.containsXZ(x, z, 2.5)) continue;
        if (!a.flying && room && !room.nav.free(room.nav.idx(x, z))) continue;
        best = new THREE.Vector3(x, a.flying ? a.pos.y : room.floorAt(x, z), z); break;
      }
      s.to = best;
      if (best) a.game.fx.spawnColumn(best.x, best.y, best.z, a.color, 0.6, 5);
    },
    update(a, s, p) {
      if (!s.to) return true;
      if (s.t < p.wind) return false;
      a.game.fx.spawnColumn(a.pos.x, a.groundY, a.pos.z, a.color, 0.4, 5);
      a.teleport(s.to);
      a.game.audio.play('spawn', a.pos, 0.9);
      return true;
    },
  },
  barrier: {
    def: { hp: 220, dur: 7, range: [5, 60], cd: 12 },
    start() {},
    update(a, s, p) { a.game.bosses.makeBarrier(a.pos, p.hp * (a.hpScale || 1), p.dur); return true; },
  },
  mines: {
    def: { n: 5, delay: 1.6, radius: 2.6, dmg: 20, spreadR: 6, range: [0, 60], cd: 6 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p) {
      if (s.t < 0.3) return false;
      a.anim.wind = false;
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const x = pp.x + (Math.random() - 0.5) * p.spreadR * 2, z = pp.z + (Math.random() - 0.5) * p.spreadR * 2;
        if (room && !room.containsXZ(x, z, 0.5)) continue;
        const y = room ? room.floorAt(x, z) : 0;
        g.fx.telegraphDisc(x, y, z, p.radius, a.color, p.delay);
        g.enemies.delayed(p.delay, () => {
          const c = new THREE.Vector3(x, y + 0.5, z);
          g.fx.explosion(c, p.radius, a.color);
          g.audio.play('explosion', c, 0.6);
          g.combat.radialDamage(c, p.radius, p.dmg * a.dmgMul, { source: 'explosion', friendly: true, cause: a.name + ' MINE', tip: tip.mines });
        });
      }
      g.audio.play('beep', a.pos, 0.8);
      return true;
    },
  },
  eruption: {
    def: { n: 4, interval: 0.45, radius: 2.0, dmg: 22, warn: 0.7, range: [0, 60], cd: 5 },
    start(a, s) { s.c = 0; s.next = 0; a.anim.wind = true; },
    update(a, s, p) {
      const g = a.game;
      if (s.t >= s.next && s.c < p.n) {
        const pp = g.player.body.pos;
        const room = g.level.current;
        const x = pp.x + g.player.body.vel.x * 0.25, z = pp.z + g.player.body.vel.z * 0.25;
        const y = room ? room.floorAt(x, z) : 0;
        g.fx.telegraphDisc(x, y, z, p.radius, 0xff6010, p.warn);
        g.enemies.delayed(p.warn, () => {
          g.fx.spawnColumn(x, y, z, 0xff6010, 0.5, 6);
          g.fx.sparksBurst(new THREE.Vector3(x, y + 0.5, z), 0xff8030, 14, 9, 0.5);
          g.audio.play('slam', new THREE.Vector3(x, y, z), 0.6);
          const q = g.player.body.pos;
          if (Math.hypot(q.x - x, q.z - z) < p.radius && q.y < y + 2.5) g.player.damage(p.dmg * a.dmgMul, new THREE.Vector3(x, y, z), a.name + ' ERUPTION', tip.eruption);
        });
        s.c++; s.next += p.interval;
      }
      if (s.c >= p.n) a.anim.wind = false;
      return s.c >= p.n && s.t > s.next + p.warn;
    },
  },
  pull: {
    def: { dur: 2.2, strength: 9, dps: 14, range: [0, 30], cd: 7 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('laser', a.pos, 0.8); },
    update(a, s, p, dt) {
      const g = a.game;
      const pp = g.player.body.pos;
      const c = a.center();
      const dx = c.x - pp.x, dz = c.z - pp.z, d = Math.hypot(dx, dz) || 1;
      if (d < 26) { g.player.body.vel.x += dx / d * p.strength * dt * 4; g.player.body.vel.z += dz / d * p.strength * dt * 4; }
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
        g.fx.sparks.spawn(c.x + Math.cos(ang) * r, a.groundY + 0.5 + Math.random() * 2, c.z + Math.sin(ang) * r, -Math.cos(ang) * r * 1.5, 0, -Math.sin(ang) * r * 1.5, 0.7, 0.5, 1, 1, 0.12, 0.5, 0, 0);
      }
      if (d < a.radius + 1.6) { s.acc = (s.acc || 0) + dt; if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, c, a.name + ' VORTEX', tip.pull); } }
      if (s.t > p.dur) { a.anim.wind = false; return true; }
      return false;
    },
  },
  flame: {
    def: { dur: 1.6, range: [0, 12], speed: 14, cone: 0.35, dmg: 5, rate: 0.05, cd: 4 },
    start(a, s) { s.next = 0.35; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.6); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 2.5);
      if (s.t < 0.35) return false;
      a.anim.wind = false; a.anim.act = true;
      while (s.t >= s.next) {
        s.next += p.rate;
        const from = a.muzzle();
        const to = aimAt(a, from);
        const dir = to.sub(from).normalize();
        dir.x += (Math.random() - 0.5) * p.cone; dir.y += (Math.random() - 0.5) * p.cone * 0.4; dir.z += (Math.random() - 0.5) * p.cone;
        shoot(a, from.clone(), dir, p.speed, p.dmg, { color: 0xff7020, radius: 0.35, size: 0.2, life: 0.75, parryable: false, tip: tip.flame, what: 'FLAMES', trail: false });
      }
      if (Math.random() < 0.2) a.game.audio.play('sizzle', a.pos, 0.6);
      return s.t > p.dur;
    },
  },
  shield: {
    def: { dur: 7, every: 1.4, range: [0, 80], cd: 14 },
    start(a, s) { a.shieldUp = true; a.game.hud.toast(a.name + ' RAISES A SHIELD - PARRY ITS SEEKERS BACK', '#ffe23a', true); a.game.audio.play('shieldBreak', a.pos, 0.6); s.next = 0.6; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (!a.shieldUp) return true;
      if (s.t >= s.next) {
        s.next += p.every;
        const from = a.muzzle();
        const to = aimAt(a, from);
        shoot(a, from, to.sub(from), 9, 12, { color: 0xffe23a, radius: 0.32, size: 0.32, homing: 1.2, life: 6, tip: 'Shielded: punch the yellow seekers back to break the shield.', what: 'SEEKER' });
      }
      if (s.t > p.dur) { a.shieldUp = false; return true; }
      return false;
    },
  },
  rain: {
    def: { n: 10, area: 7, dmg: 12, warn: 0.9, range: [0, 80], cd: 6 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.7); },
    update(a, s, p) {
      if (s.t < 0.4) return false;
      a.anim.wind = false;
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const x = pp.x + (i === 0 ? 0 : (Math.random() - 0.5) * p.area * 2), z = pp.z + (i === 0 ? 0 : (Math.random() - 0.5) * p.area * 2);
        if (room && !room.containsXZ(x, z, 0.5)) continue;
        const y = room ? room.floorAt(x, z) : 0;
        const top = room ? room.spec.H - 0.5 : 10;
        const delay = p.warn + Math.random() * 0.6;
        g.fx.telegraphDisc(x, y, z, 1.2, a.color, delay);
        g.enemies.delayed(delay - (top - y) / 30, () => shoot(a, new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), 30, p.dmg, { radius: 0.4, size: 0.35, explode: 1.6, tip: tip.rain, what: 'DEBRIS', parryable: false }));
      }
      return true;
    },
  },
  leap: {
    def: { flight: 0.95, dmg: 22, wind: 0.45, radius: 4, range: [6, 30], cd: 5, ground: true },
    start(a, s) { s.mode = 'wind'; a.anim.wind = true; },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        a.faceTarget(dt, 8);
        if (s.t >= p.wind) {
          const pp = g.player.body.pos;
          s.from = a.pos.clone(); s.to = new THREE.Vector3(pp.x, 0, pp.z);
          const room = g.level.current;
          if (room) { s.to.x = clamp(s.to.x, room.origin.x - room.W / 2 + 2, room.origin.x + room.W / 2 - 2); s.to.z = clamp(s.to.z, room.origin.z - room.D / 2 + 2, room.origin.z + room.D / 2 - 2); s.to.y = room.floorAt(s.to.x, s.to.z); }
          g.fx.telegraphDisc(s.to.x, s.to.y, s.to.z, p.radius, a.color, p.flight);
          s.mode = 'air'; s.at = 0; a.anim.wind = false; a.anim.act = true;
          g.audio.play('jump', a.pos, 1);
        }
        return false;
      }
      s.at += dt;
      const k = Math.min(1, s.at / p.flight);
      a.pos.lerpVectors(s.from, s.to, k);
      a.pos.y = s.from.y + (s.to.y - s.from.y) * k + Math.sin(k * Math.PI) * 6;
      if (k >= 1) {
        a.pos.y = s.to.y;
        g.addShake(0.5);
        g.audio.play('slam', a.pos, 1);
        g.enemies.shockwave(a.pos.clone(), 10, 10, p.dmg * 0.8 * a.dmgMul, a.color, a.name + ' IMPACT', tip.leap);
        const pp = g.player.body.pos;
        if (Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < p.radius * 0.7 && pp.y < a.pos.y + 2) g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' LEAP', tip.leap);
        a.stun(0.8);
        return true;
      }
      return false;
    },
  },
  zap: {
    def: { dur: 2.4, warn: 1.0, dps: 28, size: 7, range: [0, 80], cd: 7 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos;
      s.cx = pp.x; s.cz = pp.z;
      const room = g.level.current;
      s.y = room ? room.floorAt(s.cx, s.cz) : 0;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) g.fx.telegraphDisc(s.cx + ox * p.size * 0.3, s.y, s.cz + oz * p.size * 0.3, p.size * 0.35, 0x40a0ff, p.warn);
      g.audio.play('zap', a.pos, 0.6);
    },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.t < p.warn) return false;
      if (Math.random() < 0.6) { const x = s.cx + (Math.random() - 0.5) * p.size, z = s.cz + (Math.random() - 0.5) * p.size; g.fx.tracer(new THREE.Vector3(x, s.y + 0.05, z), new THREE.Vector3(x + (Math.random() - 0.5), s.y + 0.6, z + (Math.random() - 0.5)), 0x80c0ff, 0.1); }
      const pp = g.player.body.pos;
      if (Math.abs(pp.x - s.cx) < p.size / 2 && Math.abs(pp.z - s.cz) < p.size / 2 && pp.y < s.y + 0.2) {
        s.acc = (s.acc || 0) + dt;
        if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, null, a.name + ' FLOOR SURGE', tip.zap); g.audio.play('zap', null, 0.4); }
      }
      return s.t > p.warn + p.dur;
    },
  },
  spokes: {
    def: { n: 3, speed: 0.6, dur: 5, dmg: 16, len: 18, range: [0, 80], cd: 9 },
    start(a, s) { s.ang = Math.random() * 6; s.cd = 0; },
    update(a, s, p, dt) {
      const g = a.game;
      s.ang += dt * p.speed * a.speedMul * (s.t < 0.8 ? 0.2 : 1);
      s.cd -= dt;
      const pp = g.player.body.pos;
      for (let k = 0; k < p.n; k++) {
        const ang = s.ang + (k / p.n) * Math.PI * 2;
        const from = new THREE.Vector3(a.pos.x, a.groundY + 0.4, a.pos.z);
        const to = from.clone().add(new THREE.Vector3(Math.sin(ang) * p.len, 0, Math.cos(ang) * p.len));
        g.fx.beam(from, to, s.t < 0.8 ? 0x803040 : 0xff3050, s.t < 0.8 ? 0.06 : 0.2, 0.03, false);
        if (s.t > 0.8 && s.cd <= 0 && segPointDist2(from.x, 0, from.z, to.x, 0, to.z, pp.x, 0, pp.z) < 0.2 && pp.y < a.groundY + 0.55) {
          s.cd = 0.7;
          g.player.damage(p.dmg * a.dmgMul, from, a.name + ' SPOKE', tip.spokes);
        }
      }
      return s.t > p.dur;
    },
  },
  orbital: {
    def: { dur: 3.5, speed: 4.5, radius: 1.4, dps: 30, range: [0, 80], cd: 8 },
    start(a, s) { const pp = a.game.player.body.pos; s.p = new THREE.Vector3(pp.x + 4, 0, pp.z + 4); a.game.audio.play('laser', a.pos, 0.9); },
    update(a, s, p, dt) {
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      const dx = pp.x - s.p.x, dz = pp.z - s.p.z, d = Math.hypot(dx, dz) || 1;
      const sp = Math.min(d, p.speed * dt);
      s.p.x += dx / d * sp; s.p.z += dz / d * sp;
      const y = room ? room.floorAt(s.p.x, s.p.z) : 0;
      const top = room ? room.spec.H : 12;
      g.fx.beam(new THREE.Vector3(s.p.x, top, s.p.z), new THREE.Vector3(s.p.x, y, s.p.z), s.t < 0.6 ? 0x802030 : 0xff2040, s.t < 0.6 ? 0.15 : p.radius, 0.03, false);
      if (s.t > 0.6 && d < p.radius * 0.8) { s.acc = (s.acc || 0) + dt; if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, s.p, a.name + ' ORBITAL', tip.orbital); } }
      if (Math.random() < 0.3) g.fx.sparks.spawn(s.p.x, y + 0.1, s.p.z, (Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4, 1, 0.3, 0.3, 1, 0.12, 0.4, 8, 0);
      return s.t > p.dur;
    },
  },
  bounce: {
    def: { n: 4, speed: 14, dmg: 12, bounces: 3, wind: 0.5, range: [0, 60], cd: 4 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 5);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      for (let i = 0; i < p.n; i++) {
        const ang = a.yaw + (i - (p.n - 1) / 2) * 0.5;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { color: 0x60ffd0, radius: 0.3, size: 0.3, bounces: p.bounces, life: 5, tip: tip.bounce, what: 'BOUNCER' });
      }
      a.game.audio.play('enemyShot', a.pos, 0.9);
      return true;
    },
  },
};

export const MODULE_IDS = Object.keys(MODULES);

// ---------------------------------------------------------------------------------------
// Brain: schedules modules for an actor, handles phases and movement styles.
// ---------------------------------------------------------------------------------------
export class Brain {
  constructor(actor, abilities, phase2, phase3) {
    this.a = actor;
    this.sets = [abilities || [], phase2 || [], phase3 || []];
    this.cur = null;
    this.cds = new Map();
    this.idleT = 1.0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 2;
  }
  list() {
    const ph = this.a.phase || 1;
    let out = [...this.sets[0]];
    if (ph >= 2) out = out.concat(this.sets[1]);
    if (ph >= 3) out = out.concat(this.sets[2]);
    return out;
  }
  update(dt) {
    const a = this.a;
    for (const [k, v] of this.cds) this.cds.set(k, v - dt);
    if (this.cur) {
      const c = this.cur;
      c.s.t += dt;
      let done = false;
      try { done = c.mod.update(a, c.s, c.p, dt); } catch (e) { done = true; a.game.lastError = String(e && e.stack || e); }
      if (done) {
        this.cds.set(c.key, c.p.cd * (a.cdMul || 1));
        this.cur = null;
        a.anim.wind = false; a.anim.act = false;
        this.idleT = (0.55 + Math.random() * 0.6) * (a.cdMul || 1) * (a.isBoss ? 1 : 1.25);
      }
      return;
    }
    this.move(dt);
    this.idleT -= dt;
    if (this.idleT > 0) return;
    const pp = a.game.player.body.pos;
    const dist = Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z);
    const ready = [];
    this.list().forEach((entry, i) => {
      const [id, params] = entry;
      const mod = MODULES[id];
      if (!mod) return;
      const p = { ...mod.def, ...(params || {}) };
      const key = id + i;
      if ((this.cds.get(key) || 0) > 0) return;
      if (p.ground && a.flying) return;
      if (dist < p.range[0] || dist > p.range[1]) return;
      if (id === 'summon' && a.game.enemies.aliveCount > 6) return;
      ready.push({ id, mod, p, key, w: p.weight || 1 });
    });
    if (!ready.length) { this.idleT = 0.3; return; }
    let r = Math.random() * ready.reduce((s, x) => s + x.w, 0);
    let pick = ready[0];
    for (const x of ready) { r -= x.w; if (r <= 0) { pick = x; break; } }
    pick.s = { t: 0 };
    this.cur = pick;
    a.anim.moving = false;
    try { pick.mod.start(a, pick.s, pick.p); } catch (e) { this.cur = null; a.game.lastError = String(e && e.stack || e); }
  }
  move(dt) {
    const a = this.a;
    const g = a.game;
    const pp = g.player.body.pos;
    const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    const sp = a.moveSpeed * a.speedMul;
    const style = a.moveStyle;
    a.faceTarget(dt, 5);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.5 + Math.random() * 2; }
    let vx = 0, vz = 0;
    if (style === 'chase') { if (d > a.radius + 2.5) { vx = dx / d * sp; vz = dz / d * sp; } }
    else if (style === 'kite') {
      const want = a.prefDist || 13;
      const k = d < want - 3 ? -1 : d > want + 4 ? 1 : 0;
      vx = dx / d * sp * k - dz / d * sp * 0.7 * this.strafe;
      vz = dz / d * sp * k + dx / d * sp * 0.7 * this.strafe;
    } else if (style === 'circle' || style === 'hover') {
      const want = a.prefDist || 12;
      const k = d < want - 2 ? -0.8 : d > want + 5 ? 0.8 : 0;
      vx = dx / d * sp * k - dz / d * sp * this.strafe;
      vz = dz / d * sp * k + dx / d * sp * this.strafe;
    } else if (style === 'stationary') { vx = 0; vz = 0; }
    a.anim.moving = Math.hypot(vx, vz) > 0.3;
    if (vx || vz) a.moveVel(dt, vx, vz);
  }
}

// helper for actors that move with collision directly (bosses)
export function slideBody(body, dx, dz, colliders) {
  const before = body.pos.clone();
  const hit = moveBody(body, dx, 0, dz, colliders);
  const moved = before.distanceTo(body.pos);
  return (hit & 1) && moved < Math.hypot(dx, dz) * 0.5;
}
export { V };
