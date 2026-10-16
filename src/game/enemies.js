import * as THREE from 'three';
import { moveBody, clamp, angleDiff, segPointDist2, bodyOverlapsAny } from '../core/collide.js';
import { getTexture } from '../render/textures.js';
import { psxify } from '../render/renderer.js';
import { sharedMaterials } from '../render/materials.js';

// Scratch vectors: hot paths (think/animate) must not allocate.
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// Shared assets. Every body part is ONE merged, vertex-coloured mesh per bone, drawn with a
// shared material whose "glow" vertices are unlit (eyes, cores, coils stay readable in the
// dark and through fog). Geometry is built once per type and shared by every instance, so a
// detailed enemy costs about one draw call per bone.
// ---------------------------------------------------------------------------------------
let MATS = null;
function enemyMats() {
  if (MATS) return MATS;
  const mk = (tex, o = {}, glow = [1, 1, 1, 0]) => {
    const m = psxify(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, emissive: new THREE.Color(0.2, 0.2, 0.2), ...o }));
    const uGlow = { value: new THREE.Vector4(...glow) };
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      base(sh, r);
      sh.uniforms.uGlow = uGlow;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uGlow;\nvarying float vGlow;')
        // self-illumination follows the paint, so dark parts stay dark
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;')
        .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, mix(vColor, uGlow.rgb, uGlow.a), vGlow);\n#include <opaque_fragment>');
    };
    // distinct key: the shader differs from plain psxify materials with the same parameters
    m.customProgramCacheKey = () => 'psx1-enemy';
    return m;
  };
  const skin = getTexture('skin'), sinew = sinewTexture();
  const CX = { color: 0xa890c8, emissive: new THREE.Color(0.3, 0.08, 0.4) }, GX = [0.8, 0.3, 1, 0.85];
  MATS = {
    metal: mk(skin), flesh: mk(sinew),
    // NG+ corruption: violet cast, every glow turns the same sick purple
    metalX: mk(skin, CX, GX), fleshX: mk(sinew, CX, GX),
    // stalker camouflage: a faint additive shimmer
    cloak: mk(sinew, { color: 0x6890b0, emissive: new THREE.Color(0.08, 0.16, 0.24), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }, [0.5, 1, 0.4, 0.6]),
  };
  return MATS;
}

function sinewTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.fillStyle = '#a49c9c'; x.fillRect(0, 0, s, s);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 10; i++) {
    x.fillStyle = i % 2 ? 'rgba(50,30,34,0.35)' : 'rgba(255,240,240,0.16)';
    const y0 = i * 6.4;
    for (let px = 0; px < s; px++) x.fillRect(px, Math.round(y0 + Math.sin(px * 0.19 + i * 1.7) * 2), 1, 2);
  }
  const img = x.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}

// Pixel-art eye glints: camera-facing additive sprites that keep a minimum on-screen size,
// so a pair of eyes reads at 40 m and in blackout rooms.
const eyeTex = {};
function eyeTexture(kind) {
  if (eyeTex[kind]) return eyeTex[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  const dot = (cx, cy, w, h) => {
    x.fillStyle = 'rgba(255,255,255,0.28)'; x.fillRect(cx - w / 2 - 1, cy - h / 2 - 1, w + 2, h + 2);
    x.fillStyle = '#fff'; x.fillRect(cx - w / 2, cy - h / 2, w, h);
  };
  if (kind === 'pair') { dot(5, 8, 3, 2); dot(11, 8, 3, 2); x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(1, 7, 14, 2); }
  else if (kind === 'tri') { dot(4, 9, 2, 2); dot(12, 9, 2, 2); dot(8, 6, 2, 2); }
  else if (kind === 'slit') { dot(8, 8, 10, 2); x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(0, 7, 16, 2); }
  else { dot(8, 8, 4, 4); x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(7, 1, 2, 14); x.fillRect(1, 7, 14, 2); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  eyeTex[kind] = t;
  return t;
}
const spriteMats = new Map();
function eyeMat(kind, color) {
  const k = kind + color;
  if (!spriteMats.has(k)) spriteMats.set(k, new THREE.SpriteMaterial({ map: eyeTexture(kind), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  return spriteMats.get(k);
}

// Telegraph / tether visuals owned by individual enemies (shared geometry).
let beamGeo = null, laneGeo = null, haloGeo = null, shadowGeo = null, ringGeo = null, shellGeo = null;
function stretchGeo() { if (!beamGeo) { beamGeo = new THREE.BoxGeometry(1, 1, 1); beamGeo.translate(0, 0, 0.5); } return beamGeo; }
function laneGeometry() { if (!laneGeo) { laneGeo = new THREE.PlaneGeometry(1, 1); laneGeo.rotateX(-Math.PI / 2); laneGeo.translate(0, 0, 0.5); } return laneGeo; }
function haloGeometry() { if (!haloGeo) { haloGeo = new THREE.RingGeometry(0.75, 1, 12); haloGeo.rotateX(-Math.PI / 2); } return haloGeo; }

// ---------------------------------------------------------------------------------------
// Geometry: boxes (optionally tapered / sheared / rotated) accumulated per bone.
// ---------------------------------------------------------------------------------------
const CORN = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]];
// corner order + baked shade (top bright, belly dark: reads as PS1 vertex lighting)
const FACES = [[7, 6, 5, 4, 1.1], [0, 1, 2, 3, 0.6], [3, 2, 6, 7, 0.96], [1, 0, 4, 5, 0.8], [2, 1, 5, 6, 0.88], [0, 3, 7, 4, 0.88]];
const FUV = [[0, 2], [0, 2], [0, 1], [0, 1], [2, 1], [2, 1]];
const ONE = [1, 1];
const _c = new THREE.Color(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

class Shape {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.G = []; this.I = []; }
  // w h d size, x y z centre, col hex. o: rx ry rz order, top/bot [sx, sz] taper, shift [dx, dz] of the top face, glow, shade
  b(w, h, d, x, y, z, col, o = {}) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const top = o.top || ONE, bot = o.bot || ONE, sh = o.shift;
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
    _m.makeRotationFromEuler(_e).setPosition(x, y, z);
    const cs = CORN.map((k) => {
      const t = k[1] > 0 ? top : bot;
      const v = new THREE.Vector3(k[0] * hw * t[0] + (k[1] > 0 && sh ? sh[0] : 0), k[1] * hh, k[2] * hd * t[1] + (k[1] > 0 && sh ? sh[1] : 0)).applyMatrix4(_m);
      return { l: [k[0] * hw + x, k[1] * hh + y, k[2] * hd + z], w: v };
    });
    const glow = o.glow ? 1 : 0;
    _c.setHex(col);
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const a = cs[F[0]].w, bb = cs[F[1]].w, c = cs[F[2]].w, d4 = cs[F[3]].w;
      n.crossVectors(ab.subVectors(bb, a), ac.subVectors(c, a));
      if (n.lengthSq() < 1e-12) n.crossVectors(ab.subVectors(c, a), ac.subVectors(d4, a));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const shade = glow ? 1 : F[4] * (o.shade || 1);
      const base = this.P.length / 3;
      const [ua, va] = FUV[f];
      for (let q = 0; q < 4; q++) {
        const cn = cs[F[q]];
        this.P.push(cn.w.x, cn.w.y, cn.w.z);
        this.N.push(n.x, n.y, n.z);
        this.U.push(cn.l[ua] / 0.7, cn.l[va] / 0.7);
        this.C.push(_c.r * shade, _c.g * shade, _c.b * shade);
        this.G.push(glow);
      }
      this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }
  g(w, h, d, x, y, z, col, o = {}) { return this.b(w, h, d, x, y, z, col, { ...o, glow: 1 }); }
  build() {
    // centre the geometry on its bounds so corpse pieces settle around their real middle
    const P = this.P;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i < P.length; i += 3) { P[i] -= cx; P[i + 1] -= cy; P[i + 2] -= cz; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    geo.setAttribute('glow', new THREE.Float32BufferAttribute(this.G, 1));
    geo.setIndex(this.I);
    geo.computeBoundingSphere();
    return { geo, c: [cx, cy, cz] };
  }
}

// bones: [name, parent, x, y, z, build(S), material?]
const RIGS = new Map();
function buildRig(e, key, bones) {
  let geos = RIGS.get(key);
  if (!geos) {
    geos = bones.map((b) => { if (!b[5]) return null; const s = new Shape(); b[5](s); return s.I.length ? s.build() : null; });
    RIGS.set(key, geos);
  }
  const M = enemyMats();
  const J = {};
  for (let i = 0; i < bones.length; i++) {
    const [name, parent, x, y, z, , matName] = bones[i];
    const piv = new THREE.Group();
    piv.position.set(x, y, z);
    const gd = geos[i];
    if (gd) {
      const skin = matName || e.skinName;
      const mesh = new THREE.Mesh(gd.geo, M[skin]);
      mesh.position.set(gd.c[0], gd.c[1], gd.c[2]);
      mesh.userData.mat = M[skin];
      mesh.userData.skin = skin;
      piv.add(mesh);
      piv.userData.mesh = mesh;
    }
    (parent ? J[parent] : e.group).add(piv);
    J[name] = piv;
  }
  e.joints = J;
  return J;
}

// Standard biped skeleton. o: thigh shin hipW torsoH shW upper fore neck headZ headC + part builders.
const HUMAN_KEYS = ['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
function humanBones(o) {
  const legH = o.thigh + o.shin;
  const bones = [
    ['hips', null, 0, legH + 0.04, 0, o.pelvis],
    ['legL', 'hips', -o.hipW, -0.04, 0, o.leg && ((S) => o.leg(S, -1))],
    ['shinL', 'legL', 0, -o.thigh, 0, o.shinB && ((S) => o.shinB(S, -1))],
    ['legR', 'hips', o.hipW, -0.04, 0, o.leg && ((S) => o.leg(S, 1))],
    ['shinR', 'legR', 0, -o.thigh, 0, o.shinB && ((S) => o.shinB(S, 1))],
    ['torso', 'hips', 0, 0.04, 0, o.chest],
    ['head', 'torso', 0, o.torsoH + o.neck, o.headZ || 0, o.head],
    ['armL', 'torso', -o.shW, o.torsoH - 0.08, 0, o.arm && ((S) => o.arm(S, -1))],
    ['foreL', 'armL', 0, -o.upper, 0, o.fore && ((S) => o.fore(S, -1))],
    ['armR', 'torso', o.shW, o.torsoH - 0.08, 0, o.arm && ((S) => o.arm(S, 1))],
    ['foreR', 'armR', 0, -o.upper, 0, o.fore && ((S) => o.fore(S, 1))],
  ];
  if (o.noLegs) return bones.filter((b) => !/^(leg|shin)/.test(b[0]));
  if (o.extra) bones.push(...o.extra);
  return bones;
}

export const ENEMY_INFO = {
  husk: { name: 'HUSK', desc: 'Basic ranged trooper' },
  ripper: { name: 'RIPPER', desc: 'Fast melee lunger' },
  gunner: { name: 'GUNNER', desc: 'Telegraphed burst fire' },
  lancer: { name: 'LANCER', desc: 'Laser-sighted sniper' },
  bulwark: { name: 'BULWARK', desc: 'Front-shielded heavy' },
  signaller: { name: 'SIGNALLER', desc: 'Calls in backup' },
  wisp: { name: 'WISP', desc: 'Kamikaze drone' },
  swarmer: { name: 'SWARMER', desc: 'Pack hunter that hops at you', hint: 'SWARMERS hunt in packs and hop at you after a crouch. Splash damage, the shotgun and ground slams clear them fast.' },
  leech: { name: 'LEECH', desc: 'Latches on and drains you', hint: 'LEECH: it rears up, then leaps at you and drains health. Sidestep the leap. If it latches on, PUNCH or DASH to tear it off.' },
  sentry: { name: 'SENTRY', desc: 'Turret with a sweeping beam', hint: 'SENTRY: after its red sight line it sweeps a low beam across the room. JUMP the beam or break line of sight. Shoot the lens; its back vents are soft.' },
  charger: { name: 'CHARGER', desc: 'Armored battering ram', hint: 'CHARGER: it paws the ground and paints a red lane, then charges. Sidestep late. Lure it into a wall to stun it, then hit the furnace on its back.' },
  stalker: { name: 'STALKER', desc: 'Cloaked ambusher', hint: 'STALKER: a cloaked hunter. Watch for the shimmer and listen for the hiss. It flashes green right before it strikes: dash away, then punish it.' },
  bomber: { name: 'BOMBER', desc: 'Carpet-bombing drone', hint: 'BOMBER: when its siren sounds it flies straight over you dropping bombs. Step out of the line of red circles, or shoot it down.' },
  cantor: { name: 'CANTOR', desc: 'Shields and heals allies', hint: 'CANTOR: its golden tether shields and heals another machine. Kill the Cantor first, or punch it to break the tether.' },
  mirror: { name: 'MIRROR KNIGHT', desc: 'Reflects bullets from the front', hint: 'MIRROR KNIGHT: bullets that hit its mirror come back at you (parry them!). Flank it, use explosives or the Lance, or punch to break its guard.' },
};

export const ELITE_MODS = {
  shielded: { name: 'SHIELDED', color: 0x40e0ff },
  frenzied: { name: 'FRENZIED', color: 0xff3040 },
  volatile: { name: 'VOLATILE', color: 0xff9020 },
  blinking: { name: 'BLINKING', color: 0xc060ff },
};

// ---------------------------------------------------------------------------------------
// Base enemy
// ---------------------------------------------------------------------------------------
export class Enemy {
  constructor(game, type, pos, opts) {
    this.game = game;
    this.type = type;
    this.body = { pos: pos.clone(), vel: new THREE.Vector3(), r: 0.4, h: 1.9, grounded: false, step: 0.45 };
    this.pos = this.body.pos;
    this.yaw = Math.atan2(game.player.body.pos.x - pos.x, game.player.body.pos.z - pos.z);
    this.alive = true;
    this.targetable = false;
    this.spawnT = 0.9;
    this.state = 'idle'; this.stateT = 0;
    this.attackCd = 1 + Math.random() * 1.2;
    this.stagger = 0;
    this.flashT = 0;
    this.airTime = 0;
    this.radius = 0.42; this.headY = 1.68; this.headR = 0.24; this.bodyY0 = 0; this.bodyY1 = 1.5;
    this.styleValue = 20;
    this.bloodColor = [0.7, 0.06, 0.08];
    this.shield = 0; this.shieldMax = 0; this.shieldDelay = 0;
    this.elite = opts.elite || null;
    this.perch = opts.perch || null;
    this.hpMul = opts.hpMul || 1;
    this.dmgMul = opts.dmgMul || 1;
    this.aggr = opts.aggr || 1; // cooldown multiplier (<1 = more aggressive)
    this.speedMul = 1;
    this.windMul = 1;
    this.canSee = false; this.seeT = Math.random() * 0.2;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.walk = 0;
    this.stuckT = 0;
    this.blinkCd = 3;
    this.recentDmg = 0;
    this.v = new THREE.Vector3(); this.c = new THREE.Vector3(); this.h = new THREE.Vector3(); this.wp = { x: 0, z: 0 };
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.parts = {};
    this.meshes = [];
    // animation state
    this.seed = Math.random() * 100;
    this.skinName = 'metal';
    this.joints = null; this.tg = null; this.cr = null;
    this.flinch = 0; this.flinchX = 0; this.flinchZ = 0; this.flinchH = 0;
    this.eyes = null; this.eyeFlare = 0;
    this.dropC = 0;
    this.gait = { stride: 0.7, knee: 0.9, arm: 0.45, bob: 0.05, lean: 0.1 };
    this.wardT = 0;
  }

  finishSetup(maxHp) {
    this.maxHp = maxHp * this.hpMul * (this.elite ? 1.6 : 1);
    this.hp = this.maxHp;
    if (this.elite === 'shielded') { this.shieldMax = this.maxHp * 0.5; this.shield = this.shieldMax; }
    if (this.elite === 'frenzied') { this.speedMul = 1.35; this.aggr *= 0.65; this.windMul = 0.75; }
    this.group.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    if (!shadowGeo) { shadowGeo = new THREE.CircleGeometry(1, 10); shadowGeo.rotateX(-Math.PI / 2); }
    this.shadow = new THREE.Mesh(shadowGeo, sharedMaterials().shadow);
    this.shadow.scale.setScalar(this.radius * 1.3);
    this.game.scene.add(this.shadow);
    if (this.elite) {
      if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.8, 1, 16); ringGeo.rotateX(-Math.PI / 2); }
      const col = ELITE_MODS[this.elite].color;
      this.eliteRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.eliteRing.scale.setScalar(this.radius * 2.2);
      this.game.scene.add(this.eliteRing);
      this.group.scale.setScalar(1.12);
      this.headY *= 1.12; this.bodyY1 *= 1.12; this.radius *= 1.1;
      if (this.elite === 'shielded') {
        if (!shellGeo) shellGeo = new THREE.IcosahedronGeometry(1, 1);
        this.shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.game.scene.add(this.shell);
      }
    }
    this.headY0 = this.headY; this.bodyY10 = this.bodyY1;
    this.group.visible = false;
    this.game.scene.add(this.group);
    this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, this.elite ? ELITE_MODS[this.elite].color : 0xff3050, this.spawnT, this.bodyY1 + 1.5);
    this.game.audio.play('spawn', this.pos, 0.6);
  }

  // pose targets for the joints that exist on this rig
  initPose(keys = HUMAN_KEYS) {
    const J = this.joints;
    this.jkeys = keys.filter((k) => J[k]);
    this.tg = {}; this.cr = {};
    for (const k of this.jkeys) { this.tg[k] = { x: 0, y: 0, z: 0 }; this.cr[k] = { x: 0, y: 0, z: 0 }; }
    this.tg.drop = 0; this.tg.rate = 12;
    this.hipY = J.hips ? J.hips.position.y : 0;
    this.legLen = J.shinL ? -J.shinL.position.y * 2 : 0.9;
  }

  addEyes(bone, kind, color, x, y, z, size = 0.34) {
    const s = new THREE.Sprite(eyeMat(kind, color));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.userData.size = size;
    s.userData.kind = kind;
    (this.joints && this.joints[bone] || this.group).add(s);
    this.eyes = s;
    return s;
  }

  // material set: base skin per mesh, NG+ corruption, or cloak
  applySkin(cloak = false) {
    const M = enemyMats();
    for (const m of this.meshes) {
      const sk = m.userData.skin;
      if (!sk) continue;
      const mat = cloak ? M.cloak : M[sk + (this.corrupt ? 'X' : '')];
      m.userData.mat = mat;
      if (!this.flashing) m.material = mat;
    }
    if (this.eyes && this.corrupt && !cloak) this.eyes.material = eyeMat(this.eyes.userData.kind, 0xc060ff);
    this.cloaked = cloak;
  }

  centerPos() { return this.c.set(this.pos.x, this.pos.y + (this.bodyY0 + this.bodyY1) * 0.5, this.pos.z); }
  headPos() { return this.h.set(this.pos.x, this.pos.y + this.headY, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y + this.headY, this.pos.z); }

  playerDist() {
    const p = this.game.player.body.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  faceToward(x, z, dt, rate = 8) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw += angleDiff(this.yaw, target) * Math.min(1, rate * dt);
  }

  // Steering toward a point using the room flow field when needed.
  navMove(dt, tx, tz, speed, direct = false) {
    const room = this.game.level.current;
    let gx = tx, gz = tz;
    if (this.perch) {
      gx = clamp(tx, this.perch.x0, this.perch.x1);
      gz = clamp(tz, this.perch.z0, this.perch.z1);
    } else if (!direct && room && room.nav) {
      const s = room.nav.step(this.pos.x, this.pos.z, this.wp);
      if (s) { gx = s.x; gz = s.z; }
    }
    let dx = gx - this.pos.x, dz = gz - this.pos.z;
    const l = Math.hypot(dx, dz);
    let vx = 0, vz = 0;
    if (l > 0.15) { vx = dx / l * speed; vz = dz / l * speed; }
    this.applySteer(dt, vx, vz);
  }

  applySteer(dt, vx, vz) {
    // separation
    for (const o of this.game.enemies.list) {
      if (o === this || !o.alive || o.flying || o.latched) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + o.radius + 0.3);
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        vx += dx / d * 2.5; vz += dz / d * 2.5;
      }
    }
    const k = 1 - Math.exp(-10 * dt);
    this.body.vel.x += (vx - this.body.vel.x) * k;
    this.body.vel.z += (vz - this.body.vel.z) * k;
  }

  stop(dt) { this.applySteer(dt, 0, 0); }

  // strafe around the player (used by ranged troopers)
  strafe(dt, sp) {
    const p = this.game.player.body.pos;
    this.strafeT -= dt;
    if (this.strafeT <= 0 || this.body.wallNormalX || this.body.wallNormalZ) { this.strafeDir *= -1; this.strafeT = 1.2 + Math.random() * 1.8; }
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
    this.applySteer(dt, -dz / l * sp * this.strafeDir, dx / l * sp * this.strafeDir);
  }

  // back away from the player along the flow field's opposite
  retreat(dt, sp) {
    const p = this.game.player.body.pos;
    this.navMove(dt, this.pos.x - (p.x - this.pos.x), this.pos.z - (p.z - this.pos.z), sp, true);
  }

  physics(dt) {
    const b = this.body;
    if (!this.flying) b.vel.y -= 25 * dt;
    const bx = this.pos.x, by = this.pos.y, bz = this.pos.z;
    moveBody(b, b.vel.x * dt, b.vel.y * dt, b.vel.z * dt, this.game.level.colliders);
    if (!this.flying) this.game.level.applyEnemyProps(this, dt);
    if (this.perch) {
      this.pos.x = clamp(this.pos.x, this.perch.wx0, this.perch.wx1);
      this.pos.z = clamp(this.pos.z, this.perch.wz0, this.perch.wz1);
    }
    if (b.grounded) this.airTime = 0; else this.airTime += dt;
    // keep inside current room
    const room = this.game.level.current;
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 0.3)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 0.6, room.origin.x + room.W / 2 - 0.6);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 0.6, room.origin.z + room.D / 2 - 0.6);
    }
    if (this.pos.y < -10 && room) {
      const k = room.nav.nearestFree(room.origin.x, room.origin.z, 8);
      if (k >= 0) { room.nav.center(k, this.wp); this.pos.set(this.wp.x, 0.2, this.wp.z); b.vel.set(0, 0, 0); }
    }
    const moved = Math.hypot(this.pos.x - bx, this.pos.y - by, this.pos.z - bz);
    this.walk += moved * 2.2;
  }

  updateSight(dt) {
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.2 + Math.random() * 0.1;
      const cam = this.game.camera.position;
      this.canSee = this.game.combat.losClear(this.eyePos(this.v), cam);
    }
  }

  onHit(info, amount) {
    this.flashT = 0.07;
    this.recentDmg += amount;
    if (info.stagger && this.stagger < info.stagger && this.staggerable !== false) {
      this.stagger = info.stagger * (this.heavy ? 0.4 : 1);
    }
    if (info.knock && info.dir && !this.anchored) {
      const k = info.knock * (this.heavy ? 0.25 : 1);
      this.body.vel.x += info.dir.x * k;
      this.body.vel.z += info.dir.z * k;
      if (k > 6 && !this.flying) this.body.vel.y = Math.max(this.body.vel.y, k * 0.3);
    }
    // hit flinch: torso snaps along the impact, head whips on headshots
    if (info.dir && this.tg) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const f = info.dir.x * fx + info.dir.z * fz, r = info.dir.x * fz - info.dir.z * fx;
      const k = Math.min(0.55, 0.16 + amount / Math.max(1, this.maxHp) * 1.6) * (this.heavy ? 0.5 : 1);
      this.flinch = 1;
      this.flinchX = f * k; this.flinchZ = -r * k;
      this.flinchH = (info.part === 'head' ? 1.4 : 0.3) * (f || -1) * k;
    }
    if (this.elite === 'blinking' && this.recentDmg > this.maxHp * 0.22 && this.blinkCd <= 0 && this.hp > 0) this.blink();
  }

  blink() {
    const room = this.game.level.current;
    if (!room) return;
    const p = this.game.player.body.pos;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 6;
      const k = room.nav.idx(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      if (k >= 0 && room.nav.free(k)) {
        room.nav.center(k, this.wp);
        this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, 0xc060ff, 0.4, 3);
        this.pos.set(this.wp.x, this.flying ? this.pos.y : 0.05, this.wp.z);
        this.game.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, 0xc060ff, 0.4, 3);
        this.game.audio.play('spawn', this.pos, 0.5);
        this.blinkCd = 3.5;
        this.recentDmg = 0;
        this.stagger = 0.4;
        break;
      }
    }
  }

  // Cantor wards: a tethered ally carries a temporary regenerating shield
  ward(hpFrac) {
    if (!this.wardShield && this.shieldMax === 0) { this.wardShield = true; this.shieldMax = this.maxHp * hpFrac; this.shield = 0; }
    this.wardT = 0.35;
  }
  unward() { if (this.wardShield) { this.wardShield = false; this.shieldMax = 0; this.shield = 0; } }

  update(dt) {
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      this.group.visible = this.spawnT < 0.45 && Math.random() < 0.85;
      if (this.spawnT <= 0) {
        this.group.visible = true; this.targetable = true;
        const info = ENEMY_INFO[this.type];
        if (info && info.hint && this.game.onceHint) this.game.onceHint('enemy-' + this.type, info.hint, 7);
      }
      this.syncVisual(dt);
      if (this.spawnT > 0.45) return;
    }
    this.flashT -= dt;
    this.stateT -= dt;
    this.attackCd -= dt;
    this.blinkCd -= dt;
    this.eyeFlare = Math.max(0, this.eyeFlare - dt * 2.5);
    this.recentDmg = Math.max(0, this.recentDmg - dt * this.maxHp * 0.2);
    if (this.wardT > 0) { this.wardT -= dt; if (this.wardT <= 0) this.unward(); }
    if (this.shieldMax > 0) {
      this.shieldDelay -= dt;
      if (this.shieldDelay <= 0) this.shield = Math.min(this.shieldMax, this.shield + this.shieldMax * 0.3 * dt);
    }
    this.updateSight(dt);
    if (this.spawnT <= 0) {
      // arc EMP stun applies to every type (Minibosses use stun() as a method, hence the typeof)
      if (typeof this.stun === 'number' && this.stun > 0 && !this.flying) { this.stun -= dt; this.stagger = Math.max(this.stagger, 0.05); }
      if (this.stagger > 0) {
        this.stagger -= dt;
        this.stop(dt);
        this.onStagger && this.onStagger();
      } else this.think(dt);
    }
    this.physics(dt);
    this.syncVisual(dt);
  }

  syncVisual(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.shadow.position.set(this.pos.x, this.gy() + 0.03, this.pos.z);
    if (this.eliteRing) {
      this.eliteRing.position.set(this.pos.x, this.gy() + 0.05, this.pos.z);
      this.eliteRing.rotation.y += dt * 2;
      this.eliteRing.material.opacity = 0.5 + 0.3 * Math.sin(this.game.time * 6);
    }
    if (this.shell) {
      this.shell.position.copy(this.centerPos());
      const s = (this.bodyY1 - this.bodyY0) * 0.75;
      this.shell.scale.set(s * 0.8, s, s * 0.8);
      this.shell.visible = this.shield > 0 && this.group.visible;
      this.shell.material.opacity = 0.1 + 0.25 * (this.shield / this.shieldMax) + (this.flashT > 0 ? 0.3 : 0);
    }
    if (this.joints && !!this.corrupt !== !!this.corruptSkin) { this.corruptSkin = !!this.corrupt; this.applySkin(this.cloaked); }
    const flash = this.flashT > 0;
    if (flash !== this.flashing) {
      this.flashing = flash;
      const fm = sharedMaterials().flash;
      for (const m of this.meshes) m.material = flash ? fm : m.userData.mat;
    }
    if (this.eyes) {
      const cam = this.game.camera.position;
      const d = Math.hypot(cam.x - this.pos.x, cam.y - this.pos.y - this.headY, cam.z - this.pos.z);
      const s = Math.max(this.eyes.userData.size, d * 0.012) * (1 + this.eyeFlare * 0.9);
      this.eyes.scale.set(s, s, s);
    }
    this.animate(dt);
  }

  groundY() { return this.flying ? this.groundLevel || 0 : this.pos.y; }
  // works whether a subclass exposes groundY as a method or a getter
  gy() { const v = this.groundY; return typeof v === 'function' ? v.call(this) : v; }

  // ---- procedural animation (bipeds): gait + type pose + stagger + flinch, all smoothed
  pose() {}
  crouch(T, d) {
    const L = Math.max(0.3, this.legLen * 0.5);
    const a = Math.acos(clamp(1 - d / (2 * L), -1, 1));
    T.drop += d;
    if (T.legL) { T.legL.x -= a; T.legR.x -= a; T.shinL.x += 2 * a; T.shinR.x += 2 * a; }
  }
  staggerPose(T, t) {
    T.torso.x = 0.45 + Math.sin(t * 7 + this.seed) * 0.1;
    T.torso.z = Math.sin(t * 5.3 + this.seed) * 0.2;
    if (T.head) { T.head.x = 0.5; T.head.z = Math.sin(t * 4.1) * 0.35; }
    if (T.armL) { T.armL.x = 0.2; T.armL.z = -0.25; T.armR.x = 0.2; T.armR.z = 0.25; }
    if (T.foreL) { T.foreL.x = -0.15; T.foreR.x = -0.15; }
    this.crouch(T, 0.14);
    T.rate = 9;
    if (Math.random() < 0.08) this.game.fx.sparks.spawn(this.pos.x + (Math.random() - 0.5) * 0.4, this.pos.y + this.headY + 0.3, this.pos.z + (Math.random() - 0.5) * 0.4, 0, 1.2, 0, 1, 0.9, 0.4, 1, 0.08, 0.35, 0, 0);
  }
  animate(dt) {
    if (!this.tg) return;
    const T = this.tg, J = this.joints, G = this.gait, t = this.game.time;
    const keys = this.jkeys;
    for (let i = 0; i < keys.length; i++) { const o = T[keys[i]]; o.x = 0; o.y = 0; o.z = 0; }
    T.drop = 0; T.rate = 12;
    const v = Math.hypot(this.body.vel.x, this.body.vel.z);
    const amt = Math.min(1, v / Math.max(1.5, (this.speed || 3) * 0.75));
    const s = Math.sin(this.walk), c = Math.cos(this.walk);
    if (T.legL) {
      T.legL.x = -s * G.stride * amt; T.legR.x = s * G.stride * amt;
      T.shinL.x = (0.08 + Math.max(0, c) * G.knee) * amt; T.shinR.x = (0.08 + Math.max(0, -c) * G.knee) * amt;
      T.drop = (0.5 - Math.abs(c)) * G.bob * amt;
    }
    if (T.armL) { T.armL.x = s * G.arm * amt; T.armR.x = -s * G.arm * amt; }
    if (T.foreL) { T.foreL.x = -0.2 * amt; T.foreR.x = -0.2 * amt; }
    T.torso.x = G.lean * amt + Math.sin(t * 2.1 + this.seed) * 0.025;
    T.torso.y = s * 0.1 * amt;
    if (T.head) { T.head.x = -G.lean * amt * 0.6; T.head.y = Math.sin(t * 0.8 + this.seed) * 0.14 * (1 - amt); }
    this.pose(T, dt, amt);
    if (this.stagger > 0) this.staggerPose(T, t);
    const k = 1 - Math.exp(-T.rate * dt);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i], a = T[key], b = this.cr[key];
      b.x += (a.x - b.x) * k; b.y += (a.y - b.y) * k; b.z += (a.z - b.z) * k;
      J[key].rotation.set(b.x, b.y, b.z);
    }
    this.dropC += (T.drop - this.dropC) * k;
    if (J.hips) J.hips.position.y = this.hipY - this.dropC;
    this.headY = this.headY0 - this.dropC; this.bodyY1 = this.bodyY10 - this.dropC * 0.8;
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 6);
      const f = this.flinch * this.flinch;
      J.torso.rotation.x += this.flinchX * f; J.torso.rotation.z += this.flinchZ * f;
      if (J.head) J.head.rotation.x += this.flinchH * f;
    }
  }

  // death collapse: knees buckle, the body tips along the killing blow, limbs flop
  deathPose(k, d) {
    const J = this.joints;
    if (!J || !J.torso) return;
    const b = Math.min(1, k * 2.2);
    if (J.legL) {
      J.legL.rotation.x = -0.55 * b; J.shinL.rotation.x = 1.0 * b;
      J.legR.rotation.x = -0.15 * b; J.shinR.rotation.x = 0.5 * b;
      J.hips.position.y = this.hipY - this.dropC - 0.12 * b;
    }
    J.torso.rotation.x = d.lz * 0.35 * k; J.torso.rotation.z = -d.lx * 0.2 * k;
    if (J.head) J.head.rotation.x = d.lz * 0.7 * k + 0.2;
    if (J.armL) {
      J.armL.rotation.x = -d.lz * 1.3 * k; J.armL.rotation.z = -0.7 * k;
      J.armR.rotation.x = -d.lz * 1.1 * k; J.armR.rotation.z = 0.7 * k;
    }
    if (J.foreL) { J.foreL.rotation.x = -0.4 * k; J.foreR.rotation.x = -0.6 * k; }
  }

  // shoot an orb at the player with lead
  shootAt(speed, dmg, opts = {}) {
    const g = this.game;
    const from = opts.from || this.muzzlePos();
    const target = g.camera.position.clone();
    target.y -= 0.35;
    const pv = g.player.body.vel;
    const dist = from.distanceTo(target);
    const lead = (opts.lead !== undefined ? opts.lead : 0.35) * dist / speed;
    target.x += pv.x * lead; target.z += pv.z * lead;
    const dir = target.sub(from).normalize();
    if (opts.spread) {
      dir.x += (Math.random() - 0.5) * opts.spread; dir.y += (Math.random() - 0.5) * opts.spread * 0.5; dir.z += (Math.random() - 0.5) * opts.spread;
      dir.normalize();
    }
    if (opts.yawOff) dir.applyAxisAngle(V3.set(0, 1, 0), opts.yawOff);
    g.projectiles.spawnEnemy(from, dir.multiplyScalar(speed), dmg * this.dmgMul, {
      color: opts.color || 0xff5030, radius: opts.radius || 0.2, size: opts.size || 0.2, owner: this,
      cause: opts.cause || ENEMY_INFO[this.type].name, tip: opts.tip, explode: opts.explode || 0, homing: opts.homing || 0, life: opts.life || 4,
    });
  }

  // world position of the weapon tip (rigged types) or a generic hand position
  muzzlePos() {
    if (this.muzzle) {
      this.group.updateMatrixWorld(true);
      return this.muzzle.bone.localToWorld(this.muzzle.at.clone());
    }
    const out = new THREE.Vector3(0.35, 1.35, 0.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return out.add(this.pos);
  }

  die(info) {
    const g = this.game;
    this.alive = false;
    this.targetable = false;
    const dir = info.dir ? info.dir.clone() : new THREE.Vector3(0, 0, 0);
    const force = Math.min(14, (info.knock || 3) + (info.source === 'explosion' ? 6 : 2));
    // restore materials before handing meshes to the corpse system
    for (const m of this.meshes) m.material = m.userData.mat;
    this.flashing = false;
    if (this.cloaked) this.applySkin(false);
    if (this.eyes) this.eyes.visible = false;
    const gib = info.source === 'explosion' || info.source === 'self' || force > 10 || !this.joints || this.flying || !this.body.grounded || this.latched;
    if (gib) {
      for (const m of this.meshes.slice()) {
        if (m.userData.noCorpse) continue;
        const v = new THREE.Vector3(dir.x * force + (Math.random() - 0.5) * 3, 2 + Math.random() * 3 + (gib ? 4 : 0), dir.z * force + (Math.random() - 0.5) * 3);
        if (info.part === 'head' && m === this.headMesh) { v.y += 6; v.x += dir.x * 4; v.z += dir.z * 4; }
        g.fx.addCorpsePiece(m, v, new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
      }
      g.fx.chunks(this.centerPos(), 0x5a1010, 10, 9, 0.12);
      g.scene.remove(this.group);
    } else {
      // headshot kills pop the head clean off; the rest collapses
      if (info.part === 'head' && this.headMesh && this.headMesh.parent) {
        this.decapitated = true;
        g.fx.addCorpsePiece(this.headMesh, new THREE.Vector3(dir.x * 3 + (Math.random() - 0.5) * 2, 6 + Math.random() * 2, dir.z * 3 + (Math.random() - 0.5) * 2), new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14));
        g.fx.blood(this.headPos(), new THREE.Vector3(0, 1, 0), 2, this.bloodColor);
      }
      g.fx.chunks(this.centerPos(), 0x5a1010, 4, 4, 0.1);
      g.enemies.collapse(this, dir, force);
    }
    g.fx.blood(this.centerPos(), dir.setY(0.5).normalize(), gib ? 3 : 1.6, this.bloodColor);
    this.cleanupExtras();
    if (this.elite === 'volatile') {
      const p = this.centerPos().clone();
      g.fx.telegraphDisc(p.x, this.pos.y, p.z, 4, 0xff9020, 0.8);
      g.audio.play('windup', p, 0.8);
      g.enemies.delayed(0.8, () => {
        g.fx.explosion(p, 4, 0xff9020);
        g.audio.play('explosion', p, 1);
        g.combat.radialDamage(p, 4, 30 * this.dmgMul, { source: 'explosion', friendly: true, cause: 'VOLATILE ELITE', tip: 'Volatile elites detonate a second after death. Back off from the orange circle.' });
      });
    }
    if (this.onDeath) this.onDeath(info);
  }

  cleanupExtras() {
    this.game.scene.remove(this.shadow);
    if (this.eliteRing) { this.game.scene.remove(this.eliteRing); this.eliteRing.material.dispose(); }
    if (this.shell) { this.game.scene.remove(this.shell); this.shell.material.dispose(); }
    if (this.extraCleanup) this.extraCleanup();
  }

  remove() {
    this.game.scene.remove(this.group);
    this.cleanupExtras();
  }

  // gallery / test hook: enter the attack wind-up and hold it
  forceAttack() { this.attackCd = 0; }
}

