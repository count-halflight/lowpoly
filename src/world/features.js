import * as THREE from 'three';
import { GeoBuilder, FACES, hideRanges } from './builder.js';
import { psxify } from '../render/renderer.js';
import { GRAFFITI } from '../data/lore.js';
import { graffitiCanvas } from './kits.js';

// Interactive level features owned by a Room: destructibles + secret walls, lifts / moving
// platforms / trams, crusher pistons, steam vents, grapple anchors, shootable switches and
// shutters, speed gates and shallow water. Everything is built in room-local coordinates,
// collides through ordinary AABB colliders and is disposed with the room.

const HP = { crate: 5, cover: 12, rack: 8, wall: 10, brick: 8, grate: 10, crumble: 1, glass: 2 };
const SURF = { crate: 'wood', cover: 'concrete', rack: 'metal', wall: 'concrete', brick: 'concrete', grate: 'metal', crumble: 'concrete', glass: 'metal' };
const CHUNK = { crate: 0x8a6a4a, cover: 0x9a9a9a, rack: 0x303440, wall: 0x8a8a96, brick: 0x8a6a5a, grate: 0x606470, crumble: 0x8a8078, glass: 0xb8e8ff };
const tmpV = new THREE.Vector3();
const NONE = [];
const tmpV2 = new THREE.Vector3();
const MV = [0, 0, 0]; // placeMover's per-frame delta, reused (no allocation per mover per frame)

// ---------------------------------------------------------------- shared resources
export function featureRes(level) {
  if (level.featRes) return level.featRes;
  // plain unlit colours: the same shader program the door indicators already use (no extra compiles)
  const basic = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
  const markGeo = new THREE.PlaneGeometry(1, 1);
  markGeo.rotateX(-Math.PI / 2);
  const targetGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 8);
  targetGeo.rotateZ(Math.PI / 2);
  level.featRes = {
    warnOn: basic(0xff2a30), warnOff: basic(0x3a0c10), goOn: basic(0x3effa0),
    anchor: basic(0xffa030), anchorLit: basic(0xfff4b0), gateLit: basic(0x9ffff0),
    markOn: new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    steam: new THREE.MeshBasicMaterial({ color: 0xa8b8c4, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    coldSteam: new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    waterTex: makeWaterTexture(),
    markGeo, targetGeo,
    ringGeo: new THREE.TorusGeometry(0.42, 0.09, 4, 8),
    jetGeo: new THREE.CylinderGeometry(0.45, 0.95, 4.2, 8, 1, true),
    lampGeo: new THREE.BoxGeometry(0.34, 0.22, 0.34),
    barGeo: new THREE.BoxGeometry(1, 0.14, 0.14),
  };
  return level.featRes;
}

function makeWaterTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#5a7a84'; x.fillRect(0, 0, 32, 32);
  let r = 7;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 0; i < 26; i++) {
    x.fillStyle = rnd() < 0.5 ? '#86aab4' : '#3e5a64';
    x.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 2 + Math.floor(rnd() * 6), 1);
  }
  x.fillStyle = '#c8e4ea';
  for (let i = 0; i < 6; i++) x.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}

function whiteColors(geo) {
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  return geo;
}
const smooth = (u) => u * u * (3 - 2 * u);
// ping-pong 0 -> 1 -> 0 with a pause at each end
function moverU(m, t) {
  const P = m.period, half = P / 2, mv = Math.max(0.1, half - m.pause);
  const k = ((t + m.phase) % P + P) % P;
  if (k < m.pause) return 0;
  if (k < half) return smooth((k - m.pause) / mv);
  if (k < half + m.pause) return 1;
  return 1 - smooth((k - half - m.pause) / mv);
}
// seconds until the mover next departs (Infinity while moving)
function moverWait(m, t) {
  const P = m.period, half = P / 2;
  const k = ((t + m.phase) % P + P) % P;
  if (k < m.pause) return m.pause - k;
  if (k >= half && k < half + m.pause) return half + m.pause - k;
  return Infinity;
}

function overlapsBox(body, c, shrink = 0) {
  const p = body.pos;
  return p.x + body.r - shrink > c.minX && p.x - body.r + shrink < c.maxX && p.z + body.r - shrink > c.minZ && p.z - body.r + shrink < c.maxZ && p.y + body.h > c.minY && p.y < c.maxY;
}
// push a body out of a box along the axis of least penetration (or a preferred direction)
function pushOut(body, c, dirX = 0, dirZ = 0) {
  const p = body.pos, r = body.r + 0.02;
  if (dirX > 0.01) { p.x = c.maxX + r; return; }
  if (dirX < -0.01) { p.x = c.minX - r; return; }
  if (dirZ > 0.01) { p.z = c.maxZ + r; return; }
  if (dirZ < -0.01) { p.z = c.minZ - r; return; }
  const l = p.x + r - c.minX, rt = c.maxX - (p.x - r), f = p.z + r - c.minZ, bk = c.maxZ - (p.z - r);
  const m = Math.min(l, rt, f, bk);
  if (m === l) p.x = c.minX - r; else if (m === rt) p.x = c.maxX + r; else if (m === f) p.z = c.minZ - r; else p.z = c.maxZ + r;
}

