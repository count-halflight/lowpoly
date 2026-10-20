import * as THREE from 'three';
import { GeoBuilder, FACES } from './builder.js';
import { generateSpec, COMBAT_ARCHES } from './rooms.js';
import { THEMES, themeMaterials, sharedMaterials } from '../render/materials.js';
import { makeBox, moveBody } from '../core/collide.js';
import { RNG, hashSeed } from '../core/rng.js';
import { psxify } from '../render/renderer.js';
import { getTexture } from '../render/textures.js';
import { buildKit, graffitiCanvas, terminalCanvas, buildCeiling, buildSetPiece, buildDecor, buildSkyline, buildSigns, propDetail, skyRes } from './kits.js';
import { buildFeatures as buildInteractive, updateFeatures as updateInteractive, updateBlasts, damageDestructible, activateSwitch, blastRoom, meleeRoom, inWater, featureRes } from './features.js';
import { buildBeacon } from './beacon.js';
import { GRAFFITI } from '../data/lore.js';

const TMP_COL = new THREE.Color(), TMP_COL2 = new THREE.Color();
// colour each lighting mood pulls the theme's lamp colour toward
const MOOD_TINT = { sickly: 0x7aff8a, night: 0xffb060, water: 0x70e0ff, yard: 0xffa050, datacenter: 0x80b8ff, candle: 0xffa050, shaft: 0xc0c8ff };
const KIT_BY_THEME = { service: 'service', foundry: 'foundry', cryo: 'cryo', reactor: 'reactor', research: 'archive', slaughter: 'slaughter', orbital: 'orbital', choir: 'choir', breach: 'breach', core: 'core' };
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
  rebuild(colliders) { this.blocked.fill(0); this.build(colliders); }
  build(colliders) {
    const pad = 0.45;
    // lifts change height all the time: always off limits
    for (const b of colliders) {
      if (!b.navBlock) continue;
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const cx = this.ox + (i + 0.5) * this.cell, cz = this.oz + (j + 0.5) * this.cell;
        if (cx > b.minX - pad && cx < b.maxX + pad && cz > b.minZ - pad && cz < b.maxZ + pad) this.blocked[j * this.nx + i] = 1;
      }
    }
    // holes in the floor are off limits unless a girder spans them
    for (const h of this.room.spec.holes || []) {
      const hx0 = this.room.wx(h.x0), hx1 = this.room.wx(h.x1), hz0 = this.room.wz(h.z0), hz1 = this.room.wz(h.z1);
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const cx = this.ox + (i + 0.5) * this.cell, cz = this.oz + (j + 0.5) * this.cell;
        if (cx < hx0 - 0.45 || cx > hx1 + 0.45 || cz < hz0 - 0.45 || cz > hz1 + 0.45) continue;
        const bridged = colliders.some((b) => b.active && b.girder && cx > b.minX + 0.15 && cx < b.maxX - 0.15 && cz > b.minZ - 0.5 && cz < b.maxZ + 0.5);
        if (!bridged) this.blocked[j * this.nx + i] = 1;
      }
    }
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
    // permanent hazard pools are off limits unless a low walkway covers them
    for (const h of this.room.hazards) {
      if (h.on || h.dyn) continue;
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const cx = this.ox + (i + 0.5) * this.cell, cz = this.oz + (j + 0.5) * this.cell;
        if (cx < h.wx0 - 0.3 || cx > h.wx1 + 0.3 || cz < h.wz0 - 0.3 || cz > h.wz1 + 0.3) continue;
        const covered = colliders.some((b) => b.active && b.maxY >= 0.2 && b.maxY <= 0.46 && cx > b.minX + 0.2 && cx < b.maxX - 0.2 && cz > b.minZ + 0.2 && cz < b.maxZ - 0.2);
        if (!covered) this.blocked[j * this.nx + i] = 1;
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
  constructor(level, index, spec, origin, theme, hasCorridor, ctx = {}) {
    this.level = level;
    this.ctx = ctx;
    this.cond = ctx.cond || 'none';
    this.pads = [];
    this.conveyors = [];
    this.barrels = [];
    this.terminals = [];
    this.beacon = null;
    this.dynHazards = 0;
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
    this.pendingBlasts = [];
    this.group = new THREE.Group();
    this.group.position.copy(origin);
    this.state = 'idle'; // idle -> combat -> cleared
    this.chosenExit = -1;
    this.routes = [];
    this.time = 0;
    this.build();
    // holes in world space (enemy ledge guard)
    this.holeW = spec.holes && spec.holes.length ? spec.holes.map((h) => ({ x0: this.wx(h.x0), x1: this.wx(h.x1), z0: this.wz(h.z0), z1: this.wz(h.z1) })) : null;
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

    // floor (cut around holes: pits, rooftop gaps, crypts) / ceiling
    const floorMat = (s.floorMat && M[s.floorMat]) || M.floor;
    const floorSurf = this.theme.floorTex === 'grate' && !s.floorMat ? 'metal' : 'concrete';
    if (s.holes && s.holes.length) this.buildHoledFloor(gb, M, floorMat, floorSurf);
    else {
      gb.box(-W / 2 - T, -1, -D / 2 - T, W / 2 + T, 0, D / 2 + T, floorMat, { faces: FACES.PY });
      this.addCollider(-W / 2 - T, -1, -D / 2 - T, W / 2 + T, 0, D / 2 + T, { surface: floorSurf, nav: false });
    }
    if (!s.open) gb.box(-W / 2 - T, H, -D / 2 - T, W / 2 + T, H + 1, D / 2 + T, M.ceiling, { faces: FACES.NY });
    this.addCollider(-W / 2 - T, H, -D / 2 - T, W / 2 + T, H + 1, D / 2 + T, { nav: false });

    // walls. Open rooms (rooftops) draw low parapets on the sides and short stair towers at the
    // ends, but keep full-height invisible colliders.
    const sideVisH = s.open ? 1.15 : H, endVisH = s.open ? Math.min(H, s.endWallH || 7.5) : H;
    const wall = (x0, y0, z0, x1, y1, z1, visH = H) => {
      if (visH > y0) gb.box(x0, y0, z0, x1, Math.min(y1, visH), z1, M.wall, { faces: 63 & ~FACES.NY, tint: 1 });
      this.addCollider(x0, y0, z0, x1, y1, z1, { surface: 'metal', nav: true });
      if (visH < y1 && visH > y0) gb.box(x0 - 0.06, visH, z0, x1 + 0.06, visH + 0.12, z1, M.trim, { faces: 63 & ~FACES.NY });
    };
    // side walls, split around secret panels
    const gapsOf = (side) => (s.secrets || []).filter((sc) => sc.side === side).map((sc) => [sc.z - sc.w / 2, sc.z + sc.w / 2, sc.h]).sort((a, b) => a[0] - b[0]);
    this.sideGaps = { '-1': gapsOf(-1), '1': gapsOf(1) };
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -W / 2 - T : W / 2, x1 = side < 0 ? -W / 2 : W / 2 + T;
      let z = -D / 2 - T;
      for (const [g0, g1, gh] of this.sideGaps[side]) {
        wall(x0, 0, z, x1, H, g0, sideVisH);
        wall(x0, gh, g0, x1, H, g1, sideVisH);
        z = g1;
      }
      wall(x0, 0, z, x1, H, D / 2 + T, sideVisH);
    }
    // south wall (entrance) and north wall (exits) with door gaps
    const wallWithGaps = (z0, z1, gaps) => {
      const xs = [...gaps].sort((a, b) => a - b);
      let x = -W / 2;
      for (const g of xs) {
        if (g - DOOR_W / 2 > x + 0.01) wall(x, 0, z0, g - DOOR_W / 2, H, z1, endVisH);
        wall(g - DOOR_W / 2, DOOR_H, z0, g + DOOR_W / 2, H, z1, endVisH);
        x = g + DOOR_W / 2;
      }
      if (W / 2 > x + 0.01) wall(x, 0, z0, W / 2, H, z1, endVisH);
    };
    wallWithGaps(D / 2, D / 2 + T, [s.entX]);
    wallWithGaps(-D / 2 - T, -D / 2, s.exits);

    // baseboards + upper trim + wall accents (closed rooms; baseboards stop at secret panels)
    const segs = (side) => {
      const out = []; let z = -D / 2;
      for (const [g0, g1] of this.sideGaps[side]) { if (g0 > z) out.push([z, g0]); z = g1; }
      if (z < D / 2) out.push([z, D / 2]);
      return out;
    };
    const inGap = (side, z0, z1) => this.sideGaps[side].some(([g0, g1]) => z1 > g0 - 0.2 && z0 < g1 + 0.2);
    const bb = 0.35;
    for (const [z0, z1] of segs(-1)) gb.box(-W / 2, 0, z0, -W / 2 + 0.12, bb, z1, M.trim, { faces: FACES.PX | FACES.PY });
    for (const [z0, z1] of segs(1)) gb.box(W / 2 - 0.12, 0, z0, W / 2, bb, z1, M.trim, { faces: FACES.NX | FACES.PY });
    if (!s.open) {
      gb.box(-W / 2, H - 0.5, -D / 2, -W / 2 + 0.25, H - 0.3, D / 2, M.trim, { faces: FACES.PX | FACES.NY });
      gb.box(W / 2 - 0.25, H - 0.5, -D / 2, W / 2, H - 0.3, D / 2, M.trim, { faces: FACES.NX | FACES.NY });
      // ceiling pipes
      const pipeY = H - 0.9;
      gb.cylinder(-W / 2 + 0.5, pipeY, 0, 0.22, D, 'z', 6, M.trim, { tint: 0.8 });
      gb.cylinder(W / 2 - 0.5, pipeY + 0.2, 0, 0.16, D, 'z', 6, M.trim, { tint: 0.6 });
      // wall pilasters every few meters (break up long walls)
      for (let z = -D / 2 + 3; z < D / 2 - 2; z += rng.range(4.5, 6.5)) {
        if (!inGap(-1, z - 1.5, z + 2.4)) {
          gb.box(-W / 2, 0, z, -W / 2 + 0.35, H, z + 0.6, M.trim, { faces: FACES.PX | FACES.PZ | FACES.NZ, tint: 0.9 });
          if (rng.chance(0.35)) gb.box(-W / 2, 1.6, z + 1.2, -W / 2 + 0.08, 2.4, z + 2.4, M.vent, { faces: FACES.PX });
          if (rng.chance(0.25)) gb.box(-W / 2 + 0.02, 2.7, z - 1.5, -W / 2 + 0.06, 2.8, z - 0.3, M.accent, { faces: FACES.PX });
        }
        if (!inGap(1, z - 1.5, z + 0.6)) {
          gb.box(W / 2 - 0.35, 0, z, W / 2, H, z + 0.6, M.trim, { faces: FACES.NX | FACES.PZ | FACES.NZ, tint: 0.9 });
          if (rng.chance(0.25)) gb.box(W / 2 - 0.06, 2.7, z - 1.5, W / 2 - 0.02, 2.8, z - 0.3, M.accent, { faces: FACES.NX });
        }
      }
    } else {
      // parapet coping lights + the skyline beyond
      for (let z = -D / 2 + 2; z < D / 2 - 1; z += 3) {
        gb.box(-W / 2 + 0.02, 0.9, z, -W / 2 + 0.06, 0.98, z + 1.2, M.accent, { faces: FACES.PX });
        gb.box(W / 2 - 0.06, 0.9, z, W / 2 - 0.02, 0.98, z + 1.2, M.accent, { faces: FACES.NX });
      }
      const sky = buildSkyline(this, M, rng);
      this.group.add(sky.group);
      this.disposables.push(...sky.geos);
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

    // ceiling lamps (emissive panels like fluorescent fixtures); lamp posts under an open sky
    for (const l of s.lightSpots) {
      if (s.open) {
        const ly = s.lightY || 5.5;
        gb.box(l.x - 0.12, 0, l.z - 0.12, l.x + 0.12, ly, l.z + 0.12, M.trim, { tint: 0.7, faces: 63 & ~FACES.NY });
        gb.box(l.x - 0.12, ly - 0.1, l.z - 0.12, l.x + (l.x > 0 ? -1.1 : 1.1), ly, l.z + 0.12, M.trim, { tint: 0.7 });
        const hx = l.x + (l.x > 0 ? -1.1 : 1.1);
        gb.box(hx - 0.35, ly - 0.3, l.z - 0.25, hx + 0.35, ly - 0.05, l.z + 0.25, M.trim, { tint: 0.9 });
        gb.box(hx - 0.28, ly - 0.32, l.z - 0.18, hx + 0.28, ly - 0.3, l.z + 0.18, M.lamp, { faces: FACES.NY });
        this.addCollider(l.x - 0.15, 0, l.z - 0.15, l.x + 0.15, ly, l.z + 0.15, { surface: 'metal', nav: true });
        continue;
      }
      gb.box(l.x - 0.9, H - 0.12, l.z - 0.45, l.x + 0.9, H, l.z + 0.45, M.trim, { faces: FACES.NY | FACES.PX | FACES.NX | FACES.PZ | FACES.NZ });
      gb.box(l.x - 0.75, H - 0.14, l.z - 0.3, l.x + 0.75, H - 0.12, l.z + 0.3, M.lamp, { faces: FACES.NY });
      // hanging rods on tall ceilings, so lamps do not look glued on
      if (H > 9) gb.box(l.x - 0.03, H - 0.12, l.z - 0.03, l.x + 0.03, H, l.z + 0.03, M.trim);
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
      gb.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, m, { tint, faces: p.y0 > 0.05 ? 63 : 63 & ~FACES.NY });
      const pc = this.addCollider(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, { surface: p.surface || 'metal', nav: !p.noNav });
      if (p.girder) pc.girder = true;
      if (p.catwalk || p.girder || p.ac || p.pew || p.terrace || p.island || p.canopy || p.step) propDetail(gb, M, p);
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
      } else buildDecor(this, gb, M, d, rng);
    }
    for (const r of s.rugs) gb.box(r.x - r.w / 2, 0, r.z - r.d / 2, r.x + r.w / 2, 0.02, r.z + r.d / 2, M.rug, { faces: FACES.PY, uvScale: 0.5 });
    for (const sc of s.screens) {
      if (sc.side === 'east') {
        gb.box(sc.x - 0.06, 1.4, sc.z - 1.2, sc.x, 2.6, sc.z + 1.2, M.trim);
        gb.box(sc.x - 0.08, 1.5, sc.z - 1.1, sc.x - 0.06, 2.5, sc.z + 1.1, M.screen, { faces: FACES.NX, uvScale: 2.2 });
      } else {
        gb.box(sc.x, 1.4, sc.z - 1.2, sc.x + 0.06, 2.6, sc.z + 1.2, M.trim);
        gb.box(sc.x + 0.06, 1.5, sc.z - 1.1, sc.x + 0.08, 2.5, sc.z + 1.1, M.screen, { faces: FACES.PX, uvScale: 2.2 });
      }
    }
    // stratum dressing kit: wall pieces, ceiling clutter, signage and the stratum's signature set piece
    for (const k of s.kit) buildKit(this, gb, M, k, rng);
    if (s.ceilKit && !s.open) buildCeiling(this, gb, M, s.ceilKit, rng);
    if (s.setPiece) buildSetPiece(this, gb, M, s.setPiece, rng);
    if (s.ceilKit && s.arch !== 'tutorial') buildSigns(this, gb, s.ceilKit, rng);
    // launch pad bases
    for (const pd of s.pads) {
      gb.cylinder(pd.x, 0.06, pd.z, 1.25, 0.12, 'y', 8, M.trim, { tint: 0.7 });
      gb.cylinder(pd.x, 0.125, pd.z, 1.0, 0.01, 'y', 8, M.hazard, { caps: true });
    }
    // terminals: a slanted console against the wall
    for (const t of s.terminals) {
      const side = t.x < 0 ? -1 : 1;
      const x0 = side < 0 ? -W / 2 : W / 2 - 0.7, x1 = side < 0 ? -W / 2 + 0.7 : W / 2;
      gb.box(x0, 0, t.z - 0.55, x1, 1.0, t.z + 0.55, M.trim, { tint: 0.75 });
      gb.box(side < 0 ? -W / 2 : W / 2 - 0.25, 1.0, t.z - 0.55, side < 0 ? -W / 2 + 0.25 : W / 2, 1.7, t.z + 0.55, M.trim, { tint: 0.6 });
      gb.box(side < 0 ? -W / 2 + 0.7 : W / 2 - 0.72, 0.1, t.z - 0.3, side < 0 ? -W / 2 + 0.72 : W / 2 - 0.7, 0.3, t.z + 0.3, M.accent, { faces: side < 0 ? FACES.PX : FACES.NX });
      this.addCollider(x0, 0, t.z - 0.55, x1, 1.0, t.z + 0.55, { surface: 'metal', nav: true });
    }
    // bridges/walkways without railings
    for (const p of s.props) if (p.platformFlat) gb.box(p.x0, p.y1, p.z0, p.x1, p.y1 + 0.04, p.z1, M.grate, { faces: FACES.PY, tint: 1.15 });

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

    // interactive features: destructibles, secrets, movers, crushers, vents, anchors, switches, water
    buildInteractive(this, gb, M, rng);

    const built = gb.build();
    this.group.add(built.group);
    this.disposables.push(...built.geos);

    // hazards (separate animated material)
    for (const h of s.hazards) this.addHazard(h);
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
      // low beams are jumped, high beams (sw.y > 1) are slid under; the pylon height says which
      const ph = Math.max(1.0, sw.y + 0.3);
      const pg = new THREE.BoxGeometry(1, ph, 1);
      const pylon = new THREE.Mesh(pg, M.trim);
      pylon.position.set(sw.x, ph / 2, sw.z);
      const bg = new THREE.BoxGeometry(sw.len * 2, 0.16, 0.16);
      const beam = new THREE.Mesh(bg, psxify(new THREE.MeshBasicMaterial({ color: sw.y > 1 ? 0xffa020 : 0xff2040 })));
      beam.position.set(sw.x, sw.y, sw.z);
      // sweep circle painted on the floor
      const rg = new THREE.RingGeometry(sw.len - 0.12, sw.len + 0.05, 24, 1);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, sharedMaterials().doorLocked);
      ring.position.set(sw.x, 0.02, sw.z);
      this.group.add(pylon, beam, ring);
      this.disposables.push(pg, bg, rg, beam.material);
      this.addCollider(sw.x - 0.5, 0, sw.z - 0.5, sw.x + 0.5, ph, sw.z + 0.5, { surface: 'metal', nav: true });
      this.sweepers.push({ ...sw, beam, angle: 0, hitCd: 0 });
    }

    this.buildFeatures(rng);

    // doors
    this.entrance = this.makeDoor(s.entX, D / 2 + T / 2, 'entrance', -1);
    s.exits.forEach((ex, i) => { this.exitDoors.push(this.makeDoor(ex, -D / 2 - T / 2, 'exit', i)); });
  }

  // Floor made of strips around the holes, plus shaft walls dropping into the dark below.
  buildHoledFloor(gb, M, floorMat, floorSurf) {
    const s = this.spec, { W, D } = s, T = WALL_T;
    const holes = s.holes.map((h) => ({ x0: Math.max(-W / 2, h.x0), x1: Math.min(W / 2, h.x1), z0: Math.max(-D / 2, h.z0), z1: Math.min(D / 2, h.z1) }));
    const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    const xs = uniq([-W / 2 - T, W / 2 + T, ...holes.flatMap((h) => [h.x0, h.x1])]);
    const zs = uniq([-D / 2 - T, D / 2 + T, ...holes.flatMap((h) => [h.z0, h.z1])]);
    const solid = (x, z) => !holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
    for (let j = 0; j < zs.length - 1; j++) {
      const z0 = zs[j], z1 = zs[j + 1], cz = (z0 + z1) / 2;
      let run = -1;
      for (let i = 0; i <= xs.length - 1; i++) {
        const ok = i < xs.length - 1 && solid((xs[i] + xs[i + 1]) / 2, cz);
        if (ok && run < 0) run = i;
        if (!ok && run >= 0) {
          gb.box(xs[run], -1, z0, xs[i], 0, z1, floorMat, { faces: FACES.PY });
          this.addCollider(xs[run], -1, z0, xs[i], 0, z1, { surface: floorSurf, nav: false });
          run = -1;
        }
      }
    }
    // shaft walls: dark, banded, with lit windows on rooftops (alleys) or a faint glow in pits
    const depth = 18, alley = !!s.open;
    for (const h of holes) {
      const faces = [
        [h.x0, -depth, h.z0, h.x0 + 0.01, 0, h.z1, FACES.PX], [h.x1 - 0.01, -depth, h.z0, h.x1, 0, h.z1, FACES.NX],
        [h.x0, -depth, h.z0, h.x1, 0, h.z0 + 0.01, FACES.PZ], [h.x0, -depth, h.z1 - 0.01, h.x1, 0, h.z1, FACES.NZ],
      ];
      for (const [x0, y0, z0, x1, y1, z1, f] of faces) {
        gb.box(x0, y0, z0, x1, y1, z1, M.wall, { faces: f, tint: 0.5 });
        gb.box(x0, -0.35, z0, x1, -0.05, z1, M.hazard, { faces: f, uvScale: 2 });
        for (let y = -3; y > -depth + 2; y -= 3.2) gb.box(x0, y - 0.15, z0, x1, y, z1, M.trim, { faces: f, tint: 0.5 });
        if (alley) {
          // lit windows on the facades below
          const along = f === FACES.PX || f === FACES.NX ? [z0, z1] : [x0, x1];
          for (let y = -2.6; y > -depth + 3; y -= 2.4) for (let a = along[0] + 0.6; a < along[1] - 0.8; a += 1.6) {
            if (((a * 7.3 + y * 3.1) % 1 + 1) % 1 < 0.45) continue;
            const m = ((a * 3.7 - y) % 1 + 1) % 1 < 0.15 ? M.accent : M.lamp;
            if (f === FACES.PX || f === FACES.NX) gb.box(x0, y, a, x1, y + 0.8, a + 0.6, m, { faces: f, tint: 0.55 });
            else gb.box(a, y, z0, a + 0.6, y + 0.8, z1, m, { faces: f, tint: 0.55 });
          }
        }
      }
      gb.box(h.x0, -depth - 0.1, h.z0, h.x1, -depth, h.z1, alley ? M.trim : M.accent2, { faces: FACES.PY, tint: alley ? 0.4 : 0.18 });
    }
  }

  rebuildNav() {
    this.nav.rebuild(this.colliders);
    if (this === this.level.current) { const p = this.game.player.body.pos; this.nav.flow(p.x, p.z); }
  }

  addHazard(h) {
    const color = h.type === 'electric' ? 0x40a0ff : h.type === 'molten' ? 0xff6a10 : 0x50ff70;
    const mat = psxify(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const g = new THREE.BoxGeometry(h.x1 - h.x0, 0.05, h.z1 - h.z0);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set((h.x0 + h.x1) / 2, 0.025 + (h.dyn ? 0.01 : 0), (h.z0 + h.z1) / 2);
    this.group.add(mesh);
    this.disposables.push(g, mat);
    // hazard stripe borders
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(h.x1 - h.x0, 0.06, 0.25), sharedMaterials().door);
    b1.position.set((h.x0 + h.x1) / 2, 0.03, h.z0 - 0.125);
    const b2 = new THREE.Mesh(b1.geometry, b1.material); b2.position.set(b1.position.x, 0.03, h.z1 + 0.125);
    this.group.add(b1, b2);
    this.disposables.push(b1.geometry);
    const hz = { ...h, mesh, mat, color: new THREE.Color(color), active: !h.on, warn: false,
      wx0: this.wx(h.x0), wx1: this.wx(h.x1), wz0: this.wz(h.z0), wz1: this.wz(h.z1) };
    this.hazards.push(hz);
    return hz;
  }

  // Pads, conveyors, barrels, terminals, graffiti: separate meshes (animated or removable)
  buildFeatures(rng) {
    const s = this.spec, lv = this.level;
    for (const pd of s.pads) {
      const glow = new THREE.Mesh(lv.padGlowGeo, lv.padGlowMat);
      glow.position.set(pd.x, 0.14, pd.z);
      const beam = new THREE.Mesh(lv.padBeamGeo, lv.padBeamMat);
      beam.position.set(pd.x, 1.7, pd.z);
      this.group.add(glow, beam);
      this.pads.push({ ...pd, wx: this.wx(pd.x), wz: this.wz(pd.z), cd: 0, beam });
    }
    for (const c of s.conveyors) {
      const len = c.x1 - c.x0, dep = c.z1 - c.z0;
      const tex = lv.conveyorTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set((c.dx >= 0 ? 1 : -1) * len / 2, Math.max(1, Math.round(dep / 2)));
      const mat = psxify(new THREE.MeshLambertMaterial({ map: tex, color: 0x9a9aa0 }));
      const geo = new THREE.PlaneGeometry(len, dep);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2);
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
      this.conveyors.push({ ...c, tex, wx0: this.wx(c.x0), wx1: this.wx(c.x1), wz0: this.wz(c.z0), wz1: this.wz(c.z1), speed: Math.hypot(c.dx, c.dz) * 16 });
    }
    for (const b of s.barrels) {
      const mesh = new THREE.Mesh(lv.barrelGeo, lv.barrelMat);
      const band = new THREE.Mesh(lv.barrelBandGeo, sharedMaterials().door);
      band.position.y = 0.15;
      mesh.add(band);
      mesh.position.set(b.x, 0.6, b.z);
      mesh.rotation.y = rng.next() * 3;
      this.group.add(mesh);
      const col = this.addCollider(b.x - 0.42, 0, b.z - 0.42, b.x + 0.42, 1.2, b.z + 0.42, { surface: 'metal', nav: false, tag: 'barrel' });
      const br = { room: this, mesh, col, alive: true, pos: new THREE.Vector3(this.wx(b.x), 0.6, this.wz(b.z)), fuse: -1 };
      col.ref = br;
      this.barrels.push(br);
    }
    for (const t of s.terminals) {
      const side = t.x < 0 ? -1 : 1;
      const read = lv.game.codex ? lv.game.codex.has(t.id) : false;
      const c = terminalCanvas(read);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const geo = new THREE.PlaneGeometry(0.9, 0.62);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(side * (s.W / 2 - 0.26), 1.38, t.z);
      mesh.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
      this.terminals.push({ id: t.id, pos: new THREE.Vector3(this.wx(side * (s.W / 2 - 1.0)), 0, this.wz(t.z)), mesh, tex, read, side });
    }
    for (const d of s.decor) if (d.type === 'beacon') this.beacon = buildBeacon(this, d);
    for (const gf of s.graffiti) {
      const text = GRAFFITI[gf.idx % GRAFFITI.length];
      const c = graffitiCanvas(text, gf.idx);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: false, opacity: 0.9 });
      const geo = new THREE.PlaneGeometry(2.8, 1.05);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(gf.side * (s.W / 2 - 0.03), gf.y, gf.z);
      mesh.rotation.set(0, gf.side < 0 ? Math.PI / 2 : -Math.PI / 2, gf.rot);
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
    }
  }

  // Highest walkable surface under a world point (ignores walls / ceilings / doors).
  floorAt(x, z) {
    let y = 0;
    const H = this.spec.H - 0.05;
    for (const b of this.colliders) {
      if (!b.active || b.tag === 'door' || b.maxY >= H || b.maxY <= y || b.minY > 0.3) continue;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) y = b.maxY;
    }
    return y;
  }

  // Boss gimmicks add hazard zones mid-fight (electric pulses, rising slag).
  addDynamicHazards(type, n) {
    const g = this.game, s = this.spec;
    if (this.dynHazards >= 10) return;
    const pp = g.player.body.pos;
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < n; tries++) {
      const w = type === 'molten' ? 4.5 : 3.5;
      const x = (Math.random() - 0.5) * (s.W - w - 4), z = (Math.random() - 0.5) * (s.D - w - 8);
      if (Math.hypot(this.wx(x) - pp.x, this.wz(z) - pp.z) < w + 2) continue;
      if (this.hazards.some((h) => x + w / 2 > h.x0 - 1 && x - w / 2 < h.x1 + 1 && z + w / 2 > h.z0 - 1 && z - w / 2 < h.z1 + 1)) continue;
      if (Math.hypot(x - s.entX, z - s.D / 2) < 5) continue;
      const h = type === 'electric'
        ? { type, x0: x - w / 2, z0: z - w / 2, x1: x + w / 2, z1: z + w / 2, on: 1.6, off: 2.4, phase: Math.random() * 4, dps: 30, dyn: true }
        : { type, x0: x - w / 2, z0: z - w / 2, x1: x + w / 2, z1: z + w / 2, dps: 26, dyn: true };
      const hz = this.addHazard(h);
      hz.grow = 0;
      hz.mesh.scale.set(0.01, 1, 0.01);
      this.dynHazards++;
      placed++;
      g.fx.telegraphDisc(this.wx(x), 0.05, this.wz(z), w * 0.6, type === 'electric' ? 0x40a0ff : 0xff6a10, 0.9);
    }
    if (placed) g.audio.play(type === 'electric' ? 'zap' : 'sizzle', null, 0.8);
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
    c.width = 128; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 128, 48);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 124, 44);
    ctx.fillStyle = color;
    let size = 19;
    ctx.font = `700 ${size}px "Libre Caslon Condensed", Times, serif`;
    while (ctx.measureText(lines[0]).width > 116 && size > 10) { size--; ctx.font = `700 ${size}px "Libre Caslon Condensed", Times, serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], 64, 18);
    let s2 = 14;
    ctx.font = `${s2}px VT323, monospace`;
    while (ctx.measureText(lines[1] || '').width > 118 && s2 > 8) { s2--; ctx.font = `${s2}px VT323, monospace`; }
    ctx.fillStyle = '#d8d8d8';
    ctx.fillText(lines[1] || '', 64, 36);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set(door.x, DOOR_H + 0.88, door.z + 0.6);
    this.group.add(mesh);
    door.sign = mesh;
  }

  update(dt, player) {
    this.time += dt;
    this.updateFeatures(dt);
    updateInteractive(this, dt, player);
    updateBlasts(this, dt);
    for (const d of this.doors) {
      const prev = d.open;
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 3.2);
      d.group.position.y = DOOR_H / 2 + d.open * (DOOR_H - 0.25);
      d.col.active = d.open < 0.75;
      if (prev !== d.open && (prev === 0 || prev === 1)) this.game.audio.play('door', new THREE.Vector3(this.wx(d.x), 2, this.wz(d.z)), 0.8);
    }
    // hazards
    for (const h of this.hazards) {
      if (h.grow !== undefined && h.grow < 1) {
        h.grow = Math.min(1, h.grow + dt * 1.1);
        h.mesh.scale.set(h.grow, 1, h.grow);
        h.wx0 = this.wx(h.x0 + (h.x1 - h.x0) * (1 - h.grow) / 2); h.wx1 = this.wx(h.x1 - (h.x1 - h.x0) * (1 - h.grow) / 2);
        h.wz0 = this.wz(h.z0 + (h.z1 - h.z0) * (1 - h.grow) / 2); h.wz1 = this.wz(h.z1 - (h.z1 - h.z0) * (1 - h.grow) / 2);
      }
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
    const live = this.game.state === 'playing' && this === this.level.current;
    for (const sw of this.sweepers) {
      if (this.powerOff > 0) continue;
      sw.angle += sw.speed * dt;
      sw.beam.rotation.y = sw.angle;
      sw.hitCd -= dt;
      if (!live) continue;
      const dxb = Math.cos(sw.angle), dzb = -Math.sin(sw.angle);
      const touches = (b) => {
        const lx = b.pos.x - this.wx(sw.x), lz = b.pos.z - this.wz(sw.z);
        return Math.abs(lx * dxb + lz * dzb) < sw.len && Math.abs(-lx * dzb + lz * dxb) < b.r + 0.1 && b.pos.y < sw.y + 0.1 && b.pos.y + b.h > sw.y - 0.08;
      };
      const pb = player.body;
      if (sw.hitCd <= 0 && touches(pb)) {
        sw.hitCd = 0.6;
        this.game.player.damage(18, { x: pb.pos.x - dzb, z: pb.pos.z + dxb }, 'SWEEPER BEAM', sw.y > 1 ? 'Slide under the orange sweeper beam.' : 'Jump over the red sweeper beam.');
      }
      for (const e of this.game.enemies.list) {
        if (!e.alive || !e.body || e.flying || e.mini || (e.sweptT || 0) > this.time || !touches(e.body)) continue;
        e.sweptT = this.time + 0.8;
        this.game.combat.damageEnemy(e, 45, { source: 'hazard', dir: new THREE.Vector3(-dzb * Math.sign(sw.speed), 0.3, -dxb * Math.sign(sw.speed)), knock: 7, point: e.centerPos(), fromPlayer: false });
        if (!e.alive) this.game.style.add('SWEPT', 25);
      }
    }
  }

  updateFeatures(dt) {
    for (const c of this.conveyors) c.tex.offset.x -= c.speed * dt / 2;
    if (this.beacon) this.beacon.update(dt);
    for (const p of this.pads) { p.cd -= dt; p.beam.scale.y = 0.8 + 0.2 * Math.sin(this.time * 6 + p.x); }
    for (const b of this.barrels) {
      if (b.alive && b.fuse >= 0) { b.fuse -= dt; b.mesh.position.y = 0.6 + Math.random() * 0.04; if (b.fuse < 0) this.level.explodeBarrel(b); }
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
    // shoulder lamp: always in the scene (constant light count avoids shader recompiles)
    this.playerLight = new THREE.PointLight(0xfff0d8, 0, 16, 1.4);
    game.scene.add(this.playerLight);
    this.dark = false; this.darkK = 0;
    // shared feature resources
    this.padGlowGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.03, 8);
    this.padGlowMat = new THREE.MeshBasicMaterial({ color: 0x3ef0d0 });
    this.padBeamGeo = new THREE.CylinderGeometry(0.55, 0.95, 3.2, 8, 1, true);
    this.padBeamMat = new THREE.MeshBasicMaterial({ color: 0x1a8a78, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 8);
    this.barrelBandGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.22, 8);
    this.barrelMat = psxify(new THREE.MeshLambertMaterial({ map: getTexture('panel'), color: 0xc02818 }));
    this.conveyorTex = makeConveyorTexture();
    this.cond = 'none';
    this.recentArches = [];
    this.disposeQueue = [];
    this.lightFlicker = 0;
  }

  reset(seed) {
    this.setDarkness(false);
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
    const theme = ctx.themeObj || this.themeFor(index);
    if (ctx.kit === undefined) ctx = { ...ctx, kit: KIT_BY_THEME[theme.id] || null };
    let room = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rng = new RNG(hashSeed(this.seed, index, arch, attempt));
      const spec = generateSpec(attempt < 5 ? arch : (arch === 'boss' || arch === 'miniboss' || arch === 'tutorial' ? arch : 'arena'), rng, { ...ctx, theme });
      if (attempt === 5) { spec.props = spec.props.filter((p) => p.platformFlat); spec.cyl = []; spec.sliders = []; spec.kit = []; }
      const o = origin(spec);
      room = new Room(this, index, spec, o, theme, hasCorridor, ctx);
      const nav = room.nav;
      const ex = room.wx(spec.entX), ez = room.wz(spec.D / 2 - 1.5);
      let ok = true;
      nav.flow(ex, ez);
      const check = (x, z) => { const k = nav.nearestFree(room.wx(x), room.wz(z), 2); return k >= 0 && nav.dist[k] >= 0; };
      const fails = [];
      spec.exits.forEach((x, i) => { if (!check(x, -spec.D / 2 + 1.5)) fails.push('exit' + i); });
      if (!check(spec.cachePos.x, spec.cachePos.z)) fails.push('cache');
      ok = !fails.length;
      // kept for tests / debugging: which attempts failed validation and why
      this.genLog = attempt === 0 ? [] : this.genLog || [];
      this.genLog.push({ arch: spec.arch, attempt, fails });
      if (ok || arch === 'tutorial') break;
      room.dispose();
      room = null;
    }
    this.game.scene.add(room.group);
    this.rooms.push(room);
    this.rebuildColliders();
    return room;
  }

  // The first room of a level (or of a checkpoint resume, at ctx.index so later rooms keep
  // the same indices and seeds as on the first attempt).
  startLobby(ctx = {}) {
    const room = this.createRoom(ctx.index || 0, ctx.arch || 'lobby', () => new THREE.Vector3(0, 0, 0), ctx, false);
    this.current = room;
    this.activate(room);
    room.route = { type: 'entry' };
    if (ctx.locked) { room.setDoor(room.exitDoors[0], 'locked'); room.state = 'idle'; room.routes = []; return room; }
    room.setDoor(room.exitDoors[0], 'choose');
    room.state = 'cleared';
    room.routes = ctx.routes || [{ type: 'combat', label: 'ROOM 01', sub: 'ENTER THE MACHINE', color: '#3ef0d0' }];
    room.setSign(room.exitDoors[0], [room.routes[0].label, room.routes[0].sub], room.routes[0].color);
    return room;
  }

  pickArch(index, route, ctx = {}) {
    if (ctx.arch) return ctx.arch;
    if (route === 'boss') return 'boss';
    if (route === 'cache') return 'cache';
    if (route === 'elite') return 'elite';
    if (route === 'survival') return 'survival';
    if (route === 'hazard') return 'hazard';
    const rng = new RNG(hashSeed(this.seed, 'arch', index));
    const avail = COMBAT_ARCHES.filter((a) => {
      if (index <= 2 && (a === 'gallery' || a === 'movers' || a === 'mezzanine')) return false;
      if (index === 1 && a === 'reactor') return false; // keep the first fight free of hazards
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
    const arch = this.pickArch(index, route.type, ctx);
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
    if (room.spec.bossType === 'architect') { scene.fog.color.setHex(0x0a0c14); scene.fog.far = 95; this.hemi.intensity = t.hemi * 1.5; }
    if (room.spec.open) { scene.fog.far = t.fogFar + 30; scene.fog.color.lerp(TMP_COL.setHex(0x101830), 0.5); }
    if (room.cond === 'fog') { scene.fog.near = 2; scene.fog.far = 26; scene.fog.color.lerp(new THREE.Color(0x8890a0), 0.35); }
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
    // per-room lighting mood: tints, dying tubes, beacons, undulation (same fixed lights, no recompiles)
    const rng = new RNG(hashSeed(this.seed, 'mood', room.index));
    const arch = room.spec.arch;
    let mood = room.spec.lightMood;
    if (!mood && !['boss', 'miniboss', 'tutorial', 'lobby', 'cache', 'elite'].includes(arch)) mood = rng.pick(['plain', 'plain', 'flicker', 'accent', 'accent', 'flicker']);
    const tint = MOOD_TINT[mood];
    this.lights.forEach((l, i) => {
      const s = chosen[i];
      const u = l.userData;
      if (!s) { l.intensity = 0; u.base = 0; return; }
      l.position.set(room.wx(s.x), room.spec.open ? (room.spec.lightY || 5.5) - 0.6 : room.spec.H - 1.2, room.wz(s.z));
      let col = i === 0 && room.spec.redLight ? 0xff3040 : t.light;
      if (tint !== undefined && !(i === 0 && room.spec.redLight)) col = TMP_COL.setHex(t.light).lerp(TMP_COL2.setHex(tint), 0.55).getHex();
      u.mode = 0;
      if (mood === 'accent' && i % 3 === 1) col = TMP_COL.setHex(t.light).lerp(TMP_COL2.setHex(t.accent), 0.6).getHex();
      if (mood === 'race') col = i % 2 ? t.accent : t.accent2;
      if (mood === 'night' && i % 3 === 2) col = 0x8898ff;
      if ((mood === 'flicker' || mood === 'sickly' || mood === 'shaft' || mood === 'yard') && i === chosen.length - 1) u.mode = 1; // a dying tube
      if (mood === 'candle') u.mode = 2;
      if (mood === 'water') u.mode = 3;
      if (mood === 'warning' && i === 0) { u.mode = 4; col = 0xffa020; }
      if (mood === 'race') u.mode = 5;
      if (mood === 'datacenter' && i % 2 === 0) u.mode = 6;
      u.col = col;
      u.phase = rng.next() * 10;
      l.color.setHex(col);
      l.distance = reach * (room.spec.open ? 0.8 : 1);
      u.base = (room.spec.redLight && i === 0 ? 26 : 20) * (room.spec.bossType === 'architect' ? 1.6 : 1) * (mood === 'sickly' ? 0.85 : 1);
      l.intensity = 0;
    });
    this.mood = mood;
    this.lightningT = 6 + rng.next() * 8;
    this.lightFlicker = 0.6; // lights flicker on when entering
  }

  update(dt) {
    const g = this.game;
    for (const r of this.rooms) r.update(dt, g.player);
    const room = this.current;
    if (room && g.state === 'playing') {
      // punches break crates / walls and flip switches (polled: a fresh punch resets punchT)
      const pl = g.player;
      if (pl.punchT > (this.lastPunchT === undefined ? 1 : this.lastPunchT) + 0.05 && pl.punchT > 0.2) {
        const dir = g.camera.getWorldDirection(this.tmpDir || (this.tmpDir = new THREE.Vector3()));
        if (meleeRoom(room, g.camera.position, dir)) { g.addShake(0.12); g.hitstop(0.03); }
      }
      this.lastPunchT = pl.punchT;
      // anything walking off a ledge into a pit is gone for good
      if (room.spec.holes && room.spec.holes.length) {
        for (const e of g.enemies.list) {
          if (!e.alive || e.flying || !e.body || e.mini) continue;
          if (e.body.pos.y < -3.5) {
            g.combat.damageEnemy(e, 99999, { source: 'hazard', point: e.centerPos(), fromPlayer: false });
            g.style.add('INTO THE ABYSS', 40);
          }
        }
      }
    }
    // light flicker-on + combat alarm pulse
    if (this.current) {
      this.lightFlicker = Math.max(0, this.lightFlicker - dt);
      const alarm = this.current.state === 'combat';
      const t = this.current.time, power = this.current.powerOff > 0;
      let flash = 0;
      if (this.mood === 'night') {
        // distant lightning over the skyline
        this.lightningT -= dt;
        if (this.lightningT < 0) { this.lightningT = 7 + Math.random() * 10; this.flashT = 0.35; }
        if (this.flashT > 0) { this.flashT -= dt; flash = Math.random() < 0.6 ? this.flashT * 2.4 : 0; }
      }
      this.lights.forEach((l, i) => {
        const u = l.userData, base = u.base || 0;
        let k = 1;
        if (this.lightFlicker > 0) k = Math.random() < 0.5 + (0.6 - this.lightFlicker) ? 1 : 0.15;
        switch (u.mode) {
          case 1: if (Math.sin(t * 7 + u.phase) + Math.sin(t * 23 + u.phase * 3) > 1.3) k *= 0.12; break;
          case 2: k *= 0.82 + 0.1 * Math.sin(t * 9 + u.phase) + 0.08 * Math.sin(t * 23 + u.phase * 2); break;
          case 3: k *= 0.85 + 0.15 * Math.sin(t * 1.7 + u.phase); break;
          case 4: k *= 0.35 + 0.65 * Math.max(0, Math.sin(t * 5)); break;
          case 5: k *= 0.55 + 0.45 * Math.max(0, Math.sin(t * 4 - i * 1.1)); break;
          case 6: if (((t * 3 + u.phase) | 0) % 5 === 0) k *= 0.6; break;
          default: break;
        }
        if (power) k *= 0.45;
        if (alarm && i === 0) {
          l.color.setHex(0xff2030);
          k *= 0.6 + 0.4 * Math.sin(performance.now() * 0.006);
        } else if (i === 0 && !this.current.spec.redLight) l.color.setHex(u.col !== undefined ? u.col : this.current.theme.light);
        l.intensity = base * (k + flash) * (1 - this.darkK * 0.82);
      });
      const wantDark = this.dark || this.current.cond === 'dark';
      this.darkK += ((wantDark ? 1 : 0) - this.darkK) * Math.min(1, dt * 2);
      this.playerLight.intensity = this.darkK * 22;
      if (this.darkK > 0.01) { const cam = g.camera; this.playerLight.position.set(cam.position.x, cam.position.y + 0.2, cam.position.z); }
      this.hemi.intensity = this.current.theme.hemi * (this.current.spec.bossType === 'architect' ? 1.5 : 1) * (1 - this.darkK * 0.65) * (this.current.spec.open ? 0.8 : 1) + flash * 0.8;
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

  // Jump pads, conveyor belts and level-wide physics conditions.
  applyPlayerProps(player, dt) {
    const room = this.current;
    const b = player.body;
    const cond = room ? room.cond : 'none';
    player.gravityMul = cond === 'lowgrav' ? 0.5 : 1;
    player.friction = cond === 'ice' ? 0.16 : 1;
    player.conveyor = null;
    if (!room) return;
    for (const r of [room, this.next]) {
      if (!r) continue;
      for (const p of r.pads) {
        if (p.cd > 0) continue;
        const d = Math.hypot(b.pos.x - p.wx, b.pos.z - p.wz);
        if (d < 1.15 && b.pos.y < 0.5 && b.vel.y <= 1) {
          p.cd = 0.5;
          b.vel.y = p.power * (cond === 'lowgrav' ? 0.75 : 1);
          b.grounded = false;
          const hv = Math.hypot(b.vel.x, b.vel.z);
          if (hv > 2) { b.vel.x *= 1.15; b.vel.z *= 1.15; }
          player.sliding = false;
          this.game.audio.play('pad', null, 0.9);
          this.game.fx.ring(p.wx, 0.2, p.wz, 2.2, 0x3ef0d0, 0.35);
          player.emit('pad');
        }
      }
    }
    // knee-deep water: drags walking, sliding and hopping speed; splashes
    if (room.waters && room.waters.length && b.pos.y < 0.3 && inWater(room, b.pos.x, b.pos.z)) {
      if (b.grounded) {
        const k = Math.pow(0.86, dt * 60);
        b.vel.x *= k; b.vel.z *= k;
        if (player.sliding) player.slideSpeed = Math.max(4, player.slideSpeed - dt * 14);
      }
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 2 && Math.random() < dt * 14) {
        const c = room.waterColor;
        this.game.fx.sparks.spawn(b.pos.x + (Math.random() - 0.5) * 0.6, 0.3, b.pos.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2, c.r, c.g, c.b, 0.9, 0.09, 0.45, 12, 1, 0.28);
      }
      if (!room.wasWet && b.vel.y < -6) { this.game.audio.play('sizzle', null, 0.4); this.game.fx.ring(b.pos.x, 0.3, b.pos.z, 1.6, 0xc8e4ea, 0.3); }
      room.wasWet = true;
    } else if (room) room.wasWet = false;
    if (b.grounded && b.pos.y < 0.2) {
      for (const c of room.conveyors) {
        if (b.pos.x > c.wx0 && b.pos.x < c.wx1 && b.pos.z > c.wz0 && b.pos.z < c.wz1) {
          const l = Math.hypot(c.dx, c.dz) || 1;
          moveBody(b, c.dx / l * c.speed * dt, 0, c.dz / l * c.speed * dt, this.colliders);
          break;
        }
      }
    }
    if (this.dark || this.darkK > 0) {
      const cam = this.game.camera;
      this.playerLight.position.set(cam.position.x, cam.position.y + 0.2, cam.position.z);
    }
  }

  // Enemies on conveyors drift too (cheap: only grounded walkers). Water slows them; they step
  // back from ledges unless something knocked them over the edge.
  applyEnemyProps(e, dt) {
    const room = this.current;
    if (!room || !e.body || !e.body.grounded) return;
    const p = e.body.pos;
    if (room.waters && room.waters.length && p.y < 0.3 && inWater(room, p.x, p.z)) {
      const k = Math.pow(0.88, dt * 60);
      e.body.vel.x *= k; e.body.vel.z *= k;
    }
    if (room.holeW && !(e.stagger > 0) && !(e.hooked > 0)) {
      for (const h of room.holeW) {
        if (p.x <= h.x0 || p.x >= h.x1 || p.z <= h.z0 || p.z >= h.z1) continue;
        const gb = e.body.groundBox;
        if (gb && gb.girder) break;
        const dl = p.x - h.x0, dr = h.x1 - p.x, df = p.z - h.z0, dk = h.z1 - p.z, m = Math.min(dl, dr, df, dk);
        if (m > 0.5) break;
        if (m === dl) { p.x = h.x0 - 0.02; e.body.vel.x = Math.min(0, e.body.vel.x); }
        else if (m === dr) { p.x = h.x1 + 0.02; e.body.vel.x = Math.max(0, e.body.vel.x); }
        else if (m === df) { p.z = h.z0 - 0.02; e.body.vel.z = Math.min(0, e.body.vel.z); }
        else { p.z = h.z1 + 0.02; e.body.vel.z = Math.max(0, e.body.vel.z); }
        break;
      }
    }
    if (!room.conveyors.length) return;
    for (const c of room.conveyors) {
      if (p.x > c.wx0 && p.x < c.wx1 && p.z > c.wz0 && p.z < c.wz1) { const l = Math.hypot(c.dx, c.dz) || 1; moveBody(e.body, c.dx / l * c.speed * dt, 0, c.dz / l * c.speed * dt, this.colliders); break; }
    }
  }

  hitBarrel(ref) {
    if (!ref) return;
    // destructibles and switches share the barrel tag so every gun / projectile already reaches them
    if (ref.kind === 'break') { damageDestructible(ref.room, ref, 1.5, 'shot'); return; }
    if (ref.kind === 'switch') { activateSwitch(ref.room, ref); return; }
    if (!ref.alive || ref.fuse >= 0) return;
    this.explodeBarrel(ref);
  }

  explodeBarrel(br) {
    if (!br.alive) return;
    const g = this.game;
    br.alive = false;
    br.col.active = false;
    br.room.group.remove(br.mesh);
    const p = br.pos.clone();
    p.y = 0.8;
    g.fx.explosion(p, 4.5, 0xff6a20);
    g.audio.play('barrel', p, 1);
    g.addShake(0.35);
    g.combat.radialDamage(p, 5, 120, { source: 'explosion', selfKnock: 18, barrel: true });
    g.style.add('BARREL', 15, true);
    g.emit('barrel');
  }

  // Explosions set off nearby barrels after a short fuse (chain reactions).
  blastBarrels(pos, radius) {
    const room = this.current;
    if (!room) return;
    blastRoom(room, pos, radius);
    for (const b of room.barrels) {
      if (!b.alive || b.fuse >= 0) continue;
      if (b.pos.distanceTo(pos) < radius + 0.6) b.fuse = 0.12 + Math.random() * 0.1;
    }
  }

  setDarkness(on) {
    this.dark = on;
    if (!on) this.playerLight.intensity = 0;
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

function makeConveyorTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2a30'; x.fillRect(0, 0, 32, 32);
  x.fillStyle = '#18181c'; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 2, 32);
  x.fillStyle = '#e0b020';
  x.beginPath(); x.moveTo(10, 6); x.lineTo(22, 16); x.lineTo(10, 26); x.lineTo(14, 26); x.lineTo(26, 16); x.lineTo(14, 6); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}
