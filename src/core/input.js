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
export class TouchControls {
  constructor(input, root, settings) {
    this.input = input;
    this.root = root;
    this.settings = settings;
    this.pointers = new Map(); // pointerId -> {role, x, y, ...}
    this.build();
    this.applyLayout();
    settings.onChange((k) => { if (k === 'leftHanded' || k === 'buttonScale' || k === 'touchOpacity' || k === '*') this.applyLayout(); });
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="tc-zone tc-move" data-role="move"></div>
      <div class="tc-zone tc-look" data-role="look"></div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <button class="tc-btn tc-fire" data-act="fire"><span>FIRE</span></button>
      <button class="tc-btn tc-jump" data-act="jump"><span>JUMP</span></button>
      <button class="tc-btn tc-dash" data-act="dash"><span>DASH</span></button>
      <button class="tc-btn tc-slide" data-act="slide"><span>SLIDE</span></button>
      <button class="tc-btn tc-punch" data-act="punch"><span>PARRY</span></button>
      <button class="tc-btn tc-reload" data-act="reload"><span>RLD</span></button>
      <button class="tc-btn tc-alt" data-act="alt"><span>ALT</span></button>
      <button class="tc-btn tc-hook" data-act="hook"><span>HOOK</span></button>
      <button class="tc-btn tc-swap" data-act="swap"><span>SWAP</span></button>
      <button class="tc-btn tc-use" data-act="use"><span>USE</span></button>
      <button class="tc-btn tc-pause" data-act="pause"><span>II</span></button>
      <button class="tc-btn tc-rush" data-act="rush"><span>RUSH</span></button>
      <button class="tc-btn tc-aim" data-act="aim"><span>AIM</span></button>
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
    if (role === 'look' && this.onLookTap) {
      const id = this.onLookTap(e.clientX, e.clientY);
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
