import * as THREE from 'three';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';

// Procedural low-poly bodies for bosses and minibosses. Each builder returns a group plus
// hitbox definitions (local, unscaled) and an animate() function. Geometry and materials
// are cached so dozens of encounters stay cheap.

const geo = new Map();
function box(w, h, d) { const k = `b${w}|${h}|${d}`; if (!geo.has(k)) geo.set(k, new THREE.BoxGeometry(w, h, d)); return geo.get(k); }
function cyl(rt, rb, h, s = 8) { const k = `c${rt}|${rb}|${h}|${s}`; if (!geo.has(k)) geo.set(k, new THREE.CylinderGeometry(rt, rb, h, s)); return geo.get(k); }
function oct(r) { const k = `o${r}`; if (!geo.has(k)) geo.set(k, new THREE.OctahedronGeometry(r, 0)); return geo.get(k); }
function ico(r, d = 0) { const k = `i${r}|${d}`; if (!geo.has(k)) geo.set(k, new THREE.IcosahedronGeometry(r, d)); return geo.get(k); }

const mats = new Map();
export function chassisMats(colors) {
  const [body, dark, glow] = colors;
  const k = colors.join('|');
  if (mats.has(k)) return mats.get(k);
  const L = (c, tex) => psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color: c, emissive: new THREE.Color(c).multiplyScalar(0.2) }));
  const m = { body: L(body, 'panel'), dark: L(dark, 'gun'), plate: L(new THREE.Color(body).multiplyScalar(1.15).getHex(), 'skin'), glow: new THREE.MeshBasicMaterial({ color: glow }), hazard: L(0xd0b020, 'hazard') };
  mats.set(k, m);
  return m;
}

function M(g, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.userData.mat = mat; return m; }
function pivot(x, y, z, ...children) { const p = new THREE.Group(); p.position.set(x, y, z); for (const c of children) p.add(c); return p; }

