import * as THREE from 'three';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';

// Procedural low-poly bodies for bosses and minibosses. Each builder returns a group plus
// hitbox definitions (local, unscaled), detachable armor plates (popped off as the actor
// takes damage), vent points (smoke/sparks when hurt) and an animate(t, s) function driven
// by the anim flags the attack modules set: wind (telegraph), act (attack), moving, mod
// (current module id), hp (0..1), stun. Geometry and materials are cached so dozens of
// encounters stay cheap.

const geo = new Map();
function box(w, h, d) { const k = `b${w}|${h}|${d}`; if (!geo.has(k)) geo.set(k, new THREE.BoxGeometry(w, h, d)); return geo.get(k); }
function cyl(rt, rb, h, s = 8) { const k = `c${rt}|${rb}|${h}|${s}`; if (!geo.has(k)) geo.set(k, new THREE.CylinderGeometry(rt, rb, h, s)); return geo.get(k); }
function cone(r, h, s = 4) { const k = `n${r}|${h}|${s}`; if (!geo.has(k)) geo.set(k, new THREE.ConeGeometry(r, h, s)); return geo.get(k); }
function oct(r) { const k = `o${r}`; if (!geo.has(k)) geo.set(k, new THREE.OctahedronGeometry(r, 0)); return geo.get(k); }
function ico(r, d = 0) { const k = `i${r}|${d}`; if (!geo.has(k)) geo.set(k, new THREE.IcosahedronGeometry(r, d)); return geo.get(k); }

const mats = new Map();
export function chassisMats(colors) {
  const [body, dark, glow] = colors;
  const k = colors.join('|');
  if (mats.has(k)) return mats.get(k);
  const L = (c, tex) => psxify(new THREE.MeshLambertMaterial({ map: getTexture(tex), color: c, emissive: new THREE.Color(c).multiplyScalar(0.2) }));
  const m = { body: L(body, 'panel'), dark: L(dark, 'gun'), plate: L(new THREE.Color(body).multiplyScalar(1.15).getHex(), 'skin'), glow: new THREE.MeshBasicMaterial({ color: glow }), hazard: L(0xd0b020, 'hazard'), vent: L(new THREE.Color(dark).multiplyScalar(1.4).getHex(), 'vent') };
  mats.set(k, m);
  return m;
}

function M(g, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.userData.mat = mat; return m; }
function pivot(x, y, z, ...children) { const p = new THREE.Group(); p.position.set(x, y, z); for (const c of children) p.add(c); return p; }
// mark a mesh as a detachable armor plate
function A(mesh, list) { mesh.userData.armor = true; list.push(mesh); return mesh; }
const sin = Math.sin, cos = Math.cos, PI = Math.PI;
// eased approach so poses blend instead of snapping (called every frame)
function ease(obj, key, target, k = 0.2) { obj[key] += (target - obj[key]) * k; }

