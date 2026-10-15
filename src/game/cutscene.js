import * as THREE from 'three';

// In-engine cutscenes: letterboxed camera shots, typewriter dialogue, name cards.
// The world is frozen while a cutscene plays (bosses keep idling). Every cutscene can be
// skipped by holding SPACE / fire, or holding a finger anywhere on touch screens; a tap
// or click finishes the current line early.

const ease = (t) => t * t * (3 - 2 * t);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Cutscene {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.letterbox = 0;
    this.line = null;
    this.skipHold = 0;
    this.steps = [];
    this.idx = 0;
    this.t = 0;
    this.pointerHeld = false;
    this.tapped = false;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    const down = () => { if (this.active) { this.pointerHeld = true; this.tapped = true; } };
    const up = () => { this.pointerHeld = false; };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => { if (this.active && (e.code === 'Enter' || e.code === 'KeyE')) this.tapped = true; });
  }

  play(steps, onDone, opts = {}) {
    const g = this.game;
    this.steps = steps.filter(Boolean);
    this.idx = -1;
    this.onDone = onDone;
    this.active = true;
    this.skippable = opts.skippable !== false;
    this.letterbox = 0;
    this.skipHold = 0;
    this.line = null;
    this.tapped = false;
    this.prevState = g.state;
    this.camPos.copy(g.camera.position);
    g.camera.getWorldDirection(this.tmpA);
    this.camLook.copy(g.camera.position).addScaledVector(this.tmpA, 10);
    this.fov = g.camera.fov;
    g.setState('cutscene');
    g.input.releaseAll();
    this.next();
  }

  next() {
    this.idx++;
    this.t = 0;
    const s = this.steps[this.idx];
    if (!s) { this.finish(false); return; }
    const g = this.game;
    if (s.fn) s.fn(g);
    if (s.sfx) g.audio.play(s.sfx, null, s.vol || 1);
    if (s.shake) g.addShake(s.shake);
    if (s.flash) g.flash(s.flash, 0.6);
    if (s.name) g.hud.nameCard(s.name.name, s.name.title, s.name.color, s.name.dur || 3);
    this.line = s.say ? { text: s.say.text, speaker: s.say.speaker || '', color: s.say.color, shown: 0 } : (s.keepLine ? this.line : null);
    // resolve camera endpoints now (functions allow following moving targets)
    const r = (v) => (typeof v === 'function' ? v(g) : v);
    this.shot = s.cam ? {
      from: s.cam.from ? r(s.cam.from).clone() : this.camPos.clone(),
      to: r(s.cam.to || s.cam.from).clone(),
      lookFrom: s.cam.lookFrom ? r(s.cam.lookFrom).clone() : (s.cam.look ? null : this.camLook.clone()),
      look: s.cam.look || null,
      lookTo: s.cam.lookTo ? r(s.cam.lookTo).clone() : null,
      fov: s.cam.fov || 70, roll: s.cam.roll || 0,
    } : null;
    const textT = s.say ? s.say.text.length / 42 + 1.5 : 0;
    this.dur = Math.max(s.dur || 0, textT, s.say || s.cam || s.name ? 0.4 : 0);
    this.typeAcc = 0;
  }

  finish(skipped) {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.line = null;
    this.letterbox = 0;
    // fire any remaining step side effects that must not be lost when skipping
    if (skipped) for (let i = this.idx + 1; i < this.steps.length; i++) if (this.steps[i].must) this.steps[i].fn(g);
    g.hud.nameCardS = null;
    g.camera.fov = g.settings.get('fov');
    g.camera.updateProjectionMatrix();
    const cb = this.onDone;
    this.onDone = null;
    if (g.state === 'cutscene') g.setState(this.prevState === 'cutscene' ? 'playing' : (this.prevState || 'playing'));
    g.last = performance.now();
    if (cb) cb(skipped);
    if (g.state === 'playing' && !g.input.usingTouch) g.input.requestLock();
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const s = this.steps[this.idx];
    this.t += dt;
    this.letterbox = Math.min(1, this.letterbox + dt * 3);
    // skip handling
    const held = g.input.isHeld('jump') || g.input.fire || this.pointerHeld;
    if (this.skippable && held) {
      this.skipHold += dt;
      if (this.skipHold > 0.6) { this.finish(true); return; }
    } else this.skipHold = Math.max(0, this.skipHold - dt * 2);
    // typewriter
    if (this.line && this.line.shown < this.line.text.length) {
      const before = Math.floor(this.line.shown);
      this.line.shown = Math.min(this.line.text.length, this.line.shown + dt * 42);
      if (Math.floor(this.line.shown) !== before && before % 3 === 0 && this.line.text[before] !== ' ') g.audio.play('type', null, 0.25);
    }
    if (this.tapped) {
      this.tapped = false;
      if (this.line && this.line.shown < this.line.text.length) this.line.shown = this.line.text.length;
      else if (this.t > 0.3 && s && !s.noAdvance) { this.next(); return; }
    }
    // camera
    const cam = g.camera;
    if (this.shot) {
      const k = ease(Math.min(1, this.t / Math.max(0.01, s.camDur || this.dur)));
      const sh = this.shot;
      this.camPos.lerpVectors(sh.from, sh.to, k);
      if (sh.look) this.camLook.copy(typeof sh.look === 'function' ? sh.look(g) : sh.look);
      else if (sh.lookTo) this.camLook.lerpVectors(sh.lookFrom, sh.lookTo, k);
      else if (sh.lookFrom) this.camLook.copy(sh.lookFrom);
      cam.fov += (sh.fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      if (sh.roll) cam.rotation.z += sh.roll;
    }
    if (this.t >= this.dur && !(s && s.hold)) this.next();
  }
}

