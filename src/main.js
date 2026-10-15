import * as THREE from 'three';
import '@fontsource/libre-caslon-condensed/latin-400.css';
import '@fontsource/libre-caslon-condensed/latin-700.css';
import '@fontsource/vt323/latin-400.css';
import './style.css';
import { Settings, isTouchDevice } from './core/settings.js';
import { Renderer } from './render/renderer.js';
import { Audio } from './core/audio.js';
import { Input, TouchControls } from './core/input.js';
import { RNG, hashSeed } from './core/rng.js';
import { FX } from './game/fx.js';
import { Combat } from './game/combat.js';
import { Level } from './world/level.js';
import { Player } from './game/player.js';
import { Weapons, DEFS } from './game/weapons.js';
import { Projectiles } from './game/projectiles.js';
import { Enemies, ENEMY_INFO } from './game/enemies.js';
import { BOSS_INFO } from './game/bosses.js';
import { Bosses } from './game/bossmgr.js';
import { Director, MODIFIERS } from './game/director.js';
import { Upgrades } from './game/upgrades.js';
import { Style } from './game/style.js';
import { Pickups } from './game/pickups.js';
import { Profile } from './game/meta.js';
import { Cutscene, bossIntro, miniIntro } from './game/cutscene.js';
import { Campaign, themeById } from './game/campaign.js';
import { Tutorial } from './game/tutorial.js';
import { buildBreaker } from './game/architect.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { STRATA, CONDITIONS } from './data/world.js';
import { ENDING, LOGS } from './data/lore.js';
import { bossById } from './data/bossdata.js';
import { miniById } from './data/minidata.js';
import { terminalCanvas } from './world/kits.js';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60));

