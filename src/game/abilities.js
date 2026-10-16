import * as THREE from 'three';
import { segPointDist2, moveBody, clamp } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { Construct, countOwned } from './constructs.js';

// Reusable, telegraphed attack modules shared by every boss and miniboss. Each module
// has a wind-up the player can read, an active part, and parameters that data entries
// tune (counts, speeds, damage). Modules return true from update() when finished and may
// define end() for cleanup when they finish or get interrupted. Long-lived hazards
// (fissures, meteors, gravity wells...) are handed to the HazardField so they keep going
// after the module returns, and die with their owner.

const V = () => new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const TAU = Math.PI * 2;
const tip = {
  fan: 'Fans have gaps: strafe between the orbs or dash through.',
  burst: 'A flickering laser means a burst is coming. Break line of sight.',
  spiral: 'Spirals rotate: move with the rotation and slip through the gaps.',
  ring: 'Low orb rings can be jumped. Look for the gap.',
  homing: 'Yellow seekers are slow and parryable. Punch them back.',
  mortar: 'Leave the red circles before they fill.',
  shockwave: 'Jump over expanding shockwave rings.',
  charge: 'A painted lane means a charge. Sidestep or dash out of it.',
  lunge: 'Lunges follow the painted lane. Dash sideways at the last moment.',
  sweep: 'A circle around the enemy means a spin. Jump it or dash out.',
  laser: 'Sweeping lasers sit at waist height: slide under or jump over.',
  snipe: 'Red laser = aiming, white flash = firing. Break line of sight.',
  mines: 'Mines detonate after their circles flash. Keep moving.',
  eruption: 'Eruptions chase your position. Never stand still on a circle.',
  pull: 'The vortex drags you in. Dash away from it.',
  flame: 'Flame cones are short range. Keep your distance.',
  rain: 'Glowing circles mark where debris falls.',
  leap: 'It lands on the circle. Get off it.',
  zap: 'Flashing floor zones electrify. Get out, or stay airborne.',
  spokes: 'Jump the rotating floor beams.',
  orbital: 'The orbital beam follows you with a delay. Keep moving.',
  bounce: 'Bouncing orbs rebound off walls. Watch the angles.',
  fissure: 'Fissures race along the glowing lines. Step off the line or jump the spikes.',
  beamgrid: 'Beam grids show faint lines first. Stand between them, and jump the low ones.',
  meteor: 'Meteors land on the orange circles. Keep moving between them.',
  gravity: 'Gravity wells drag you in, then collapse. Dash out before the flash.',
  missiles: 'Missiles climb, then dive at you. Keep moving, or punch them back.',
  tether: 'A tether latched on. DASH to snap it.',
  wallwave: 'Low walls can be jumped. Tall walls have a gap: get to it.',
  pattern: 'Bullet patterns always leave lanes. Read the shape and slip through.',
  blinkstrike: 'It reappears where the column flashes. Leave the circle.',
  quake: 'When the floor flashes red, stand in a green circle or get airborne.',
  rollers: 'Rolling hazards bounce off walls. Jump over them or dash through.',
  drones: 'Shield drones protect their owner. Shoot them down first.',
  decoys: 'Decoys flicker. The real one does not.',
  chain: 'Lightning arcs between the pylons. Shoot a pylon to break the circuit.',
  eggs: 'Egg sacs hatch into machines. Shoot them before they burst.',
  swarmdive: 'A red line marks each dive. Sidestep when the line locks.',
  burrow: 'It surfaces where the circle grows. Get off it.',
};
export const MODULE_TIPS = tip;

function aimAt(a, from) {
  const g = a.game;
  const t = g.camera.position.clone();
  t.y -= 0.4;
  const pv = g.player.body.vel;
  const dist = from.distanceTo(t);
  t.x += pv.x * dist * 0.012; t.z += pv.z * dist * 0.012;
  return t;
}

// owner is left null on purpose: a parried shot must be able to hit the actor that fired it
function shoot(a, from, dir, speed, dmg, opts = {}) {
  return a.game.projectiles.spawnEnemy(from, dir.clone().normalize().multiplyScalar(speed), dmg * a.dmgMul, {
    color: opts.color || a.color, radius: opts.radius || 0.24, size: opts.size || 0.24, owner: null,
    cause: a.name + (opts.what ? ' ' + opts.what : ''), tip: opts.tip, homing: opts.homing || 0, life: opts.life || 4, parryable: opts.parryable !== false,
    explode: opts.explode || 0, gravity: opts.gravity || 0, kind: opts.kind, bounces: opts.bounces || 0, trail: opts.trail,
  });
}

const FLD = (a) => a.game.bosses.field;
const roomOf = (a) => a.game.level.current;
function floorAt(a, x, z) { const r = a.game.level.current; return r ? r.floorAt(x, z) : 0; }
function hexOf(a) { return a.colorHex || (a.info && a.info.color) || '#' + (a.color || 0xffd060).toString(16).padStart(6, '0'); }
function hurt(a, amount, x, y, z, what, tipText) {
  return a.game.player.damage(amount * a.dmgMul, new THREE.Vector3(x, y, z), a.name + ' ' + what, tipText);
}
function bounds(a, m = 0.5) {
  const r = roomOf(a);
  if (!r) return { x0: a.pos.x - 20, x1: a.pos.x + 20, z0: a.pos.z - 20, z1: a.pos.z + 20, cx: a.pos.x, cz: a.pos.z, H: 10, r: null };
  return { x0: r.origin.x - r.W / 2 + m, x1: r.origin.x + r.W / 2 - m, z0: r.origin.z - r.D / 2 + m, z1: r.origin.z + r.D / 2 - m, cx: r.origin.x, cz: r.origin.z, H: r.spec.H, r };
}
function freeSpot(a, x, z, margin = 1.5) {
  const r = roomOf(a);
  if (!r) return true;
  if (!r.containsXZ(x, z, margin)) return false;
  return r.nav.free(r.nav.idx(x, z));
}
// clip the infinite line p + t*d to the room box; returns false when it misses
const _clip = { t0: 0, t1: 0 };
function clipLine(px, pz, dx, dz, b) {
  let t0 = -1e9, t1 = 1e9;
  if (Math.abs(dx) < 1e-6) { if (px < b.x0 || px > b.x1) return false; } else { let u = (b.x0 - px) / dx, v = (b.x1 - px) / dx; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
  if (Math.abs(dz) < 1e-6) { if (pz < b.z0 || pz > b.z1) return false; } else { let u = (b.z0 - pz) / dz, v = (b.z1 - pz) / dz; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); }
  _clip.t0 = t0; _clip.t1 = t1;
  return t1 > t0;
}
// player standing inside a horizontal band [y0, y1] (feet to head)
function playerBand(g, y0, y1) { const p = g.player.body; return p.pos.y < y1 && p.pos.y + p.h > y0; }
function wrapAng(d) { return Math.atan2(Math.sin(d), Math.cos(d)); }
function mixHex(c1, c2, k) { const a = new THREE.Color(c1), b = new THREE.Color(c2); return a.lerp(b, k).getHex(); }
function announce(a, text, big) { a.game.hud.toast(text, hexOf(a), !big); }

// ---------------------------------------------------------------------------------------
// HazardField: persistent hazards + immediate-mode instanced drawing. Hazards and modules
// call draw()/beam() every frame they want something visible; flush() uploads the batch
// once per frame. Nothing is created or destroyed at runtime, so nothing can leak.
// ---------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0), _fz = new THREE.Vector3(0, 0, 1), _bd = new THREE.Vector3();

export class HazardField {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.kinds = {};
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const lit = (tex, em) => psxify(new THREE.MeshLambertMaterial({ color: 0xffffff, map: getTexture(tex), emissive: new THREE.Color(em) }));
    const spike = new THREE.ConeGeometry(0.45, 1.6, 4); spike.translate(0, 0.8, 0);
    const wall = new THREE.BoxGeometry(1, 1, 1); wall.translate(0, 0.5, 0);
    const beam = new THREE.BoxGeometry(1, 1, 1); beam.translate(0, 0, 0.5);
    const disc = new THREE.CircleGeometry(1, 20); disc.rotateX(-Math.PI / 2);
    const ring = new THREE.RingGeometry(0.86, 1, 24, 1); ring.rotateX(-Math.PI / 2);
    const tile = new THREE.PlaneGeometry(1, 1); tile.rotateX(-Math.PI / 2);
    this.add('spike', spike, lit('panel', 0x302020), 160);
    this.add('rock', new THREE.IcosahedronGeometry(1, 0), lit('concrete', 0x2a1408), 40);
    this.add('ball', new THREE.DodecahedronGeometry(1, 0), lit('hazard', 0x201008), 24);
    this.add('shard', new THREE.OctahedronGeometry(1, 0), psxify(new THREE.MeshBasicMaterial({ color: 0xffffff })), 64);
    this.add('wall', wall, glow(), 48);
    this.add('beam', beam, glow(), 160);
    this.add('disc', disc, glow(), 96);
    this.add('ring', ring, glow(), 96);
    this.add('orb', new THREE.IcosahedronGeometry(1, 1), glow(), 48);
    this.add('tile', tile, glow(), 64);
  }
  add(name, geo, mat, cap) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    _c.setRGB(0, 0, 0);
    for (let i = 0; i < cap; i++) mesh.setColorAt(i, _c);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 2;
    this.game.scene.add(mesh);
    this.kinds[name] = { mesh, n: 0, cap };
  }
  push(h) { this.list.push(h); return h; }
  put(K, color, k) {
    K.mesh.setMatrixAt(K.n, _m);
    _c.setHex(color);
    if (k !== 1) _c.multiplyScalar(Math.max(0, k));
    K.mesh.setColorAt(K.n, _c);
    K.n++;
  }
  draw(kind, x, y, z, sx, sy, sz, ry, color, k = 1) {
    const K = this.kinds[kind];
    if (K.n >= K.cap) return;
    _q.setFromAxisAngle(_up, ry || 0);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.put(K, color, k);
  }
  drawQ(kind, x, y, z, q, sx, sy, sz, color, k = 1) {
    const K = this.kinds[kind];
    if (K.n >= K.cap) return;
    _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sz));
    this.put(K, color, k);
  }
  beam(ax, ay, az, bx, by, bz, w, color, k = 1) {
    const K = this.kinds.beam;
    if (K.n >= K.cap) return;
    _bd.set(bx - ax, by - ay, bz - az);
    const len = _bd.length();
    if (len < 1e-3) return;
    _bd.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_fz, _bd);
    _m.compose(_p.set(ax, ay, az), _q, _s.set(w, w, len));
    this.put(K, color, k);
  }
  disc(x, y, z, r, color, k = 1) { this.draw('disc', x, y + 0.04, z, r, 1, r, 0, color, k); }
  ring(x, y, z, r, color, k = 1) { this.draw('ring', x, y + 0.05, z, r, 1, r, 0, color, k); }
  // filling ground telegraph: frac 0..1
  tele(x, y, z, r, frac, color) {
    this.disc(x, y, z, r * (0.2 + 0.8 * frac), color, 0.22 + 0.4 * frac);
    this.ring(x, y, z, r, color, 0.55 + 0.45 * Math.sin(frac * 40));
  }
  update(dt) {
    const L = this.list;
    let dead = false;
    for (let i = 0; i < L.length; i++) {
      const h = L[i];
      if (h.dead) continue;
      let done = false;
      if (h.owner && h.bound !== false && !h.owner.alive) done = true;
      else {
        try { done = h.update(dt, this); } catch (e) { done = true; this.game.lastError = String(e && e.stack || e); }
      }
      if (done) { h.dead = true; dead = true; if (h.end) { try { h.end(); } catch (e) { /* cleanup is best effort */ } } }
    }
    if (dead) this.list = L.filter((h) => !h.dead);
    this.flush();
  }
  flush() {
    for (const k in this.kinds) {
      const K = this.kinds[k];
      K.mesh.count = K.n;
      K.mesh.visible = K.n > 0;
      if (K.n) { K.mesh.instanceMatrix.needsUpdate = true; K.mesh.instanceColor.needsUpdate = true; }
      K.n = 0;
    }
  }
  clear() {
    for (const h of this.list) if (!h.dead && h.end) { try { h.end(); } catch (e) { /* ignore */ } }
    this.list = [];
    for (const k in this.kinds) { const K = this.kinds[k]; K.n = 0; K.mesh.count = 0; K.mesh.visible = false; }
  }
  // drop hazards owned by one actor (on its death or a phase reset)
  clearOwner(owner) { for (const h of this.list) if (h.owner === owner && !h.dead) { h.dead = true; if (h.end) h.end(); } this.list = this.list.filter((h) => !h.dead); }
}

// ---------------------------------------------------------------------------------------
// hazard factories (live in the field)
// ---------------------------------------------------------------------------------------
function fissureWave(a, ox, oz, lanes, p) {
  const g = a.game, room = roomOf(a);
  const spikes = [];
  const col = mixHex(a.color, 0x909090, 0.35);
  let maxLen = 0;
  for (const l of lanes) maxLen = Math.max(maxLen, l.len);
  let front = 0.6, next = 1.4;
  return {
    owner: a,
    update(dt, F) {
      front += p.speed * dt;
      while (next <= front && next <= maxLen) {
        for (const l of lanes) {
          if (next > l.len) continue;
          const x = ox + l.dx * next, z = oz + l.dz * next;
          const y = room ? room.floorAt(x, z) : 0;
          spikes.push({ x, y, z, t: 0, s: 0.75 + Math.random() * 0.5, r: Math.random() * 6 });
          if (Math.random() < 0.6) g.fx.dust.spawn(x, y + 0.2, z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.35, 0.3, 0.28, 0.8, 0.35, 0.6, 6, 1);
        }
        next += 1.15;
      }
      const pp = g.player.body.pos;
      for (const l of lanes) {
        if (l.hit || front > l.len + 0.8) continue;
        const fx = ox + l.dx * Math.min(front, l.len), fz = oz + l.dz * Math.min(front, l.len);
        const fy = room ? room.floorAt(fx, fz) : 0;
        if (Math.hypot(pp.x - fx, pp.z - fz) < 1.25 && pp.y < fy + 1.15 && pp.y > fy - 1) {
          l.hit = true;
          if (hurt(a, p.dmg, fx, fy, fz, 'FISSURE', tip.fissure)) g.player.knock(l.dx * 5, 9, l.dz * 5);
        }
      }
      let alive = 0;
      for (const sp of spikes) {
        sp.t += dt;
        if (sp.t > 0.95) continue;
        alive++;
        const rise = sp.t < 0.12 ? sp.t / 0.12 : sp.t > 0.6 ? Math.max(0, 1 - (sp.t - 0.6) / 0.35) : 1;
        F.draw('spike', sp.x, sp.y - 1.4 * sp.s * (1 - rise), sp.z, sp.s, sp.s * (0.8 + 0.4 * rise), sp.s, sp.r, col, 1);
      }
      if (spikes.length > 40 && spikes[0].t > 0.95) { let k = 0; while (k < spikes.length && spikes[k].t > 0.95) k++; spikes.splice(0, k); }
      return front > maxLen + 1 && alive === 0;
    },
  };
}

