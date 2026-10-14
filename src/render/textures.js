import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Tiny procedural textures (64x64, nearest filtered) for the gritty retro look.
// Grayscale so each theme can tint them through material colour + vertex colour.

const cache = new Map();

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

function noise(ctx, size, rng, amount, base = 128) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, size, rng, count, alpha, dark = true) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * size, y = rng.next() * size, r = 2 + rng.next() * 8;
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha * rng.next()})` : `rgba(255,255,255,${alpha * rng.next()})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const generators = {
  panel(ctx, s, rng) {
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rng, 30, 0.12);
    ctx.fillStyle = '#5c5c5c';
    ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s);
    ctx.fillRect(0, s / 2, s, 1);
    ctx.fillStyle = '#c4c4c4';
    ctx.fillRect(2, 2, s - 2, 1); ctx.fillRect(2, s / 2 + 1, s - 2, 1);
    // rivets
    ctx.fillStyle = '#6d6d6d';
    for (const [x, y] of [[5, 5], [s - 6, 5], [5, s / 2 + 4], [s - 6, s / 2 + 4], [5, s - 6], [s - 6, s - 6]]) ctx.fillRect(x, y, 2, 2);
    // drip stains
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rng.next() * s);
      ctx.fillStyle = 'rgba(30,20,10,0.18)';
      ctx.fillRect(x, Math.floor(rng.next() * s / 2), 1 + Math.floor(rng.next() * 2), 8 + rng.next() * 20);
    }
    noise(ctx, s, rng, 26);
  },
  tile(ctx, s, rng) {
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, s, s);
    const n = 2, t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 130 + Math.floor(rng.next() * 25);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
    }
    ctx.fillStyle = '#4a4a4a';
    for (let i = 0; i <= n; i++) { ctx.fillRect(i * t, 0, 1, s); ctx.fillRect(0, i * t, s, 1); }
    blotches(ctx, s, rng, 26, 0.18);
    // cracks
    ctx.strokeStyle = 'rgba(40,40,40,0.5)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      let x = rng.next() * s, y = rng.next() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rng.next() - 0.5) * 14; y += (rng.next() - 0.5) * 14; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    noise(ctx, s, rng, 30);
  },
  concrete(ctx, s, rng) {
    ctx.fillStyle = '#909090'; ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rng, 60, 0.12);
    blotches(ctx, s, rng, 30, 0.08, false);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(rng.next() * s, rng.next() * s, 1, 1); }
    noise(ctx, s, rng, 40);
  },
  grate(ctx, s, rng) {
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#8c8c8c';
    for (let i = 0; i < s; i += 8) { ctx.fillRect(i, 0, 3, s); }
    ctx.fillStyle = '#6a6a6a';
    for (let i = 0; i < s; i += 16) { ctx.fillRect(0, i, s, 2); }
    noise(ctx, s, rng, 30);
  },
  crate(ctx, s, rng) {
    ctx.fillStyle = '#8f8f8f'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8) {
      const v = 120 + Math.floor(rng.next() * 40);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, s, 7);
      ctx.fillStyle = '#555'; ctx.fillRect(0, y + 7, s, 1);
    }
    ctx.fillStyle = '#5e5e5e';
    ctx.fillRect(0, 0, s, 5); ctx.fillRect(0, s - 5, s, 5); ctx.fillRect(0, 0, 5, s); ctx.fillRect(s - 5, 0, 5, s);
    ctx.strokeStyle = '#5e5e5e'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(s - 4, s - 4); ctx.stroke();
    noise(ctx, s, rng, 26);
  },
  hazard(ctx, s, rng) {
    ctx.fillStyle = '#e8b416'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#151515';
    for (let i = -s; i < s * 2; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + 8, 0); ctx.lineTo(i + 8 - s, s); ctx.lineTo(i - s, s); ctx.closePath(); ctx.fill();
    }
    blotches(ctx, s, rng, 20, 0.25);
    noise(ctx, s, rng, 30);
  },
  vent(ctx, s, rng) {
    ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2a2a2a';
    for (let y = 6; y < s - 4; y += 6) ctx.fillRect(4, y, s - 8, 3);
    noise(ctx, s, rng, 20);
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
    noise(ctx, s, rng, 30);
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

export function getTexture(name) {
  if (cache.has(name)) return cache.get(name);
  const s = 64;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  const rng = new RNG(name.length * 977 + name.charCodeAt(0) * 31);
  generators[name](ctx, s, rng);
  const t = toTexture(c);
  cache.set(name, t);
  return t;
}
