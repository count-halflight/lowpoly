// One close-up per boss (spawned in a stratum-3 room, stepped 40 frames), for art review.
//   PORT=4440 node tests/boss-gallery.mjs     (OUT=dir; default tests/shots/bosses)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4440', 10);
const OUT = process.env.OUT || new URL('./shots/bosses/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.evaluate(() => { const g = window.__vg; g.profile.v.tutorialDone = true; g.settings.set('cutscenes', false); });
  // the roster comes from the data file
  const { BOSSES } = await import(new URL('../src/data/bossdata.js', import.meta.url).href);
  const list = BOSSES.map((b) => b.id).filter((id) => id !== 'architect').concat(['architect']);
  let n = 0;
  for (const id of list) {
    const ok = await page.evaluate((id) => {
      const g = window.__vg;
      g.frame = () => {};
      g.startPractice('3-2');
      const room = g.level.current;
      if (g.bosses.active) { g.bosses.active.remove && g.bosses.active.remove(); g.bosses.active = null; }
      let b;
      try { b = g.bosses.spawn(id, room, 3, {}); } catch (e) { return 'spawn ' + e.message; }
      b.state = 'idle'; b.intro = 0;
      g.debug.god(true);
      for (let i = 0; i < 40; i++) { try { b.update(1 / 60); if (b.animate) b.animate(1 / 60); if (b.sync) b.sync(); } catch (e) { return 'update ' + e.message; } }
      const c = b.center ? b.center() : b.pos;
      const r = (b.radius || 2) * 3.2 + 4;
      g.camera.position.set(c.x + r * 0.55, c.y + r * 0.25, c.z + r * 0.85);
      g.camera.lookAt(c.x, c.y, c.z);
      g.camera.updateMatrixWorld();
      g.hud.clear && g.hud.clear();
      g.renderer.render(g.scene, g.camera, null, null);
      return 'ok';
    }, id);
    await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${id}.png` });
    console.log(id, ok);
    n++;
  }
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 5));
} finally {
  await browser.close();
  server.kill();
}
