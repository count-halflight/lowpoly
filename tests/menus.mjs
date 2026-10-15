// Screenshots of every menu screen with a partly-progressed profile, at desktop and phone
// sizes. Fails on page errors or on horizontal overflow at phone width.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = 4178;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function run(label, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  // seed a profile with some progress
  await page.evaluate(() => {
    const g = window.__vg, p = g.profile.v;
    p.tutorialDone = true; p.deepest = 4; p.cyclesCleared = 0;
    for (const id of ['T1', 'T2', '1-1', '1-3', '2-2', '3-5', '4-1']) p.logs[id] = 1;
    for (const id of ['kast', 'tallyman', 'grindhammer', 'cinder']) p.bosses[id] = 1;
    p.bosses.hollowdrill = 0;
    for (const id of ['janitor', 'fusebox', 'cablehound', 'smeltwing', 'anvil']) p.minis[id] = 1;
    Object.assign(p.ranks, { '1-1': 'S', '1-3': 'A', '2-2': 'B', '3-5': 'P', '4-1': 'C' });
    p.endless = { bestScore: 48210, bestRoom: 23, runs: 7, bosses: 5 };
    g.profile.checkMedals(); g.profile.newMedals = [];
    g.menus.show('title');
  });
  await page.waitForTimeout(500);
  const shots = [['title', null], ['codex', 'codex'], ['codex-bosses', 'tab:bosses'], ['medals', 'medals'], ['levels', 'levels'], ['endless', 'endless'], ['settings', 'settings']];
  for (const [name, action] of shots) {
    await page.evaluate((a) => {
      const g = window.__vg, m = g.menus;
      m.show('title');
      if (!a) return;
      if (a.startsWith('tab:')) { m.action('codex'); m.codexTab = a.slice(4); m.buildCodex(); return; }
      m.action(a);
      if (a === 'levels') m.viewLevel('1-1');
    }, action);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => { const s = document.querySelector('.screen.on'); return s ? s.scrollWidth - s.clientWidth : 0; });
    if (overflow > 2) errors.push(label + ' ' + name + ': horizontal overflow ' + overflow + 'px');
    await page.screenshot({ path: SHOTS + `menu-${label}-${name}.png` });
  }
  // in-game overlays: terminal + pause + results
  await page.evaluate(() => { const g = window.__vg; g.newCampaign(0, true); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const g = window.__vg; g.setState('terminal'); g.menus.showTerminal('2-4'); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + `menu-${label}-terminal.png` });
  await page.evaluate(() => { const g = window.__vg; g.closeTerminal(); g.pause(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + `menu-${label}-pause.png` });
  await page.evaluate(() => { const g = window.__vg; g.resume(); g.completeLevel(); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + `menu-${label}-results.png` });
  await ctx.close();
}

try {
  await run('desk', { width: 1280, height: 720 });
  await run('phone', { width: 844, height: 390 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('MENUS OK');
} finally {
  await browser.close();
  server.kill();
}
