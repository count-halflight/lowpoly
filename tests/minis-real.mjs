// Every miniboss in its real containment room, fought with real input only: mouse aim
// (yaw/pitch), fresh trigger presses, parries, reloads, number keys, strafing. The room must clear
// (miniboss down, escorts shut down, exits open) within LIMIT seconds. God mode keeps it about
// whether each miniboss can be hurt and finished, not about survival.
//   PORT=4430 node tests/minis-real.mjs          (MINIS=janitor,anvil  LIMIT=150)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4186', 10);
const LIMIT = parseInt(process.env.LIMIT || '150', 10);
const all = [...readFileSync(new URL('../src/data/minidata.js', import.meta.url), 'utf8').matchAll(/^  M\(\d+, '([a-z0-9_]+)'/gm)].map((m) => m[1]);
const MINIS = process.env.MINIS ? process.env.MINIS.split(',') : all;
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
  const W = {};
  const walkTo = (x, z) => {
    const pp = g.player.body.pos, room = g.level.current;
    let tx = x, tz = z;
    if (room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z) && Math.hypot(x - pp.x, z - pp.z) > 2) { room.nav.flow(x, z); const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 }); if (s) { tx = s.x; tz = s.z; } }
    g.player.yaw = Math.atan2(-(tx - pp.x), -(tz - pp.z)); g.player.pitch = 0;
    g.input.held.fwd = true;
    const moved = Math.hypot(pp.x - (W.lx ?? pp.x), pp.z - (W.lz ?? pp.z));
    W.lx = pp.x; W.lz = pp.z;
    W.slow = moved < 0.02 ? (W.slow || 0) + 1 / 60 : 0;
    if (W.slow > 0.6 && g.player.body.grounded) g.input.pressed.jump = true;
    if (W.slow > 1.2 && !(W.sideT > 0)) { W.side = W.side === 'left' ? 'right' : 'left'; W.sideT = 1.6; }
    if (W.sideT > 0) { W.sideT -= 1 / 60; g.input.held[W.side] = true; }
  };
  g.profile.v.tutorialDone = true;
  g.startPractice('3-2');
  g.campaign.plan[0].minis = [id, id];
  g.debug.god(true);
  for (const w of ['breacher', 'lance', 'thumper', 'arc']) g.weapons.give(w);
  // walk to the first containment room (room 3); earlier fights are skipped with debug kills
  let f = 0;
  for (; f < 60 * 400 && !(g.level.current.spec.arch === 'miniboss' && g.level.current.state === 'combat' && g.state === 'playing'); f++) {
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
      }
    }
    step();
  }
  const room = g.level.current;
  const mini = g.director.minis[0];
  if (room.spec.arch !== 'miniboss' || !mini || mini.def.id !== id) { release(); return { id, error: 'never reached the containment room', at: room.index, arch: room.spec.arch, got: mini && mini.def.id }; }
  const ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];
  let lastParry = -99, maxHp = mini.maxHp;
  for (f = 0; f < 60 * LIMIT && room.state !== 'cleared'; f++) {
    release();
    if (g.state === 'cutscene') { g.input.held.jump = true; step(); continue; }
    if (g.state === 'reward') { g.input.slot = 0; step(); continue; }
    let orb = null, od = 1e9;
    for (const p of g.projectiles.list) { if (!p.active || p.friendly || !p.parryable) continue; const d = p.pos.distanceTo(eye()); if (d < od) { od = d; orb = p; } }
    // the miniboss first, then whatever else is alive
    const pp = g.player.body.pos;
    let tgt = g.director.minis.find((m) => m.alive && m.targetable);
    if (!tgt) { let bd = 1e9; for (const e of g.enemies.list) { if (!e.alive || !e.targetable) continue; const d = e.pos.distanceTo(pp); if (d < bd) { bd = d; tgt = e; } } }
    if (tgt) {
      const q = (f / 120 | 0) % 3 === 0 && !tgt.flying && tgt.headPos ? tgt.headPos() : tgt.centerPos();
      aimAt(q);
      if (orb && od < 2.6 && f - lastParry > 20) { g.input.pressed.punch = true; lastParry = f; }
      else { g.input.fire = true; if (f % 6 === 0) g.input.firePressed = true; }
      const d = Math.hypot(tgt.pos.x - pp.x, tgt.pos.z - pp.z);
      if (!g.combat.losClear(eye(), q)) walkTo(tgt.pos.x, tgt.pos.z), aimAt(q);
      else if (d > 14) g.input.held.fwd = true; else if (d < 5) g.input.held.back = true;
      g.input.held[(f / 70 | 0) % 2 ? 'left' : 'right'] = true;
    }
    const Wp = g.weapons, wa = Wp.ammo[Wp.current];
    if (f % 480 === 240) { const ok = Wp.owned.filter((w) => Wp.ammo[w].mag > 0 || Wp.ammo[w].reserve > 0); const nx = ok[(f / 480 | 0) % ok.length]; if (nx && nx !== Wp.current && !Wp.switchTo) g.input.slot = ORDER.indexOf(nx); }
    else if (wa.mag <= 0 && wa.reserve <= 0) { const nx = Wp.owned.find((w) => Wp.ammo[w].mag > 0 || Wp.ammo[w].reserve > 0); if (nx && !Wp.switchTo) g.input.slot = ORDER.indexOf(nx); }
    else if (wa.mag <= 0 && !Wp.reloading) g.input.pressed.reload = true;
    if (f % 600 === 0) for (const w of Wp.owned) Wp.addAmmo(w, 2);
    step();
  }
  release();
  g.debug.god(false);
  const alive = g.enemies.list.filter((e) => e.alive).map((e) => e.type + (e.mini ? ':' + e.def.id : '') + '@' + [(e.pos.x - room.origin.x).toFixed(1), e.pos.y.toFixed(1), (e.pos.z - room.origin.z).toFixed(1)].join(','));
  return { id, cleared: room.state === 'cleared', seconds: Math.round(f / 60), miniHp: Math.round(Math.max(0, mini.hp)), maxHp: Math.round(maxHp), alive: alive.slice(0, 5), doors: room.exitDoors.map((d) => d.state) };
}

let failed = 0;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const times = [];
  for (const id of MINIS) {
    let r;
    try { r = await page.evaluate(fight, [id, LIMIT]); } catch (e) { r = { id, error: e.message.slice(0, 300) }; }
    const ok = !r.error && r.cleared;
    if (!ok) { failed++; console.log('FAIL ' + id.padEnd(14) + JSON.stringify(r)); } else times.push(id + ':' + r.seconds + 's');
  }
  console.log('cleared: ' + times.join(' '));
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 6)); failed++; }
  console.log(failed ? `MINIS REAL: ${failed} failed of ${MINIS.length}` : `MINIS REAL OK (${MINIS.length})`);
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
