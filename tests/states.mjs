// Game state machine under hostile timing: every case drives the real input system (keys, the
// pause key, number keys, USE, DOM menu buttons, pointer-lock loss, viewport resizes) one fixed
// 60 Hz step at a time. Fights are skipped with debug kills where a case is about a transition,
// not about combat (tests/bot-campaign.mjs covers real fighting). Cases:
//   rewardKey      picking a reward card with key 1 must not also cycle the held weapon
//   terminalKeys   E closes the terminal without re-opening it; ESC closes it too
//   lockLoss       losing pointer lock pauses play, even right after a terminal / reward was shown
//   cutscene       ESC / lock loss during a cutscene neither pauses nor breaks it; it ends in play
//   deadKey        R on the death screen restarts without eating the new magazine
//   doubleExit     touching two doors in one step builds only one next room
//   quitMidDoor    quitting while the next room is open leaves nothing behind for the next run
//   bossDeath      dying in a boss room retries from the checkpoint right before it; the boss
//                  route is offered again and the boss returns at full health
//   practice       practice levels keep a working checkpoint without touching the save
//   touchAim       the touch AIM latch is released by pause and by death
//   resize         resizing mid-fight / mid-cutscene keeps the game running
//   finale         final level: real breaker pull, results, credits -> NG+ -> cycle II starts
//                  with the carried loadout
//   PORT=4430 node tests/states.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4183', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

function install() {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
  const step = (n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
  const release = () => { for (const a of KEYS) g.input.held[a] = false; g.input.fire = false; };
  const click = (a) => { const b = [...document.querySelectorAll('[data-a="' + a + '"]')].find((x) => x.offsetParent !== null); if (!b) return false; b.click(); return true; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // real-time gap so the pause key's 350 ms debounce never eats a press
  const pauseKey = async () => { await wait(380); g.input.pressed.pause = true; step(); };
  const walkTo = (x, z) => {
    const pp = g.player.body.pos, room = g.level.current;
    let tx = x, tz = z;
    if (room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z) && Math.hypot(x - pp.x, z - pp.z) > 2) { room.nav.flow(x, z); const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 }); if (s) { tx = s.x; tz = s.z; } }
    g.player.yaw = Math.atan2(-(tx - pp.x), -(tz - pp.z)); g.player.pitch = 0;
    g.input.held.fwd = true;
  };
  // play forward until pred() holds: real walking/doors/keys, debug kills for the fights
  const drive = (pred, limit = 60 * 240, route = 0) => {
    for (let f = 0; f < limit; f++) {
      if (pred()) { release(); return true; }
      release();
      const st = g.state;
      if (st === 'reward') g.input.slot = 0;
      else if (st === 'terminal') g.input.pressed.use = true;
      else if (st === 'cutscene') g.input.held.jump = true;
      else if (st === 'playing') {
        const room = g.level.current;
        g.player.hp = Math.max(g.player.hp, g.player.stats.maxHp * 0.6);
        if (room.state === 'combat') {
          const b = g.bosses.active;
          if (f % 30 === 0) { if (b && b.alive) g.debug.bossHit(0.25); else { g.debug.killAll(); g.director.waveT = -99; } }
        } else {
          const cache = g.pickups.list.find((p) => p.kind === 'cache' && room.containsXZ(p.pos.x, p.pos.z));
          const nx = g.level.next;
          if (cache) walkTo(cache.pos.x, cache.pos.z);
          else if (nx) walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3));
          else if (room.routes && room.routes.length) { const d = room.exitDoors[Math.min(route, room.routes.length - 1)]; walkTo(room.wx(d.x), room.wz(d.z) + 1.2); }
          if (f % 100 === 50) g.input.pressed.jump = true;
        }
      }
      step();
    }
    release();
    return false;
  };
  const info = () => ({ state: g.state, mode: g.mode, room: g.level.current && g.level.current.index, arch: g.level.current && g.level.current.spec.arch, roomState: g.level.current && g.level.current.state, menu: g.menus.current, err: g.lastError });
  window.__S = { g, step, release, click, wait, pauseKey, walkTo, drive, info };
}

