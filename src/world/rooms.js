// Room archetype generators. Each returns a declarative spec in room-local coordinates:
// entrance on the +Z wall, exits on the -Z wall, floor at y = 0.

export const ARCH_NAMES = {
  lobby: ['LOBBY'],
  gauntlet: ['SERVICE HALL', 'MAINTENANCE RUN', 'CABLE DUCT', 'TRANSIT SPINE'],
  arena: ['ASSEMBLY FLOOR', 'LOADING BAY', 'TURBINE HALL', 'DRILL YARD'],
  warehouse: ['STOCK ROOM', 'PARTS DEPOT', 'COLD STORAGE', 'FREIGHT HOLD'],
  mezzanine: ['CONTROL ATRIUM', 'OBSERVATION DECK', 'SWITCHYARD', 'GANTRY HALL'],
  hazard: ['LIVE GRID', 'SUBSTATION', 'SMELTER FLOOR', 'COOLANT TRENCH'],
  gallery: ['FIRING RANGE', 'LONG GALLERY', 'CONVEYOR LINE', 'PROVING GROUND'],
  cells: ['BREAK ROOM', 'OFFICE BLOCK', 'DORMITORY', 'LAB CELLS'],
  movers: ['PRESS LINE', 'SORTING FLOOR', 'PISTON HALL', 'CRUSHER BAY'],
  survival: ['HOLDOUT', 'KILLBOX', 'THE PIT', 'SIEGE RING'],
  elite: ['WARDEN POST', 'VAULT', 'EXECUTIVE SUITE', 'COMMAND NEST'],
  cache: ['ARMORY', 'MEDBAY', 'SUPPLY CACHE', 'WORKSHOP'],
  reactor: ['CORE ACCESS', 'COOLING TOWER', 'REACTOR RING', 'HEAT SINK'],
  boss: ['ARENA'],
};

function base(rng, arch, W, D, H) {
  return {
    arch, name: rng.pick(ARCH_NAMES[arch]), W, D, H,
    entX: 0, exits: [0],
    props: [], cyl: [], decor: [], hazards: [], sweepers: [], sliders: [], perches: [],
    keepClear: [], lightSpots: [], rugs: [], screens: [],
    cachePos: { x: 0, z: 0 },
  };
}