// ---------------------------------------------------------------------------------------
// Script builders
// ---------------------------------------------------------------------------------------
function fwdOf(yaw) { return V(Math.sin(yaw), 0, Math.cos(yaw)); }

export function bossIntro(g, boss, def) {
  const c = boss.center().clone();
  const h = Math.max(3, boss.height || 4);
  const f = fwdOf(boss.yaw);
  const side = V(f.z, 0, -f.x);
  const room = boss.room;
  const lines = (def && def.intro) || [];
  const color = boss.info.color || '#ff3050';
  const steps = [];
  // 1. establishing shot: high and wide, slow push in
  const wideFrom = c.clone().addScaledVector(f, 18).addScaledVector(side, 9).setY(Math.min(room.spec.H - 1, h + 5));
  const wideTo = c.clone().addScaledVector(f, 13).addScaledVector(side, 5).setY(Math.min(room.spec.H - 1.5, h + 2.5));
  steps.push({ dur: 2.4, cam: { from: wideFrom, to: wideTo, look: c, fov: 62 }, sfx: 'sting', say: lines[0] ? { speaker: boss.info.name, text: stripName(lines[0], boss.info.name), color } : null });
  // 2. low-angle hero shot + name card
  const lowFrom = c.clone().addScaledVector(f, 7).addScaledVector(side, -2).setY(0.6);
  const lowTo = c.clone().addScaledVector(f, 5.5).addScaledVector(side, -1).setY(0.9);
  steps.push({ dur: 3.0, cam: { from: lowFrom, to: lowTo, lookFrom: c.clone().setY(c.y + h * 0.3), lookTo: c.clone().setY(c.y + h * 0.45), fov: 58 }, sfx: 'bossRoar', shake: 0.5, name: { name: boss.name, title: boss.title, color, dur: 3.2 } });
  // 3. narration over the player's shoulder
  if (lines[1]) {
    const pp = g.player.body.pos;
    const toBoss = c.clone().sub(pp).setY(0).normalize();
    const over = pp.clone().addScaledVector(toBoss, -2.2).add(V(toBoss.z * 0.8, 2.1, -toBoss.x * 0.8));
    steps.push({ dur: 2.6, cam: { from: over, to: over.clone().addScaledVector(toBoss, 0.8), look: c, fov: 66 }, say: { speaker: '', text: lines[1], color: '#9fb' } });
  }
  return steps;
}

export function miniIntro(g, minis) {
  const steps = [];
  minis.forEach((e, i) => {
    const c = e.centerPos().clone();
    const f = fwdOf(e.yaw);
    const side = V(f.z, 0, -f.x).multiplyScalar(i % 2 ? -1 : 1);
    const size = Math.max(1.5, e.height || 2);
    const from = c.clone().addScaledVector(f, 5 + size).addScaledVector(side, 2).setY(c.y + 0.4);
    const to = c.clone().addScaledVector(f, 3.4 + size * 0.6).addScaledVector(side, 1).setY(c.y + 0.2);
    steps.push({
      dur: 2.3, cam: { from, to, look: c, fov: 60 }, sfx: i === 0 ? 'miniSting' : null,
      name: { name: e.name, title: e.title, color: e.colorHex, dur: 2.3 },
      say: i === minis.length - 1 && e.def.lore ? { speaker: '', text: e.def.lore, color: '#9fb' } : null,
    });
  });
  return steps;
}

// Remove a leading 'NAME: ' and wrapping quotes from a scripted line.
function stripName(line, name) {
  let t = line;
  if (t.toUpperCase().startsWith(name.toUpperCase() + ':')) t = t.slice(name.length + 1).trim();
  return t.replace(/^"|"$/g, '');
}

export { V as vec3 };
