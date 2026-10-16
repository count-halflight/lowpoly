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
  checkpoint: ['RELAY SHRINE', 'WAYSTATION', 'QUIET ROOM', 'SAVE VAULT'],
  reactor: ['CORE ACCESS', 'COOLING TOWER', 'REACTOR RING', 'HEAT SINK'],
  boss: ['ARENA'],
  pit: ['THE PIT', 'SUMP', 'CAULDRON', 'DRAIN HALL'],
  bridges: ['CATWALKS', 'GANTRY CROSSING', 'SPILLWAY', 'TRESTLES'],
  tower: ['UPDRAFT', 'LIFT SHAFT', 'RISER', 'STACK'],
  hall: ['NAVE', 'PROCESSION', 'COLONNADE', 'GREAT HALL'],
  miniboss: ['HOLDING PEN', 'CONTAINMENT', 'PROVING CAGE', 'THE RING'],
  tutorial: ['TRAINING HALL'],
};

function base(rng, arch, W, D, H) {
  return {
    arch, name: rng.pick(ARCH_NAMES[arch]), W, D, H,
    entX: 0, exits: [0],
    props: [], cyl: [], decor: [], hazards: [], sweepers: [], sliders: [], perches: [],
    keepClear: [], lightSpots: [], rugs: [], screens: [],
    pads: [], conveyors: [], barrels: [], terminals: [], graffiti: [], kit: [],
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
  if (stairSide === 'none') { s.perches.push({ x0: x0 + 0.6, z0: z0 + 0.6, x1: x1 - 0.6, z1: z1 - 0.6, y: h }); return; }
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
  // checkpoint: a calm, symmetrical relay room built around the save beacon
  checkpoint(rng) {
    const W = rng.int(14, 16), D = rng.int(18, 20), H = 7;
    const s = base(rng, 'checkpoint', W, D, H);
    s.exits = [0];
    s.cyl.push({ x: 0, z: 0, r: 0.75, y0: 0, y1: 1.1, mat: 'trim', collide: true, core: true });
    s.decor.push({ type: 'beacon', x: 0, z: 0 });
    for (let i = 0; i < 4; i++) { // bollards around the beacon
      const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * 3.6, z = Math.sin(a) * 3.6;
      prop(s, x - 0.28, 0, z - 0.28, x + 0.28, 0.9, z + 0.28, 'trim', 'metal', { keep: true });
    }
    // benches along the side walls
    prop(s, -W / 2, 0, -2.2, -W / 2 + 1.1, 0.55, 2.2, 'trim', 'metal', { tint: 0.8 });
    prop(s, W / 2 - 1.1, 0, -2.2, W / 2, 0.55, 2.2, 'trim', 'metal', { tint: 0.8 });
    crate(s, rng, -W / 2 + 1.6, -D / 2 + 2.4, 1.2, 1); crate(s, rng, W / 2 - 1.6, D / 2 - 3.2, 1.2, 2);
    s.screens.push({ x: -s.W / 2 + 0.05, z: -5, side: 'west' });
    lightGrid(s, rng, 1, 2);
    s.keepClear.push({ x: 0, z: 0, r: 3.2 });
    s.cachePos = { x: 0, z: 4.6 };
    s.calm = true;
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
    const def = ctx.bossDef || {};
    const big = bt === 'architect';
    const W = big ? 52 : bt === 'crucible' ? 40 : 38, D = big ? 54 : 40, H = big ? 20 : 13;
    const s = base(rng, 'boss', W, D, H);
    s.exits = [0];
    s.bossType = bt;
    const layout = def.arena || (def.gimmick === 'pillars' ? 'pillars' : def.gimmick === 'pylons' ? 'ring' : def.gimmick === 'darkness' ? 'columns' : def.chassis && ['hover', 'orb', 'swarm', 'crystal', 'serpent'].includes(def.chassis) ? 'platforms' : 'cover');
    if (big) {
      // the final arena: a ring of low cover and four raised platforms with stairs
      for (const [x, z] of [[-16, -6], [16, -6], [-16, 12], [16, 12]]) platform(s, rng, x - 3, z - 3, x + 3, z + 3, 2.6, x < 0 ? 'east' : 'west');
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; barrier(s, rng, Math.cos(a) * 9, 6 + Math.sin(a) * 6, 3, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x', 1.2); }
      s.pads = [{ x: -8, z: 16, power: 15 }, { x: 8, z: 16, power: 15 }];
      s.cachePos = { x: 0, z: 18 };
    } else if (bt === 'grindhammer' || layout === 'pillars') {
      for (const [x, z] of [[-10, -9], [10, -9], [-10, 6], [10, 6], [-4.5, -1], [4.5, -1]]) pillar(s, x, z, 2.4, H, 'concrete');
      s.props.forEach((p) => { p.breakable = true; });
    } else if (bt === 'vesper' || layout === 'platforms') {
      for (const [x, z] of [[-10, -10], [10, -10], [-10, 9], [10, 9]]) platform(s, rng, x - 2.5, z - 2.5, x + 2.5, z + 2.5, 2.4, x < 0 ? 'east' : 'west');
      barrier(s, rng, 0, 4, 5, 'x'); barrier(s, rng, 0, -6, 5, 'x');
      s.pads = [{ x: 0, z: 0, power: 14 }];
    } else if (bt === 'crucible' || layout === 'ring') {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; barrier(s, rng, Math.cos(a) * 15, Math.sin(a) * 15, 3, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x', 1.3); }
    } else if (layout === 'columns') {
      for (let i = -1; i <= 1; i += 2) for (let k = -2; k <= 2; k++) pillar(s, i * 11, k * 6.5, 1.8, H, 'trim');
      barrier(s, rng, 0, 0, 6, 'x');
    } else {
      for (const [x, z] of [[-11, -9], [11, -9], [-11, 9], [11, 9]]) pillar(s, x, z, 3, H, 'trim');
      barrier(s, rng, -5, 0, 3.5, 'z'); barrier(s, rng, 5, 0, 3.5, 'z');
    }
    lightGrid(s, rng, 3, 3);
    if (!big) s.cachePos = { x: 0, z: 8 };
    s.redLight = true;
    return s;
  },
  miniboss(rng) {
    const W = rng.int(28, 32), D = rng.int(28, 32), H = 10;
    const s = base(rng, 'miniboss', W, D, H);
    s.exits = [0];
    const variant = rng.int(0, 2);
    if (variant === 0) { for (const [x, z] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) pillar(s, x, z, 2, H, 'trim'); }
    else if (variant === 1) { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; barrier(s, rng, Math.cos(a) * 9, Math.sin(a) * 9, 3, Math.abs(Math.cos(a)) > 0.7 ? 'z' : 'x'); } }
    else { platform(s, rng, -W / 2, -4, -W / 2 + 5, 4, 2.4, 'east'); platform(s, rng, W / 2 - 5, -4, W / 2, 4, 2.4, 'west'); barrier(s, rng, 0, 3, 4, 'x'); }
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 6 };
    s.redLight = true;
    return s;
  },
  pit(rng, ctx) {
    const W = rng.int(28, 32), D = rng.int(28, 32), H = 9;
    const s = base(rng, 'pit', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const hz = ctx.theme.hazard === 'electric' ? 'molten' : ctx.theme.hazard;
    const r = rng.range(5, 7);
    s.hazards.push({ type: hz, x0: -r, z0: -r, x1: r, z1: r, dps: 34 });
    // stepping stones across the pit
    for (let k = -1; k <= 1; k++) prop(s, -1, 0, k * 3.5 - 1, 1, 0.9, k * 3.5 + 1, 'trim', 'metal', { tint: 0.8, trimTop: true });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; pillar(s, Math.cos(a) * (r + 3.5), Math.sin(a) * (r + 3.5), 1.6, H); }
    s.pads = [{ x: -(r + 2), z: 0, power: 13 }, { x: r + 2, z: 0, power: 13 }];
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: r + 4 };
    return s;
  },
  bridges(rng, ctx) {
    const W = rng.int(24, 28), D = rng.int(30, 36), H = 9;
    const s = base(rng, 'bridges', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const hz = ctx.theme.hazard === 'electric' ? 'coolant' : ctx.theme.hazard;
    // the middle floor is a hazard channel; low grated walkways cross it
    s.hazards.push({ type: hz, x0: -W / 2, z0: -D / 2 + 5, x1: W / 2, z1: D / 2 - 5, dps: 30 });
    const y = 0.32;
    const lanes = rng.pick([[-7, 7], [-9, 0, 9], [-5, 5]]);
    for (const x of lanes) prop(s, x - 1.4, 0, -D / 2 + 4, x + 1.4, y, D / 2 - 4, 'grate', 'metal', { platformFlat: true });
    prop(s, -W / 2, 0, -1.3, W / 2, y, 1.3, 'grate', 'metal', { platformFlat: true });
    if (rng.chance(0.5)) prop(s, -W / 2, 0, -D / 4 - 1.1, W / 2, y, -D / 4 + 1.1, 'grate', 'metal', { platformFlat: true });
    for (let i = 0; i < 3; i++) crate(s, rng, rng.pick(lanes), rng.range(-D / 2 + 9, D / 2 - 9), 1.1, 1);
    // gantry towers on the banks for snipers
    platform(s, rng, -W / 2, -D / 2, -W / 2 + 4, -D / 2 + 4.5, 2.6, 'east');
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: lanes[0], z: D / 2 - 3 };
    return s;
  },
  tower(rng) {
    const W = rng.int(22, 26), D = rng.int(24, 28), H = 16;
    const s = base(rng, 'tower', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    platform(s, rng, -W / 2, -4, -W / 2 + 6, 4, 4, 'east');
    platform(s, rng, W / 2 - 6, -4, W / 2, 4, 4, 'west');
    prop(s, -4, 0, -D / 2 + 1, 4, 7, -D / 2 + 5, 'trim', 'metal', { platform: true, tint: 0.85 });
    s.perches.push({ x0: -3.4, z0: -D / 2 + 1.6, x1: 3.4, z1: -D / 2 + 4.4, y: 7 });
    s.pads = [{ x: 0, z: 0, power: 17 }, { x: -6, z: 7, power: 14 }, { x: 6, z: 7, power: 14 }, { x: 0, z: -D / 2 + 8, power: 16 }];
    for (let i = 0; i < 3; i++) crate(s, rng, rng.range(-W / 2 + 8, W / 2 - 8), rng.range(-4, 8), 1.2, 1);
    lightGrid(s, rng, 2, 3);
    s.cachePos = { x: 0, z: 6 };
    return s;
  },
  hall(rng) {
    const W = rng.int(18, 22), D = rng.int(42, 50), H = 12;
    const s = base(rng, 'hall', W, D, H);
    s.exits = [0];
    for (let z = D / 2 - 8; z > -D / 2 + 6; z -= 6) { pillar(s, -W / 2 + 4, z, 1.6, H, 'trim'); pillar(s, W / 2 - 4, z, 1.6, H, 'trim'); }
    for (let z = D / 2 - 11; z > -D / 2 + 9; z -= 6) { prop(s, -4.5, 0, z - 0.4, -1.5, 0.9, z + 0.4, 'crate', 'wood', { tint: 0.6 }); prop(s, 1.5, 0, z - 0.4, 4.5, 0.9, z + 0.4, 'crate', 'wood', { tint: 0.6 }); }
    platform(s, rng, -4, -D / 2, 4, -D / 2 + 4, 1.4, 'south');
    s.rugs.push({ x: 0, z: 0, w: 2.4, d: D - 12 });
    lightGrid(s, rng, 2, 6);
    s.cachePos = { x: 0, z: -D / 2 + 7 };
    return s;
  },
  tutorial(rng, ctx) {
    const st = ctx.station || 0;
    const W = 16, D = st === 6 ? 44 : st === 9 ? 26 : 22, H = st === 5 ? 9 : st === 8 ? 10 : 7;
    const s = base(rng, 'tutorial', W, D, H);
    s.exits = [0];
    s.station = st;
    if (st === 3) s.hazards.push({ type: 'molten', x0: -W / 2, z0: -2.5, x1: W / 2, z1: 2.5, dps: 12 });
    if (st === 4) prop(s, -W / 2, 1.05, -1.5, W / 2, H, -0.5, 'wall', 'metal', { tint: 0.7, slideGate: true, noNav: true, keep: true });
    if (st === 5) {
      // a 3.6m wall across the room; climb the chimney on the east side by wall-jumping
      prop(s, -W / 2, 0, -1.6, W / 2, 3.6, -0.4, 'wall', 'metal', { tint: 0.75, noNav: true, trimTop: true, keep: true });
      prop(s, W / 2 - 3.1, 0, -0.4, W / 2 - 2.7, 3.6, 4.5, 'wall', 'metal', { tint: 0.6, noNav: true, keep: true });
    }
    if (st === 6) { for (let z = D / 2 - 8; z > -D / 2 + 6; z -= 6) s.rugs.push({ x: 0, z, w: 3, d: 0.5 }); }
    if (st === 8) {
      s.pads = [{ x: 0, z: 3, power: 17.5 }];
      prop(s, -W / 2, 0, -3, W / 2, 5.2, -1, 'trim', 'metal', { tint: 0.75, noNav: true, trimTop: true, keep: true });
    }
    if (st === 9) { pillar(s, -4, -2, 1.6, H); pillar(s, 4, -2, 1.6, H); barrier(s, rng, 0, 3, 4, 'x'); }
    lightGrid(s, rng, 1, Math.round(D / 7));
    s.cachePos = { x: -W / 2 + 3, z: D / 2 - 5 };
    s.calm = true;
    return s;
  },
};

// Thematic decoration kits: each stratum dresses its rooms differently.
function decorate(s, rng, kit) {
  const n = Math.round(s.W * s.D / 90);
  const wallSpot = () => {
    const side = rng.int(0, 1) ? 1 : -1;
    return { x: side * (s.W / 2 - 1.1), z: rng.range(-s.D / 2 + 4, s.D / 2 - 4), side };
  };
  for (let i = 0; i < n; i++) {
    const w = wallSpot();
    const k = { kind: kit, x: w.x, z: w.z, side: w.side, v: rng.next() };
    s.kit.push(k);
  }
}

export const COMBAT_ARCHES = ['gauntlet', 'arena', 'warehouse', 'mezzanine', 'gallery', 'cells', 'movers', 'reactor', 'pit', 'bridges', 'tower', 'hall'];

export function generateSpec(arch, rng, ctx) {
  const s = GEN[arch](rng, ctx);
  s.arch = arch;
  const cond = ctx.cond || 'none';
  const combat = !['lobby', 'cache', 'checkpoint', 'boss', 'tutorial', 'miniboss'].includes(arch);
  // level conditions add features
  if (cond === 'pads' && combat && !s.pads.length) { s.pads.push({ x: rng.range(-s.W / 4, s.W / 4), z: rng.range(-s.D / 4, s.D / 4), power: 15 }); s.pads.push({ x: rng.range(-s.W / 3, s.W / 3), z: rng.range(-s.D / 4, s.D / 4), power: 13 }); }
  if (cond === 'conveyor' && combat) {
    const z = rng.range(-s.D / 4, s.D / 4);
    s.conveyors.push({ x0: -s.W / 2, z0: z - 2, x1: s.W / 2, z1: z + 2, dx: rng.sign() * 0.25, dz: 0 });
    if (s.D > 30) s.conveyors.push({ x0: -s.W / 2, z0: z - 10, x1: s.W / 2, z1: z - 7, dx: rng.sign() * 0.25, dz: 0 });
  }
  if (cond === 'hazards' && combat && !s.hazards.length) {
    const z = rng.range(-s.D / 4, s.D / 4);
    s.hazards.push({ type: ctx.theme.hazard, x0: -s.W / 2, z0: z - 1.2, x1: s.W / 2, z1: z + 1.2, on: 2, off: 2.2, phase: rng.next() * 3, dps: 30 });
  }
  const nb = (cond === 'barrels' ? 7 : 2) * (combat ? 1 : 0) + (arch === 'miniboss' ? 2 : 0);
  for (let i = 0; i < nb; i++) s.barrels.push({ x: rng.range(-s.W / 2 + 2, s.W / 2 - 2), z: rng.range(-s.D / 2 + 4, s.D / 2 - 4) });
  // graffiti: 1-3 spray tags per room
  if (arch !== 'tutorial') {
    const ng = rng.int(1, 3);
    for (let i = 0; i < ng; i++) s.graffiti.push({ side: rng.sign(), z: rng.range(-s.D / 2 + 3, s.D / 2 - 3), y: rng.range(1.5, 2.6), idx: rng.int(0, 999), rot: rng.range(-0.08, 0.08) });
  }
  if (ctx.kit && arch !== 'tutorial' && arch !== 'boss') decorate(s, rng, ctx.kit);
  if (ctx.terminal) s.terminals.push({ x: rng.sign() * (s.W / 2 - 0.6), z: rng.range(-s.D / 4, s.D / 4), id: ctx.terminal });
  // keep entrance / exit approaches clear of props
  s.keepClear.push({ x: s.entX, z: s.D / 2 - 1.8, r: 3.2 });
  for (const ex of s.exits) s.keepClear.push({ x: ex, z: -s.D / 2 + 1.8, r: 3.2 });
  s.keepClear.push({ x: s.cachePos.x, z: s.cachePos.z, r: 1.6 });
  const clear = (p) => s.keepClear.some((k) => {
    const cx = Math.max(p.x0, Math.min(k.x, p.x1));
    const cz = Math.max(p.z0, Math.min(k.z, p.z1));
    return Math.hypot(cx - k.x, cz - k.z) < k.r;
  });
  s.props = s.props.filter((p) => p.keep || !clear(p));
  s.cyl = s.cyl.filter((c) => c.core || !clear({ x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r }));
  // clamp props inside the room
  for (const p of s.props) {
    p.x0 = Math.max(p.x0, -s.W / 2); p.x1 = Math.min(p.x1, s.W / 2);
    p.z0 = Math.max(p.z0, -s.D / 2); p.z1 = Math.min(p.z1, s.D / 2);
  }
  s.props = s.props.filter((p) => p.x1 - p.x0 > 0.05 && p.z1 - p.z0 > 0.05);
  const near = (x, z, r) => s.keepClear.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r) || s.props.some((p) => x > p.x0 - r && x < p.x1 + r && z > p.z0 - r && z < p.z1 + r) || s.hazards.some((h) => x > h.x0 - 0.5 && x < h.x1 + 0.5 && z > h.z0 - 0.5 && z < h.z1 + 0.5);
  s.barrels = s.barrels.filter((b) => !near(b.x, b.z, 1.0));
  s.pads = s.pads.filter((p) => !s.keepClear.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < k.r + 1));
  s.kit = s.kit.filter((k) => !near(k.x, k.z, 0.9) && Math.abs(k.z) < s.D / 2 - 3);
  if (ctx.mirror) mirrorSpec(s);
  return s;
}