function meteorFall(a, x, y, z, p, delay) {
  const g = a.game;
  const top = bounds(a).H - 0.4;
  const ang = Math.random() * TAU;
  const sx = x + Math.cos(ang) * 5, sz = z + Math.sin(ang) * 5;
  const spin = Math.random() * 6;
  let t = -delay, boomed = false;
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      if (t < 0) return false;
      if (!boomed) {
        const frac = Math.min(1, t / p.warn);
        F.tele(x, y, z, p.radius, frac, 0xff7a20);
        const fall = 0.5;
        if (t > p.warn - fall) {
          const k = (t - (p.warn - fall)) / fall;
          const mx = sx + (x - sx) * k, my = top + (y + 0.6 - top) * k, mz = sz + (z - sz) * k;
          F.draw('rock', mx, my, mz, 0.75, 0.75, 0.75, spin + t * 6, 0x8a5a3a, 1);
          F.draw('orb', mx, my, mz, 1.15, 1.15, 1.15, 0, 0xff6a10, 0.5);
          g.fx.sparks.spawn(mx, my, mz, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1, 0.5, 0.1, 1, 0.25, 0.4, 0, 1);
        }
        if (t >= p.warn) {
          boomed = true;
          const c = _a.set(x, y + 0.6, z);
          g.fx.explosion(c, p.radius, 0xff7a20);
          g.fx.chunks(c, 0x6a4a3a, 5, 7, 0.22);
          g.audio.play('explosion', c, 0.7);
          const pp = g.player.body.pos;
          const d = Math.hypot(pp.x - x, pp.z - z);
          if (d < 9) g.addShake(0.25 * (1 - d / 9));
          if (d < p.radius && pp.y < y + 2.4) { if (hurt(a, p.dmg, x, y, z, 'METEOR', tip.meteor)) g.player.knock((pp.x - x) / (d || 1) * 7, 6, (pp.z - z) / (d || 1) * 7); }
        }
        return false;
      }
      // smouldering crater
      const k = 1 - (t - p.warn) / 0.8;
      if (k <= 0) return true;
      F.disc(x, y, z, p.radius * 0.6, 0xff5010, 0.35 * k);
      return false;
    },
  };
}

function gravityWell(a, x, z, p, orbitAng) {
  const g = a.game;
  const b = bounds(a, 2);
  let t = 0, ang = orbitAng, acc = 0, boomed = false;
  const col = a.color;
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      if (p.orbit) { ang += dt * 0.45; x = b.cx + Math.cos(ang) * p.orbit; z = b.cz + Math.sin(ang) * p.orbit; }
      const y = floorAt(a, x, z) + 1.3;
      const live = t > 0.8;
      const end = 0.8 + p.dur;
      const pulse = t > end - 0.7 ? 0.5 + 0.5 * Math.sin(t * 40) : 1;
      // visuals: dark core, collapsing rings, inward sparks
      F.draw('shard', x, y, z, 0.7, 0.7, 0.7, t * 3, 0x1a0a2a, 1);
      F.draw('orb', x, y, z, 1.2 + Math.sin(t * 6) * 0.1, 1.2, 1.2, 0, col, 0.5 * pulse);
      for (let i = 0; i < 3; i++) { const rr = p.radius * (1 - ((t * 0.6 + i / 3) % 1)); F.ring(x, y - 1.25, z, rr, col, (live ? 0.45 : 0.2) * (rr / p.radius)); }
      F.ring(x, y - 1.25, z, p.coreR, 0xffffff, 0.6 * pulse);
      if (Math.random() < 0.5) { const aa = Math.random() * TAU, r = 2 + Math.random() * p.radius * 0.6; g.fx.sparks.spawn(x + Math.cos(aa) * r, y + (Math.random() - 0.5) * 2, z + Math.sin(aa) * r, -Math.cos(aa) * r * 1.4, 0, -Math.sin(aa) * r * 1.4, 0.6, 0.3, 1, 1, 0.1, 0.6, 0, 0); }
      if (!live) return false;
      const pp = g.player.body.pos, pv = g.player.body.vel;
      const dx = x - pp.x, dz = z - pp.z, d = Math.hypot(dx, dz) || 1;
      if (t < end && d < p.radius) {
        const f = p.strength * (0.35 + 0.65 * (1 - d / p.radius));
        pv.x += dx / d * f * dt * 3; pv.z += dz / d * f * dt * 3;
        if (d < p.coreR) { acc += dt; if (acc > 0.3) { acc = 0; hurt(a, p.dps * 0.3, x, y, z, 'SINGULARITY', tip.gravity); } }
      }
      if (t >= end && !boomed) {
        boomed = true;
        const c = _a.set(x, y, z);
        g.fx.explosion(c, p.boom, col);
        g.audio.play('explosion', c, 0.9);
        g.addShake(0.35);
        if (d < p.boom && pp.y < y + 2) { if (hurt(a, p.dmg, x, y, z, 'COLLAPSE', tip.gravity)) g.player.knock(-dx / d * 10, 6, -dz / d * 10); }
        return true;
      }
      return false;
    },
  };
}

function missileSalvo(a, list, p) {
  const g = a.game;
  return {
    owner: a,
    update(dt) {
      let live = 0;
      for (const m of list) {
        const pr = m.pr;
        if (m.gone || !pr.active || pr.friendly || pr.cause !== m.cause) { m.gone = true; continue; }
        live++;
        m.t += dt;
        if (!m.armed && m.t > p.rise) {
          m.armed = true;
          pr.homing = p.turn;
          const pp = g.player.body.pos;
          const dir = _d.set(pp.x - pr.pos.x, pp.y + 1 - pr.pos.y, pp.z - pr.pos.z).normalize();
          pr.vel.copy(dir).multiplyScalar(p.speed);
          g.audio.play('droneDive', pr.pos, 0.25);
        }
        if (m.armed && m.t > p.rise + p.track) pr.homing = 0; // stop steering: they become dodgeable lines
        if (Math.random() < 0.6) g.fx.dust.spawn(pr.pos.x, pr.pos.y, pr.pos.z, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, 0.45, 0.42, 0.4, 0.6, 0.28, 0.5, -0.3, 1);
      }
      return live === 0;
    },
  };
}

function wallSweep(a, w, p) {
  const g = a.game;
  let t = 0;
  const walls = [];
  for (let k = 0; k < p.n; k++) walls.push({ k, hit: false, done: false });
  const span = Math.abs(w.end - w.start);
  const col = a.color;
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      const pp = g.player.body.pos;
      const pc = w.axis === 'x' ? pp.x : pp.z, pperp = w.axis === 'x' ? pp.z : pp.x;
      let active = 0;
      for (const wl of walls) {
        const travel = t * p.speed - wl.k * p.spacing;
        if (travel > span + 0.5) { wl.done = true; continue; }
        active++;
        if (travel < 0) continue;
        const c = w.start + w.dir * travel;
        const segs = w.gapC == null ? [[w.p0, w.p1]] : [[w.p0, w.gapC - p.gap / 2], [w.gapC + p.gap / 2, w.p1]];
        for (const [s0, s1] of segs) {
          if (s1 - s0 < 0.1) continue;
          const mid = (s0 + s1) / 2, len = s1 - s0;
          const fl = Math.sin(t * 30 + wl.k) * 0.1;
          if (w.axis === 'x') { F.draw('wall', c, 0, mid, 0.35, w.h, len, 0, col, 0.55 + fl); F.draw('wall', c, w.h - 0.06, mid, 0.5, 0.12, len, 0, 0xffffff, 0.8); }
          else { F.draw('wall', mid, 0, c, len, w.h, 0.35, 0, col, 0.55 + fl); F.draw('wall', mid, w.h - 0.06, c, len, 0.12, 0.5, 0, 0xffffff, 0.8); }
        }
        if (Math.random() < 0.5) { const s = w.p0 + Math.random() * (w.p1 - w.p0); g.fx.sparks.spawn(w.axis === 'x' ? c : s, 0.2, w.axis === 'x' ? s : c, w.dir * 3 * (w.axis === 'x' ? 1 : 0), 3, w.dir * 3 * (w.axis === 'z' ? 1 : 0), 1, 0.8, 0.5, 1, 0.12, 0.3, 8, 0); }
        if (!wl.hit && Math.abs(pc - c) < 0.6 + p.speed * dt) {
          const inGap = w.gapC != null && Math.abs(pperp - w.gapC) < p.gap / 2 - 0.25;
          const over = pp.y > w.h - 0.05;
          if (!inGap && !over) {
            wl.hit = true;
            if (hurt(a, p.dmg, pp.x, pp.y, pp.z, w.gapC != null ? 'BULKHEAD' : 'WAVE WALL', tip.wallwave)) g.player.knock(w.axis === 'x' ? w.dir * 12 : 0, 5, w.axis === 'z' ? w.dir * 12 : 0);
          }
        }
      }
      return active === 0;
    },
  };
}

function rollerPack(a, balls, p) {
  const g = a.game;
  let t = 0;
  const col = mixHex(a.color, 0x8a6a40, 0.4);
  const ax = new THREE.Vector3(), q = new THREE.Quaternion();
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      const b = bounds(a, 0.6);
      const pp = g.player.body.pos;
      const fade = t > p.dur ? 1 - (t - p.dur) / 0.4 : 1;
      if (fade <= 0) { for (const r of balls) g.fx.sparksBurst(_a.set(r.x, r.y + r.r, r.z), col, 10, 6, 0.4); return true; }
      for (const r of balls) {
        r.cd -= dt;
        const sp = Math.hypot(r.vx, r.vz) || 1;
        // walls and pillars: ray along travel at ball centre height
        _a.set(r.x, r.y + r.r, r.z);
        _d.set(r.vx / sp, 0, r.vz / sp);
        const hit = g.combat.rayWorld(_a, _d, sp * dt + r.r, true);
        if (hit && Math.abs(hit.ny) < 0.5) {
          const dot = r.vx * hit.nx + r.vz * hit.nz;
          r.vx -= 2 * dot * hit.nx; r.vz -= 2 * dot * hit.nz;
          g.fx.sparksBurst(_a, 0xffd080, 6, 5, 0.25);
          if (r.cd < 0.5) g.audio.play('slam', _a, 0.35);
        }
        r.x += r.vx * dt; r.z += r.vz * dt;
        if (r.x < b.x0 + r.r) { r.x = b.x0 + r.r; r.vx = Math.abs(r.vx); }
        if (r.x > b.x1 - r.r) { r.x = b.x1 - r.r; r.vx = -Math.abs(r.vx); }
        if (r.z < b.z0 + r.r) { r.z = b.z0 + r.r; r.vz = Math.abs(r.vz); }
        if (r.z > b.z1 - r.r) { r.z = b.z1 - r.r; r.vz = -Math.abs(r.vz); }
        r.y = floorAt(a, r.x, r.z);
        r.roll += sp * dt / r.r;
        ax.set(r.vz, 0, -r.vx).normalize();
        q.setFromAxisAngle(ax, r.roll);
        const s = r.r * fade;
        F.drawQ('ball', r.x, r.y + r.r, r.z, q, s, s, s, col, 1);
        F.draw('orb', r.x, r.y + r.r, r.z, s * 1.25, s * 1.25, s * 1.25, 0, a.color, 0.3);
        if (Math.random() < 0.4) g.fx.dust.spawn(r.x, r.y + 0.1, r.z, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 0.3, 0.27, 0.25, 0.6, 0.3, 0.5, 2, 2);
        const d = Math.hypot(pp.x - r.x, pp.z - r.z);
        if (r.cd <= 0 && d < r.r + 0.45 && pp.y < r.y + r.r * 2 - 0.15) {
          r.cd = 0.9;
          if (hurt(a, p.dmg, r.x, r.y, r.z, 'ROLLER', tip.rollers)) g.player.knock(r.vx / sp * 9, 6, r.vz / sp * 9);
        }
      }
      return false;
    },
  };
}

function chainCircuit(a, pylons, p) {
  const g = a.game;
  let t = 0, cd = 0;
  const loop = pylons.length >= 3;
  const col = a.color;
  const seg = (ax, ay, az, bx, by, bz, F, live) => {
    if (!live) { F.beam(ax, ay, az, bx, by, bz, 0.05, col, 0.35 + 0.3 * Math.sin(t * 40)); return; }
    // three jittered segments read as an arc
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= 3; i++) {
      const k = i / 3;
      const j = i < 3 ? 0.45 : 0;
      const nx = ax + (bx - ax) * k + (Math.random() - 0.5) * j, ny = ay + (by - ay) * k + (Math.random() - 0.5) * j, nz = az + (bz - az) * k + (Math.random() - 0.5) * j;
      F.beam(px, py, pz, nx, ny, nz, 0.22, col, 0.9);
      F.beam(px, py, pz, nx, ny, nz, 0.08, 0xffffff, 1);
      px = nx; py = ny; pz = nz;
    }
  };
  return {
    owner: a,
    update(dt, F) {
      t += dt; cd -= dt;
      const live = t > p.warn;
      const pp = g.player.body;
      let links = 0;
      for (let i = 0; i < pylons.length; i++) {
        if (!loop && i === pylons.length - 1) break;
        const A = pylons[i], Bq = pylons[(i + 1) % pylons.length];
        if (!A.alive || !B_ok(Bq) || A.spawnT > 0 || Bq.spawnT > 0) continue;
        links++;
        const y = A.pos.y + p.height;
        seg(A.pos.x, y, A.pos.z, Bq.pos.x, Bq.pos.y + p.height, Bq.pos.z, F, live);
        if (live && cd <= 0 && segPointDist2(A.pos.x, 0, A.pos.z, Bq.pos.x, 0, Bq.pos.z, pp.pos.x, 0, pp.pos.z) < 0.5 * 0.5 && pp.pos.y < y + 0.5 && pp.pos.y + pp.h > y - 0.5) {
          cd = 0.6;
          hurt(a, p.dmg, pp.pos.x, y, pp.pos.z, 'ARC', tip.chain);
          g.audio.play('zap', null, 0.6);
        }
      }
      if (live && Math.random() < 0.15) g.audio.play('zap', pylons[0].pos, 0.25);
      if (t > p.warn + p.dur || (links === 0 && t > 1)) { for (const py of pylons) if (py.alive) py.expire(); return true; }
      return false;
    },
    end() { for (const py of pylons) if (py.alive) py.expire(true); },
  };
}
function B_ok(e) { return e && e.alive; }

