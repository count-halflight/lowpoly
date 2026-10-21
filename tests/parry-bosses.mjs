// Shield-gimmick bosses must be beatable with real input. THE TALLYMAN, HYMNAL and PALE COURIER
// (gimmick 'parry') only drop their shield when the player parries their yellow seekers back into
// them; VESPER is the hand-built parry boss. Each is fought in its real campaign boss room: walk
// there (fights on the way are skipped), then only the mouse (yaw/pitch), the parry key and fresh
// trigger presses. God mode keeps the test about the gimmick, not about survival.
// Fails when a boss never loses its shield or is still alive after 150 s of play.
//   PORT=4430 node tests/parry-bosses.mjs        (BOSSES=tallyman,vesper)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4185', 10);
const BOSSES = (process.env.BOSSES || 'tallyman,hymnal,palecourier,vesper').split(',');
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

function fight(id) {
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
  };
  g.profile.v.tutorialDone = true;
  g.startPractice('3-2');
  g.campaign.plan[0].bossId = id;
  g.debug.god(true);
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
  if (!b || b.type !== id) { release(); return { id, error: 'never reached the boss room', got: b && b.type, at: g.level.current.index }; }
  // the fight: parry every seeker into the boss, shoot whenever it can be hurt
  const stats = { parries: 0, shieldBreaks: 0, firstBreakS: -1 };
  g.on('parry', () => stats.parries++);
  let up = !!b.shieldUp, lastParry = -99;
  const tmp = new b.pos.constructor();
  const point = () => { const hbs = b.hitboxes() || []; const hb = hbs.find((h) => h.weak) || hbs[0]; return hb ? tmp.set(hb.x, hb.y, hb.z) : b.pos; };
  for (f = 0; f < 60 * 150 && b.alive; f++) {
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
    const wa = g.weapons.ammo[g.weapons.current];
    if (wa.mag <= 0 && !g.weapons.reloading) g.input.pressed.reload = true;
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
  for (const id of BOSSES) {
    let r;
    try { r = await page.evaluate(fight, id); } catch (e) { r = { id, error: e.message.slice(0, 300) }; }
    const ok = !r.error && r.killed;
    if (!ok) failed++;
    console.log((ok ? 'ok   ' : 'FAIL ') + id.padEnd(12) + JSON.stringify(r));
  }
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 6)); failed++; }
  console.log(failed ? `PARRY BOSSES: ${failed} failed` : 'PARRY BOSSES OK');
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
