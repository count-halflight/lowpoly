import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Tiny procedural textures (64x64 pixel art, nearest filtered) for the gritty retro look.
// Mostly grayscale so each stratum tints them through material colour + vertex colour; rust,
// soot and frost carry a faint hue of their own. Builder UVs are world-scaled: one tile = 2 m.
// Variants per kind (panel/panel2/panel3/brick/stone/ice/flesh, tile/tile2/tile3/wet/flag,
// concrete/concrete2, grate/grate2/plate, trim/rust, crate/crate2, ceil/ceil2) are picked per
// stratum in materials.js.

const cache = new Map();
const S = 64;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 1;
  t.needsUpdate = true;
  return t;
}

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function noise(ctx, size, rng, amount) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = clamp8(d[i] + n);
    d[i + 1] = clamp8(d[i + 1] + n);
    d[i + 2] = clamp8(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

// soft value noise (tiles seamlessly): broad grime/wear variation instead of per-pixel static
function mottle(ctx, size, rng, amount, cell = 8) {
  const n = size / cell;
  const g = [];
  for (let i = 0; i < n * n; i++) g.push(rng.next() - 0.5);
  const at = (x, y) => g[((y + n) % n) * n + ((x + n) % n)];
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    const i = (y * size + x) * 4, k = v * amount;
    d[i] = clamp8(d[i] + k); d[i + 1] = clamp8(d[i + 1] + k); d[i + 2] = clamp8(d[i + 2] + k);
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, size, rng, count, alpha, dark = true) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size, y = rng.next() * size, r = 2 + rng.next() * 8;
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha * rng.next()})` : `rgba(255,255,255,${alpha * rng.next()})`;
    // draw wrapped copies so blotches tile across the seams
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// raised plate edge: light top/left, dark bottom/right
function bevel(ctx, x, y, w, h, hi = 196, lo = 70) {
  ctx.fillStyle = gray(hi); ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = gray(lo); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
}

function bolt(ctx, x, y) {
  ctx.fillStyle = gray(58); ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = gray(200); ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = gray(36); ctx.fillRect(x + 1, y + 2, 1, 1);
}

// rust / water streaks running down from a point, fading out
function streak(ctx, rng, x, y, len, rust = true) {
  for (let i = 0; i < len; i++) {
    const a = 0.28 * (1 - i / len);
    ctx.fillStyle = rust ? rgba(92, 46, 18, a) : rgba(0, 0, 0, a * 0.8);
    ctx.fillRect(x + (rng.next() < 0.12 ? (rng.next() < 0.5 ? -1 : 1) : 0), (y + i) % S, 1 + (i < len * 0.3 ? 1 : 0), 1);
  }
}

function crack(ctx, rng, x, y, steps, a = 0.55) {
  ctx.fillStyle = `rgba(20,20,20,${a})`;
  let dx = rng.next() < 0.5 ? 1 : -1, dy = rng.next() < 0.5 ? 1 : -1;
  for (let i = 0; i < steps; i++) {
    ctx.fillRect(((x % S) + S) % S, ((y % S) + S) % S, 1, 1);
    if (rng.next() < 0.6) x += dx; else y += dy;
    if (rng.next() < 0.15) dx = -dx;
    if (rng.next() < 0.1 && i > 4) crack(ctx, rng, x, y, (steps - i) >> 1, a * 0.7);
  }
}

// chipped paint along an edge
function wear(ctx, rng, x, y, w, h, n, v = 210) {
  ctx.fillStyle = gray(v);
  for (let i = 0; i < n; i++) ctx.fillRect(x + Math.floor(rng.next() * w), y + Math.floor(rng.next() * h), 1, 1);
}

// 3x5 stencil glyphs (rows of 3-bit masks) for little panel numbers/labels
const GLYPH = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 3, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], R: [6, 5, 6, 5, 5], V: [5, 5, 5, 5, 2], X: [5, 5, 2, 5, 5],
};
function stencil(ctx, text, x, y, v = 40, a = 0.75) {
  ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
  for (const ch of text) {
    const rows = GLYPH[ch];
    if (rows) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (rows[j] & (4 >> i)) ctx.fillRect(x + i, y + j, 1, 1);
    x += 4;
  }
}

const generators = {
  // ------------------------------------------------------------------ walls
  panel(ctx, s, rng) { // riveted service plates (also bosses/chassis)
    ctx.fillStyle = gray(150); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 26, 16);
    blotches(ctx, s, rng, 22, 0.1);
    for (const y0 of [0, s / 2]) {
      bevel(ctx, 0, y0, s, s / 2, 192, 72);
      ctx.fillStyle = gray(48); ctx.fillRect(0, y0, s, 1); ctx.fillRect(0, y0, 1, s / 2);
      for (const [x, y] of [[4, y0 + 4], [s - 6, y0 + 4], [4, y0 + s / 2 - 6], [s - 6, y0 + s / 2 - 6]]) bolt(ctx, x, y);
    }
    // a small inspection hatch on the lower plate
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(40, 42, 16, 12);
    bevel(ctx, 40, 42, 16, 12, 70, 190);
    ctx.fillStyle = gray(60); for (let y = 45; y < 52; y += 2) ctx.fillRect(43, y, 10, 1);
    stencil(ctx, String(rng.int(10, 99)), 8, 12, 46, 0.6);
    for (let i = 0; i < 5; i++) streak(ctx, rng, Math.floor(rng.next() * s), rng.pick([6, 38]), 6 + rng.int(0, 18), true);
    wear(ctx, rng, 1, 1, s - 2, 2, 10); wear(ctx, rng, 1, s / 2 + 1, s - 2, 2, 10);
    noise(ctx, s, rng, 18);
  },
  panel2(ctx, s, rng) { // clean lab / station cladding with a painted band
    ctx.fillStyle = gray(162); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 14, 16);
    ctx.fillStyle = gray(52); ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s); ctx.fillRect(s / 2, 0, 1, s);
    bevel(ctx, 1, 1, s / 2 - 1, s - 1, 205, 112); bevel(ctx, s / 2 + 1, 1, s / 2 - 1, s - 1, 205, 112);
    // painted band + pinstripe
    ctx.fillStyle = gray(104); ctx.fillRect(0, 40, s, 7);
    ctx.fillStyle = gray(212); ctx.fillRect(0, 48, s, 1);
    // flush recessed handles + tiny labels
    ctx.fillStyle = gray(84); ctx.fillRect(12, 20, 8, 2); ctx.fillRect(44, 20, 8, 2);
    ctx.fillStyle = gray(200); ctx.fillRect(12, 22, 8, 1); ctx.fillRect(44, 22, 8, 1);
    stencil(ctx, 'R' + rng.int(1, 9), 4, 42, 228, 0.75);
    stencil(ctx, 'B' + rng.int(1, 9), 36, 42, 228, 0.75);
    for (let i = 0; i < 3; i++) streak(ctx, rng, Math.floor(rng.next() * s), 49, 4 + rng.int(0, 8), false);
    blotches(ctx, s, rng, 8, 0.06);
    noise(ctx, s, rng, 10);
  },
  panel3(ctx, s, rng) { // corrugated / ribbed sheet with a riveted kick band
    for (let x = 0; x < s; x++) {
      const p = (x % 8) / 8, v = 118 + Math.sin(p * Math.PI) * 70 - (p > 0.85 ? 40 : 0);
      ctx.fillStyle = gray(v); ctx.fillRect(x, 0, 1, s);
    }
    mottle(ctx, s, rng, 30, 16);
    ctx.fillStyle = gray(96); ctx.fillRect(0, 50, s, 14);
    bevel(ctx, 0, 50, s, 14, 176, 46);
    for (let x = 3; x < s; x += 10) bolt(ctx, x, 55);
    ctx.fillStyle = gray(40); ctx.fillRect(0, 0, s, 1);
    // rust bloom where water pools on the band
    for (let i = 0; i < 6; i++) { ctx.fillStyle = rgba(110, 54, 20, 0.12 + rng.next() * 0.12); ctx.fillRect(rng.int(0, s - 6), 50 + rng.int(0, 8), rng.int(2, 7), rng.int(1, 4)); }
    for (let i = 0; i < 6; i++) streak(ctx, rng, Math.floor(rng.next() * s), rng.int(0, 30), 8 + rng.int(0, 20), rng.next() < 0.6);
    noise(ctx, s, rng, 16);
  },
  brick(ctx, s, rng) { // soot-stained firebrick
    ctx.fillStyle = gray(70); ctx.fillRect(0, 0, s, s);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let bx = -1; bx < 4; bx++) {
        const x = bx * 16 + off, y = row * 8, v = 128 + rng.int(-22, 26);
        ctx.fillStyle = rgba(v + 8, v - 4, v - 12, 1); ctx.fillRect(x + 1, y + 1, 15, 7);
        ctx.fillStyle = gray(v + 40); ctx.fillRect(x + 1, y + 1, 14, 1);
        ctx.fillStyle = gray(v - 40); ctx.fillRect(x + 1, y + 7, 15, 1);
        if (rng.next() < 0.3) { ctx.fillStyle = gray(60); ctx.fillRect(x + (rng.next() < 0.5 ? 1 : 13), y + 1, 2, 2); } // chipped corner
      }
    }
    mottle(ctx, s, rng, 36, 16);
    // soot plumes
    for (let i = 0; i < 4; i++) { const x = rng.int(0, s); for (let y = 0; y < s; y++) { ctx.fillStyle = `rgba(10,6,4,${0.1 * (1 - y / s) * rng.next()})`; ctx.fillRect(x - 4 + Math.round(Math.sin(y * 0.2) * 2), y, 9, 1); } }
    noise(ctx, s, rng, 22);
  },
  stone(ctx, s, rng) { // cathedral ashlar blocks
    ctx.fillStyle = gray(84); ctx.fillRect(0, 0, s, s);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 16 : 0;
      for (let bx = -1; bx < 2; bx++) {
        const x = bx * 32 + off, y = row * 16, v = 140 + rng.int(-16, 18);
        ctx.fillStyle = gray(v); ctx.fillRect(x + 1, y + 1, 31, 15);
        bevel(ctx, x + 1, y + 1, 31, 15, v + 34, v - 48);
        for (let k = 0; k < 6; k++) { ctx.fillStyle = gray(v - 30); ctx.fillRect(x + 3 + rng.int(0, 26), y + 3 + rng.int(0, 10), 2, 1); }
      }
    }
    mottle(ctx, s, rng, 34, 8);
    for (let i = 0; i < 3; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 14, 0.45);
    // damp moss creeping up from the bottom row
    for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba(40, 52, 30, 0.25); ctx.fillRect(rng.int(0, s), 48 + Math.floor(Math.pow(rng.next(), 0.5) * 16), 1 + rng.int(0, 2), 1); }
    noise(ctx, s, rng, 18);
  },
  ice(ctx, s, rng) { // frosted cold-storage panels
    ctx.fillStyle = gray(172); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 22, 16);
    ctx.fillStyle = gray(96); ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s); ctx.fillRect(0, s / 2, s, 1);
    bevel(ctx, 1, 1, s - 1, s / 2 - 1, 220, 128); bevel(ctx, 1, s / 2 + 1, s - 1, s / 2 - 1, 220, 128);
    // frost: dense bright crystals along the seams, sparse in the middle
    for (let i = 0; i < 380; i++) {
      const x = rng.int(0, s - 1); let y = rng.int(0, s - 1);
      const dy = Math.min(Math.abs(y - s / 2), y, s - y);
      if (rng.next() * 18 < dy) continue;
      ctx.fillStyle = rgba(236, 248, 255, 0.55 + rng.next() * 0.4); ctx.fillRect(x, y, 1, 1);
    }
    // icicle drips under the seam
    for (let i = 0; i < 7; i++) { const x = rng.int(0, s - 1), l = rng.int(3, 9); for (let k = 0; k < l; k++) { ctx.fillStyle = rgba(230, 246, 255, 0.7 - k / l * 0.6); ctx.fillRect(x, s / 2 + 1 + k, 1, 1); } }
    bolt(ctx, 4, 4); bolt(ctx, s - 6, 4); bolt(ctx, 4, 36); bolt(ctx, s - 6, 36);
    noise(ctx, s, rng, 12);
  },
  flesh(ctx, s, rng) { // the breach: plating overgrown with veined tissue
    ctx.fillStyle = gray(118); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 46, 16);
    mottle(ctx, s, rng, 20, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, s / 2, s, 1); ctx.fillRect(s / 2, 0, 1, s / 2);
    // veins: wandering lines with a lit edge
    for (let i = 0; i < 7; i++) {
      let x = rng.next() * s, y = rng.next() * s, a = rng.next() * Math.PI * 2;
      const n = 20 + rng.int(0, 30);
      for (let k = 0; k < n; k++) {
        a += (rng.next() - 0.5) * 0.9; x += Math.cos(a); y += Math.sin(a);
        const px = ((Math.floor(x) % s) + s) % s, py = ((Math.floor(y) % s) + s) % s;
        ctx.fillStyle = rgba(60, 24, 40, 0.75); ctx.fillRect(px, py, 2, 1);
        ctx.fillStyle = rgba(220, 160, 190, 0.35); ctx.fillRect(px, (py + 63) % s, 1, 1);
      }
    }
    // pustules
    for (let i = 0; i < 10; i++) { const x = rng.int(1, s - 3), y = rng.int(1, s - 3); ctx.fillStyle = gray(70); ctx.fillRect(x, y, 3, 3); ctx.fillStyle = gray(225); ctx.fillRect(x, y, 1, 1); }
    noise(ctx, s, rng, 16);
  },
  // ------------------------------------------------------------------ floors
  tile(ctx, s, rng) { // big worn floor tiles
    ctx.fillStyle = gray(70); ctx.fillRect(0, 0, s, s);
    const n = 2, t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 138 + rng.int(-10, 16);
      ctx.fillStyle = gray(v); ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
      bevel(ctx, x * t + 1, y * t + 1, t - 2, t - 2, v + 34, v - 44);
    }
    mottle(ctx, s, rng, 30, 16);
    blotches(ctx, s, rng, 16, 0.14);
    for (let i = 0; i < 3; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 12);
    // chipped tile corners + grime in the grout
    for (let i = 0; i < 4; i++) { const cx = rng.pick([1, t - 3, t + 1, s - 3]), cy = rng.pick([1, t - 3, t + 1, s - 3]); ctx.fillStyle = gray(66); ctx.fillRect(cx, cy, 2, 2); }
    noise(ctx, s, rng, 20);
  },
  tile2(ctx, s, rng) { // small glazed tiles (cold rooms, killing floors)
    ctx.fillStyle = gray(80); ctx.fillRect(0, 0, s, s);
    const t = 16;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (rng.next() < 0.04) { ctx.fillStyle = gray(52); ctx.fillRect(x * t + 1, y * t + 1, t - 1, t - 1); continue; } // missing tile
      const v = 168 + rng.int(-14, 10);
      ctx.fillStyle = gray(v); ctx.fillRect(x * t + 1, y * t + 1, t - 1, t - 1);
      ctx.fillStyle = gray(Math.min(255, v + 46)); ctx.fillRect(x * t + 2, y * t + 2, 3, 1); ctx.fillRect(x * t + 2, y * t + 2, 1, 2); // glaze glint
      ctx.fillStyle = gray(v - 30); ctx.fillRect(x * t + 1, y * t + t - 1, t - 1, 1);
    }
    mottle(ctx, s, rng, 28, 16);
    for (let i = 0; i < 4; i++) streak(ctx, rng, rng.int(0, s), rng.int(0, s), 6 + rng.int(0, 14), false);
    for (let i = 0; i < 2; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 10, 0.45);
    blotches(ctx, s, rng, 10, 0.12);
    noise(ctx, s, rng, 14);
  },
  tile3(ctx, s, rng) { // two-tone lab checker
    const t = 16;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = ((x + y) % 2 ? 176 : 112) + rng.int(-6, 6);
      ctx.fillStyle = gray(v); ctx.fillRect(x * t, y * t, t, t);
      ctx.fillStyle = gray(v + 22); ctx.fillRect(x * t, y * t, t, 1);
      ctx.fillStyle = gray(v - 26); ctx.fillRect(x * t, y * t + t - 1, t, 1);
    }
    ctx.fillStyle = gray(60);
    for (let i = 0; i <= 4; i++) { ctx.fillRect(i * t, 0, 1, s); }
    mottle(ctx, s, rng, 20, 16);
    for (let i = 0; i < 18; i++) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(rng.int(0, s), rng.int(0, s), rng.int(1, 4), 1); } // scuffs
    noise(ctx, s, rng, 12);
  },
  wet(ctx, s, rng) { // wet tiles: dark puddles with streaky lamp reflections
    generators.tile2(ctx, s, rng);
    for (let i = 0; i < 3; i++) {
      const cx = rng.next() * s, cy = rng.next() * s, rx = 8 + rng.next() * 12, ry = 4 + rng.next() * 6;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        ctx.fillStyle = 'rgba(10,14,18,0.42)';
        ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(235,240,255,0.5)';
        for (let k = 0; k < 4; k++) ctx.fillRect(Math.floor(cx + ox - rx * 0.5 + rng.next() * rx), Math.floor(cy + oy - ry * 0.4 + k * 2), 2 + rng.int(0, 5), 1);
      }
    }
  },
  flag(ctx, s, rng) { // irregular flagstones
    ctx.fillStyle = gray(66); ctx.fillRect(0, 0, s, s);
    const rects = [[0, 0, 24, 20], [24, 0, 40, 14], [0, 20, 18, 26], [18, 20, 26, 22], [44, 14, 20, 30], [0, 46, 30, 18], [30, 42, 34, 22], [18, 14, 6, 6]];
    for (const [x, y, w, h] of rects) {
      const v = 130 + rng.int(-18, 18);
      ctx.fillStyle = gray(v); ctx.fillRect(x + 1, y + 1, w - 1, h - 1);
      bevel(ctx, x + 1, y + 1, w - 1, h - 1, v + 26, v - 40);
    }
    mottle(ctx, s, rng, 34, 8);
    for (let i = 0; i < 3; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 12, 0.4);
    // worn path polish in the middle
    blotches(ctx, s, rng, 6, 0.08, false);
    noise(ctx, s, rng, 18);
  },
  concrete(ctx, s, rng) { // cast concrete with aggregate, tie holes and cracks
    ctx.fillStyle = gray(146); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 40, 16);
    mottle(ctx, s, rng, 18, 4);
    blotches(ctx, s, rng, 26, 0.1);
    for (let i = 0; i < 70; i++) { ctx.fillStyle = rng.next() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.22)'; ctx.fillRect(rng.int(0, s), rng.int(0, s), 1, 1); }
    // form-tie holes
    for (const [x, y] of [[15, 15], [47, 15], [15, 47], [47, 47]]) { ctx.fillStyle = gray(58); ctx.fillRect(x, y, 2, 2); ctx.fillStyle = gray(180); ctx.fillRect(x, y + 2, 2, 1); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, s, 1);
    for (let i = 0; i < 2; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 16, 0.45);
    noise(ctx, s, rng, 22);
  },
  concrete2(ctx, s, rng) { // scorched slabs with expansion joints
    ctx.fillStyle = gray(136); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 44, 16);
    mottle(ctx, s, rng, 16, 4);
    ctx.fillStyle = gray(50); ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s);
    ctx.fillStyle = gray(178); ctx.fillRect(2, 2, s - 2, 1); ctx.fillRect(2, 2, 1, s - 2);
    // scorch rings
    for (let i = 0; i < 2; i++) {
      const cx = rng.next() * s, cy = rng.next() * s;
      for (let r = 12; r > 2; r -= 2) { ctx.fillStyle = `rgba(14,8,4,${0.08})`; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let i = 0; i < 3; i++) crack(ctx, rng, rng.int(0, s), rng.int(0, s), 18, 0.5);
    for (let i = 0; i < 50; i++) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(rng.int(0, s), rng.int(0, s), 1, 1); }
    noise(ctx, s, rng, 24);
  },
  grate(ctx, s, rng) { // walkway grating: shaded bars over a dark void
    ctx.fillStyle = gray(22); ctx.fillRect(0, 0, s, s);
    // something far below: faint pipes
    ctx.fillStyle = gray(34); ctx.fillRect(0, 22, s, 4); ctx.fillRect(40, 0, 3, s);
    for (let i = 0; i < s; i += 8) {
      ctx.fillStyle = gray(178); ctx.fillRect(i, 0, 1, s);
      ctx.fillStyle = gray(140); ctx.fillRect(i + 1, 0, 1, s);
      ctx.fillStyle = gray(92); ctx.fillRect(i + 2, 0, 1, s);
    }
    for (let i = 0; i < s; i += 16) {
      ctx.fillStyle = gray(150); ctx.fillRect(0, i, s, 1);
      ctx.fillStyle = gray(96); ctx.fillRect(0, i + 1, s, 1);
    }
    mottle(ctx, s, rng, 26, 16);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = rgba(100, 50, 20, 0.3); ctx.fillRect(rng.int(0, 8) * 8, rng.int(0, s), 3, rng.int(2, 6)); }
    noise(ctx, s, rng, 18);
  },
  grate2(ctx, s, rng) { // perforated plate
    ctx.fillStyle = gray(140); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 24, 16);
    for (let y = 0; y < s; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < s; x += 4) {
      ctx.fillStyle = gray(30); ctx.fillRect(x + 1, y + 1, 2, 2);
      ctx.fillStyle = gray(182); ctx.fillRect(x + 1, y + 3, 2, 1);
    }
    ctx.fillStyle = gray(70); ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s);
    bolt(ctx, 4, 4); bolt(ctx, 34, 4); bolt(ctx, 4, 34); bolt(ctx, 34, 34);
    noise(ctx, s, rng, 14);
  },
  plate(ctx, s, rng) { // diamond tread plate
    ctx.fillStyle = gray(132); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 28, 16);
    for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) {
      const vert = ((x + y) / 8) % 2 === 0;
      const ox = x + 2, oy = y + 2;
      ctx.fillStyle = gray(196);
      if (vert) { ctx.fillRect(ox + 1, oy, 1, 1); ctx.fillRect(ox, oy + 1, 1, 2); } else { ctx.fillRect(ox, oy + 1, 1, 1); ctx.fillRect(ox + 1, oy, 2, 1); }
      ctx.fillStyle = gray(70);
      if (vert) { ctx.fillRect(ox + 1, oy + 3, 1, 1); ctx.fillRect(ox + 2, oy + 1, 1, 2); } else { ctx.fillRect(ox + 3, oy + 1, 1, 1); ctx.fillRect(ox + 1, oy + 2, 2, 1); }
    }
    for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(rng.int(0, s), rng.int(0, s), rng.int(2, 8), 1); } // scuffs
    blotches(ctx, s, rng, 10, 0.14);
    ctx.fillStyle = gray(64); ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s);
    noise(ctx, s, rng, 16);
  },
  // ------------------------------------------------------------------ ceilings / trim / props
  ceil(ctx, s, rng) { // suspended ceiling tiles
    ctx.fillStyle = gray(132); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 22, 16);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(rng.int(0, s), rng.int(0, s), 1, 1); }
    ctx.fillStyle = gray(70); ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s); ctx.fillRect(0, s / 2, s, 2); ctx.fillRect(s / 2, 0, 2, s);
    // one water-stained tile
    for (let r = 10; r > 2; r -= 2) { ctx.fillStyle = 'rgba(70,50,20,0.1)'; ctx.beginPath(); ctx.arc(46, 46, r, 0, Math.PI * 2); ctx.fill(); }
    noise(ctx, s, rng, 12);
  },
  ceil2(ctx, s, rng) { // exposed coffered ceiling with a duct
    ctx.fillStyle = gray(96); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 26, 16);
    ctx.fillStyle = gray(140); ctx.fillRect(0, 0, s, 6); ctx.fillRect(0, 0, 6, s);
    ctx.fillStyle = gray(176); ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s);
    ctx.fillStyle = gray(56); ctx.fillRect(6, 6, s - 6, 2); ctx.fillRect(6, 6, 2, s - 6);
    // duct
    ctx.fillStyle = gray(150); ctx.fillRect(20, 24, s - 20, 10);
    ctx.fillStyle = gray(190); ctx.fillRect(20, 24, s - 20, 1);
    ctx.fillStyle = gray(80); ctx.fillRect(20, 33, s - 20, 1);
    for (let x = 26; x < s; x += 12) { ctx.fillStyle = gray(110); ctx.fillRect(x, 24, 1, 10); }
    noise(ctx, s, rng, 16);
  },
  trim(ctx, s, rng) { // brushed structural steel
    ctx.fillStyle = gray(150); ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) { ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + rng.next() * 0.08})`; ctx.fillRect(0, y, s, 1); }
    mottle(ctx, s, rng, 24, 16);
    ctx.fillStyle = gray(96); ctx.fillRect(0, 31, s, 1);
    ctx.fillStyle = gray(190); ctx.fillRect(0, 32, s, 1);
    for (let x = 6; x < s; x += 16) { bolt(ctx, x, 26); bolt(ctx, x + 8, 36); }
    wear(ctx, rng, 0, 0, s, s, 40, 200);
    blotches(ctx, s, rng, 10, 0.12);
    noise(ctx, s, rng, 14);
  },
  rust(ctx, s, rng) { // corroded steel
    ctx.fillStyle = gray(128); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 40, 16);
    for (let i = 0; i < 14; i++) {
      const x = rng.next() * s, y = rng.next() * s, r = 3 + rng.next() * 9;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { ctx.fillStyle = rgba(120, 58, 22, 0.18 + rng.next() * 0.16); ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let i = 0; i < 90; i++) { ctx.fillStyle = rng.next() < 0.6 ? rgba(60, 26, 10, 0.5) : rgba(200, 120, 70, 0.4); ctx.fillRect(rng.int(0, s), rng.int(0, s), 1, 1); } // pitting
    ctx.fillStyle = gray(60); ctx.fillRect(0, 0, s, 1);
    for (let x = 6; x < s; x += 16) bolt(ctx, x, 4);
    for (let i = 0; i < 6; i++) streak(ctx, rng, rng.int(0, s), 6, 10 + rng.int(0, 24), true);
    noise(ctx, s, rng, 18);
  },
  crate(ctx, s, rng) { // wooden planks in a metal-cornered frame
    ctx.fillStyle = gray(140); ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8) {
      const v = 128 + rng.int(-16, 22);
      ctx.fillStyle = rgba(v + 10, v, v - 14, 1); ctx.fillRect(0, y, s, 7);
      for (let k = 0; k < 3; k++) { ctx.fillStyle = gray(v - 22); ctx.fillRect(rng.int(0, s - 20), y + rng.int(1, 5), rng.int(8, 24), 1); } // grain
      if (rng.next() < 0.5) { ctx.fillStyle = gray(v - 40); ctx.fillRect(rng.int(8, s - 8), y + 3, 2, 2); } // knot
      ctx.fillStyle = gray(56); ctx.fillRect(0, y + 7, s, 1);
    }
    mottle(ctx, s, rng, 22, 16);
    ctx.fillStyle = gray(90);
    ctx.fillRect(0, 0, s, 5); ctx.fillRect(0, s - 5, s, 5); ctx.fillRect(0, 0, 5, s); ctx.fillRect(s - 5, 0, 5, s);
    bevel(ctx, 0, 0, s, s, 170, 50); bevel(ctx, 5, 5, s - 10, s - 10, 50, 150);
    ctx.strokeStyle = gray(96); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(s - 4, s - 4); ctx.stroke();
    for (const [x, y] of [[1, 1], [s - 3, 1], [1, s - 3], [s - 3, s - 3]]) bolt(ctx, x, y);
    stencil(ctx, 'V' + rng.int(10, 99), 40, 12, 30, 0.55);
    noise(ctx, s, rng, 18);
  },
  crate2(ctx, s, rng) { // ribbed metal container
    for (let x = 0; x < s; x++) { const p = (x % 6) / 6; ctx.fillStyle = gray(120 + Math.sin(p * Math.PI) * 50); ctx.fillRect(x, 0, 1, s); }
    mottle(ctx, s, rng, 26, 16);
    ctx.fillStyle = gray(76); ctx.fillRect(0, 0, s, 6); ctx.fillRect(0, s - 6, s, 6);
    bevel(ctx, 0, 0, s, 6, 170, 40); bevel(ctx, 0, s - 6, s, 6, 170, 40);
    // stencil plate
    ctx.fillStyle = gray(200); ctx.fillRect(14, 22, 36, 14);
    stencil(ctx, 'X' + rng.int(100, 999), 17, 26, 30, 0.9);
    // hazard corner
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? gray(40) : gray(215); ctx.fillRect(s - 8 + i, s - 6 - i, 1, i + 1); }
    for (let i = 0; i < 4; i++) streak(ctx, rng, rng.int(0, s), 6, 6 + rng.int(0, 14), true);
    noise(ctx, s, rng, 16);
  },
  // ------------------------------------------------------------------ misc (unchanged names used across the game)
  hazard(ctx, s, rng) {
    ctx.fillStyle = '#e8b416'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#151515';
    for (let i = -s; i < s * 2; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + 8, 0); ctx.lineTo(i + 8 - s, s); ctx.lineTo(i - s, s); ctx.closePath(); ctx.fill();
    }
    mottle(ctx, s, rng, 30, 16);
    // worn paint: scuffs show the bare metal
    for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba(150, 140, 120, 0.5); ctx.fillRect(rng.int(0, s), rng.int(0, s), rng.int(1, 4), 1); }
    blotches(ctx, s, rng, 16, 0.22);
    noise(ctx, s, rng, 24);
  },
  vent(ctx, s, rng) {
    ctx.fillStyle = gray(122); ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, rng, 20, 16);
    bevel(ctx, 0, 0, s, s, 180, 60);
    for (let y = 6; y < s - 4; y += 6) {
      ctx.fillStyle = gray(30); ctx.fillRect(4, y, s - 8, 3);
      ctx.fillStyle = gray(176); ctx.fillRect(4, y + 3, s - 8, 1);
    }
    bolt(ctx, 1, 1); bolt(ctx, s - 3, 1); bolt(ctx, 1, s - 3); bolt(ctx, s - 3, s - 3);
    for (let i = 0; i < 3; i++) streak(ctx, rng, rng.int(4, s - 4), 9, 8 + rng.int(0, 14), false);
    noise(ctx, s, rng, 14);
  },
  skin(ctx, s, rng) { // enemy body plating
    ctx.fillStyle = '#a0a0a0'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#6c6c6c';
    ctx.fillRect(0, 20, s, 2); ctx.fillRect(30, 0, 2, s); ctx.fillRect(0, 46, s, 1);
    blotches(ctx, s, rng, 14, 0.2);
    noise(ctx, s, rng, 34);
  },
  gun(ctx, s, rng) {
    ctx.fillStyle = '#9c9c9c'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#7a7a7a';
    for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 1);
    blotches(ctx, s, rng, 18, 0.18);
    for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(rng.next() * s, rng.next() * s, 2, 1); }
    noise(ctx, s, rng, 24);
  },
  rug(ctx, s, rng) {
    ctx.fillStyle = '#7a1f22'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#c4a24c';
    ctx.fillRect(3, 3, s - 6, 2); ctx.fillRect(3, s - 5, s - 6, 2); ctx.fillRect(3, 3, 2, s - 6); ctx.fillRect(s - 5, 3, 2, s - 6);
    ctx.fillStyle = '#d9d2c0';
    for (let y = 10; y < s - 10; y += 8) for (let x = 10; x < s - 10; x += 8) {
      ctx.fillRect(x + 3, y, 2, 2); ctx.fillRect(x, y + 3, 2, 2); ctx.fillRect(x + 6, y + 3, 2, 2); ctx.fillRect(x + 3, y + 6, 2, 2);
    }
    mottle(ctx, s, rng, 24, 16);
    noise(ctx, s, rng, 24);
  },
  screen(ctx, s, rng) {
    ctx.fillStyle = '#060a0a'; ctx.fillRect(0, 0, s, s);
    for (let y = 4; y < s - 4; y += 4) {
      const w = 6 + rng.next() * (s - 16);
      ctx.fillStyle = rng.next() < 0.2 ? '#ff4060' : '#3ef0d0';
      ctx.fillRect(4, y, w, 2);
    }
    noise(ctx, s, rng, 14);
  },
};

export const TEXTURE_NAMES = Object.keys(generators);

export function getTexture(name) {
  if (!generators[name]) name = 'panel'; // unknown kinds fall back instead of throwing mid-build
  if (cache.has(name)) return cache.get(name);
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = new RNG(name.length * 977 + name.charCodeAt(0) * 31 + name.charCodeAt(name.length - 1) * 7);
  generators[name](ctx, S, rng);
  const t = toTexture(c);
  cache.set(name, t);
  return t;
}