function swarmPack(a, p) {
  const g = a.game;
  const n = p.n;
  const shards = [];
  const m = a.muzzle();
  for (let i = 0; i < n; i++) shards.push({ x: m.x + (Math.random() - 0.5), y: m.y + Math.random(), z: m.z + (Math.random() - 0.5), st: 'rise', t: 0, i, tx: 0, ty: 0, tz: 0 });
  let t = 0, nextDive = p.rise, order = 0;
  const col = a.color;
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      const pp = g.player.body.pos;
      const top = Math.min(bounds(a).H - 1.2, floorAt(a, pp.x, pp.z) + 7);
      if (t >= nextDive && order < n) {
        const s = shards[order++];
        s.st = 'aim'; s.t = 0;
        const room = roomOf(a);
        s.tx = pp.x + g.player.body.vel.x * 0.3; s.tz = pp.z + g.player.body.vel.z * 0.3;
        if (room) { s.tx = clamp(s.tx, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1); s.tz = clamp(s.tz, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1); }
        s.ty = floorAt(a, s.tx, s.tz);
        nextDive = t + p.gap;
        g.audio.play('sniperAim', _a.set(s.x, s.y, s.z), 0.4);
      }
      let live = 0;
      for (const s of shards) {
        if (s.st === 'done') continue;
        live++;
        s.t += dt;
        if (s.st === 'rise' || s.st === 'aim') {
          const ang = t * 0.9 + s.i / n * TAU;
          const hx = pp.x + Math.cos(ang) * 5.5, hz = pp.z + Math.sin(ang) * 5.5;
          const k = Math.min(1, dt * (s.st === 'aim' ? 1 : 3));
          s.x += (hx - s.x) * k; s.y += (top - s.y) * k; s.z += (hz - s.z) * k;
        }
        if (s.st === 'aim') {
          F.beam(s.x, s.y, s.z, s.tx, s.ty + 0.05, s.tz, 0.05 + s.t * 0.08, 0xff2030, 0.5 + 0.5 * Math.sin(s.t * 40));
          F.tele(s.tx, s.ty, s.tz, p.radius, Math.min(1, s.t / p.aim), 0xff2030);
          if (s.t >= p.aim) { s.st = 'dive'; s.t = 0; g.audio.play('droneDive', _a.set(s.x, s.y, s.z), 0.5); }
        } else if (s.st === 'dive') {
          const dx = s.tx - s.x, dy = s.ty + 0.3 - s.y, dz = s.tz - s.z, d = Math.hypot(dx, dy, dz);
          const step = p.speed * dt;
          if (d <= step) {
            s.st = 'done';
            const c = _a.set(s.tx, s.ty + 0.4, s.tz);
            g.fx.explosion(c, p.radius, col);
            g.audio.play('explosion', c, 0.5);
            const q = Math.hypot(pp.x - s.tx, pp.z - s.tz);
            if (q < p.radius && pp.y < s.ty + 2) hurt(a, p.dmg, s.tx, s.ty, s.tz, 'DIVE', tip.swarmdive);
            continue;
          }
          s.x += dx / d * step; s.y += dy / d * step; s.z += dz / d * step;
          F.beam(s.x, s.y, s.z, s.x - dx / d * 2, s.y - dy / d * 2, s.z - dz / d * 2, 0.15, col, 0.6);
        }
        F.draw('shard', s.x, s.y, s.z, 0.32, 0.6, 0.32, t * 5 + s.i, col, 1);
      }
      return live === 0;
    },
  };
}

// a delayed eruption column that leaves the floor dangerous for a moment (charge wakes)
function wakeColumn(a, x, z, delay, dmg) {
  const g = a.game;
  const y = floorAt(a, x, z);
  let t = 0, hit = false;
  return {
    owner: a,
    update(dt, F) {
      t += dt;
      if (t < delay) { F.tele(x, y, z, 1.4, t / delay, 0xff5010); return false; }
      if (!hit) {
        hit = true;
        g.fx.spawnColumn(x, y, z, 0xff6010, 0.5, 4);
        g.fx.sparksBurst(_a.set(x, y + 0.4, z), 0xff8030, 8, 7, 0.4);
        const pp = g.player.body.pos;
        if (Math.hypot(pp.x - x, pp.z - z) < 1.5 && pp.y < y + 2) hurt(a, dmg, x, y, z, 'MOLTEN WAKE', 'The charge leaves a burning trail. Stay off it until it cools.');
      }
      F.disc(x, y, z, 1.3, 0xff4010, Math.max(0, 0.5 - (t - delay)));
      return t > delay + 0.5;
    },
  };
}