const B = {
  brute(m) {
    const g = new THREE.Group(), armor = [];
    const legL = pivot(-0.45, 1.3, 0, M(box(0.5, 0.7, 0.55), m.dark, 0, -0.35, 0));
    const legR = pivot(0.45, 1.3, 0, M(box(0.5, 0.7, 0.55), m.dark, 0, -0.35, 0));
    const shinL = pivot(0, -0.7, 0, M(box(0.46, 0.7, 0.5), m.body, 0, -0.3, 0.02), M(box(0.6, 0.18, 0.8), m.dark, 0, -0.62, 0.1));
    const shinR = pivot(0, -0.7, 0, M(box(0.46, 0.7, 0.5), m.body, 0, -0.3, 0.02), M(box(0.6, 0.18, 0.8), m.dark, 0, -0.62, 0.1));
    legL.add(shinL); legR.add(shinR);
    const torso = pivot(0, 1.3, 0, M(box(1.7, 1.4, 1.0), m.body, 0, 0.75, 0), M(box(1.8, 0.3, 1.05), m.dark, 0, 1.4, 0), M(box(0.6, 0.4, 0.06), m.glow, 0, 0.9, 0.52),
      M(box(0.9, 0.6, 0.5), m.vent, 0, 1.0, -0.62), M(box(0.18, 0.7, 0.18), m.dark, -0.35, 1.7, -0.55), M(box(0.18, 0.7, 0.18), m.dark, 0.35, 1.7, -0.55));
    torso.add(A(M(box(1.0, 0.55, 0.12), m.plate, 0, 0.35, 0.55), armor), A(M(box(0.5, 0.5, 0.12), m.plate, -0.55, 1.0, 0.55), armor));
    const head = pivot(0, 2.9, 0.1, M(box(0.55, 0.5, 0.55), m.plate), M(box(0.4, 0.08, 0.04), m.glow, 0, 0.05, 0.29), M(box(0.65, 0.15, 0.6), m.dark, 0, 0.3, -0.02));
    const mk = (s) => {
      const arm = pivot(s * 1.1, 2.5, 0, M(box(0.6, 0.8, 0.6), m.body, 0, -0.35, 0));
      const pad = A(M(box(0.85, 0.35, 0.8), m.plate, s * 0.1, 0.12, 0), armor);
      const fore = pivot(0, -0.8, 0, M(box(0.55, 0.8, 0.55), m.dark, 0, -0.35, 0), M(box(0.8, 0.6, 0.8), m.dark, 0, -0.9, 0), M(box(0.82, 0.1, 0.82), m.glow, 0, -0.62, 0));
      arm.add(pad, fore); arm.userData.fore = fore; return arm;
    };
    const armL = mk(-1), armR = mk(1);
    g.add(legL, legR, torso, head, armL, armR);
    return {
      group: g, parts: { legL, legR, torso, head, armL, armR }, height: 3.2, radius: 1.0, armor, vents: [[0, 3.0, -0.55], [-0.35, 3.3, -0.55], [0.35, 3.3, -0.55]],
      hit: [{ x: 0, y: 2.0, z: 0, r: 1.0 }, { x: 0, y: 2.95, z: 0.1, r: 0.38, weak: true, mul: 2 }],
      muzzle: [1.1, 1.0, 0.4],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        const w = sin(t * 6) * 0.5 * mv;
        ease(legL.rotation, 'x', w); ease(legR.rotation, 'x', -w);
        ease(shinL.rotation, 'x', Math.max(0, -w) * 0.9); ease(shinR.rotation, 'x', Math.max(0, w) * 0.9);
        const slam = s.mod === 'shockwave' || s.mod === 'quake' || s.mod === 'leap' || s.mod === 'sweep';
        const wa = s.wind ? (slam ? -2.8 : -1.6) : s.act ? (slam ? 0.2 : -1.2) : -w * 0.6 + sin(t * 1.6) * 0.06;
        ease(armL.rotation, 'x', wa, 0.25); ease(armR.rotation, 'x', s.wind && !slam ? -1.3 : wa, 0.25);
        ease(armL.userData.fore.rotation, 'x', s.wind ? -0.5 : 0); ease(armR.userData.fore.rotation, 'x', s.wind ? -0.5 : 0);
        ease(torso.rotation, 'x', s.wind ? -0.25 : s.act && slam ? 0.35 : 0);
        torso.position.y = 1.3 + sin(t * 2) * 0.03 + Math.abs(sin(t * 6)) * 0.06 * mv;
        head.rotation.y = sin(t * 0.7) * 0.3 * (1 - mv);
        head.position.y = torso.position.y + 1.6;
      },
    };
  },
  walker(m) {
    const g = new THREE.Group(), armor = [];
    const body = pivot(0, 2.4, 0, M(box(1.6, 0.9, 1.8), m.body), M(box(1.0, 0.4, 0.6), m.dark, 0, 0.6, -0.2), M(box(0.5, 0.15, 0.06), m.glow, 0, 0.1, 0.93),
      M(box(0.25, 0.25, 1.4), m.dark, 0.6, -0.1, 1.0), M(box(0.25, 0.25, 1.4), m.dark, -0.6, -0.1, 1.0), M(box(0.12, 0.9, 0.12), m.dark, -0.5, 0.9, -0.6), M(box(0.2, 0.08, 0.2), m.glow, -0.5, 1.38, -0.6));
    body.add(A(M(box(1.7, 0.2, 1.2), m.plate, 0, 0.5, 0.25), armor), A(M(box(0.2, 0.7, 1.4), m.plate, 0.88, 0, 0), armor), A(M(box(0.2, 0.7, 1.4), m.plate, -0.88, 0, 0), armor));
    const pods = [];
    for (const s of [-1, 1]) { const p = pivot(s * 1.05, 0.15, 0.3, M(box(0.45, 0.45, 0.9), m.dark), M(box(0.3, 0.3, 0.06), m.glow, 0, 0, 0.46)); pods.push(p); body.add(p); }
    const legs = [], shins = [];
    for (const s of [-1, 1]) {
      const hip = pivot(s * 0.6, 2.2, 0);
      const thigh = pivot(0, 0, 0, M(box(0.3, 1.2, 0.3), m.dark, 0, -0.6, -0.2), M(box(0.42, 0.42, 0.42), m.body, 0, 0, 0));
      thigh.rotation.x = 0.5;
      const shin = pivot(0, -1.1, -0.5, M(box(0.25, 1.2, 0.25), m.body, 0, -0.55, 0.2), M(box(0.6, 0.15, 0.8), m.dark, 0, -1.15, 0.35), M(box(0.12, 0.3, 0.12), m.hazard, 0, -0.2, 0.32));
      shin.rotation.x = -0.7;
      thigh.add(shin); hip.add(thigh); g.add(hip);
      legs.push(thigh); shins.push(shin);
    }
    g.add(body);
    return {
      group: g, parts: { body, legs }, height: 3.0, radius: 1.0, armor, vents: [[-0.5, 3.8, -0.6], [0, 3.0, -0.8]],
      hit: [{ x: 0, y: 2.4, z: 0, r: 1.05 }, { x: 0, y: 2.5, z: 0.95, r: 0.32, weak: true, mul: 2 }],
      muzzle: [0.6, 2.3, 1.8],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        const w = sin(t * 7) * 0.35 * mv;
        ease(legs[0].rotation, 'x', 0.5 + w); ease(legs[1].rotation, 'x', 0.5 - w);
        ease(shins[0].rotation, 'x', -0.7 - Math.max(0, w) * 0.8); ease(shins[1].rotation, 'x', -0.7 - Math.max(0, -w) * 0.8);
        const crouch = s.wind ? (s.mod === 'leap' || s.mod === 'charge' ? 0.55 : 0.25) : 0;
        body.position.y = 2.4 + Math.abs(sin(t * 7)) * 0.08 * mv - crouch + sin(t * 2.2) * 0.03;
        ease(body.rotation, 'x', s.wind ? -0.12 : s.act ? 0.08 : 0);
        pods.forEach((p, i) => { ease(p.rotation, 'x', s.wind ? -0.5 : s.act ? 0.25 * sin(t * 40 + i) : 0); p.position.z = 0.3 - (s.act ? 0.12 * Math.abs(sin(t * 30 + i)) : 0); });
      },
    };
  },
  spider(m) {
    const g = new THREE.Group(), armor = [];
    const body = pivot(0, 1.1, 0, M(box(1.6, 0.6, 2.0), m.body), M(box(1.0, 0.5, 0.9), m.dark, 0, 0.45, -0.2));
    for (const [x, y] of [[-0.3, 0.1], [0.3, 0.1], [-0.15, 0.25], [0.15, 0.25]]) body.add(M(box(0.16, 0.16, 0.05), m.glow, x, y, 1.02));
    const abdomen = pivot(0, 0.2, -1.0, M(box(1.3, 0.9, 1.4), m.dark, 0, 0.15, -0.6), M(box(0.6, 0.12, 1.0), m.glow, 0, 0.62, -0.6));
    abdomen.add(A(M(box(1.4, 0.2, 1.0), m.plate, 0, 0.55, -0.7), armor));
    body.add(abdomen, A(M(box(1.7, 0.18, 1.2), m.plate, 0, 0.36, 0.3), armor));
    const fangs = [];
    for (const s of [-1, 1]) { const f = pivot(s * 0.35, -0.2, 1.0, M(box(0.12, 0.5, 0.12), m.plate, 0, -0.2, 0.1)); fangs.push(f); body.add(f); }
    g.add(body);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3;
      const hip = pivot(side * 0.75, 1.1, -0.6 + k * 0.6);
      const upper = M(box(1.1, 0.16, 0.16), m.dark, side * 0.55, 0.3, 0);
      upper.rotation.z = side * -0.5;
      const lower = M(box(0.16, 1.4, 0.16), m.body, side * 1.1, -0.35, 0);
      hip.add(upper, lower, M(box(0.24, 0.24, 0.24), m.plate, side * 1.1, 0.4, 0));
      g.add(hip);
      legs.push(hip);
    }
    return {
      group: g, parts: { body, legs }, height: 1.8, radius: 1.3, low: true, armor, vents: [[0, 1.9, -1.6], [0, 1.6, -0.4]],
      hit: [{ x: 0, y: 1.15, z: 0, r: 1.15 }, { x: 0, y: 1.25, z: 1.0, r: 0.35, weak: true, mul: 2 }],
      muzzle: [0, 1.3, 1.2],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        legs.forEach((l, i) => { const ph = i % 2 ? PI : 0; l.rotation.y = sin(t * 11 + ph) * (mv ? 0.35 : 0.04); l.position.y = 1.1 + Math.max(0, sin(t * 11 + ph)) * (mv ? 0.12 : 0) - (s.wind ? 0.25 : 0); });
        body.position.y = 1.1 - (s.wind ? 0.3 : 0) + sin(t * 3) * 0.04;
        ease(body.rotation, 'x', s.wind ? -0.25 : s.act ? 0.1 : 0);
        abdomen.scale.setScalar(1 + sin(t * (s.wind ? 14 : 3)) * (s.wind ? 0.08 : 0.03));
        fangs.forEach((f, i) => { f.rotation.z = (i ? 1 : -1) * (s.act || s.wind ? 0.5 + sin(t * 20) * 0.2 : 0.1); });
      },
    };
  },
  tank(m) {
    const g = new THREE.Group(), armor = [];
    const base = pivot(0, 0.5, 0, M(box(2.2, 0.8, 2.8), m.dark), M(box(0.5, 0.9, 2.9), m.body, -1.15, 0, 0), M(box(0.5, 0.9, 2.9), m.body, 1.15, 0, 0));
    const treads = [];
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const tr = M(box(0.52, 0.1, 0.35), m.hazard, s * 1.15, -0.42, -1.2 + i * 0.8); treads.push(tr); base.add(tr); }
    base.add(A(M(box(0.55, 0.6, 1.6), m.plate, -1.45, 0.15, 0.3), armor), A(M(box(0.55, 0.6, 1.6), m.plate, 1.45, 0.15, 0.3), armor));
    const barrel = pivot(0, 0.1, 0.8, M(box(0.3, 0.3, 1.8), m.dark, 0, 0, 0.5), M(box(0.45, 0.45, 0.2), m.dark, 0, 0, 1.4), M(box(0.2, 0.2, 0.06), m.glow, 0, 0, 1.51));
    const turret = pivot(0, 1.2, 0, M(box(1.6, 0.8, 1.6), m.body), barrel, M(box(0.5, 0.12, 0.05), m.glow, 0, 0.25, 0.81),
      M(box(0.9, 0.35, 0.5), m.vent, 0, 0.1, -0.85), M(box(0.6, 0.12, 0.3), m.glow, 0, 0.3, -0.85), M(box(0.08, 0.9, 0.08), m.dark, 0.55, 0.8, -0.4));
    turret.add(A(M(box(1.7, 0.18, 1.3), m.plate, 0, 0.5, 0.1), armor));
    g.add(base, turret);
    return {
      group: g, parts: { base, turret }, height: 1.8, radius: 1.5, low: true, armor, vents: [[0, 1.6, -0.9], [0.55, 2.4, -0.4]],
      hit: [{ x: 0, y: 1.0, z: 0, r: 1.4 }, { x: 0, y: 1.25, z: -0.8, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [0, 1.3, 2.4],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        base.position.y = 0.5 + sin(t * 30) * 0.015 * mv;
        treads.forEach((tr, i) => { tr.position.z = -1.2 + ((i % 4) * 0.8 + t * 2.4 * mv) % 3.2; });
        ease(turret.rotation, 'x', s.wind ? -0.12 : 0);
        turret.rotation.y = sin(t * 0.8) * 0.15 * (1 - mv);
        barrel.position.z = 0.8 - (s.act ? 0.25 * Math.abs(sin(t * 25)) : 0);
        ease(barrel.rotation, 'x', s.wind ? (s.mod === 'mortar' || s.mod === 'meteor' || s.mod === 'missiles' ? -0.7 : -0.15) : 0);
      },
    };
  },
  hover(m) {
    const g = new THREE.Group(), armor = [];
    const rig = new THREE.Group();
    rig.add(M(box(0.9, 1.3, 0.6), m.body, 0, 0.4, 0), M(box(0.6, 0.6, 0.5), m.dark, 0, -0.5, 0), M(box(0.3, 0.3, 0.3), m.glow, 0, -0.9, 0));
    rig.add(A(M(box(1.0, 0.6, 0.15), m.plate, 0, 0.55, 0.36), armor), A(M(box(1.0, 0.5, 0.15), m.plate, 0, 0.5, -0.36), armor));
    const head = M(box(0.5, 0.55, 0.5), m.plate, 0, 1.4, 0);
    rig.add(head, M(box(0.42, 0.1, 0.05), m.glow, 0, 1.45, 0.27), M(box(0.08, 0.5, 0.08), m.dark, 0, 1.9, -0.1));
    const wings = [];
    for (const s of [-1, 1]) {
      const w = pivot(s * 0.5, 0.8, -0.3, M(box(1.8, 0.08, 0.7), m.dark, s * 0.9, 0, 0), M(box(1.6, 0.05, 0.1), m.glow, s * 0.9, 0, 0.36), M(box(0.9, 0.06, 0.5), m.body, s * 1.5, -0.05, -0.35));
      wings.push(w); rig.add(w);
    }
    const arms = [];
    for (const s of [-1, 1]) { const a = pivot(s * 0.6, 0.8, 0.1, M(box(0.2, 0.9, 0.2), m.dark, 0, -0.45, 0), M(box(0.26, 0.26, 0.26), m.glow, 0, -0.95, 0)); arms.push(a); rig.add(a); }
    g.add(rig);
    return {
      group: g, parts: { rig, wings }, height: 2.2, radius: 0.9, flying: true, hover: 3, armor, vents: [[0, -0.9, 0], [0, 0.6, -0.4]],
      hit: [{ x: 0, y: 0.4, z: 0, r: 0.85 }, { x: 0, y: 1.4, z: 0, r: 0.42, weak: true, mul: 2.2 }],
      muzzle: [0, 0.7, 0.5],
      animate(t, s) {
        wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.2 + sin(t * (s.wind ? 9 : 3)) * 0.15 + (s.wind ? 0.4 : 0)); });
        ease(rig.rotation, 'x', s.wind ? 0.3 : s.moving ? 0.25 : 0.1);
        arms.forEach((a, i) => { ease(a.rotation, 'x', s.wind ? -1.4 : s.act ? -1.0 : sin(t * 2 + i) * 0.15); ease(a.rotation, 'z', (i ? -1 : 1) * (s.wind && s.mod !== 'burst' ? 0.9 : 0.1)); });
        head.rotation.y = sin(t * 0.9) * 0.25;
      },
    };
  },
  orb(m) {
    const g = new THREE.Group(), armor = [];
    const core = M(ico(1.1, 1), m.body);
    const eye = M(box(0.8, 0.8, 0.2), m.glow, 0, 0, 1.0);
    const pupil = M(box(0.3, 0.3, 0.05), m.dark, 0, 0, 1.12);
    const lids = [M(box(1.0, 0.3, 0.25), m.dark, 0, 0.5, 0.98), M(box(1.0, 0.3, 0.25), m.dark, 0, -0.5, 0.98)];
    const ring = M(cyl(1.6, 1.6, 0.12, 12), m.dark);
    ring.rotation.x = PI / 2;
    const fins = [];
    for (let i = 0; i < 4; i++) { const f = M(box(0.15, 1.1, 0.6), m.dark, cos(i * PI / 2) * 1.15, sin(i * PI / 2) * 1.15, -0.3); f.rotation.z = i * PI / 2; fins.push(f); }
    const spin = new THREE.Group(); spin.add(ring, ...fins);
    for (let i = 0; i < 4; i++) { const p = A(M(box(0.7, 0.7, 0.25), m.plate, cos(i * PI / 2 + PI / 4) * 0.95, sin(i * PI / 2 + PI / 4) * 0.95, 0.35), armor); p.lookAt(0, 0, 0); p.rotateY(PI); g.add(p); }
    const antenna = M(box(0.06, 0.9, 0.06), m.dark, 0, 1.4, -0.2);
    g.add(core, eye, pupil, ...lids, spin, antenna);
    return {
      group: g, parts: { core, eye, spin }, height: 2.4, radius: 1.2, flying: true, hover: 3.5, armor, vents: [[0, 0.9, -0.6], [0.8, 0, -0.6], [-0.8, 0, -0.6]],
      hit: [{ x: 0, y: 0, z: 0, r: 1.15 }, { x: 0, y: 0, z: 1.0, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [0, 0, 1.3],
      animate(t, s) {
        spin.rotation.z = t * (s.wind ? 6 : 1.2);
        eye.scale.setScalar(s.wind ? 1.25 + sin(t * 30) * 0.1 : 1);
        pupil.position.x = sin(t * 1.3) * 0.18 * (s.wind ? 0 : 1); pupil.position.y = cos(t * 0.9) * 0.12 * (s.wind ? 0 : 1);
        const open = s.wind || s.act ? 0.72 : s.stun ? 0.2 : 0.55 + (sin(t * 0.5) > 0.97 ? -0.4 : 0);
        lids[0].position.y = open; lids[1].position.y = -open;
        core.rotation.y = sin(t * 0.4) * 0.3;
      },
    };
  },
  totem(m) {
    const g = new THREE.Group(), armor = [];
    const blocks = [];
    for (let i = 0; i < 4; i++) {
      const w = 1.5 - i * 0.12;
      const b = pivot(0, 0.6 + i * 1.15, 0, M(box(w, 1.0, w), i % 2 ? m.dark : m.body), M(box(0.5, 0.18, 0.05), m.glow, 0, 0, 0.76 - i * 0.06),
        M(box(w + 0.2, 0.12, 0.25), m.dark, 0, 0.45, 0));
      if (i % 2 === 0) b.add(A(M(box(0.25, 0.8, w * 0.8), m.plate, w / 2 + 0.1, 0, 0), armor), A(M(box(0.25, 0.8, w * 0.8), m.plate, -w / 2 - 0.1, 0, 0), armor));
      blocks.push(b); g.add(b);
    }
    const crown = M(oct(0.5), m.glow, 0, 5.4, 0);
    const halo = new THREE.Group();
    for (let i = 0; i < 6; i++) { const sp = M(box(0.12, 0.5, 0.12), m.dark, cos(i / 6 * PI * 2) * 0.9, 0, sin(i / 6 * PI * 2) * 0.9); halo.add(sp); }
    halo.position.y = 5.4;
    g.add(crown, halo);
    return {
      group: g, parts: { blocks, crown }, height: 5.6, radius: 0.9, armor, vents: [[0, 5.0, 0], [0, 2.9, 0]],
      hit: [{ x: 0, y: 1.8, z: 0, r: 1.0 }, { x: 0, y: 3.6, z: 0, r: 0.9 }, { x: 0, y: 5.4, z: 0, r: 0.5, weak: true, mul: 2.5 }],
      muzzle: [0, 4.2, 0.7],
      animate(t, s) {
        blocks.forEach((b, i) => { b.rotation.y = sin(t * (0.6 + i * 0.3) + i) * (s.wind ? 1.2 : 0.5) + (s.act ? t * (i % 2 ? 3 : -3) : 0); b.position.y = 0.6 + i * 1.15 + (s.wind ? i * 0.08 : 0); });
        crown.rotation.y = t * 2; crown.position.y = 5.4 + sin(t * 2) * 0.15 + (s.wind ? 0.4 : 0);
        crown.scale.setScalar(s.wind ? 1.3 + sin(t * 25) * 0.15 : 1);
        halo.position.y = crown.position.y; halo.rotation.y = -t * (s.wind ? 5 : 1);
      },
    };
  },
  serpent(m) {
    const g = new THREE.Group(), armor = [];
    const jaw = pivot(0, -0.3, 0.3, M(box(0.9, 0.2, 0.9), m.dark, 0, -0.1, 0.35), M(box(0.7, 0.1, 0.1), m.glow, 0, 0.02, 0.75));
    const head = pivot(0, 0, 0, M(box(1.0, 0.8, 1.4), m.body), M(box(0.8, 0.12, 0.05), m.glow, 0, 0.1, 0.72), jaw,
      M(box(0.12, 0.5, 0.12), m.dark, -0.35, 0.55, -0.3), M(box(0.12, 0.5, 0.12), m.dark, 0.35, 0.55, -0.3));
    head.add(A(M(box(1.1, 0.2, 1.0), m.plate, 0, 0.48, 0.1), armor));
    g.add(head);
    const segs = [];
    for (let i = 0; i < 8; i++) {
      const s = M(box(0.85 - i * 0.05, 0.75 - i * 0.04, 0.9), i % 2 ? m.dark : m.body);
      s.add(M(box(0.2, 0.3, 0.5), m.plate, 0, 0.45 - i * 0.02, 0));
      s.userData.trail = true;
      segs.push(s);
    }
    return {
      group: g, parts: { head, segs }, height: 1.2, radius: 0.8, flying: true, hover: 3, serpent: true, armor, vents: [[0, 0.5, -0.6]],
      hit: [{ x: 0, y: 0, z: 0, r: 0.75, weak: true, mul: 1.6 }],
      muzzle: [0, 0, 0.9],
      animate(t, s) {
        head.rotation.z = sin(t * 3) * 0.15;
        ease(jaw.rotation, 'x', s.wind ? 0.7 + sin(t * 30) * 0.08 : s.act ? 0.5 : 0.05);
        segs.forEach((sg, i) => { sg.scale.y = 1 + sin(t * 6 - i * 0.7) * 0.06; });
      },
    };
  },
  knight(m) {
    const g = new THREE.Group(), armor = [];
    const legL = pivot(-0.35, 1.5, 0, M(box(0.4, 1.5, 0.45), m.dark, 0, -0.75, 0), M(box(0.46, 0.3, 0.5), m.plate, 0, -0.75, 0.05));
    const legR = pivot(0.35, 1.5, 0, M(box(0.4, 1.5, 0.45), m.dark, 0, -0.75, 0), M(box(0.46, 0.3, 0.5), m.plate, 0, -0.75, 0.05));
    const torso = pivot(0, 1.5, 0, M(box(1.2, 1.3, 0.8), m.body, 0, 0.65, 0), M(box(1.5, 0.35, 0.9), m.plate, 0, 1.25, 0), M(box(0.3, 0.3, 0.06), m.glow, 0, 0.75, 0.42),
      M(box(1.0, 1.4, 0.1), m.dark, 0, 0.2, -0.45));
    torso.add(A(M(box(0.55, 0.3, 0.95), m.plate, -0.75, 1.42, 0), armor), A(M(box(0.55, 0.3, 0.95), m.plate, 0.75, 1.42, 0), armor), A(M(box(0.9, 0.5, 0.12), m.plate, 0, 0.35, 0.44), armor));
    const head = pivot(0, 3.0, 0, M(box(0.5, 0.6, 0.55), m.plate), M(box(0.06, 0.4, 0.04), m.glow, 0, 0, 0.29), M(box(0.08, 0.5, 0.5), m.dark, 0, 0.45, 0));
    const cape = pivot(0, 2.75, -0.45, M(box(1.1, 1.8, 0.06), m.dark, 0, -0.9, 0));
    const shield = pivot(-0.85, 2.3, 0.5, M(box(0.15, 2.0, 1.2), m.plate, 0, -0.3, 0), M(box(0.17, 0.2, 1.22), m.hazard, 0, -1.0, 0), M(box(0.17, 0.5, 0.15), m.glow, -0.02, -0.2, 0));
    const sword = pivot(0.85, 2.4, 0.2, M(box(0.15, 0.4, 0.15), m.dark, 0, 0, 0), M(box(0.4, 0.1, 0.12), m.dark, 0, -0.05, 0.12), M(box(0.08, 0.3, 2.4), m.glow, 0, -0.1, 1.2));
    g.add(legL, legR, torso, head, cape, shield, sword);
    return {
      group: g, parts: { legL, legR, torso, head, shield, sword }, height: 3.4, radius: 0.85, armor, vents: [[0, 2.6, -0.5]],
      hit: [{ x: 0, y: 2.1, z: 0, r: 0.85 }, { x: 0, y: 3.05, z: 0, r: 0.36, weak: true, mul: 2 }],
      muzzle: [0.85, 2.4, 1.5], frontShield: true,
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        const w = sin(t * 6) * 0.5 * mv;
        ease(legL.rotation, 'x', w); ease(legR.rotation, 'x', -w);
        const thrust = s.mod === 'lunge' || s.mod === 'charge' || s.mod === 'blinkstrike';
        ease(sword.rotation, 'x', s.wind ? (thrust ? -0.4 : -1.8) : s.act ? (thrust ? 1.4 : 0.8) : -0.3 + sin(t * 1.5) * 0.05, 0.3);
        ease(sword.rotation, 'z', s.act && !thrust ? -0.6 : 0);
        ease(shield.rotation, 'y', s.wind ? 0.6 : 0);
        ease(torso.rotation, 'y', s.wind && !thrust ? 0.4 : s.act && !thrust ? -0.5 : 0, 0.3);
        cape.rotation.x = 0.1 + mv * 0.35 + sin(t * 3) * 0.05;
        torso.position.y = 1.5 + sin(t * 2) * 0.02;
      },
    };
  },
  mantis(m) {
    const g = new THREE.Group(), armor = [];
    const legs = [];
    for (const s of [-1, 1]) { const l = pivot(s * 0.5, 1.6, 0, M(box(0.3, 1.6, 0.3), m.dark, 0, -0.8, 0), M(box(0.4, 0.15, 0.6), m.dark, 0, -1.55, 0.15)); legs.push(l); g.add(l); }
    const torso = pivot(0, 1.6, 0, M(box(1.1, 1.3, 0.7), m.body, 0, 0.65, 0), M(box(0.5, 0.5, 0.1), m.glow, 0, 0.7, 0.36), M(box(0.6, 0.5, 0.8), m.dark, 0, 1.55, 0.2), M(box(0.5, 0.06, 0.05), m.glow, 0, 1.6, 0.62),
      M(box(0.08, 0.7, 0.08), m.dark, -0.2, 2.0, 0.2), M(box(0.08, 0.7, 0.08), m.dark, 0.2, 2.0, 0.2));
    torso.add(A(M(box(1.2, 0.4, 0.15), m.plate, 0, 1.1, 0.38), armor), A(M(box(0.9, 0.9, 0.12), m.plate, 0, 0.6, -0.4), armor));
    const arms = [];
    for (const s of [-1, 1]) { const a = pivot(s * 0.75, 1.2, 0, M(box(0.25, 1.0, 0.25), m.dark, 0, -0.5, 0), M(box(0.08, 0.3, 1.9), m.plate, s * 0.05, -1.0, 0.9), M(box(0.09, 0.06, 1.7), m.glow, s * 0.05, -0.85, 0.9)); arms.push(a); torso.add(a); }
    g.add(torso);
    return {
      group: g, parts: { legs, torso, arms }, height: 3.4, radius: 0.85, armor, vents: [[0, 3.3, -0.3]],
      hit: [{ x: 0, y: 2.3, z: 0, r: 0.85 }, { x: 0, y: 3.3, z: 0, r: 0.45, weak: true, mul: 1.8 }],
      muzzle: [0, 2.5, 0.8],
      animate(t, s) {
        legs.forEach((l, i) => { ease(l.rotation, 'x', sin(t * 8 + i * PI) * (s.moving ? 0.5 : 0)); });
        arms.forEach((a, i) => { ease(a.rotation, 'x', s.wind ? -2.3 : s.act ? 0.5 : -0.6 + sin(t * 2 + i) * 0.2, 0.3); ease(a.rotation, 'z', s.act ? (i ? -0.5 : 0.5) : 0); });
        ease(torso.rotation, 'x', s.wind ? 0.45 : 0);
        torso.position.y = 1.6 + sin(t * 2.5) * 0.04;
      },
    };
  },
  bull(m) {
    const g = new THREE.Group(), armor = [];
    const chassis = new THREE.Group();
    chassis.add(M(box(3.2, 1.8, 4.4), m.body, 0, 2.2, 0), M(box(3.4, 0.4, 4.6), m.dark, 0, 3.2, 0), M(box(2.2, 1.2, 1.0), m.dark, 0, 2.0, 2.5), M(box(1.6, 0.5, 0.1), m.glow, 0, 2.0, 3.02),
      M(box(0.5, 1.6, 0.5), m.dark, -1.2, 3.8, 1.2), M(box(0.5, 1.6, 0.5), m.dark, 1.2, 3.8, 1.2), M(box(0.6, 0.15, 0.6), m.glow, -1.2, 4.62, 1.2), M(box(0.6, 0.15, 0.6), m.glow, 1.2, 4.62, 1.2),
      M(box(1.8, 1.0, 0.1), m.glow, 0, 2.4, -2.26), M(box(3.25, 0.25, 0.2), m.hazard, 0, 1.5, 2.25));
    chassis.add(A(M(box(0.25, 1.2, 3.6), m.plate, -1.72, 2.2, 0), armor), A(M(box(0.25, 1.2, 3.6), m.plate, 1.72, 2.2, 0), armor), A(M(box(2.4, 0.3, 2.0), m.plate, 0, 3.5, -0.6), armor));
    const horns = [];
    for (const s of [-1, 1]) { const h = pivot(s * 1.0, 2.6, 2.9, M(box(0.25, 0.25, 1.1), m.plate, s * 0.2, 0.2, 0.4)); h.rotation.y = s * 0.4; h.rotation.x = -0.3; horns.push(h); chassis.add(h); }
    const legs = [];
    for (const [x, z] of [[-1.5, 1.5], [1.5, 1.5], [-1.5, -1.5], [1.5, -1.5]]) { const l = pivot(x, 1.4, z, M(box(0.7, 1.4, 0.7), m.dark, 0, -0.7, 0), M(box(0.85, 0.3, 0.9), m.body, 0, -1.25, 0.1)); legs.push(l); chassis.add(l); }
    g.add(chassis);
    return {
      group: g, parts: { chassis, legs }, height: 4.0, radius: 1.8, armor, vents: [[-1.2, 4.7, 1.2], [1.2, 4.7, 1.2], [0, 2.6, -2.4]],
      hit: [{ x: 0, y: 2.2, z: 0.8, r: 1.8, mul: 0.8 }, { x: 0, y: 2.2, z: -1.2, r: 1.6 }, { x: 0, y: 2.4, z: -2.3, r: 0.85, weak: true, mul: 2 }],
      muzzle: [0, 2.0, 3.2],
      animate(t, s) {
        const fast = s.mod === 'charge' && s.act;
        legs.forEach((l, i) => { l.rotation.x = sin(t * (fast ? 16 : 8) + (i % 2) * PI) * (s.moving || fast ? (fast ? 0.7 : 0.45) : 0); });
        ease(chassis.rotation, 'x', s.wind ? -0.25 : fast ? 0.12 : 0);
        chassis.position.y = (s.wind ? -0.25 : 0) + Math.abs(sin(t * 8)) * (s.moving ? 0.08 : 0);
        horns.forEach((h, i) => { h.rotation.z = (i ? -1 : 1) * (s.wind ? 0.25 + sin(t * 30) * 0.05 : 0); });
      },
    };
  },
  swarm(m) {
    const g = new THREE.Group(), armor = [];
    const core = M(oct(0.9), m.body);
    const glow = M(oct(0.5), m.glow);
    const cage = new THREE.Group();
    for (let i = 0; i < 3; i++) { const r = A(M(box(2.0, 0.12, 0.12), m.plate), armor); r.rotation.set(i * 0.9, i * 1.2, 0); cage.add(r); }
    const drones = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const d = M(box(0.45, 0.2, 0.45), i % 2 ? m.dark : m.plate, cos(i / 10 * PI * 2) * 2, sin(i * 1.3) * 0.5, sin(i / 10 * PI * 2) * 2);
      d.add(M(box(0.15, 0.06, 0.15), m.glow, 0, 0.12, 0));
      drones.add(d);
    }
    g.add(core, glow, cage, drones);
    return {
      group: g, parts: { core, drones }, height: 2.0, radius: 1.0, flying: true, hover: 3.2, armor, vents: [[0, 0.6, 0]],
      hit: [{ x: 0, y: 0, z: 0, r: 1.0, weak: true, mul: 1.5 }],
      muzzle: [0, 0, 1.0],
      animate(t, s) {
        drones.rotation.y = t * (s.wind ? 5 : 1.6); drones.rotation.x = sin(t) * 0.3;
        const tight = s.wind ? 0.6 : s.act ? 1.3 : 1;
        drones.scale.setScalar(tight + sin(t * 3) * 0.05);
        core.rotation.y = -t; cage.rotation.y = t * 0.7; cage.rotation.z = t * 0.4;
        glow.scale.setScalar(1 + (s.wind ? 0.4 : 0) + sin(t * 8) * 0.05);
      },
    };
  },
  crystal(m) {
    const g = new THREE.Group(), armor = [];
    const shards = [];
    const center = M(oct(0.9), m.glow);
    g.add(center);
    for (let i = 0; i < 6; i++) {
      const s = M(oct(0.6), i % 2 ? m.body : m.plate);
      s.scale.set(0.6, 1.8, 0.6);
      shards.push(s); g.add(s);
    }
    const shell = [];
    for (let i = 0; i < 3; i++) { const p = A(M(oct(0.35), m.plate), armor); p.scale.set(0.5, 1.4, 0.5); shell.push(p); g.add(p); }
    return {
      group: g, parts: { center, shards }, height: 2.6, radius: 1.1, flying: true, hover: 3.2, armor, vents: [[0, 0, 0]],
      hit: [{ x: 0, y: 0, z: 0, r: 0.9, weak: true, mul: 2 }, { x: 0, y: 0, z: 0, r: 1.5, mul: 0.6 }],
      muzzle: [0, 0, 1.0],
      animate(t, s) {
        shards.forEach((sh, i) => { const a = t * (s.wind ? 3 : 0.8) + i / 6 * PI * 2; const r = s.wind ? 1.0 : s.act ? 1.9 : 1.5; sh.position.set(cos(a) * r, sin(a * 1.3) * 0.6, sin(a) * r); sh.rotation.y = a; });
        shell.forEach((p, i) => { const a = -t * 1.4 + i / 3 * PI * 2; p.position.set(cos(a) * 0.95, 0.9 * sin(t + i), sin(a) * 0.95); p.rotation.z = a; });
        center.rotation.y = t * 2; center.scale.setScalar(s.wind ? 1.2 + sin(t * 25) * 0.1 : 1);
      },
    };
  },
  warden(m) {
    // tall gaunt hunter used by the NG+ stalker
    const g = new THREE.Group(), armor = [];
    const cloak = M(cyl(0.3, 0.9, 3.0, 6), m.dark, 0, 1.6, 0);
    const head = M(oct(0.35), m.plate, 0, 3.4, 0);
    const eye = M(box(0.3, 0.06, 0.05), m.glow, 0, 3.42, 0.3);
    const mantle = A(M(cyl(0.6, 0.5, 0.3, 6), m.plate, 0, 3.0, 0), armor);
    const arms = [];
    for (const s of [-1, 1]) { const a = pivot(s * 0.45, 2.8, 0, M(box(0.12, 2.0, 0.12), m.dark, 0, -1.0, 0.2), M(box(0.06, 0.06, 0.9), m.glow, 0, -2.0, 0.6)); arms.push(a); g.add(a); }
    g.add(cloak, head, eye, mantle);
    return {
      group: g, parts: { arms, head }, height: 3.6, radius: 0.7, armor, vents: [[0, 3.0, 0]],
      hit: [{ x: 0, y: 1.8, z: 0, r: 0.75 }, { x: 0, y: 3.4, z: 0, r: 0.35, weak: true, mul: 2 }],
      muzzle: [0, 2.6, 0.6],
      animate(t, s) { arms.forEach((a, i) => { ease(a.rotation, 'x', s.wind ? -2.0 : -0.3 + sin(t * 3 + i) * 0.3); }); head.rotation.y = sin(t * 1.3) * 0.4; cloak.rotation.y = sin(t * 0.8) * 0.2; },
    };
  },
  // ---- heavy biped with cannon arms and a chest reactor
  colossus(m) {
    const g = new THREE.Group(), armor = [];
    const legs = [], knees = [];
    for (const s of [-1, 1]) {
      const hip = pivot(s * 0.75, 1.9, 0, M(box(0.75, 1.0, 0.8), m.dark, 0, -0.45, 0));
      const knee = pivot(0, -0.95, 0.1, M(box(0.65, 1.0, 0.7), m.body, 0, -0.45, -0.05), M(box(1.0, 0.25, 1.2), m.dark, 0, -0.9, 0.15), M(box(0.3, 0.3, 0.12), m.glow, 0, -0.1, 0.37));
      knee.add(A(M(box(0.75, 0.6, 0.15), m.plate, 0, -0.3, 0.4), armor));
      hip.add(knee); g.add(hip); legs.push(hip); knees.push(knee);
    }
    const torso = pivot(0, 1.9, 0, M(box(2.4, 1.8, 1.4), m.body, 0, 0.95, 0), M(box(2.6, 0.4, 1.5), m.dark, 0, 1.9, 0), M(box(1.0, 0.8, 0.4), m.vent, 0, 1.2, -0.8),
      M(box(0.25, 1.1, 0.25), m.dark, -0.6, 2.4, -0.6), M(box(0.25, 1.1, 0.25), m.dark, 0.6, 2.4, -0.6));
    const reactor = M(oct(0.38), m.glow, 0, 0.95, 0.72);
    torso.add(reactor, M(box(0.9, 0.9, 0.12), m.dark, 0, 0.95, 0.66));
    torso.add(A(M(box(0.8, 0.5, 0.14), m.plate, -0.65, 0.35, 0.74), armor), A(M(box(0.8, 0.5, 0.14), m.plate, 0.65, 0.35, 0.74), armor));
    const head = pivot(0, 2.25, 0.35, M(box(0.7, 0.45, 0.6), m.plate), M(box(0.5, 0.08, 0.04), m.glow, 0, 0, 0.31));
    torso.add(head);
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = pivot(s * 1.5, 1.6, 0, M(box(0.7, 0.7, 0.7), m.dark));
      sh.add(A(M(box(1.0, 0.45, 1.0), m.plate, s * 0.1, 0.4, 0), armor));
      const can = pivot(0, -0.3, 0, M(box(0.6, 1.4, 0.6), m.body, 0, -0.6, 0), M(box(0.45, 0.45, 1.6), m.dark, 0, -1.2, 0.5), M(box(0.3, 0.3, 0.06), m.glow, 0, -1.2, 1.31));
      sh.add(can); sh.userData.can = can; torso.add(sh); arms.push(sh);
    }
    g.add(torso);
    return {
      group: g, parts: { legs, torso, arms, head }, height: 4.3, radius: 1.3, armor, vents: [[-0.6, 5.0, -0.6], [0.6, 5.0, -0.6], [0, 3.2, -0.9]],
      hit: [{ x: 0, y: 2.6, z: 0, r: 1.3 }, { x: 0, y: 1.2, z: 0, r: 0.9, mul: 0.8 }, { x: 0, y: 2.85, z: 0.7, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [1.5, 2.3, 1.9],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        const w = sin(t * 4.5) * 0.4 * mv;
        ease(legs[0].rotation, 'x', w); ease(legs[1].rotation, 'x', -w);
        ease(knees[0].rotation, 'x', Math.max(0, -w)); ease(knees[1].rotation, 'x', Math.max(0, w));
        const slam = s.mod === 'shockwave' || s.mod === 'quake' || s.mod === 'leap' || s.mod === 'fissure';
        torso.position.y = 1.9 - (s.wind && slam ? 0.4 : 0) + Math.abs(sin(t * 4.5)) * 0.08 * mv + sin(t * 1.8) * 0.03;
        ease(torso.rotation, 'x', s.wind ? (slam ? 0.3 : -0.1) : 0);
        arms.forEach((a, i) => {
          const aim = s.wind || s.act ? (slam ? -2.6 : -1.45) : -0.15 + sin(t * 1.3 + i) * 0.05;
          ease(a.rotation, 'x', s.act && slam ? 0.3 : aim, 0.25);
          a.userData.can.position.y = -0.3 + (s.act && !slam ? 0.15 * Math.abs(sin(t * 28 + i)) : 0);
        });
        reactor.scale.setScalar(1 + sin(t * (s.wind ? 20 : 4)) * (s.wind ? 0.25 : 0.08));
        reactor.rotation.y = t * 2;
      },
    };
  },
  // ---- floating bell with a lantern heart and swinging chains
  lantern(m) {
    const g = new THREE.Group(), armor = [];
    const bell = pivot(0, 0.6, 0, M(cyl(0.5, 1.4, 1.5, 6), m.body), M(cyl(1.45, 1.5, 0.2, 6), m.dark, 0, -0.8, 0), M(cyl(0.2, 0.5, 0.5, 6), m.dark, 0, 1.0, 0));
    for (let i = 0; i < 3; i++) bell.add(A(M(box(0.8, 1.0, 0.12), m.plate, cos(i / 3 * PI * 2 + 0.5) * 1.05, -0.05, sin(i / 3 * PI * 2 + 0.5) * 1.05), armor));
    armor.forEach((p, i) => { p.rotation.y = -(i / 3 * PI * 2 + 0.5) + PI / 2; p.rotation.x = 0.35; });
    const heart = M(oct(0.5), m.glow, 0, -0.35, 0);
    const halo = M(cyl(0.95, 0.95, 0.06, 10), m.glow, 0, -0.95, 0);
    const chains = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2;
      const c = pivot(cos(a) * 1.2, -0.3, sin(a) * 1.2, M(box(0.1, 1.0, 0.1), m.dark, 0, -0.5, 0), M(box(0.1, 0.9, 0.1), m.dark, 0, -1.4, 0), M(box(0.22, 0.22, 0.22), m.glow, 0, -1.9, 0));
      chains.push(c); g.add(c);
    }
    const eyes = M(box(0.7, 0.1, 0.05), m.glow, 0, 0.75, 0.62);
    g.add(bell, heart, halo, eyes);
    return {
      group: g, parts: { bell, heart }, height: 2.6, radius: 1.3, flying: true, hover: 3.6, armor, vents: [[0, 1.6, 0]],
      hit: [{ x: 0, y: 0.6, z: 0, r: 1.3 }, { x: 0, y: -0.35, z: 0, r: 0.55, weak: true, mul: 2.2 }],
      muzzle: [0, -0.4, 0.7],
      animate(t, s) {
        chains.forEach((c, i) => { c.rotation.x = sin(t * 2 + i) * 0.25 + (s.moving ? 0.3 : 0); c.rotation.z = cos(t * 1.7 + i * 1.3) * 0.2 + (s.wind ? sin(t * 20 + i) * 0.15 : 0); });
        bell.rotation.y = t * 0.4; bell.position.y = 0.6 + (s.wind ? 0.25 : 0);
        heart.scale.setScalar(1 + sin(t * (s.wind ? 18 : 3)) * (s.wind ? 0.3 : 0.1));
        halo.scale.setScalar(1 + (s.act ? 0.4 : 0) + sin(t * 4) * 0.05); halo.position.y = -0.95 - (s.wind ? 0.3 : 0);
      },
    };
  },
  // ---- ring of blades around a cyclopean eye block
  sentinel(m) {
    const g = new THREE.Group(), armor = [];
    const block = pivot(0, 0, 0, M(box(1.2, 1.2, 1.2), m.body), M(box(0.7, 0.7, 0.12), m.dark, 0, 0, 0.62));
    const eye = M(box(0.42, 0.42, 0.06), m.glow, 0, 0, 0.7);
    block.add(eye);
    for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) block.add(A(M(box(0.5, 0.5, 0.5), m.plate, x * 0.55, y * 0.55, 0.2), armor));
    const ring = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2;
      const seg = M(box(0.25, 0.9, 0.35), i % 2 ? m.dark : m.body, cos(a) * 1.7, sin(a) * 1.7, 0);
      seg.rotation.z = a;
      ring.add(seg);
      if (i % 2 === 0) { const bl = M(cone(0.18, 0.7, 4), m.glow, cos(a) * 2.25, sin(a) * 2.25, 0); bl.rotation.z = a - PI / 2; ring.add(bl); }
    }
    const ring2 = new THREE.Group();
    for (let i = 0; i < 4; i++) { const a = i / 4 * PI * 2; const sg = M(box(0.15, 0.15, 0.8), m.dark, cos(a) * 1.1, sin(a) * 1.1, -0.3); ring2.add(sg); }
    g.add(block, ring, ring2);
    return {
      group: g, parts: { block, ring }, height: 2.4, radius: 1.3, flying: true, hover: 3.4, armor, vents: [[0, 0.7, -0.5]],
      hit: [{ x: 0, y: 0, z: 0, r: 1.1 }, { x: 0, y: 0, z: 0.65, r: 0.42, weak: true, mul: 2.3 }],
      muzzle: [0, 0, 1.0],
      animate(t, s) {
        ring.rotation.z = t * (s.wind ? 7 : s.act ? 3 : 0.9);
        ring.scale.setScalar(s.wind ? 0.85 : s.act ? 1.15 : 1);
        ring2.rotation.z = -t * 2;
        eye.scale.setScalar(s.wind ? 1.4 + sin(t * 30) * 0.15 : 1);
        block.rotation.x = sin(t * 0.8) * 0.1; block.rotation.y = sin(t * 0.6) * 0.15;
      },
    };
  },
  // ---- low scorpion: pincers, six legs, a tail with a glowing stinger
  crawler(m) {
    const g = new THREE.Group(), armor = [];
    const body = pivot(0, 0.9, 0, M(box(1.4, 0.6, 2.2), m.body), M(box(1.0, 0.3, 1.8), m.dark, 0, 0.4, -0.1), M(box(0.5, 0.12, 0.05), m.glow, 0, 0.1, 1.12));
    body.add(A(M(box(1.5, 0.2, 0.8), m.plate, 0, 0.5, 0.5), armor), A(M(box(1.5, 0.2, 0.8), m.plate, 0, 0.5, -0.5), armor));
    const tail = [];
    let parent = body;
    for (let i = 0; i < 4; i++) {
      const seg = pivot(0, i ? 0.1 : 0.35, i ? -0.55 : -1.1, M(box(0.55 - i * 0.07, 0.45 - i * 0.05, 0.6), i % 2 ? m.dark : m.body, 0, 0, -0.3));
      seg.rotation.x = 0.55;
      parent.add(seg); tail.push(seg); parent = seg;
    }
    const sting = M(oct(0.3), m.glow, 0, 0.05, -0.75);
    parent.add(sting, M(cone(0.12, 0.5, 4), m.plate, 0, -0.1, -1.0));
    const claws = [];
    for (const s of [-1, 1]) {
      const c = pivot(s * 0.6, 0, 1.0, M(box(0.25, 0.25, 0.9), m.dark, 0, 0, 0.4));
      const pin = pivot(0, 0, 0.85, M(box(0.4, 0.2, 0.55), m.plate, s * 0.08, 0, 0.25), M(box(0.12, 0.15, 0.5), m.glow, -s * 0.12, 0, 0.3));
      c.add(pin); c.userData.pin = pin; body.add(c); claws.push(c);
    }
    g.add(body);
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1, k = i % 3;
      const hip = pivot(side * 0.65, 0.9, -0.6 + k * 0.6, M(box(0.9, 0.14, 0.14), m.dark, side * 0.45, 0.15, 0), M(box(0.14, 1.0, 0.14), m.body, side * 0.9, -0.3, 0));
      g.add(hip); legs.push(hip);
    }
    return {
      group: g, parts: { body, legs, tail }, height: 3.4, radius: 1.3, low: true, armor, vents: [[0, 1.5, -0.4]],
      hit: [{ x: 0, y: 1.0, z: 0.2, r: 1.2 }, { x: 0, y: 3.28, z: -1.05, r: 0.45, weak: true, mul: 2.2 }],
      muzzle: [0, 3.3, -0.8],
      animate(t, s) {
        const mv = s.moving ? 1 : 0;
        legs.forEach((l, i) => { const ph = i % 2 ? PI : 0; l.rotation.y = sin(t * 12 + ph) * (mv ? 0.3 : 0.03); l.position.y = 0.9 + Math.max(0, sin(t * 12 + ph)) * 0.1 * mv; });
        tail.forEach((sg, i) => { ease(sg.rotation, 'x', (s.wind ? 0.9 : 0.55) + sin(t * 2 + i) * 0.08 - (s.act && i === 3 ? 0.9 : 0), 0.3); });
        claws.forEach((c, i) => { ease(c.rotation, 'y', (i ? -1 : 1) * (s.wind ? 0.5 : 0.1)); c.userData.pin.rotation.y = (i ? 1 : -1) * (s.act || s.wind ? 0.4 + sin(t * 18) * 0.25 : 0.15); });
        sting.scale.setScalar(1 + sin(t * (s.wind ? 20 : 4)) * (s.wind ? 0.3 : 0.1));
        body.position.y = 0.9 + sin(t * 3) * 0.03 - (s.wind ? 0.15 : 0);
      },
    };
  },
};

