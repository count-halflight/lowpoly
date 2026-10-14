import * as THREE from 'three';
import { RNG, hashSeed } from '../core/rng.js';
import { ELITE_MODS } from './enemies.js';
import { BOSS_ORDER, BOSS_INFO } from './bosses.js';

// Encounter director: builds tactically coherent enemy compositions, paces waves, scales
// difficulty through variety (types, elites, modifiers, hazards) more than raw HP.

const COST = { husk: 1, ripper: 1.1, wisp: 0.8, signaller: 1.4, gunner: 2, lancer: 2, bulwark: 3.5 };
const UNLOCK = { husk: 1, ripper: 2, wisp: 3, signaller: 3, gunner: 4, lancer: 6, bulwark: 7 };

export const ROUTES = {
  combat: { label: 'COMBAT', sub: 'STANDARD CACHE', color: '#3ef0d0', reward: 'standard' },
  hazard: { label: 'HAZARD', sub: 'RARE CACHE  +50% SCORE', color: '#ffb020', reward: 'rare', scoreMul: 1.5 },
  elite: { label: 'ELITE', sub: 'RARE CACHE  +HEAVY HITTERS', color: '#c060ff', reward: 'rare', scoreMul: 1.3 },
  cache: { label: 'SUPPLY', sub: 'HEAL  AMMO  WEAPONS', color: '#60ff90', reward: 'supply' },
  survival: { label: 'SURVIVAL', sub: 'WAVES  DOUBLE CACHE', color: '#ff5050', reward: 'standard', picks: 2, scoreMul: 1.25 },
  boss: { label: '!! WARNING !!', sub: 'BOSS SIGNAL', color: '#ff3050', reward: 'boss' },
};

export const MODIFIERS = {
  blackout: { name: 'BLACKOUT', desc: 'Lights are failing', scoreMul: 1.2 },
  overcharged: { name: 'OVERCHARGED', desc: 'Enemies move and attack faster', scoreMul: 1.25 },
  armored: { name: 'ARMORED', desc: 'Every enemy carries a regenerating shield', scoreMul: 1.25 },
  volatile: { name: 'VOLATILE', desc: 'The dead explode', scoreMul: 1.2 },
};

export class Director {
  constructor(game) {
    this.game = game;
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed;
    this.waves = [];
    this.waveIdx = 0;
    this.waveT = 0;
    this.active = false;
    this.pendingBackup = 0;
    this.roomDamage = 0;
    this.signallers = 0;
    this.bossOrder = [];
    this.bossCount = 0;
    this.lastRoutes = [];
    this.modifier = null;
    this.clearT = 0;
  }

  // ---- difficulty curves (gentle HP growth; variety does the heavy lifting)
  hpMul(i) { return 1 + Math.min(i, 30) * 0.04 + Math.max(0, i - 30) * 0.02; }
  dmgMul(i) { return Math.min(1.9, 1 + i * 0.022); }
  aggr(i) { return Math.max(0.68, 1 - i * 0.011); }
  playerDamageMul() { return 1; }
  maxAlive() { return this.game.lowPower ? 10 : 13; }

  budget(i, arch) {
    let b = 3.2 + i * 1.0;
    if (i > 20) b = 23.2 + (i - 20) * 0.45;
    if (arch === 'gallery') b *= 0.9;
    if (arch === 'cells') b *= 0.85;
    if (arch === 'elite') b *= 0.6;
    if (arch === 'hazard') b *= 0.8;
    if (arch === 'survival') b *= 1.6;
    // breather rooms: occasionally a lighter encounter
    const rng = new RNG(hashSeed(this.seed, 'breather', i));
    if (i > 3 && rng.chance(0.18)) b *= 0.6;
    return b;
  }

  bossFor(n) {
    // shuffle a new cycle of the 4 bosses every 4 bosses (first cycle in a fixed teaching order)
    while (this.bossOrder.length <= n) {
      const cycle = Math.floor(this.bossOrder.length / 4);
      const order = BOSS_ORDER.slice();
      if (cycle > 0) new RNG(hashSeed(this.seed, 'bosses', cycle)).shuffle(order);
      this.bossOrder.push(...order);
    }
    return { type: this.bossOrder[n], tier: Math.floor(n / 4) };
  }

