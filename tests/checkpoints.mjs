// Checkpoint rooms: one after each miniboss (the second sits right before the boss).
//   1. the room order is lobby, combat, combat, miniboss, CHECKPOINT, combat, miniboss, CHECKPOINT, boss
//   2. entering a checkpoint heals fully and saves (profile save has atRoom)
//   3. dying afterwards offers RETRY FROM CHECKPOINT, which respawns in that room
//   4. QUIT + CONTINUE resumes in the checkpoint room; RESTART LEVEL goes back to room 00
//   5. the level still finishes, and the save then points at the next level
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const PORT = parseInt(process.env.PORT || '4191', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const sleep = (ms) => page.waitForTimeout(ms);
const info = () => page.evaluate(() => {
  const g = window.__vg, i = g.debug.info(), c = g.campaign;
  return { ...i, save: g.profile.v.save ? { levelIdx: g.profile.v.save.levelIdx, atRoom: g.profile.v.save.atRoom || 0 } : null, cp: c.roomCheckpoint ? c.roomCheckpoint.atRoom : 0, restarts: c.lv ? c.lv.restarts : -1, maxHp: g.player.stats.maxHp, t0: c.lv ? c.lv.t0 : null };
});
const fail = (msg) => { throw new Error(msg); };
const ok = (cond, msg) => { if (!cond) fail(msg); console.log('  ok ', msg); };

// clears whatever is in the way and walks to the next room (same driver as campaign.mjs)
const step = () => page.evaluate(() => {
  const g = window.__vg, d = g.debug;
  if (g.cutscene.active) { g.cutscene.finish(true); return 'cutscene'; }
  if (g.state === 'reward') { g.chooseReward(0); return 'reward'; }
  if (g.state === 'terminal') { g.closeTerminal(); return 'terminal'; }
  if (g.state === 'results') return 'results';
  if (g.state === 'dead' || g.state === 'dying') return 'dead';
  if (g.state !== 'playing') return 'state:' + g.state;
  const room = g.level.current;
  if (room.state === 'combat') {
    const b = g.bosses.active;
    if (b && b.alive) { d.bossHit(0.34); return 'boss-hit'; }
    d.killAll(); g.director.waveT = -99; return 'kill';
  }
  for (const t of room.terminals) if (!t.read) { g.openTerminal(t); return 'read'; }
  const cache = g.pickups.list.find((p) => p.kind === 'cache');
  if (cache) { g.pickups.collect(cache); return 'cache'; }
  if (room.state === 'cleared') {
    if (g.level.next) {
      const nx = g.level.next;
      g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2));
      g.player.body.vel.set(0, 0, 0);
      return 'enter';
    }
    if (room.chosenExit < 0 && room.routes.length) { g.chooseExit(0); return 'exit ' + room.routes[0].type; }
  }
  return 'wait ' + room.state;
});

// advance until `pred(info)` holds
async function advance(pred, label, limit = 600) {
  for (let n = 0; n < limit; n++) {
    const i = await info();
    if (i.error) fail(label + ': game error ' + i.error);
    if (errors.length) fail(label + ': ' + errors.join(' | '));
    if (pred(i)) return i;
    const r = await step();
    if (r === 'dead') fail(label + ': player died');
    await sleep(r === 'enter' ? 150 : 30);
  }
  fail(label + ': timed out ' + JSON.stringify(await info()));
}