// helpers -------------------------------------------------------------------------------
function prop(s, x0, y0, z0, x1, y1, z1, mat = 'crate', surface = 'wood', extra = {}) {
  s.props.push({ x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), mat, surface, ...extra });
}
function crate(s, rng, x, z, size = 1.4, stack = 1) {
  const h = size;
  prop(s, x - size / 2, 0, z - size / 2, x + size / 2, h, z + size / 2, 'crate', 'wood', { tint: rng.range(0.75, 1.1) });
  if (stack > 1) {
    const o = rng.range(-0.2, 0.2);
    const s2 = size * 0.8;
    prop(s, x - s2 / 2 + o, h, z - s2 / 2 - o, x + s2 / 2 + o, h + s2, z + s2 / 2 - o, 'crate', 'wood', { tint: rng.range(0.75, 1.1) });
  }
}
function barrier(s, rng, x, z, len, axis = 'x', h = 1.15) {
  const t = 0.5;
  if (axis === 'x') prop(s, x - len / 2, 0, z - t / 2, x + len / 2, h, z + t / 2, 'concrete', 'concrete', { trimTop: true });
  else prop(s, x - t / 2, 0, z - len / 2, x + t / 2, h, z + len / 2, 'concrete', 'concrete', { trimTop: true });
}
function pillar(s, x, z, size, H, mat = 'trim') {
  prop(s, x - size / 2, 0, z - size / 2, x + size / 2, H, z + size / 2, mat, 'metal', { pillar: true });
}
function barrel(s, rng, x, z) {
  s.cyl.push({ x, z, r: 0.42, y0: 0, y1: 1.15, mat: rng.chance(0.3) ? 'hazard' : 'trim', collide: true });
}
function platform(s, rng, x0, z0, x1, z1, h, stairSide = 'south') {
  prop(s, x0, 0, z0, x1, h, z1, 'trim', 'metal', { platform: true, tint: 0.9 });
  // railing (thin, blocks movement, allows shooting over)
  s.perches.push({ x0: x0 + 0.6, z0: z0 + 0.6, x1: x1 - 0.6, z1: z1 - 0.6, y: h });
  const steps = Math.ceil(h / 0.38);
  const rise = h / steps, run = 0.55, w = 2.2;
  for (let i = 1; i <= steps; i++) {
    const y = rise * i;
    if (stairSide === 'south') { const cx = (x0 + x1) / 2; const z = z1 + (steps - i) * run; prop(s, cx - w / 2, 0, z, cx + w / 2, y, z + run, 'trim', 'metal', { tint: 0.7 }); }
    else if (stairSide === 'north') { const cx = (x0 + x1) / 2; const z = z0 - (steps - i) * run; prop(s, cx - w / 2, 0, z - run, cx + w / 2, y, z, 'trim', 'metal', { tint: 0.7 }); }
    else if (stairSide === 'east') { const cz = (z0 + z1) / 2; const x = x1 + (steps - i) * run; prop(s, x, 0, cz - w / 2, x + run, y, cz + w / 2, 'trim', 'metal', { tint: 0.7 }); }
    else { const cz = (z0 + z1) / 2; const x = x0 - (steps - i) * run; prop(s, x - run, 0, cz - w / 2, x, y, cz + w / 2, 'trim', 'metal', { tint: 0.7 }); }
  }
}
function lightGrid(s, rng, nx, nz) {
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -s.W / 2 + (i + 0.5) * (s.W / nx);
    const z = -s.D / 2 + (j + 0.5) * (s.D / nz);
    s.lightSpots.push({ x: x + rng.range(-0.5, 0.5), z: z + rng.range(-0.5, 0.5) });
  }
}
function exitsFor(rng, W, count) {
  if (count <= 1) return [rng.range(-W / 2 + 4, W / 2 - 4) * (W > 14 ? 0.5 : 0)];
  const off = Math.min(W / 2 - 3.5, Math.max(4, W * 0.28));
  return [-off, off];
}
function scatter(s, rng, count, fn, margin = 2.5) {
  let tries = 0, placed = 0;
  while (placed < count && tries < count * 20) {
    tries++;
    const x = rng.range(-s.W / 2 + margin, s.W / 2 - margin);
    const z = rng.range(-s.D / 2 + margin + 3, s.D / 2 - margin - 3);
    if (Math.hypot(x - s.cachePos.x, z - s.cachePos.z) < 2.5) continue;
    if (fn(x, z) !== false) placed++;
  }
}

