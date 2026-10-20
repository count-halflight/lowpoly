import * as THREE from 'three';
import { FACES, GeoBuilder } from './builder.js';
import { psxify } from '../render/renderer.js';

// Stratum dressing kits. Each piece stands against a side wall (k.side = -1 west, +1 east)
// and is built into the room's merged geometry. Tall pieces get colliders.
// w(x) maps a distance from the wall (0 = wall surface, positive = into the room) to local x.

export function buildKit(room, gb, M, k, rng) {
  const s = room.spec, H = s.H;
  const side = k.side;
  const wallX = side * s.W / 2;
  const w = (d) => wallX - side * d;
  const span = (d0, d1) => [Math.min(w(d0), w(d1)), Math.max(w(d0), w(d1))];
  const z = k.z;
  const col = (d0, y0, z0, d1, y1, z1, surface = 'metal') => {
    const [x0, x1] = span(d0, d1);
    room.addCollider(x0, y0, z0, x1, y1, z1, { surface, nav: true });
  };
  const box = (d0, y0, z0, d1, y1, z1, mat, opts) => { const [x0, x1] = span(d0, d1); gb.box(x0, y0, z0, x1, y1, z1, mat, opts); };
  const cyl = (d, y, zz, r, h, mat, opts) => gb.cylinder(w(d), y, zz, r, h, 'y', 8, mat, opts);
  const v = k.v;
  switch (k.kind) {
    case 'service': {
      if (v < 0.18) { // breaker panel bank with conduit up the wall
        box(0, 0.9, z - 1.0, 0.3, 2.5, z + 1.0, M.trim, { tint: 0.75 });
        for (let i = 0; i < 4; i++) box(0.3, 1.1 + i * 0.32, z - 0.85, 0.32, 1.3 + i * 0.32, z + 0.85, i % 2 ? M.vent : M.trim, { faces: side < 0 ? FACES.PX : FACES.NX, tint: 0.6 });
        box(0.3, 2.2, z + 0.5, 0.33, 2.32, z + 0.8, M.accent2, { faces: side < 0 ? FACES.PX : FACES.NX });
        box(0.05, 2.5, z - 0.08, 0.2, H, z + 0.08, M.trim, { tint: 0.5 });
        col(0, 0.9, z - 1.0, 0.3, 2.5, z + 1.0);
        break;
      }
      if (v < 0.3) { // mop sink + bucket + wet floor sign
        box(0, 0, z - 0.6, 0.7, 0.45, z + 0.6, M.trim, { tint: 0.9 });
        box(0.05, 0.45, z - 0.55, 0.65, 0.5, z + 0.55, M.dark, {});
        cyl(1.0, 0.2, z + 0.9, 0.22, 0.4, M.accent2, { tint: 0.6 });
        box(1.1, 0, z - 1.0, 1.15, 0.7, z - 0.6, M.hazard, { uvScale: 2 });
        col(0, 0, z - 0.6, 0.7, 0.45, z + 0.6);
        break;
      }
      if (v < 0.5) { // locker bank
        for (let i = 0; i < 3; i++) {
          const z0 = z - 0.95 + i * 0.64;
          box(0, 0, z0, 0.6, 2.1, z0 + 0.6, M.trim, { tint: 0.8 + (i % 2) * 0.15 });
          box(0.6, 1.7, z0 + 0.15, 0.62, 1.85, z0 + 0.45, M.vent, { faces: side < 0 ? FACES.PX : FACES.NX });
        }
        col(0, 0, z - 0.95, 0.6, 2.1, z + 0.97);
      } else if (v < 0.8) { // fuse box with status lamps
        box(0, 1.2, z - 0.6, 0.25, 2.3, z + 0.6, M.trim);
        for (let i = 0; i < 3; i++) box(0.25, 2.0 - i * 0.25, z - 0.4, 0.27, 2.08 - i * 0.25, z - 0.25, i === 0 ? M.accent2 : M.accent, { faces: side < 0 ? FACES.PX : FACES.NX });
        box(0.25, 1.35, z - 0.1, 0.32, 1.85, z + 0.4, M.hazard, { uvScale: 2 });
      } else { // valve stack
        cyl(0.3, 1.3, z, 0.28, 2.6, M.trim, { tint: 0.7 });
        gb.cylinder(w(0.62), 1.6, z, 0.3, 0.08, side < 0 ? 'x' : 'x', 8, M.accent2);
        col(0, 0, z - 0.3, 0.6, 2.6, z + 0.3);
      }
      break;
    }
    case 'foundry': {
      if (v < 0.2) { // mould press: heavy frame, glowing seam
        box(0, 0, z - 0.9, 1.3, 2.6, z - 0.6, M.trim, { tint: 0.6 });
        box(0, 0, z + 0.6, 1.3, 2.6, z + 0.9, M.trim, { tint: 0.6 });
        box(0, 2.3, z - 0.9, 1.3, 2.7, z + 0.9, M.trim, { tint: 0.7 });
        box(0.1, 0, z - 0.6, 1.2, 0.8, z + 0.6, M.trim, { tint: 0.45 });
        box(0.15, 0.8, z - 0.55, 1.15, 0.86, z + 0.55, M.accent, { faces: FACES.PY });
        col(0, 0, z - 0.9, 1.3, 2.7, z + 0.9);
        break;
      }
      if (v < 0.35) { // tool rack: tongs and ladles hanging on a bar
        box(0, 2.1, z - 1.1, 0.2, 2.2, z + 1.1, M.trim, {});
        for (let i = 0; i < 5; i++) box(0.12, 0.9 + (i % 2) * 0.3, z - 0.9 + i * 0.45, 0.17, 2.1, z - 0.86 + i * 0.45, M.trim, { tint: 0.5 });
        break;
      }
      if (v < 0.5) { // ingot stack
        for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - (l % 2); i++) {
          const z0 = z - 0.8 + i * 0.55 + (l % 2) * 0.27;
          box(0.1, l * 0.22, z0, 1.1, l * 0.22 + 0.2, z0 + 0.45, M.trim, { tint: 0.9 });
        }
        col(0, 0, z - 0.8, 1.1, 0.66, z + 0.85);
      } else { // slag bucket
        cyl(0.9, 0.55, z, 0.75, 1.1, M.trim, { tint: 0.6 });
        gb.cylinder(w(0.9), 1.11, z, 0.62, 0.02, 'y', 8, M.accent);
        col(0.15, 0, z - 0.7, 1.65, 1.1, z + 0.7);
      }
      break;
    }
    case 'cryo': {
      if (v < 0.25) { // coolant tank with frost rings and a gauge
        cyl(0.8, 1.3, z, 0.7, 2.6, M.trim, { tint: 0.9 });
        for (let i = 0; i < 3; i++) gb.cylinder(w(0.8), 0.5 + i * 0.8, z, 0.72, 0.12, 'y', 8, M.accent, { caps: false, tint: 0.6 });
        box(0.0, 1.6, z - 0.15, 0.1, 1.9, z + 0.15, M.screen, {});
        col(0.1, 0, z - 0.7, 1.5, 2.6, z + 0.7);
        break;
      }
      // sleeper pod: frosted capsule with a dark silhouette
      box(0, 0, z - 0.6, 0.9, 0.25, z + 0.6, M.trim);
      box(0, 2.3, z - 0.6, 0.9, 2.55, z + 0.6, M.trim);
      box(0.15, 0.25, z - 0.45, 0.75, 2.3, z + 0.45, M.accent, { tint: 0.35 });
      box(0.3, 0.4, z - 0.18, 0.6, 1.9, z + 0.18, M.dark, {});
      box(0.32, 1.9, z - 0.13, 0.58, 2.15, z + 0.13, M.dark, {});
      col(0, 0, z - 0.6, 0.9, 2.55, z + 0.6);
      if (v > 0.6) box(0.9, 0, z - 0.3, 1.3, 0.35, z + 0.2, M.accent, { tint: 0.5 });
      break;
    }
    case 'reactor': {
      if (v < 0.3) { // control desk with a slanted screen row and warning beacon
        box(0, 0, z - 1.0, 0.9, 0.95, z + 1.0, M.trim, { tint: 0.75 });
        box(0, 0.95, z - 1.0, 0.45, 1.5, z + 1.0, M.trim, { tint: 0.6 });
        box(0.45, 1.0, z - 0.9, 0.47, 1.45, z + 0.9, M.screen, { faces: side < 0 ? FACES.PX : FACES.NX });
        cyl(0.2, 1.65, z + 0.8, 0.12, 0.25, M.accent2);
        col(0, 0, z - 1.0, 0.9, 1.5, z + 1.0);
        break;
      }
      if (v < 0.5) { // spent cask, hazard banded
        cyl(0.7, 0.75, z, 0.6, 1.5, M.trim, { tint: 0.5 });
        gb.cylinder(w(0.7), 0.4, z, 0.62, 0.2, 'y', 8, M.hazard, { caps: false });
        gb.cylinder(w(0.7), 1.1, z, 0.62, 0.2, 'y', 8, M.hazard, { caps: false });
        gb.cylinder(w(0.7), 1.51, z, 0.35, 0.02, 'y', 8, M.accent);
        col(0.1, 0, z - 0.6, 1.3, 1.5, z + 0.6);
        break;
      }
      cyl(0.65, 0.8, z, 0.55, 1.6, M.trim, { tint: 0.85 });
      gb.cylinder(w(0.65), 1.0, z, 0.57, 0.25, 'y', 8, M.hazard, { caps: false });
      box(0, 2.2, z - 0.5, 0.18, 3.0, z + 0.5, M.screen, {});
      col(0.1, 0, z - 0.55, 1.2, 1.6, z + 0.55);
      break;
    }
    case 'archive': {
      if (v < 0.2) { // reading desk with a green lamp and a stack of files
        box(0, 0.75, z - 0.9, 0.8, 0.82, z + 0.9, M.crate, { tint: 0.6 });
        box(0.05, 0, z - 0.85, 0.15, 0.75, z - 0.75, M.trim, {}); box(0.05, 0, z + 0.75, 0.15, 0.75, z + 0.85, M.trim, {});
        box(0.65, 0, z - 0.85, 0.75, 0.75, z - 0.75, M.trim, {}); box(0.65, 0, z + 0.75, 0.75, 0.75, z + 0.85, M.trim, {});
        box(0.2, 0.82, z + 0.3, 0.45, 1.25, z + 0.35, M.trim, {});
        box(0.15, 1.2, z + 0.15, 0.5, 1.3, z + 0.5, M.accent, { tint: 0.8 });
        box(0.3, 0.82, z - 0.6, 0.6, 1.05, z - 0.2, M.rug, { tint: 1.3 });
        col(0, 0, z - 0.9, 0.8, 0.82, z + 0.9);
        break;
      }
      if (v < 0.6) { // server rack, blinking accent dots
        box(0, 0, z - 0.6, 0.9, 2.4, z + 0.6, M.dark, {});
        for (let r = 0; r < 7; r++) {
          const y = 0.3 + r * 0.3;
          box(0.9, y, z - 0.5, 0.92, y + 0.05, z - 0.5 + 0.12 + ((r * 7 + Math.floor(v * 30)) % 5) * 0.12, r % 3 === 0 ? M.accent2 : M.accent, { faces: side < 0 ? FACES.PX : FACES.NX });
        }
        col(0, 0, z - 0.6, 0.9, 2.4, z + 0.6);
      } else { // filing cabinets + paper stacks
        box(0, 0, z - 0.7, 0.7, 1.4, z, M.trim, { tint: 0.7 });
        box(0, 0, z + 0.05, 0.7, 1.4, z + 0.75, M.trim, { tint: 0.8 });
        box(0.8, 0, z - 0.3, 1.2, 0.3, z + 0.1, M.rug, { tint: 1.4 });
        col(0, 0, z - 0.7, 0.7, 1.4, z + 0.75);
      }
      break;
    }
    case 'slaughter': {
      if (v < 0.3) { // butcher block with cleavers + drain grate
        box(0.1, 0, z - 0.8, 1.1, 0.9, z + 0.8, M.crate, { tint: 0.5 });
        box(0.1, 0.9, z - 0.8, 1.1, 0.95, z + 0.8, M.accent2, { tint: 0.25, faces: FACES.PY });
        box(0.4, 0.95, z - 0.4, 0.45, 1.25, z - 0.1, M.trim, { tint: 1.2 });
        box(1.3, 0.005, z - 0.4, 2.1, 0.02, z + 0.4, M.grate, { faces: FACES.PY, tint: 0.6 });
        col(0.1, 0, z - 0.8, 1.1, 0.95, z + 0.8);
        break;
      }
      // hanging carcass on a chain + blood pool
      const d = 1.0;
      box(d - 0.03, 2.6, z - 0.03, d + 0.03, H, z + 0.03, M.trim, { tint: 0.5 });
      box(d - 0.3, 1.0, z - 0.22, d + 0.3, 2.6, z + 0.22, M.accent2, { tint: 0.45 });
      box(d - 0.22, 0.75, z - 0.15, d + 0.22, 1.0, z + 0.15, M.accent2, { tint: 0.3 });
      box(d - 0.7, 0.005, z - 0.6, d + 0.6, 0.02, z + 0.7, M.accent2, { faces: FACES.PY, tint: 0.2 });
      col(d - 0.3, 0.9, z - 0.22, d + 0.3, 2.6, z + 0.22, 'flesh');
      break;
    }
    case 'orbital': {
      if (v < 0.3) { // pressure suit locker with a helmet visor
        box(0, 0, z - 0.6, 0.6, 2.3, z + 0.6, M.trim, { tint: 0.8 });
        box(0.6, 1.6, z - 0.25, 0.62, 2.0, z + 0.25, M.accent, { faces: side < 0 ? FACES.PX : FACES.NX, tint: 0.9 });
        box(0.6, 0.3, z - 0.4, 0.62, 1.4, z + 0.4, M.hazard, { faces: side < 0 ? FACES.PX : FACES.NX, uvScale: 2 });
        col(0, 0, z - 0.6, 0.6, 2.3, z + 0.6);
        break;
      }
      // window onto the city far below: dark pane, lit specks, frame
      box(0, 1.0, z - 1.4, 0.05, 3.2, z + 1.4, M.dark, {});
      for (let i = 0; i < 9; i++) {
        const zz = z - 1.25 + ((i * 37 + Math.floor(v * 100)) % 25) / 10;
        const y = 1.1 + ((i * 53 + Math.floor(v * 77)) % 9) / 10;
        box(0.05, y, zz, 0.06, y + 0.04, zz + 0.04, i % 4 === 0 ? M.accent : M.lamp, { faces: side < 0 ? FACES.PX : FACES.NX });
      }
      box(0, 0.9, z - 1.5, 0.2, 1.0, z + 1.5, M.trim);
      box(0, 3.2, z - 1.5, 0.2, 3.3, z + 1.5, M.trim);
      box(0, 1.0, z - 0.04, 0.12, 3.2, z + 0.04, M.trim);
      break;
    }
    case 'choir': {
      if (v < 0.35) { // shrine: lectern, candle rack, a halo of light on the wall
        box(0.3, 0, z - 0.25, 0.8, 1.1, z + 0.25, M.crate, { tint: 0.5 });
        box(0.2, 1.1, z - 0.4, 0.9, 1.2, z + 0.4, M.crate, { tint: 0.6 });
        for (let i = 0; i < 5; i++) {
          gb.cylinder(w(1.3), 0.2 + (i % 2) * 0.1, z - 0.8 + i * 0.4, 0.05, 0.4 + (i % 2) * 0.2, 'y', 5, M.rug, { tint: 1.5 });
          gb.cylinder(w(1.3), 0.43 + (i % 2) * 0.2, z - 0.8 + i * 0.4, 0.03, 0.06, 'y', 4, M.lamp);
        }
        gb.cylinder(w(0.02), 2.6, z, 0.9, 0.04, 'x', 10, M.accent, { caps: false });
        col(0.2, 0, z - 0.4, 0.9, 1.2, z + 0.4);
        break;
      }
      // organ pipes of varying heights, candles at the base
      for (let i = 0; i < 5; i++) {
        const h = Math.min(H - 0.5, 2.5 + ((i * 3 + Math.floor(v * 10)) % 5) * 0.7 + (i === 2 ? 1.2 : 0));
        gb.cylinder(w(0.4), h / 2, z - 0.9 + i * 0.45, 0.18, h, 'y', 6, M.trim, { tint: 1.1 });
        gb.cylinder(w(0.4), h - 0.3, z - 0.9 + i * 0.45, 0.19, 0.1, 'y', 6, M.accent, { caps: false });
      }
      col(0.1, 0, z - 1.1, 0.7, H - 0.5, z + 1.1);
      for (let i = 0; i < 3; i++) {
        gb.cylinder(w(1.0), 0.15, z - 0.6 + i * 0.6, 0.05, 0.3, 'y', 5, M.rug, { tint: 1.5 });
        gb.cylinder(w(1.0), 0.33, z - 0.6 + i * 0.6, 0.03, 0.06, 'y', 4, M.lamp);
      }
      break;
    }
    case 'breach': {
      if (v < 0.3) { // flesh-machine growth: a pulsing sac fused to conduit
        cyl(0.6, 0.6, z, 0.55, 1.2, M.accent2, { tint: 0.35 });
        cyl(0.6, 1.4, z, 0.4, 0.5, M.accent2, { tint: 0.5 });
        box(0.0, 0.2, z - 0.1, 0.9, 0.35, z + 0.1, M.trim, { tint: 0.5 });
        box(0.4, 1.0, z - 0.6, 0.45, 1.05, z + 0.6, M.accent, { tint: 0.8 });
        col(0.1, 0, z - 0.55, 1.15, 1.65, z + 0.55, 'flesh');
        break;
      }
      // crystal growth: jagged stacked shards with glow
      const n = 4 + Math.floor(v * 3);
      for (let i = 0; i < n; i++) {
        const d = 0.2 + (i % 3) * 0.3, zz = z - 0.8 + i * 0.35, h = 0.8 + ((i * 7) % 5) * 0.4;
        box(d, 0, zz - 0.14, d + 0.28, h, zz + 0.14, i % 2 ? M.accent2 : M.accent, { tint: 0.6 + (i % 3) * 0.2 });
        box(d + 0.05, h, zz - 0.08, d + 0.23, h + 0.3, zz + 0.08, M.accent2, { tint: 0.9 });
      }
      col(0.1, 0, z - 1.0, 1.1, 1.8, z + 0.6, 'energy');
      break;
    }
    case 'core': {
      if (v < 0.35) { // data pylon: stacked glowing rings on a black core
        cyl(0.6, 1.5, z, 0.35, 3.0, M.dark, {});
        for (let i = 0; i < 4; i++) gb.cylinder(w(0.6), 0.6 + i * 0.7, z, 0.45, 0.06, 'y', 8, M.lamp, { caps: false });
        col(0.2, 0, z - 0.4, 1.0, 3.0, z + 0.4);
        break;
      }
      // black monolith with a white seam
      box(0, 0, z - 0.7, 0.8, Math.min(H - 0.2, 4.2), z + 0.7, M.dark, {});
      box(0.8, 0.2, z - 0.03, 0.82, Math.min(H - 0.4, 4.0), z + 0.03, M.lamp, { faces: side < 0 ? FACES.PX : FACES.NX });
      col(0, 0, z - 0.7, 0.8, Math.min(H - 0.2, 4.2), z + 0.7);
      break;
    }
    default: break;
  }
}

