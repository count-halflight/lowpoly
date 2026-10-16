// Regression checks for reported bugs.
//  - Killing a containment room's miniboss must open the door even if its escort wave is
//    still alive (escorts shut down with it).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4180', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
const out = await page.evaluate(() => {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  g.profile.v.tutorialDone = true;
  const step = (n, fn) => { for (let f = 0; f < n; f++) { if (fn) fn(f); g.tick(1 / 60, 1 / 60); } };
  const results = [];
  for (const scenario of ['killMiniEarly', 'killMiniLate', 'killMiniLateRealShots']) {
    for (let trial = 0; trial < 4; trial++) {
      g.newCampaign(0, true);
      g.debug.god(true);
      // walk rooms 0..2 quickly
      for (let k = 0; k < 3; k++) {
        const room = g.level.current;
        if (room.state === 'combat') { for (let t = 0; t < 40 && room.state === 'combat'; t++) { g.debug.killAll(); g.director.waveT = -99; step(20); } }
        for (const p of g.pickups.list.slice()) if (p.kind === 'cache') { g.pickups.collect(p); while (g.state === 'reward') g.chooseReward(0); }
        g.chooseExit(0);
        const nx = g.level.next;
        g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
        step(5);
        if (g.cutscene.active) g.cutscene.finish(true);
      }
      const room = g.level.current;
      const r = { scenario, trial, arch: room.spec.arch, idx: room.index };
      if (g.cutscene.active) g.cutscene.finish(true);
      step(scenario === 'killMiniEarly' ? 60 : 60 * 12, (f) => { g.input.held.left = (f / 60 | 0) % 2 === 0; g.input.held.right = !g.input.held.left; });
      const mini = g.director.minis[0];
      r.mini = mini && mini.def.id;
      // kill only the miniboss
      if (scenario === 'killMiniLateRealShots') {
        for (let t = 0; t < 400 && mini.alive; t++) { g.combat.damageEnemy(mini, 40, { source: 'hitscan', point: mini.centerPos().clone(), part: 'body', dir: mini.pos.clone().sub(g.player.body.pos).normalize() }); step(2); }
      } else g.combat.damageEnemy(mini, 1e6, { source: 'hitscan', point: mini.centerPos().clone() });
      r.miniAlive = mini.alive;
      step(60 * 4);
      r.after = g.enemies.list.filter((e) => e.alive).map((e) => ({ t: e.type, mini: !!e.mini, tg: e.targetable, y: +e.pos.y.toFixed(1), inRoom: room.containsXZ(e.pos.x, e.pos.z), st: e.state }));
      r.roomState = room.state; r.waveIdx = g.director.waveIdx; r.waves = g.director.waves.length; r.active = g.director.active; r.pending = g.director.pendingBackup;
      // now kill the rest
      for (let t = 0; t < 20 && room.state === 'combat'; t++) { g.debug.killAll(); step(30); }
      r.finalState = room.state; r.door = room.exitDoors.map((d) => d.state);
      results.push(r);
    }
  }
  return results;
});
const bad = out.filter((r) => r.after.length || r.roomState !== 'cleared');
for (const r of out) console.log(r.scenario.padEnd(22), (r.mini || '').padEnd(14), 'escorts left after mini death:', r.after.length, '| room', r.roomState);
if (errors.length) console.log('ERRORS', errors);
if (bad.length || errors.length) { console.log('FAIL: miniboss room did not clear when its miniboss died'); process.exitCode = 1; } else console.log('REGRESSIONS OK');
await browser.close(); server.kill();
