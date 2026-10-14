// Close-up gallery of every enemy type and weapon viewmodel (art review).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = 4175;
const OUT = new URL('./shots/gallery/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.click('[data-a="start"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const g = window.__vg; g.debug.god(true); g.hud.hint(''); for (const id of ['breacher', 'lance', 'thumper', 'arc']) g.weapons.owned.push(id); });
  for (const w of ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc']) {
    await page.evaluate((w) => { const g = window.__vg; g.weapons.select(w); }, w);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + 'w-' + w + '.png' });
  }
  for (const t of ['husk', 'ripper', 'gunner', 'lancer', 'bulwark', 'signaller', 'wisp']) {
    await page.evaluate((t) => {
      const g = window.__vg; const THREE = g.camera.position.constructor;
      g.enemies.clear();
      const r = g.level.current; const pp = g.player.body.pos;
      const e = g.enemies.spawn(t, new THREE(r.wx(0), t === 'wisp' ? 1.8 : 0.05, r.wz(-1.5)), {});
      e.spawnT = 0.01; e.attackCd = 99; e.stagger = 99; g.fx.columns.clear();
      g.player.yaw = 0; g.player.pitch = -0.05; g.player.body.pos.z = r.wz(2);
    }, t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + 'e-' + t + '.png' });
  }
} finally {
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  server.kill();
  process.exit(0);
}
