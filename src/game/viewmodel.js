import * as THREE from 'three';
import { GeoBuilder } from '../world/builder.js';
import { psxify } from '../render/renderer.js';
import { damp, clamp } from '../core/collide.js';

// ---------------------------------------------------------------------------------------
// First-person presentation: six procedural viewmodels (plus variant parts) with moving
// pieces, a shared mechanical left arm (punch, parry, coin flick, reload hand, vault plant,
// wall touch), a slide-kick leg, muzzle flashes, spent casings and smoke puffs. Everything
// lives in the weapon camera's own scene (camera at the origin looking down -z).
// Pure feedback: nothing in here changes damage, fire rates or movement.
// ---------------------------------------------------------------------------------------

const IDS = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];
const TAU = Math.PI * 2;
const seg = (k, a, b) => (k <= a ? 0 : k >= b ? 1 : (k - a) / (b - a));
const sm = (x) => x * x * (3 - 2 * x);
const eOut = (x) => 1 - (1 - x) * (1 - x);
const bump = (k, a, b) => Math.sin(seg(k, a, b) * Math.PI);
const win = (k, a, b, c, d) => sm(seg(k, a, b)) * (1 - sm(seg(k, c, d)));

// Per weapon: hip pose, sight height (model space, the line that meets the screen centre when
// aiming), aim distance, recoil profile [push, flip, roll, jitter], flash [star, flame, width],
// left-hand support point (null = one-handed).
const CFG = {
  hammer: { hip: [0.2, -0.19, -0.4], rot: [0, 0.08, 0.05], sight: 0.1, adsZ: -0.42, recoil: [0.9, 1.9, 0.5, 0.25], flash: [1.15, 1.4, 1], gripL: null },
  ripsaw: { hip: [0.2, -0.2, -0.38], rot: [0, 0.09, 0.06], sight: 0.118, adsZ: -0.3, recoil: [0.75, 0.45, 0.6, 0.8], flash: [0.75, 0.9, 0.8], gripL: [-0.03, -0.075, -0.5] },
  breacher: { hip: [0.2, -0.2, -0.36], rot: [0, 0.09, 0.06], sight: 0.083, adsZ: -0.3, recoil: [1.3, 1.25, 0.45, 0.2], flash: [1.6, 1.15, 1.6], gripL: [-0.03, -0.062, -0.42] },
  lance: { hip: [0.21, -0.2, -0.36], rot: [0, 0.09, 0.05], sight: 0.135, adsZ: -0.26, recoil: [1.4, 0.8, 0.3, 0.1], flash: [1.25, 2.1, 0.7], gripL: [-0.035, -0.07, -0.3] },
  thumper: { hip: [0.21, -0.18, -0.38], rot: [0, 0.09, 0.05], sight: 0.13, adsZ: -0.36, recoil: [1.1, 1.0, 0.3, 0.2], flash: [1.05, 0.8, 1.4], gripL: [-0.02, -0.09, -0.38] },
  arc: { hip: [0.2, -0.17, -0.4], rot: [0, 0.1, 0.05], sight: 0.1, adsZ: -0.38, recoil: [0.35, 0.3, 0.8, 0.9], flash: [0.65, 0.3, 0.6], gripL: [-0.1, -0.08, -0.16] },
};
const SPLITTER_SIGHT = 0.112;

// camera-space anchors for the left arm
const SHOULDER_L = new THREE.Vector3(-0.3, -0.52, 0.14);
const HIDE_L = new THREE.Vector3(-0.26, -0.62, -0.3);
const PUNCH_L = new THREE.Vector3(-0.05, -0.11, -0.6);
const COIN_L = new THREE.Vector3(-0.1, -0.15, -0.42);
const WALL_L = new THREE.Vector3(-0.3, -0.12, -0.42);
const VAULT0 = new THREE.Vector3(-0.05, -0.11, -0.46), VAULT1 = new THREE.Vector3(-0.07, -0.44, -0.33);
const FETCH_L = new THREE.Vector3(-0.2, -0.5, -0.32); // off-screen pocket for magazines and shells
const HIP_K = new THREE.Vector3(0.04, -1.0, 0.25);

// ---------------------------------------------------------------- procedural textures
let rs = 90731;
const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };

function canvasTex(size, fill, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fill(x, y, size), i = (y * size + x) * 4;
    if (typeof v === 'number') { img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 255); img.data[i + 3] = 255; } else {
      img.data[i] = clamp(v[0], 0, 255); img.data[i + 1] = clamp(v[1], 0, 255); img.data[i + 2] = clamp(v[2], 0, 255); img.data[i + 3] = v.length > 3 ? clamp(v[3], 0, 255) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = repeat ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = repeat;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function vmTextures() {
  const rows = [];
  for (let i = 0; i < 64; i++) rows.push(rnd());
  const metal = canvasTex(64, (x, y) => {
    let v = 214 + (rows[y] - 0.5) * 22 + (rnd() - 0.5) * 12; // brushed streaks
    const yy = y % 32;
    if (yy === 0) v -= 70; else if (yy === 1) v += 24; // panel seam with a lit lip
    if (x % 32 === 0 && yy > 4 && yy < 27) v -= 30;
    if ((x % 32 === 4 || x % 32 === 27) && (yy === 5 || yy === 26)) v -= 80; // rivets
    if ((x % 32 === 5 || x % 32 === 28) && (yy === 4 || yy === 25)) v += 40;
    if (rnd() < 0.012) v += 50; // scratches
    return v;
  });
  const grip = canvasTex(64, (x, y) => 150 + (((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) ? -58 : 0) + (rnd() - 0.5) * 16);
  const wood = canvasTex(64, (x, y) => {
    const g = Math.sin((x * 0.55 + Math.sin(y * 0.11) * 5 + Math.sin(y * 0.031 + 1) * 9));
    return 168 + g * 30 + (rows[x] - 0.5) * 20 + (rnd() - 0.5) * 10;
  });
  const plate = canvasTex(64, (x, y) => {
    const px = x % 32, py = y % 32;
    let v = 168 + (rnd() - 0.5) * 18;
    if (px < 2 || py < 2) v = 222; else if (px > 29 || py > 29) v = 82;
    if ((px === 5 || px === 26) && (py === 5 || py === 26)) v = 70;
    if ((px === 6 || px === 27) && (py === 6 || py === 27)) v = 230;
    if (py === 16 && px > 8 && px < 24) v -= 40;
    return v;
  });
  return { metal, grip, wood, plate };
}

// Matcap from the view-space normal: a cool sky above, a dark horizon line, warm floor bounce
// and a hot key highlight. Banded on purpose (PS1 shading steps).
function matcapTex(hi) {
  return canvasTex(64, (i, j, s) => {
    const nx = (i + 0.5) / s * 2 - 1, ny = 1 - (j + 0.5) / s * 2;
    const r = Math.sqrt(nx * nx + ny * ny);
    let v = hi ? 0.62 + 0.3 * ny : 0.5 + 0.2 * ny;
    v -= (hi ? 0.4 : 0.15) * Math.exp(-(((ny + 0.16) / (hi ? 0.075 : 0.13)) ** 2));
    v += (hi ? 0.16 : 0.09) * sm(clamp((r - 0.72) / 0.28, 0, 1));
    const sx = nx + 0.38, sy = ny - 0.48;
    v += (hi ? 0.8 : 0.32) * Math.exp(-(sx * sx + sy * sy) / (hi ? 0.016 : 0.05));
    v = Math.round(clamp(v, 0, 1.25) * 12) / 12;
    const cool = 0.5 + 0.5 * ny;
    return [v * (0.98 - 0.14 * cool) * 255, v * (0.95 - 0.02 * cool) * 255, v * (0.84 + 0.2 * cool) * 255];
  }, false);
}

// additive flash sprites: an 8-point star with a hot core, and a side-on flame tongue
function starTex() {
  const reach = [];
  for (let i = 0; i < 8; i++) reach.push(0.5 + rnd() * 0.5);
  return canvasTex(64, (i, j, s) => {
    const dx = (i + 0.5) / s * 2 - 1, dy = (j + 0.5) / s * 2 - 1;
    const d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx) + Math.PI;
    const lobe = Math.floor(a / TAU * 8 + 0.5) % 8;
    const sp = Math.pow(Math.abs(Math.cos(a * 4)), 5);
    let v = clamp(1 - d / (0.22 + 0.78 * sp * reach[lobe]), 0, 1);
    v = v * v + Math.exp(-d * d / 0.03) * 0.9;
    v = Math.round(clamp(v, 0, 1) * 8) / 8;
    return v * 255;
  }, false);
}
function flameTex() {
  return canvasTex(64, (i, j, s) => {
    const u = (i + 0.5) / s, v = (j + 0.5) / s; // v: 0 at the muzzle, 1 at the tip
    const wdt = 0.08 + 0.42 * Math.pow(Math.sin(Math.min(1, v * 1.25) * Math.PI * 0.5 + 0.0001), 0.5) * Math.pow(1 - v, 0.7);
    let k = clamp(1 - Math.abs(u - 0.5) / Math.max(0.02, wdt), 0, 1);
    k = k * k * (1 - v * 0.6) + Math.exp(-(((u - 0.5) / 0.07) ** 2)) * (1 - v) * 0.7;
    k = Math.round(clamp(k, 0, 1) * 8) / 8;
    return k * 255;
  }, false);
}
function puffTex() {
  return canvasTex(32, (i, j, s) => {
    const dx = (i + 0.5) / s * 2 - 1, dy = (j + 0.5) / s * 2 - 1;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = clamp(1 - d, 0, 1) ** 1.6 * (0.75 + rnd() * 0.25);
    return [255, 255, 255, Math.round(a * 6) / 6 * 255];
  }, false);
}

let SHARED = null;
function vmMaterials() {
  if (SHARED) return SHARED;
  const T = vmTextures();
  const CHROME = matcapTex(true), SATIN = matcapTex(false);
  const mc = (cap, color, map) => psxify(new THREE.MeshMatcapMaterial({ matcap: cap, color, map, vertexColors: true }));
  const L = (map, color) => psxify(new THREE.MeshLambertMaterial({ map, color, vertexColors: true }));
  const B = (color) => new THREE.MeshBasicMaterial({ color, vertexColors: true });
  SHARED = {
    chrome: mc(CHROME, 0xdfe3ea, T.metal),
    metal: mc(CHROME, 0x8f96a4, T.metal),
    dark: mc(SATIN, 0x454a58, T.metal),
    black: mc(SATIN, 0x1e2028, T.grip),
    brass: mc(CHROME, 0xe6b860, null),
    wood: L(T.wood, 0x9a5630),
    glove: L(T.grip, 0x2e2e38),
    armor: mc(SATIN, 0x6a7080, T.plate),
    armorL: mc(SATIN, 0x3f6fd0, T.plate),
    red: L(T.metal, 0xc02424),
    glow: B(0xffffff),
    armGlow: B(0x5ae8ff),
    tex: T,
  };
  return SHARED;
}

// ---------------------------------------------------------------- geometry helpers
const _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _eu = new THREE.Euler(), _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const B = (gb, x0, y0, z0, x1, y1, z1, m, tint) => gb.box(x0, y0, z0, x1, y1, z1, m, { tint });
const C = (gb, x, y, z, r, len, axis, segs, m, tint, rot) => gb.cylinder(x, y, z, r, len, axis, segs, m, { tint, rot });
// Bake a rotation + offset into everything fn() adds (angled grips, curved mags, teeth).
function T(gb, rot, pos, fn) {
  const before = new Map();
  for (const [mat, b] of gb.buckets) before.set(mat, b.pos.length);
  fn();
  _m4.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2])), _one);
  _n3.getNormalMatrix(_m4);
  for (const [mat, b] of gb.buckets) {
    for (let i = before.get(mat) || 0; i < b.pos.length; i += 3) {
      _v.set(b.pos[i], b.pos[i + 1], b.pos[i + 2]).applyMatrix4(_m4);
      b.pos[i] = _v.x; b.pos[i + 1] = _v.y; b.pos[i + 2] = _v.z;
      _v.set(b.nrm[i], b.nrm[i + 1], b.nrm[i + 2]).applyMatrix3(_n3).normalize();
      b.nrm[i] = _v.x; b.nrm[i + 1] = _v.y; b.nrm[i + 2] = _v.z;
    }
  }
}
function piece(build, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const gb = new GeoBuilder(0.3);
  build(gb);
  const grp = new THREE.Group();
  grp.add(gb.build().group);
  grp.position.set(pos[0], pos[1], pos[2]);
  grp.rotation.set(rot[0], rot[1], rot[2]);
  return grp;
}