// Spray-paint graffiti texture (canvas) for wall decals.
export function graffitiCanvas(text, seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  const palettes = ['#ff3050', '#3ef0d0', '#ffd23a', '#f0f0f0', '#c060ff', '#ff8a1a'];
  const col = palettes[seed % palettes.length];
  ctx.clearRect(0, 0, 256, 96);
  let size = 40;
  ctx.font = `700 ${size}px "Libre Caslon Condensed", Impact, serif`;
  while (ctx.measureText(text).width > 236 && size > 14) { size -= 2; ctx.font = `700 ${size}px "Libre Caslon Condensed", Impact, serif`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // overspray
  ctx.globalAlpha = 0.25; ctx.fillStyle = col;
  ctx.shadowColor = col; ctx.shadowBlur = 8;
  ctx.fillText(text, 128, 46);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.fillText(text, 128, 46);
  // drips
  let r = seed * 9301 + 49297;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  const tw = Math.min(236, ctx.measureText(text).width);
  for (let i = 0; i < 6; i++) {
    const x = 128 - tw / 2 + rnd() * tw, y = 46 + size * 0.3, len = 6 + rnd() * 22;
    ctx.fillRect(x, y, 2, len);
    ctx.fillRect(x - 0.5, y + len, 3, 3);
  }
  // pixelate: draw down then up
  const small = document.createElement('canvas');
  small.width = 128; small.height = 48;
  const sx = small.getContext('2d');
  sx.drawImage(c, 0, 0, 128, 48);
  ctx.clearRect(0, 0, 256, 96);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, 256, 96);
  return c;
}

