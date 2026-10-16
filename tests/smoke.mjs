// Automated smoke / soak test: builds are served with `vite preview`, then a headless
// Chromium plays through the lobby, real rooms, bosses and a long endless run using the
// game's debug hooks, failing on any page error. Screenshots go to tests/shots/.
//
//   npm run build && npm test            (ROOMS=40 npm test for a longer soak)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOMS = parseInt(process.env.ROOMS || '26', 10);
const PORT = parseInt(process.env.PORT || '4173', 10);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const VW = parseInt(process.env.VW || '1280', 10);
const page = await browser.newPage({ viewport: { width: VW, height: Math.round(VW * 9 / 16) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const sleep = (ms) => page.waitForTimeout(ms);
const info = () => page.evaluate(() => window.__vg.debug.info());
const fail = (msg) => { console.error('FAIL:', msg); throw new Error(msg); };
let failed = false;

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug, null, { timeout: 15000 });
  await sleep(800);
  await page.screenshot({ path: SHOTS + '01-title.png' });

  await page.click('[data-a="endless"]'); await page.click('[data-a="endlessRandom"]');
  await sleep(600);
  let i = await info();
  if (i.state !== 'playing') fail('run did not start: ' + JSON.stringify(i));
  await page.screenshot({ path: SHOTS + '02-lobby.png' });

  // --- real movement: walk forward to the lobby exit door
  await page.keyboard.down('KeyW');
  await sleep(2600);
  await page.keyboard.up('KeyW');
  i = await info();
  console.log('after walking:', i.room, i.arch, i.roomState, 'rooms in memory:', i.rooms);

  // helper: drive one room to completion
  const advance = async (shotName) => {
    // enter the next room through the open door
    await page.evaluate(() => {
      const g = window.__vg;
      const cur = g.level.current;
      if (cur.state === 'cleared' && cur.chosenExit < 0) g.chooseExit(0);
      const n = g.level.next;
      if (n) g.player.spawnAt(n.wx(n.spec.entX), 0.05, n.wz(n.D / 2 - 2), 0);
    });
    await sleep(500);
    let st = await info();
    // fight: let enemies spawn, shoot a little for real, then clear
    await page.waitForFunction(() => { const g = window.__vg; return g.enemies.list.length > 0 || g.bosses.active || g.level.current.state === 'cleared'; }, null, { timeout: 15000 }).catch(() => {});
    await sleep(1400);
    await page.mouse.down(); await sleep(300); await page.mouse.up();
    if (shotName) await page.screenshot({ path: SHOTS + shotName });
    // let bosses run their full attack patterns for a while (god mode) to exercise every state
    const isBoss = await page.evaluate(() => !!(window.__vg.bosses.active && window.__vg.bosses.active.alive));
    if (isBoss && process.env.BOSS_SOAK !== '0') {
      await page.evaluate(() => { const g = window.__vg; g.player.body.pos.set(g.level.current.wx(0), 0.05, g.level.current.wz(8)); });
      for (let s = 0; s < 8; s++) {
        await sleep(1500);
        await page.evaluate((s) => { const g = window.__vg; if (s === 3) g.debug.bossHit(0.3); }, s);
      }
      const bs = await page.evaluate(() => { const b = window.__vg.bosses.active; return b ? { state: b.state, phase: b.phase, hp: Math.round(b.hp), dmg: window.__vg.run.damageTaken | 0 } : null; });
      console.log('   boss soak:', JSON.stringify(bs));
    }
    for (let k = 0; k < 40; k++) {
      st = await info();
      if (st.roomState === 'cleared') break;
      await page.evaluate(() => { const g = window.__vg; g.debug.killAll(); if (g.bosses.active && g.bosses.active.alive) g.debug.bossHit(0.6); });
      await sleep(350);
    }
    st = await info();
    if (st.roomState !== 'cleared') fail('room did not clear: ' + JSON.stringify(st));
    // pick up the cache and choose a reward
    await page.evaluate(() => {
      const g = window.__vg;
      const c = g.pickups.list.find((p) => p.kind === 'cache');
      if (c) g.player.body.pos.set(c.pos.x, 0.05, c.pos.z);
    });
    await sleep(300);
    for (let k = 0; k < 3; k++) {
      const s = await page.evaluate(() => window.__vg.state);
      if (s !== 'reward') break;
      await page.keyboard.press('Digit1');
      await sleep(200);
    }
    return info();
  };

  // first room: check a real encounter happened
  i = await info();
  if (i.room !== 1) {
    // walking did not reach the trigger (headless timing); push through the door
    await page.evaluate(() => { const g = window.__vg; const d = g.level.current.exitDoors[0]; g.player.body.pos.set(g.level.current.wx(d.x), 0.05, g.level.current.wz(d.z) + 2); });
    await sleep(400);
    await page.evaluate(() => { const g = window.__vg; const n = g.level.next; if (n) g.player.spawnAt(n.wx(n.spec.entX), 0.05, n.wz(n.D / 2 - 2), 0); });
    await sleep(600);
    i = await info();
  }
  if (i.room !== 1) fail('did not enter room 1: ' + JSON.stringify(i));
  await page.waitForFunction(() => window.__vg.enemies.list.length > 0, null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  i = await info();
  console.log('room 1 encounter:', i.enemies, 'enemies');
  if (i.enemies < 1) fail('no enemies spawned in room 1');
  await page.screenshot({ path: SHOTS + '03-room1-combat.png' });
  // shoot for real at whatever is in front for a moment
  await page.mouse.down(); await sleep(600); await page.mouse.up();
  for (let k = 0; k < 30; k++) {
    i = await info();
    if (i.roomState === 'cleared') break;
    await page.evaluate(() => window.__vg.debug.killAll());
    await sleep(300);
  }
  if (i.roomState !== 'cleared') fail('room 1 not cleared');
  await page.screenshot({ path: SHOTS + '04-room1-clear.png' });
  await page.evaluate(() => { const g = window.__vg; const c = g.pickups.list.find((p) => p.kind === 'cache'); if (c) g.player.body.pos.set(c.pos.x, 0.05, c.pos.z); });
  await sleep(400);
  if ((await page.evaluate(() => window.__vg.state)) !== 'reward') fail('cache did not open reward screen');
  await page.screenshot({ path: SHOTS + '05-reward.png' });
  const ownedBefore = (await info()).owned.length;
  await page.keyboard.press('Digit1');
  await sleep(300);

  // invincible from here on so the soak tests generation/memory, not our aim
  await page.evaluate(() => window.__vg.debug.god(true));

  const seen = { arch: new Set(), boss: new Set() };
  let maxRooms = 0, maxColliders = 0, maxChildren = 0, geo0 = null;
  for (let r = 2; r <= ROOMS; r++) {
    const shot = r === 2 || r === 5 || r === 10 || r === 15 || r === 20 || r === 7 ? `room-${String(r).padStart(2, '0')}.png` : null;
    i = await advance(shot);
    seen.arch.add(i.arch);
    if (i.boss) seen.boss.add(i.boss.type + (i.boss.tier ? '+' + i.boss.tier : ''));
    const mem = await page.evaluate(() => { const g = window.__vg; return { geo: g.renderer.r.info.memory.geometries, tex: g.renderer.r.info.memory.textures, progs: g.renderer.r.info.programs.length, calls: g.renderer.r.info.render.calls }; });
    if (r === 6) geo0 = mem.geo;
    maxRooms = Math.max(maxRooms, i.rooms); maxColliders = Math.max(maxColliders, i.colliders); maxChildren = Math.max(maxChildren, i.sceneChildren);
    console.log(`room ${String(i.room).padStart(2)} ${String(i.arch).padEnd(10)} state=${i.roomState} score=${i.score} owned=${i.owned.length} rooms=${i.rooms} geo=${mem.geo} tex=${mem.tex} programs=${mem.progs} children=${i.sceneChildren}${i.boss ? ' boss=' + i.boss.type + '/t' + i.boss.tier : ''}`);
    if (i.error) fail('runtime error: ' + i.error);
  }
  const memEnd = await page.evaluate(() => window.__vg.renderer.r.info.memory.geometries);
  console.log('archetypes seen:', [...seen.arch].join(', '));
  console.log('bosses seen:', [...seen.boss].join(', '));
  console.log('max rooms in memory:', maxRooms, 'max colliders:', maxColliders, 'max scene children:', maxChildren, 'geometries room6->end:', geo0, '->', memEnd);
  if (maxRooms > 3) fail('rooms are not being disposed');
  if (geo0 !== null && memEnd > geo0 * 1.6 + 40) fail('geometry count grows unbounded');
  if ((await info()).owned.length <= ownedBefore && ROOMS >= 10) console.warn('note: no new weapon picked in soak (card order)');

  // pause works
  await page.evaluate(() => window.__vg.pause());
  const t0 = await page.evaluate(() => window.__vg.time);
  await sleep(500);
  const t1 = await page.evaluate(() => window.__vg.time);
  if (t1 !== t0) fail('time advanced while paused');
  await page.screenshot({ path: SHOTS + '90-pause.png' });
  await page.evaluate(() => window.__vg.resume());

  // death + restart
  await page.evaluate(() => { const g = window.__vg; g.debug.god(false); g.player.stats.maxHp = 100; g.player.stats.phoenix = 0; g.player.stats.shieldMax = 0; g.player.shield = 0; g.player.hp = 1; g.player.invuln = 0; g.player.damage(50, null, 'TEST', 'This is a test.'); });
  await page.waitForFunction(() => window.__vg.state === 'dead', null, { timeout: 20000 }).catch(() => {});
  if ((await page.evaluate(() => window.__vg.state)) !== 'dead') fail('death screen not shown');
  await page.screenshot({ path: SHOTS + '91-dead.png' });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__vg.state === 'playing', null, { timeout: 10000 }).catch(() => {});
  await sleep(300);
  i = await info();
  if (i.state !== 'playing' || i.room !== 0 || i.hp !== 100) fail('restart failed: ' + JSON.stringify(i));
  console.log('restart ok');

  // mobile viewport + touch layout smoke
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await ctx.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(`http://localhost:${PORT}/`);
  await mp.waitForFunction(() => window.__vg && window.__vg.debug);
  await mp.tap('[data-a="endless"]'); await mp.waitForTimeout(200); await mp.tap('[data-a="endlessRandom"]');
  await mp.waitForFunction(() => window.__vg.state === 'playing', null, { timeout: 10000 });
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: SHOTS + '81-mobile-lobby.png' });
  // simultaneous touches: move stick + hold fire, via CDP multi-touch
  const cdp = await ctx.newCDPSession(mp);
  const tp = (id, x, y) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(1, 150, 300)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(1, 150, 240)] });
  const fireBox = await mp.locator('.tc-fire').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(1, 150, 240), tp(2, fireBox.x + fireBox.width / 2, fireBox.y + fireBox.height / 2)] });
  await mp.waitForTimeout(300);
  const both = await mp.evaluate(() => ({ move: window.__vg.input.moveY, fire: window.__vg.input.fire, touch: window.__vg.input.usingTouch, z: window.__vg.player.body.pos.z }));
  // lift only the fire finger: movement must continue
  // CDP touchEnd lists the point(s) being released
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tp(2, fireBox.x + fireBox.width / 2, fireBox.y + fireBox.height / 2)] });
  await mp.waitForTimeout(150);
  const after = await mp.evaluate(() => ({ move: window.__vg.input.moveY, fire: window.__vg.input.fire }));
  await mp.screenshot({ path: SHOTS + '80-mobile.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tp(1, 150, 240)] });
  console.log('multitouch:', JSON.stringify(both), '-> after lifting fire finger:', JSON.stringify(after));
  if (!(both.move > 0.5 && both.fire)) fail('simultaneous move+fire touch failed');
  if (!(after.move > 0.5 && !after.fire)) fail('lifting one finger affected the other touch');
  await ctx.close();

  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('\nALL CHECKS PASSED');
} catch (e) {
  failed = true;
  console.error(e.message);
  if (errors.length) console.error(errors.join('\n'));
  try { await page.screenshot({ path: SHOTS + '99-failure.png' }); } catch { /* ignore */ }
} finally {
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
