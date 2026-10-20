import * as THREE from 'three';
import { psxify } from '../render/renderer.js';

// Pooled, bounded visual effects. Everything here has a fixed capacity so long runs never
// accumulate objects: particles (2 point clouds), tracers (1 line batch), decals (1 instanced
// mesh), beams, explosions, rings, debris.

const PVERT = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float uScale;
void main(){
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
varying vec4 vColor;
void main(){
  if (vColor.a <= 0.0) discard;
  gl_FragColor = vColor;
}`;

class ParticleSystem {
  constructor(scene, cap, additive) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.base = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.floorY = new Float32Array(cap);
    // sticky particles (blood drops) call onStick when they reach their floor and die there
    this.stick = new Uint8Array(cap);
    this.onStick = null;
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('pcolor', this.aCol);
    this.geo.setAttribute('size', this.aSize);
    this.geo.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 300 } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.additive = additive;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, floorY = -1e9) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap);
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.base[i4] = r; this.base[i4 + 1] = g; this.base[i4 + 2] = b; this.base[i4 + 3] = a;
    this.size0[i] = size; this.life[i] = life; this.max[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.floorY[i] = floorY;
    this.stick[i] = 0;
    return i;
  }
  update(dt) {
    let n = this.n;
    const P = this.pos, V = this.vel, C = this.col, B = this.base;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) {
          const i3 = i * 3, n3 = n * 3, i4 = i * 4, n4 = n * 4;
          P[i3] = P[n3]; P[i3 + 1] = P[n3 + 1]; P[i3 + 2] = P[n3 + 2];
          V[i3] = V[n3]; V[i3 + 1] = V[n3 + 1]; V[i3 + 2] = V[n3 + 2];
          B[i4] = B[n4]; B[i4 + 1] = B[n4 + 1]; B[i4 + 2] = B[n4 + 2]; B[i4 + 3] = B[n4 + 3];
          this.size0[i] = this.size0[n]; this.life[i] = this.life[n]; this.max[i] = this.max[n];
          this.grav[i] = this.grav[n]; this.drag[i] = this.drag[n]; this.floorY[i] = this.floorY[n];
          this.stick[i] = this.stick[n];
          i--;
        }
        continue;
      }
      const i3 = i * 3, i4 = i * 4;
      const d = 1 - this.drag[i] * dt;
      V[i3] *= d; V[i3 + 1] = V[i3 + 1] * d - this.grav[i] * dt; V[i3 + 2] *= d;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < this.floorY[i]) {
        P[i3 + 1] = this.floorY[i];
        if (this.stick[i]) { this.stick[i] = 0; this.life[i] = Math.min(this.life[i], 0.05); if (this.onStick) this.onStick(P[i3], P[i3 + 1], P[i3 + 2], B[i4], B[i4 + 1], B[i4 + 2], this.size0[i]); }
        V[i3 + 1] *= -0.3; V[i3] *= 0.6; V[i3 + 2] *= 0.6;
      }
      const t = this.life[i] / this.max[i];
      if (this.additive) {
        C[i4] = B[i4] * t; C[i4 + 1] = B[i4 + 1] * t; C[i4 + 2] = B[i4 + 2] * t; C[i4 + 3] = 1;
      } else {
        C[i4] = B[i4]; C[i4 + 1] = B[i4 + 1]; C[i4 + 2] = B[i4 + 2]; C[i4 + 3] = B[i4 + 3] * Math.min(1, t * 2);
      }
      this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

class Tracers {
  constructor(scene, cap) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 6);
    this.col = new Float32Array(cap * 6);
    this.base = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.i = 0;
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('color', this.aCol);
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  add(ax, ay, az, bx, by, bz, r, g, b, life = 0.07) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    const p = i * 6;
    this.pos[p] = ax; this.pos[p + 1] = ay; this.pos[p + 2] = az;
    this.pos[p + 3] = bx; this.pos[p + 4] = by; this.pos[p + 5] = bz;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.life[i] = life; this.max[i] = life;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      const p = i * 6;
      if (this.life[i] <= 0) {
        this.col[p] = this.col[p + 1] = this.col[p + 2] = this.col[p + 3] = this.col[p + 4] = this.col[p + 5] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      const r = this.base[i * 3] * t, g = this.base[i * 3 + 1] * t, b = this.base[i * 3 + 2] * t;
      // head bright, tail dim
      this.col[p] = r * 0.25; this.col[p + 1] = g * 0.25; this.col[p + 2] = b * 0.25;
      this.col[p + 3] = r; this.col[p + 4] = g; this.col[p + 5] = b;
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

// ---------------------------------------------------------------------------------------
// Billboards: camera-facing textured quads (one instanced draw per system) for fireballs,
// smoke, flashes and blood mist. Frames come from a procedural 4x4 pixel atlas, so a
// fireball burns out over its life (white core -> orange -> red -> soot) at PS1 resolution.
// Smoke is screen-door dithered (opaque + discard), which sorts correctly without blending.
// ---------------------------------------------------------------------------------------
export const BB = { FIRE0: 0, FIRE1: 7, SMOKE: 8, STAR: 12, GLOW: 13, RING: 14, MIST: 15 };

let atlasTex = null;
function fxAtlas() {
  if (atlasTex) return atlasTex;
  const F = 32, c = document.createElement('canvas');
  c.width = c.height = F * 4;
  const x = c.getContext('2d');
  const img = x.createImageData(F * 4, F * 4);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // tiny value noise on an 8x8 lattice, one per frame
  const lattice = () => {
    const L = [];
    for (let i = 0; i < 81; i++) L.push(rnd());
    return (u, v) => {
      const fx = u * 8, fy = v * 8, ix = Math.min(7, Math.floor(fx)), iy = Math.min(7, Math.floor(fy)), tx = fx - ix, ty = fy - iy;
      const a = L[iy * 9 + ix], b = L[iy * 9 + ix + 1], cc = L[(iy + 1) * 9 + ix], d = L[(iy + 1) * 9 + ix + 1];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
    };
  };
  const put = (fr, px, py, r, g, b, a) => {
    const X = (fr % 4) * F + px, Y = Math.floor(fr / 4) * F + py, i = (Y * F * 4 + X) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
  };
  // fire ramp: hot white core -> yellow -> orange -> red -> soot
  const RAMP = [[255, 250, 220], [255, 214, 80], [255, 138, 32], [214, 56, 18], [110, 26, 14], [46, 20, 16]];
  for (let fr = 0; fr < 8; fr++) {
    const age = fr / 7, n = lattice(), n2 = lattice();
    const R = 0.55 + age * 0.4;
    for (let py = 0; py < F; py++) for (let px = 0; px < F; px++) {
      const u = (px + 0.5) / F, v = (py + 0.5) / F, dx = u - 0.5, dy = v - 0.5;
      const d = Math.hypot(dx, dy) * 2 / R;
      const nz = n(u, v) * 0.65 + n2(u * 0.5 + 0.25, v * 0.5 + 0.25) * 0.35;
      const edge = 1 - d + (nz - 0.5) * (0.5 + age * 0.6);
      if (edge <= 0.02) continue;
      // holes open up as it burns out
      if (age > 0.35 && nz < (age - 0.35) * 0.95) continue;
      let heat = edge * (1.25 - age * 0.95) + (nz - 0.5) * 0.35 - Math.max(0, dy) * 0.25 * age;
      heat = Math.max(0, Math.min(0.999, heat));
      const k = Math.min(RAMP.length - 1, Math.floor((1 - heat) * RAMP.length));
      const col = RAMP[k];
      put(fr, px, py, col[0], col[1], col[2], k >= 5 ? 170 : 255);
    }
  }
  // smoke puffs: lumpy grey with a lit top edge
  for (let fr = 8; fr < 12; fr++) {
    const n = lattice();
    const lumps = [];
    for (let i = 0; i < 5; i++) lumps.push([0.5 + (rnd() - 0.5) * 0.4, 0.5 + (rnd() - 0.5) * 0.4, 0.18 + rnd() * 0.16]);
    for (let py = 0; py < F; py++) for (let px = 0; px < F; px++) {
      const u = (px + 0.5) / F, v = (py + 0.5) / F;
      let m = 0;
      for (const [lx, ly, lr] of lumps) m = Math.max(m, 1 - Math.hypot(u - lx, v - ly) / lr);
      m += (n(u, v) - 0.5) * 0.45;
      if (m <= 0.05) continue;
      const lit = 0.55 + 0.45 * (1 - v) + (n(v, u) - 0.5) * 0.2;
      const g = Math.max(60, Math.min(255, 200 * lit));
      put(fr, px, py, g, g, g, Math.min(255, 90 + m * 330));
    }
  }
  // 12: four-point flash star, 13: soft glow, 14: shock ring, 15: blood mist clump
  for (let py = 0; py < F; py++) for (let px = 0; px < F; px++) {
    const dx = (px + 0.5) / F - 0.5, dy = (py + 0.5) / F - 0.5, d = Math.hypot(dx, dy);
    const star = Math.max(0, 1 - d * 2.2) + Math.max(0, 0.5 - Math.abs(dx) * 14) * Math.max(0, 1 - Math.abs(dy) * 2.1) + Math.max(0, 0.5 - Math.abs(dy) * 14) * Math.max(0, 1 - Math.abs(dx) * 2.1);
    if (star > 0.08) put(12, px, py, 255, 255, Math.min(255, 150 + star * 140), Math.min(255, star * 330));
    const glow = Math.max(0, 1 - d * 2.05);
    if (glow > 0.02) put(13, px, py, 255, 255, 255, Math.min(255, Math.pow(glow, 1.6) * 255 * 1.4));
    const ring = Math.max(0, 1 - Math.abs(d - 0.4) * 14);
    if (ring > 0.05) put(14, px, py, 255, 255, 255, ring * 255);
  }
  const nm = lattice();
  for (let py = 0; py < F; py++) for (let px = 0; px < F; px++) {
    const u = (px + 0.5) / F, v = (py + 0.5) / F, d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const m = 1 - d + (nm(u, v) - 0.5) * 0.9;
    if (m > 0.1) { const g = 150 + nm(v, u) * 105; put(15, px, py, g, g, g, Math.min(255, m * 400)); }
  }
  x.putImageData(img, 0, 0);
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false;
  return atlasTex;
}

const BVERT = `
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec4 iDat;
varying vec2 vUv;
varying vec4 vCol;
varying float vTint;
varying float vDepth;
void main(){
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iDat.y), s = sin(iDat.y);
  vec2 q = position.xy * iDat.x;
  mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = projectionMatrix * mv;
  float f = floor(iDat.z + 0.5);
  float cx = mod(f, 4.0), cy = floor(f / 4.0);
  vUv = vec2((uv.x + cx) * 0.25, (uv.y + 3.0 - cy) * 0.25);
  vCol = iCol; vTint = iDat.w; vDepth = -mv.z;
}`;
const BFRAG = `
uniform sampler2D uMap;
uniform float uDither;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec4 vCol;
varying float vTint;
varying float vDepth;
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  float lum = dot(t.rgb, vec3(0.3, 0.59, 0.11));
  vec3 c = mix(t.rgb * vCol.rgb, vec3(lum) * vCol.rgb * 2.0, vTint);
  #ifdef USE_FOG
  float ff = smoothstep(fogNear, fogFar, vDepth);
  #else
  float ff = 0.0;
  #endif
  if (uDither > 0.5) {
    float th = (bayer2(0.5 * gl_FragCoord.xy) * 0.25 + bayer2(gl_FragCoord.xy)) * 0.94 + 0.03;
    if (a < th) discard;
    gl_FragColor = vec4(mix(c, fogColor, ff), 1.0);
  } else {
    if (a < 0.02) discard;
    gl_FragColor = vec4(c * (1.0 - ff), a);
  }
}`;

class Billboards {
  constructor(scene, cap, additive) {
    this.cap = cap;
    this.n = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new Float32Array(cap * 3); this.iCol = new Float32Array(cap * 4); this.iDat = new Float32Array(cap * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.iCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.aDat = new THREE.InstancedBufferAttribute(this.iDat, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iDat', this.aDat);
    geo.instanceCount = 0;
    this.geo = geo;
    // per-particle state
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.c = new Float32Array(cap * 4);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap); this.rot = new Float32Array(cap); this.spin = new Float32Array(cap);
    this.f0 = new Float32Array(cap); this.f1 = new Float32Array(cap); this.tint = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.delay = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.mode = new Uint8Array(cap);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BVERT, fragmentShader: BFRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uDither: { value: additive ? 0 : 1 } }]),
      fog: true, transparent: additive, depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat.uniforms.uMap.value = fxAtlas();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 2 : 1;
    scene.add(this.mesh);
  }
  // mode 0: fade out; 1: fade in, then out (smoke); 2: hold, then a quick fade (flashes)
  spawn(x, y, z, vx, vy, vz, size0, size1, f0, f1, life, r = 1, g = 1, b = 1, a = 1, o = NOOPT) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap);
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c[i4] = r; this.c[i4 + 1] = g; this.c[i4 + 2] = b; this.c[i4 + 3] = a;
    this.s0[i] = size0; this.s1[i] = size1; this.f0[i] = f0; this.f1[i] = f1;
    this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * 6.283; this.spin[i] = o.spin || 0;
    this.tint[i] = o.tint || 0; this.life[i] = life; this.max[i] = life; this.delay[i] = o.delay || 0;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0; this.mode[i] = o.mode || 0;
    return i;
  }
  update(dt) {
    let n = this.n;
    const P = this.p, V = this.v, C = this.c, IP = this.iPos, IC = this.iCol, ID = this.iDat;
    for (let i = 0; i < n; i++) {
      if (this.delay[i] > 0) this.delay[i] -= dt;
      else this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) {
          const i3 = i * 3, n3 = n * 3, i4 = i * 4, n4 = n * 4;
          P[i3] = P[n3]; P[i3 + 1] = P[n3 + 1]; P[i3 + 2] = P[n3 + 2];
          V[i3] = V[n3]; V[i3 + 1] = V[n3 + 1]; V[i3 + 2] = V[n3 + 2];
          C[i4] = C[n4]; C[i4 + 1] = C[n4 + 1]; C[i4 + 2] = C[n4 + 2]; C[i4 + 3] = C[n4 + 3];
          this.s0[i] = this.s0[n]; this.s1[i] = this.s1[n]; this.f0[i] = this.f0[n]; this.f1[i] = this.f1[n];
          this.rot[i] = this.rot[n]; this.spin[i] = this.spin[n]; this.tint[i] = this.tint[n];
          this.life[i] = this.life[n]; this.max[i] = this.max[n]; this.delay[i] = this.delay[n];
          this.grav[i] = this.grav[n]; this.drag[i] = this.drag[n]; this.mode[i] = this.mode[n];
          i--;
        }
        continue;
      }
      const i3 = i * 3, i4 = i * 4;
      const live = this.delay[i] <= 0;
      if (live) {
        const d = Math.max(0, 1 - this.drag[i] * dt);
        V[i3] *= d; V[i3 + 1] = V[i3 + 1] * d - this.grav[i] * dt; V[i3 + 2] *= d;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        this.rot[i] += this.spin[i] * dt;
      }
      const t = 1 - this.life[i] / this.max[i];
      const e = 1 - (1 - t) * (1 - t);
      let a = C[i4 + 3];
      const m = this.mode[i];
      if (m === 0) a *= 1 - t * t;
      else if (m === 1) a *= Math.min(1, t * 6) * (1 - t * t);
      else a *= t < 0.6 ? 1 : (1 - t) / 0.4;
      IP[i3] = P[i3]; IP[i3 + 1] = P[i3 + 1]; IP[i3 + 2] = P[i3 + 2];
      IC[i4] = C[i4]; IC[i4 + 1] = C[i4 + 1]; IC[i4 + 2] = C[i4 + 2]; IC[i4 + 3] = live ? a : 0;
      ID[i4] = live ? this.s0[i] + (this.s1[i] - this.s0[i]) * e : 0;
      ID[i4 + 1] = this.rot[i];
      ID[i4 + 2] = this.f0[i] + (this.f1[i] - this.f0[i]) * Math.min(0.999, t);
      ID[i4 + 3] = this.tint[i];
    }
    this.n = n;
    this.geo.instanceCount = n;
    if (n) { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aDat.needsUpdate = true; }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}
const NOOPT = {};

// A 32x32 pixel splat (irregular blob with droplets) shared by every decal: blood pools,
// scorch marks and bullet holes read as shapes instead of flat squares.
let splatTex = null;
function splatTexture() {
  if (splatTex) return splatTex;
  const N = 32, c = document.createElement('canvas');
  c.width = N; c.height = N;
  const x = c.getContext('2d');
  const img = x.createImageData(N, N);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blobs = [[16, 16, 9]];
  for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI * 2, r = 6 + rnd() * 7; blobs.push([16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 1.5 + rnd() * 3.5]); }
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let v = 0;
      for (const [bx, by, br] of blobs) { const d = Math.hypot(px + 0.5 - bx, py + 0.5 - by); v = Math.max(v, 1 - d / br); }
      const i = (py * N + px) * 4;
      const inside = v > 0.02;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * (0.75 + 0.25 * Math.min(1, v * 2));
      img.data[i + 3] = inside ? 255 * Math.min(1, 0.55 + v) : 0;
    }
  }
  x.putImageData(img, 0, 0);
  splatTex = new THREE.CanvasTexture(c);
  splatTex.magFilter = THREE.NearestFilter; splatTex.minFilter = THREE.NearestFilter; splatTex.generateMipmaps = false;
  return splatTex;
}

const _spin = new THREE.Quaternion();
class Decals {
  constructor(scene, cap) {
    this.cap = cap;
    this.i = 0;
    const g = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: splatTexture(), transparent: true, opacity: 0.9, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: false });
    this.mesh = new THREE.InstancedMesh(g, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color(0, 0, 0)); }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.n = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
    this.c = new THREE.Color();
    scene.add(this.mesh);
  }
  // grow > 0: the decal spreads from a third of its size over grow seconds (pools)
  add(x, y, z, nx, ny, nz, size, color, grow = 0) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    if (this.growing) { for (let k = this.growing.length - 1; k >= 0; k--) if (this.growing[k].i === i) this.growing.splice(k, 1); }
    this.n.set(nx, ny, nz);
    this.q.setFromUnitVectors(this.z, this.n);
    this.q.premultiply(_spin.setFromAxisAngle(this.n, Math.random() * Math.PI));
    this.v.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    const s0 = grow > 0 ? size * 0.3 : size;
    this.s.set(s0, s0, s0);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    if (grow > 0) {
      if (!this.growing) this.growing = [];
      this.growing.push({ i, p: this.v.clone(), q: this.q.clone(), s0, s1: size, t: 0, T: grow });
    }
    this.c.setHex(color);
    this.mesh.setColorAt(i, this.c);
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const G = this.growing;
    if (!G || !G.length) return;
    for (const d of G) {
      d.t += dt;
      const u = Math.min(1, d.t / d.T), e = 1 - (1 - u) * (1 - u) * (1 - u), sz = d.s0 + (d.s1 - d.s0) * e;
      this.s.set(sz, sz, sz);
      this.m.compose(d.p, d.q, this.s);
      this.mesh.setMatrixAt(d.i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.growing = G.filter((d) => d.t < d.T);
  }
  clear() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = 0; this.i = 0;
    if (this.growing) this.growing.length = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Generic pooled transient meshes (beams, explosion spheres, rings, spawn columns).
class MeshPool {
  constructor(scene, geo, makeMat, cap) {
    this.items = [];
    for (let i = 0; i < cap; i++) {
      const m = new THREE.Mesh(geo, makeMat());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.items.push({ mesh: m, life: 0, max: 1, update: null });
    }
    this.i = 0;
  }
  get() {
    for (let k = 0; k < this.items.length; k++) {
      const it = this.items[(this.i + k) % this.items.length];
      if (it.life <= 0) { this.i = (this.i + k + 1) % this.items.length; return it; }
    }
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length; return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.mesh.visible = false; continue; }
      if (it.update) it.update(it, 1 - it.life / it.max, dt);
    }
  }
  clear() { for (const it of this.items) { it.life = 0; it.mesh.visible = false; } }
}

// scratch for ray-vs-box splatter tests and corpse trails (no per-call allocation)
const _rd = new THREE.Vector3(), _cv = new THREE.Color();
const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3(), _bx = new THREE.Box3();
const hexOf = (r, g, b) => (Math.min(255, Math.round(r * 255)) << 16) | (Math.min(255, Math.round(g * 255)) << 8) | Math.min(255, Math.round(b * 255));

export class FX {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const mobile = game.lowPower;
    this.sparks = new ParticleSystem(scene, mobile ? 500 : 900, true);
    this.dust = new ParticleSystem(scene, mobile ? 400 : 700, false);
    // blood drops that land paint the floor (their own ring, so they never evict pools or scorch marks)
    this.dust.onStick = (x, y, z, r, g, b, size) => this.drops.add(x, y + 0.004, z, 0, 1, 0, 0.1 + size * 1.4 + Math.random() * 0.08, hexOf(r * 0.62, g * 0.62, b * 0.62));
    this.tracers = new Tracers(scene, 64);
    this.decals = new Decals(scene, mobile ? 96 : 160);
    this.drops = new Decals(scene, mobile ? 64 : 128);
    // blood / oil pools under bodies spread out over a few seconds
    this.pools = new Decals(scene, mobile ? 28 : 48);
    this.fire = new Billboards(scene, mobile ? 110 : 190, true);
    this.smoke = new Billboards(scene, mobile ? 70 : 130, false);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0, 0.5); // mesh.lookAt aims +Z at the target, so the beam spans +Z from its origin
    this.beams = new MeshPool(scene, box, () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 24);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    this.balls = new MeshPool(scene, ico, () => psxify(new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 16);
    const ring = new THREE.RingGeometry(0.85, 1, 24, 1);
    ring.rotateX(-Math.PI / 2);
    this.rings = new MeshPool(scene, ring, () => new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), 36);
    const disc = new THREE.CircleGeometry(1, 20);
    disc.rotateX(-Math.PI / 2);
    this.discs = new MeshPool(scene, disc, () => new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }), 32);
    const col = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
    col.translate(0, 0.5, 0);
    this.columns = new MeshPool(scene, col, () => new THREE.MeshBasicMaterial({ color: 0x3ef0d0, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), 24);

    // Debris chunks (instanced boxes with simple physics)
    this.debrisCap = mobile ? 60 : 120;
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), psxify(new THREE.MeshLambertMaterial({ color: 0xffffff })), this.debrisCap);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.frustumCulled = false;
    this.debris = [];
    for (let i = 0; i < this.debrisCap; i++) {
      this.debris.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0.1, floor: 0 });
      this.debrisMesh.setColorAt(i, new THREE.Color(0.5, 0.5, 0.5));
    }
    this.debrisI = 0;
    scene.add(this.debrisMesh);

    // Corpse pieces (actual enemy meshes reparented here)
    this.corpses = [];
    this.corpseCap = mobile ? 50 : 90;

    // Lights: fixed count, never added/removed (avoids shader recompiles)
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 1.4);
    scene.add(this.muzzleLight);
    this.boomLight = new THREE.PointLight(0xff9030, 0, 16, 1.2);
    scene.add(this.boomLight);
    this.boomT = 0;
    this.muzzleT = 0;

    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpS = new THREE.Vector3(); this.tmpV = new THREE.Vector3();
  }

  get reduced() { return this.game.settings.get('reduceFlashes'); }
  get gore() { return this.game.settings.get('gore') !== false; }

  // floor height under a point (room geometry), for decals and sticky drops
  floorAt(x, z, y = 99) {
    const room = this.game.level && this.game.level.current;
    if (!room || !room.floorAt) return 0;
    const f = room.floorAt(x, z);
    return f > y + 0.3 ? 0 : f;
  }

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.pools.update(dt);
    this.tracers.update(dt);
    this.beams.update(dt);
    this.balls.update(dt);
    this.rings.update(dt);
    this.discs.update(dt);
    this.columns.update(dt);
    this.updateDebris(dt);
    this.updateCorpses(dt);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0; }
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boomLight.intensity = Math.max(0, this.boomT / 0.35) * 30;
    } else this.boomLight.intensity = 0;
    const h = this.game.renderer.internalH;
    this.sparks.uniforms.uScale.value = h * 0.9;
    this.dust.uniforms.uScale.value = h * 0.9;
  }

  clear() {
    this.sparks.clear(); this.dust.clear(); this.tracers.clear(); this.decals.clear(); this.drops.clear(); this.pools.clear();
    this.fire.clear(); this.smoke.clear();
    this.beams.clear(); this.balls.clear(); this.rings.clear(); this.discs.clear(); this.columns.clear();
    for (const d of this.debris) d.life = 0;
    this.clearCorpses();
  }

  muzzle(x, y, z, color = 0xffc070, strength = 1) {
    this.muzzleLight.position.set(x, y, z);
    this.muzzleLight.color.setHex(color);
    this.muzzleLight.intensity = (this.reduced ? 3 : 7) * strength;
    this.muzzleT = 0.05;
  }

  tracer(a, b, color = 0xffd890, life = 0.07) {
    const c = _cv.setHex(color);
    this.tracers.add(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, life);
  }

  // A single glow billboard (charge-ups, eye flares, cores). life ~ one frame for a held glow.
  flare(p, color, size, life = 0.05, mode = 2) {
    const c = _cv.setHex(color);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, size, size, BB.GLOW, BB.GLOW, life, c.r, c.g, c.b, 1, mode === 2 ? FLARE_OPT : FADE_OPT);
  }

  // A four-point star glint (attack release, metal ping): white core tinted toward color.
  glint(p, color, size = 1, life = 0.09) {
    const c = _cv.setHex(color);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, size, size * 0.3, BB.STAR, BB.STAR, life, 0.6 + c.r * 0.4, 0.6 + c.g * 0.4, 0.6 + c.b * 0.4, 1, FLARE_OPT);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, size * 0.8, size * 1.2, BB.GLOW, BB.GLOW, life * 1.6, c.r, c.g, c.b, 0.8, FADE_OPT);
  }

  // Per-surface hits: metal throws bright sparks and a glint, concrete chips and puffs dust,
  // energy fizzes; every hit leaves a hole.
  impact(p, n, surface = 'metal', scale = 1) {
    const low = this.game.lowPower;
    const cnt = Math.round((low ? 4 : 7) * scale * (surface === 'concrete' ? 0.6 : 1));
    let r = 1, g = 0.8, b = 0.4;
    if (surface === 'concrete') { r = 0.8; g = 0.75; b = 0.65; }
    if (surface === 'wood') { r = 0.75; g = 0.55; b = 0.3; }
    if (surface === 'energy') { r = 0.3; g = 1; b = 0.9; }
    for (let i = 0; i < cnt; i++) {
      const s = 3 + Math.random() * 5;
      this.sparks.spawn(p.x, p.y, p.z,
        n.x * s + (Math.random() - 0.5) * 4, n.y * s + (Math.random() - 0.2) * 4, n.z * s + (Math.random() - 0.5) * 4,
        r, g, b, 1, 0.06 + Math.random() * 0.05, 0.18 + Math.random() * 0.2, 14, 1);
    }
    if (surface === 'metal' || surface === 'energy') {
      this.fire.spawn(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, 0, 0, 0, 0.35 * Math.min(1.6, scale + 0.3), 0.15, BB.STAR, BB.STAR, 0.06, r, g, b, 1, FLARE_OPT);
    } else {
      // a little dust cloud hangs in the air where the round struck
      this.smoke.spawn(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, n.x * 0.6, n.y * 0.6 + 0.25, n.z * 0.6, 0.18 * scale + 0.1, 0.5 * scale + 0.25, BB.SMOKE + (Math.random() * 4 | 0), BB.SMOKE + 3, 0.5 + Math.random() * 0.3, r * 0.6, g * 0.6, b * 0.6, 0.7, SMOKE_OPT);
      if (!low && Math.random() < 0.35 * scale) this.chunks(p, surface === 'wood' ? 0x5a4020 : 0x5a5a60, 1, 3, 0.05);
    }
    if (surface !== 'metal' || Math.random() < 0.5) {
      for (let i = 0; i < 2; i++) this.dust.spawn(p.x, p.y, p.z, n.x * 1.2 + (Math.random() - 0.5), n.y * 1.2 + Math.random() * 0.6, n.z * 1.2 + (Math.random() - 0.5),
        r * 0.5, g * 0.5, b * 0.5, 0.6, 0.18, 0.5 + Math.random() * 0.4, -0.5, 2);
    }
    this.decals.add(p.x, p.y, p.z, n.x, n.y, n.z, 0.12 + Math.random() * 0.06, 0x0c0c0c);
  }

  // Blood spray. With gore on a share of the drops is sticky (they paint the floor where they
  // land) and bigger hits leave a hanging mist.
  blood(p, dir, amount = 1, color = [0.75, 0.05, 0.08]) {
    const cnt = Math.round((this.game.lowPower ? 6 : 10) * amount);
    const gore = this.gore;
    const floor = this.floorAt(p.x, p.z, p.y) + 0.02;
    let sticky = gore ? Math.min(4, Math.floor(amount * 1.4 + Math.random() * 1.2)) : 0;
    for (let i = 0; i < cnt; i++) {
      const s = 2 + Math.random() * 5;
      const k = this.dust.spawn(p.x, p.y, p.z,
        dir.x * s + (Math.random() - 0.5) * 4, dir.y * s + Math.random() * 3, dir.z * s + (Math.random() - 0.5) * 4,
        color[0], color[1], color[2], 1, 0.08 + Math.random() * 0.08, 0.5 + Math.random() * 0.5, 16, 0.5, floor);
      if (sticky > 0) { sticky--; this.dust.stick[k] = 1; this.dust.life[k] = this.dust.max[k] = 2.5; }
    }
    if (gore && amount >= 1.2) {
      const m = amount >= 2 ? 2 : 1;
      for (let i = 0; i < m; i++) {
        this.smoke.spawn(p.x + (Math.random() - 0.5) * 0.2, p.y + (Math.random() - 0.5) * 0.2, p.z + (Math.random() - 0.5) * 0.2,
          dir.x * 1.5 + (Math.random() - 0.5), dir.y * 1.5 + 0.3, dir.z * 1.5 + (Math.random() - 0.5),
          0.15 + amount * 0.06, 0.3 + amount * 0.14, BB.MIST, BB.MIST, 0.22 + Math.random() * 0.12, color[0] * 0.7, color[1] * 0.7, color[2] * 0.7, 0.6, MIST_OPT);
      }
    }
  }

  // Paint a splat on the first surface behind p along dir (walls, pillars, the floor).
  splatter(p, dir, size, color, maxDist = 3.5) {
    if (!this.gore) return false;
    const boxes = this.game.level ? this.game.level.colliders : null;
    if (!boxes) return false;
    _rd.copy(dir); if (_rd.lengthSq() < 1e-6) return false; _rd.normalize();
    let best = maxDist, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (!b.active || !b.solid) continue;
      let t0 = 0, t1 = best, ax = -1;
      let fail = false;
      for (let a = 0; a < 3 && !fail; a++) {
        const o = a === 0 ? p.x : a === 1 ? p.y : p.z, d = a === 0 ? _rd.x : a === 1 ? _rd.y : _rd.z;
        const mn = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ, mx = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
        if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) fail = true; continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0) { t0 = ta; ax = a; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) fail = true;
      }
      if (fail || ax < 0 || t0 <= 0.01 || t0 >= best) continue;
      best = t0;
      nx = ax === 0 ? -Math.sign(_rd.x) : 0; ny = ax === 1 ? -Math.sign(_rd.y) : 0; nz = ax === 2 ? -Math.sign(_rd.z) : 0;
    }
    if (best >= maxDist) return false;
    const s = size * (0.7 + best * 0.12) * (0.8 + Math.random() * 0.4);
    this.decals.add(p.x + _rd.x * best, p.y + _rd.y * best, p.z + _rd.z * best, nx, ny, nz, s, color);
    return true;
  }

  // Wet burst for gibs and dismemberment: mist, a fan of sticky drops, splats on the floor
  // and the nearest wall behind the body.
  gibBurst(p, dir, color = [0.7, 0.06, 0.08], scale = 1) {
    if (!this.gore) { this.blood(p, dir, scale, color); return; }
    this.blood(p, _rd.set(dir.x, Math.max(0.4, dir.y), dir.z).normalize(), 2.2 * scale, color);
    const hex = hexOf(color[0] * 0.55, color[1] * 0.55, color[2] * 0.55);
    const floor = this.floorAt(p.x, p.z, p.y);
    const n = Math.round(3 + scale * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.8 * scale;
      this.drops.add(p.x + Math.cos(a) * r + dir.x * r * 0.6, floor + 0.006, p.z + Math.sin(a) * r + dir.z * r * 0.6, 0, 1, 0, 0.25 + Math.random() * 0.45 * scale, hex);
    }
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.3) * 0.6, p.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 2 + dir.x * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2 + dir.z * 2,
        0.3 * scale, 0.9 * scale, BB.MIST, BB.MIST, 0.35 + Math.random() * 0.25, color[0] * 0.75, color[1] * 0.75, color[2] * 0.75, 0.7, MIST_OPT);
    }
    this.splatter(p, _rd.set(dir.x, dir.y * 0.3, dir.z), 1.0 * scale, hex, 4);
  }

  // Robots bleed oil and sparks instead.
  oilBurst(p, dir, scale = 1) {
    this.sparksBurst(p, 0xffc060, Math.round(10 * scale), 7, 0.45, 0.09);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.6 * scale, 1.0 * scale, BB.STAR, BB.STAR, 0.08, 1, 0.85, 0.5, 1, FLARE_OPT);
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 1.2 + dir.x, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2 + dir.z,
        0.3 * scale, 1.0 * scale, BB.SMOKE + (Math.random() * 4 | 0), BB.SMOKE + 3, 0.9 + Math.random() * 0.6, 0.12, 0.11, 0.1, 0.9, SMOKE_OPT);
    }
    if (this.gore) {
      const floor = this.floorAt(p.x, p.z, p.y);
      for (let i = 0; i < 3; i++) this.drops.add(p.x + (Math.random() - 0.5) * 1.4, floor + 0.006, p.z + (Math.random() - 0.5) * 1.4, 0, 1, 0, 0.3 + Math.random() * 0.4, 0x0b0a08);
    }
  }

  sparksBurst(p, color, count = 12, speed = 6, life = 0.4, size = 0.1) {
    const c = _cv.setHex(color);
    const r = c.r, g = c.g, b = c.b;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.sparks.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, r, g, b, 1, size, life * (0.5 + Math.random() * 0.5), 6, 1.5, 0.02);
    }
  }

  // Layered blast: white flash, a cluster of burning fireball billboards that burn out, a hot
  // shell, embers, debris, a shock ring and rolling dithered smoke that rises after the fire.
  explosion(p, radius, color = 0xff8a30) {
    const reduce = this.reduced;
    const low = this.game.lowPower;
    const c = _cv.setHex(color);
    const cr = c.r, cg = c.g, cb = c.b;
    // natural fire for warm blasts, tinted plasma for cold ones (white keeps the fire ramp)
    const warm = (cr >= 0.8 && cb <= 0.55) || (cr > 0.9 && cg > 0.9 && cb > 0.9);
    const tint = warm ? 0 : 0.75;
    const fr = tint ? cr : 1, fg = tint ? cg : 1, fb = tint ? cb : 1;
    const it = this.balls.get();
    it.mesh.position.copy(p);
    it.mesh.material.color.setHex(color);
    it.mesh.material.opacity = 1;
    it.mesh.visible = true;
    it.life = it.max = 0.32;
    it.update = (o, t) => {
      const s = radius * (0.3 + 0.75 * Math.pow(t, 0.4));
      o.mesh.scale.set(s, s, s);
      o.mesh.material.opacity = (1 - t) * (reduce ? 0.35 : 0.6);
      o.mesh.rotation.y += 0.05;
    };
    // flash
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, radius * (reduce ? 1.2 : 2.2), radius * 1.3, BB.STAR, BB.STAR, reduce ? 0.06 : 0.1, 1, 1, 0.9, reduce ? 0.5 : 1, FLARE_OPT);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, radius * 1.6, radius * 2.4, BB.GLOW, BB.GLOW, 0.28, cr, cg * 0.85, cb * 0.7, reduce ? 0.4 : 0.8, FADE_OPT);
    // fireballs
    const nf = Math.max(3, Math.min(low ? 6 : 10, Math.round(3 + radius * 1.4)));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, rr = radius * (0.12 + Math.random() * 0.3);
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
      const sp = radius * (0.8 + Math.random() * 1.4);
      const life = 0.4 + Math.random() * 0.35 + radius * 0.03;
      this.fire.spawn(p.x + dx * rr, p.y + dy * rr, p.z + dz * rr, dx * sp, dy * sp + 0.8, dz * sp,
        radius * (0.45 + Math.random() * 0.25), radius * (0.9 + Math.random() * 0.5), BB.FIRE0, BB.FIRE1 + 0.9, life, fr, fg, fb, 1,
        { tint, spin: (Math.random() - 0.5) * 3, drag: 4, grav: -1.5, delay: i * 0.012 });
    }
    // smoke rolls up as the fire dies
    const ns = Math.max(2, Math.min(low ? 4 : 7, Math.round(1 + radius)));
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2, rr = radius * Math.random() * 0.45;
      const g = 0.2 + Math.random() * 0.08;
      this.smoke.spawn(p.x + Math.cos(a) * rr, p.y + Math.random() * radius * 0.3, p.z + Math.sin(a) * rr,
        Math.cos(a) * radius * 0.5, 1 + Math.random() * 1.5, Math.sin(a) * radius * 0.5,
        radius * 0.6, radius * (1.5 + Math.random() * 0.7), BB.SMOKE + (Math.random() * 4 | 0), BB.SMOKE + 3.9, 1.3 + Math.random() * 1.1,
        g + cr * 0.03, g, g, 0.95, { mode: 1, drag: 1.4, grav: -0.5, spin: (Math.random() - 0.5) * 0.8, delay: 0.08 + Math.random() * 0.14 });
    }
    this.ring(p.x, Math.max(p.y - 0.3, this.floorAt(p.x, p.z, p.y) + 0.05), p.z, radius * 1.1, color, 0.4, 0.2);
    // embers
    const n = low ? 18 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.6;
      const s = radius * (2 + Math.random() * 4);
      this.sparks.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, cr, cg * 0.9, cb * 0.6, 1, 0.12 + Math.random() * 0.1, 0.3 + Math.random() * 0.5, 10, 2, 0.02);
    }
    if (radius >= 2) this.chunks(p, 0x2a2622, low ? 2 : 4, radius * 3, 0.1);
    this.boomLight.position.copy(p);
    this.boomLight.color.setHex(color);
    this.boomT = 0.35;
    const floor = this.floorAt(p.x, p.z, p.y);
    if (p.y - floor < 1.2) this.decals.add(p.x, floor, p.z, 0, 1, 0, radius * 0.9, 0x080808);
  }

  ring(x, y, z, radius, color, life, startFrac = 0) {
    const it = this.rings.get();
    it.mesh.position.set(x, y, z);
    it.mesh.material.color.setHex(color);
    it.mesh.visible = true;
    it.life = it.max = life;
    it.update = (o, t) => { const s = radius * (startFrac + (1 - startFrac) * t); o.mesh.scale.set(s, 1, s); o.mesh.material.opacity = 1 - t; };
    it.update(it, 0, 0);
    return it;
  }

  // Ground telegraph circle that fills up over `life` seconds. An outer ring closes in on the
  // edge and lands exactly when the attack does, so the timing reads at a glance.
  telegraphDisc(x, y, z, radius, color, life) {
    const it = this.discs.get();
    it.mesh.position.set(x, y + 0.03, z);
    it.mesh.material.color.setHex(color);
    it.mesh.visible = true;
    it.life = it.max = life;
    it.update = (o, t) => { const s = radius * (0.2 + 0.8 * t); o.mesh.scale.set(s, 1, s); o.mesh.material.opacity = 0.18 + 0.35 * t; };
    it.update(it, 0, 0);
    const r = this.rings.get();
    r.mesh.position.set(x, y + 0.04, z);
    r.mesh.material.color.setHex(color);
    r.mesh.visible = true;
    r.life = r.max = life;
    r.update = (o, t) => { o.mesh.scale.set(radius, 1, radius); o.mesh.material.opacity = 0.5 + 0.5 * Math.sin(t * 30); };
    r.update(r, 0, 0);
    if (life >= 0.3) {
      const q = this.rings.get();
      q.mesh.position.set(x, y + 0.05, z);
      q.mesh.material.color.setHex(0xffffff);
      q.mesh.visible = true;
      q.life = q.max = life;
      q.update = (o, t) => { const s = radius * (1.7 - 0.7 * t * t); o.mesh.scale.set(s, 1, s); o.mesh.material.opacity = 0.15 + 0.6 * t; };
      q.update(q, 0, 0);
    }
    return it;
  }

  beam(a, b, color, width, life, fade = true) {
    const it = this.beams.get();
    const m = it.mesh;
    m.position.copy(a);
    const len = a.distanceTo(b);
    m.lookAt(b);
    m.scale.set(width, width, len);
    m.material.color.setHex(color);
    m.material.opacity = 1;
    m.visible = true;
    it.life = it.max = life;
    it.update = fade ? (o, t) => { o.mesh.material.opacity = 1 - t; const w = width * (1 - t * 0.7); o.mesh.scale.x = w; o.mesh.scale.y = w; } : null;
    return it;
  }

  spawnColumn(x, y, z, color, life, height = 4) {
    const it = this.columns.get();
    it.mesh.position.set(x, y, z);
    it.mesh.material.color.setHex(color);
    it.mesh.visible = true;
    it.life = it.max = life;
    it.update = (o, t) => {
      const w = 0.15 + Math.sin(t * Math.PI) * 0.9;
      o.mesh.scale.set(w, height * (0.3 + t), w);
      o.mesh.material.opacity = Math.sin(t * Math.PI) * 0.55;
      o.mesh.rotation.y += 0.2;
    };
    it.update(it, 0, 0);
  }

  // Teleport-in: a floor sigil ring tightens, motes stream upward and a flash pops when the
  // body arrives (the actor animates its own rise / materialise).
  spawnIn(x, y, z, color, height = 2, radius = 0.8, life = 0.9) {
    const c = _cv.setHex(color);
    const it = this.rings.get();
    it.mesh.position.set(x, y + 0.04, z);
    it.mesh.material.color.setHex(color);
    it.mesh.visible = true;
    it.life = it.max = life;
    it.update = (o, t) => { const s = radius * (2.2 - 1.2 * Math.min(1, t * 2)); o.mesh.scale.set(s, 1, s); o.mesh.material.opacity = t < 0.5 ? 0.35 + 1.3 * t : (1 - t) * 2; o.mesh.rotation.y += 0.1; };
    it.update(it, 0, 0);
    const n = this.game.lowPower ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * (0.4 + Math.random() * 0.8);
      this.sparks.spawn(x + Math.cos(a) * r, y + Math.random() * 0.3, z + Math.sin(a) * r, -Math.cos(a) * 0.4, height * (1 + Math.random()), -Math.sin(a) * 0.4,
        c.r, c.g, c.b, 1, 0.08 + Math.random() * 0.06, 0.4 + Math.random() * 0.5, -1, 1.5);
    }
    this.fire.spawn(x, y + height * 0.5, z, 0, 0, 0, height * 0.5, height * 1.4, BB.GLOW, BB.GLOW, 0.35, c.r, c.g, c.b, 0.9, { delay: life * 0.5, mode: 0 });
    this.fire.spawn(x, y + height * 0.55, z, 0, 0, 0, height * 0.9, height * 0.4, BB.STAR, BB.STAR, 0.12, 1, 1, 1, 0.8, { delay: life * 0.5, mode: 2 });
  }

  chunks(p, color, count, speed = 6, size = 0.12) {
    const c = _cv.setHex(color);
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisI];
      const idx = this.debrisI;
      this.debrisI = (this.debrisI + 1) % this.debrisCap;
      d.life = 4 + Math.random() * 2;
      d.p.copy(p);
      d.v.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 1, (Math.random() - 0.5) * speed);
      d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.w.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      d.s = size * (0.6 + Math.random() * 0.8);
      d.floor = 0;
      this.debrisMesh.setColorAt(idx, c);
    }
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  updateDebris(dt) {
    const boxes = this.game.level ? this.game.level.colliders : [];
    for (let i = 0; i < this.debrisCap; i++) {
      const d = this.debris[i];
      if (d.life <= 0) { this.tmpM.makeScale(0, 0, 0); this.debrisMesh.setMatrixAt(i, this.tmpM); continue; }
      d.life -= dt;
      const resting = d.v.lengthSq() < 0.01 && d.p.y <= d.floor + d.s;
      if (!resting) {
        d.v.y -= 22 * dt;
        d.p.addScaledVector(d.v, dt);
        // find floor under the chunk
        let floor = -50;
        for (let k = 0; k < boxes.length; k++) {
          const b = boxes[k];
          if (!b.active || !b.solid) continue;
          if (d.p.x > b.minX && d.p.x < b.maxX && d.p.z > b.minZ && d.p.z < b.maxZ && b.maxY <= d.p.y + 0.3 && b.maxY > floor) floor = b.maxY;
        }
        d.floor = floor;
        if (d.p.y - d.s * 0.5 < floor) {
          d.p.y = floor + d.s * 0.5;
          d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
          if (Math.abs(d.v.y) < 0.6) d.v.y = 0;
        }
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      }
      const s = d.s * Math.min(1, d.life);
      this.tmpQ.setFromEuler(d.r);
      this.tmpS.set(s, s, s);
      this.tmpM.compose(d.p, this.tmpQ, this.tmpS);
      this.debrisMesh.setMatrixAt(i, this.tmpM);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  // Turn enemy part meshes into physical corpse pieces that tumble and settle.
  // opts.bleed: blood colour (the piece trails sticky drops and splats where it lands);
  // opts.spark: the piece trails sparks and smoke (robot parts).
  // A whole limb (a bone group with its children) is wrapped in a holder centred on its bounds,
  // so it tumbles about its middle and settles on the floor instead of its joint.
  addCorpsePiece(mesh, vel, spin, opts) {
    if (!mesh.isMesh) {
      mesh.updateWorldMatrix(true, true);
      const holder = new THREE.Group();
      _bx.setFromObject(mesh).getCenter(holder.position);
      this.game.scene.add(holder);
      holder.updateMatrixWorld(true);
      holder.attach(mesh);
      mesh = holder;
    } else {
      mesh.updateWorldMatrix(true, false);
      mesh.matrixWorld.decompose(_wp, _wq, _ws);
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.position.copy(_wp); mesh.quaternion.copy(_wq); mesh.scale.copy(_ws);
      this.game.scene.add(mesh);
    }
    const box = _bx.setFromObject(mesh);
    const half = Math.max(0.05, (box.max.y - box.min.y) * 0.5);
    const piece = { mesh, v: vel.clone(), w: spin.clone(), half, rest: false, t: 0, bleed: null, spark: false, trailT: 0, own: false };
    // opts.own: the piece's geometry belongs to it alone (bespoke boss wreckage) and is freed with it
    if (opts) { piece.bleed = opts.bleed && this.gore ? opts.bleed : null; piece.spark = !!opts.spark; piece.own = !!opts.own; }
    this.corpses.push(piece);
    while (this.corpses.length > this.corpseCap) this.dropCorpse(this.corpses.shift());
    return piece;
  }
  dropCorpse(c) {
    this.game.scene.remove(c.mesh);
    if (c.own) c.mesh.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }

  // a pool that spreads under a body (blood, or oil for machines)
  pool(x, y, z, size, color, grow = 2.2) {
    if (!this.gore) return;
    this.pools.add(x, y + 0.008, z, 0, 1, 0, size, color, grow);
  }

  updateCorpses(dt) {
    const boxes = this.game.level ? this.game.level.colliders : [];
    for (const c of this.corpses) {
      if (c.rest) continue;
      c.t += dt;
      const p = c.mesh.position;
      c.v.y -= 22 * dt;
      p.addScaledVector(c.v, dt);
      let floor = -50;
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        if (!b.active || !b.solid) continue;
        if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && b.maxY <= p.y + 0.4 && b.maxY > floor) floor = b.maxY;
        // keep pieces out of walls (simple push back)
        if (p.y > b.minY && p.y < b.maxY && p.x > b.minX - 0.05 && p.x < b.maxX + 0.05 && p.z > b.minZ - 0.05 && p.z < b.maxZ + 0.05 && b.maxY > p.y + 0.4) {
          c.v.x *= -0.4; c.v.z *= -0.4; p.addScaledVector(c.v, dt * 2);
        }
      }
      // trails while airborne: blood drops or sparks and smoke
      if ((c.bleed || c.spark) && c.t < 1.6) {
        c.trailT -= dt;
        if (c.trailT <= 0) {
          c.trailT = 0.035;
          if (c.bleed) {
            const k = this.dust.spawn(p.x, p.y, p.z, c.v.x * 0.2 + (Math.random() - 0.5), c.v.y * 0.2, c.v.z * 0.2 + (Math.random() - 0.5), c.bleed[0], c.bleed[1], c.bleed[2], 1, 0.09 + Math.random() * 0.05, 2.5, 16, 0.5, floor + 0.02);
            if (Math.random() < 0.5) this.dust.stick[k] = 1;
          } else {
            this.sparks.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 1, 0.75, 0.35, 1, 0.07, 0.35, 10, 0.5);
            if (Math.random() < 0.3) this.smoke.spawn(p.x, p.y, p.z, 0, 0.6, 0, 0.15, 0.5, BB.SMOKE + (Math.random() * 4 | 0), BB.SMOKE + 3, 0.7, 0.1, 0.1, 0.1, 0.9, SMOKE_OPT);
          }
        }
      }
      const h = c.half * 0.6;
      if (p.y - h < floor) {
        // first hard landing of a bleeding piece leaves a splat
        if (c.bleed && c.v.y < -4) {
          const bc = c.bleed;
          this.drops.add(p.x, floor + 0.005, p.z, 0, 1, 0, 0.35 + Math.min(0.5, -c.v.y * 0.04), hexOf(bc[0] * 0.6, bc[1] * 0.6, bc[2] * 0.6));
        }
        p.y = floor + h;
        c.v.y *= -0.25; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5);
        if (Math.abs(c.v.y) < 0.8 && c.v.lengthSq() < 0.5) { c.rest = true; }
      }
      c.mesh.rotation.x += c.w.x * dt; c.mesh.rotation.y += c.w.y * dt; c.mesh.rotation.z += c.w.z * dt;
      if (c.t > 5) c.rest = true;
    }
  }

  clearCorpses() {
    for (const c of this.corpses) this.dropCorpse(c);
    this.corpses.length = 0;
  }
}

// shared billboard spawn options (no per-call allocation)
const FLARE_OPT = { mode: 2, rot: 0 };
const FADE_OPT = { mode: 0 };
const SMOKE_OPT = { mode: 1, drag: 1.5, grav: -0.3 };
const MIST_OPT = { mode: 0, drag: 3, grav: 1.5 };
