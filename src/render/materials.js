import * as THREE from 'three';
import { getTexture } from './textures.js';
import { psxify } from './renderer.js';

// Regional art direction. Each stratum has its own palette, fog, lighting balance (hemisphere sky
// vs ground bounce vs lamp colour), surface textures (textures.js variants) and a post grade
// (renderer.setTheme: highlight tint, saturation, contrast, shadow lift toward the fog hue, glow).
// Lamps are tinted against the ambient (warm lamps in cold rooms and the reverse) so lit pools read.
export const THEMES = [
  {
    id: 'service', name: 'SERVICE DECKS', // blue-grey steel under sodium work lamps
    wall: 0x66708a, floor: 0x777b88, trim: 0x343a48, prop: 0x8a6a48, accent: 0x3ef0d0, accent2: 0xff3050,
    lamp: 0xffe2a8, fog: 0x0a0e18, fogNear: 10, fogFar: 62, sky: 0x6a7aac, ground: 0x2e2418, hemi: 1.2,
    light: 0xffd49a, floorTex: 'plate', wallTex: 'panel', ceilTex: 'ceil2', trimTex: 'trim', crateTex: 'crate', hazard: 'electric',
    grade: { hi: 0xfff0d8, sat: 1.1, contrast: 0.2, lift: 0.05, bloom: 0.9 },
  },
  {
    id: 'foundry', name: 'THE FOUNDRY', // soot-black firebrick, orange haze, molten glow
    wall: 0x8e5c46, floor: 0x6c605a, trim: 0x2e221c, prop: 0x7a7066, accent: 0xff8a1a, accent2: 0xff3020,
    lamp: 0xffc880, fog: 0x1e0c05, fogNear: 8, fogFar: 54, sky: 0xb46c3c, ground: 0x3a1606, hemi: 1.15,
    light: 0xffa060, floorTex: 'concrete2', wallTex: 'brick', ceilTex: 'ceil2', trimTex: 'rust', crateTex: 'crate2', concreteTex: 'concrete2', hazard: 'molten',
    grade: { hi: 0xffd8a8, sat: 1.15, contrast: 0.22, lift: 0.07, bloom: 1.1, thresh: 0.58 },
  },
  {
    id: 'reactor', name: 'REACTOR COMPLEX', // sickly green coolant light, yellow hazard paint
    wall: 0x58786c, floor: 0x54645c, trim: 0x1e2c26, prop: 0x6a7a4a, accent: 0x6aff5a, accent2: 0xffe23a,
    lamp: 0xe8ffd8, fog: 0x08140c, fogNear: 9, fogFar: 58, sky: 0x6aa880, ground: 0x16240a, hemi: 1.15,
    light: 0xb0ffb8, floorTex: 'grate', wallTex: 'panel3', ceilTex: 'ceil2', trimTex: 'trim', crateTex: 'crate2', hazard: 'coolant',
    grade: { hi: 0xeaffd8, sat: 1.1, contrast: 0.2, lift: 0.06, bloom: 1.05 },
  },
  {
    id: 'research', name: 'RESEARCH WING', // clinical white cladding, checker floors
    wall: 0xb8bcc8, floor: 0xa6aab4, trim: 0x40444f, prop: 0x8890a0, accent: 0x40c8ff, accent2: 0xff40a0,
    lamp: 0xffffff, fog: 0x12161f, fogNear: 12, fogFar: 64, sky: 0xb0bcd8, ground: 0x2a2e3a, hemi: 1.15,
    light: 0xf0f6ff, floorTex: 'tile3', wallTex: 'panel2', ceilTex: 'ceil', trimTex: 'trim', crateTex: 'crate2', hazard: 'electric',
    grade: { hi: 0xf4f8ff, sat: 1.05, contrast: 0.2, lift: 0.04, bloom: 0.8, thresh: 0.7 },
  },
  {
    id: 'orbital', name: 'ORBITAL FOUNDRY', // deep navy hull plating, gold work lights
    wall: 0x42547e, floor: 0x4e5672, trim: 0x182038, prop: 0x6a6040, accent: 0xffc840, accent2: 0xff4060,
    lamp: 0xfff0c0, fog: 0x04060f, fogNear: 10, fogFar: 62, sky: 0x5068b8, ground: 0x0c0e1c, hemi: 1.25,
    light: 0xc4d2ff, floorTex: 'plate', wallTex: 'panel2', ceilTex: 'ceil2', trimTex: 'trim', crateTex: 'crate2', grateTex: 'grate2', hazard: 'electric',
    grade: { hi: 0xfff2d0, sat: 1.12, contrast: 0.22, lift: 0.05, bloom: 1.0 },
  },
  {
    id: 'cryo', name: 'COLD STORAGE', // frosted panels in pale blue mist
    wall: 0x9ab4c8, floor: 0xa8bccc, trim: 0x2c3c4c, prop: 0x7a8c9a, accent: 0x9ff0ff, accent2: 0xff4060,
    lamp: 0xf0fbff, fog: 0x101c28, fogNear: 7, fogFar: 52, sky: 0xa8d0f0, ground: 0x1c2a3a, hemi: 1.1,
    light: 0xd4eeff, floorTex: 'tile2', wallTex: 'ice', ceilTex: 'ceil', trimTex: 'trim', crateTex: 'crate2', hazard: 'coolant',
    grade: { hi: 0xe8f6ff, sat: 0.92, contrast: 0.15, lift: 0.08, bloom: 0.9, thresh: 0.66 },
  },
  {
    id: 'slaughter', name: 'SLAUGHTERWORKS', // filthy glazed tile, wet floors, meat-red light
    wall: 0xa08c88, floor: 0x70544e, trim: 0x2c1414, prop: 0x7a5a50, accent: 0xff3030, accent2: 0xffd060,
    lamp: 0xffe4cc, fog: 0x1a0606, fogNear: 8, fogFar: 52, sky: 0xa87870, ground: 0x320808, hemi: 1.1,
    light: 0xffc0a8, floorTex: 'wet', wallTex: 'tile2', ceilTex: 'ceil2', trimTex: 'rust', crateTex: 'crate', hazard: 'molten',
    grade: { hi: 0xffe0d0, sat: 1.05, contrast: 0.24, lift: 0.06, bloom: 1.0 },
  },
  {
    id: 'choir', name: 'THE CHOIR', // cathedral ashlar, candle gold against violet glass
    wall: 0x8e7e9a, floor: 0x705e5a, trim: 0x2c1c26, prop: 0x6a4a3a, accent: 0xffd060, accent2: 0xa080ff,
    lamp: 0xfff0c8, fog: 0x140b1a, fogNear: 9, fogFar: 58, sky: 0xa484d8, ground: 0x3a2210, hemi: 1.2,
    light: 0xffd8a0, floorTex: 'flag', wallTex: 'stone', ceilTex: 'ceil2', trimTex: 'trim', crateTex: 'crate', hazard: 'electric',
    grade: { hi: 0xffe0b0, sat: 1.15, contrast: 0.22, lift: 0.08, bloom: 1.15 },
  },
  {
    id: 'core', name: 'THE CORE', // black halls, white light, cyan current
    wall: 0x52566a, floor: 0x3c404a, trim: 0x101216, prop: 0x5a5e6a, accent: 0x3ef0d0, accent2: 0xff3050,
    lamp: 0xf0ffff, fog: 0x030406, fogNear: 9, fogFar: 58, sky: 0x7a8aa4, ground: 0x08090c, hemi: 1.1,
    light: 0xd8fff6, floorTex: 'grate2', wallTex: 'panel2', ceilTex: 'ceil2', trimTex: 'trim', crateTex: 'crate2', hazard: 'electric',
    grade: { hi: 0xf0fffc, sat: 0.9, contrast: 0.28, lift: 0.03, bloom: 1.15, thresh: 0.6 },
  },
  {
    id: 'breach', name: 'THE BREACH', // plating overgrown with tissue, magenta rift light, teal bounce
    wall: 0x76426e, floor: 0x503e58, trim: 0x2c1032, prop: 0x5a2a4a, accent: 0xff3df0, accent2: 0x7affe0,
    lamp: 0xffc0f0, fog: 0x14041a, fogNear: 8, fogFar: 54, sky: 0xa04aa8, ground: 0x0a2422, hemi: 1.15,
    light: 0xff98e4, floorTex: 'concrete2', wallTex: 'flesh', ceilTex: 'ceil2', trimTex: 'rust', crateTex: 'crate2', concreteTex: 'concrete2', hazard: 'molten',
    grade: { hi: 0xffd8f4, sat: 1.18, contrast: 0.24, lift: 0.08, bloom: 1.2 },
  },
];