// Terminal screen texture
export function terminalCanvas(read) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#031208'; ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = read ? '#2a6040' : '#5aff9a';
  ctx.font = '10px VT323, monospace';
  ctx.fillText('> LOG', 4, 12);
  for (let i = 0; i < 4; i++) ctx.fillRect(4, 18 + i * 6, 20 + ((i * 17) % 34), 2);
  if (!read) ctx.fillRect(4, 42, 6, 3);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Ceiling dressing: ducts, cable trays, chains, rails, ribs. Visual only (no colliders), kept
// above head height and away from the lamps.
// ---------------------------------------------------------------------------------------------
export function buildCeiling(room, gb, M, kit, rng) {
  const s = room.spec, { W, D, H } = s;
  const lamps = s.lightSpots;
  const clearOf = (x, z, r = 1.4) => !lamps.some((l) => Math.abs(l.x - x) < 0.9 + r && Math.abs(l.z - z) < 0.45 + r) &&
    !(s.crushers || []).some((c) => Math.abs(c.x - x) < c.w / 2 + 1.2 && Math.abs(c.z - z) < c.d / 2 + 1.2) &&
    !(s.anchors || []).some((a) => Math.hypot(a.x - x, a.z - z) < 1.6);
  const low = Math.max(3.4, H - 2.2); // lowest point anything may hang to
  const chain = (x, z, y0, y1) => { for (let y = y1; y > y0 + 0.01; y -= 0.3) gb.box(x - 0.04, Math.max(y0, y - 0.22), z - 0.04, x + 0.04, y, z + 0.04, M.trim, { tint: 0.45 + ((y * 7) % 1) * 0.2 }); };
  const cable = (x, zA, zB, sag, mat, tint = 0.5) => {
    const n = 6, y0 = H - 0.25;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, za = zA + (zB - zA) * t0, zb = zA + (zB - zA) * t1;
      const ya = y0 - sag * 4 * t0 * (1 - t0), yb = y0 - sag * 4 * t1 * (1 - t1);
      gb.box(x - 0.05, Math.min(ya, yb) - 0.05, Math.min(za, zb), x + 0.05, Math.max(ya, yb), Math.max(za, zb), mat, { tint });
    }
  };
  const along = (fn, step) => { for (let z = -D / 2 + step / 2; z < D / 2 - 1; z += step) fn(z); };
  switch (kit) {
    case 'service': {
      // rectangular duct with hangers + a cable tray
      const dx = rng.sign() * W * 0.22;
      gb.box(dx - 0.6, H - 1.0, -D / 2, dx + 0.6, H - 0.4, D / 2, M.vent, { tint: 0.75 });
      along((z) => { gb.box(dx - 0.65, H - 1.05, z, dx + 0.65, H - 0.95, z + 0.08, M.trim, { tint: 0.6 }); gb.box(dx - 0.62, H - 0.4, z, dx - 0.56, H, z + 0.06, M.trim); }, 3);
      const tx = -dx * 0.8;
      gb.box(tx - 0.4, H - 0.55, -D / 2, tx + 0.4, H - 0.5, D / 2, M.grate, { tint: 0.8 });
      for (let k = 0; k < 3; k++) gb.box(tx - 0.3 + k * 0.22, H - 0.5, -D / 2, tx - 0.22 + k * 0.22, H - 0.42, D / 2, k === 1 ? M.accent2 : M.trim, { tint: 0.6 });
      for (let i = 0; i < 3; i++) { const x = rng.range(-W / 2 + 2, W / 2 - 2); cable(x, -D / 2 + rng.range(2, 6), D / 2 - rng.range(2, 6), rng.range(0.4, 1.0), M.trim, 0.35); }
      break;
    }
    case 'foundry': {
      // crane rails across the room, hooks on chains
      along((z) => {
        gb.box(-W / 2, H - 0.7, z - 0.18, W / 2, H - 0.5, z + 0.18, M.trim, { tint: 0.65 });
        gb.box(-W / 2, H - 0.5, z - 0.06, W / 2, H, z + 0.06, M.trim, { tint: 0.5 });
        gb.box(-W / 2, H - 0.75, z - 0.2, W / 2, H - 0.7, z + 0.2, M.hazard, { uvScale: 2, faces: FACES.NY | FACES.PZ | FACES.NZ });
        if (rng.chance(0.7)) {
          const x = rng.range(-W / 2 + 3, W / 2 - 3);
          if (clearOf(x, z)) { chain(x, z, low + 0.4, H - 0.7); gb.box(x - 0.25, low, z - 0.08, x + 0.25, low + 0.4, z + 0.08, M.trim, { tint: 0.7 }); gb.box(x - 0.25, low - 0.15, z - 0.08, x - 0.12, low + 0.1, z + 0.08, M.trim, { tint: 0.7 }); }
        }
      }, 8);
      break;
    }
    case 'cryo': {
      // frosted pipe pairs with icicles
      for (const px of [-W * 0.3, W * 0.3]) {
        gb.cylinder(px, H - 0.6, 0, 0.25, D, 'z', 6, M.trim, { tint: 0.9 });
        gb.cylinder(px + 0.6, H - 0.5, 0, 0.18, D, 'z', 6, M.accent, { tint: 0.45 });
        along((z) => { if (rng.chance(0.6)) for (let k = 0; k < 3; k++) { const l = rng.range(0.2, 0.7); gb.box(px - 0.2 + k * 0.18, H - 0.85 - l, z + k * 0.3 - 0.03, px - 0.16 + k * 0.18, H - 0.85, z + k * 0.3 + 0.03, M.accent, { tint: 0.75 }); } }, 2.2);
      }
      break;
    }
    case 'reactor': {
      // fat coolant mains with glowing collars
      const px = rng.sign() * W * 0.25;
      gb.cylinder(px, H - 0.9, 0, 0.5, D, 'z', 8, M.trim, { tint: 0.8 });
      along((z) => { gb.cylinder(px, H - 0.9, z, 0.55, 0.25, 'z', 8, M.accent, { caps: false }); gb.box(px - 0.06, H - 0.4, z - 0.06, px + 0.06, H, z + 0.06, M.trim); }, 4);
      gb.cylinder(-px * 0.6, H - 0.5, 0, 0.2, D, 'z', 6, M.accent2, { tint: 0.5 });
      break;
    }
    case 'archive': {
      // cable trays crossing the room with colored bundles, hanging status displays
      along((z) => {
        gb.box(-W / 2, H - 0.45, z - 0.35, W / 2, H - 0.4, z + 0.35, M.grate, { tint: 0.7, faces: 63 });
        for (let k = 0; k < 4; k++) gb.box(-W / 2, H - 0.4, z - 0.28 + k * 0.15, W / 2, H - 0.33, z - 0.2 + k * 0.15, k % 2 ? M.accent : M.accent2, { tint: 0.45 });
      }, 6);
      for (let i = 0; i < 3; i++) {
        const x = rng.range(-W / 2 + 3, W / 2 - 3), z = rng.range(-D / 2 + 4, D / 2 - 4);
        if (!clearOf(x, z)) continue;
        chain(x, z, low + 0.7, H);
        gb.box(x - 0.7, low, z - 0.08, x + 0.7, low + 0.7, z + 0.08, M.trim, { tint: 0.6 });
        gb.box(x - 0.6, low + 0.08, z + 0.08, x + 0.6, low + 0.62, z + 0.1, M.screen, { faces: FACES.PZ });
        gb.box(x - 0.6, low + 0.08, z - 0.1, x + 0.6, low + 0.62, z - 0.08, M.screen, { faces: FACES.NZ });
      }
      break;
    }
    case 'slaughter': {
      // overhead hook line with chains, some still loaded
      for (const rx of [-W * 0.22, W * 0.22]) {
        gb.box(rx - 0.08, H - 0.6, -D / 2, rx + 0.08, H - 0.45, D / 2, M.trim, { tint: 0.6 });
        along((z) => {
          gb.box(rx - 0.03, H - 0.45, z - 0.03, rx + 0.03, H, z + 0.03, M.trim, { tint: 0.4 });
          const hz = z + 1.1;
          if (!clearOf(rx, hz, 0.8)) return;
          const loaded = rng.chance(0.35) && H >= 7;
          const bot = loaded ? Math.max(low, H - 3.4) : low + 0.6;
          chain(rx, hz, bot + (loaded ? 1.5 : 0.25), H - 0.6);
          gb.box(rx - 0.03, bot, hz - 0.15, rx + 0.03, bot + 0.25, hz + 0.15, M.trim, { tint: 0.8 });
          if (loaded) { gb.box(rx - 0.28, bot - 0.1, hz - 0.2, rx + 0.28, bot + 1.5, hz + 0.2, M.accent2, { tint: 0.4 }); gb.box(rx - 0.2, bot - 0.35, hz - 0.14, rx + 0.2, bot - 0.1, hz + 0.14, M.accent2, { tint: 0.28 }); }
        }, 3.2);
      }
      break;
    }
    case 'orbital': {
      // truss beams: chords + diagonal web
      along((z) => {
        const y0 = H - 1.2, y1 = H - 0.15;
        gb.box(-W / 2, y1 - 0.12, z - 0.12, W / 2, y1, z + 0.12, M.trim, { tint: 0.7 });
        gb.box(-W / 2, y0, z - 0.12, W / 2, y0 + 0.12, z + 0.12, M.trim, { tint: 0.7 });
        for (let x = -W / 2 + 1; x < W / 2 - 0.5; x += 1.2) gb.box(x - 0.05, y0, z - 0.05, x + 0.05, y1, z + 0.05, M.trim, { tint: 0.55 });
        gb.box(-W / 2, y0 - 0.02, z - 0.13, W / 2, y0, z + 0.13, M.accent, { faces: FACES.NY, tint: 0.6 });
      }, 5);
      break;
    }
    case 'choir': {
      // chandeliers (hoops of candles) on long chains, censers
      for (let i = 0; i < Math.max(1, Math.round(D / 14)); i++) {
        const x = rng.range(-W / 4, W / 4), z = -D / 2 + (i + 0.5) * D / Math.max(1, Math.round(D / 14));
        if (!clearOf(x, z, 1.8)) continue;
        const y = Math.max(low, H - 3);
        chain(x, z, y + 0.2, H);
        gb.cylinder(x, y + 0.1, z, 1.1, 0.12, 'y', 10, M.trim, { caps: false, tint: 0.9 });
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; gb.box(x + Math.cos(a) * 1.1 - 0.04, y + 0.16, z + Math.sin(a) * 1.1 - 0.04, x + Math.cos(a) * 1.1 + 0.04, y + 0.36, z + Math.sin(a) * 1.1 + 0.04, M.lamp); }
      }
      break;
    }
    case 'breach': {
      // crystal stalactites and glowing veins across the ceiling
      for (let i = 0; i < Math.round(W * D / 70); i++) {
        const x = rng.range(-W / 2 + 1, W / 2 - 1), z = rng.range(-D / 2 + 1, D / 2 - 1);
        if (!clearOf(x, z, 0.6)) continue;
        const l = rng.range(0.5, Math.min(2.2, H - low + 1));
        gb.box(x - 0.18, H - l, z - 0.18, x + 0.18, H, z + 0.18, rng.chance(0.5) ? M.accent : M.accent2, { tint: rng.range(0.5, 0.9) });
        gb.box(x - 0.08, H - l - 0.3, z - 0.08, x + 0.08, H - l, z + 0.08, M.accent2, { tint: 0.9 });
      }
      let x = rng.range(-W / 4, W / 4);
      for (let z = -D / 2 + 1; z < D / 2 - 1; z += 1.2) { const nx = x + rng.range(-0.8, 0.8); gb.box(Math.min(x, nx) - 0.06, H - 0.03, z, Math.max(x, nx) + 0.06, H, z + 1.2, M.accent, { faces: FACES.NY }); x = nx; }
      break;
    }
    case 'core': {
      // black ribs spanning the room with light strips between them
      along((z) => {
        gb.box(-W / 2, H - 0.8, z - 0.3, W / 2, H, z + 0.3, M.dark, {});
        gb.box(-W / 2 + 0.4, H - 0.82, z - 0.04, W / 2 - 0.4, H - 0.8, z + 0.04, M.lamp, { faces: FACES.NY });
      }, 5);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------------------------
// Signage: one shared atlas texture, signs are quads in the room's merged geometry.
// ---------------------------------------------------------------------------------------------
const SIGNS = [
  ['DECK 04', '#1a3a7a', '#ffffff'], ['NO ENTRY', '#c01020', '#ffffff'], ['HIGH VOLTAGE', '#ffd020', '#101010'], ['KEEP CLEAR', '#ffd020', '#101010'],
  ['MIND THE GAP', '#ffd020', '#101010'], ['SERVICE LIFT', '#1a3a7a', '#ffffff'], ['SHIFT 3 ONLY', '#2a2a30', '#3ef0d0'], ['WET FLOOR', '#ffd020', '#101010'],
  ['POUR ZONE', '#ff7010', '#101010'], ['HEAT KILLS', '#c01020', '#ffffff'], ['SLAG LINE B', '#2a2a30', '#ff8a1a'], ['GOGGLES ON', '#1a3a7a', '#ffffff'],
  ['KEEP FROZEN', '#9ff0ff', '#102030'], ['SLEEPERS', '#203040', '#9ff0ff'], ['-40 C', '#203040', '#ffffff'], ['DO NOT THAW', '#c01020', '#ffffff'],
  ['RADIATION', '#ffd020', '#101010'], ['CORE ACCESS', '#203020', '#6aff5a'], ['SCRAM', '#c01020', '#ffffff'], ['DOSIMETER', '#203020', '#ffe23a'],
  ['SILENCE', '#e8e8f0', '#202030'], ['RECORDS 7-A', '#e8e8f0', '#202030'], ['REDACTED', '#101010', '#ffffff'], ['SPECIMENS', '#203048', '#40c8ff'],
  ['RENDERING', '#601010', '#ffd060'], ['HOOK LINE', '#2a1414', '#ff3030'], ['HOSE DOWN', '#2a1414', '#ffffff'], ['NO WASTE', '#601010', '#ffffff'],
  ['TETHER 01', '#1a2038', '#ffc840'], ['VACUUM', '#c01020', '#ffffff'], ['AIRLOCK', '#1a2038', '#ffffff'], ['SUITS ON', '#ffc840', '#101010'],
  ['SING', '#2a1a2a', '#ffd060'], ['HYMN 404', '#2a1a2a', '#a080ff'], ['KNEEL', '#2a1a2a', '#ffffff'], ['GLORY', '#ffd060', '#2a1a2a'],
  ['DO NOT LOOK', '#2a1030', '#ff3df0'], ['IT HEARS', '#101010', '#7affe0'], ['QUARANTINE', '#ffd020', '#101010'], ['GO BACK', '#2a1030', '#ffffff'],
  ['ARCHITECT', '#050505', '#f0ffff'], ['OBEY', '#050505', '#ff3050'], ['ALL IS GRID', '#050505', '#3ef0d0'], ['NO EXIT', '#050505', '#ffffff'],
];
const SIGN_SET = { service: [0, 1, 2, 3, 5, 6, 7], foundry: [3, 8, 9, 10, 11, 1], cryo: [12, 13, 14, 15, 3], reactor: [16, 17, 18, 19, 2], archive: [20, 21, 22, 23, 1], slaughter: [24, 25, 26, 27, 7], orbital: [28, 29, 30, 31, 4], choir: [32, 33, 34, 35], breach: [36, 37, 38, 39, 1], core: [40, 41, 42, 43] };
const SIGN_ROWS = 24, SIGN_COLS = 2;
let signMat = null;
function signMaterial() {
  if (signMat) return signMat;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 768;
  const x = c.getContext('2d');
  SIGNS.forEach(([text, bg, fg], i) => {
    const cx = (i % SIGN_COLS) * 128, cy = Math.floor(i / SIGN_COLS) * 32;
    x.fillStyle = bg; x.fillRect(cx, cy, 128, 32);
    x.strokeStyle = fg; x.lineWidth = 2; x.strokeRect(cx + 3, cy + 3, 122, 26);
    let size = 20;
    x.font = `700 ${size}px "Libre Caslon Condensed", Impact, serif`;
    while (x.measureText(text).width > 112 && size > 9) { size--; x.font = `700 ${size}px "Libre Caslon Condensed", Impact, serif`; }
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, cx + 64, cy + 17);
    // grime
    for (let k = 0; k < 18; k++) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(cx + ((k * 37 + i * 11) % 124), cy + ((k * 13 + i * 7) % 30), 2 + (k % 3), 1); }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  signMat = psxify(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true })); // same program as screens
  return signMat;
}
function signUV(i) {
  const u0 = (i % SIGN_COLS) / SIGN_COLS, row = Math.floor(i / SIGN_COLS);
  return [u0, 1 - (row + 1) / SIGN_ROWS, u0 + 1 / SIGN_COLS, 1 - row / SIGN_ROWS];
}
// a sign on a wall: side -1 west, 1 east, 'n' north, 's' south
function wallSign(gb, idx, side, at, y, hw = 0.9, hh = 0.225, inset = 0) {
  const s = gb.signRoom.spec, m = signMaterial();
  const [u0, v0, u1, v1] = signUV(idx);
  const y0 = y - hh, y1 = y + hh;
  if (side === -1) { const x = -s.W / 2 + 0.03 + inset; gb.quadUV(m, [x, y0, at + hw], [x, y0, at - hw], [x, y1, at - hw], [x, y1, at + hw], [1, 0, 0], u0, v0, u1, v1); }
  else if (side === 1) { const x = s.W / 2 - 0.03 - inset; gb.quadUV(m, [x, y0, at - hw], [x, y0, at + hw], [x, y1, at + hw], [x, y1, at - hw], [-1, 0, 0], u0, v0, u1, v1); }
  else if (side === 'n') { const z = -s.D / 2 + 0.03 + inset; gb.quadUV(m, [at - hw, y0, z], [at + hw, y0, z], [at + hw, y1, z], [at - hw, y1, z], [0, 0, 1], u0, v0, u1, v1); }
  else { const z = s.D / 2 - 0.03 - inset; gb.quadUV(m, [at + hw, y0, z], [at - hw, y0, z], [at - hw, y1, z], [at + hw, y1, z], [0, 0, -1], u0, v0, u1, v1); }
}
export function buildSigns(room, gb, kit, rng) {
  const s = room.spec, set = SIGN_SET[kit];
  if (!set) return;
  gb.signRoom = room;
  const gaps = room.sideGaps || { '-1': [], '1': [] };
  const n = s.open ? 2 : Math.min(4, 1 + Math.round(s.D / 14));
  for (let i = 0; i < n; i++) {
    const idx = set[rng.int(0, set.length - 1)];
    if (s.open) {
      // on the stair towers, beside the doors
      const end = i % 2 ? 'n' : 's';
      const doors = end === 'n' ? s.exits : [s.entX];
      let at = rng.range(-s.W / 2 + 2, s.W / 2 - 2);
      if (doors.some((d) => Math.abs(d - at) < 2.6)) at = doors[0] + (at > doors[0] ? 3 : -3);
      wallSign(gb, idx, end, at, 4.6, 1.2, 0.3);
      continue;
    }
    const side = rng.sign(), z = rng.range(-s.D / 2 + 3, s.D / 2 - 3);
    if (gaps[side].some(([g0, g1]) => z > g0 - 1.4 && z < g1 + 1.4)) continue;
    wallSign(gb, idx, side, z, Math.min(s.H - 1.2, rng.range(2.9, 3.4)));
  }
  // exit wall: a stencil above each door frame
  if (!s.open && s.H >= 6.5) for (const ex of s.exits) wallSign(gb, set[0], 'n', ex, 4.5, 0.8, 0.2);
}