const order = [];
async function walkTo(roomIdx, label) {
  return advance((i) => {
    if (i.state === 'playing' && order[i.room] === undefined) order[i.room] = i.arch;
    return i.state === 'playing' && i.room === roomIdx && i.roomState === 'cleared';
  }, label);
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload();
  await page.waitForFunction(() => window.__vg && window.__vg.debug, null, { timeout: 15000 });
  await sleep(500);
  await page.evaluate(() => { window.__vg.settings.set('cutscenes', false); window.__vg.newCampaign(0, true); });
  await sleep(600);

  console.log('1. first checkpoint');
  let i = await walkTo(4, 'to room 4');
  ok(i.arch === 'checkpoint', 'room 04 is a checkpoint (got ' + i.arch + ')');
  ok(order[3] === 'miniboss', 'it follows the first miniboss (' + order.join(',') + ')');
  ok(Math.abs(i.hp - i.maxHp) < 0.5, 'full heal on entry (' + Math.round(i.hp) + '/' + i.maxHp + ')');
  ok(i.save && i.save.atRoom === 4 && i.save.levelIdx === 0, 'profile save points at room 04: ' + JSON.stringify(i.save));
  ok(i.cp === 4, 'campaign keeps the room checkpoint');
  const t0 = i.t0;

  console.log('2. die after the checkpoint');
  await walkTo(5, 'to room 5');
  const dmg = await page.evaluate(() => {
    const g = window.__vg, out = [];
    g.player.stats.phoenix = false; // a picked upgrade could revive the player once
    for (let k = 0; k < 3 && g.state === 'playing'; k++) { g.player.invuln = 0; g.player.shield = 0; out.push(g.player.damage(1e7, null, 'TEST', '')); }
    return { out, state: g.state, hp: g.player.hp };
  });
  console.log('  damage', JSON.stringify(dmg));
  await page.waitForFunction(() => window.__vg.state === 'dead', null, { timeout: 15000 });
  const btns = await page.$$eval('#m-deadlist [data-a]', (els) => els.map((e) => e.dataset.a));
  ok(btns[0] === 'retryCheckpoint' && btns.includes('retryLevel'), 'death menu offers RETRY FROM CHECKPOINT first: ' + btns.join(','));
  await page.click('[data-a="retryCheckpoint"]');
  await sleep(600);
  i = await info();
  ok(i.state === 'playing' && i.room === 4 && i.arch === 'checkpoint' && i.roomState === 'cleared', 'respawned in the checkpoint room: ' + JSON.stringify({ s: i.state, r: i.room, a: i.arch, rs: i.roomState }));
  ok(i.restarts === 1, 'restart counted (' + i.restarts + ')');
  ok(i.t0 === t0, 'level clock keeps running from the level start');
  ok(Math.abs(i.hp - i.maxHp) < 0.5, 'full health after respawn');

  console.log('3. second checkpoint, before the boss');
  i = await walkTo(7, 'to room 7');
  ok(i.arch === 'checkpoint' && order[6] === 'miniboss', 'room 07 is a checkpoint after the second miniboss (' + order.join(',') + ')');
  ok(i.save.atRoom === 7, 'save moved to room 07');
  const routes = await page.evaluate(() => window.__vg.level.current.routes.map((r) => r.type));
  ok(routes.length === 1 && routes[0] === 'boss', 'its exit leads to the boss: ' + routes.join(','));

  console.log('4. quit + continue, restart level');
  await page.evaluate(() => window.__vg.quitToTitle());
  await sleep(500);
  const cont = await page.$eval('[data-a="continue"]', (e) => e.textContent);
  ok(/CHECKPOINT/.test(cont), 'title CONTINUE mentions the checkpoint: ' + cont.trim());
  await page.click('[data-a="continue"]');
  await sleep(700);
  i = await info();
  ok(i.state === 'playing' && i.room === 7 && i.arch === 'checkpoint', 'continue resumes in room 07');
  await page.evaluate(() => window.__vg.pause());
  await sleep(300);
  const pbtns = await page.$$eval('#m-pauselist [data-a]', (els) => els.map((e) => e.dataset.a));
  ok(pbtns.includes('retryCheckpoint') && pbtns.includes('retryLevel'), 'pause offers both restarts: ' + pbtns.join(','));
  await page.click('#m-pauselist [data-a="retryLevel"]');
  await sleep(700);
  i = await info();
  ok(i.state === 'playing' && i.room === 0 && i.arch === 'lobby' && i.cp === 0, 'RESTART LEVEL goes back to room 00');
  ok(i.save && !i.save.atRoom && i.save.levelIdx === 0, 'save reset to the level start');

  console.log('5. finish the level');
  order.length = 0;
  i = await advance((x) => { if (x.state === 'playing' && order[x.room] === undefined) order[x.room] = x.arch; return x.state === 'results'; }, 'to results', 900);
  ok(order[4] === 'checkpoint' && order[7] === 'checkpoint' && order[8] === 'boss', 'full order: ' + order.join(','));
  ok(i.save && i.save.levelIdx === 1 && !i.save.atRoom, 'after the level the save points at the next level: ' + JSON.stringify(i.save));
  await page.evaluate(() => window.__vg.nextLevel());
  await sleep(700);
  i = await info();
  ok(i.state === 'playing' && i.level.idx === 1 && i.room === 0, 'next level starts at its lobby');
  if (errors.length) fail(errors.join(' | '));
  console.log('CHECKPOINTS OK');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