// Right hand wrapped round a pistol grip (grip space: top at y=0, front face at z=gf).
function rightHand(gb, M, gw = 0.022, gf = -0.03, gk = 0.036, gh = 0.12) {
  B(gb, gw - 0.002, -gh + 0.012, gf + 0.004, gw + 0.03, -0.012, gk + 0.026, M.glove); // back of the hand
  B(gb, gw + 0.006, -0.034, gf + 0.01, gw + 0.034, -0.014, gk + 0.016, M.armor, 0.9); // knuckle plate
  for (let i = 0; i < 3; i++) {
    const y0 = -0.04 - i * 0.026;
    B(gb, -gw - 0.008, y0 - 0.023, gf - 0.025, gw + 0.022, y0, gf + 0.002, M.glove, 0.92 - i * 0.06); // wrapped fingers
    B(gb, -gw - 0.01, y0 - 0.021, gf - 0.022, -gw + 0.004, y0 - 0.002, gf + 0.03, M.glove, 0.78);
  }
  B(gb, -0.007, -0.021, gf - 0.062, 0.011, -0.005, gf - 0.002, M.glove, 0.88); // trigger finger
  B(gb, -gw - 0.013, -0.032, gf - 0.03, -gw + 0.002, -0.01, gk + 0.006, M.glove, 0.72); // thumb over the left
}
// Forearm from the wrist (origin) back along +z towards the shoulder.
function forearm(gb, M, glowMat, plates, len = 0.5, w = 0.036, h = 0.033) {
  B(gb, -w * 0.78, -h * 0.8, -0.03, w * 0.78, h * 0.8, 0.05, M.glove);
  B(gb, -w - 0.004, -h - 0.004, 0.035, w + 0.004, h + 0.004, 0.065, M.metal, 0.75); // cuff ring
  B(gb, -w, -h, 0.06, w, h, len, M.glove, 0.8);
  B(gb, -w - 0.007, h - 0.016, 0.08, w + 0.007, h + 0.01, len * 0.6, plates, 1.1); // top plate
  B(gb, -w - 0.009, -h * 0.5, 0.1, -w + 0.002, h * 0.6, len * 0.75, plates, 0.85); // side plates
  B(gb, w - 0.002, -h * 0.5, 0.1, w + 0.009, h * 0.6, len * 0.75, plates, 0.85);
  B(gb, -0.007, h + 0.01, 0.1, 0.007, h + 0.017, len * 0.5, glowMat); // power strip
  B(gb, -w - 0.011, -0.006, 0.14, -w - 0.007, 0.006, len * 0.6, glowMat);
}