// ---------------------------------------------------------------------------------------
export const MODULES = {
  fan: {
    def: { n: 5, spread: 0.14, speed: 20, volleys: 2, dmg: 10, wind: 0.5, gap: 0.35, range: [0, 60], cd: 2.5 },
    start(a, s, p) { s.v = p.volleys; s.next = p.wind; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.6); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 5);
      if (s.t < s.next) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      const to = aimAt(a, from);
      const base = Math.atan2(to.x - from.x, to.z - from.z);
      const flat = Math.hypot(to.x - from.x, to.z - from.z);
      const dy = (to.y - from.y) / Math.max(1, flat);
      const off = (s.v % 2) * p.spread * 0.5;
      for (let i = 0; i < p.n; i++) {
        const ang = base + (i - (p.n - 1) / 2) * p.spread + off;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang), dy, Math.cos(ang)), p.speed, p.dmg, { tip: tip.fan, what: 'FAN' });
      }
      a.game.audio.play('enemyShot', a.pos, 0.9);
      s.v--; s.next += p.gap;
      return s.v <= 0;
    },
  },
  burst: {
    def: { n: 5, speed: 36, dmg: 7, wind: 0.7, gap: 0.1, spread: 0.06, range: [0, 45], cd: 2.6 },
    start(a, s) { s.fired = 0; s.next = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.5); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 6);
      const from = a.muzzle();
      if (s.t < p.wind) { if (Math.random() < 0.7) a.game.fx.beam(from, a.game.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0)), 0xffe23a, 0.03, 0.05); return false; }
      a.anim.wind = false; a.anim.act = true;
      if (s.t - p.wind >= s.next) {
        const to = aimAt(a, from);
        const dir = to.sub(from).normalize();
        dir.x += (Math.random() - 0.5) * p.spread; dir.y += (Math.random() - 0.5) * p.spread * 0.5; dir.z += (Math.random() - 0.5) * p.spread;
        shoot(a, from.clone(), dir, p.speed, p.dmg, { color: 0xffe23a, radius: 0.14, size: 0.13, tip: tip.burst, what: 'BURST' });
        a.game.audio.play('enemyBurst', a.pos, 0.6);
        s.fired++; s.next += p.gap;
      }
      return s.fired >= p.n;
    },
  },
  spiral: {
    def: { arms: 3, dur: 3, rate: 0.14, speed: 11, dmg: 8, turn: 0.24, range: [0, 50], cd: 4 },
    start(a, s) { s.a = Math.random() * 6; s.next = 0.3; a.anim.wind = true; },
    update(a, s, p) {
      if (s.t < 0.3) return false;
      a.anim.wind = false; a.anim.act = true;
      while (s.t >= s.next) {
        s.next += p.rate;
        const c = a.center();
        const y = Math.min(c.y, a.groundY + 1.3);
        for (let k = 0; k < p.arms; k++) {
          const ang = s.a + (k / p.arms) * Math.PI * 2;
          shoot(a, new THREE.Vector3(c.x, y, c.z), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { tip: tip.spiral, trail: false, what: 'SPIRAL' });
        }
        s.a += p.turn;
      }
      return s.t > p.dur;
    },
  },
  ring: {
    def: { n: 16, speed: 12, dmg: 10, rings: 2, gap: 0.7, wind: 0.6, range: [0, 40], cd: 3.5 },
    start(a, s) { s.r = 0; s.next = 0; a.anim.wind = true; a.game.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, 2.5, a.color, 0.6); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false;
      if (s.t - p.wind >= s.next) {
        const c = a.center();
        const gapAt = Math.floor(Math.random() * p.n);
        const off = Math.random() * 6;
        for (let i = 0; i < p.n; i++) {
          if (i === gapAt || i === (gapAt + 1) % p.n) continue;
          const ang = off + (i / p.n) * Math.PI * 2;
          shoot(a, new THREE.Vector3(c.x, a.groundY + 0.6, c.z), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { tip: tip.ring, what: 'RING', trail: false });
        }
        a.game.audio.play('enemyShot', a.pos, 0.8);
        s.r++; s.next += p.gap;
      }
      return s.r >= p.rings;
    },
  },
  homing: {
    def: { n: 3, speed: 10, turn: 1.5, dmg: 14, wind: 0.6, range: [0, 60], cd: 4 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      for (let i = 0; i < p.n; i++) {
        const ang = a.yaw + (i - (p.n - 1) / 2) * 0.7;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang) * 0.8, 0.5, Math.cos(ang) * 0.8), p.speed, p.dmg, { color: 0xffe23a, radius: 0.3, size: 0.3, homing: p.turn, life: 6, tip: tip.homing, what: 'SEEKER' });
      }
      a.game.audio.play('radio', a.pos, 0.8);
      return true;
    },
  },
  mortar: {
    def: { n: 3, radius: 3, flight: 1.2, dmg: 22, scatter: 4, wind: 0.5, range: [6, 60], cd: 3.5 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const g = a.game;
      const pp = g.player.body.pos;
      const room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const tgt = new THREE.Vector3(pp.x + (i ? (Math.random() - 0.5) * p.scatter * 2 : g.player.body.vel.x * 0.5), 0, pp.z + (i ? (Math.random() - 0.5) * p.scatter * 2 : g.player.body.vel.z * 0.5));
        if (room) { tgt.x = clamp(tgt.x, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1); tgt.z = clamp(tgt.z, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1); }
        tgt.y = room ? room.floorAt(tgt.x, tgt.z) : 0;
        g.projectiles.spawnMortar(a.muzzle(), tgt, p.dmg * a.dmgMul, p.radius, p.flight + i * 0.12, { cause: a.name + ' MORTAR', color: a.color });
      }
      g.audio.play('launcher', a.pos, 0.8);
      return true;
    },
  },
  shockwave: {
    def: { rings: 1, maxR: 16, speed: 11, dmg: 20, wind: 0.8, gap: 0.5, range: [0, 14], cd: 3.5 },
    start(a, s) { s.r = 0; s.next = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.9); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      if (s.t - p.wind >= s.next) {
        a.game.enemies.shockwave(a.pos.clone().setY(a.groundY), p.maxR, p.speed * a.speedMul, p.dmg * a.dmgMul, a.color, a.name + ' SHOCKWAVE', tip.shockwave);
        a.game.audio.play('slam', a.pos, 1);
        a.game.addShake(0.3);
        a.game.fx.chunks(a.pos.clone().setY(a.groundY + 0.3), 0x6a6460, 5, 6, 0.18);
        s.r++; s.next += p.gap;
      }
      return s.r >= p.rings;
    },
  },
  charge: {
    def: { speed: 24, maxT: 2, dmg: 28, wind: 0.9, stun: 2.0, count: 1, wake: 0, range: [6, 60], cd: 4, ground: true },
    start(a, s) { s.mode = 'wind'; s.c = 0; s.wt = 0; s.trail = 0; a.anim.wind = true; a.game.audio.play('bossCharge', a.pos, 0.9); },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        s.wt += dt;
        if (s.wt < p.wind - 0.2) a.faceTarget(dt, 7);
        const o = a.pos.clone().setY(a.groundY + 0.06);
        g.fx.beam(o, o.clone().add(new THREE.Vector3(Math.sin(a.yaw) * 40, 0, Math.cos(a.yaw) * 40)), 0xff3020, a.radius * 1.6, 0.03, false);
        if (s.wt >= p.wind) { s.mode = 'go'; s.gt = 0; s.hit = false; a.anim.wind = false; a.anim.act = true; a.anim.moving = true; g.audio.play('lunge', a.pos, 1); }
        return false;
      }
      if (s.mode === 'go') {
        s.gt += dt;
        const v = p.speed * a.speedMul;
        const blocked = a.slide(Math.sin(a.yaw) * v * dt, Math.cos(a.yaw) * v * dt);
        if (p.wake) {
          s.trail += v * dt;
          if (s.trail > 2.2) { s.trail = 0; FLD(a).push(wakeColumn(a, a.pos.x - Math.sin(a.yaw) * 1.5, a.pos.z - Math.cos(a.yaw) * 1.5, 0.75, p.wake)); }
        }
        if (Math.random() < 0.6) g.fx.dust.spawn(a.pos.x, a.groundY + 0.2, a.pos.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.3, 0.25, 0.2, 0.6, 0.5, 0.6, 1, 2);
        const pp = g.player.body.pos;
        if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < a.radius + 1.0 && pp.y < a.groundY + a.height) {
          s.hit = true;
          if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' CHARGE', tip.charge)) g.player.knock(Math.sin(a.yaw) * 12, 6, Math.cos(a.yaw) * 12);
        }
        if (blocked || s.gt > p.maxT) {
          if (blocked) { g.addShake(0.45); g.audio.play('slam', a.pos, 1); g.fx.chunks(a.center(), 0x777777, 8, 7, 0.25); a.onWallImpact && a.onWallImpact(); }
          s.c++;
          a.anim.moving = false;
          if (blocked && s.c >= p.count) { a.stun(p.stun * (a.brokePillar ? 1.7 : 1)); a.brokePillar = false; return true; }
          if (s.c < p.count) { s.mode = 'wind'; s.wt = 0.3; a.anim.wind = true; return false; }
          return true;
        }
      }
      return false;
    },
  },
  lunge: {
    def: { speed: 22, dist: 12, dmg: 24, wind: 0.5, count: 1, range: [3, 16], cd: 2.8, ground: true },
    start(a, s) { s.mode = 'wind'; s.c = 0; s.wt = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8); },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        s.wt += dt;
        a.faceTarget(dt, 10);
        const o = a.pos.clone().setY(a.groundY + 0.06);
        g.fx.beam(o, o.clone().add(new THREE.Vector3(Math.sin(a.yaw) * p.dist, 0, Math.cos(a.yaw) * p.dist)), a.color, a.radius * 1.2, 0.03, false);
        if (s.wt >= p.wind) { s.mode = 'go'; s.gt = 0; s.hit = false; a.anim.wind = false; a.anim.act = true; g.audio.play('lunge', a.pos, 1); }
        return false;
      }
      s.gt += dt;
      const v = p.speed * a.speedMul;
      const blocked = a.slide(Math.sin(a.yaw) * v * dt, Math.cos(a.yaw) * v * dt);
      const pp = g.player.body.pos;
      if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < a.radius + 1.2 && pp.y < a.groundY + a.height) {
        s.hit = true;
        if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' LUNGE', tip.lunge)) g.player.knock(Math.sin(a.yaw) * 9, 4, Math.cos(a.yaw) * 9);
        g.audio.play('slash', a.pos, 1);
      }
      if (blocked) { a.stun(1.6); return true; }
      if (s.gt > p.dist / v) { s.c++; if (s.c < p.count) { s.mode = 'wind'; s.wt = 0.25; a.anim.wind = true; return false; } return true; }
      return false;
    },
  },
  sweep: {
    // spins > 1 chains expanding spins (each one bigger, with its own short telegraph)
    def: { radius: 4.5, dmg: 24, wind: 0.65, spins: 1, grow: 1.35, range: [0, 6], cd: 3, ground: true },
    start(a, s, p) { s.k = 0; s.t0 = 0; s.r = p.radius * Math.max(1, a.size * 0.8); a.anim.wind = true; a.game.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, s.r, a.color, p.wind); a.game.audio.play('windup', a.pos, 0.9); },
    update(a, s, p, dt) {
      const lt = s.t - s.t0;
      const wind = s.k ? 0.4 : p.wind;
      if (lt < wind) return false;
      a.anim.wind = false; a.anim.act = true;
      a.spin = (a.spin || 0) + dt * 18;
      const g = a.game;
      const pp = g.player.body.pos;
      const r = s.r;
      if (!s.hit && Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < r && pp.y < a.groundY + 1.15) {
        s.hit = true;
        if (g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' SWEEP', tip.sweep)) { const d = Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) || 1; g.player.knock((pp.x - a.pos.x) / d * 9, 4, (pp.z - a.pos.z) / d * 9); }
      }
      if (!s.snd) { s.snd = true; g.audio.play('slash', a.pos, 1); g.fx.ring(a.pos.x, a.groundY + 0.4, a.pos.z, r, a.color, 0.35, 0.6); }
      g.fx.sparksBurst(a.pos.clone().setY(a.groundY + 1), a.color, 2, 10, 0.2);
      if (lt > wind + 0.45) {
        s.k++;
        if (s.k < p.spins) {
          s.t0 = s.t; s.hit = false; s.snd = false; s.r *= p.grow;
          a.anim.wind = true; a.anim.act = false;
          g.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, s.r, a.color, 0.4);
          return false;
        }
        a.spin = 0; return true;
      }
      return false;
    },
    end(a) { a.spin = 0; },
  },
  laser: {
    def: { arc: 3.6, dur: 2, height: 1.0, dmg: 26, wind: 1.0, length: 40, dir: 0, range: [0, 60], cd: 6 },
    start(a, s, p) { s.dir = p.dir || (Math.random() < 0.5 ? 1 : -1); a.anim.wind = true; a.game.audio.play('laser', a.pos, 1); s.base = null; },
    update(a, s, p) {
      const g = a.game;
      const pp = g.player.body.pos;
      if (s.base === null) s.base = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z) - s.dir * p.arc / 2;
      const y = a.groundY + p.height;
      const from = new THREE.Vector3(a.pos.x, y, a.pos.z);
      const prog = s.t < p.wind ? 0 : Math.min(1, (s.t - p.wind) / p.dur);
      const ang = s.base + s.dir * p.arc * prog;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const w = g.combat.rayWorld(from, dir, p.length);
      const to = from.clone().addScaledVector(dir, w ? w.t : p.length);
      if (s.t < p.wind) { g.fx.beam(from, to, a.color, 0.03, 0.03, false); return false; }
      a.anim.wind = false; a.anim.act = true;
      g.fx.beam(from, to, a.color, 0.28, 0.03, false);
      g.fx.beam(from, to, 0xffffff, 0.1, 0.03, false);
      if (!s.hit && segPointDist2(from.x, y, from.z, to.x, y, to.z, pp.x, y, pp.z) < 0.25 && pp.y < y + 0.12 && pp.y + g.player.body.h > y - 0.1) {
        s.hit = true;
        g.player.damage(p.dmg * a.dmgMul, from, a.name + ' LASER', tip.laser);
      }
      return prog >= 1;
    },
  },
  snipe: {
    def: { aim: 1.4, lock: 0.35, dmg: 30, range: [8, 80], cd: 4 },
    start(a, s) { s.aim = a.muzzle().clone().add(new THREE.Vector3(Math.sin(a.yaw) * 5, -1, Math.cos(a.yaw) * 5)); a.anim.wind = true; },
    update(a, s, p, dt) {
      const g = a.game;
      const from = a.muzzle();
      const cam = g.camera.position;
      if (s.t < p.aim) s.aim.lerp(cam.clone().add(new THREE.Vector3(0, -0.3, 0)), Math.min(1, dt * 3));
      a.face(s.aim.x, s.aim.z, dt, 8);
      const dir = s.aim.clone().sub(from).normalize();
      const w = g.combat.rayWorld(from, dir, 200);
      const end = from.clone().addScaledVector(dir, w ? w.t : 200);
      if (s.t < p.aim) { g.fx.beam(from, end, 0xff2040, 0.025, 0.03, false); if (Math.random() < 0.1) g.audio.play('sniperAim', a.pos, 0.4); return false; }
      if (s.t < p.aim + p.lock) { if (!s.locked) { s.locked = true; g.audio.play('sniperLock', a.pos, 0.9); } g.fx.beam(from, end, Math.random() < 0.5 ? 0xffffff : 0xff2040, 0.07, 0.03, false); return false; }
      a.anim.wind = false; a.anim.act = true;
      g.fx.beam(from, end, 0xffffff, 0.14, 0.25);
      g.fx.beam(from, end, 0xff2040, 0.3, 0.35);
      g.audio.play('sniperFire', a.pos, 1);
      const pp = g.player.body.pos;
      if (segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 0.9, pp.z) < 0.36 || segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 1.5, pp.z) < 0.2) {
        g.player.damage(p.dmg * a.dmgMul, from, a.name + ' RAIL', tip.snipe);
      }
      if (w) g.fx.impact(end, new THREE.Vector3(w.nx, w.ny, w.nz), 'energy', 1.5);
      return true;
    },
  },
  summon: {
    def: { types: ['husk', 'ripper'], n: 3, wind: 0.8, range: [0, 80], cd: 12 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('backup', a.pos, 0.8); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false;
      a.game.director.spawnSummons(p.types, p.n, a.pos);
      a.game.hud.toast(a.name + ' CALLS REINFORCEMENTS', '#ff8a3a', true);
      return true;
    },
  },
  blink: {
    def: { wind: 0.55, range: [0, 80], cd: 5, then: true },
    start(a, s) {
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      let best = null;
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2, r = 9 + Math.random() * 6;
        const x = pp.x + Math.cos(ang) * r, z = pp.z + Math.sin(ang) * r;
        if (room && !room.containsXZ(x, z, 2.5)) continue;
        if (!a.flying && room && !room.nav.free(room.nav.idx(x, z))) continue;
        best = new THREE.Vector3(x, a.flying ? a.pos.y : (room ? room.floorAt(x, z) : 0), z); break;
      }
      s.to = best;
      if (best) a.game.fx.spawnColumn(best.x, best.y, best.z, a.color, 0.6, 5);
    },
    update(a, s, p) {
      if (!s.to) return true;
      if (s.t < p.wind) return false;
      a.game.fx.spawnColumn(a.pos.x, a.groundY, a.pos.z, a.color, 0.4, 5);
      a.teleport(s.to);
      a.game.audio.play('spawn', a.pos, 0.9);
      return true;
    },
  },
  barrier: {
    def: { hp: 220, dur: 7, range: [5, 60], cd: 12 },
    start() {},
    update(a, s, p) { a.game.bosses.makeBarrier(a.pos, p.hp * (a.hpScale || 1), p.dur); return true; },
  },
  mines: {
    def: { n: 5, delay: 1.6, radius: 2.6, dmg: 20, spreadR: 6, range: [0, 60], cd: 6 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p) {
      if (s.t < 0.3) return false;
      a.anim.wind = false;
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const x = pp.x + (Math.random() - 0.5) * p.spreadR * 2, z = pp.z + (Math.random() - 0.5) * p.spreadR * 2;
        if (room && !room.containsXZ(x, z, 0.5)) continue;
        const y = room ? room.floorAt(x, z) : 0;
        g.fx.telegraphDisc(x, y, z, p.radius, a.color, p.delay);
        g.enemies.delayed(p.delay, () => {
          if (!a.alive || room !== g.level.current) return;
          const c = new THREE.Vector3(x, y + 0.5, z);
          g.fx.explosion(c, p.radius, a.color);
          g.audio.play('explosion', c, 0.6);
          g.combat.radialDamage(c, p.radius, p.dmg * a.dmgMul, { source: 'explosion', friendly: true, cause: a.name + ' MINE', tip: tip.mines });
        });
      }
      g.audio.play('beep', a.pos, 0.8);
      return true;
    },
  },
  eruption: {
    def: { n: 4, interval: 0.45, radius: 2.0, dmg: 22, warn: 0.7, range: [0, 60], cd: 5 },
    start(a, s) { s.c = 0; s.next = 0; a.anim.wind = true; },
    update(a, s, p) {
      const g = a.game;
      if (s.t >= s.next && s.c < p.n) {
        const pp = g.player.body.pos;
        const room = g.level.current;
        const x = pp.x + g.player.body.vel.x * 0.25, z = pp.z + g.player.body.vel.z * 0.25;
        const y = room ? room.floorAt(x, z) : 0;
        g.fx.telegraphDisc(x, y, z, p.radius, 0xff6010, p.warn);
        g.enemies.delayed(p.warn, () => {
          if (!a.alive || room !== g.level.current) return;
          g.fx.spawnColumn(x, y, z, 0xff6010, 0.5, 6);
          g.fx.sparksBurst(new THREE.Vector3(x, y + 0.5, z), 0xff8030, 14, 9, 0.5);
          g.audio.play('slam', new THREE.Vector3(x, y, z), 0.6);
          const q = g.player.body.pos;
          if (Math.hypot(q.x - x, q.z - z) < p.radius && q.y < y + 2.5) g.player.damage(p.dmg * a.dmgMul, new THREE.Vector3(x, y, z), a.name + ' ERUPTION', tip.eruption);
        });
        s.c++; s.next += p.interval;
      }
      if (s.c >= p.n) a.anim.wind = false;
      return s.c >= p.n && s.t > s.next + p.warn;
    },
  },
  pull: {
    def: { dur: 2.2, strength: 9, dps: 14, range: [0, 30], cd: 7 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('laser', a.pos, 0.8); },
    update(a, s, p, dt) {
      const g = a.game;
      const pp = g.player.body.pos;
      const c = a.center();
      const dx = c.x - pp.x, dz = c.z - pp.z, d = Math.hypot(dx, dz) || 1;
      if (d < 26) { g.player.body.vel.x += dx / d * p.strength * dt * 4; g.player.body.vel.z += dz / d * p.strength * dt * 4; }
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
        g.fx.sparks.spawn(c.x + Math.cos(ang) * r, a.groundY + 0.5 + Math.random() * 2, c.z + Math.sin(ang) * r, -Math.cos(ang) * r * 1.5, 0, -Math.sin(ang) * r * 1.5, 0.7, 0.5, 1, 1, 0.12, 0.5, 0, 0);
      }
      if (d < a.radius + 1.6) { s.acc = (s.acc || 0) + dt; if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, c, a.name + ' VORTEX', tip.pull); } }
      if (s.t > p.dur) { a.anim.wind = false; return true; }
      return false;
    },
  },
  flame: {
    def: { dur: 1.6, range: [0, 12], speed: 14, cone: 0.35, dmg: 5, rate: 0.05, cd: 4 },
    start(a, s) { s.next = 0.35; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.6); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 2.5);
      if (s.t < 0.35) return false;
      a.anim.wind = false; a.anim.act = true;
      while (s.t >= s.next) {
        s.next += p.rate;
        const from = a.muzzle();
        const to = aimAt(a, from);
        const dir = to.sub(from).normalize();
        dir.x += (Math.random() - 0.5) * p.cone; dir.y += (Math.random() - 0.5) * p.cone * 0.4; dir.z += (Math.random() - 0.5) * p.cone;
        shoot(a, from.clone(), dir, p.speed, p.dmg, { color: 0xff7020, radius: 0.35, size: 0.2, life: 0.75, parryable: false, tip: tip.flame, what: 'FLAMES', trail: false });
      }
      if (Math.random() < 0.2) a.game.audio.play('sizzle', a.pos, 0.6);
      return s.t > p.dur;
    },
  },
  shield: {
    def: { dur: 7, every: 1.4, range: [0, 80], cd: 14 },
    start(a, s) { a.shieldUp = true; a.game.hud.toast(a.name + ' RAISES A SHIELD - PARRY ITS SEEKERS BACK', '#ffe23a', true); a.game.audio.play('shieldBreak', a.pos, 0.6); s.next = 0.6; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (!a.shieldUp) return true;
      if (s.t >= s.next) {
        s.next += p.every;
        const from = a.muzzle();
        const to = aimAt(a, from);
        shoot(a, from, to.sub(from), 9, 12, { color: 0xffe23a, radius: 0.32, size: 0.32, homing: 1.2, life: 6, tip: 'Shielded: punch the yellow seekers back to break the shield.', what: 'SEEKER' });
      }
      if (s.t > p.dur) { a.shieldUp = false; return true; }
      return false;
    },
    end(a) { if (a.gimmick !== 'parry') a.shieldUp = false; },
  },
  rain: {
    def: { n: 10, area: 7, dmg: 12, warn: 0.9, range: [0, 80], cd: 6 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.7); },
    update(a, s, p) {
      if (s.t < 0.4) return false;
      a.anim.wind = false;
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      for (let i = 0; i < p.n; i++) {
        const x = pp.x + (i === 0 ? 0 : (Math.random() - 0.5) * p.area * 2), z = pp.z + (i === 0 ? 0 : (Math.random() - 0.5) * p.area * 2);
        if (room && !room.containsXZ(x, z, 0.5)) continue;
        const y = room ? room.floorAt(x, z) : 0;
        const top = room ? room.spec.H - 0.5 : 10;
        const delay = p.warn + Math.random() * 0.6;
        g.fx.telegraphDisc(x, y, z, 1.2, a.color, delay);
        g.enemies.delayed(delay - (top - y) / 30, () => { if (a.alive && room === g.level.current) shoot(a, new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), 30, p.dmg, { radius: 0.4, size: 0.35, explode: 1.6, tip: tip.rain, what: 'DEBRIS', parryable: false }); });
      }
      return true;
    },
  },
  leap: {
    def: { flight: 0.95, dmg: 22, wind: 0.45, radius: 4, range: [6, 30], cd: 5, ground: true },
    start(a, s) { s.mode = 'wind'; a.anim.wind = true; },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.mode === 'wind') {
        a.faceTarget(dt, 8);
        if (s.t >= p.wind) {
          const pp = g.player.body.pos;
          s.from = a.pos.clone(); s.to = new THREE.Vector3(pp.x, 0, pp.z);
          const room = g.level.current;
          if (room) { s.to.x = clamp(s.to.x, room.origin.x - room.W / 2 + 2, room.origin.x + room.W / 2 - 2); s.to.z = clamp(s.to.z, room.origin.z - room.D / 2 + 2, room.origin.z + room.D / 2 - 2); s.to.y = room.floorAt(s.to.x, s.to.z); }
          g.fx.telegraphDisc(s.to.x, s.to.y, s.to.z, p.radius, a.color, p.flight);
          s.mode = 'air'; s.at = 0; a.anim.wind = false; a.anim.act = true;
          g.audio.play('jump', a.pos, 1);
        }
        return false;
      }
      s.at += dt;
      const k = Math.min(1, s.at / p.flight);
      a.pos.lerpVectors(s.from, s.to, k);
      a.pos.y = s.from.y + (s.to.y - s.from.y) * k + Math.sin(k * Math.PI) * 6;
      if (k >= 1) {
        a.pos.y = s.to.y;
        g.addShake(0.5);
        g.audio.play('slam', a.pos, 1);
        g.enemies.shockwave(a.pos.clone(), 10, 10, p.dmg * 0.8 * a.dmgMul, a.color, a.name + ' IMPACT', tip.leap);
        g.fx.chunks(a.pos.clone().setY(a.pos.y + 0.3), 0x6a6460, 6, 7, 0.2);
        const pp = g.player.body.pos;
        if (Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) < p.radius * 0.7 && pp.y < a.pos.y + 2) g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' LEAP', tip.leap);
        a.stun(0.8);
        return true;
      }
      return false;
    },
  },
  zap: {
    def: { dur: 2.4, warn: 1.0, dps: 28, size: 7, range: [0, 80], cd: 7 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos;
      s.cx = pp.x; s.cz = pp.z;
      const room = g.level.current;
      s.y = room ? room.floorAt(s.cx, s.cz) : 0;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) g.fx.telegraphDisc(s.cx + ox * p.size * 0.3, s.y, s.cz + oz * p.size * 0.3, p.size * 0.35, 0x40a0ff, p.warn);
      g.audio.play('zap', a.pos, 0.6);
    },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.t < p.warn) return false;
      if (Math.random() < 0.6) { const x = s.cx + (Math.random() - 0.5) * p.size, z = s.cz + (Math.random() - 0.5) * p.size; g.fx.tracer(new THREE.Vector3(x, s.y + 0.05, z), new THREE.Vector3(x + (Math.random() - 0.5), s.y + 0.6, z + (Math.random() - 0.5)), 0x80c0ff, 0.1); }
      const pp = g.player.body.pos;
      if (Math.abs(pp.x - s.cx) < p.size / 2 && Math.abs(pp.z - s.cz) < p.size / 2 && pp.y < s.y + 0.2) {
        s.acc = (s.acc || 0) + dt;
        if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, null, a.name + ' FLOOR SURGE', tip.zap); g.audio.play('zap', null, 0.4); }
      }
      return s.t > p.warn + p.dur;
    },
  },
  spokes: {
    def: { n: 3, speed: 0.6, dur: 5, dmg: 16, len: 18, range: [0, 80], cd: 9 },
    start(a, s) { s.ang = Math.random() * 6; s.cd = 0; },
    update(a, s, p, dt) {
      const g = a.game;
      const F = FLD(a);
      s.ang += dt * p.speed * a.speedMul * (s.t < 0.8 ? 0.2 : 1);
      s.cd -= dt;
      const pp = g.player.body.pos;
      const y = a.groundY + 0.4;
      for (let k = 0; k < p.n; k++) {
        const ang = s.ang + (k / p.n) * Math.PI * 2;
        const tx = a.pos.x + Math.sin(ang) * p.len, tz = a.pos.z + Math.cos(ang) * p.len;
        F.beam(a.pos.x, y, a.pos.z, tx, y, tz, s.t < 0.8 ? 0.06 : 0.2, s.t < 0.8 ? 0x803040 : 0xff3050, 1);
        if (s.t > 0.8) F.beam(a.pos.x, y, a.pos.z, tx, y, tz, 0.07, 0xffffff, 0.8);
        if (s.t > 0.8 && s.cd <= 0 && segPointDist2(a.pos.x, 0, a.pos.z, tx, 0, tz, pp.x, 0, pp.z) < 0.2 && pp.y < a.groundY + 0.55) {
          s.cd = 0.7;
          g.player.damage(p.dmg * a.dmgMul, a.pos, a.name + ' SPOKE', tip.spokes);
        }
      }
      return s.t > p.dur;
    },
  },
  orbital: {
    def: { dur: 3.5, speed: 4.5, radius: 1.4, dps: 30, range: [0, 80], cd: 8 },
    start(a, s) { const pp = a.game.player.body.pos; s.p = new THREE.Vector3(pp.x + 4, 0, pp.z + 4); a.game.audio.play('laser', a.pos, 0.9); },
    update(a, s, p, dt) {
      const g = a.game, pp = g.player.body.pos, room = g.level.current;
      const dx = pp.x - s.p.x, dz = pp.z - s.p.z, d = Math.hypot(dx, dz) || 1;
      const sp = Math.min(d, p.speed * dt);
      s.p.x += dx / d * sp; s.p.z += dz / d * sp;
      const y = room ? room.floorAt(s.p.x, s.p.z) : 0;
      const top = room ? room.spec.H : 12;
      const F = FLD(a);
      F.beam(s.p.x, top, s.p.z, s.p.x, y, s.p.z, s.t < 0.6 ? 0.15 : p.radius, s.t < 0.6 ? 0x802030 : 0xff2040, 0.9);
      if (s.t >= 0.6) F.beam(s.p.x, top, s.p.z, s.p.x, y, s.p.z, p.radius * 0.35, 0xffffff, 0.8);
      F.ring(s.p.x, y, s.p.z, p.radius * 1.3, 0xff2040, 0.6);
      if (s.t > 0.6 && d < p.radius * 0.8) { s.acc = (s.acc || 0) + dt; if (s.acc > 0.25) { s.acc = 0; g.player.damage(p.dps * 0.25 * a.dmgMul, s.p, a.name + ' ORBITAL', tip.orbital); } }
      if (Math.random() < 0.3) g.fx.sparks.spawn(s.p.x, y + 0.1, s.p.z, (Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4, 1, 0.3, 0.3, 1, 0.12, 0.4, 8, 0);
      return s.t > p.dur;
    },
  },
  bounce: {
    def: { n: 4, speed: 14, dmg: 12, bounces: 3, wind: 0.5, range: [0, 60], cd: 4 },
    start(a, s) { a.anim.wind = true; },
    update(a, s, p, dt) {
      a.faceTarget(dt, 5);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const from = a.muzzle();
      for (let i = 0; i < p.n; i++) {
        const ang = a.yaw + (i - (p.n - 1) / 2) * 0.5;
        shoot(a, from.clone(), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), p.speed, p.dmg, { color: 0x60ffd0, radius: 0.3, size: 0.3, bounces: p.bounces, life: 5, tip: tip.bounce, what: 'BOUNCER' });
      }
      a.game.audio.play('enemyShot', a.pos, 0.9);
      return true;
    },
  },

  // ===================================================================== new modules
  // Ground spikes racing out along painted lanes ('lanes' toward the player, 'star' all round).
  fissure: {
    def: { mode: 'lanes', n: 3, spread: 0.32, speed: 15, wind: 0.75, dmg: 20, len: 34, range: [0, 50], cd: 6 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos;
      a.anim.wind = true; g.audio.play('windup', a.pos, 0.8);
      s.ox = a.pos.x; s.oz = a.pos.z; s.oy = a.groundY;
      const base = p.mode === 'star' ? a.yaw : Math.atan2(pp.x - s.ox, pp.z - s.oz);
      s.lanes = [];
      _a.set(s.ox, s.oy + 0.7, s.oz);
      for (let k = 0; k < p.n; k++) {
        const ang = p.mode === 'star' ? base + (k / p.n) * TAU : base + (k - (p.n - 1) / 2) * p.spread;
        const dx = Math.sin(ang), dz = Math.cos(ang);
        const w = g.combat.rayWorld(_a, _d.set(dx, 0, dz), p.len, true);
        s.lanes.push({ dx, dz, len: Math.max(2, (w ? w.t : p.len) - 0.4), hit: false });
      }
    },
    update(a, s, p) {
      const F = FLD(a);
      if (s.t < p.wind) {
        const k = 0.4 + 0.35 * Math.sin(s.t * 30);
        for (const l of s.lanes) F.beam(s.ox, s.oy + 0.07, s.oz, s.ox + l.dx * l.len, s.oy + 0.07, s.oz + l.dz * l.len, 0.4, a.color, k);
        return false;
      }
      if (!s.go) {
        s.go = true; a.anim.wind = false; a.anim.act = true;
        a.game.audio.play('slam', a.pos, 0.9); a.game.addShake(0.3);
        F.push(fissureWave(a, s.ox, s.oz, s.lanes, p));
      }
      return s.t > p.wind + 0.35;
    },
  },
  // Lines of light across the arena. 'rotate': parallel low beams turning around the centre
  // (jump them). 'lattice': a static grid whose two halves alternate (stand in a cell).
  beamgrid: {
    def: { mode: 'rotate', n: 4, gap: 6, height: 0.5, turn: 0.32, dur: 5.5, wind: 1.1, dmg: 18, cycles: 3, range: [0, 90], cd: 11 },
    start(a, s) { const b = bounds(a, 0.3); s.b = b; s.ang = Math.random() * Math.PI; s.cd = 0; s.dir = Math.random() < 0.5 ? 1 : -1; a.anim.wind = true; a.game.audio.play('laser', a.pos, 0.9); },
    update(a, s, p, dt) {
      const g = a.game, F = FLD(a), b = s.b;
      const pp = g.player.body;
      s.cd -= dt;
      const live = s.t > p.wind;
      if (live) { a.anim.wind = false; a.anim.act = true; }
      const lines = [];
      if (p.mode === 'lattice') {
        const per = 1.6;
        const phase = Math.max(0, Math.floor((s.t - p.wind) / per));
        const set = live ? phase % 2 : 0;
        const nextSet = live ? (phase + 1) % 2 : 0;
        const inCycle = live ? (s.t - p.wind) % per : 0;
        for (let axis = 0; axis < 2; axis++) {
          const lo = axis ? b.z0 : b.x0, hi = axis ? b.z1 : b.x1;
          const c0 = (axis ? b.cz : b.cx);
          for (let i = -6; i <= 6; i++) {
            const c = c0 + i * p.gap + p.gap * 0.5;
            if (c <= lo + 0.5 || c >= hi - 0.5) continue;
            const grp = (i + axis + 100) % 2;
            const on = live && grp === set;
            const warn = !live || (grp === nextSet && inCycle > per - 0.8);
            lines.push({ axis, c, on, warn });
          }
        }
        const y0 = a.groundY;
        for (const l of lines) {
          const x0 = l.axis ? b.x0 : l.c, x1 = l.axis ? b.x1 : l.c, z0 = l.axis ? l.c : b.z0, z1 = l.axis ? l.c : b.z1;
          if (l.on) {
            F.draw('wall', (x0 + x1) / 2, y0, (z0 + z1) / 2, Math.max(0.2, x1 - x0), 2.6, Math.max(0.2, z1 - z0), 0, a.color, 0.35 + 0.1 * Math.sin(s.t * 40));
            F.beam(x0, y0 + 1.3, z0, x1, y0 + 1.3, z1, 0.1, 0xffffff, 0.8);
            const d = l.axis ? Math.abs(pp.pos.z - l.c) : Math.abs(pp.pos.x - l.c);
            if (s.cd <= 0 && d < 0.45 && pp.pos.y < y0 + 2.6) { s.cd = 0.5; hurt(a, p.dmg, pp.pos.x, pp.pos.y, pp.pos.z, 'GRID', tip.beamgrid); }
          } else if (l.warn) F.beam(x0, y0 + 0.06, z0, x1, y0 + 0.06, z1, 0.08, a.color, 0.4 + 0.3 * Math.sin(s.t * 30));
        }
        return s.t > p.wind + per * p.cycles * 2;
      }
      // rotate
      s.ang += dt * p.turn * s.dir * (live ? 1 : 0.25) * (a.speedMul || 1);
      const dx = Math.sin(s.ang), dz = Math.cos(s.ang), nx = dz, nz = -dx;
      const y = a.groundY + p.height;
      for (let k = 0; k < p.n; k++) {
        const o = (k - (p.n - 1) / 2) * p.gap;
        const px = b.cx + nx * o, pz = b.cz + nz * o;
        if (!clipLine(px, pz, dx, dz, b)) continue;
        const ax = px + dx * _clip.t0, az = pz + dz * _clip.t0, bx = px + dx * _clip.t1, bz = pz + dz * _clip.t1;
        if (!live) { F.beam(ax, y, az, bx, y, bz, 0.05, a.color, 0.4 + 0.3 * Math.sin(s.t * 30)); continue; }
        F.beam(ax, y, az, bx, y, bz, 0.26, a.color, 0.9);
        F.beam(ax, y, az, bx, y, bz, 0.09, 0xffffff, 1);
        if (s.cd <= 0 && segPointDist2(ax, 0, az, bx, 0, bz, pp.pos.x, 0, pp.pos.z) < 0.4 * 0.4 && playerBand(g, y - 0.15, y + 0.15)) {
          s.cd = 0.6;
          hurt(a, p.dmg, pp.pos.x, y, pp.pos.z, 'BEAM GRID', tip.beamgrid);
        }
      }
      return s.t > p.wind + p.dur;
    },
  },
  // Rocks fall from the ceiling onto telegraphed circles around the player.
  meteor: {
    def: { n: 8, dur: 2.4, radius: 2.4, dmg: 24, warn: 1.1, area: 8, range: [0, 90], cd: 9 },
    start(a, s) { s.c = 0; s.next = 0.25; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8); a.game.audio.play('bossCharge', a.pos, 0.4); },
    update(a, s, p) {
      const g = a.game;
      while (s.t >= s.next && s.c < p.n) {
        const pp = g.player.body.pos, pv = g.player.body.vel;
        let x = pp.x + (s.c === 0 ? pv.x * 0.5 : (Math.random() - 0.5) * p.area * 2), z = pp.z + (s.c === 0 ? pv.z * 0.5 : (Math.random() - 0.5) * p.area * 2);
        const b = bounds(a, 1);
        x = clamp(x, b.x0, b.x1); z = clamp(z, b.z0, b.z1);
        FLD(a).push(meteorFall(a, x, floorAt(a, x, z), z, p, 0));
        s.c++; s.next += p.dur / p.n;
        a.anim.act = true;
      }
      if (s.c >= p.n) a.anim.wind = false;
      return s.c >= p.n && s.t > s.next;
    },
  },
  // Singularities that drag the player in and then collapse. orbit > 0: they circle the arena.
  gravity: {
    def: { n: 1, dur: 4.5, radius: 11, strength: 9, coreR: 1.8, dps: 30, boom: 4, dmg: 24, orbit: 0, range: [0, 80], cd: 13 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos, b = bounds(a, 3);
      a.anim.wind = true; g.audio.play('laser', a.pos, 0.9); g.audio.play('emp', a.pos, 0.5);
      const base = Math.random() * TAU;
      for (let i = 0; i < p.n; i++) {
        let x, z;
        if (p.orbit) { const ang = base + i / p.n * TAU; x = b.cx + Math.cos(ang) * p.orbit; z = b.cz + Math.sin(ang) * p.orbit; FLD(a).push(gravityWell(a, x, z, p, ang)); continue; }
        // between actor and player, offset so it never spawns on top of the player
        const k = 0.5 + i * 0.2;
        x = a.pos.x + (pp.x - a.pos.x) * k + (Math.random() - 0.5) * 4; z = a.pos.z + (pp.z - a.pos.z) * k + (Math.random() - 0.5) * 4;
        if (Math.hypot(x - pp.x, z - pp.z) < p.coreR + 3) { const d = Math.hypot(x - pp.x, z - pp.z) || 1; x = pp.x + (x - pp.x) / d * (p.coreR + 3); z = pp.z + (z - pp.z) / d * (p.coreR + 3); }
        FLD(a).push(gravityWell(a, clamp(x, b.x0, b.x1), clamp(z, b.z0, b.z1), p, 0));
      }
    },
    update(a, s) { if (s.t > 0.8) { a.anim.wind = false; return true; } return false; },
  },
  // Missiles climb, then dive at the player and stop steering after a moment.
  missiles: {
    def: { n: 6, speed: 17, turn: 1.4, track: 1.4, dmg: 13, wind: 0.6, rise: 0.55, explode: 2.2, size: 0.28, color: 0xff5030, gap: 0.08, range: [0, 80], cd: 8 },
    start(a, s) { s.c = 0; s.next = 0; s.list = []; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.7); a.game.audio.play('sniperLock', a.pos, 0.4); },
    update(a, s, p, dt) {
      a.faceTarget(dt, 4);
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      const g = a.game;
      while (s.t - p.wind >= s.next && s.c < p.n) {
        const from = a.muzzle();
        const ang = a.yaw + (s.c - (p.n - 1) / 2) * (1.6 / Math.max(1, p.n - 1)) + (Math.random() - 0.5) * 0.2;
        const v = _d.set(Math.sin(ang) * 0.55, 1, Math.cos(ang) * 0.55);
        const pr = shoot(a, from, v, p.speed * 0.6, p.dmg, { color: p.color, radius: p.size, size: p.size, life: p.rise + p.track + 3, explode: p.explode, tip: tip.missiles, what: 'MISSILE', trail: true });
        s.list.push({ pr, t: 0, armed: false, cause: pr.cause });
        g.audio.play('launcher', a.pos, 0.35);
        s.c++; s.next += p.gap;
      }
      if (s.c >= p.n) { FLD(a).push(missileSalvo(a, s.list, p)); return true; }
      return false;
    },
  },
  // A hook that latches on and drags the player in ('pull') or reels the actor in ('reel').
  tether: {
    def: { mode: 'pull', wind: 0.75, speed: 34, dur: 2.4, strength: 15, dps: 12, dmg: 22, maxLen: 34, range: [4, 30], cd: 10 },
    start(a, s) { s.mode = 'aim'; s.acc = 0; a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8); },
    update(a, s, p, dt) {
      const g = a.game, F = FLD(a), pl = g.player;
      const pp = pl.body.pos;
      const m = a.muzzle();
      const chest = _b.set(pp.x, pp.y + pl.body.h * 0.55, pp.z);
      if (s.mode === 'aim') {
        a.faceTarget(dt, 8);
        F.beam(m.x, m.y, m.z, chest.x, chest.y, chest.z, 0.03, a.color, 0.4 + 0.4 * Math.sin(s.t * 40));
        if (s.t >= p.wind) {
          s.mode = 'fly'; s.head = m.clone(); s.dir = chest.clone().sub(m).normalize(); s.dist = 0;
          a.anim.wind = false; a.anim.act = true;
          g.audio.play('hook', a.pos, 1);
        }
        return false;
      }
      if (s.mode === 'fly') {
        const step = p.speed * dt;
        const w = g.combat.rayWorld(s.head, s.dir, step);
        s.head.addScaledVector(s.dir, w ? w.t : step);
        s.dist += step;
        F.beam(m.x, m.y, m.z, s.head.x, s.head.y, s.head.z, 0.08, a.color, 0.9);
        F.draw('shard', s.head.x, s.head.y, s.head.z, 0.3, 0.3, 0.3, s.t * 10, a.color, 1);
        if (s.head.distanceTo(chest) < 1.3 && pl.invuln <= 0 && pl.alive) {
          s.mode = 'latched'; s.lt = 0;
          g.audio.play('stick', pp, 1);
          if (!g.tetherTold) { g.tetherTold = true; g.hud.toast('TETHERED - DASH TO BREAK FREE', '#ffd060'); } else g.hud.toast('DASH TO BREAK', '#ffd060', true);
          return false;
        }
        return !!w || s.dist > p.maxLen;
      }
      // latched
      s.lt += dt;
      const jx = (Math.random() - 0.5) * 0.15, jy = (Math.random() - 0.5) * 0.15;
      F.beam(m.x, m.y, m.z, chest.x + jx, chest.y + jy, chest.z, 0.12, a.color, 1);
      F.beam(m.x, m.y, m.z, chest.x, chest.y, chest.z, 0.04, 0xffffff, 1);
      if (pl.dashT > 0 || !pl.alive) {
        g.fx.sparksBurst(chest, a.color, 16, 7, 0.4);
        g.audio.play('shieldBreak', pp, 0.8);
        g.style.add('TETHER SNAPPED', 30);
        a.stun(0.9);
        return true;
      }
      const dx = a.pos.x - pp.x, dz = a.pos.z - pp.z, d = Math.hypot(dx, dz) || 1;
      if (p.mode === 'reel') {
        // the actor rides the line into the player
        const v = 22 * dt;
        if (a.flying) { a.pos.x -= dx / d * v; a.pos.z -= dz / d * v; } else a.slide(-dx / d * v, -dz / d * v);
        if (d < (a.radius || 1) + 1.6) {
          if (hurt(a, p.dmg, a.pos.x, a.pos.y, a.pos.z, 'REEL STRIKE', tip.tether)) pl.knock(-dx / d * 10, 6, -dz / d * 10);
          g.audio.play('slash', a.pos, 1);
          g.fx.sparksBurst(chest, 0xffffff, 12, 8, 0.3);
          return true;
        }
      } else {
        pl.body.vel.x += dx / d * p.strength * dt * 3; pl.body.vel.z += dz / d * p.strength * dt * 3;
        s.acc += dt;
        if (s.acc > 0.4) { s.acc = 0; hurt(a, p.dps * 0.4, a.pos.x, a.pos.y, a.pos.z, 'TETHER', tip.tether); }
        if (d < (a.radius || 1) + 1.8) {
          if (hurt(a, p.dmg, a.pos.x, a.pos.y, a.pos.z, 'HOOK SLAM', tip.tether)) pl.knock(-dx / d * 12, 7, -dz / d * 12);
          g.audio.play('slam', a.pos, 0.9);
          return true;
        }
      }
      return s.lt > p.dur;
    },
  },
  // A wall of energy crossing the whole arena: low ones you jump, tall ones have a gap.
  wallwave: {
    def: { n: 1, gap: 0, speed: 9, wind: 1.0, height: 0.85, tall: 4.5, dmg: 22, spacing: 5, range: [0, 90], cd: 9 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos, b = bounds(a, 0.4);
      a.anim.wind = true; g.audio.play('windup', a.pos, 0.9);
      const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z;
      const axis = Math.abs(dx) / (b.x1 - b.x0) > Math.abs(dz) / (b.z1 - b.z0) ? 'x' : 'z';
      const dir = (axis === 'x' ? dx : dz) >= 0 ? 1 : -1;
      const lo = axis === 'x' ? b.x0 : b.z0, hi = axis === 'x' ? b.x1 : b.z1;
      const p0 = axis === 'x' ? b.z0 : b.x0, p1 = axis === 'x' ? b.z1 : b.x1;
      const w = { axis, dir, start: dir > 0 ? lo : hi, end: dir > 0 ? hi : lo, p0, p1, h: p.gap ? p.tall : p.height, gapC: null };
      // start just behind the actor so the wall rolls out of it toward the player
      const ac = axis === 'x' ? a.pos.x : a.pos.z;
      w.start = clamp(ac - dir * 2, lo, hi);
      if (p.gap) {
        const pperp = axis === 'x' ? pp.z : pp.x;
        w.gapC = clamp(pperp + (Math.random() - 0.5) * 12, p0 + p.gap / 2 + 0.5, p1 - p.gap / 2 - 0.5);
      }
      s.w = w;
    },
    update(a, s, p) {
      const F = FLD(a), w = s.w;
      if (s.t < p.wind) {
        const k = 0.3 + 0.3 * Math.sin(s.t * 30);
        if (w.axis === 'x') F.draw('wall', w.start, 0, (w.p0 + w.p1) / 2, 0.2, w.h, w.p1 - w.p0, 0, a.color, k);
        else F.draw('wall', (w.p0 + w.p1) / 2, 0, w.start, w.p1 - w.p0, w.h, 0.2, 0, a.color, k);
        if (w.gapC != null) {
          // the gap glows green so the player can run for it
          const gx = w.axis === 'x' ? w.start : w.gapC, gz = w.axis === 'x' ? w.gapC : w.start;
          F.beam(gx, 0, gz, gx, w.h + 1, gz, p.gap * 0.6, 0x40ff80, 0.35);
          const ex = w.axis === 'x' ? w.end : w.gapC, ez = w.axis === 'x' ? w.gapC : w.end;
          F.beam(gx, 0.08, gz, ex, 0.08, ez, p.gap * 0.8, 0x40ff80, 0.18);
        }
        return false;
      }
      if (!s.go) { s.go = true; a.anim.wind = false; a.anim.act = true; a.game.audio.play('slam', a.pos, 0.8); F.push(wallSweep(a, w, p)); }
      return s.t > p.wind + 0.3;
    },
  },
  // Bullet-hell shapes: flower, cross, wave, helix (counter-wound arms + lagging aimed shot),
