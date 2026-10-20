import { isTouchDevice } from '../core/settings.js';
import { pixelTextCanvas, noiseDataURL, iconCanvas, scramble } from './pixel.js';
import { LOGS, ENEMY_LORE, WEAPON_LORE, PREMISE } from '../data/lore.js';
import { BOSSES } from '../data/bossdata.js';
import { MINIBOSSES } from '../data/minidata.js';
import { STRATA, LEVELS, CONDITIONS } from '../data/world.js';
import { ENEMY_INFO } from '../game/enemies.js';
import { DEFS, WEAPON_ORDER } from '../game/weapons.js';
import { MEDALS, SKINS, RANK_COLOR } from '../game/meta.js';
import { NG_TWIST, ROMAN } from '../game/campaign.js';

const SETTINGS_SPEC = [
  { group: 'GAME' },
  { k: 'difficulty', label: 'Difficulty (applies from the next room)', type: 'select', str: true, options: [['steady', 'STEADY  (learning the ropes)'], ['normal', 'NORMAL'], ['hard', 'HARD  (the original balance)'], ['brutal', 'BRUTAL']] },
  { group: 'CONTROLS' },
  { k: 'mouseSens', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05 },
  { k: 'touchSens', label: 'Touch look sensitivity', type: 'range', min: 0.3, max: 3, step: 0.05 },
  { k: 'invertY', label: 'Invert look Y', type: 'bool' },
  { k: 'rmbMode', label: 'Right mouse button', type: 'select', str: true, options: [['alt', 'ALT-FIRE  (aim with Z)'], ['aim', 'AIM  (alt-fire on T / middle mouse)']] },
  { k: 'aimToggle', label: 'Aim is a toggle (not hold)', type: 'bool' },
  { k: 'adsSens', label: 'Aiming sensitivity', type: 'range', min: 0.3, max: 1.5, step: 0.05 },
  { k: 'aimAssist', label: 'Touch aim assist', type: 'bool' },
  { k: 'leftHanded', label: 'Left-handed touch layout', type: 'bool' },
  { k: 'buttonScale', label: 'Touch button size', type: 'range', min: 0.7, max: 1.4, step: 0.05 },
  { k: 'touchOpacity', label: 'Touch button opacity', type: 'range', min: 0.25, max: 1, step: 0.05 },
  { group: 'VIDEO' },
  { k: 'fov', label: 'Field of view', type: 'range', min: 70, max: 115, step: 1 },
  { k: 'resolution', label: 'Render resolution', type: 'select', options: [[240, '240p (crunchiest)'], [300, '300p'], [400, '400p'], [540, '540p'], [720, '720p (sharp)']] },
  { k: 'jitter', label: 'Retro vertex wobble', type: 'bool' },
  { k: 'shake', label: 'Screen shake', type: 'range', min: 0, max: 1.5, step: 0.05 },
  { k: 'reduceFlashes', label: 'Reduce flashes', type: 'bool' },
  { k: 'cutscenes', label: 'Play boss cutscenes', type: 'bool' },
  { k: 'gore', label: 'Gore (dismemberment, blood pools)', type: 'bool' },
  { k: 'hudScale', label: 'HUD size', type: 'range', min: 0.8, max: 1.3, step: 0.05 },
  { k: 'textFx', label: 'Glitchy HUD text effects', type: 'bool' },
  { k: 'showFps', label: 'Show FPS', type: 'bool' },
  { k: 'hints', label: 'Control hints', type: 'bool' },
  { group: 'AUDIO' },
  { k: 'master', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'sfx', label: 'Effects volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'music', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.05 },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + Number(n).toString(16).padStart(6, '0');

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    document.documentElement.style.setProperty('--noise', `url(${noiseDataURL()})`);
    root.innerHTML = `
      <section class="screen shade" id="m-title">
        <div class="title-grid"><div class="title-col">
          <div class="logo-wrap" id="m-logo"></div>
          <div class="tagline">A DESCENT INTO THE GRID</div>
          <nav class="menu-list" id="m-titlelist"></nav>
          <div class="seedrow" id="m-seedrow" hidden><label>ENDLESS SEED <input id="m-seed" inputmode="numeric" placeholder="random" maxlength="12"></label></div>
          <div class="title-foot" id="m-records"></div>
        </div></div>
        <div class="version">VOLTGRAVE v2.0</div>
      </section>
      <section class="screen shade" id="m-pause">
        <div class="pause-wrap">
          <div class="panel-h"><span id="m-pauseh"></span><span class="sub" id="m-pausesub"></span></div>
          <div class="pause-stats" id="m-pausestats"></div>
          <nav class="menu-list" id="m-pauselist"></nav>
        </div>
      </section>
      <section class="screen shade-full" id="m-settings">
        <div class="panel">
          <div class="panel-h"><span data-px="SETTINGS"></span></div>
          <div class="settings-list" id="m-settingslist"></div>
          <div class="row-btns"><button class="btn" data-a="resetSettings">RESET</button><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen shade-full" id="m-controls">
        <div class="panel">
          <div class="panel-h"><span data-px="CONTROLS"></span></div>
          <div class="controls-grid">
            <div><h4>KEYBOARD + MOUSE</h4>
              <p><b>WASD</b> move · <b>MOUSE</b> look · <b>LMB</b> fire · <b>RMB</b> alt-fire (coin, saw, core, scope, mine, EMP)</p>
              <p><b>Z</b> aim down sights: fire while aiming for tighter shots. Settings can put AIM on <b>RMB</b> (alt-fire moves to <b>T</b> / middle mouse) or make it a toggle.</p>
              <p><b>QUICKSCOPE</b>: raise the sights and land the shot within about half a second (railcannon or revolver headshot) for bonus damage and style.</p>
              <p><b>1-6 / WHEEL</b> weapons · <b>Q</b> last weapon · <b>R</b> reload · <b>X</b> RUSH when full</p>
              <p><b>SPACE</b> jump, wall-jump, hold to bunny hop · <b>SHIFT</b> dash (3 charges)</p>
              <p><b>CTRL / C</b> slide on the ground, slam in the air · jump right after a slam for a slam-jump</p>
              <p><b>F / V</b> punch · time it on an orb to <b>PARRY</b> · <b>G</b> grapple hook · <b>E</b> use terminals</p>
              <p><b>ESC / P</b> pause</p></div>
            <div><h4>TOUCH</h4>
              <p><b>Left half</b>: drag anywhere to move, push to the edge to sprint.</p>
              <p><b>Right half</b>: drag to look. Drag on <b>FIRE</b> to steer while shooting. Tap weapon chips to switch.</p>
              <p><b>AIM</b> toggles aim-down-sights so FIRE stays free: tap AIM, then shoot. Tap FIRE right after AIM to quickscope.</p>
              <p><b>JUMP</b> (hold to hop), <b>DASH</b>, <b>SLIDE</b> (slam in the air), <b>PARRY</b>, <b>ALT</b>, <b>HOOK</b>, <b>RLD</b>, <b>SWAP</b>, <b>USE</b>.</p>
              <p>Settings: sensitivity, button size, left-handed layout, aim assist.</p></div>
            <div><h4>MOVEMENT TECH</h4>
              <p><b>Bunny hop</b>: jump the instant you land to keep all speed. Strafe and turn in the air to gain more.</p>
              <p><b>Slide boost</b>: land into a slide to convert fall speed into ground speed.</p>
              <p><b>Dash-jump</b> and <b>slide-jump</b> carry extra momentum. <b>Slam-jump</b> launches you high.</p>
              <p><b>Wall-run</b>: hit a wall at speed while holding forward to run along it; jump off to keep the speed. <b>Dash-slide</b>: slide out of a dash to keep most of its speed.</p>
              <p><b>Vault</b>: jump into a ledge up to head height while holding forward to climb it.</p>
              <p>Speed is armor. Standing still is how machines die.</p></div>
          </div>
          <div class="row-btns"><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen shade-full" id="m-reward">
        <div class="reward-wrap">
          <div class="panel-h"><span id="m-rewardtitle"></span><span class="sub" id="m-rewardsub"></span></div>
          <div class="cards" id="m-cards"></div>
          <div class="row-btns"><button class="btn" data-a="skipReward">SKIP  (+25 HP)</button></div>
        </div>
      </section>
      <section class="screen shade" id="m-dead">
        <div class="pause-wrap">
          <div class="panel-h"><span data-px="TERMINATED" data-col="#ff3150"></span><span class="sub" id="m-deadsub"></span></div>
          <div class="dead-cause" id="m-cause"></div>
          <div class="dead-tip" id="m-tip"></div>
          <div class="stat-grid" id="m-deadstats"></div>
          <nav class="menu-list" id="m-deadlist"></nav>
          <div class="progress-line">${isTouchDevice ? '' : 'R or ENTER to retry'}</div>
        </div>
      </section>
      <section class="screen shade" id="m-results">
        <div class="pause-wrap" style="max-width:760px">
          <div class="panel-h"><span id="m-resh"></span><span class="sub" id="m-ressub"></span></div>
          <div class="rank-big"><div id="m-rank"></div><div class="rank-rows" id="m-resrows"></div></div>
          <div class="pause-stats" id="m-resnote"></div>
          <nav class="menu-list" id="m-reslist"></nav>
        </div>
      </section>
      <section class="screen shade-full" id="m-terminal">
        <div class="terminal">
          <div class="t-head"><span id="m-thead"></span><span id="m-tid"></span></div>
          <div class="t-title" id="m-ttitle"></div>
          <div class="t-body"><span id="m-tbody"></span><span class="cursor"></span></div>
          <div class="row-btns"><button class="btn primary" data-a="closeTerminal">CLOSE  [E]</button></div>
        </div>
      </section>
      <section class="screen shade-full" id="m-codex">
        <div class="panel">
          <div class="panel-h"><span data-px="CODEX"></span><span class="sub" id="m-codexprog"></span></div>
          <div class="tabs" id="m-codextabs"></div>
          <div class="codex-body"><div class="codex-list" id="m-codexlist"></div><div class="codex-view" id="m-codexview"></div></div>
          <div class="row-btns"><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen shade-full" id="m-medals">
        <div class="panel">
          <div class="panel-h"><span data-px="MEDALS"></span><span class="sub" id="m-medalprog"></span></div>
          <div class="medals" id="m-medallist"></div>
          <h3 class="sec">WEAPON FINISH</h3>
          <div class="tabs" id="m-skins"></div>
          <div class="row-btns"><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen shade-full" id="m-levels">
        <div class="panel">
          <div class="panel-h"><span data-px="LEVEL SELECT"></span><span class="sub">PRACTICE ANY LEVEL YOU HAVE REACHED</span></div>
          <div class="codex-body"><div class="codex-list" id="m-levellist"></div><div class="codex-view" id="m-levelview"></div></div>
          <div class="row-btns"><button class="btn primary" data-a="back">BACK</button></div>
        </div>
      </section>
      <section class="screen shade" id="m-endless">
        <div class="pause-wrap">
          <div class="panel-h"><span data-px="ENDLESS"></span><span class="sub">ROOM AFTER ROOM UNTIL YOU BREAK</span></div>
          <div class="pause-stats" id="m-endlessstats"></div>
          <nav class="menu-list">
            <button class="mi primary" data-a="endlessRandom">RANDOM SEED</button>
            <button class="mi" data-a="endlessDaily">DAILY SEED <small id="m-dailyinfo"></small></button>
            <button class="mi" data-a="endlessSeed">CUSTOM SEED</button>
            <button class="mi" data-a="back">BACK</button>
          </nav>
          <div class="seedrow"><label>SEED <input id="m-seed2" inputmode="numeric" placeholder="type a number or word" maxlength="16"></label></div>
        </div>
      </section>
      <section class="screen shade" id="m-tutdone">
        <div class="pause-wrap">
          <div class="panel-h"><span data-px="TRAINING COMPLETE" data-col="#7fe0b8"></span></div>
          <div class="pause-stats">${PREMISE.map((p) => '<p>' + esc(p) + '</p>').join('')}</div>
          <nav class="menu-list">
            <button class="mi primary" data-a="beginDescent">BEGIN THE DESCENT</button>
            <button class="mi" data-a="quit">TITLE</button>
          </nav>
        </div>
      </section>
      <section class="screen credits" id="m-credits">
        <div class="credits-roll" id="m-roll"></div>
        <div class="version" style="z-index:2"><button class="btn" data-a="skipCredits">SKIP</button></div>
      </section>
      <section class="screen shade-full" id="m-ngplus">
        <div class="pause-wrap">
          <div class="panel-h"><span id="m-ngh"></span><span class="sub">NEW GAME +</span></div>
          <div class="pause-stats" id="m-ngtext"></div>
          <nav class="menu-list">
            <button class="mi primary" data-a="beginCycle">BEGIN THE CLIMB</button>
            <button class="mi" data-a="quit">TITLE</button>
          </nav>
        </div>
      </section>
      <div class="rotate" id="m-rotate"><div>ROTATE TO LANDSCAPE</div></div>
    `;
    this.$ = (id) => root.querySelector('#' + id);
    this.screens = {};
    root.querySelectorAll('.screen').forEach((s) => { this.screens[s.id.slice(2)] = s; });
    root.querySelectorAll('[data-px]').forEach((el) => this.px(el, el.dataset.px, 30, el.dataset.col));
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      this.game.audio.init();
      this.game.audio.play(b.dataset.a === 'back' ? 'uiBack' : 'ui');
      this.action(b.dataset.a, b);
    });
    root.addEventListener('pointerover', (e) => { if (e.target.closest && e.target.closest('.mi')) this.game.audio.play('uiHover', null, 0.3); });
    this.stack = [];
    this.codexTab = 'logs';
    this.buildLogo();
    this.buildSettings();
    this.updateTitle();
    const checkRotate = () => {
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      this.$('m-rotate').classList.toggle('on', isTouchDevice && portrait);
    };
    window.addEventListener('resize', checkRotate);
    checkRotate();
  }

  px(el, text, size = 30, color = '#f2f2ee') {
    el.textContent = '';
    const c = pixelTextCanvas(text, { size: Math.round(size * 0.55), color, ca: 1 });
    c.style.height = Math.round(size * 1.15) + 'px';
    c.style.width = 'auto';
    el.appendChild(c);
    el.setAttribute('aria-label', text);
  }

  buildLogo() {
    const wrap = this.$('m-logo');
    wrap.textContent = '';
    const c = pixelTextCanvas('VOLTGRAVE', { size: 34, color: '#f2f2ee', ca: 1.5 });
    c.style.height = 'auto'; // width comes from style.css so short screens can shrink it
    wrap.appendChild(c);
    wrap.setAttribute('aria-label', 'VOLTGRAVE');
  }

  // ------------------------------------------------------------------ title
  updateTitle() {
    const g = this.game, p = g.profile.v;
    const save = p.save;
    const list = [];
    if (save) {
      const lv = save.plan[save.levelIdx];
      const name = lv.final ? 'THE ARCHITECT' : (LEVELS.find((l) => l.id === lv.levelId) || {}).name;
      list.push(`<button class="mi primary" data-a="continue">CONTINUE <small>${save.cycle ? 'CYCLE ' + ROMAN[save.cycle + 1] + ' · ' : ''}${lv.final ? 'X' : esc(lv.levelId)} ${esc(name || '')}${save.atRoom ? ' · CHECKPOINT' : ''}</small></button>`);
    }
    list.push(`<button class="mi${save ? '' : ' primary'}" data-a="newGame">NEW DESCENT ${p.tutorialDone ? '' : '<span class="tag">TRAINING FIRST</span>'}</button>`);
    if (p.cyclesCleared > 0) list.push(`<button class="mi" data-a="ngplus">NEW GAME + <small>CYCLE ${ROMAN[Math.min(10, p.cyclesCleared + 1)]}</small></button>`);
    list.push(`<button class="mi" data-a="training">TRAINING${p.tutorialDone ? '' : ' <span class="tag">NEW</span>'}</button>`);
    list.push(`<button class="mi" data-a="levels">LEVEL SELECT ${p.deepest ? '' : '<small>LOCKED</small>'}</button>`);
    list.push('<button class="mi" data-a="endless">ENDLESS</button>');
    list.push(`<button class="mi" data-a="codex">CODEX <small>${Object.keys(p.logs).length}/${Object.keys(LOGS).length} LOGS</small></button>`);
    list.push(`<button class="mi" data-a="medals">MEDALS <small>${Object.keys(p.medals).length}/${MEDALS.length}</small></button>`);
    list.push('<button class="mi" data-a="settings">SETTINGS</button>');
    list.push('<button class="mi" data-a="controls">CONTROLS</button>');
    list.push('<button class="mi" data-a="fullscreen">FULLSCREEN</button>');
    this.$('m-titlelist').innerHTML = list.join('');
    const e = p.endless;
    const bosses = Object.values(p.bosses).filter((n) => n > 0).length, minis = Object.values(p.minis).filter((n) => n > 0).length;
    this.$('m-records').innerHTML = [
      p.deepest ? `DEEPEST <b>STRATUM ${ROMAN[p.deepest]}</b>` : 'THE DESCENT AWAITS',
      `BOSSES <b>${bosses}/30</b>`, `MINIBOSSES <b>${minis}/60</b>`,
      e.runs ? `ENDLESS BEST <b>${e.bestScore}</b> · ROOM <b>${e.bestRoom}</b>` : '',
      p.cyclesCleared ? `CYCLES <b>${p.cyclesCleared}</b>` : '',
    ].filter(Boolean).map((s) => `<span>${s}</span>`).join('');
  }
  updateRecords() { this.updateTitle(); }

  // ------------------------------------------------------------------ actions
  action(a, el) {
    const g = this.game;
    switch (a) {
      case 'continue': g.continueCampaign(); break;
      case 'newGame': g.newCampaign(); break;
      case 'ngplus': g.newCampaign(g.profile.v.cyclesCleared); break;
      case 'training': g.startTutorial(false); break;
      case 'levels': if (g.profile.v.deepest) { this.buildLevels(); this.push('levels'); } break;
      case 'playLevel': g.startPractice(el.dataset.id); break;
      case 'pickLevel': this.viewLevel(el.dataset.id); break;
      case 'endless': this.buildEndless(); this.push('endless'); break;
      case 'endlessRandom': g.startEndless((Math.random() * 1e9) >>> 0, false); break;
      case 'endlessDaily': g.startEndless(dailySeed(), true, dailyKey()); break;
      case 'endlessSeed': {
        const v = this.$('m-seed2').value.trim();
        if (!v) { this.$('m-seed2').focus(); break; }
        g.startEndless((/^\d+$/.test(v) ? parseInt(v, 10) >>> 0 : hash(v)) || 1, true);
        break;
      }
      case 'codex': this.buildCodex(); this.push('codex'); break;
      case 'codexTab': this.codexTab = el.dataset.t; this.buildCodex(); break;
      case 'codexItem': this.viewCodex(el.dataset.t, el.dataset.id); break;
      case 'medals': this.buildMedals(); this.push('medals'); break;
      case 'skin': g.setSkin(el.dataset.id); this.buildMedals(); break;
      case 'resume': g.resume(); break;
      case 'restart': g.restart(); break;
      case 'retryLevel': g.retryLevel(); break;
      case 'retryCheckpoint': g.retryCheckpoint(); break;
      case 'skipTraining': g.finishTutorial(true); break;
      case 'quit': g.quitToTitle(); break;
      case 'settings': this.push('settings'); break;
      case 'controls': this.push('controls'); break;
      case 'back': this.pop(); break;
      case 'fullscreen': g.toggleFullscreen(); break;
      case 'resetSettings': g.settings.reset(); this.buildSettings(); break;
      case 'skipReward': g.chooseReward(-1); break;
      case 'card': g.chooseReward(parseInt(el.dataset.i, 10)); break;
      case 'nextLevel': g.nextLevel(); break;
      case 'closeTerminal': g.closeTerminal(); break;
      case 'beginDescent': g.newCampaign(0, true); break;
      case 'skipCredits': this.endCredits(); break;
      case 'beginCycle': g.beginNextCycle(); break;
      default: break;
    }
  }

  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    this.current = name;
    this.stack = name ? [name] : [];
    if (name === 'title') this.updateTitle();
    if (name) { const s = this.screens[name]; if (s) s.scrollTop = 0; }
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
    if (prev === 'title') this.updateTitle();
  }

  // ------------------------------------------------------------------ settings
  buildSettings() {
    const list = this.$('m-settingslist');
    const s = this.game.settings;
    list.innerHTML = '';
    for (const spec of SETTINGS_SPEC) {
      if (spec.group) { const h = document.createElement('h3'); h.className = 'sec'; h.textContent = spec.group; list.appendChild(h); continue; }
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
        input.addEventListener('change', () => s.set(spec.k, spec.str ? input.value : parseInt(input.value, 10)));
        row.appendChild(input);
      }
      list.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ pause
  showPause(title, sub, statsHtml, mode, opts = {}) {
    this.px(this.$('m-pauseh'), title, 30);
    this.$('m-pausesub').textContent = sub || '';
    this.$('m-pausestats').innerHTML = statsHtml;
    const items = ['<button class="mi primary" data-a="resume">RESUME</button>'];
    if (mode === 'campaign' && opts.checkpoint) items.push(`<button class="mi" data-a="retryCheckpoint">RESTART FROM CHECKPOINT <small>ROOM ${String(opts.checkpoint).padStart(2, '0')}</small></button>`);
    if (mode === 'campaign') items.push('<button class="mi" data-a="retryLevel">RESTART LEVEL <small>FROM THE START</small></button>');
    if (mode === 'endless') items.push('<button class="mi" data-a="restart">RESTART RUN</button>');
    if (mode === 'tutorial') items.push('<button class="mi" data-a="skipTraining">SKIP TRAINING</button>');
    items.push('<button class="mi" data-a="settings">SETTINGS</button>', '<button class="mi" data-a="controls">CONTROLS</button>', '<button class="mi" data-a="fullscreen">FULLSCREEN</button>');
    items.push(`<button class="mi danger" data-a="quit">QUIT TO TITLE${mode === 'campaign' ? ` <small>PROGRESS SAVED AT ${opts.checkpoint ? 'CHECKPOINT' : 'LEVEL START'}</small>` : ''}</button>`);
    this.$('m-pauselist').innerHTML = items.join('');
    this.show('pause');
  }
  pauseStats(html) { this.$('m-pausestats').innerHTML = html; }

  // ------------------------------------------------------------------ rewards
  showReward(title, sub, cards) {
    this.px(this.$('m-rewardtitle'), title, 30, '#8ff4e4');
    this.$('m-rewardsub').textContent = sub;
    const wrap = this.$('m-cards');
    wrap.innerHTML = cards.map((c, i) => `
      <button class="card r-${c.rarity}${c.trade ? ' trade' : ''}" data-a="card" data-i="${i}" ${c.color ? `style="--wc:${c.color}"` : ''}>
        <div class="card-key">${i + 1}</div>
        <div class="card-rarity">${c.kind === 'weapon' ? 'NEW WEAPON' : c.rarity.toUpperCase()}${c.trade ? ' · TRADE-OFF' : ''}</div>
        <div class="card-name">${esc(c.name)}</div>
        <div class="card-desc">${esc(c.desc)}</div>
        ${c.max ? `<div class="card-stack">LEVEL ${c.stack} / ${c.max}</div>` : ''}
      </button>`).join('');
    wrap.querySelectorAll('.card').forEach((el, i) => {
      const c = cards[i];
      if (c.kind === 'weapon') { const ic = iconCanvas(c.id, ['#f2f2ee', '#666', c.color], 3); ic.classList.add('icon'); el.insertBefore(ic, el.children[1]); }
    });
    this.show('reward');
  }

  // ------------------------------------------------------------------ death
  showDeath(cause, tip, stats, mode, opts = {}) {
    this.$('m-cause').textContent = 'KILLED BY ' + (cause || 'THE MACHINE');
    this.$('m-tip').textContent = tip || '';
    this.$('m-deadsub').textContent = mode === 'campaign' ? (opts.checkpoint ? 'CHECKPOINT: ROOM ' + String(opts.checkpoint).padStart(2, '0') : 'CHECKPOINT: START OF LEVEL') : mode === 'endless' ? 'RUN OVER' : '';
    this.$('m-deadstats').innerHTML = stats.map(([k, v, best]) => `<div class="${best ? 'best' : ''}"><b>${esc(v)}</b>${esc(k)}${best ? ' · NEW BEST' : ''}</div>`).join('');
    const items = mode === 'campaign'
      ? (opts.checkpoint
        ? ['<button class="mi primary" data-a="retryCheckpoint">RETRY FROM CHECKPOINT</button>', '<button class="mi" data-a="retryLevel">RESTART LEVEL</button>', '<button class="mi" data-a="quit">TITLE</button>']
        : ['<button class="mi primary" data-a="retryLevel">RETRY LEVEL</button>', '<button class="mi" data-a="quit">TITLE</button>'])
      : mode === 'tutorial'
        ? ['<button class="mi primary" data-a="retryLevel">RETRY STATION</button>', '<button class="mi" data-a="quit">TITLE</button>']
        : ['<button class="mi primary" data-a="restart">RUN IT BACK</button>', '<button class="mi" data-a="quit">TITLE</button>'];
    this.$('m-deadlist').innerHTML = items.join('');
    this.show('dead');
  }

  // ------------------------------------------------------------------ results
  showResults(res, opts = {}) {
    this.px(this.$('m-resh'), res.code + '  ' + res.name, 30);
    this.$('m-ressub').textContent = res.stratum;
    const rk = this.$('m-rank');
    rk.textContent = '';
    const big = pixelTextCanvas(res.rank, { size: 40, color: RANK_COLOR[res.rank] || '#fff', ca: 2 });
    big.style.height = '120px'; big.style.width = 'auto';
    rk.appendChild(big);
    this.$('m-resrows').innerHTML = res.rows.map(([l, v, r]) => `<span class="l">${esc(l)}</span><span>${esc(v)}</span><span class="r" style="color:${RANK_COLOR[r] || '#888'}">${esc(r)}</span>`).join('');
    this.$('m-resnote').innerHTML = opts.note || '';
    this.$('m-reslist').innerHTML = `<button class="mi primary" data-a="nextLevel">${esc(opts.next || 'CONTINUE')}</button>` + (opts.practice ? '' : '<button class="mi" data-a="quit">SAVE &amp; QUIT</button>');
    this.show('results');
    // animate the rank reveal
    rk.style.opacity = '0';
    setTimeout(() => { rk.style.opacity = '1'; this.game.audio.play('rank', null, 1); }, 450);
  }

  // ------------------------------------------------------------------ terminal
  showTerminal(id) {
    const log = LOGS[id];
    if (!log) return;
    this.$('m-thead').textContent = 'GRID TERMINAL · ' + (log.author || 'UNKNOWN');
    this.$('m-tid').textContent = 'LOG ' + id;
    this.$('m-ttitle').textContent = log.title;
    const body = this.$('m-tbody');
    body.textContent = '';
    this.show('terminal');
    clearInterval(this.typeTimer);
    let i = 0;
    this.typeTimer = setInterval(() => {
      i += 2;
      body.textContent = log.text.slice(0, i);
      if (i % 6 === 0) this.game.audio.play('type', null, 0.2);
      if (i >= log.text.length) clearInterval(this.typeTimer);
    }, 16);
  }
  finishTerminal() { clearInterval(this.typeTimer); }

  // ------------------------------------------------------------------ codex
  buildCodex() {
    const g = this.game, p = g.profile.v;
    const tabs = [['logs', 'LOGS'], ['bosses', 'BOSSES'], ['minis', 'MINIBOSSES'], ['enemies', 'MACHINES'], ['weapons', 'ARSENAL'], ['strata', 'STRATA']];
    this.$('m-codextabs').innerHTML = tabs.map(([k, l]) => `<button class="tab${this.codexTab === k ? ' on' : ''}" data-a="codexTab" data-t="${k}">${l}</button>`).join('');
    const nLogs = Object.keys(p.logs).length, nB = Object.values(p.bosses).filter((n) => n > 0).length, nM = Object.values(p.minis).filter((n) => n > 0).length;
    this.$('m-codexprog').textContent = `${nLogs}/${Object.keys(LOGS).length} LOGS · ${nB}/30 BOSSES · ${nM}/60 MINIBOSSES`;
    const items = this.codexItems(this.codexTab);
    this.$('m-codexlist').innerHTML = items.map((it) => `<button class="cx-item${it.locked ? ' locked' : ''}" data-a="codexItem" data-t="${this.codexTab}" data-id="${esc(it.id)}">${esc(it.locked ? it.lockedLabel || '??????' : it.label)}</button>`).join('');
    const first = items.find((x) => !x.locked) || items[0];
    if (first) this.viewCodex(this.codexTab, first.id);
  }

  codexItems(tab) {
    const p = this.game.profile.v;
    if (tab === 'logs') return Object.entries(LOGS).map(([id, l]) => ({ id, label: id + '  ' + l.title, locked: !p.logs[id], lockedLabel: id + '  ??????' }));
    if (tab === 'bosses') return BOSSES.map((b) => ({ id: b.id, label: b.name, locked: p.bosses[b.id] === undefined }));
    if (tab === 'minis') return MINIBOSSES.map((m) => ({ id: m.id, label: m.name, locked: p.minis[m.id] === undefined, lockedLabel: 'STRATUM ' + ROMAN[m.stratum] + ' ??????' }));
    if (tab === 'enemies') return Object.keys(ENEMY_INFO).map((k) => ({ id: k, label: ENEMY_INFO[k].name }));
    if (tab === 'weapons') return WEAPON_ORDER.map((k) => ({ id: k, label: DEFS[k].full || DEFS[k].name }));
    return STRATA.map((s) => ({ id: String(s.n), label: ROMAN[s.n] + '  ' + s.name, locked: p.deepest < s.n }));
  }

  viewCodex(tab, id) {
    const p = this.game.profile.v;
    const v = this.$('m-codexview');
    this.$('m-codexlist').querySelectorAll('.cx-item').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    let h = '';
    if (tab === 'logs') {
      const l = LOGS[id];
      h = p.logs[id] ? `<h2>${esc(l.title)}</h2><div class="meta">LOG ${esc(id)} · ${esc(l.author)}</div><p>${esc(l.text)}</p>`
        : `<h2>${esc(scramble(l.title, 0, 1, 3))}</h2><div class="meta">LOG ${esc(id)} · NOT RECOVERED</div><p>${id.startsWith('N') ? 'Found only after the Architect falls once.' : id.startsWith('T') ? 'Found on the training deck.' : 'A terminal somewhere in level ' + esc(id) + ' holds this log.'}</p>`;
    } else if (tab === 'bosses') {
      const b = BOSSES.find((x) => x.id === id);
      const n = p.bosses[id];
      h = n === undefined ? '<h2>??????</h2><div class="meta">NOT YET ENCOUNTERED</div>'
        : `<h2 style="color:${b.uiColor || '#fff'}">${esc(b.name)}</h2><div class="meta">${esc(b.title)} · ${n > 0 ? 'DESTROYED x' + n : 'ENCOUNTERED'}</div><p>${esc(b.lore || '')}</p>${b.gimmick ? `<p class="meta">GIMMICK: ${esc(b.gimmick.toUpperCase())}</p>` : ''}${b.signatureName ? `<p class="meta">SIGNATURE: ${esc(b.signatureName)}</p>` : ''}`;
    } else if (tab === 'minis') {
      const m = MINIBOSSES.find((x) => x.id === id);
      const n = p.minis[id];
      h = n === undefined ? `<h2>??????</h2><div class="meta">NATIVE TO STRATUM ${ROMAN[m.stratum]}</div>`
        : `<h2 style="color:${hex(m.colors[2])}">${esc(m.name)}</h2><div class="meta">${esc(m.title)} · STRATUM ${ROMAN[m.stratum]} · ${n > 0 ? 'NEUTRALIZED x' + n : 'ENCOUNTERED'}</div><p>${esc(m.lore || '')}</p>`;
    } else if (tab === 'enemies') {
      h = `<h2>${esc(ENEMY_INFO[id].name)}</h2><div class="meta">${esc(ENEMY_INFO[id].desc)}</div><p>${esc(ENEMY_LORE[id] || '')}</p>`;
    } else if (tab === 'weapons') {
      const d = DEFS[id];
      h = `<h2 style="color:${d.color}">${esc(d.full || d.name)}</h2><div class="meta">${esc(d.desc || '')}</div>${d.altDesc ? `<p><b>ALT</b> ${esc(d.altDesc)}</p>` : ''}<p>${esc(WEAPON_LORE[id] || '')}</p>`;
    } else {
      const s = STRATA[parseInt(id, 10) - 1];
      const ranks = LEVELS.filter((l) => l.stratum === s.n).map((l) => `${l.id} ${esc(l.name)} <b style="color:${RANK_COLOR[p.ranks[l.id]] || '#555'}">${p.ranks[l.id] || '-'}</b>`).join('<br>');
      h = p.deepest < s.n ? `<h2>STRATUM ${ROMAN[s.n]}</h2><div class="meta">NOT YET REACHED</div>` : `<h2>${esc(s.name)}</h2><div class="meta">STRATUM ${ROMAN[s.n]}</div><p>${esc(s.lore)}</p><p>${ranks}</p>`;
    }
    v.innerHTML = h;
  }

  // ------------------------------------------------------------------ medals + skins
  buildMedals() {
    const g = this.game, p = g.profile.v;
    this.$('m-medalprog').textContent = Object.keys(p.medals).length + ' / ' + MEDALS.length;
    this.$('m-medallist').innerHTML = MEDALS.map(([id, name, desc]) => `<div class="medal${p.medals[id] ? ' got' : ''}"><b>${esc(name)}</b>${esc(desc)}</div>`).join('');
    this.$('m-skins').innerHTML = SKINS.map((s) => {
      const ok = g.profile.skinUnlocked(s);
      const req = s.req ? MEDALS.find((m) => m[0] === s.req) : null;
      return `<button class="tab${p.skin === s.id ? ' on' : ''}" ${ok ? `data-a="skin" data-id="${s.id}"` : 'disabled'} title="${req ? 'Unlocked by ' + esc(req[1]) : ''}">${esc(s.name)}${ok ? '' : ' · ' + esc(req ? req[1] : '')}</button>`;
    }).join('');
  }

  // ------------------------------------------------------------------ level select
  buildLevels() {
    const p = this.game.profile.v;
    const rows = [];
    for (const s of STRATA) {
      if (p.deepest < s.n) { rows.push(`<button class="cx-item locked">${ROMAN[s.n]} ??????</button>`); continue; }
      rows.push(`<div class="meta" style="color:var(--mint);font-size:16px;margin-top:6px">${ROMAN[s.n]} · ${esc(s.name)}</div>`);
      for (const l of LEVELS.filter((x) => x.stratum === s.n)) {
        const r = p.ranks[l.id];
        rows.push(`<button class="cx-item" data-a="pickLevel" data-id="${l.id}">${l.id} ${esc(l.name)} <span style="color:${RANK_COLOR[r] || '#555'}">${r || '-'}</span></button>`);
      }
    }
    if (p.cyclesCleared) rows.push(`<button class="cx-item" data-a="pickLevel" data-id="X">X THE ARCHITECT <span style="color:${RANK_COLOR[p.ranks.X] || '#555'}">${p.ranks.X || '-'}</span></button>`);
    this.$('m-levellist').innerHTML = rows.join('');
    this.$('m-levelview').innerHTML = '<p>Pick a level. Practice runs start with a loadout suited to the depth and do not affect your descent.</p>';
  }

  viewLevel(id) {
    const p = this.game.profile.v;
    const l = id === 'X' ? { id: 'X', name: 'THE ARCHITECT', desc: 'The final fight.', cond: 'none', stratum: 10 } : LEVELS.find((x) => x.id === id);
    const b = p.best[id] || {};
    const c = CONDITIONS[l.cond];
    this.$('m-levellist').querySelectorAll('.cx-item').forEach((el) => el.classList.toggle('on', el.dataset.id === id));
    this.$('m-levelview').innerHTML = `<h2>${esc(l.id + '  ' + l.name)}</h2><div class="meta">${c && c.name ? esc(c.name) + ' · ' : ''}BEST RANK <b style="color:${RANK_COLOR[p.ranks[id]] || '#888'}">${p.ranks[id] || '-'}</b>${b.score ? ' · BEST STYLE ' + b.score : ''}${b.time ? ' · BEST TIME ' + Math.floor(b.time / 60) + ':' + String(Math.floor(b.time % 60)).padStart(2, '0') : ''}</div><p>${esc(l.desc)}</p>${c && c.desc ? `<p>${esc(c.desc)}</p>` : ''}<div class="row-btns"><button class="btn primary" data-a="playLevel" data-id="${l.id}">PLAY</button></div>`;
  }

  // ------------------------------------------------------------------ endless
  buildEndless() {
    const e = this.game.profile.v.endless;
    const d = this.game.profile.v.daily[dailyKey()];
    this.$('m-endlessstats').innerHTML = e.runs ? `BEST SCORE <b>${e.bestScore}</b> · DEEPEST ROOM <b>${e.bestRoom}</b> · BOSSES <b>${e.bosses}</b> · RUNS <b>${e.runs}</b>` : 'The original mode: an endless chain of rooms, a boss every fifth door.';
    this.$('m-dailyinfo').textContent = dailyKey() + (d ? ' · BEST ' + d : '');
  }

  // ------------------------------------------------------------------ credits / NG+
  showCredits(cycle, onDone) {
    this.creditsDone = onDone;
    const roll = this.$('m-roll');
    roll.innerHTML = `
      <h2>VOLTGRAVE</h2><div class="r">${cycle ? 'CYCLE ' + ROMAN[cycle + 1] + ' COMPLETE' : 'THE BREAKER IS PULLED'}</div>
      <p>For eleven seconds the city was dark.</p>
      <h2>LINE-7</h2><div class="r">YOU</div>
      <h2>MARA VOSS</h2><div class="r">CHIEF ENGINEER · REMEMBERED</div>
      <h2>THE ARCHITECT</h2><div class="r">REBOOTING</div>
      <h2>THE THIRTY</h2><div>${BOSSES.map((b) => esc(b.name)).join(' · ')}</div>
      <h2>THE SIXTY</h2><div>${MINIBOSSES.map((m) => esc(m.name)).join(' · ')}</div>
      <h2>ELEVEN MILLION</h2><div class="r">THE CONNECTED · WE ARE LOUDER TOGETHER</div>
      <h2>MADE WITH</h2><div>three.js · Web Audio · a lot of PS1 nostalgia</div>
      <h2>THANK YOU FOR PLAYING</h2><div class="r">THE GRID REMEMBERS YOUR SHAPE</div>`;
    roll.style.animation = 'none';
    void roll.offsetHeight;
    roll.style.animation = '';
    this.show('credits');
    clearTimeout(this.creditsT);
    this.creditsT = setTimeout(() => this.endCredits(), 47000);
  }
  endCredits() {
    clearTimeout(this.creditsT);
    const cb = this.creditsDone;
    this.creditsDone = null;
    if (cb) cb();
  }

  showNgPlus(cycle) {
    this.px(this.$('m-ngh'), 'CYCLE ' + ROMAN[cycle + 1], 30, '#c060ff');
    this.$('m-ngtext').innerHTML = NG_TWIST.map((t) => '<p>' + esc(t) + '</p>').join('') + '<p>Your weapons and upgrades carry over.</p>';
    this.show('ngplus');
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function dailyKey() { const d = new Date(); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
export function dailySeed() { return hash('voltgrave-daily-' + dailyKey()); }