// ---------------------------------------------------------------------------------------------
// Stratum signature set pieces: one big, readable landmark per room.
// ---------------------------------------------------------------------------------------------
export function buildSetPiece(room, gb, M, kit, rng) {
  const s = room.spec, { W, D, H } = s;
  const cz = rng.range(-D / 6, D / 6), cx = 0;
  const free = (x, z, r) => !s.lightSpots.some((l) => Math.hypot(l.x - x, l.z - z) < r) && !(s.anchors || []).some((a) => Math.hypot(a.x - x, a.z - z) < r) &&
    !(s.crushers || []).some((c) => Math.abs(c.x - x) < c.w / 2 + r && Math.abs(c.z - z) < c.d / 2 + r) && !(s.movers || []).some((m) => m.kind === 'plat' && Math.abs(m.x - x) < r + Math.abs(m.ax) + 2);
  const northWall = (fn) => fn(-D / 2 + 0.02);
  switch (kit) {
    case 'service': { // giant ceiling fan housing
      if (!free(cx, cz, 3.2) || H < 6) return;
      const y = H - 0.05, r = 2.6;
      gb.cylinder(cx, y - 0.3, cz, r + 0.3, 0.6, 'y', 12, M.trim, { tint: 0.6, caps: false });
      gb.cylinder(cx, y - 0.02, cz, r, 0.04, 'y', 12, M.dark, {});
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const ex = Math.cos(a) * r * 0.9, ez = Math.sin(a) * r * 0.9;
        gb.box(cx + Math.min(0, ex) - 0.25, y - 0.45, cz + Math.min(0, ez) - 0.25, cx + Math.max(0, ex) + 0.25, y - 0.38, cz + Math.max(0, ez) + 0.25, M.trim, { tint: 0.8 });
      }
      gb.cylinder(cx, y - 0.5, cz, 0.45, 0.3, 'y', 8, M.accent, { tint: 0.7 });
      break;
    }
    case 'foundry': { // hanging crucible ladle, slag glowing inside
      if (!free(cx, cz, 3.5) || H < 7) return;
      const y = H - 3.6;
      gb.cylinder(cx, y, cz, 1.6, 1.8, 'y', 10, M.trim, { tint: 0.55 });
      gb.cylinder(cx, y - 1.05, cz, 1.2, 0.3, 'y', 10, M.trim, { tint: 0.45 });
      gb.cylinder(cx, y + 0.91, cz, 1.4, 0.03, 'y', 10, M.accent, {});
      gb.cylinder(cx, y + 0.95, cz, 1.7, 0.12, 'y', 10, M.hazard, { caps: false });
      for (const sx of [-1, 1]) {
        gb.box(cx + sx * 1.75 - 0.1, y, cz - 0.1, cx + sx * 1.75 + 0.1, y + 1.6, cz + 0.1, M.trim, { tint: 0.6 });
        for (let yy = H; yy > y + 1.6; yy -= 0.35) gb.box(cx + sx * 1.75 - 0.05, yy - 0.25, cz - 0.05, cx + sx * 1.75 + 0.05, yy, cz + 0.05, M.trim, { tint: 0.4 });
      }
      gb.box(cx - 1.9, y + 1.5, cz - 0.12, cx + 1.9, y + 1.7, cz + 0.12, M.trim, { tint: 0.6 });
      break;
    }
    case 'cryo': { // frost manifold across the exit wall
      if (H < 6.5) return;
      northWall((z) => {
        const y = H - 1.7;
        gb.cylinder(0, y, z + 0.8, 0.7, W - 2, 'x', 8, M.trim, { tint: 0.85 });
        for (let x = -W / 2 + 2; x < W / 2 - 1.5; x += 2.4) { gb.cylinder(x, y, z + 0.8, 0.74, 0.2, 'x', 8, M.accent, { caps: false, tint: 0.7 }); for (let k = 0; k < 3; k++) gb.box(x + k * 0.25 - 0.03, y - 1.1 + k * 0.2, z + 0.6, x + k * 0.25 + 0.03, y - 0.65, z + 0.66, M.accent, { tint: 0.8 }); }
      });
      break;
    }
    case 'reactor': { // ring of glowing fuel rods hanging over the floor
      if (!free(cx, cz, 3.2) || H < 7) return;
      const y = H - 3.2;
      gb.cylinder(cx, H - 0.6, cz, 2.6, 0.4, 'y', 12, M.trim, { tint: 0.6, caps: false });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, x = cx + Math.cos(a) * 2.2, z = cz + Math.sin(a) * 2.2;
        gb.cylinder(x, y + 1.2, z, 0.16, 2.6, 'y', 6, M.trim, { tint: 0.7 });
        gb.cylinder(x, y, z, 0.2, 0.5, 'y', 6, M.accent, {});
      }
      break;
    }
    case 'archive': { // a giant card-catalogue drum
      if (!free(cx, cz, 3.2) || H < 6.5) return;
      const y = H - 2.0;
      gb.cylinder(cx, y, cz, 1.3, Math.min(8, W * 0.4), 'x', 10, M.trim, { tint: 0.75 });
      for (let x = -Math.min(4, W * 0.2) + 0.5; x < Math.min(4, W * 0.2) - 0.3; x += 0.8) gb.cylinder(cx + x, y, cz, 1.33, 0.06, 'x', 10, M.accent, { caps: false, tint: 0.6 });
      for (const sx of [-1, 1]) { const ex = cx + sx * (Math.min(4, W * 0.2) + 0.2); gb.box(ex - 0.15, y - 0.2, cz - 0.2, ex + 0.15, H, cz + 0.2, M.trim, { tint: 0.5 }); }
      break;
    }
    case 'slaughter': { // a carousel of hooks circling over the floor
      if (!free(cx, cz, 3.5) || H < 7) return;
      gb.cylinder(cx, H - 0.8, cz, 3.0, 0.2, 'y', 12, M.trim, { tint: 0.55, caps: false });
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, x = cx + Math.cos(a) * 3, z = cz + Math.sin(a) * 3;
        const bot = H - (k % 3 === 0 ? 3.6 : 1.8);
        gb.box(x - 0.03, bot, z - 0.03, x + 0.03, H - 0.8, z + 0.03, M.trim, { tint: 0.4 });
        if (k % 3 === 0) gb.box(x - 0.25, bot - 1.2, z - 0.2, x + 0.25, bot + 0.2, z + 0.2, M.accent2, { tint: 0.38 });
      }
      break;
    }
    case 'orbital': { // the planet, through a long window above the exits
      if (H < 7.5) return;
      northWall((z) => {
        const y0 = 4.6, y1 = H - 0.8, hw = Math.min(W / 2 - 1.5, 9);
        gb.box(-hw, y0, z, hw, y1, z + 0.02, M.dark, { faces: FACES.PZ });
        let r = 9;
        for (let i = 0; i < 30; i++) { r = (r * 9301 + 49297) % 233280; const x = -hw + (r / 233280) * hw * 2; r = (r * 9301 + 49297) % 233280; const y = y0 + (r / 233280) * (y1 - y0); gb.box(x, y, z + 0.02, x + 0.06, y + 0.06, z + 0.03, M.lamp, { faces: FACES.PZ }); }
        // planet limb: stacked bands of an arc rising from the window sill
        for (let k = 0; k < 8; k++) {
          const yy = y0 + k * 0.32, half = Math.sqrt(Math.max(0, 14 * 14 - (14 - k * 0.32 - 0.5) ** 2));
          gb.box(Math.max(-hw, -half), yy, z + 0.03, Math.min(hw, half), yy + 0.32, z + 0.04, k < 2 ? M.accent2 : M.accent, { faces: FACES.PZ, tint: 0.35 + k * 0.06 });
        }
        for (let x = -hw; x <= hw + 0.01; x += hw / 3) gb.box(x - 0.12, y0, z, x + 0.12, y1, z + 0.12, M.trim, {});
        gb.box(-hw - 0.2, y0 - 0.2, z, hw + 0.2, y0, z + 0.25, M.trim, {});
        gb.box(-hw - 0.2, y1, z, hw + 0.2, y1 + 0.2, z + 0.25, M.trim, {});
      });
      break;
    }
    case 'choir': { // rose window over the exits
      if (H < 7.5) return;
      northWall((z) => buildRose(gb, M, 0, H - 3.2, z, Math.min(2.8, (H - 5) / 2)));
      break;
    }
    case 'breach': { // the rift: a jagged glowing tear across the ceiling, dripping shards
      let x = rng.range(-W / 4, W / 4);
      for (let z = -D / 2 + 2; z < D / 2 - 2; z += 0.9) {
        const nx = x + rng.range(-1.2, 1.2), w = rng.range(0.3, 0.8);
        gb.box(Math.min(x, nx) - w, H - 0.06, z, Math.max(x, nx) + w, H - 0.01, z + 0.9, M.accent2, { faces: FACES.NY });
        if (rng.chance(0.3)) gb.box(nx - 0.1, H - rng.range(0.8, 2.2), z + 0.3, nx + 0.1, H, z + 0.5, M.accent, { tint: 0.9 });
        x = Math.max(-W / 2 + 2, Math.min(W / 2 - 2, nx));
      }
      break;
    }
    case 'core': { // a white halo hanging in the dark
      if (!free(cx, cz, 4) || H < 7) return;
      const y = H - 2.4;
      gb.cylinder(cx, y, cz, 3.2, 0.25, 'y', 16, M.lamp, { caps: false });
      gb.cylinder(cx, y, cz, 3.0, 0.15, 'y', 16, M.dark, { caps: false });
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; gb.box(cx + Math.cos(a) * 3.1 - 0.02, y, cz + Math.sin(a) * 3.1 - 0.02, cx + Math.cos(a) * 3.1 + 0.02, H, cz + Math.sin(a) * 3.1 + 0.02, M.trim); }
      break;
    }
    default: break;
  }
}