// archetypes --------------------------------------------------------------------------
const GEN = {
  lobby(rng) {
    const s = base(rng, 'lobby', 14, 22, 5);
    s.exits = [0];
    crate(s, rng, -4.5, -2, 1.4, 2);
    crate(s, rng, 4.8, 3, 1.2, 1);
    barrier(s, rng, 3, -5, 3, 'x');
    barrel(s, rng, -5, 5); barrel(s, rng, -5.6, 6);
    lightGrid(s, rng, 1, 3);
    s.screens.push({ x: -s.W / 2 + 0.05, z: 0, side: 'west' });
    s.cachePos = { x: 0, z: 3 };
    return s;
  },
  gauntlet(rng) {
    const W = rng.int(9, 11), D = rng.int(36, 46), H = rng.int(5, 6);
    const s = base(rng, 'gauntlet', W, D, H);
    s.entX = 0; s.exits = [0];
    // alternating half walls create cover pockets
    let side = rng.sign();
    for (let z = D / 2 - 7; z > -D / 2 + 6; z -= rng.range(5.5, 7.5)) {
      const len = W * rng.range(0.38, 0.5);
      const x = side * (W / 2 - len / 2);
      if (rng.chance(0.7)) prop(s, x - len / 2, 0, z - 0.4, x + len / 2, rng.chance(0.5) ? 1.2 : H, z + 0.4, 'wall', 'metal', { tint: 0.85 });
      else crate(s, rng, x * 0.8, z, 1.5, 2);
      side = -side;
    }
    lightGrid(s, rng, 1, 5);
    s.cachePos = { x: 0, z: -D / 2 + 4 };
    return s;
  },
  arena(rng) {
    const W = rng.int(28, 34), D = rng.int(28, 34), H = rng.int(7, 9);
    const s = base(rng, 'arena', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const ring = rng.range(6, 9);
    const n = rng.pick([4, 4, 6]);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      pillar(s, Math.cos(a) * ring, Math.sin(a) * ring, rng.range(1.6, 2.4), H);
    }
    scatter(s, rng, rng.int(4, 7), (x, z) => {
      if (Math.hypot(x, z) < ring + 2.5 && Math.hypot(x, z) > ring - 2.5) return false;
      if (rng.chance(0.5)) crate(s, rng, x, z, 1.4, rng.int(1, 2)); else barrier(s, rng, x, z, rng.range(2.5, 4), rng.chance(0.5) ? 'x' : 'z');
    });
    if (rng.chance(0.5)) platform(s, rng, -3, -3, 3, 3, 1.6, rng.pick(['south', 'north', 'east', 'west']));
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: s.perches.length ? 6 : 0 };
    return s;
  },
  warehouse(rng) {
    const W = rng.int(26, 32), D = rng.int(30, 38), H = rng.int(7, 8);
    const s = base(rng, 'warehouse', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    // shelving rows along z with aisles
    const rows = Math.floor((W - 8) / 6);
    for (let r = 0; r < rows; r++) {
      const x = -W / 2 + 6 + r * 6 + rng.range(-0.5, 0.5);
      let z = D / 2 - 6;
      while (z > -D / 2 + 6) {
        const len = rng.range(5, 9);
        const z1 = Math.max(-D / 2 + 6, z - len);
        if (z - z1 > 2.5) {
          prop(s, x - 0.8, 0, z1, x + 0.8, rng.pick([2.4, 3.2, 4]), z, 'trim', 'metal', { shelf: true });
        }
        z = z1 - rng.range(2.5, 3.5);
      }
    }
    scatter(s, rng, rng.int(3, 6), (x, z) => crate(s, rng, x, z, rng.range(1, 1.5), rng.int(1, 2)), 3);
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 0 };
    return s;
  },
  mezzanine(rng) {
    const W = rng.int(26, 30), D = rng.int(28, 34), H = 10;
    const s = base(rng, 'mezzanine', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const h = rng.pick([3, 3.4]);
    platform(s, rng, -W / 2, -D / 2 + 6, -W / 2 + 5, D / 2 - 8, h, 'east');
    platform(s, rng, W / 2 - 5, -D / 2 + 6, W / 2, D / 2 - 8, h, 'west');
    if (rng.chance(0.6)) platform(s, rng, -4, -D / 2 + 1, 4, -D / 2 + 4.5, 2.4, 'south');
    scatter(s, rng, 4, (x, z) => { if (Math.abs(x) > W / 2 - 9) return false; crate(s, rng, x, z, 1.3, rng.int(1, 2)); });
    barrier(s, rng, 0, 2, 4, 'x');
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 6 };
    return s;
  },
  hazard(rng, ctx) {
    const W = rng.int(22, 28), D = rng.int(26, 32), H = 7;
    const s = base(rng, 'hazard', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const type = ctx.theme.hazard;
    // striped hazard strips across the room that cycle (electric) or are permanent pools (molten/coolant)
    const strips = rng.int(3, 4);
    const span = D - 12;
    for (let i = 0; i < strips; i++) {
      const z = D / 2 - 6 - (i + 0.5) * (span / strips);
      const depth = rng.range(2.2, 3.2);
      if (type === 'electric') {
        s.hazards.push({ type, x0: -W / 2, z0: z - depth / 2, x1: W / 2, z1: z + depth / 2, on: 2.0, off: 2.4, phase: i * 1.1, dps: 34 });
      } else {
        // pools with a walkway gap
        const gap = rng.range(-W / 2 + 4, W / 2 - 4);
        s.hazards.push({ type, x0: -W / 2, z0: z - depth / 2, x1: gap - 1.5, z1: z + depth / 2, dps: 30 });
        s.hazards.push({ type, x0: gap + 1.5, z0: z - depth / 2, x1: W / 2, z1: z + depth / 2, dps: 30 });
      }
      if (rng.chance(0.7)) crate(s, rng, rng.range(-W / 2 + 3, W / 2 - 3), z + depth / 2 + 1.6, 1.3, 1);
    }
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: -D / 2 + 4 };
    return s;
  },
  gallery(rng) {
    const W = rng.int(15, 19), D = rng.int(50, 58), H = rng.int(6, 8);
    const s = base(rng, 'gallery', W, D, H);
    s.exits = [0];
    for (let z = D / 2 - 9; z > -D / 2 + 10; z -= rng.range(6, 8)) {
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k++) {
        const x = rng.range(-W / 2 + 3, W / 2 - 3);
        barrier(s, rng, x, z, rng.range(2.4, 4), 'x', rng.pick([1.1, 1.1, 1.6]));
      }
    }
    // far perch for snipers
    platform(s, rng, -W / 2, -D / 2, -W / 2 + 4.5, -D / 2 + 5, 3, 'east');
    if (rng.chance(0.6)) platform(s, rng, W / 2 - 4.5, -D / 2, W / 2, -D / 2 + 5, 3, 'west');
    s.exits = [0];
    lightGrid(s, rng, 2, 6);
    s.cachePos = { x: 0, z: D / 2 - 6 };
    return s;
  },
  cells(rng) {
    const W = rng.int(24, 28), D = rng.int(24, 28), H = 5;
    const s = base(rng, 'cells', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    // a 3x3 grid of chambers with doorways
    const cw = W / 3, cd = (D - 6) / 3;
    for (let i = 1; i < 3; i++) {
      const x = -W / 2 + i * cw;
      for (let j = 0; j < 3; j++) {
        const z0 = -D / 2 + 3 + j * cd, z1 = z0 + cd;
        const gapC = (z0 + z1) / 2 + rng.range(-cd * 0.2, cd * 0.2);
        prop(s, x - 0.3, 0, z0, x + 0.3, H, gapC - 1.4, 'wall', 'metal', { tint: 0.8 });
        prop(s, x - 0.3, 0, gapC + 1.4, x + 0.3, H, z1, 'wall', 'metal', { tint: 0.8 });
      }
    }
    for (let j = 1; j < 3; j++) {
      const z = -D / 2 + 3 + j * cd;
      for (let i = 0; i < 3; i++) {
        const x0 = -W / 2 + i * cw, x1 = x0 + cw;
        const gapC = (x0 + x1) / 2 + rng.range(-cw * 0.2, cw * 0.2);
        if (rng.chance(0.25)) continue; // occasional open side
        prop(s, x0 + 0.3, 0, z - 0.3, gapC - 1.4, H, z + 0.3, 'wall', 'metal', { tint: 0.8 });
        prop(s, gapC + 1.4, 0, z - 0.3, x1 - 0.3, H, z + 0.3, 'wall', 'metal', { tint: 0.8 });
      }
    }
    // furniture: tables
    for (let k = 0; k < 5; k++) {
      const x = rng.range(-W / 2 + 2, W / 2 - 2), z = rng.range(-D / 2 + 5, D / 2 - 5);
      prop(s, x - 0.9, 0, z - 0.5, x + 0.9, 0.85, z + 0.5, 'crate', 'wood', { tint: 0.6, table: true });
    }
    for (let k = 0; k < 3; k++) s.rugs.push({ x: rng.range(-W / 2 + 4, W / 2 - 4), z: rng.range(-D / 2 + 6, D / 2 - 6), w: rng.range(3, 5), d: rng.range(2, 4) });
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 0 };
    return s;
  },
  movers(rng) {
    const W = rng.int(26, 30), D = rng.int(28, 34), H = 8;
    const s = base(rng, 'movers', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const lanes = rng.int(2, 3);
    for (let i = 0; i < lanes; i++) {
      const z = D / 2 - 8 - i * ((D - 14) / lanes);
      s.sliders.push({ x: 0, z, w: rng.range(3, 4.5), d: 1.2, h: rng.pick([1.3, 2.2]), axis: 'x', amp: W / 2 - 4, speed: rng.range(0.35, 0.6), phase: rng.next() * 6 });
    }
    s.sweepers.push({ x: 0, z: -2, len: Math.min(W, D) * 0.42, speed: rng.range(0.7, 1.0) * rng.sign(), y: 0.45 });
    scatter(s, rng, 4, (x, z) => { crate(s, rng, x, z, 1.2, 1); }, 3);
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: -D / 2 + 4 };
    return s;
  },
  survival(rng) {
    const W = rng.int(28, 32), D = W, H = 9;
    const s = base(rng, 'survival', W, D, H);
    s.exits = [0];
    s.survival = true;
    // octagon-ish corners
    const c = 5;
    prop(s, -W / 2, 0, -D / 2, -W / 2 + c, H, -D / 2 + c, 'wall', 'metal');
    prop(s, W / 2 - c, 0, -D / 2, W / 2, H, -D / 2 + c, 'wall', 'metal');
    prop(s, -W / 2, 0, D / 2 - c, -W / 2 + c, H, D / 2, 'wall', 'metal');
    prop(s, W / 2 - c, 0, D / 2 - c, W / 2, H, D / 2, 'wall', 'metal');
    // ring of low cover
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      barrier(s, rng, Math.cos(a) * 7, Math.sin(a) * 7, 2.6, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x');
    }
    platform(s, rng, -2, -2, 2, 2, 1.2, 'south');
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 5 };
    return s;
  },
  elite(rng) {
    const W = rng.int(20, 24), D = rng.int(22, 26), H = 7;
    const s = base(rng, 'elite', W, D, H);
    s.exits = [0];
    pillar(s, -5, -3, 1.8, H); pillar(s, 5, -3, 1.8, H); pillar(s, -5, 4, 1.8, H); pillar(s, 5, 4, 1.8, H);
    barrier(s, rng, 0, 0, 4, 'x', 1.2);
    s.rugs.push({ x: 0, z: 0, w: 6, d: 10 });
    lightGrid(s, rng, 2, 2);
    s.cachePos = { x: 0, z: -D / 2 + 4 };
    s.redLight = true;
    return s;
  },
  cache(rng) {
    const W = rng.int(14, 16), D = rng.int(16, 18), H = 5;
    const s = base(rng, 'cache', W, D, H);
    s.exits = [0];
    // armory racks along walls
    for (let z = -D / 2 + 3; z < D / 2 - 4; z += 3.2) {
      prop(s, -W / 2, 0, z, -W / 2 + 1, 2.4, z + 2.2, 'trim', 'metal', { rack: true });
      prop(s, W / 2 - 1, 0, z, W / 2, 2.4, z + 2.2, 'trim', 'metal', { rack: true });
    }
    crate(s, rng, -3, -3, 1.2, 2); crate(s, rng, 3.5, 2, 1.2, 1);
    s.screens.push({ x: -s.W / 2 + 1.05, z: 0, side: 'west' });
    lightGrid(s, rng, 1, 2);
    s.cachePos = { x: 0, z: 0 };
    s.calm = true;
    return s;
  },
  reactor(rng, ctx) {
    const W = rng.int(28, 32), D = rng.int(28, 32), H = 10;
    const s = base(rng, 'reactor', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    s.cyl.push({ x: 0, z: 0, r: 3.2, y0: 0, y1: H, mat: 'trim', collide: true, core: true });
    s.decor.push({ type: 'coreRing', x: 0, z: 0, r: 3.35, y: 2.2 });
    s.decor.push({ type: 'coreRing', x: 0, z: 0, r: 3.35, y: 5.5 });
    const hz = ctx.theme.hazard === 'electric' ? 'coolant' : ctx.theme.hazard;
    // pools in the four corners
    const p = 3.5;
    s.hazards.push({ type: hz, x0: -W / 2 + 1, z0: -D / 2 + 3, x1: -W / 2 + 1 + p * 1.6, z1: -D / 2 + 3 + p, dps: 28 });
    s.hazards.push({ type: hz, x0: W / 2 - 1 - p * 1.6, z0: D / 2 - 3 - p, x1: W / 2 - 1, z1: D / 2 - 3, dps: 28 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      barrier(s, rng, Math.cos(a) * 8.5, Math.sin(a) * 8.5, 3, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x');
    }
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 6 };
    return s;
  },
  boss(rng, ctx) {
    const bt = ctx.bossType;
    const W = bt === 'crucible' ? 40 : 38, D = bt === 'crucible' ? 40 : 40, H = 13;
    const s = base(rng, 'boss', W, D, H);
    s.exits = [0];
    s.bossType = bt;
    if (bt === 'grindhammer') {
      // breakable pillars to bait charges into
      for (const [x, z] of [[-10, -9], [10, -9], [-10, 6], [10, 6], [-4.5, -1], [4.5, -1]]) pillar(s, x, z, 2.4, H, 'concrete');
      s.props.forEach((p) => { p.breakable = true; });
    } else if (bt === 'vesper') {
      for (const [x, z] of [[-10, -10], [10, -10], [-10, 9], [10, 9]]) platform(s, rng, x - 2.5, z - 2.5, x + 2.5, z + 2.5, 2.4, x < 0 ? 'east' : 'west');
      barrier(s, rng, 0, 4, 5, 'x'); barrier(s, rng, 0, -6, 5, 'x');
    } else if (bt === 'crucible') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        barrier(s, rng, Math.cos(a) * 13, Math.sin(a) * 13, 3, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x', 1.3);
      }
    } else {
      // scythewright: open arena with walls to bait the lunge into
      for (const [x, z] of [[-11, -9], [11, -9], [-11, 9], [11, 9]]) pillar(s, x, z, 3, H, 'trim');
      barrier(s, rng, -5, 0, 3.5, 'z'); barrier(s, rng, 5, 0, 3.5, 'z');
    }
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 8 };
    s.redLight = true;
    return s;
  },
};

