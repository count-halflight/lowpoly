// Every boss must be beatable with real input, whatever its gimmick: parry shields (THE TALLYMAN,
// HYMNAL and PALE COURIER only drop theirs when their yellow seekers are parried back into them),
// pylons, armor plates, vents and weak points, servants, darkness, rising slag. Each is fought in
// its real campaign boss room: walk there (fights on the way are skipped), then only the mouse
// (yaw/pitch), the parry key, number keys, reload and fresh trigger presses, aiming at whatever
// can be hurt (weak point, pylon, plate, body). God mode keeps it about the gimmick, not survival.
// Fails when a boss is still alive after LIMIT seconds of play.
//   PORT=4430 node tests/boss-gimmicks.mjs      (BOSSES=tallyman,vesper  LIMIT=240  default: parry
//   bosses + one of each other gimmick; BOSSES=all for every boss)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4185', 10);
const LIMIT = parseInt(process.env.LIMIT || '240', 10);
const PICK = process.env.BOSSES || 'gimmicks';
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

function fight([id, LIMIT]) {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
  const step = () => g.tick(1 / 60, 1 / 60);
  const release = () => { for (const k of KEYS) g.input.held[k] = false; g.input.fire = false; };
  const eye = () => g.camera.position;
  const aimAt = (q) => { const c = eye(), dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(dy, Math.hypot(dx, dz)))); };
  const walkTo = (x, z) => {
    const pp = g.player.body.pos, room = g.level.current;
    let tx = x, tz = z;
    if (room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z) && Math.hypot(x - pp.x, z - pp.z) > 2) { room.nav.flow(x, z); const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 }); if (s) { tx = s.x; tz = s.z; } }
    g.player.yaw = Math.atan2(-(tx - pp.x), -(tz - pp.z)); g.player.pitch = 0;
    g.input.held.fwd = true;
    // blocked by a post or a crate: hop, then sidestep one way for a while
    const moved = Math.hypot(pp.x - (W.lx ?? pp.x), pp.z - (W.lz ?? pp.z));
    W.lx = pp.x; W.lz = pp.z;
    W.slow = moved < 0.02 ? (W.slow || 0) + 1 / 60 : 0;
    if (W.slow > 0.6 && g.player.body.grounded) g.input.pressed.jump = true;
    if (W.slow > 1.2 && !(W.sideT > 0)) { W.side = W.side === 'left' ? 'right' : 'left'; W.sideT = 1.6; }
    if (W.sideT > 0) { W.sideT -= 1 / 60; g.input.held[W.side] = true; }
  };
  const W = {};
  g.profile.v.tutorialDone = true;
  g.startPractice('3-2');
  g.campaign.plan[0].bossId = id;
  g.debug.god(true);
  for (const w of ['breacher', 'lance', 'thumper', 'arc']) g.weapons.give(w);
  // walk to the boss room; earlier fights are skipped with debug kills
  let f = 0;
  for (; f < 60 * 600 && !(g.level.current.spec.arch === 'boss' && g.bosses.active && g.state === 'playing'); f++) {
    release();
    const st = g.state, room = g.level.current;
    if (st === 'reward') g.input.slot = 0;
    else if (st === 'terminal') g.input.pressed.use = true;
    else if (st === 'cutscene') g.input.held.jump = true;
    else if (st === 'playing') {
      if (room.state === 'combat') { if (f % 30 === 0) { g.debug.killAll(); g.director.waveT = -99; } }
      else {
        const cache = g.pickups.list.find((p) => p.kind === 'cache' && room.containsXZ(p.pos.x, p.pos.z));
        const nx = g.level.next;
        if (cache) walkTo(cache.pos.x, cache.pos.z);
        else if (nx) walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3));
        else if (room.routes && room.routes.length) { const d = room.exitDoors[0]; walkTo(room.wx(d.x), room.wz(d.z) + 1.2); }
        if (f % 100 === 50) g.input.pressed.jump = true;
      }
    }
    step();
  }
  const b = g.bosses.active;
  if (!b || b.type !== id) {
    release();
    const r = g.level.current, p = g.player.body.pos;
    return { id, error: 'never reached the boss room', got: b && b.type, at: r.index, arch: r.spec.arch, roomState: r.state, state: g.state, alive: g.enemies.aliveCount, pos: [+(p.x - r.origin.x).toFixed(1), +p.y.toFixed(1), +(p.z - r.origin.z).toFixed(1)], doors: r.exitDoors.map((d) => d.state), next: !!g.level.next, err: g.lastError };
  }
  // the fight: parry every seeker into the boss, shoot whenever it can be hurt
  const stats = { parries: 0, shieldBreaks: 0, firstBreakS: -1 };
  g.on('parry', () => stats.parries++);
  let up = !!b.shieldUp, lastParry = -99;
  const tmp = new b.pos.constructor();
  // what a player would shoot: a pylon or plate first, then an exposed weak point, then the body
  const point = () => {
    const hbs = b.hitboxes() || [];
    const hb = hbs.find((h) => (h.pylon || h.plate) && !h.shielded) || hbs.find((h) => h.weak && !h.shielded) || hbs.find((h) => !h.shielded) || hbs[0];
    return hb ? tmp.set(hb.x, hb.y, hb.z) : b.pos;
  };
  const ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];
  for (f = 0; f < 60 * LIMIT && b.alive; f++) {
    release();
    if (g.state === 'cutscene') { g.input.held.jump = true; step(); continue; }
    let orb = null, od = 1e9;
    for (const p of g.projectiles.list) { if (!p.active || p.friendly || !p.parryable) continue; const d = p.pos.distanceTo(eye()); if (d < od) { od = d; orb = p; } }
    aimAt(point());
    if (orb && od < 2.6 && f - lastParry > 20) { g.input.pressed.punch = true; lastParry = f; }
    else if (!b.shieldUp) { g.input.fire = true; if (f % 6 === 0) g.input.firePressed = true; }
    // keep some distance and strafe a little so seekers arrive from the front
    const pp = g.player.body.pos, d = Math.hypot(b.pos.x - pp.x, b.pos.z - pp.z);
    if (d > 16) g.input.held.fwd = true; else if (d < 8) g.input.held.back = true;
    g.input.held[(f / 90 | 0) % 2 ? 'left' : 'right'] = f % 180 < 40;
    const W = g.weapons, wa = W.ammo[W.current];
    if (wa.mag <= 0 && wa.reserve <= 0) { const nx = W.owned.find((w) => W.ammo[w].mag > 0 || W.ammo[w].reserve > 0); if (nx && !W.switchTo) g.input.slot = ORDER.indexOf(nx); }
    else if (wa.mag <= 0 && !W.reloading) g.input.pressed.reload = true;
    if (f % 600 === 0) for (const w of W.owned) W.addAmmo(w, 2); // ammo pickups in a real fight
    step();
    if (up && !b.shieldUp) { stats.shieldBreaks++; if (stats.firstBreakS < 0) stats.firstBreakS = Math.round(f / 60); }
    up = !!b.shieldUp;
  }
  release();
  g.debug.god(false);
  return { id, killed: !b.alive, seconds: Math.round(f / 60), hp: Math.round(b.hp), max: Math.round(b.maxHp), shieldNow: !!b.shieldUp, ...stats };
}