function buildRose(gb, M, x, y, z, r) {
  gb.cylinder(x, y, z + 0.06, r + 0.25, 0.12, 'z', 16, M.trim, { tint: 0.8 });
  gb.cylinder(x, y, z + 0.08, r, 0.04, 'z', 16, M.dark, {});
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r * 0.62, py = y + Math.sin(a) * r * 0.62;
    gb.cylinder(px, py, z + 0.1, r * 0.26, 0.03, 'z', 6, k % 2 ? M.accent : M.accent2, { tint: 0.8 });
    gb.box(x + Math.min(0, Math.cos(a) * r) - 0.04, y + Math.min(0, Math.sin(a) * r) - 0.04, z + 0.12, x + Math.max(0, Math.cos(a) * r) + 0.04, y + Math.max(0, Math.sin(a) * r) + 0.04, z + 0.14, M.trim, { tint: 0.6 });
  }
  gb.cylinder(x, y, z + 0.12, r * 0.22, 0.04, 'z', 8, M.lamp, {});
}

// ---------------------------------------------------------------------------------------------
// Archetype decor pieces referenced from room specs.
// ---------------------------------------------------------------------------------------------
export function buildDecor(room, gb, M, d, rng) {
  const s = room.spec, H = s.H;
  switch (d.type) {
    case 'drain': {
      gb.box(d.x - 0.5, 0, d.z - 0.5, d.x + 0.5, 0.012, d.z + 0.5, M.trim, { faces: FACES.PY, tint: 0.6 });
      gb.box(d.x - 0.42, 0.012, d.z - 0.42, d.x + 0.42, 0.016, d.z + 0.42, M.grate, { faces: FACES.PY, tint: 0.5 });
      break;
    }
    case 'waterTower': {
      const y = 3.6;
      gb.box(d.x - 1.9, y, d.z - 1.9, d.x + 1.9, y + 0.2, d.z + 1.9, M.trim, { tint: 0.6 });
      gb.cylinder(d.x, y + 1.7, d.z, 1.7, 3.0, 'y', 10, M.crate, { tint: 0.7 });
      for (let k = 0; k < 4; k++) gb.cylinder(d.x, y + 0.6 + k * 0.7, d.z, 1.74, 0.08, 'y', 10, M.trim, { caps: false, tint: 0.5 });
      gb.cylinder(d.x, y + 3.5, d.z, 1.2, 0.6, 'y', 10, M.trim, { tint: 0.6 });
      gb.cylinder(d.x, y + 3.95, d.z, 0.3, 0.3, 'y', 6, M.trim, { tint: 0.5 });
      room.addCollider(d.x - 1.9, y, d.z - 1.9, d.x + 1.9, y + 3.8, d.z + 1.9, { surface: 'wood', nav: false });
      break;
    }
    case 'mast': {
      gb.box(d.x - 0.12, 0, d.z - 0.12, d.x + 0.12, 9, d.z + 0.12, M.trim, { tint: 0.6 });
      for (let y = 1; y < 9; y += 1.5) gb.box(d.x - 0.5, y, d.z - 0.04, d.x + 0.5, y + 0.06, d.z + 0.04, M.trim, { tint: 0.5 });
      gb.box(d.x - 0.15, 9, d.z - 0.15, d.x + 0.15, 9.3, d.z + 0.15, M.accent2, {});
      room.addCollider(d.x - 0.15, 0, d.z - 0.15, d.x + 0.15, 9, d.z + 0.15, { surface: 'metal', nav: true });
      break;
    }
    case 'billboard': {
      // a lit advertisement on legs, facing into the roof
      const x = d.x, sd = d.side, y0 = 2.4, y1 = 5.6;
      gb.box(x - sd * 0.1 - 0.1, 0, d.z - 2.8, x - sd * 0.1 + 0.1, y0, d.z - 2.6, M.trim, { tint: 0.5 });
      gb.box(x - sd * 0.1 - 0.1, 0, d.z + 2.6, x - sd * 0.1 + 0.1, y0, d.z + 2.8, M.trim, { tint: 0.5 });
      gb.box(x - 0.15, y0, d.z - 3.2, x + 0.15, y1, d.z + 3.2, M.trim, { tint: 0.6 });
      const fx = x - sd * 0.16;
      gb.box(Math.min(fx, fx - sd * 0.02), y0 + 0.2, d.z - 3, Math.max(fx, fx - sd * 0.02), y1 - 0.2, d.z + 3, M.accent2, { faces: sd > 0 ? FACES.NX : FACES.PX, tint: 0.55 });
      gb.box(Math.min(fx, fx - sd * 0.03), y0 + 0.6, d.z - 2.6, Math.max(fx, fx - sd * 0.03), y0 + 1.2, d.z + 1.2, M.lamp, { faces: sd > 0 ? FACES.NX : FACES.PX });
      gb.box(Math.min(fx, fx - sd * 0.03), y0 + 1.6, d.z - 2.6, Math.max(fx, fx - sd * 0.03), y0 + 2.6, d.z - 0.4, M.accent, { faces: sd > 0 ? FACES.NX : FACES.PX });
      room.addCollider(x - 0.25, 0, d.z - 2.85, x + 0.25, y0, d.z - 2.55, { surface: 'metal', nav: true });
      room.addCollider(x - 0.25, 0, d.z + 2.55, x + 0.25, y0, d.z + 2.85, { surface: 'metal', nav: true });
      break;
    }
    case 'catenary': {
      const y = Math.min(H - 0.6, 5.6);
      gb.box(d.x0, y, d.z - 0.03, d.x1, y + 0.04, d.z + 0.03, M.trim, { tint: 0.4 });
      for (let x = d.x0 + 4; x < d.x1 - 2; x += 8) gb.box(x - 0.02, y, d.z - 0.02, x + 0.02, H, d.z + 0.02, M.trim, { tint: 0.4 });
      break;
    }
    case 'coldAisle': {
      for (let z = d.z0; z < d.z1 - 0.5; z += 1.2) gb.box(d.x - 0.55, 0, z, d.x + 0.55, 0.01, z + 1.1, M.vent, { faces: FACES.PY, tint: 0.7 });
      break;
    }
    case 'altar': {
      gb.box(d.x - 1.4, 0.8, d.z - 0.6, d.x + 1.4, 1.8, d.z + 0.6, M.trim, { tint: 0.7 });
      gb.box(d.x - 1.5, 1.8, d.z - 0.7, d.x + 1.5, 1.9, d.z + 0.7, M.accent, { tint: 0.6 });
      for (let k = -2; k <= 2; k++) { gb.cylinder(d.x + k * 0.55, 2.05, d.z, 0.05, 0.3, 'y', 5, M.rug, { tint: 1.4 }); gb.cylinder(d.x + k * 0.55, 2.24, d.z, 0.03, 0.07, 'y', 4, M.lamp); }
      room.addCollider(d.x - 1.4, 0.8, d.z - 0.6, d.x + 1.4, 1.9, d.z + 0.6, { surface: 'concrete', nav: false });
      break;
    }
    case 'rose': buildRose(gb, M, d.x, d.y, d.z, Math.min(2.8, (H - 5) / 2)); break;
    case 'banner': {
      const len = Math.min(4, H - 6);
      gb.box(d.x - 1.6, H - 0.2, d.z - 0.05, d.x + 1.6, H - 0.1, d.z + 0.05, M.trim, { tint: 0.6 });
      gb.box(d.x - 1.3, H - 0.2 - len, d.z - 0.02, d.x + 1.3, H - 0.2, d.z + 0.02, M.accent2, { tint: 0.5 });
      gb.box(d.x - 0.3, H - 0.2 - len * 0.6, d.z - 0.03, d.x + 0.3, H - 0.2 - len * 0.3, d.z + 0.03, M.accent, { tint: 0.9 });
      break;
    }
    case 'shrine': {
      // dais with a lit rim
      gb.cylinder(d.x, 0.1, d.z, 2.5, 0.2, 'y', 12, M.trim, { tint: 0.75 });
      gb.cylinder(d.x, 0.19, d.z, 2.53, 0.05, 'y', 12, M.accent, { caps: false, tint: 0.8 });
      gb.cylinder(d.x, 0.205, d.z, 2.1, 0.01, 'y', 12, M.dark, { tint: 0.7 });
      // conduits: floor strips from each wall to the dais, rising up the walls and back across the ceiling
      const W2 = s.W / 2, D2 = s.D / 2, y = 0.012, w = 0.16;
      const legs = [[-W2 + 0.15, d.x - 2.5, 'x'], [d.x + 2.5, W2 - 0.15, 'x']];
      for (const [a, b] of legs) {
        gb.box(a, 0, d.z - w, b, y, d.z + w, M.trim, { faces: FACES.PY, tint: 0.5 });
        gb.box(a, y, d.z - w * 0.4, b, y + 0.004, d.z + w * 0.4, M.accent, { faces: FACES.PY, tint: 0.7 });
      }
      for (const sx of [-1, 1]) {
        const wx = sx * (W2 - 0.04);
        gb.box(Math.min(wx, wx - sx * 0.06), 0, d.z - w * 0.5, Math.max(wx, wx - sx * 0.06), H, d.z + w * 0.5, M.accent, { faces: sx > 0 ? FACES.NX : FACES.PX, tint: 0.65 });
        gb.box(Math.min(sx * W2, d.x + sx * 1.7), H - 0.08, d.z - w, Math.max(sx * W2, d.x + sx * 1.7), H, d.z + w, M.trim, { faces: FACES.NY, tint: 0.5 });
        gb.box(Math.min(sx * W2, d.x + sx * 1.7), H - 0.1, d.z - w * 0.4, Math.max(sx * W2, d.x + sx * 1.7), H - 0.08, d.z + w * 0.4, M.accent, { faces: FACES.NY, tint: 0.8 });
      }
      // a run toward the exit wall too, so the eye follows it onward
      gb.box(d.x - w, 0, -D2 + 0.2, d.x + w, y, d.z - 2.5, M.trim, { faces: FACES.PY, tint: 0.5 });
      gb.box(d.x - w * 0.4, y, -D2 + 0.2, d.x + w * 0.4, y + 0.004, d.z - 2.5, M.accent, { faces: FACES.PY, tint: 0.7 });
      // halo over the beacon on four rods
      gb.cylinder(d.x, H - 0.75, d.z, 1.7, 0.16, 'y', 12, M.trim, { caps: false, tint: 0.7 });
      gb.cylinder(d.x, H - 0.85, d.z, 1.62, 0.05, 'y', 12, M.lamp, { caps: false });
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, rx = d.x + Math.cos(a) * 1.7, rz = d.z + Math.sin(a) * 1.7; gb.box(rx - 0.03, H - 0.75, rz - 0.03, rx + 0.03, H, rz + 0.03, M.trim, { tint: 0.5 }); }
      gb.cylinder(d.x, H - 0.05, d.z, 2.1, 0.1, 'y', 12, M.trim, { tint: 0.6 });
      break;
    }
    case 'pump': {
      gb.cylinder(d.x, 2.7, d.z, 1.1, 0.2, 'y', 8, M.accent, { caps: false, tint: 0.7 });
      gb.cylinder(d.x + 1.4, 1.4, d.z, 0.2, 2.6, 'y', 6, M.trim, { tint: 0.7 });
      gb.box(d.x + 0.9, 2.5, d.z - 0.15, d.x + 1.5, 2.7, d.z + 0.15, M.trim, { tint: 0.6 });
      gb.cylinder(d.x, 3.0, d.z, 0.5, 0.6, 'y', 8, M.trim, { tint: 0.6 });
      break;
    }
    default: break;
  }
  void rng;
}

