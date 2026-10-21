// Touch layout: at phone sizes, in right- and left-handed and full/minimal layouts, no two touch
// buttons overlap, all stay on screen and clear of the HUD's top band (health, ammo, weapon chips).
// Real taps: the AIM latch toggles, and in the minimal layout tapping the ammo counter reloads.
//   PORT=4410 node tests/touch-layout.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4179', 10);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = (m) => errors.push(m);

async function check(w, h, lefty, layout) {
  const label = `${w}x${h}${lefty ? '-lefty' : ''}-${layout}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(label + ' pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.evaluate(([lefty, layout]) => {
    const g = window.__vg;
    g.settings.set('leftHanded', lefty); g.settings.set('touchLayout', layout);
    g.startEndless(1234);
  }, [lefty, layout]);
  await page.waitForFunction(() => window.__vg.state === 'playing');
  // show the conditional buttons too (RUSH ready, USE prompt) so they are checked against the rest
  await page.evaluate(() => { const g = window.__vg; for (const n of ['rush', 'use']) g.touch.root.querySelector('.tc-' + n).style.display = 'flex'; g.hud.toasts = []; g.hud.hint(''); });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const g = window.__vg, hud = g.hud;
    const boxes = [...document.querySelectorAll('#touch .tc-btn')].filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => { const b = el.getBoundingClientRect(); return { n: el.dataset.act, x: b.x, y: b.y, w: b.width, h: b.height }; });
    // the HUD's top band: weapon chips + ammo (right) and health (left), in css px
    const a = hud.ammoBox, k = hud.k;
    let chipsBottom = 0;
    for (const b of hud.weaponBoxes) chipsBottom = Math.max(chipsBottom, (b.y + b.h) / k);
    const hudBoxes = hud.weaponBoxes.map((b) => ({ n: 'chip ' + b.id, x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k }));
    if (a) hudBoxes.push({ n: 'ammo', x: a.x / k, y: a.y / k, w: a.w / k, h: a.h / k });
    return { boxes, hudBoxes, ammoBottom: a ? (a.y + a.h) / k : 0, chipsBottom, hidden: ['reload', 'swap'].map((n) => !!document.querySelector(`#touch .tc-btn[data-act="${n}"]`) && getComputedStyle(document.querySelector(`#touch .tc-btn[data-act="${n}"]`)).display === 'none') };
  });
  const B = r.boxes;
  if (B.length < 9) fail(label + ': only ' + B.length + ' buttons visible');
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > w + 0.5 || a.y + a.h > h + 0.5) fail(`${label}: ${a.n} off screen ${JSON.stringify(a)}`);
    if (a.n !== 'pause' && a.y < Math.max(r.ammoBottom, r.chipsBottom) + 2) fail(`${label}: ${a.n} reaches into the HUD top band (top ${a.y.toFixed(0)} < ${Math.max(r.ammoBottom, r.chipsBottom).toFixed(0)})`);
    for (let j = i + 1; j < B.length; j++) {
      const b = B[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) fail(`${label}: ${a.n} overlaps ${b.n}`);
    }
  }
  // the pause button shares the top band: it must not cover the ammo counter or weapon chips
  const pz = B.find((b) => b.n === 'pause');
  for (const b of r.hudBoxes) {
    const ox = Math.min(pz.x + pz.w, b.x + b.w) - Math.max(pz.x, b.x), oy = Math.min(pz.y + pz.h, b.y + b.h) - Math.max(pz.y, b.y);
    if (ox > 1 && oy > 1) fail(`${label}: pause button covers HUD ${b.n}`);
  }
  if (layout === 'minimal' && !(r.hidden[0] && r.hidden[1])) fail(label + ': RLD/SWAP still shown in the minimal layout');
  if (layout === 'full' && (r.hidden[0] || r.hidden[1])) fail(label + ': RLD/SWAP hidden in the full layout');
  await page.screenshot({ path: SHOTS + `touch-${label}.png` });
  // AIM latch with a real tap
  await page.evaluate(() => { for (const n of ['rush', 'use']) window.__vg.touch.root.querySelector('.tc-' + n).style.display = ''; });
  const aim = await page.locator('.tc-aim').boundingBox();
  await page.touchscreen.tap(aim.x + aim.width / 2, aim.y + aim.height / 2);
  await page.waitForTimeout(100);
  const on = await page.evaluate(() => window.__vg.input.touchAim);
  await page.touchscreen.tap(aim.x + aim.width / 2, aim.y + aim.height / 2);
  await page.waitForTimeout(100);
  const off = await page.evaluate(() => window.__vg.input.touchAim);
  if (!(on && !off)) fail(`${label}: AIM latch did not toggle (on=${on} off=${off})`);
  // tapping the ammo counter reloads (the only manual reload in the minimal layout)
  await page.evaluate(() => { const g = window.__vg; g.weapons.give('ripsaw'); });
  // game time runs slow under software GL: wait for the switch to finish, not a fixed time
  await page.waitForFunction(() => { const w = window.__vg.weapons; return w.current === 'ripsaw' && !w.switchTo && !w.reloading; }, null, { timeout: 15000 });
  await page.evaluate(() => { const g = window.__vg; g.weapons.ammo[g.weapons.current].mag = 3; });
  await page.waitForTimeout(150);
  const tap = await page.evaluate(() => { const hud = window.__vg.hud, a = hud.ammoBox; return { x: (a.x + a.w / 2) / hud.k, y: (a.y + a.h / 2) / hud.k }; });
  await page.touchscreen.tap(tap.x, tap.y);
  await page.waitForFunction(() => window.__vg.weapons.reloading, null, { timeout: 3000 }).catch(() => {});
  const rel = await page.evaluate(() => ({ reloading: !!window.__vg.weapons.reloading, cur: window.__vg.weapons.current }));
  if (!rel.reloading) fail(`${label}: tapping the ammo counter did not reload (${JSON.stringify(rel)})`);
  console.log(label, 'buttons', B.length, 'aim', on, '->', off, 'ammo-tap reload', rel.reloading);
  await ctx.close();
}

try {
  for (const [w, h] of [[844, 390], [740, 360]]) {
    for (const lefty of [false, true]) for (const layout of ['full', 'minimal']) await check(w, h, lefty, layout);
  }
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('TOUCH LAYOUT OK');
} finally {
  await browser.close();
  server.kill();
}
