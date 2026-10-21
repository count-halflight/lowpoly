// Movement fuzzer: real inputs only (WASD, jump, dash, slide, hook, mouse yaw/pitch) thrown at
// every room archetype, normal and NG+ mirrored, while its lifts, trams, crushers, vents and
// crumbling floors keep running. Each episode starts on a random free nav cell and runs a short
// random program (vault into the nearest wall, wall-run along it, dash-slide, hook the ceiling,
// slam, bhop circles). Invariants checked every frame:
//   - the player is never inside solid geometry for more than a moment (mantle, wall-run, movers)
//   - a sealed room (fight in progress) keeps the player inside its walls and under its ceiling:
//     no vaulting over walls, no wall-running through a closed door, no clipping into a corridor
//   - a vault never hangs (mantle state ends), the position never goes NaN
//   - falling out of the world only happens where the room has pits
//   PORT=4430 node tests/fuzz-move.mjs        (EPISODES=24 SEEDS=1 ONLY=crusher,tramyard)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4184', 10);
const EPISODES = parseInt(process.env.EPISODES || '24', 10);
const SEEDS = parseInt(process.env.SEEDS || '1', 10);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const ARCHES = ONLY || ['crusher', 'shaft', 'tiers', 'sewer', 'rooftop', 'flooded', 'ring', 'tramyard', 'servers', 'chapel',
  'gauntlet', 'arena', 'warehouse', 'mezzanine', 'gallery', 'cells', 'movers', 'reactor', 'pit', 'bridges', 'tower', 'hall',
  'hazard', 'survival', 'elite', 'miniboss', 'boss', 'checkpoint'];

