import * as THREE from 'three';
import { RNG, hashSeed } from '../core/rng.js';
import { ELITE_MODS, FLYING_TYPES } from './enemies.js';
import { Miniboss } from './kit.js';
import { BOSS_ORDER, BOSS_INFO } from './bosses.js';

// Encounter director: builds tactically coherent enemy compositions, paces waves, scales
// difficulty through variety (types, elites, modifiers, hazards) more than raw HP.
// "heat" is the difficulty index: the room number in endless mode, or a value derived
// from campaign depth (and NG+ cycle) in the campaign.

const COST = {
  husk: 1, ripper: 1.1, wisp: 0.8, signaller: 1.4, gunner: 2, lancer: 2, bulwark: 3.5,
  swarmer: 0.45, leech: 0.9, sentry: 1.8, charger: 3, stalker: 1.8, bomber: 1.7, cantor: 1.6, mirror: 3.2,
};
// heat at which each type joins the pool (endless room index, or campaign depth heat)
const UNLOCK = {
  husk: 1, ripper: 2, wisp: 3, signaller: 3, gunner: 4, lancer: 6, bulwark: 7,
  swarmer: 3, leech: 5, sentry: 5, charger: 8, stalker: 9, bomber: 10, cantor: 11, mirror: 13,
};
// pack hunters arrive together; small fry count less toward the alive cap
const PACK = { swarmer: 3 };
const LOAD = { swarmer: 0.5, leech: 0.75 };
const NO_ELITE = new Set(['signaller', 'swarmer']);
const NO_BLINK = new Set(['sentry', 'leech']);
// corrupted dead rise again as wisps (not the small fry or the drones)
const NO_RISE = new Set(['wisp', 'swarmer', 'leech', 'bomber']);

export const ROUTES = {
  combat: { label: 'COMBAT', sub: 'STANDARD CACHE', color: '#3ef0d0', reward: 'standard' },
  hazard: { label: 'HAZARD', sub: 'RARE CACHE  +50% SCORE', color: '#ffb020', reward: 'rare', scoreMul: 1.5 },
  elite: { label: 'ELITE', sub: 'RARE CACHE  +HEAVY HITTERS', color: '#c060ff', reward: 'rare', scoreMul: 1.3 },
  cache: { label: 'SUPPLY', sub: 'HEAL  AMMO  WEAPONS', color: '#60ff90', reward: 'supply' },
  survival: { label: 'SURVIVAL', sub: 'WAVES  DOUBLE CACHE', color: '#ff5050', reward: 'standard', picks: 2, scoreMul: 1.25 },
  boss: { label: '!! WARNING !!', sub: 'BOSS SIGNAL', color: '#ff3050', reward: 'boss' },
  mini: { label: 'CONTAINMENT', sub: 'MINIBOSS  RARE CACHE', color: '#ff8a3a', reward: 'rare', scoreMul: 1.2 },
  exit: { label: 'EXTRACTION', sub: 'LEVEL COMPLETE', color: '#7aff7a', reward: 'none' },
};

export const MODIFIERS = {
  blackout: { name: 'BLACKOUT', desc: 'Lights are failing', scoreMul: 1.2 },
  overcharged: { name: 'OVERCHARGED', desc: 'Enemies move and attack faster', scoreMul: 1.25 },
  armored: { name: 'ARMORED', desc: 'Every enemy carries a regenerating shield', scoreMul: 1.25 },
  volatile: { name: 'VOLATILE', desc: 'The dead explode', scoreMul: 1.2 },
};

// level-condition composition biases
const COND_BIAS = {
  swarm: { wisp: 3, ripper: 1.3, swarmer: 3, leech: 1.6 },
  snipers: { lancer: 3, husk: 1.3, sentry: 2.2 },
  heavies: { bulwark: 2.6, gunner: 2, charger: 2, mirror: 1.8 },
  haste: { ripper: 1.5, swarmer: 1.4, charger: 1.3 },
  fog: { ripper: 1.6, wisp: 1.4, lancer: 0.3, stalker: 3, leech: 1.5, sentry: 0.3, bomber: 0.6 },
  dark: { stalker: 2, leech: 1.3 },
  lowgrav: { bomber: 1.5, swarmer: 1.3 },
  hazards: { sentry: 1.4, charger: 1.3 },
};