// NG+: the world is rebuilt inside-out. Mirror every x coordinate in the spec.
function mirrorSpec(s) {
  const fx = (x) => -x;
  s.entX = fx(s.entX);
  s.exits = s.exits.map(fx);
  for (const p of s.props) { const a = fx(p.x1), b = fx(p.x0); p.x0 = a; p.x1 = b; }
  for (const c of s.cyl) c.x = fx(c.x);
  for (const h of s.hazards) { const a = fx(h.x1), b = fx(h.x0); h.x0 = a; h.x1 = b; }
  for (const p of s.perches) { const a = fx(p.x1), b = fx(p.x0); p.x0 = a; p.x1 = b; }
  for (const c of s.conveyors) { const a = fx(c.x1), b = fx(c.x0); c.x0 = a; c.x1 = b; c.dx = -c.dx; }
  for (const l of s.lightSpots) l.x = fx(l.x);
  for (const r of s.rugs) r.x = fx(r.x);
  for (const o of [...s.pads, ...s.barrels, ...s.terminals, ...s.kit, ...s.sliders, ...s.sweepers, ...s.screens, ...s.decor]) if (o.x !== undefined) o.x = fx(o.x);
  for (const g of s.graffiti) g.side = -g.side;
  for (const k of s.kit) k.side = -k.side;
  for (const sc of s.screens) sc.side = sc.side === 'west' ? 'east' : 'west';
  s.cachePos.x = fx(s.cachePos.x);
  for (const k of s.keepClear) k.x = fx(k.x);
}