// small helpers for rig art
const side = (s, v) => s * v;

// ---------------------------------------------------------------------------------------
// HUSK: reanimated maintenance trooper. Gas mask, hard hat with a headlamp, air tank, carbine.
// ---------------------------------------------------------------------------------------
const HUSK_RIG = (() => {
  const suit = 0x6e6048, dark = 0x26221e, rust = 0x9a4418, steel = 0x464850, mask = 0x56524a, glow = 0xff8a20;
  return humanBones({
    thigh: 0.44, shin: 0.44, hipW: 0.12, torsoH: 0.6, shW: 0.29, upper: 0.3, fore: 0.3, neck: 0.04,
    pelvis: (S) => { S.b(0.4, 0.2, 0.26, 0, -0.06, 0, dark); S.b(0.1, 0.1, 0.07, -0.13, -0.04, 0.15, suit); S.b(0.1, 0.1, 0.07, 0.13, -0.04, 0.15, suit); },
    leg: (S) => { S.b(0.17, 0.44, 0.19, 0, -0.22, 0, suit); S.b(0.15, 0.1, 0.06, 0, -0.4, 0.1, rust); },
    shinB: (S) => { S.b(0.15, 0.36, 0.17, 0, -0.19, 0, suit, { bot: [0.9, 0.9] }); S.b(0.17, 0.12, 0.28, 0, -0.38, 0.04, dark, { top: [0.9, 0.8] }); },
    chest: (S) => {
      S.b(0.36, 0.26, 0.24, 0, 0.13, 0, suit); S.b(0.46, 0.34, 0.28, 0, 0.42, 0, suit, { bot: [0.85, 0.9] });
      S.b(0.38, 0.24, 0.06, 0, 0.42, 0.15, steel, { top: [0.9, 1] }); S.b(0.28, 0.07, 0.26, 0, 0.6, 0, dark);
      S.b(0.26, 0.42, 0.16, 0, 0.36, -0.22, steel); S.b(0.27, 0.05, 0.17, 0, 0.25, -0.22, rust); S.b(0.2, 0.06, 0.12, 0, 0.6, -0.22, rust);
      S.b(0.04, 0.32, 0.04, 0.12, 0.47, -0.1, dark, { rx: 0.4 }); S.g(0.07, 0.04, 0.02, -0.07, 0.48, -0.305, glow);
    },
    head: (S) => {
      S.b(0.24, 0.26, 0.25, 0, 0.12, 0, mask, { top: [0.9, 0.9] }); S.b(0.23, 0.09, 0.03, 0, 0.16, 0.12, dark); S.g(0.19, 0.045, 0.03, 0, 0.16, 0.13, glow);
      S.b(0.08, 0.08, 0.1, -0.08, 0.04, 0.14, dark, { rx: 0.3 }); S.b(0.08, 0.08, 0.1, 0.08, 0.04, 0.14, dark, { rx: 0.3 });
      S.b(0.3, 0.09, 0.32, 0, 0.29, 0, rust, { top: [0.8, 0.8] }); S.b(0.34, 0.025, 0.37, 0, 0.255, 0.01, rust); S.g(0.07, 0.05, 0.03, 0, 0.29, 0.165, 0xfff0b0);
    },
    arm: (S) => { S.b(0.13, 0.3, 0.14, 0, -0.14, 0, suit); S.b(0.2, 0.12, 0.22, 0, 0.0, 0, rust, { top: [0.8, 0.8] }); },
    fore: (S, s) => {
      S.b(0.12, 0.26, 0.13, 0, -0.13, 0, suit); S.b(0.13, 0.1, 0.13, 0, -0.3, 0, dark);
      if (s > 0) { // carbine along the forearm (points forward once the arm is raised)
        S.b(0.08, 0.52, 0.12, 0, -0.44, 0.06, steel); S.b(0.06, 0.16, 0.1, 0, -0.18, 0.04, dark);
        S.b(0.05, 0.08, 0.15, 0, -0.38, -0.1, dark); S.b(0.03, 0.06, 0.05, 0, -0.32, 0.14, dark); S.g(0.05, 0.05, 0.05, 0, -0.72, 0.06, glow);
      }
    },
  });
})();

class Husk extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'husk', pos, opts);
    const J = buildRig(this, 'husk', HUSK_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'slit', 0xff8a20, 0, 0.16, 0.2, 0.3);
    this.muzzle = { bone: J.foreR, at: new THREE.Vector3(0, -0.76, 0.06) };
    this.headY = 0.92 + 0.04 + 0.6 + 0.04 + 0.13; this.bodyY1 = 1.55; this.headR = 0.22;
    this.speed = 3.4;
    this.styleValue = 18;
    this.recoil = 0;
    this.gait = { stride: 0.7, knee: 0.9, arm: 0.2, bob: 0.05, lean: 0.12 };
    this.finishSetup(60);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.faceToward(p.x, p.z, dt, 6);
    if (this.state === 'aim') {
      this.stop(dt);
      if (this.stateT <= 0) {
        this.shootAt(21, 9, { color: 0xff7020, tip: 'Husks fire slow orange orbs. Strafe or dash sideways, or parry them back.' });
        g.audio.play('enemyShot', this.pos, 0.7);
        this.state = 'move'; this.recoil = 1;
        this.attackCd = (1.5 + Math.random() * 1.2) * this.aggr;
      }
      return;
    }
    if (this.attackCd <= 0 && this.canSee && d < 32) { this.state = 'aim'; this.stateT = 0.45 * this.windMul; this.eyeFlare = 1; return; }
    const sp = this.speed * this.speedMul;
    if (!this.canSee || d > 15) this.navMove(dt, p.x, p.z, sp);
    else if (d < 6) this.retreat(dt, sp);
    else this.strafe(dt, sp * 0.8);
  }
  pose(T, dt) {
    this.recoil = Math.max(0, this.recoil - dt * 4);
    if (this.state === 'aim' || this.recoil > 0) {
      T.armR.x = -1.5 - this.recoil * 0.4; T.foreR.x = 0.05; T.armL.x = -1.25; T.armL.z = 0.5; T.foreL.x = -0.6;
      T.torso.y = -0.18; T.torso.x -= this.recoil * 0.15; T.rate = 16;
    } else {
      T.armR.x += this.canSee ? -0.55 : -0.25; T.foreR.x = -1.15; T.armL.x += -0.35; T.armL.z = 0.3; T.foreL.x = -1.05;
    }
  }
  forceAttack() { this.state = 'aim'; this.stateT = 9; }
}