// ---------------------------------------------------------------------------------------------
// Small per-prop details for the new archetypes (catwalk edges, girders, AC units, pews ...).
// ---------------------------------------------------------------------------------------------
export function propDetail(gb, M, p) {
  const { x0, y0, z0, x1, y1, z1 } = p;
  if (p.catwalk) {
    gb.box(x0, y1, z0, x1, y1 + 0.04, z1, M.grate, { faces: FACES.PY, tint: 1.15 });
    const along = x1 - x0 > z1 - z0;
    if (along) {
      gb.box(x0, y1, z0, x1, y1 + 0.14, z0 + 0.06, M.accent, { faces: 63 & ~FACES.NY, tint: 0.7 });
      gb.box(x0, y1, z1 - 0.06, x1, y1 + 0.14, z1, M.accent, { faces: 63 & ~FACES.NY, tint: 0.7 });
      for (let x = x0 + 1; x < x1 - 0.5; x += 2) gb.box(x - 0.06, y0 - 0.25, z0, x + 0.06, y0, z1, M.trim, { tint: 0.5 });
    } else {
      gb.box(x0, y1, z0, x0 + 0.06, y1 + 0.14, z1, M.accent, { faces: 63 & ~FACES.NY, tint: 0.7 });
      gb.box(x1 - 0.06, y1, z0, x1, y1 + 0.14, z1, M.accent, { faces: 63 & ~FACES.NY, tint: 0.7 });
      for (let z = z0 + 1; z < z1 - 0.5; z += 2) gb.box(x0, y0 - 0.25, z - 0.06, x1, y0, z + 0.06, M.trim, { tint: 0.5 });
    }
  } else if (p.girder) {
    const along = x1 - x0 > z1 - z0;
    // I-beam: web + bottom flange below the walkable top, striped ends
    if (along) { gb.box(x0, y0 - 0.5, (z0 + z1) / 2 - 0.08, x1, y0, (z0 + z1) / 2 + 0.08, M.trim, { tint: 0.6 }); gb.box(x0, y0 - 0.65, z0 + 0.1, x1, y0 - 0.5, z1 - 0.1, M.trim, { tint: 0.7 }); }
    else { gb.box((x0 + x1) / 2 - 0.08, y0 - 0.5, z0, (x0 + x1) / 2 + 0.08, y0, z1, M.trim, { tint: 0.6 }); gb.box(x0 + 0.1, y0 - 0.65, z0, x1 - 0.1, y0 - 0.5, z1, M.trim, { tint: 0.7 }); }
    gb.box(x0, y1, z0, x1, y1 + 0.015, z1, M.hazard, { faces: FACES.PY, uvScale: 1.5 });
  } else if (p.ac) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    gb.cylinder(cx, y1 + 0.02, cz, Math.min(x1 - x0, z1 - z0) * 0.38, 0.04, 'y', 8, M.vent, { tint: 0.8 });
    gb.cylinder(cx, y1 + 0.05, cz, 0.12, 0.04, 'y', 6, M.trim, {});
    for (let y = y0 + 0.2; y < y1 - 0.2; y += 0.18) gb.box(x0 - 0.01, y, z0 + 0.1, x0, y + 0.06, z1 - 0.1, M.trim, { faces: FACES.NX, tint: 0.5 });
  } else if (p.pew) {
    const back = z1 + 0.0;
    gb.box(x0, y1, back - 0.08, x1, y1 + 0.5, back, M.crate, { tint: 0.5 });
    gb.box(x0, y1 + 0.5, back - 0.1, x1, y1 + 0.56, back + 0.02, M.crate, { tint: 0.65 });
  } else if (p.terrace) {
    // painted edge stripes so the tiers read from below
    gb.box(x0, y1 - 0.12, z0 - 0.01, x1, y1 - 0.04, z0, M.accent, { faces: FACES.NZ, tint: 0.6 });
    gb.box(x0, y1 - 0.12, z1, x1, y1 - 0.04, z1 + 0.01, M.accent, { faces: FACES.PZ, tint: 0.6 });
    gb.box(x0 - 0.01, y1 - 0.12, z0, x0, y1 - 0.04, z1, M.accent, { faces: FACES.NX, tint: 0.6 });
    gb.box(x1, y1 - 0.12, z0, x1 + 0.01, y1 - 0.04, z1, M.accent, { faces: FACES.PX, tint: 0.6 });
  } else if (p.island) {
    gb.box(x0, y1 + 0.08, z0, x1, y1 + 0.09, z0 + 0.25, M.hazard, { faces: FACES.PY, uvScale: 2 });
    gb.box(x0, y1 + 0.08, z1 - 0.25, x1, y1 + 0.09, z1, M.hazard, { faces: FACES.PY, uvScale: 2 });
  } else if (p.canopy) {
    gb.box(x0 + 0.4, y0 - 0.02, (z0 + z1) / 2 - 0.15, x1 - 0.4, y0, (z0 + z1) / 2 + 0.15, M.lamp, { faces: FACES.NY });
  } else if (p.runwall) {
    // lit chevrons on the face that points into the room, a lamp strip along the top
    const sd = p.side || 1, fx = sd > 0 ? x1 : x0, f = sd > 0 ? FACES.PX : FACES.NX, o = sd > 0 ? 0.02 : -0.02;
    const xa = Math.min(fx, fx + o), xb = Math.max(fx, fx + o), ym = (y0 + y1) / 2;
    gb.box(xa, y0 + 0.4, z0 + 0.3, xb, y1 - 0.4, z1 - 0.3, M.accent2, { faces: f, tint: 0.35 });
    for (let z = z0 + 1; z < z1 - 1; z += 1.6) {
      gb.box(xa - o, ym - 0.05, z, xb - o, ym + 0.75, z + 0.3, M.accent, { faces: f, tint: 0.9 });
      gb.box(xa - o, ym - 0.8, z, xb - o, ym, z + 0.3, M.accent, { faces: f, tint: 0.9 });
    }
    gb.box(Math.min(fx, fx + o * 3), y1 - 0.18, z0, Math.max(fx, fx + o * 3), y1 - 0.06, z1, M.lamp, { faces: f });
    gb.box(Math.min(fx, fx + o * 3), y0, z0, Math.max(fx, fx + o * 3), y0 + 0.25, z1, M.hazard, { faces: f, uvScale: 2 });
  } else if (p.lampPost) {
    // a lantern cap on a bollard
    gb.box(x0 + 0.06, y1, z0 + 0.06, x1 - 0.06, y1 + 0.26, z1 - 0.06, M.lamp, { tint: 0.85, faces: 63 & ~FACES.NY });
    gb.box(x0 - 0.04, y1 + 0.26, z0 - 0.04, x1 + 0.04, y1 + 0.34, z1 + 0.04, M.trim, { tint: 0.6 });
    gb.box(x0 - 0.02, y1 - 0.18, z0 - 0.02, x1 + 0.02, y1 - 0.1, z1 + 0.02, M.accent, { faces: 63 & ~FACES.PY & ~FACES.NY, tint: 0.7 });
  } else if (p.step) {
    // nosing stripe on the riser
    gb.box(x0, y1 - 0.05, z0 - 0.005, x1, y1, z1 + 0.005, M.hazard, { faces: FACES.PY, uvScale: 3 });
  }
}