// ---------------------------------------------------------------- build
// Static parts go into the room's merged builder `gb`; moving / breakable parts get their own meshes.
export function buildFeatures(room, gb, M, rng) {
  const s = room.spec, R = featureRes(room.level);
  room.movers = []; room.crushers = []; room.vents = []; room.anchors = []; room.destructibles = [];
  room.switches = []; room.gates = []; room.speedGates = []; room.waters = []; room.secretList = []; room.fallList = [];
  room.navDirty = 0; room.powerOff = 0; room.drained = 0;
  room.waterColor = new THREE.Color(s.waterColor || 0x7ab8c8);

  // --- destructibles: one merged builder, pieces hidden by collapsing their vertex ranges
  const list = s.breakables || [];
  if (list.length) {
    const dg = new GeoBuilder(2);
    for (const b of list) {
      dg.begin();
      drawBreakable(dg, M, b, room);
      const ranges = dg.end();
      const col = room.addCollider(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, { surface: SURF[b.kind] || 'wood', nav: b.nav !== false, tag: 'barrel' });
      if (b.kind === 'crumble') col.crumble = true;
      const d = {
        kind: 'break', type: b.kind, room, col, ranges, hp: b.hp || HP[b.kind] || 5, broken: false,
        floor: b.kind === 'grate' || b.kind === 'crumble', bulletproof: b.kind === 'wall' || b.kind === 'brick' || b.kind === 'grate' || b.kind === 'crumble',
        nav: b.nav !== false, secret: b.secret !== undefined ? b.secret : -1, src: b, t: -1, regrow: -1,
        c: new THREE.Vector3(room.wx((b.x0 + b.x1) / 2), (b.y0 + b.y1) / 2, room.wz((b.z0 + b.z1) / 2)),
      };
      col.ref = d;
      room.destructibles.push(d);
    }
    const built = dg.build();
    room.group.add(built.group);
    room.disposables.push(...built.geos);
    room.dMeshes = built.meshes;
    for (const d of room.destructibles) {
      if (d.type !== 'crumble') continue;
      d.orig = d.ranges.map((r) => built.meshes.get(r.mat).geometry.attributes.position.array.slice(r.start * 3, (r.start + r.count) * 3));
    }
  }

  // --- secret alcoves (the cracked wall is a destructible; this is the room behind it)
  (s.secrets || []).forEach((sc, i) => {
    room.secretList.push({ ...sc, found: false, i });
    const side = sc.side, x0 = side * (s.W / 2), xb = side * (s.W / 2 + 1 + sc.depth);
    const ax0 = Math.min(x0, xb), ax1 = Math.max(x0, xb);
    const z0 = sc.z - sc.w / 2, z1 = sc.z + sc.w / 2;
    gb.box(ax0, -1, z0 - 0.5, ax1, 0, z1 + 0.5, M.floor, { faces: FACES.PY });
    room.addCollider(ax0, -1, z0 - 0.5, ax1, 0, z1 + 0.5, { nav: false, surface: 'concrete' });
    // back + side walls + roof of the alcove
    const bx0 = side > 0 ? ax1 - 0.5 : ax0, bx1 = side > 0 ? ax1 : ax0 + 0.5;
    gb.box(bx0, 0, z0 - 0.5, bx1, sc.h + 0.5, z1 + 0.5, M.wall, { faces: side > 0 ? FACES.NX : FACES.PX });
    gb.box(ax0, 0, z0 - 0.5, ax1, sc.h + 0.5, z0, M.wall, { faces: FACES.PZ, tint: 0.8 });
    gb.box(ax0, 0, z1, ax1, sc.h + 0.5, z1 + 0.5, M.wall, { faces: FACES.NZ, tint: 0.8 });
    gb.box(ax0, sc.h, z0 - 0.5, ax1, sc.h + 0.5, z1 + 0.5, M.ceiling, { faces: FACES.NY });
    room.addCollider(bx0, 0, z0 - 0.5, bx1, sc.h + 0.5, z1 + 0.5, { nav: false });
    room.addCollider(ax0, 0, z0 - 0.5, ax1, sc.h + 0.5, z0, { nav: false });
    room.addCollider(ax0, 0, z1, ax1, sc.h + 0.5, z1 + 0.5, { nav: false });
    room.addCollider(ax0, sc.h, z0 - 0.5, ax1, sc.h + 0.5, z1 + 0.5, { nav: false });
    // a little shrine: pedestal, lamp strip and an old tag on the back wall
    const px = side * (s.W / 2 + 1 + sc.depth * 0.55);
    gb.box(px - 0.4, 0, sc.z - 0.4, px + 0.4, 0.7, sc.z + 0.4, M.trim, { tint: 0.8 });
    gb.box(px - 0.42, 0.7, sc.z - 0.42, px + 0.42, 0.76, sc.z + 0.42, M.accent, { faces: FACES.PY | FACES.PX | FACES.NX | FACES.PZ | FACES.NZ });
    gb.box(ax0 + 0.3, sc.h - 0.12, sc.z - 0.6, ax1 - 0.3, sc.h, sc.z + 0.6, M.lamp, { faces: FACES.NY });
    const idx = Math.floor(rng.next() * 997);
    const tex = new THREE.CanvasTexture(graffitiCanvas(GRAFFITI[idx % GRAFFITI.length], idx));
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: false });
    const geo = new THREE.PlaneGeometry(2.2, 0.82);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(side > 0 ? ax1 - 0.52 : ax0 + 0.52, 1.6, sc.z);
    mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    room.group.add(mesh);
    room.disposables.push(tex, mat, geo);
  });

  // --- movers: lifts (rising columns), floating platforms, trams
  for (const m of s.movers || []) {
    const mg = new GeoBuilder(2);
    const w = m.w, d = m.d;
    let lamp = null;
    if (m.kind === 'lift') {
      const travel = Math.abs(m.ay) + 2;
      mg.box(-w / 2, -0.4, -d / 2, w / 2, 0, d / 2, M.trim, { tint: 0.85 });
      mg.box(-w / 2, -0.001, -d / 2, w / 2, 0.02, d / 2, M.grate, { faces: FACES.PY, tint: 1.1 });
      mg.box(-w / 2 - 0.02, -0.4, -d / 2 - 0.02, w / 2 + 0.02, -0.2, d / 2 + 0.02, M.hazard, { uvScale: 2, faces: 63 & ~FACES.PY & ~FACES.NY });
      mg.box(-w / 2 + 0.3, -travel - 0.4, -d / 2 + 0.3, w / 2 - 0.3, -0.4, d / 2 - 0.3, M.trim, { tint: 0.55, faces: 63 & ~FACES.PY & ~FACES.NY });
      for (let k = 1; k < travel; k += 1.2) mg.box(-w / 2 + 0.28, -k - 0.45, -d / 2 + 0.28, w / 2 - 0.28, -k - 0.4, d / 2 - 0.28, M.accent, { faces: 63 & ~FACES.PY & ~FACES.NY, tint: 0.6 });
    } else if (m.kind === 'plat') {
      const t = m.thick || 0.45;
      mg.box(-w / 2, -t, -d / 2, w / 2, 0, d / 2, M.trim, { tint: 0.8 });
      mg.box(-w / 2, -0.001, -d / 2, w / 2, 0.02, d / 2, M.grate, { faces: FACES.PY, tint: 1.15 });
      mg.box(-w / 2 - 0.02, -t * 0.6, -d / 2 - 0.02, w / 2 + 0.02, -t * 0.4, d / 2 + 0.02, M.accent, { faces: 63 & ~FACES.PY & ~FACES.NY });
      mg.box(-0.5, -t - 0.03, -0.5, 0.5, -t, 0.5, M.lamp, { faces: FACES.NY });
    } else if (m.kind === 'tram') {
      buildTram(mg, M, m);
    }
    const built = mg.build();
    room.group.add(built.group);
    room.disposables.push(...built.geos);
    if (m.kind === 'tram') {
      lamp = new THREE.Mesh(R.lampGeo, R.warnOff);
      lamp.position.set(0, m.h + 0.55, 0);
      built.group.add(lamp);
      // the track: rails + sleepers + buffer stops
      const z = m.z, ext = Math.abs(m.ax) + m.w;
      const xa = m.x + Math.min(0, m.ax) - m.w / 2 - 0.6, xb = m.x + Math.max(0, m.ax) + m.w / 2 + 0.6;
      for (const o of [-0.75, 0.75]) gb.box(xa, 0, z + o - 0.06, xb, 0.08, z + o + 0.06, M.trim, { tint: 1.3, faces: 63 & ~FACES.NY });
      for (let x = xa + 0.3; x < xb; x += 0.9) gb.box(x, 0, z - 1.05, x + 0.3, 0.04, z + 1.05, M.crate, { tint: 0.45, faces: FACES.PY | FACES.PX | FACES.NX });
      for (const bx of [xa - 1.1, xb + 0.6]) {
        gb.box(bx, 0, z - 1.0, bx + 0.5, 0.9, z + 1.0, M.hazard, { uvScale: 2 });
        room.addCollider(bx, 0, z - 1.0, bx + 0.5, 0.9, z + 1.0, { surface: 'metal', nav: true });
      }
      void ext;
    }
    const col = room.addCollider(0, 0, 0, 0, 0, 0, { surface: 'metal', nav: false });
    col.navBlock = m.kind === 'lift';
    col.mover = true;
    const mv = { ...m, group: built.group, col, lamp, lx: m.x, ly: m.y, lz: m.z, speed: 0, dirX: 0, dirZ: 0, horn: false };
    placeMover(room, mv, 0);
    room.movers.push(mv);
  }

  // --- crushers: ceiling pistons with a floor marker and warning lamps
  for (const c of s.crushers || []) {
    const H = s.H;
    gb.box(c.x - c.w / 2, 0, c.z - c.d / 2, c.x + c.w / 2, 0.012, c.z + c.d / 2, M.hazard, { faces: FACES.PY, uvScale: 1.5 });
    gb.box(c.x - c.w / 2 + 0.25, 0.006, c.z - c.d / 2 + 0.25, c.x + c.w / 2 - 0.25, 0.016, c.z + c.d / 2 - 0.25, M.dark, { faces: FACES.PY });
    gb.box(c.x - c.w / 2 - 0.4, H - 0.6, c.z - c.d / 2 - 0.4, c.x + c.w / 2 + 0.4, H, c.z + c.d / 2 + 0.4, M.trim, { tint: 0.6, faces: 63 & ~FACES.PY });
    const hg = new GeoBuilder(2);
    hg.box(-c.w / 2, 0.15, -c.d / 2, c.w / 2, 1.1, c.d / 2, M.trim, { tint: 0.85 });
    hg.box(-c.w / 2 - 0.03, 0.55, -c.d / 2 - 0.03, c.w / 2 + 0.03, 0.85, c.d / 2 + 0.03, M.hazard, { uvScale: 2, faces: 63 & ~FACES.PY & ~FACES.NY });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const tx = -c.w / 2 + (i + 0.5) * c.w / 3, tz = -c.d / 2 + (j + 0.5) * c.d / 3;
      hg.box(tx - 0.22, 0, tz - 0.22, tx + 0.22, 0.15, tz + 0.22, M.trim, { tint: 0.5 });
    }
    hg.box(-0.45, 1.1, -0.45, 0.45, H + 3, 0.45, M.trim, { tint: 0.65, faces: 63 & ~FACES.PY & ~FACES.NY });
    hg.box(-0.5, 1.1, -0.5, 0.5, 1.5, 0.5, M.accent2, { tint: 0.6, faces: 63 & ~FACES.PY & ~FACES.NY });
    const built = hg.build();
    room.group.add(built.group);
    room.disposables.push(...built.geos);
    // all four warning lamps in one mesh: one draw call, one material swap to blink
    const lg = new GeoBuilder(2);
    for (const [lx, lz] of [[0, -c.d / 2 - 0.12], [0, c.d / 2 + 0.12], [-c.w / 2 - 0.12, 0], [c.w / 2 + 0.12, 0]]) lg.box(lx - 0.17, 0.87, lz - 0.17, lx + 0.17, 1.09, lz + 0.17, R.warnOff);
    const lb = lg.build();
    built.group.add(lb.group);
    room.disposables.push(...lb.geos);
    const lamps = [lb.meshes.get(R.warnOff)];
    const mark = new THREE.Mesh(R.markGeo, R.markOn);
    mark.scale.set(c.w - 0.5, 1, c.d - 0.5);
    mark.position.set(c.x, 0.03, c.z);
    mark.visible = false;
    room.group.add(mark);
    const high = c.high || Math.min(H - 1.6, 4.2);
    const col = room.addCollider(c.x - c.w / 2, high, c.z - c.d / 2, c.x + c.w / 2, H + 1, c.z + c.d / 2, { surface: 'metal', nav: false });
    const cr = { ...c, high, group: built.group, lamps, mark, col, bottom: high, lastK: 0, warnOn: false, hitSet: new Set() };
    built.group.position.set(c.x, high, c.z);
    room.crushers.push(cr);
  }

  // --- steam vents
  for (const v of s.vents || []) {
    const vy = v.y || 0;
    gb.cylinder(v.x, vy + 0.03, v.z, 1.05, 0.06, 'y', 8, M.trim, { tint: 0.6 });
    gb.cylinder(v.x, vy + 0.065, v.z, 0.85, 0.01, 'y', 8, M.grate, { tint: 0.5 });
    gb.cylinder(v.x, vy + 0.07, v.z, 1.08, 0.04, 'y', 8, M.hazard, { caps: false });
    // a short exhaust stack on the wall-side rim reads as "steam outlet" from across the room
    gb.box(v.x - 0.18, vy, v.z + 0.85, v.x + 0.18, vy + 0.5, v.z + 1.05, M.trim, { tint: 0.5 });
    const jet = new THREE.Mesh(R.jetGeo, v.cold ? R.coldSteam : R.steam);
    jet.position.set(v.x, vy + 2.1, v.z);
    jet.visible = false;
    room.group.add(jet);
    room.vents.push({ ...v, y: vy, jet, wx: room.wx(v.x), wz: room.wz(v.z), active: false, cd: 0 });
  }

  // --- grapple anchors: a ring on a chain, with its own collider so the hook catches it
  for (const a of s.anchors || []) {
    gb.box(a.x - 0.04, a.y + 0.45, a.z - 0.04, a.x + 0.04, s.H, a.z + 0.04, M.trim, { tint: 0.5 });
    gb.box(a.x - 0.35, s.H - 0.12, a.z - 0.35, a.x + 0.35, s.H, a.z + 0.35, M.trim, { tint: 0.7, faces: 63 & ~FACES.PY });
    const ring = new THREE.Mesh(R.ringGeo, R.anchor);
    ring.position.set(a.x, a.y, a.z);
    room.group.add(ring);
    const col = room.addCollider(a.x - 0.45, a.y - 0.45, a.z - 0.45, a.x + 0.45, a.y + 0.45, a.z + 0.45, { surface: 'metal', nav: false, tag: 'anchor', solid: false });
    room.anchors.push({ ...a, ring, col, lit: 0, wp: new THREE.Vector3(room.wx(a.x), a.y, room.wz(a.z)) });
  }

  // --- shutters (opened by switches) and the switches themselves
  for (const gt of s.gates || []) {
    const gg = new GeoBuilder(2);
    const w = gt.x1 - gt.x0, d = gt.z1 - gt.z0, h = gt.h || s.H;
    gg.box(0, 0, 0, w, h, d, M.wall, { tint: 0.7 });
    for (let y = 0.4; y < h; y += 0.55) gg.box(-0.02, y, -0.02, w + 0.02, y + 0.08, d + 0.02, M.trim, { tint: 0.5, faces: 63 & ~FACES.PY & ~FACES.NY });
    gg.box(-0.03, 0, -0.03, w + 0.03, 0.5, d + 0.03, M.hazard, { uvScale: 2, faces: 63 & ~FACES.NY });
    const built = gg.build();
    built.group.position.set(gt.x0, 0, gt.z0);
    room.group.add(built.group);
    room.disposables.push(...built.geos);
    const col = room.addCollider(gt.x0, 0, gt.z0, gt.x1, h, gt.z1, { surface: 'metal', nav: true });
    const gate = { ...gt, h, group: built.group, col, open: 0, target: 0, sw: null };
    room.gates.push(gate);
    if (gt.breaker) {
      // a breaker panel bolted to the shutter's near face: shoot, punch or blast it to open up
      const nx = gt.pnx || 0, nz = gt.pnz || 0, y = 1.7;
      const cx = (gt.x0 + gt.x1) / 2 + nx * (w / 2 + 0.02), cz = (gt.z0 + gt.z1) / 2 + nz * (d / 2 + 0.02);
      const pg = new GeoBuilder(2);
      const lx = cx - gt.x0, lz = cz - gt.z0;
      if (nx) pg.box(lx - (nx > 0 ? 0 : 0.12), y - 0.7, lz - 0.7, lx + (nx > 0 ? 0.12 : 0), y + 0.7, lz + 0.7, M.hazard, { uvScale: 2 });
      else pg.box(lx - 0.7, y - 0.7, lz - (nz > 0 ? 0 : 0.12), lx + 0.7, y + 0.7, lz + (nz > 0 ? 0.12 : 0), M.hazard, { uvScale: 2 });
      const pb = pg.build();
      built.group.add(pb.group);
      room.disposables.push(...pb.geos);
      const target = new THREE.Mesh(R.targetGeo, R.warnOn);
      target.position.set(lx + nx * 0.16, y, lz + nz * 0.16);
      if (nz) target.rotation.y = Math.PI / 2;
      built.group.add(target);
      const tx = cx + nx * 0.2, tz = cz + nz * 0.2;
      const scol = room.addCollider(tx - 0.45, y - 0.5, tz - 0.45, tx + 0.45, y + 0.5, tz + 0.45, { surface: 'metal', nav: false, tag: 'barrel', solid: false });
      const o = { kind: 'switch', action: 'gate', gate: room.gates.length - 1, room, target, col: scol, on: false, side: 0, wp: new THREE.Vector3(room.wx(cx + nx * 0.3), y, room.wz(cz + nz * 0.3)) };
      scol.ref = o;
      gate.sw = o;
      room.switches.push(o);
    }
  }
  for (const sw of s.switches || []) {
    const side = sw.side, wx = side * s.W / 2, y = sw.y || 1.7;
    const xi = side < 0 ? wx : wx - 0.16, xo = side < 0 ? wx + 0.16 : wx;
    gb.box(xi, y - 0.75, sw.z - 0.75, xo, y + 0.75, sw.z + 0.75, M.trim, { tint: 0.7 });
    gb.box(side < 0 ? xo : xi - 0.02, y - 0.85, sw.z - 0.85, side < 0 ? xo + 0.02 : xi, y + 0.85, sw.z + 0.85, M.hazard, { uvScale: 2, faces: side < 0 ? FACES.PX : FACES.NX });
    // cable run from the switch to the ceiling: shows it drives something
    gb.box(wx - side * 0.1 - 0.05, y + 0.75, sw.z - 0.05, wx - side * 0.1 + 0.05, s.H, sw.z + 0.05, M.accent2, { tint: 0.5 });
    const target = new THREE.Mesh(R.targetGeo, R.warnOn);
    target.position.set(wx - side * 0.24, y, sw.z);
    room.group.add(target);
    const col = room.addCollider(Math.min(wx, wx - side * 0.4), y - 0.5, sw.z - 0.5, Math.max(wx, wx - side * 0.4), y + 0.5, sw.z + 0.5, { surface: 'metal', nav: false, tag: 'barrel' });
    const o = { ...sw, kind: 'switch', room, target, col, on: false, wp: new THREE.Vector3(room.wx(wx - side * 0.3), y, room.wz(sw.z)) };
    col.ref = o;
    room.switches.push(o);
  }

  // --- speed gates (ring track): an arch that rewards passing through at speed
  for (const sg of s.speedGates || []) {
    const hw = sg.w / 2, h = 3.4;
    if (sg.axis === 'x') {
      for (const x of [sg.x - hw - 0.3, sg.x + hw]) gb.box(x, 0, sg.z - 0.2, x + 0.3, h, sg.z + 0.2, M.trim);
      gb.box(sg.x - hw - 0.3, h, sg.z - 0.2, sg.x + hw + 0.3, h + 0.35, sg.z + 0.2, M.trim);
      gb.box(sg.x - hw, h - 0.06, sg.z - 0.22, sg.x + hw, h, sg.z + 0.22, M.accent, { faces: FACES.NY | FACES.PZ | FACES.NZ });
    } else {
      for (const z of [sg.z - hw - 0.3, sg.z + hw]) gb.box(sg.x - 0.2, 0, z, sg.x + 0.2, h, z + 0.3, M.trim);
      gb.box(sg.x - 0.2, h, sg.z - hw - 0.3, sg.x + 0.2, h + 0.35, sg.z + hw + 0.3, M.trim);
      gb.box(sg.x - 0.22, h - 0.06, sg.z - hw, sg.x + 0.22, h, sg.z + hw, M.accent, { faces: FACES.NY | FACES.PX | FACES.NX });
    }
    for (const sx of [-1, 1]) {
      const px = sg.axis === 'x' ? sg.x + sx * (hw + 0.15) : sg.x, pz = sg.axis === 'x' ? sg.z : sg.z + sx * (hw + 0.15);
      room.addCollider(px - 0.2, 0, pz - 0.2, px + 0.2, h, pz + 0.2, { surface: 'metal', nav: true });
    }
    const bar = new THREE.Mesh(R.barGeo, R.gateLit);
    bar.scale.x = sg.w;
    bar.position.set(sg.x, h + 0.18, sg.z);
    if (sg.axis !== 'x') bar.rotation.y = Math.PI / 2;
    bar.visible = false;
    room.group.add(bar);
    room.speedGates.push({ ...sg, bar, side: 0, cd: 0, flash: 0 });
  }

  // --- shallow water: a scrolling translucent sheet above the floor; outfalls pour into it
  if ((s.water || []).length || (s.falls || []).length) {
    const tex = R.waterTex.clone();
    tex.needsUpdate = true;
    // vertexColors + map + psx: the same program as the theme's screen material
    const mat = psxify(new THREE.MeshBasicMaterial({ map: tex, color: s.waterColor || 0x7ab8c8, transparent: true, opacity: 0.62, depthWrite: false, vertexColors: true }));
    room.disposables.push(mat, tex);
    room.waterTex = tex;
    for (const f of s.falls || []) {
      // outlet pipe mouth + a falling sheet + foam at the bottom
      const ns = f.side === 'n' || f.side === 's';
      const geo = whiteColors(new THREE.PlaneGeometry(f.w, f.y - 0.25));
      const fm = new THREE.Mesh(geo, mat);
      const off = f.side === 'e' ? -0.35 : f.side === 'w' ? 0.35 : f.side === 'n' ? 0.35 : -0.35;
      fm.position.set(f.x + (ns ? 0 : off), (f.y + 0.25) / 2, f.z + (ns ? off : 0));
      fm.rotation.y = f.side === 'e' ? -Math.PI / 2 : f.side === 'w' ? Math.PI / 2 : f.side === 's' ? Math.PI : 0;
      room.group.add(fm);
      room.disposables.push(geo);
      if (ns) gb.box(f.x - f.w / 2 - 0.2, f.y, f.z - (f.side === 'n' ? 0 : 0.7), f.x + f.w / 2 + 0.2, f.y + 0.7, f.z + (f.side === 'n' ? 0.7 : 0), M.trim, { tint: 0.6 });
      else gb.box(f.x - (f.side === 'e' ? 0.7 : 0), f.y, f.z - f.w / 2 - 0.2, f.x + (f.side === 'w' ? 0.7 : 0), f.y + 0.7, f.z + f.w / 2 + 0.2, M.trim, { tint: 0.6 });
      room.fallList.push({ wx: room.wx(f.x + (ns ? 0 : off * 2)), wz: room.wz(f.z + (ns ? off * 2 : 0)), w: f.w });
    }
    for (const w of s.water) {
      const geo = whiteColors(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0));
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w.x1 - w.x0) / 3, uv.getY(i) * (w.z1 - w.z0) / 3);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((w.x0 + w.x1) / 2, 0.28, (w.z0 + w.z1) / 2);
      room.group.add(mesh);
      room.disposables.push(geo);
      room.waters.push({ wx0: room.wx(w.x0), wx1: room.wx(w.x1), wz0: room.wz(w.z0), wz1: room.wz(w.z1), mesh });
    }
  }
}

