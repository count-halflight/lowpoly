// Campaign / tutorial / final boss / NG+ integration test. Serves the build with
// `vite preview` and drives the game through its debug hooks:
//   1. title -> NEW DESCENT (fresh profile) -> all 10 training stations
//   2. BEGIN THE DESCENT -> LEVELS (env LEVELS, default 3) room by room, incl. minibosses + boss
//   3. jump to the final level -> THE ARCHITECT through all three phases -> breaker -> ending
//   4. results -> credits -> NG+ cycle starts mirrored
// Fails on any page error. Screenshots go to tests/shots/campaign-*.png
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const LEVELS = parseInt(process.env.LEVELS || '3', 10);
const PORT = 4174;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const sleep = (ms) => page.waitForTimeout(ms);
const info = () => page.evaluate(() => window.__vg.debug.info());
const shot = (n) => page.screenshot({ path: SHOTS + 'campaign-' + n + '.png' });
const fail = (msg) => { throw new Error(msg); };
const check = async (label) => {
  const i = await info();
  if (i.error) fail(label + ': game error ' + i.error);
  if (errors.length) fail(label + ': ' + errors.join(' | '));
  return i;
};

// One "step" of a scripted player: clears whatever is in the way and walks to the next room.
async function step() {
  return page.evaluate(() => {
    const g = window.__vg;
    const d = g.debug;
    if (g.cutscene.active) { g.cutscene.finish(true); return 'cutscene'; }
    if (g.state === 'reward') { g.chooseReward(0); return 'reward'; }
    if (g.state === 'terminal') { g.closeTerminal(); return 'terminal'; }
    if (g.state === 'results') return 'results';
    if (g.state === 'dead' || g.state === 'dying') return 'dead';
    if (g.state !== 'playing') return 'state:' + g.state;
    const room = g.level.current;
    if (g.mode === 'tutorial' && room.state === 'tutorial') { g.tutorial.complete(); return 'tut-complete'; }
    if (g.breaker && !g.breaker.pulled) { g.pullBreaker(); return 'breaker'; }
    if (room.state === 'combat') {
      const b = g.bosses.active;
      if (b && b.alive) { d.bossHit(0.34); return 'boss-hit ' + b.type + ' ' + Math.round(b.hp) + ' p' + b.phase; }
      d.killAll();
      g.director.waveT = -99;
      return 'kill';
    }
    if (g.breaker && !g.breaker.pulled) { g.pullBreaker(); return 'breaker'; }
    // read terminals on the way
    for (const t of room.terminals) if (!t.read) { g.openTerminal(t); return 'read ' + t.id; }
    // claim caches
    const cache = g.pickups.list.find((p) => p.kind === 'cache');
    if (cache) { g.pickups.collect(cache); return 'cache'; }
    if (room.state === 'cleared') {
      if (g.level.next) {
        const nx = g.level.next;
        g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2));
        g.player.body.vel.set(0, 0, 0);
        return 'enter';
      }
      if (room.chosenExit < 0 && room.routes.length) {
        const k = Math.floor(Math.random() * room.routes.length);
        g.chooseExit(k);
        return 'exit ' + (room.routes[k] && room.routes[k].type);
      }
    }
    return 'wait ' + room.state;
  });
}

