// Real-input bot for the first level of the campaign: aims at the nearest enemy (yaw/pitch),
// fires real weapons, pathfinds to caches and doors. No debug kills unless a room is stuck,
// which is reported as a failure. Regression for: the room after the first miniboss staying
// sealed because a fleeing signaller hid behind cover.
//   PORT=4181 RUNS=4 node tests/bot-firstlevel.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4181', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
await page.evaluate((m) => { window.__BOT_MODE = m; }, process.env.MODE || 'campaign');
const RUNS = parseInt(process.env.RUNS || '6', 10);
const out = [];
for (let run = 0; run < RUNS; run++) {
  const r = await page.evaluate((run) => {
    const g = window.__vg;
    g.frame = () => {}; g.render = () => {};
    g.profile.v.tutorialDone = true;
    if (window.__BOT_MODE === 'endless') g.startEndless((Math.random() * 1e9) >>> 0); else g.newCampaign(0, true);
    g.player.stats.maxHp = 400; g.player.hp = 400;
    const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
    const report = [];
    let f = 0;
    const aimAt = (p) => {
      const cam = g.camera.position;
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    const walkTo = (x, z) => {
      const pp = g.player.body.pos, room = g.level.current;
      let tx = x, tz = z;
      if (room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z)) { room.nav.flow(x, z); const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 }); if (s && Math.hypot(x - pp.x, z - pp.z) > 2) { tx = s.x; tz = s.z; } }
      aimAt({ x: tx, y: g.camera.position.y, z: tz }); g.input.held.fwd = Math.hypot(x - pp.x, z - pp.z) > 0.5;
      if ((f % 120) < 6) g.input.pressed.jump = true;
    };
    for (let roomsDone = 0; roomsDone < 5 && f < 60 * 60 * 12; ) {
      for (const k of KEYS) g.input.held[k] = false;
      g.input.fire = false;
      if (g.state === 'reward') { g.chooseReward(0); continue; }
      if (g.state === 'terminal') { g.closeTerminal(); continue; }
      if (g.state === 'results') { report.push('RESULTS'); break; }
      if (g.state === 'dead' || g.state === 'dying') { report.push('DIED in room ' + g.level.current.index); break; }
      const room = g.level.current;
      if (g.state === 'playing' && g.player.hp < 150) g.player.hp = 400;
      if (g.state === 'playing') {
        if (room.state === 'combat') {
          room._t = (room._t || 0) + 1 / 60;
          let best = null, bd = 1e9;
          for (const e of g.enemies.list) { if (!e.alive || !e.targetable) continue; const d = e.pos.distanceTo(g.player.body.pos); if (d < bd) { bd = d; best = e; } }
          const b = g.bosses.active;
          if (b && b.alive) { const hb = b.hitboxes().find((h) => h.weak && !h.shielded) || b.hitboxes()[0]; if (hb) aimAt(hb); g.input.fire = true; }
          else if (best) { aimAt(best.centerPos()); g.input.fire = true; g.input.held.left = (f / 70 | 0) % 2 === 0; g.input.held.right = !g.input.held.left; if (bd > 14) g.input.held.fwd = true; }
          if (f % 400 === 0 && g.weapons.owned.length > 1) g.input.slot = Math.floor(Math.random() * g.weapons.owned.length);
          if (room._t > 150 && !room._reported) {
            room._reported = true;
            const d = g.director;
            report.push({ STUCK: room.index, arch: room.spec.arch, t: Math.round(room._t), alive: g.enemies.list.filter((e) => e.alive).map((e) => ({ type: e.type, mini: !!e.mini, id: e.def && e.def.id, tg: e.targetable, hp: Math.round(e.hp), y: +e.pos.y.toFixed(1), inRoom: room.containsXZ(e.pos.x, e.pos.z) })), minis: d.minis.map((m) => m.alive), waveIdx: d.waveIdx, waves: d.waves.length, pending: d.pendingBackup, active: d.active, boss: b && { alive: b.alive, hp: Math.round(b.hp), state: b.state } });
          }
          if (room._t > 240) { g.debug.killAll(); if (b && b.alive) g.debug.bossHit(1); }
        } else if (room.state === 'cleared') {
          const cache = g.pickups.list.find((p) => p.kind === 'cache');
          if (cache) walkTo(cache.pos.x, cache.pos.z);
          else if (g.level.next) { const nx = g.level.next; walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3)); }
          else if (room.routes.length) {
            const d = room.exitDoors[0];
            if (room.routes[0].type === 'exit' && Math.hypot(room.wx(d.x) - g.player.body.pos.x, room.wz(d.z) - g.player.body.pos.z) < 5) { g.chooseExit(0); }
            walkTo(room.wx(d.x), room.wz(d.z) + 1.5);
            room._wt = (room._wt || 0) + 1 / 60;
            if (room._wt > 40 && !room._wr) { room._wr = 1; report.push({ DOOR_STUCK: room.index, arch: room.spec.arch, chosen: room.chosenExit, doors: room.exitDoors.map((x) => x.state), routes: room.routes.map((x) => x.type), caches: g.pickups.list.filter((p) => p.kind === 'cache').length, pos: [+(g.player.body.pos.x - room.origin.x).toFixed(1), +(g.player.body.pos.z - room.origin.z).toFixed(1)], err: g.lastError }); }
          }
        }
      }
      const before = room;
      if (g.input.fire && f % 9 === 0) g.input.firePressed = true; // semi-auto weapons need fresh presses
      if (f % 1800 === 0) report.push('t=' + Math.round(f / 60) + ' ' + g.state + ' room' + room.index + ':' + room.state + ' alive=' + g.enemies.aliveCount + ' minis=' + g.director.minis.map((m) => m.alive ? Math.round(m.hp) : 'dead').join('/') + ' hp=' + Math.round(g.player.hp) + ' pos=' + [g.player.body.pos.x - room.origin.x, g.player.body.pos.y, g.player.body.pos.z - room.origin.z].map((v) => v.toFixed(1)).join(',') + (g.cutscene.active ? ' CUT' + g.cutscene.idx : '') + ' wIdx=' + g.director.waveIdx + '/' + g.director.waves.length + ' act=' + g.director.active);
      g.tick(1 / 60, 1 / 60);
      f++;
      if (g.level.current !== before) { roomsDone++; report.push(g.level.current.index + ':' + g.level.current.spec.arch + (g.level.current.ctx.miniDefs ? '[' + g.level.current.ctx.miniDefs.map((m) => m.id).join(',') + ']' : '') + ' t=' + Math.round(f / 60)); }
    }
    return { run, report, err: g.lastError, level: g.mode === 'campaign' ? g.campaign.level.id : 'endless' };
  }, run);
  out.push(r);
  const rooms = r.report.filter((x) => typeof x === 'string' && /^\d/.test(x));
  const stuck = r.report.filter((x) => typeof x === 'object');
  console.log('run', run, r.level, rooms.join(' '), stuck.length ? 'STUCK ' + JSON.stringify(stuck).slice(0, 600) : '');
}
const failed = out.filter((r) => r.report.some((x) => typeof x === 'object') || r.err);
if (errs.length) console.log('page errors', errs.slice(0, 5));
if (failed.length || errs.length) { console.log('FAIL: rooms got stuck or errors occurred'); process.exitCode = 1; } else console.log('BOT FIRST LEVEL OK');
await browser.close(); server.kill();