function drawBreakable(dg, M, b, room) {
  const { x0, y0, z0, x1, y1, z1 } = b;
  const t = b.tint || 1;
  switch (b.kind) {
    case 'crate': {
      dg.box(x0, y0, z0, x1, y1, z1, M.crate, { tint: t, faces: 63 & ~FACES.NY });
      const e = 0.07;
      dg.box(x0 - 0.02, y1 - e, z0 - 0.02, x1 + 0.02, y1 + 0.01, z1 + 0.02, M.trim, { tint: 0.7, faces: 63 & ~FACES.NY });
      dg.box(x0 - 0.02, y0 + (y1 - y0) * 0.45, z0 - 0.02, x1 + 0.02, y0 + (y1 - y0) * 0.55, z1 + 0.02, M.trim, { tint: 0.55, faces: 63 & ~FACES.NY & ~FACES.PY });
      break;
    }
    case 'cover': {
      dg.box(x0, y0, z0, x1, y1, z1, M.concrete, { tint: t, faces: 63 & ~FACES.NY });
      dg.box(x0 - 0.04, y1, z0 - 0.04, x1 + 0.04, y1 + 0.08, z1 + 0.04, M.trim, { faces: 63 & ~FACES.NY });
      dg.box(x0 - 0.02, y0, z0 - 0.02, x1 + 0.02, y0 + 0.3, z1 + 0.02, M.hazard, { uvScale: 2, faces: 63 & ~FACES.NY & ~FACES.PY });
      break;
    }
    case 'rack': {
      dg.box(x0, y0, z0, x1, y1, z1, M.dark, {});
      dg.box(x0 - 0.02, y1 - 0.12, z0 - 0.02, x1 + 0.02, y1, z1 + 0.02, M.trim, { tint: 0.6 });
      const alongZ = z1 - z0 > x1 - x0;
      const len = alongZ ? z1 - z0 : x1 - x0;
      const seed = Math.floor((x0 * 7 + z0 * 13) * 10) & 1023;
      for (let r = 0; r < 7; r++) {
        const y = y0 + 0.3 + r * ((y1 - y0 - 0.6) / 7);
        const l = 0.3 + ((seed + r * 37) % 9) / 9 * (len - 0.6);
        const m = r % 3 === 0 ? M.accent2 : M.accent;
        if (alongZ) {
          dg.box(x0 - 0.02, y, z0 + 0.2, x0, y + 0.05, z0 + 0.2 + l, m, { faces: FACES.NX });
          dg.box(x1, y, z1 - 0.2 - l, x1 + 0.02, y + 0.05, z1 - 0.2, m, { faces: FACES.PX });
        } else {
          dg.box(x0 + 0.2, y, z0 - 0.02, x0 + 0.2 + l, y + 0.05, z0, m, { faces: FACES.NZ });
          dg.box(x1 - 0.2 - l, y, z1, x1 - 0.2, y + 0.05, z1 + 0.02, m, { faces: FACES.PZ });
        }
      }
      break;
    }
    case 'wall': {
      // cracked panel: the room-facing side shows glowing fissures
      dg.box(x0, y0, z0, x1, y1, z1, M.wall, { tint: 0.82 });
      const side = b.side || 1;
      const fx = side > 0 ? x0 - 0.015 : x1, fx1 = side > 0 ? x0 : x1 + 0.015;
      const zc = (z0 + z1) / 2, h = y1 - y0;
      const cracks = [[0, 0.15, 0.06, 0.55], [-0.3, 0.5, 0.05, 0.3], [0.25, 0.42, 0.05, 0.35], [-0.1, 0.68, 0.05, 0.25], [0.45, 0.2, 0.04, 0.22]];
      for (const [dz, fy, wz, fh] of cracks) dg.box(fx, y0 + h * fy, zc + dz - wz, fx1, y0 + h * (fy + fh), zc + dz + wz, M.accent2, { faces: side > 0 ? FACES.NX : FACES.PX, tint: 0.85 });
      dg.box(fx, y0 + h * 0.38, zc - 0.55, fx1, y0 + h * 0.38 + 0.06, zc + 0.4, M.accent2, { faces: side > 0 ? FACES.NX : FACES.PX, tint: 0.7 });
      dg.box(fx, y0, z0, fx1, y0 + 0.25, z1, M.dark, { faces: side > 0 ? FACES.NX : FACES.PX });
      break;
    }
    case 'grate': {
      dg.box(x0, y0, z0, x1, y1, z1, M.trim, { tint: 0.75, faces: 63 & ~FACES.PY });
      dg.box(x0, y1 - 0.01, z0, x1, y1 + 0.02, z1, M.grate, { faces: FACES.PY, tint: 1.2 });
      dg.box(x0 + 0.1, y0 - 0.02, z0 + 0.1, x1 - 0.1, y0, z1 - 0.1, M.accent2, { faces: FACES.NY, tint: 0.6 });
      break;
    }
    case 'crumble': {
      dg.box(x0, y0, z0, x1, y1, z1, M.concrete, { tint: t, faces: 63 & ~FACES.NY });
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      dg.box(x0 + 0.2, y1, cz - 0.03, cx + 0.3, y1 + 0.012, cz + 0.03, M.dark, { faces: FACES.PY });
      dg.box(cx - 0.03, y1, z0 + 0.3, cx + 0.03, y1 + 0.012, z1 - 0.1, M.dark, { faces: FACES.PY });
      dg.box(x0, y1, z0, x1, y1 + 0.006, z0 + 0.08, M.accent2, { faces: FACES.PY, tint: 0.5 });
      break;
    }
    case 'glass': {
      if (b.skylight) {
        // roof skylight: frame, ribbed glass top that glows from the room below
        dg.box(x0, y0, z0, x1, y1 - 0.25, z1, M.trim, { tint: 0.7, faces: 63 & ~FACES.NY });
        dg.box(x0 + 0.12, y1 - 0.25, z0 + 0.12, x1 - 0.12, y1, z1 - 0.12, M.lamp, { tint: 0.45, faces: 63 & ~FACES.NY });
        for (let x = x0 + 0.6; x < x1 - 0.3; x += 0.6) dg.box(x - 0.04, y1, z0 + 0.1, x + 0.04, y1 + 0.04, z1 - 0.1, M.trim, { tint: 0.5 });
      } else {
        dg.box(x0, y0, z0, x1, y1, z1, M.accent, { tint: 0.35 });
        dg.box(x0 - 0.03, y0, z0 - 0.03, x1 + 0.03, y0 + 0.15, z1 + 0.03, M.trim, {});
      }
      break;
    }
    case 'brick': {
      // crumbling masonry: darker courses, cracks on both faces, rubble at the foot
      dg.box(x0, y0, z0, x1, y1, z1, M.concrete, { tint: 0.62 });
      const alongZ = z1 - z0 > x1 - x0;
      for (let y = y0 + 0.5; y < y1 - 0.2; y += 0.5) {
        if (alongZ) { dg.box(x0 - 0.01, y, z0, x0, y + 0.05, z1, M.trim, { faces: FACES.NX, tint: 0.5 }); dg.box(x1, y, z0, x1 + 0.01, y + 0.05, z1, M.trim, { faces: FACES.PX, tint: 0.5 }); }
        else { dg.box(x0, y, z0 - 0.01, x1, y + 0.05, z0, M.trim, { faces: FACES.NZ, tint: 0.5 }); dg.box(x0, y, z1, x1, y + 0.05, z1 + 0.01, M.trim, { faces: FACES.PZ, tint: 0.5 }); }
      }
      const len = alongZ ? z1 - z0 : x1 - x0, c0 = alongZ ? z0 : x0;
      for (const [f, fy, fh] of [[0.3, 0.1, 0.5], [0.55, 0.35, 0.35], [0.7, 0.15, 0.25]]) {
        const a = c0 + len * f, h = y1 - y0;
        if (alongZ) { dg.box(x0 - 0.02, y0 + h * fy, a - 0.05, x0, y0 + h * (fy + fh), a + 0.05, M.accent2, { faces: FACES.NX, tint: 0.7 }); dg.box(x1, y0 + h * fy, a - 0.05, x1 + 0.02, y0 + h * (fy + fh), a + 0.05, M.accent2, { faces: FACES.PX, tint: 0.7 }); }
        else { dg.box(a - 0.05, y0 + h * fy, z0 - 0.02, a + 0.05, y0 + h * (fy + fh), z0, M.accent2, { faces: FACES.NZ, tint: 0.7 }); dg.box(a - 0.05, y0 + h * fy, z1, a + 0.05, y0 + h * (fy + fh), z1 + 0.02, M.accent2, { faces: FACES.PZ, tint: 0.7 }); }
      }
      break;
    }
    default: dg.box(x0, y0, z0, x1, y1, z1, M.crate, { tint: t });
  }
  void room;
}

