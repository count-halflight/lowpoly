// Visual capture: plays into specific rooms and screenshots the camera aimed at the action.
//   npm run build && node tests/visual.mjs [maxRoom] [seed]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const MAX = parseInt(process.argv[2] || '10', 10);
const SEED = process.argv[3] || '1234';
const W = parseInt(process.env.W || '1280', 10), H = parseInt(process.env.H || '720', 10);
const PORT = 4174;
const OUT = new URL('./shots/visual/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
await page.fill('#m-seed', SEED);
await page.click('[data-a="endless"]'); await page.click('[data-a="endlessRandom"]');
await page.waitForTimeout(500);
await page.evaluate(() => window.__vg.debug.god(true));
const aim = () => page.evaluate(() => {
  const g = window.__vg;
  const cam = g.camera.position;
  let t = null;
  if (g.bosses.active && g.bosses.active.alive) { const h = g.bosses.active.hitboxes()[0]; t = { x: h.x, y: h.y, z: h.z }; }
  else {
    let bd = 1e9;
    for (const e of g.enemies.list) { if (!e.alive) continue; const c = e.centerPos(); const d = Math.hypot(c.x - cam.x, c.z - cam.z); if (d < bd) { bd = d; t = { x: c.x, y: c.y, z: c.z }; } }
  }
  if (!t) return false;
  const dx = t.x - cam.x, dy = t.y - cam.y, dz = t.z - cam.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return true;
});
for (let r = 1; r <= MAX; r++) {
  await page.evaluate(() => {
    const g = window.__vg; const cur = g.level.current;
    if (cur.state !== 'cleared') { g.debug.killAll(); }
    if (cur.chosenExit < 0) g.chooseExit(0);
    const n = g.level.next; if (n) g.player.spawnAt(n.wx(n.spec.entX), 0.05, n.wz(n.D / 2 - 2), 0);
  });
  await page.waitForTimeout(2600);
  await aim();
  await page.waitForTimeout(120);
  const i = await page.evaluate(() => window.__vg.debug.info());
  await page.screenshot({ path: `${OUT}r${String(r).padStart(2, '0')}-${i.arch}.png` });
  // shoot a few times at the target and capture the effects
  await page.evaluate(() => { const g = window.__vg; g.input.fire = true; g.input.firePressed = true; });
  await page.waitForTimeout(160);
  await page.evaluate(() => { const g = window.__vg; g.input.fire = false; });
  await page.screenshot({ path: `${OUT}r${String(r).padStart(2, '0')}-${i.arch}-fire.png` });
  for (let k = 0; k < 30; k++) {
    const st = await page.evaluate(() => window.__vg.level.current.state);
    if (st === 'cleared') break;
    await page.evaluate(() => { const g = window.__vg; g.debug.killAll(); if (g.bosses.active && g.bosses.active.alive) g.debug.bossHit(0.6); });
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { const g = window.__vg; const c = g.pickups.list.find((p) => p.kind === 'cache'); if (c) g.player.body.pos.set(c.pos.x, 0.05, c.pos.z); });
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__vg.state)) === 'reward') { await page.keyboard.press('Digit1'); await page.waitForTimeout(200); }
  if ((await page.evaluate(() => window.__vg.state)) === 'reward') { await page.keyboard.press('Digit1'); await page.waitForTimeout(200); }
  console.log('room', r, i.arch, i.enemies, 'enemies', i.boss ? i.boss.type : '');
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.kill();
process.exit(0);
