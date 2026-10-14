import * as THREE from 'three';
import { GeoBuilder, FACES } from './builder.js';
import { generateSpec, COMBAT_ARCHES } from './rooms.js';
import { THEMES, themeMaterials, sharedMaterials } from '../render/materials.js';
import { makeBox } from '../core/collide.js';
import { RNG, hashSeed } from '../core/rng.js';
import { psxify } from '../render/renderer.js';

const DOOR_W = 3, DOOR_H = 3.6, WALL_T = 1, CORR_L = 8, CORR_HW = 2, CORR_H = 4.4;

// --------------------------------------------------------------------------------------
// Navigation grid (1m cells) with BFS flow field toward the player.
// --------------------------------------------------------------------------------------
export class NavGrid {
  constructor(room) {
    this.room = room;
    this.cell = 1;
    this.nx = Math.ceil(room.spec.W);
    this.nz = Math.ceil(room.spec.D);
    this.ox = room.origin.x - room.spec.W / 2;
    this.oz = room.origin.z - room.spec.D / 2;
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.dist = new Int16Array(this.nx * this.nz).fill(-1);
    this.queue = new Int32Array(this.nx * this.nz);
  }
  build(colliders) {
    const pad = 0.45;
    for (const b of colliders) {
      if (!b.nav || !b.active) continue;
      if (b.maxY <= 0.45 || b.minY >= 2.0) continue;
      const i0 = Math.max(0, Math.floor((b.minX - pad - this.ox) / this.cell));
      const i1 = Math.min(this.nx - 1, Math.floor((b.maxX + pad - this.ox) / this.cell));
      const j0 = Math.max(0, Math.floor((b.minZ - pad - this.oz) / this.cell));
      const j1 = Math.min(this.nz - 1, Math.floor((b.maxZ + pad - this.oz) / this.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        // only block if cell centre is within padded box (more precise than the overlap)
        const cx = this.ox + (i + 0.5) * this.cell, cz = this.oz + (j + 0.5) * this.cell;
        if (cx > b.minX - pad && cx < b.maxX + pad && cz > b.minZ - pad && cz < b.maxZ + pad) this.blocked[j * this.nx + i] = 1;
      }
    }
    // border cells are too close to walls
    for (let i = 0; i < this.nx; i++) { this.blocked[i] = 1; this.blocked[(this.nz - 1) * this.nx + i] = 1; }
    for (let j = 0; j < this.nz; j++) { this.blocked[j * this.nx] = 1; this.blocked[j * this.nx + this.nx - 1] = 1; }
  }
  idx(x, z) {
    const i = Math.floor((x - this.ox) / this.cell), j = Math.floor((z - this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  center(k, out) { out.x = this.ox + ((k % this.nx) + 0.5) * this.cell; out.z = this.oz + (Math.floor(k / this.nx) + 0.5) * this.cell; return out; }
  free(k) { return k >= 0 && !this.blocked[k]; }
  nearestFree(x, z, maxR = 5) {
    const k = this.idx(Math.max(this.ox + 0.5, Math.min(this.ox + this.nx - 0.5, x)), Math.max(this.oz + 0.5, Math.min(this.oz + this.nz - 0.5, z)));
    if (k < 0) return -1;
    if (!this.blocked[k]) return k;
    const ci = k % this.nx, cj = Math.floor(k / this.nx);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const kk = j * this.nx + i;
        if (this.blocked[kk]) continue;
        const d = (i - ci) * (i - ci) + (j - cj) * (j - cj);
        if (d < bd) { bd = d; best = kk; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // BFS distance field from a world position
  flow(x, z) {
    const start = this.nearestFree(x, z, 6);
    this.dist.fill(-1);
    if (start < 0) return;
    const q = this.queue, nx = this.nx, nz = this.nz;
    let h = 0, t = 0;
    q[t++] = start; this.dist[start] = 0;
    while (h < t) {
      const k = q[h++];
      const i = k % nx, j = (k / nx) | 0, d = this.dist[k] + 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const kk = jj * nx + ii;
        if (this.blocked[kk] || this.dist[kk] >= 0) continue;
        if (di && dj && (this.blocked[j * nx + ii] || this.blocked[jj * nx + i])) continue; // no corner cutting
        this.dist[kk] = d; q[t++] = kk;
      }
    }
  }
  // Returns the world-space centre of the next cell toward the flow target, or null.
  step(x, z, out) {
    let k = this.idx(x, z);
    if (k < 0 || this.blocked[k] || this.dist[k] < 0) { k = this.nearestFree(x, z, 3); if (k < 0) return null; return this.center(k, out); }
    const nx = this.nx, i = k % nx, j = (k / nx) | 0;
    let best = k, bd = this.dist[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= this.nz) continue;
      const kk = jj * nx + ii;
      if (this.blocked[kk] || this.dist[kk] < 0) continue;
      if (di && dj && (this.blocked[j * nx + ii] || this.blocked[jj * nx + i])) continue;
      if (this.dist[kk] < bd) { bd = this.dist[kk]; best = kk; }
    }
    if (best === k) return null;
    return this.center(best, out);
  }
  reachable(fromX, fromZ, toX, toZ) {
    this.flow(fromX, fromZ);
    const k = this.nearestFree(toX, toZ, 2);
    return k >= 0 && this.dist[k] >= 0;
  }
}

// --------------------------------------------------------------------------------------
// Room: builds geometry from a spec at a world origin; owns colliders, doors, hazards.
// --------------------------------------------------------------------------------------

export class Room {
  constructor(level, index, spec, origin, theme, hasCorridor) {
    this.level = level;
    this.game = level.game;
    this.index = index;
    this.spec = spec;
    this.origin = origin.clone();
    this.theme = theme;
    this.hasCorridor = hasCorridor;
    this.colliders = [];
    this.doors = [];
    this.exitDoors = [];
    this.hazards = [];
    this.sliders = [];
    this.sweepers = [];
    this.breakables = [];
    this.disposables = [];
    this.group = new THREE.Group();
    this.group.position.copy(origin);
    this.state = 'idle'; // idle -> combat -> cleared
    this.chosenExit = -1;
    this.routes = [];
    this.time = 0;
    this.build();
    this.nav = new NavGrid(this);
    this.nav.build(this.colliders);
  }

  get W() { return this.spec.W; }
  get D() { return this.spec.D; }

  // local -> world helpers
  wx(x) { return this.origin.x + x; }
  wz(z) { return this.origin.z + z; }

  addCollider(x0, y0, z0, x1, y1, z1, opts) {
    const b = makeBox(this.wx(x0), y0, this.wz(z0), this.wx(x1), y1, this.wz(z1), opts);
    this.colliders.push(b);
    return b;
  }

  build() {
    const s = this.spec, T = WALL_T;
    const M = themeMaterials(this.theme);
    const gb = new GeoBuilder(2);
    const { W, D, H } = s;
    const rng = new RNG(hashSeed('roomdecor', this.index, this.level.seed));

    // floor / ceiling
    gb.box(-W / 2 - T, -1, -D / 2 - T, W / 2 + T, 0, D / 2 + T, M.floor, { faces: FACES.PY });
    this.addCollider(-W / 2 - T, -1, -D / 2 - T, W / 2 + T, 0, D / 2 + T, { surface: this.theme.floorTex === 'grate' ? 'metal' : 'concrete', nav: false });
    gb.box(-W / 2 - T, H, -D / 2 - T, W / 2 + T, H + 1, D / 2 + T, M.ceiling, { faces: FACES.NY });
    this.addCollider(-W / 2 - T, H, -D / 2 - T, W / 2 + T, H + 1, D / 2 + T, { nav: false });

    // side walls
    const wall = (x0, y0, z0, x1, y1, z1) => {
      gb.box(x0, y0, z0, x1, y1, z1, M.wall, { faces: 63 & ~FACES.NY, tint: 1 });
      this.addCollider(x0, y0, z0, x1, y1, z1, { surface: 'metal', nav: true });
    };
    wall(-W / 2 - T, 0, -D / 2 - T, -W / 2, H, D / 2 + T);
    wall(W / 2, 0, -D / 2 - T, W / 2 + T, H, D / 2 + T);
    // south wall (entrance) and north wall (exits) with door gaps
    const wallWithGaps = (z0, z1, gaps) => {
      const xs = [...gaps].sort((a, b) => a - b);
      let x = -W / 2;
      for (const g of xs) {
        if (g - DOOR_W / 2 > x + 0.01) wall(x, 0, z0, g - DOOR_W / 2, H, z1);
        wall(g - DOOR_W / 2, DOOR_H, z0, g + DOOR_W / 2, H, z1);
        x = g + DOOR_W / 2;
      }
      if (W / 2 > x + 0.01) wall(x, 0, z0, W / 2, H, z1);
    };
    wallWithGaps(D / 2, D / 2 + T, [s.entX]);
    wallWithGaps(-D / 2 - T, -D / 2, s.exits);

    // baseboards + upper trim + wall accents
    const bb = 0.35;
    gb.box(-W / 2, 0, -D / 2, -W / 2 + 0.12, bb, D / 2, M.trim, { faces: FACES.PX | FACES.PY });
    gb.box(W / 2 - 0.12, 0, -D / 2, W / 2, bb, D / 2, M.trim, { faces: FACES.NX | FACES.PY });
    gb.box(-W / 2, H - 0.5, -D / 2, -W / 2 + 0.25, H - 0.3, D / 2, M.trim, { faces: FACES.PX | FACES.NY });
    gb.box(W / 2 - 0.25, H - 0.5, -D / 2, W / 2, H - 0.3, D / 2, M.trim, { faces: FACES.NX | FACES.NY });
    // ceiling pipes
    const pipeY = H - 0.9;
    gb.cylinder(-W / 2 + 0.5, pipeY, 0, 0.22, D, 'z', 6, M.trim, { tint: 0.8 });
    gb.cylinder(W / 2 - 0.5, pipeY + 0.2, 0, 0.16, D, 'z', 6, M.trim, { tint: 0.6 });
    // wall pilasters every few meters (break up long walls)
    for (let z = -D / 2 + 3; z < D / 2 - 2; z += rng.range(4.5, 6.5)) {
      gb.box(-W / 2, 0, z, -W / 2 + 0.35, H, z + 0.6, M.trim, { faces: FACES.PX | FACES.PZ | FACES.NZ, tint: 0.9 });
      gb.box(W / 2 - 0.35, 0, z, W / 2, H, z + 0.6, M.trim, { faces: FACES.NX | FACES.PZ | FACES.NZ, tint: 0.9 });
      if (rng.chance(0.35)) gb.box(-W / 2, 1.6, z + 1.2, -W / 2 + 0.08, 2.4, z + 2.4, M.vent, { faces: FACES.PX });
      if (rng.chance(0.25)) gb.box(-W / 2 + 0.02, 2.7, z - 1.5, -W / 2 + 0.06, 2.8, z - 0.3, M.accent, { faces: FACES.PX });
      if (rng.chance(0.25)) gb.box(W / 2 - 0.06, 2.7, z - 1.5, W / 2 - 0.02, 2.8, z - 0.3, M.accent, { faces: FACES.NX });
    }

    // door frames + accents
    const frame = (x, z, dir) => { // dir: +1 entrance wall (south), -1 north
      const zf = dir > 0 ? z - 0.15 : z;
      const zb = dir > 0 ? z : z + 0.15;
      gb.box(x - DOOR_W / 2 - 0.35, 0, zf, x - DOOR_W / 2, DOOR_H + 0.35, zb, M.trim);
      gb.box(x + DOOR_W / 2, 0, zf, x + DOOR_W / 2 + 0.35, DOOR_H + 0.35, zb, M.trim);
      gb.box(x - DOOR_W / 2, DOOR_H, zf, x + DOOR_W / 2, DOOR_H + 0.35, zb, M.trim);
      gb.box(x - DOOR_W / 2 - 0.6, 0, zf - (dir > 0 ? 0.02 : 0), x - DOOR_W / 2 - 0.35, 0.6, zb, M.hazard, { uvScale: 2 });
      gb.box(x + DOOR_W / 2 + 0.35, 0, zf - (dir > 0 ? 0.02 : 0), x + DOOR_W / 2 + 0.6, 0.6, zb, M.hazard, { uvScale: 2 });
    };
    frame(s.entX, D / 2, 1);
    for (const ex of s.exits) frame(ex, -D / 2, -1);

    // ceiling lamps (emissive panels like fluorescent fixtures)
    for (const l of s.lightSpots) {
      gb.box(l.x - 0.9, H - 0.12, l.z - 0.45, l.x + 0.9, H, l.z + 0.45, M.trim, { faces: FACES.NY | FACES.PX | FACES.NX | FACES.PZ | FACES.NZ });
      gb.box(l.x - 0.75, H - 0.14, l.z - 0.3, l.x + 0.75, H - 0.12, l.z + 0.3, M.lamp, { faces: FACES.NY });
    }

    // props
    const matOf = (k) => M[k] || M.crate;
    for (const p of s.props) {
      const tint = p.tint || 1;
      const m = matOf(p.mat);
      if (p.breakable) {
        // breakable pillars are separate meshes so they can be removed
        const g2 = new GeoBuilder(2);
        g2.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, m, { tint });
        g2.box(p.x0 - 0.1, p.y0, p.z0 - 0.1, p.x1 + 0.1, 0.8, p.z1 + 0.1, M.hazard, { uvScale: 2 });
        const built = g2.build();
        this.group.add(built.group);
        this.disposables.push(...built.geos);
        const col = this.addCollider(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { surface: 'concrete', nav: true, tag: 'breakable' });
        const br = { group: built.group, col, hp: 1, x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, broken: false };
        col.ref = br;
        this.breakables.push(br);
        continue;
      }
      gb.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, m, { tint, faces: 63 & ~FACES.NY });
      this.addCollider(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { surface: p.surface || 'metal', nav: true });
      if (p.trimTop) gb.box(p.x0 - 0.04, p.y1, p.z0 - 0.04, p.x1 + 0.04, p.y1 + 0.08, p.z1 + 0.04, M.trim, { faces: 63 & ~FACES.NY });
      if (p.platform) {
        // railing posts + edge accent
        gb.box(p.x0, p.y1, p.z0, p.x1, p.y1 + 0.06, p.z1, M.grate, { faces: FACES.PY, tint: 1.1 });
        gb.box(p.x0, p.y1 - 0.12, p.z0 - 0.02, p.x1, p.y1 - 0.04, p.z0, M.accent, { faces: FACES.NZ });
        gb.box(p.x0, p.y1 - 0.12, p.z1, p.x1, p.y1 - 0.04, p.z1 + 0.02, M.accent, { faces: FACES.PZ });
      }
      if (p.shelf) {
        const levels = Math.floor(p.y1 / 0.9);
        for (let k = 1; k < levels; k++) {
          const y = k * 0.9;
          gb.box(p.x0 - 0.05, y, p.z0, p.x1 + 0.05, y + 0.06, p.z1, M.trim, { tint: 0.6 });
        }
        for (let z = p.z0 + 0.3; z < p.z1 - 0.8; z += rng.range(0.9, 1.6)) {
          const y = rng.int(0, Math.max(0, levels - 1)) * 0.9 + 0.06;
          const sz = rng.range(0.4, 0.7);
          gb.box(p.x0 - 0.12, y, z, p.x0 - 0.12 + sz, y + sz, z + sz, M.crate, { tint: rng.range(0.6, 1.1) });
        }
      }
      if (p.rack) {
        gb.box(p.x0 + 0.05, 1.2, p.z0 + 0.1, p.x1 - 0.05, 1.28, p.z1 - 0.1, M.accent2, { tint: 0.7 });
        for (let z = p.z0 + 0.3; z < p.z1 - 0.2; z += 0.5) gb.box((p.x0 + p.x1) / 2 - 0.05, 0.9, z, (p.x0 + p.x1) / 2 + 0.05, 2.0, z + 0.12, M.trim, { tint: 0.4 });
      }
    }
    for (const c of s.cyl) {
      gb.cylinder(c.x, (c.y0 + c.y1) / 2, c.z, c.r, c.y1 - c.y0, 'y', c.core ? 10 : 8, matOf(c.mat), { tint: c.core ? 0.8 : 1 });
      if (c.collide) {
        const r = c.r * 0.92;
        this.addCollider(c.x - r, c.y0, c.z - r, c.x + r, c.y1, c.z + r, { surface: 'metal', nav: true });
      }
      if (!c.core) gb.box(c.x - c.r * 0.7, c.y1, c.z - c.r * 0.7, c.x + c.r * 0.7, c.y1 + 0.03, c.z + c.r * 0.7, M.accent2, { faces: FACES.PY, tint: 0.5 });
    }
    for (const d of s.decor) {
      if (d.type === 'coreRing') {
        gb.cylinder(d.x, d.y, d.z, d.r, 0.25, 'y', 10, M.accent, { caps: false });
      }
    }
    for (const r of s.rugs) gb.box(r.x - r.w / 2, 0, r.z - r.d / 2, r.x + r.w / 2, 0.02, r.z + r.d / 2, M.rug, { faces: FACES.PY, uvScale: 0.5 });
    for (const sc of s.screens) {
      gb.box(sc.x, 1.4, sc.z - 1.2, sc.x + 0.06, 2.6, sc.z + 1.2, M.trim);
      gb.box(sc.x + 0.06, 1.5, sc.z - 1.1, sc.x + 0.08, 2.5, sc.z + 1.1, M.screen, { faces: FACES.PX, uvScale: 2.2 });
    }

    // corridor connecting the previous room's exit to this entrance
    if (this.hasCorridor) {
      const z0 = D / 2 + T, z1 = D / 2 + T + CORR_L, x = s.entX;
      gb.box(x - CORR_HW - 1, -1, z0, x + CORR_HW + 1, 0, z1, M.floor, { faces: FACES.PY });
      this.addCollider(x - CORR_HW - 1, -1, z0, x + CORR_HW + 1, 0, z1, { nav: false, surface: 'metal' });
      gb.box(x - CORR_HW - 1, CORR_H, z0, x + CORR_HW + 1, CORR_H + 1, z1, M.ceiling, { faces: FACES.NY });
      this.addCollider(x - CORR_HW - 1, CORR_H, z0, x + CORR_HW + 1, CORR_H + 1, z1, { nav: false });
      gb.box(x - CORR_HW - 1, 0, z0, x - CORR_HW, CORR_H, z1, M.wall, { faces: FACES.PX });
      gb.box(x + CORR_HW, 0, z0, x + CORR_HW + 1, CORR_H, z1, M.wall, { faces: FACES.NX });
      this.addCollider(x - CORR_HW - 1, 0, z0, x - CORR_HW, CORR_H, z1, { nav: false });
      this.addCollider(x + CORR_HW, 0, z0, x + CORR_HW + 1, CORR_H, z1, { nav: false });
      // corridor caps between door width and corridor width at both ends
      gb.box(x - CORR_HW, DOOR_H, z0, x + CORR_HW, CORR_H, z0 + 0.2, M.trim);
      gb.box(x - CORR_HW, DOOR_H, z1 - 0.2, x + CORR_HW, CORR_H, z1, M.trim);
      for (let zz = z0 + 1.5; zz < z1 - 1; zz += 2.5) {
        gb.box(x - 0.6, CORR_H - 0.1, zz, x + 0.6, CORR_H, zz + 0.5, M.lamp, { faces: FACES.NY });
        gb.box(x - CORR_HW + 0.02, 0.05, zz, x - CORR_HW + 0.06, 0.15, zz + 1.2, M.accent, { faces: FACES.PX });
        gb.box(x + CORR_HW - 0.06, 0.05, zz, x + CORR_HW - 0.02, 0.15, zz + 1.2, M.accent, { faces: FACES.NX });
      }
    }

    const built = gb.build();
    this.group.add(built.group);
    this.disposables.push(...built.geos);

    // hazards (separate animated material)
    for (const h of s.hazards) {
      const color = h.type === 'electric' ? 0x40a0ff : h.type === 'molten' ? 0xff6a10 : 0x50ff70;
      const mat = psxify(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      const g = new THREE.BoxGeometry(h.x1 - h.x0, 0.05, h.z1 - h.z0);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set((h.x0 + h.x1) / 2, 0.025, (h.z0 + h.z1) / 2);
      this.group.add(mesh);
      this.disposables.push(g, mat);
      // hazard stripe borders
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(h.x1 - h.x0, 0.06, 0.25), sharedMaterials().door);
      b1.position.set((h.x0 + h.x1) / 2, 0.03, h.z0 - 0.125);
      const b2 = b1.clone(); b2.position.z = h.z1 + 0.125;
      this.group.add(b1, b2);
      this.disposables.push(b1.geometry);
      this.hazards.push({ ...h, mesh, mat, color: new THREE.Color(color), active: !h.on, warn: false,
        wx0: this.wx(h.x0), wx1: this.wx(h.x1), wz0: this.wz(h.z0), wz1: this.wz(h.z1) });
    }
    // sliders (moving cover)
    for (const sl of s.sliders) {
      const g = new THREE.BoxGeometry(sl.w, sl.h, sl.d);
      const mesh = new THREE.Mesh(g, M.trim);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(sl.w + 0.02, 0.3, sl.d + 0.02), sharedMaterials().door);
      stripe.position.y = sl.h / 2 - 0.2;
      mesh.add(stripe);
      this.group.add(mesh);
      this.disposables.push(g, stripe.geometry);
      // rail on floor
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sl.amp * 2 + sl.w, 0.04, 0.3), M.accent);
      rail.position.set(sl.x, 0.02, sl.z);
      this.group.add(rail);
      this.disposables.push(rail.geometry);
      const col = this.addCollider(0, 0, 0, 0, 0, 0, { surface: 'metal', nav: false });
      this.sliders.push({ ...sl, mesh, col, px: sl.x });
    }
    for (const sw of s.sweepers) {
      const pg = new THREE.BoxGeometry(1, 1.0, 1);
      const pylon = new THREE.Mesh(pg, M.trim);
      pylon.position.set(sw.x, 0.5, sw.z);
      const bg = new THREE.BoxGeometry(sw.len * 2, 0.16, 0.16);
      const beam = new THREE.Mesh(bg, psxify(new THREE.MeshBasicMaterial({ color: 0xff2040 })));
      beam.position.set(sw.x, sw.y, sw.z);
      this.group.add(pylon, beam);
      this.disposables.push(pg, bg, beam.material);
      this.addCollider(sw.x - 0.5, 0, sw.z - 0.5, sw.x + 0.5, 1.0, sw.z + 0.5, { surface: 'metal', nav: true });
      this.sweepers.push({ ...sw, beam, angle: 0, hitCd: 0 });
    }