function buildTram(mg, M, m) {
  const w = m.w, d = m.d, h = m.h;
  mg.box(-w / 2, 0.35, -d / 2, w / 2, h, d / 2, M.trim, { tint: 0.95 });
  mg.box(-w / 2 + 0.3, 0, -d / 2 + 0.25, w / 2 - 0.3, 0.35, d / 2 - 0.25, M.dark, { faces: 63 & ~FACES.PY & ~FACES.NY });
  // livery stripe, window band and roof gear
  mg.box(-w / 2 - 0.02, 0.9, -d / 2 - 0.02, w / 2 + 0.02, 1.15, d / 2 + 0.02, M.accent2, { faces: FACES.PZ | FACES.NZ | FACES.PX | FACES.NX, tint: 0.8 });
  for (let x = -w / 2 + 0.5; x < w / 2 - 0.9; x += 1.4) {
    mg.box(x, 1.5, -d / 2 - 0.02, x + 1.0, 2.3, d / 2 + 0.02, M.lamp, { faces: FACES.PZ | FACES.NZ, tint: 0.55 });
  }
  mg.box(-w / 2 - 0.02, 1.5, -d / 2 + 0.25, w / 2 + 0.02, 2.3, d / 2 - 0.25, M.lamp, { faces: FACES.PX | FACES.NX, tint: 0.4 });
  mg.box(-w / 2 + 0.6, h, -d / 2 + 0.3, w / 2 - 0.6, h + 0.25, d / 2 - 0.3, M.trim, { tint: 0.6, faces: 63 & ~FACES.NY });
  mg.box(-0.15, h + 0.25, -0.6, 0.15, h + 0.95, 0.6, M.trim, { tint: 0.5 });
  for (const sx of [-1, 1]) {
    mg.box(sx * w / 2 - (sx > 0 ? 0.02 : -0.02) - 0.02, 0.55, -d / 2 + 0.25, sx * w / 2 + 0.02 * sx, 0.85, -d / 2 + 0.7, M.lamp, { faces: sx > 0 ? FACES.PX : FACES.NX });
    mg.box(sx * w / 2 - 0.02 * -sx - 0.02, 0.55, d / 2 - 0.7, sx * w / 2 + 0.02 * sx, 0.85, d / 2 - 0.25, M.lamp, { faces: sx > 0 ? FACES.PX : FACES.NX });
    mg.box(sx * w / 2 - (sx > 0 ? 0.05 : -0.05) - 0.05, 0.35, -d / 2, sx * w / 2 + 0.05 * sx, h, -d / 2 + 0.08, M.hazard, { uvScale: 2, faces: FACES.NZ });
  }
}