// archetype flavour
const ARCH_BIAS = {
  gallery: { lancer: 2, husk: 1.5, ripper: 0.5, sentry: 1.6 }, cells: { ripper: 2, husk: 1.2, lancer: 0.3, stalker: 1.5, leech: 1.4, bomber: 0.4 },
  gauntlet: { gunner: 1.5, ripper: 1.3, charger: 1.5, sentry: 1.2 }, mezzanine: { husk: 1.5, lancer: 1.5, sentry: 1.3, bomber: 1.2 },
  warehouse: { ripper: 1.4, wisp: 1.3, stalker: 1.4, swarmer: 1.4 }, arena: { wisp: 1.4, bulwark: 1.3, charger: 1.4, bomber: 1.3, mirror: 1.2 },
  movers: { wisp: 1.5, swarmer: 1.3 }, reactor: { gunner: 1.3, husk: 1.2, sentry: 1.3, cantor: 1.3 },
  survival: { ripper: 1.5, wisp: 1.4, swarmer: 1.6, leech: 1.3 }, elite: { gunner: 1.5, bulwark: 1.5, mirror: 1.6, charger: 1.4, cantor: 1.3 },
  tower: { wisp: 1.6, lancer: 1.4, bomber: 1.6 }, bridges: { husk: 1.4, gunner: 1.3, ripper: 0.6, bomber: 1.4, sentry: 1.3 },
  pit: { wisp: 1.5, husk: 1.2, leech: 1.4, bomber: 1.3 }, hall: { gunner: 1.4, ripper: 1.3, charger: 1.6, mirror: 1.3 },
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
    this.combatT = 0;
    this.warden = null;
    this.minis = [];
    this.miniPending = 0;
    this.minisDown = false;
    this.lateT = 0;
  }

  // ---- difficulty curves (gentle HP growth; variety does the heavy lifting)
  hpMul(i) { return 1 + Math.min(i, 30) * 0.04 + Math.max(0, i - 30) * 0.02; }
  dmgMul(i) { return Math.min(1.9, 1 + i * 0.022) * (this.cond === 'glass' ? 1.5 : 1); }
  aggr(i) { return Math.max(0.68, 1 - i * 0.011) * (this.cond === 'haste' ? 0.8 : 1); }
  playerDamageMul() { return this.cond === 'glass' ? 1.5 : 1; }
  maxAlive() { return this.game.lowPower ? 10 : 13; }
  get cond() { const r = this.game.level.current; return r ? r.cond : 'none'; }
  heatOf(room) { return room.ctx && room.ctx.heat !== undefined ? room.ctx.heat : room.index; }

  budget(i, arch) {
    let b = 3.2 + i * 1.0;
    if (i > 20) b = 23.2 + (i - 20) * 0.45;
    if (arch === 'gallery') b *= 0.9;
    if (arch === 'cells') b *= 0.85;
    if (arch === 'elite') b *= 0.6;
    if (arch === 'hazard' || arch === 'bridges' || arch === 'pit') b *= 0.8;
    if (arch === 'survival') b *= 1.6;
    // breather rooms: occasionally a lighter encounter
    const rng = new RNG(hashSeed(this.seed, 'breather', i, this.game.level.current ? this.game.level.current.index : 0));
    if (i > 3 && rng.chance(0.18)) b *= 0.6;
    return b;
  }

  bossFor(n) {
    // endless: shuffle a new cycle of the 4 bespoke bosses every 4 bosses
    while (this.bossOrder.length <= n) {
      const cycle = Math.floor(this.bossOrder.length / 4);
      const order = BOSS_ORDER.slice();
      if (cycle > 0) new RNG(hashSeed(this.seed, 'bosses', cycle)).shuffle(order);
      this.bossOrder.push(...order);
    }
    return { type: this.bossOrder[n], tier: Math.floor(n / 4) };
  }

  // Exit choices offered after clearing a room (endless mode)
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
    return this.pickRoutes(room, pool, rng);
  }

  pickRoutes(room, pool, rng) {
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

  // Flat list of enemy types for an encounter (packs stay adjacent).
  composition(index, arch, budget, rng, opts = {}) {
    return this.compositionUnits(index, arch, budget, rng, opts).flat();
  }

  // Encounter as units: a single type, or an array for a pack that must spawn together.
  compositionUnits(index, arch, budget, rng, opts = {}) {
    const types = Object.keys(COST).filter((t) => UNLOCK[t] <= index);
    const cond = this.cond;
    const force = (t, min) => { if (!types.includes(t) && index >= min) types.push(t); };
    if (cond === 'swarm') { force('wisp', 0); force('swarmer', 2); }
    if (cond === 'snipers') { force('lancer', 3); force('sentry', 4); }
    if (cond === 'heavies') { force('bulwark', 4); force('charger', 5); }
    if (cond === 'fog') force('stalker', 5);
    const limit = {
      lancer: 1 + Math.floor(index / 10) + (cond === 'snipers' ? 2 : 0), bulwark: 1 + Math.floor(index / 9) + (cond === 'heavies' ? 1 : 0),
      signaller: index >= 15 ? 2 : 1, gunner: 2 + Math.floor(index / 8), wisp: cond === 'swarm' ? 9 : 4, ripper: 6, husk: 8,
      swarmer: (cond === 'swarm' ? 12 : 7) + Math.floor(index / 12), leech: 2 + (index >= 18 ? 1 : 0) + (cond === 'swarm' ? 1 : 0),
      sentry: 1 + Math.floor(index / 14) + (cond === 'snipers' ? 1 : 0), charger: 1 + Math.floor(index / 16) + (cond === 'heavies' ? 1 : 0),
      stalker: 2 + (cond === 'fog' || cond === 'dark' ? 1 : 0), bomber: 1 + Math.floor(index / 18), cantor: 1 + (index >= 20 ? 1 : 0),
      mirror: 1 + Math.floor(index / 18) + (cond === 'heavies' ? 1 : 0),
    };
    const counts = {};
    const units = [];
    let n = 0;
    let b = budget;
    const bias = ARCH_BIAS[arch] || {};
    const cb = COND_BIAS[cond] || {};
    let guard = 0;
    while (b > 0.7 && guard++ < 60) {
      const avail = types.filter((t) => COST[t] * (PACK[t] ? 2 : 1) <= b + 0.3 && (counts[t] || 0) < limit[t]
        && !(t === 'signaller' && opts.noSignaller) && !(opts.exclude && opts.exclude.includes(t))
        // a priest needs a flock: only once there are two others to ward
        && !(t === 'cantor' && n - (counts.cantor || 0) < 2));
      if (!avail.length) break;
      const t = rng.weighted(avail, (x) => {
        let w = (bias[x] || 1) * (cb[x] || 1) * (x === 'husk' ? 1.4 : 1);
        const share = (counts[x] || 0) / Math.max(1, n);
        if (share > 0.45 && n > 2 && !cb[x]) w *= 0.25; // avoid monotone groups
        return w;
      });
      if (!t) break;
      if (PACK[t]) {
        const size = Math.min(PACK[t] + (index >= 12 ? 1 : 0) + (cond === 'swarm' ? 1 : 0), limit[t] - (counts[t] || 0), Math.floor((b + 0.3) / COST[t]));
        const pack = [];
        for (let k = 0; k < size; k++) pack.push(t);
        units.push(pack);
        counts[t] = (counts[t] || 0) + size; n += size; b -= COST[t] * size;
      } else {
        units.push(t);
        counts[t] = (counts[t] || 0) + 1; n++; b -= COST[t];
      }
    }
    if (!units.length) units.push('husk');
    return units;
  }

  // weighted alive count: packs of small fry should not starve the room of real threats
  load() {
    let n = 0;
    for (const e of this.game.enemies.list) if (e.alive) n += LOAD[e.type] || 1;
    return n;
  }

  eliteChance(index, arch) {
    if (arch === 'elite') return 1;
    if (index < 4) return 0;
    return Math.min(0.32, 0.03 + index * 0.011) + (this.ngPlus ? 0.12 : 0);
  }

  get ngPlus() { return (this.game.campaign && this.game.campaign.cycle > 0 && this.game.mode === 'campaign') || false; }

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
    this.combatT = 0;
    this.warden = null;
    this.minis = [];
    this.miniPending = 0;
    this.minisDown = false;
    this.lateT = 0;
    const route = room.route || { type: 'combat' };
    this.lastRoutes.push(route.type);
    if (this.lastRoutes.length > 3) this.lastRoutes.shift();
    g.style.routeMult = route.scoreMul || 1;
    const i = this.heatOf(room);
    const rng = new RNG(hashSeed(this.seed, 'enc', room.index, i));
    const arch = room.spec.arch;
    if (arch === 'cache' || arch === 'lobby' || arch === 'tutorial' || room.ctx.calm) { this.active = false; return 'calm'; }
    if (arch === 'boss') {
      this.active = true;
      if (room.ctx.bossId) {
        g.bosses.spawn(room.ctx.bossId, room, room.ctx.bossTier || 0, { ngPlus: this.ngPlus, hpScale: room.ctx.bossHpScale || 1 });
      } else {
        const n = Math.floor(room.index / 5) - 1;
        const b = this.bossFor(n);
        this.bossCount = n + 1;
        g.bosses.spawn(b.type, room, b.tier);
      }
      return 'boss';
    }
    if (arch === 'miniboss') {
      this.active = true;
      this.spawnMinis(room, i);
      // a light escort wave arrives later
      const comp = this.composition(i, 'arena', Math.min(8, 2 + i * 0.3), rng, { noSignaller: true });
      this.waves = [comp];
      this.eliteFlags = [comp.map(() => null)];
      this.waveT = 9;
      this.survival = false;
      return 'mini';
    }
    // room modifier from region 2 onward (endless), or occasionally in the campaign
    if (i > 5 && rng.chance(Math.min(0.4, 0.1 + i * 0.01) * (g.mode === 'campaign' ? 0.4 : 1))) {
      const keys = Object.keys(MODIFIERS);
      this.modifier = rng.pick(keys);
      g.style.routeMult *= MODIFIERS[this.modifier].scoreMul;
    }
    const budget = this.budget(i, arch) * (this.ngPlus ? 1.15 : 1);
    const units = this.compositionUnits(i, arch, budget, rng);
    rng.shuffle(units);
    const total = units.reduce((s, u) => s + (Array.isArray(u) ? u.length : 1), 0);
    // split into waves at unit boundaries so packs arrive together
    let nw = arch === 'survival' ? 4 : total > 9 ? 3 : total > 4 ? 2 : 1;
    if (i <= 1) nw = 1;
    const per = Math.ceil(total / nw);
    let cur = [];
    for (const u of units) {
      if (cur.length >= per && this.waves.length < nw - 1) { this.waves.push(cur); cur = []; }
      if (Array.isArray(u)) cur.push(...u); else cur.push(u);
    }
    this.waves.push(cur);
    this.waves = this.waves.filter((w) => w.length);
    // elites
    const ec = this.eliteChance(i, arch);
    const mods = Object.keys(ELITE_MODS).filter((m) => i >= 6 || m !== 'blinking');
    const pickMod = (t) => rng.pick(NO_BLINK.has(t) ? mods.filter((m) => m !== 'blinking') : mods);
    this.eliteFlags = this.waves.map((w) => w.map((t) => (arch === 'elite' ? (t !== 'wisp' && rng.chance(0.75)) : rng.chance(ec)) && !NO_ELITE.has(t) ? pickMod(t) : null));
    if (arch === 'elite' && !this.eliteFlags.flat().some(Boolean)) {
      const k = this.waves[0].findIndex((t) => !NO_ELITE.has(t));
      if (k >= 0) this.eliteFlags[0][k] = pickMod(this.waves[0][k]);
    }
    this.survival = arch === 'survival';
    this.active = true;
    if (this.modifier === 'blackout') {
      g.level.lights.forEach((l) => { l.userData.base *= 0.35; });
      g.scene.fog.far *= 0.6;
    }
    return 'combat';
  }

  spawnMinis(room, heat) {
    const g = this.game;
    const defs = room.ctx.miniDefs || [];
    const pp = g.player.body.pos;
    defs.forEach((def, k) => {
      const x = room.wx((k - (defs.length - 1) / 2) * 8), z = room.wz(-room.D / 2 + 9);
      const pos = new THREE.Vector3(x, 0.05, z);
      void pp;
      const e = new Miniboss(g, pos, {
        def, hpMul: (room.ctx.miniHpMul || 1) * (1 + Math.min(heat, 40) * 0.035) * (this.ngPlus ? 1.3 : 1),
        dmgMul: this.dmgMul(heat), aggr: this.aggr(heat),
      });
      e.introHold = true;
      g.enemies.list.push(e);
      this.minis.push(e);
    });
  }

  // Abilities and boss gimmicks call this to bring in adds near a position.
  spawnSummons(types, n, nearPos) {
    const g = this.game;
    const room = g.level.current;
    if (!room) return;
    const rng = new RNG(hashSeed(this.seed, 'summon', g.time * 100 | 0));
    const heat = this.heatOf(room);
    const pp = g.player.body.pos;
    const nav = room.nav;
    let made = 0;
    if (this.minisDown) return;
    for (let tries = 0; tries < 60 && made < n; tries++) {
      if (this.load() >= this.maxAlive()) break;
      const a = rng.next() * Math.PI * 2, r = rng.range(3, 8);
      const x = nearPos.x + Math.cos(a) * r, z = nearPos.z + Math.sin(a) * r;
      const k = nav.idx(x, z);
      if (k < 0 || !nav.free(k)) continue;
      if (Math.hypot(x - pp.x, z - pp.z) < 5) continue;
      if (room.hazardAt(x, z, 0)) continue;
      const type = rng.pick(types);
      g.enemies.spawn(type, new THREE.Vector3(x, FLYING_TYPES.has(type) ? 3 : room.floorAt(x, z) + 0.05, z), { hpMul: this.hpMul(heat) * 0.8, dmgMul: this.dmgMul(heat), aggr: this.aggr(heat) });
      made++;
    }
  }

  spawnWave(list, eliteFlags) {
    const g = this.game;
    const room = g.level.current;
    if (!room || this.minisDown) return;
    const i = this.heatOf(room);
    const rng = new RNG(hashSeed(this.seed, 'spawn', room.index, this.waveIdx, g.time | 0));
    const used = [];
    let packAt = null;
    list.forEach((type, k) => {
      if (this.load() >= this.maxAlive()) return;
      // pack members spawn around the first of their pack
      const spot = (PACK[type] && packAt && packAt.type === type && this.findNear(room, packAt.pos, used, rng)) || this.findSpawn(room, type, rng, used);
      if (!spot) return;
      packAt = PACK[type] ? (packAt && packAt.type === type ? packAt : { type, pos: spot.pos }) : null;
      used.push(spot.pos);
      let elite = eliteFlags ? eliteFlags[k] : null;
      if (this.modifier === 'armored' && !elite) elite = 'shielded';
      if (this.modifier === 'volatile' && !elite) elite = 'volatile';
      const e = g.enemies.spawn(type, spot.pos, {
        elite, perch: spot.perch, hpMul: this.hpMul(i) * (this.modifier === 'armored' && elite === 'shielded' && !eliteFlags?.[k] ? 0.625 : 1) * (this.ngPlus ? 1.2 : 1),
        dmgMul: this.dmgMul(i), aggr: this.aggr(i) * (this.modifier === 'overcharged' ? 0.8 : 1),
      });
      if (this.modifier === 'overcharged' || this.cond === 'haste') e.speedMul *= 1.2;
      if (this.ngPlus) e.corrupt = true;
      if (type === 'signaller') this.signallers++;
    });
  }

  findNear(room, at, used, rng) {
    const nav = room.nav;
    for (let tries = 0; tries < 14; tries++) {
      const a = rng.next() * Math.PI * 2, r = 1 + rng.next() * 1.6;
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      const k = nav.idx(x, z);
      if (k < 0 || !nav.free(k) || room.hazardAt(x, z, 0)) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 0.7)) continue;
      return { pos: new THREE.Vector3(x, room.floorAt(x, z) + 0.05, z), perch: null };
    }
    return null;
  }

  findSpawn(room, type, rng, used) {
    const g = this.game;
    const nav = room.nav;
    const pp = g.player.body.pos;
    // perched spawn for ranged enemies
    const perchChance = { lancer: 0.8, sentry: 0.75, husk: 0.35, gunner: 0.35 }[type] || 0;
    if (perchChance && room.spec.perches.length && rng.chance(perchChance)) {
      const p = rng.pick(room.spec.perches);
      const perch = { x0: room.wx(p.x0), x1: room.wx(p.x1), z0: room.wz(p.z0), z1: room.wz(p.z1), y: p.y };
      perch.wx0 = perch.x0; perch.wx1 = perch.x1; perch.wz0 = perch.z0; perch.wz1 = perch.z1;
      const x = rng.range(perch.x0, perch.x1), z = rng.range(perch.z0, perch.z1);
      if (Math.hypot(x - pp.x, z - pp.z) > 6 && !used.some((u) => Math.hypot(u.x - x, u.z - z) < 1.5)) return { pos: new THREE.Vector3(x, p.y + 0.05, z), perch };
    }
    let best = null, bestScore = -1e9;
    const entZ = room.wz(room.D / 2), entX = room.wx(room.spec.entX);
    const fwd = g.player.fwd;
    const ideal = { lancer: 22, sentry: 18, ripper: 12, stalker: 11, leech: 11, swarmer: 13, charger: 16 }[type] || 15;
    const eye = g.camera.position;
    for (let tries = 0; tries < 40; tries++) {
      const k = Math.floor(rng.next() * nav.nx * nav.nz);
      if (!nav.free(k)) continue;
      const c = nav.center(k, { x: 0, z: 0 });
      const d = Math.hypot(c.x - pp.x, c.z - pp.z);
      if (d < 8) continue;
      if (Math.hypot(c.x - entX, c.z - entZ) < 5) continue;
      if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 1.6)) continue;
      if (room.hazardAt(c.x, c.z, 0) || room.hazards.some((h) => c.x > h.wx0 && c.x < h.wx1 && c.z > h.wz0 && c.z < h.wz1)) continue;
      // prefer medium distance, slight preference toward the far side of the room
      let score = -Math.abs(d - ideal) + rng.next() * 4;
      if (type === 'lancer' || type === 'sentry') score += (entZ - c.z) * 0.2;
      // ambushers like to start behind you
      if (type === 'stalker' && fwd) score -= ((c.x - pp.x) * fwd.x + (c.z - pp.z) * fwd.z) / Math.max(1, d) * 5;
      // a turret that cannot see the room is wasted
      if (type === 'sentry' && score > bestScore && !g.combat.losClear(new THREE.Vector3(c.x, room.floorAt(c.x, c.z) + 1.0, c.z), eye)) score -= 12;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;
    const y = type === 'wisp' ? 3 : type === 'bomber' ? Math.max(3.6, Math.min(6.5, (room.spec.H || 7) - 1.6)) : room.floorAt(best.x, best.z) + 0.05;
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
    const heat = this.heatOf(room);
    const comp = this.composition(heat, room.spec.arch, 2.5 + heat * 0.25, rng, { noSignaller: true, exclude: ['cantor'] });
    this.pendingBackup++;
    g.enemies.delayed(1.2, () => {
      // never below zero: a miniboss kill may already have cleared the pending count
      this.pendingBackup = Math.max(0, this.pendingBackup - 1);
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
    const pool = summon ? ['wisp', 'wisp', 'husk', 'ripper', 'swarmer'] : ['husk', 'ripper', 'wisp', 'gunner', 'swarmer'];
    if (!summon && tier >= 1) pool.push('leech', 'stalker');
    const n = Math.min(4, 2 + Math.floor(tier / 2));
    const list = [];
    for (let k = 0; k < n; k++) {
      const t = rng.pick(pool);
      if (PACK[t]) list.push(t, t); // swarmers never come alone
      list.push(t);
    }
    this.spawnWave(list, null);
  }

  // the last miniboss in a containment room takes its escorts and summons down with it
  shutdownEscorts(room) {
    const g = this.game;
    if (room !== g.level.current) return;
    for (const o of g.enemies.list) {
      if (!o.alive || o.mini) continue;
      g.fx.sparksBurst(o.centerPos().clone(), 0xffd060, 10, 5, 0.35);
      g.combat.damageEnemy(o, 1e6, { source: 'explosion', fromPlayer: false, quiet: true });
    }
  }

  // NG+: corrupted enemies sometimes rise again as wisps
  onKill(e) {
    const g = this.game;
    if (e.mini && this.minis.includes(e) && !this.minis.some((m) => m.alive)) {
      this.waveIdx = this.waves.length;
      this.pendingBackup = 0;
      this.minisDown = true; // no more waves, backups or summons in this room
      const room = g.level.current;
      g.hud.toast('LINK SEVERED · ESCORTS SHUT DOWN', '#ffd060');
      g.enemies.delayed(0.45, () => this.shutdownEscorts(room));
      return;
    }
    if (!e.corrupt || NO_RISE.has(e.type) || Math.random() > 0.3) return;
    const room = g.level.current;
    const p = e.pos.clone();
    g.enemies.delayed(0.7, () => {
      if (room !== g.level.current || room.state !== 'combat') return;
      p.y = 2.4;
      const w = g.enemies.spawn('wisp', p, { hpMul: 0.7, dmgMul: this.dmgMul(this.heatOf(room)) });
      w.corrupt = false;
      g.hud.toast('THE DEAD DO NOT STAY DOWN', '#c060ff', true);
    });
  }

  // NG+: the Warden hunts anyone who lingers
  spawnWarden(room) {
    const g = this.game;
    const def = {
      id: 'warden', name: 'THE WARDEN', title: 'IT KEEPS THE CYCLE', chassis: 'warden', colors: [0x1a1a22, 0x050508, 0xe8e8ff], scale: 1.5,
      abilities: [['lunge', { count: 2 }], ['laser', {}], ['blink', {}]], enrage: [['spokes', { n: 3 }]], hp: 1600, move: 'chase', speed: 5,
      lore: 'Every cycle needs a keeper. The Warden makes sure nobody stays anywhere long enough to think.',
    };
    const pp = g.player.body.pos;
    const pos = new THREE.Vector3(room.wx(room.spec.entX), 0.05, room.wz(room.D / 2 - 3));
    if (pos.distanceTo(pp) < 6) pos.set(room.wx(0), 0.05, room.wz(-room.D / 2 + 4));
    const e = new Miniboss(g, pos, { def, hpMul: 1 + this.heatOf(room) * 0.03, dmgMul: this.dmgMul(this.heatOf(room)), aggr: 0.8 });
    e.warden = true;
    g.enemies.list.push(e);
    this.warden = e;
    g.audio.play('sting', null, 1);
    g.hud.banner('THE WARDEN', 'YOU STAYED TOO LONG', '#e8e8ff', 2.6);
    g.emit('warden');
  }

  update(dt) {
    const g = this.game;
    const room = g.level.current;
    if (!this.active || !room || room.state !== 'combat') return;
    this.combatT += dt;
    if (g.bosses.active) {
      if (g.bosses.active.final) return; // the ending sequence owns the final room
      // boss room clears when the boss is dead and its escorts are gone
      if (!g.bosses.active.alive && g.enemies.aliveCount === 0) { this.clearT += dt; if (this.clearT > 2.2) { this.active = false; g.onRoomCleared(room); } }
      return;
    }
    if (this.ngPlus && !this.warden && this.combatT > (g.campaign.cycle >= 2 ? 50 : 70) && room.spec.arch !== 'miniboss') this.spawnWarden(room);
    this.waveT -= dt;
    const alive = g.enemies.aliveCount;
    const minisAlive = this.minis.some((m) => m.alive);
    if (this.waveIdx < this.waves.length) {
      const total = this.waves[Math.max(0, this.waveIdx - 1)]?.length || 1;
      const ready = this.minis.length ? (this.waveT <= 0 && minisAlive)
        : this.waveIdx === 0 ? this.waveT <= 0
          : this.survival ? (this.waveT <= 0 || alive <= 2)
            : (alive <= Math.max(1, Math.floor(total * 0.34)) || this.waveT <= -18);
      if (ready) {
        this.spawnWave(this.waves[this.waveIdx], this.eliteFlags[this.waveIdx]);
        this.waveIdx++;
        this.waveT = this.survival ? 13 : 0;
        if (this.waveIdx > 1 || this.minis.length) g.hud.toast(this.survival ? 'WAVE ' + this.waveIdx + ' / ' + this.waves.length : 'REINFORCEMENTS', '#ff8a3a', true);
      } else if (this.minis.length && !minisAlive) this.waveIdx = this.waves.length;
    } else if (alive === 0 && this.pendingBackup <= 0) {
      this.clearT += dt;
      if (this.clearT > (this.minis.length ? 1.2 : 0.4)) { this.active = false; g.onRoomCleared(room); }
    } else if (this.minisDown && alive > 0) {
      // stragglers that slipped in after the shutdown (late summons, delayed spawns) go too
      this.lateT += dt;
      if (this.lateT > 1.5) { this.lateT = 0; this.shutdownEscorts(room); }
    }
  }

  remaining() {
    let n = this.game.enemies.aliveCount;
    if (!this.minis.length) for (let w = this.waveIdx; w < this.waves.length; w++) n += this.waves[w].length;
    return n;
  }
}