const matCache = new Map();

function lambert(tex, color, opts = {}) {
  const m = new THREE.MeshLambertMaterial({
    map: tex ? getTexture(tex) : null,
    color,
    vertexColors: true,
    ...opts,
  });
  return psxify(m);
}

export function themeMaterials(theme) {
  if (matCache.has(theme.id)) return matCache.get(theme.id);
  const m = {
    wall: lambert(theme.wallTex || 'panel', theme.wall),
    floor: lambert(theme.floorTex || 'tile', theme.floor),
    ceiling: lambert(theme.ceilTex || 'panel', new THREE.Color(theme.wall).multiplyScalar(0.45)),
    trim: lambert(theme.trimTex || 'gun', theme.trim),
    crate: lambert(theme.crateTex || 'crate', theme.prop),
    hazard: lambert('hazard', 0xffffff),
    grate: lambert(theme.grateTex || 'grate', theme.floor),
    vent: lambert('vent', theme.wall),
    concrete: lambert(theme.concreteTex || 'concrete', new THREE.Color(theme.floor).multiplyScalar(0.9)),
    rug: lambert('rug', 0xffffff),
    accent: new THREE.MeshBasicMaterial({ color: theme.accent, vertexColors: true }),
    accent2: new THREE.MeshBasicMaterial({ color: theme.accent2, vertexColors: true }),
    lamp: new THREE.MeshBasicMaterial({ color: theme.lamp, vertexColors: true }),
    screen: new THREE.MeshBasicMaterial({ map: getTexture('screen'), color: 0xffffff, vertexColors: true }),
    dark: new THREE.MeshBasicMaterial({ color: 0x050505, vertexColors: true }),
  };
  psxify(m.accent); psxify(m.accent2); psxify(m.lamp); psxify(m.screen);
  matCache.set(theme.id, m);
  return m;
}

// Shared misc materials
let shared = null;
export function sharedMaterials() {
  if (shared) return shared;
  shared = {
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    doorLocked: new THREE.MeshBasicMaterial({ color: 0xff2a3a }),
    doorOpen: new THREE.MeshBasicMaterial({ color: 0x3effa0 }),
    doorChoose: new THREE.MeshBasicMaterial({ color: 0x3ef0d0 }),
    door: psxify(new THREE.MeshLambertMaterial({ map: getTexture('hazard'), color: 0xb0b0b0 })),
    doorPanel: psxify(new THREE.MeshLambertMaterial({ map: getTexture('panel'), color: 0x5a5a66 })),
  };
  return shared;
}