// ---------------------------------------------------------------- weapon models
function buildModel(id, M, acc) {
  const root = new THREE.Group();
  const anim = { var: {} };
  const add = (p) => { root.add(p); return p; };
  const P = (build, pos, rot) => add(piece(build, pos, rot));
  const V = (vid, build, pos, rot) => { const pc = P(build, pos, rot); (anim.var[vid] = anim.var[vid] || []).push(pc); return pc; };
  // pistol grip + gripping hand + forearm, baked into one piece
  // (positive x-rotation tips +z downwards: grips rake back, forearms drop away to the shoulder)
  const gripArm = (gp, gr, gripBuild, armRot = [0.62, 0.12, 0]) => P((gb) => {
    T(gb, [-gr, 0, 0], gp, () => { gripBuild(gb); rightHand(gb, M); });
    T(gb, armRot, [gp[0] + 0.012, gp[1] - 0.1, gp[2] + 0.075], () => forearm(gb, M, M.armGlow, M.armor));
  });
  let muzzle;

  if (id === 'hammer') {
    // .50 revolver: heavy slab barrel with an underlug, vent rib, swing-out cylinder
    P((gb) => {
      B(gb, -0.021, 0.035, -0.43, 0.021, 0.076, -0.07, M.chrome);
      B(gb, -0.009, 0.076, -0.43, 0.009, 0.086, -0.07, M.dark);
      for (let z = -0.41; z < -0.1; z += 0.045) B(gb, -0.0095, 0.08, z, 0.0095, 0.087, z + 0.018, M.black);
      B(gb, -0.017, 0.006, -0.43, 0.017, 0.036, -0.12, M.chrome, 0.82); // underlug
      B(gb, -0.006, 0.0, -0.13, 0.006, 0.008, -0.06, M.dark); // ejector rod
      C(gb, 0, 0.055, -0.433, 0.025, 0.012, 'z', 8, M.dark);
      B(gb, -0.009, 0.046, -0.441, 0.009, 0.064, -0.438, M.black); // bore
      B(gb, -0.003, 0.086, -0.42, 0.003, 0.104, -0.396, M.dark); // front blade
      B(gb, -0.0035, 0.097, -0.397, 0.0035, 0.104, -0.393, M.glow, [1, 0.62, 0.22]);
      // frame: top strap over the cylinder window, lower frame, recoil shield
      B(gb, -0.022, 0.082, -0.075, 0.022, 0.094, 0.07, M.chrome);
      B(gb, -0.023, -0.014, -0.08, 0.023, -0.002, 0.11, M.chrome, 0.9);
      B(gb, -0.025, -0.014, 0.045, 0.025, 0.094, 0.11, M.chrome, 0.85);
      B(gb, -0.024, 0.0, -0.08, 0.024, 0.08, -0.066, M.chrome, 0.8);
      B(gb, -0.013, 0.094, 0.068, -0.004, 0.105, 0.09, M.dark); B(gb, 0.004, 0.094, 0.068, 0.013, 0.105, 0.09, M.dark); // rear notch
      B(gb, -0.0055, -0.058, -0.004, 0.0055, -0.05, 0.085, M.dark); // trigger guard
      B(gb, -0.0055, -0.058, -0.006, 0.0055, -0.012, 0.004, M.dark);
      B(gb, -0.004, -0.044, 0.042, 0.004, -0.012, 0.052, M.dark); // trigger
      // engraved side panels + accent strips (variant colour)
      B(gb, 0.021, 0.042, -0.36, 0.024, 0.07, -0.09, M.dark, 0.8);
      B(gb, 0.024, 0.052, -0.34, 0.026, 0.06, -0.11, acc); B(gb, -0.026, 0.052, -0.34, -0.024, 0.06, -0.11, acc);
      B(gb, 0.023, 0.006, 0.0, 0.026, 0.03, 0.04, M.dark); // crane latch
    });
    anim.cyl = P((gb) => {
      C(gb, 0, 0, 0, 0.044, 0.1, 'z', 12, M.chrome, 0.78, Math.PI / 12);
      for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * TAU; B(gb, Math.cos(a) * 0.042 - 0.006, Math.sin(a) * 0.042 - 0.006, -0.045, Math.cos(a) * 0.042 + 0.006, Math.sin(a) * 0.042 + 0.006, 0.045, M.black); }
      C(gb, 0, 0, -0.055, 0.03, 0.012, 'z', 6, M.dark);
      C(gb, 0, 0, 0.052, 0.012, 0.008, 'z', 6, M.dark);
    }, [0, 0.036, -0.012]);
    anim.rounds = piece((gb) => { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; C(gb, Math.cos(a) * 0.027, Math.sin(a) * 0.027, 0.052, 0.0105, 0.006, 'z', 6, M.brass); } });
    anim.cyl.add(anim.rounds);
    anim.cylHome = new THREE.Vector3(0, 0.036, -0.012);
    anim.spur = P((gb) => { B(gb, -0.007, 0, 0, 0.007, 0.04, 0.026, M.dark); B(gb, -0.009, 0.03, 0.016, 0.009, 0.042, 0.034, M.dark, 0.8); }, [0, 0.072, 0.105], [-0.5, 0, 0]);
    gripArm([0, -0.006, 0.1], 0.36, (gb) => {
      B(gb, -0.023, -0.145, -0.03, 0.023, 0.0, 0.038, M.wood);
      B(gb, -0.024, -0.152, -0.033, 0.024, -0.138, 0.041, M.dark);
      B(gb, -0.0245, -0.09, -0.012, 0.0245, -0.06, 0.02, M.brass, 0.85); // medallion
    });
    // MARKSMAN: coin rack on the left of the frame
    V('marksman', (gb) => {
      B(gb, -0.034, -0.01, -0.005, -0.025, 0.05, 0.04, M.dark);
      for (let i = 0; i < 3; i++) C(gb, -0.038, 0.034 - i * 0.017, 0.018, 0.017, 0.006, 'x', 8, M.brass, 1 - i * 0.1);
    });
    // PIERCER: ribbed shroud with charge rings and a capacitor
    V('piercer', (gb) => {
      B(gb, -0.028, 0.026, -0.405, 0.028, 0.082, -0.22, M.dark);
      for (const z of [-0.39, -0.345, -0.3, -0.255]) B(gb, -0.031, 0.023, z, 0.031, 0.085, z + 0.012, acc);
      B(gb, 0.026, 0.0, -0.2, 0.046, 0.03, -0.09, M.dark); B(gb, 0.045, 0.006, -0.19, 0.048, 0.024, -0.1, acc);
    });
    muzzle = new THREE.Vector3(0, 0.055, -0.45);
  } else if (id === 'ripsaw') {
    // battle rifle: silver upper, dark lower, holo sight, vented handguard, muzzle brake
    P((gb) => {
      B(gb, -0.034, 0.0, -0.32, 0.034, 0.068, 0.08, M.chrome);
      B(gb, -0.03, -0.042, -0.25, 0.03, 0.0, 0.07, M.dark);
      B(gb, 0.034, 0.016, -0.2, 0.037, 0.052, -0.07, M.black); // ejection port
      B(gb, -0.016, 0.068, -0.31, 0.016, 0.078, 0.06, M.dark); // top rail
      for (let z = -0.3; z < 0.05; z += 0.03) B(gb, -0.018, 0.078, z, 0.018, 0.083, z + 0.014, M.dark, 0.8);
      // holo sight (thin frame, floating dot)
      B(gb, -0.022, 0.078, -0.1, 0.022, 0.09, -0.02, M.dark);
      B(gb, -0.028, 0.088, -0.07, -0.021, 0.152, -0.055, M.dark); B(gb, 0.021, 0.088, -0.07, 0.028, 0.152, -0.055, M.dark);
      B(gb, -0.028, 0.146, -0.07, 0.028, 0.154, -0.055, M.dark);
      B(gb, -0.0022, 0.1158, -0.064, 0.0022, 0.1202, -0.062, M.glow, [1, 0.25, 0.3]);
      for (const [x, y] of [[-0.012, 0], [0.012, 0], [0, -0.012], [0, 0.012]]) B(gb, x - 0.0018, 0.118 + y - 0.0018, -0.064, x + 0.0018, 0.118 + y + 0.0018, -0.062, M.glow, [0.9, 0.3, 0.35]);
      // handguard + vents + accent
      B(gb, -0.04, -0.032, -0.62, 0.04, 0.058, -0.32, M.dark, 0.9);
      for (let z = -0.6; z < -0.35; z += 0.05) { B(gb, 0.04, 0.0, z, 0.043, 0.032, z + 0.026, M.black); B(gb, -0.043, 0.0, z, -0.04, 0.032, z + 0.026, M.black); }
      B(gb, 0.04, 0.04, -0.6, 0.043, 0.048, -0.34, acc); B(gb, -0.043, 0.04, -0.6, -0.04, 0.048, -0.34, acc);
      C(gb, 0, 0.02, -0.72, 0.014, 0.22, 'z', 6, M.chrome);
      B(gb, -0.022, 0.0, -0.88, 0.022, 0.04, -0.82, M.dark);
      for (const z of [-0.87, -0.85, -0.83]) { B(gb, 0.022, 0.008, z, 0.025, 0.032, z + 0.008, M.black); B(gb, -0.025, 0.008, z, -0.022, 0.032, z + 0.008, M.black); }
      B(gb, -0.004, 0.04, -0.86, 0.004, 0.06, -0.85, M.dark);
      // skeletal stock
      T(gb, [0.3, 0, 0], [0, 0.02, 0.08], () => {
        B(gb, -0.012, -0.02, 0.0, 0.012, 0.016, 0.22, M.dark);
        B(gb, -0.012, -0.1, 0.18, 0.012, 0.016, 0.22, M.dark);
        B(gb, -0.015, -0.11, 0.21, 0.015, 0.026, 0.24, M.black);
      });
      B(gb, -0.031, 0.044, -0.02, -0.03, 0.05, 0.06, M.glow, [0.35, 0.95, 0.8]);
    });
    anim.mag = P((gb) => {
      B(gb, -0.02, -0.1, -0.033, 0.02, 0.0, 0.033, M.dark);
      T(gb, [0.32, 0, 0], [0, -0.095, 0.0], () => { B(gb, -0.02, -0.1, -0.035, 0.02, 0.0, 0.03, M.dark); B(gb, -0.021, -0.112, -0.037, 0.021, -0.098, 0.033, M.metal); });
      B(gb, -0.008, 0.0, -0.02, 0.008, 0.009, 0.02, M.brass);
    }, [0, -0.04, -0.17], [0.12, 0, 0]);
    anim.magHome = new THREE.Vector3(0, -0.04, -0.17);
    anim.bolt = P((gb) => B(gb, 0.0, 0.0, 0, 0.004, 0.026, 0.1, M.metal), [0.033, 0.021, -0.19]);
    anim.handle = P((gb) => { B(gb, -0.018, 0, 0, 0, 0.012, 0.02, M.metal); B(gb, -0.022, -0.004, 0.0, -0.016, 0.016, 0.012, M.dark); }, [-0.034, 0.044, -0.0]);
    gripArm([0, -0.04, 0.04], 0.3, (gb) => B(gb, -0.022, -0.125, -0.026, 0.022, 0.0, 0.03, M.black));
    // SAWBLADE: spinning blade slung under the handguard
    V('sawblade', (gb) => { B(gb, -0.006, -0.04, -0.53, 0.006, -0.028, -0.47, M.dark); });
    anim.saw = V('sawblade', (gb) => {
      C(gb, 0, 0, 0, 0.058, 0.008, 'x', 10, M.chrome);
      C(gb, 0, 0, 0, 0.018, 0.014, 'x', 6, acc);
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; T(gb, [a, 0, 0], [0, 0, 0], () => B(gb, -0.003, 0.054, -0.006, 0.003, 0.068, 0.006, M.metal)); }
    }, [0, -0.082, -0.5]);
    // INFERNO: heat-sink fins that glow with heat, fuel canister
    V('inferno', (gb) => {
      for (let z = -0.6; z < -0.35; z += 0.05) B(gb, -0.05, -0.035, z, 0.05, 0.062, z + 0.016, acc);
      C(gb, 0, -0.072, -0.42, 0.026, 0.16, 'z', 8, M.red);
      B(gb, -0.004, -0.05, -0.47, 0.004, -0.03, -0.37, M.dark);
    });
    muzzle = new THREE.Vector3(0, 0.02, -0.9);
  } else if (id === 'breacher') {
    // pump shotgun: barrel over a magazine tube, heat shield, bead sight, shell carrier
    P((gb) => {
      B(gb, -0.038, -0.022, -0.2, 0.038, 0.066, 0.08, M.dark);
      B(gb, -0.039, 0.05, -0.2, 0.039, 0.058, 0.08, M.chrome, 0.8);
      B(gb, 0.038, 0.012, -0.15, 0.041, 0.046, -0.05, M.black); // ejection port
      B(gb, -0.02, -0.024, -0.17, 0.02, -0.021, -0.05, M.black); // loading port
      B(gb, -0.004, 0.066, 0.04, 0.004, 0.078, 0.07, M.dark); // rear groove posts
      C(gb, 0, 0.045, -0.48, 0.022, 0.56, 'z', 10, M.chrome);
      B(gb, -0.016, 0.058, -0.68, 0.016, 0.071, -0.24, M.dark); // heat shield
      for (let z = -0.66; z < -0.27; z += 0.05) B(gb, -0.012, 0.0705, z, 0.012, 0.072, z + 0.022, M.black);
      B(gb, -0.004, 0.071, -0.752, 0.004, 0.083, -0.742, M.glow, [1, 0.85, 0.5]); // bead
      C(gb, 0, 0.004, -0.42, 0.017, 0.45, 'z', 10, M.chrome, 0.78);
      C(gb, 0, 0.004, -0.65, 0.019, 0.02, 'z', 10, M.dark);
      B(gb, -0.012, -0.01, -0.68, 0.012, 0.06, -0.66, M.dark); // barrel clamp
      // breaching shotgun: pistol grip and a short buffer tube instead of a full stock
      B(gb, -0.03, -0.02, 0.08, 0.03, 0.05, 0.12, M.dark);
      T(gb, [0.55, 0, 0], [0, 0.01, 0.12], () => { C(gb, 0, 0, 0.07, 0.016, 0.14, 'z', 8, M.dark); B(gb, -0.022, -0.03, 0.13, 0.022, 0.02, 0.15, M.black); });
      for (let i = 0; i < 4; i++) { B(gb, -0.054, 0.0, -0.17 + i * 0.045, -0.04, 0.036, -0.135 + i * 0.045, M.red); B(gb, -0.055, 0.0, -0.17 + i * 0.045, -0.05, 0.036, -0.158 + i * 0.045, M.brass); }
      B(gb, 0.038, 0.02, -0.19, 0.041, 0.028, 0.06, acc);
    });
    anim.pump = P((gb) => {
      B(gb, -0.036, -0.024, -0.09, 0.036, 0.034, 0.09, M.wood, 0.9);
      for (let z = -0.08; z < 0.08; z += 0.025) B(gb, -0.038, -0.026, z, 0.038, 0.036, z + 0.01, M.black, 0.9);
      B(gb, -0.006, 0.02, 0.09, 0.006, 0.03, 0.27, M.metal); // action bar
    }, [0, 0, -0.42]);
    anim.pumpHome = -0.42;
    gripArm([0, -0.022, 0.07], 0.42, (gb) => B(gb, -0.024, -0.13, -0.026, 0.024, 0.0, 0.036, M.wood));
    // CORE EJECT: live core window on the receiver + side core tube
    V('core', (gb) => {
      B(gb, -0.014, 0.058, -0.15, 0.014, 0.07, -0.05, acc); B(gb, -0.018, 0.057, -0.155, 0.018, 0.06, -0.045, M.dark);
      C(gb, 0.058, -0.004, -0.06, 0.022, 0.12, 'z', 8, M.dark); C(gb, 0.058, -0.004, -0.06, 0.024, 0.034, 'z', 8, acc);
    });
    // PUMP CHARGE: three charge lamps + muzzle compensator
    anim.pumpMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0x401018 }));
    V('pump', (gb) => {
      for (let i = 0; i < 3; i++) B(gb, -0.012, 0.058, -0.17 + i * 0.04, 0.012, 0.072, -0.145 + i * 0.04, anim.pumpMats[i]);
      B(gb, -0.03, 0.026, -0.78, 0.03, 0.066, -0.7, M.dark);
      for (let z = -0.775; z < -0.71; z += 0.02) B(gb, -0.032, 0.03, z, 0.032, 0.062, z + 0.008, acc);
    });
    muzzle = new THREE.Vector3(0, 0.045, -0.8);
  } else if (id === 'lance') {
    // railcannon: twin rails round glowing coils, top vents, a rear capacitor cell
    P((gb) => {
      B(gb, -0.05, -0.03, -0.35, 0.05, 0.08, 0.15, M.chrome);
      B(gb, -0.044, 0.08, -0.33, 0.044, 0.09, 0.12, M.chrome, 0.85);
      B(gb, -0.038, -0.002, -0.78, -0.02, 0.032, -0.35, M.dark); B(gb, 0.02, -0.002, -0.78, 0.038, 0.032, -0.35, M.dark);
      B(gb, -0.04, 0.008, -0.79, -0.036, 0.022, -0.38, acc); B(gb, 0.036, 0.008, -0.79, 0.04, 0.022, -0.38, acc);
      B(gb, -0.008, 0.045, -0.74, 0.008, 0.058, -0.35, M.dark);
      B(gb, -0.03, -0.03, -0.36, 0.03, -0.012, -0.76, M.dark);
      for (let z = 0.0; z < 0.13; z += 0.04) B(gb, -0.055, 0.09, z, 0.055, 0.105, z + 0.02, M.dark);
      T(gb, [0.3, 0, 0], [0, 0.02, 0.15], () => { B(gb, -0.03, -0.08, 0.0, 0.03, 0.03, 0.22, M.dark); B(gb, -0.032, -0.1, 0.2, 0.032, 0.04, 0.24, M.black); });
      B(gb, 0.05, 0.0, -0.3, 0.054, 0.05, 0.1, M.dark); B(gb, 0.054, 0.02, -0.28, 0.056, 0.03, 0.08, M.glow, [0.3, 0.85, 1]);
      B(gb, -0.054, 0.0, -0.3, -0.05, 0.05, 0.1, M.dark); B(gb, -0.056, 0.02, -0.28, -0.054, 0.03, 0.08, M.glow, [0.3, 0.85, 1]);
    });
    anim.coils = P((gb) => { for (let i = 0; i < 4; i++) C(gb, 0, 0.025, -0.4 - i * 0.09, 0.058, 0.025, 'z', 8, M.glow, [0.25, 0.85, 1]); });
    anim.cell = P((gb) => {
      B(gb, -0.03, -0.06, -0.1, 0.03, 0.0, 0.1, M.dark);
      B(gb, -0.031, -0.05, -0.09, 0.031, -0.01, 0.09, M.glow, [0.3, 0.85, 1]);
      B(gb, -0.034, -0.064, 0.09, 0.034, 0.004, 0.11, M.metal);
    }, [0, -0.03, -0.15]);
    anim.cellHome = new THREE.Vector3(0, -0.03, -0.15);
    anim.ventL = P((gb) => B(gb, -0.045, 0, -0.08, 0, 0.008, 0.08, M.metal), [-0.002, 0.09, -0.18]);
    anim.ventR = P((gb) => B(gb, 0, 0, -0.08, 0.045, 0.008, 0.08, M.metal), [0.002, 0.09, -0.18]);
    P((gb) => B(gb, -0.03, 0.089, -0.26, 0.03, 0.091, -0.1, M.glow, [0.25, 0.85, 1])); // vent glow underneath
    gripArm([0, -0.03, 0.06], 0.3, (gb) => B(gb, -0.024, -0.13, -0.025, 0.024, 0, 0.035, M.dark));
    // SCOPE: rail scope with a lit lens
    V('scope', (gb) => {
      C(gb, 0, 0.135, -0.08, 0.021, 0.17, 'z', 8, M.dark);
      C(gb, 0, 0.135, -0.175, 0.027, 0.03, 'z', 8, M.dark);
      B(gb, -0.008, 0.105, -0.13, 0.008, 0.118, -0.11, M.dark); B(gb, -0.008, 0.105, -0.05, 0.008, 0.118, -0.03, M.dark);
      C(gb, 0, 0.135, -0.191, 0.02, 0.004, 'z', 8, acc);
    });
    // SPLITTER: prism at the muzzle, side fins, glowing iron sights
    V('splitter', (gb) => {
      B(gb, -0.07, 0.0, -0.7, -0.055, 0.05, -0.5, acc); B(gb, 0.055, 0.0, -0.7, 0.07, 0.05, -0.5, acc);
      B(gb, -0.003, 0.058, -0.72, 0.003, SPLITTER_SIGHT, -0.71, M.dark);
      B(gb, -0.0035, SPLITTER_SIGHT - 0.006, -0.712, 0.0035, SPLITTER_SIGHT, -0.708, acc);
      B(gb, -0.016, 0.09, 0.06, -0.006, SPLITTER_SIGHT + 0.006, 0.08, M.dark); B(gb, 0.006, 0.09, 0.06, 0.016, SPLITTER_SIGHT + 0.006, 0.08, M.dark);
    });
    anim.prism = V('splitter', (gb) => B(gb, -0.028, -0.028, -0.028, 0.028, 0.028, 0.028, acc), [0, 0.015, -0.81], [0.6, 0.78, 0.6]);
    muzzle = new THREE.Vector3(0, 0.015, -0.8);
  } else if (id === 'thumper') {
    // drum launcher: fat tube, ladder sight, 5-round revolving drum with live tips
    P((gb) => {
      C(gb, 0, 0.025, -0.36, 0.05, 0.42, 'z', 10, M.chrome, 0.9);
      for (const z of [-0.5, -0.42, -0.34, -0.26]) C(gb, 0, 0.025, z, 0.054, 0.018, 'z', 10, M.dark);
      C(gb, 0, 0.025, -0.585, 0.06, 0.05, 'z', 10, M.dark);
      C(gb, 0, 0.025, -0.611, 0.04, 0.004, 'z', 10, M.black);
      B(gb, -0.03, 0.074, -0.32, 0.03, 0.088, 0.1, M.dark); // carry handle bar
      B(gb, -0.02, 0.05, -0.32, 0.02, 0.074, -0.3, M.dark); B(gb, -0.02, 0.05, 0.08, 0.02, 0.074, 0.1, M.dark);
      // ladder sight + front post
      B(gb, -0.026, 0.088, -0.03, -0.019, 0.162, -0.02, M.dark); B(gb, 0.019, 0.088, -0.03, 0.026, 0.162, -0.02, M.dark);
      B(gb, -0.026, 0.156, -0.03, 0.026, 0.162, -0.02, M.dark);
      B(gb, -0.003, 0.075, -0.545, 0.003, 0.124, -0.535, M.dark);
      B(gb, -0.0035, 0.124, -0.544, 0.0035, 0.131, -0.536, M.glow, [1, 0.45, 0.2]);
      // drum housing plates
      B(gb, -0.032, -0.08, 0.012, 0.032, 0.07, 0.03, M.dark); B(gb, -0.032, -0.08, -0.155, 0.032, 0.07, -0.137, M.dark);
      B(gb, -0.012, -0.09, -0.15, 0.012, -0.075, 0.03, M.dark);
      // foregrip, stock
      B(gb, -0.018, -0.03, -0.42, 0.018, 0.0, -0.34, M.dark);
      B(gb, -0.016, -0.12, -0.4, 0.016, -0.03, -0.36, M.black);
      B(gb, -0.03, -0.075, 0.08, 0.03, 0.04, 0.12, M.dark);
      T(gb, [0.38, 0, 0], [0, -0.01, 0.12], () => { B(gb, -0.012, -0.02, 0.0, 0.012, 0.01, 0.22, M.dark); B(gb, -0.03, -0.06, 0.2, 0.03, 0.03, 0.23, M.black); });
      B(gb, 0.05, 0.004, -0.46, 0.054, 0.04, -0.2, acc); B(gb, -0.054, 0.004, -0.46, -0.05, 0.04, -0.2, acc);
    });
    anim.drum = P((gb) => {
      C(gb, 0, 0, 0, 0.078, 0.13, 'z', 10, M.dark);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; C(gb, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.0, 0.019, 0.134, 'z', 6, M.black); }
      C(gb, 0, 0, 0.0, 0.02, 0.15, 'z', 6, M.metal);
    }, [0, -0.005, -0.063]);
    anim.drumHome = new THREE.Vector3(0, -0.005, -0.063);
    anim.tips = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU;
      const tp = piece((gb) => { C(gb, 0, 0, 0, 0.015, 0.012, 'z', 6, M.glow, [1, 0.4, 0.2]); }, [Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.064]);
      anim.drum.add(tp); anim.tips.push(tp);
    }
    gripArm([0, -0.075, 0.09], 0.3, (gb) => B(gb, -0.024, -0.13, -0.025, 0.024, 0, 0.035, M.dark));
    // STICKY: mine pack on the side
    V('sticky', (gb) => { B(gb, -0.095, -0.03, -0.27, -0.056, 0.05, -0.17, M.red); B(gb, -0.098, 0.0, -0.26, -0.094, 0.03, -0.18, acc); B(gb, -0.09, 0.05, -0.25, -0.06, 0.058, -0.19, M.dark); });
    // FREEZEFRAME: cryo rings and a longer rocket tube
    V('freeze', (gb) => {
      C(gb, 0, 0.025, -0.65, 0.046, 0.08, 'z', 10, M.dark);
      C(gb, 0, 0.025, -0.6, 0.064, 0.02, 'z', 10, acc);
      C(gb, 0, 0.025, -0.52, 0.06, 0.015, 'z', 10, acc);
    });
    muzzle = new THREE.Vector3(0, 0.025, -0.69);
  } else if (id === 'arc') {
    // tesla projector: chunky body, twin spinning coils, prong emitter, side power core
    P((gb) => {
      B(gb, -0.065, -0.09, -0.22, 0.065, 0.03, 0.12, M.chrome, 0.9);
      B(gb, -0.055, 0.03, -0.2, 0.055, 0.045, 0.1, M.dark);
      T(gb, [0.3, 0, 0], [0, -0.02, 0.1], () => {
        B(gb, -0.075, -0.1, 0.0, 0.075, 0.03, 0.26, M.dark);
        for (let i = 0; i < 3; i++) B(gb, -0.077, -0.09, 0.04 + i * 0.08, 0.077, -0.07, 0.08 + i * 0.08, M.metal);
      });
      for (const [x, y] of [[-0.042, 0.02], [0.042, 0.02], [0, -0.075]]) {
        B(gb, x - 0.012, y - 0.012, -0.43, x + 0.012, y + 0.012, -0.2, M.dark);
        B(gb, x - 0.008, y - 0.008, -0.46, x + 0.008, y + 0.008, -0.43, M.glow, [0.8, 0.65, 1]);
      }
      C(gb, 0, -0.02, -0.25, 0.07, 0.04, 'z', 10, M.dark);
      // holo sight between the coils
      B(gb, -0.022, 0.045, -0.2, -0.016, 0.125, -0.19, M.dark); B(gb, 0.016, 0.045, -0.2, 0.022, 0.125, -0.19, M.dark);
      B(gb, -0.022, 0.12, -0.2, 0.022, 0.126, -0.19, M.dark);
      B(gb, -0.0022, 0.0978, -0.196, 0.0022, 0.1022, -0.194, M.glow, [0.85, 0.6, 1]);
      // core cage on the left
      for (const [y, z] of [[-0.06, -0.15], [0.0, -0.15], [-0.06, 0.05], [0.0, 0.05]]) B(gb, -0.1, y - 0.006, z - 0.006, -0.065, y + 0.006, z + 0.006, M.dark);
      B(gb, -0.104, -0.068, -0.16, -0.096, 0.008, 0.06, M.dark, 0.7);
      B(gb, 0.065, -0.05, -0.18, 0.068, -0.03, 0.08, acc);
    });
    anim.core = P((gb) => {
      C(gb, 0, 0, 0, 0.022, 0.17, 'z', 8, M.glow, [0.75, 0.55, 1]);
      C(gb, 0, 0, -0.09, 0.026, 0.016, 'z', 8, M.metal); C(gb, 0, 0, 0.09, 0.026, 0.016, 'z', 8, M.metal);
    }, [-0.082, -0.03, -0.05]);
    anim.coreHome = new THREE.Vector3(-0.082, -0.03, -0.05);
    anim.coils = P((gb) => {
      for (const x of [-0.045, 0.045]) {
        C(gb, x, 0.08, -0.06, 0.022, 0.07, 'y', 6, M.glow, [0.75, 0.6, 1]);
        for (const y of [0.055, 0.08, 0.105]) C(gb, x, y, -0.06, 0.026, 0.008, 'y', 6, M.metal);
        C(gb, x, 0.122, -0.06, 0.032, 0.014, 'y', 6, M.metal);
      }
    });
    gripArm([0, -0.09, 0.04], 0.32, (gb) => B(gb, -0.024, -0.12, -0.026, 0.024, 0, 0.034, M.black));
    P((gb) => { B(gb, -0.11, -0.1, -0.2, -0.065, -0.06, -0.12, M.black); }); // left handle block
    // EMP: capacitor dish behind the emitter
    V('emp', (gb) => { C(gb, 0, -0.02, -0.37, 0.09, 0.012, 'z', 12, acc); C(gb, 0, -0.02, -0.362, 0.072, 0.01, 'z', 12, M.dark); });
    // TESLA TETHER: clamp prongs and a cable spool
    V('tether', (gb) => {
      for (const [x, y] of [[-0.052, 0.03], [0.052, 0.03], [0, -0.09]]) B(gb, x - 0.01, y - 0.01, -0.5, x + 0.01, y + 0.01, -0.4, acc);
      C(gb, 0.085, -0.05, 0.02, 0.032, 0.03, 'x', 8, M.metal);
      C(gb, 0.085, -0.05, 0.02, 0.026, 0.034, 'x', 8, acc, 0.8);
    });
    muzzle = new THREE.Vector3(0, -0.02, -0.47);
  }

  const flash = new THREE.Group();
  flash.position.copy(muzzle);
  flash.visible = false;
  root.add(flash);
  root.userData = { muzzle, flash, anim, acc };
  root.visible = false;
  return root;
}