const results = {};
async function run(name, fn) {
  let r;
  try { r = await page.evaluate(fn); } catch (e) { r = { ok: false, error: e.message.slice(0, 500) }; }
  results[name] = r;
  console.log((r.ok ? 'ok   ' : 'FAIL ') + name.padEnd(13) + JSON.stringify(r).slice(0, 700));
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.evaluate(install);

  await run('rewardKey', () => {
    const { g, step } = window.__S;
    g.startEndless(4242);
    step(30);
    const v0 = g.weapons.variantId('hammer'), w0 = g.weapons.current;
    g.openReward('standard', 1);
    const opened = g.state === 'reward';
    g.input.slot = 0; step(); // key 1
    step(30);
    return { ok: opened && g.state === 'playing' && g.weapons.current === w0 && g.weapons.variantId('hammer') === v0, opened, state: g.state, weapon: g.weapons.current, variant: g.weapons.variantId('hammer'), was: v0 };
  });

  await run('terminalKeys', async () => {
    const { g, step, pauseKey } = window.__S;
    g.startTutorial(false, 0);
    const t = g.level.current.terminals[0];
    g.player.body.pos.set(t.pos.x + (t.pos.x > g.level.current.origin.x ? -1.2 : 1.2), 0.05, t.pos.z);
    step(5);
    g.input.pressed.use = true; step();
    const open1 = g.state === 'terminal';
    step(10);
    g.input.pressed.use = true; step(); // E closes...
    const closedE = g.state === 'playing';
    step(10); // ...and must not re-open on the same press
    const stayed = g.state === 'playing';
    g.input.pressed.use = true; step();
    const open2 = g.state === 'terminal';
    await pauseKey(); // ESC closes it too
    const closedEsc = g.state === 'playing';
    return { ok: open1 && closedE && stayed && open2 && closedEsc, open1, closedE, stayed, open2, closedEsc };
  });

  await run('lockLoss', async () => {
    const { g, step, click, wait } = window.__S;
    g.startEndless(77);
    step(10);
    // the terminal and reward screens drop pointer lock on purpose; if the lock was already gone
    // (touch, unfocused tab) the "ignore the next loss" flag must not linger into play
    g.openReward('standard', 1);
    click('skipReward');
    step(5);
    await wait(450); // past the grace window for the menu's own, intended lock release
    g.input.onLockLost();
    const pausedAfterReward = g.state === 'paused';
    click('resume'); step(5);
    g.startTutorial(false, 0);
    const t = g.level.current.terminals[0];
    g.openTerminal(t);
    click('closeTerminal');
    step(5);
    await wait(450);
    g.input.onLockLost();
    const pausedAfterTerminal = g.state === 'paused';
    click('resume'); step(5);
    return { ok: pausedAfterReward && pausedAfterTerminal, pausedAfterReward, pausedAfterTerminal, state: g.state };
  });

  // the death screen releases a held pointer lock; on a busy machine the browser reported that
  // release 440 ms later, after RETRY, and the fresh run paused itself. A real loss later still pauses.
  await run('lateUnlock', async () => {
    const { g, step, click, wait } = window.__S;
    // a scripted lock: the headless browser's own (instant) lock events must not interleave
    const rq = g.input.requestLock;
    g.input.requestLock = () => {};
    if (document.pointerLockElement) { document.exitPointerLock(); await wait(300); }
    g.startEndless(61);
    step(5);
    Object.defineProperty(document, 'pointerLockElement', { get: () => g.input.canvas, configurable: true });
    g.player.damage(99999, null, 'TEST', '');
    for (let i = 0; i < 200 && g.state !== 'dead'; i++) step();
    delete document.pointerLockElement;
    const dead = g.state === 'dead';
    const retried = click('restart');
    step(5);
    await wait(700);
    g.input.onLockLost(); // the late event for our own release
    const stillPlaying = g.state === 'playing';
    await wait(450);
    g.input.onLockLost(); // a real one: alt-tab, ESC in the browser
    const pausedLater = g.state === 'paused';
    click('resume'); step(2);
    g.input.requestLock = rq;
    return { ok: dead && retried && stillPlaying && pausedLater, dead, retried, stillPlaying, pausedLater };
  });

  await run('cutscene', async () => {
    const { g, step, pauseKey } = window.__S;
    g.startEndless(99);
    step(10);
    const p = g.player.body.pos.clone();
    let done = 0;
    g.cutscene.play([{ dur: 1.0, cam: { from: p.clone().setY(3), to: p.clone().setY(4), look: p.clone() }, say: { speaker: 'TEST', text: 'A line.' } }, { dur: 1.0 }], () => { done++; });
    const inCut = g.state === 'cutscene';
    await pauseKey(); // ESC mid-cutscene
    g.input.onLockLost(); // and the browser drops pointer lock
    const still = g.state === 'cutscene';
    step(200);
    return { ok: inCut && still && g.state === 'playing' && done === 1 && !g.cutscene.active, inCut, still, state: g.state, done };
  });

  await run('deadKey', () => {
    const { g, step } = window.__S;
    g.startEndless(5);
    step(10);
    g.player.damage(99999, null, 'TEST', '');
    for (let i = 0; i < 200 && g.state !== 'dead'; i++) step();
    const dead = g.state === 'dead';
    g.input.pressed.reload = true; step();
    const a = g.weapons.ammo[g.weapons.current];
    return { ok: dead && g.state === 'playing' && !g.weapons.reloading && g.player.hp > 0, dead, state: g.state, reloading: g.weapons.reloading, mag: a.mag };
  });

  await run('doubleExit', () => {
    const { g, step } = window.__S;
    g.startEndless(31337);
    const room = g.level.current;
    g.chooseExit(0); g.chooseExit(0);
    if (room.routes.length > 1) g.chooseExit(1);
    step(2);
    const built = g.level.rooms.length;
    return { ok: built === 2 && room.chosenExit === 0 && !!g.level.next, built, chosen: room.chosenExit };
  });

  await run('quitMidDoor', () => {
    const { g, step, drive, click } = window.__S;
    g.startEndless(2024);
    drive(() => g.level.current.index === 1 && g.level.current.state === 'cleared', 60 * 60);
    drive(() => !!g.level.next, 60 * 30); // walk into a door: the next room is built and open
    const hadNext = !!g.level.next;
    g.input.pressed.pause = true; step();
    const quit = click('quit');
    step(5);
    const atTitle = g.state === 'menu' && g.menus.current === 'title';
    g.startEndless(2025);
    step(30);
    return { ok: hadNext && quit && atTitle && g.level.rooms.length === 1 && g.enemies.list.length === 0 && g.state === 'playing' && !g.lastError, hadNext, quit, atTitle, rooms: g.level.rooms.length, enemies: g.enemies.list.length };
  });

  await run('bossDeath', () => {
    const { g, step, drive, click, info } = window.__S;
    g.profile.v.tutorialDone = true;
    g.newCampaign(0, true);
    const reached = drive(() => g.level.current.index === 8 && g.level.current.state === 'combat' && g.state === 'playing' && g.bosses.active && g.bosses.active.alive, 60 * 600);
    const boss0 = g.bosses.active && g.bosses.active.type;
    g.player.damage(99999, null, 'TEST', '');
    for (let i = 0; i < 200 && g.state !== 'dead'; i++) step();
    const died = g.state === 'dead';
    const retry = click('retryCheckpoint');
    step(5);
    const back = info();
    const room = g.level.current;
    const bossRoute = room.routes && room.routes[0] && room.routes[0].type;
    // walk into the boss door again: the same boss must be there, at full health
    const again = drive(() => g.level.current.index === 8 && g.bosses.active && g.bosses.active.alive, 60 * 60);
    const b = g.bosses.active;
    return { ok: reached && died && retry && back.room === 7 && back.arch === 'checkpoint' && back.roomState === 'cleared' && bossRoute === 'boss' && again && b.type === boss0 && b.hp >= b.maxHp * 0.99, reached, died, retry, back, bossRoute, again, boss: b && { type: b.type, hp: Math.round(b.hp), max: Math.round(b.maxHp) } };
  });

  await run('practice', () => {
    const { g, step, drive, click, info } = window.__S;
    const save0 = JSON.stringify(g.profile.v.save || null);
    g.startPractice('3-2');
    const cp = drive(() => g.level.current.index === 4 && g.level.current.state === 'cleared' && g.state === 'playing', 60 * 400);
    g.player.damage(99999, null, 'TEST', '');
    for (let i = 0; i < 200 && g.state !== 'dead'; i++) step();
    const retry = click('retryCheckpoint');
    step(5);
    const back = info();
    const save1 = JSON.stringify(g.profile.v.save || null);
    return { ok: cp && retry && back.room === 4 && back.arch === 'checkpoint' && g.campaign.practice && save0 === save1, cp, retry, back, practice: g.campaign.practice, saveUntouched: save0 === save1 };
  });

  await run('touchAim', async () => {
    const { g, step, click, pauseKey } = window.__S;
    g.startEndless(11);
    step(5);
    g.input.touchAim = true; step(20);
    const aimed = g.input.aiming;
    await pauseKey();
    const relPause = !g.input.aiming && !g.input.touchAim;
    click('resume'); step(5);
    g.input.touchAim = true; step(5);
    g.player.damage(99999, null, 'TEST', '');
    step(2);
    const relDeath = !g.input.aiming;
    return { ok: aimed && relPause && relDeath, aimed, relPause, relDeath };
  });

  // the last machine of a fight gets wedged somewhere nobody can reach (under the floor, AI stuck):
  // after half a minute without damage the director brings it back onto open floor, and the
  // room clears once it dies
  await run('stallNet', () => {
    const { g, step } = window.__S;
    g.startEndless(4545);
    g.debug.god(true);
    g.chooseExit(0);
    step(10);
    const nx = g.level.next;
    g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
    for (let i = 0; i < 300 && !(g.level.current === nx && nx.state === 'combat'); i++) step();
    const d = g.director;
    for (let i = 0; i < 60 * 60 && d.waveIdx < d.waves.length; i++) { if (i % 20 === 0) { g.debug.killAll(); d.waveT = -99; } step(); }
    for (let i = 0; i < 120 && g.enemies.aliveCount === 0; i++) step();
    const victim = g.enemies.list.find((e) => e.alive && !e.flying && e.body);
    if (!victim) return { ok: false, why: 'no ground enemy in the last wave', alive: g.enemies.aliveCount };
    for (const e of g.enemies.list) if (e !== victim && e.alive) g.combat.damageEnemy(e, 1e7, { source: 'hazard', fromPlayer: false });
    victim.update = () => {}; // its AI is stuck for good
    victim.pos.set(nx.origin.x, -4, nx.origin.z); // below the floor slab, above the void net
    let back = -1;
    for (let i = 0; i < 60 * 45 && back < 0; i++) { step(); if (victim.pos.y > -0.5) back = i; }
    const room = g.level.current, k = room.nav.nearestFree(victim.pos.x, victim.pos.z, 2);
    room.nav.flow(g.player.body.pos.x, g.player.body.pos.z);
    const reachable = k >= 0 && room.nav.dist[k] >= 0;
    g.combat.damageEnemy(victim, 1e7, { source: 'hazard', fromPlayer: false });
    for (let i = 0; i < 180 && room.state !== 'cleared'; i++) step();
    g.debug.god(false);
    return { ok: back > 60 * 25 && reachable && room.state === 'cleared', backAfterS: Math.round(back / 60), reachable, state: room.state };
  });

  // NG+: linger in a fight and THE WARDEN comes; the room holds until it is down, then clears
  await run('warden', () => {
    const { g, step, drive } = window.__S;
    g.profile.v.tutorialDone = true;
    g.newCampaign(1, true);
    const inRoom = drive(() => g.level.current.index === 1 && g.level.current.state === 'combat' && g.state === 'playing', 60 * 120);
    g.debug.god(true);
    const room = g.level.current;
    let f = 0;
    for (; f < 60 * 90 && !g.director.warden; f++) step();
    const w = g.director.warden;
    const at = Math.round(f / 60);
    // everything else dies: the room must still wait for the Warden
    for (let i = 0; i < 60 * 30; i++) { if (i % 20 === 0) { for (const e of g.enemies.list) if (e.alive && e !== w) g.combat.damageEnemy(e, 1e7, { source: 'hazard', fromPlayer: false }); g.director.waveT = -99; } step(); }
    const held = room.state === 'combat' && !!w && w.alive;
    if (w) g.combat.damageEnemy(w, 1e7, { source: 'hazard', fromPlayer: false });
    for (let i = 0; i < 240 && room.state !== 'cleared'; i++) step();
    g.debug.god(false);
    return { ok: inRoom && !!w && at >= 69 && held && room.state === 'cleared', inRoom, warden: !!w, at, held, state: room.state };
  });

  // SAVE & QUIT on a results screen after a rough boss fight, then CONTINUE: the next level must
  // start at full health (the save carried the leftover HP), and so must RESTART LEVEL after it
  await run('continueHp', () => {
    const { g, step, click } = window.__S;
    g.profile.v.tutorialDone = true;
    g.newCampaign(0, true);
    step(5);
    g.player.hp = 17;
    g.completeLevel();
    const res = g.state === 'results';
    const quit = click('quit');
    step(2);
    const cont = click('continue');
    step(5);
    const max = g.player.stats.maxHp, hp1 = g.player.hp, lvl = g.campaign.levelIdx;
    g.player.damage(99999, null, 'TEST', '');
    for (let i = 0; i < 200 && g.state !== 'dead'; i++) step();
    const rl = click('retryLevel');
    step(5);
    const hp2 = g.player.hp;
    return { ok: res && quit && cont && lvl === 1 && hp1 === max && rl && hp2 === max, res, quit, cont, lvl, hp1, hp2, max };
  });

  // finale: final level from a real campaign save, real breaker pull, credits -> NG+
  await run('finale', () => {
    const { g, step, drive, click, walkTo, release } = window.__S;
    g.profile.v.tutorialDone = true;
    g.newCampaign(0, true);
    g.weapons.give('lance');
    const last = g.campaign.plan.length - 1;
    g.debug.goLevel(last);
    const fight = drive(() => g.bosses.active && g.bosses.active.final && g.state === 'playing' && g.level.current.state === 'combat', 60 * 120);
    // break it: the ending cutscene, then PULL THE BREAKER
    const fallen = drive(() => !!g.breaker && g.state === 'playing', 60 * 300);
    let f = 0;
    for (; f < 60 * 60 && g.breaker && !g.breaker.pulled; f++) {
      release();
      const b = g.breaker;
      walkTo(b.pos.x, b.pos.z);
      if (Math.hypot(b.pos.x - g.player.body.pos.x, b.pos.z - g.player.body.pos.z) < 2.2) { g.input.held.fwd = false; g.input.pressed.use = true; }
      step();
    }
    const pulled = !!(g.breaker && g.breaker.pulled) || g.state === 'cutscene';
    for (let i = 0; i < 60 * 60 && g.state === 'cutscene'; i++) { g.input.held.jump = true; step(); }
    release();
    const results = g.state === 'results';
    g.input.pressed.confirm = true; step();
    const credits = g.state === 'credits';
    const skipped = click('skipCredits');
    step(2);
    const ngMenu = g.menus.current;
    const carried = g.weapons.owned.slice();
    const begin = click('beginCycle');
    step(10);
    return {
      ok: fight && fallen && pulled && results && credits && skipped && ngMenu === 'ngplus' && begin && g.mode === 'campaign' && g.campaign.cycle === 1 && g.state === 'playing' && g.weapons.owned.includes('lance'),
      fight, fallen, pulled, results, credits, ngMenu, begin, cycle: g.campaign.cycle, state: g.state, carried, owned: g.weapons.owned,
    };
  });

  await run('resize', async () => {
    const { g, step } = window.__S;
    g.startEndless(808);
    step(10);
    return { ok: true, state: g.state };
  });
  for (const [w, h] of [[844, 390], [390, 844], [1280, 720]]) { await page.setViewportSize({ width: w, height: h }); await page.evaluate(() => window.__S.step(20)); }
  const after = await page.evaluate(() => ({ state: window.__vg.state, err: window.__vg.lastError, w: window.__vg.renderer.width }));
  results.resize = { ok: after.state === 'playing' && !after.err, ...after };
  console.log((results.resize.ok ? 'ok   ' : 'FAIL ') + 'resize       ' + JSON.stringify(after));

  const failed = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => k);
  if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 8)); process.exitCode = 1; }
  if (failed.length) { console.log('STATE MACHINE FAILURES:', failed.join(', ')); process.exitCode = 1; } else console.log('STATE MACHINE OK');
} finally {
  await browser.close();
  server.kill();
}