  // Exit choices offered after clearing a room
  routesFor(room) {
    const next = room.index + 1;
    const rng = new RNG(hashSeed(this.seed, 'routes', room.index));
    if (next % 5 === 0) {
      const b = this.bossFor(Math.floor(next / 5) - 1);
      return [{ type: 'boss', ...ROUTES.boss, sub: BOSS_INFO[b.type].name }];
    }
    const pool = ['combat', 'combat'];
    if (next >= 2) pool.push('hazard');
    if (next >= 3) pool.push('elite');
    if (next >= 3 && !this.lastRoutes.includes('cache')) pool.push('cache');
    if (next >= 4) pool.push('survival');
    const n = room.exitDoors.length;
    const out = [];
    const types = new Set();
    for (let k = 0; k < n; k++) {
      let t;
      let guard = 0;
      do { t = k === 0 && rng.chance(0.55) ? 'combat' : rng.pick(pool); guard++; } while (types.has(t) && guard < 20);
      types.add(t);
      out.push({ type: t, ...ROUTES[t] });
    }
    return out;
  }

  composition(index, arch, budget, rng, opts = {}) {
    const types = Object.keys(COST).filter((t) => UNLOCK[t] <= index);
    const limit = {
      lancer: 1 + Math.floor(index / 10), bulwark: 1 + Math.floor(index / 9), signaller: index >= 15 ? 2 : 1, gunner: 2 + Math.floor(index / 8),
      wisp: 4, ripper: 6, husk: 8,
    };
    const counts = {};
    const list = [];
    let b = budget;
    // archetype flavour
    const bias = {
      gallery: { lancer: 2, husk: 1.5, ripper: 0.5 }, cells: { ripper: 2, husk: 1.2, lancer: 0.3 }, gauntlet: { gunner: 1.5, ripper: 1.3 },
      mezzanine: { husk: 1.5, lancer: 1.5 }, warehouse: { ripper: 1.4, wisp: 1.3 }, arena: { wisp: 1.4, bulwark: 1.3 }, movers: { wisp: 1.5 },
      reactor: { gunner: 1.3, husk: 1.2 }, survival: { ripper: 1.5, wisp: 1.4 }, elite: { gunner: 1.5, bulwark: 1.5 },
    }[arch] || {};
    let guard = 0;
    while (b > 0.7 && guard++ < 60) {
      const avail = types.filter((t) => COST[t] <= b + 0.3 && (counts[t] || 0) < limit[t]);
      if (!avail.length) break;
      const t = rng.weighted(avail, (x) => {
        let w = (bias[x] || 1) * (x === 'husk' ? 1.4 : 1);
        const share = (counts[x] || 0) / Math.max(1, list.length);
        if (share > 0.45 && list.length > 2) w *= 0.25; // avoid monotone groups
        if (x === 'signaller' && opts.noSignaller) w = 0;
        return w;
      });
      if (!t) break;
      counts[t] = (counts[t] || 0) + 1;
      list.push(t);
      b -= COST[t];
    }
    if (!list.length) list.push('husk');
    return list;
  }

  eliteChance(index, arch) {
    if (arch === 'elite') return 1;
    if (index < 4) return 0;
    return Math.min(0.32, 0.03 + index * 0.011);
  }

