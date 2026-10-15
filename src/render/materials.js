import * as THREE from 'three';
import { getTexture } from './textures.js';
import { psxify } from './renderer.js';

// Regional art direction. Each region has its own palette, fog and lighting mood.
export const THEMES = [
  {
    id: 'service', name: 'SERVICE DECKS',
    wall: 0x6a6c9c, floor: 0x7b7f9a, trim: 0x3d3f55, prop: 0x8a6a4a, accent: 0x3ef0d0, accent2: 0xff3050,
    lamp: 0xf4f0e0, fog: 0x0a0a14, fogNear: 10, fogFar: 62, sky: 0x6670a8, ground: 0x241c2c, hemi: 1.25,
    light: 0xd8d8ff, floorTex: 'tile', wallTex: 'panel', hazard: 'electric',
  },
  {
    id: 'foundry', name: 'THE FOUNDRY',
    wall: 0x8a5a40, floor: 0x6e625a, trim: 0x3a2a22, prop: 0x7a7066, accent: 0xff8a1a, accent2: 0xff3020,
    lamp: 0xffd8a0, fog: 0x140806, fogNear: 10, fogFar: 58, sky: 0xa06a4a, ground: 0x2a1408, hemi: 1.2,
    light: 0xffb070, floorTex: 'concrete', wallTex: 'panel', hazard: 'molten',
  },
  {
    id: 'reactor', name: 'REACTOR COMPLEX',
    wall: 0x5a7a72, floor: 0x5a6a62, trim: 0x22302c, prop: 0x6a7a5a, accent: 0x6aff5a, accent2: 0xffe23a,
    lamp: 0xe0ffe8, fog: 0x06100c, fogNear: 10, fogFar: 60, sky: 0x60907a, ground: 0x0c2018, hemi: 1.2,
    light: 0xb0ffd0, floorTex: 'grate', wallTex: 'panel', hazard: 'coolant',
  },
  {
    id: 'research', name: 'RESEARCH WING',
    wall: 0xb4b8c4, floor: 0xa8acb6, trim: 0x4a4e5a, prop: 0x8890a0, accent: 0x40c8ff, accent2: 0xff40a0,
    lamp: 0xffffff, fog: 0x10141c, fogNear: 12, fogFar: 64, sky: 0x9aa4c0, ground: 0x2a2e3a, hemi: 1.15,
    light: 0xe8f4ff, floorTex: 'tile', wallTex: 'panel', hazard: 'electric',
  },
  {
    id: 'orbital', name: 'ORBITAL FOUNDRY',
    wall: 0x40507a, floor: 0x4a5270, trim: 0x1a2038, prop: 0x6a6040, accent: 0xffc840, accent2: 0xff4060,
    lamp: 0xfff0c0, fog: 0x04060e, fogNear: 10, fogFar: 60, sky: 0x4a5a9a, ground: 0x0a0c1a, hemi: 1.25,
    light: 0xc0d0ff, floorTex: 'grate', wallTex: 'panel', hazard: 'electric',
  },
  {
    id: 'cryo', name: 'COLD STORAGE',
    wall: 0x8aa8bc, floor: 0x9ab0c0, trim: 0x2a3440, prop: 0x7a8a96, accent: 0x9ff0ff, accent2: 0xff4060,
    lamp: 0xe8f8ff, fog: 0x0a121a, fogNear: 9, fogFar: 56, sky: 0x8ab0d0, ground: 0x1a2430, hemi: 1.15,
    light: 0xd8f0ff, floorTex: 'tile', wallTex: 'panel', hazard: 'coolant',
  },
  {
    id: 'slaughter', name: 'SLAUGHTERWORKS',
    wall: 0x8a5a58, floor: 0x6a5450, trim: 0x2a1414, prop: 0x7a5a50, accent: 0xff3030, accent2: 0xffd060,
    lamp: 0xffd8c8, fog: 0x140606, fogNear: 9, fogFar: 54, sky: 0xa06060, ground: 0x2a0a0a, hemi: 1.15,
    light: 0xffb0a0, floorTex: 'tile', wallTex: 'panel', hazard: 'molten',
  },
  {
    id: 'choir', name: 'THE CHOIR',
    wall: 0x7a6a8a, floor: 0x6a5a5a, trim: 0x2a1a2a, prop: 0x6a4a3a, accent: 0xffd060, accent2: 0xa080ff,
    lamp: 0xfff0c8, fog: 0x0e0a12, fogNear: 10, fogFar: 60, sky: 0x9a80a8, ground: 0x1a1018, hemi: 1.15,
    light: 0xffe0b0, floorTex: 'tile', wallTex: 'panel', hazard: 'electric',
  },
  {
    id: 'core', name: 'THE CORE',
    wall: 0x50545e, floor: 0x3a3e48, trim: 0x101216, prop: 0x5a5e6a, accent: 0x3ef0d0, accent2: 0xff3050,
    lamp: 0xf0ffff, fog: 0x030406, fogNear: 9, fogFar: 58, sky: 0x6a7a90, ground: 0x08090c, hemi: 1.1,
    light: 0xc8fff4, floorTex: 'grate', wallTex: 'panel', hazard: 'electric',
  },
  {
    id: 'breach', name: 'THE BREACH',
    wall: 0x6a3a6a, floor: 0x4a3a52, trim: 0x2a1030, prop: 0x5a2a4a, accent: 0xff3df0, accent2: 0x7affe0,
    lamp: 0xffc0f0, fog: 0x0e040e, fogNear: 8, fogFar: 54, sky: 0x8a4a8a, ground: 0x1a061a, hemi: 1.2,
    light: 0xff90e0, floorTex: 'concrete', wallTex: 'panel', hazard: 'molten',
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
    wall: lambert(theme.wallTex, theme.wall),
    floor: lambert(theme.floorTex, theme.floor),
    ceiling: lambert('panel', new THREE.Color(theme.wall).multiplyScalar(0.45)),
    trim: lambert('gun', theme.trim),
    crate: lambert('crate', theme.prop),
    hazard: lambert('hazard', 0xffffff),
    grate: lambert('grate', theme.floor),
    vent: lambert('vent', theme.wall),
    concrete: lambert('concrete', new THREE.Color(theme.floor).multiplyScalar(0.9)),
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