// ---------------------------------------------------------------------------------------------
// Open-sky rooms: a skyline beyond the parapets, stars and a moon overhead.
// ---------------------------------------------------------------------------------------------
let sky = null;
export function skyRes() {
  if (sky) return sky;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#000000'; x.fillRect(0, 0, 128, 128);
  let r = 11;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 0; i < 90; i++) { const b = 120 + Math.floor(rnd() * 135); x.fillStyle = `rgb(${b},${b},${Math.min(255, b + 30)})`; x.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1, 1); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 4);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  const starGeo = new THREE.PlaneGeometry(320, 320);
  starGeo.rotateX(Math.PI / 2);
  // stars, moon and halo share one shader program (map, no fog)
  const wc = document.createElement('canvas'); wc.width = wc.height = 2;
  const wx = wc.getContext('2d'); wx.fillStyle = '#ffffff'; wx.fillRect(0, 0, 2, 2);
  const white = new THREE.CanvasTexture(wc);
  sky = {
    starGeo, starMat: new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }),
    moonGeo: new THREE.CircleGeometry(7, 12), moonMat: new THREE.MeshBasicMaterial({ map: white, color: 0xe8ecff, fog: false }),
    haloGeo: new THREE.CircleGeometry(11, 12), haloMat: new THREE.MeshBasicMaterial({ map: white, color: 0x2a3050, fog: false, transparent: true, opacity: 0.5, depthWrite: false }),
  };
  return sky;
}