function install() {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
  const step = (n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
  const release = () => { for (const k of KEYS) g.input.held[k] = false; g.input.fire = false; };
  // small deterministic rng so a failure can be replayed with the same seed
  let s0 = 1;
  const rnd = () => { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; };
  const F = { out: [], ev: {} };
  g.on('*', (e) => { if (e === 'wallrun' || e === 'mantle' || e === 'dashslide' || e === 'hook' || e === 'slam' || e === 'walljump' || e === 'pad') F.ev[e] = (F.ev[e] || 0) + 1; });
  // build `arch` as the next room, walk in, then empty it but keep it sealed (fight never ends)
  F.enter = (arch, seed, mirror) => {
    s0 = seed * 7919 + arch.length * 31 + (mirror ? 5 : 0);
    g.startEndless(seed);
    g.debug.god(true);
    const L = g.level, o = L.pickArch, oc = L.createRoom;
    L.pickArch = () => arch;
    if (mirror) { const cb = oc.bind(L); L.createRoom = (i, a, or, ctx, hc) => cb(i, a, or, { ...ctx, mirror: true }, hc); }
    const lobby = L.current;
    // force a route of the right kind for the special archetypes
    if (arch === 'boss' || arch === 'miniboss' || arch === 'checkpoint') {
      const r = lobby.routes[0];
      r.type = arch === 'miniboss' ? 'mini' : arch;
      if (arch === 'boss') lobby.index = 4; // endless bosses guard every fifth room
    }
    g.chooseExit(0);
    L.pickArch = o; L.createRoom = oc;
    step(10);
    const nx = L.next;
    if (!nx) return null;
    g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
    for (let i = 0; i < 400 && (L.current !== nx || g.state !== 'playing'); i++) { if (g.state === 'cutscene') g.cutscene.finish(true); step(1); }
    release();
    g.director.active = false;
    for (const e of g.enemies.list) if (e.alive) g.combat.damageEnemy(e, 1e7, { source: 'hazard', fromPlayer: false });
    if (g.bosses.active) g.bosses.clear();
    step(30);
    for (const e of g.enemies.list) e.alive && g.combat.damageEnemy(e, 1e7, { source: 'hazard', fromPlayer: false });
    g.enemies.update = () => {}; // nothing left to fight; keep it that way
    return L.current;
  };
  // pick a random walkable point
  F.spot = (room) => {
    const nav = room.nav;
    for (let k = 0; k < 60; k++) {
      const x = room.wx((rnd() - 0.5) * (room.W - 2)), z = room.wz((rnd() - 0.5) * (room.D - 2));
      const i = nav.nearestFree(x, z, 3);
      if (i < 0) continue;
      const c = nav.center(i, { x: 0, z: 0 });
      return { x: c.x, z: c.z, y: room.floorAt(c.x, c.z) + 0.05 };
    }
    return null;
  };
  // yaw that faces the nearest solid wall/prop within 6 m (so vaults and wall-runs happen)
  F.faceNearest = (room) => {
    const p = g.player.body.pos;
    let best = null, bd = 6;
    for (const c of g.level.colliders) {
      if (!c.active || !c.solid || c.maxY < p.y + 0.4 || c.minY > p.y + 1.6) continue;
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX)), cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d > 0.05 && d < bd) { bd = d; best = { x: cx, z: cz }; }
    }
    if (!best) return Math.atan2(-(room.origin.x - p.x), -(room.origin.z - p.z));
    return Math.atan2(-(best.x - p.x), -(best.z - p.z));
  };
  const PROGS = ['vault', 'wallrun', 'dashslide', 'hook', 'slam', 'bhop', 'vault', 'wallrun'];
  F.episode = (room, ep) => {
    const P = g.player, b = P.body, s = room.spec;
    const sp = F.spot(room);
    if (!sp) return;
    P.spawnAt(sp.x, sp.y, sp.z, rnd() * 6.28);
    P.hp = P.stats.maxHp;
    release();
    step(2);
    const prog = PROGS[(rnd() * PROGS.length) | 0];
    const face = F.faceNearest(room);
    P.yaw = prog === 'wallrun' ? face + (rnd() < 0.5 ? 1 : -1) * (0.9 + rnd() * 0.5) : prog === 'hook' ? rnd() * 6.28 : face + (rnd() - 0.5) * 0.6;
    P.pitch = prog === 'hook' ? 0.5 + rnd() * 0.8 : 0;
    const frames = 120 + ((rnd() * 120) | 0);
    const sealed = room.state === 'combat';
    const pits = (s.holes && s.holes.length) || room.spec.arch === 'pit';
    let inT = 0, mantT = 0, rep = {};
    const bad = (kind, extra) => {
      if (rep[kind]) return;
      rep[kind] = 1;
      F.out.push({ kind, arch: s.arch, mirror: !!room.ctx.mirror, ep, prog, f, pos: [+(b.pos.x - room.origin.x).toFixed(2), +b.pos.y.toFixed(2), +(b.pos.z - room.origin.z).toFixed(2)], start: [+(sp.x - room.origin.x).toFixed(1), +(sp.z - room.origin.z).toFixed(1)], mantle: !!P.mantle, wallRun: !!P.wallRun, ...extra });
    };
    let f = 0;
    for (; f < frames; f++) {
      release();
      const h = g.input.held;
      if (prog === 'vault') { h.fwd = true; if (f % 14 === 2) g.input.pressed.jump = true; }
      else if (prog === 'wallrun') {
        h.fwd = true;
        if (f === 1) g.input.pressed.dash = true;
        if (f === 12) g.input.pressed.jump = true;
        if (f > 14) { h[(rnd() < 0.5) ? 'left' : 'right'] = true; P.yaw += (face - P.yaw) * 0.02; }
        if (f === 70 || f === 130) g.input.pressed.jump = true;
      } else if (prog === 'dashslide') {
        h.fwd = true;
        if (f % 50 === 1) g.input.pressed.dash = true;
        if (f % 50 > 6 && f % 50 < 30) h.slide = true;
        if (f % 50 === 32) g.input.pressed.jump = true;
      } else if (prog === 'hook') {
        if (f === 1) g.input.pressed.hook = true;
        h.fwd = f > 20;
        if (f === 60) g.input.pressed.jump = true;
        if (f === 62) { P.pitch = 0; P.yaw = face; }
        if (f > 62 && f % 16 === 0) g.input.pressed.jump = true;
      } else if (prog === 'slam') {
        h.fwd = true;
        if (f % 60 === 1) g.input.pressed.jump = true;
        if (f % 60 === 20) g.input.pressed.slide = true;
        if (f % 60 === 22) g.input.pressed.jump = true;
      } else {
        h.fwd = true; h[(f / 40 | 0) % 2 ? 'left' : 'right'] = true;
        P.yaw += 0.03 * ((f / 40 | 0) % 2 ? 1 : -1);
        if (b.grounded) g.input.pressed.jump = true;
      }
      const cur = g.level.current;
      g.tick(1 / 60, 1 / 60);
      if (g.level.current !== cur || g.state !== 'playing') break;
      const p = b.pos;
      if (!Number.isFinite(p.x + p.y + p.z)) { bad('NAN'); break; }
      inT = P.overlapsAny() ? inT + 1 : 0;
      if (inT > 20) bad('IN_GEOMETRY', { vel: [+b.vel.x.toFixed(1), +b.vel.y.toFixed(1), +b.vel.z.toFixed(1)] });
      mantT = P.mantle ? mantT + 1 : 0;
      if (mantT > 60) bad('MANTLE_HANG');
      const lx = p.x - room.origin.x, lz = p.z - room.origin.z;
      if (sealed) {
        const alcove = room.secretList && room.secretList.some((sc) => sc.found);
        if (!alcove && p.y > -1 && (Math.abs(lx) > s.W / 2 + 0.05 || Math.abs(lz) > s.D / 2 + 0.05)) bad('LEFT_SEALED_ROOM', { W: s.W, D: s.D });
      }
      if (!s.open && p.y + b.h > s.H + 0.1 && Math.abs(lx) < s.W / 2 && Math.abs(lz) < s.D / 2) bad('ABOVE_CEILING', { H: s.H });
      if (p.y < -6 && !pits) bad('FELL', { holes: (s.holes || []).length });
    }
    release();
  };
  F.run = (arch, seed, mirror, episodes) => {
    const room = F.enter(arch, seed, mirror);
    if (!room) return { arch, error: 'no room' };
    const got = room.spec.arch;
    const n0 = F.out.length;
    F.ev = {};
    let ran = 0;
    for (let ep = 0; ep < episodes; ep++) {
      // walking into an open exit claims the cache: take the card and carry on
      for (let k = 0; k < 30 && g.state !== 'playing'; k++) { if (g.state === 'reward') g.input.slot = 0; else if (g.state === 'terminal') g.closeTerminal(); step(1); }
      if (g.level.current !== room || g.state !== 'playing') break;
      F.episode(room, ep);
      ran++;
    }
    return { arch, got, mirror, state: room.state, ran, issues: F.out.slice(n0), err: g.lastError, ev: F.ev };
  };
  window.__F = F;
}

let bad = 0;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.evaluate(install);
  for (const arch of ARCHES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const mirror of [false, true]) {
        let r;
        try { r = await page.evaluate(([a, s, m, n]) => window.__F.run(a, s, m, n), [arch, seed * 17 + 3, mirror, EPISODES]); } catch (e) { r = { arch, error: e.message.slice(0, 300), issues: [] }; }
        const issues = r.issues || [];
        const okRun = !r.error && issues.length === 0;
        if (!okRun) bad++;
        console.log(`${okRun ? 'ok  ' : 'FAIL'} ${arch.padEnd(10)} ${mirror ? 'M' : ' '} seed ${seed} got=${r.got} state=${r.state} episodes=${r.ran} ${JSON.stringify(r.ev || {})}${r.error ? ' ERROR ' + r.error : ''}`);
        for (const i of issues.slice(0, 4)) console.log('     ' + JSON.stringify(i));
        if (issues.length > 4) console.log(`     ... ${issues.length - 4} more`);
      }
    }
  }
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 6)); bad++; }
  console.log(bad ? `FUZZ: ${bad} problem run(s)` : 'FUZZ MOVE OK');
  if (bad) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