export const COMBAT_ARCHES = ['gauntlet', 'arena', 'warehouse', 'mezzanine', 'gallery', 'cells', 'movers', 'reactor'];

export function generateSpec(arch, rng, ctx) {
  const s = GEN[arch](rng, ctx);
  s.arch = arch;
  // keep entrance / exit approaches clear of props
  s.keepClear.push({ x: s.entX, z: s.D / 2 - 1.8, r: 3.2 });
  for (const ex of s.exits) s.keepClear.push({ x: ex, z: -s.D / 2 + 1.8, r: 3.2 });
  s.keepClear.push({ x: s.cachePos.x, z: s.cachePos.z, r: 1.6 });
  const clear = (p) => s.keepClear.some((k) => {
    const cx = Math.max(p.x0, Math.min(k.x, p.x1));
    const cz = Math.max(p.z0, Math.min(k.z, p.z1));
    return Math.hypot(cx - k.x, cz - k.z) < k.r;
  });
  s.props = s.props.filter((p) => !clear(p));
  s.cyl = s.cyl.filter((c) => c.core || !clear({ x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r }));
  // clamp props inside the room
  for (const p of s.props) {
    p.x0 = Math.max(p.x0, -s.W / 2); p.x1 = Math.min(p.x1, s.W / 2);
    p.z0 = Math.max(p.z0, -s.D / 2); p.z1 = Math.min(p.z1, s.D / 2);
  }
  s.props = s.props.filter((p) => p.x1 - p.x0 > 0.05 && p.z1 - p.z0 > 0.05);
  return s;
}
