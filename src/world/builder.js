import * as THREE from 'three';

// Accumulates boxes/prisms per material and emits one merged mesh per material.
// UVs are world-scaled so textures tile consistently regardless of box size.

const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32;
export const FACES = { PX: FACE_PX, NX: FACE_NX, PY: FACE_PY, NY: FACE_NY, PZ: FACE_PZ, NZ: FACE_NZ, ALL: 63 };

export class GeoBuilder {
  constructor(texWorldSize = 2) {
    this.buckets = new Map();
    this.tws = texWorldSize;
  }
  bucket(mat) {
    let b = this.buckets.get(mat);
    if (!b) { b = { pos: [], nrm: [], uv: [], col: [], idx: [] }; this.buckets.set(mat, b); }
    return b;
  }
  quad(b, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, uvs, r, g, bl) {
    const i = b.pos.length / 3;
    b.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 4; k++) { b.nrm.push(nx, ny, nz); b.col.push(r, g, bl); }
    b.uv.push(...uvs);
    b.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** Axis aligned box. tint: number (scalar) or [r,g,b]. */
  box(x0, y0, z0, x1, y1, z1, mat, opts = {}) {
    const b = this.bucket(mat);
    const faces = opts.faces === undefined ? 63 : opts.faces;
    const t = opts.tint === undefined ? 1 : opts.tint;
    const r = Array.isArray(t) ? t[0] : t, g = Array.isArray(t) ? t[1] : t, bl = Array.isArray(t) ? t[2] : t;
    const s = opts.uvScale ? this.tws / opts.uvScale : this.tws;
    const u = (v) => v / s;
    if (faces & FACE_PX) this.quad(b, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0,
      [u(-z1), u(y0), u(-z0), u(y0), u(-z0), u(y1), u(-z1), u(y1)], r, g, bl);
    if (faces & FACE_NX) this.quad(b, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0,
      [u(z0), u(y0), u(z1), u(y0), u(z1), u(y1), u(z0), u(y1)], r, g, bl);
    if (faces & FACE_PY) this.quad(b, x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0,
      [u(x0), u(-z1), u(x1), u(-z1), u(x1), u(-z0), u(x0), u(-z0)], r, g, bl);
    if (faces & FACE_NY) this.quad(b, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0,
      [u(x0), u(z0), u(x1), u(z0), u(x1), u(z1), u(x0), u(z1)], r, g, bl);
    if (faces & FACE_PZ) this.quad(b, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1,
      [u(x0), u(y0), u(x1), u(y0), u(x1), u(y1), u(x0), u(y1)], r, g, bl);
    if (faces & FACE_NZ) this.quad(b, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1,
      [u(-x1), u(y0), u(-x0), u(y0), u(-x0), u(y1), u(-x1), u(y1)], r, g, bl);
  }
  /** Low-poly cylinder along an axis ('y' vertical, 'x' or 'z' horizontal). */
  cylinder(cx, cy, cz, radius, length, axis, segs, mat, opts = {}) {
    const b = this.bucket(mat);
    const t = opts.tint === undefined ? 1 : opts.tint;
    const r = Array.isArray(t) ? t[0] : t, g = Array.isArray(t) ? t[1] : t, bl = Array.isArray(t) ? t[2] : t;
    const half = length / 2;
    const map = (a, c, l) => { // a, c are circle coords, l along axis
      if (axis === 'y') return [cx + a, cy + l, cz + c];
      if (axis === 'x') return [cx + l, cy + a, cz + c];
      return [cx + a, cy + c, cz + l];
    };
    const circ = 2 * Math.PI * radius;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2 + (opts.rot || 0), a1 = ((i + 1) / segs) * Math.PI * 2 + (opts.rot || 0);
      const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius], p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
      const am = (a0 + a1) / 2;
      const n = map(Math.cos(am), Math.sin(am), 0); n[0] -= cx; n[1] -= cy; n[2] -= cz;
      const A = map(p0[0], p0[1], -half), B = map(p1[0], p1[1], -half), C = map(p1[0], p1[1], half), D = map(p0[0], p0[1], half);
      const u0 = (i / segs) * circ / this.tws, u1 = ((i + 1) / segs) * circ / this.tws, v0 = 0, v1 = length / this.tws;
      // winding: ensure outward facing
      const flip = axis !== 'y';
      if (!flip) this.quad(b, ...D, ...C, ...B, ...A, n[0], n[1], n[2], [u0, v1, u1, v1, u1, v0, u0, v0], r, g, bl);
      else this.quad(b, ...A, ...B, ...C, ...D, n[0], n[1], n[2], [u0, v0, u1, v0, u1, v1, u0, v1], r, g, bl);
      if (opts.caps !== false) {
        // caps as triangles (degenerate quads)
        const ctop = map(0, 0, half), cbot = map(0, 0, -half);
        const nt = map(0, 0, 1); nt[0] -= cx; nt[1] -= cy; nt[2] -= cz;
        if (flip) {
          this.quad(b, ...ctop, ...ctop, ...D, ...C, nt[0], nt[1], nt[2], [0.5, 0.5, 0.5, 0.5, p0[0], p0[1], p1[0], p1[1]], r, g, bl);
          this.quad(b, ...cbot, ...cbot, ...B, ...A, -nt[0], -nt[1], -nt[2], [0.5, 0.5, 0.5, 0.5, p1[0], p1[1], p0[0], p0[1]], r, g, bl);
        } else {
          this.quad(b, ...ctop, ...ctop, ...C, ...D, nt[0], nt[1], nt[2], [0.5, 0.5, 0.5, 0.5, p1[0], p1[1], p0[0], p0[1]], r, g, bl);
          this.quad(b, ...cbot, ...cbot, ...A, ...B, -nt[0], -nt[1], -nt[2], [0.5, 0.5, 0.5, 0.5, p0[0], p0[1], p1[0], p1[1]], r, g, bl);
        }
      }
    }
  }
  build() {
    const group = new THREE.Group();
    const geos = [];
    for (const [mat, b] of this.buckets) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.idx.length > 65000 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      geos.push(g);
    }
    return { group, geos };
  }
}