function placeMover(room, m, dt) {
  const u = moverU(m, room.time);
  const nx = m.x + m.ax * u, ny = m.y + m.ay * u, nz = m.z + m.az * u;
  const dx = nx - m.lx, dy = ny - m.ly, dz = nz - m.lz;
  m.lx = nx; m.ly = ny; m.lz = nz;
  m.group.position.set(nx, ny, nz);
  const c = m.col;
  m.prevTop = c.maxY;
  c.minX = room.wx(nx - m.w / 2); c.maxX = room.wx(nx + m.w / 2);
  c.minZ = room.wz(nz - m.d / 2); c.maxZ = room.wz(nz + m.d / 2);
  if (m.kind === 'plat') { c.minY = ny - (m.thick || 0.45); c.maxY = ny; } else if (m.kind === 'tram') { c.minY = 0; c.maxY = m.h; } else { c.minY = 0; c.maxY = ny; }
  if (dt > 0) {
    const l = Math.hypot(dx, dz);
    m.speed = Math.hypot(dx, dy, dz) / dt;
    m.dirX = l > 1e-5 ? dx / l : 0; m.dirZ = l > 1e-5 ? dz / l : 0;
  }
  MV[0] = dx; MV[1] = dy; MV[2] = dz;
  return MV;
}

// ---------------------------------------------------------------- update
export function updateFeatures(room, dt, player) {
  const g = room.game;
  // only the room the player is in can hurt, launch or carry anyone
  const live = g.state === 'playing' && room === room.level.current;
  const enemies = live ? g.enemies.list : NONE;
  const pb = player.body;
  const cols = room.level.colliders;
  const powered = room.powerOff <= 0;
  if (room.powerOff > 0) room.powerOff -= dt;
  if (room.waterTex) room.waterTex.offset.y -= dt * 0.35;
  for (const sw of room.switches) {
    if (sw.rearm > 0) { sw.rearm -= dt; if (sw.rearm <= 0) { sw.on = false; sw.target.material = room.level.featRes.warnOn; } }
  }
  // drained water: sheets sink out of sight, then refill
  if (room.drained > 0) {
    room.drained -= dt;
    const k = room.drained > 1.5 ? Math.max(0, 1 - (room.drainT - room.drained) * 0.8) : 1 - room.drained / 1.5;
    for (const w of room.waters) { w.mesh.position.y = 0.28 * k - 0.02; w.mesh.visible = k > 0.05; }
  }
  if (live && room.fallList.length && Math.random() < dt * 10) {
    const f = room.fallList[(Math.random() * room.fallList.length) | 0], c = room.waterColor;
    g.fx.sparks.spawn(f.wx + (Math.random() - 0.5) * f.w, 0.35, f.wz + (Math.random() - 0.5) * f.w * 0.4, (Math.random() - 0.5) * 2, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 2, c.r, c.g, c.b, 0.9, 0.1, 0.5, 12, 1, 0.28);
  }

  // movers: move, carry riders, push / ram anything in the way
  for (const m of room.movers) {
    if (!powered && m.kind === 'tram') { m.speed = 0; continue; }
    const d = placeMover(room, m, dt), dx = d[0], dy = d[1], dz = d[2];
    if (m.lamp) {
      const wait = moverWait(m, room.time);
      const warn = wait < 1.0;
      m.lamp.material = warn || wait === Infinity ? (Math.sin(room.time * 18) > 0 || wait === Infinity ? room.level.featRes.warnOn : room.level.featRes.warnOff) : room.level.featRes.goOn;
      if (warn && !m.horn) { m.horn = true; g.audio.play('alert', tmpV.set(m.col.minX + m.w / 2, 2, m.col.minZ + m.d / 2), 0.35); }
      if (!warn) m.horn = false;
    }
    if (!dx && !dy && !dz) continue;
    if (!live) continue;
    carry(room, m, pb, true, dx, dy, dz, cols);
    for (const e of enemies) if (e.alive && e.body && !e.flying) carry(room, m, e.body, false, dx, dy, dz, cols, e);
  }

  // crushers
  for (const c of room.crushers) updateCrusher(room, c, dt, pb, enemies, powered, live);

  // vents
  for (const v of room.vents) {
    const cyc = v.on + v.off;
    const k = ((room.time + v.phase) % cyc + cyc) % cyc;
    const was = v.active;
    v.active = powered && k < v.on;
    const warn = powered && !v.active && k > cyc - 0.7;
    v.jet.visible = v.active;
    if (v.active) {
      const f = Math.min(1, k * 6);
      v.jet.scale.set(0.8 + Math.sin(room.time * 30) * 0.12, f, 0.8 + Math.cos(room.time * 27) * 0.12);
      v.jet.position.y = 2.1 * f;
      if (!was) g.audio.play('sizzle', tmpV.set(v.wx, 0.5, v.wz), 0.7);
      if (Math.random() < 0.6) g.fx.sparks.spawn(v.wx + (Math.random() - 0.5) * 0.8, v.y + 0.3, v.wz + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.5, 7 + Math.random() * 5, (Math.random() - 0.5) * 1.5, 0.75, 0.8, 0.85, 0.8, 0.35, 0.5, -2, 1.5);
      v.cd -= dt;
      if (live && v.cd <= 0 && ventLaunch(v, pb, v.power * (room.cond === 'lowgrav' ? 0.75 : 1))) {
        v.cd = 0.4;
        player.sliding = false;
        g.audio.play('pad', null, 0.8);
        g.fx.ring(v.wx, 0.2, v.wz, 2.0, 0xd8e8f0, 0.35);
        if (player.emit) player.emit('pad');
      }
      for (const e of enemies) if (e.alive && e.body && !e.flying && !e.mini && !e.heavy && ventLaunch(v, e.body, v.power * 0.75)) e.stagger = Math.max(e.stagger || 0, 0.8);
    } else if (warn && Math.random() < 0.25) {
      g.fx.sparks.spawn(v.wx + (Math.random() - 0.5) * 0.6, 0.15, v.wz + (Math.random() - 0.5) * 0.6, 0, 2 + Math.random() * 2, 0, 0.6, 0.65, 0.7, 0.7, 0.25, 0.4, -1, 1);
    }
  }

  // anchors light up while hooked
  const hook = player.hook;
  for (const a of room.anchors) {
    a.ring.rotation.y += dt * 1.2;
    const hooked = hook && hook.pulling && hook.point && Math.abs(hook.point.x - a.wp.x) < 1.2 && Math.abs(hook.point.y - a.wp.y) < 1.2 && Math.abs(hook.point.z - a.wp.z) < 1.2;
    if (hooked && !a.lit) { g.style.add('SWING', 6, true); g.fx.sparksBurst(a.wp, 0xffd060, 6, 3, 0.25, 0.08); }
    a.lit = hooked;
    a.ring.material = hooked ? room.level.featRes.anchorLit : room.level.featRes.anchor;
  }

  // gates
  for (const gt of room.gates) {
    if (gt.open === gt.target) continue;
    gt.open = Math.min(gt.target, gt.open + dt * 1.1);
    gt.group.position.y = gt.open * (gt.h - 0.4);
    const was = gt.col.active;
    gt.col.active = gt.open < 0.5;
    if (gt.sw) gt.sw.col.active = gt.open < 0.1;
    if (was && !gt.col.active) room.navDirty = 0.01;
  }

  // speed gates
  for (const sg of room.speedGates) {
    if (!live) break;
    sg.cd -= dt;
    if (sg.flash > 0) { sg.flash -= dt; sg.bar.visible = sg.flash > 0; }
    const p = pb.pos;
    const along = sg.axis === 'x' ? p.x - room.wx(sg.x) : p.z - room.wz(sg.z);
    const across = sg.axis === 'x' ? p.z - room.wz(sg.z) : p.x - room.wx(sg.x);
    const side = across > 0 ? 1 : -1;
    if (sg.side && side !== sg.side && Math.abs(along) < sg.w / 2 && p.y < 3.4 && sg.cd <= 0) {
      const sp = Math.hypot(pb.vel.x, pb.vel.z);
      if (sp > 14.5) {
        sg.cd = 1.2; sg.flash = 0.35; sg.bar.visible = true;
        g.style.add(sp > 22 ? 'SONIC GATE' : 'SPEED GATE', sp > 22 ? 18 : 10);
        g.audio.play('coin', null, 0.5);
        g.fx.ring(p.x, p.y + 1, p.z, 2.4, 0x9ffff0, 0.3);
      }
    }
    sg.side = side;
  }

  // dashing / sliding fast through a crate smashes it
  if (live && (player.dashT > 0 || (player.sliding && player.slideSpeed > 13))) {
    for (const d of room.destructibles) {
      if (d.broken || (d.type !== 'crate' && d.type !== 'glass')) continue;
      if (overlapsBox(pb, d.col, -0.25)) { breakDestructible(room, d); g.style.add(player.dashT > 0 ? 'BULLDOZER' : 'SKITTLES', 8, true); g.addShake(0.1); }
    }
  }
  // crumbling floor tiles: stepping on one starts the collapse (and so does landing hard nearby)
  const gbx = pb.grounded ? pb.groundBox : null;
  if (live && gbx && gbx.crumble && gbx.ref && !gbx.ref.broken && gbx.ref.t < 0) {
    gbx.ref.t = 0.5;
    g.audio.play('land', gbx.ref.c, 0.7);
    g.fx.sparksBurst(gbx.ref.c, 0xa09080, 6, 2, 0.3, 0.08);
  }
  for (const d of room.destructibles) {
    if (d.type !== 'crumble') continue;
    if (!d.broken && d.t >= 0) {
      d.t -= dt;
      if (Math.random() < 0.5) g.fx.sparks.spawn(d.c.x + (Math.random() - 0.5) * 1.6, d.src.y1, d.c.z + (Math.random() - 0.5) * 1.6, 0, -1, 0, 0.5, 0.45, 0.4, 0.8, 0.12, 0.5, 6, 0);
      if (d.t <= 0) breakDestructible(room, d, true);
    } else if (d.broken && d.regrow > 0) {
      d.regrow -= dt;
      if (d.regrow <= 0) regrow(room, d);
    }
  }

  if (room.navDirty > 0) {
    room.navDirty -= dt;
    if (room.navDirty <= 0) { room.navDirty = 0; room.rebuildNav(); }
  }
}