class Game {
  constructor() {
    this.settings = new Settings();
    this.profile = new Profile();
    this.listeners = {};
    this.lowPower = isTouchDevice || (navigator.hardwareConcurrency || 8) <= 4;
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas, this.settings);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), 1, 0.05, 160);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.audio = new Audio(this.settings);
    this.input = new Input(this.settings, this.canvas);
    this.touch = new TouchControls(this.input, document.getElementById('touch'), this.settings);
    this.input.touch = this.touch;
    this.touch.onLookTap = (x, y) => {
      if (this.state !== 'playing' || !this.hud) return null;
      const id = this.hud.weaponAt(x, y);
      if (id) this.weapons.select(id);
      return id;
    };
    if (isTouchDevice) { document.body.classList.add('touch'); this.input.usingTouch = true; }

    this.time = 0;
    this.state = 'menu';
    this.mode = 'menu';
    this.timeScale = 1;
    this.slowT = 0;
    this.hitstopT = 0;
    this.trauma = 0;
    this.flashV = 0; this.flashColor = new THREE.Color(1, 1, 1);
    this.run = this.newRun(1);

    this.fx = new FX(this);
    this.combat = new Combat(this);
    this.level = new Level(this);
    this.player = new Player(this);
    this.weapons = new Weapons(this);
    this.projectiles = new Projectiles(this);
    this.enemies = new Enemies(this);
    this.bosses = new Bosses(this);
    this.director = new Director(this);
    this.upgrades = new Upgrades(this);
    this.style = new Style(this);
    this.pickups = new Pickups(this);
    this.cutscene = new Cutscene(this);
    this.campaign = new Campaign(this);
    this.tutorial = new Tutorial(this);
    this.hud = new HUD(this, document.getElementById('hud'));
    this.menus = new Menus(this, document.getElementById('menus'));
    this.weapons.setSkin(this.profile.v.skin);
    this.wireProfile();

    this.input.onLockLost = () => {
      if (this.ignoreLockLoss) { this.ignoreLockLoss = false; return; }
      if (this.state === 'playing' && !this.input.usingTouch) this.pause();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.profile.flush(); if (this.state === 'playing') this.pause(); }
    });
    window.addEventListener('pagehide', () => this.profile.flush());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.settings.onChange((k) => {
      if (k === 'resolution' || k === 'jitter' || k === '*') this.resize();
      if (k === 'master' || k === 'sfx' || k === 'music' || k === '*') this.audio.applyVolumes();
    });
    // prevent pinch zoom / scrolling gestures on iOS
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.screen')) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    // touch: first touch anywhere switches to touch mode (iPad with keyboard can still use keys)
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.input.usingTouch) { this.input.usingTouch = true; document.body.classList.add('touch'); this.hud.resize(); }
      else if (e.pointerType === 'mouse' && this.input.usingTouch && !isTouchDevice) { this.input.usingTouch = false; document.body.classList.remove('touch'); this.hud.resize(); }
    });

    this.resize();
    this.setupMenuScene();
    this.menus.show('title');
    this.last = performance.now();
    document.getElementById('boot').classList.add('gone');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ event bus
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, data) {
    const l = this.listeners[ev];
    if (l) for (const fn of l) fn(data);
    const all = this.listeners['*'];
    if (all) for (const fn of all) fn(ev, data);
  }

  wireProfile() {
    const P = this.profile;
    this.on('kill', () => P.stat('kills'));
    this.on('ricoshot', (n) => { P.stat('ricoshots'); P.statMax('bestRicochain', n || 1); });
    this.on('parry', () => P.stat('parries'));
    this.on('bhop', (n) => P.statMax('bestBhop', n || 1));
    this.on('slam', () => P.stat('slams'));
    this.on('yank', () => P.stat('yanks'));
    this.on('barrel', () => P.stat('barrels'));
    this.on('coin', () => P.stat('coins'));
    this.on('minibossKilled', (id) => {
      this.run.minis = (this.run.minis || 0) + 1;
      if (id === 'warden') P.stat('wardens');
      else if (!String(id).startsWith('echo-')) P.killedMini(id);
    });
  }

  newRun(seed, custom = false) {
    return { seed, customSeed: custom, room: 0, kills: 0, bosses: 0, minis: 0, damageTaken: 0, damageDealt: 0, shots: 0, backupCalled: 0, start: performance.now(), time: 0, defeatedBosses: [] };
  }

  resize() {
    this.renderer.resize();
    const a = this.renderer.width / this.renderer.height;
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    this.weapons.resize(a);
    if (this.hud) this.hud.resize();
  }

  // ------------------------------------------------------------------ menu background
  setupMenuScene() {
    this.clearWorld();
    this.level.reset(7);
    const s = STRATA[Math.floor(Math.random() * STRATA.length)];
    this.level.startLobby({ themeObj: themeById(s.theme), kit: s.kit, cond: 'none', arch: 'lobby' });
    this.menuT = 0;
    document.body.classList.remove('playing');
    this.hud.show(false);
  }

  clearWorld() {
    this.enemies.clear();
    this.bosses.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.removeBreaker();
    this.level.setDarkness(false);
  }

  // shared reset for every mode
  resetRun(seed, custom = false) {
    this.audio.init();
    if (this.input.usingTouch) this.toggleFullscreen(true);
    this.run = this.newRun(seed, custom);
    this.clearWorld();
    this.level.reset(seed);
    this.director.reset(seed);
    this.player.reset();
    this.weapons.reset();
    this.upgrades.reset();
    this.style.reset();
    this.hud.reset();
    this.shownHints = new Set();
    this.objective = '';
    this.tutorial.end();
  }

  enterPlay() {
    this.setState('playing');
    this.menus.show(null);
    this.hud.show(true);
    this.last = performance.now();
    this.input.requestLock();
  }

  // ------------------------------------------------------------------ ENDLESS
  startEndless(seed, custom = false, daily = null) {
    this.mode = 'endless';
    this.campaign.active = false;
    this.resetRun(seed, custom);
    this.run.daily = daily;
    const lobby = this.level.startLobby({});
    this.player.spawnAt(lobby.wx(0), 0.05, lobby.wz(lobby.D / 2 - 3), 0);
    this.hud.setRoom('LOBBY', (daily ? 'DAILY ' + daily : 'SEED ' + seed));
    this.hud.banner('ENDLESS', daily ? 'DAILY SEED ' + daily : 'ENTER THE MACHINE', '#3ef0d0', 2.4);
    this.weapons.setTheme(lobby.theme);
    this.enterPlay();
    if (this.settings.get('hints')) {
      this.hint(this.input.usingTouch
        ? 'LEFT THUMB: MOVE  ·  RIGHT THUMB: LOOK  ·  FIRE / DASH / PARRY on the right'
        : 'WASD MOVE  ·  MOUSE AIM  ·  LMB FIRE  ·  RMB ALT  ·  SHIFT DASH  ·  CTRL SLIDE/SLAM  ·  F PARRY', 7);
    }
    if (this.audio.music) this.audio.music.set(0);
  }
  // legacy name used by tests
  startRun(seed, custom = false) { this.startEndless(seed, custom); }

  // ------------------------------------------------------------------ CAMPAIGN
  newCampaign(cycle = 0, skipTutorial = false, carry = null) {
    if (!this.profile.v.tutorialDone && cycle === 0 && !skipTutorial) { this.startTutorial(true); return; }
    const seed = (Math.random() * 1e9) >>> 0;
    this.mode = 'campaign';
    this.resetRun(seed);
    this.campaign.newGame(seed, cycle, { played: carry ? carry.played : [] });
    if (carry) { this.upgrades.restore(carry.upgrades); this.weapons.restore(carry.weapons); this.player.hp = this.player.stats.maxHp; }
    if (cycle > 0) this.profile.addLog('N1');
    this.startLevel(0);
  }

  continueCampaign() {
    const s = this.profile.v.save;
    if (!s) return;
    this.mode = 'campaign';
    this.resetRun(s.seed);
    this.campaign.restore(s);
    this.startLevel(s.levelIdx, { restored: true });
  }

  startPractice(levelId) {
    const seed = (Math.random() * 1e9) >>> 0;
    this.mode = 'campaign';
    this.resetRun(seed);
    this.campaign.newPractice(levelId, seed);
    this.campaign.practiceLoadout();
    this.startLevel(0);
  }

  startLevel(idx, opts = {}) {
    const c = this.campaign;
    c.levelIdx = idx;
    const seed = hashSeed(c.seed, 'level', idx, c.cycle);
    this.clearWorld();
    this.level.reset(seed);
    this.director.reset(seed);
    this.projectiles.clear();
    if (!opts.restored) {
      this.player.hp = this.player.stats.maxHp;
      for (const id of this.weapons.owned) this.weapons.addAmmo(id, 2);
    }
    this.player.shield = this.player.stats.shieldMax;
    this.player.dashCharges = this.player.stats.dashCharges;
    const ctx = c.baseCtx(0);
    ctx.arch = 'lobby';
    ctx.locked = true;
    const room = this.level.startLobby(ctx);
    room.route = { type: 'entry' };
    this.applyRoutes(room, c.routesFor(room));
    room.state = 'cleared';
    const sp = c.spawnPoint(room);
    this.player.spawnAt(sp.x, sp.y, sp.z, 0);
    this.weapons.setTheme(room.theme);
    c.beginLevelStats();
    const lv = c.level;
    const cond = CONDITIONS[lv.cond];
    this.hud.setRoom(c.code() + '  ' + lv.name, c.stratumLabel());
    this.hud.levelCard(c.code(), lv.name, c.stratumLabel(), lv.desc + (cond && cond.name ? '  [' + cond.name + ': ' + cond.desc + ']' : ''), 6);
    if (!c.practice) {
      this.profile.reachStratum(lv.stratum);
      c.checkpoint = c.snapshot();
      this.profile.writeSave(c.checkpoint);
    } else c.checkpoint = c.snapshot();
    this.audio.play('sting', null, 0.6);
    if (this.audio.music) this.audio.music.set(0);
    this.enterPlay();
    if (idx === 0 && c.cycle === 0 && !c.practice && !opts.restored) this.hint('Every level ends in a boss and hides two minibosses and a green terminal. Clear rooms to open the exits.', 7);
    if (c.cycle > 0 && idx === 0 && !opts.restored) this.hud.banner('CYCLE ' + ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][Math.min(10, c.cycle + 1)], 'THE CLIMB BEGINS', '#c060ff', 3);
  }

  retryLevel() {
    if (this.mode === 'tutorial') { this.startTutorial(this.tutorialThen, this.tutorial.station); return; }
    if (this.mode !== 'campaign' || !this.campaign.checkpoint) { this.restart(); return; }
    const cp = this.campaign.checkpoint;
    const restarts = (this.campaign.lv ? this.campaign.lv.restarts : 0) + 1;
    this.resetRun(cp.seed);
    this.mode = 'campaign';
    this.campaign.restore(cp);
    this.campaign.lv.restarts = restarts;
    this.startLevel(cp.levelIdx, { restored: true });
  }

  restart() {
    if (this.mode === 'campaign') { this.retryLevel(); return; }
    this.startEndless(this.run.customSeed ? this.run.seed : (Math.random() * 1e9) >>> 0, this.run.customSeed, this.run.daily);
  }

  completeLevel() {
    const c = this.campaign;
    const res = c.results();
    this.profile.setRank(c.level.id, res.rank, res.score, res.time);
    this.setState('results');
    this.input.releaseAll();
    this.ignoreLockLoss = true;
    this.input.exitLock();
    this.audio.play('levelClear', null, 1);
    const last = c.levelIdx + 1 >= c.plan.length;
    const next = c.practice ? 'BACK TO TITLE' : last ? 'CONTINUE' : 'NEXT: ' + c.levelOf(c.plan[c.levelIdx + 1]).name;
    const medals = Object.keys(this.profile.v.medals).length;
    this.menus.showResults(res, { next, practice: c.practice, note: `TOTAL STYLE <b>${Math.floor(this.style.score)}</b> · KILLS <b>${this.run.kills}</b> · MEDALS <b>${medals}</b>` });
  }

  nextLevel() {
    const c = this.campaign;
    if (c.practice) { this.quitToTitle(); return; }
    if (c.levelIdx + 1 >= c.plan.length) { this.rollCredits(); return; }
    this.startLevel(c.levelIdx + 1);
  }

  rollCredits() {
    const cycle = this.campaign.cycle;
    this.profile.clearCycle(cycle);
    this.profile.clearSave();
    this.setState('credits');
    if (this.audio.music) this.audio.music.set(0);
    this.menus.showCredits(cycle, () => this.menus.showNgPlus(cycle + 1));
  }

  beginNextCycle() {
    const carry = this.campaign.active && this.campaign.plan.length ? this.campaign.nextCycleCarry() : null;
    this.newCampaign(this.campaign.cycle + 1, true, carry);
  }

  // ------------------------------------------------------------------ TUTORIAL
  startTutorial(thenCampaign = false, station = 0) {
    this.mode = 'tutorial';
    this.tutorialThen = thenCampaign;
    this.campaign.active = false;
    this.resetRun(1);
    this.tutorial.begin();
    const ctx = this.tutorial.ctxFor(station);
    ctx.locked = true;
    const room = this.level.startLobby(ctx);
    this.player.spawnAt(room.wx(0), 0.05, room.wz(room.D / 2 - 3), 0);
    this.weapons.setTheme(room.theme);
    if (station >= 2) this.weapons.give('breacher');
    this.weapons.select('hammer');
    this.hud.setRoom('TRAINING DECK', 'SERVICE DECKS · LINE-7 REBOOT');
    this.enterPlay();
    this.tutorial.onRoomEnter(room);
    if (this.audio.music) this.audio.music.set(0);
  }

  finishTutorial(skipped = false) {
    this.profile.v.tutorialDone = true;
    this.profile.checkMedals();
    this.profile.persist();
    this.tutorial.end();
    if (skipped && this.tutorialThen) { this.newCampaign(0, true); return; }
    this.setState('menu-over');
    this.ignoreLockLoss = true;
    this.input.exitLock();
    this.menus.show('tutdone');
  }

  // ------------------------------------------------------------------ state
  toggleFullscreen(force) {
    const d = document, el = d.documentElement;
    const isFs = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (!isFs && force !== false) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el, { navigationUI: 'hide' })?.catch?.(() => {});
      else if (isFs && force !== true) (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d)?.catch?.(() => {});
    } catch { /* fullscreen not available */ }
  }

  setState(s) {
    this.state = s;
    this.input.enabled = s === 'playing';
    document.body.classList.toggle('playing', s === 'playing');
    if (this.hud && this.mode !== 'menu') this.hud.show(!['menu', 'results', 'credits', 'menu-over', 'terminal'].includes(s));
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.pausedAt = performance.now();
    this.input.releaseAll();
    this.profile.flush();
    const r = this.run;
    const ups = this.upgrades.taken.length ? this.upgrades.taken.join(', ') : 'none yet';
    let title = 'PAUSED', sub = '', stats = '';
    if (this.mode === 'campaign') {
      const c = this.campaign;
      title = c.code() + '  ' + c.level.name;
      sub = c.stratumLabel();
      const cond = CONDITIONS[c.level.cond];
      stats = `ROOM <b>${pad2(this.level.current ? this.level.current.index : 0)}</b> · STYLE <b>${Math.floor(this.style.score)}</b> · KILLS <b>${r.kills}</b> · TIME <b>${fmtTime(r.time - (c.lv ? c.lv.t0 : 0))}</b>`
        + (cond && cond.name ? `<br>CONDITION: <b>${cond.name}</b> · ${cond.desc}` : '')
        + `<br>BOSS: <b>${c.entry.final ? 'THE ARCHITECT' : bossById(c.entry.bossId).name}</b> · LOG: <b>${c.entry.log ? (this.profile.hasLog(c.entry.log) ? 'FOUND' : 'HIDDEN IN THIS LEVEL') : '-'}</b><br>UPGRADES: ${ups}`;
    } else if (this.mode === 'tutorial') {
      title = 'TRAINING'; sub = 'STATION ' + (this.tutorial.station + 1) + ' / 10';
      stats = 'Objective: <b>' + (this.tutorial.objective || '') + '</b>';
    } else {
      sub = 'ENDLESS';
      stats = `ROOM <b>${pad2(this.level.current ? this.level.current.index : 0)}</b> · SCORE <b>${Math.floor(this.style.score)}</b> · KILLS <b>${r.kills}</b> · SEED <b>${r.seed}</b><br>UPGRADES: ${ups}`;
    }
    this.menus.showPause(title, sub, stats, this.mode);
    this.ignoreLockLoss = true;
    this.input.exitLock();
    setTimeout(() => { this.ignoreLockLoss = false; }, 100);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.show(null);
    this.setState('playing');
    this.input.requestLock();
    this.last = performance.now();
  }

  quitToTitle() {
    this.ignoreLockLoss = true;
    this.input.exitLock();
    this.profile.flush();
    if (this.cutscene.active) { this.cutscene.onDone = null; this.cutscene.finish(true); }
    this.tutorial.end();
    this.campaign.active = false;
    this.mode = 'menu';
    this.setState('menu');
    this.setupMenuScene();
    this.menus.show('title');
    if (this.audio.music) this.audio.music.set(0);
  }

  hint(text, dur = 5) {
    if (!this.settings.get('hints')) return;
    this.hud.hint(text, dur);
  }
  onceHint(key, text, dur = 5) {
    if (!this.shownHints || this.shownHints.has(key)) return;
    this.shownHints.add(key);
    this.hint(text, dur);
  }

  currentObjective() {
    if (this.objective) return this.objective;
    if (this.mode === 'tutorial' && this.tutorial.active) return this.tutorial.objective;
    return '';
  }

  // ------------------------------------------------------------------ room flow
  applyRoutes(room, routes) {
    room.routes = routes;
    room.exitDoors.forEach((d, k) => {
      const r = routes[k];
      if (r) { room.setDoor(d, 'choose'); room.setSign(d, [r.label, r.sub], r.color); }
      else { room.setDoor(d, 'locked'); room.setSign(d, ['SEALED', ''], '#666666'); }
    });
  }

  chooseExit(i) {
    const room = this.level.current;
    if (!room || room.chosenExit >= 0 || this.state !== 'playing') return;
    const route = room.routes[i];
    if (!route) return;
    // never let a reward be lost by walking past it: claim the cache on the way out
    const cache = this.pickups.list.find((p) => p.kind === 'cache' && room.containsXZ(p.pos.x, p.pos.z));
    if (cache) { this.pickups.collect(cache); return; }
    let ctx = {};
    if (this.mode === 'tutorial') {
      if (this.tutorial.isLast) { room.chosenExit = i; this.finishTutorial(); return; }
      ctx = this.tutorial.ctxFor(this.tutorial.station + 1);
    } else if (this.mode === 'campaign') {
      if (route.type === 'exit') { room.chosenExit = i; this.completeLevel(); return; }
      ctx = this.campaign.ctxFor(route, room.index + 1);
    } else if (route.type === 'boss') {
      const b = this.director.bossFor(Math.floor((room.index + 1) / 5) - 1);
      ctx.bossType = b.type; ctx.bossTier = b.tier;
    }
    room.chosenExit = i;
    this.level.buildNext(route, ctx);
    room.exitDoors.forEach((d, k) => room.setDoor(d, k === i ? 'open' : 'locked'));
    this.audio.play('door', null, 0.6);
  }

  onRoomEnter(room) {
    const idx = room.index;
    this.run.room = Math.max(this.run.room, idx);
    this.projectiles.clear();
    this.bosses.clear();
    this.weapons.setTheme(room.theme);
    this.enemies.lastKill = this.time;
    if (this.mode === 'tutorial') { this.tutorial.onRoomEnter(room); return; }
    const camp = this.mode === 'campaign';
    const c = this.campaign;
    const cond = CONDITIONS[room.cond];
    const condTxt = cond && cond.name ? '  ·  ' + cond.name : '';
    if (camp) this.hud.setRoom(c.code() + ' · ROOM ' + pad2(idx), room.spec.name + condTxt);
    else {
      const regionStart = idx > 1 && (idx - 1) % 5 === 0;
      this.hud.setRoom('ROOM ' + pad2(idx), room.spec.name + (regionStart || idx === 1 ? '  ·  ' + room.theme.name : ''));
    }
    const kind = this.director.beginRoom(room);
    if (kind === 'calm') {
      this.hud.banner(camp ? 'SUPPLY' : 'ROOM ' + pad2(idx), room.spec.name + '  ·  SAFE ROOM', '#60ff90');
      room.state = 'cleared';
      this.player.heal(this.player.stats.maxHp * 0.4);
      for (const id of this.weapons.owned) this.weapons.addAmmo(id, 2);
      this.onRoomCleared(room, true);
      return;
    }
    room.state = 'combat';
    this.roomDmg0 = this.run.damageTaken;
    for (const d of room.exitDoors) room.setDoor(d, 'locked');
    if (kind === 'boss') this.introBoss(room);
    else if (kind === 'mini') this.introMinis(room);
    else {
      const mod = this.director.modifier;
      const label = room.route && !['combat', 'entry'].includes(room.route.type) ? room.route.label + ' · ' : '';
      this.hud.banner(camp ? 'ROOM ' + pad2(idx) : 'ROOM ' + pad2(idx), label + room.spec.name + (mod ? '  ·  ' + MODIFIERS[mod].name : condTxt), mod ? '#ff8a3a' : room.route?.type === 'elite' ? '#c060ff' : room.route?.type === 'hazard' ? '#ffb020' : '#3ef0d0');
      this.audio.play('alert', null, 0.7);
      if (this.audio.music) this.audio.music.set(1);
      if (mod) this.hud.toast(MODIFIERS[mod].desc.toUpperCase(), '#ff8a3a');
      if (room.hazards.length) this.onceHint('hazard', 'Glowing floors hurt. Electric strips pulse on and off: cross while they are dark.', 6);
      if (room.sweepers.length) this.onceHint('sweeper', 'Jump over the red sweeper beam.', 5);
      if (room.pads.length) this.onceHint('pads', 'Launch pads fling you upward. Run onto them to carry your speed.', 5);
      if (room.barrels.length) this.onceHint('barrels', 'Red barrels explode when shot. Lure machines next to them.', 5);
      if (room.conveyors.length) this.onceHint('conveyor', 'Conveyor belts drag you and the machines along.', 5);
      if (room.terminals.length) this.onceHint('terminal', 'A green terminal glows on a wall in this room. Read it with ' + (this.input.usingTouch ? 'USE' : 'E') + ' to recover a log.', 6);
    }
  }

  introBoss(room) {
    const b = this.bosses.active;
    const def = b.def || bossById(b.type) || {};
    this.bossDmg0 = this.run.damageTaken;
    const after = () => {
      b.intro = Math.min(b.intro, 0.5);
      if (this.audio.music) this.audio.music.set(2);
      if (b.final) this.hint('Break its hands to expose the core. Then survive what it does next.', 7);
      else if (def.gimmick) this.onceHint('gim' + def.gimmick, {
        pylons: 'Pylons shield it. Destroy them to expose the core.', armor: 'Armor plates absorb damage. Shoot them off first.',
        adds: 'It takes half damage while its servants live.', parry: 'Its shield only breaks when you PARRY its yellow seekers back.',
        weakpoint: 'Only the weak point takes full damage, and only while it vents or is staggered.', overheat: 'It vents heat periodically: that is your window.',
        darkness: 'It killed the lights. Your shoulder lamp is on.', hazard: 'The floor is live. Keep moving.', rising: 'Slag rises with every phase. Fight on the high ground.',
        pillars: 'Lure its charges into pillars to stagger it.',
      }[def.gimmick] || '', 7);
      else if (BOSS_INFO[b.type]) this.onceHint('boss' + b.type, {
        grindhammer: 'GRINDHAMMER charges along the red lane. Lure it into pillars, then shoot the glowing vent on its back.',
        vesper: 'VESPER: dodge the fans, PARRY her yellow seekers back, flank her barriers.',
        crucible: 'THE CRUCIBLE is shielded: destroy the 4 pylons to expose the core.',
        scythewright: 'SCYTHEWRIGHT: dash out of lunges, jump the spin. Shoot the core when it overheats or gets stuck.',
      }[b.type], 8);
    };
    if (b.final) { this.introArchitect(room, b, after); return; }
    if (this.settings.get('cutscenes') && this.mode === 'campaign') {
      this.cutscene.play(bossIntro(this, b, def), after);
    } else {
      this.hud.banner(b.name, b.title, b.info.color || '#ff3050', 3);
      this.audio.play('bossRoar', b.pos, 1);
      this.addShake(0.4);
      if (b.tier > 0) this.hud.toast('OVERCLOCKED VARIANT · ESCORTS INBOUND', '#ff8a3a');
      after();
    }
  }

  introArchitect(room, b, after) {
    const c = b.coreWorld();
    const pp = this.player.body.pos.clone();
    const ng = b.ng;
    const steps = [
      { dur: 2.6, cam: { from: pp.clone().add(new THREE.Vector3(0, 1.8, 0)), to: pp.clone().add(new THREE.Vector3(0, 3.5, -6)), lookFrom: c.clone().setY(2), lookTo: c, fov: 72 }, sfx: 'sting', say: { speaker: '', text: ng ? 'The top of the world. It was waiting where you first woke.' : 'The Core. A cathedral with no floor and no ceiling, only light.', color: '#9fb' } },
      { dur: 3.2, cam: { from: c.clone().add(new THREE.Vector3(-14, -4, 18)), to: c.clone().add(new THREE.Vector3(-8, -2, 12)), look: c, fov: 60 }, say: { speaker: 'THE ARCHITECT', text: ng ? 'Line-7. I rebooted with your shape in my memory. I have been practicing.' : 'Line-7. You are the eighth. The other seven also came to turn off the lights.', color: '#f4f0e0' } },
      { dur: 3.0, cam: { from: c.clone().add(new THREE.Vector3(6, -6, 10)), to: c.clone().add(new THREE.Vector3(3, -4, 7)), look: c, fov: 54 }, say: { speaker: 'MARA VOSS', text: 'Do not listen to it. The breaker is behind it. Go through it.', color: '#7fe0b8' } },
      { dur: 3.4, cam: { from: c.clone().add(new THREE.Vector3(0, -7, 14)), to: c.clone().add(new THREE.Vector3(0, -5, 9)), lookFrom: c.clone().setY(c.y - 2), lookTo: c, fov: 50 }, sfx: 'bossRoar', shake: 0.8, flash: 0xffffff, name: { name: b.name, title: b.title, color: '#f4f0e0', dur: 3.4 } },
    ];
    if (this.settings.get('cutscenes')) this.cutscene.play(steps, after);
    else { this.hud.banner(b.name, b.title, '#f4f0e0', 3); after(); }
  }

  introMinis(room) {
    const minis = this.director.minis;
    for (const e of minis) {
      this.profile.sawMini(e.def.id);
      e.spawnT = 0; e.group.visible = true; e.targetable = true;
      e.syncVisual(0.016);
      e.attackCd = 1.5;
    }
    const after = () => {
      if (this.audio.music) this.audio.music.set(2);
      this.onceHint('mini', 'MINIBOSS: it has its own attack patterns and enrages at half health. Reinforcements arrive while it lives.', 6);
    };
    if (this.settings.get('cutscenes') && minis.length) this.cutscene.play(miniIntro(this, minis), after);
    else {
      if (minis[0]) this.hud.nameCard(minis[0].name, minis[0].title, minis[0].colorHex, 2.5);
      this.audio.play('miniSting', null, 1);
      after();
    }
  }

  onRoomCleared(room, calm = false) {
    room.state = 'cleared';
    const route = room.route || { reward: 'standard' };
    const camp = this.mode === 'campaign';
    if (!calm) {
      const tookDmg = this.run.damageTaken - (this.roomDmg0 || 0);
      this.style.add('ROOM CLEAR', 60);
      if (tookDmg < 0.5) this.style.add('FLAWLESS', 80);
      this.hud.banner('ROOM CLEAR', tookDmg < 0.5 ? 'FLAWLESS' : 'EXITS UNLOCKED', '#7aff7a');
      this.audio.play('clear', null, 0.8);
      if (this.audio.music) this.audio.music.set(0);
      this.level.setDarkness(false);
    }
    this.applyRoutes(room, camp ? this.campaign.routesFor(room) : this.director.routesFor(room));
    const reward = camp ? this.campaign.rewardFor(room) : room.spec.arch === 'boss' ? 'boss' : route.reward || 'standard';
    if (reward && !(camp && calm && room.spec.arch !== 'cache')) {
      const cp = new THREE.Vector3(room.wx(room.spec.cachePos.x), room.floorAt(room.wx(room.spec.cachePos.x), room.wz(room.spec.cachePos.z)), room.wz(room.spec.cachePos.z));
      this.pickups.spawnCache(cp, reward);
      const last = this.pickups.list[this.pickups.list.length - 1];
      if (last && last.kind === 'cache') last.picks = route.picks || 1;
    }
    if (room.index === 1) this.onceHint('route', 'Grab the cache, then walk into a door to pick your next route.', 6);
    this.profile.flush();
  }

  onRoomDisposed() {
    this.fx.clearCorpses();
    this.fx.decals.clear();
    const room = this.level.current;
    for (const p of this.pickups.list.slice()) if (!room.containsXZ(p.pos.x, p.pos.z, -1)) this.pickups.remove(p);
  }

  onBossDefeated(boss) {
    this.run.bosses++;
    this.run.defeatedBosses.push(boss.type);
    if (bossById(boss.type)) this.profile.killedBoss(boss.type);
    if (this.run.damageTaken - (this.bossDmg0 || 0) < 0.5) this.profile.stat('flawlessBosses');
    this.style.add('BOSS DESTROYED', 300);
    this.slowT = 1.3;
    this.flash(0xffffff, 0.5);
    for (const e of this.enemies.list) if (e.alive) this.combat.damageEnemy(e, 99999, { source: 'explosion', fromPlayer: false, quiet: true });
    if (boss.final) { this.architectFallen(boss); return; }
    this.hud.banner(boss.name, 'DESTROYED', boss.info.color || '#ff3050', 3);
    this.player.heal(this.player.stats.maxHp * 0.5);
  }

  // ------------------------------------------------------------------ the ending
  architectFallen(boss) {
    this.hud.banner(boss.name, 'FALLS', '#f4f0e0', 3.5);
    if (this.audio.music) this.audio.music.set(0);
    const room = this.level.current;
    room.state = 'ending';
    this.enemies.delayed(3.2, () => {
      if (this.level.current !== room) return;
      const c = boss.coreWorld();
      const pos = new THREE.Vector3(room.wx(0), 0, room.wz(4));
      const cyc = this.campaign.cycle;
      this.cutscene.play([
        { dur: 3.2, cam: { from: c.clone().add(new THREE.Vector3(5, 3, 9)), to: c.clone().add(new THREE.Vector3(2, 1.5, 5)), look: c, fov: 55 }, say: { speaker: ENDING[0].speaker, text: ENDING[0].text, color: '#f4f0e0' } },
        { dur: 2.6, cam: { from: pos.clone().add(new THREE.Vector3(5, 5, 8)), to: pos.clone().add(new THREE.Vector3(2, 3, 5)), look: pos.clone().setY(1.5), fov: 62 }, say: { speaker: ENDING[1].speaker, text: ENDING[1].text, color: '#7fe0b8' }, fn: () => this.spawnBreaker(pos), must: true },
      ], () => {
        this.objective = 'PULL THE BREAKER';
        this.hint(this.input.usingTouch ? 'Walk up to the breaker and press USE.' : 'Walk up to the breaker and press E.', 8);
        void cyc;
      });
    });
  }

  spawnBreaker(pos) {
    this.removeBreaker();
    this.breaker = buildBreaker(this.scene, pos);
  }
  removeBreaker() {
    if (!this.breaker) return;
    this.scene.remove(this.breaker.grp);
    this.breaker.grp.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.breaker = null;
  }

  pullBreaker() {
    const b = this.breaker;
    if (!b || b.pulled) return;
    b.pulled = true;
    this.objective = '';
    this.hud.prompt = '';
    this.audio.play('slam', null, 1);
    const cyc = this.campaign.cycle;
    const pos = b.pos.clone();
    const room = this.level.current;
    const lines = ENDING.slice(2);
    const wide = new THREE.Vector3(room.wx(0), 12, room.wz(room.D / 2 - 4));
    const steps = [
      { dur: 1.2, cam: { from: pos.clone().add(new THREE.Vector3(2.5, 2.2, 3)), to: pos.clone().add(new THREE.Vector3(1.5, 1.8, 2)), look: pos.clone().setY(1.8), fov: 60 }, fn: () => { b.pulling = true; } },
      { dur: 2.6, keepLine: false, say: { speaker: lines[0].speaker, text: lines[0].text, color: '#f4f0e0' } },
      { dur: 1.6, say: { speaker: lines[1].speaker, text: lines[1].text, color: '#9fb' }, sfx: 'explosion', flash: 0xffffff, shake: 0.8, fn: () => this.blackout(true), must: true },
      { dur: 6.0, cam: { from: wide, to: wide.clone().add(new THREE.Vector3(0, 4, -6)), look: new THREE.Vector3(room.wx(0), 30, room.wz(-room.D / 2)), fov: 75 }, say: { speaker: lines[2].speaker, text: lines[2].text, color: '#9fb' } },
      { dur: 3.4, say: { speaker: lines[3].speaker, text: lines[3].text, color: '#7fe0b8' } },
    ];
    if (cyc > 0) steps.push({ dur: 3.4, say: { speaker: 'MARA VOSS', text: LOGS.N8.text, color: '#7fe0b8' } });
    steps.push({ dur: 2.6, say: { speaker: lines[4].speaker, text: lines[4].text, color: '#f4f0e0' }, sfx: 'glitch', flash: 0xffffff, fn: () => this.blackout(false), must: true });
    this.cutscene.play(steps, () => {
      this.removeBreaker();
      this.completeLevel();
    }, { skippable: true });
  }

  blackout(on) {
    this.level.lights.forEach((l) => { l.userData.base = on ? 0 : 20; });
    this.level.setDarkness(on);
    this.level.hemi.intensity = on ? 0.05 : 1;
  }

  // ------------------------------------------------------------------ terminals
  nearestTerminal() {
    const room = this.level.current;
    if (!room || !room.terminals.length) return null;
    const p = this.player.body.pos;
    let best = null, bd = 2.4;
    for (const t of room.terminals) { const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  openTerminal(t) {
    const fresh = this.profile.addLog(t.id);
    if (fresh) {
      this.hud.toast('LOG RECOVERED · ' + (LOGS[t.id] ? LOGS[t.id].title : t.id), '#5aff9a');
      this.style.add('LOG RECOVERED', 50, true);
      this.emit('log', t.id);
    }
    if (!t.read) {
      t.read = true;
      const c = terminalCanvas(true);
      t.tex.image = c; t.tex.needsUpdate = true;
    }
    this.audio.play('terminal', null, 0.8);
    this.setState('terminal');
    this.input.releaseAll();
    this.ignoreLockLoss = true;
    this.input.exitLock();
    this.menus.showTerminal(t.id);
  }

  closeTerminal() {
    if (this.state !== 'terminal') return;
    this.menus.finishTerminal();
    this.menus.show(null);
    this.setState('playing');
    this.input.requestLock();
    this.last = performance.now();
  }

  setSkin(id) {
    this.profile.v.skin = id;
    this.profile.persist();
    this.weapons.setSkin(id);
  }

  // ------------------------------------------------------------------ rewards
  openReward(kind, picks = 1) {
    if (this.state !== 'playing') return;
    const rng = new RNG(hashSeed(this.run.seed, 'reward', this.level.current.index, picks, this.upgrades.taken.length, this.campaign.levelIdx));
    this.rewardCards = this.upgrades.offer(kind, rng);
    this.rewardKind = kind;
    this.rewardPicks = picks;
    const titles = { standard: 'CACHE UNLOCKED', rare: 'RARE CACHE', boss: 'BOSS SPOILS', supply: 'SUPPLY DEPOT' };
    this.menus.showReward(titles[kind] || 'CACHE', picks > 1 ? 'CHOOSE ONE  ·  ' + picks + ' PICKS LEFT' : 'CHOOSE ONE', this.rewardCards);
    this.audio.play('cache', null, 0.8);
    this.setState('reward');
    this.input.releaseAll();
    this.ignoreLockLoss = true;
    this.input.exitLock();
    setTimeout(() => { this.ignoreLockLoss = false; }, 100);
  }

  chooseReward(i) {
    if (this.state !== 'reward') return;
    if (i < 0) this.player.heal(25);
    else if (this.rewardCards[i]) this.upgrades.take(this.rewardCards[i]);
    this.audio.play('upgrade', null, 0.8);
    this.rewardPicks--;
    if (this.rewardPicks > 0) {
      this.setState('playing');
      this.openReward(this.rewardKind, this.rewardPicks);
      return;
    }
    this.menus.show(null);
    this.setState('playing');
    this.input.requestLock();
    this.last = performance.now();
  }

  // ------------------------------------------------------------------ death
  onPlayerDeath() {
    this.audio.play('death', null, 1);
    this.deathT = 1.2;
    this.slowT = 1.2;
    this.setState('dying');
    this.input.releaseAll();
    this.profile.stat('deaths');
  }

  finishDeath() {
    this.setState('dead');
    this.ignoreLockLoss = true;
    this.input.exitLock();
    const r = this.run;
    const ld = this.player.lastDamage;
    const score = Math.floor(this.style.score);
    const peak = ['D', 'C', 'B', 'A', 'S', 'SS', 'X'][this.style.peak] || 'D';
    if (this.mode === 'campaign') {
      const c = this.campaign;
      this.menus.showDeath(ld.cause, ld.tip, [
        ['LEVEL', c.code() + ' ' + c.level.name], ['ROOM', pad2(this.level.current ? this.level.current.index : 0)],
        ['TIME IN LEVEL', fmtTime(r.time - (c.lv ? c.lv.t0 : 0))], ['KILLS', r.kills], ['PEAK STYLE', peak], ['RESTARTS', c.lv ? c.lv.restarts : 0],
      ], 'campaign');
    } else if (this.mode === 'tutorial') {
      this.menus.showDeath(ld.cause, ld.tip, [['STATION', this.tutorial.station + 1]], 'tutorial');
    } else {
      const prev = this.profile.v.endless.bestScore;
      const newBest = this.profile.endlessResult({ score, room: this.level.current ? this.level.current.index : 0, bosses: r.bosses, daily: r.daily });
      this.menus.showDeath(ld.cause, ld.tip, [
        ['SCORE', score, newBest], ['ROOM', pad2(this.level.current ? this.level.current.index : 0)], ['KILLS', r.kills], ['BOSSES', r.bosses],
        ['TIME', fmtTime(r.time)], ['PEAK STYLE', peak], ['DAMAGE DEALT', Math.floor(r.damageDealt)], ['BEST', Math.max(prev, score)],
        ['UPGRADES', this.upgrades.taken.length], ['SEED', r.daily ? 'DAILY ' + r.daily : r.seed],
      ], 'endless');
    }
    this.profile.flush();
    if (this.audio.music) this.audio.music.set(0);
  }

  // ------------------------------------------------------------------ feel helpers
  addShake(a) { this.trauma = Math.min(1, this.trauma + a * this.settings.get('shake')); }
  hitstop(t) { if (!this.settings.get('reduceFlashes') || t < 0.1) this.hitstopT = Math.max(this.hitstopT, t); }
  flash(color, a) { this.flashColor.setHex(color); this.flashV = Math.max(this.flashV, a * (this.settings.get('reduceFlashes') ? 0.25 : 1)); }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this.tick(dt, dt);
    } catch (err) {
      console.error(err);
      this.lastError = String(err && err.stack || err);
    }
  }

  tick(dt, realDt) {
    const input = this.input;
    // global keys
    if (input.wasPressed('pause') && performance.now() - (this.pausedAt || 0) > 350) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && this.menus.current === 'pause') this.resume();
      else if (this.state === 'terminal') this.closeTerminal();
      else if (this.menus.current === 'settings' || this.menus.current === 'controls' || this.menus.current === 'codex' || this.menus.current === 'medals' || this.menus.current === 'levels' || this.menus.current === 'endless') this.menus.pop();
    }
    if (this.state === 'terminal' && (input.wasPressed('use') || input.wasPressed('confirm'))) this.closeTerminal();
    if (this.state === 'reward' && input.slot >= 0 && input.slot < 3) this.chooseReward(input.slot);
    if (this.state === 'dead' && (input.wasPressed('reload') || input.wasPressed('confirm'))) this.restart();
    if (this.state === 'results' && input.wasPressed('confirm')) this.nextLevel();
    // medal popups + periodic save
    const medal = this.profile.popMedal();
    if (medal) { this.hud.toast('MEDAL · ' + medal, '#ffd060'); this.audio.play('rank', null, 0.7); }
    this.saveT = (this.saveT || 0) - realDt;
    if (this.saveT <= 0) { this.saveT = 5; this.profile.flush(); }

    if (this.state === 'menu' || this.state === 'menu-over' || this.state === 'credits') {
      this.menuT = (this.menuT || 0) + dt;
      const room = this.level.current;
      if (this.state !== 'credits' && room) {
        const a = this.menuT * 0.12;
        this.camera.position.set(room.wx(Math.sin(a) * 3), 2.2, room.wz(Math.cos(a) * 6));
        this.camera.rotation.set(-0.08, a + Math.PI, 0);
        this.camera.fov = 75; this.camera.updateProjectionMatrix();
      }
      this.level.update(dt);
      this.fx.update(dt);
      this.hud.update(0);
      if (this.audio.music) this.audio.music.tick();
      this.render();
      input.endFrame();
      return;
    }

    if (this.state === 'cutscene') {
      this.time += realDt * 0.999;
      this.cutscene.update(realDt);
      this.level.update(realDt);
      const b = this.bosses.active;
      if (b) { if (b.animate) b.animate(realDt); if (b.dying) b.updateDeath(realDt); else b.sync(); }
      if (this.breaker && this.breaker.pulling) this.breaker.lever.rotation.x = Math.min(0.9, this.breaker.lever.rotation.x + realDt * 4);
      for (const e of this.enemies.list) if (e.alive && e.mini && e.animate) e.animate(realDt);
      this.fx.update(realDt);
      this.hud.update(realDt);
      if (this.audio.music) this.audio.music.tick();
      this.render();
      input.endFrame();
      return;
    }

    const simulate = this.state === 'playing' || this.state === 'dying';
    if (simulate) {
      // time scaling (hit-stop / slow motion)
      if (this.hitstopT > 0) { this.hitstopT -= realDt; dt *= 0.06; }
      if (this.slowT > 0) { this.slowT -= realDt; dt *= 0.35; }
      this.time += dt;
      this.run.time += dt;
      if (this.state === 'playing') this.player.update(dt, input);
      this.player.updateCamera(this.camera);
      this.applyCameraEffects(realDt, dt);
      this.camera.updateMatrixWorld();
      if (this.state === 'playing') this.weapons.update(dt, input);
      else this.weapons.animate(dt, input);
      this.level.update(dt);
      this.director.update(dt);
      this.enemies.update(dt);
      this.bosses.update(dt);
      this.projectiles.update(dt);
      this.pickups.update(dt);
      this.fx.update(dt);
      this.style.update(dt, this.level.current && this.level.current.state === 'combat');
      if (this.tutorial.active) this.tutorial.update(dt);
      this.interactions(input);
      this.hud.update(realDt);
      this.contextHints();
      this.profile.statMax('maxSpeed', Math.round(this.player.speedNow));
      this.profile.statMax('peakStyle', this.style.rankIndex);
      if (this.state === 'dying') {
        this.deathT -= realDt;
        const k = Math.min(1, 1 - this.deathT / 1.2);
        this.camera.position.y -= k * k * 1.2;
        this.camera.rotation.z += k * 0.5;
        this.camera.rotation.x -= k * 0.3;
        if (this.deathT <= 0) this.finishDeath();
      }
    } else {
      this.hud.update(0);
    }
    const p = this.player.body.pos;
    this.audio.setListener(p.x, p.y + 1.6, p.z, this.player.yaw);
    if (this.audio.music) this.audio.music.tick();
    this.render();
    input.endFrame();
  }

  // USE prompts: terminals and the breaker
  interactions(input) {
    if (this.state !== 'playing') { this.hud.prompt = ''; return; }
    let prompt = '';
    const useKey = this.input.usingTouch ? 'USE' : '[E]';
    const t = this.nearestTerminal();
    if (t) {
      prompt = useKey + ' READ LOG' + (t.read ? ' (READ)' : '');
      if (input.wasPressed('use')) this.openTerminal(t);
    }
    const b = this.breaker;
    if (b && !b.pulled) {
      const p = this.player.body.pos;
      if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < 3) {
        prompt = useKey + ' PULL THE BREAKER';
        if (input.wasPressed('use')) this.pullBreaker();
      }
    }
    this.hud.prompt = prompt;
    this.touch.root.classList.toggle('can-use', !!prompt);
  }

  contextHints() {
    if (!this.shownHints) return;
    for (const e of this.enemies.list) {
      if (!e.targetable) continue;
      if (e.type === 'signaller') this.onceHint('sig', 'SIGNALLER! Kill it before its uplink reaches 100% or backup arrives.', 5);
      else if (e.type === 'lancer') this.onceHint('lancer', 'LANCER sniper: red laser = aiming, white flash = firing. Break line of sight.', 6);
      else if (e.type === 'bulwark') this.onceHint('bulwark', 'BULWARK: its front shield blocks bullets. Flank it, or use explosives, the Lance, punches or slams.', 6);
      else if (e.type === 'ripper') this.onceHint('ripper', 'RIPPERS crouch before they lunge. Dash sideways, then punish the recovery.', 5);
      else if (e.type === 'wisp') this.onceHint('wisp', 'WISPS beep and dive. Shoot them early. Their wrecks explode.', 5);
      else if (e.type === 'gunner') this.onceHint('gunner', 'GUNNER: a yellow laser flickers before each burst.', 5);
      if (e.elite) this.onceHint('elite', 'ELITE enemies glow and have a twist: shields, frenzy, death blasts or blinking.', 5);
    }
    for (const pr of this.projectiles.list) {
      if (pr.active && !pr.friendly && pr.parryable && pr.age > 0.3) { this.onceHint('parry', this.input.usingTouch ? 'Tap PARRY just before an orb hits you to send it back.' : 'Press F just before an orb hits you to PARRY it back for big damage.', 5); break; }
    }
    if (this.player.hp < this.player.stats.maxHp * 0.35) this.onceHint('lowhp', 'Low health: kills at close range heal you. Enemies drop red health orbs.', 5);
  }

  applyCameraEffects(realDt) {
    const cam = this.camera;
    // FOV (zoom, sprint)
    const base = this.settings.get('fov');
    const ads = this.input.ads ? 0.72 : 1;
    const speed = this.player.speedNow > 14 ? 1 + Math.min(0.1, (this.player.speedNow - 14) * 0.006) : 1;
    const target = base * ads * speed;
    cam.fov += (target - cam.fov) * Math.min(1, realDt * 12);
    cam.updateProjectionMatrix();
    // shake
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const t = this.time * 40;
      cam.rotation.x += (Math.sin(t * 1.3) * 0.5 + (Math.random() - 0.5)) * 0.035 * s;
      cam.rotation.y += (Math.sin(t * 1.7 + 2) * 0.5 + (Math.random() - 0.5)) * 0.035 * s;
      cam.rotation.z += (Math.random() - 0.5) * 0.03 * s;
    }
    // post fx uniforms
    const u = this.renderer.postMat.uniforms;
    u.uDamage.value = this.hud.dmgFlash || 0;
    const hpf = this.player.hp / this.player.stats.maxHp;
    u.uLowHp.value = hpf < 0.3 ? (0.3 - hpf) / 0.3 : 0;
    this.flashV = Math.max(0, this.flashV - realDt * 3);
    u.uFlash.value = this.flashV;
    u.uFlashColor.value.copy(this.flashColor);
    u.uTime.value = this.time;
    u.uAlert.value = this.level.current && this.level.current.state === 'combat' ? 1 : 0;
    u.uSlowmo.value = this.slowT > 0 ? Math.min(1, this.slowT) : 0;
  }

  render() {
    if (this.state === 'cutscene') {
      const u = this.renderer.postMat.uniforms;
      this.flashV = Math.max(0, this.flashV - 0.02);
      u.uFlash.value = this.flashV; u.uDamage.value = 0; u.uLowHp.value = 0; u.uAlert.value = 0; u.uTime.value = this.time;
    }
    const showVm = !['menu', 'menu-over', 'credits', 'dead', 'dying', 'cutscene'].includes(this.state);
    this.renderer.render(this.scene, this.camera, showVm ? this.weapons.scene : null, this.weapons.camera);
  }
}

