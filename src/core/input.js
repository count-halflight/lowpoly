// Unified input: keyboard + mouse (pointer lock) and independent multi-touch controls.
// Every touch is tracked by pointerId so movement, aiming and firing work simultaneously.

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', ControlLeft: 'slide', KeyC: 'slide', KeyF: 'punch', KeyV: 'punch',
  KeyR: 'reload', KeyQ: 'lastWeapon', KeyE: 'use', KeyG: 'hook', Escape: 'pause', KeyP: 'pause', Enter: 'confirm', KeyZ: 'zoom',
  KeyX: 'rush', KeyT: 'altKey',
};
const EDGE = new Set(['jump', 'dash', 'punch', 'reload', 'lastWeapon', 'pause', 'slideTap', 'confirm', 'use', 'hook', 'altTap', 'rush', 'zoom']);

export class Input {
  constructor(settings, canvas) {
    this.settings = settings;
    this.canvas = canvas;
    this.held = Object.create(null);
    this.pressed = Object.create(null);
    this.lookDX = 0; this.lookDY = 0;
    this.moveX = 0; this.moveY = 0; // analog from touch
    this.fire = false; this.firePressed = false;
    this.ads = false; // set by the weapons each frame: true while aiming down sights
    this.alt = false;
    // AIM: Z (or the right mouse button when 'rmbMode' is 'aim') held, or latched in toggle mode;
    // on touch the AIM button latches. Aiming and firing work at the same time.
    this.aimMouse = false; this.aimLatched = false; this.touchAim = false;
    this.slot = -1; this.wheel = 0;
    this.chipTap = null; // weapon id whose HUD chip was tapped this frame (re-tap cycles variants)
    this.locked = false;
    this.enabled = false; // gameplay input active
    this.usingTouch = false;
    this.touchSprint = false;
    this.onPauseRequest = null;
    this.onLockLost = null;
    this.wantLock = false;
    this.lockTime = 0;
    this.bindKeyboardMouse();
  }