function carry(room, m, body, isPlayer, dx, dy, dz, cols, enemy) {
  const c = m.col, g = room.game;
  const p = body.pos;
  const riding = body.grounded && body.groundBox === c && Math.abs(p.y - (c.maxY - dy)) < 0.2;
  if (riding) {
    p.y = c.maxY;
    if (dx || dz) {
      // the mover's own box must not block its rider
      const was = c.active; c.active = false;
      const gb = body.groundBox;
      const savedVx = body.vel.x, savedVz = body.vel.z;
      // moveBody zeroes velocity on wall hits; riders keep their own steering
      moveBodyLite(body, dx, dz, cols);
      body.vel.x = savedVx; body.vel.z = savedVz;
      c.active = was;
      body.grounded = true; body.groundBox = gb;
    }
    return;
  }
  if (!overlapsBox(body, c, 0.02)) return;
  if (p.y >= c.maxY - 0.7 && (dy > 0 || m.kind !== 'tram')) {
    p.y = c.maxY + 0.001;
    if (body.vel.y < 0) body.vel.y = 0;
    body.grounded = true; body.groundBox = c;
    return;
  }
  pushOut(body, c, m.kind === 'tram' ? m.dirX : 0, m.kind === 'tram' ? m.dirZ : 0);
  if (m.kind === 'tram' && m.speed > 3.5) {
    if (isPlayer) {
      if (g.time - (m.hitT || -9) > 0.8) {
        m.hitT = g.time;
        // thrown clear of the rails (sideways), not ahead of the tram into a second hit
        const px = -m.dirZ, pz = m.dirX, off = (p.x - (c.minX + c.maxX) / 2) * px + (p.z - (c.minZ + c.maxZ) / 2) * pz;
        const sd = off >= 0 ? 1 : -1;
        body.vel.x = m.dirX * 5 + px * sd * 13; body.vel.z = m.dirZ * 5 + pz * sd * 13; body.vel.y = 6.5; body.grounded = false;
        g.player.damage(24, { x: p.x - m.dirX, z: p.z - m.dirZ }, 'TRAM', 'Trams flash red and sound a horn before they move. Stay off the rails or ride on the roof.');
        g.addShake(0.3);
      }
    } else if (enemy && (enemy.envHitT || 0) < g.time) {
      enemy.envHitT = g.time + 0.7;
      g.combat.damageEnemy(enemy, enemy.mini ? 60 : 160, { source: 'hazard', dir: tmpV2.set(m.dirX, 0.4, m.dirZ), knock: 14, point: enemy.centerPos(), fromPlayer: false });
      if (!enemy.alive) g.style.add('ROADKILL', 35);
    }
  }
}

