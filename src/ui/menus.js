import { isTouchDevice } from '../core/settings.js';

const SETTINGS_SPEC = [
  { group: 'CONTROLS' },
  { k: 'mouseSens', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05 },
  { k: 'touchSens', label: 'Touch look sensitivity', type: 'range', min: 0.3, max: 3, step: 0.05 },
  { k: 'invertY', label: 'Invert look Y', type: 'bool' },
  { k: 'aimAssist', label: 'Touch aim assist', type: 'bool' },
  { k: 'leftHanded', label: 'Left-handed touch layout', type: 'bool' },
  { k: 'buttonScale', label: 'Touch button size', type: 'range', min: 0.7, max: 1.4, step: 0.05 },
  { group: 'VIDEO' },
  { k: 'fov', label: 'Field of view', type: 'range', min: 70, max: 115, step: 1 },
  { k: 'resolution', label: 'Render resolution', type: 'select', options: [[240, '240p (fastest)'], [300, '300p'], [400, '400p'], [540, '540p'], [720, '720p (sharp)']] },
  { k: 'jitter', label: 'Retro vertex wobble', type: 'bool' },
  { k: 'shake', label: 'Screen shake', type: 'range', min: 0, max: 1.5, step: 0.05 },
  { k: 'reduceFlashes', label: 'Reduce flashes', type: 'bool' },
  { k: 'showFps', label: 'Show FPS', type: 'bool' },
  { k: 'hints', label: 'Control hints', type: 'bool' },
  { group: 'AUDIO' },
  { k: 'master', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'sfx', label: 'Effects volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'music', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.05 },
];

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    root.innerHTML = `
      <section class="screen title" id="m-title">
        <div class="title-wrap">
          <div class="logo"><span class="logo-a">VOLT</span><span class="logo-b">GRAVE</span></div>
          <div class="tagline">ENDLESS INDUSTRIAL FPS ROGUELITE</div>
          <div class="menu-col">
            <button class="btn primary" data-a="start">START RUN</button>
            <button class="btn" data-a="settings">SETTINGS</button>
            <button class="btn" data-a="controls">CONTROLS</button>
            <button class="btn" data-a="fullscreen">FULLSCREEN</button>
          </div>
          <div class="seedrow"><label>SEED <input id="m-seed" inputmode="numeric" placeholder="random" maxlength="9"></label></div>
          <div class="records" id="m-records"></div>
        </div>
      </section>
      <section class="screen pause" id="m-pause">
        <div class="panel">
          <h2>PAUSED</h2>
          <div class="pause-stats" id="m-pausestats"></div>
          <div class="menu-col">
            <button class="btn primary" data-a="resume">RESUME</button>
            <button class="btn" data-a="settings">SETTINGS</button>
            <button class="btn" data-a="controls">CONTROLS</button>
            <button class="btn" data-a="fullscreen">FULLSCREEN</button>
            <button class="btn" data-a="restart">RESTART RUN</button>
            <button class="btn danger" data-a="quit">QUIT TO TITLE</button>
          </div>
        </div>
      </section>
      <section class="screen settings" id="m-settings">
        <div class="panel wide">
          <h2>SETTINGS</h2>
          <div class="settings-list" id="m-settingslist"></div>
          <div class="menu-row"><button class="btn" data-a="resetSettings">RESET</button><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen controls" id="m-controls">
        <div class="panel wide">
          <h2>CONTROLS</h2>
          <div class="controls-grid">
            <div><h3>KEYBOARD + MOUSE</h3>
              <p><b>WASD</b> move &nbsp; <b>MOUSE</b> aim &nbsp; <b>LMB</b> fire (hold to charge the Lance)</p>
              <p><b>RMB / E</b> aim down sights &nbsp; <b>R</b> reload &nbsp; <b>1-6 / wheel</b> weapons &nbsp; <b>Q</b> last weapon</p>
              <p><b>SPACE</b> jump (also off walls) &nbsp; <b>SHIFT</b> dash (hold to sprint)</p>
              <p><b>CTRL / C</b> slide, or ground-slam in mid-air (jump right after landing for a slam jump)</p>
              <p><b>F / V</b> punch &mdash; time it on an incoming orb to <b>PARRY</b> it back</p>
              <p><b>ESC / P</b> pause</p></div>
            <div><h3>TOUCH</h3>
              <p><b>Left side</b> drag anywhere: move (push to the edge to sprint)</p>
              <p><b>Right side</b> drag: look. Drag on <b>FIRE</b> to aim while shooting.</p>
              <p><b>JUMP, DASH, SLIDE</b> (slide in mid-air = slam), <b>PARRY</b>, <b>RLD</b>, <b>AIM</b>, <b>SWAP</b>. Tap weapon names to switch.</p>
              <p>Settings has sensitivity, button size, left-handed layout and aim assist.</p></div>
            <div><h3>HOW TO WIN FIGHTS</h3>
              <p>Every enemy telegraphs: <b>orange orbs</b> are dodgeable, <b>yellow lasers</b> mean a burst, <b>red sniper lasers</b> flash white before firing, <b>circles</b> on the floor show where blasts land.</p>
              <p>Kill <b>Signallers</b> before their uplink hits 100% or backup arrives.</p>
              <p>Close-range kills heal you. Style rank multiplies your score.</p></div>
          </div>
          <div class="menu-row"><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen reward" id="m-reward">
        <div class="reward-wrap">
          <h2 id="m-rewardtitle">CACHE UNLOCKED</h2>
          <div class="reward-sub" id="m-rewardsub">CHOOSE ONE</div>
          <div class="cards" id="m-cards"></div>
          <button class="btn skip" data-a="skipReward">SKIP  (+25 HP)</button>
        </div>
      </section>
      <section class="screen dead" id="m-dead">
        <div class="panel wide">
          <h2 class="dead-title">TERMINATED</h2>
          <div class="dead-cause" id="m-cause"></div>
          <div class="dead-tip" id="m-tip"></div>
          <div class="dead-stats" id="m-deadstats"></div>
          <div class="menu-row"><button class="btn primary" data-a="restart">RUN IT BACK</button><button class="btn" data-a="quit">TITLE</button></div>
          <div class="dead-key">${isTouchDevice ? '' : 'Press R or ENTER to restart'}</div>
        </div>
      </section>
      <div class="rotate" id="m-rotate"><div>ROTATE TO LANDSCAPE</div></div>
    `;
    this.screens = {};
    root.querySelectorAll('.screen').forEach((s) => { this.screens[s.id.slice(2)] = s; });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      this.game.audio.init();
      this.game.audio.play(b.dataset.a === 'back' ? 'uiBack' : 'ui');
      this.action(b.dataset.a, b);
    });
    this.stack = [];
    this.buildSettings();
    this.updateRecords();
    const checkRotate = () => {
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      $id('m-rotate').classList.toggle('on', isTouchDevice && portrait);
    };
    const $id = (id) => root.querySelector('#' + id);
    window.addEventListener('resize', checkRotate);
    checkRotate();
  }

  action(a, el) {
    const g = this.game;
    switch (a) {
      case 'start': {
        const v = this.root.querySelector('#m-seed').value.trim();
        const seed = v ? (parseInt(v, 10) >>> 0) || hash(v) : (Math.random() * 1e9) >>> 0;
        g.startRun(seed);
        break;
      }
      case 'resume': g.resume(); break;
      case 'restart': g.startRun(g.run.customSeed ? g.run.seed : (Math.random() * 1e9) >>> 0, g.run.customSeed); break;
      case 'quit': g.quitToTitle(); break;
      case 'settings': this.push('settings'); break;
      case 'controls': this.push('controls'); break;
      case 'back': this.pop(); break;
      case 'fullscreen': g.toggleFullscreen(); break;
      case 'resetSettings': g.settings.reset(); this.buildSettings(); break;
      case 'skipReward': g.chooseReward(-1); break;
      case 'card': g.chooseReward(parseInt(el.dataset.i, 10)); break;
      default: break;
    }
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    this.current = name;
    this.stack = name ? [name] : [];
  }
  push(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    this.stack.push(name);
    this.current = name;
  }
  pop() {
    this.stack.pop();
    const prev = this.stack[this.stack.length - 1] || null;
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === prev);
    this.current = prev;
  }

  buildSettings() {
    const list = this.root.querySelector('#m-settingslist');
    const s = this.game.settings;
    list.innerHTML = '';
    for (const spec of SETTINGS_SPEC) {
      if (spec.group) { const h = document.createElement('h3'); h.textContent = spec.group; list.appendChild(h); continue; }
      const row = document.createElement('label');
      row.className = 'set-row';
      const name = document.createElement('span');
      name.textContent = spec.label;
      row.appendChild(name);
      let input;
      if (spec.type === 'range') {
        input = document.createElement('input');
        input.type = 'range'; input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = s.get(spec.k);
        const val = document.createElement('em');
        const fmt = (v) => (spec.k === 'fov' ? v + '°' : Number(v).toFixed(2));
        val.textContent = fmt(input.value);
        input.addEventListener('input', () => { val.textContent = fmt(input.value); s.set(spec.k, parseFloat(input.value)); });
        row.appendChild(input); row.appendChild(val);
      } else if (spec.type === 'bool') {
        input = document.createElement('input');
        input.type = 'checkbox'; input.checked = !!s.get(spec.k);
        input.addEventListener('change', () => s.set(spec.k, input.checked));
        row.appendChild(input);
      } else if (spec.type === 'select') {
        input = document.createElement('select');
        for (const [v, l] of spec.options) { const o = document.createElement('option'); o.value = v; o.textContent = l; input.appendChild(o); }
        input.value = s.get(spec.k);
        input.addEventListener('change', () => s.set(spec.k, parseInt(input.value, 10)));
        row.appendChild(input);
      }
      list.appendChild(row);
    }
  }

  updateRecords() {
    const r = this.game.records.v;
    this.root.querySelector('#m-records').innerHTML = r.runs
      ? `BEST SCORE <b>${r.bestScore}</b> &nbsp;·&nbsp; DEEPEST ROOM <b>${r.bestRoom}</b> &nbsp;·&nbsp; BOSSES DOWN <b>${r.bossesKilled}</b> &nbsp;·&nbsp; RUNS <b>${r.runs}</b>`
      : 'NO RECORDS YET';
  }

  showReward(title, sub, cards) {
    this.root.querySelector('#m-rewardtitle').textContent = title;
    this.root.querySelector('#m-rewardsub').textContent = sub;
    const wrap = this.root.querySelector('#m-cards');
    wrap.innerHTML = cards.map((c, i) => `
      <button class="card r-${c.rarity}${c.trade ? ' trade' : ''}" data-a="card" data-i="${i}" ${c.color ? `style="--wc:${c.color}"` : ''}>
        <div class="card-key">${i + 1}</div>
        <div class="card-rarity">${c.kind === 'weapon' ? 'NEW WEAPON' : c.rarity.toUpperCase()}${c.trade ? ' · TRADE-OFF' : ''}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-desc">${c.desc}</div>
        ${c.max ? `<div class="card-stack">LEVEL ${c.stack} / ${c.max}</div>` : ''}
      </button>`).join('');
    this.show('reward');
  }

  showDeath(cause, tip, stats) {
    this.root.querySelector('#m-cause').textContent = 'KILLED BY ' + (cause || 'THE MACHINE');
    this.root.querySelector('#m-tip').textContent = tip || '';
    this.root.querySelector('#m-deadstats').innerHTML = stats;
    this.show('dead');
  }

  pauseStats(html) { this.root.querySelector('#m-pausestats').innerHTML = html; }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