  // ---- room lifecycle
  beginRoom(room) {
    const g = this.game;
    this.waves = [];
    this.waveIdx = 0;
    this.waveT = 0.9;
    this.pendingBackup = 0;
    this.roomDamage = g.run.damageTaken;
    this.signallers = 0;
    this.modifier = null;
    this.clearT = 0;
    const route = room.route || { type: 'combat' };
    this.lastRoutes.push(route.type);
    if (this.lastRoutes.length > 3) this.lastRoutes.shift();
    g.style.routeMult = route.scoreMul || 1;
    const i = room.index;
    const rng = new RNG(hashSeed(this.seed, 'enc', i));
    const arch = room.spec.arch;
    if (arch === 'cache') { this.active = false; return 'calm'; }
    if (arch === 'boss') {
      const n = Math.floor(i / 5) - 1;
      const b = this.bossFor(n);
      this.bossCount = n + 1;
      this.active = true;
      g.bosses.spawn(b.type, room, b.tier);
      return 'boss';
    }
    // room modifier from region 2 onward
    if (i > 5 && rng.chance(Math.min(0.4, 0.1 + i * 0.01))) {
      const keys = Object.keys(MODIFIERS);
      this.modifier = rng.pick(keys);
      g.style.routeMult *= MODIFIERS[this.modifier].scoreMul;
    }
    const budget = this.budget(i, arch);
    const comp = this.composition(i, arch, budget, rng);
    rng.shuffle(comp);
    // split into waves
    let nw = arch === 'survival' ? 4 : comp.length > 9 ? 3 : comp.length > 4 ? 2 : 1;
    if (i === 1) nw = 1;
    const per = Math.ceil(comp.length / nw);
    for (let w = 0; w < nw; w++) this.waves.push(comp.slice(w * per, (w + 1) * per));
    this.waves = this.waves.filter((w) => w.length);
    // elites
    const ec = this.eliteChance(i, arch);
    const mods = Object.keys(ELITE_MODS).filter((m) => i >= 6 || m !== 'blinking');
    this.eliteFlags = this.waves.map((w) => w.map((t) => (arch === 'elite' ? (t !== 'wisp' && rng.chance(0.75)) : rng.chance(ec)) && t !== 'signaller' ? rng.pick(mods) : null));
    if (arch === 'elite' && !this.eliteFlags.flat().some(Boolean)) this.eliteFlags[0][0] = rng.pick(mods);
    this.survival = arch === 'survival';
    this.active = true;
    if (this.modifier === 'blackout') {
      g.level.lights.forEach((l) => { l.userData.base *= 0.35; });
      g.scene.fog.far *= 0.6;
    }
    return 'combat';
  }

  spawnWave(list, eliteFlags) {
    const g = this.game;
    const room = g.level.current;
    const i = room.index;
    const rng = new RNG(hashSeed(this.seed, 'spawn', i, this.waveIdx, g.time | 0));
    const used = [];
    list.forEach((type, k) => {
      if (g.enemies.aliveCount >= this.maxAlive()) return;
      const spot = this.findSpawn(room, type, rng, used);
      if (!spot) return;
      used.push(spot.pos);
      let elite = eliteFlags ? eliteFlags[k] : null;
      if (this.modifier === 'armored' && !elite) elite = 'shielded';
      if (this.modifier === 'volatile' && !elite) elite = 'volatile';
      const e = g.enemies.spawn(type, spot.pos, {
        elite, perch: spot.perch, hpMul: this.hpMul(i) * (this.modifier === 'armored' && elite === 'shielded' && !eliteFlags?.[k] ? 0.625 : 1),
        dmgMul: this.dmgMul(i), aggr: this.aggr(i) * (this.modifier === 'overcharged' ? 0.8 : 1),
      });
      if (this.modifier === 'overcharged') e.speedMul *= 1.2;
      if (type === 'signaller') this.signallers++;
    });
  }

