// HUD declutter rules, desktop + phone, deterministic stepping:
//  - hints queue: one at a time, never started under a banner, bursts are capped
//  - banners sit below the boss bars, never on top of them
//  - nothing is drawn while a menu (pause) is up
//  - RUSH strip under the health bar shows from ~10% and hides when empty; redundant toasts are dropped
//  - tech counters + medals from Profile.attach reach the corner lane
//   PORT=4410 node tests/hud-declutter.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4180', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function run(label, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const res = await page.evaluate(async () => {
    const g = window.__vg, hud = g.hud, out = [];
    const ok = (c, m) => { if (!c) out.push(m); };
    g.frame = () => {}; g.render = () => {};
    const step = (sec) => { for (let i = 0, n = Math.round(sec * 60); i < n; i++) g.tick(1 / 60, 1 / 60); };
    g.startEndless(4242);
    g.debug.god(true);
    step(3);
    // --- hint queue
    hud.reset(); g.shownHints = new Set();
    hud.banner('TEST BANNER', 'SUB');
    g.hint('first tip'); g.hint('second tip'); g.hint('third tip');
    step(0.5);
    ok(!hud.hintText, 'hint started while a banner is up');
    step(2.5);
    ok(hud.hintText === 'first tip', 'first queued hint did not show after the banner: ' + hud.hintText);
    ok(hud.hintQ.length === 1, 'burst of hints not capped at two: ' + hud.hintQ.length);
    step(5.5);
    ok(hud.hintText !== 'second tip', 'second hint started without a gap');
    step(4.5);
    ok(hud.hintText === 'second tip', 'second hint never showed: ' + hud.hintText);
    hud.hint('');
    // --- banner below boss bars (a stand-in boss for the HUD only)
    const fake = { alive: true, state: 'idle', name: 'TEST BOSS', title: 'STAND-IN', hp: 50, maxHp: 100, phase: 1, info: { color: '#ff3050' } };
    const real = g.bosses.active;
    g.bosses.active = fake;
    hud.banners = null; hud.bannerQ = []; hud.levelCardS = null;
    hud.banner('ROOM 99', 'OVERLAP CHECK');
    hud.update(0.3);
    const barsBottom = hud.topY;
    ok(hud.bannerY >= barsBottom, `banner (y ${hud.bannerY}) overlaps the boss bar (bottom ${barsBottom})`);
    g.bosses.active = real;
    hud.banners = null;
    // --- RUSH strip + redundant toasts
    g.player.rush = 1; step(0.6);
    ok(hud.rushA > 0.9, 'RUSH strip not shown when full: ' + hud.rushA.toFixed(2));
    g.player.rush = 0.04; step(1.2);
    ok(hud.rushA < 0.05, 'RUSH strip still shown when nearly empty: ' + hud.rushA.toFixed(2));
    hud.toasts = [];
    hud.toast('RUSH READY · PRESS X', '#ff3df0'); hud.toast('PARRY', '#ffe23a');
    ok(hud.toasts.length === 0, 'redundant toasts were queued: ' + hud.toasts.map((t) => t.text).join(','));
    hud.toast('BACKUP INCOMING', '#ff3050');
    ok(hud.toasts.length === 1, 'normal toast dropped');
    // --- tech counters + medal into the corner lane
    const w0 = g.profile.v.stats.wallruns || 0;
    for (let i = 0; i < 100; i++) g.emit('wallrun');
    ok(g.profile.v.stats.wallruns === w0 + 100, 'wall-runs not counted: ' + g.profile.v.stats.wallruns);
    g.emit('quickscope', true); g.emit('noscope', 31.6); g.emit('mantle'); g.emit('dashslide'); g.emit('finisher', {}); g.emit('perfectDodge'); g.emit('projBoost', {}); g.emit('rush');
    const st = g.profile.v.stats;
    ok(st.quickscopes >= 1 && st.noscopes >= 1 && st.longestNoScope >= 31 && st.vaults >= 1 && st.dashSlides >= 1 && st.finishers >= 1 && st.perfectDodges >= 1 && st.projBoosts >= 1 && st.rushes >= 1, 'tech counters missing: ' + JSON.stringify(st));
    await new Promise((r) => setTimeout(r, 450));
    step(0.1);
    ok(!!g.profile.v.medals.wallrun, 'PARKOUR medal not awarded');
    ok(hud.corner.some((c) => /PARKOUR|NOTHING BUT NET/.test(c.text)) || g.profile.newMedals.length > 0, 'medal popup did not reach the corner lane');
    // --- nothing drawn under the pause menu
    g.pause(); step(0.05);
    const c = hud.canvas, d = hud.ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { lit++; if (lit > 0) break; }
    ok(!lit, 'HUD still drawn under the pause menu');
    g.resume();
    return out;
  });
  for (const e of res) errors.push(label + ': ' + e);
  console.log(label, res.length ? 'FAIL ' + res.length : 'ok');
  await ctx.close();
}

try {
  await run('desk', { width: 1280, height: 720 });
  await run('phone', { width: 844, height: 390 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('HUD DECLUTTER OK');
} finally {
  await browser.close();
  server.kill();
}