// ledger (rows with a gap), implode (ring closing in).
  pattern: {
    def: { shape: 'flower', n: 22, speed: 10, dmg: 9, bursts: 3, gap: 0.5, dur: 2.8, wind: 0.6, petals: 5, range: [0, 70], cd: 8 },
    start(a, s, p) {
      s.k = 0; s.next = 0; s.rot = Math.random() * TAU; s.hole = Math.floor(Math.random() * Math.max(1, p.n - 3));
      a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8);
      a.game.fx.telegraphDisc(a.pos.x, a.groundY, a.pos.z, 3, a.color, p.wind);
      const pp = a.game.player.body.pos;
      s.aim = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z);
    },
    update(a, s, p, dt) {
      const g = a.game;
      if (s.t < p.wind) { a.faceTarget(dt, 4); return false; }
      a.anim.wind = false; a.anim.act = true;
      const c = a.center();
      const y = Math.min(c.y, a.groundY + 1.1);
      const o = (ang, sp, x = c.x, z = c.z, life = 4) => shoot(a, _a.set(x, y, z), _b.set(Math.sin(ang), 0, Math.cos(ang)), sp, p.dmg, { tip: tip.pattern, what: p.shape.toUpperCase(), trail: false, life, radius: 0.26, size: 0.26 });
      const lt = s.t - p.wind;
      if (p.shape === 'flower') {
        if (lt >= s.next && s.k < p.bursts) {
          for (let i = 0; i < p.n; i++) { const ang = s.rot + i / p.n * TAU; o(ang, p.speed * (0.55 + 0.45 * Math.abs(Math.cos(p.petals * (ang - s.rot) / 2)))); }
          s.rot += Math.PI / p.n * 1.5; s.k++; s.next += p.gap; g.audio.play('enemyShot', a.pos, 0.7);
        }
        return s.k >= p.bursts && lt > s.next;
      }
      if (p.shape === 'cross') {
        while (lt >= s.next) {
          s.next += 0.15;
          const turn = (lt < p.dur / 2 ? 1 : -1) * 0.07;
          s.rot += turn;
          for (let k = 0; k < 4; k++) o(s.rot + k * Math.PI / 2, p.speed, c.x, c.z, 3.2);
        }
        return lt > p.dur;
      }
      if (p.shape === 'wave') {
        while (lt >= s.next) {
          s.next += 0.07;
          const pp = g.player.body.pos;
          s.aim += clamp(wrapAng(Math.atan2(pp.x - c.x, pp.z - c.z) - s.aim), -0.02, 0.02);
          const w = Math.sin(lt * 5) * 0.55;
          o(s.aim + w, p.speed); o(s.aim + w + 0.9, p.speed * 0.85); o(s.aim + w - 0.9, p.speed * 0.85);
        }
        return lt > p.dur;
      }
      if (p.shape === 'helix') {
        // two arms wind one way, a slower arm winds back through them, and every third beat
        // a lagging aimed shot: weave through the crossings instead of circle-strafing
        while (lt >= s.next) {
          s.next += 0.12;
          s.rot += 0.24 * (p.dir || 1);
          const pp = g.player.body.pos;
          s.aim += clamp(wrapAng(Math.atan2(pp.x - c.x, pp.z - c.z) - s.aim), -0.05, 0.05);
          o(s.rot, p.speed, c.x, c.z, 3); o(s.rot + Math.PI, p.speed, c.x, c.z, 3);
          o(-s.rot * 0.7 + Math.PI / 2, p.speed * 0.8, c.x, c.z, 3);
          if (s.k++ % 3 === 0) { o(s.aim, p.speed * 1.15, c.x, c.z, 3); g.audio.play('enemyShot', a.pos, 0.4); }
        }
        return lt > p.dur;
      }
      if (p.shape === 'ledger') {
        if (lt >= s.next && s.k < p.bursts) {
          const pp = g.player.body.pos;
          const ang = Math.atan2(pp.x - c.x, pp.z - c.z);
          const ux = Math.sin(ang), uz = Math.cos(ang), nx = uz, nz = -ux;
          s.hole = clamp(s.hole + Math.floor(Math.random() * 5) - 2, 0, p.n - 3);
          const b = bounds(a, 0.6);
          for (let i = 0; i < p.n; i++) {
            if (i >= s.hole && i < s.hole + 3) continue;
            const off = (i - (p.n - 1) / 2) * 1.0;
            const x = c.x + nx * off, z = c.z + nz * off;
            if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
            shoot(a, _a.set(x, y, z), _b.set(ux, 0, uz), p.speed, p.dmg, { tip: tip.pattern, what: 'LEDGER', trail: false, life: 4, color: 0xffe23a, radius: 0.26, size: 0.26 });
          }
          s.k++; s.next += p.gap; g.audio.play('enemyShot', a.pos, 0.6);
        }
        return s.k >= p.bursts && lt > s.next;
      }
      if (p.shape === 'implode') {
        if (lt >= s.next && s.k < p.bursts) {
          const b = bounds(a, 0.8);
          const R = Math.min(p.radius || 15, (b.x1 - b.x0) / 2 + 4, (b.z1 - b.z0) / 2 + 4);
          const holeAt = Math.floor(Math.random() * p.n);
          for (let i = 0; i < p.n; i++) {
            if (Math.abs(i - holeAt) <= 1) continue;
            const ang = s.rot + i / p.n * TAU;
            const x = c.x + Math.sin(ang) * R, z = c.z + Math.cos(ang) * R;
            if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
            o(ang + Math.PI, p.speed, x, z, Math.max(0.5, (R - 1.5) / p.speed));
          }
          g.fx.ring(c.x, a.groundY + 0.1, c.z, R, a.color, 0.4, 1);
          s.rot += Math.PI / p.n; s.k++; s.next += p.gap; g.audio.play('enemyShot', a.pos, 0.6);
        }
        return s.k >= p.bursts && lt > s.next;
      }
      return true;
    },
  },
  // Teleport next to the player (column marks the spot), strike, repeat.
  blinkstrike: {
    def: { n: 3, wind: 0.6, radius: 3.4, dmg: 22, behind: 3.6, range: [0, 90], cd: 9 },
    start(a, s) { s.k = 0; s.mode = 'pick'; s.wt = 0; },
    update(a, s, p, dt) {
      const g = a.game, pl = g.player, pp = pl.body.pos;
      if (s.mode === 'pick') {
        const back = pl.yaw + Math.PI;
        s.to = null;
        for (let i = 0; i < 10; i++) {
          const ang = (i === 0 ? back : back + (Math.random() - 0.5) * 2.4) + (s.k % 2 ? 1.2 : -1.2) * (i ? 1 : 0.3);
          const x = pp.x - Math.sin(ang) * p.behind, z = pp.z - Math.cos(ang) * p.behind;
          if (!freeSpot(a, x, z, (a.radius || 1) + 0.5)) continue;
          s.to = new THREE.Vector3(x, a.flying ? a.pos.y : floorAt(a, x, z), z);
          break;
        }
        if (!s.to) return true;
        const fy = floorAt(a, s.to.x, s.to.z);
        g.fx.spawnColumn(s.to.x, fy, s.to.z, a.color, p.wind + 0.1, 6);
        if (!a.flying) g.fx.telegraphDisc(s.to.x, fy, s.to.z, p.radius, a.color, p.wind + 0.3);
        g.audio.play('glitch', s.to, 0.8);
        s.mode = 'wait'; s.wt = 0; a.anim.wind = true;
        return false;
      }
      s.wt += dt;
      if (s.mode === 'wait') {
        if (s.wt >= p.wind) {
          g.fx.spawnColumn(a.pos.x, a.groundY, a.pos.z, a.color, 0.4, 5);
          a.teleport(s.to);
          a.faceTarget(1, 50);
          g.audio.play('spawn', a.pos, 0.8);
          s.mode = 'strike'; s.wt = 0;
        }
        return false;
      }
      if (s.mode === 'strike') {
        a.faceTarget(dt, 6);
        if (s.wt >= 0.3 && !s.struck) {
          s.struck = true;
          a.anim.wind = false; a.anim.act = true;
          if (a.flying) {
            const from = a.muzzle(), to = aimAt(a, from);
            const base = Math.atan2(to.x - from.x, to.z - from.z), dy = (to.y - from.y) / Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
            for (let i = -2; i <= 2; i++) shoot(a, from.clone(), _d.set(Math.sin(base + i * 0.16), dy, Math.cos(base + i * 0.16)), 22, p.dmg * 0.5, { tip: tip.blinkstrike, what: 'AMBUSH' });
            g.audio.play('enemyShot', a.pos, 0.9);
          } else {
            g.audio.play('slash', a.pos, 1);
            g.fx.ring(a.pos.x, a.groundY + 0.5, a.pos.z, p.radius, a.color, 0.3, 0.5);
            g.fx.sparksBurst(_a.set(a.pos.x, a.groundY + 1, a.pos.z), a.color, 14, 9, 0.3);
            const d = Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z);
            if (d < p.radius && pp.y < a.groundY + 1.6) { if (hurt(a, p.dmg, a.pos.x, a.pos.y, a.pos.z, 'AMBUSH', tip.blinkstrike)) pl.knock((pp.x - a.pos.x) / (d || 1) * 9, 4, (pp.z - a.pos.z) / (d || 1) * 9); }
          }
        }
        if (s.wt >= 0.55) {
          s.k++; s.struck = false; a.anim.act = false;
          if (s.k >= p.n) return true;
          s.mode = 'pick';
        }
      }
      return false;
    },
  },
  // Arena-wide slam. 'zones': only the green circles (or high ground) are safe.
  // 'checker': the floor splits into tiles that blow in two alternating waves.
  quake: {
    def: { mode: 'zones', safe: 3, safeR: 2.6, warn: 1.7, dmg: 28, cell: 6, range: [0, 90], cd: 13 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos, b = bounds(a, 1.5);
      s.b = b; s.wave = 0; s.boomT = p.warn;
      a.anim.wind = true; g.audio.play('bossCharge', a.pos, 0.9); g.audio.play('alert', null, 0.6);
      if (p.mode === 'checker') { s.cells = []; const nx = Math.ceil((b.x1 - b.x0) / p.cell), nz = Math.ceil((b.z1 - b.z0) / p.cell); s.par = Math.random() < 0.5 ? 0 : 1; for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) s.cells.push({ x: b.x0 + (i + 0.5) * (b.x1 - b.x0) / nx, z: b.z0 + (j + 0.5) * (b.z1 - b.z0) / nz, w: (b.x1 - b.x0) / nx, d: (b.z1 - b.z0) / nz, par: (i + j) % 2 }); return; }
      s.zones = [];
      for (let tries = 0; tries < 80 && s.zones.length < p.safe; tries++) {
        // the first safe zone is always within reach of the player
        const near = s.zones.length === 0;
        const ang = Math.random() * TAU, r = near ? 4 + Math.random() * 4 : 5 + Math.random() * 14;
        const x = near ? pp.x + Math.cos(ang) * r : b.x0 + Math.random() * (b.x1 - b.x0), z = near ? pp.z + Math.sin(ang) * r : b.z0 + Math.random() * (b.z1 - b.z0);
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !freeSpot(a, x, z, 1.5)) continue;
        if (s.zones.some((q) => Math.hypot(q.x - x, q.z - z) < p.safeR * 3)) continue;
        if (Math.hypot(x - a.pos.x, z - a.pos.z) < (a.radius || 1) + p.safeR + 1) continue;
        s.zones.push({ x, z, y: floorAt(a, x, z) });
      }
    },
    update(a, s, p) {
      const g = a.game, F = FLD(a), b = s.b;
      const pp = g.player.body.pos;
      const base = floorAt(a, b.cx, b.cz);
      if (p.mode === 'checker') {
        const par = (s.par + s.wave) % 2;
        const frac = clamp(1 - (s.boomT - s.t) / (s.wave ? 1.0 : p.warn), 0, 1);
        for (const c of s.cells) {
          if (c.par !== par) continue;
          F.draw('tile', c.x, base + 0.05, c.z, c.w * 0.94, 1, c.d * 0.94, 0, 0xff2030, 0.15 + 0.35 * frac + 0.15 * Math.sin(s.t * 30));
        }
        if (s.t >= s.boomT) {
          g.audio.play('slam', a.pos, 1); g.addShake(0.5);
          for (const c of s.cells) {
            if (c.par !== par) continue;
            if (Math.random() < 0.5) g.fx.spawnColumn(c.x, base, c.z, 0xff3040, 0.45, 4);
            if (Math.abs(pp.x - c.x) < c.w / 2 && Math.abs(pp.z - c.z) < c.d / 2 && pp.y < base + 1.0) { if (hurt(a, p.dmg, c.x, base, c.z, 'JUDGEMENT', tip.quake)) g.player.knock(0, 8, 0); }
          }
          s.wave++;
          if (s.wave >= 2) { a.anim.wind = false; a.anim.act = true; return true; }
          s.boomT = s.t + 1.0;
        }
        return false;
      }
      if (s.t < p.warn) {
        const frac = s.t / p.warn;
        F.disc(b.cx, base, b.cz, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 2, 0xff2010, 0.08 + 0.12 * frac + 0.08 * Math.sin(s.t * 25));
        for (const z of s.zones) {
          F.disc(z.x, z.y + 0.02, z.z, p.safeR, 0x30ff70, 0.4);
          F.ring(z.x, z.y + 0.02, z.z, p.safeR, 0xa0ffc0, 0.8);
          F.beam(z.x, z.y, z.z, z.x, z.y + 7, z.z, p.safeR * 0.5, 0x30ff70, 0.18);
        }
        return false;
      }
      if (!s.boomed) {
        s.boomed = true;
        a.anim.wind = false; a.anim.act = true;
        g.audio.play('slam', a.pos, 1); g.audio.play('explosion', a.pos, 0.6);
        g.addShake(0.9); g.hitstop(0.05);
        g.fx.ring(a.pos.x, a.groundY + 0.1, a.pos.z, 26, a.color, 0.7, 0.05);
        g.fx.ring(b.cx, base + 0.1, b.cz, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2, 0xff3020, 0.5, 0.6);
        for (let i = 0; i < 14; i++) g.fx.dust.spawn(b.x0 + Math.random() * (b.x1 - b.x0), base + 0.2, b.z0 + Math.random() * (b.z1 - b.z0), 0, 2 + Math.random() * 2, 0, 0.4, 0.36, 0.3, 0.8, 0.6, 1, 4, 1);
        const safe = s.zones.some((z) => Math.hypot(pp.x - z.x, pp.z - z.z) < p.safeR) || pp.y > base + 1.0;
        if (!safe && hurt(a, p.dmg, a.pos.x, a.pos.y, a.pos.z, 'QUAKE', tip.quake)) g.player.knock(0, 9, 0);
      }
      return s.t > p.warn + 0.35;
    },
  },
  // Heavy balls that roll out and bounce around the arena for a few seconds.
  rollers: {
    def: { n: 3, speed: 10, r: 0.8, dur: 6, dmg: 22, wind: 0.8, spread: 0.55, range: [0, 70], cd: 10 },
    start(a, s, p) {
      a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.8);
      const pp = a.game.player.body.pos;
      s.base = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z);
    },
    update(a, s, p, dt) {
      const F = FLD(a);
      a.faceTarget(dt, 4);
      const R = (a.radius || 1) + p.r + 0.4;
      const pts = [];
      for (let i = 0; i < p.n; i++) {
        const ang = s.base + (i - (p.n - 1) / 2) * p.spread;
        pts.push({ ang, x: a.pos.x + Math.sin(ang) * R, z: a.pos.z + Math.cos(ang) * R });
      }
      if (s.t < p.wind) {
        const k = s.t / p.wind;
        for (const q of pts) {
          const y = floorAt(a, q.x, q.z);
          F.draw('ball', q.x, y + p.r * k, q.z, p.r * k, p.r * k, p.r * k, s.t * 3, mixHex(a.color, 0x8a6a40, 0.4), 1);
          F.beam(q.x, y + 0.06, q.z, q.x + Math.sin(q.ang) * 12, y + 0.06, q.z + Math.cos(q.ang) * 12, p.r * 1.6, a.color, 0.25 + 0.2 * Math.sin(s.t * 30));
        }
        return false;
      }
      a.anim.wind = false; a.anim.act = true;
      const balls = pts.map((q) => ({ x: q.x, z: q.z, y: floorAt(a, q.x, q.z), vx: Math.sin(q.ang) * p.speed, vz: Math.cos(q.ang) * p.speed, r: p.r, roll: 0, cd: 0 }));
      F.push(rollerPack(a, balls, p));
      a.game.audio.play('swing', a.pos, 0.9);
      return true;
    },
  },
  // Orbiting shield drones: the owner takes reduced damage until they are shot down.
  drones: {
    def: { n: 3, hp: 70, life: 14, radius: 2.4, wind: 0.8, fire: 3.2, dmg: 9, range: [0, 90], cd: 18 },
    start(a, s) {
      s.skip = countOwned(a.game, a, 'drone') > 0;
      if (s.skip) return;
      a.anim.wind = true; a.game.audio.play('radio', a.pos, 0.8);
    },
    update(a, s, p) {
      if (s.skip) return true;
      if (s.t < p.wind) return false;
      const g = a.game, c = a.center();
      for (let i = 0; i < p.n; i++) {
        const ang = i / p.n * TAU;
        const R = p.radius + (a.radius || 1);
        const d = new Construct(g, 'drone', new THREE.Vector3(c.x + Math.cos(ang) * R, c.y, c.z + Math.sin(ang) * R), a, { hp: p.hp, life: p.life, orbitR: R, ang, fire: p.fire, dmg: p.dmg, color: a.color, spin: 1.1 * (i % 2 ? 1 : 1) });
        g.enemies.list.push(d);
      }
      announce(a, 'SHIELD DRONES - SHOOT THEM DOWN', false);
      return true;
    },
  },
  // Blink among copies of itself. The copies flicker; the real one never does.
  decoys: {
    def: { n: 2, hp: 30, life: 9, wind: 0.75, fire: 2.4, dmg: 7, range: [0, 90], cd: 15 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos;
      s.skip = countOwned(g, a, 'decoy') > 0;
      if (s.skip) return;
      const base = Math.atan2(a.pos.x - pp.x, a.pos.z - pp.z);
      const R = clamp(Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z), 8, 14);
      s.spots = [];
      for (let k = 0; k <= p.n; k++) {
        for (let tries = 0; tries < 10; tries++) {
          const ang = base + (k - p.n / 2) * 1.0 + (Math.random() - 0.5) * 0.5;
          const x = pp.x + Math.sin(ang) * R, z = pp.z + Math.cos(ang) * R;
          if (!freeSpot(a, x, z, (a.radius || 1) + 1.2)) continue;
          if (s.spots.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
          s.spots.push(new THREE.Vector3(x, a.flying ? a.pos.y : floorAt(a, x, z), z));
          break;
        }
      }
      if (s.spots.length < 2) { s.skip = true; return; }
      a.anim.wind = true;
      for (const q of s.spots) g.fx.spawnColumn(q.x, floorAt(a, q.x, q.z), q.z, a.color, p.wind + 0.15, 6);
      g.audio.play('glitch', a.pos, 1);
    },
    update(a, s, p) {
      if (s.skip) return true;
      if (s.t < p.wind) return false;
      const g = a.game;
      const real = Math.floor(Math.random() * s.spots.length);
      g.fx.spawnColumn(a.pos.x, a.groundY, a.pos.z, a.color, 0.4, 5);
      a.teleport(s.spots[real]);
      const opts = { hp: p.hp, life: p.life, fire: p.fire, dmg: p.dmg, color: a.color, spawnT: 0.05 };
      if (a.decoyLook) Object.assign(opts, a.decoyLook);
      s.spots.forEach((q, i) => { if (i !== real) g.enemies.list.push(new Construct(g, 'decoy', q, a, opts)); });
      g.audio.play('spawn', a.pos, 0.9);
      announce(a, 'DECOYS - THE REAL ONE DOES NOT FLICKER', false);
      return true;
    },
  },
  // Pylons rise around the arena and lightning arcs between them. Shooting one opens a gap.
  chain: {
    def: { n: 4, hp: 90, radius: 9, warn: 1.3, dur: 5, dmg: 18, height: 1.2, range: [0, 90], cd: 15 },
    start(a, s, p) {
      const g = a.game, pp = g.player.body.pos, b = bounds(a, 2);
      s.skip = countOwned(g, a, 'pylon') > 0;
      if (s.skip) return;
      const R = Math.min(p.radius, (b.x1 - b.x0) / 2 - 1, (b.z1 - b.z0) / 2 - 1);
      const base = Math.random() * TAU;
      const pylons = [];
      for (let i = 0; i < p.n; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const ang = base + i / p.n * TAU + (tries ? (Math.random() - 0.5) * 0.6 : 0);
          const r = R * (tries ? 0.7 + Math.random() * 0.4 : 1);
          const x = b.cx + Math.cos(ang) * r, z = b.cz + Math.sin(ang) * r;
          if (!freeSpot(a, x, z, 1.2) || Math.hypot(x - pp.x, z - pp.z) < 2.5) continue;
          const py = new Construct(g, 'pylon', new THREE.Vector3(x, floorAt(a, x, z), z), a, { hp: p.hp, life: p.warn + p.dur + 2, color: a.color, spawnT: 0.6 });
          g.enemies.list.push(py); pylons.push(py);
          break;
        }
      }
      if (pylons.length < 2) { for (const py of pylons) py.expire(true); s.skip = true; return; }
      FLD(a).push(chainCircuit(a, pylons, p));
      a.anim.wind = true;
      g.audio.play('zap', a.pos, 0.9);
      announce(a, 'CIRCUIT - SHOOT A PYLON TO BREAK IT', false);
    },
    update(a, s) { if (s.t > 0.6 || s.skip) { a.anim.wind = false; return true; } return false; },
  },
  // Egg sacs that hatch into machines unless they are shot first.
  eggs: {
    def: { n: 3, hp: 55, hatch: 6, types: ['ripper'], wind: 0.6, range: [0, 90], cd: 16 },
    start(a, s) {
      s.skip = countOwned(a.game, a, 'egg') > 0;
      if (!s.skip) { a.anim.wind = true; a.game.audio.play('windup', a.pos, 0.6); }
    },
    update(a, s, p) {
      if (s.skip) return true;
      if (s.t < p.wind) return false;
      const g = a.game;
      const base = Math.random() * TAU;
      let made = 0;
      for (let i = 0; i < p.n * 3 && made < p.n; i++) {
        const ang = base + i * 2.1, r = (a.radius || 1) + 2 + Math.random() * 4;
        const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
        if (!freeSpot(a, x, z, 1)) continue;
        g.enemies.list.push(new Construct(g, 'egg', new THREE.Vector3(x, floorAt(a, x, z), z), a, { hp: p.hp, life: p.hatch, types: p.types, color: a.color, spawnT: 0.4 }));
        made++;
      }
      if (made) announce(a, 'EGG SACS - SHOOT THEM BEFORE THEY HATCH', false);
      return true;
    },
  },
  // Glowing shards rise over the player and dive one by one along locked red lines.
  swarmdive: {
    def: { n: 6, wind: 0.6, rise: 1.0, aim: 0.6, gap: 0.38, speed: 30, radius: 1.9, dmg: 16, range: [0, 90], cd: 10 },
    start(a, s) { a.anim.wind = true; a.game.audio.play('droneDive', a.pos, 0.7); },
    update(a, s, p) {
      if (s.t < p.wind) return false;
      a.anim.wind = false; a.anim.act = true;
      FLD(a).push(swarmPack(a, p));
      return true;
    },
  },
  // Sink into the floor, travel underneath, burst out under the player.
  burrow: {
    def: { dive: 0.6, under: 1.0, warn: 0.9, radius: 3.2, dmg: 28, ring: 12, range: [0, 90], cd: 11 },
    start(a, s) { s.mode = 'dive'; a.anim.wind = true; a.game.audio.play('droneDive', a.pos, 0.8); s.trail = a.pos.clone(); },
    update(a, s, p, dt) {
      const g = a.game, F = FLD(a), pp = g.player.body.pos;
      const depth = (a.height || 3) + 2;
      if (s.mode === 'dive') {
        a.sinkY = depth * Math.min(1, s.t / p.dive);
        if (Math.random() < 0.7) g.fx.dust.spawn(a.pos.x + (Math.random() - 0.5) * 2, a.groundY + 0.2, a.pos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3, 0.35, 0.3, 0.26, 0.8, 0.5, 0.8, 6, 1);
        if (s.t >= p.dive) { s.mode = 'under'; s.mt = 0; a.hidden = true; g.fx.chunks(_a.set(a.pos.x, a.groundY + 0.3, a.pos.z), 0x5a5048, 8, 7, 0.22); g.audio.play('slam', a.pos, 0.6); }
        return false;
      }
      s.mt += dt;
      if (s.mode === 'under') {
        // a mole track crawls toward the player
        const dx = pp.x - s.trail.x, dz = pp.z - s.trail.z, d = Math.hypot(dx, dz) || 1;
        const v = Math.min(d, 16 * dt);
        s.trail.x += dx / d * v; s.trail.z += dz / d * v;
        const fy = floorAt(a, s.trail.x, s.trail.z);
        g.fx.dust.spawn(s.trail.x, fy + 0.15, s.trail.z, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2, 0.35, 0.3, 0.26, 0.9, 0.45, 0.7, 6, 1);
        F.ring(s.trail.x, fy, s.trail.z, 1.2, a.color, 0.4);
        if (s.mt >= p.under) {
          s.mode = 'warn'; s.mt = 0;
          const b = bounds(a, (a.radius || 1) + 0.6);
          s.to = new THREE.Vector3(clamp(pp.x, b.x0, b.x1), 0, clamp(pp.z, b.z0, b.z1));
          s.to.y = floorAt(a, s.to.x, s.to.z);
          g.audio.play('windup', s.to, 1);
        }
        return false;
      }
      if (s.mode === 'warn') {
        F.tele(s.to.x, s.to.y, s.to.z, p.radius, Math.min(1, s.mt / p.warn), a.color);
        if (Math.random() < 0.5) g.fx.dust.spawn(s.to.x + (Math.random() - 0.5) * p.radius, s.to.y + 0.1, s.to.z + (Math.random() - 0.5) * p.radius, 0, 2, 0, 0.35, 0.3, 0.26, 0.8, 0.4, 0.6, 6, 1);
        if (s.mt >= p.warn) {
          s.mode = 'up'; s.mt = 0;
          a.teleport(new THREE.Vector3(s.to.x, a.flying ? a.pos.y : s.to.y, s.to.z));
          a.hidden = false; a.anim.wind = false; a.anim.act = true;
          g.addShake(0.6); g.audio.play('slam', a.pos, 1); g.audio.play('explosion', a.pos, 0.6);
          g.fx.chunks(_a.set(s.to.x, s.to.y + 0.4, s.to.z), 0x5a5048, 14, 10, 0.3);
          g.enemies.shockwave(s.to.clone(), 9, 11, p.dmg * 0.6 * a.dmgMul, a.color, a.name + ' ERUPTION', tip.burrow);
          const d = Math.hypot(pp.x - s.to.x, pp.z - s.to.z);
          if (d < p.radius && pp.y < s.to.y + 3) { if (hurt(a, p.dmg, s.to.x, s.to.y, s.to.z, 'BURROW', tip.burrow)) g.player.knock((pp.x - s.to.x) / (d || 1) * 6, 11, (pp.z - s.to.z) / (d || 1) * 6); }
          for (let i = 0; i < p.ring; i++) { const ang = i / p.ring * TAU; shoot(a, _a.set(s.to.x, s.to.y + 1, s.to.z), _b.set(Math.sin(ang), 0, Math.cos(ang)), 11, p.dmg * 0.4, { what: 'DEBRIS', tip: tip.burrow, trail: false }); }
        }
        return false;
      }
      // rising back out
      a.sinkY = depth * Math.max(0, 1 - s.mt / 0.3);
      return s.mt > 0.45;
    },
    end(a) { a.hidden = false; a.sinkY = 0; },
  },
};