  findSpawn(room, type, rng, used) {
    const g = this.game;
    const nav = room.nav;
    const pp = g.player.body.pos;
    // perched spawn for ranged enemies
    if ((type === 'lancer' || type === 'husk' || type === 'gunner') && room.spec.perches.length && rng.chance(type === 'lancer' ? 0.8 : 0.35)) {
      const p = rng.pick(room.spec.perches);
      const perch = { x0: room.wx(p.x0), x1: room.wx(p.x1), z0: room.wz(p.z0), z1: room.wz(p.z1), y: p.y };
      perch.wx0 = perch.x0; perch.wx1 = perch.x1; perch.wz0 = perch.z0; perch.wz1 = perch.z1;
      const x = rng.range(perch.x0, perch.x1), z = rng.range(perch.z0, perch.z1);
      if (Math.hypot(x - pp.x, z - pp.z) > 6 && !used.some((u) => Math.hypot(u.x - x, u.z - z) < 1.5)) return { pos: new THREE.Vector3(x, p.y + 0.05, z), perch };
    }
    let best = null, bestScore = -1e9;
    const entZ = room.wz(room.D / 2), entX = room.wx(room.spec.entX);
    for (let tries = 0; tries < 40; tries++) {
      const k = Math.floor(rng.next() * nav.nx * nav.nz);
      if (!nav.free(k)) continue;
      const c = nav.center(k, { x: 0, z: 0 });
      const d = Math.hypot(c.x - pp.x, c.z - pp.z);
      if (d < 8) continue;
      if (Math.hypot(c.x - entX, c.z - entZ) < 5) continue;
      if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 1.6)) continue;
      if (room.hazardAt(c.x, c.z, 0) || room.spec.hazards.some((h) => c.x > room.wx(h.x0) && c.x < room.wx(h.x1) && c.z > room.wz(h.z0) && c.z < room.wz(h.z1))) continue;
      // prefer medium distance, slight preference toward the far side of the room
      let score = -Math.abs(d - (type === 'lancer' ? 22 : type === 'ripper' ? 12 : 15)) + rng.next() * 4;
      if (type === 'lancer') score += (entZ - c.z) * 0.2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;
    const y = type === 'wisp' ? 3 : 0.05;
    return { pos: new THREE.Vector3(best.x, y, best.z), perch: null };
  }

  callBackup(sig) {
    const g = this.game;
    const room = g.level.current;
    if (!room || room.state !== 'combat') return;
    g.run.backupCalled++;
    g.audio.play('backup', null, 0.9);
    g.hud.toast('BACKUP INCOMING', '#ff3050');
    const rng = new RNG(hashSeed(this.seed, 'backup', room.index, g.time | 0));
    const comp = this.composition(room.index, room.spec.arch, 2.5 + room.index * 0.25, rng, { noSignaller: true });
    this.pendingBackup++;
    g.enemies.delayed(1.2, () => {
      this.pendingBackup--;
      if (room !== g.level.current || room.state !== 'combat') return;
      this.spawnWave(comp, null);
    });
    void sig;
  }

  spawnEscort(tier, summon = false) {
    const g = this.game;
    const room = g.level.current;
    if (!room) return;
    const rng = new RNG(hashSeed(this.seed, 'escort', g.time * 100 | 0));
    const pool = summon ? ['wisp', 'wisp', 'husk', 'ripper'] : ['husk', 'ripper', 'wisp', 'gunner'];
    const n = Math.min(4, 2 + Math.floor(tier / 2));
    const list = [];
    for (let k = 0; k < n; k++) list.push(rng.pick(pool));
    this.spawnWave(list, null);
  }

  update(dt) {
    const g = this.game;
    const room = g.level.current;
    if (!this.active || !room || room.state !== 'combat') return;
    if (g.bosses.active) {
      // boss room clears when the boss is dead and its escorts are gone
      if (!g.bosses.active.alive && g.enemies.aliveCount === 0) { this.clearT += dt; if (this.clearT > 2.2) { this.active = false; g.onRoomCleared(room); } }
      return;
    }
    this.waveT -= dt;
    const alive = g.enemies.aliveCount;
    if (this.waveIdx < this.waves.length) {
      const total = this.waves[Math.max(0, this.waveIdx - 1)]?.length || 1;
      const ready = this.waveIdx === 0 ? this.waveT <= 0
        : this.survival ? (this.waveT <= 0 || alive <= 2)
          : (alive <= Math.max(1, Math.floor(total * 0.34)) || this.waveT <= -18);
      if (ready) {
        this.spawnWave(this.waves[this.waveIdx], this.eliteFlags[this.waveIdx]);
        this.waveIdx++;
        this.waveT = this.survival ? 13 : 0;
        if (this.waveIdx > 1) g.hud.toast(this.survival ? 'WAVE ' + this.waveIdx + ' / ' + this.waves.length : 'REINFORCEMENTS', '#ff8a3a', true);
      }
    } else if (alive === 0 && this.pendingBackup === 0) {
      this.clearT += dt;
      if (this.clearT > 0.4) { this.active = false; g.onRoomCleared(room); }
    }
  }

  remaining() {
    let n = this.game.enemies.aliveCount;
    for (let w = this.waveIdx; w < this.waves.length; w++) n += this.waves[w].length;
    return n;
  }
}
