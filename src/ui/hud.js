import * as THREE from 'three';
import { RANKS } from '../game/style.js';
import { DEFS, WEAPON_ORDER } from '../game/weapons.js';
import { font, scramble, drawIcon } from './pixel.js';

// The HUD is drawn into a low-resolution canvas (virtual height 300-360 units) that the
// browser scales up with nearest-neighbour filtering, so every glyph is genuinely
// pixelated like the PS1-style reference footage.

const CYAN = '#8ff4e4', MINT = '#7fe0b8', RED = '#ff3150', WHITE = '#f2f2ee', DIM = 'rgba(8,8,14,0.72)';

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hudc';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.noise = document.createElement('canvas');
    this.noise.width = 80; this.noise.height = 28;
    this.nctx = this.noise.getContext('2d');
    this.toasts = [];
    this.banners = null;
    this.nameCardS = null;
    this.levelCardS = null;
    this.hintText = ''; this.hintT = 0;
    this.prompt = '';
    this.hitT = 0; this.hitKind = '';
    this.dmgDirs = [];
    this.dmgFlash = 0;
    this.healT = 0;
    this.glitchT = 0;
    this.room = { main: 'LOBBY', sub: '' };
    this.t = 0;
    this.visible = false;
    this.weaponBoxes = [];
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(this.probe);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const touch = this.game.input && this.game.input.usingTouch;
    const cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
    const V = touch ? 290 : Math.max(300, Math.min(400, Math.round(cssH / 2.6)));
    this.V = V; this.W = Math.round(V * cssW / cssH);
    this.k = V / cssH; // virtual units per css px
    this.canvas.width = this.W; this.canvas.height = this.V;
    const cs = getComputedStyle(this.probe);
    this.safe = {
      t: parseFloat(cs.paddingTop) * this.k, r: parseFloat(cs.paddingRight) * this.k,
      b: parseFloat(cs.paddingBottom) * this.k, l: parseFloat(cs.paddingLeft) * this.k,
    };
    this.touch = touch;
  }

  show(on) { this.visible = on; this.root.classList.toggle('on', on); }

  // ---------------------------------------------------------------- public API
  setRoom(main, sub) { this.room = { main, sub }; }
  banner(main, sub, color = MINT, dur = 2.4) { this.banners = { main, sub: sub || '', color, t: 0, dur }; }
  nameCard(name, title, color, dur = 3) { this.nameCardS = { name, title, color, t: 0, dur }; }
  levelCard(code, name, stratum, desc, dur = 5) { this.levelCardS = { code, name, stratum, desc, t: 0, dur }; }
  toast(text, color = WHITE, small = false) {
    this.toasts.unshift({ text, color, small, t: 0, dur: small ? 1.5 : 2.6 });
    if (this.toasts.length > 4) this.toasts.pop();
  }
  hint(text, dur = 6) { this.hintText = text || ''; this.hintT = text ? dur : 0; }
  hitMarker(kind) { this.hitKind = kind; this.hitT = kind === 'kill' || kind === 'headkill' ? 0.28 : 0.13; }
  damage(amount, from) {
    const g = this.game;
    this.dmgFlash = Math.min(1, this.dmgFlash + 0.25 + amount / 50);
    this.glitchT = Math.min(0.35, 0.1 + amount / 120);
    if (from) {
      const p = g.player.body.pos;
      const ang = Math.atan2(from.x - p.x, from.z - p.z);
      this.dmgDirs.push({ a: -(ang - (g.player.yaw + Math.PI)), t: 1 });
      if (this.dmgDirs.length > 6) this.dmgDirs.shift();
    }
  }
  healPulse() { this.healT = 0.5; }
  reset() { this.toasts = []; this.dmgDirs = []; this.banners = null; this.nameCardS = null; this.levelCardS = null; this.dmgFlash = 0; this.hintText = ''; }

  // touch: which weapon chip is at this css point?
  weaponAt(cx, cy) {
    const x = cx * this.k, y = cy * this.k;
    for (const b of this.weaponBoxes) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    return null;
  }

  // ---------------------------------------------------------------- drawing helpers
  text(str, x, y, size, color = WHITE, align = 'left', opts = {}) {
    const c = this.ctx;
    c.font = font(size, opts.kind || 'serif', opts.weight || 700);
    c.textAlign = align;
    c.textBaseline = opts.base || 'alphabetic';
    x = Math.round(x); y = Math.round(y);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    if (opts.shadow !== false) { c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillText(str, x + 1, y + 1); }
    if (opts.ca) {
      c.fillStyle = 'rgba(255,40,80,0.8)'; c.fillText(str, x - opts.ca, y);
      c.fillStyle = 'rgba(60,240,230,0.8)'; c.fillText(str, x + opts.ca, y);
    }
    c.fillStyle = color;
    c.fillText(str, x, y);
    c.globalAlpha = 1;
    return c.measureText(str).width;
  }
  // draw text shrunk (then truncated) to fit a width
  fitText(str, x, y, size, maxW, color, opts) {
    const c = this.ctx;
    let sz = size;
    c.font = font(sz, opts.kind || 'serif', opts.weight || 700);
    while (sz > 7 && c.measureText(str).width > maxW) { sz--; c.font = font(sz, opts.kind || 'serif', opts.weight || 700); }
    let t = str;
    while (t.length > 3 && c.measureText(t).width > maxW) t = t.slice(0, -2);
    if (t !== str) t = t.slice(0, -1) + '.';
    return this.text(t, x, y, sz, color, 'left', opts);
  }
  rect(x, y, w, h, color) { this.ctx.fillStyle = color; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  frame(x, y, w, h, color) {
    const c = this.ctx;
    c.strokeStyle = color; c.lineWidth = 1;
    c.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
  stripes(x, y, w, h, color, gap = 6, thick = 3) {
    const c = this.ctx;
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = color;
    for (let i = -h; i < w + h; i += gap) {
      c.beginPath();
      c.moveTo(x + i, y + h); c.lineTo(x + i + thick, y + h); c.lineTo(x + i + thick + h, y); c.lineTo(x + i + h, y);
      c.closePath(); c.fill();
    }
    c.restore();
  }
  segBar(x, y, w, h, frac, color, segs = 10, gap = 1, bg = 'rgba(255,255,255,0.14)') {
    const sw = (w - gap * (segs - 1)) / segs;
    for (let i = 0; i < segs; i++) {
      const f = Math.max(0, Math.min(1, frac * segs - i));
      this.rect(x + i * (sw + gap), y, sw, h, bg);
      if (f > 0) this.rect(x + i * (sw + gap), y, sw * f, h, color);
    }
  }
  staticNoise() {
    const n = this.nctx;
    const img = n.createImageData(80, 28);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? Math.random() * 120 : 20;
      img.data[i] = v * 1.1; img.data[i + 1] = v * 0.5; img.data[i + 2] = v * 0.6; img.data[i + 3] = 200;
    }
    n.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- main update/draw
  update(dt) {
    this.t += dt;
    const g = this.game;
    if (this.banners) { this.banners.t += dt; if (this.banners.t > this.banners.dur) this.banners = null; }
    if (this.nameCardS) { this.nameCardS.t += dt; if (this.nameCardS.t > this.nameCardS.dur) this.nameCardS = null; }
    if (this.levelCardS) { this.levelCardS.t += dt; if (this.levelCardS.t > this.levelCardS.dur) this.levelCardS = null; }
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < t.dur);
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintText = ''; }
    this.hitT -= dt;
    for (const d of this.dmgDirs) d.t -= dt;
    this.dmgDirs = this.dmgDirs.filter((d) => d.t > 0);
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 2.2);
    this.healT -= dt;
    this.glitchT -= dt;
    if (g.settings.get('showFps')) {
      this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    }
    this.draw();
  }

  draw() {
    const c = this.ctx, g = this.game;
    c.clearRect(0, 0, this.W, this.V);
    if (!this.visible) return;
    c.imageSmoothingEnabled = false;
    const cut = g.cutscene && g.cutscene.active;
    if (!cut) {
      this.drawTopRight();
      this.drawAlert();
      this.drawBossBars();
      this.drawStyle();
      this.drawUplink();
      this.drawCrosshair();
      this.drawHealth();
      this.drawAmmo();
      this.drawDamageDirs();
      this.drawStragglers();
      this.drawPrompt();
      this.drawHint();
    }
    if (!cut) {
      this.drawBanner();
      this.drawToasts();
      if (!(g.bosses.active && g.bosses.active.alive)) this.drawLevelCard();
    }
    if (cut) this.drawCutscene();
    this.drawNameCard();
    if (this.healT > 0) { c.globalAlpha = this.healT; c.strokeStyle = 'rgba(90,255,150,0.6)'; c.lineWidth = 6; c.strokeRect(3, 3, this.W - 6, this.V - 6); c.globalAlpha = 1; }
    if (this.glitchT > 0 && !g.settings.get('reduceFlashes')) this.glitchSlices();
    if (g.settings.get('showFps') && this.fps) this.text(this.fps + ' FPS', this.W - 4 - this.safe.r, this.V - 4 - this.safe.b, 9, '#9f9', 'right', { kind: 'mono', weight: 400 });
  }

  glitchSlices() {
    const c = this.ctx;
    for (let i = 0; i < 3; i++) {
      const y = Math.floor(Math.random() * this.V), h = 2 + Math.floor(Math.random() * 8);
      const dx = Math.round((Math.random() - 0.5) * 14);
      c.drawImage(this.canvas, 0, y, this.W, h, dx, y, this.W, h);
    }
  }

  drawTopRight() {
    const g = this.game;
    const s = this.safe;
    const w = 196, h = 34, x = this.W - w - 6 - s.r, y = 6 + s.t;
    const c = this.ctx;
    // panel with a slanted left edge
    c.fillStyle = DIM;
    c.beginPath(); c.moveTo(x + 10, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 10.5, y); c.lineTo(x + 0.5, y + h); c.stroke();
    const combat = g.level.current && g.level.current.state === 'combat';
    const score = String(Math.floor(g.style.score)).padStart(6, '0');
    const sw = this.text(score, x + w - 6, y + 18, 18, CYAN, 'right', { ca: 0.5 });
    this.fitText(this.room.main, x + 14, y + 17, 17, w - 30 - sw, WHITE, { ca: 0.6 });
    this.fitText(this.room.sub, x + 14, y + 28, 8, w - 120, '#d8d8d8', {});
    // status bars + label
    const bx = x + w - 96;
    for (let i = 0; i < 5; i++) this.rect(bx + i * 10, y + 24, 8, 2, i < (g.style.rankIndex + 1) ? (combat ? RED : '#bbbbbb') : 'rgba(255,255,255,0.2)');
    const mult = g.style.rank.mult * g.style.routeMult;
    this.text(combat ? 'ALERT' : 'CLEAR', x + w - 6, y + 31, 7, combat ? RED : '#e0e0e0', 'right');
    this.text('x' + mult.toFixed(2), bx - 4, y + 31, 7, '#aaa', 'right', { shadow: false });
    if (combat) this.rect(x + 12, y + h - 1, w - 12, 1, RED);
    // objective
    const room = g.level.current;
    let obj = '';
    if (room) {
      if (room.state === 'combat' && !g.bosses.active) obj = 'HOSTILES ' + g.director.remaining();
      else if (room.state === 'cleared') obj = room.chosenExit < 0 && room.exitDoors.length > 1 ? 'CHOOSE A ROUTE ^' : 'PROCEED ^';
      const o = g.currentObjective ? g.currentObjective() : '';
      if (o) obj = o;
    }
    if (obj) this.text(obj, this.W / 2, 16 + s.t, 9, WHITE, 'center', { kind: 'mono', weight: 400 });
  }

  drawAlert() {
    const g = this.game;
    const combat = g.level.current && g.level.current.state === 'combat';
    if (!combat) return;
    const blink = Math.floor(this.t * 2) % 2 === 0;
    const w = 86, h = 13, x = this.W / 2 - 150, y = 6 + this.safe.t;
    if (x < 70) return;
    this.stripes(x, y, w, h, blink ? RED : '#c01838', 7, 3);
    this.rect(x + 18, y, w - 36, h, 'rgba(20,0,6,0.85)');
    this.text('ALERT', x + w / 2, y + 11, 11, WHITE, 'center', { ca: 0.5 });
  }

  drawBossBars() {
    const g = this.game;
    const bars = [];
    const boss = g.bosses.active;
    if (boss && boss.alive && boss.state !== 'introHidden') {
      bars.push({ name: boss.name, sub: boss.phase >= 2 ? (boss.phaseName || 'PHASE ' + ['', 'I', 'II', 'III', 'IV'][boss.phase]) : boss.title, frac: boss.hp / boss.maxHp, color: boss.info?.color || '#ff8a3a', shielded: boss.shielded, big: true, segs: boss.hpSegments });
    }
    for (const e of g.enemies.list) if (e.alive && e.mini && e.targetable) bars.push({ name: e.name, sub: 'MINIBOSS' + (e.phase >= 2 ? ' · ENRAGED' : ''), frac: e.hp / e.maxHp, color: e.colorHex || '#ff5a3a', shield: e.shieldMax ? e.shield / e.shieldMax : 0 });
    let y = 46 + this.safe.t;
    for (const b of bars.slice(0, 3)) {
      const w = b.big ? Math.min(330, this.W * 0.5) : Math.min(220, this.W * 0.36);
      const x = this.W / 2 - w / 2;
      this.text(b.name, this.W / 2, y + (b.big ? 11 : 8), b.big ? 14 : 10, WHITE, 'center', { ca: b.big ? 0.6 : 0 });
      const by = y + (b.big ? 14 : 11);
      const h = b.big ? 6 : 4;
      this.rect(x - 1, by - 1, w + 2, h + 2, '#000');
      this.frame(x - 2, by - 2, w + 4, h + 4, 'rgba(255,255,255,0.8)');
      if (b.shielded) this.stripes(x, by, w * b.frac, h, '#6aff5a', 4, 2);
      else { this.rect(x, by, w * b.frac, h, b.color); this.rect(x, by, w * b.frac, 1, 'rgba(255,255,255,0.5)'); }
      if (b.shield) this.rect(x, by + h - 1, w * b.shield, 1, '#40c8ff');
      if (b.big) this.rect(x + w / 2, by - 2, 1, h + 4, '#fff');
      if (b.segs) for (const sgm of b.segs) this.rect(x + w * sgm, by - 2, 1, h + 4, '#fff');
      this.text(b.sub, this.W / 2, by + h + 8, 7, '#d0d0d0', 'center');
      y += b.big ? 34 : 26;
    }
  }

  drawStyle() {
    const g = this.game, st = g.style, r = st.rank;
    const x = 8 + this.safe.l, y = Math.round(this.V * (this.touch ? 0.36 : 0.42));
    const dim = st.rankIndex === 0 && st.meter < 1 && !st.feed.length;
    this.ctx.globalAlpha = dim ? 0.35 : 1;
    const w = 96, h = 30;
    this.rect(x, y, w, h, DIM);
    this.frame(x, y, w, h, 'rgba(230,240,255,0.7)');
    this.rect(x, y, 2, h, r.c);
    this.text(r.l, x + 15, y + 25, r.l.length > 1 ? 18 : 26, r.c, 'center', { ca: 0.6 });
    this.text(r.w, x + 30, y + 11, 8, r.c, 'left');
    this.text('SCORE ' + Math.floor(st.score), x + 30, y + 20, 7, '#e8e8e8', 'left');
    this.segBar(x + 30, y + 23, 60, 2, Math.max(0, Math.min(1, st.meter / 100)), r.c, 8, 1);
    this.ctx.globalAlpha = 1;
    let fy = y + h + 9;
    for (const f of st.feed) {
      const age = g.time - f.t;
      const a = Math.max(0, Math.min(1, 4 - age));
      const slide = Math.max(0, 0.15 - age) * 60;
      this.text('+' + f.pts, x + 2 - slide, fy, 8, r.c, 'left', { alpha: a });
      this.text(f.name + (f.count > 1 ? ' x' + f.count : ''), x + 26 - slide, fy, 8, WHITE, 'left', { alpha: a });
      fy += 9;
    }
  }

  drawUplink() {
    const sig = this.game.enemies.uplink();
    if (!sig) return;
    const w = 92, h = 34, x = this.W - w - 6 - this.safe.r, y = 46 + this.safe.t + (this.game.bosses.active ? 40 : 0);
    this.staticNoise();
    this.ctx.drawImage(this.noise, x, y, w, h);
    this.frame(x, y, w, h, 'rgba(255,60,90,0.8)');
    const pct = Math.floor(sig.progress * 100);
    const blink = Math.floor(this.t * 3) % 2;
    this.text('CE 07 LIVE', x + w - 3, y + 7, 6, '#ffb0b8', 'right', { kind: 'mono', weight: 400 });
    this.text(blink ? 'CALLING BACKUP' : 'CALLING BACKU' + String.fromCharCode(65 + Math.floor(Math.random() * 26)), x + 3, y + 18, 11, WHITE, 'left', { ca: 0.7 });
    for (let i = 0; i < 22; i++) {
      const bh = 1 + Math.random() * 5 * (i / 22 < sig.progress ? 1 : 0.3);
      this.rect(x + 3 + i * 4, y + 26 - bh / 2, 2, bh, i / 22 < sig.progress ? RED : 'rgba(255,80,100,0.35)');
    }
    this.text('UPLINK ' + pct + '%', x + w - 3, y + h - 2, 6, '#ffb0b8', 'right', { kind: 'mono', weight: 400 });
  }

  // Railcannon scope: lens cut-out, reticle, charge ring, range readout and the quick-scope window.
  drawScope() {
    const g = this.game, w = g.weapons, c = this.ctx;
    const k = w.scopeK;
    const cx = Math.round(this.W / 2), cy = Math.round(this.V / 2);
    const r = Math.round(this.V * (0.36 + 0.08 * k));
    c.save();
    c.globalAlpha = k;
    c.fillStyle = '#050608';
    c.beginPath(); c.rect(0, 0, this.W, this.V); c.arc(cx, cy, r, 0, Math.PI * 2, true); c.fill('evenodd');
    c.strokeStyle = '#1c2a30'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(64,224,255,0.55)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r - 2, 0, Math.PI * 2); c.stroke();
    // reticle: thin cross with a gap, thicker posts at the edge, mil dots
    const ret = 'rgba(10,14,16,0.9)';
    this.rect(cx - r, cy, r - 6, 1, ret); this.rect(cx + 6, cy, r - 6, 1, ret);
    this.rect(cx, cy + 6, 1, r - 6, ret); this.rect(cx, cy - r, 1, r - 6, ret);
    this.rect(cx - r, cy - 1, r * 0.35, 3, ret); this.rect(cx + r * 0.65, cy - 1, r * 0.35, 3, ret);
    this.rect(cx - 1, cy + r * 0.65, 3, r * 0.35, ret);
    for (let i = 1; i <= 4; i++) { const dd = i * r * 0.12; this.rect(cx + dd, cy - 1, 1, 3, ret); this.rect(cx - dd, cy - 1, 1, 3, ret); this.rect(cx - 1, cy + dd, 3, 1, ret); }
    this.rect(cx, cy, 1, 1, '#ff3150');
    // charge ring around the lens
    if (w.charging) {
      c.strokeStyle = w.charge >= 1 ? '#ffffff' : '#40e0ff'; c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * w.charge); c.stroke();
    }
    // quick-scope window: a shrinking tick ring while the bonus is live
    if (w.quickScopeLive()) {
      const left = 1 - (g.time - w.adsStart) / 0.6;
      c.strokeStyle = '#ffe23a'; c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, 12 + 18 * left, 0, Math.PI * 2); c.stroke();
      this.text('QUICKSCOPE', cx, cy + r - 14, 10, '#ffe23a', 'center', { kind: 'mono', weight: 400 });
    }
    // range to whatever the reticle sits on
    this.rangeT = (this.rangeT || 0) - 1;
    if (this.rangeT <= 0) {
      this.rangeT = 6;
      const cam = g.camera, dir = cam.getWorldDirection(this.tmpDir || (this.tmpDir = new THREE.Vector3()));
      const hit = g.combat.raycast(cam.position, dir, 160, {});
      this.range = hit ? hit.t : 0;
      this.rangeFoe = !!(hit && (hit.kind === 'enemy' || hit.kind === 'boss'));
    }
    this.text(this.range ? this.range.toFixed(1) + ' M' : '--.- M', cx + r * 0.5, cy - 8, 10, this.rangeFoe ? '#ff5a6a' : '#8ff4e4', 'left', { kind: 'mono', weight: 400 });
    c.restore();
  }

  drawCrosshair() {
    const g = this.game, w = g.weapons, p = g.player;
    if (w.scopeK > 0.02) { this.drawScope(); if (w.scopeK > 0.5) return; }
    const cx = Math.round(this.W / 2), cy = Math.round(this.V / 2);
    const d = DEFS[w.current];
    const spread = (d.spread || 0.01) + w.bloom + (d.moveSpread || 0) * Math.min(1, p.speedNow / 8);
    const gap = Math.round(Math.min(16, 2 + spread * 160 * (1 - 0.6 * (w.adsK || 0))));
    const col = 'rgba(255,255,255,0.95)';
    this.rect(cx - gap - 4, cy, 4, 1, col); this.rect(cx + gap + 1, cy, 4, 1, col);
    this.rect(cx, cy - gap - 4, 1, 4, col); this.rect(cx, cy + gap + 1, 1, 4, col);
    this.rect(cx, cy, 1, 1, CYAN);
    // dash charges under the crosshair (like the reference's little bars)
    const n = p.stats.dashCharges;
    for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, p.dashCharges - i));
      const bx = cx - (n * 9) / 2 + i * 9;
      this.rect(bx, cy + 14, 7, 2, 'rgba(255,255,255,0.15)');
      this.rect(bx, cy + 14, 7 * f, 2, f >= 1 ? CYAN : '#4a8a88');
    }
    // hook cooldown pip
    if (p.hookCd !== undefined && p.hookCd > 0) this.rect(cx - 4, cy + 18, 8 * (1 - p.hookCd / p.hookCdMax), 1, '#ffd060');
    // aimed revolver: the quick-scope window shows as a shrinking yellow ring
    if (w.current === 'hammer' && w.quickScopeLive && w.quickScopeLive()) {
      const c = this.ctx, left = 1 - (g.time - w.adsStart) / 0.6;
      c.strokeStyle = 'rgba(255,226,58,0.9)'; c.lineWidth = 1;
      c.beginPath(); c.arc(cx + 0.5, cy + 0.5, 6 + 10 * left, 0, Math.PI * 2); c.stroke();
    }
    // lance charge arc
    if (w.charging) {
      const c = this.ctx;
      c.strokeStyle = '#40e0ff'; c.lineWidth = 2;
      c.beginPath(); c.arc(cx + 0.5, cy + 0.5, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * w.charge); c.stroke();
    }
    if (this.hitT > 0) {
      const k = this.hitKind;
      const col2 = k === 'kill' || k === 'headkill' ? RED : k === 'head' ? '#ffe23a' : k === 'shield' || k === 'armor' ? '#40c8ff' : WHITE;
      const s = k === 'kill' || k === 'headkill' ? 6 : 4;
      const c = this.ctx;
      c.strokeStyle = col2; c.lineWidth = k.includes('kill') ? 2 : 1;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(cx + sx * 3, cy + sy * 3); c.lineTo(cx + sx * (3 + s), cy + sy * (3 + s)); }
      c.stroke();
    }
  }

  drawHealth() {
    const g = this.game, p = g.player;
    const s = this.safe;
    const x = 8 + s.l;
    const y = this.touch ? 40 + s.t : this.V - 10 - s.b;
    const low = p.hp < p.stats.maxHp * 0.3;
    const blink = low && Math.floor(this.t * 4) % 2 === 0;
    if (p.stats.shieldMax) this.segBar(x + 14, y - 34, 74, 2, p.shield / p.stats.shieldMax, '#40c8ff', 6, 1);
    this.text('/', x, y, 30, CYAN, 'left', { weight: 400 });
    const hpStr = String(Math.ceil(Math.max(0, p.hp)));
    const tw = this.text(hpStr, x + 12, y, 30, blink ? RED : WHITE, 'left', { ca: 0.7 });
    this.segBar(x + 16 + tw, y - 12, 60, 4, p.hp / p.stats.maxHp, low ? RED : WHITE, 14, 1);
    this.text(low ? 'CRITICAL' : 'INTEGRITY', x + 16 + tw, y - 2, 7, low ? RED : '#bbb', 'left');
  }

  drawAmmo() {
    const g = this.game, w = g.weapons;
    const s = this.safe;
    const id = w.current, a = w.ammo[id], d = DEFS[id];
    const right = this.W - 8 - s.r;
    const y = this.touch ? 74 + s.t : this.V - 10 - s.b;
    // weapon icons row
    this.weaponBoxes = [];
    const owned = WEAPON_ORDER.filter((x) => w.owned.includes(x));
    const iw = 34, ih = 14;
    let ix = right - owned.length * (iw + 3) + 3;
    const iy = y - 44;
    for (const wid of owned) {
      const cur = wid === id;
      this.rect(ix, iy, iw, ih, cur ? 'rgba(143,244,228,0.25)' : DIM);
      this.frame(ix, iy, iw, ih, cur ? DEFS[wid].color : 'rgba(255,255,255,0.3)');
      drawIcon(this.ctx, wid, ix + 1, iy + 1, 1, cur ? [WHITE, '#777', DEFS[wid].color] : ['#9a9a9a', '#555', '#666']);
      this.text(String(WEAPON_ORDER.indexOf(wid) + 1), ix + 2, iy + ih - 2, 6, cur ? WHITE : '#888', 'left', { kind: 'mono', weight: 400, shadow: false });
      this.weaponBoxes.push({ id: wid, x: ix, y: iy, w: iw, h: ih });
      ix += iw + 3;
    }
    // ammo number
    const empty = a.mag === 0;
    this.text('/', right, y, 30, d.color, 'right', { weight: 400 });
    const nw = this.text(String(a.mag), right - 12, y, 30, empty ? RED : WHITE, 'right', { ca: 0.7 });
    const lx = right - 16 - nw;
    this.text(d.name, lx, y - 14, 9, d.color, 'right');
    this.text(isFinite(a.reserve) ? 'RES ' + Math.floor(a.reserve) : 'RES INF', lx, y - 4, 7, '#ccc', 'right');
    if (w.reloading) this.segBar(lx - 60, y - 24, 60, 2, 1 - w.reloadT / w.reloadTotal, d.color, 10, 1);
    if (w.altInfo) this.text(w.altInfo(), lx, y - 27, 7, '#ffd060', 'right', { kind: 'mono', weight: 400 });
  }

  // When only one or two enemies remain and nothing has died for a while, point at them so a
  // room never looks finished while its door is still sealed.
  drawStragglers() {
    const g = this.game, room = g.level.current;
    if (!room || room.state !== 'combat' || (g.bosses.active && g.bosses.active.alive)) return;
    if (g.time - (g.enemies.lastKill || 0) < 5) return;
    let n = 0;
    for (const e of g.enemies.list) if (e.alive) n++;
    if (!n || n > 2) return;
    const v = this.tmpV || (this.tmpV = new THREE.Vector3());
    const cx = this.W / 2, cy = this.V / 2, pp = g.player.body.pos;
    const blink = Math.floor(this.t * 3) % 2 === 0;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      v.copy(e.centerPos()).project(g.camera);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * this.W, y = (-v.y * 0.5 + 0.5) * this.V;
      if (behind) { x = this.W - x; y = this.V - y; }
      const dist = Math.round(Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z));
      const m = 22;
      const onScreen = !behind && x > m && x < this.W - m && y > m && y < this.V - m;
      const c = this.ctx;
      if (onScreen) {
        // corner brackets around the target
        c.strokeStyle = blink ? RED : '#ffd060'; c.lineWidth = 1;
        const r = 7;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(x + sx * r, y + sy * (r - 3)); c.lineTo(x + sx * r, y + sy * r); c.lineTo(x + sx * (r - 3), y + sy * r); }
        c.stroke();
        this.text(dist + 'M', x, y - r - 3, 7, '#ffd060', 'center', { kind: 'mono', weight: 400 });
      } else {
        // clamp to the screen edge along the direction from the centre
        let dx = x - cx, dy = y - cy;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const k = Math.min((this.W / 2 - m) / Math.max(0.001, Math.abs(dx)), (this.V / 2 - m) / Math.max(0.001, Math.abs(dy)));
        const ax = cx + dx * k, ay = cy + dy * k;
        c.save(); c.translate(ax, ay); c.rotate(Math.atan2(dy, dx));
        c.fillStyle = blink ? RED : '#ffd060';
        c.beginPath(); c.moveTo(8, 0); c.lineTo(-4, -6); c.lineTo(-4, 6); c.closePath(); c.fill();
        c.restore();
        this.text(dist + 'M', ax - dx * 14, ay - dy * 14 + 3, 7, '#ffd060', 'center', { kind: 'mono', weight: 400 });
      }
    }
    this.text(n === 1 ? 'LAST HOSTILE' : n + ' HOSTILES LEFT', this.W / 2, 28 + this.safe.t, 8, blink ? RED : '#ffd060', 'center', { kind: 'mono', weight: 400 });
  }

  drawDamageDirs() {
    const c = this.ctx;
    const cx = this.W / 2, cy = this.V / 2;
    for (const d of this.dmgDirs) {
      c.save();
      c.translate(cx, cy); c.rotate(d.a);
      c.globalAlpha = Math.min(1, d.t);
      c.fillStyle = RED;
      c.beginPath(); c.moveTo(-10, -34); c.lineTo(10, -34); c.lineTo(0, -42); c.closePath(); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  }

  drawPrompt() {
    if (!this.prompt) return;
    const y = this.V / 2 + 34;
    const w = this.ctx.measureText(this.prompt).width;
    this.text(this.prompt, this.W / 2, y, 10, '#ffe23a', 'center', { kind: 'mono', weight: 400 });
    void w;
  }

  drawHint() {
    if (!this.hintText) return;
    const c = this.ctx;
    c.font = font(10, 'mono', 400);
    const maxW = Math.min(this.W * 0.6, 340);
    const lines = wrap(c, this.hintText, maxW);
    const h = lines.length * 10 + 8;
    const y = this.touch ? this.V * 0.24 : this.V - 74 - this.safe.b;
    const w = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width))) + 14;
    const a = Math.min(1, this.hintT * 2);
    c.globalAlpha = a;
    this.rect(this.W / 2 - w / 2, y, w, h, 'rgba(4,10,12,0.8)');
    this.frame(this.W / 2 - w / 2, y, w, h, 'rgba(127,224,184,0.6)');
    lines.forEach((l, i) => this.text(l, this.W / 2, y + 11 + i * 10, 10, '#d8fff0', 'center', { kind: 'mono', weight: 400, shadow: false }));
    c.globalAlpha = 1;
  }

  drawBanner() {
    const b = this.banners;
    if (!b) return;
    const c = this.ctx;
    const t = b.t;
    const fadeIn = Math.min(1, t * 8), fadeOut = Math.min(1, (b.dur - t) * 3);
    const a = Math.min(fadeIn, fadeOut);
    const main = scramble(b.main, t, 0.5, b.main.length);
    c.font = font(26, 'serif');
    const tw = c.measureText(b.main).width;
    const w = Math.min(this.W - 20, tw + 120), h = 30;
    const x = this.W / 2 - w / 2, y = Math.round(this.V * 0.36);
    const squash = 1 - Math.max(0, 0.12 - t) * 6;
    c.save();
    c.globalAlpha = a;
    c.translate(this.W / 2, y + h / 2); c.scale(1, squash); c.translate(-this.W / 2, -(y + h / 2));
    this.rect(x, y, w, h, 'rgba(6,10,12,0.78)');
    this.stripes(x, y, 44, h, b.color, 7, 3);
    this.stripes(x + w - 44, y, 44, h, b.color, 7, 3);
    this.rect(x, y, w, 1, b.color); this.rect(x, y + h - 1, w, 1, b.color);
    const jitter = t < 0.5 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.text(main, this.W / 2 + jitter, y + 22, 26, WHITE, 'center', { ca: 1 });
    if (b.sub) this.text(scramble(b.sub, t, 0.8, 3), this.W / 2, y + h + 9, 8, b.color, 'center');
    c.restore();
  }

  drawToasts() {
    let y = this.V * 0.6;
    for (const t of this.toasts) {
      const pop = Math.max(0, 0.12 - t.t) * 4;
      const a = Math.min(1, (t.dur - t.t) * 2);
      this.text(t.text, this.W / 2, y, (t.small ? 9 : 12) * (1 + pop), t.color, 'center', { alpha: a, kind: t.small ? 'mono' : 'serif', weight: t.small ? 400 : 700, ca: t.small ? 0 : 0.5 });
      y += t.small ? 11 : 15;
    }
  }

  drawLevelCard() {
    const L = this.levelCardS;
    if (!L) return;
    const c = this.ctx;
    const a = Math.min(1, L.t * 3, (L.dur - L.t) * 2);
    c.globalAlpha = a;
    const x = 14 + this.safe.l, y = this.V * 0.2;
    this.rect(x - 6, y - 16, Math.min(this.W * 0.55, 300), 70, 'rgba(4,6,10,0.75)');
    this.rect(x - 6, y - 16, 2, 70, MINT);
    this.text(L.stratum, x, y - 4, 8, MINT, 'left');
    this.text(scramble(L.code + '  ' + L.name, L.t, 0.6), x, y + 15, 20, WHITE, 'left', { ca: 0.8 });
    c.font = font(10, 'mono', 400);
    const shown = L.desc.slice(0, Math.floor(Math.max(0, L.t - 0.5) * 45));
    wrap(c, shown, Math.min(this.W * 0.5, 280)).slice(0, 3).forEach((l, i) => this.text(l, x, y + 28 + i * 9, 10, '#cfe', 'left', { kind: 'mono', weight: 400 }));
    c.globalAlpha = 1;
  }

  drawCutscene() {
    const cs = this.game.cutscene;
    const bar = Math.round(this.V * 0.11 * cs.letterbox);
    this.rect(0, 0, this.W, bar, '#000');
    this.rect(0, this.V - bar, this.W, bar, '#000');
    const line = cs.line;
    if (line && line.text) {
      const c = this.ctx;
      c.font = font(11, 'mono', 400);
      const shown = line.text.slice(0, Math.floor(line.shown));
      const lines = wrap(c, shown, Math.min(this.W * 0.7, 420));
      const y0 = this.V - bar - 10 - lines.length * 11;
      if (line.speaker) this.text(line.speaker, this.W / 2, y0 - 6, 10, line.color || MINT, 'center', { ca: 0.5 });
      lines.forEach((l, i) => this.text(l, this.W / 2, y0 + 8 + i * 11, 11, WHITE, 'center', { kind: 'mono', weight: 400 }));
    }
    const skip = this.game.input.usingTouch ? 'HOLD ANYWHERE TO SKIP' : 'HOLD SPACE TO SKIP';
    this.text(skip, this.W - 8 - this.safe.r, this.V - 4 - Math.max(0, bar - 12), 7, cs.skipHold > 0 ? '#ffe23a' : '#777', 'right', { kind: 'mono', weight: 400 });
    if (cs.skipHold > 0) this.rect(this.W - 8 - this.safe.r - 60, this.V - 2, 60 * Math.min(1, cs.skipHold / 0.6), 1, '#ffe23a');
  }

  drawNameCard() {
    const N = this.nameCardS;
    if (!N) return;
    const c = this.ctx;
    const t = N.t;
    const a = Math.min(1, t * 4, (N.dur - t) * 2.5);
    c.globalAlpha = a;
    const y = this.V * 0.62;
    const name = scramble(N.name, t, 0.6, 9);
    c.font = font(34, 'serif');
    const tw = c.measureText(N.name).width;
    const x = this.W / 2 - tw / 2 - 30;
    this.stripes(x - 30, y - 30, 26, 40, N.color, 6, 3);
    this.stripes(this.W / 2 + tw / 2 + 34, y - 30, 26, 40, N.color, 6, 3);
    this.text(name, this.W / 2, y, 34, WHITE, 'center', { ca: 1.2 });
    this.rect(this.W / 2 - tw / 2, y + 5, tw * Math.min(1, t * 2), 1, N.color);
    this.text(scramble(N.title, t, 1.0, 2), this.W / 2, y + 16, 9, N.color, 'center');
    c.globalAlpha = 1;
  }
}

export function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export { RANKS };
