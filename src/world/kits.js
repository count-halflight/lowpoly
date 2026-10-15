import { FACES } from './builder.js';

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
      cyl(0.65, 0.8, z, 0.55, 1.6, M.trim, { tint: 0.85 });
      gb.cylinder(w(0.65), 1.0, z, 0.57, 0.25, 'y', 8, M.hazard, { caps: false });
      box(0, 2.2, z - 0.5, 0.18, 3.0, z + 0.5, M.screen, {});
      col(0.1, 0, z - 0.55, 1.2, 1.6, z + 0.55);
      break;
    }
    case 'archive': {
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