// ---------------------------------------------------------------------------------------
// RIPPER: skeletal harvest drone on digitigrade legs, forearm flensing blades, dorsal fins.
// ---------------------------------------------------------------------------------------
const RIPPER_RIG = (() => {
  const chrome = 0x7a8296, dark = 0x1c1e24, blood = 0x6a0e18, bone = 0xc8c0b0, glow = 0xff2040;
  return humanBones({
    thigh: 0.42, shin: 0.46, hipW: 0.1, torsoH: 0.55, shW: 0.24, upper: 0.3, fore: 0.28, neck: 0.05, headZ: 0.06,
    pelvis: (S) => { S.b(0.3, 0.14, 0.2, 0, -0.04, 0, dark); S.b(0.08, 0.2, 0.08, 0, 0.04, -0.06, dark); S.b(0.04, 0.3, 0.04, 0, -0.1, -0.16, chrome, { rx: 0.9, bot: [0.2, 0.2] }); },
    leg: (S) => { S.b(0.1, 0.42, 0.12, 0, -0.21, 0, chrome, { bot: [0.75, 0.8] }); S.b(0.05, 0.14, 0.05, 0, -0.42, 0.1, dark, { rx: 1.1, top: [0, 0] }); },
    shinB: (S) => {
      S.b(0.08, 0.36, 0.09, 0, -0.18, 0, dark); S.b(0.12, 0.08, 0.24, 0, -0.42, 0.06, chrome, { top: [1, 0.6] });
      S.b(0.04, 0.12, 0.03, -0.04, -0.43, 0.22, bone, { rx: Math.PI / 2, top: [0, 0] }); S.b(0.04, 0.12, 0.03, 0.04, -0.43, 0.22, bone, { rx: Math.PI / 2, top: [0, 0] });
    },
    chest: (S) => {
      S.b(0.1, 0.55, 0.1, 0, 0.27, -0.06, dark);
      for (let i = 0; i < 3; i++) S.b(0.36 - i * 0.03, 0.07, 0.26, 0, 0.2 + i * 0.13, 0.02, chrome);
      S.b(0.1, 0.42, 0.06, 0, 0.33, 0.14, chrome); S.g(0.08, 0.08, 0.04, 0, 0.36, 0.08, glow);
      for (let i = 0; i < 3; i++) S.b(0.03, 0.24, 0.12, 0, 0.14 + i * 0.17, -0.15, blood, { rx: -0.7, top: [1, 0] });
    },
    head: (S) => {
      S.b(0.18, 0.15, 0.32, 0, 0.06, 0.05, chrome, { top: [0.7, 0.8] }); S.b(0.14, 0.05, 0.22, 0, -0.03, 0.08, dark);
      S.g(0.065, 0.025, 0.02, -0.045, 0.08, 0.215, glow, { rz: 0.4 }); S.g(0.065, 0.025, 0.02, 0.045, 0.08, 0.215, glow, { rz: -0.4 });
      S.b(0.03, 0.1, 0.3, 0, 0.17, -0.02, blood, { top: [1, 0.4] });
    },
    arm: (S, s) => { S.b(0.08, 0.3, 0.09, 0, -0.14, 0, chrome); S.b(0.06, 0.16, 0.06, 0, 0.07, 0, dark, { top: [0, 0], rz: side(s, -0.5) }); },
    fore: (S) => {
      S.b(0.08, 0.24, 0.08, 0, -0.12, 0, dark); S.b(0.1, 0.1, 0.12, 0, -0.26, 0, chrome);
      S.b(0.025, 0.8, 0.13, 0, -0.68, 0.04, bone, { bot: [1, 0.1] }); S.g(0.03, 0.62, 0.02, 0, -0.62, 0.105, glow, { bot: [1, 0.2] });
    },
  });
})();

class Ripper extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'ripper', pos, opts);
    const J = buildRig(this, 'ripper', RIPPER_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'pair', 0xff2040, 0, 0.08, 0.25, 0.3);
    this.headY = 0.88 + 0.04 + 0.04 + 0.55 + 0.05 + 0.06 - 0.12; this.bodyY1 = 1.38; this.headR = 0.2;
    this.speed = 7.4;
    this.radius = 0.38;
    this.styleValue = 22;
    this.bloodColor = [0.65, 0.05, 0.1];
    this.gait = { stride: 0.95, knee: 1.25, arm: 0.25, bob: 0.07, lean: 0.35 };
    this.finishSetup(45);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    if (this.state === 'windup') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 12);
      if (this.stateT <= 0) {
        this.state = 'lunge'; this.stateT = 0.32; this.hitDone = false;
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
        this.lungeX = dx / l; this.lungeZ = dz / l;
        g.audio.play('lunge', this.pos, 0.8);
      }
      return;
    }
    if (this.state === 'lunge') {
      const sp = 17 * this.speedMul;
      this.body.vel.x = this.lungeX * sp; this.body.vel.z = this.lungeZ * sp;
      if (!this.hitDone) {
        const pp = g.player.body.pos;
        if (Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < 1.5 && Math.abs(pp.y - this.pos.y) < 1.8) {
          this.hitDone = true;
          if (g.player.damage(18 * this.dmgMul, this.pos, 'RIPPER', 'Rippers crouch before lunging. Dash sideways when you see them crouch, then punish the recovery.')) {
            g.player.knock(this.lungeX * 8, 3, this.lungeZ * 8);
            g.audio.play('slash', this.pos, 1);
          }
        }
      }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.75; }
      return;
    }
    if (this.state === 'recover') {
      this.stop(dt);
      if (this.stateT <= 0) { this.state = 'chase'; this.attackCd = 0.5 * this.aggr; }
      return;
    }
    this.faceToward(p.x, p.z, dt, 10);
    if (d < 4.6 && this.canSee && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 2) {
      this.state = 'windup'; this.stateT = 0.38 * this.windMul; this.eyeFlare = 1;
      g.audio.play('windup', this.pos, 0.6);
      return;
    }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 5);
  }
  pose(T) {
    const st = this.state;
    if (st === 'windup') {
      this.crouch(T, 0.24); T.torso.x = 0.8; T.head.x = -0.6;
      T.armL.x = 0.8; T.armL.z = -0.7; T.foreL.x = -1.3; T.armR.x = 0.8; T.armR.z = 0.7; T.foreR.x = -1.3; T.rate = 20;
    } else if (st === 'lunge') {
      T.torso.x = 0.65; T.head.x = -0.5; T.armL.x = -1.9; T.armL.z = 0.35; T.foreL.x = -0.1; T.armR.x = -1.9; T.armR.z = -0.35; T.foreR.x = -0.1;
      T.legL.x = -0.9; T.legR.x = 0.7; T.shinR.x = 0.6; T.rate = 26;
    } else if (st === 'recover') {
      this.crouch(T, 0.12); T.torso.x = 0.45; T.armL.x = 0.1; T.foreL.x = -0.3; T.armR.x = 0.1; T.foreR.x = -0.3; T.rate = 8;
    } else {
      this.crouch(T, 0.06); T.torso.x += 0.25; T.head.x -= 0.25;
      T.armL.x += -0.55; T.armL.z = -0.3; T.foreL.x = -0.95; T.armR.x += -0.55; T.armR.z = 0.3; T.foreR.x = -0.95;
    }
  }
  forceAttack() { this.state = 'windup'; this.stateT = 9; }
}

// ---------------------------------------------------------------------------------------
// GUNNER: wide security heavy with a spinning rotary cannon and an ammo-drum backpack.
// ---------------------------------------------------------------------------------------
const GUNNER_RIG = (() => {
  const olive = 0x4e5a38, dark = 0x1c2018, plate = 0x74805a, hazard = 0xc8a020, steel = 0x38393e, glow = 0xffe23a;
  return humanBones({
    thigh: 0.46, shin: 0.46, hipW: 0.16, torsoH: 0.74, shW: 0.42, upper: 0.32, fore: 0.32, neck: 0.02,
    pelvis: (S) => { S.b(0.5, 0.24, 0.32, 0, -0.04, 0, dark); S.b(0.4, 0.2, 0.05, 0, -0.14, 0.17, plate, { rx: 0.15 }); },
    leg: (S) => { S.b(0.2, 0.46, 0.22, 0, -0.23, 0, olive); S.b(0.21, 0.24, 0.06, 0, -0.2, 0.11, plate); },
    shinB: (S) => { S.b(0.18, 0.38, 0.2, 0, -0.2, 0, olive); S.b(0.2, 0.14, 0.1, 0, -0.02, 0.1, plate); S.b(0.22, 0.14, 0.32, 0, -0.39, 0.04, dark); },
    chest: (S) => {
      S.b(0.48, 0.24, 0.32, 0, 0.12, 0, dark); S.b(0.66, 0.5, 0.38, 0, 0.47, 0, olive, { bot: [0.8, 0.85] });
      S.b(0.6, 0.34, 0.08, 0, 0.5, 0.2, plate, { top: [0.85, 1] }); S.b(0.12, 0.3, 0.085, -0.18, 0.5, 0.205, hazard);
      S.b(0.4, 0.1, 0.34, 0, 0.74, -0.02, dark); S.b(0.5, 0.46, 0.26, 0, 0.46, -0.31, steel); S.b(0.52, 0.06, 0.28, 0, 0.3, -0.31, hazard);
      S.g(0.06, 0.18, 0.03, -0.15, 0.48, -0.445, glow); S.g(0.06, 0.18, 0.03, 0.15, 0.48, -0.445, glow);
      for (let i = 0; i < 5; i++) S.b(0.07, 0.06, 0.08, 0.18 + i * 0.05, 0.6 + i * 0.03, -0.18 + i * 0.07, hazard);
    },
    head: (S) => {
      S.b(0.28, 0.26, 0.3, 0, 0.12, 0, plate, { top: [0.85, 0.85] }); S.b(0.32, 0.04, 0.34, 0, 0.18, 0, dark);
      S.b(0.22, 0.16, 0.04, 0, 0.08, 0.15, dark);
      S.g(0.05, 0.05, 0.02, -0.06, 0.11, 0.175, glow); S.g(0.05, 0.05, 0.02, 0.06, 0.11, 0.175, glow); S.g(0.05, 0.05, 0.02, 0, 0.04, 0.175, glow);
    },
    arm: (S, s) => { S.b(0.18, 0.32, 0.2, 0, -0.15, 0, olive); S.b(0.32, 0.18, 0.32, side(s, 0.03), 0.03, 0, plate, { top: [0.75, 0.8] }); S.b(0.33, 0.04, 0.33, side(s, 0.03), -0.02, 0, hazard); },
    fore: (S, s) => {
      if (s < 0) { S.b(0.16, 0.28, 0.18, 0, -0.14, 0, olive); S.b(0.18, 0.14, 0.2, 0, -0.3, 0, dark); return; }
      S.b(0.16, 0.2, 0.18, 0, -0.1, 0, olive); S.b(0.26, 0.32, 0.28, 0, -0.34, 0.02, steel); S.b(0.27, 0.05, 0.29, 0, -0.26, 0.02, hazard);
    },
    extra: [['gun', 'foreR', 0, -0.48, 0.02, (S) => {
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3; S.b(0.06, 0.52, 0.06, Math.cos(a) * 0.07, -0.26, Math.sin(a) * 0.07, dark); }
      S.b(0.22, 0.05, 0.22, 0, -0.1, 0, steel); S.b(0.2, 0.04, 0.2, 0, -0.44, 0, steel); S.g(0.06, 0.03, 0.06, 0, -0.53, 0, glow);
    }]],
  });
})();

class Gunner extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'gunner', pos, opts);
    const J = buildRig(this, 'gunner', GUNNER_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'tri', 0xffe23a, 0, 0.09, 0.2, 0.3);
    this.muzzle = { bone: J.gun, at: new THREE.Vector3(0, -0.56, 0) };
    this.headY = 0.96 + 0.04 + 0.74 + 0.02 + 0.12; this.bodyY1 = 1.74; this.headR = 0.22;
    this.radius = 0.5;
    this.speed = 2.6;
    this.styleValue = 30;
    this.spin = 0; this.spinV = 0;
    this.gait = { stride: 0.5, knee: 0.7, arm: 0.15, bob: 0.06, lean: 0.06 };
    this.finishSetup(95);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.faceToward(p.x, p.z, dt, this.state === 'burst' ? 3 : 6);
    if (this.state === 'windup') {
      this.stop(dt);
      // flickering laser sight telegraph
      if (Math.random() < 0.7) g.fx.beam(this.muzzlePos(), V1.copy(g.camera.position).setY(g.camera.position.y - 0.4), 0xffe23a, 0.025, 0.05);
      if (this.stateT <= 0) { this.state = 'burst'; this.shots = 4 + (this.elite ? 2 : 0); this.shotT = 0; }
      return;
    }
    if (this.state === 'burst') {
      this.stop(dt);
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = 0.1;
        this.shots--;
        this.shootAt(36, 6, { color: 0xffe23a, radius: 0.12, size: 0.11, spread: 0.08, lead: 0.2, tip: 'Gunners flash a yellow laser before a burst. Break line of sight when you see it.' });
        g.audio.play('enemyBurst', this.pos, 0.6);
        if (this.shots <= 0) { this.state = 'move'; this.attackCd = (2.4 + Math.random()) * this.aggr; }
      }
      return;
    }
    if (this.attackCd <= 0 && this.canSee && d < 30) { this.state = 'windup'; this.stateT = 0.75 * this.windMul; this.eyeFlare = 1; g.audio.play('windup', this.pos, 0.5); return; }
    if (!this.canSee || d > 13) this.navMove(dt, p.x, p.z, this.speed * this.speedMul);
    else this.stop(dt);
  }
  pose(T, dt) {
    const st = this.state, t = this.game.time;
    const firing = st === 'windup' || st === 'burst';
    this.spinV += ((st === 'burst' ? 34 : st === 'windup' ? 18 : 0) - this.spinV) * Math.min(1, dt * 4);
    this.spin += this.spinV * dt;
    this.joints.gun.rotation.y = this.spin;
    if (firing) {
      T.armR.x = -1.45; T.foreR.x = -0.08; T.armL.x = -1.1; T.armL.z = 0.55; T.foreL.x = -0.6;
      T.legL.x += -0.25; T.legR.x += 0.3; T.shinR.x += 0.3; T.legL.z = -0.08; T.legR.z = 0.08;
      if (st === 'burst') { const r = Math.sin(t * 70); T.torso.x -= 0.06 + r * 0.03; T.armR.x -= 0.05 * r; }
      T.rate = 14;
    } else {
      T.armR.x = -0.45; T.foreR.x = -1.0; T.armL.x += -0.25; T.armL.z = 0.15; T.foreL.x = -0.6;
    }
  }
  forceAttack() { this.state = 'windup'; this.stateT = 9; }
}

// ---------------------------------------------------------------------------------------
// LANCER: long-coated sniper with a hooded scope eye and a coil rail rifle. Kneels to aim.
// ---------------------------------------------------------------------------------------
const LANCER_RIG = (() => {
  const coat = 0x30344a, dark = 0x121216, trim = 0x8088a0, leather = 0x4a3a30, glow = 0xff2040, coil = 0x50c0ff;
  return humanBones({
    thigh: 0.48, shin: 0.48, hipW: 0.11, torsoH: 0.62, shW: 0.25, upper: 0.32, fore: 0.3, neck: 0.05,
    pelvis: (S) => {
      S.b(0.32, 0.18, 0.22, 0, -0.03, 0, dark);
      S.b(0.36, 0.5, 0.04, 0, -0.3, 0.13, coat, { bot: [1.15, 1] }); S.b(0.4, 0.58, 0.04, 0, -0.33, -0.13, coat, { bot: [1.2, 1] });
    },
    leg: (S) => { S.b(0.13, 0.48, 0.15, 0, -0.24, 0, dark); },
    shinB: (S) => { S.b(0.12, 0.38, 0.13, 0, -0.2, 0, dark); S.b(0.12, 0.12, 0.05, 0, -0.03, 0.08, trim); S.b(0.14, 0.14, 0.26, 0, -0.41, 0.04, leather); },
    chest: (S) => {
      S.b(0.42, 0.62, 0.26, 0, 0.31, 0, coat, { top: [1.05, 1], bot: [0.85, 0.9] });
      S.b(0.1, 0.4, 0.03, -0.08, 0.38, 0.135, trim, { rz: 0.2 }); S.b(0.1, 0.4, 0.03, 0.08, 0.38, 0.135, trim, { rz: -0.2 });
      S.b(0.06, 0.72, 0.28, 0, 0.3, 0, leather, { rz: 0.6 });
      S.b(0.3, 0.36, 0.14, 0, 0.36, -0.2, dark); for (let k = 0; k < 3; k++) S.g(0.24, 0.03, 0.02, 0, 0.28 + k * 0.08, -0.275, coil);
      S.b(0.36, 0.16, 0.3, 0, 0.62, -0.02, coat, { top: [0.9, 0.9] });
    },
    head: (S) => {
      S.b(0.28, 0.3, 0.3, 0, 0.12, -0.01, coat, { top: [0.6, 0.7], shift: [0, -0.04] }); S.b(0.2, 0.18, 0.04, 0, 0.08, 0.13, dark);
      S.b(0.07, 0.07, 0.14, 0.04, 0.1, 0.17, trim); S.g(0.05, 0.05, 0.02, 0.04, 0.1, 0.245, glow); S.g(0.03, 0.03, 0.02, -0.06, 0.1, 0.152, glow);
    },
    arm: (S) => { S.b(0.12, 0.32, 0.13, 0, -0.15, 0, coat); S.b(0.17, 0.08, 0.17, 0, 0.0, 0, trim); },
    fore: (S, s) => {
      S.b(0.11, 0.26, 0.12, 0, -0.13, 0, coat); S.b(0.1, 0.08, 0.1, 0, -0.28, 0, leather);
      if (s > 0) {
        S.b(0.07, 1.0, 0.1, 0, -0.62, 0.04, dark); S.b(0.06, 0.24, 0.12, 0, -0.06, 0.02, leather); S.b(0.05, 0.22, 0.06, 0, -0.42, 0.13, trim);
        for (let k = 0; k < 4; k++) S.g(0.13, 0.035, 0.15, 0, -0.56 - k * 0.14, 0.04, coil);
        S.g(0.09, 0.06, 0.12, 0, -1.13, 0.04, glow);
      }
    },
  });
})();

class Lancer extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'lancer', pos, opts);
    const J = buildRig(this, 'lancer', LANCER_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'mono', 0xff2040, 0.04, 0.1, 0.27, 0.32);
    this.muzzle = { bone: J.foreR, at: new THREE.Vector3(0, -1.18, 0.04) };
    this.headY = 1.0 + 0.04 + 0.62 + 0.05 + 0.12; this.bodyY1 = 1.66; this.headR = 0.22;
    this.speed = 2.4;
    this.styleValue = 30;
    this.aim = new THREE.Vector3();
    this.gait = { stride: 0.65, knee: 0.8, arm: 0.2, bob: 0.04, lean: 0.06 };
    this.finishSetup(55);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    const cam = g.camera.position;
    if (this.state === 'aim' || this.state === 'lock') {
      this.stop(dt);
      const from = this.muzzlePos();
      if (this.state === 'aim') {
        // tracks with lag
        this.aim.lerp(V1.copy(cam).setY(cam.y - 0.3), Math.min(1, dt * 3));
        this.faceToward(this.aim.x, this.aim.z, dt, 8);
        if (!this.canSee) this.losT = (this.losT || 0) + dt; else this.losT = 0;
        if (this.losT > 0.6) { this.state = 'move'; this.attackCd = 1.2; return; }
        if (Math.random() < 0.15) g.audio.play('sniperAim', this.pos, 0.4);
        if (this.stateT <= 0) { this.state = 'lock'; this.stateT = 0.4 * this.windMul; this.eyeFlare = 1.5; g.audio.play('sniperLock', this.pos, 0.9); }
      } else if (this.stateT <= 0) {
        // fire along locked line
        const dir = V2.copy(this.aim).sub(from).normalize();
        const w = g.combat.rayWorld(from, dir, 200);
        const end = from.clone().addScaledVector(dir, w ? w.t : 200);
        g.fx.beam(from, end, 0xffffff, 0.12, 0.25);
        g.fx.beam(from, end, 0xff2040, 0.25, 0.35);
        g.audio.play('sniperFire', this.pos, 1);
        const pp = g.player.body.pos;
        const d2 = segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 0.9, pp.z);
        if (d2 < 0.6 * 0.6 || segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + 1.5, pp.z) < 0.45 * 0.45) {
          g.player.damage(32 * this.dmgMul, from, 'LANCER', 'Lancers paint you with a red laser, then it flashes white right before the shot. Move or break line of sight.');
        }
        if (w) g.fx.impact(end, new THREE.Vector3(w.nx, w.ny, w.nz), 'energy', 1.5);
        this.state = 'move'; this.recoil = 1;
        this.attackCd = (3.2 + Math.random()) * this.aggr;
        return;
      }
      // laser sight beam (thin while aiming, thick flicker on lock)
      const dir = V2.copy(this.aim).sub(from).normalize();
      const w = g.combat.rayWorld(from, dir, 200);
      const end = from.clone().addScaledVector(dir, w ? w.t : 200);
      if (this.state === 'aim') g.fx.beam(from, end, 0xff2040, 0.02 + (1 - Math.max(0, this.stateT) / 1.6) * 0.03, 0.03, false);
      else g.fx.beam(from, end, Math.random() < 0.5 ? 0xffffff : 0xff2040, 0.06, 0.03, false);
      return;
    }
    this.faceToward(p.x, p.z, dt, 5);
    if (this.attackCd <= 0 && this.canSee) {
      this.state = 'aim'; this.stateT = 1.6 * this.windMul;
      this.eyePos(this.aim).add(V1.set(Math.sin(this.yaw) * 5, -1, Math.cos(this.yaw) * 5));
      return;
    }
    if (d < 11) this.retreat(dt, this.speed * this.speedMul);
    else if (!this.canSee) this.navMove(dt, p.x, p.z, this.speed * this.speedMul);
    else this.stop(dt);
  }
  pose(T, dt) {
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 3);
    if (this.state === 'aim' || this.state === 'lock') {
      // sniper's kneel: one knee down, rifle shouldered, support hand forward
      T.drop = 0.4; T.legL.x = -1.2; T.shinL.x = 1.25; T.legR.x = 0.3; T.shinR.x = 1.7;
      const cam = this.game.camera.position;
      const pitch = Math.atan2(cam.y - (this.pos.y + 1.2), Math.max(1, this.playerDist()));
      T.torso.x = 0.1; T.armR.x = -1.5 - pitch; T.foreR.x = 0; T.armL.x = -1.35 - pitch; T.armL.z = 0.4; T.foreL.x = -0.35; T.head.x = -0.05;
      T.rate = 9;
    } else {
      T.armR.x = -0.5 - this.recoil * 0.6; T.foreR.x = -0.9; T.armL.x = -0.4; T.armL.z = 0.4; T.foreL.x = -1.2;
    }
  }
  forceAttack() { this.state = 'aim'; this.stateT = 9; this.aim.copy(this.game.camera.position); }
}

