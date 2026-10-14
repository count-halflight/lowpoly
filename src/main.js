import * as THREE from 'three';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './style.css';
import { Settings, Records, isTouchDevice } from './core/settings.js';
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
import { Bosses, BOSS_INFO } from './game/bosses.js';
import { Director, MODIFIERS } from './game/director.js';
import { Upgrades } from './game/upgrades.js';
import { Style } from './game/style.js';
import { Pickups } from './game/pickups.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';

const pad2 = (n) => String(n).padStart(2, '0');

class Game {
  constructor() {
    this.settings = new Settings();
    this.records = new Records();
    this.lowPower = isTouchDevice || (navigator.hardwareConcurrency || 8) <= 4;
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas, this.settings);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov'), 1, 0.05, 140);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.audio = new Audio(this.settings);
    this.input = new Input(this.settings, this.canvas);
    this.touch = new TouchControls(this.input, document.getElementById('touch'), this.settings);
    this.input.touch = this.touch;
    if (isTouchDevice) { document.body.classList.add('touch'); this.input.usingTouch = true; }

    this.time = 0;
    this.state = 'menu';
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
    this.hud = new HUD(this, document.getElementById('hud'));
    this.menus = new Menus(this, document.getElementById('menus'));

    this.input.onLockLost = () => {
      if (this.ignoreLockLoss) { this.ignoreLockLoss = false; return; }
      if (this.state === 'playing' && !this.input.usingTouch) this.pause();
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
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
      if (e.pointerType === 'touch' && !this.input.usingTouch) { this.input.usingTouch = true; document.body.classList.add('touch'); }
      else if (e.pointerType === 'mouse' && this.input.usingTouch && !isTouchDevice) { this.input.usingTouch = false; document.body.classList.remove('touch'); }
    });

    this.resize();
    this.setupMenuScene();
    this.menus.show('title');
    this.last = performance.now();
    document.getElementById('boot').classList.add('gone');
    requestAnimationFrame((t) => this.frame(t));
  }

  newRun(seed, custom = false) {
    return { seed, customSeed: custom, room: 0, kills: 0, bosses: 0, damageTaken: 0, damageDealt: 0, shots: 0, backupCalled: 0, start: performance.now(), time: 0 };
  }

  resize() {
    this.renderer.resize();
    const a = this.renderer.width / this.renderer.height;
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    this.weapons.resize(a);
  }

  // ------------------------------------------------------------------ menu background
  setupMenuScene() {
    this.clearWorld();
    this.level.reset(7);
    this.level.startLobby();
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
  }

  // ------------------------------------------------------------------ run lifecycle
  startRun(seed, custom = false) {
    this.audio.init();
    if (this.input.usingTouch) this.toggleFullscreen(true);
    const customSeed = custom || !!document.querySelector('#m-seed')?.value.trim();
    this.run = this.newRun(seed, customSeed);
    this.clearWorld();
    this.level.reset(seed);
    this.director.reset(seed);
    this.player.reset();
    this.weapons.reset();
    this.upgrades.reset();
    this.style.reset();
    this.hud.reset();
    this.shownHints = new Set();
    const lobby = this.level.startLobby();
    this.player.spawnAt(lobby.wx(0), 0.05, lobby.wz(lobby.D / 2 - 3), 0);
    this.hud.setRoom('LOBBY', 'SEED ' + seed);
    this.hud.banner('VOLTGRAVE', 'ENTER THE MACHINE', '#3ef0d0', 2.4);
    this.weapons.setTheme(lobby.theme);
    this.setState('playing');
    this.menus.show(null);
    this.hud.show(true);
    if (this.settings.get('hints')) {
      this.hint(this.input.usingTouch
        ? 'LEFT THUMB: MOVE  ·  RIGHT THUMB: LOOK  ·  FIRE / DASH / PARRY on the right'
        : 'WASD MOVE  ·  MOUSE AIM  ·  LMB FIRE  ·  SHIFT DASH  ·  CTRL SLIDE/SLAM  ·  F PARRY', 7);
    }
    if (this.audio.music) this.audio.music.set(0);
    this.input.requestLock();
  }

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
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.pausedAt = performance.now();
    this.input.releaseAll();
    const r = this.run;
    this.menus.pauseStats(`ROOM <b>${pad2(this.level.current ? this.level.current.index : 0)}</b> · SCORE <b>${Math.floor(this.style.score)}</b> · KILLS <b>${r.kills}</b> · SEED <b>${r.seed}</b><br>UPGRADES: ${this.upgrades.taken.length ? this.upgrades.taken.join(', ') : 'none yet'}`);
    this.menus.show('pause');
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
    this.setState('menu');
    this.setupMenuScene();
    this.menus.updateRecords();
    this.menus.show('title');
    if (this.audio.music) this.audio.music.set(0);
  }

  hint(text, dur = 5) {
    if (!this.settings.get('hints')) return;
    this.hud.hint(text);
    this.hintT = dur;
  }
  onceHint(key, text, dur = 5) {
    if (!this.shownHints || this.shownHints.has(key)) return;
    this.shownHints.add(key);
    this.hint(text, dur);
  }

  // ------------------------------------------------------------------ room flow
  chooseExit(i) {
    const room = this.level.current;
    if (!room || room.chosenExit >= 0 || this.state !== 'playing') return;
    const route = room.routes[i];
    if (!route) return;
    // never let a reward be lost by walking past it: claim the cache on the way out
    const cache = this.pickups.list.find((p) => p.kind === 'cache' && room.containsXZ(p.pos.x, p.pos.z));
    if (cache) { this.pickups.collect(cache); return; }
    room.chosenExit = i;
    const ctx = {};
    if (route.type === 'boss') {
      const b = this.director.bossFor(Math.floor((room.index + 1) / 5) - 1);
      ctx.bossType = b.type; ctx.bossTier = b.tier;
    }
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
    const regionStart = idx > 1 && (idx - 1) % 5 === 0;
    this.hud.setRoom('ROOM ' + pad2(idx), room.spec.name + (regionStart || idx === 1 ? '  ·  ' + room.theme.name : ''));
    const kind = this.director.beginRoom(room);
    if (kind === 'calm') {
      this.hud.banner('ROOM ' + pad2(idx), room.spec.name + '  ·  SAFE ROOM', '#60ff90');
      room.state = 'cleared';
      this.player.heal(this.player.stats.maxHp * 0.4);
      for (const id of this.weapons.owned) this.weapons.addAmmo(id, 2);
      this.onRoomCleared(room, true);
      return;
    }
    room.state = 'combat';
    for (const d of room.exitDoors) room.setDoor(d, 'locked');
    if (kind === 'boss') {
      const b = this.bosses.active;
      this.hud.banner(b.name, b.title, BOSS_INFO[b.type].color, 3);
      this.audio.play('bossRoar', b.pos, 1);
      this.addShake(0.4);
      if (this.audio.music) this.audio.music.set(2);
      if (b.tier > 0) this.hud.toast('OVERCLOCKED VARIANT · ESCORTS INBOUND', '#ff8a3a');
      this.onceHint('boss' + b.type, {
        grindhammer: 'GRINDHAMMER charges along the red lane. Lure it into pillars, then shoot the glowing vent on its back.',
        vesper: 'VESPER: dodge the fans, PARRY her yellow seekers back, flank her barriers.',
        crucible: 'THE CRUCIBLE is shielded: destroy the 4 pylons to expose the core.',
        scythewright: 'SCYTHEWRIGHT: dash out of lunges, jump the spin. Shoot the core when it overheats or gets stuck.',
      }[b.type], 8);
    } else {
      const mod = this.director.modifier;
      const banner = room.route && room.route.type !== 'combat' ? room.route.label + ' · ' : '';
      this.hud.banner('ROOM ' + pad2(idx), banner + room.spec.name + (mod ? '  ·  ' + MODIFIERS[mod].name : ''), mod ? '#ff8a3a' : room.route?.type === 'elite' ? '#c060ff' : room.route?.type === 'hazard' ? '#ffb020' : '#3ef0d0');
      this.audio.play('alert', null, 0.7);
      if (this.audio.music) this.audio.music.set(1);
      if (mod) this.hud.toast(MODIFIERS[mod].desc.toUpperCase(), '#ff8a3a');
      if (room.spec.hazards.length) this.onceHint('hazard', 'Glowing floors hurt. Electric strips pulse on and off: cross while they are dark.', 6);
      if (room.spec.sweepers.length) this.onceHint('sweeper', 'Jump over the red sweeper beam.', 5);
    }
  }

  onRoomCleared(room, calm = false) {
    room.state = 'cleared';
    const route = room.route || { reward: 'standard' };
    if (!calm) {
      const tookDmg = this.run.damageTaken - this.director.roomDamage;
      this.style.add('ROOM CLEAR', 60);
      if (this.director.signallers > 0 && this.run.backupCalledRoom === undefined) { /* per-signaller bonuses already given */ }
      if (tookDmg < 0.5) this.style.add('FLAWLESS', 80);
      this.hud.banner('ROOM CLEAR', tookDmg < 0.5 ? 'FLAWLESS' : 'EXITS UNLOCKED', '#7aff7a');
      this.audio.play('clear', null, 0.8);
      if (this.audio.music) this.audio.music.set(0);
    }
    room.routes = this.director.routesFor(room);
    room.exitDoors.forEach((d, k) => {
      const r = room.routes[k];
      if (r) { room.setDoor(d, 'choose'); room.setSign(d, [r.label, r.sub], r.color); }
      else { room.setDoor(d, 'locked'); room.setSign(d, ['SEALED', ''], '#666666'); }
    });
    const reward = room.spec.arch === 'boss' ? 'boss' : route.reward || 'standard';
    const cp = new THREE.Vector3(room.wx(room.spec.cachePos.x), 0, room.wz(room.spec.cachePos.z));
    const cache = this.pickups.spawnCache(cp, reward);
    void cache;
    const last = this.pickups.list[this.pickups.list.length - 1];
    if (last && last.kind === 'cache') last.picks = route.picks || 1;
    if (room.index === 1) this.onceHint('route', 'Grab the cache, then walk into a door to pick your next route.', 6);
  }

  onRoomDisposed() {
    this.fx.clearCorpses();
    this.fx.decals.clear();
    const room = this.level.current;
    for (const p of this.pickups.list.slice()) if (!room.containsXZ(p.pos.x, p.pos.z, -1)) this.pickups.remove(p);
  }

  onBossDefeated(boss) {
    this.run.bosses++;
    this.style.add('BOSS DESTROYED', 300);
    this.hud.banner(boss.name, 'DESTROYED', BOSS_INFO[boss.type].color, 3);
    this.slowT = 1.3;
    this.player.heal(this.player.stats.maxHp * 0.5);
    this.flash(0xffffff, 0.5);
    // remaining escorts collapse with their master
    for (const e of this.enemies.list) if (e.alive) this.combat.damageEnemy(e, 99999, { source: 'explosion', fromPlayer: false, quiet: true });
  }

  // ------------------------------------------------------------------ rewards
  openReward(kind, picks = 1) {
    if (this.state !== 'playing') return;
    const rng = new RNG(hashSeed(this.run.seed, 'reward', this.level.current.index, picks, this.upgrades.taken.length));
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
  }

  finishDeath() {
    this.setState('dead');
    this.ignoreLockLoss = true;
    this.input.exitLock();
    const r = this.run;
    const score = Math.floor(this.style.score);
    const prevBest = this.records.v.bestScore;
    const newBest = this.records.submit({ score, room: this.level.current ? this.level.current.index : 0, bosses: r.bosses });
    const secs = Math.floor(r.time);
    const ld = this.player.lastDamage;
    const stats = [
      ['SCORE', score, newBest], ['ROOM', pad2(this.level.current ? this.level.current.index : 0)], ['KILLS', r.kills], ['BOSSES', r.bosses],
      ['TIME', Math.floor(secs / 60) + ':' + pad2(secs % 60)], ['PEAK STYLE', ['D', 'C', 'B', 'A', 'S', 'SS', 'X'][this.style.peak]],
      ['DAMAGE DEALT', Math.floor(r.damageDealt)], ['BEST', Math.max(prevBest, score)],
    ].map(([k, v, best]) => `<div class="${best ? 'best' : ''}"><b>${v}</b>${k}${best ? ' · NEW BEST' : ''}</div>`).join('');
    this.menus.showDeath(ld.cause, ld.tip, stats + `<div><b>${this.upgrades.taken.length}</b>UPGRADES</div><div><b>${r.seed}</b>SEED</div>`);
    this.menus.updateRecords();
    if (this.audio.music) this.audio.music.set(0);
  }

  // ------------------------------------------------------------------ feel helpers
  addShake(a) { this.trauma = Math.min(1, this.trauma + a * this.settings.get('shake')); }
  hitstop(t) { if (!this.settings.get('reduceFlashes') || t < 0.1) this.hitstopT = Math.max(this.hitstopT, t); }
  flash(color, a) { this.flashColor.setHex(color); this.flashV = Math.max(this.flashV, a * (this.settings.get('reduceFlashes') ? 0.25 : 1)); }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const realDt = dt;
    try {
      this.tick(dt, realDt);
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
      else if (this.menus.current === 'settings' || this.menus.current === 'controls') this.menus.pop();
    }
    if (this.state === 'reward' && input.slot >= 0 && input.slot < 3) this.chooseReward(input.slot);
    if (this.state === 'dead' && (input.wasPressed('reload') || input.wasPressed('confirm'))) this.startRun(this.run.customSeed ? this.run.seed : (Math.random() * 1e9) >>> 0, this.run.customSeed);

    if (this.state === 'menu') {
      this.menuT += dt;
      const room = this.level.current;
      const a = this.menuT * 0.12;
      this.camera.position.set(room.wx(Math.sin(a) * 3), 2.2, room.wz(Math.cos(a) * 6));
      this.camera.rotation.set(-0.08, a + Math.PI, 0);
      this.camera.fov = 75; this.camera.updateProjectionMatrix();
      this.level.update(dt);
      this.fx.update(dt);
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
      if (this.state === 'playing') {
        this.player.update(dt, input);
      }
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
      this.hud.update(realDt);
      if (this.hintT > 0) { this.hintT -= realDt; if (this.hintT <= 0) this.hud.hint(''); }
      // contextual first-time hints
      this.contextHints();
      if (this.state === 'dying') {
        this.deathT -= realDt;
        this.camera.position.y -= (1 - Math.max(0, this.deathT)) * 0.02;
        this.camera.rotation.z += realDt * 0.4;
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
    // FOV (ADS zoom, sprint)
    const base = this.settings.get('fov');
    const ads = this.input.ads && this.weapons.current !== 'breacher' ? 0.72 : 1;
    const speed = this.player.speedNow > 12 ? 1.06 : 1;
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
    const showVm = this.state !== 'menu' && this.state !== 'dead' && this.state !== 'dying';
    this.renderer.render(this.scene, this.camera, showVm ? this.weapons.scene : null, this.weapons.camera);
  }
}