  bindKeyboardMouse() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      const a = KEYMAP[e.code];
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.slot = n - 1;
      }
      if (a === 'altKey') { if (!this.held.altKey) this.pressed.altTap = true; this.alt = true; }
      if (a === 'zoom' && !this.held.zoom && this.settings.get('aimToggle')) this.aimLatched = !this.aimLatched;
      if (a) {
        if (!this.held[a] && EDGE.has(a)) this.pressed[a] = true;
        if (a === 'slide' && !this.held[a]) this.pressed.slideTap = true;
        this.held[a] = true;
        if (a !== 'pause' || this.enabled) e.preventDefault();
      }
      if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held[a] = false;
      if (a === 'altKey') this.alt = false;
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.usingTouch) return;
      if (!this.locked) { if (this.enabled) this.requestLock(); return; }
      const rmbAim = this.settings.get('rmbMode') === 'aim';
      if (e.button === 0) { this.fire = true; this.firePressed = true; }
      if (e.button === 2) {
        if (rmbAim) { this.aimMouse = true; if (this.settings.get('aimToggle')) this.aimLatched = !this.aimLatched; } else { this.alt = true; this.pressed.altTap = true; }
      }
      // middle button: alt-fire when the right button aims, otherwise the hook (like the side buttons)
      if (e.button === 1 && rmbAim) { this.alt = true; this.pressed.altTap = true; this.midAlt = true; }
      else if (e.button === 3 || e.button === 4 || e.button === 1) { this.pressed.hook = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) { this.alt = false; this.aimMouse = false; }
      if (e.button === 1 && this.midAlt) { this.alt = false; this.midAlt = false; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome can emit one bogus huge delta right after pointer lock engages; drop it
      if (performance.now() - this.lockTime < 120) return;
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      const dx = mx, dy = my;
      // aiming already slows the look through the narrower FOV; this only takes the edge off
      const s = 0.0022 * this.settings.get('mouseSens') * (this.ads ? this.settings.get('adsSens') : 1);
      this.lookDX += dx * s;
      this.lookDY += dy * s * (this.settings.get('invertY') ? -1 : 1);
    });
    window.addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked && !was) this.lockTime = performance.now();
      if (was && !this.locked) {
        this.releaseAll();
        if (this.onLockLost) this.onLockLost();
      }
    });
  }

  requestLock() {
    if (this.usingTouch) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    } catch { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  releaseAll() {
    for (const k in this.held) this.held[k] = false;
    this.fire = false; this.ads = false; this.alt = false;
    this.aimMouse = false; this.aimLatched = false; this.touchAim = false; this.midAlt = false;
    if (this.touch && this.touch.setAim) this.touch.setAim(false);
    this.moveX = 0; this.moveY = 0;
    this.touchSprint = false;
    if (this.touch) this.touch.reset();
  }

  // Called once per frame by the game after reading input.
  endFrame() {
    for (const k in this.pressed) this.pressed[k] = false;
    this.lookDX = 0; this.lookDY = 0;
    this.firePressed = false;
    this.slot = -1; this.wheel = 0;
    this.chipTap = null;
  }

  axis() {
    let x = this.moveX, y = this.moveY;
    if (this.held.right) x += 1;
    if (this.held.left) x -= 1;
    if (this.held.fwd) y += 1;
    if (this.held.back) y -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  // the player wants to aim down sights right now
  get aiming() {
    if (this.touchAim || this.aimLatched) return true;
    return !this.settings.get('aimToggle') && (!!this.held.zoom || this.aimMouse);
  }

  isHeld(a) { return !!this.held[a]; }
  wasPressed(a) { return !!this.pressed[a]; }
  press(a) { this.pressed[a] = true; }
}

// ---------------------------------------------------------------------------------------
// Touch controls
// ---------------------------------------------------------------------------------------
// Line icons (24x24, drawn with currentColor) so buttons read at a glance with a tiny label.
const ICON = {
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  jump: '<path d="M5 13l7-7 7 7M5 19l7-7 7 7"/>',
  dash: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
  slide: '<path d="M4 5l7 8h9M3 19h18"/>',
  punch: '<path d="M12 3l2.4 5.6 6 .6-4.6 4 1.4 6-5.2-3.2-5.2 3.2 1.4-6-4.6-4 6-.6z"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4"/>',
  alt: '<path d="M12 4l8 8-8 8-8-8z"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  hook: '<path d="M14 3v10a5 5 0 1 1-10 0v-1M14 3l4 3"/>',
  swap: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  use: '<path d="M4 12h11M11 7l5 5-5 5M20 4v16"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  rush: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  aim: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M7 12h10"/>',
};
const btn = (act, cls, label) => `<button class="tc-btn tc-${cls}" data-act="${act}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[cls]}</svg>${label ? `<span>${label}</span>` : ''}</button>`;

export class TouchControls {
  constructor(input, root, settings) {
    this.input = input;
    this.root = root;
    this.settings = settings;
    this.pointers = new Map(); // pointerId -> {role, x, y, ...}
    this.build();
    this.applyLayout();
    settings.onChange((k) => { if (k === 'leftHanded' || k === 'buttonScale' || k === 'touchOpacity' || k === 'touchLayout' || k === '*') this.applyLayout(); });
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="tc-zone tc-move" data-role="move"></div>
      <div class="tc-zone tc-look" data-role="look"></div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      ${btn('fire', 'fire', 'FIRE')}${btn('jump', 'jump', 'JUMP')}${btn('dash', 'dash', 'DASH')}${btn('slide', 'slide', 'SLIDE')}
      ${btn('punch', 'punch', 'PARRY')}${btn('alt', 'alt', 'ALT')}${btn('aim', 'aim', 'AIM')}
      ${btn('reload', 'reload', 'RLD')}${btn('swap', 'swap', 'SWAP')}${btn('hook', 'hook', 'HOOK')}${btn('use', 'use', 'USE')}
      ${btn('pause', 'pause', '')}${btn('rush', 'rush', 'RUSH')}
    `;
    this.aimBtn = r.querySelector('.tc-aim');
    this.stick = r.querySelector('.tc-stick');
    this.knob = r.querySelector('.tc-knob');
    const opts = { passive: false };
    r.querySelectorAll('[data-role],[data-act]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => this.down(e, el), opts);
      el.addEventListener('pointermove', (e) => this.move(e), opts);
      el.addEventListener('pointerup', (e) => this.up(e), opts);
      el.addEventListener('pointercancel', (e) => this.up(e), opts);
      el.addEventListener('lostpointercapture', (e) => this.up(e), opts);
    });
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  applyLayout() {
    this.root.classList.toggle('lefty', !!this.settings.get('leftHanded'));
    // minimal: no RLD / SWAP buttons (tap the ammo counter to reload, weapon icons to switch)
    this.root.classList.toggle('minimal', this.settings.get('touchLayout') === 'minimal');
    this.root.style.setProperty('--btn-scale', this.settings.get('buttonScale'));
    this.root.style.setProperty('--tc-alpha', this.settings.get('touchOpacity'));
  }

  down(e, el) {
    e.preventDefault();
    this.input.usingTouch = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const role = el.dataset.role || null;
    const act = el.dataset.act || null;
    const p = { role, act, el, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    this.pointers.set(e.pointerId, p);
    const inp = this.input;
    // HUD tap targets (weapon chips, ammo counter) sit in whichever zone the layout puts on the right
    if (role && this.onLookTap) {
      const id = this.onLookTap(e.clientX, e.clientY);
      if (id === 'reload') { inp.press('reload'); this.pointers.delete(e.pointerId); return; } // tapped the ammo counter
      if (id) { this.input.chipTap = id; this.pointers.delete(e.pointerId); return; }
    }
    if (role === 'move') {
      const rect = this.stick.getBoundingClientRect();
      p.cx = e.clientX; p.cy = e.clientY;
      this.stick.style.left = (e.clientX - rect.width / 2) + 'px';
      this.stick.style.top = (e.clientY - rect.height / 2) + 'px';
      this.stick.classList.add('active');
    }
    if (act) {
      el.classList.add('down');
      if (act === 'fire') { inp.fire = true; inp.firePressed = true; }
      else if (act === 'jump') { inp.press('jump'); inp.held.jump = true; }
      else if (act === 'dash') { inp.press('dash'); inp.touchSprint = true; }
      else if (act === 'slide') { inp.held.slide = true; inp.press('slideTap'); }
      else if (act === 'punch') inp.press('punch');
      else if (act === 'reload') inp.press('reload');
      else if (act === 'alt') { inp.alt = true; inp.press('altTap'); }
      else if (act === 'hook') inp.press('hook');
      else if (act === 'use') inp.press('use');
      else if (act === 'swap') inp.press('lastWeapon');
      else if (act === 'pause') inp.press('pause');
      else if (act === 'rush') inp.press('rush');
      else if (act === 'aim') this.setAim(!inp.touchAim);
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const inp = this.input;
    if (p.role === 'move') {
      const max = 60 * (this.settings.get('buttonScale') || 1);
      let ox = e.clientX - p.cx, oy = e.clientY - p.cy;
      const l = Math.hypot(ox, oy);
      if (l > max) { ox = ox / l * max; oy = oy / l * max; }
      this.knob.style.transform = `translate(${ox}px, ${oy}px)`;
      const nx = ox / max, ny = -oy / max;
      // small deadzone with rescale
      const m = Math.hypot(nx, ny);
      const dz = 0.12;
      const k = m < dz ? 0 : (m - dz) / (1 - dz) / m;
      inp.moveX = nx * k; inp.moveY = ny * k;
      inp.stickSprint = m > 0.95;
    } else if (p.role === 'look' || p.act === 'fire' || p.act === 'alt' || p.act === 'aim') {
      const s = 0.0055 * this.settings.get('touchSens') * (inp.ads ? this.settings.get('adsSens') : 1);
      inp.lookDX += dx * s;
      inp.lookDY += dy * s * (this.settings.get('invertY') ? -1 : 1);
    }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const inp = this.input;
    if (p.role === 'move') {
      inp.moveX = 0; inp.moveY = 0; inp.stickSprint = false;
      this.knob.style.transform = '';
      this.stick.classList.remove('active');
      this.stick.style.left = ''; this.stick.style.top = '';
    }
    if (p.act) {
      p.el.classList.remove('down');
      if (p.act === 'fire') {
        // only release fire if no other pointer is still holding fire
        let still = false;
        for (const q of this.pointers.values()) if (q.act === 'fire') still = true;
        if (!still) inp.fire = false;
      } else if (p.act === 'slide') inp.held.slide = false;
      else if (p.act === 'alt') inp.alt = false;
      else if (p.act === 'jump') inp.held.jump = false;
      else if (p.act === 'dash') inp.touchSprint = false;
    }
  }

  // AIM is a latch on touch so FIRE stays free for the other thumb
  setAim(on) {
    this.input.touchAim = on;
    if (this.aimBtn) this.aimBtn.classList.toggle('on', on);
  }

  // RUSH button only shows while the meter is full; toggled on change, not per frame
  setRushReady(on) {
    if (this.rushReady === on) return;
    this.rushReady = on;
    this.root.classList.toggle('rush-ready', on);
  }

  reset() {
    for (const p of this.pointers.values()) if (p.el) p.el.classList.remove('down');
    this.pointers.clear();
    this.knob.style.transform = '';
    this.stick.classList.remove('active');
  }
}