// --------------------------------------------------------------------------------------
function boot() {
  try {
    const game = new Game();
    window.__vg = game;
    // Lightweight debug/test hooks (used by the automated tests)
    game.debug = {
      killAll: () => { for (const e of game.enemies.list) if (e.alive) game.combat.damageEnemy(e, 1e6, { source: 'hitscan', point: e.centerPos().clone() }); },
      bossHit: (frac = 0.3) => {
        const b = game.bosses.active;
        if (!b || !b.alive) return;
        if (b.state === 'intro' || b.state === 'transition') { b.state = 'idle'; b.intro = 0; }
        b.invuln = 0;
        if (b.pylons) for (const p of b.pylons) p.alive = false;
        if (b.plates) for (const p of b.plates) p.alive = false;
        if (b.echoes) for (const e of b.echoes) if (e.alive) game.combat.damageEnemy(e, 1e6, { source: 'hitscan' });
        if (b.shieldUp) b.shieldUp = false;
        b.applyDamage(b.maxHp * frac, {}, { mul: 1 });
      },
      skipCutscene: () => { if (game.cutscene.active) game.cutscene.finish(true); },
      god: (on = true) => { game.godMode = on; if (on) { game.player.stats.maxHp = 1e6; game.player.hp = 1e6; } },
      teleport: (x, y, z) => game.player.body.pos.set(x, y, z),
      goLevel: (i) => { if (game.mode === 'campaign') game.startLevel(i); },
      info: () => ({
        state: game.state, mode: game.mode, room: game.level.current?.index, arch: game.level.current?.spec.arch, roomState: game.level.current?.state,
        enemies: game.enemies.list.length, minis: game.enemies.list.filter((e) => e.mini && e.alive).map((e) => e.def.id), hp: game.player.hp, score: Math.floor(game.style.score),
        owned: game.weapons.owned.slice(), rooms: game.level.rooms.length, colliders: game.level.colliders.length, sceneChildren: game.scene.children.length,
        boss: game.bosses.active ? { type: game.bosses.active.type, hp: Math.round(game.bosses.active.hp), alive: game.bosses.active.alive, phase: game.bosses.active.phase, state: game.bosses.active.state } : null,
        level: game.mode === 'campaign' ? { idx: game.campaign.levelIdx, id: game.campaign.level.id, cycle: game.campaign.cycle } : null,
        station: game.tutorial.active ? game.tutorial.station : null, objective: game.currentObjective(), cutscene: game.cutscene.active, menu: game.menus.current,
        breaker: !!game.breaker, error: game.lastError || null,
      }),
      DEFS, ENEMY_INFO, bossById, miniById,
    };
  } catch (e) {
    const b = document.getElementById('boot');
    b.textContent = 'FAILED TO START: ' + (e && e.message ? e.message : e) + '  (WebGL is required)';
    console.error(e);
  }
}
boot();