// ---------------------------------------------------------------------------------------
// BULWARK: riot heavy. Tower shield on the left arm, slam fist, mortar tube on its back.
// ---------------------------------------------------------------------------------------
const BULWARK_RIG = (() => {
  const armor = 0x7c6a4c, dark = 0x26221c, steel = 0x4a5062, hazard = 0xc8a020, glow = 0x40e0ff;
  return humanBones({
    thigh: 0.5, shin: 0.5, hipW: 0.2, torsoH: 0.86, shW: 0.52, upper: 0.38, fore: 0.36, neck: -0.06,
    pelvis: (S) => { S.b(0.66, 0.3, 0.42, 0, -0.04, 0, dark); S.b(0.7, 0.2, 0.46, 0, -0.15, 0, armor, { bot: [1.1, 1.1] }); },
    leg: (S) => { S.b(0.27, 0.5, 0.29, 0, -0.25, 0, dark); S.b(0.29, 0.3, 0.08, 0, -0.2, 0.14, armor); },
    shinB: (S) => { S.b(0.26, 0.42, 0.28, 0, -0.21, 0, armor, { bot: [1.1, 1.1] }); S.b(0.24, 0.14, 0.12, 0, -0.02, 0.15, steel); S.b(0.32, 0.14, 0.42, 0, -0.43, 0.05, dark); },
    chest: (S) => {
      S.b(0.62, 0.3, 0.44, 0, 0.16, 0, dark); S.b(0.86, 0.6, 0.52, 0, 0.52, 0, armor, { bot: [0.85, 0.9] });
      S.b(0.72, 0.36, 0.08, 0, 0.56, 0.27, steel, { top: [0.9, 1] }); for (let k = 0; k < 3; k++) S.g(0.3, 0.035, 0.02, 0, 0.5 + k * 0.07, 0.315, glow);
      S.b(0.62, 0.24, 0.3, 0, 0.84, -0.1, armor, { top: [0.7, 0.8] });
      S.b(0.24, 0.62, 0.24, 0.22, 0.86, -0.32, steel, { rx: -0.35 }); S.g(0.28, 0.06, 0.28, 0.22, 1.16, -0.43, 0xff7020, { rx: -0.35 });
      S.b(0.7, 0.08, 0.06, 0, 0.36, -0.27, hazard);
    },
    head: (S) => { S.b(0.3, 0.24, 0.3, 0, 0.1, 0.04, steel, { top: [0.8, 0.8] }); S.g(0.22, 0.04, 0.02, 0, 0.1, 0.195, glow); S.b(0.26, 0.1, 0.06, 0, 0.02, 0.17, dark); },
    arm: (S, s) => {
      S.b(0.24, 0.38, 0.26, 0, -0.17, 0, dark); S.b(0.38, 0.2, 0.38, side(s, 0.04), 0.02, 0, armor, { top: [0.75, 0.8] });
      if (s < 0) { // tower shield
        S.b(1.3, 1.65, 0.14, 0.45, -0.5, 0.48, steel); S.b(1.1, 1.4, 0.04, 0.45, -0.48, 0.56, armor);
        S.b(1.32, 0.16, 0.16, 0.45, -1.15, 0.48, hazard); S.g(0.42, 0.06, 0.02, 0.45, 0.08, 0.585, glow);
        for (let k = -1; k <= 1; k++) S.b(0.09, 0.22, 0.09, 0.45 + k * 0.42, 0.42, 0.48, dark, { top: [0, 0] });
      }
    },
    fore: (S, s) => {
      if (s < 0) return;
      S.b(0.24, 0.3, 0.26, 0, -0.15, 0, armor); S.b(0.36, 0.3, 0.36, 0, -0.42, 0, steel); S.g(0.3, 0.05, 0.02, 0, -0.45, 0.185, glow);
    },
  });
})();

class Bulwark extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'bulwark', pos, opts);
    const J = buildRig(this, 'bulwark', BULWARK_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'slit', 0x40e0ff, 0, 0.1, 0.24, 0.32);
    this.headY = 1.04 + 0.04 + 0.86 - 0.06 + 0.1; this.bodyY1 = 1.94; this.headR = 0.26;
    this.radius = 0.68;
    this.body.r = 0.55;
    this.heavy = true;
    this.speed = 1.9;
    this.styleValue = 45;
    this.gait = { stride: 0.45, knee: 0.6, arm: 0.2, bob: 0.08, lean: 0.06 };
    this.stepT = 0;
    this.finishSetup(280);
  }
  armorFactor(info) {
    if (!info.dir || info.source === 'explosion' || info.energy || info.source === 'punch' || info.source === 'parry' || info.source === 'slam') return 1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dot = info.dir.x * fx + info.dir.z * fz; // bullet travel vs facing; front hits travel opposite to facing
    if (dot < -0.45 && info.part !== 'head') {
      if (info.point) this.game.fx.sparksBurst(info.point, 0xffd080, 3, 4, 0.2, 0.07);
      return 0.12;
    }
    return 1;
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    if (this.state === 'slamWind') {
      this.stop(dt);
      if (this.stateT <= 0) {
        g.enemies.shockwave(this.pos.clone(), 7.5, 11, 20 * this.dmgMul, 0x40e0ff, 'BULWARK SLAM', 'Jump over Bulwark shockwaves. Hit them from behind or with explosives and energy beams.');
        g.audio.play('slam', this.pos, 1);
        g.addShake(0.2);
        g.fx.sparksBurst(V1.set(this.pos.x + Math.sin(this.yaw) * 0.7, this.pos.y + 0.1, this.pos.z + Math.cos(this.yaw) * 0.7), 0x40e0ff, 14, 6, 0.4);
        this.state = 'slamRec'; this.stateT = 0.4; this.attackCd = 2.8 * this.aggr;
      }
      return;
    }
    if (this.state === 'slamRec') { this.stop(dt); if (this.stateT <= 0) this.state = 'move'; return; }
    if (this.state === 'mortarWind') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 4);
      if (this.stateT <= 0) {
        const target = p.clone();
        const pv = g.player.body.vel;
        target.x += pv.x * 0.6; target.z += pv.z * 0.6;
        const room = g.level.current;
        target.y = 0;
        if (room) { target.x = clamp(target.x, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1); target.z = clamp(target.z, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1); }
        g.projectiles.spawnMortar(this.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), target, 24 * this.dmgMul, 3.2, 1.35, { cause: 'BULWARK MORTAR' });
        g.audio.play('launcher', this.pos, 0.8);
        this.state = 'move'; this.attackCd = 3.2 * this.aggr;
      }
      return;
    }
    this.faceToward(p.x, p.z, dt, 2.5);
    if (this.attackCd <= 0 && d < 5.5) { this.state = 'slamWind'; this.stateT = 0.8 * this.windMul; this.eyeFlare = 1; g.audio.play('windup', this.pos, 0.8); return; }
    if (this.attackCd <= 0 && this.canSee && d < 30) { this.state = 'mortarWind'; this.stateT = 0.6 * this.windMul; return; }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 6);
    // heavy footfalls
    this.stepT -= dt;
    if (this.stepT <= 0 && Math.hypot(this.body.vel.x, this.body.vel.z) > 0.8) { this.stepT = 0.62; g.audio.play('land', this.pos, 0.35); }
  }
  pose(T) {
    const st = this.state;
    T.armL.x = -0.18 + T.armL.x * 0.15; T.armL.z = 0.06;
    if (st === 'slamWind') {
      T.armR.x = -2.9; T.armR.z = -0.25; T.foreR.x = -0.7; T.torso.x = -0.25; T.head.x = 0.15; this.crouch(T, 0.06); T.rate = 9;
    } else if (st === 'slamRec') {
      T.armR.x = -0.5; T.foreR.x = -0.1; T.torso.x = 0.45; this.crouch(T, 0.2); T.rate = 30;
    } else if (st === 'mortarWind') {
      T.torso.x = 0.4; T.head.x = -0.3; this.crouch(T, 0.12); T.armR.x = -0.3; T.foreR.x = -0.5; T.rate = 10;
    } else { T.armR.x += -0.2; T.foreR.x = -0.5; }
  }
  forceAttack() { this.state = 'slamWind'; this.stateT = 9; }
}

// ---------------------------------------------------------------------------------------
// SIGNALLER: radio operator with a backpack set, whip antenna and a blinking beacon.
// ---------------------------------------------------------------------------------------
const SIGNALLER_RIG = (() => {
  const suit = 0x564868, dark = 0x201c26, steel = 0x46464e, teal = 0x3ef0d0;
  return humanBones({
    thigh: 0.44, shin: 0.44, hipW: 0.11, torsoH: 0.6, shW: 0.27, upper: 0.3, fore: 0.28, neck: 0.04,
    pelvis: (S) => { S.b(0.36, 0.18, 0.24, 0, -0.04, 0, dark); },
    leg: (S, s) => { S.b(0.15, 0.44, 0.17, 0, -0.22, 0, suit); S.b(0.06, 0.12, 0.13, side(s, 0.09), -0.25, 0, dark); },
    shinB: (S) => { S.b(0.13, 0.36, 0.15, 0, -0.19, 0, suit); S.b(0.15, 0.12, 0.26, 0, -0.38, 0.04, dark); },
    chest: (S) => {
      S.b(0.44, 0.58, 0.26, 0, 0.3, 0, suit, { top: [1.05, 1], bot: [0.85, 0.9] }); S.b(0.46, 0.3, 0.28, 0, 0.4, 0.01, steel, { top: [0.95, 1] });
      S.b(0.1, 0.1, 0.05, -0.12, 0.38, 0.155, dark); S.b(0.1, 0.1, 0.05, 0.12, 0.38, 0.155, dark);
      S.b(0.44, 0.56, 0.26, 0, 0.36, -0.27, steel); S.g(0.08, 0.05, 0.02, -0.1, 0.52, -0.405, teal); S.g(0.08, 0.05, 0.02, 0.1, 0.52, -0.405, 0xff3050);
      S.b(0.3, 0.12, 0.02, 0, 0.3, -0.405, dark); S.b(0.03, 1.1, 0.03, 0.16, 1.15, -0.3, dark);
      S.b(0.26, 0.26, 0.04, -0.2, 0.72, -0.3, steel, { rx: -0.6, ry: 0.4 }); S.g(0.05, 0.05, 0.03, -0.2, 0.72, -0.27, teal, { rx: -0.6, ry: 0.4 });
    },
    head: (S) => {
      S.b(0.24, 0.26, 0.25, 0, 0.12, 0, 0x6a5e58); S.b(0.26, 0.12, 0.27, 0, 0.22, 0, suit, { top: [0.85, 0.85] });
      S.g(0.08, 0.07, 0.03, -0.06, 0.15, 0.13, teal); S.g(0.08, 0.07, 0.03, 0.06, 0.15, 0.13, teal); S.b(0.22, 0.03, 0.02, 0, 0.15, 0.12, dark);
      S.b(0.05, 0.12, 0.1, -0.15, 0.12, 0, steel); S.b(0.05, 0.12, 0.1, 0.15, 0.12, 0, steel); S.b(0.02, 0.02, 0.18, 0.12, 0.05, 0.08, dark, { ry: -0.5 });
    },
    arm: (S) => { S.b(0.13, 0.3, 0.14, 0, -0.14, 0, suit); S.b(0.17, 0.1, 0.18, 0, 0.0, 0, dark); },
    fore: (S, s) => {
      S.b(0.12, 0.26, 0.13, 0, -0.13, 0, suit); S.b(0.12, 0.09, 0.12, 0, -0.29, 0, dark);
      if (s > 0) { S.b(0.06, 0.22, 0.09, 0, -0.38, 0.03, steel); S.g(0.04, 0.04, 0.04, 0, -0.5, 0.03, teal); }
      else S.b(0.07, 0.16, 0.06, 0, -0.36, 0.05, steel);
    },
  });
})();

class Signaller extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'signaller', pos, opts);
    const J = buildRig(this, 'signaller', SIGNALLER_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'pair', 0x3ef0d0, 0, 0.15, 0.18, 0.28);
    this.beacon = new THREE.Sprite(eyeMat('mono', 0xff3050));
    this.beacon.position.set(0.16, 1.74, -0.3); this.beacon.scale.setScalar(0.3);
    J.torso.add(this.beacon);
    this.muzzle = { bone: J.foreR, at: new THREE.Vector3(0, -0.52, 0.03) };
    this.headY = 0.92 + 0.04 + 0.6 + 0.04 + 0.12; this.bodyY1 = 1.55; this.headR = 0.22;
    this.speed = 3.4;
    this.progress = 0;
    this.called = false;
    this.calling = false;
    this.callDelay = 2.0 + Math.random();
    this.styleValue = 25;
    this.gait = { stride: 0.7, knee: 0.9, arm: 0.45, bob: 0.05, lean: 0.08 };
    this.finishSetup(50);
  }
  onStagger() { this.calling = false; }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.callDelay -= dt;
    if (!this.called && (this.canSee || this.callDelay <= 0)) {
      this.calling = true;
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 3);
      const rate = 1 / 7.5 / this.aggr;
      this.progress += dt * rate;
      if (Math.random() < dt * 2) g.audio.play('radio', this.pos, 0.5);
      if (this.progress >= 1) {
        this.called = true; this.calling = false; this.progress = 1;
        g.director.callBackup(this);
      }
      return;
    }
    this.calling = false;
    // after calling: keep distance and plink
    if (d < 9) this.retreat(dt, this.speed * this.speedMul);
    else this.stop(dt);
    this.faceToward(p.x, p.z, dt, 5);
    if (this.called && this.attackCd <= 0 && this.canSee) {
      this.shootAt(20, 7, { color: 0x3ef0d0, tip: 'Kill Signallers first: if their uplink reaches 100% they call backup.' });
      g.audio.play('enemyShot', this.pos, 0.5);
      this.attackCd = 2.2 * this.aggr; this.recoil = 1;
    }
  }
  pose(T, dt) {
    const t = this.game.time;
    this.beacon.visible = this.calling ? Math.sin(t * 20) > 0 : Math.sin(t * 3) > -0.2;
    this.beacon.scale.setScalar(this.calling ? 0.42 : 0.28);
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 3);
    if (this.calling) {
      // hand to the headset, handset up, nodding along to the static
      T.armL.x = -2.5; T.armL.z = 0.55; T.foreL.x = -2.1; T.head.z = 0.22; T.head.x = 0.1 + Math.sin(t * 9) * 0.05;
      T.armR.x = -0.9; T.armR.z = -0.2; T.foreR.x = -1.2; T.rate = 10;
    } else if (this.called && this.canSee) {
      T.armR.x = -1.5 - this.recoil * 0.4; T.foreR.x = 0; T.armL.x += -0.2;
    }
  }
  forceAttack() { this.callDelay = 0; this.canSee = true; }
}

// ---------------------------------------------------------------------------------------
// WISP: smoke-detector kamikaze drone with a spinning rotor and one big lens.
// ---------------------------------------------------------------------------------------
const WISP_RIG = (() => {
  const shell = 0x9a9aa6, dark = 0x26262c, glow = 0xff3050;
  return [
    ['core', null, 0, 0, 0, (S) => {
      S.b(0.5, 0.12, 0.5, 0, 0, 0, shell); S.b(0.5, 0.12, 0.5, 0, 0, 0, shell, { ry: Math.PI / 4 });
      S.b(0.54, 0.05, 0.54, 0, -0.04, 0, dark); S.b(0.54, 0.05, 0.54, 0, -0.04, 0, dark, { ry: Math.PI / 4 });
      S.b(0.26, 0.1, 0.26, 0, 0.1, 0, 0xc8c8d0, { top: [0.6, 0.6] });
      S.b(0.22, 0.22, 0.05, 0, -0.02, 0.25, dark); S.g(0.15, 0.15, 0.05, 0, -0.02, 0.27, glow);
      S.b(0.02, 0.2, 0.02, -0.12, 0.17, -0.1, dark, { rz: 0.4 }); S.b(0.02, 0.2, 0.02, 0.12, 0.17, -0.1, dark, { rz: -0.4 });
      S.g(0.2, 0.02, 0.2, 0, -0.07, 0, 0xff8040);
    }],
    ['rotor', 'core', 0, 0.16, 0, (S) => { S.b(0.72, 0.015, 0.06, 0, 0, 0, dark); S.b(0.06, 0.015, 0.72, 0, 0, 0, dark); S.b(0.06, 0.06, 0.06, 0, -0.02, 0, dark); }],
  ];
})();

class Wisp extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'wisp', pos, opts);
    this.flying = true;
    this.staggerable = true;
    const J = buildRig(this, 'wisp', WISP_RIG);
    this.rig = J.core; this.rotor = J.rotor;
    this.headMesh = J.core.userData.mesh;
    this.addEyes('core', 'mono', 0xff3050, 0, -0.02, 0.32, 0.3);
    this.radius = 0.38; this.headY = 0.0; this.headR = 0.2; this.bodyY0 = -0.35; this.bodyY1 = 0.35;
    this.body.r = 0.3; this.body.h = 0.6;
    this.speed = 6;
    this.hoverH = 2.6 + Math.random() * 1.6;
    this.orbitA = Math.random() * Math.PI * 2;
    this.styleValue = 15;
    this.bloodColor = [0.9, 0.6, 0.2];
    this.attackCd = 2.5 + Math.random() * 2;
    this.pos.y = this.hoverH;
    this.finishSetup(28);
  }
  centerPos() { return this.c.set(this.pos.x, this.pos.y, this.pos.z); }
  headPos() { return this.h.set(this.pos.x, this.pos.y, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y, this.pos.z); }
  groundY() { return 0; }
  muzzlePos() { return this.pos.clone(); }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const cam = g.camera.position;
    if (this.stun > 0) { this.stun -= dt; this.body.vel.multiplyScalar(0.9); this.body.vel.y = -1; return; }
    if (this.state === 'dive') {
      const dir = V1.set(cam.x - this.pos.x, cam.y - 0.4 - this.pos.y, cam.z - this.pos.z);
      const dist = dir.length();
      dir.normalize();
      const cur = V2.copy(this.body.vel).normalize();
      cur.lerp(dir, Math.min(1, dt * 1.4)).normalize();
      this.body.vel.copy(cur.multiplyScalar(15 * this.speedMul));
      this.yaw = Math.atan2(this.body.vel.x, this.body.vel.z);
      if (dist < 1.2) { this.explodeSelf(true); return; }
      if (this.stateT <= 0) { this.state = 'orbit'; this.attackCd = 2; }
      return;
    }
    if (this.state === 'windup') {
      this.body.vel.multiplyScalar(0.85);
      this.eyes.visible = Math.sin(g.time * 40) > 0;
      this.faceToward(p.x, p.z, dt, 10);
      if (this.stateT <= 0) {
        this.state = 'dive'; this.stateT = 2.2; this.eyes.visible = true;
        const dir = V1.set(cam.x - this.pos.x, cam.y - this.pos.y, cam.z - this.pos.z).normalize();
        this.body.vel.copy(dir.multiplyScalar(15));
        g.audio.play('droneDive', this.pos, 0.8);
      }
      return;
    }
    // orbit around the player at range, bobbing
    this.orbitA += dt * 0.6 * (this.strafeDir);
    const r = 9;
    const tx = p.x + Math.cos(this.orbitA) * r, tz = p.z + Math.sin(this.orbitA) * r;
    const ty = this.hoverH + Math.sin(g.time * 2 + this.orbitA) * 0.4;
    const dx = tx - this.pos.x, dz = tz - this.pos.z, dy = ty - this.pos.y;
    const l = Math.hypot(dx, dz) || 1;
    const sp = this.speed * this.speedMul * Math.min(1, l / 3);
    const k = 1 - Math.exp(-4 * dt);
    this.body.vel.x += (dx / l * sp - this.body.vel.x) * k;
    this.body.vel.z += (dz / l * sp - this.body.vel.z) * k;
    this.body.vel.y += (dy * 2 - this.body.vel.y) * k;
    this.faceToward(p.x, p.z, dt, 5);
    if (this.attackCd <= 0 && this.canSee) {
      this.state = 'windup'; this.stateT = 0.6 * this.windMul; this.eyeFlare = 1.5;
      g.audio.play('beep', this.pos, 0.7);
      this.attackCd = 3 * this.aggr;
    }
  }
  physics(dt) {
    const bx = this.pos.x, by = this.pos.y, bz = this.pos.z;
    moveBody(this.body, this.body.vel.x * dt, this.body.vel.y * dt, this.body.vel.z * dt, this.game.level.colliders);
    const hitSomething = this.state === 'dive' && Math.hypot(this.pos.x - bx, this.pos.y - by, this.pos.z - bz) < this.body.vel.length() * dt * 0.5;
    if (hitSomething) this.explodeSelf(false);
    this.pos.y = Math.max(0.4, this.pos.y);
    const room = this.game.level.current;
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 0.5)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 0.8, room.origin.x + room.W / 2 - 0.8);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 0.8, room.origin.z + room.D / 2 - 0.8);
    }
  }
  animate(dt) {
    const t = this.game.time;
    this.rotor.rotation.y += dt * (this.state === 'dive' ? 60 : 32);
    // bank into the direction of travel, nose down when diving
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const vf = this.body.vel.x * fx + this.body.vel.z * fz, vr = this.body.vel.x * fz - this.body.vel.z * fx;
    this.rig.rotation.x = clamp(vf * 0.05, -0.6, 0.6) + (this.state === 'windup' ? -0.3 : 0);
    this.rig.rotation.z = clamp(-vr * 0.06, -0.5, 0.5) + Math.sin(t * 5 + this.seed) * 0.12;
    this.rig.position.y = Math.sin(t * 3 + this.seed) * 0.05;
  }
  explodeSelf(contact) {
    if (!this.alive) return;
    const g = this.game;
    this.hp = 0;
    const p = this.pos.clone();
    g.combat.killEnemy(this, { source: 'self', dir: new THREE.Vector3(0, 1, 0), knock: 4, fromPlayer: false });
    void contact;
    g.fx.explosion(p, 2.4, 0xff5030);
    g.audio.play('explosion', p, 0.8);
    g.combat.radialDamage(p, 2.6, 16 * this.dmgMul, { source: 'explosion', friendly: true, cause: 'WISP', tip: 'Wisps blink red and beep before diving at you. Shoot them in the air or dash out of the way.' });
  }
  onDeath(info) {
    if (info.source === 'self') return;
    const g = this.game;
    const p = this.pos.clone();
    g.fx.explosion(p, 2.0, 0xff8030);
    g.audio.play('explosion', p, 0.6);
    g.combat.radialDamage(p, 2.4, 14, { source: 'explosion', friendly: true, cause: 'WISP EXPLOSION', tip: 'Shot-down Wisps still explode. Do not kill them right next to you.' });
  }
  forceAttack() { this.state = 'windup'; this.stateT = 9; this.eyeFlare = 1.5; }
}