// The left arm: a blue mechanical arm (the punching arm). Hand at the origin, fingers towards
// -z, back of the hand +y, thumb on +x, forearm running back along +z to the shoulder.
function buildLeftArm(M) {
  const root = new THREE.Group();
  const wrist = new THREE.Group();
  root.add(wrist);
  wrist.add(piece((gb) => {
    B(gb, -0.04, -0.022, -0.046, 0.04, 0.022, 0.034, M.glove);
    B(gb, -0.042, 0.012, -0.05, 0.042, 0.03, 0.02, M.armorL, 1.1); // back plate
    B(gb, -0.04, 0.03, -0.052, 0.04, 0.036, -0.03, M.armGlow); // knuckle glow
    B(gb, -0.012, -0.024, -0.03, 0.012, -0.021, 0.0, M.armGlow); // palm core
  }));
  const fingers = piece((gb) => {
    for (let i = 0; i < 4; i++) {
      const x = -0.036 + i * 0.019;
      B(gb, x, -0.016, -0.04, x + 0.016, 0.016, 0.0, M.glove, 0.95 - i * 0.04);
      B(gb, x + 0.001, -0.014, -0.072, x + 0.015, 0.012, -0.038, M.glove, 0.85 - i * 0.04);
      B(gb, x + 0.002, 0.012, -0.036, x + 0.014, 0.019, -0.004, M.armorL, 0.9);
    }
  }, [0, 0, -0.046]);
  const thumb = piece((gb) => {
    B(gb, -0.009, -0.011, -0.042, 0.011, 0.011, 0.0, M.glove, 0.9);
    B(gb, -0.008, 0.008, -0.03, 0.01, 0.015, -0.006, M.armorL, 0.9);
  }, [0.04, -0.006, -0.012]);
  wrist.add(fingers, thumb);
  root.add(piece((gb) => {
    T(gb, [0, 0, 0], [0, 0, 0.04], () => forearm(gb, M, M.armGlow, M.armorL, 0.55, 0.038, 0.034));
  }));
  // props the hand carries during reloads
  const props = {};
  const prop = (name, build) => { const pc = piece(build); pc.visible = false; wrist.add(pc); props[name] = pc; };
  prop('loader', (gb) => { C(gb, 0, -0.04, -0.03, 0.03, 0.03, 'z', 6, M.dark); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; C(gb, Math.cos(a) * 0.022, -0.04 + Math.sin(a) * 0.022, -0.06, 0.009, 0.05, 'z', 6, M.brass); } });
  prop('mag', (gb) => { B(gb, -0.019, -0.13, -0.05, 0.019, -0.018, 0.0, M.dark); B(gb, -0.008, -0.022, -0.04, 0.008, -0.012, -0.01, M.brass); });
  prop('shell', (gb) => { C(gb, 0, -0.03, -0.035, 0.011, 0.045, 'z', 6, M.red); C(gb, 0, -0.03, -0.01, 0.0115, 0.01, 'z', 6, M.brass); });
  prop('cell', (gb) => { B(gb, -0.028, -0.07, -0.08, 0.028, -0.018, 0.04, M.dark); B(gb, -0.029, -0.062, -0.07, 0.029, -0.026, 0.03, M.glow, [0.3, 0.85, 1]); });
  prop('grenade', (gb) => { C(gb, 0, -0.035, -0.04, 0.017, 0.05, 'z', 6, M.black); C(gb, 0, -0.035, -0.07, 0.015, 0.012, 'z', 6, M.glow, [1, 0.4, 0.2]); });
  prop('canister', (gb) => { C(gb, 0, -0.04, -0.03, 0.02, 0.15, 'z', 8, M.glow, [0.75, 0.55, 1]); C(gb, 0, -0.04, -0.105, 0.024, 0.014, 'z', 8, M.metal); });
  root.visible = false;
  root.scale.setScalar(0.78);
  return { root, wrist, fingers, thumb, props };
}

