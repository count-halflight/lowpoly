// A boss body leaning on a player who stands against the arena wall must not shove them into the
// wall (camera inside the wall, the bot saw "IN_GEOMETRY" for seconds) or through it. Each hand-
// built boss is pinned 2 m from the east wall with the player between, for 4 s (the kit bosses
// inherit the same Boss.pushPlayer).
//   PORT=4430 node tests/boss-wall.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4187', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const hooked = /moveBody\(pb, dx \* k/.test(readFileSync(new URL('../src/game/bosses.js', import.meta.url), 'utf8'));

let failed = 0;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const out = await page.evaluate(() => {
    const g = window.__vg;
    g.frame = () => {}; g.render = () => {};
    g.settings.values.cutscenes = false;
    const step = (n) => { for (let f = 0; f < n; f++) g.tick(1 / 60, 1 / 60); };
    const res = [];
    // endless boss rooms at increasing depth: grindhammer, vesper, crucible, scythewright
    for (const [seed, idx] of [[539, 4], [540, 9], [541, 14], [542, 19]]) {
      g.startEndless(seed);
      const lobby = g.level.current;
      lobby.index = idx;
      g.applyRoutes(lobby, lobby.exitDoors.map(() => ({ type: 'boss', label: 'BOSS', sub: 'TEST', color: '#3ef0d0', reward: 'boss', picks: 1 })));
      g.chooseExit(0);
      const nx = g.level.next;
      g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
      for (let i = 0; i < 900 && !(g.bosses.active && g.bosses.active.alive && g.state === 'playing' && g.level.current.state === 'combat'); i++) { g.input.held.jump = g.state === 'cutscene'; step(1); }
      g.input.held.jump = false;
      const b = g.bosses.active, room = g.level.current;
      if (!b) { res.push({ seed, error: 'no boss', state: g.state }); continue; }
      g.debug.god(true);
      const pb = g.player.body, o = room.origin, W = room.W;
      let worst = 0, overlap = 0, outside = false;
      for (let f = 0; f < 240; f++) {
        b.pos.set(o.x + W / 2 - 2, b.pos.y, o.z);
        if (f % 60 === 0) { pb.pos.set(o.x + W / 2 - 0.6, 0.05, o.z); pb.vel.set(0, 0, 0); }
        step(1);
        worst = Math.max(worst, pb.pos.x + pb.r - (o.x + W / 2));
        if (g.player.overlapsAny()) overlap++;
        if (pb.pos.x - pb.r > o.x + W / 2 + 0.9) outside = true;
      }
      g.debug.god(false);
      res.push({ seed, type: b.type, flying: !!b.flying, penetration: +worst.toFixed(2), overlapFrames: overlap, outside });
    }
    return res;
  });
  for (const r of out) {
    const ok = !r.error && r.penetration < 0.05 && r.overlapFrames === 0 && !r.outside;
    if (!ok) failed++;
    console.log((ok ? 'ok   ' : 'FAIL ') + JSON.stringify(r) + (!ok && !hooked ? '  <- OPEN BUG: apply the bosses.js pushPlayer hook' : ''));
  }
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 6)); failed++; }
  if (!hooked && failed) console.log('NOTE: bosses.js pushPlayer still moves the player without collision: failures above are the known open bug');
  console.log(failed ? `BOSS WALL: ${failed} failed` : 'BOSS WALL OK');
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
