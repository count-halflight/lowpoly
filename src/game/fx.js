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
          i--;
        }
        continue;
      }
      const i3 = i * 3, i4 = i * 4;
      const d = 1 - this.drag[i] * dt;
      V[i3] *= d; V[i3 + 1] = V[i3 + 1] * d - this.grav[i] * dt; V[i3 + 2] *= d;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < this.floorY[i]) { P[i3 + 1] = this.floorY[i]; V[i3 + 1] *= -0.3; V[i3] *= 0.6; V[i3 + 2] *= 0.6; }
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

class Decals {
  constructor(scene, cap) {
    this.cap = cap;
    this.i = 0;
    const g = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: false });
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
  add(x, y, z, nx, ny, nz, size, color) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    this.n.set(nx, ny, nz);
    this.q.setFromUnitVectors(this.z, this.n);
    const spin = new THREE.Quaternion().setFromAxisAngle(this.n, Math.random() * Math.PI);
    this.q.premultiply(spin);
    this.v.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    this.s.set(size, size, size);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.c.setHex(color);
    this.mesh.setColorAt(i, this.c);
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = 0; this.i = 0;
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

export class FX {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const mobile = game.lowPower;
    this.sparks = new ParticleSystem(scene, mobile ? 500 : 900, true);
    this.dust = new ParticleSystem(scene, mobile ? 400 : 700, false);
    this.tracers = new Tracers(scene, 64);
    this.decals = new Decals(scene, mobile ? 96 : 160);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0, -0.5); // so scale.z = length along -z (lookAt)
    this.beams = new MeshPool(scene, box, () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 24);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    this.balls = new MeshPool(scene, ico, () => psxify(new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 16);
    const ring = new THREE.RingGeometry(0.85, 1, 24, 1);
    ring.rotateX(-Math.PI / 2);
    this.rings = new MeshPool(scene, ring, () => new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), 20);
    const disc = new THREE.CircleGeometry(1, 20);
    disc.rotateX(-Math.PI / 2);
    this.discs = new MeshPool(scene, disc, () => new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }), 24);
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

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
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
    this.sparks.clear(); this.dust.clear(); this.tracers.clear(); this.decals.clear();
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
    const c = new THREE.Color(color);
    this.tracers.add(a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, life);
  }

  impact(p, n, surface = 'metal', scale = 1) {
    const cnt = Math.round((this.game.lowPower ? 4 : 7) * scale);
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
    if (surface !== 'metal' || Math.random() < 0.5) {
      for (let i = 0; i < 2; i++) this.dust.spawn(p.x, p.y, p.z, n.x * 1.2 + (Math.random() - 0.5), n.y * 1.2 + Math.random() * 0.6, n.z * 1.2 + (Math.random() - 0.5),
        r * 0.5, g * 0.5, b * 0.5, 0.6, 0.18, 0.5 + Math.random() * 0.4, -0.5, 2);
    }
    this.decals.add(p.x, p.y, p.z, n.x, n.y, n.z, 0.12 + Math.random() * 0.06, 0x0c0c0c);
  }

  blood(p, dir, amount = 1, color = [0.75, 0.05, 0.08]) {
    const cnt = Math.round((this.game.lowPower ? 6 : 10) * amount);
    for (let i = 0; i < cnt; i++) {
      const s = 2 + Math.random() * 5;
      this.dust.spawn(p.x, p.y, p.z,
        dir.x * s + (Math.random() - 0.5) * 4, dir.y * s + Math.random() * 3, dir.z * s + (Math.random() - 0.5) * 4,
        color[0], color[1], color[2], 1, 0.08 + Math.random() * 0.08, 0.5 + Math.random() * 0.5, 16, 0.5, 0.02);
    }
  }

  sparksBurst(p, color, count = 12, speed = 6, life = 0.4, size = 0.1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.sparks.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, c.r, c.g, c.b, 1, size, life * (0.5 + Math.random() * 0.5), 6, 1.5, 0.02);
    }
  }

  explosion(p, radius, color = 0xff8a30) {
    const reduce = this.reduced;
    const it = this.balls.get();
    it.mesh.position.copy(p);
    it.mesh.material.color.setHex(color);
    it.mesh.material.opacity = 1;
    it.mesh.visible = true;
    it.life = it.max = 0.45;
    it.update = (o, t) => {
      const s = radius * (0.3 + 0.9 * Math.pow(t, 0.4));
      o.mesh.scale.set(s, s, s);
      o.mesh.material.opacity = (1 - t) * (reduce ? 0.5 : 0.95);
      o.mesh.rotation.y += 0.05;
    };
    const it2 = this.balls.get();
    it2.mesh.position.copy(p);
    it2.mesh.material.color.setHex(0xfff0c0);
    it2.mesh.visible = true;
    it2.life = it2.max = 0.18;
    it2.update = (o, t) => { const s = radius * 0.5 * (0.5 + t); o.mesh.scale.set(s, s, s); o.mesh.material.opacity = (1 - t); };
    this.ring(p.x, Math.max(p.y - 0.3, 0.05), p.z, radius, color, 0.4, 0.2);
    const c = new THREE.Color(color);
    const n = this.game.lowPower ? 18 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.6;
      const s = radius * (2 + Math.random() * 4);
      this.sparks.spawn(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, c.r, c.g * 0.9, c.b * 0.6, 1, 0.12 + Math.random() * 0.1, 0.3 + Math.random() * 0.4, 10, 2, 0.02);
    }
    for (let i = 0; i < (this.game.lowPower ? 6 : 12); i++) {
      this.dust.spawn(p.x + (Math.random() - 0.5) * radius, p.y + Math.random() * radius * 0.5, p.z + (Math.random() - 0.5) * radius,
        (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.12, 0.1, 0.1, 0.7, 0.6 + Math.random() * 0.5, 1 + Math.random(), -0.4, 1.5);
    }
    this.boomLight.position.copy(p);
    this.boomLight.color.setHex(color);
    this.boomT = 0.35;
    if (p.y < 1.2) this.decals.add(p.x, 0.0, p.z, 0, 1, 0, radius * 0.9, 0x080808);
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

  // Ground telegraph circle that fills up over `life` seconds.
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

  chunks(p, color, count, speed = 6, size = 0.12) {
    const c = new THREE.Color(color);
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
  addCorpsePiece(mesh, vel, spin) {
    mesh.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    mesh.matrixWorld.decompose(wp, wq, ws);
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.position.copy(wp); mesh.quaternion.copy(wq); mesh.scale.copy(ws);
    this.game.scene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    const half = Math.max(0.05, (box.max.y - box.min.y) * 0.5);
    this.corpses.push({ mesh, v: vel.clone(), w: spin.clone(), half, rest: false, t: 0 });
    while (this.corpses.length > this.corpseCap) {
      const c = this.corpses.shift();
      this.game.scene.remove(c.mesh);
    }
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
      const h = c.half * 0.6;
      if (p.y - h < floor) {
        p.y = floor + h;
        c.v.y *= -0.25; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5);
        if (Math.abs(c.v.y) < 0.8 && c.v.lengthSq() < 0.5) { c.rest = true; }
      }
      c.mesh.rotation.x += c.w.x * dt; c.mesh.rotation.y += c.w.y * dt; c.mesh.rotation.z += c.w.z * dt;
      if (c.t > 5) c.rest = true;
    }
  }

  clearCorpses() {
    for (const c of this.corpses) this.game.scene.remove(c.mesh);
    this.corpses.length = 0;
  }
}