function buildLeg(M) {
  const root = new THREE.Group();
  root.add(piece((gb) => {
    B(gb, -0.05, -0.04, -0.12, 0.05, 0.04, 0.06, M.armor); // boot
    B(gb, -0.054, -0.055, -0.13, 0.054, -0.035, 0.07, M.black); // sole
    B(gb, -0.046, 0.0, -0.135, 0.046, 0.03, -0.1, M.metal); // toe cap
    B(gb, -0.052, 0.0, -0.06, -0.048, 0.03, 0.04, M.armGlow); B(gb, 0.048, 0.0, -0.06, 0.052, 0.03, 0.04, M.armGlow);
    B(gb, -0.04, 0.04, -0.1, 0.04, 0.05, -0.02, M.metal, 0.8); // laces plate
    B(gb, -0.045, -0.035, 0.04, 0.045, 0.05, 0.6, M.glove, 0.85); // shin
    B(gb, -0.05, 0.03, 0.08, 0.05, 0.06, 0.45, M.armorL, 1.0);
    B(gb, -0.008, 0.06, 0.1, 0.008, 0.066, 0.4, M.armGlow);
  }));
  root.visible = false;
  return root;
}

// ---------------------------------------------------------------------------------------
export class Viewmodel {
  constructor(w) {
    this.w = w;
    this.game = w.game;
    const scene = w.scene;
    const M = this.M = vmMaterials();
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(0.82);
    scene.add(this.holder);
    this.models = {};
    for (const id of IDS) {
      const acc = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
      this.models[id] = buildModel(id, M, acc);
      this.holder.add(this.models[id]);
    }
    // shared muzzle flash (re-parented to whichever gun is out)
    const add = (mat) => new THREE.MeshBasicMaterial({ map: mat, color: 0xffd090, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.starMat = add(starTex());
    const flameT = flameTex();
    this.flameMat = add(flameT);
    this.coreMat = new THREE.MeshBasicMaterial({ map: this.starMat.map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const fl = new THREE.PlaneGeometry(0.11, 0.42); fl.translate(0, 0.21, 0); fl.rotateX(-Math.PI / 2); // lies along -z
    this.flash = new THREE.Group();
    this.fStar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), this.starMat);
    this.fCore = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), this.coreMat);
    this.fSide1 = new THREE.Mesh(fl, this.flameMat);
    this.fSide2 = new THREE.Mesh(fl, this.flameMat); this.fSide2.rotation.z = Math.PI / 2;
    this.fCore.position.z = 0.005;
    this.flash.add(this.fStar, this.fCore, this.fSide1, this.fSide2);
    // left arm, kick leg
    this.arm = buildLeftArm(M);
    scene.add(this.arm.root);
    this.leg = buildLeg(M);
    scene.add(this.leg);
    // parry burst at the palm
    this.parryFx = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: this.starMat.map, color: 0xffe23a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.parryFx.visible = false;
    scene.add(this.parryFx);
    // spent casings + smoke puffs + the flicked coin (camera-space, pooled)
    const casG = new THREE.CylinderGeometry(0.008, 0.008, 0.026, 6); casG.rotateZ(Math.PI / 2);
    const shellG = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6); shellG.rotateZ(Math.PI / 2);
    this.casings = [];
    // plain geometry has no colour attribute: these need materials without vertexColors
    this.brassMat = M.brass.clone(); this.brassMat.vertexColors = false;
    this.shellMat = new THREE.MeshLambertMaterial({ color: 0xc02424 });
    for (let i = 0; i < 10; i++) {
      const big = i >= 7;
      const mesh = new THREE.Mesh(big ? shellG : casG, big ? this.shellMat : this.brassMat);
      mesh.visible = false; scene.add(mesh);
      this.casings.push({ mesh, big, t: 0, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    const puffT = puffTex(), puffG = new THREE.PlaneGeometry(1, 1);
    this.puffs = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: puffT, color: 0xc8c8d0, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(puffG, mat);
      mesh.visible = false; scene.add(mesh);
      this.puffs.push({ mesh, t: 0, life: 0, vel: new THREE.Vector3(), s0: 0.05, s1: 0.2, a: 0.5 });
    }
    this.vcoin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.005, 10), this.brassMat);
    this.vcoin.visible = false; scene.add(this.vcoin);
    this.vcoinT = 0; this.vcoinV = new THREE.Vector3();
    this.skinCol = new THREE.Color(0xdfe3ea); this.tint = new THREE.Color(1, 1, 1);
    // scratch
    this.tA = new THREE.Vector3(); this.tB = new THREE.Vector3(); this.tC = new THREE.Vector3(); this.tH = new THREE.Vector3();
    this.mM = new THREE.Matrix4();
    this.ndc = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.recoilP = 0; this.recoilPV = 0; this.recoilR = 0; this.recoilRV = 0; this.kickRoll = 0; this.kickRollV = 0; this.kickYaw = 0;
    this.landP = 0; this.landV = 0; this.settleP = 0; this.settleV = 0; this.drawP = 0; this.drawV = 0;
    this.swayX = 0; this.swayY = 0; this.inX = 0; this.inY = 0; this.inZ = 0;
    this.sprintK = 0; this.slideK = 0; this.wallK = 0; this.wallSide = 0; this.vaultW = 0; this.wallHandW = 0;
    this.idleT = 0; this.inspectT = -1; this.inspectW = 0;
    this.coinT = -1; this.parryT = -1; this.reloadW = 0; this.lastRk = 0; this.ejected = false;
    this.cylSwing = 0; this.cylSpin = 0; this.drumOut = 0; this.flashT = 0; this.lastAdsK = 0; this.lastPumpK = 0;
    this.heatPuffT = 0; this.ventT = 0; this.shotHeat = 0; this.drawGlow = 0;
    this.armBlend = 0; this.vaultK = 0;
    this.lastShells = 0;
    for (const c of this.casings) { c.life = 0; c.mesh.visible = false; }
    for (const p of this.puffs) { p.life = 0; p.mesh.visible = false; }
    this.vcoin.visible = false; this.vcoinT = 0;
    this.arm.root.visible = false; this.leg.visible = false; this.parryFx.visible = false;
  }

  // ------------------------------------------------------------------ events from gameplay
  // Shot feedback: per-weapon spring impulses and the muzzle flash.
  recoil(d, id, color, scale) {
    const cfg = CFG[id] || CFG.hammer, rc = cfg.recoil;
    const ads = 1 - 0.45 * (this.w.adsK || 0);
    this.recoilPV += d.kick * 32 * rc[0] * ads;
    this.recoilRV += d.kick * 30 * rc[1] * ads;
    this.kickRollV += (Math.random() < 0.5 ? -1 : 1) * d.kick * 16 * rc[2];
    this.kickYaw = (Math.random() - 0.5) * d.kick * rc[3] * 0.6;
    this.flashT = (scale || 1) > 1.4 ? 0.06 : 0.045;
    const m = this.models[id];
    m.userData.flash.add(this.flash);
    m.userData.flash.visible = true;
    const f = cfg.flash, s = (0.8 + Math.random() * 0.5) * (scale || 1);
    this.fStar.scale.setScalar(f[0] * s);
    this.fStar.rotation.z = Math.random() * TAU;
    this.fCore.scale.setScalar(f[0] * s * (0.8 + Math.random() * 0.3));
    const len = f[1] * (0.7 + Math.random() * 0.7) * (scale || 1);
    this.fSide1.scale.set(f[2] * s, len, 1); this.fSide2.scale.set(f[2] * s, len, 1);
    this.fSide1.visible = this.fSide2.visible = f[1] > 0.35;
    this.starMat.color.setHex(color); this.flameMat.color.setHex(color);
    this.shotHeat = Math.min(1.5, this.shotHeat + d.kick * 3);
    if (id === 'ripsaw') this.casing(false, 1);
    if (id === 'thumper' || (id === 'breacher' && Math.random() < 0.5)) this.puff(0.05, 0.18, 0.4, 0.5);
    if (id === 'lance') this.ventT = 0.7;
  }

  onDraw(id) {
    this.drawV += 9; // comes up and settles
    const an = this.models[id].userData.anim;
    if (id === 'hammer') this.cylSpin = 14;
    else if (id === 'breacher') this.w.pumpT = 0.45;
    else if (id === 'ripsaw') this.w.boltT = 0.08;
    else if (id === 'thumper') this.w.drumAngle += TAU / 5;
    this.drawGlow = 1;
    if (an.cyl) this.cylSwing = 0;
    this.inspectT = -1; this.idleT = 0;
  }

  onCoin() { this.coinT = 0; this.coinOut = false; this.inspectT = -1; this.idleT = 0; }
  onParry() { this.parryT = 0; }
  inspect() { if (this.inspectT < 0 && !this.w.switchTo && !this.w.reloading) { this.inspectT = 0; this.game.audio.play('swap', null, 0.25); } }
  // movement feedback: land impact 0..1, vault start, dash
  onMove(kind, k = 1) {
    if (kind === 'land') this.landV -= 0.9 * k + 0.25;
    else if (kind === 'dash') { this.recoilPV += 1.2; this.kickRollV += k * 3; }
    else if (kind === 'jump') this.landV += 0.35;
    else if (kind === 'vault') { this.landV -= 0.3; this.vaultK = 0; }
    this.idleT = 0; if (this.inspectT >= 0) this.inspectT = -1;
  }

  casing(big, n = 1, from) {
    for (let i = 0; i < n; i++) {
      const c = this.casings.find((x) => x.big === big && x.life <= 0) || this.casings.find((x) => x.big === big);
      if (!c) return;
      const m = this.models[this.w.current];
      if (from) c.mesh.position.copy(from); else this.toCam(m, this.ejectPort(this.w.current), c.mesh.position);
      c.vel.set(big ? 0.9 : 1.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.7, 0.2 + Math.random() * 0.25);
      if (from) c.vel.set(-0.2 + (Math.random() - 0.5) * 0.5, -0.2 - Math.random() * 0.4, 0.1 + (Math.random() - 0.5) * 0.2);
      c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      c.life = c.t = 0.7; c.mesh.visible = true;
      c.mesh.rotation.set(0, Math.random() * 3, 0);
    }
  }
  ejectPort(id) {
    if (id === 'breacher') return this.tA.set(0.045, 0.03, -0.1);
    if (id === 'ripsaw') return this.tA.set(0.04, 0.035, -0.13);
    return this.tA.set(0.03, 0.05, 0);
  }
  puff(s0, s1, life, a, at) {
    const p = this.puffs.find((x) => x.life <= 0) || this.puffs[0];
    const m = this.models[this.w.current];
    if (at) p.mesh.position.copy(at); else this.toCam(m, this.tB.copy(m.userData.muzzle), p.mesh.position);
    p.vel.set((Math.random() - 0.5) * 0.06, 0.12 + Math.random() * 0.08, -0.05);
    p.s0 = s0; p.s1 = s1; p.life = p.t = life; p.a = a;
    p.mesh.visible = true; p.mesh.rotation.z = Math.random() * TAU;
  }

  // model-space point -> weapon-camera space
  toCam(model, local, out) {
    this.holder.updateMatrix(); model.updateMatrix();
    return out.copy(local).applyMatrix4(model.matrix).applyMatrix4(this.holder.matrix);
  }

  // Muzzle of the visible gun mapped into the world: project through the weapon camera,
  // unproject through the world camera, 0.75m out. Tracers start where the flash is drawn.
  muzzleWorld(out) {
    const w = this.w, cam = this.game.camera, vc = w.camera;
    const m = this.models[w.current];
    const p = this.toCam(m, this.tC.copy(m.userData.muzzle), this.ndc);
    const zz = Math.max(0.05, -p.z);
    const tv = Math.tan(THREE.MathUtils.degToRad(vc.fov) / 2), tw = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const nx = p.x / zz / (tv * vc.aspect), ny = p.y / zz / tv;
    out.set(nx * tw * cam.aspect, ny * tw, -1).normalize().multiplyScalar(0.75);
    return out.applyMatrix4(cam.matrixWorld);
  }

  setSkin(hex) { this.skinCol.setHex(hex); this.applyTint(); }
  setTheme(theme) {
    // chrome picks up a little of the room's hue (never its darkness)
    const s = this.tC.set(((theme.sky >> 16) & 255) / 255, ((theme.sky >> 8) & 255) / 255, (theme.sky & 255) / 255);
    const mx = Math.max(0.05, s.x, s.y, s.z);
    this.tint.setRGB(1, 1, 1).lerp(new THREE.Color(s.x / mx, s.y / mx, s.z / mx), 0.16);
    this.applyTint();
  }
  applyTint() {
    this.M.chrome.color.copy(this.skinCol).multiply(this.tint);
    this.M.metal.color.setHex(0x8f96a4).multiply(this.tint);
  }

  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const w = this.w, g = this.game, p = g.player;
    const id = w.current, m = this.models[id], ud = m.userData, an = ud.anim, cfg = CFG[id];
    const t = g.time, sdt = Math.min(dt, 0.033);
    const h = this.holder;

    // ---- springs: push-back, muzzle flip, roll, landing, draw, sight settle
    this.recoilPV += (-420 * this.recoilP - 26 * this.recoilPV) * sdt; this.recoilP += this.recoilPV * sdt;
    this.recoilRV += (-300 * this.recoilR - 22 * this.recoilRV) * sdt; this.recoilR += this.recoilRV * sdt;
    this.kickRollV += (-300 * this.kickRoll - 20 * this.kickRollV) * sdt; this.kickRoll += this.kickRollV * sdt;
    this.kickYaw = damp(this.kickYaw, 0, 14, dt);
    this.landV += (-160 * this.landP - 13 * this.landV) * sdt; this.landP += this.landV * sdt;
    this.drawV += (-220 * this.drawP - 16 * this.drawV) * sdt; this.drawP += this.drawV * sdt;
    this.settleV += (-380 * this.settleP - 18 * this.settleV) * sdt; this.settleP += this.settleV * sdt;
    this.shotHeat = Math.max(0, this.shotHeat - dt * 0.7);
    this.drawGlow = Math.max(0, this.drawGlow - dt * 2.5);

    // ---- look sway + movement inertia
    this.swayX = damp(this.swayX, clamp(-input.lookDX * 4, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(input.lookDY * 4, -0.06, 0.06), 10, dt);
    const v = p.body.vel;
    const lv = v.x * p.right.x + v.z * p.right.z, fv = v.x * p.fwd.x + v.z * p.fwd.z;
    this.inX = damp(this.inX, clamp(-lv * 0.0022, -0.035, 0.035), 6, dt);
    this.inY = damp(this.inY, clamp(-v.y * 0.0018, -0.03, 0.04), 8, dt);
    this.inZ = damp(this.inZ, clamp(fv * 0.0012, -0.02, 0.03), 6, dt);

    // ---- ADS: the sight line meets the screen centre, with a small settle when it arrives
    const adsK = w.adsK || 0, ae = sm(clamp(adsK, 0, 1));
    if (adsK > 0.86 && this.lastAdsK <= 0.86) this.settleV -= 0.9;
    if (adsK < 0.5 && this.lastAdsK >= 0.5) this.settleV += 0.5;
    this.lastAdsK = adsK;
    const sightY = id === 'lance' && w.variantId('lance') === 'splitter' ? SPLITTER_SIGHT : cfg.sight;
    const S = h.scale.x;
    // wide phone screens: keep the hip pose out at the right instead of drifting to the middle
    const wide = clamp((w.camera.aspect - 1.78) * 0.1, -0.04, 0.06);
    let px = cfg.hip[0] + wide + (-cfg.hip[0] - wide) * ae;
    let py = cfg.hip[1] + (-sightY * S - cfg.hip[1]) * ae;
    let pz = cfg.hip[2] + (cfg.adsZ - cfg.hip[2]) * ae;
    let rx = cfg.rot[0] * (1 - ae), ry = cfg.rot[1] * (1 - ae), rz = cfg.rot[2] * (1 - ae);
    const loose = 1 - ae * 0.78; // sway and bob shrink while aiming

    // ---- idle breathing, walk bob, sway, inertia
    const bob = p.bobAmp * loose;
    px += (Math.cos(p.bob) * 0.012 * bob + Math.sin(t * 0.7) * 0.0022 * loose);
    py += (-Math.abs(Math.sin(p.bob)) * 0.016 * bob + Math.sin(t * 1.45) * 0.0036 * loose);
    rz += Math.cos(p.bob) * 0.018 * bob + Math.sin(t * 0.7) * 0.006 * loose;
    rx += Math.sin(t * 1.45 + 0.6) * 0.008 * loose;
    px += this.swayX * loose; py += this.swayY * loose;
    ry += this.swayX * 1.5 * loose; rx += this.swayY * 0.6 * loose;
    px += this.inX * loose; py += this.inY * loose; pz += this.inZ * loose;
    ry += this.inX * 2 * loose; rx += this.inY * 2 * loose;

    // ---- sprint, slide, wall-run lean, landing spring
    const sprint = p.sprint && p.body.grounded && p.speedNow > 6 && !input.fire && !w.adsOn ? 1 : 0;
    this.sprintK = damp(this.sprintK, sprint, 8, dt);
    this.slideK = damp(this.slideK, p.sliding ? 1 : 0, 10, dt);
    const wr = p.wallRun;
    if (wr) this.wallSide = wr.nx * p.right.x + wr.nz * p.right.z; // > 0: wall on the left
    this.wallK = damp(this.wallK, wr ? 1 : 0, wr ? 9 : 5, dt);
    px += -this.sprintK * 0.04 + this.slideK * 0.03 + this.wallK * this.wallSide * 0.035;
    py += -this.sprintK * 0.035 - this.slideK * 0.045 + this.landP * 0.09;
    rx += -this.sprintK * 0.28 + this.landP * 0.5;
    ry += this.sprintK * 0.5;
    rz += this.sprintK * 0.15 + p.roll * 2 + this.slideK * 0.28 + p.wallRunRoll * 2.4 + this.wallK * this.wallSide * 0.22;

    // ---- recoil
    pz += this.recoilP * 1.6 * (1 - ae * 0.4);
    rx += this.recoilR * (id === 'hammer' ? 1.4 : 1.0) + this.recoilP * 0.6;
    rz += this.kickRoll; ry += this.kickYaw;
    py += this.settleP * 0.02; rx += this.settleP * 0.06;

    // ---- weapon switch: holster drops and rolls away, draw rises and settles
    if (w.switchTo) {
      const hk = w.switchT > 0.16 ? 1 - (w.switchT - 0.16) / 0.16 : 0;
      const dk = w.switchT <= 0.16 ? w.switchT / 0.16 : 0;
      const hold = hk * hk;
      py -= hold * 0.4 + sm(dk) * 0.36; px += hold * 0.05 - dk * 0.02;
      rx -= hold * 0.7 - dk * 0.5; rz -= hold * 0.5 + dk * 0.35; ry += dk * 0.2;
    }
    py += this.drawP * 0.012; rx += this.drawP * 0.05;

    // ---- variant flourish + finisher
    const fl = w.flourish > 0 ? Math.sin((1 - w.flourish / 0.32) * Math.PI) : 0;
    py -= fl * 0.04; ry -= fl * 0.25; rz += fl * 0.7;

    // ---- reload (per weapon), inspect, punch dip, vault
    const RL = this.reloadPose(dt, input);
    px += RL.px; py += RL.py; pz += RL.pz; rx += RL.rx; ry += RL.ry; rz += RL.rz;
    const IN = this.inspectPose(dt, input);
    px += IN.px; py += IN.py; rx += IN.rx; ry += IN.ry; rz += IN.rz;
    const pu = w.punchAnim > 0 ? Math.sin((1 - w.punchAnim / 0.28) * Math.PI) : 0;
    px += pu * 0.03; py -= pu * 0.05; rz -= pu * 0.18; rx -= pu * 0.1;
    this.vaultW = damp(this.vaultW, p.mantle ? 1 : 0, p.mantle ? 30 : 7, dt);
    if (p.mantle) this.vaultK = clamp(p.mantle.t / p.mantle.dur, 0, 1);
    px += this.vaultW * 0.04; py -= this.vaultW * 0.09; rz -= this.vaultW * 0.35; rx -= this.vaultW * 0.25;

    // ---- charge shake
    if (id === 'lance' && w.charging) { px += (Math.random() - 0.5) * w.charge * 0.006; py += (Math.random() - 0.5) * w.charge * 0.006; }
    if (w.pierceCharge > 0) { px += (Math.random() - 0.5) * w.pierceCharge * 0.004; py += (Math.random() - 0.5) * w.pierceCharge * 0.004; }
    h.position.set(px, py, pz);
    h.rotation.set(rx, ry, rz);

    this.animateParts(dt, input, m, ud, an, id, RL);
    this.updateArm(dt, input, m, id, RL, IN);
    this.updateFx(dt);
  }

  // Reload choreography. Returns gun offsets and (via RL.hand*) where the left hand goes.
  reloadPose(dt, input) {
    const w = this.w, id = w.current, an = this.models[id].userData.anim;
    const RL = this.RL || (this.RL = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, hand: new THREE.Vector3(), handLocal: false, handW: 0, curl: 1, twist: 0, prop: '', k: 0, shell: false });
    RL.px = RL.py = RL.pz = RL.rx = RL.ry = RL.rz = 0; RL.handW = 0; RL.prop = ''; RL.curl = 1; RL.twist = 0; RL.handLocal = false; RL.fetch = 0;
    const shellMode = !!(this.w.def().reloadShell);
    this.reloadW = damp(this.reloadW, w.reloading ? 1 : 0, w.reloading ? 12 : 9, dt);
    const k = w.reloading ? clamp(1 - w.reloadT / w.reloadTotal, 0, 1) : (this.reloadW > 0.01 ? 1 : 0);
    RL.k = k;
    if (!w.reloading && this.reloadW < 0.01) { this.ejected = false; this.lastRk = 0; return RL; }
    const W = this.reloadW;
    if (w.reloading && k < this.lastRk - 0.5) this.ejected = false; // next shell cycle
    const crossed = (x) => w.reloading && this.lastRk < x && k >= x;
    const au = this.game.audio;
    const H = (x, y, z, wgt, local = true) => { RL.hand.set(x, y, z); RL.handLocal = local; RL.handW = wgt; };
    if (id === 'hammer') {
      // bring it up, roll it left, swing the cylinder out, flick the empties, speedloader in, flick it shut
      const lift = win(k, 0.0, 0.16, 0.8, 0.96);
      RL.px = -0.11 * lift; RL.py = 0.09 * lift; RL.pz = 0.03 * lift;
      RL.rx = 0.42 * lift + 0.3 * bump(k, 0.2, 0.34); RL.ry = 0.95 * lift; RL.rz = 0.2 * lift - 0.35 * bump(k, 0.8, 0.93);
      this.cylSwing = 1.25 * win(k, 0.1, 0.2, 0.78, 0.84);
      if (crossed(0.24)) { this.casing(false, 6, this.toCam(this.models.hammer, this.tB.set(-0.03, 0.06, 0.06), this.tH)); au.play('shell', null, 0.25); }
      an.rounds.visible = !(w.reloading && k > 0.22 && k < 0.6);
      if (crossed(0.82)) au.play('dry', null, 0.35);
      if (crossed(0.86)) this.cylSpin = 22;
      const hw = win(k, 0.34, 0.54, 0.66, 0.82);
      // hand target: just behind the swung-out cylinder
      H(-0.07, 0.03, 0.1, hw); RL.curl = 0.9; RL.twist = 1.6; RL.prop = k > 0.3 && k < 0.63 ? 'loader' : '';
    } else if (id === 'ripsaw') {
      const tilt = win(k, 0.0, 0.14, 0.86, 1.0);
      RL.rz = -0.55 * tilt; RL.ry = 0.25 * tilt; RL.rx = 0.16 * tilt + 0.06 * bump(k, 0.56, 0.64); RL.px = -0.08 * tilt; RL.py = 0.075 * tilt - 0.02 * bump(k, 0.56, 0.62);
      // magazine falls out, a fresh one rises in
      const drop = seg(k, 0.12, 0.32), seat = sm(seg(k, 0.48, 0.58));
      an.mag.visible = k < 0.32 || k >= 0.56 || !w.reloading;
      const off = k < 0.4 ? drop * drop * 0.4 : (1 - seat) * 0.09;
      an.mag.position.set(an.magHome.x, an.magHome.y - (w.reloading ? off : 0), an.magHome.z);
      an.mag.rotation.x = 0.12 + (k < 0.4 && w.reloading ? drop * 0.6 : 0);
      if (crossed(0.14)) au.play('dry', null, 0.3);
      if (crossed(0.57)) au.play('shell', null, 0.4);
      // hand: off to the pouch, back with a mag, seat it, rack the handle, back to the guard
      const away = win(k, 0.1, 0.24, 0.3, 0.48), atMag = win(k, 0.3, 0.46, 0.6, 0.66), atHandle = win(k, 0.6, 0.68, 0.8, 0.9);
      if (atHandle > 0.01) { H(-0.05, 0.05, 0.02 + 0.06 * sm(seg(k, 0.72, 0.8)) * (1 - seg(k, 0.8, 0.84)), atHandle); RL.curl = 1.1; RL.twist = 0.4; }
      else if (atMag > 0.01) { H(0, -0.09 - (1 - seat) * 0.09, -0.17, atMag); RL.curl = 0.9; RL.twist = 0.2; RL.prop = k < 0.56 ? 'mag' : ''; }
      else if (away > 0.01) { RL.hand.copy(FETCH_L); RL.handLocal = false; RL.handW = away; RL.prop = k > 0.28 ? 'mag' : ''; }
      an.handle.position.z = 0.06 * sm(seg(k, 0.72, 0.8)) * (1 - seg(k, 0.8, 0.84));
      if (crossed(0.81)) au.play('reloadEnd', null, 0.35);
    } else if (id === 'breacher') {
      // rolled to the loading port; one shell pushed in per cycle
      RL.rz = -0.6 * W; RL.ry = 0.2 * W; RL.rx = 0.18 * W; RL.px = -0.08 * W; RL.py = 0.07 * W;
      if (shellMode && w.reloading) {
        const fetch = win(k, 0.02, 0.3, 0.42, 0.7);
        const push = sm(seg(k, 0.62, 0.86)) * (1 - seg(k, 0.9, 1.0));
        RL.py += 0.012 * bump(k, 0.8, 0.95); RL.rx += 0.04 * bump(k, 0.8, 0.95);
        H(0, -0.07 + 0.04 * push, -0.11 + 0.01 * push, 1); RL.curl = 0.7; RL.twist = 0.0; RL.prop = k < 0.86 ? 'shell' : '';
        RL.fetch = fetch;
      } else H(0, -0.07, -0.11, 1); RL.curl = 0.7;
    } else if (id === 'lance') {
      const tilt = win(k, 0.0, 0.14, 0.84, 1.0);
      RL.rx = 0.4 * tilt; RL.rz = -0.3 * tilt; RL.ry = 0.2 * tilt; RL.py = 0.08 * tilt; RL.pz = 0.04 * tilt; RL.px = -0.07 * tilt;
      const out = seg(k, 0.12, 0.3), seat = sm(seg(k, 0.56, 0.66));
      an.cell.visible = k < 0.3 || k >= 0.6 || !w.reloading;
      const off = k < 0.45 ? out * out * 0.35 : (1 - seat) * 0.12;
      an.cell.position.set(an.cellHome.x, an.cellHome.y - (w.reloading ? off : 0), an.cellHome.z + (w.reloading && k < 0.45 ? out * 0.08 : 0));
      if (crossed(0.14)) { au.play('vent', null, 0.25); this.ventT = 0.6; for (let i = 0; i < 3; i++) this.puff(0.04, 0.16, 0.6, 0.35, this.toCam(this.models.lance, this.tB.set(0, 0.1, -0.18), this.tH)); }
      if (crossed(0.62)) au.play('shell', null, 0.45);
      const away = win(k, 0.1, 0.24, 0.3, 0.44), atCell = win(k, 0.3, 0.46, 0.68, 0.84);
      if (atCell > 0.01) { H(0, -0.13 - (1 - seat) * 0.1, -0.14, atCell); RL.curl = 0.8; RL.twist = 0.1; RL.prop = k < 0.6 ? 'cell' : ''; }
      else if (away > 0.01) { RL.hand.copy(FETCH_L); RL.handLocal = false; RL.handW = away; RL.prop = k > 0.26 ? 'cell' : ''; }
      RL.py += 0.012 * bump(k, 0.62, 0.72);
    } else if (id === 'thumper') {
      const tilt = win(k, 0.0, 0.14, 0.86, 1.0);
      RL.rz = 0.2 * tilt; RL.ry = 0.55 * tilt; RL.rx = 0.15 * tilt; RL.px = -0.08 * tilt; RL.py = 0.08 * tilt;
      this.drumOut = win(k, 0.08, 0.2, 0.78, 0.86);
      if (crossed(0.82)) au.play('dry', null, 0.35);
      RL.py -= 0.015 * bump(k, 0.84, 0.94);
      // three pushes, each rotates the drum one chamber
      const pk = seg(k, 0.26, 0.76) * 3, pi = Math.min(2, Math.floor(pk)), pf = pk - pi;
      const inPush = k > 0.26 && k < 0.76;
      if (inPush && this.lastShells !== pi) { this.lastShells = pi; w.drumAngle += TAU / 5; au.play('shell', null, 0.35); }
      if (!inPush) this.lastShells = -1;
      const hw = win(k, 0.18, 0.28, 0.76, 0.88);
      H(-0.13 + (inPush ? 0.03 * Math.sin(pf * Math.PI) : 0), -0.005, -0.04, hw); RL.curl = 0.8; RL.twist = 1.3; RL.prop = inPush && pf < 0.6 ? 'grenade' : '';
    } else if (id === 'arc') {
      const tilt = win(k, 0.0, 0.14, 0.86, 1.0);
      RL.rz = -0.25 * tilt; RL.ry = 0.45 * tilt; RL.rx = 0.18 * tilt; RL.px = -0.05 * tilt; RL.py = 0.07 * tilt;
      const out = seg(k, 0.12, 0.3), seat = sm(seg(k, 0.5, 0.62));
      an.core.visible = k < 0.3 || k >= 0.55 || !w.reloading;
      const off = k < 0.45 ? out : (1 - seat) * 0.6;
      an.core.position.set(an.coreHome.x - (w.reloading ? off * 0.12 : 0), an.coreHome.y + (w.reloading && k < 0.45 ? out * 0.05 - out * out * 0.3 : 0), an.coreHome.z);
      if (crossed(0.14)) au.play('zap', null, 0.25);
      if (crossed(0.58)) au.play('shell', null, 0.4);
      const away = win(k, 0.1, 0.24, 0.3, 0.42), atCore = win(k, 0.3, 0.44, 0.64, 0.8);
      if (atCore > 0.01) { H(-0.15 + seat * 0.05, -0.03, -0.05, atCore); RL.curl = 0.8; RL.twist = 1.4; RL.prop = k < 0.56 ? 'canister' : ''; }
      else if (away > 0.01) { RL.hand.copy(FETCH_L); RL.handLocal = false; RL.handW = away; RL.prop = k > 0.26 ? 'canister' : ''; }
    }
    RL.handW *= W;
    if (!w.reloading) { // blend out after the last frame of the reload
      RL.px *= W; RL.py *= W; RL.pz *= W; RL.rx *= W; RL.ry *= W; RL.rz *= W;
      if (an.mag) { an.mag.visible = true; an.mag.position.copy(an.magHome); an.mag.rotation.x = 0.12; }
      if (an.cell) { an.cell.visible = true; an.cell.position.copy(an.cellHome); }
      if (an.core) { an.core.visible = true; an.core.position.copy(an.coreHome); }
      if (an.rounds) an.rounds.visible = true;
      if (an.handle) an.handle.position.z = 0;
      this.drumOut = 0;
      if (id === 'hammer') this.cylSwing = 0;
    }
    this.lastRk = w.reloading ? k : 0;
    return RL;
  }

  // Inspect after a long idle (or RELOAD with a full magazine): turn the gun, work the action.
  inspectPose(dt, input) {
    const w = this.w, p = this.game.player, id = w.current;
    const IN = this.IN || (this.IN = { px: 0, py: 0, rx: 0, ry: 0, rz: 0, k: -1, hand: 0 });
    IN.px = IN.py = IN.rx = IN.ry = IN.rz = 0; IN.hand = 0;
    const busy = input.fire || input.alt || w.adsOn || w.reloading || w.switchTo || p.speedNow > 0.6 || !p.body.grounded ||
      Math.abs(input.lookDX) + Math.abs(input.lookDY) > 0.0005 || w.charging || w.punchAnim > 0 || !p.alive;
    if (busy) { this.idleT = 0; if (this.inspectT >= 0) this.inspectT = -1; } else if (this.game.state === 'playing') this.idleT += dt;
    if (this.idleT > 9 && this.inspectT < 0) { this.inspectT = 0; this.idleT = -6; }
    if (this.inspectT >= 0) { this.inspectT += dt; if (this.inspectT > 2.6) this.inspectT = -1; }
    this.inspectW = damp(this.inspectW, this.inspectT >= 0 ? 1 : 0, this.inspectT >= 0 ? 7 : 12, dt);
    if (this.inspectW < 0.01) { IN.k = -1; this.lastInK = 0; return IN; }
    const k = this.inspectT >= 0 ? this.inspectT / 2.6 : 1, Wt = this.inspectW;
    IN.k = k;
    const turn = win(k, 0.0, 0.18, 0.82, 1.0);
    IN.px = -0.07 * turn; IN.py = 0.03 * turn; IN.ry = 0.65 * turn; IN.rz = 0.35 * turn; IN.rx = 0.12 * turn;
    const flip = win(k, 0.42, 0.52, 0.62, 0.74);
    IN.rz -= flip * 0.9; IN.ry -= flip * 0.9; IN.rx += flip * 0.2;
    if (id === 'hammer') { this.cylSwing = 1.2 * win(k, 0.22, 0.3, 0.6, 0.66) * Wt; if (k > 0.3 && k < 0.58) this.cylSpin = Math.max(this.cylSpin, 18); }
    else if (id === 'breacher' && k > 0.3 && k < 0.36 && w.pumpT <= 0) w.pumpT = 0.45;
    else if (id === 'thumper' && k >= 0.3 && this.lastInK < 0.3) w.drumAngle += TAU;
    else if (id === 'ripsaw') IN.hand = win(k, 0.24, 0.32, 0.42, 0.5);
    IN.px *= Wt; IN.py *= Wt; IN.rx *= Wt; IN.ry *= Wt; IN.rz *= Wt;
    this.lastInK = k;
    return IN;
  }

  animateParts(dt, input, m, ud, an, id, RL) {
    const w = this.w, t = this.game.time;
    if (an.cyl) {
      if (!w.reloading && this.inspectW < 0.01) this.cylSwing = damp(this.cylSwing, 0, 14, dt);
      // swing-out arc around the crane pivot (lower left of the frame)
      const a = this.cylSwing, ox = 0.03, oy = 0.046;
      an.cyl.position.set(an.cylHome.x - 0.03 + ox * Math.cos(a) - oy * Math.sin(a), an.cylHome.y - 0.046 + ox * Math.sin(a) + oy * Math.cos(a), an.cylHome.z);
      if (this.cylSpin > 0.1) { w.cylAngle += this.cylSpin * dt; w.cylTarget = w.cylAngle; this.cylSpin = damp(this.cylSpin, 0, 3, dt); }
      w.cylAngle += (w.cylTarget - w.cylAngle) * Math.min(1, dt * 25);
      an.cyl.rotation.z = w.cylAngle + (w.pierceCharge > 0 ? Math.sin(t * 60) * 0.05 * w.pierceCharge : 0);
      an.spur.rotation.x = w.cooldown > 0.12 || w.pierceCharge >= 1 ? 0 : -0.5;
    }
    if (an.pump) {
      const k = w.pumpT > 0 ? Math.sin((1 - w.pumpT / 0.45) * Math.PI) : 0;
      an.pump.position.z = an.pumpHome + k * 0.09;
      if (k > 0.85 && this.lastPumpK <= 0.85 && w.pumpT < 0.3) this.casing(true, 1);
      this.lastPumpK = k;
    }
    if (an.bolt) an.bolt.position.z = -0.19 + (w.boltT > 0 ? 0.035 : 0) + (an.handle ? an.handle.position.z * 0.8 : 0);
    if (an.drum) {
      an.drum.rotation.z += (w.drumAngle - an.drum.rotation.z) * Math.min(1, dt * 14);
      an.drum.position.set(an.drumHome.x - this.drumOut * 0.1, an.drumHome.y - this.drumOut * 0.02, an.drumHome.z);
      const a = w.ammo.thumper.mag, n = w.reloading ? a + Math.ceil(seg(RL.k, 0.26, 0.76) * (5 - a)) : a;
      for (let i = 0; i < 5; i++) an.tips[i].visible = i < n;
    }
    if (an.coils) {
      if (id === 'arc') an.coils.rotation.y += dt * (input.fire ? 30 : w.tether ? 12 : 3 + this.drawGlow * 25 + (w.reloading && RL.k > 0.6 ? 25 : 0));
      if (id === 'lance') an.coils.scale.setScalar(w.charging ? 1 + w.charge * 0.15 + Math.random() * 0.03 : 1 + this.drawGlow * 0.12);
    }
    if (an.core) { const s = input.fire && !w.reloading ? 0.85 + Math.random() * 0.4 : 1; an.core.scale.set(s, s, 1); }
    if (an.ventL) {
      // vents crack open with charge and stay open while the gun dumps heat
      this.ventT -= dt;
      const o = Math.max(w.charging ? w.charge * 0.5 : 0, this.ventT > 0 ? Math.min(1, this.ventT * 3) * 0.9 : 0);
      an.ventL.rotation.z = o; an.ventR.rotation.z = -o;
      if (this.ventT > 0 && Math.random() < dt * 14) this.puff(0.03, 0.12, 0.5, 0.3, this.toCam(m, this.tB.set((Math.random() - 0.5) * 0.06, 0.11, -0.18), this.tH));
    }
    if (an.saw) an.saw.rotation.x += dt * (w.altCd > 0 ? 40 : 6);
    if (an.prism) an.prism.rotation.y += dt * (w.charging ? 6 + w.charge * 24 : 1.5);
    if (an.pumpMats) {
      const blink = w.pumpLevel >= 3 && Math.sin(t * 30) > 0;
      for (let i = 0; i < 3; i++) an.pumpMats[i].color.setHex(i < w.pumpLevel ? (blink ? 0xffffff : 0xff3050) : 0x401018);
    }
    // accent glow follows the variant's state (heat, charge, freeze, tether)
    if (ud.acc && ud.accBase) {
      const vid = w.variantId();
      let k = 1;
      if (vid === 'inferno') k = 0.35 + w.heat * 0.9 + (w.overheated ? Math.sin(t * 25) * 0.25 : 0);
      else if (vid === 'piercer') k = 0.55 + w.pierceCharge * 0.8 + (w.pierceCharge >= 1 ? Math.sin(t * 20) * 0.2 : 0);
      else if (vid === 'freeze') k = w.freezeOn ? 0.9 + Math.sin(t * 12) * 0.3 : 0.75;
      else if (vid === 'tether') k = w.tether ? 0.9 + Math.sin(t * 22) * 0.3 : 0.75;
      else if (vid === 'pump') k = 0.6 + w.pumpLevel * 0.2;
      ud.acc.color.copy(ud.accBase).multiplyScalar(Math.max(0.15, k + this.drawGlow * 0.5));
    }
    // shared glow: lance charge brightens it, a reload dims it, RUSH tints it magenta, finishers flash red
    const p = this.game.player;
    let gs = id === 'lance' && w.charging ? 0.6 + w.charge * 1.4 : 1;
    if (id === 'lance' && w.reloading) gs *= 0.25 + 0.75 * sm(seg(RL.k, 0.62, 0.9));
    gs += this.drawGlow * 0.6;
    let gr = gs, gg = gs, gb = gs;
    if (p.rushT > 0) { const k = 0.5 + 0.5 * Math.sin(t * 10); gr *= 1.2; gg *= 0.3 + 0.25 * k; gb *= 1.1; }
    if (w.finisherGlow > 0) { gg *= 0.35; gb *= 0.35; gr *= 1.3; }
    this.M.glow.color.setRGB(gr, gg, gb);
    // muzzle flash
    this.flashT -= dt;
    ud.flash.visible = this.flashT > 0;
    if (this.flashT > 0) { const k = this.flashT / 0.06; this.fSide1.scale.y *= 0.9 + 0.1 * k; this.fSide2.scale.y = this.fSide1.scale.y; }
    w.muzzleLight.intensity = this.flashT > 0 ? 3 : 0;
    // barrel smoke after sustained fire
    this.heatPuffT -= dt;
    if (this.shotHeat > 0.6 && this.heatPuffT <= 0 && !input.fire) { this.heatPuffT = 0.12; this.puff(0.03, 0.14, 0.7, Math.min(0.35, this.shotHeat * 0.25)); }
  }

  // Left arm: support grip, reload hand, punch/parry jab, coin flick, vault plant, wall touch.
  updateArm(dt, input, m, id, RL, IN) {
    const w = this.w, g = this.game, p = g.player, A = this.arm;
    const cfg = CFG[id];
    const pos = this.tA, tmp = this.tB;
    let curl = 1, twist = 0, thumbUp = 0, thumbFold = 0.4, wristX = 0;
    // anchor: support grip (follows the gun) or tucked away below the frame
    const two = cfg.gripL && !(w.switchTo && w.switchT > 0.1);
    this.armBlend = damp(this.armBlend, two ? 1 : 0, 14, dt);
    if (cfg.gripL) {
      tmp.set(cfg.gripL[0], cfg.gripL[1], cfg.gripL[2]);
      if (id === 'breacher') tmp.z = m.userData.anim.pump.position.z;
      this.toCam(m, tmp, pos);
      pos.lerp(HIDE_L, 1 - this.armBlend);
      curl = 1.25; twist = 2.3; thumbFold = 0.1;
    } else pos.copy(HIDE_L);
    // reload hand (model-space targets follow the gun, others are camera-space)
    if (RL.handW > 0.001) {
      if (RL.handLocal) this.toCam(m, this.tC.copy(RL.hand), this.tH); else this.tH.copy(RL.hand);
      if (RL.fetch > 0) this.tH.lerp(FETCH_L, RL.fetch);
      pos.lerp(this.tH, RL.handW);
      curl += (RL.curl - curl) * RL.handW; twist += (RL.twist - twist) * RL.handW;
    }
    if (IN.hand > 0.001) { this.toCam(m, this.tC.set(0, -0.12, -0.17), this.tH); pos.lerp(this.tH, IN.hand); }
    // wall-run: the free hand reaches for a wall on the left
    const wantWall = p.wallRun && this.wallSide > 0.3 && !w.reloading ? 1 : 0;
    this.wallHandW = damp(this.wallHandW, wantWall, wantWall ? 10 : 6, dt);
    if (this.wallHandW > 0.001) { pos.lerp(this.tH.copy(WALL_L).add(this.tC.set(0, Math.sin(g.time * 14) * 0.006, 0)), this.wallHandW); curl += (0.15 - curl) * this.wallHandW; twist += (-1.4 - twist) * this.wallHandW; wristX += 0.5 * this.wallHandW; }
    // vault: palm planted on the ledge, sliding down the screen as we climb over it
    if (this.vaultW > 0.001) {
      this.tH.copy(VAULT0).lerp(VAULT1, sm(this.vaultK));
      pos.lerp(this.tH, this.vaultW); curl += (0.1 - curl) * this.vaultW; twist *= 1 - this.vaultW; wristX -= 0.95 * this.vaultW;
    }
    // coin flick: fist rises, thumb snaps up, a coin spins off the top of the frame
    if (this.coinT >= 0) {
      this.coinT += dt;
      const k = this.coinT / 0.42;
      const cw = win(k, 0.0, 0.22, 0.55, 1.0);
      pos.lerp(this.tH.copy(COIN_L), cw);
      curl += (1.2 - curl) * cw; twist += (0.9 - twist) * cw; thumbFold = (1 - seg(k, 0.25, 0.32)) * 0.9 * cw;
      thumbUp = seg(k, 0.25, 0.32) * 0.9 * (1 - seg(k, 0.6, 0.9));
      if (k >= 0.25 && !this.coinOut) {
        this.coinOut = true; this.vcoinT = 0.001; this.vcoin.visible = true;
        this.vcoin.position.copy(COIN_L).add(this.tC.set(0.04, 0.04, -0.03));
        this.vcoinV.set(0.12, 2.6, -0.6);
      }
      if (k >= 1) this.coinT = -1;
    }
    // punch / parry: snap out, hang, recoil back
    let jab = 0;
    if (w.punchAnim > 0 && !w.kickAnim) {
      const u = 1 - w.punchAnim / 0.28;
      jab = u < 0.22 ? eOut(u / 0.22) : u < 0.42 ? 1 : 1 - sm((u - 0.42) / 0.58);
      pos.lerp(PUNCH_L, jab);
      curl += (1.6 - curl) * jab; twist += (0.35 - twist) * jab; thumbFold = thumbFold * (1 - jab) + jab;
      if (this.parryT >= 0) { curl -= 1.4 * jab * seg(u, 0.15, 0.3); twist += 1.2 * jab; }
    }
    if (this.parryT >= 0) { this.parryT += dt; if (this.parryT > 0.35) this.parryT = -1; }
    const show = pos.y > -0.58 || jab > 0;
    A.root.visible = show;
    if (show) {
      A.root.position.copy(pos);
      A.root.lookAt(SHOULDER_L);
      A.root.rotateZ(twist);
      A.wrist.rotation.set(wristX - (jab > 0 ? 0.15 * jab : 0), 0, 0);
      A.fingers.rotation.x = -curl;
      A.thumb.rotation.set(thumbUp, -thumbFold, 0);
      for (const k in A.props) A.props[k].visible = k === RL.prop && RL.handW > 0.3;
    }
    // arm glow: cyan, yellow on a parry, magenta in RUSH
    const ag = this.M.armGlow.color;
    if (this.parryT >= 0) ag.setHex(0xffe23a).multiplyScalar(1.4 - this.parryT * 2);
    else if (p.rushT > 0) ag.setRGB(1, 0.35, 0.95);
    else ag.setRGB(0.35, 0.9 + jab * 0.1, 1);
    this.parryFx.visible = this.parryT >= 0 && this.parryT < 0.22;
    if (this.parryFx.visible) {
      const s = 0.5 + this.parryT * 6;
      this.parryFx.position.copy(A.root.position).add(this.tC.set(0, 0.02, -0.06));
      this.parryFx.scale.setScalar(s);
      this.parryFx.rotation.z = this.parryT * 6;
      this.parryFx.material.opacity = 1 - this.parryT / 0.22;
    }
    // slide kick: the boot sweeps up into frame
    const L = this.leg;
    if (w.punchAnim > 0 && w.kickAnim) {
      const u = 1 - w.punchAnim / 0.28;
      const e = u < 0.3 ? eOut(u / 0.3) : 1 - sm((u - 0.3) / 0.7);
      L.visible = true;
      L.position.set(-0.04 + e * 0.04, -0.74 + e * 0.5, -0.14 - e * 0.36);
      L.lookAt(HIP_K);
      L.rotateZ(0.2 * e);
    } else L.visible = false;
  }

  updateFx(dt) {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 5.5 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0 || c.mesh.position.y < -0.7) { c.life = 0; c.mesh.visible = false; }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.t;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * eOut(k));
      p.mesh.rotation.z += dt * 0.8;
      p.mesh.material.opacity = p.a * (1 - k) * Math.min(1, k * 8);
      if (p.life <= 0) p.mesh.visible = false;
    }
    if (this.vcoinT > 0) {
      this.vcoinT += dt;
      this.vcoinV.y -= 6 * dt;
      this.vcoin.position.addScaledVector(this.vcoinV, dt);
      this.vcoin.rotation.x += dt * 34; this.vcoin.rotation.z += dt * 6;
      if (this.vcoinT > 0.5 || this.vcoin.position.y > 0.45) { this.vcoin.visible = false; this.vcoinT = 0; }
    }
  }
}
