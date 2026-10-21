// Persistent profile: codex (logs, bosses, minibosses), level ranks, medals, campaign
// checkpoint, endless records and cosmetic skins. All storage access is guarded.
// Progression rewards mastery (ranks, medals, codex completion) — there are no timers,
// streaks or randomized purchases.

import { LOGS } from '../data/lore.js';
import { BOSSES } from '../data/bossdata.js';
import { MINIBOSSES } from '../data/minidata.js';

const KEY = 'voltgrave.profile.v2';
const OLD = 'voltgrave.records.v1';

function load(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export const RANK_ORDER = ['D', 'C', 'B', 'A', 'S', 'P'];
export const RANK_COLOR = { D: '#6a8cff', C: '#5aff8a', B: '#ffd23a', A: '#ff8a1a', S: '#ff3050', P: '#ffffff' };

export const SKINS = [
  { id: 'default', name: 'STANDARD ISSUE', req: null },
  { id: 'verdigris', name: 'VERDIGRIS', req: 'graduate' },
  { id: 'bloodline', name: 'BLOODLINE', req: 'srank' },
  { id: 'gilded', name: 'GILDED', req: 'architect' },
  { id: 'void', name: 'VOID', req: 'cycle2' },
  { id: 'obsidian', name: 'OBSIDIAN', req: 'prank' },
];

// id, name, description, test(profile) -> bool
export const MEDALS = [
  ['firstblood', 'FIRST SHIFT', 'Destroy your first machine.', (p) => p.stats.kills >= 1],
  ['graduate', 'GRADUATE', 'Complete the training deck.', (p) => p.tutorialDone],
  ['hundred', 'CENTURY', 'Destroy 100 machines.', (p) => p.stats.kills >= 100],
  ['thousand', 'SCRAP MOUNTAIN', 'Destroy 1,000 machines.', (p) => p.stats.kills >= 1000],
  ['ricochet', 'PENNY FOR THEM', 'Hit 25 coin ricoshots.', (p) => p.stats.ricoshots >= 25],
  ['ricochain', 'BANK SHOT', 'Chain a ricoshot through 3 coins.', (p) => p.stats.bestRicochain >= 3],
  ['parry', 'RETURN TO SENDER', 'Parry 50 projectiles.', (p) => p.stats.parries >= 50],
  ['bhop', 'BUNNY', 'Chain 5 bunny hops without touching the ground for long.', (p) => p.stats.bestBhop >= 5],
  ['speed', 'SPEED DEMON', 'Move faster than 30 m/s.', (p) => p.stats.maxSpeed >= 30],
  ['slam', 'SLAM DUNK', 'Land 50 ground slams.', (p) => p.stats.slams >= 50],
  ['hook', 'COME HERE', 'Yank 50 machines with the hook.', (p) => p.stats.yanks >= 50],
  ['barrel', 'PYROTECHNICS', 'Detonate 30 barrels.', (p) => p.stats.barrels >= 30],
  ['stylex', 'ULTRAVIOLENT', 'Reach the top style rank.', (p) => p.stats.peakStyle >= 6],
  ['mini10', 'CONTAINMENT', 'Defeat 10 different minibosses.', (p) => Object.values(p.minis).filter((n) => n > 0).length >= 10],
  ['mini60', 'ZOOKEEPER', 'Defeat all 60 minibosses.', (p) => MINIBOSSES.every((m) => p.minis[m.id] > 0)],
  ['boss5', 'GIANT KILLER', 'Defeat 5 different bosses.', (p) => Object.values(p.bosses).filter((n) => n > 0).length >= 5],
  ['boss30', 'TROPHY WALL', 'Defeat all 30 bosses.', (p) => BOSSES.every((b) => p.bosses[b.id])],
  ['logs10', 'READER', 'Recover 10 logs.', (p) => Object.keys(p.logs).length >= 10],
  ['logsall', 'THE WHOLE TRUTH', 'Recover every log.', (p) => Object.keys(LOGS).every((k) => p.logs[k])],
  ['stratum5', 'HALFWAY DOWN', 'Reach the fifth stratum.', (p) => p.deepest >= 5],
  ['stratum10', 'ROCK BOTTOM', 'Reach the Core.', (p) => p.deepest >= 10],
  ['architect', 'BREAKER PULLED', 'Defeat THE ARCHITECT.', (p) => p.cyclesCleared >= 1],
  ['cycle2', 'CYCLE TWO', 'Defeat THE ARCHITECT on NG+.', (p) => p.cyclesCleared >= 2],
  ['srank', 'STYLISH', 'Earn an S rank on any level.', (p) => Object.values(p.ranks).some((r) => r === 'S' || r === 'P')],
  ['prank', 'PERFECT', 'Earn a P rank: S in everything, no restarts.', (p) => Object.values(p.ranks).some((r) => r === 'P')],
  ['s10', 'CONSISTENT', 'Earn S or better on 10 levels.', (p) => Object.values(p.ranks).filter((r) => r === 'S' || r === 'P').length >= 10],
  ['flawlessboss', 'UNTOUCHABLE', 'Defeat a boss without taking damage.', (p) => p.stats.flawlessBosses >= 1],
  ['endless20', 'DEEP RUN', 'Reach room 20 in Endless.', (p) => p.endless.bestRoom >= 20],
  ['endless50', 'NO BOTTOM', 'Reach room 50 in Endless.', (p) => p.endless.bestRoom >= 50],
  ['warden', 'KEEPER OF NOTHING', 'Destroy THE WARDEN.', (p) => p.stats.wardens >= 1],
  // movement + combat tech
  ['quickscope', 'FLICK', 'Land 25 quickscopes.', (p) => p.stats.quickscopes >= 25],
  ['noscope', 'NOTHING BUT NET', 'Land a no-scope kill from 30 m or more.', (p) => p.stats.longestNoScope >= 30],
  ['wallrun', 'PARKOUR', 'Wall-run 100 times.', (p) => p.stats.wallruns >= 100],
  ['vault', 'OVER THE TOP', 'Vault 50 ledges.', (p) => p.stats.vaults >= 50],
  ['dashslide', 'SKID MARKS', 'Dash-slide 50 times.', (p) => p.stats.dashSlides >= 50],
  ['finisher', 'EXECUTIONER', 'Execute 50 broken machines.', (p) => p.stats.finishers >= 50],
  ['dodge', 'NOT THERE', 'Pull off 25 perfect dodges.', (p) => p.stats.perfectDodges >= 25],
  ['boost', 'BATTER UP', 'Punch-boost 20 of your own projectiles.', (p) => p.stats.projBoosts >= 20],
  ['rush', 'OVERDRIVE', 'Unleash RUSH 10 times.', (p) => p.stats.rushes >= 10],
];

// The STATS page: [group, [[label, value], ...]] built from the profile. Plain totals and bests;
// nothing here counts down or nags.
export function statRows(p) {
  const s = p.stats, n = (v) => Math.floor(v || 0).toLocaleString('en-US');
  const time = (sec) => { sec = Math.floor(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60; return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm'; };
  const ranked = Object.values(p.ranks || {});
  return [
    ['COMBAT', [['Machines destroyed', n(s.kills)], ['Executions', n(s.finishers)], ['Parries', n(s.parries)], ['Ricoshots', n(s.ricoshots) + (s.bestRicochain > 1 ? '  ·  best chain ' + s.bestRicochain : '')],
      ['Coins flipped', n(s.coins)], ['Quickscopes', n(s.quickscopes)], ['No-scopes', n(s.noscopes) + (s.longestNoScope ? '  ·  longest ' + s.longestNoScope + ' m' : '')],
      ['Projectile boosts', n(s.projBoosts)], ['RUSH unleashed', n(s.rushes)], ['Barrels detonated', n(s.barrels)], ['Hook yanks', n(s.yanks)]]],
    ['MOVEMENT', [['Top speed', n(s.maxSpeed) + ' m/s'], ['Longest bunny hop chain', n(s.bestBhop)], ['Wall-runs', n(s.wallruns)], ['Vaults', n(s.vaults)],
      ['Dash-slides', n(s.dashSlides)], ['Slide kicks', n(s.slideKicks)], ['Ground slams', n(s.slams)], ['Perfect dodges', n(s.perfectDodges)]]],
    ['DESCENT', [['Deepest stratum', p.deepest ? String(p.deepest) + ' / 10' : '-'], ['Bosses destroyed', Object.values(p.bosses).filter((v) => v > 0).length + ' / ' + BOSSES.length],
      ['Minibosses neutralized', Object.values(p.minis).filter((v) => v > 0).length + ' / ' + MINIBOSSES.length], ['Logs recovered', Object.keys(p.logs).length + ' / ' + Object.keys(LOGS).length],
      ['Levels at S or better', String(ranked.filter((r) => r === 'S' || r === 'P').length)], ['Flawless boss kills', n(s.flawlessBosses)], ['Cycles cleared', n(p.cyclesCleared)],
      ['Endless best', p.endless.runs ? n(p.endless.bestScore) + '  ·  room ' + p.endless.bestRoom : '-'], ['Deaths', n(s.deaths)], ['Time played', time(s.playtime)]]],
  ];
}

function fresh() {
  return {
    v: 2,
    tutorialDone: false,
    logs: {}, bosses: {}, minis: {}, enemies: {},
    ranks: {}, best: {},
    medals: {},
    stats: { kills: 0, ricoshots: 0, bestRicochain: 0, parries: 0, bestBhop: 0, maxSpeed: 0, slams: 0, yanks: 0, barrels: 0, peakStyle: 0, deaths: 0, flawlessBosses: 0, wardens: 0, playtime: 0, coins: 0,
      quickscopes: 0, noscopes: 0, longestNoScope: 0, wallruns: 0, vaults: 0, dashSlides: 0, slideKicks: 0, finishers: 0, perfectDodges: 0, projBoosts: 0, rushes: 0 },
    deepest: 0, cyclesCleared: 0,
    save: null,
    skin: 'default',
    endless: { bestScore: 0, bestRoom: 0, runs: 0, bosses: 0 },
    daily: {},
  };
}

export class Profile {
  constructor() {
    const d = load(KEY);
    this.p = fresh();
    if (d) {
      Object.assign(this.p, d);
      this.p.stats = { ...fresh().stats, ...(d.stats || {}) };
      this.p.endless = { ...fresh().endless, ...(d.endless || {}) };
    } else {
      // migrate the old endless records
      const old = load(OLD);
      if (old) Object.assign(this.p.endless, { bestScore: old.bestScore || 0, bestRoom: old.bestRoom || 0, runs: old.runs || 0, bosses: old.bossesKilled || 0 });
    }
    this.dirty = false;
    this.newMedals = [];
  }
  get v() { return this.p; }
  persist() { save(KEY, this.p); this.dirty = false; }
  touch() { this.dirty = true; }
  flush() { if (this.dirty) this.persist(); }

  // ---- codex
  hasLog(id) { return !!this.p.logs[id]; }
  addLog(id) { if (this.p.logs[id]) return false; this.p.logs[id] = Date.now(); this.touch(); this.checkMedals(); return true; }
  killedBoss(id) { this.p.bosses[id] = (this.p.bosses[id] || 0) + 1; this.touch(); this.checkMedals(); }
  killedMini(id) { this.p.minis[id] = (this.p.minis[id] || 0) + 1; this.touch(); this.checkMedals(); }
  // a boss or miniboss is "seen" (shows silhouette entry) once encountered
  sawBoss(id) { if (!this.p.bosses[id]) { this.p.bosses[id] = this.p.bosses[id] || 0; this.touch(); } }
  sawMini(id) { if (this.p.minis[id] === undefined) { this.p.minis[id] = 0; this.touch(); } }

  // ---- stats from the event bus
  stat(k, n = 1) { this.p.stats[k] = (this.p.stats[k] || 0) + n; this.touch(); }
  statMax(k, v) { if (v > (this.p.stats[k] || 0)) { this.p.stats[k] = v; this.touch(); } }

  // Counters for the movement/combat tech, wired straight to the game's event bus (main.js wires
  // the older ones). Stat-based medals are checked here too, throttled, so they pop when earned.
  attach(game) {
    if (this.game) return;
    this.game = game;
    const on = (ev, fn) => game.on(ev, (d) => { fn(d); this.soonCheck(); });
    on('quickscope', () => this.stat('quickscopes'));
    on('noscope', (far) => { this.stat('noscopes'); if (far > 0) this.statMax('longestNoScope', Math.round(far)); });
    on('wallrun', () => this.stat('wallruns'));
    on('mantle', () => this.stat('vaults'));
    on('dashslide', () => this.stat('dashSlides'));
    on('slidekick', (n) => this.stat('slideKicks', n > 0 ? n : 1));
    on('finisher', () => this.stat('finishers'));
    on('perfectDodge', () => this.stat('perfectDodges'));
    on('projBoost', () => this.stat('projBoosts'));
    on('rush', () => this.stat('rushes'));
    for (const ev of ['kill', 'parry', 'ricoshot', 'slam', 'yank', 'barrel', 'bhop', 'coin']) game.on(ev, () => this.soonCheck());
    // time played: whole seconds while actually in play (saved with the next periodic flush)
    this.clock = setInterval(() => { if (game.state === 'playing') { this.p.stats.playtime = (this.p.stats.playtime || 0) + 1; this.dirty = true; } }, 1000);
  }
  soonCheck() {
    if (this.checkT) return;
    this.checkT = setTimeout(() => { this.checkT = 0; this.checkMedals(); }, 300);
  }

  // ---- campaign
  setRank(levelId, rank, score, time) {
    const cur = this.p.ranks[levelId];
    if (!cur || RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(cur)) this.p.ranks[levelId] = rank;
    const b = this.p.best[levelId] || {};
    if (!b.score || score > b.score) b.score = score;
    if (!b.time || time < b.time) b.time = time;
    this.p.best[levelId] = b;
    this.touch(); this.checkMedals();
  }
  reachStratum(n) { if (n > this.p.deepest) { this.p.deepest = n; this.touch(); this.checkMedals(); } }
  clearCycle(cycle) { this.p.cyclesCleared = Math.max(this.p.cyclesCleared, cycle + 1); this.touch(); this.checkMedals(); this.persist(); }
  writeSave(s) { this.p.save = s; this.persist(); }
  clearSave() { this.p.save = null; this.persist(); }

  endlessResult(run) {
    const e = this.p.endless;
    const newBest = run.score > e.bestScore;
    e.bestScore = Math.max(e.bestScore, run.score);
    e.bestRoom = Math.max(e.bestRoom, run.room);
    e.bosses += run.bosses;
    e.runs += 1;
    if (run.daily) this.p.daily[run.daily] = Math.max(this.p.daily[run.daily] || 0, run.score);
    this.touch(); this.checkMedals(); this.persist();
    return newBest;
  }

  // ---- medals
  checkMedals() {
    for (const [id, name, , test] of MEDALS) {
      if (this.p.medals[id]) continue;
      let ok = false;
      try { ok = test(this.p); } catch { ok = false; }
      if (ok) { this.p.medals[id] = Date.now(); this.newMedals.push(name); this.touch(); }
    }
  }
  popMedal() { return this.newMedals.shift(); }
  skinUnlocked(s) { return !s.req || !!this.p.medals[s.req]; }
}