// ---------------------------------------------------------------------------------------
// SWARMER: knee-high six-legged scuttler. Hunts in packs, flanks, hops at your legs.
// ---------------------------------------------------------------------------------------
const SWARMER_RIG = (() => {
  const chitin = 0x2e1c20, flesh = 0x7a4a48, bone = 0xd0c0a8, glow = 0xff6a2a;
  const legs = (S, set) => {
    // tripod gait: set A = front-left, mid-right, back-left; set B mirrors it
    for (const [sx, z] of set) S.b(0.045, 0.44, 0.045, sx * 0.25, -0.12, z, chitin, { rz: sx * 0.62, rx: z * 0.6, bot: [0.4, 0.4] });
  };
  return [
    ['body', null, 0, 0.32, 0, (S) => {
      S.b(0.36, 0.16, 0.42, 0, 0.04, -0.02, chitin, { top: [0.7, 0.8] }); S.b(0.3, 0.08, 0.36, 0, -0.07, 0, flesh);
      S.b(0.3, 0.22, 0.3, 0, 0.06, -0.33, flesh, { top: [0.7, 0.7], bot: [0.8, 0.8] }); S.g(0.31, 0.03, 0.2, 0, 0.1, -0.33, glow); S.g(0.31, 0.03, 0.18, 0, 0.03, -0.35, glow);
      S.b(0.2, 0.14, 0.18, 0, 0.02, 0.28, chitin, { top: [0.8, 0.8] });
      S.b(0.04, 0.04, 0.17, -0.06, -0.04, 0.41, bone, { ry: 0.4, top: [1, 0.3] }); S.b(0.04, 0.04, 0.17, 0.06, -0.04, 0.41, bone, { ry: -0.4, top: [1, 0.3] });
      S.g(0.035, 0.035, 0.02, -0.05, 0.06, 0.375, glow); S.g(0.035, 0.035, 0.02, 0.05, 0.06, 0.375, glow); S.g(0.035, 0.035, 0.02, 0, 0.09, 0.37, glow);
      S.b(0.04, 0.16, 0.04, -0.1, 0.16, -0.05, bone, { top: [0, 0], rx: -0.5 }); S.b(0.04, 0.16, 0.04, 0.1, 0.16, -0.05, bone, { top: [0, 0], rx: -0.5 });
    }, 'flesh'],
    ['legsA', 'body', 0, -0.02, 0, (S) => legs(S, [[-1, 0.18], [1, 0], [-1, -0.2]]), 'flesh'],
    ['legsB', 'body', 0, -0.02, 0, (S) => legs(S, [[1, 0.18], [-1, 0], [1, -0.2]]), 'flesh'],
  ];
})();

class Swarmer extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'swarmer', pos, opts);
    this.skinName = 'flesh';
    const J = buildRig(this, 'swarmer', SWARMER_RIG);
    this.headMesh = J.body.userData.mesh;
    this.addEyes('body', 'tri', 0xff6a2a, 0, 0.07, 0.4, 0.22);
    this.radius = 0.32; this.body.r = 0.26; this.body.h = 0.55;
    this.headY = 0.42; this.headR = 0.15; this.bodyY1 = 0.5;
    this.speed = 8.2;
    this.styleValue = 8;
    this.bloodColor = [0.75, 0.3, 0.08];
    this.flankA = (Math.random() - 0.5) * 2.4;
    this.attackCd = 0.6 + Math.random();
    this.finishSetup(16);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.faceToward(p.x, p.z, dt, 9);
    if (this.state === 'crouch') {
      this.stop(dt);
      if (this.stateT <= 0) {
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
        const sp = Math.min(13, 5 + l * 1.6) * this.speedMul;
        this.body.vel.set(dx / l * sp, 5.2, dz / l * sp);
        this.state = 'leap'; this.stateT = 0.9; this.hitDone = false;
        g.audio.play('lunge', this.pos, 0.35);
      }
      return;
    }
    if (this.state === 'leap') {
      if (!this.hitDone && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.0 && this.pos.y - p.y < 1.4 && p.y - this.pos.y < 1.2) {
        this.hitDone = true;
        if (g.player.damage(7 * this.dmgMul, this.pos, 'SWARMER', 'Swarmers crouch, then hop at you. Keep moving and use splash damage on the pack.')) g.audio.play('slash', this.pos, 0.6);
      }
      if ((this.body.grounded && this.stateT < 0.75) || this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.45; }
      return;
    }
    if (this.state === 'recover') { this.stop(dt); if (this.stateT <= 0) this.state = 'chase'; return; }
    if (d < 3.4 && this.canSee && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 1.5) {
      this.state = 'crouch'; this.stateT = 0.32 * this.windMul; this.eyeFlare = 1.2; this.attackCd = (1.1 + Math.random() * 0.8) * this.aggr;
      g.audio.play('beep', this.pos, 0.25);
      return;
    }
    // packs fan out around the player instead of queueing in a line
    let tx = p.x, tz = p.z;
    if (d > 4.5) {
      const a = Math.atan2(this.pos.x - p.x, this.pos.z - p.z) + this.flankA * 0.5;
      tx = p.x + Math.sin(a) * 3; tz = p.z + Math.cos(a) * 3;
    }
    this.navMove(dt, tx, tz, this.speed * this.speedMul, this.canSee && d < 7);
  }
  animate(dt) {
    const J = this.joints, t = this.game.time;
    const v = Math.hypot(this.body.vel.x, this.body.vel.z);
    const amt = Math.min(1, v / 4);
    const ph = this.walk * 1.6;
    let y = 0.32 + Math.abs(Math.sin(ph)) * 0.03 * amt, pitch = 0, tuck = 0;
    if (this.state === 'crouch') { y = 0.2; pitch = -0.25; }
    else if (this.state === 'leap') { tuck = 0.5; pitch = 0.2; }
    else if (this.stagger > 0) { y = 0.24; pitch = Math.sin(t * 13) * 0.2; }
    J.body.position.y += (y - J.body.position.y) * Math.min(1, dt * 18);
    J.body.rotation.x += (pitch - J.body.rotation.x) * Math.min(1, dt * 14);
    J.legsA.rotation.y = Math.sin(ph) * 0.35 * amt; J.legsB.rotation.y = -Math.sin(ph) * 0.35 * amt;
    J.legsA.position.y = Math.max(0, Math.sin(ph)) * 0.05 * amt; J.legsB.position.y = Math.max(0, -Math.sin(ph)) * 0.05 * amt;
    J.legsA.rotation.x = J.legsB.rotation.x = tuck;
    J.body.rotation.z = this.state === 'crouch' ? Math.sin(t * 50) * 0.05 : 0;
  }
  deathPose(k, d) { this.joints.body.rotation.z = (d.lx >= 0 ? -1 : 1) * 2.6 * k; this.joints.body.position.y = 0.32 - 0.1 * k; }
  forceAttack() { this.state = 'crouch'; this.stateT = 9; this.eyeFlare = 1.2; }
}

// ---------------------------------------------------------------------------------------
// SENTRY: tripod turret. Tracks with a red sight line, charges, then sweeps a low beam
// across the room that must be jumped (or dodged behind cover).
// ---------------------------------------------------------------------------------------
const SENTRY_RIG = (() => {
  const steel = 0x50545c, dark = 0x1e2026, hazard = 0xc8a020, glow = 0xff3040, vent = 0xffa030;
  return [
    ['base', null, 0, 0, 0, (S) => {
      S.b(0.14, 0.8, 0.14, 0, 0.5, 0, steel); S.b(0.3, 0.1, 0.3, 0, 0.88, 0, dark); S.b(0.17, 0.08, 0.17, 0, 0.3, 0, hazard);
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 + Math.PI / 3;
        S.b(0.08, 0.72, 0.08, Math.sin(a) * 0.28, 0.32, Math.cos(a) * 0.28, dark, { rx: -0.6, ry: a, order: 'YXZ' });
        S.b(0.15, 0.05, 0.15, Math.sin(a) * 0.5, 0.025, Math.cos(a) * 0.5, dark);
      }
    }],
    ['turret', 'base', 0, 0.95, 0, (S) => {
      S.b(0.56, 0.38, 0.5, 0, 0.05, -0.02, steel, { top: [0.8, 0.85] }); S.b(0.6, 0.42, 0.08, 0, 0.04, 0.26, dark, { top: [0.85, 1] });
      S.b(0.26, 0.26, 0.06, 0, 0.04, 0.31, steel); S.g(0.17, 0.17, 0.04, 0, 0.04, 0.345, glow);
      S.b(0.07, 0.07, 0.38, -0.25, -0.09, 0.3, dark); S.b(0.07, 0.07, 0.38, 0.25, -0.09, 0.3, dark);
      S.g(0.05, 0.05, 0.03, -0.25, -0.09, 0.49, glow); S.g(0.05, 0.05, 0.03, 0.25, -0.09, 0.49, glow);
      S.g(0.36, 0.16, 0.04, 0, 0.06, -0.29, vent); for (let k = 0; k < 3; k++) S.b(0.38, 0.025, 0.05, 0, 0.0 + k * 0.06, -0.3, dark);
      S.b(0.02, 0.3, 0.02, 0.18, 0.36, -0.12, dark); S.b(0.4, 0.02, 0.06, 0, 0.245, 0.1, hazard);
    }],
  ];
})();

class Sentry extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'sentry', pos, opts);
    const J = buildRig(this, 'sentry', SENTRY_RIG);
    this.headMesh = J.turret.userData.mesh;
    this.addEyes('turret', 'mono', 0xff3040, 0, 0.04, 0.4, 0.38);
    this.radius = 0.5; this.body.r = 0.42; this.body.h = 1.3;
    this.headY = 0.99; this.headR = 0.24; this.bodyY1 = 1.25;
    this.heavy = true; this.anchored = true;
    this.speed = 0;
    this.styleValue = 35;
    this.pitch = 0; this.scanA = Math.random() * TAU;
    this.attackCd = 1.2 + Math.random();
    this.state = 'scan';
    this.from = new THREE.Vector3(); this.end = new THREE.Vector3();
    this.finishSetup(130);
  }
  armorFactor(info) {
    if (!info.dir || info.source === 'explosion' || info.energy || info.source === 'punch' || info.source === 'parry' || info.part === 'head') return 1;
    const dot = info.dir.x * Math.sin(this.yaw) + info.dir.z * Math.cos(this.yaw);
    if (dot < -0.3) { if (info.point) this.game.fx.sparksBurst(info.point, 0xffd080, 2, 3, 0.15, 0.06); return 0.5; }
    return dot > 0.4 ? 1.5 : 1; // shots into the back vents
  }
  lens(out) {
    const cp = Math.cos(this.pitch);
    return out.set(this.pos.x + Math.sin(this.yaw) * 0.37 * cp, this.pos.y + 0.99 + Math.sin(this.pitch) * 0.37, this.pos.z + Math.cos(this.yaw) * 0.37 * cp);
  }
  beamEnd(from, out) {
    const cp = Math.cos(this.pitch);
    const dir = V3.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const w = this.game.combat.rayWorld(from, dir, 60);
    return { end: out.copy(from).addScaledVector(dir, w ? w.t : 60), w };
  }
  aimPitch() {
    // aim low (knee height): jumping clears the beam
    const p = this.game.player.body.pos;
    return Math.atan2(p.y + 0.55 - (this.pos.y + 0.99), Math.max(1, this.playerDist()));
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const st = this.state;
    if (st === 'track') {
      const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
      this.yaw += clamp(angleDiff(this.yaw, want), -1.8 * dt, 1.8 * dt);
      this.pitch += (this.aimPitch() - this.pitch) * Math.min(1, dt * 4);
      const from = this.lens(this.from);
      g.fx.beam(from, this.beamEnd(from, this.end).end, 0xff3040, 0.025, 0.03, false);
      if (!this.canSee) this.losT = (this.losT || 0) + dt; else this.losT = 0;
      if (this.losT > 0.9) { this.state = 'scan'; this.attackCd = 1; return; }
      if (this.stateT <= 0) { this.state = 'charge'; this.stateT = 0.6 * this.windMul; this.eyeFlare = 2; g.audio.play('lanceCharge', this.pos, 0.8); }
      return;
    }
    if (st === 'charge') {
      const from = this.lens(this.from);
      g.fx.beam(from, this.beamEnd(from, this.end).end, Math.random() < 0.5 ? 0xffffff : 0xff3040, 0.07, 0.03, false);
      if (Math.random() < 0.4) g.fx.sparks.spawn(from.x, from.y, from.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 1, 0.3, 0.2, 1, 0.1, 0.25, 0, 0);
      if (this.stateT <= 0) {
        // sweep through the player's position, starting from whichever side the head leads
        const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
        const sgn = this.strafeDir;
        this.sweepFrom = want - 0.8 * sgn; this.sweepTo = want + 0.8 * sgn;
        this.yaw = this.sweepFrom;
        this.state = 'sweep'; this.stateT = this.sweepDur = 1.5; this.tickT = 0;
        g.audio.play('laser', this.pos, 1);
      }
      return;
    }
    if (st === 'sweep') {
      const k = 1 - Math.max(0, this.stateT) / this.sweepDur;
      this.yaw = this.sweepFrom + (this.sweepTo - this.sweepFrom) * (k * k * (3 - 2 * k));
      const from = this.lens(this.from);
      const { end, w } = this.beamEnd(from, this.end);
      g.fx.beam(from, end, 0xff3040, 0.22, 0.04, false);
      g.fx.beam(from, end, 0xffffff, 0.07, 0.04, false);
      if (w && Math.random() < 0.6) g.fx.sparks.spawn(end.x, end.y, end.z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, 1, 0.4, 0.2, 1, 0.12, 0.3, 10, 0);
      this.tickT -= dt;
      if (this.tickT <= 0) {
        const pp = g.player.body.pos, ph = g.player.body.h;
        for (const hgt of [0.3, 0.7, 1.1, 1.5]) {
          if (hgt > ph) break;
          if (segPointDist2(from.x, from.y, from.z, end.x, end.y, end.z, pp.x, pp.y + hgt, pp.z) < 0.32 * 0.32) {
            if (g.player.damage(13 * this.dmgMul, from, 'SENTRY BEAM', 'Sentries sweep a low beam after the red sight line. Jump over it, or stay behind cover.')) this.tickT = 0.3;
            break;
          }
        }
      }
      if (this.stateT <= 0) { this.state = 'cool'; this.stateT = 1.6; this.strafeDir *= -1; this.attackCd = (2.6 + Math.random()) * this.aggr; }
      return;
    }
    if (st === 'cool') {
      if (Math.random() < 0.3) { const b = V1.set(this.pos.x - Math.sin(this.yaw) * 0.32, this.pos.y + 1.05, this.pos.z - Math.cos(this.yaw) * 0.32); g.fx.dust.spawn(b.x, b.y, b.z, (Math.random() - 0.5) * 0.6, 1 + Math.random(), (Math.random() - 0.5) * 0.6, 0.5, 0.5, 0.55, 0.5, 0.25, 0.8, -0.5, 1); }
      if (this.stateT <= 0) this.state = 'scan';
      return;
    }
    // scan: slow sweep of the turret until the player is in sight
    this.scanA += dt * 0.7;
    if (this.canSee) this.faceToward(p.x, p.z, dt, 2.5);
    else this.yaw += Math.sin(this.scanA) * dt * 0.6;
    this.pitch *= 1 - Math.min(1, dt * 3);
    if (this.canSee && this.attackCd <= 0 && this.playerDist() < 40) { this.state = 'track'; this.stateT = 1.1 * this.windMul; g.audio.play('sniperAim', this.pos, 0.6); }
  }
  physics(dt) { this.body.vel.x = 0; this.body.vel.z = 0; super.physics(dt); }
  animate(dt) {
    const J = this.joints;
    J.turret.rotation.x = -this.pitch + (this.stagger > 0 ? Math.sin(this.game.time * 20) * 0.08 : 0);
    J.turret.rotation.z = this.state === 'charge' ? Math.sin(this.game.time * 60) * 0.03 : 0;
    void dt;
  }
  deathPose(k) { this.joints.turret.rotation.x = 0.9 * k; this.joints.turret.position.y = 0.95 - 0.25 * k; }
  forceAttack() { this.state = 'charge'; this.stateT = 9; this.pitch = 0; }
}

// ---------------------------------------------------------------------------------------
// STALKER: gaunt cloaked hunter. Circles behind you while shimmering, decloaks with a green
// flash before a lunging claw strike, then hangs exposed for a moment.
// ---------------------------------------------------------------------------------------
const STALKER_RIG = (() => {
  const bone = 0xb0a898, dark = 0x201a20, sinew = 0x5a3a40, glow = 0x9dff3a;
  return humanBones({
    thigh: 0.5, shin: 0.52, hipW: 0.1, torsoH: 0.55, shW: 0.24, upper: 0.4, fore: 0.4, neck: 0.06, headZ: 0.08,
    pelvis: (S) => { S.b(0.26, 0.14, 0.18, 0, -0.03, 0, dark); },
    leg: (S) => { S.b(0.09, 0.5, 0.1, 0, -0.25, 0, sinew, { bot: [0.7, 0.7] }); },
    shinB: (S) => { S.b(0.07, 0.46, 0.08, 0, -0.23, 0, bone); S.b(0.1, 0.06, 0.2, 0, -0.49, 0.05, dark, { top: [0.8, 0.6] }); },
    chest: (S) => {
      S.b(0.2, 0.26, 0.16, 0, 0.12, 0, sinew); S.b(0.32, 0.3, 0.22, 0, 0.38, 0, bone, { top: [1.1, 1], bot: [0.7, 0.8] });
      for (let k = 0; k < 3; k++) S.b(0.34, 0.03, 0.2, 0, 0.32 - k * 0.07, 0.035, dark);
      for (let k = 0; k < 4; k++) S.b(0.03, 0.12, 0.03, 0, 0.18 + k * 0.1, -0.12, bone, { rx: -0.8, top: [0, 0] });
      S.g(0.06, 0.06, 0.02, 0, 0.42, 0.115, glow);
    },
    head: (S) => {
      S.b(0.18, 0.18, 0.34, 0, 0.06, 0.06, bone, { top: [0.7, 0.6] }); S.b(0.12, 0.06, 0.2, 0, -0.05, 0.1, dark);
      S.g(0.035, 0.03, 0.02, -0.05, 0.08, 0.235, glow); S.g(0.035, 0.03, 0.02, 0.05, 0.08, 0.235, glow); S.g(0.03, 0.03, 0.02, 0, 0.13, 0.22, glow);
    },
    arm: (S) => { S.b(0.07, 0.4, 0.08, 0, -0.2, 0, sinew); S.b(0.12, 0.08, 0.12, 0, 0, 0, bone); },
    fore: (S) => {
      S.b(0.06, 0.38, 0.07, 0, -0.19, 0, bone);
      for (let k = 0; k < 3; k++) { S.b(0.02, 0.36, 0.05, (k - 1) * 0.04, -0.54, 0.04, 0xd8d0c0, { bot: [0.3, 0.3], rx: 0.2 }); S.g(0.022, 0.08, 0.03, (k - 1) * 0.04, -0.7, 0.075, glow, { rx: 0.2 }); }
    },
  });
})();

