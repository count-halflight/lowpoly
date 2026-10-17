// Real-input check of the training deck's movement stations. Each station is started
// directly and solved only by injecting key states into the input system, one fixed 60 Hz
// game step at a time (no teleports, no debug kills), so it is deterministic even on slow
// headless renderers.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4175', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const results = await page.evaluate(() => {
    const g = window.__vg;
    g.frame = () => {}; // stop the RAF loop: we step the game ourselves
    g.render = () => {};
    const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
    const loc = () => { const r = g.level.current, p = g.player.body.pos; return { x: p.x - r.origin.x, y: p.y, z: p.z - r.origin.z }; };
    function solve(station, maxFrames, fn) {
      g.startTutorial(false, station);
      g.player.yaw = 0; g.player.pitch = 0;
      const mem = {};
      let f = 0;
      for (; f < maxFrames && !g.tutorial.done; f++) {
        const k = fn(f, loc(), g.player, mem) || {};
        for (const a of KEYS) g.input.held[a] = !!(k.hold && k.hold.includes(a));
        if (k.press) for (const a of k.press) g.input.pressed[a] = true;
        g.tick(1 / 60, 1 / 60);
      }
      for (const a of KEYS) g.input.held[a] = false;
      const l = loc();
      return { done: g.tutorial.done, frames: f, obj: g.tutorial.objective, x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2), hp: Math.round(g.player.hp) };
    }
    const out = {};
    // 2: switch weapons, destroy the dummy first (the old soft-lock: no target left for the
    // ricochet), then flip a coin and shoot it out of the air with real aim + trigger presses
    const aimAt = (q) => { const c = g.camera.position, dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
    out.coin = solve(2, 1500, (f, p, pl, m) => {
      if (f === 2) g.input.slot = 2; // breacher
      if (f === 40) g.input.slot = 0; // hammer
      if (f < 70) return {};
      const dummy = g.tutorial.dummies.find((e) => e.alive);
      if (!m.killed) {
        if (dummy) { aimAt(dummy.headPos()); g.input.fire = true; if (f % 8 === 0) g.input.firePressed = true; return {}; }
        m.killed = f; g.input.fire = false;
      }
      const coin = g.weapons.coins.find((c) => c.alive);
      if (!coin && f - (m.flip || 0) > 50) { m.flip = f; g.player.pitch = 0.2; return { press: ['altTap'] }; }
      if (coin && coin.vel.y < 1.5) { aimAt(coin.pos); g.input.fire = true; g.input.firePressed = true; return {}; }
      g.input.fire = false;
      return {};
    });
    out.coin.coinHits = g.tutorial.counts.coinhit || 0;
    g.input.fire = false;
    // 3: run, jump at the edge of the slag, dash in mid-air
    out.slag = solve(3, 600, (f, p, pl, m) => {
      if (p.z < 3.3 && !m.j) { m.j = f; return { hold: ['fwd'], press: ['jump'] }; }
      if (m.j && f === m.j + 12) return { hold: ['fwd'], press: ['dash'] };
      return { hold: ['fwd'] };
    });
    // 4: slide under the gate
    out.slide = solve(4, 600, (f) => ({ hold: f > 25 ? ['fwd', 'slide'] : ['fwd'] }));
    // 6: hold jump to bunny hop, then dash for the speed burst
    out.bhop = solve(6, 1500, (f, p, pl, m) => {
      const hops = g.tutorial.counts.bhop || 0;
      if (f < 20) return { hold: ['fwd'] };
      if (hops >= 4 && !m.d) { m.d = 1; return { hold: ['fwd', 'jump'], press: ['dash'] }; }
      return { hold: ['fwd', 'jump'], press: f === 20 ? ['jump'] : [] };
    });
    // 8: fire the hook twice, then run over the launch pad onto the ledge
    out.pad = solve(8, 1200, (f, p, pl, m) => {
      if (f === 2 || f === 80) return { press: ['hook'] };
      if (f < 100) return {};
      // the hook may have pulled us past the pad: back up for a run-up
      if (!(g.tutorial.counts.pad > 0)) { if (p.z < 2 && !m.run) return { hold: ['back'] }; if (p.z > 6.5) m.run = 1; if (!m.run) return { hold: ['back'] }; }
      return { hold: ['fwd'] };
    });
    // 5: walk into the chimney, jump, then wall-jump whenever touching a wall near the apex
    out.chimney = solve(5, 1500, (f, p, pl, m) => {
      if (!m.in) {
        if (p.x < 6.5) return { hold: ['right'] };
        if (p.z > 0.6) return { hold: ['fwd'] };
        m.in = f;
        return { hold: ['fwd', 'right'], press: ['jump'] };
      }
      const b = pl.body;
      if (!b.grounded && pl.wallContactT > 0 && b.vel.y < 2 && pl.wallJumps < 3 && f - (m.last || 0) > 8) { m.last = f; return { hold: ['fwd', 'right'], press: ['jump'] }; }
      if (b.grounded && f - m.in > 20 && p.y < 0.5 && p.z > -0.5) { m.in = f; return { hold: ['fwd', 'right'], press: ['jump'] }; }
      return { hold: p.y > 3.0 ? ['fwd'] : ['fwd', 'right'] };
    });
    return out;
  });
  console.log(JSON.stringify(results, null, 1));
  const failed = Object.entries(results).filter(([, v]) => !v.done).map(([k]) => k);
  if (errors.length) { console.log('ERRORS', errors); process.exitCode = 1; }
  if (failed.length) { console.log('NOT SOLVED WITH REAL INPUT:', failed.join(', ')); process.exitCode = 1; } else console.log('ALL MOVEMENT STATIONS SOLVED WITH REAL INPUT');
} finally {
  await browser.close();
  server.kill();
}
