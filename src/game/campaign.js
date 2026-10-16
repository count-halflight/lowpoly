import * as THREE from 'three';
import { LEVELS, STRATA, CONDITIONS, FINAL_LEVEL } from '../data/world.js';
import { BOSSES, bossById } from '../data/bossdata.js';
import { MINIBOSSES, miniById } from '../data/minidata.js';
import { THEMES } from '../render/materials.js';
import { RNG, hashSeed } from '../core/rng.js';
import { ROUTES } from './director.js';
import { WEAPON_ORDER } from './weapons.js';
import { RANK_ORDER } from './meta.js';

// The descent. A playthrough is 30 levels (3 of the 5 levels in each of the 10 strata, picked
// and ordered per seed) plus the final level. Every level has two minibosses and ends in a
// boss, so a full cycle meets all 30 bosses and all 60 minibosses in a randomized order.
// NG+ cycles climb back UP through a mirrored world with corrupted enemies and a hunter.

// room sequence inside a level (index = local room number)
const SEQ = ['entry', 'combat', 'combat', 'mini', 'combat', 'mini', 'boss'];
const CHOICE = new Set([2, 4]); // these slots offer an alternative route
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export const NG_TWIST = [
  'THE GRID HAS REBUILT ITSELF INSIDE OUT.',
  'The descent now runs backwards: you climb from the Core to the surface.',
  'Every room is mirrored. The dead do not stay down.',
  'THE WARDEN hunts anyone who lingers in a fight.',
  'Every boss has a third phase. The Architect is waiting at the top.',
];

export function themeById(id) { return THEMES.find((t) => t.id === id) || THEMES[0]; }