class Stalker extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'stalker', pos, opts);
    this.skinName = 'flesh';
    const J = buildRig(this, 'stalker', STALKER_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'tri', 0x9dff3a, 0, 0.1, 0.27, 0.26);
    this.headY = 1.06 + 0.04 + 0.55 + 0.06 + 0.06 - 0.2; this.bodyY1 = 1.5; this.headR = 0.2;
    this.speed = 6.6;
    this.radius = 0.38;
    this.styleValue = 32;
    this.bloodColor = [0.35, 0.6, 0.12];
    this.gait = { stride: 0.8, knee: 1.1, arm: 0.2, bob: 0.04, lean: 0.4 };
    this.state = 'stalk';
    this.cloakK = 1; this.stepT = 0;
    this.finishSetup(75);
    this.applySkin(true);
  }
  get hidden() { return this.state === 'stalk' || (this.state === 'retreat' && this.stateT < 0.6); }
  armorFactor() { return this.state === 'recover' ? 1.6 : 1; }
  onHit(info, amount) {
    super.onHit(info, amount);
    // getting shot rips the camouflage: it reels and stays visible for a while
    if (this.hp > 0 && this.hidden) {
      this.state = 'reveal'; this.stateT = 2.0; this.stagger = Math.max(this.stagger, 0.45);
      this.game.audio.play('glitch', this.pos, 0.8);
      this.game.fx.sparksBurst(this.centerPos().clone(), 0x9dff3a, 12, 5, 0.4);
    }
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    const st = this.state;
    if (st === 'decloak') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 10);
      if (this.stateT <= 0) {
        const pv = g.player.body.vel;
        const dx = p.x + pv.x * 0.15 - this.pos.x, dz = p.z + pv.z * 0.15 - this.pos.z, l = Math.hypot(dx, dz) || 1;
        this.lungeX = dx / l; this.lungeZ = dz / l;
        this.state = 'strike'; this.stateT = 0.3; this.hitDone = false;
        g.audio.play('lunge', this.pos, 0.9);
      }
      return;
    }
    if (st === 'strike') {
      const sp = 15 * this.speedMul;
      this.body.vel.x = this.lungeX * sp; this.body.vel.z = this.lungeZ * sp;
      if (!this.hitDone && d < 1.6 && Math.abs(p.y - this.pos.y) < 1.8) {
        this.hitDone = true;
        if (g.player.damage(17 * this.dmgMul, this.pos, 'STALKER', 'Stalkers flash green right before they strike. Dash away the moment you see the flash, then punish the recovery.')) {
          g.player.knock(this.lungeX * 7, 3, this.lungeZ * 7);
          g.audio.play('slash', this.pos, 1);
        }
      }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.95; }
      return;
    }
    if (st === 'recover' || st === 'reveal') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 4);
      if (this.stateT <= 0) { this.state = 'retreat'; this.stateT = 1.4; }
      return;
    }
    if (st === 'retreat') {
      this.retreat(dt, this.speed * this.speedMul * 0.8);
      if (this.stateT <= 0) { this.state = 'stalk'; this.attackCd = (1.2 + Math.random()) * this.aggr; g.audio.play('sizzle', this.pos, 0.5); }
      return;
    }
    // stalk: circle in behind the player, hissing softly
    const fwd = g.player.fwd;
    let tx = p.x - fwd.x * 3.5, tz = p.z - fwd.z * 3.5;
    if (d < 6) { tx = p.x; tz = p.z; }
    this.faceToward(p.x, p.z, dt, 6);
    this.navMove(dt, tx, tz, this.speed * this.speedMul);
    this.stepT -= dt;
    if (this.stepT <= 0 && d < 16) {
      this.stepT = 0.5 + Math.random() * 0.3;
      g.audio.play('sizzle', this.pos, 0.25);
      g.fx.dust.spawn(this.pos.x, this.pos.y + 0.05, this.pos.z, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 0.45, 0.6, 0.4, 0.4, 0.3, 0.6, -0.3, 1.5);
    }
    if (d < 4.4 && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 2) {
      this.state = 'decloak'; this.stateT = 0.55 * this.windMul; this.eyeFlare = 2;
      g.audio.play('sniperLock', this.pos, 0.7);
      g.fx.spawnColumn(this.pos.x, this.pos.y, this.pos.z, 0x9dff3a, 0.4, 2.4);
    }
  }
  pose(T) {
    const st = this.state, t = this.game.time;
    // camouflage blend + eye flicker
    const want = this.hidden ? 1 : 0;
    this.cloakK += (want - this.cloakK) * 0.25;
    if ((this.cloakK > 0.5) !== !!this.cloaked) this.applySkin(this.cloakK > 0.5);
    this.eyes.visible = !this.cloaked || Math.sin(t * 3.1 + this.seed) > 0.93;
    T.torso.x += 0.35; T.head.x -= 0.3; this.crouch(T, 0.1);
    if (st === 'decloak') {
      this.crouch(T, 0.18); T.torso.x = 0.7; T.head.x = -0.6;
      T.armL.x = -0.3; T.armL.z = -1.3; T.foreL.x = -1.2; T.armR.x = -0.3; T.armR.z = 1.3; T.foreR.x = -1.2; T.rate = 18;
    } else if (st === 'strike') {
      T.torso.x = 0.6; T.armL.x = -1.7; T.armL.z = 0.4; T.foreL.x = -0.2; T.armR.x = -1.5; T.armR.z = -0.5; T.foreR.x = -0.1; T.legL.x = -0.9; T.legR.x = 0.6; T.rate = 26;
    } else if (st === 'recover' || st === 'reveal') {
      T.torso.x = 0.55; T.armL.x = 0.2; T.armR.x = 0.2; T.foreL.x = -0.2; T.foreR.x = -0.2; T.head.z = Math.sin(t * 6) * 0.3; T.rate = 8;
    } else {
      T.armL.x += -0.35; T.armL.z = -0.25; T.foreL.x = -0.7; T.armR.x += -0.35; T.armR.z = 0.25; T.foreR.x = -0.7;
    }
  }
  forceAttack() { this.state = 'decloak'; this.stateT = 9; this.eyeFlare = 2; }
}

// ---------------------------------------------------------------------------------------
// CANTOR: floating choir priest. Tethers a golden ward to an ally (shield + heal), sings a
// healing hymn, and lobs slow homing hymn-orbs when it is alone.
// ---------------------------------------------------------------------------------------
const CANTOR_RIG = (() => {
  const robe = 0x6a1822, robeD = 0x3a0c14, gold = 0xc8a040, dark = 0x1a1014, skin = 0xb8a890, glow = 0xffd060;
  return humanBones({
    noLegs: true, thigh: 0.6, shin: 0.6, hipW: 0, torsoH: 0.5, shW: 0.25, upper: 0.32, fore: 0.3, neck: 0.04,
    pelvis: (S) => {
      S.b(0.5, 1.0, 0.42, 0, -0.5, 0, robe, { top: [0.65, 0.7], bot: [1.15, 1.1] }); S.b(0.58, 0.06, 0.47, 0, -0.97, 0, gold);
      S.b(0.12, 0.8, 0.03, 0, -0.45, 0.19, gold, { rx: -0.07 }); S.g(0.07, 0.07, 0.02, 0, -0.32, 0.2, glow, { rz: Math.PI / 4 });
    },
    chest: (S) => {
      S.b(0.38, 0.5, 0.24, 0, 0.25, 0, robe, { top: [1.1, 1] }); S.b(0.1, 0.5, 0.03, -0.1, 0.28, 0.13, gold); S.b(0.1, 0.5, 0.03, 0.1, 0.28, 0.13, gold);
      S.b(0.44, 0.12, 0.3, 0, 0.5, 0, robeD);
      // standing halo behind the head
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; S.g(0.17, 0.035, 0.03, Math.cos(a) * 0.27, 0.82 + Math.sin(a) * 0.27, -0.2, glow, { rz: a + Math.PI / 2 }); }
    },
    head: (S) => {
      S.b(0.3, 0.34, 0.32, 0, 0.13, -0.02, robeD, { top: [0.5, 0.6] }); S.b(0.18, 0.22, 0.04, 0, 0.1, 0.14, skin);
      S.g(0.12, 0.025, 0.02, 0, 0.14, 0.165, glow); S.b(0.06, 0.02, 0.02, 0, 0.05, 0.165, dark);
    },
    arm: (S) => { S.b(0.14, 0.32, 0.15, 0, -0.15, 0, robe, { bot: [1.2, 1.2] }); },
    fore: (S, s) => {
      S.b(0.16, 0.3, 0.16, 0, -0.14, 0, robe, { bot: [1.3, 1.3] }); S.b(0.07, 0.08, 0.07, 0, -0.32, 0, skin);
      if (s < 0) { S.b(0.015, 0.3, 0.015, 0, -0.5, 0, gold); S.b(0.12, 0.12, 0.12, 0, -0.7, 0, gold, { top: [0.6, 0.6], bot: [0.7, 0.7] }); S.g(0.08, 0.04, 0.08, 0, -0.66, 0, glow); }
      else { S.b(0.04, 1.6, 0.04, 0, -0.35, 0.05, gold); S.g(0.13, 0.13, 0.04, 0, 0.5, 0.05, glow, { rz: Math.PI / 4 }); }
    },
  });
})();

let tetherMat = null, wardMat = null;
class Cantor extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'cantor', pos, opts);
    this.skinName = 'flesh';
    const J = buildRig(this, 'cantor', CANTOR_RIG);
    this.initPose();
    this.hipY += 0.22; // it floats
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'slit', 0xffd060, 0, 0.14, 0.2, 0.3);
    this.muzzle = { bone: J.foreR, at: new THREE.Vector3(0, 0.5, 0.05) };
    this.headY = 1.26 + 0.04 + 0.5 + 0.04 + 0.13; this.bodyY0 = 0.25; this.bodyY1 = 1.82; this.headR = 0.22;
    this.speed = 3.0;
    this.radius = 0.42;
    this.styleValue = 35;
    this.bloodColor = [0.9, 0.7, 0.3];
    this.gait = { stride: 0, knee: 0, arm: 0.1, bob: 0, lean: 0.12 };
    this.ally = null; this.pickT = 0; this.losT = 0; this.hymnCd = 5 + Math.random() * 2; this.state = 'drift';
    if (!tetherMat) {
      tetherMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      wardMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    }
    this.tether = new THREE.Mesh(stretchGeo(), tetherMat);
    this.tether.visible = false; this.tether.frustumCulled = false;
    this.halo = new THREE.Mesh(haloGeometry(), wardMat);
    this.halo.visible = false;
    game.scene.add(this.tether, this.halo);
    this.finishSetup(65);
  }
  extraCleanup() { this.game.scene.remove(this.tether, this.halo); if (this.ally) this.ally.wardT = Math.min(this.ally.wardT, 0.01); this.ally = null; }
  onStagger() { this.dropTether(); }
  dropTether() { this.ally = null; this.tether.visible = false; this.halo.visible = false; }
  pickAlly() {
    const g = this.game;
    let best = null, bs = -1;
    for (const o of g.enemies.list) {
      if (!o.alive || !o.targetable || o === this || o.type === 'cantor' || o.mini || o.warden || o.latched) continue;
      if (o.wardBy && o.wardBy !== this && o.wardBy.alive) continue;
      const d = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
      if (d > 20) continue;
      const s = o.maxHp / (1 + d * 0.05);
      if (s > bs && g.combat.losClear(this.centerPos(), V1.copy(o.centerPos()))) { bs = s; best = o; }
    }
    if (this.ally && this.ally !== best && this.ally.wardBy === this) this.ally.wardBy = null;
    this.ally = best;
    if (best) best.wardBy = this;
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.pickT -= dt; this.hymnCd -= dt;
    if (this.ally && !this.ally.alive) this.dropTether();
    if (this.pickT <= 0) { this.pickT = 0.6; if (!this.ally) this.pickAlly(); else if (!g.combat.losClear(this.centerPos(), V1.copy(this.ally.centerPos()))) { this.losT += 0.6; if (this.losT > 1.2) { this.dropTether(); this.losT = 0; } } else this.losT = 0; }
    if (this.state === 'hymn') {
      this.stop(dt);
      if (this.stateT <= 0) {
        // heal everyone nearby and pulse a golden ring
        g.fx.ring(this.pos.x, this.pos.y + 0.2, this.pos.z, 9, 0xffd060, 0.6, 0.1);
        g.audio.play('upgrade', this.pos, 0.6);
        for (const o of g.enemies.list) if (o.alive && o !== this && !o.mini && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 9) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.2); g.fx.sparksBurst(o.centerPos().clone(), 0xffd060, 6, 3, 0.4); }
        this.state = 'drift'; this.hymnCd = (7 + Math.random() * 2) * this.aggr;
      }
      return;
    }
    if (this.state === 'cast') {
      this.stop(dt);
      this.faceToward(p.x, p.z, dt, 6);
      if (this.stateT <= 0) {
        for (let k = -1; k <= 1; k++) this.shootAt(11, 10, { color: 0xffd060, homing: 0.9, yawOff: k * 0.25, lead: 0, life: 5, cause: 'CANTOR HYMN', tip: 'Cantor orbs are slow and homing: parry them back or outrun them.' });
        g.audio.play('enemyShot', this.pos, 0.6);
        this.state = 'drift'; this.attackCd = (2.6 + Math.random()) * this.aggr;
      }
      return;
    }
    // drift behind its ally, away from the player
    if (this.ally) {
      const a = this.ally;
      const ax = a.pos.x - p.x, az = a.pos.z - p.z, al = Math.hypot(ax, az) || 1;
      this.navMove(dt, a.pos.x + ax / al * 4.5, a.pos.z + az / al * 4.5, this.speed * this.speedMul);
      this.faceToward(a.pos.x, a.pos.z, dt, 5);
      a.ward(0.6);
      if (a.wardShield || a.shieldMax > 0) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.035 * dt);
    } else {
      if (d < 11) this.retreat(dt, this.speed * this.speedMul); else this.stop(dt);
      this.faceToward(p.x, p.z, dt, 4);
      if (this.attackCd <= 0 && this.canSee) { this.state = 'cast'; this.stateT = 0.6 * this.windMul; this.eyeFlare = 1.2; return; }
    }
    if (this.hymnCd <= 0) {
      let n = 0;
      for (const o of g.enemies.list) if (o.alive && o !== this && !o.mini && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 9 && o.hp < o.maxHp * 0.95) n++;
      if (n) { this.state = 'hymn'; this.stateT = 1.0 * this.windMul; this.eyeFlare = 1.5; g.fx.telegraphDisc(this.pos.x, this.pos.y, this.pos.z, 9, 0xffd060, 1.0); g.audio.play('windup', this.pos, 0.5); }
      else this.hymnCd = 2;
    }
  }
  pose(T) {
    const t = this.game.time;
    T.drop = -Math.sin(t * 2 + this.seed) * 0.07;
    T.torso.z = Math.sin(t * 1.3 + this.seed) * 0.05;
    if (this.state === 'hymn') { T.armL.x = -2.6; T.armL.z = -0.4; T.armR.x = -2.6; T.armR.z = 0.4; T.foreL.x = -0.3; T.foreR.x = -0.3; T.head.x = -0.4; T.torso.x = -0.15; T.rate = 8; }
    else if (this.state === 'cast') { T.armR.x = -1.9; T.foreR.x = -0.3; T.armL.x = -1.4; T.armL.z = -0.5; T.rate = 12; }
    else { T.armR.x = this.ally ? -1.2 : -0.5; T.foreR.x = -0.5; T.armL.x = -0.4; T.foreL.x = -0.7; }
    this.drawTether(t);
  }
  drawTether(t) {
    const a = this.ally;
    if (!a || !a.alive || this.stagger > 0) { this.tether.visible = this.halo.visible = false; return; }
    const from = this.muzzlePos(), to = a.centerPos();
    const len = from.distanceTo(to);
    const w = 0.06 + Math.sin(t * 18) * 0.025;
    this.tether.position.copy(from);
    this.tether.lookAt(to);
    this.tether.scale.set(w, w, len);
    this.tether.visible = true;
    this.halo.position.set(a.pos.x, a.pos.y + a.headY + 0.45, a.pos.z);
    this.halo.scale.setScalar(0.35 + Math.sin(t * 6) * 0.04);
    this.halo.rotation.y = t * 2;
    this.halo.visible = true;
  }
  forceAttack() { this.state = 'hymn'; this.stateT = 9; this.eyeFlare = 1.5; }
}

// ---------------------------------------------------------------------------------------
// MIRROR KNIGHT: armored knight with a mirror shield. Front hits from bullets come back at you
// (parryable). Punches break its guard; raising the mirror to the light exposes it.
// ---------------------------------------------------------------------------------------
const MIRROR_RIG = (() => {
  const steel = 0x868ea0, dark = 0x1c1e26, trim = 0x545868, gold = 0xb89a50, plume = 0xb01c28, mirror = 0xc8f0ff, eye = 0x80f0ff;
  return humanBones({
    thigh: 0.52, shin: 0.52, hipW: 0.14, torsoH: 0.78, shW: 0.38, upper: 0.36, fore: 0.36, neck: 0.04,
    pelvis: (S) => {
      S.b(0.46, 0.22, 0.3, 0, -0.03, 0, dark); S.b(0.18, 0.3, 0.05, -0.12, -0.22, 0.17, steel, { rx: 0.12 }); S.b(0.18, 0.3, 0.05, 0.12, -0.22, 0.17, steel, { rx: 0.12 });
      S.b(0.42, 0.3, 0.05, 0, -0.22, -0.17, steel, { rx: -0.12 });
    },
    leg: (S) => { S.b(0.18, 0.52, 0.2, 0, -0.26, 0, dark); S.b(0.2, 0.32, 0.08, 0, -0.2, 0.1, steel); },
    shinB: (S) => { S.b(0.18, 0.44, 0.2, 0, -0.22, 0, steel, { bot: [0.85, 0.85] }); S.b(0.2, 0.14, 0.12, 0, -0.01, 0.1, trim, { top: [0.6, 1] }); S.b(0.18, 0.1, 0.3, 0, -0.47, 0.05, steel, { top: [0.8, 0.7] }); },
    chest: (S) => {
      S.b(0.44, 0.24, 0.3, 0, 0.16, 0, steel); S.b(0.58, 0.48, 0.36, 0, 0.5, 0, steel, { bot: [0.8, 0.85] });
      S.b(0.06, 0.42, 0.06, 0, 0.52, 0.19, gold); S.b(0.36, 0.12, 0.3, 0, 0.78, 0, trim);
      S.b(0.6, 1.1, 0.04, 0, 0.2, -0.21, plume, { bot: [1.25, 1] }); S.g(0.08, 0.08, 0.02, 0, 0.6, 0.2, eye, { rz: Math.PI / 4 });
    },
    head: (S) => {
      S.b(0.3, 0.36, 0.32, 0, 0.16, 0, steel, { top: [0.9, 0.9] }); S.g(0.04, 0.2, 0.02, 0, 0.15, 0.165, eye); S.g(0.22, 0.04, 0.02, 0, 0.2, 0.165, eye);
      S.b(0.06, 0.24, 0.42, 0, 0.42, -0.06, plume, { top: [1, 0.5], rx: -0.2 }); S.b(0.04, 0.06, 0.34, 0, 0.35, 0, gold);
    },
    arm: (S, s) => {
      S.b(0.16, 0.36, 0.18, 0, -0.16, 0, dark); S.b(0.3, 0.16, 0.3, side(s, 0.03), 0.03, 0, steel, { top: [0.6, 0.8] }); S.b(0.31, 0.03, 0.31, side(s, 0.03), -0.04, 0, gold);
      if (s < 0) { // the mirror
        S.b(0.84, 1.24, 0.08, 0.3, -0.55, 0.36, trim, { bot: [0.45, 1] }); S.g(0.7, 1.04, 0.04, 0.3, -0.52, 0.41, mirror, { bot: [0.4, 1] });
        // sheen bands so the face reads as polished glass rather than a white slab
        S.g(0.14, 0.6, 0.01, 0.24, -0.32, 0.432, 0x78b8d8, { rz: 0.5 }); S.g(0.06, 0.45, 0.01, 0.42, -0.36, 0.432, 0x9ad0e8, { rz: 0.5 });
        S.b(0.86, 0.06, 0.1, 0.3, 0.07, 0.36, gold); S.b(0.12, 0.12, 0.06, 0.3, -0.42, 0.44, gold);
      }
    },
    fore: (S, s) => {
      S.b(0.15, 0.32, 0.17, 0, -0.16, 0, steel); S.b(0.15, 0.1, 0.15, 0, -0.36, 0, trim);
      if (s > 0) {
        S.b(0.3, 0.05, 0.05, 0, -0.38, 0.1, gold); S.b(0.04, 0.16, 0.04, 0, -0.38, 0.0, dark, { rx: Math.PI / 2 });
        S.b(0.04, 1.0, 0.12, 0, -0.38, 0.62, 0xd8e0f0, { rx: Math.PI / 2, top: [1, 0.15] }); S.g(0.045, 0.8, 0.02, 0, -0.38, 0.58, eye, { rx: Math.PI / 2, top: [1, 0.2] });
      }
    },
  });
})();