    // doors
    this.entrance = this.makeDoor(s.entX, D / 2 + T / 2, 'entrance', -1);
    s.exits.forEach((ex, i) => { this.exitDoors.push(this.makeDoor(ex, -D / 2 - T / 2, 'exit', i)); });
  }

  makeDoor(x, z, kind, index) {
    const sm = sharedMaterials();
    const lv = this.level;
    const group = new THREE.Group();
    const panel = new THREE.Mesh(lv.doorGeo, sm.doorPanel);
    const stripe = new THREE.Mesh(lv.doorStripeGeo, sm.door);
    stripe.position.y = -DOOR_H / 2 + 0.35;
    const ind = new THREE.Mesh(lv.doorIndGeo, sm.doorLocked);
    group.add(panel, stripe);
    group.position.set(x, DOOR_H / 2, z);
    this.group.add(group);
    const indicator = ind;
    indicator.position.set(x, DOOR_H + 0.17, z + (kind === 'entrance' ? -0.75 : 0.75));
    this.group.add(indicator);
    const col = this.addCollider(x - DOOR_W / 2, 0, z - 0.2, x + DOOR_W / 2, DOOR_H, z + 0.2, { surface: 'metal', nav: false, tag: 'door' });
    const door = { x, z, kind, index, group, indicator, col, open: 0, target: 0, state: 'locked', sign: null };
    this.doors.push(door);
    return door;
  }

  setDoor(door, state) {
    const sm = sharedMaterials();
    door.state = state;
    door.indicator.material = state === 'locked' ? sm.doorLocked : state === 'choose' ? sm.doorChoose : sm.doorOpen;
    door.target = state === 'open' ? 1 : 0;
  }

  setSign(door, lines, color) {
    if (door.sign) { this.group.remove(door.sign); door.sign.material.map.dispose(); door.sign.material.dispose(); door.sign.geometry.dispose(); door.sign = null; }
    if (!lines) return;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(3, 3, 250, 90);
    ctx.fillStyle = color;
    ctx.font = 'bold 34px Oswald, Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], 128, 34);
    ctx.font = '20px "Share Tech Mono", monospace';
    ctx.fillStyle = '#d8d8d8';
    ctx.fillText(lines[1] || '', 128, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set(door.x, DOOR_H + 0.88, door.z + 0.6);
    this.group.add(mesh);
    door.sign = mesh;
  }

  update(dt, player) {
    this.time += dt;
    for (const d of this.doors) {
      const prev = d.open;
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 3.2);
      d.group.position.y = DOOR_H / 2 + d.open * (DOOR_H - 0.25);
      d.col.active = d.open < 0.75;
      if (prev !== d.open && (prev === 0 || prev === 1)) this.game.audio.play('door', new THREE.Vector3(this.wx(d.x), 2, this.wz(d.z)), 0.8);
    }
    // hazards
    for (const h of this.hazards) {
      if (h.on) {
        const cyc = h.on + h.off;
        const t = (this.time + h.phase) % cyc;
        h.active = t < h.on;
        h.warn = !h.active && t > cyc - 0.9;
      } else h.active = true;
      const flick = h.active ? 0.75 + 0.25 * Math.sin(this.time * 40 + h.phase * 10) : h.warn ? (Math.sin(this.time * 30) > 0 ? 0.5 : 0.1) : 0.08;
      h.mat.color.copy(h.color).multiplyScalar(flick);
    }
    // sliders
    for (const sl of this.sliders) {
      const nx = sl.x + Math.sin(this.time * sl.speed + sl.phase) * sl.amp;
      const dx = nx - sl.px;
      sl.px = nx;
      sl.mesh.position.set(nx, sl.h / 2, sl.z);
      const b = sl.col;
      b.minX = this.wx(nx - sl.w / 2); b.maxX = this.wx(nx + sl.w / 2);
      b.minY = 0; b.maxY = sl.h;
      b.minZ = this.wz(sl.z - sl.d / 2); b.maxZ = this.wz(sl.z + sl.d / 2);
      // push bodies out
      const pushBody = (body) => {
        const p = body.pos;
        if (p.x + body.r > b.minX && p.x - body.r < b.maxX && p.z + body.r > b.minZ && p.z - body.r < b.maxZ && p.y < b.maxY - 0.05 && p.y + body.h > b.minY) {
          if (dx > 0) p.x = b.maxX + body.r + 0.01; else p.x = b.minX - body.r - 0.01;
        }
      };
      pushBody(player.body);
      for (const e of this.game.enemies.list) if (e.body) pushBody(e.body);
    }
    // sweepers
    for (const sw of this.sweepers) {
      sw.angle += sw.speed * dt;
      sw.beam.rotation.y = sw.angle;
      sw.hitCd -= dt;
      const p = player.body.pos;
      const lx = p.x - this.wx(sw.x), lz = p.z - this.wz(sw.z);
      // beam direction (rotation about y): x axis rotated
      const dxb = Math.cos(sw.angle), dzb = -Math.sin(sw.angle);
      const along = lx * dxb + lz * dzb;
      const perp = Math.abs(-lx * dzb + lz * dxb);
      if (Math.abs(along) < sw.len && perp < 0.45 && p.y < sw.y + 0.1 && sw.hitCd <= 0) {
        sw.hitCd = 0.6;
        this.game.player.damage(18, { x: p.x - dzb, z: p.z + dxb }, 'SWEEPER BEAM', 'Jump over the red sweeper beam.');
      }
    }
  }

  // Returns the hazard (if any) whose rectangle contains the point and is active.
  hazardAt(x, z, y) {
    if (y > 0.25) return null;
    for (const h of this.hazards) if (h.active && x > h.wx0 && x < h.wx1 && z > h.wz0 && z < h.wz1) return h;
    return null;
  }

  containsXZ(x, z, margin = 0) {
    return x > this.origin.x - this.W / 2 + margin && x < this.origin.x + this.W / 2 - margin &&
           z > this.origin.z - this.D / 2 + margin && z < this.origin.z + this.D / 2 - margin;
  }

  breakPillar(br) {
    if (br.broken) return;
    br.broken = true;
    br.col.active = false;
    this.group.remove(br.group);
    const p = new THREE.Vector3(this.wx(br.x), 2, this.wz(br.z));
    this.game.fx.chunks(p, 0x888888, 16, 9, 0.35);
    this.game.fx.explosion(p, 3, 0xaaaaaa);
    this.game.audio.play('explosion', p, 0.8);
    // nav update
    this.nav = new NavGrid(this);
    this.nav.build(this.colliders);
  }

  dispose() {
    this.level.game.scene.remove(this.group);
    for (const d of this.doors) if (d.sign) { d.sign.material.map.dispose(); d.sign.material.dispose(); d.sign.geometry.dispose(); }
    for (const g of this.disposables) g.dispose();
    this.disposables.length = 0;
    this.colliders.length = 0;
  }
}