let failed = 0;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  // the roster from the data file: every parry boss, the first of every other gimmick, the
  // hand-built four (they keep their own gimmicks in bosses.js)
  const rows = [...readFileSync(new URL('../src/data/bossdata.js', import.meta.url), 'utf8').matchAll(/^  \{ id: '([a-z]+)'[^\n]*/gm)].map((m) => ({ id: m[1], gm: (m[0].match(/gimmick: '([a-z]+)'/) || [])[1] || '' }));
  const seen = new Set();
  const list = PICK === 'all' ? rows.map((r) => r.id).filter((id) => id !== 'architect')
    : PICK !== 'gimmicks' ? PICK.split(',')
      : [...new Set(['vesper', 'grindhammer', 'crucible', 'scythewright', ...rows.filter((r) => r.gm && (r.gm === 'parry' || !seen.has(r.gm)) && seen.add(r.gm)).map((r) => r.id)])];
  console.log('bosses: ' + list.join(' '));
  const parryHook = /gimmick === 'parry'/.test(readFileSync(new URL('../src/game/combat.js', import.meta.url), 'utf8'));
  if (!parryHook) console.log('NOTE: combat.js has no parry-shield hook yet: THE TALLYMAN, HYMNAL and PALE COURIER are expected to FAIL (known open soft-lock)');
  for (const id of list) {
    let r;
    try { r = await page.evaluate(fight, [id, LIMIT]); } catch (e) { r = { id, error: e.message.slice(0, 300) }; }
    const ok = !r.error && r.killed;
    if (!ok) failed++;
    // damageBoss drops every hit on a shielded part before applyDamage can see the parry
    const open = !ok && !parryHook && r.parries > 0 && r.shieldBreaks === 0 && r.shieldNow;
    console.log((ok ? 'ok   ' : 'FAIL ') + id.padEnd(12) + JSON.stringify(r) + (open ? '  <- OPEN BUG: parries never break the shield (apply the combat.js parry-shield hook)' : ''));
  }
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 6)); failed++; }
  console.log(failed ? `BOSS GIMMICKS: ${failed} failed` : 'BOSS GIMMICKS OK');
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