const t0 = Date.now();
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload();
  await page.waitForFunction(() => window.__vg && window.__vg.debug, null, { timeout: 15000 });
  await sleep(700);
  await shot('00-title');
  await page.click('[data-a="newGame"]');
  await sleep(500);
  let i = await check('tutorial start');
  if (i.mode !== 'tutorial') fail('NEW DESCENT should start training on a fresh profile: ' + JSON.stringify(i));
  console.log('tutorial started, objective:', i.objective);
  await shot('01-tutorial');

  // ---- tutorial
  let guard = 0, lastStation = -1;
  while (guard++ < 400) {
    i = await info();
    if (i.menu === 'tutdone') break;
    if (i.station !== null && i.station !== lastStation) {
      lastStation = i.station;
      await sleep(250);
      await shot('02-station-' + i.station);
      console.log('station', i.station, i.objective);
    }
    const r = await step();
    if (r.startsWith('wait')) await sleep(120);
    await sleep(40);
    await check('tutorial');
  }
  i = await info();
  if (i.menu !== 'tutdone') fail('tutorial did not complete: ' + JSON.stringify(i));
  await shot('03-tutdone');
  await page.click('[data-a="beginDescent"]');
  await sleep(500);
  i = await check('campaign start');
  if (i.mode !== 'campaign' || !i.level) fail('campaign did not start: ' + JSON.stringify(i));
  console.log('campaign level', i.level);
  await sleep(1500);
  await shot('04-level-entry');

  // ---- levels
  const seenMinis = new Set(), seenBosses = new Set();
  for (let L = 0; L < LEVELS; L++) {
    guard = 0;
    let shotsTaken = 0;
    while (guard++ < 900) {
      const r = await step();
      i = await info();
      if (i.minis && i.minis.length) i.minis.forEach((m) => seenMinis.add(m));
      if (i.boss) seenBosses.add(i.boss.type);
      if ((r === 'cutscene' || r === 'kill') && shotsTaken < 4 && (i.arch === 'miniboss' || i.arch === 'boss')) {
        // let the intro play a moment for a screenshot
        shotsTaken++;
      }
      if (r === 'results') break;
      if (r === 'dead') fail('player died in level ' + L);
      if (r.startsWith('enter')) await sleep(150);
      else await sleep(30);
      await check('level ' + L + ' (' + r + ')');
    }
    await shot('05-results-L' + L);
    console.log('level', L, 'done; minis', [...seenMinis].join(','), 'bosses', [...seenBosses].join(','));
    if (i.state !== 'results') fail('level did not finish: ' + JSON.stringify(i));
    await page.evaluate(() => window.__vg.nextLevel());
    await sleep(800);
    await check('next level');
    if (L === 0) await shot('06-level2-entry');
  }

  // ---- watch one boss intro cutscene properly (no skipping) for screenshots
  await page.evaluate(() => { const g = window.__vg; g.campaign.levelIdx = Math.min(g.campaign.levelIdx, 28); });

  // ---- final level
  await page.evaluate(() => window.__vg.debug.goLevel(30));
  await sleep(800);
  i = await check('final level');
  console.log('final level', i.level);
  await page.evaluate(() => { const g = window.__vg; const room = g.level.current; g.chooseExit(0); const nx = g.level.next; g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2)); });
  await sleep(1200);
  await shot('07-architect-intro');
  await sleep(2600);
  await shot('08-architect-intro2');
  await page.evaluate(() => window.__vg.debug.god(true));
  guard = 0;
  let phaseShots = new Set();
  while (guard++ < 400) {
    i = await info();
    if (i.boss && !phaseShots.has(i.boss.phase) && !i.cutscene) {
      phaseShots.add(i.boss.phase);
      await sleep(1500);
      await shot('09-architect-phase' + i.boss.phase);
    }
    const r = await step();
    if (r === 'results') break;
    if (r === 'breaker') { await sleep(200); }
    await sleep(r.startsWith('boss-hit') ? 250 : 40);
    await check('final (' + r + ')');
  }
  if (i.state !== 'results' && (await info()).state !== 'results') fail('ending did not reach results: ' + JSON.stringify(await info()));
  await shot('10-final-results');
  await page.evaluate(() => window.__vg.nextLevel());
  await sleep(800);
  i = await info();
  if (i.menu !== 'credits') fail('credits did not roll: ' + JSON.stringify(i));
  await shot('11-credits');
  await page.click('[data-a="skipCredits"]');
  await sleep(400);
  i = await info();
  if (i.menu !== 'ngplus') fail('NG+ screen missing: ' + JSON.stringify(i));
  await shot('12-ngplus');
  await page.click('[data-a="beginCycle"]');
  await sleep(1000);
  i = await check('ng+ start');
  if (!i.level || i.level.cycle !== 1) fail('NG+ cycle did not start: ' + JSON.stringify(i));
  const mirrored = await page.evaluate(() => { const g = window.__vg; return { first: g.campaign.plan[0].levelId, stratum: g.campaign.level.stratum }; });
  console.log('NG+ started at', mirrored);
  if (mirrored.stratum !== 10) fail('NG+ should start at the Core');
  // a couple of NG+ rooms
  guard = 0;
  while (guard++ < 120) {
    const r = await step();
    i = await info();
    if (i.room >= 3) break;
    await sleep(r.startsWith('enter') ? 150 : 30);
    await check('ng+ rooms (' + r + ')');
  }
  await shot('13-ngplus-room');
  // title screen reflects progress
  await page.evaluate(() => window.__vg.quitToTitle());
  await sleep(500);
  await shot('14-title-after');
  const prof = await page.evaluate(() => { const p = window.__vg.profile.v; return { medals: Object.keys(p.medals), logs: Object.keys(p.logs).length, bosses: Object.keys(p.bosses).length, minis: Object.keys(p.minis).length, cycles: p.cyclesCleared }; });
  console.log('profile', JSON.stringify(prof));
  if (prof.cycles < 1) fail('cycle not recorded');
  await check('end');
  console.log('CAMPAIGN TEST PASSED in', Math.round((Date.now() - t0) / 1000) + 's');
} catch (e) {
  console.error('FAIL:', e.message);
  await shot('zz-fail').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
