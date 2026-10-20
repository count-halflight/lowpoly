import * as THREE from 'three';
import { rayBox, raySphere, rayCylinder } from '../core/collide.js';

// Central hit resolution + damage application. All real hits go through here, so every
// hit marker, sound and score event corresponds to an actual damage event.
export class Combat {
  constructor(game) {
    this.game = game;
    this.n = { nx: 0, ny: 0, nz: 0 };
    this.recentKills = [];
    this.v1 = new THREE.Vector3();
  }

  /** World-only raycast. Returns {t, nx,ny,nz, box} or null. */
  rayWorld(o, d, maxT, ignoreBarriers = false) {
    const cs = this.game.level.colliders;
    let best = maxT, bestBox = null, nx = 0, ny = 0, nz = 0;
    const n = this.n;
    for (let i = 0; i < cs.length; i++) {
      const b = cs[i];
      if (!b.active || !b.shootable) continue;
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b, best, n);
      if (t >= 0 && t < best) { best = t; bestBox = b; nx = n.nx; ny = n.ny; nz = n.nz; }
    }
    // dynamic shields (boss barriers etc)
    if (!ignoreBarriers) for (const s of this.game.bosses.barriers) {
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, s.box, best, n);
      if (t >= 0 && t < best) { best = t; bestBox = s.box; nx = n.nx; ny = n.ny; nz = n.nz; }
    }
    if (!bestBox) return null;
    return { t: best, nx, ny, nz, box: bestBox };
  }

  losClear(a, b) {
    const d = this.v1.subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.multiplyScalar(1 / len);
    const h = this.rayWorld(a, d, len - 0.1);
    return !h;
  }

  /** Full raycast: world + enemies + boss. opts.skip: Set of enemies to ignore. */
  raycast(o, d, maxT, opts = {}) {
    const w = this.rayWorld(o, d, maxT);
    let best = w ? w.t : maxT;
    let hit = w ? { kind: 'world', t: w.t, normal: new THREE.Vector3(w.nx, w.ny, w.nz), box: w.box, surface: w.box.surface } : null;
    for (const e of this.game.enemies.list) {
      if (!e.alive || !e.targetable || (opts.skip && opts.skip.has(e))) continue;
      const hy = e.pos.y + e.headY;
      let t = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, hy, e.pos.z, e.headR, best);
      if (t >= 0 && t < best) { best = t; hit = { kind: 'enemy', t, enemy: e, part: 'head' }; }
      t = rayCylinder(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, e.pos.z, e.radius, e.pos.y + e.bodyY0, e.pos.y + e.bodyY1, best);
      if (t >= 0 && t < best) { best = t; hit = { kind: 'enemy', t, enemy: e, part: 'body' }; }
    }
    const boss = this.game.bosses.active;
    if (boss && boss.alive) {
      for (const hb of boss.hitboxes()) {
        const t = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, hb.x, hb.y, hb.z, hb.r, best);
        if (t >= 0 && t < best) { best = t; hit = { kind: 'boss', t, boss, part: hb }; }
      }
    }
    if (hit) hit.point = new THREE.Vector3(o.x + d.x * hit.t, o.y + d.y * hit.t, o.z + d.z * hit.t);
    return hit;
  }

  /** Returns all enemies a ray passes through before hitting the world (for piercing beams). */
  raycastPierce(o, d, maxT) {
    const w = this.rayWorld(o, d, maxT, true);
    const end = w ? w.t : maxT;
    const hits = [];
    for (const e of this.game.enemies.list) {
      if (!e.alive || !e.targetable) continue;
      const th = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, e.pos.y + e.headY, e.pos.z, e.headR, end);
      const tb = rayCylinder(o.x, o.y, o.z, d.x, d.y, d.z, e.pos.x, e.pos.z, e.radius, e.pos.y + e.bodyY0, e.pos.y + e.bodyY1, end);
      if (th >= 0 || tb >= 0) {
        const part = th >= 0 ? 'head' : 'body';
        const t = th >= 0 ? th : tb;
        hits.push({ enemy: e, part, t, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) });
      }
    }
    let bossHit = null;
    const boss = this.game.bosses.active;
    if (boss && boss.alive) {
      let bt = end;
      for (const hb of boss.hitboxes()) {
        const t = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, hb.x, hb.y, hb.z, hb.r, bt);
        if (t >= 0 && t < bt) { bt = t; bossHit = { part: hb, t, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) }; }
      }
    }
    hits.sort((a, b) => a.t - b.t);
    return { hits, bossHit, end, world: w };
  }

  // Damage the player deals (as opposed to enemy friendly fire, hazards, self-destructs).
  playerSource(info) {
    return info.source !== 'enemy' && info.source !== 'hazard' && info.source !== 'self' && !info.friendly && info.fromPlayer !== false;
  }

  // RUSH overdrive multiplier on outgoing damage
  rushMul(info) { return this.game.player.rushT > 0 && this.playerSource(info) ? 1.3 : 1; }

  // Lifesteal while RUSH is active (on top of Vampiric Field)
  rushLeech(amount, info) {
    const pl = this.game.player;
    if (pl.rushT > 0 && amount > 0 && this.playerSource(info)) pl.heal(Math.min(8, amount * 0.06), true);
  }

  damageEnemy(e, dmg, info = {}) {
    const g = this.game;
    if (!e.alive) return 0;
    let mul = this.rushMul(info);
    const head = info.part === 'head';
    if (head) mul *= (info.headMul || 2) * g.player.stats.headMul;
    if (e.elite) mul *= g.player.stats.elitesMul;
    // juggling: ground enemies caught in the air (launched or mid-leap) take extra player damage
    if (!e.flying && !e.mini && !e.anchored && e.airTime > 0.15 && !e.body.grounded && this.playerSource(info)) mul *= 1.15 + 0.2 * (g.player.stats.juggle || 0);
    // type-specific armour (e.g. Bulwark front shield)
    const armor = info.finisher ? 1 : e.armorFactor ? e.armorFactor(info) : 1;
    let amount = dmg * mul * armor;
    // finishers take exactly what is left, so damage stats and lifesteal stay honest
    if (info.finisher) { e.shield = 0; amount = Math.max(1, e.hp); }
    let shieldHit = false;
    if (e.shield > 0) {
      const sMul = info.energy ? 2 : 1;
      const sd = Math.min(e.shield, amount * sMul);
      e.shield -= sd;
      amount -= sd / sMul;
      shieldHit = true;
      e.shieldDelay = 3;
      if (e.shield <= 0) { g.audio.play('shieldBreak', e.pos, 0.8); g.fx.sparksBurst(e.centerPos(), 0x40e0ff, 20, 7, 0.5); g.style.add('SHIELD BREAK', 20); }
    }
    e.hp -= amount;
    e.lastHit = info;
    e.onHit(info, amount);
    if (info.source !== 'enemy' && info.source !== 'hazard') {
      g.run.damageDealt += amount;
      if (g.player.stats.vampiric) g.player.heal(amount * 0.03 * g.player.stats.vampiric, true);
      this.rushLeech(amount, info);
    }
    const p = info.point || e.centerPos();
    if (!shieldHit || amount > 0) g.fx.blood(p, info.dir || new THREE.Vector3(0, 1, 0), head ? 1.4 : 0.7, e.bloodColor);
    else g.fx.sparksBurst(p, 0x40e0ff, 6, 4, 0.25, 0.08);
    if (e.hp <= 0) {
      info.killDmg = amount; // how hard the killing blow landed (dismemberment)
      this.killEnemy(e, info);
      if (info.fromPlayer !== false) g.hud.hitMarker(head ? 'headkill' : 'kill');
    } else if (info.fromPlayer !== false && info.source !== 'enemy') {
      g.hud.hitMarker(shieldHit && amount <= 0 ? 'shield' : head ? 'head' : armor < 0.5 ? 'armor' : 'hit');
      if (!info.quiet) g.audio.play(shieldHit && amount <= 0 ? 'shieldHit' : head ? 'headshot' : 'hit', null, 0.5);
    }
    return amount;
  }

  killEnemy(e, info) {
    const g = this.game;
    e.alive = false;
    if (info.source === 'self') { e.die(info); g.enemies.onKilled(e); return; }
    const head = info.part === 'head';
    const now = g.time;
    // style
    g.style.add('KILL', e.styleValue || 20);
    if (head) g.style.add('HEADSHOT', 25);
    if (!e.body.grounded && !e.flying && e.airTime > 0.2) g.style.add('AIRSHOT', 30);
    if (e.flying && info.source === 'hitscan' && info.longRange) g.style.add('SKYSHOT', 30);
    if (info.source === 'explosion') g.style.add('EXPLODED', 15);
    if (info.source === 'enemy' || info.friendly) g.style.add('FRIENDLY FIRE', 40);
    if (info.source === 'parry') g.style.add('RETURN TO SENDER', 50);
    if (info.source === 'punch') g.style.add('KNOCKOUT', 30);
    if (info.source === 'slam') g.style.add('GROUND POUND', 30);
    if (info.source === 'fire') g.style.add('CREMATED', 25);
    if (info.boosted) g.style.add('HOME RUN', 35);
    if (info.dist !== undefined && info.dist > 28) g.style.add('LONGSHOT', 25);
    if (e.elite) g.style.add('ELITE DOWN', 60);
    if (e.type === 'signaller' && !e.called) g.style.add('NO BACKUP', 40);
    this.recentKills = this.recentKills.filter((t) => now - t < 0.7);
    this.recentKills.push(now);
    const n = this.recentKills.length;
    if (n === 2) g.style.add('DOUBLE', 30);
    else if (n === 3) g.style.add('TRIPLE', 50);
    else if (n >= 4) g.style.add('MASSACRE', 80);
    // close-range kills heal (aggression is rewarded)
    const pp = g.player.body.pos;
    const d = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
    const bf = g.level.current && g.level.current.cond === 'bloodfuel' ? 2 : 1;
    if (d < 6) { g.player.heal((5 + g.player.stats.healOnKill) * bf); g.fx.sparksBurst(e.centerPos(), 0xff3050, 8, 3, 0.4); }
    else if (g.player.stats.healOnKill || bf > 1) g.player.heal((g.player.stats.healOnKill + (bf > 1 ? 4 : 0)) * bf);
    g.run.kills++;
    g.audio.play('kill', e.pos, 0.9);
    // rising confirm tick: each kill in a quick streak lands a step higher
    g.audio.play('killConfirm', null, head ? 0.75 : 0.55, Math.min(6, n + (head ? 1 : 0)));
    const pl = g.player;
    if (pl.rushT > 0 && pl.stats.rushExtend) pl.rushT = Math.min(pl.rushMax, pl.rushT + 0.5 * pl.stats.rushExtend);
    g.addShake(e.elite || e.heavy ? 0.2 : 0.07);
    if (head || e.elite || e.heavy) g.hitstop(e.elite || e.heavy ? 0.06 : 0.03);
    if (info.source === 'explosion' || (info.knock && info.knock > 9) || head) g.audio.play('gib', e.pos, 0.6);
    e.die(info);
    g.pickups.onEnemyKilled(e);
    if (g.player.stats.chainReaction && info.source === 'explosion' && !info.chained) {
      const p = e.centerPos();
      setTimeout(() => {
        if (g.state !== 'playing') return;
        g.fx.explosion(p, 3, 0xff6a20);
        g.audio.play('explosion', p, 0.6);
        this.radialDamage(p, 3.2, 45, { source: 'explosion', chained: true, noSelf: true });
      }, 120);
    }
    // ricochet on kill
    if (g.player.stats.ricochet && info.source === 'hitscan' && !info.ricochet) this.ricochet(e.centerPos(), info.dmg || 20, e);
    g.enemies.onKilled(e);
  }

  ricochet(from, dmg, exclude) {
    const g = this.game;
    let best = null, bd = 12 + 4 * g.player.stats.ricochet;
    for (const e of g.enemies.list) {
      if (!e.alive || e === exclude) continue;
      const c = e.centerPos();
      const d = c.distanceTo(from);
      if (d < bd && this.losClear(from, c)) { bd = d; best = e; }
    }
    if (!best) return;
    const c = best.centerPos();
    g.fx.tracer(from, c, 0xffe060, 0.15);
    g.style.add('RICOCHET', 20);
    this.damageEnemy(best, dmg * (0.6 + 0.2 * g.player.stats.ricochet), { source: 'hitscan', ricochet: true, point: c, part: 'body', dir: c.clone().sub(from).normalize() });
  }

  damageBoss(boss, dmg, info = {}) {
    const g = this.game;
    if (!boss.alive) return 0;
    const part = info.part || {};
    if (part.shielded) {
      g.hud.hitMarker('shield');
      g.audio.play('shieldHit', info.point, 0.6);
      g.fx.sparksBurst(info.point || boss.pos, 0x40e0ff, 5, 4, 0.2, 0.08);
      return 0;
    }
    const mul = (part.mul || 1) * (part.weak ? g.player.stats.headMul : 1) * g.player.stats.elitesMul * this.rushMul(info);
    const amount = boss.applyDamage(dmg * mul, info, part);
    if (amount <= 0) return 0;
    g.run.damageDealt += amount;
    if (g.player.stats.vampiric) g.player.heal(amount * 0.03 * g.player.stats.vampiric, true);
    this.rushLeech(amount, info);
    g.hud.hitMarker(part.weak ? 'head' : 'hit');
    if (!info.quiet) g.audio.play(part.weak ? 'headshot' : 'hit', null, 0.45);
    if (info.point) g.fx.sparksBurst(info.point, part.weak ? 0xffe060 : 0xffa060, part.weak ? 8 : 4, 5, 0.3, 0.09);
    g.style.add(part.weak ? 'CRITICAL' : 'BOSS HIT', part.weak ? 6 : 2, true);
    return amount;
  }

  /** Explosion / shockwave damage to everything in radius with falloff. */
  radialDamage(pos, radius, dmg, opts = {}) {
    const g = this.game;
    let hits = 0;
    g.level.blastBarrels(pos, radius);
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const c = e.centerPos();
      const d = c.distanceTo(pos);
      if (d > radius + e.radius) continue;
      const fall = 1 - Math.max(0, d - e.radius) / radius * 0.6;
      const dir = c.clone().sub(pos).normalize();
      if (opts.launch) e.body.vel.y = Math.max(e.body.vel.y, opts.launch);
      this.damageEnemy(e, dmg * fall, { source: opts.source || 'explosion', point: c, dir, knock: opts.knock || 8, stagger: 0.4, friendly: opts.friendly, chained: opts.chained, energy: opts.energy, fromPlayer: !opts.friendly, boosted: opts.boosted });
      hits++;
    }
    const boss = g.bosses.active;
    if (boss && boss.alive && !opts.friendly) {
      let bestD = 1e9, bestHb = null;
      for (const hb of boss.hitboxes()) {
        const d = Math.hypot(hb.x - pos.x, hb.y - pos.y, hb.z - pos.z) - hb.r;
        if (d < bestD) { bestD = d; bestHb = hb; }
      }
      if (bestHb && bestD < radius) {
        this.damageBoss(boss, dmg * (1 - Math.max(0, bestD) / radius * 0.6), { source: 'explosion', part: bestHb, point: new THREE.Vector3(bestHb.x, bestHb.y, bestHb.z), quiet: true });
      }
    }
    for (const b of g.bosses.barriers) {
      const cx = (b.box.minX + b.box.maxX) / 2, cz = (b.box.minZ + b.box.maxZ) / 2;
      if (Math.hypot(cx - pos.x, cz - pos.z) < radius + 3.5 && !opts.friendly) b.hp -= dmg;
    }
    // self damage + rocket jump
    if (!opts.noSelf) {
      const p = g.player.body.pos;
      const c = this.v1.set(p.x, p.y + 0.9, p.z);
      const d = c.distanceTo(pos);
      if (d < radius) {
        const k = 1 - d / radius;
        const dir = c.clone().sub(pos).normalize();
        const knock = (opts.selfKnock || 14) * (0.4 + 0.6 * k);
        g.player.knock(dir.x * knock, Math.max(4, dir.y * knock + 6 * k), dir.z * knock);
        const sd = opts.friendly ? dmg * k : Math.min(18, dmg * 0.18 * k);
        if (sd > 1) g.player.damage(sd, pos, opts.friendly ? (opts.cause || 'EXPLOSION') : 'YOUR OWN EXPLOSION', opts.friendly ? (opts.tip || 'Watch for glowing telegraph circles and move out of the blast radius.') : 'Keep some distance from your own grenades (rocket-jumping is still worth it).');
      }
    }
    return hits;
  }
}