const B = {
  brute(m) {
    const g = new THREE.Group();
    const legL = pivot(-0.45, 1.3, 0, M(box(0.5, 1.3, 0.55), m.dark, 0, -0.65, 0));
    const legR = pivot(0.45, 1.3, 0, M(box(0.5, 1.3, 0.55), m.dark, 0, -0.65, 0));
    const torso = pivot(0, 1.3, 0, M(box(1.7, 1.4, 1.0), m.body, 0, 0.75, 0), M(box(1.8, 0.3, 1.05), m.dark, 0, 1.4, 0), M(box(0.6, 0.4, 0.06), m.glow, 0, 0.9, 0.52));
    const head = pivot(0, 2.9, 0.1, M(box(0.55, 0.5, 0.55), m.plate), M(box(0.4, 0.08, 0.04), m.glow, 0, 0.05, 0.29));
    const armL = pivot(-1.1, 2.5, 0, M(box(0.6, 1.5, 0.6), m.body, 0, -0.7, 0), M(box(0.75, 0.6, 0.75), m.dark, 0, -1.6, 0));
    const armR = pivot(1.1, 2.5, 0, M(box(0.6, 1.5, 0.6), m.body, 0, -0.7, 0), M(box(0.75, 0.6, 0.75), m.dark, 0, -1.6, 0));
    g.add(legL, legR, torso, head, armL, armR);
    return {
      group: g, parts: { legL, legR, torso, head, armL, armR }, height: 3.2, radius: 1.0,
      hit: [{ x: 0, y: 2.0, z: 0, r: 1.0 }, { x: 0, y: 2.95, z: 0.1, r: 0.38, weak: true, mul: 2 }],
      muzzle: [1.1, 1.0, 0.4],
      animate(t, s) {
        const w = Math.sin(t * 6) * (s.moving ? 0.5 : 0);
        legL.rotation.x = w; legR.rotation.x = -w;
        armL.rotation.x = s.wind ? -2.2 : -w * 0.6; armR.rotation.x = s.wind ? -2.2 : w * 0.6;
        torso.rotation.x = s.wind ? -0.25 : 0;
      },
    };
  },
  walker(m) {
    const g = new THREE.Group();
    const body = pivot(0, 2.4, 0, M(box(1.6, 0.9, 1.8), m.body), M(box(1.0, 0.4, 0.6), m.dark, 0, 0.6, -0.2), M(box(0.5, 0.15, 0.06), m.glow, 0, 0.1, 0.93), M(box(0.25, 0.25, 1.4), m.dark, 0.6, -0.1, 1.0), M(box(0.25, 0.25, 1.4), m.dark, -0.6, -0.1, 1.0));
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = pivot(s * 0.6, 2.2, 0);
      const thigh = pivot(0, 0, 0, M(box(0.3, 1.2, 0.3), m.dark, 0, -0.6, -0.2));
      thigh.rotation.x = 0.5;
      const shin = pivot(0, -1.1, -0.5, M(box(0.25, 1.2, 0.25), m.body, 0, -0.55, 0.2), M(box(0.6, 0.15, 0.8), m.dark, 0, -1.15, 0.35));
      shin.rotation.x = -0.7;
      thigh.add(shin);
      hip.add(thigh);
      g.add(hip);
      legs.push(thigh);
    }
    g.add(body);
    return {
      group: g, parts: { body, legs }, height: 3.0, radius: 1.0,
      hit: [{ x: 0, y: 2.4, z: 0, r: 1.05 }, { x: 0, y: 2.5, z: 0.95, r: 0.32, weak: true, mul: 2 }],
      muzzle: [0.6, 2.3, 1.8],
      animate(t, s) {
        const w = Math.sin(t * 7) * (s.moving ? 0.35 : 0);
        legs[0].rotation.x = 0.5 + w; legs[1].rotation.x = 0.5 - w;
        body.position.y = 2.4 + Math.abs(Math.sin(t * 7)) * (s.moving ? 0.08 : 0) - (s.wind ? 0.25 : 0);
      },
    };
  },
  spider(m) {
    const g = new THREE.Group();
    const body = pivot(0, 1.1, 0, M(box(1.6, 0.6, 2.0), m.body), M(box(1.0, 0.5, 0.9), m.dark, 0, 0.45, -0.2));
    for (const [x, y] of [[-0.3, 0.1], [0.3, 0.1], [-0.15, 0.25], [0.15, 0.25]]) body.add(M(box(0.16, 0.16, 0.05), m.glow, x, y, 1.02));
    g.add(body);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3;
      const hip = pivot(side * 0.75, 1.1, -0.6 + k * 0.6);
      const upper = M(box(1.1, 0.16, 0.16), m.dark, side * 0.55, 0.3, 0);
      upper.rotation.z = side * -0.5;
      const lower = M(box(0.16, 1.4, 0.16), m.body, side * 1.1, -0.35, 0);
      hip.add(upper, lower);
      g.add(hip);
      legs.push(hip);
    }
    return {
      group: g, parts: { body, legs }, height: 1.8, radius: 1.3, low: true,
      hit: [{ x: 0, y: 1.15, z: 0, r: 1.15 }, { x: 0, y: 1.25, z: 1.0, r: 0.35, weak: true, mul: 2 }],
      muzzle: [0, 1.3, 1.2],
      animate(t, s) {
        legs.forEach((l, i) => { l.rotation.y = Math.sin(t * 10 + i * 1.7) * (s.moving ? 0.35 : 0.05); l.position.y = 1.1 + Math.max(0, Math.sin(t * 10 + i)) * (s.moving ? 0.1 : 0); });
        body.rotation.x = s.wind ? -0.2 : 0;
      },
    };
  },
  tank(m) {
    const g = new THREE.Group();
    const base = pivot(0, 0.5, 0, M(box(2.2, 0.8, 2.8), m.dark), M(box(0.5, 0.9, 2.9), m.body, -1.15, 0, 0), M(box(0.5, 0.9, 2.9), m.body, 1.15, 0, 0));
    const turret = pivot(0, 1.2, 0, M(box(1.6, 0.8, 1.6), m.body), M(box(0.3, 0.3, 1.8), m.dark, 0, 0.1, 1.3), M(box(0.45, 0.45, 0.2), m.dark, 0, 0.1, 2.2), M(box(0.5, 0.12, 0.05), m.glow, 0, 0.25, 0.81));
    g.add(base, turret);
    return {
      group: g, parts: { base, turret }, height: 1.8, radius: 1.5, low: true,
      hit: [{ x: 0, y: 1.0, z: 0, r: 1.4 }, { x: 0, y: 1.25, z: -0.8, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [0, 1.3, 2.4],
      animate(t, s) { base.position.y = 0.5 + Math.sin(t * 30) * (s.moving ? 0.015 : 0); turret.rotation.x = s.wind ? -0.12 : 0; },
    };
  },
  hover(m) {
    const g = new THREE.Group();
    const rig = new THREE.Group();
    rig.add(M(box(0.9, 1.3, 0.6), m.body, 0, 0.4, 0), M(box(0.6, 0.6, 0.5), m.dark, 0, -0.5, 0));
    const head = M(box(0.5, 0.55, 0.5), m.plate, 0, 1.4, 0);
    rig.add(head, M(box(0.42, 0.1, 0.05), m.glow, 0, 1.45, 0.27));
    const wings = [];
    for (const s of [-1, 1]) {
      const w = pivot(s * 0.5, 0.8, -0.3, M(box(1.8, 0.08, 0.7), m.dark, s * 0.9, 0, 0), M(box(1.6, 0.05, 0.1), m.glow, s * 0.9, 0, 0.36));
      wings.push(w); rig.add(w);
    }
    g.add(rig);
    return {
      group: g, parts: { rig, wings }, height: 2.2, radius: 0.9, flying: true, hover: 3,
      hit: [{ x: 0, y: 0.4, z: 0, r: 0.85 }, { x: 0, y: 1.4, z: 0, r: 0.42, weak: true, mul: 2.2 }],
      muzzle: [0, 0.7, 0.5],
      animate(t, s) { wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.2 + Math.sin(t * 3) * 0.15 + (s.wind ? 0.4 : 0)); }); rig.rotation.x = s.wind ? 0.3 : 0.1; },
    };
  },
  orb(m) {
    const g = new THREE.Group();
    const core = M(ico(1.1, 1), m.body);
    const eye = M(box(0.8, 0.8, 0.2), m.glow, 0, 0, 1.0);
    const pupil = M(box(0.3, 0.3, 0.05), m.dark, 0, 0, 1.12);
    const ring = M(cyl(1.6, 1.6, 0.12, 12), m.dark);
    ring.rotation.x = Math.PI / 2;
    const fins = [];
    for (let i = 0; i < 4; i++) { const f = M(box(0.15, 1.1, 0.6), m.dark, Math.cos(i * Math.PI / 2) * 1.15, Math.sin(i * Math.PI / 2) * 1.15, -0.3); f.rotation.z = i * Math.PI / 2; fins.push(f); }
    const spin = new THREE.Group(); spin.add(ring, ...fins);
    g.add(core, eye, pupil, spin);
    return {
      group: g, parts: { core, eye, spin }, height: 2.4, radius: 1.2, flying: true, hover: 3.5,
      hit: [{ x: 0, y: 0, z: 0, r: 1.15 }, { x: 0, y: 0, z: 1.0, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [0, 0, 1.3],
      animate(t, s) { spin.rotation.z = t * (s.wind ? 6 : 1.2); eye.scale.setScalar(s.wind ? 1.25 + Math.sin(t * 30) * 0.1 : 1); },
    };
  },
  totem(m) {
    const g = new THREE.Group();
    const blocks = [];
    for (let i = 0; i < 4; i++) {
      const b = pivot(0, 0.6 + i * 1.15, 0, M(box(1.5 - i * 0.12, 1.0, 1.5 - i * 0.12), i % 2 ? m.dark : m.body), M(box(0.5, 0.18, 0.05), m.glow, 0, 0, 0.76 - i * 0.06));
      blocks.push(b); g.add(b);
    }
    const crown = M(oct(0.5), m.glow, 0, 5.4, 0);
    g.add(crown);
    return {
      group: g, parts: { blocks, crown }, height: 5.6, radius: 0.9,
      hit: [{ x: 0, y: 1.8, z: 0, r: 1.0 }, { x: 0, y: 3.6, z: 0, r: 0.9 }, { x: 0, y: 5.4, z: 0, r: 0.5, weak: true, mul: 2.5 }],
      muzzle: [0, 4.2, 0.7],
      animate(t, s) { blocks.forEach((b, i) => { b.rotation.y = Math.sin(t * (0.6 + i * 0.3) + i) * (s.wind ? 1.2 : 0.5); }); crown.rotation.y = t * 2; crown.position.y = 5.4 + Math.sin(t * 2) * 0.15; },
    };
  },
  serpent(m) {
    const g = new THREE.Group();
    const head = pivot(0, 0, 0, M(box(1.0, 0.8, 1.4), m.body), M(box(0.8, 0.12, 0.05), m.glow, 0, 0.1, 0.72), M(box(0.9, 0.2, 0.6), m.dark, 0, -0.4, 0.5));
    g.add(head);
    const segs = [];
    for (let i = 0; i < 8; i++) {
      const s = M(box(0.85 - i * 0.05, 0.75 - i * 0.04, 0.9), i % 2 ? m.dark : m.body);
      s.userData.trail = true;
      segs.push(s);
    }
    return {
      group: g, parts: { head, segs }, height: 1.2, radius: 0.8, flying: true, hover: 3, serpent: true,
      hit: [{ x: 0, y: 0, z: 0, r: 0.75, weak: true, mul: 1.6 }],
      muzzle: [0, 0, 0.9],
      animate(t, s) { head.rotation.z = Math.sin(t * 3) * 0.15; },
    };
  },
  knight(m) {
    const g = new THREE.Group();
    const legL = pivot(-0.35, 1.5, 0, M(box(0.4, 1.5, 0.45), m.dark, 0, -0.75, 0));
    const legR = pivot(0.35, 1.5, 0, M(box(0.4, 1.5, 0.45), m.dark, 0, -0.75, 0));
    const torso = pivot(0, 1.5, 0, M(box(1.2, 1.3, 0.8), m.body, 0, 0.65, 0), M(box(1.5, 0.35, 0.9), m.plate, 0, 1.25, 0));
    const head = pivot(0, 3.0, 0, M(box(0.5, 0.6, 0.55), m.plate), M(box(0.06, 0.4, 0.04), m.glow, 0, 0, 0.29), M(box(0.08, 0.5, 0.5), m.dark, 0, 0.45, 0));
    const shield = pivot(-0.85, 2.3, 0.5, M(box(0.15, 2.0, 1.2), m.plate, 0, -0.3, 0), M(box(0.17, 0.2, 1.22), m.hazard, 0, -1.0, 0));
    const sword = pivot(0.85, 2.4, 0.2, M(box(0.15, 0.4, 0.15), m.dark, 0, 0, 0), M(box(0.08, 0.3, 2.4), m.glow, 0, -0.1, 1.2));
    g.add(legL, legR, torso, head, shield, sword);
    return {
      group: g, parts: { legL, legR, torso, head, shield, sword }, height: 3.4, radius: 0.85,
      hit: [{ x: 0, y: 2.1, z: 0, r: 0.85 }, { x: 0, y: 3.05, z: 0, r: 0.36, weak: true, mul: 2 }],
      muzzle: [0.85, 2.4, 1.5], frontShield: true,
      animate(t, s) {
        const w = Math.sin(t * 6) * (s.moving ? 0.5 : 0);
        legL.rotation.x = w; legR.rotation.x = -w;
        sword.rotation.x = s.wind ? -1.8 : s.act ? 0.8 : -0.3;
        shield.rotation.y = s.wind ? 0.6 : 0;
      },
    };
  },
  mantis(m) {
    const g = new THREE.Group();
    const legs = [];
    for (const s of [-1, 1]) { const l = pivot(s * 0.5, 1.6, 0, M(box(0.3, 1.6, 0.3), m.dark, 0, -0.8, 0)); legs.push(l); g.add(l); }
    const torso = pivot(0, 1.6, 0, M(box(1.1, 1.3, 0.7), m.body, 0, 0.65, 0), M(box(0.5, 0.5, 0.1), m.glow, 0, 0.7, 0.36), M(box(0.6, 0.5, 0.8), m.dark, 0, 1.55, 0.2), M(box(0.5, 0.06, 0.05), m.glow, 0, 1.6, 0.62));
    const arms = [];
    for (const s of [-1, 1]) { const a = pivot(s * 0.75, 1.2, 0, M(box(0.25, 1.0, 0.25), m.dark, 0, -0.5, 0), M(box(0.08, 0.3, 1.9), m.plate, s * 0.05, -1.0, 0.9), M(box(0.09, 0.06, 1.7), m.glow, s * 0.05, -0.85, 0.9)); arms.push(a); torso.add(a); }
    g.add(torso);
    return {
      group: g, parts: { legs, torso, arms }, height: 3.4, radius: 0.85,
      hit: [{ x: 0, y: 2.3, z: 0, r: 0.85 }, { x: 0, y: 3.3, z: 0, r: 0.45, weak: true, mul: 1.8 }],
      muzzle: [0, 2.5, 0.8],
      animate(t, s) {
        legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 8 + i * Math.PI) * (s.moving ? 0.5 : 0); });
        arms.forEach((a, i) => { a.rotation.x = s.wind ? -2.3 : s.act ? 0.5 : -0.6 + Math.sin(t * 2 + i) * 0.2; });
        torso.rotation.x = s.wind ? 0.45 : 0;
      },
    };
  },
  bull(m) {
    const g = new THREE.Group();
    const chassis = new THREE.Group();
    chassis.add(M(box(3.2, 1.8, 4.4), m.body, 0, 2.2, 0), M(box(3.4, 0.4, 4.6), m.dark, 0, 3.2, 0), M(box(2.2, 1.2, 1.0), m.dark, 0, 2.0, 2.5), M(box(1.6, 0.5, 0.1), m.glow, 0, 2.0, 3.02), M(box(0.5, 1.6, 0.5), m.dark, -1.2, 3.8, 1.2), M(box(0.5, 1.6, 0.5), m.dark, 1.2, 3.8, 1.2), M(box(1.8, 1.0, 0.1), m.glow, 0, 2.4, -2.26));
    const legs = [];
    for (const [x, z] of [[-1.5, 1.5], [1.5, 1.5], [-1.5, -1.5], [1.5, -1.5]]) { const l = pivot(x, 1.4, z, M(box(0.7, 1.4, 0.7), m.dark, 0, -0.7, 0)); legs.push(l); chassis.add(l); }
    g.add(chassis);
    return {
      group: g, parts: { chassis, legs }, height: 4.0, radius: 1.8,
      hit: [{ x: 0, y: 2.2, z: 0.8, r: 1.8, mul: 0.8 }, { x: 0, y: 2.2, z: -1.2, r: 1.6 }, { x: 0, y: 2.4, z: -2.3, r: 0.85, weak: true, mul: 2 }],
      muzzle: [0, 2.0, 3.2],
      animate(t, s) { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 8 + (i % 2) * Math.PI) * (s.moving ? 0.45 : 0); }); chassis.rotation.x = s.wind ? -0.25 : 0; },
    };
  },
  swarm(m) {
    const g = new THREE.Group();
    const core = M(oct(0.9), m.body);
    const glow = M(oct(0.5), m.glow);
    const drones = new THREE.Group();
    for (let i = 0; i < 8; i++) { const d = M(box(0.45, 0.2, 0.45), i % 2 ? m.dark : m.plate, Math.cos(i / 8 * Math.PI * 2) * 2, Math.sin(i * 1.3) * 0.5, Math.sin(i / 8 * Math.PI * 2) * 2); drones.add(d); }
    g.add(core, glow, drones);
    return {
      group: g, parts: { core, drones }, height: 2.0, radius: 1.0, flying: true, hover: 3.2,
      hit: [{ x: 0, y: 0, z: 0, r: 1.0, weak: true, mul: 1.5 }],
      muzzle: [0, 0, 1.0],
      animate(t, s) { drones.rotation.y = t * (s.wind ? 5 : 1.6); drones.rotation.x = Math.sin(t) * 0.3; core.rotation.y = -t; glow.scale.setScalar(1 + (s.wind ? 0.4 : 0) + Math.sin(t * 8) * 0.05); },
    };
  },
  crystal(m) {
    const g = new THREE.Group();
    const shards = [];
    const center = M(oct(0.9), m.glow);
    g.add(center);
    for (let i = 0; i < 6; i++) {
      const s = M(oct(0.6), i % 2 ? m.body : m.plate);
      s.scale.set(0.6, 1.8, 0.6);
      shards.push(s); g.add(s);
    }
    return {
      group: g, parts: { center, shards }, height: 2.6, radius: 1.1, flying: true, hover: 3.2,
      hit: [{ x: 0, y: 0, z: 0, r: 0.9, weak: true, mul: 2 }, { x: 0, y: 0, z: 0, r: 1.5, mul: 0.6 }],
      muzzle: [0, 0, 1.0],
      animate(t, s) { shards.forEach((sh, i) => { const a = t * (s.wind ? 3 : 0.8) + i / 6 * Math.PI * 2; const r = s.wind ? 1.0 : 1.5; sh.position.set(Math.cos(a) * r, Math.sin(a * 1.3) * 0.6, Math.sin(a) * r); sh.rotation.y = a; }); center.rotation.y = t * 2; },
    };
  },
  warden(m) {
    // tall gaunt hunter used by the NG+ stalker
    const g = new THREE.Group();
    const cloak = M(cyl(0.3, 0.9, 3.0, 6), m.dark, 0, 1.6, 0);
    const head = M(oct(0.35), m.plate, 0, 3.4, 0);
    const eye = M(box(0.3, 0.06, 0.05), m.glow, 0, 3.42, 0.3);
    const arms = [];
    for (const s of [-1, 1]) { const a = pivot(s * 0.45, 2.8, 0, M(box(0.12, 2.0, 0.12), m.dark, 0, -1.0, 0.2), M(box(0.06, 0.06, 0.9), m.glow, 0, -2.0, 0.6)); arms.push(a); g.add(a); }
    g.add(cloak, head, eye);
    return {
      group: g, parts: { arms, head }, height: 3.6, radius: 0.7,
      hit: [{ x: 0, y: 1.8, z: 0, r: 0.75 }, { x: 0, y: 3.4, z: 0, r: 0.35, weak: true, mul: 2 }],
      muzzle: [0, 2.6, 0.6],
      animate(t, s) { arms.forEach((a, i) => { a.rotation.x = s.wind ? -2.0 : -0.3 + Math.sin(t * 3 + i) * 0.3; }); head.rotation.y = Math.sin(t * 1.3) * 0.4; },
    };
  },
};

export const CHASSIS_LIST = Object.keys(B);

export function buildChassis(type, colors, scale = 1) {
  const m = chassisMats(colors);
  const c = B[type](m);
  c.type = type;
  c.scale = scale;
  c.group.scale.setScalar(scale);
  c.meshes = [];
  c.group.traverse((o) => { if (o.isMesh) c.meshes.push(o); });
  c.mats = m;
  return c;
}