class MirrorKnight extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'mirror', pos, opts);
    const J = buildRig(this, 'mirror', MIRROR_RIG);
    this.initPose();
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'slit', 0x80f0ff, 0, 0.19, 0.2, 0.3);
    this.glint = new THREE.Sprite(eyeMat('mono', 0xe8ffff));
    this.glint.position.set(0.3, -0.5, 0.5); this.glint.scale.setScalar(0.3);
    J.armL.add(this.glint);
    this.headY = 1.08 + 0.04 + 0.78 + 0.04 + 0.16; this.bodyY1 = 1.9; this.headR = 0.24;
    this.radius = 0.55; this.body.r = 0.45;
    this.heavy = true;
    this.speed = 2.9;
    this.styleValue = 50;
    this.bloodColor = [0.4, 0.4, 0.45];
    this.gait = { stride: 0.55, knee: 0.7, arm: 0.2, bob: 0.06, lean: 0.06 };
    this.reflectT = 0; this.reflectAcc = 0; this.flareCd = 3 + Math.random() * 2;
    this.state = 'advance';
    this.finishSetup(170);
  }
  get guarding() { return this.state === 'advance' || this.state === 'bashWind' || this.state === 'bashRec'; }
  armorFactor(info) {
    if (!info.dir || !this.guarding) return this.state === 'guardBroken' ? 1.3 : 1;
    if ((info.source !== 'hitscan' && info.source !== 'projectile') || info.energy || info.ricoshot) return 1;
    const dot = info.dir.x * Math.sin(this.yaw) + info.dir.z * Math.cos(this.yaw);
    if (dot > -0.35) return 1;
    // the mirror sends bullets back (batched so a shotgun blast returns as one orb)
    const g = this.game;
    this.reflectAcc += info.dmg || 12;
    if (info.point) g.fx.sparksBurst(info.point, 0xc8f0ff, 4, 5, 0.2, 0.07);
    this.glintT = 0.15;
    if (this.reflectT <= 0) {
      this.reflectT = 0.12;
      const dmg = clamp(this.reflectAcc * 0.3, 5, 16) / this.dmgMul;
      this.reflectAcc = 0;
      const from = info.point ? info.point.clone() : this.centerPos().clone();
      from.x += Math.sin(this.yaw) * 0.3; from.z += Math.cos(this.yaw) * 0.3;
      this.shootAt(32, dmg, { from, color: 0xc8f0ff, radius: 0.16, size: 0.15, spread: 0.05, lead: 0.1, cause: 'MIRROR KNIGHT', tip: 'Mirror Knights reflect bullets that hit the mirror. Flank them, use explosives, or parry the reflection back.' });
      g.audio.play('ricochet', this.pos, 0.5);
    }
    return 0.04;
  }
  onHit(info, amount) {
    super.onHit(info, amount);
    if (this.hp > 0 && (info.source === 'punch' || info.source === 'ram' || info.source === 'slam') && this.state !== 'guardBroken') {
      this.state = 'guardBroken'; this.stateT = 1.7;
      this.game.style.add('GUARD BREAK', 25);
      this.game.audio.play('shieldBreak', this.pos, 0.8);
      this.game.fx.sparksBurst(this.centerPos().clone(), 0xc8f0ff, 16, 6, 0.4);
    }
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    this.reflectT -= dt; this.flareCd -= dt; this.glintT = (this.glintT || 0) - dt;
    const st = this.state;
    if (st === 'guardBroken') { this.stop(dt); if (this.stateT <= 0) { this.state = 'advance'; this.attackCd = 0.6; } return; }
    if (st === 'bashWind') {
      this.stop(dt); this.faceToward(p.x, p.z, dt, 6);
      if (this.stateT <= 0) {
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
        this.lungeX = dx / l; this.lungeZ = dz / l;
        this.state = 'bash'; this.stateT = 0.28; this.hitDone = false;
        g.audio.play('swing', this.pos, 0.7);
      }
      return;
    }
    if (st === 'bash') {
      this.body.vel.x = this.lungeX * 12 * this.speedMul; this.body.vel.z = this.lungeZ * 12 * this.speedMul;
      if (!this.hitDone && d < 1.8 && Math.abs(p.y - this.pos.y) < 1.8) {
        this.hitDone = true;
        if (g.player.damage(15 * this.dmgMul, this.pos, 'MIRROR KNIGHT', 'Mirror Knights pull their shield back before a bash. Dash sideways.')) { g.player.knock(this.lungeX * 13, 5, this.lungeZ * 13); g.audio.play('slam', this.pos, 0.6); }
      }
      if (this.stateT <= 0) { this.state = 'bashRec'; this.stateT = 0.55; this.attackCd = 1.6 * this.aggr; }
      return;
    }
    if (st === 'bashRec') { this.stop(dt); if (this.stateT <= 0) this.state = 'advance'; return; }
    if (st === 'flareWind') {
      this.stop(dt); this.faceToward(p.x, p.z, dt, 3);
      if (Math.random() < 0.5) { const m = this.glint.getWorldPosition(V1); g.fx.sparks.spawn(m.x + (Math.random() - 0.5) * 2, m.y + Math.random() * 1.5, m.z + (Math.random() - 0.5) * 2, -(Math.random() - 0.5) * 3, -2, -(Math.random() - 0.5) * 3, 0.8, 0.95, 1, 1, 0.1, 0.35, 0, 0); }
      if (this.stateT <= 0) {
        const from = this.glint.getWorldPosition(new THREE.Vector3());
        for (let k = -2; k <= 2; k++) this.shootAt(17, 9, { from: from.clone(), color: 0xc8f0ff, yawOff: k * 0.16, lead: 0.2, cause: 'MIRROR FLARE', tip: 'The Mirror Knight raises its mirror before a fan of light. Shoot it while the mirror is up, then dodge between the orbs.' });
        g.audio.play('lance', this.pos, 0.5);
        this.state = 'flareRec'; this.stateT = 0.45; this.flareCd = (6 + Math.random() * 2) * this.aggr;
      }
      return;
    }
    if (st === 'flareRec') { this.stop(dt); if (this.stateT <= 0) this.state = 'advance'; return; }
    // advance behind the mirror
    this.faceToward(p.x, p.z, dt, 3.2);
    if (d < 3.4 && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 1.8) { this.state = 'bashWind'; this.stateT = 0.5 * this.windMul; this.eyeFlare = 1; return; }
    if (this.canSee && d > 7 && this.flareCd <= 0) { this.state = 'flareWind'; this.stateT = 0.9 * this.windMul; this.eyeFlare = 1.2; g.audio.play('lanceCharge', this.pos, 0.6); return; }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 5);
  }
  pose(T) {
    const st = this.state, t = this.game.time;
    this.glint.visible = this.glintT > 0 || st === 'flareWind' || Math.sin(t * 1.7 + this.seed) > 0.97;
    this.glint.scale.setScalar(st === 'flareWind' ? 0.6 + Math.sin(t * 30) * 0.15 : 0.35);
    // guard: mirror held across the body, sword low and forward
    T.armL.x = -0.3; T.armL.z = 0.45; T.foreL.x = -0.4;
    T.armR.x += -0.3; T.foreR.x = -0.9;
    if (st === 'bashWind') { T.armL.x = 0.2; T.armL.z = 0.3; T.torso.y = 0.35; T.torso.x = -0.1; this.crouch(T, 0.1); T.rate = 14; }
    else if (st === 'bash') { T.armL.x = -0.6; T.armL.z = 0.55; T.torso.y = -0.25; T.torso.x = 0.25; T.legL.x = -0.7; T.legR.x = 0.5; T.rate = 26; }
    else if (st === 'flareWind' || st === 'flareRec') { T.armL.x = -1.65; T.armL.z = 0.25; T.foreL.x = -0.2; T.head.x = -0.4; T.torso.x = -0.15; T.armR.x = -0.2; T.foreR.x = -0.3; T.rate = 9; }
    else if (st === 'guardBroken') { T.armL.x = -0.5; T.armL.z = -1.1; T.foreL.x = -0.2; T.torso.x = -0.25; T.torso.z = Math.sin(t * 8) * 0.1; T.armR.x = 0.2; T.rate = 16; }
  }
  forceAttack() { this.state = 'flareWind'; this.stateT = 9; }
}

// ---------------------------------------------------------------------------------------
// LEECH: segmented lamprey-slug. Rears up, leaps, latches onto your face and drains you until
// it is punched or dashed off.
// ---------------------------------------------------------------------------------------
const LEECH_RIG = (() => {
  const flesh = 0x7a3e4c, dark = 0x2e141c, belly = 0xb07a78, glow = 0xff4a6a;
  const spine = (S, z, h) => { S.b(0.05, h, 0.06, 0, 0.12 + h / 2, z, dark, { top: [0.2, 0.3], rx: -0.4 }); };
  return [
    ['mid', null, 0, 0.22, 0, (S) => {
      S.b(0.36, 0.3, 0.32, 0, 0, 0, flesh, { top: [0.8, 0.9], bot: [0.9, 0.95] }); S.b(0.3, 0.06, 0.3, 0, -0.14, 0, belly);
      S.b(0.08, 0.06, 0.2, -0.2, -0.08, 0, dark, { rz: 0.5 }); S.b(0.08, 0.06, 0.2, 0.2, -0.08, 0, dark, { rz: -0.5 });
      spine(S, 0.04, 0.14); spine(S, -0.1, 0.12);
    }, 'flesh'],
    ['head', 'mid', 0, 0.01, 0.15, (S) => {
      S.b(0.34, 0.32, 0.24, 0, 0, 0.1, flesh, { top: [0.85, 0.9] });
      // flared lamprey lips around a ring of glowing teeth
      S.b(0.42, 0.42, 0.06, 0, 0, 0.24, belly, { top: [0.8, 1] }); S.b(0.3, 0.3, 0.04, 0, 0, 0.27, dark);
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; S.g(0.045, 0.045, 0.05, Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.29, glow, { rz: a }); }
      S.b(0.1, 0.1, 0.02, 0, 0, 0.285, 0x500818);
      S.g(0.03, 0.03, 0.02, -0.12, 0.12, 0.13, 0xffd0d8); S.g(0.03, 0.03, 0.02, 0.12, 0.12, 0.13, 0xffd0d8);
    }, 'flesh'],
    ['tail1', 'mid', 0, -0.01, -0.16, (S) => { S.b(0.3, 0.25, 0.28, 0, -0.02, -0.13, flesh, { top: [0.85, 0.9] }); S.b(0.24, 0.05, 0.26, 0, -0.14, -0.13, belly); spine(S, -0.13, 0.1); }, 'flesh'],
    ['tail2', 'tail1', 0, -0.01, -0.26, (S) => { S.b(0.22, 0.18, 0.26, 0, -0.03, -0.13, flesh, { top: [0.8, 0.8] }); S.b(0.12, 0.1, 0.16, 0, -0.03, -0.32, dark, { top: [0.4, 0.4] }); S.b(0.26, 0.03, 0.12, 0, -0.05, -0.4, dark, { top: [1, 0.5] }); }, 'flesh'],
  ];
})();

class Leech extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'leech', pos, opts);
    this.skinName = 'flesh';
    const J = buildRig(this, 'leech', LEECH_RIG);
    this.headMesh = J.head.userData.mesh;
    this.addEyes('head', 'mono', 0xff4a6a, 0, 0, 0.3, 0.26);
    this.radius = 0.36; this.body.r = 0.3; this.body.h = 0.45;
    this.headY = 0.3; this.headR = 0.2; this.bodyY1 = 0.5;
    this.speed = 4.6;
    this.styleValue = 18;
    this.bloodColor = [0.55, 0.12, 0.3];
    this.state = 'crawl';
    this.latched = false; this.drainT = 0; this.latchT = 0;
    this.finishSetup(34);
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    const st = this.state;
    if (st === 'latched') { this.updateLatched(dt); return; }
    if (st === 'rear') {
      this.stop(dt); this.faceToward(p.x, p.z, dt, 10);
      if (this.stateT <= 0) {
        // ballistic leap at the player's chest, with a little lead
        const pv = g.player.body.vel;
        const tx = p.x + pv.x * 0.25, tz = p.z + pv.z * 0.25, ty = p.y + 1.0;
        const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz) || 1;
        const T = clamp(l / 11, 0.3, 0.7);
        this.body.vel.set(dx / T, (ty - this.pos.y) / T + 12.5 * T, dz / T);
        this.state = 'leap'; this.stateT = 1.2;
        g.audio.play('lunge', this.pos, 0.6);
      }
      return;
    }
    if (st === 'leap') {
      const cy = this.pos.y + 0.2;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 0.95 && cy > p.y - 0.1 && cy < p.y + g.player.body.h + 0.2 && g.player.alive && !g.enemies.list.some((o) => o.latched)) {
        this.latch(); return;
      }
      if ((this.body.grounded && this.stateT < 1.05) || this.stateT <= 0) { this.state = 'miss'; this.stateT = 0.8; }
      return;
    }
    if (st === 'miss' || st === 'flung') {
      this.stop(dt);
      if (this.stateT <= 0) { this.state = 'crawl'; this.attackCd = (1.2 + Math.random()) * this.aggr; }
      return;
    }
    this.faceToward(p.x, p.z, dt, 6);
    if (d < 6.5 && d > 1.5 && this.canSee && this.attackCd <= 0 && Math.abs(p.y - this.pos.y) < 2) {
      this.state = 'rear'; this.stateT = 0.55 * this.windMul; this.eyeFlare = 1.5;
      g.audio.play('windup', this.pos, 0.4);
      return;
    }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 4);
  }
  latch() {
    const g = this.game;
    this.state = 'latched'; this.latched = true; this.latchT = 0; this.drainT = 0.35;
    this.body.vel.set(0, 0, 0);
    g.audio.play('stick', null, 1);
    g.addShake(0.25);
    g.hud.toast('LEECH! PUNCH OR DASH', '#ff4a6a', true);
  }
  detach(vx, vy, vz, why) {
    const g = this.game;
    this.latched = false;
    this.state = 'flung'; this.stateT = 0.9;
    // drop it where the player can see it, outside their body
    const cam = g.camera.position;
    this.pos.set(cam.x + vx * 0.08, Math.max(g.player.body.pos.y + 0.6, cam.y - 0.5), cam.z + vz * 0.08);
    this.body.vel.set(vx, vy, vz);
    this.stagger = 0.9;
    if (why) { g.style.add(why, 30); g.fx.blood(this.pos, V1.set(vx, 1, vz).normalize(), 1.2, this.bloodColor); }
  }
  updateLatched(dt) {
    const g = this.game;
    this.latchT += dt;
    // thrown off by a dash, or by the player dying
    if (g.player.dashT > 0) {
      const dd = g.player.dashDir;
      this.detach(-dd.x * 7, 4, -dd.z * 7, 'SHAKEN OFF');
      g.combat.damageEnemy(this, 14, { source: 'ram', fromPlayer: true, quiet: true });
      return;
    }
    if (!g.player.alive || this.latchT > 7) { this.detach(0, 2, 0, null); return; }
    this.drainT -= dt;
    if (this.drainT <= 0) {
      this.drainT = 0.55;
      if (g.player.damage(4 * this.dmgMul, this.pos, 'LEECH', 'Leeches leap after rearing up. If one latches on, PUNCH or DASH immediately to tear it off.')) {
        this.hp = Math.min(this.maxHp * 1.5, this.hp + 4);
        g.audio.play('sizzle', null, 0.4);
      }
    }
  }
  onHit(info, amount) {
    super.onHit(info, amount);
    if (this.latched && this.hp > 0 && info.source === 'punch') {
      const d = info.dir || V1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.detach(d.x * 11, 4, d.z * 11, 'TORN OFF');
    }
  }
  physics(dt) {
    if (!this.latched) { super.physics(dt); return; }
    // ride the player's face: in front of the camera, low enough to keep the crosshair clear
    const cam = this.game.camera;
    const fwd = cam.getWorldDirection(V2);
    const wob = Math.sin(this.game.time * 23) * 0.03;
    this.pos.set(cam.position.x + fwd.x * 0.62, cam.position.y + fwd.y * 0.62 - 0.42 + wob, cam.position.z + fwd.z * 0.62);
    this.yaw = Math.atan2(cam.position.x - this.pos.x, cam.position.z - this.pos.z);
  }
  updateSight(dt) { if (this.latched) { this.canSee = true; return; } super.updateSight(dt); }
  animate(dt) {
    const J = this.joints, t = this.game.time, st = this.state;
    const v = Math.hypot(this.body.vel.x, this.body.vel.z);
    const amt = Math.min(1, v / 3);
    const w = this.walk * 2;
    let hx = 0, t1x = 0, my = 0.22, mx = 0;
    if (st === 'rear') { hx = -0.9; mx = -0.5; t1x = 0.4; my = 0.32; }
    else if (st === 'leap') { hx = -0.2; mx = -0.3; }
    else if (st === 'latched') { hx = Math.sin(t * 20) * 0.15; mx = -0.2 + Math.sin(t * 14) * 0.2; }
    const k = Math.min(1, dt * 14);
    J.head.rotation.x += (hx - J.head.rotation.x) * k;
    J.mid.rotation.x += (mx - J.mid.rotation.x) * k;
    J.mid.position.y += (my - J.mid.position.y) * k;
    J.tail1.rotation.x += (t1x - J.tail1.rotation.x) * k;
    const sway = st === 'latched' ? Math.sin(t * 16) * 0.5 : Math.sin(w) * 0.45 * amt;
    J.head.rotation.y = -sway * 0.5; J.tail1.rotation.y = sway; J.tail2.rotation.y = sway * 1.2;
    J.mid.scale.set(1, 1 + Math.sin(w * 2) * 0.06 * amt, 1 - Math.sin(w * 2) * 0.04 * amt);
    this.group.scale.setScalar(st === 'latched' ? 0.85 : this.elite ? 1.28 : 1.15);
    this.shadow.visible = !this.latched;
  }
  deathPose(k) { this.joints.mid.rotation.z = 2.8 * k; this.joints.tail1.rotation.y = 0.8 * k; this.joints.head.rotation.y = -0.6 * k; }
  forceAttack() { this.state = 'rear'; this.stateT = 9; this.eyeFlare = 1.5; }
}

// ---------------------------------------------------------------------------------------
// BOMBER: delta-wing drone. Lines up a run over the player and carpet-bombs a straight lane
// (every bomb shows its landing circle). Shoot it down or step off the line.
// ---------------------------------------------------------------------------------------
const BOMBER_RIG = (() => {
  const hull = 0x50545e, dark = 0x1c1e24, hazard = 0xc8a020, glow = 0xff5030, eye = 0xffe23a;
  const rotor = (S) => { S.b(0.5, 0.015, 0.05, 0, 0, 0, dark); S.b(0.05, 0.015, 0.5, 0, 0, 0, dark); };
  return [
    ['hull', null, 0, 0, 0, (S) => {
      S.b(0.42, 0.26, 1.0, 0, 0, 0, hull, { top: [0.8, 0.9] }); S.b(0.3, 0.2, 0.3, 0, -0.02, 0.6, hull, { top: [0.7, 0.6], bot: [0.8, 0.7] });
      for (const s of [-1, 1]) {
        S.b(0.8, 0.05, 0.4, s * 0.55, 0.02, -0.1, hull, { ry: s * 0.35 }); S.b(0.25, 0.055, 0.1, s * 0.75, 0.025, -0.14, hazard, { ry: s * 0.35 });
        S.b(0.14, 0.14, 0.14, s * 0.9, 0.05, -0.24, dark); S.g(0.06, 0.03, 0.06, s * 0.9, -0.03, -0.24, glow);
        S.b(0.04, 0.26, 0.2, s * 0.12, 0.2, -0.44, hull, { rz: -s * 0.3, top: [1, 0.5] });
      }
      S.b(0.3, 0.06, 0.52, 0, -0.15, -0.05, dark); for (let k = 0; k < 3; k++) S.g(0.32, 0.02, 0.05, 0, -0.18, -0.28 + k * 0.23, glow);
      S.b(0.1, 0.1, 0.18, -0.08, -0.23, -0.05, 0x3a3a3a); S.b(0.1, 0.1, 0.18, 0.08, -0.23, -0.05, 0x3a3a3a);
      S.g(0.14, 0.06, 0.03, 0, 0.0, 0.76, eye);
    }],
    ['rotL', 'hull', -0.9, 0.14, -0.24, rotor], ['rotR', 'hull', 0.9, 0.14, -0.24, rotor],
  ];
})();

class Bomber extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'bomber', pos, opts);
    this.flying = true;
    const J = buildRig(this, 'bomber', BOMBER_RIG);
    this.headMesh = J.hull.userData.mesh;
    this.addEyes('hull', 'slit', 0xffe23a, 0, 0, 0.8, 0.3);
    this.radius = 0.75; this.body.r = 0.5; this.body.h = 0.5;
    this.headY = 0; this.headR = 0.3; this.bodyY0 = -0.3; this.bodyY1 = 0.3;
    this.speed = 7;
    this.styleValue = 35;
    this.bloodColor = [0.9, 0.6, 0.2];
    const room = game.level.current;
    this.hoverH = room ? clamp((room.spec.H || 7) - 1.6, 3.6, 6.5) : 5;
    this.pos.y = Math.max(this.pos.y, this.hoverH);
    this.state = 'cruise'; this.attackCd = 1.5 + Math.random();
    this.runDir = new THREE.Vector3(); this.runStart = new THREE.Vector3();
    this.bank = 0;
    this.finishSetup(60);
  }
  centerPos() { return this.c.set(this.pos.x, this.pos.y, this.pos.z); }
  headPos() { return this.h.set(this.pos.x, this.pos.y, this.pos.z); }
  eyePos(out) { return out.set(this.pos.x, this.pos.y - 0.2, this.pos.z); }
  get groundY() { const r = this.game.level.current; return r ? r.floorAt(this.pos.x, this.pos.z) : 0; }
  planRun() {
    const g = this.game, p = g.player.body.pos, room = g.level.current;
    // approach from the bomber's side so the run starts soon; clamp the lane to the room
    let ux = p.x - this.pos.x, uz = p.z - this.pos.z;
    const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    this.runDir.set(ux, 0, uz);
    this.runStart.set(p.x - ux * 8, this.hoverH, p.z - uz * 8);
    if (room) {
      this.runStart.x = clamp(this.runStart.x, room.origin.x - room.W / 2 + 2, room.origin.x + room.W / 2 - 2);
      this.runStart.z = clamp(this.runStart.z, room.origin.z - room.D / 2 + 2, room.origin.z + room.D / 2 - 2);
    }
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const b = this.body;
    if (typeof this.stun === 'number' && this.stun > 0) { this.stun -= dt; b.vel.multiplyScalar(0.9); b.vel.y = -1.5; return; }
    const ty = this.hoverH + Math.sin(g.time * 1.3 + this.seed) * 0.25;
    b.vel.y += ((ty - this.pos.y) * 2 - b.vel.y) * Math.min(1, dt * 3);
    const k = 1 - Math.exp(-3 * dt);
    if (this.state === 'approach') {
      const dx = this.runStart.x - this.pos.x, dz = this.runStart.z - this.pos.z, l = Math.hypot(dx, dz);
      b.vel.x += (dx / (l || 1) * this.speed * this.speedMul - b.vel.x) * k;
      b.vel.z += (dz / (l || 1) * this.speed * this.speedMul - b.vel.z) * k;
      this.faceToward(this.pos.x + b.vel.x, this.pos.z + b.vel.z, dt, 4);
      if (l < 1.6 || this.stateT <= 0) {
        this.planRunDirFromHere();
        this.state = 'run'; this.stateT = 3.2; this.bombs = 6 + (this.elite ? 2 : 0); this.bombT = 0.45 * this.windMul;
        this.eyeFlare = 1.5;
        g.audio.play('alert', this.pos, 0.9);
      }
      return;
    }
    if (this.state === 'run') {
      const sp = 8.5 * this.speedMul;
      b.vel.x += (this.runDir.x * sp - b.vel.x) * Math.min(1, dt * 6);
      b.vel.z += (this.runDir.z * sp - b.vel.z) * Math.min(1, dt * 6);
      this.faceToward(this.pos.x + this.runDir.x, this.pos.z + this.runDir.z, dt, 8);
      this.bombT -= dt;
      if (this.bombT <= 0 && this.bombs > 0) {
        this.bombT = 0.3; this.bombs--;
        const room = g.level.current;
        const from = V1.set(this.pos.x, this.pos.y - 0.3, this.pos.z);
        const tx = this.pos.x + b.vel.x * 0.85, tz = this.pos.z + b.vel.z * 0.85;
        const target = new THREE.Vector3(tx, room ? room.floorAt(tx, tz) : 0, tz);
        g.projectiles.spawnMortar(from.clone(), target, 18 * this.dmgMul, 2.4, 0.85, { cause: 'BOMBER', color: 0xff6020 });
        g.audio.play('launcher', this.pos, 0.4);
      }
      if (this.bombs <= 0 || this.stateT <= 0) { this.state = 'cruise'; this.attackCd = (2.4 + Math.random()) * this.aggr; }
      return;
    }
    // cruise: lazy figure-eight around the player at altitude
    const a = g.time * 0.35 + this.seed;
    const tx = p.x + Math.sin(a) * 10, tz = p.z + Math.sin(a * 2) * 6;
    const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz) || 1;
    const sp = this.speed * this.speedMul * Math.min(1, l / 4);
    b.vel.x += (dx / l * sp - b.vel.x) * k;
    b.vel.z += (dz / l * sp - b.vel.z) * k;
    this.faceToward(this.pos.x + b.vel.x, this.pos.z + b.vel.z, dt, 3);
    if (this.attackCd <= 0 && this.canSee) { this.planRun(); this.state = 'approach'; this.stateT = 4; }
  }
  planRunDirFromHere() {
    const p = this.game.player.body.pos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, l = Math.hypot(dx, dz);
    if (l > 1.5) this.runDir.set(dx / l, 0, dz / l);
  }
  physics(dt) {
    moveBody(this.body, this.body.vel.x * dt, this.body.vel.y * dt, this.body.vel.z * dt, this.game.level.colliders);
    this.pos.y = Math.max(1.2, this.pos.y);
    const room = this.game.level.current;
    if (room && !room.containsXZ(this.pos.x, this.pos.z, 0.8)) {
      this.pos.x = clamp(this.pos.x, room.origin.x - room.W / 2 + 1, room.origin.x + room.W / 2 - 1);
      this.pos.z = clamp(this.pos.z, room.origin.z - room.D / 2 + 1, room.origin.z + room.D / 2 - 1);
    }
  }
  animate(dt) {
    const J = this.joints, t = this.game.time;
    J.rotL.rotation.y += dt * 45; J.rotR.rotation.y -= dt * 45;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const vr = this.body.vel.x * fz - this.body.vel.z * fx;
    this.bank += (clamp(-vr * 0.12, -0.6, 0.6) - this.bank) * Math.min(1, dt * 4);
    J.hull.rotation.z = this.bank + Math.sin(t * 2 + this.seed) * 0.05;
    J.hull.rotation.x = this.state === 'run' ? 0.12 : 0;
  }
  onDeath(info) {
    const g = this.game, p = this.pos.clone();
    void info;
    g.fx.explosion(p, 2.4, 0xff7030);
    g.audio.play('explosion', p, 0.8);
    g.combat.radialDamage(p, 2.6, 14, { source: 'explosion', friendly: true, cause: 'BOMBER WRECK', tip: 'Downed Bombers explode where they fall.' });
  }
  forceAttack() { this.state = 'run'; this.stateT = 9; this.bombs = 1; this.bombT = 9; this.eyeFlare = 1.5; this.runDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
}