export function buildSkyline(room, M, rng) {
  const s = room.spec, { W, D } = s;
  const gb = new GeoBuilder(4);
  for (const side of [-1, 1]) {
    for (const [d0, d1, h0, h1] of [[6, 16, -14, 4], [20, 34, -6, 16], [38, 56, 4, 30]]) {
      let z = -D / 2;
      while (z < D / 2 - 2) {
        const dz = Math.min(D / 2 - z, rng.range(6, 12)), dx = rng.range(6, 12);
        const near = side * (W / 2 + rng.range(d0, d1));
        const xA = Math.min(near, near + side * dx), xB = Math.max(near, near + side * dx);
        const top = rng.range(h0, h1);
        gb.box(xA, -60, z, xB, top, z + dz - 1.2, M.trim, { tint: rng.range(0.18, 0.32), faces: 63 & ~FACES.NY });
        // windows on the face toward the room
        const fx = side > 0 ? xA : xB, f = side > 0 ? FACES.NX : FACES.PX;
        const neon = rng.chance(0.3);
        for (let y = top - 2; y > Math.max(-24, top - 40); y -= 2.2) {
          for (let wz = z + 0.6; wz < z + dz - 2; wz += 1.5) {
            if (rng.next() < 0.55) continue;
            gb.box(fx - (side > 0 ? 0.02 : 0), y, wz, fx + (side > 0 ? 0 : 0.02), y + 0.9, wz + 0.7, rng.chance(0.12) ? M.accent : M.lamp, { faces: f, tint: rng.range(0.35, 0.8) });
          }
        }
        if (neon) gb.box(fx - (side > 0 ? 0.04 : 0), top - 3.5, z + 1, fx + (side > 0 ? 0 : 0.04), top - 1.5, z + Math.min(dz - 2, 5), rng.chance(0.5) ? M.accent2 : M.accent, { faces: f, tint: 0.8 });
        if (rng.chance(0.4)) gb.box((xA + xB) / 2 - 0.1, top, z + dz / 2 - 0.1, (xA + xB) / 2 + 0.1, top + rng.range(3, 8), z + dz / 2 + 0.1, M.trim, { tint: 0.3 });
        z += dz;
      }
    }
  }
  const built = gb.build();
  const R = skyRes();
  const stars = new THREE.Mesh(R.starGeo, R.starMat);
  stars.position.set(0, 80, 0);
  const side = rng.sign();
  const moon = new THREE.Mesh(R.moonGeo, R.moonMat);
  moon.position.set(side * 70, 55, -60);
  moon.lookAt(0, 0, 0);
  const halo = new THREE.Mesh(R.haloGeo, R.haloMat);
  halo.position.copy(moon.position).multiplyScalar(1.01);
  halo.lookAt(0, 0, 0);
  stars.renderOrder = -2; halo.renderOrder = -1;
  built.group.add(stars, moon, halo);
  return { group: built.group, geos: built.geos };
}