// --------------------------------------------------------------------------------------
function boot() {
  try {
    const game = new Game();
    window.__vg = game;
    // Lightweight debug/test hooks (used by the automated smoke test)
    game.debug = {
      killAll: () => { for (const e of game.enemies.list) if (e.alive) game.combat.damageEnemy(e, 1e6, { source: 'hitscan', point: e.centerPos().clone() }); },
      bossHit: (frac = 0.3) => { const b = game.bosses.active; if (b && b.alive) { b.state = b.state === 'intro' ? 'idle' : b.state; b.intro = 0; b.invuln = 0; if (b.pylons) for (const p of b.pylons) { p.alive = false; } const amt = b.maxHp * frac; b.applyDamage(amt, {}, { mul: 1 }); } },
      god: (on = true) => { game.godMode = on; if (on) { game.player.stats.maxHp = 1e6; game.player.hp = 1e6; } },
      teleport: (x, y, z) => game.player.body.pos.set(x, y, z),
      info: () => ({ state: game.state, room: game.level.current?.index, arch: game.level.current?.spec.arch, roomState: game.level.current?.state, enemies: game.enemies.list.length, hp: game.player.hp, score: Math.floor(game.style.score), owned: game.weapons.owned.slice(), rooms: game.level.rooms.length, colliders: game.level.colliders.length, sceneChildren: game.scene.children.length, boss: game.bosses.active ? { type: game.bosses.active.type, hp: Math.round(game.bosses.active.hp), alive: game.bosses.active.alive, tier: game.bosses.active.tier } : null, error: game.lastError || null }),
      DEFS, ENEMY_INFO,
    };
  } catch (e) {
    const b = document.getElementById('boot');
    b.textContent = 'FAILED TO START: ' + (e && e.message ? e.message : e) + '  (WebGL is required)';
    console.error(e);
  }
}
boot();