// horizontal-only collision sweep (no grounding side effects) for carried riders
function moveBodyLite(body, dx, dz, cols) {
  const p = body.pos;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25));
  for (let s = 0; s < steps; s++) {
    p.x += dx / steps;
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (!b.active || !b.solid || !overlapsBox(body, b)) continue;
      if (b.maxY - p.y <= 0.05) continue;
      p.x = dx > 0 ? b.minX - body.r - 0.001 : b.maxX + body.r + 0.001;
    }
    p.z += dz / steps;
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (!b.active || !b.solid || !overlapsBox(body, b)) continue;
      if (b.maxY - p.y <= 0.05) continue;
      p.z = dz > 0 ? b.minZ - body.r - 0.001 : b.maxZ + body.r + 0.001;
    }
  }
}

// a vent's jet throws whoever stands over it (unless they are already flying up faster)
function ventLaunch(v, body, power) {
  const p = body.pos;
  if (Math.hypot(p.x - v.wx, p.z - v.wz) > 1.1 || p.y > v.y + 1.2 || p.y < v.y - 0.3 || body.vel.y > power * 0.6) return false;
  body.vel.y = power; body.grounded = false;
  return true;
}

function updateCrusher(room, c, dt, pb, enemies, powered, live) {
  const g = room.game, R = room.level.featRes;
  const P = c.period;
  const k = ((room.time + c.phase) % P + P) % P;
  let bottom;
  const warn = k > P - 0.95;
  if (!powered) bottom = Math.min(c.high, c.bottom + dt * 2);
  else if (k < 0.16) bottom = c.high * (1 - (k / 0.16) * (k / 0.16));
  else if (k < 0.8) bottom = 0;
  else if (k < 2.1) bottom = c.high * smooth((k - 0.8) / 1.3);
  else bottom = c.high;
  const prev = c.bottom;
  c.bottom = bottom;
  const jitter = warn && powered ? Math.sin(room.time * 60) * 0.03 : 0;
  c.group.position.y = bottom + jitter;
  c.col.minY = bottom;
  // telegraph: blinking lamps + floor marker
  const lampOn = warn && powered ? Math.sin(room.time * 22) > 0 : k < 0.8 && powered;
  if (lampOn !== c.warnOn) { c.warnOn = lampOn; for (const l of c.lamps) l.material = lampOn ? R.warnOn : R.warnOff; }
  c.mark.visible = powered && (warn || k < 0.8);
  if (warn && !c.warned && powered) { c.warned = true; g.audio.play('windup', tmpV.set(room.wx(c.x), 2, room.wz(c.z)), 0.45); }
  if (!warn) c.warned = false;
  // impact
  if (prev > 0.01 && bottom <= 0.01) {
    const wp = tmpV.set(room.wx(c.x), 0.2, room.wz(c.z));
    g.audio.play('slam', wp, 0.9);
    g.fx.sparksBurst(wp, 0xb0a890, 14, 7, 0.45, 0.12);
    g.fx.ring(wp.x, 0.1, wp.z, Math.max(c.w, c.d) * 0.9, 0xffb060, 0.3);
    const dp = Math.hypot(pb.pos.x - wp.x, pb.pos.z - wp.z);
    if (dp < 9) g.addShake(0.3 * (1 - dp / 9));
    c.hitSet.clear();
  }
  if (bottom >= prev || bottom > 2.2 || !live) return;
  // anything under a descending head is crushed and shoved clear
  const col = c.col;
  const hit = (body) => body.pos.x + body.r - 0.1 > col.minX && body.pos.x - body.r + 0.1 < col.maxX && body.pos.z + body.r - 0.1 > col.minZ && body.pos.z - body.r + 0.1 < col.maxZ && body.pos.y + body.h > bottom && body.pos.y < bottom + 0.6;
  if (hit(pb) && !c.hitSet.has(pb)) {
    c.hitSet.add(pb);
    g.player.damage(45, { x: room.wx(c.x), z: room.wz(c.z) }, 'CRUSHER', 'Crushers blink red and mark the floor before they drop. Cross right after a slam.');
    pushOut(pb, col);
    pb.vel.y = 3;
  } else if (hit(pb)) pushOut(pb, col);
  for (const e of enemies) {
    if (!e.alive || !e.body || e.flying || !hit(e.body)) continue;
    pushOut(e.body, col);
    if (c.hitSet.has(e)) continue;
    c.hitSet.add(e);
    g.combat.damageEnemy(e, e.mini ? 90 : 400, { source: 'hazard', dir: tmpV2.set(0, -1, 0), knock: 4, point: e.centerPos(), fromPlayer: false });
    if (!e.alive) { g.style.add('CRUSHED', 40); g.fx.blood(e.centerPos(), tmpV2.set(0, 1, 0), 2, e.bloodColor); }
  }
}

