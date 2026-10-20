import * as THREE from 'three';
import { RANKS } from '../game/style.js';
import { DEFS, WEAPON_ORDER } from '../game/weapons.js';
import { font, scramble, drawIcon } from './pixel.js';

// The HUD is laid out in virtual units (virtual height ~300-400) but rendered at the
// device's real resolution through a canvas transform, so text stays crisp and readable on
// phones and high-DPI screens. Readable text never gets glitch effects unless the player
// turns 'textFx' on. Messages use fixed lanes so nothing piles up on the crosshair.

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
    this.corner = []; // medals / unlocks: a quiet lane away from the action
    this.banners = null;
    this.bannerQ = [];
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
    const hs = (this.game.settings && this.game.settings.get('hudScale')) || 1;
    const V = Math.round((touch ? 330 : Math.max(300, Math.min(400, Math.round(cssH / 2.6)))) / hs);
    this.V = V; this.W = Math.round(V * cssW / cssH);
    this.k = V / cssH; // virtual units per css px
    // backing store at (about) device resolution: S device px per virtual unit
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.S = Math.max(1, Math.min(4, Math.ceil(cssH * dpr / V)));
    this.canvas.width = this.W * this.S; this.canvas.height = this.V * this.S;
    this.canvas.style.imageRendering = this.S > 1 ? 'auto' : '';
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
  // one big banner at a time: a new one waits until the current one has mostly played
  banner(main, sub, color = MINT, dur = 2.4) {
    const b = { main, sub: sub || '', color, t: 0, dur: Math.min(dur, 2.2) };
    // the level card is old news once something happens: fade it out and show the banner
    const L = this.levelCardS;
    if (L) L.dur = Math.min(L.dur, L.t + 0.3);
    const cur = this.banners;
    if (cur && cur.main === main) { cur.sub = b.sub; return; }
    if (cur && cur.t < cur.dur * 0.55) { this.bannerQ = this.bannerQ.filter((q) => q.main !== main).slice(-1); this.bannerQ.push(b); return; }
    this.banners = b;
  }
  nameCard(name, title, color, dur = 3) { this.nameCardS = { name, title, color, t: 0, dur }; }
  levelCard(code, name, stratum, desc, dur = 5) { this.levelCardS = { code, name, stratum, desc, t: 0, dur }; }
  toast(text, color = WHITE, small = false) {
    if (/^MEDAL|^UNLOCK/.test(text)) { this.corner.unshift({ text, color, t: 0, dur: 3.5 }); this.corner.length = Math.min(this.corner.length, 3); return; }
    const same = this.toasts.find((t) => t.text === text);
    if (same) { same.t = 0; return; }
    this.toasts.unshift({ text, color, small, t: 0, dur: small ? 1.5 : 2.4 });
    if (this.toasts.length > 2) this.toasts.pop();
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
  reset() { this.toasts = []; this.corner = []; this.dmgDirs = []; this.banners = null; this.bannerQ = []; this.nameCardS = null; this.levelCardS = null; this.dmgFlash = 0; this.hintText = ''; }
  // glitch only when the player asked for it
  scr(text, t, dur, seed) { return this.textFx ? scramble(text, t, dur, seed) : text; }

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
    if (opts.shadow !== false) { c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillText(str, x + 1, y + 1); }
    if (opts.ca && this.textFx) {
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
    if (this.banners && !this.levelCardS) { this.banners.t += dt; if (this.banners.t > this.banners.dur) this.banners = null; }
    // queued banners wait while the level card is up, then play one after another
    if (!this.banners && this.bannerQ.length && !this.levelCardS) this.banners = this.bannerQ.shift();
    for (const t of this.corner) t.t += dt;
    this.corner = this.corner.filter((t) => t.t < t.dur);
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
    c.setTransform(this.S, 0, 0, this.S, 0, 0);
    c.clearRect(0, 0, this.W, this.V);
    if (!this.visible) return;
    c.imageSmoothingEnabled = false;
    this.textFx = !!g.settings.get('textFx');
    const cut = g.cutscene && g.cutscene.active;
    if (!cut) {
      this.drawTopRight();
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
      if (!(g.bosses.active && g.bosses.active.alive)) this.drawLevelCard();
      if (!this.levelCardS) this.drawBanner();
      this.drawToasts();
      this.drawCorner();
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
    const mult = g.style.rank.mult * g.style.routeMult;
    const tag = (combat ? 'ALERT' : 'CLEAR') + (mult > 1.001 ? '  x' + mult.toFixed(1) : '');
    c.font = font(9, 'serif', 700);
    const tagW = c.measureText(tag).width;
    this.fitText(this.room.sub, x + 14, y + 29, 9, w - 26 - tagW - 8, '#e0e0e0', {});
    this.text(tag, x + w - 6, y + 29, 9, combat ? RED : '#e0e0e0', 'right');
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
    if (obj) {
      c.font = font(11, 'mono', 400);
      const ow = c.measureText(obj).width + 12;
      this.rect(this.W / 2 - ow / 2, 5 + s.t, ow, 14, 'rgba(4,8,10,0.6)');
      this.text(obj, this.W / 2, 16 + s.t, 11, WHITE, 'center', { kind: 'mono', weight: 400 });
    }
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
    this.text(r.w, x + 30, y + 12, 9, r.c, 'left');
    this.text(String(Math.floor(st.score)), x + 30, y + 21, 8, '#e8e8e8', 'left', { kind: 'mono', weight: 400 });
    this.segBar(x + 30, y + 23, 60, 2, Math.max(0, Math.min(1, st.meter / 100)), r.c, 8, 1);
    this.ctx.globalAlpha = 1;
    let fy = y + h + 9;
    for (const f of st.feed.slice(0, 3)) {
      const age = g.time - f.t;
      const a = Math.max(0, Math.min(1, 4 - age));
      const slide = Math.max(0, 0.15 - age) * 60;
      this.text('+' + f.pts, x + 2 - slide, fy, 9, r.c, 'left', { alpha: a });
      this.text(f.name + (f.count > 1 ? ' x' + f.count : ''), x + 28 - slide, fy, 9, WHITE, 'left', { alpha: a });
      fy += 10;
    }
  }

  drawUplink() {
    const sig = this.game.enemies.uplink();
    if (!sig) return;
    const w = 92, h = 34;
    const x = this.touch ? this.W / 2 - w / 2 - 110 : this.W - w - 6 - this.safe.r;
    const y = this.touch ? 24 + this.safe.t : 46 + this.safe.t + (this.game.bosses.active ? 40 : 0);
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
    const x = (this.touch ? 54 * this.k : 8) + s.l; // the touch pause button sits top-left
    const y = this.touch ? 40 + s.t : this.V - 10 - s.b;
    const low = p.hp < p.stats.maxHp * 0.3;
    const blink = low && Math.floor(this.t * 4) % 2 === 0;
    if (p.stats.shieldMax) this.segBar(x + 14, y - 34, 74, 2, p.shield / p.stats.shieldMax, '#40c8ff', 6, 1);
    this.text('/', x, y, 30, CYAN, 'left', { weight: 400 });
    const hpStr = String(Math.ceil(Math.max(0, p.hp)));
    const tw = this.text(hpStr, x + 13, y, 30, blink ? RED : WHITE, 'left', { ca: 0.7 });
    this.segBar(x + 16 + tw, y - 12, 60, 4, p.hp / p.stats.maxHp, low ? RED : WHITE, 14, 1);
    if (low) this.text('CRITICAL', x + 16 + tw, y - 1, 9, RED, 'left');
  }

  drawAmmo() {
    const g = this.game, w = g.weapons;
    const s = this.safe;
    const id = w.current, a = w.ammo[id], d = DEFS[id];
    const right = this.W - 8 - s.r;
    const y = this.touch ? 96 + s.t : this.V - 10 - s.b;
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
      this.text(String(WEAPON_ORDER.indexOf(wid) + 1), ix + 2, iy + ih - 2, 8, cur ? WHITE : '#888', 'left', { kind: 'mono', weight: 400, shadow: false });
      this.weaponBoxes.push({ id: wid, x: ix, y: iy, w: iw, h: ih });
      ix += iw + 3;
    }
    // ammo number
    const empty = a.mag === 0;
    this.text('/', right, y, 30, d.color, 'right', { weight: 400 });
    const nw = this.text(String(a.mag), right - 12, y, 30, empty ? RED : WHITE, 'right', { ca: 0.7 });
    const lx = right - 16 - nw;
    const vi = w.variantInfo ? w.variantInfo(id) : null;
    this.text(d.name + (vi ? ' · ' + vi.name : ''), lx, y - 14, 10, vi && vi.color ? vi.color : d.color, 'right');
    const rw = this.text(isFinite(a.reserve) ? 'RES ' + Math.floor(a.reserve) : 'RES ∞', lx, y - 3, 9, '#d8d8d8', 'right', { kind: 'mono', weight: 400 });
    if (w.reloading) this.segBar(lx - 60, y - 26, 60, 2, 1 - w.reloadT / w.reloadTotal, d.color, 10, 1);
    if (w.altInfo) { const info = w.altInfo(); if (info) this.text(info, lx - rw - 10, y - 3, 9, '#ffd060', 'right', { kind: 'mono', weight: 400 }); }
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
    let cx = this.W / 2, maxW = Math.min(this.W * 0.6, 340);
    if (this.touch) {
      // between the move stick (left ~200 css px) and the button cluster (right ~350 css px)
      const lo = 200 * this.k + this.safe.l, hi = this.W - 350 * this.k - this.safe.r;
      maxW = Math.max(120, hi - lo - 10); cx = (lo + hi) / 2;
    }
    c.font = font(11, 'mono', 400);
    const lines = wrap(c, this.hintText, maxW - 14);
    const lh = 12, h = lines.length * lh + 8;
    const y = this.touch ? this.V - h - 8 - this.safe.b : this.V - 74 - this.safe.b - Math.max(0, lines.length - 2) * lh;
    const w = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width)) + 14);
    const a = Math.min(1, this.hintT * 2);
    c.globalAlpha = a;
    this.rect(cx - w / 2, y, w, h, 'rgba(4,10,12,0.88)');
    this.frame(cx - w / 2, y, w, h, 'rgba(127,224,184,0.7)');
    lines.forEach((l, i) => this.text(l, cx, y + 12 + i * lh, 11, '#e8fff6', 'center', { kind: 'mono', weight: 400, shadow: false }));
    c.globalAlpha = 1;
  }

  drawBanner() {
    const b = this.banners;
    if (!b) return;
    const c = this.ctx;
    const t = b.t;
    const fadeIn = Math.min(1, t * 8), fadeOut = Math.min(1, (b.dur - t) * 3);
    const a = Math.min(fadeIn, fadeOut);
    const main = this.scr(b.main, t, 0.5, b.main.length);
    c.font = font(24, 'serif');
    const tw = c.measureText(b.main).width;
    const w = Math.min(this.W - 20, tw + 100), h = 30;
    const x = this.W / 2 - w / 2, y = Math.round(this.V * 0.2) + this.safe.t;
    const squash = 1 - Math.max(0, 0.12 - t) * 6;
    c.save();
    c.globalAlpha = a;
    c.translate(this.W / 2, y + h / 2); c.scale(1, squash); c.translate(-this.W / 2, -(y + h / 2));
    this.rect(x, y, w, h, 'rgba(6,10,12,0.88)');
    this.stripes(x, y, 30, h, b.color, 7, 3);
    this.stripes(x + w - 30, y, 30, h, b.color, 7, 3);
    this.rect(x, y, w, 1, b.color); this.rect(x, y + h - 1, w, 1, b.color);
    const jitter = this.textFx && t < 0.5 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.text(main, this.W / 2 + jitter, y + 22, 24, WHITE, 'center', { ca: 1 });
    if (b.sub) {
      c.font = font(10, 'serif', 700);
      const sw = Math.min(this.W - 20, c.measureText(b.sub).width + 16);
      this.rect(this.W / 2 - sw / 2, y + h + 1, sw, 13, 'rgba(6,10,12,0.8)');
      this.text(this.scr(b.sub, t, 0.8, 3), this.W / 2, y + h + 11, 10, b.color, 'center');
    }
    c.restore();
  }

  drawToasts() {
    let y = Math.round(this.V * 0.2) + this.safe.t + (this.banners ? 52 : 12);
    if (this.levelCardS && this.cardBottom) y = this.cardBottom + 16;
    const c = this.ctx;
    for (const t of this.toasts) {
      const pop = Math.max(0, 0.1 - t.t) * 3;
      const a = Math.min(1, (t.dur - t.t) * 2);
      const size = t.small ? 10 : 12;
      c.font = font(size, t.small ? 'mono' : 'serif', t.small ? 400 : 700);
      const w = c.measureText(t.text).width + 14;
      c.globalAlpha = a * 0.85;
      this.rect(this.W / 2 - w / 2, y - size, w, size + 5, 'rgba(4,8,10,0.75)');
      c.globalAlpha = 1;
      this.text(t.text, this.W / 2, y, size * (1 + pop), t.color, 'center', { alpha: a, kind: t.small ? 'mono' : 'serif', weight: t.small ? 400 : 700 });
      y += size + 7;
    }
  }

  // medals and unlocks: small, right edge, mid height (out of the way of combat info)
  drawCorner() {
    // touch: under the objective pill (the right side belongs to the buttons)
    let y = this.touch ? 36 + this.safe.t + (this.game.bosses.active ? 40 : 0) : Math.round(this.V * 0.3);
    const x = this.touch ? this.W / 2 + 80 : this.W - 8 - this.safe.r;
    for (const t of this.touch ? this.corner.slice(0, 1) : this.corner) {
      const a = Math.min(1, t.t * 4, (t.dur - t.t) * 2);
      this.ctx.font = font(10, 'serif', 700);
      const w = this.ctx.measureText(t.text).width + 12;
      this.ctx.globalAlpha = a;
      this.rect(x - w, y - 11, w, 15, 'rgba(4,8,10,0.8)');
      this.rect(x - w, y - 11, 2, 15, t.color);
      this.ctx.globalAlpha = 1;
      this.text(t.text, x - 5, y, 10, t.color, 'right', { alpha: a });
      y += 18;
    }
  }

  drawLevelCard() {
    const L = this.levelCardS;
    if (!L) return;
    const c = this.ctx;
    const a = Math.min(1, L.t * 3, (L.dur - L.t) * 2);
    c.globalAlpha = a;
    const cw = Math.min(this.W - 24, this.touch ? 280 : 340);
    c.font = font(11, 'mono', 400);
    const lines = wrap(c, L.desc, cw - 20).slice(0, 2);
    const ch = 44 + lines.length * 12;
    const x = this.W / 2 - cw / 2, y = Math.round(this.V * 0.16) + this.safe.t;
    this.rect(x, y, cw, ch, 'rgba(4,6,10,0.88)');
    this.rect(x, y, cw, 2, MINT);
    this.text(L.stratum, this.W / 2, y + 13, 9, MINT, 'center');
    this.text(this.scr(L.code + '  ' + L.name, L.t, 0.6), this.W / 2, y + 33, 20, WHITE, 'center', { ca: 0.8 });
    lines.forEach((l, i) => this.text(l, this.W / 2, y + 48 + i * 12, 11, '#d8f0ea', 'center', { kind: 'mono', weight: 400 }));
    this.cardBottom = y + ch;
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
      c.font = font(12, 'mono', 400);
      const shown = line.text.slice(0, Math.floor(line.shown));
      const lines = wrap(c, shown, Math.min(this.W * 0.75, 440));
      const y0 = this.V - bar - 10 - lines.length * 13;
      if (line.speaker) this.text(line.speaker, this.W / 2, y0 - 6, 11, line.color || MINT, 'center', { ca: 0.5 });
      lines.forEach((l, i) => this.text(l, this.W / 2, y0 + 9 + i * 13, 12, WHITE, 'center', { kind: 'mono', weight: 400 }));
    }
    const skip = this.game.input.usingTouch ? 'HOLD ANYWHERE TO SKIP' : 'HOLD SPACE TO SKIP';
    this.text(skip, this.W - 8 - this.safe.r, this.V - 4 - Math.max(0, bar - 12), 9, cs.skipHold > 0 ? '#ffe23a' : '#999', 'right', { kind: 'mono', weight: 400 });
    if (cs.skipHold > 0) this.rect(this.W - 8 - this.safe.r - 60, this.V - 2, 60 * Math.min(1, cs.skipHold / 0.6), 1, '#ffe23a');
  }

  drawNameCard() {
    const N = this.nameCardS;
    if (!N) return;
    const c = this.ctx;
    const t = N.t;
    const a = Math.min(1, t * 4, (N.dur - t) * 2.5);
    c.globalAlpha = a;
    const y = Math.round(this.V * 0.7);
    const name = this.scr(N.name, t, 0.6, 9);
    c.font = font(28, 'serif');
    const tw = c.measureText(N.name).width;
    const x = this.W / 2 - tw / 2 - 30;
    this.stripes(x - 30, y - 30, 26, 40, N.color, 6, 3);
    this.stripes(this.W / 2 + tw / 2 + 34, y - 30, 26, 40, N.color, 6, 3);
    this.text(name, this.W / 2, y, 28, WHITE, 'center', { ca: 1.2 });
    this.rect(this.W / 2 - tw / 2, y + 5, tw * Math.min(1, t * 2), 1, N.color);
    this.text(this.scr(N.title, t, 1.0, 2), this.W / 2, y + 18, 11, N.color, 'center');
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