export const CHASSIS_LIST = Object.keys(B);

// opts.unique: give this instance its own glow material so the actor can pulse it as a
// telegraph without recolouring every other actor that shares the palette.
export function buildChassis(type, colors, scale = 1, opts = {}) {
  const m = chassisMats(colors);
  const c = (B[type] || B.brute)(m);
  c.type = type;
  c.scale = scale;
  c.group.scale.setScalar(scale);
  c.meshes = [];
  // chassis geometry is cached and shared: owners must never dispose it
  c.group.traverse((o) => { if (o.isMesh) { c.meshes.push(o); o.userData.shared = true; } });
  if (c.parts.segs) for (const s of c.parts.segs) s.traverse((o) => { if (o.isMesh) o.userData.shared = true; });
  c.mats = m;
  c.armor = c.armor || [];
  c.vents = c.vents || [[0, c.height * 0.8, 0]];
  c.baseGlow = new THREE.Color(colors[2]);
  if (opts.unique) {
    const gm = m.glow.clone();
    const swap = (o) => { if (o.isMesh && o.material === m.glow) { o.material = gm; o.userData.mat = gm; } };
    c.group.traverse(swap);
    if (c.parts.segs) for (const s of c.parts.segs) s.traverse(swap);
    c.glowMat = gm;
  }
  return c;
}
