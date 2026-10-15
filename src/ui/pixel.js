// Shared pixel-art UI helpers: low-res text rendering (genuinely pixelated), glitch
// scrambles, procedural noise textures and weapon icon sprites.

export const SERIF = '"Libre Caslon Condensed", "Times New Roman", Times, serif';
export const MONO = 'VT323, "Courier New", monospace';

export function font(size, kind = 'serif', weight = 700) {
  return kind === 'mono' ? `${size}px ${MONO}` : `${weight} ${size}px ${SERIF}`;
}

const GLYPHS = '#?/<>%&@$X7C[]=+*0123456789';
export function scramble(text, t, dur = 0.45, seed = 0) {
  if (t >= dur) return text;
  const k = Math.max(0, t / dur);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ' || i / text.length < k) out += c;
    else out += GLYPHS[(Math.floor(t * 40) + i * 7 + seed) % GLYPHS.length];
  }
  return out;
}

// Occasional data-corruption of a string (used for lore and boss chatter)
export function corrupt(text, amount, rnd = Math.random) {
  let out = '';
  for (const c of text) out += c !== ' ' && rnd() < amount ? GLYPHS[Math.floor(rnd() * GLYPHS.length)] : c;
  return out;
}

/** Render text to a small canvas, to be shown scaled up with image-rendering: pixelated. */
export function pixelTextCanvas(text, { size = 22, color = '#ffffff', kind = 'serif', ca = 1, pad = 4, stroke = null, glow = null } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font(size, kind);
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + ca * 2;
  const h = Math.ceil(size * 1.25) + pad * 2;
  c.width = w; c.height = h;
  ctx.font = font(size, kind);
  ctx.textBaseline = 'middle';
  const y = h / 2 + 1;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 6; }
  if (ca) {
    ctx.fillStyle = 'rgba(255,40,70,0.85)'; ctx.fillText(text, pad, y);
    ctx.fillStyle = 'rgba(60,240,230,0.85)'; ctx.fillText(text, pad + ca * 2, y);
  }
  ctx.shadowBlur = 0;
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeText(text, pad + ca, y); }
  ctx.fillStyle = color;
  ctx.fillText(text, pad + ca, y);
  c.className = 'px';
  return c;
}

/** Replace an element's content with a pixel-rendered version of its text. */
export function pixelize(el, opts = {}) {
  const text = opts.text || el.textContent;
  el.textContent = '';
  const c = pixelTextCanvas(text, opts);
  const scale = opts.scale || 3;
  c.style.width = c.width * scale + 'px';
  c.style.height = c.height * scale + 'px';
  c.style.maxWidth = '100%';
  c.style.height = 'auto';
  el.appendChild(c);
  el.setAttribute('aria-label', text);
  return c;
}

let noiseURL = null;
export function noiseDataURL() {
  if (noiseURL) return noiseURL;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  noiseURL = c.toDataURL();
  return noiseURL;
}

// Weapon icon pixel rects in a 32x12 grid: [x0,y0,x1,y1,shade] shade: 0 body, 1 dark, 2 accent
export const ICONS = {
  hammer: [[11, 3, 31, 5, 0], [9, 2, 15, 8, 0], [10, 3, 14, 7, 1], [4, 2, 10, 8, 0], [2, 7, 7, 12, 1], [4, 0, 7, 2, 1], [28, 1, 30, 3, 1]],
  ripsaw: [[0, 4, 8, 9, 1], [8, 3, 22, 7, 0], [22, 4, 32, 5, 0], [13, 7, 16, 12, 1], [11, 1, 19, 3, 1], [17, 7, 19, 10, 1], [9, 4, 21, 5, 2]],
  breacher: [[0, 4, 9, 9, 1], [9, 3, 15, 7, 0], [15, 3, 32, 5, 0], [17, 5, 26, 8, 1], [11, 7, 13, 11, 1]],
  lance: [[2, 2, 20, 8, 0], [20, 2, 32, 3, 1], [20, 7, 32, 8, 1], [7, 4, 18, 6, 2], [0, 4, 4, 9, 1], [10, 8, 13, 12, 1]],
  thumper: [[5, 2, 30, 8, 0], [28, 1, 32, 9, 1], [10, 8, 13, 12, 1], [14, 0, 19, 2, 1], [6, 4, 28, 5, 2]],
  arc: [[6, 2, 20, 9, 0], [20, 3, 31, 4, 1], [20, 6, 31, 7, 1], [10, 4, 17, 7, 2], [2, 3, 6, 8, 1]],
};

export function drawIcon(ctx, id, x, y, scale, colors) {
  const rects = ICONS[id];
  if (!rects) return;
  for (const [x0, y0, x1, y1, s] of rects) {
    ctx.fillStyle = colors[s];
    ctx.fillRect(Math.round(x + x0 * scale), Math.round(y + y0 * scale), Math.max(1, Math.round((x1 - x0) * scale)), Math.max(1, Math.round((y1 - y0) * scale)));
  }
}

export function iconCanvas(id, colors, scale = 2) {
  const c = document.createElement('canvas');
  c.width = 32 * scale; c.height = 12 * scale;
  drawIcon(c.getContext('2d'), id, 0, 0, scale, colors);
  c.className = 'px';
  return c;
}
