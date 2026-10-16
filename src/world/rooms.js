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
  pit: ['THE PIT', 'SUMP', 'CAULDRON', 'DRAIN HALL'],
  bridges: ['CATWALKS', 'GANTRY CROSSING', 'SPILLWAY', 'TRESTLES'],
  tower: ['UPDRAFT', 'LIFT SHAFT', 'RISER', 'STACK'],
  hall: ['NAVE', 'PROCESSION', 'COLONNADE', 'GREAT HALL'],
  miniboss: ['HOLDING PEN', 'CONTAINMENT', 'PROVING CAGE', 'THE RING'],
  tutorial: ['TRAINING HALL'],
  crusher: ['PRESS GALLERY', 'STAMPING LINE', 'DROP FORGE', 'HAMMER HALL'],
  shaft: ['HOIST WELL', 'FREIGHT ELEVATOR', 'CARGO LIFT', 'PATERNOSTER'],
  tiers: ['TERRACES', 'AMPHITHEATRE', 'STEPPED BASIN', 'GRANDSTAND'],
  sewer: ['STORM DRAIN', 'SEWER JUNCTION', 'OUTFALL', 'CISTERN MAZE'],
  rooftop: ['ROOFTOPS', 'SKYLINE', 'THE HEIGHTS', 'ANTENNA FARM'],
  flooded: ['FLOODED HALL', 'PUMP ROOM', 'SPILL BASIN', 'BILGE'],
  ring: ['SPEEDWAY', 'CENTRIFUGE', 'THE LOOP', 'ACCELERATOR'],
  tramyard: ['TRAM YARD', 'RAIL DEPOT', 'SHUNTING YARD', 'CARRIAGE SHED'],
  servers: ['SERVER FARM', 'DATA HALL', 'COLD AISLE', 'MAINFRAME'],
  chapel: ['CHAPEL', 'ORATORY', 'OSSUARY', 'SANCTUARY'],
};