// --------------------------------------------------------------------------------------
// Level manager: room chain, transitions, lights, validation.
// --------------------------------------------------------------------------------------
export class Level {
  constructor(game) {
    this.game = game;
    this.rooms = [];
    this.colliders = [];
    this.current = null;
    this.next = null;
    this.seed = 1;
    this.doorGeo = new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.35);
    this.doorStripeGeo = new THREE.BoxGeometry(DOOR_W + 0.01, 0.5, 0.37);
    this.doorIndGeo = new THREE.BoxGeometry(1.6, 0.18, 0.1);
    this.lightCount = game.lowPower ? 4 : 6;
    this.lights = [];
    for (let i = 0; i < this.lightCount; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 1.25);
      game.scene.add(l);
      this.lights.push(l);
    }
    this.hemi = new THREE.HemisphereLight(0x8890c0, 0x201820, 0.9);
    game.scene.add(this.hemi);
    this.recentArches = [];
    this.disposeQueue = [];
    this.lightFlicker = 0;
  }

  reset(seed) {
    for (const r of this.rooms) r.dispose();
    this.rooms = [];
    this.current = this.next = null;
    this.seed = seed;
    this.recentArches = [];
    this.disposeQueue = [];
    this.rebuildColliders();
  }

  themeFor(index) {
    if (index <= 0) return THEMES[0];
    return THEMES[Math.floor((index - 1) / 5) % THEMES.length];
  }

  rebuildColliders() {
    this.colliders = [];
    for (const r of this.rooms) for (const c of r.colliders) this.colliders.push(c);
  }

  // Create a room, validating that entrance, exits and cache spot are mutually reachable.
  createRoom(index, arch, origin, ctx, hasCorridor) {
    const theme = this.themeFor(index);
    let room = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rng = new RNG(hashSeed(this.seed, index, arch, attempt));
      const spec = generateSpec(attempt < 5 ? arch : 'arena', rng, { ...ctx, theme });
      if (attempt === 5) { spec.props = []; spec.cyl = []; spec.sliders = []; }
      const o = origin(spec);
      room = new Room(this, index, spec, o, theme, hasCorridor);
      const nav = room.nav;
      const ex = room.wx(spec.entX), ez = room.wz(spec.D / 2 - 1.5);
      let ok = true;
      nav.flow(ex, ez);
      const check = (x, z) => { const k = nav.nearestFree(room.wx(x), room.wz(z), 2); return k >= 0 && nav.dist[k] >= 0; };
      for (const x of spec.exits) if (!check(x, -spec.D / 2 + 1.5)) ok = false;
      if (!check(spec.cachePos.x, spec.cachePos.z)) ok = false;
      if (ok) break;
      room.dispose();
      room = null;
    }
    this.game.scene.add(room.group);
    this.rooms.push(room);
    this.rebuildColliders();
    return room;
  }

  startLobby() {
    const room = this.createRoom(0, 'lobby', (spec) => new THREE.Vector3(0, 0, 0), {}, false);
    this.current = room;
    this.activate(room);
    room.setDoor(room.exitDoors[0], 'choose');
    room.state = 'cleared';
    room.routes = [{ type: 'combat', label: ['ROOM 01', 'ENTER THE MACHINE'], color: '#3ef0d0' }];
    room.setSign(room.exitDoors[0], room.routes[0].label, room.routes[0].color);
    return room;
  }

  pickArch(index, route) {
    if (route === 'boss') return 'boss';
    if (route === 'cache') return 'cache';
    if (route === 'elite') return 'elite';
    if (route === 'survival') return 'survival';
    if (route === 'hazard') return 'hazard';
    const rng = new RNG(hashSeed(this.seed, 'arch', index));
    const avail = COMBAT_ARCHES.filter((a) => {
      if (index <= 2 && (a === 'gallery' || a === 'movers' || a === 'mezzanine')) return false;
      return true;
    });
    return rng.weighted(avail, (a) => {
      const k = this.recentArches.lastIndexOf(a);
      if (k === -1) return 3;
      const age = this.recentArches.length - k;
      return age <= 2 ? 0.05 : age <= 4 ? 0.8 : 2;
    });
  }

  // Generate the next room beyond exit `exitIdx` of the current room.
  buildNext(route, ctx) {
    const cur = this.current;
    const index = cur.index + 1;
    const arch = this.pickArch(index, route.type);
    this.recentArches.push(arch);
    if (this.recentArches.length > 8) this.recentArches.shift();
    const exitX = cur.spec.exits[cur.chosenExit];
    const room = this.createRoom(index, arch, (spec) => new THREE.Vector3(
      cur.origin.x + exitX - spec.entX,
      0,
      cur.origin.z - cur.spec.D / 2 - WALL_T - CORR_L - WALL_T - spec.D / 2,
    ), { ...ctx, route }, true);
    room.route = route;
    room.setDoor(room.entrance, 'open');
    this.next = room;
    return room;
  }

  activate(room) {
    const t = room.theme;
    const scene = this.game.scene;
    if (!scene.fog) scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    scene.fog.color.setHex(t.fog);
    scene.fog.near = t.fogNear; scene.fog.far = t.fogFar + (room.spec.D > 40 ? 15 : 0);
    this.hemi.color.setHex(t.sky);
    this.hemi.groundColor.setHex(t.ground);
    this.hemi.intensity = t.hemi;
    // spread point lights over the lamp spots (farthest-point sampling)
    const spots = room.spec.lightSpots.slice();
    const chosen = [];
    if (spots.length) {
      chosen.push(spots[Math.floor(spots.length / 2)]);
      while (chosen.length < Math.min(this.lightCount, spots.length)) {
        let best = null, bd = -1;
        for (const s of spots) {
          if (chosen.includes(s)) continue;
          let md = 1e9;
          for (const c of chosen) md = Math.min(md, Math.hypot(s.x - c.x, s.z - c.z));
          if (md > bd) { bd = md; best = s; }
        }
        chosen.push(best);
      }
    }
    const reach = Math.max(16, Math.sqrt(room.W * room.D / Math.max(1, chosen.length)) * 1.8);
    this.lights.forEach((l, i) => {
      const s = chosen[i];
      if (!s) { l.intensity = 0; return; }
      l.position.set(room.wx(s.x), room.spec.H - 1.2, room.wz(s.z));
      l.color.setHex(i === 0 && room.spec.redLight ? 0xff3040 : t.light);
      l.distance = reach;
      l.userData.base = room.spec.redLight && i === 0 ? 26 : 20;
      l.intensity = 0;
    });
    this.lightFlicker = 0.6; // lights flicker on when entering
  }

  update(dt) {
    const g = this.game;
    for (const r of this.rooms) r.update(dt, g.player);
    // light flicker-on + combat alarm pulse
    if (this.current) {
      this.lightFlicker = Math.max(0, this.lightFlicker - dt);
      const alarm = this.current.state === 'combat';
      this.lights.forEach((l, i) => {
        const base = l.userData.base || 0;
        let k = 1;
        if (this.lightFlicker > 0) k = Math.random() < 0.5 + (0.6 - this.lightFlicker) ? 1 : 0.15;
        if (alarm && i === 0) {
          l.color.setHex(0xff2030);
          k *= 0.6 + 0.4 * Math.sin(performance.now() * 0.006);
        } else if (i === 0 && !this.current.spec.redLight) l.color.setHex(this.current.theme.light);
        l.intensity = base * k;
      });
    }
    // delayed disposal
    for (let i = this.disposeQueue.length - 1; i >= 0; i--) {
      const q = this.disposeQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        q.room.dispose();
        this.rooms = this.rooms.filter((r) => r !== q.room);
        this.disposeQueue.splice(i, 1);
        this.rebuildColliders();
        g.onRoomDisposed(q.room);
      }
    }
    // exit choice / transition triggers
    const cur = this.current;
    const p = g.player.body.pos;
    if (cur && cur.state === 'cleared' && cur.chosenExit < 0) {
      cur.exitDoors.forEach((d, i) => {
        const dx = p.x - cur.wx(d.x), dz = p.z - cur.wz(d.z);
        if (Math.abs(dx) < 2.2 && dz < 3.8 && dz > -0.5) g.chooseExit(i);
      });
    }
    const nx = this.next;
    if (nx && p.z < nx.wz(nx.D / 2 - 1.2) && nx.containsXZ(p.x, p.z, 0.2)) {
      this.enterNext();
    }
  }

  enterNext() {
    const old = this.current;
    const room = this.next;
    this.next = null;
    this.current = room;
    room.setDoor(room.entrance, 'locked');
    for (const d of old.exitDoors) old.setDoor(d, 'locked');
    this.disposeQueue.push({ room: old, t: 0.6 });
    this.activate(room);
    this.game.onRoomEnter(room);
  }
}
