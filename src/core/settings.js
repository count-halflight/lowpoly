// Persistent settings + records (localStorage, all access guarded).

const KEY = 'voltgrave.settings.v1';
const REC = 'voltgrave.records.v1';

export const isTouchDevice = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const DEFAULTS = {
  mouseSens: 1.0,
  touchSens: 1.0,
  invertY: false,
  fov: 90,
  resolution: isTouchDevice ? 300 : 400,
  jitter: true,
  shake: 1.0,
  reduceFlashes: false,
  master: 0.8,
  sfx: 0.9,
  music: 0.55,
  leftHanded: false,
  buttonScale: 1.0,
  aimAssist: true,
  showFps: false,
  hints: true,
  cutscenes: true,
  difficulty: 'normal',
  rmbMode: 'alt',      // right mouse button: 'alt' (alt-fire) or 'aim' (aim down sights; alt moves to T / middle mouse)
  aimToggle: false,    // AIM key/button latches instead of being held
  adsSens: 0.85,       // extra look sensitivity factor while aiming
  hudScale: 1.0,
  textFx: false,       // decorative glitch/scramble on HUD headlines
  touchOpacity: 0.75,
};

function load(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS, ...(load(KEY) || {}) };
    this.listeners = [];
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    this.values[k] = v;
    save(KEY, this.values);
    for (const l of this.listeners) l(k, v);
  }
  reset() {
    this.values = { ...DEFAULTS };
    save(KEY, this.values);
    for (const l of this.listeners) l('*', null);
  }
  onChange(fn) { this.listeners.push(fn); }
}

export class Records {
  constructor() {
    this.v = { bestScore: 0, bestRoom: 0, bossesKilled: 0, runs: 0, ...(load(REC) || {}) };
  }
  submit(run) {
    const newBest = run.score > this.v.bestScore;
    this.v.bestScore = Math.max(this.v.bestScore, run.score);
    this.v.bestRoom = Math.max(this.v.bestRoom, run.room);
    this.v.bossesKilled += run.bosses;
    this.v.runs += 1;
    save(REC, this.v);
    return newBest;
  }
}