export class Campaign {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.active = false;
    this.cycle = 0;
    this.plan = [];
    this.levelIdx = 0;
    this.practice = false;
    this.lv = null; // per-level stats
    this.checkpoint = null;
    this.seed = 1;
  }

  // ------------------------------------------------------------------ planning
  buildPlan(seed, cycle, played = []) {
    const rng = new RNG(hashSeed(seed, 'plan', cycle));
    const order = cycle % 2 === 1 ? [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // bosses: escalate by tier with a little randomness, 3 per stratum position
    const bosses = BOSSES.map((b) => ({ id: b.id, k: b.tier + rng.range(-1.3, 1.3) })).sort((a, b) => a.k - b.k).map((b) => b.id);
    // minibosses: natives of each stratum, with occasional swaps between neighbouring strata
    const pools = {};
    for (let s = 1; s <= 10; s++) pools[s] = rng.shuffle(MINIBOSSES.filter((m) => m.stratum === s).map((m) => m.id));
    for (let s = 1; s < 10; s++) for (let k = 0; k < 6; k++) if (rng.chance(0.2)) { const t = pools[s][k]; pools[s][k] = pools[s + 1][k]; pools[s + 1][k] = t; }
    const plan = [];
    order.forEach((s, pos) => {
      const levels = LEVELS.filter((l) => l.stratum === s)
        .map((l) => ({ l, k: (played.includes(l.id) ? 1 : 0) + rng.next() * 0.9 }))
        .sort((a, b) => a.k - b.k).slice(0, 3).map((x) => x.l);
      levels.sort((a, b) => a.i - b.i);
      const bs = rng.shuffle(bosses.slice(pos * 3, pos * 3 + 3));
      levels.forEach((l, j) => {
        const n = plan.length;
        plan.push({
          levelId: l.id, bossId: bs[j], minis: [pools[s][j * 2], pools[s][j * 2 + 1]],
          termRoom: rng.int(1, 5), log: l.id,
          nlog: cycle > 0 && n % 4 === 0 && n / 4 < 8 ? 'N' + (n / 4 + 1) : null,
        });
      });
    });
    plan.push({ levelId: 'X', bossId: 'architect', minis: [], termRoom: -1, log: null, final: true });
    return plan;
  }

  levelOf(entry) { return entry.final ? FINAL_LEVEL : LEVELS.find((l) => l.id === entry.levelId); }
  get entry() { return this.plan[this.levelIdx]; }
  get level() { return this.levelOf(this.entry); }
  get stratum() { return STRATA[this.level.stratum - 1]; }
  heat(local = 0) { return 2 + this.levelIdx * 1.15 + local * 0.3 + this.cycle * 14; }
  theme() {
    if (this.entry.final && this.cycle % 2 === 1) return themeById('service');
    return themeById(this.stratum.theme);
  }
  code() { return this.entry.final ? 'X' : this.level.id; }

  // ------------------------------------------------------------------ lifecycle
  newGame(seed, cycle = 0, opts = {}) {
    this.reset();
    this.active = true;
    this.seed = seed;
    this.cycle = cycle;
    this.plan = this.buildPlan(seed, cycle, opts.played || []);
    this.levelIdx = 0;
    this.practice = !!opts.practice;
  }

  // Practice a single level from the level select.
  newPractice(levelId, seed) {
    this.reset();
    this.active = true;
    this.practice = true;
    this.seed = seed;
    const l = levelId === 'X' ? FINAL_LEVEL : LEVELS.find((x) => x.id === levelId);
    const rng = new RNG(hashSeed(seed, 'practice', levelId));
    const natives = MINIBOSSES.filter((m) => m.stratum === l.stratum);
    const bosses = BOSSES.filter((b) => Math.abs(b.tier - l.stratum) <= 1);
    this.plan = [levelId === 'X' ? { levelId: 'X', bossId: 'architect', minis: [], termRoom: -1, final: true }
      : { levelId, bossId: rng.pick(bosses).id, minis: rng.shuffle(natives.map((m) => m.id)).slice(0, 2), termRoom: rng.int(1, 5), log: l.id }];
    this.levelIdx = 0;
    this.practiceDepth = levelId === 'X' ? 30 : (l.stratum - 1) * 3 + 1;
  }

  // difficulty depth used for heat (practice uses the level's natural depth)
  get depth() { return this.practice ? this.practiceDepth : this.levelIdx; }

  baseCtx(local) {
    const e = this.entry;
    const st = this.stratum;
    const heat = 2 + this.depth * 1.15 + local * 0.3 + this.cycle * 14;
    const ctx = { themeObj: this.theme(), cond: this.level.cond || 'none', kit: st.kit, heat, mirror: this.cycle % 2 === 1, local };
    if (local === e.termRoom && e.log) ctx.terminal = e.log;
    else if (local === 0 && e.nlog) ctx.terminal = e.nlog;
    return ctx;
  }

  pickCombatArch(local) {
    const rng = new RNG(hashSeed(this.seed, 'arch', this.levelIdx, local, this.cycle));
    const arches = this.level.arches || { arena: 1 };
    const keys = Object.keys(arches).filter((a) => a !== this.lastArch);
    const a = rng.weighted(keys.length ? keys : Object.keys(arches), (k) => arches[k]);
    this.lastArch = a;
    return a;
  }

  // Context for the room that a route leads into.
  ctxFor(route, local) {
    const ctx = this.baseCtx(local);
    const kind = SEQ[local] || 'combat';
    if (this.entry.final) {
      Object.assign(ctx, { arch: 'boss', bossType: 'architect', bossId: 'architect', bossDef: { arena: 'architect' }, cond: 'none', kit: null });
      return ctx;
    }
    if (route.type === 'cache') { ctx.arch = 'cache'; ctx.cond = 'none'; return ctx; }
    if (route.type === 'hazard') { ctx.arch = 'hazard'; return ctx; }
    if (route.type === 'elite') { ctx.arch = 'elite'; return ctx; }
    if (route.type === 'survival') { ctx.arch = 'survival'; return ctx; }
    if (kind === 'mini') {
      const which = local === 3 ? 0 : 1;
      const ids = this.cycle > 0 && which === 1 ? this.entry.minis : [this.entry.minis[which]];
      ctx.arch = 'miniboss';
      ctx.miniDefs = ids.map(miniById).filter(Boolean);
      ctx.miniHpMul = ids.length > 1 ? 0.75 : 1;
      return ctx;
    }
    if (kind === 'boss') {
      const def = bossById(this.entry.bossId);
      Object.assign(ctx, {
        arch: 'boss', bossType: def.id, bossDef: def, bossId: def.id, bossTier: 0,
        bossHpScale: 1 + this.depth * 0.035 + this.cycle * 0.45, cond: 'none',
      });
      return ctx;
    }
    ctx.arch = this.pickCombatArch(local);
    return ctx;
  }

  // Exit routes after a room is cleared (local = index of the cleared room)
  routesFor(room) {
    const next = room.index + 1;
    if (this.entry.final) return room.index === 0 ? [{ type: 'boss', ...ROUTES.boss, sub: 'THE ARCHITECT' }] : [{ type: 'exit', ...ROUTES.exit, sub: 'THE END' }];
    if (next >= SEQ.length) return [{ type: 'exit', ...ROUTES.exit, sub: this.levelIdx + 1 < this.plan.length && !this.practice ? 'NEXT: ' + this.levelOf(this.plan[this.levelIdx + 1]).name : 'LEVEL COMPLETE' }];
    const kind = SEQ[next];
    if (kind === 'boss') return [{ type: 'boss', ...ROUTES.boss, sub: bossById(this.entry.bossId).name }];
    if (kind === 'mini') return [{ type: 'mini', ...ROUTES.mini, label: 'CONTAINMENT', sub: 'MINIBOSS SIGNAL' }];
    const main = { type: 'combat', ...ROUTES.combat, label: 'ROOM ' + String(next).padStart(2, '0'), sub: this.condName() || 'ADVANCE' };
    if (!CHOICE.has(next) || room.exitDoors.length < 2) return [main];
    const rng = new RNG(hashSeed(this.seed, 'routes', this.levelIdx, next, this.cycle));
    const alt = rng.pick(this.levelIdx < 2 ? ['hazard', 'cache'] : ['hazard', 'elite', 'cache', 'survival']);
    return rng.chance(0.5) ? [main, { type: alt, ...ROUTES[alt] }] : [{ type: alt, ...ROUTES[alt] }, main];
  }

  condName() { const c = CONDITIONS[this.level.cond]; return c && c.name ? c.name : ''; }

  // cache reward for a cleared room in the campaign (null = no cache)
  rewardFor(room) {
    const arch = room.spec.arch;
    if (arch === 'boss') return 'boss';
    if (arch === 'miniboss') return room.index === 3 ? 'rare' : 'standard';
    const r = room.route && room.route.type;
    if (arch === 'cache' || r === 'cache') return 'supply';
    if (r === 'hazard' || r === 'elite') return 'rare';
    if (r === 'survival') return 'standard';
    if (room.index === 1 && this.levelIdx === 0) return 'standard';
    return null;
  }

  // ------------------------------------------------------------------ per-level stats + ranks
  beginLevelStats() {
    const g = this.game, r = g.run;
    this.lv = { t0: r.time, kills0: r.kills, score0: g.style.score, dmg0: r.damageTaken, secrets: 0, restarts: this.lv && this.lv.levelIdx === this.levelIdx ? this.lv.restarts : 0, levelIdx: this.levelIdx, bossDmg0: 0 };
  }

  results() {
    const g = this.game, r = g.run, lv = this.lv;
    const time = r.time - lv.t0;
    const kills = r.kills - lv.kills0;
    const score = Math.floor(g.style.score - lv.score0);
    const dmg = Math.round(r.damageTaken - lv.dmg0);
    const final = this.entry.final;
    const par = final ? 300 : 520 + this.depth * 6;
    const g1 = (v, cuts) => (v <= cuts[0] ? 4 : v <= cuts[1] ? 3 : v <= cuts[2] ? 2 : v <= cuts[3] ? 1 : 0);
    const timeG = g1(time, [par * 0.6, par * 0.8, par, par * 1.4]);
    const target = final ? 2500 : 2400 + this.depth * 60;
    const styleG = score >= target ? 4 : score >= target * 0.7 ? 3 : score >= target * 0.45 ? 2 : score >= target * 0.25 ? 1 : 0;
    const dmgG = g1(dmg, [60, 140, 240, 380]);
    let idx = Math.round((timeG + styleG + dmgG) / 3);
    if (lv.restarts > 0) idx = Math.min(idx, 3);
    let rank = RANK_ORDER[idx];
    const hasSecret = !this.entry.log || g.profile.hasLog(this.entry.log);
    if (timeG === 4 && styleG === 4 && dmgG === 4 && lv.restarts === 0 && hasSecret) rank = 'P';
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    return {
      code: this.code(), name: this.level.name, stratum: this.stratumLabel(),
      rows: [
        ['TIME', fmt(time), RANK_ORDER[timeG]],
        ['STYLE', score, RANK_ORDER[styleG]],
        ['DAMAGE TAKEN', dmg, RANK_ORDER[dmgG]],
        ['KILLS', kills, ''],
        ['RESTARTS', lv.restarts, lv.restarts ? 'C MAX' : ''],
        ['SECRET LOG', this.entry.log ? (g.profile.hasLog(this.entry.log) ? 'FOUND' : 'MISSED') : '-', ''],
      ],
      rank, time, score,
    };
  }

  stratumLabel() {
    if (this.entry.final) return 'THE CORE · FINAL';
    const n = this.cycle % 2 === 1 ? 11 - this.level.stratum : this.level.stratum;
    return 'STRATUM ' + ROMAN[this.level.stratum] + ' · ' + this.stratum.name + (this.cycle ? '  ·  CYCLE ' + ROMAN[this.cycle + 1] : '') + (this.practice ? '  ·  PRACTICE' : '') + (n !== this.level.stratum ? '' : '');
  }

  // ------------------------------------------------------------------ checkpoints
  snapshot() {
    const g = this.game;
    return {
      v: 1, seed: this.seed, cycle: this.cycle, levelIdx: this.levelIdx, plan: this.plan,
      hp: g.player.hp, upgrades: g.upgrades.snapshot(), weapons: g.weapons.snapshot(),
      score: g.style.score, run: { kills: g.run.kills, bosses: g.run.bosses, time: g.run.time, damageTaken: g.run.damageTaken, damageDealt: g.run.damageDealt, minis: g.run.minis || 0 },
      restarts: this.lv ? this.lv.restarts : 0, practice: this.practice, practiceDepth: this.practiceDepth,
    };
  }

  restore(s) {
    const g = this.game;
    this.reset();
    this.active = true;
    this.seed = s.seed; this.cycle = s.cycle; this.levelIdx = s.levelIdx; this.plan = s.plan;
    this.practice = !!s.practice; this.practiceDepth = s.practiceDepth;
    g.upgrades.restore(s.upgrades);
    g.weapons.restore(s.weapons);
    g.player.hp = Math.min(g.player.stats.maxHp, s.hp);
    g.style.score = s.score;
    Object.assign(g.run, s.run);
    this.lv = { levelIdx: s.levelIdx, restarts: s.restarts || 0 };
  }

  // a fresh loadout for practice: weapons scale with depth
  practiceLoadout() {
    const g = this.game;
    const n = Math.min(WEAPON_ORDER.length, 1 + Math.floor(this.practiceDepth / 5));
    for (let i = 1; i < n; i++) g.weapons.give(WEAPON_ORDER[i]);
    g.weapons.select('hammer');
  }

  // Where the player's run carries into the next cycle (weapons + upgrades stay)
  nextCycleCarry() {
    const g = this.game;
    return { upgrades: g.upgrades.snapshot(), weapons: g.weapons.snapshot(), played: this.plan.map((e) => e.levelId) };
  }

  // spawn point for the entry room
  spawnPoint(room) { return new THREE.Vector3(room.wx(room.spec.entX), 0.05, room.wz(room.D / 2 - 3)); }
}

export { SEQ, ROMAN };