// ---------------------------------------------------------------- damage / interaction
export function damageDestructible(room, d, amount, src) {
  if (d.broken || amount <= 0) return;
  if (src === 'shot' && d.bulletproof) {
    if (d.secret >= 0 && !d.thunk) { d.thunk = true; room.game.audio.play('shieldHit', d.c, 0.35); }
    return;
  }
  d.hp -= amount;
  if (d.hp <= 0) breakDestructible(room, d);
  else if (src !== 'shot') room.game.fx.chunks(d.c, CHUNK[d.type] || 0x888888, 3, 4, 0.12);
}

export function breakDestructible(room, d, quiet = false) {
  if (d.broken) return;
  const g = room.game;
  d.broken = true;
  d.col.active = false;
  hideRanges(room.dMeshes, d.ranges);
  const big = d.type === 'wall' || d.type === 'cover' || d.type === 'rack';
  g.fx.chunks(d.c, CHUNK[d.type] || 0x888888, big ? 14 : 8, big ? 7 : 5, big ? 0.22 : 0.16);
  if (d.type === 'rack') {
    g.fx.sparksBurst(d.c, 0x60c0ff, 22, 8, 0.5, 0.1);
    g.audio.play('zap', d.c, 0.8);
    room.pendingBlasts.push({ t: 0.18, p: d.c.clone(), r: 3, dmg: 40 });
  } else if (d.type === 'glass') {
    g.fx.sparksBurst(d.c, 0xb8e8ff, 18, 6, 0.5, 0.08);
    g.audio.play('shieldBreak', d.c, 0.6);
  } else if (!quiet) {
    g.audio.play(big ? 'explosion' : 'gib', d.c, big ? 0.55 : 0.5);
  } else g.audio.play('land', d.c, 0.6);
  if (big) g.addShake(0.12);
  if (d.type === 'crate') g.style.add('SMASH', 3, true);
  if (d.type === 'crumble') { d.regrow = 7; d.t = -1; }
  if (d.nav) room.navDirty = room.navDirty || 0.15;
  if (d.secret >= 0) revealSecret(room, room.secretList[d.secret]);
}

function regrow(room, d) {
  // never regrow into somebody standing in the tile's space
  const c = d.col, g = room.game;
  const busy = overlapsBox(g.player.body, c, -0.05) || g.enemies.list.some((e) => e.alive && e.body && overlapsBox(e.body, c, -0.05));
  if (busy) { d.regrow = 0.5; return; }
  d.ranges.forEach((r, i) => {
    const m = room.dMeshes.get(r.mat);
    const a = m.geometry.attributes.position;
    a.array.set(d.orig[i], r.start * 3);
    a.needsUpdate = true;
  });
  d.broken = false; d.col.active = true; d.hp = 1; d.t = -1;
  g.fx.sparksBurst(d.c, 0xc0b8a0, 8, 3, 0.3, 0.08);
}

function revealSecret(room, sc) {
  if (!sc || sc.found) return;
  sc.found = true;
  const g = room.game, s = room.spec;
  const x = room.wx(sc.side * (s.W / 2 + 1 + sc.depth * 0.55)), z = room.wz(sc.z);
  g.pickups.spawn('hp', new THREE.Vector3(x, 1.2, z - 0.3));
  const need = g.weapons.neediest ? g.weapons.neediest() : null;
  if (need) g.pickups.spawn('ammo', new THREE.Vector3(x, 1.2, z + 0.3), { weapon: need });
  else g.pickups.spawn('hp', new THREE.Vector3(x, 1.2, z + 0.3));
  g.style.add('SECRET', 60);
  g.hud.toast('SECRET FOUND', '#ffd060');
  g.audio.play('cache', new THREE.Vector3(x, 1, z), 0.9);
  g.emit('secret', { room: room.index });
  room.secretsFound = (room.secretsFound || 0) + 1;
}

export function activateSwitch(room, sw) {
  if (sw.on) return;
  sw.on = true;
  const g = room.game;
  sw.target.material = room.level.featRes.goOn;
  g.audio.play('door', sw.wp, 0.8);
  g.audio.play('beep', sw.wp, 0.7);
  g.fx.sparksBurst(sw.wp, 0x3effa0, 10, 4, 0.3, 0.08);
  if (sw.action === 'power') {
    room.powerOff = sw.dur || 9;
    g.hud.toast('POWER CUT · ' + Math.round(room.powerOff) + 's', '#3effa0', true);
    g.style.add('SABOTAGE', 15);
    sw.rearm = (sw.dur || 9) + 3; // re-arms once the power comes back
  } else if (sw.action === 'drain') {
    room.drained = room.drainT = sw.dur || 14;
    g.hud.toast('PUMPS ON · WATER DRAINING', '#3effa0', true);
    g.style.add('DRAINED', 10, true);
    g.audio.play('sizzle', sw.wp, 0.8);
    sw.rearm = (sw.dur || 14) + 4;
  } else {
    const gt = room.gates[sw.gate || 0];
    if (gt) gt.target = 1;
    g.hud.toast('SHORTCUT OPEN', '#3effa0', true);
    g.style.add('SHORTCUT', 10, true);
  }
}

// explosion / slam / melee at a world point
export function blastRoom(room, pos, radius, dmgK = 1) {
  if (!room.destructibles) return;
  for (const d of room.destructibles) {
    if (d.broken) continue;
    const c = d.col;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX)), cy = Math.max(c.minY, Math.min(pos.y, c.maxY)), cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dist = Math.hypot(cx - pos.x, cy - pos.y, cz - pos.z);
    if (dist > radius) continue;
    if (d.type === 'crumble') { if (d.t < 0) d.t = 0.05; continue; }
    damageDestructible(room, d, 14 * dmgK * (1 - dist / radius * 0.5) * (d.floor ? 0.6 : 1), 'blast');
  }
  for (const sw of room.switches) if (!sw.on && sw.wp.distanceTo(pos) < radius + 0.6) activateSwitch(room, sw);
}

export function meleeRoom(room, eye, dir) {
  if (!room.destructibles) return false;
  let hit = false;
  for (const d of room.destructibles) {
    if (d.broken || d.floor) continue;
    const c = d.col;
    const cx = Math.max(c.minX, Math.min(eye.x, c.maxX)), cy = Math.max(c.minY, Math.min(eye.y, c.maxY)), cz = Math.max(c.minZ, Math.min(eye.z, c.maxZ));
    const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 2.4) continue;
    if (dist > 0.3 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist < 0.35) continue;
    damageDestructible(room, d, d.type === 'wall' ? 12 : 6, 'melee');
    hit = true;
  }
  for (const sw of room.switches) {
    if (sw.on) continue;
    const dx = sw.wp.x - eye.x, dy = sw.wp.y - eye.y, dz = sw.wp.z - eye.z, dist = Math.hypot(dx, dy, dz);
    if (dist < 2.8 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist > 0.4) { activateSwitch(room, sw); hit = true; }
  }
  return hit;
}

// shallow water: returns true when the point is in (undrained) water
export function inWater(room, x, z) {
  if (room.drained > 1.5) return false;
  for (const w of room.waters) if (x > w.wx0 && x < w.wx1 && z > w.wz0 && z < w.wz1) return true;
  return false;
}

// delayed rack shorts (deferred so explosions never recurse into each other)
export function updateBlasts(room, dt) {
  if (!room.pendingBlasts.length) return;
  const g = room.game;
  for (let i = room.pendingBlasts.length - 1; i >= 0; i--) {
    const b = room.pendingBlasts[i];
    b.t -= dt;
    if (b.t > 0) continue;
    room.pendingBlasts.splice(i, 1);
    if (g.state !== 'playing' || room !== room.level.current) continue;
    g.fx.explosion(b.p, b.r, 0x60c0ff);
    g.combat.radialDamage(b.p, b.r, b.dmg, { source: 'explosion', noSelf: true, energy: true, knock: 6 });
  }
}