// ---------------------------------------------------------------------------------------
// CHARGER: horned furnace-ram on four legs. Paws the ground behind a red lane telegraph, then
// charges; walls stun it and expose the furnace on its back. It tramples other machines too.
// ---------------------------------------------------------------------------------------
const CHARGER_RIG = (() => {
  const armor = 0x74301f, dark = 0x1e1412, horn = 0xd0c0a0, steel = 0x46464c, glow = 0xff7020, hazard = 0xc8a020;
  const leg = (S) => { S.b(0.26, 0.42, 0.3, 0, -0.18, 0, armor); S.b(0.2, 0.32, 0.22, 0, -0.52, 0, dark); S.b(0.28, 0.1, 0.32, 0, -0.67, 0.03, steel); };
  return [
    ['body', null, 0, 1.0, 0, (S) => {
      S.b(0.9, 0.7, 1.3, 0, 0.05, -0.05, armor, { top: [0.8, 0.9] }); S.b(0.7, 0.2, 1.1, 0, -0.32, -0.05, dark);
      S.b(0.98, 0.56, 0.6, 0, 0.32, 0.32, armor, { top: [0.6, 0.7] });
      S.b(0.5, 0.3, 0.5, 0, 0.5, -0.22, steel, { top: [0.7, 0.7] }); S.g(0.36, 0.04, 0.36, 0, 0.66, -0.22, glow);
      for (let k = 0; k < 3; k++) S.b(0.38, 0.03, 0.04, 0, 0.675, -0.34 + k * 0.12, dark);
      S.b(0.08, 0.42, 0.08, -0.22, 0.55, -0.58, steel, { rx: -0.5 }); S.b(0.08, 0.42, 0.08, 0.22, 0.55, -0.58, steel, { rx: -0.5 });
      S.g(0.07, 0.04, 0.07, -0.22, 0.73, -0.68, glow, { rx: -0.5 }); S.g(0.07, 0.04, 0.07, 0.22, 0.73, -0.68, glow, { rx: -0.5 });
      S.b(0.92, 0.08, 0.3, 0, 0.0, -0.45, hazard); S.b(0.2, 0.2, 0.2, 0, -0.05, -0.75, armor, { top: [0.5, 0.5] });
    }],
    ['head', 'body', 0, -0.05, 0.72, (S) => {
      S.b(0.7, 0.55, 0.5, 0, -0.1, 0.2, armor, { top: [0.75, 0.8], bot: [0.9, 1] }); S.b(0.6, 0.5, 0.12, 0, -0.15, 0.48, steel, { rx: 0.25 });
      S.b(0.13, 0.62, 0.13, -0.42, 0.22, 0.3, horn, { top: [0.2, 0.2], rz: 0.85, rx: -0.4 }); S.b(0.13, 0.62, 0.13, 0.42, 0.22, 0.3, horn, { top: [0.2, 0.2], rz: -0.85, rx: -0.4 });
      S.g(0.09, 0.05, 0.02, -0.16, 0.02, 0.535, glow, { rx: 0.25 }); S.g(0.09, 0.05, 0.02, 0.16, 0.02, 0.535, glow, { rx: 0.25 });
      S.g(0.05, 0.05, 0.02, -0.08, -0.28, 0.58, 0xff3010, { rx: 0.25 }); S.g(0.05, 0.05, 0.02, 0.08, -0.28, 0.58, 0xff3010, { rx: 0.25 });
    }],
    ['legFL', 'body', -0.36, -0.3, 0.42, leg], ['legFR', 'body', 0.36, -0.3, 0.42, leg],
    ['legBL', 'body', -0.36, -0.3, -0.5, leg], ['legBR', 'body', 0.36, -0.3, -0.5, leg],
  ];
})();

let laneMat = null;
class Charger extends Enemy {
  constructor(game, pos, opts) {
    super(game, 'charger', pos, opts);
    const J = buildRig(this, 'charger', CHARGER_RIG);
    this.headMesh = J.body.userData.mesh;
    this.addEyes('head', 'pair', 0xff7020, 0, 0.03, 0.6, 0.36);
    this.radius = 0.85; this.body.r = 0.62; this.body.h = 1.5;
    this.headY = 1.62; this.headR = 0.3; this.bodyY1 = 1.45;
    this.heavy = true;
    this.speed = 3.4;
    this.styleValue = 55;
    this.bloodColor = [0.5, 0.15, 0.05];
    this.state = 'stalk';
    this.attackCd = 1.5 + Math.random();
    this.chargeDir = new THREE.Vector3();
    this.trampled = new Set();
    if (!laneMat) laneMat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lane = new THREE.Mesh(laneGeometry(), laneMat.clone());
    this.lane.visible = false;
    game.scene.add(this.lane);
    this.stepT = 0;
    this.finishSetup(230);
  }
  extraCleanup() { this.game.scene.remove(this.lane); this.lane.material.dispose(); }
  armorFactor(info) {
    if (this.state === 'stunned') return info.part === 'head' ? 1.3 : 1.5;
    if (!info.dir || info.source === 'explosion' || info.energy || info.source === 'punch' || info.source === 'parry' || info.part === 'head') return 1;
    const dot = info.dir.x * Math.sin(this.yaw) + info.dir.z * Math.cos(this.yaw);
    if (dot < -0.4) { if (info.point) this.game.fx.sparksBurst(info.point, 0xffb060, 3, 4, 0.2, 0.07); return 0.35; }
    return 1;
  }
  laneLength() {
    const from = V1.set(this.pos.x, this.pos.y + 0.8, this.pos.z);
    const w = this.game.combat.rayWorld(from, this.chargeDir, 30);
    return w ? w.t : 30;
  }
  think(dt) {
    const g = this.game, p = g.player.body.pos;
    const d = this.playerDist();
    const st = this.state;
    if (st === 'paw') {
      this.stop(dt);
      if (this.stateT > 0.3) {
        this.faceToward(p.x, p.z, dt, 4);
        this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      }
      if (Math.random() < 0.4) g.fx.dust.spawn(this.pos.x + Math.sin(this.yaw) * 0.6, this.pos.y + 0.05, this.pos.z + Math.cos(this.yaw) * 0.6, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.4, 0.33, 0.28, 0.7, 0.3, 0.6, -0.3, 1);
      if (this.stateT <= 0) {
        this.state = 'charge'; this.stateT = 1.6; this.trampled.clear(); this.hitDone = false;
        g.audio.play('lunge', this.pos, 1); g.addShake(0.08);
      }
      return;
    }
    if (st === 'charge') {
      const sp = 19 * this.speedMul;
      this.body.vel.x = this.chargeDir.x * sp; this.body.vel.z = this.chargeDir.z * sp;
      if (!this.hitDone && d < 1.5 && Math.abs(p.y - this.pos.y) < 1.7) {
        this.hitDone = true;
        if (g.player.damage(26 * this.dmgMul, this.pos, 'CHARGER', 'Chargers paint a red lane before they charge. Sidestep late, and lure them into walls to stun them.')) {
          g.player.knock(this.chargeDir.x * 16, 6, this.chargeDir.z * 16);
          g.audio.play('slam', this.pos, 0.8); g.addShake(0.35);
        }
        this.state = 'skid'; this.stateT = 0.6;
        return;
      }
      // trample anything in the way (friendly fire counts for your style)
      for (const o of g.enemies.list) {
        if (o === this || !o.alive || o.mini || o.flying || o.latched || this.trampled.has(o)) continue;
        if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < this.radius + o.radius) {
          this.trampled.add(o);
          g.combat.damageEnemy(o, 70, { source: 'enemy', friendly: true, fromPlayer: false, dir: this.chargeDir.clone(), knock: 12, stagger: 0.8, point: o.centerPos().clone() });
        }
      }
      if (this.stateT <= 0) { this.state = 'skid'; this.stateT = 0.6; }
      return;
    }
    if (st === 'skid') {
      this.body.vel.x *= 1 - Math.min(1, dt * 5); this.body.vel.z *= 1 - Math.min(1, dt * 5);
      if (this.stateT <= 0) { this.state = 'stalk'; this.attackCd = (2 + Math.random()) * this.aggr; }
      return;
    }
    if (st === 'stunned') {
      this.stop(dt);
      if (Math.random() < 0.15) g.fx.sparks.spawn(this.pos.x + (Math.random() - 0.5), this.pos.y + 1.8, this.pos.z + (Math.random() - 0.5), 0, 1.5, 0, 1, 0.9, 0.3, 1, 0.12, 0.4, 0, 0);
      if (this.stateT <= 0) { this.state = 'stalk'; this.attackCd = 0.8 * this.aggr; }
      return;
    }
    if (st === 'gore') {
      this.stop(dt); this.faceToward(p.x, p.z, dt, 5);
      if (this.stateT <= 0) {
        if (d < 2.6 && Math.abs(p.y - this.pos.y) < 1.8 && g.player.damage(16 * this.dmgMul, this.pos, 'CHARGER', 'Chargers toss their horns at close range. Keep your distance or flank them.')) {
          const dx = (p.x - this.pos.x) / (d || 1), dz = (p.z - this.pos.z) / (d || 1);
          g.player.knock(dx * 10, 7, dz * 10); g.audio.play('slash', this.pos, 0.8);
        }
        this.state = 'stalk'; this.attackCd = 1.4 * this.aggr;
      }
      return;
    }
    this.faceToward(p.x, p.z, dt, 3);
    if (this.attackCd <= 0 && d < 2.6) { this.state = 'gore'; this.stateT = 0.5 * this.windMul; this.eyeFlare = 1; g.audio.play('windup', this.pos, 0.6); return; }
    if (this.attackCd <= 0 && this.canSee && d > 5 && d < 28) {
      this.state = 'paw'; this.stateT = 1.0 * this.windMul; this.eyeFlare = 1.5;
      this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      g.audio.play('bossCharge', this.pos, 0.5);
      return;
    }
    this.navMove(dt, p.x, p.z, this.speed * this.speedMul, this.canSee && d < 5);
    this.stepT -= dt;
    if (this.stepT <= 0 && Math.hypot(this.body.vel.x, this.body.vel.z) > 1) { this.stepT = 0.45; g.audio.play('land', this.pos, 0.3); }
  }
  physics(dt) {
    const charging = this.state === 'charge';
    super.physics(dt);
    if (charging && this.state === 'charge' && (this.body.wallNormalX || this.body.wallNormalZ)) {
      // slammed into a wall: dazed, furnace exposed
      const g = this.game;
      this.state = 'stunned'; this.stateT = 2.3;
      this.body.vel.set(-this.chargeDir.x * 3, 3, -this.chargeDir.z * 3);
      g.audio.play('slam', this.pos, 1); g.addShake(Math.max(0, 0.4 - this.playerDist() * 0.02));
      g.fx.sparksBurst(V1.set(this.pos.x + this.chargeDir.x, this.pos.y + 1, this.pos.z + this.chargeDir.z), 0xffd080, 20, 8, 0.5);
      g.style.add('WALL SLAM', 25, true);
    }
  }
  animate(dt) {
    const J = this.joints, t = this.game.time, st = this.state;
    const v = Math.hypot(this.body.vel.x, this.body.vel.z);
    const amt = Math.min(1, v / 3);
    const ph = this.walk * (st === 'charge' ? 0.9 : 1.3);
    const sw = Math.sin(ph) * (st === 'charge' ? 0.8 : 0.45) * amt;
    let lfl = sw, lfr = -sw, lbl = -sw, lbr = sw;
    let bodyY = 1.0 + Math.abs(Math.cos(ph)) * 0.05 * amt, bodyX = 0, headX = 0, headY = 0;
    if (st === 'paw') { lfr = -0.6 + Math.max(0, Math.sin(t * 14)) * 0.9; bodyY = 0.92; bodyX = 0.12; headX = 0.25 + Math.sin(t * 14) * 0.05; }
    else if (st === 'charge') { bodyX = 0.15; headX = 0.35; bodyY = 0.95; }
    else if (st === 'stunned') { bodyY = 0.85; headX = 0.4 + Math.sin(t * 5) * 0.1; headY = Math.sin(t * 3.3) * 0.4; lfl = -0.3; lfr = -0.25; }
    else if (st === 'gore') { headX = this.stateT > 0.15 ? 0.4 : -0.6; bodyX = this.stateT > 0.15 ? 0.1 : -0.15; }
    else if (st === 'skid') { bodyX = -0.1; lfl = lfr = -0.5; }
    const k = Math.min(1, dt * 12);
    J.legFL.rotation.x += (lfl - J.legFL.rotation.x) * k; J.legFR.rotation.x += (lfr - J.legFR.rotation.x) * k;
    J.legBL.rotation.x += (lbl - J.legBL.rotation.x) * k; J.legBR.rotation.x += (lbr - J.legBR.rotation.x) * k;
    J.body.position.y += (bodyY - J.body.position.y) * k;
    J.body.rotation.x += (bodyX - J.body.rotation.x) * k;
    J.head.rotation.x += (headX - J.head.rotation.x) * k;
    J.head.rotation.y += (headY - J.head.rotation.y) * k;
    if (this.stagger > 0) J.body.rotation.z = Math.sin(t * 9) * 0.06; else J.body.rotation.z = 0;
    // lane telegraph: grows in while pawing, flashes once the direction locks
    if (st === 'paw' && this.alive) {
      const len = this.laneLength();
      this.lane.visible = true;
      this.lane.position.set(this.pos.x, this.gy() + 0.06, this.pos.z);
      this.lane.rotation.y = Math.atan2(this.chargeDir.x, this.chargeDir.z);
      this.lane.scale.set(1.7, 1, len * clamp(1.2 - this.stateT, 0.2, 1));
      this.lane.material.opacity = this.stateT < 0.3 ? (Math.sin(t * 40) > 0 ? 0.7 : 0.25) : 0.3;
    } else this.lane.visible = false;
  }
  deathPose(k) {
    const J = this.joints;
    J.legFL.rotation.z = J.legBL.rotation.z = -0.8 * k; J.legFR.rotation.z = J.legBR.rotation.z = 0.8 * k;
    J.body.position.y = 1.0 - 0.45 * k; J.head.rotation.x = 0.6 * k;
  }
  forceAttack() { this.state = 'paw'; this.stateT = 9; this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.eyeFlare = 1.5; }
}

const TYPES = {
  husk: Husk, ripper: Ripper, gunner: Gunner, lancer: Lancer, bulwark: Bulwark, signaller: Signaller, wisp: Wisp,
  swarmer: Swarmer, leech: Leech, sentry: Sentry, charger: Charger, stalker: Stalker, bomber: Bomber, cantor: Cantor, mirror: MirrorKnight,
};
export const ENEMY_TYPES = Object.keys(TYPES);
export const FLYING_TYPES = new Set(['wisp', 'bomber']);

// ---------------------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------------------
export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.flowT = 0;
    this.waves = [];
    this.timers = [];
    this.dying = [];
  }
  spawn(type, pos, opts = {}) {
    const C = TYPES[type];
    const e = new C(this.game, pos, opts);
    this.list.push(e);
    return e;
  }
  get aliveCount() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }

  delayed(t, fn) { this.timers.push({ t, fn }); }

  shockwave(center, maxR, speed, dmg, color, cause, tip) {
    const fx = this.game.fx;
    const it = fx.ring(center.x, center.y + 0.1, center.z, maxR, color, maxR / speed, 0);
    const it2 = fx.ring(center.x, center.y + 0.5, center.z, maxR, color, maxR / speed, 0);
    this.waves.push({ c: center.clone(), r: 0, maxR, speed, dmg, hit: false, cause, tip, ring: it, ring2: it2 });
  }

  // grounded deaths keep the body for a short ragdoll-ish collapse before it becomes debris
  collapse(e, dir, force) {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    let lz = dir.x * fx + dir.z * fz, lx = dir.x * fz - dir.z * fx;
    const l = Math.hypot(lx, lz);
    if (l < 0.2) { lz = -1; lx = (Math.random() - 0.5) * 0.6; } else { lx /= l; lz /= l; }
    if (e.type === 'charger') { lx = lx >= 0 ? 1 : -1; lz = 0; } // big bodies roll onto a side
    const push = Math.min(5, force * 0.45);
    e.body.vel.set(dir.x * push, 0, dir.z * push);
    this.dying.push({ e, t: 0, dur: 0.5 + Math.random() * 0.15, lx, lz, twist: (Math.random() - 0.5) * 0.6 });
  }

  updateDying(dt) {
    if (!this.dying.length) return;
    const g = this.game;
    for (const d of this.dying) {
      const e = d.e;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const b = e.body;
      const damp = Math.exp(-5 * dt);
      b.vel.x *= damp; b.vel.z *= damp; b.vel.y -= 25 * dt;
      moveBody(b, b.vel.x * dt, b.vel.y * dt, b.vel.z * dt, g.level.colliders);
      const f = k * k * 1.5; // accelerates like a falling plank
      e.group.position.copy(e.pos);
      e.group.rotation.set(d.lz * f, e.yaw + d.twist * k, -d.lx * f);
      e.deathPose(k, d);
      if (d.t >= d.dur + 0.08) {
        d.done = true;
        e.group.updateMatrixWorld(true);
        for (const m of e.meshes) if (m.parent && !m.userData.noCorpse && !(e.decapitated && m === e.headMesh)) g.fx.addCorpsePiece(m, ZERO, ZERO);
        g.scene.remove(e.group);
      }
    }
    this.dying = this.dying.filter((d) => !d.done);
  }

  update(dt) {
    const g = this.game;
    const room = g.level.current;
    this.flowT -= dt;
    if (this.flowT <= 0 && room && room.nav) {
      this.flowT = 0.25;
      const p = g.player.body.pos;
      room.nav.flow(p.x, p.z);
    }
    for (const e of this.list) if (e.alive) e.update(dt);
    this.updateDying(dt);
    // safety nets: free enemies wedged inside geometry, and mark stragglers if a fight drags on
    this.checkT = (this.checkT || 0) - dt;
    if (this.checkT <= 0 && room) {
      this.checkT = 1.5;
      const alive = this.list.filter((e) => e.alive && e.targetable);
      for (const e of alive) {
        if (!e.flying && !e.perch && !e.latched && bodyOverlapsAny(e.body, g.level.colliders)) {
          const k = room.nav.nearestFree(e.pos.x, e.pos.z, 8);
          if (k >= 0) { const c = room.nav.center(k, { x: 0, z: 0 }); e.pos.set(c.x, room.floorAt(c.x, c.z) + 0.05, c.z); e.body.vel.set(0, 0, 0); }
        }
      }
      if (alive.length && alive.length <= 2 && g.time - (this.lastKill || 0) > 12 && room.state === 'combat') {
        for (const e of alive) g.fx.spawnColumn(e.pos.x, e.pos.y, e.pos.z, 0xff3050, 1.2, 9);
      }
    }
    // remove dead (their meshes were handed to the corpse system)
    if (this.list.some((e) => !e.alive)) this.list = this.list.filter((e) => e.alive);
    // shockwaves
    const pp = g.player.body.pos;
    for (const w of this.waves) {
      w.r += w.speed * dt;
      const d = Math.hypot(pp.x - w.c.x, pp.z - w.c.z);
      if (!w.hit && Math.abs(d - w.r) < 0.7 && pp.y - w.c.y < 0.55) {
        w.hit = true;
        if (g.player.damage(w.dmg, w.c, w.cause, w.tip)) {
          const dx = (pp.x - w.c.x) / (d || 1), dz = (pp.z - w.c.z) / (d || 1);
          g.player.knock(dx * 7, 5, dz * 7);
        }
      }
    }
    this.waves = this.waves.filter((w) => w.r < w.maxR);
    for (const t of this.timers) { t.t -= dt; if (t.t <= 0) t.fn(); }
    this.timers = this.timers.filter((t) => t.t > 0);
  }

  onKilled(e) { this.lastKill = this.game.time; if (e) { this.game.director.onKill(e); this.game.emit('kill', e); } }

  clear() {
    for (const e of this.list) e.remove();
    for (const d of this.dying) this.game.scene.remove(d.e.group);
    this.list = [];
    this.dying = [];
    this.waves = [];
    this.timers = [];
  }

  // Highest active signaller progress (for the HUD uplink panel)
  uplink() {
    let best = null;
    for (const e of this.list) if (e.alive && e.type === 'signaller' && !e.called && e.progress > 0) if (!best || e.progress > best.progress) best = e;
    return best;
  }
}