function base(rng, arch, W, D, H) {
  return {
    arch, name: rng.pick(ARCH_NAMES[arch]), W, D, H,
    entX: 0, exits: [0],
    props: [], cyl: [], decor: [], hazards: [], sweepers: [], sliders: [], perches: [],
    keepClear: [], lightSpots: [], rugs: [], screens: [],
    pads: [], conveyors: [], barrels: [], terminals: [], graffiti: [], kit: [],
    // interactive features (see features.js) and floor holes (pits, rooftop gaps, crypts)
    holes: [], breakables: [], secrets: [], movers: [], crushers: [], vents: [], anchors: [],
    gates: [], switches: [], speedGates: [], water: [], falls: [],
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

function breakable(s, kind, x0, y0, z0, x1, y1, z1, extra = {}) {
  s.breakables.push({ kind, x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), ...extra });
}
// a crate that splinters when shot, punched or blasted
function bcrate(s, rng, x, z, size = 1.3, stack = 1) {
  breakable(s, 'crate', x - size / 2, 0, z - size / 2, x + size / 2, size, z + size / 2, { tint: rng.range(0.75, 1.1) });
  if (stack > 1) { const s2 = size * 0.75, o = rng.range(-0.15, 0.15); breakable(s, 'crate', x - s2 / 2 + o, size, z - s2 / 2 - o, x + s2 / 2 + o, size + s2, z + s2 / 2 - o, { tint: rng.range(0.75, 1.1), nav: false }); }
}
function hole(s, x0, z0, x1, z1) {
  s.holes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
}
// a steel beam laid across a hole: walkable (and on the nav grid), top flush with the floor
function girder(s, x0, z0, x1, z1) {
  prop(s, x0, -0.45, z0, x1, 0, z1, 'trim', 'metal', { girder: true, tint: 0.85 });
}
// a run of steps whose top edge is at (x, z), descending from y1 to y0 as it runs out toward `dir`
// (n = -z, s = +z, e = +x, w = -x). Returns the run length.
function steps(s, x, z, dir, w, y0, y1, run = 0.55) {
  const n = Math.max(1, Math.ceil((y1 - y0) / 0.4));
  const rise = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const y = y1 - rise * i, a = i * run, b = a + run;
    if (dir === 'n') prop(s, x - w / 2, y0, z - b, x + w / 2, y, z - a, 'trim', 'metal', { tint: 0.7, step: true });
    else if (dir === 's') prop(s, x - w / 2, y0, z + a, x + w / 2, y, z + b, 'trim', 'metal', { tint: 0.7, step: true });
    else if (dir === 'e') prop(s, x + a, y0, z - w / 2, x + b, y, z + w / 2, 'trim', 'metal', { tint: 0.7, step: true });
    else prop(s, x - b, y0, z - w / 2, x - a, y, z + w / 2, 'trim', 'metal', { tint: 0.7, step: true });
  }
  return n * run;
}
// thin elevated walkway (enemies walk beneath it; perch on top)
function catwalk(s, x0, z0, x1, z1, y, posts = true) {
  prop(s, x0, y - 0.3, z0, x1, y, z1, 'grate', 'metal', { catwalk: true });
  s.perches.push({ x0: Math.min(x0, x1) + 0.5, z0: Math.min(z0, z1) + 0.5, x1: Math.max(x0, x1) - 0.5, z1: Math.max(z0, z1) - 0.5, y });
  if (!posts) return;
  const ax0 = Math.min(x0, x1), ax1 = Math.max(x0, x1), az0 = Math.min(z0, z1), az1 = Math.max(z0, z1);
  const along = ax1 - ax0 > az1 - az0;
  const len = along ? ax1 - ax0 : az1 - az0, n = Math.max(1, Math.round(len / 6));
  for (let i = 0; i <= n; i++) {
    const t = 0.25 + (i / n) * (len - 0.5);
    for (const e of [0, 1]) {
      if (along) { const x = ax0 + t, z = e ? az1 - 0.35 : az0 + 0.35; prop(s, x - 0.18, 0, z - 0.18, x + 0.18, y - 0.3, z + 0.18, 'trim', 'metal', { tint: 0.6, post: true }); }
      else { const z = az0 + t, x = e ? ax1 - 0.35 : ax0 + 0.35; prop(s, x - 0.18, 0, z - 0.18, x + 0.18, y - 0.3, z + 0.18, 'trim', 'metal', { tint: 0.6, post: true }); }
    }
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
  // --- PRESS GALLERY: a central lane of ceiling pistons dropping in a rolling wave, side lanes with cover
  crusher(rng) {
    const W = rng.int(22, 26), D = rng.int(34, 40), H = 8;
    const s = base(rng, 'crusher', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const z0 = D / 2 - 8, z1 = -D / 2 + 8;
    const n = Math.max(3, Math.round((z0 - z1) / 5) + 1);
    const period = rng.range(4.4, 5.0);
    for (let i = 0; i < n; i++) {
      const z = z0 - i * (z0 - z1) / (n - 1);
      // two half-lane heads per row, opposite phase: there is always a way through if you read the rhythm
      s.crushers.push({ x: -1.6, z, w: 3.1, d: 3.1, period, phase: i * 0.55 });
      s.crushers.push({ x: 1.6, z, w: 3.1, d: 3.1, period, phase: i * 0.55 + period / 2 });
    }
    // lane curbs: low, hazard striped, easy to step over
    prop(s, -3.55, 0, z1 - 2, -3.25, 0.22, z0 + 2, 'hazard', 'metal', { tint: 0.9 });
    prop(s, 3.25, 0, z1 - 2, 3.55, 0.22, z0 + 2, 'hazard', 'metal', { tint: 0.9 });
    // side lanes: smashable crates, concrete cover and a raised gantry for gunners
    for (const sx of [-1, 1]) {
      for (let z = D / 2 - 7; z > -D / 2 + 6; z -= rng.range(5, 7)) {
        const x = sx * rng.range(5.5, W / 2 - 2.5);
        if (rng.chance(0.55)) bcrate(s, rng, x, z, rng.range(1.1, 1.4), rng.chance(0.3) ? 2 : 1);
        else breakable(s, 'cover', x - 1.3, 0, z - 0.3, x + 1.3, 1.15, z + 0.3);
      }
    }
    const side = rng.sign();
    platform(s, rng, side > 0 ? W / 2 - 3 : -W / 2, -5, side > 0 ? W / 2 : -W / 2 + 3, 4, 3.2, 'south');
    // the line's breaker: shoot or punch it to stop the presses for a while
    s.switches.push({ side: -side, z: rng.range(-D / 5, D / 5), y: 1.9, action: 'power', dur: 10 });
    lightGrid(s, rng, 2, 4);
    s.lightMood = 'warning';
    s.cachePos = { x: side * -(W / 2 - 3), z: -D / 2 + 4.5 };
    return s;
  },
  // --- HOIST WELL: tall shaft, side catwalks served by lifts, a shuttle platform crossing the void
  shaft(rng) {
    const W = rng.int(24, 28), D = rng.int(26, 30), H = 16;
    const s = base(rng, 'shaft', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const ch = 5.4, cw = 4.2;
    const cz0 = -D / 2 + 6, cz1 = D / 2 - 6;
    catwalk(s, -W / 2, cz0, -W / 2 + cw, cz1, ch);
    catwalk(s, W / 2 - cw, cz0, W / 2, cz1, ch);
    // lifts at the inner edge of each catwalk
    const lz = rng.range(-2, 2);
    s.movers.push({ kind: 'lift', x: -W / 2 + cw + 1.3, y: 0, z: lz, w: 2.4, d: 2.4, ax: 0, ay: ch, az: 0, period: 9, pause: 2.6, phase: 0 });
    s.movers.push({ kind: 'lift', x: W / 2 - cw - 1.3, y: 0, z: lz, w: 2.4, d: 2.4, ax: 0, ay: ch, az: 0, period: 9, pause: 2.6, phase: 4.5 });
    // a shuttle crossing between the catwalks at catwalk height, on the other half of the shaft from the vents
    const span = W / 2 - cw - 1.7, shz = lz + (lz > 0 ? -6 : 6);
    s.movers.push({ kind: 'plat', x: -span, y: ch, z: shz, w: 3, d: 3, ax: span * 2, ay: 0, az: 0, period: 10, pause: 1.8, phase: rng.next() * 10 });
    // high anchors for swinging across, vents to pop up to the catwalks
    s.anchors.push({ x: 0, y: H - 3, z: -D / 4 }, { x: 0, y: H - 3, z: D / 4 });
    const vz = shz > 0 ? -(D / 2 - 8.5) : D / 2 - 8.5;
    s.vents.push({ x: -W / 2 + cw + 1.4, z: vz, on: 1.2, off: 2.6, phase: 0, power: 16.5 });
    s.vents.push({ x: W / 2 - cw - 1.4, z: vz, on: 1.2, off: 2.6, phase: 1.9, power: 16.5 });
    // floor clutter
    scatter(s, rng, 4, (x, z) => { if (Math.abs(x) > W / 2 - cw - 3) return false; bcrate(s, rng, x, z, 1.25, rng.chance(0.3) ? 2 : 1); }, 3);
    breakable(s, 'cover', -1.6, 0, -0.3, 1.6, 1.15, 0.3);
    lightGrid(s, rng, 2, 3);
    s.lightMood = 'shaft';
    s.cachePos = { x: 0, z: 6 };
    return s;
  },
  // --- TERRACES: stepped tiers along both walls, a high catwalk across, a central dais
  tiers(rng) {
    const W = rng.int(30, 34), D = rng.int(30, 34), H = 11;
    const s = base(rng, 'tiers', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const z0 = -D / 2 + 5.5, z1 = D / 2 - 6;
    const t1 = 1.2, t2 = 2.4;
    for (const sx of [-1, 1]) {
      const xa = sx * (W / 2 - 9), xb = sx * (W / 2 - 5), xc = sx * (W / 2);
      prop(s, xa, 0, z0, xb, t1, z1, 'concrete', 'concrete', { trimTop: true, terrace: true });
      prop(s, xb, 0, z0, xc, t2, z1, 'concrete', 'concrete', { trimTop: true, terrace: true });
      s.perches.push({ x0: Math.min(xa, xb) + 0.6, z0: z0 + 0.6, x1: Math.max(xa, xb) - 0.6, z1: z1 - 0.6, y: t1 });
      s.perches.push({ x0: Math.min(xb, xc) + 0.6, z0: z0 + 0.6, x1: Math.max(xb, xc) - 0.6, z1: z1 - 0.6, y: t2 });
      // steps: floor -> tier 1 (two runs), tier 1 -> tier 2 (offset runs, so the climb zig-zags)
      for (const zz of [z0 + (z1 - z0) * 0.25, z0 + (z1 - z0) * 0.75]) steps(s, xa, zz, sx > 0 ? 'w' : 'e', 2.2, 0, t1, 0.6);
      steps(s, xb, (z0 + z1) / 2, sx > 0 ? 'w' : 'e', 2.2, t1, t2, 0.6);
    }
    // the high catwalk spans the room; stairs climb to it from tier 2
    const cz = rng.range(-3, 2), cy = 5.2;
    catwalk(s, -(W / 2 - 3.2), cz - 1.1, W / 2 - 3.2, cz + 1.1, cy, false);
    for (const sx of [-1, 1]) {
      prop(s, sx * (W / 2 - 3.2) - (sx > 0 ? 0 : 0), 2.4, cz - 1.1, sx * (W / 2), cy, cz + 1.1, 'trim', 'metal', { tint: 0.7 });
      steps(s, sx * (W / 2 - 1.6), cz + 1.1, 's', 2.4, t2, cy, 0.5);
    }
    // central dais with breakable cover around it
    platform(s, rng, -2.5, -2.5, 2.5, 2.5, 0.8, 'none');
    steps(s, 0, 2.5, 's', 2.2, 0, 0.8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      breakable(s, 'cover', Math.cos(a) * 6.5 - 1.2, 0, Math.sin(a) * 6.5 - 0.3, Math.cos(a) * 6.5 + 1.2, 1.15, Math.sin(a) * 6.5 + 0.3);
    }
    s.pads.push({ x: 0, z: -7.5, power: 15 });
    lightGrid(s, rng, 3, 3);
    s.cachePos = { x: 0, z: 7 };
    return s;
  },
  // --- STORM DRAIN: a carved maze of tight corridors, a slow drain channel and crumbling brick shortcuts
  sewer(rng) {
    const nx = rng.int(5, 6), nz = 6, cs = rng.range(4.8, 5.2);
    const W = Math.round(nx * cs), D = Math.round(nz * cs + 4), H = 6;
    const s = base(rng, 'sewer', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const cw = W / nx, cd = (D - 4) / nz, zTop = D / 2 - 2;
    // depth-first carve, then knock a few extra holes (loops) and turn some walls to crumbling brick
    const open = new Set(), seen = new Uint8Array(nx * nz);
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    const stack = [rng.int(0, nx * nz - 1)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], i = c % nx, j = Math.floor(c / nx);
      const nb = [];
      if (i > 0 && !seen[c - 1]) nb.push(c - 1);
      if (i < nx - 1 && !seen[c + 1]) nb.push(c + 1);
      if (j > 0 && !seen[c - nx]) nb.push(c - nx);
      if (j < nz - 1 && !seen[c + nx]) nb.push(c + nx);
      if (!nb.length) { stack.pop(); continue; }
      const n = rng.pick(nb);
      seen[n] = 1; open.add(key(c, n)); stack.push(n);
    }
    const wallSeg = (x0, z0, x1, z1, k) => {
      const roll = rng.next();
      if (roll < 0.28) return; // extra loop
      if (roll < 0.42) { breakable(s, 'brick', x0, 0, z0, x1, H, z1, { hp: 8 }); return; }
      const low = k && roll > 0.85;
      prop(s, x0, 0, z0, x1, low ? 1.2 : H, z1, 'wall', 'concrete', { tint: 0.75, trimTop: low });
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const x = -W / 2 + (i + 1) * cw, zA = zTop - j * cd, zB = zTop - (j + 1) * cd;
      if (i < nx - 1 && !open.has(key(c, c + 1))) wallSeg(x - 0.3, zB + 0.3, x + 0.3, zA - 0.3, true);
      if (j < nz - 1 && !open.has(key(c, c + nx))) wallSeg(-W / 2 + i * cw + 0.3, zB - 0.3, -W / 2 + (i + 1) * cw - 0.3, zB + 0.3, true);
    }
    // corner posts keep the maze readable
    for (let j = 1; j < nz; j++) for (let i = 1; i < nx; i++) prop(s, -W / 2 + i * cw - 0.35, 0, zTop - j * cd - 0.35, -W / 2 + i * cw + 0.35, H, zTop - j * cd + 0.35, 'concrete', 'concrete', { tint: 0.65, post: true });
    // the drain: a sluggish channel down the middle
    const ci = Math.floor(nx / 2);
    const chx = -W / 2 + (ci + 0.5) * cw;
    s.water.push({ x0: chx - 1.6, z0: -D / 2 + 2.5, x1: chx + 1.6, z1: D / 2 - 2.5 });
    s.waterColor = 0x7a9a6a;
    s.falls.push({ x: chx, z: -D / 2 + 0.05, w: 2.2, y: H - 1.4, side: 'n' });
    for (let k = 0; k < 4; k++) s.decor.push({ type: 'drain', x: rng.range(-W / 2 + 2, W / 2 - 2), z: rng.range(-D / 2 + 4, D / 2 - 4) });
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (rng.chance(0.55)) s.lightSpots.push({ x: -W / 2 + (i + 0.5) * cw, z: zTop - (j + 0.5) * cd });
    if (s.lightSpots.length < 4) lightGrid(s, rng, 2, 3);
    s.lightMood = 'sickly';
    s.wantSecret = 0.85;
    s.cachePos = { x: chx > 0 ? chx - cw : chx + cw, z: 0 };
    s.cachePos.x = Math.max(-W / 2 + 2, Math.min(W / 2 - 2, s.cachePos.x));
    s.cachePos.z = zTop - Math.floor(nz / 2) * cd + cd / 2;
    return s;
  },
  // --- ROOFTOPS: open sky, a city skyline, gaps between roofs crossed by girders, a shuttle and an anchor
  rooftop(rng) {
    const W = rng.int(30, 34), D = rng.int(40, 46), H = 24;
    const s = base(rng, 'rooftop', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    s.open = true; s.lightY = 5.6; s.floorMat = 'concrete';
    // gap 1: full width alley, jumpable, two girders
    const g1 = D / 2 - rng.range(11, 13), d1 = rng.range(2.8, 3.4);
    hole(s, -W / 2, g1 - d1 / 2, W / 2, g1 + d1 / 2);
    const gx = [rng.range(-W / 2 + 3, -4), rng.range(4, W / 2 - 3)];
    for (const x of gx) girder(s, x - 0.8, g1 - d1 / 2 - 0.4, x + 0.8, g1 + d1 / 2 + 0.4);
    // gap 2: a wide light-well on one side, crossed by a shuttle platform or an anchor swing
    const g2 = -D / 2 + rng.range(11, 13), d2 = rng.range(5, 6), side = rng.sign();
    const x2a = side > 0 ? -W / 2 + W * 0.42 : -W / 2, x2b = side > 0 ? W / 2 : W / 2 - W * 0.42;
    hole(s, x2a, g2 - d2 / 2, x2b, g2 + d2 / 2);
    const sx2 = (x2a + x2b) / 2 + side * 3;
    s.movers.push({ kind: 'plat', x: sx2, y: 0, z: g2 + d2 / 2 + 0.2, w: 2.8, d: 2.8, ax: 0, ay: 0, az: -(d2 + 0.4), period: 7, pause: 1.6, phase: rng.next() * 7 });
    s.anchors.push({ x: sx2 - side * 4, y: 6.5, z: g2 });
    girder(s, (x2a + x2b) / 2 - side * 5 - 0.8, g2 - d2 / 2 - 0.4, (x2a + x2b) / 2 - side * 5 + 0.8, g2 + d2 / 2 + 0.4);
    // roof clutter: AC units, vent stacks, skylights, antenna masts, a water tower
    scatter(s, rng, 7, (x, z) => {
      if (s.holes.some((h) => x > h.x0 - 2.2 && x < h.x1 + 2.2 && z > h.z0 - 2.2 && z < h.z1 + 2.2)) return false;
      const r = rng.next();
      if (r < 0.45) prop(s, x - 1.1, 0, z - 0.8, x + 1.1, 1.3, z + 0.8, 'trim', 'metal', { ac: true, tint: rng.range(0.8, 1.1) });
      else if (r < 0.7) breakable(s, 'glass', x - 1.2, 0, z - 1.2, x + 1.2, 0.9, z + 1.2, { skylight: true, nav: true, hp: 3 });
      else if (r < 0.85) { s.cyl.push({ x, z, r: 0.5, y0: 0, y1: rng.range(1.6, 2.4), mat: 'trim', collide: true }); }
      else bcrate(s, rng, x, z, 1.2, 1);
    }, 3);
    const tx = -side * (W / 2 - 4.5), tz = rng.range(-2, 4);
    s.decor.push({ type: 'waterTower', x: tx, z: tz });
    for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) prop(s, tx + lx - 0.2, 0, tz + lz - 0.2, tx + lx + 0.2, 3.6, tz + lz + 0.2, 'trim', 'metal', { tint: 0.55, post: true });
    s.decor.push({ type: 'mast', x: side * (W / 2 - 2), z: D / 2 - 6 });
    s.decor.push({ type: 'mast', x: -side * (W / 2 - 2), z: -D / 2 + 6 });
    s.decor.push({ type: 'billboard', x: side * (W / 2 - 0.8), z: rng.range(-4, 4), side });
    s.vents.push({ x: rng.range(-4, 4), z: (g1 + g2) / 2 + rng.range(-2, 2), on: 1.0, off: 3.0, phase: 0, power: 14 });
    for (let i = 0; i < 6; i++) s.lightSpots.push({ x: (i % 2 ? 1 : -1) * (W / 2 - 3.5), z: D / 2 - 5 - i * (D - 10) / 5 });
    s.lightMood = 'night';
    s.cachePos = { x: 0, z: D / 2 - 5.5 };
    return s;
  },
  // --- FLOODED HALL: knee-deep water slows everything, dry walkways and pump islands, a drain valve
  flooded(rng, ctx) {
    const W = rng.int(26, 30), D = rng.int(30, 34), H = 8;
    const s = base(rng, 'flooded', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    s.water.push({ x0: -W / 2, z0: -D / 2 + 3.4, x1: W / 2, z1: D / 2 - 3.4 });
    const th = ctx.theme ? ctx.theme.id : '';
    s.waterColor = th === 'slaughter' ? 0xa83a34 : th === 'breach' ? 0xa060d0 : th === 'foundry' ? 0x9a8a62 : th === 'reactor' ? 0x7ad08a : 0x7ab8c8;
    // walkways: raised just under a step so you can hop on from the water
    const wy = 0.4;
    for (const sx of [-1, 1]) prop(s, sx * (W / 2 - 5), 0, -D / 2 + 3, sx * (W / 2 - 3), wy, D / 2 - 3, 'grate', 'metal', { platformFlat: true });
    const cz = rng.range(-3, 3);
    prop(s, -W / 2 + 3, 0, cz - 1, W / 2 - 3, wy, cz + 1, 'grate', 'metal', { platformFlat: true });
    // pump islands with machinery
    for (const [px, pz] of [[-W / 4, -D / 4], [W / 4, D / 4 - 1]]) {
      prop(s, px - 2.2, 0, pz - 2.2, px + 2.2, 0.6, pz + 2.2, 'concrete', 'concrete', { trimTop: true });
      s.cyl.push({ x: px, z: pz, r: 0.9, y0: 0.6, y1: 2.6, mat: 'trim', collide: true });
      s.decor.push({ type: 'pump', x: px, z: pz });
    }
    scatter(s, rng, 5, (x, z) => { if (rng.chance(0.5)) bcrate(s, rng, x, z, 1.2, 1); else breakable(s, 'cover', x - 1.2, 0, z - 0.3, x + 1.2, 1.1, z + 0.3); }, 3.5);
    // outfalls pouring in from the side walls
    for (const sx of [-1, 1]) s.falls.push({ x: sx * (W / 2 - 0.05), z: rng.range(-D / 4, D / 4), w: 1.8, y: H - 2, side: sx > 0 ? 'e' : 'w' });
    s.switches.push({ side: rng.sign(), z: rng.range(-D / 5, D / 5), y: 1.8, action: 'drain', dur: 14 });
    lightGrid(s, rng, 3, 3);
    s.lightMood = 'water';
    s.cachePos = { x: 0, z: cz };
    return s;
  },
  // --- SPEEDWAY: a ring track around a bottomless pit; speed gates reward momentum
  ring(rng) {
    const W = rng.int(32, 36), D = W, H = 9;
    const s = base(rng, 'ring', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const pr = rng.range(5.5, 6.5);
    hole(s, -pr, -pr, pr, pr);
    girder(s, -pr / 2 - 0.8, -pr - 0.4, -pr / 2 + 0.8, pr + 0.4);
    s.movers.push({ kind: 'plat', x: pr / 2, y: 0, z: -pr + 1.2, w: 2.6, d: 2.6, ax: 0, ay: 0, az: pr * 2 - 2.4, period: 8, pause: 1.4, phase: rng.next() * 8 });
    s.anchors.push({ x: 0, y: 6.2, z: -pr / 2 }, { x: 0, y: 6.2, z: pr / 2 });
    // pit lip
    for (const [x0, z0, x1, z1] of [[-pr - 0.3, -pr - 0.3, pr + 0.3, -pr], [-pr - 0.3, pr, pr + 0.3, pr + 0.3], [-pr - 0.3, -pr, -pr, pr], [pr, -pr, pr + 0.3, pr]]) prop(s, x0, 0, z0, x1, 0.2, z1, 'hazard', 'metal', { lip: true });
    // speed gates on the long straights
    const tw = W / 2 - pr, mid = pr + tw / 2;
    s.speedGates.push({ x: -mid, z: 0, w: tw - 1.4, axis: 'x' }, { x: mid, z: 0, w: tw - 1.4, axis: 'x' }, { x: 0, z: -mid, w: tw - 1.4, axis: 'z' });
    // chicanes: alternating low barriers to hop
    for (const sx of [-1, 1]) for (const zz of [-D / 4 - 1, D / 4 + 1]) {
      const inner = rng.chance(0.5);
      const x0 = inner ? sx * (pr + 0.8) : sx * (W / 2 - tw * 0.5), x1 = inner ? sx * (pr + tw * 0.5) : sx * (W / 2 - 0.6);
      breakable(s, 'cover', x0, 0, zz - 0.3, x1, 0.95, zz + 0.3);
    }
    // rounded outer corners
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) for (let k = 0; k < 3; k++) {
      const a = 4.2 - k * 1.3;
      prop(s, cx > 0 ? W / 2 - a : -W / 2, 0, cz > 0 ? D / 2 - (1.3 + k * 1.3) : -D / 2, cx > 0 ? W / 2 : -W / 2 + a, H, cz > 0 ? D / 2 : -D / 2 + (1.3 + k * 1.3), 'wall', 'metal', { tint: 0.8, corner: true });
    }
    s.pads.push({ x: -(W / 2 - 5.5), z: -(D / 2 - 5.5), power: 14 }, { x: W / 2 - 5.5, z: D / 2 - 5.5, power: 14 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; s.lightSpots.push({ x: Math.cos(a) * mid, z: Math.sin(a) * mid }); }
    s.lightMood = 'race';
    s.cachePos = { x: W / 2 - 4, z: 4 };
    return s;
  },
  // --- TRAM YARD: trams shuttle across the yard (moving cover that hits hard); station islands between tracks
  tramyard(rng) {
    const W = rng.int(34, 38), D = rng.int(34, 38), H = 9;
    const s = base(rng, 'tramyard', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const tracks = [D / 2 - 10.5, -D / 2 + 10.5];
    tracks.forEach((z, i) => {
      const w = rng.range(6.5, 7.5), half = W / 2 - w / 2 - 1.6;
      const dir = i % 2 ? 1 : -1;
      s.movers.push({ kind: 'tram', x: dir * half, y: 0, z, w, d: 2.6, h: 2.9, ax: -dir * half * 2, ay: 0, az: 0, period: rng.range(11, 13), pause: rng.range(3, 4), phase: rng.next() * 6 });
      s.decor.push({ type: 'catenary', z, x0: -W / 2, x1: W / 2 });
    });
    // station island between the tracks: raised platform, canopy pillars, benches
    const iz0 = tracks[1] + 2.4, iz1 = tracks[0] - 2.4;
    prop(s, -W / 2 + 3, 0, iz0, W / 2 - 3, 0.4, iz1, 'concrete', 'concrete', { trimTop: true, island: true });
    for (const x of [-W / 4, 0, W / 4]) {
      pillar(s, x, (iz0 + iz1) / 2, 0.7, H, 'trim');
      prop(s, x - 3, 3.9, (iz0 + iz1) / 2 - 2.2, x + 3, 4.1, (iz0 + iz1) / 2 + 2.2, 'trim', 'metal', { canopy: true, tint: 0.7 });
    }
    for (let k = 0; k < 4; k++) {
      const x = rng.range(-W / 2 + 5, W / 2 - 5), z = rng.chance(0.5) ? iz0 + 1.2 : iz1 - 1.2;
      if (rng.chance(0.5)) bcrate(s, rng, x, z, 1.1, 1); else prop(s, x - 1, 0.4, z - 0.25, x + 1, 0.85, z + 0.25, 'crate', 'wood', { tint: 0.55, bench: true });
    }
    // cover near the walls (outside the tracks)
    for (const z of [D / 2 - 5.5, -D / 2 + 5.5]) for (const sx of [-1, 1]) breakable(s, 'cover', sx * (W / 2 - 6) - 1.4, 0, z - 0.3, sx * (W / 2 - 6) + 1.4, 1.15, z + 0.3);
    lightGrid(s, rng, 3, 3);
    s.lightMood = 'yard';
    s.cachePos = { x: 0, z: (iz0 + iz1) / 2 + 2.6 };
    return s;
  },
  // --- SERVER FARM: aisles of destructible racks that short out when broken; a glass control booth
  servers(rng) {
    const W = rng.int(26, 30), D = rng.int(32, 36), H = 6.5;
    const s = base(rng, 'servers', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const rows = Math.floor((W - 10) / 4.4);
    const x0 = -((rows - 1) * 4.4) / 2;
    for (let r = 0; r < rows; r++) {
      const x = x0 + r * 4.4;
      let z = D / 2 - 6.5;
      while (z > -D / 2 + 7) {
        const run = rng.int(2, 4);
        for (let k = 0; k < run && z > -D / 2 + 7; k++) { breakable(s, 'rack', x - 0.55, 0, z - 1.15, x + 0.55, 2.3, z - 0.05, { hp: 7 }); z -= 1.2; }
        z -= rng.range(2.4, 3.2);
      }
    }
    // perforated cold-aisle tiles
    for (let r = 0; r <= rows; r++) s.decor.push({ type: 'coldAisle', x: x0 + (r - 0.5) * 4.4, z0: -D / 2 + 6, z1: D / 2 - 6 });
    // control booth with glass windows, behind which sits the breaker
    const side = rng.sign(), bz = rng.range(-D / 6, D / 6);
    const bx = side * (W / 2 - 3.4);
    prop(s, bx - 0.15, 0, bz - 3, bx + 0.15, 1.0, bz + 3, 'trim', 'metal', { tint: 0.8 });
    breakable(s, 'glass', bx - 0.08, 1.0, bz - 3, bx + 0.08, 2.6, bz - 0.05, { hp: 2, nav: false });
    breakable(s, 'glass', bx - 0.08, 1.0, bz + 0.05, bx + 0.08, 2.6, bz + 3, { hp: 2, nav: false });
    prop(s, bx - 0.15, 2.6, bz - 3, bx + 0.15, H, bz + 3, 'wall', 'metal', { tint: 0.7 });
    prop(s, Math.min(bx, side * W / 2), 0, bz - 3.15, Math.max(bx, side * W / 2), H, bz - 2.85, 'wall', 'metal', { tint: 0.7 });
    s.switches.push({ side, z: bz + 1.2, y: 1.6, action: 'power', dur: 12 });
    s.vents.push({ x: x0 - 2.2, z: rng.range(-4, 4), on: 1.1, off: 2.8, phase: 0, power: 13, cold: true });
    s.vents.push({ x: x0 + rows * 4.4 - 2.2, z: rng.range(-4, 4), on: 1.1, off: 2.8, phase: 1.4, power: 13, cold: true });
    for (let r = 0; r <= rows; r++) for (let j = 0; j < 3; j++) s.lightSpots.push({ x: x0 + (r - 0.5) * 4.4, z: -D / 2 + 6 + (j + 0.5) * (D - 12) / 3 });
    s.lightMood = 'datacenter';
    s.wantSecret = 0.4;
    s.cachePos = { x: x0 - 2.2, z: D / 2 - 5 };
    return s;
  },
  // --- CHAPEL: nave and side aisles; the nave floor over the crypt gives way under your feet
  chapel(rng) {
    const W = rng.int(22, 26), D = rng.int(38, 44), H = 12;
    const s = base(rng, 'chapel', W, D, H);
    s.exits = exitsFor(rng, W, 2);
    const cx = W / 2 - 5;
    for (let z = D / 2 - 7; z > -D / 2 + 6; z -= 6) { pillar(s, -cx, z, 1.4, H, 'trim'); pillar(s, cx, z, 1.4, H, 'trim'); }
    // collapsing crypt band(s) across the nave
    const bands = D > 40 ? [D / 2 - 15, -2] : [rng.range(-4, 2)];
    for (const bz of bands) {
      const z0 = bz - 2, z1 = bz + 2;
      hole(s, -cx + 0.8, z0, cx - 0.8, z1);
      for (let x = -cx + 0.8; x < cx - 0.81; x += (2 * cx - 1.6) / 4) for (let z = z0; z < z1 - 0.01; z += 2) {
        breakable(s, 'crumble', x, -0.5, z, x + (2 * cx - 1.6) / 4, 0, z + 2, { hp: 1, nav: false, tint: rng.range(0.8, 1) });
      }
    }
    // pews outside the crypt bands
    for (let z = D / 2 - 6; z > -D / 2 + 9; z -= 2.2) {
      if (bands.some((b) => Math.abs(z - b) < 3.4)) continue;
      for (const sx of [-1, 1]) prop(s, sx * 1.3, 0, z - 0.25, sx * (cx - 1.2), 0.55, z + 0.25, 'crate', 'wood', { tint: 0.55, pew: true });
    }
    // altar dais
    platform(s, rng, -3, -D / 2 + 3.5, 3, -D / 2 + 6.5, 0.8, 'none');
    steps(s, 0, -D / 2 + 6.5, 's', 3, 0, 0.8);
    s.decor.push({ type: 'altar', x: 0, z: -D / 2 + 5 });
    s.decor.push({ type: 'rose', x: 0, z: -D / 2 + 0.02, y: H - 4.2 });
    for (let z = D / 2 - 7; z > -D / 2 + 6; z -= 6) s.decor.push({ type: 'banner', x: 0, z: z - 3, y: H });
    for (let z = D / 2 - 7; z > -D / 2 + 6; z -= 6) { s.lightSpots.push({ x: -cx - 2.2, z: z - 3 }); s.lightSpots.push({ x: cx + 2.2, z: z - 3 }); }
    s.anchors.push({ x: 0, y: H - 3.5, z: bands[0] });
    s.lightMood = 'candle';
    s.wantSecret = 0.7;
    s.cachePos = { x: -cx - 2.3, z: D / 2 - 6 };
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

export const COMBAT_ARCHES = ['gauntlet', 'arena', 'warehouse', 'mezzanine', 'gallery', 'cells', 'movers', 'reactor', 'pit', 'bridges', 'tower', 'hall',
  'crusher', 'shaft', 'tiers', 'sewer', 'rooftop', 'flooded', 'ring', 'tramyard', 'servers', 'chapel'];
// archetypes that need a few rooms of practice before they show up in endless runs
export const LATE_ARCHES = { rooftop: 3, ring: 3, chapel: 4, tramyard: 3, crusher: 2, shaft: 3, sewer: 2 };

const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const rectHit = (a, b, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

// A cracked panel in a side wall hides an alcove with a reward. Only melee and explosions open it.
function placeSecret(s, rng) {
  for (let tries = 0; tries < 12; tries++) {
    const side = rng.sign(), z = rng.range(-s.D / 2 + 5, s.D / 2 - 5), w = 2.6;
    const zone = { x0: side > 0 ? s.W / 2 - 2.6 : -s.W / 2, x1: side > 0 ? s.W / 2 : -s.W / 2 + 2.6, z0: z - w / 2 - 0.6, z1: z + w / 2 + 0.6 };
    if (s.props.some((p) => rectHit(p, zone) && p.y0 < 3)) continue;
    if (s.breakables.some((b) => rectHit(b, zone)) || s.holes.some((h) => rectHit(h, zone, 1)) || s.water.some((h) => rectHit(h, zone))) continue;
    if (s.cyl.some((c) => inRect(zone, c.x, c.z, c.r)) || s.falls.some((f) => Math.abs(f.z - z) < 3) || s.switches.some((sw) => sw.side === side && Math.abs(sw.z - z) < 3)) continue;
    const i = s.secrets.length;
    s.secrets.push({ side, z, w, h: 3.0, depth: 2.4 });
    breakable(s, 'wall', side > 0 ? s.W / 2 : -s.W / 2 - 1, 0, z - w / 2, side > 0 ? s.W / 2 + 1 : -s.W / 2, 3.0, z + w / 2, { secret: i, side, nav: false, hp: 10 });
    return true;
  }
  return false;
}

export function generateSpec(arch, rng, ctx) {
  const s = GEN[arch](rng, ctx);
  s.arch = arch;
  const cond = ctx.cond || 'none';
  const combat = !['lobby', 'cache', 'boss', 'tutorial', 'miniboss'].includes(arch);
  const inHole = (x, z, m = 0) => s.holes.some((h) => inRect(h, x, z, m));
  // stratum signature set piece (ceiling / far wall dressing) in roomy combat spaces
  if (ctx.kit && combat && !s.open && s.W >= 20 && s.D >= 24) s.setPiece = ctx.kit;
  if (ctx.kit && arch !== 'tutorial') s.ceilKit = ctx.kit;
  if (combat && !s.open && (ctx.secrets !== false) && rng.chance(s.wantSecret !== undefined ? s.wantSecret : 0.22)) placeSecret(s, rng);
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
  // graffiti: 1-3 spray tags per room (never on a secret panel, never floating over a parapet)
  const nearSecret = (side, z, m) => s.secrets.some((sc) => sc.side === side && Math.abs(sc.z - z) < sc.w / 2 + m);
  if (arch !== 'tutorial' && !s.open) {
    const ng = rng.int(1, 3);
    for (let i = 0; i < ng; i++) {
      const g = { side: rng.sign(), z: rng.range(-s.D / 2 + 3, s.D / 2 - 3), y: rng.range(1.5, 2.6), idx: rng.int(0, 999), rot: rng.range(-0.08, 0.08) };
      if (!nearSecret(g.side, g.z, 1.6)) s.graffiti.push(g);
    }
  }
  if (ctx.kit && arch !== 'tutorial' && arch !== 'boss' && !s.open) decorate(s, rng, ctx.kit);
  if (ctx.terminal) {
    let t = null;
    for (let k = 0; k < 10 && !t; k++) {
      const c = { x: rng.sign() * (s.W / 2 - 0.6), z: rng.range(-s.D / 4, s.D / 4), id: ctx.terminal };
      const side = c.x < 0 ? -1 : 1;
      if (k < 9 && (inHole(c.x, c.z, 1.2) || nearSecret(side, c.z, 1.4) || s.props.some((p) => inRect(p, c.x, c.z, 1)) || s.breakables.some((b) => inRect(b, c.x, c.z, 1)))) continue;
      t = c;
    }
    s.terminals.push(t);
  }
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
  // breakables: same door rule; also never inside solid props (secret panels sit in the wall itself)
  const solid = s.props.filter((p) => p.y1 > 0.6 && !p.catwalk && !p.canopy && p.y0 < 1);
  s.breakables = s.breakables.filter((b) => b.secret !== undefined || (!clear(b) && (b.kind === 'crumble' || b.y0 > 0.5 || !solid.some((p) => rectHit(p, b, 0.15)))));
  // clamp props inside the room
  for (const p of [...s.props, ...s.breakables.filter((b) => b.secret === undefined)]) {
    p.x0 = Math.max(p.x0, -s.W / 2); p.x1 = Math.min(p.x1, s.W / 2);
    p.z0 = Math.max(p.z0, -s.D / 2); p.z1 = Math.min(p.z1, s.D / 2);
  }
  s.props = s.props.filter((p) => p.x1 - p.x0 > 0.05 && p.z1 - p.z0 > 0.05);
  const near = (x, z, r) => s.keepClear.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r) || s.props.some((p) => x > p.x0 - r && x < p.x1 + r && z > p.z0 - r && z < p.z1 + r) || s.hazards.some((h) => x > h.x0 - 0.5 && x < h.x1 + 0.5 && z > h.z0 - 0.5 && z < h.z1 + 0.5) ||
    s.breakables.some((b) => b.secret === undefined && inRect(b, x, z, r)) || inHole(x, z, r + 0.4) || s.movers.some((m) => Math.abs(m.x + m.ax / 2 - x) < Math.abs(m.ax) / 2 + m.w / 2 + r && Math.abs(m.z + m.az / 2 - z) < Math.abs(m.az) / 2 + m.d / 2 + r) ||
    s.crushers.some((c) => Math.abs(c.x - x) < c.w / 2 + r && Math.abs(c.z - z) < c.d / 2 + r) || s.vents.some((v) => Math.hypot(v.x - x, v.z - z) < 1.2 + r);
  s.barrels = s.barrels.filter((b) => !near(b.x, b.z, 1.0));
  s.pads = s.pads.filter((p) => !s.keepClear.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < k.r + 1) && !inHole(p.x, p.z, 1.4));
  s.kit = s.kit.filter((k) => !near(k.x, k.z, 0.9) && Math.abs(k.z) < s.D / 2 - 3 && !nearSecret(k.side, k.z, 1.8) && !s.falls.some((f) => Math.abs(f.z - k.z) < 2.4 && Math.sign(f.x) === k.side));
  // lamps (posts on open roofs) never stand over a gap
  for (const l of s.lightSpots) for (const h of s.holes) if (inRect(h, l.x, l.z, 1)) l.z = l.z > (h.z0 + h.z1) / 2 ? h.z1 + 1.5 : h.z0 - 1.5;
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
  // interactive features: rects swap edges, points flip, travel / facing flips
  for (const key of ['holes', 'water', 'breakables', 'secrets', 'movers', 'crushers', 'vents', 'anchors', 'gates', 'switches', 'speedGates', 'falls']) {
    for (const o of s[key] || []) {
      if (o.x0 !== undefined && o.x1 !== undefined) { const a = fx(o.x1), b = fx(o.x0); o.x0 = a; o.x1 = b; }
      if (o.x !== undefined) o.x = fx(o.x);
      if (o.ax) o.ax = -o.ax;
      if (typeof o.side === 'number') o.side = -o.side;
      else if (o.side === 'e' || o.side === 'w') o.side = o.side === 'e' ? 'w' : 'e';
    }
  }
  for (const d of s.decor) {
    if (d.x0 !== undefined && d.x1 !== undefined) { const a = fx(d.x1), b = fx(d.x0); d.x0 = a; d.x1 = b; }
    if (typeof d.side === 'number') d.side = -d.side;
  }
}
