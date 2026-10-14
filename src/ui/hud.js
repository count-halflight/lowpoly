import { RANKS } from '../game/style.js';
import { DEFS, WEAPON_ORDER } from '../game/weapons.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="alert" id="h-alert"><span>ALERT</span></div>
        <div class="roomlabel"><div class="rl-main" id="h-room">LOBBY</div><div class="rl-sub" id="h-roomsub">SERVICE DECKS</div></div>
        <div class="scorebox"><div class="score" id="h-score">000000</div><div class="score-sub" id="h-scoresub">x1.0</div></div>
      </div>
      <div class="objective" id="h-obj"></div>
      <div class="bossbar" id="h-boss"><div class="bb-name" id="h-bossname"></div><div class="bb-track"><div class="bb-fill" id="h-bossfill"></div><div class="bb-mark"></div></div><div class="bb-title" id="h-bosstitle"></div></div>
      <div class="stylebox" id="h-style">
        <div class="sb-head"><div class="sb-rank" id="h-rank">D</div><div class="sb-info"><div class="sb-word" id="h-rankword">DULL</div><div class="sb-score" id="h-stylescore">SCORE 0</div><div class="sb-meter"><div id="h-meter"></div></div></div></div>
        <div class="sb-feed" id="h-feed"></div>
      </div>
      <div class="uplink" id="h-uplink"><div class="ul-top"><span class="ul-tag">CH 07 LIVE</span></div><div class="ul-main">CALLING BACKUP</div><div class="ul-bar"><div id="h-uplinkfill"></div></div><div class="ul-pct" id="h-uplinkpct">UPLINK 0%</div></div>
      <div class="crosshair" id="h-cross"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b></b><div class="charge" id="h-charge"></div></div>
      <div class="hitmarker" id="h-hit"><i></i><i></i><i></i><i></i></div>
      <div class="dmgdirs" id="h-dmgdirs"></div>
      <div class="banner" id="h-banner"><div class="bn-main" id="h-bnmain"></div><div class="bn-sub" id="h-bnsub"></div></div>
      <div class="toasts" id="h-toasts"></div>
      <div class="hint" id="h-hint"></div>
      <div class="hp" id="h-hpbox">
        <div class="hp-shield"><div id="h-shield"></div></div>
        <div class="hp-row"><span class="hp-slash">/</span><span class="hp-num" id="h-hp">100</span><div class="hp-side"><div class="hp-bar"><div id="h-hpbar"></div></div><div class="dash" id="h-dash"></div></div></div>
      </div>
      <div class="ammo" id="h-ammobox">
        <div class="weapons" id="h-weapons"></div>
        <div class="ammo-row"><div class="ammo-side"><div class="ammo-name" id="h-wname">HAMMER</div><div class="ammo-res" id="h-res">RES ∞</div></div><span class="ammo-num" id="h-mag">8</span><span class="hp-slash r">/</span></div>
        <div class="reload" id="h-reload"><div id="h-reloadfill"></div></div>
      </div>
      <div class="fps" id="h-fps"></div>
      <div class="vignette-heal" id="h-heal"></div>
    `;
    this.el = {};
    root.querySelectorAll('[id^="h-"]').forEach((e) => { this.el[e.id.slice(2)] = e; });
    this.cache = {};
    this.toastList = [];
    this.hitT = 0;
    this.dmgDirs = [];
    this.bannerT = 0;
    this.buildWeapons();
    this.el.weapons.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-w]');
      if (b) { e.preventDefault(); e.stopPropagation(); this.game.weapons.select(b.dataset.w); }
    });
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  buildWeapons() {
    this.el.weapons.innerHTML = WEAPON_ORDER.map((id, i) => `<div class="w" data-w="${id}" style="--wc:${DEFS[id].color}"><span class="wk">${i + 1}</span><span class="wn">${DEFS[id].name}</span></div>`).join('');
    this.wEls = {};
    this.el.weapons.querySelectorAll('[data-w]').forEach((e) => { this.wEls[e.dataset.w] = e; });
  }

  show(on) { this.root.classList.toggle('on', on); }

  setRoom(main, sub) { this.set('room', this.el.room, main); this.set('roomsub', this.el.roomsub, sub); }

  banner(main, sub, color = '#3ef0d0', dur = 2.2) {
    this.el.bnmain.textContent = main;
    this.el.bnsub.textContent = sub || '';
    this.el.banner.style.setProperty('--bc', color);
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
    this.bannerT = dur;
  }

  toast(text, color = '#ffffff', small = false) {
    const d = document.createElement('div');
    d.className = 'toast' + (small ? ' small' : '');
    d.style.color = color;
    d.textContent = text;
    this.el.toasts.prepend(d);
    this.toastList.push({ d, t: small ? 1.4 : 2.4 });
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
  }

  hint(text) { this.set('hint', this.el.hint, text || ''); this.el.hint.classList.toggle('on', !!text); }

  hitMarker(kind) {
    const h = this.el.hit;
    h.className = 'hitmarker show ' + kind;
    this.hitT = kind === 'kill' || kind === 'headkill' ? 0.25 : 0.12;
  }

  damage(amount, from) {
    const g = this.game;
    this.dmgFlash = Math.min(1, (this.dmgFlash || 0) + 0.25 + amount / 50);
    if (from) {
      const p = g.player.body.pos;
      const ang = Math.atan2(from.x - p.x, from.z - p.z);
      const rel = ang - (g.player.yaw + Math.PI);
      const d = document.createElement('div');
      d.className = 'dmgdir';
      d.style.transform = `rotate(${-rel}rad)`;
      this.el.dmgdirs.appendChild(d);
      this.dmgDirs.push({ d, t: 1.0 });
      if (this.dmgDirs.length > 6) { const o = this.dmgDirs.shift(); o.d.remove(); }
    }
  }

  healPulse() {
    const h = this.el.heal;
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const w = g.weapons;
    // top
    this.set('score', this.el.score, String(Math.floor(g.style.score)).padStart(6, '0'));
    const mult = g.style.rank.mult * g.style.routeMult;
    this.set('scoresub', this.el.scoresub, 'x' + mult.toFixed(2).replace(/0$/, '') + (g.director.modifier ? '  ' + g.director.modifier.toUpperCase() : ''));
    const combat = g.level.current && g.level.current.state === 'combat';
    this.el.alert.classList.toggle('on', !!combat);
    // objective
    let obj = '';
    const room = g.level.current;
    if (room) {
      if (room.state === 'combat' && !g.bosses.active) obj = 'HOSTILES ' + g.director.remaining();
      else if (room.state === 'cleared' && room.chosenExit < 0) obj = room.exitDoors.length > 1 ? 'CHOOSE A ROUTE  ▲' : 'PROCEED  ▲';
      else if (room.state === 'cleared') obj = 'PROCEED  ▲';
    }
    this.set('obj', this.el.obj, obj);
    // boss
    const boss = g.bosses.active;
    const showBoss = !!(boss && boss.alive);
    this.el.boss.classList.toggle('on', showBoss);
    if (showBoss) {
      this.set('bossname', this.el.bossname, boss.name);
      this.set('bosstitle', this.el.bosstitle, boss.phase === 2 ? 'PHASE II' : boss.title);
      this.el.bossfill.style.width = (boss.hp / boss.maxHp * 100).toFixed(1) + '%';
      this.el.boss.classList.toggle('shielded', !!(boss.shielded));
    }
    // style
    const r = g.style.rank;
    this.set('rank', this.el.rank, r.l);
    this.set('rankword', this.el.rankword, r.w);
    this.set('stylescore', this.el.stylescore, 'SCORE ' + Math.floor(g.style.score));
    this.el.style.style.setProperty('--rc', r.c);
    this.el.meter.style.width = Math.max(0, Math.min(100, g.style.meter)).toFixed(0) + '%';
    const feedKey = g.style.feed.map((f) => f.name + f.count + f.pts).join('|');
    if (this.cache.feed !== feedKey) {
      this.cache.feed = feedKey;
      this.el.feed.innerHTML = g.style.feed.map((f) => `<div><b>+${f.pts}</b> ${f.name}${f.count > 1 ? ' x' + f.count : ''}</div>`).join('');
    }
    this.el.style.classList.toggle('dim', g.style.rankIndex === 0 && g.style.meter < 1 && !g.style.feed.length);
    // uplink
    const sig = g.enemies.uplink();
    this.el.uplink.classList.toggle('on', !!sig);
    if (sig) {
      const pct = Math.floor(sig.progress * 100);
      this.set('uplinkpct', this.el.uplinkpct, 'UPLINK ' + pct + '%');
      this.el.uplinkfill.style.width = pct + '%';
    }
    // health
    this.set('hp', this.el.hp, String(Math.ceil(Math.max(0, p.hp))));
    this.el.hpbar.style.width = Math.max(0, p.hp / p.stats.maxHp * 100).toFixed(1) + '%';
    this.el.hpbox.classList.toggle('low', p.hp < p.stats.maxHp * 0.3);
    this.el.shield.style.width = p.stats.shieldMax ? (p.shield / p.stats.shieldMax * 100).toFixed(1) + '%' : '0%';
    const dashKey = Math.floor(p.dashCharges * 10) + '/' + p.stats.dashCharges;
    if (this.cache.dash !== dashKey) {
      this.cache.dash = dashKey;
      let s = '';
      for (let i = 0; i < p.stats.dashCharges; i++) {
        const f = Math.max(0, Math.min(1, p.dashCharges - i));
        s += `<i style="--f:${f}"></i>`;
      }
      this.el.dash.innerHTML = s;
    }
    // ammo
    const id = w.current, a = w.ammo[id], d = DEFS[id];
    this.set('mag', this.el.mag, String(a.mag));
    this.set('res', this.el.res, isFinite(a.reserve) ? 'RES ' + a.reserve : 'RES ∞');
    this.set('wname', this.el.wname, d.name);
    this.el.ammobox.style.setProperty('--wc', d.color);
    this.el.ammobox.classList.toggle('empty', a.mag === 0);
    this.el.reload.classList.toggle('on', w.reloading);
    if (w.reloading) this.el.reloadfill.style.width = ((1 - w.reloadT / w.reloadTotal) * 100).toFixed(0) + '%';
    for (const wid of WEAPON_ORDER) {
      const e = this.wEls[wid];
      const owned = w.owned.includes(wid);
      const key = (owned ? 1 : 0) + (wid === id ? 2 : 0);
      if (this.cache['w' + wid] !== key) {
        this.cache['w' + wid] = key;
        e.classList.toggle('owned', owned);
        e.classList.toggle('cur', wid === id);
      }
    }
    // crosshair
    const ch = this.el.cross;
    const spread = (d.spread || 0.01) + w.bloom + (d.moveSpread || 0) * Math.min(1, p.speedNow / 8);
    const gap = Math.min(40, 4 + spread * 380 * (g.input.ads ? 0.4 : 1));
    ch.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this.el.charge.style.setProperty('--c', (w.charging ? w.charge : 0).toFixed(2));
    // hitmarker
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hit.className = 'hitmarker'; }
    // damage dirs
    for (const dd of this.dmgDirs) { dd.t -= dt; dd.d.style.opacity = Math.max(0, dd.t).toFixed(2); }
    while (this.dmgDirs.length && this.dmgDirs[0].t <= 0) this.dmgDirs.shift().d.remove();
    // banner
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.remove('show'); }
    // toasts
    for (const t of this.toastList) { t.t -= dt; if (t.t <= 0) t.d.remove(); }
    this.toastList = this.toastList.filter((t) => t.t > 0);
    // damage vignette fade
    this.dmgFlash = Math.max(0, (this.dmgFlash || 0) - dt * 2.2);
    // fps
    if (g.settings.get('showFps')) {
      this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 0.5) { this.el.fps.textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS'; this.fpsAcc = 0; this.fpsN = 0; }
    } else this.set('fps', this.el.fps, '');
  }

  reset() {
    for (const t of this.toastList) t.d.remove();
    this.toastList = [];
    for (const d of this.dmgDirs) d.d.remove();
    this.dmgDirs = [];
    this.el.banner.classList.remove('show');
    this.cache = {};
    this.dmgFlash = 0;
  }
}

export { RANKS };