export const MODULE_IDS = Object.keys(MODULES);

// ---------------------------------------------------------------------------------------
// Brain: schedules modules for an actor, handles phases, movement styles, named combos and
// a per-boss signature attack.
//   extra.signature = { name, seq: [[id, params], ...], over: [[id, params]...] (phase 3), cd }
//   extra.combos = [{ name, phase, seq: [[id, params], ...], cd, weight }]
// ---------------------------------------------------------------------------------------
export class Brain {
  constructor(actor, abilities, phase2, phase3, extra = {}) {
    this.a = actor;
    this.sets = [abilities || [], phase2 || [], phase3 || []];
    this.cur = null;
    this.cds = new Map();
    this.idleT = 1.0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 2;
    this.sig = extra.signature || null;
    this.combos = extra.combos || [];
    this.sigT = extra.sigDelay != null ? extra.sigDelay : 7;
    this.sigUses = 0;
    this.queue = null;
    this.gapT = 0;
    this.comboCd = new Map();
    this.comboSeen = new Set();
  }
  list() {
    const ph = this.a.phase || 1;
    let out = [...this.sets[0]];
    if (ph >= 2) out = out.concat(this.sets[1]);
    if (ph >= 3) out = out.concat(this.sets[2]);
    return out;
  }
  params(id, params) { const mod = MODULES[id]; return mod ? { ...mod.def, ...(params || {}) } : null; }
  // interrupt whatever is running (phase change, hand broken, stun)
  abort() {
    if (this.cur) { const c = this.cur; try { if (c.mod.end) c.mod.end(this.a, c.s, c.p); } catch (e) { /* ignore */ } }
    this.cur = null;
    this.queue = null;
    const an = this.a.anim;
    if (an) { an.wind = false; an.act = false; an.mod = null; }
  }
  onPhase(n) {
    this.idleT = Math.min(this.idleT, 0.8);
    if (this.sig) this.sigT = Math.min(this.sigT, n >= 3 ? 1.0 : 2.5);
  }
  begin(id, params, key) {
    const a = this.a;
    const mod = MODULES[id];
    if (!mod) return false;
    const p = { ...mod.def, ...(params || {}) };
    const pick = { id, mod, p, key, s: { t: 0 } };
    this.cur = pick;
    a.anim.moving = false;
    a.anim.mod = id;
    try { mod.start(a, pick.s, p); } catch (e) { this.cur = null; a.game.lastError = String(e && e.stack || e); return false; }
    return true;
  }
  startSeq(name, seq, kind) {
    this.queue = { name, seq, i: 0, kind };
    this.nextStep();
  }
  nextStep() {
    const q = this.queue;
    if (!q || q.i >= q.seq.length) { this.queue = null; return; }
    const [id, params] = q.seq[q.i];
    q.i++;
    if (!this.begin(id, params, 'q:' + q.name + q.i)) { this.queue = null; this.idleT = 0.5; }
  }
  startSignature() {
    const a = this.a, sig = this.sig;
    const over = (a.phase || 1) >= 3 && sig.over;
    const name = over ? 'OVERDRIVE · ' + sig.name : sig.name;
    const first = this.sigUses === 0;
    this.sigUses++;
    this.sigT = (sig.cd || 17) * (a.cdMul || 1) * (over ? 0.75 : 1);
    announce(a, name, first || over);
    if (first || over) a.game.audio.play('alert', null, 0.5);
    a.game.emit && a.game.emit('bossSignature', { name: sig.name, actor: a.def ? a.def.id : a.type });
    this.startSeq(name, over || sig.seq, 'sig');
  }
  update(dt) {
    const a = this.a;
    for (const [k, v] of this.cds) this.cds.set(k, v - dt);
    for (const [k, v] of this.comboCd) this.comboCd.set(k, v - dt);
    this.sigT -= dt;
    if (this.cur) {
      const c = this.cur;
      c.s.t += dt;
      let done = false;
      try { done = c.mod.update(a, c.s, c.p, dt); } catch (e) { done = true; a.game.lastError = String(e && e.stack || e); }
      if (done) {
        try { if (c.mod.end) c.mod.end(a, c.s, c.p); } catch (e) { /* ignore */ }
        this.cds.set(c.key, c.p.cd * (a.cdMul || 1));
        this.cur = null;
        a.anim.wind = false; a.anim.act = false; a.anim.mod = null;
        if (this.queue && this.queue.i < this.queue.seq.length) { this.gapT = 0.3; return; }
        this.queue = null;
        this.idleT = (0.55 + Math.random() * 0.6) * (a.cdMul || 1) * (a.isBoss ? 1 : 1.25);
      }
      return;
    }
    if (this.queue) {
      // short beat between combo steps: keep facing the player, no wandering
      this.gapT -= dt;
      a.faceTarget(dt, 6);
      if (this.gapT <= 0) this.nextStep();
      return;
    }
    this.move(dt);
    this.idleT -= dt;
    if (this.idleT > 0) return;
    const pp = a.game.player.body.pos;
    const dist = Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z);
    const ph = a.phase || 1;
    const fits = (id, params, slack = 0) => {
      const p = this.params(id, params);
      if (!p) return false;
      if (p.ground && a.flying) return false;
      return dist >= p.range[0] - slack && dist <= p.range[1] + slack;
    };
    // signature attack when its timer is up
    if (this.sig && this.sigT <= 0 && ph >= (this.sig.phase || 1) && fits(this.sig.seq[0][0], this.sig.seq[0][1], 6)) { this.startSignature(); return; }
    const ready = [];
    this.list().forEach((entry, i) => {
      const [id, params] = entry;
      const mod = MODULES[id];
      if (!mod) return;
      const p = { ...mod.def, ...(params || {}) };
      const key = id + i;
      if ((this.cds.get(key) || 0) > 0) return;
      if (p.ground && a.flying) return;
      if (dist < p.range[0] || dist > p.range[1]) return;
      if (id === 'summon' && a.game.enemies.aliveCount > 6) return;
      ready.push({ id, mod, p, key, w: p.weight || 1 });
    });
    this.combos.forEach((cb, i) => {
      if (ph < (cb.phase || 1) || (this.comboCd.get(i) || 0) > 0) return;
      if (!cb.seq.length || !fits(cb.seq[0][0], cb.seq[0][1], 3)) return;
      if (cb.seq.some(([id]) => id === 'summon') && a.game.enemies.aliveCount > 6) return;
      ready.push({ combo: cb, ci: i, w: cb.weight || 1.4 });
    });
    if (!ready.length) { this.idleT = 0.3; return; }
    let r = Math.random() * ready.reduce((s, x) => s + x.w, 0);
    let pick = ready[0];
    for (const x of ready) { r -= x.w; if (r <= 0) { pick = x; break; } }
    if (pick.combo) {
      const cb = pick.combo;
      this.comboCd.set(pick.ci, (cb.cd || 12) * (a.cdMul || 1));
      if (a.isBoss || !this.comboSeen.has(cb.name)) announce(a, cb.name, false);
      this.comboSeen.add(cb.name);
      this.startSeq(cb.name, cb.seq, 'combo');
      return;
    }
    this.begin(pick.id, pick.p, pick.key);
  }
  move(dt) {
    const a = this.a;
    const g = a.game;
    const pp = g.player.body.pos;
    const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    const sp = a.moveSpeed * a.speedMul;
    const style = a.moveStyle;
    a.faceTarget(dt, 5);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.5 + Math.random() * 2; }
    let vx = 0, vz = 0;
    if (style === 'chase') { if (d > a.radius + 2.5) { vx = dx / d * sp; vz = dz / d * sp; } }
    else if (style === 'kite') {
      const want = a.prefDist || 13;
      const k = d < want - 3 ? -1 : d > want + 4 ? 1 : 0;
      vx = dx / d * sp * k - dz / d * sp * 0.7 * this.strafe;
      vz = dz / d * sp * k + dx / d * sp * 0.7 * this.strafe;
    } else if (style === 'circle' || style === 'hover') {
      const want = a.prefDist || 12;
      const k = d < want - 2 ? -0.8 : d > want + 5 ? 0.8 : 0;
      vx = dx / d * sp * k - dz / d * sp * this.strafe;
      vz = dz / d * sp * k + dx / d * sp * this.strafe;
    } else if (style === 'stationary') { vx = 0; vz = 0; }
    a.anim.moving = Math.hypot(vx, vz) > 0.3;
    if (vx || vz) a.moveVel(dt, vx, vz);
  }
}

// helper for actors that move with collision directly (bosses)
export function slideBody(body, dx, dz, colliders) {
  const before = body.pos.clone();
  const hit = moveBody(body, dx, 0, dz, colliders);
  const moved = before.distanceTo(body.pos);
  return (hit & 1) && moved < Math.hypot(dx, dz) * 0.5;
}
export { V };
