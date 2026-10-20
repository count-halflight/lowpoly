// Real-input check of the whole training deck. Every station is solved only by injecting key
// states, mouse aim (yaw/pitch) and trigger presses into the input system, one fixed 60 Hz game
// step at a time (no teleports, no debug kills), so it is deterministic even on slow headless
// renderers. Covers:
//  - each of the 10 stations on its own,
//  - one continuous playthrough (NEW DESCENT -> all 10 stations through the real doors ->
//    TRAINING COMPLETE -> BEGIN THE DESCENT),
//  - adversarial orders: destroy the dummy before the coin trick, cycle the Hammer to its
//    coinless variant, kill the parry dummy first, die in a station and retry from the death
//    screen, pause/resume mid-station, read the terminal, skip training (both entry points).
// Any objective that can become impossible fails here.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4175', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// shared in-page helpers + per-station solvers (installed once as window.__T)
function install() {
  const g = window.__vg;
  g.frame = () => {}; // stop the RAF loop: we step the game ourselves
  g.render = () => {};
  const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
  const loc = () => { const r = g.level.current, p = g.player.body.pos; return { x: p.x - r.origin.x, y: p.y, z: p.z - r.origin.z }; };
  const aimAt = (q) => { const c = g.camera.position, dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  const apply = (k) => {
    k = k || {};
    for (const a of KEYS) g.input.held[a] = !!(k.hold && k.hold.includes(a));
    if (k.press) for (const a of k.press) g.input.pressed[a] = true;
  };
  const release = () => { for (const a of KEYS) g.input.held[a] = false; g.input.fire = false; };
  // shoot the nearest live target with fresh trigger presses (semi-auto safe)
  const shootNearest = (f, list, head = true) => {
    let best = null, bd = 1e9;
    for (const e of list) { if (!e.alive || !e.targetable) continue; const d = e.pos.distanceTo(g.player.body.pos); if (d < bd) { bd = d; best = e; } }
    if (!best) { g.input.fire = false; return null; }
    aimAt(head ? best.headPos() : best.centerPos());
    g.input.fire = true;
    if (f % 6 === 0) g.input.firePressed = true;
    return best;
  };
  // flip coins with the Hammer and shoot each one out of the air
  const coinTrick = (f, m) => {
    const coin = g.weapons.coins.find((c) => c.alive);
    if (!coin && f - (m.flip || 0) > 50) { m.flip = f; g.player.yaw = 0; g.player.pitch = 0.2; return { press: ['altTap'] }; }
    if (coin && coin.vel.y < 1.5) { aimAt(coin.pos); g.input.fire = true; g.input.firePressed = true; return {}; }
    g.input.fire = false;
    return {};
  };
  const SOLVE = {
    0: () => ({ hold: ['fwd'] }),
    1: (f) => { if (f >= 20) shootNearest(f, g.tutorial.dummies); return {}; },
    // the deck hands over the Breacher on entry: switch back to the Hammer, then the coin trick
    2: (f, p, pl, m) => { if (f === 30) g.input.slot = 0; return f < 70 ? {} : coinTrick(f, m); },
    3: (f, p, pl, m) => {
      if (p.z < 3.3 && !m.j) { m.j = f; return { hold: ['fwd'], press: ['jump'] }; }
      if (m.j && f === m.j + 12) return { hold: ['fwd'], press: ['dash'] };
      return { hold: ['fwd'] };
    },
    4: (f) => ({ hold: f > 25 ? ['fwd', 'slide'] : ['fwd'] }),
    // walk into the chimney (around the north end of its wall), jump, then wall-jump near the apex
    5: (f, p, pl, m) => {
      if (!m.in) {
        if (p.x < 6.5) return { hold: p.z < 5.2 && p.x < 5.6 ? ['back', 'right'] : ['right'] };
        if (p.z > 0.6) return { hold: ['fwd'] };
        m.in = f;
        return { hold: ['fwd', 'right'], press: ['jump'] };
      }
      const b = pl.body;
      if (!b.grounded && pl.wallContactT > 0 && b.vel.y < 2 && pl.wallJumps < 3 && f - (m.last || 0) > 8) { m.last = f; return { hold: ['fwd', 'right'], press: ['jump'] }; }
      if (b.grounded && f - m.in > 20 && p.y < 0.5 && p.z > -0.5) { m.in = f; return { hold: ['fwd', 'right'], press: ['jump'] }; }
      return { hold: p.y > 3.0 ? ['fwd'] : ['fwd', 'right'] };
    },
    // hold jump to bunny hop, then dash for the speed burst
    6: (f, p, pl, m) => {
      const hops = g.tutorial.counts.bhop || 0;
      if (f < 20) return { hold: ['fwd'] };
      if (hops >= 4 && !m.d) { m.d = 1; return { hold: ['fwd', 'jump'], press: ['dash'] }; }
      return { hold: ['fwd', 'jump'], press: f === 20 ? ['jump'] : [] };
    },
    // wait for an orb, face it and parry it when it is close
    7: (f, p, pl, m) => {
      const eye = g.camera.position;
      let orb = null, od = 1e9;
      for (const pr of g.projectiles.list) { if (!pr.active || pr.friendly || !pr.parryable) continue; const d = pr.pos.distanceTo(eye); if (d < od) { od = d; orb = pr; } }
      if (orb) { aimAt(orb.pos); if (od < 2.4 && f - (m.last || 0) > 30) { m.last = f; return { press: ['punch'] }; } return {}; }
      const d = g.tutorial.dummies.find((e) => e.alive);
      if (d) aimAt(d.centerPos());
      return {};
    },
    // fire the hook twice, then run over the launch pad onto the ledge
    8: (f, p, pl, m) => {
      if (f === 2 || f === 80) { g.player.yaw = 0; g.player.pitch = 0; return { press: ['hook'] }; }
      if (f < 100) return {};
      g.player.yaw = 0; g.player.pitch = 0;
      // the hook may have pulled us past the pad: back up for a run-up
      if (!(g.tutorial.counts.pad > 0)) { if (p.z > 6.5) m.run = 1; if (!m.run) return { hold: ['back'] }; }
      return { hold: ['fwd'] };
    },
    // everything at once with the Ripsaw: strafe, dash and shoot the nearest
    9: (f) => {
      if (f === 5) g.input.slot = 1;
      if (f < 30) return {};
      const t = shootNearest(f, g.enemies.list, false);
      const side = (f / 50 | 0) % 2 ? 'left' : 'right';
      if (f % 90 === 0) return { hold: [side], press: ['dash'] };
      return { hold: t && t.pos.distanceTo(g.player.body.pos) > 12 ? ['fwd', side] : [side] };
    },
  };
  // walk toward a world point through the room's flow field
  const walkTo = (x, z, f) => {
    const pp = g.player.body.pos, room = g.level.current;
    let tx = x, tz = z;
    if (room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z)) { room.nav.flow(x, z); const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 }); if (s && Math.hypot(x - pp.x, z - pp.z) > 2) { tx = s.x; tz = s.z; } }
    g.player.yaw = Math.atan2(-(tx - pp.x), -(tz - pp.z)); g.player.pitch = 0;
    return { hold: ['fwd'], press: (f % 90) < 2 ? ['jump'] : [] };
  };
  const result = (extra = {}) => {
    const l = loc();
    return { done: g.tutorial.done, obj: g.tutorial.objective, x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2), hp: Math.round(g.player.hp), state: g.state, ...extra };
  };
  // start a station and solve it with fn (defaults to the station's solver)
  function solve(station, maxFrames, fn = SOLVE[station], opts = {}) {
    if (!opts.keep) g.startTutorial(false, station);
    g.player.yaw = 0; g.player.pitch = 0;
    const mem = {};
    let f = 0;
    for (; f < maxFrames && !g.tutorial.done; f++) {
      apply(fn(f, loc(), g.player, mem));
      g.tick(1 / 60, 1 / 60);
      if (g.state !== 'playing' && !opts.anyState) break;
    }
    release();
    return result({ frames: f });
  }
  const step = (n = 1) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
  const click = (a) => { const b = [...document.querySelectorAll('[data-a="' + a + '"]')].find((x) => x.offsetParent !== null); if (!b) return false; b.click(); return true; };
  window.__T = { g, loc, aimAt, apply, release, SOLVE, solve, walkTo, coinTrick, shootNearest, result, step, click };
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.evaluate(install);
  const results = {};
  const run = async (name, fn) => {
    try { results[name] = await page.evaluate(fn); } catch (e) { results[name] = { done: false, error: e.message.slice(0, 400) }; }
    console.log(name.padEnd(14), JSON.stringify(results[name]));
  };

  // ---- every station on its own
  const LIMIT = [600, 1200, 1500, 600, 600, 1500, 1500, 3600, 1200, 3600];
  for (let s = 0; s < 10; s++) await run('station' + s, `window.__T.solve(${s}, ${LIMIT[s]})`);

  // ---- adversarial orders
  // 2: destroy the dummy first (the old soft-lock: no target left for the ricochet), then the coin trick
  await run('coinNoTarget', () => {
    const { g, solve, aimAt, coinTrick } = window.__T;
    const r = solve(2, 1500, (f, p, pl, m) => {
      if (f === 30) g.input.slot = 0;
      if (f < 70) return {};
      const dummy = g.tutorial.dummies.find((e) => e.alive);
      if (!m.killed) {
        if (dummy) { aimAt(dummy.headPos()); g.input.fire = true; if (f % 8 === 0) g.input.firePressed = true; return {}; }
        m.killed = f; g.input.fire = false;
      }
      return coinTrick(f, m);
    });
    r.coinHits = g.tutorial.counts.coinhit || 0;
    return r;
  });
  // 2: press the Hammer's key while holding it (cycles to the coinless PIERCER); the objective must
  // say how to get the coin back, and pressing it again must still finish the station
  await run('coinVariant', () => {
    const { g, solve, coinTrick } = window.__T;
    let saw = '';
    const r = solve(2, 1800, (f, p, pl, m) => {
      if (f === 30) g.input.slot = 0; // to the Hammer
      if (f === 70) g.input.slot = 0; // again: PIERCER
      if (f > 75 && f < 200) { if (f === 120) saw = g.tutorial.objective; return f % 60 === 0 ? { press: ['altTap'] } : {}; }
      if (f === 200) g.input.slot = 0; // back to MARKSMAN, as the objective says
      if (f < 240) return {};
      return coinTrick(f, m);
    });
    r.sawHint = saw;
    r.hintOk = /MARKSMAN/.test(saw);
    r.done = r.done && r.hintOk;
    return r;
  });
  // 7: the wrong idea first: shoot the parry dummy (it is far too tough to kill) and eat some
  // orbs, then parry as taught
  await run('parryAfterShooting', () => {
    const { g, solve, SOLVE, shootNearest } = window.__T;
    const r = solve(7, 4800, (f, p, pl, m) => {
      if (f < 600) { shootNearest(f, g.tutorial.dummies); return {}; }
      g.input.fire = false;
      return SOLVE[7](f, p, pl, m);
    });
    r.parries = g.tutorial.counts.parry || 0;
    return r;
  });
  // 2 in the real flow: entering from station 1 hands over the Breacher (an automatic switch);
  // that must not tick SWITCH WEAPONS off on its own
  await run('arsenalEntry', () => {
    const { g, step, walkTo, apply, release, SOLVE, loc } = window.__T;
    g.startTutorial(false, 1);
    for (let f = 0; f < 1200 && !g.tutorial.done; f++) { apply(SOLVE[1](f, loc(), g.player, {})); step(); }
    release();
    let f = 0;
    for (; f < 1200 && g.tutorial.station === 1; f++) {
      const room = g.level.current, nx = g.level.next;
      apply(nx ? walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3), f) : walkTo(room.wx(room.exitDoors[0].x), room.wz(room.exitDoors[0].z) + 1.5, f));
      step();
    }
    release();
    step(30);
    const obj = g.tutorial.objective;
    return { done: g.tutorial.station === 2 && obj === 'SWITCH WEAPONS', obj, station: g.tutorial.station, holding: g.weapons.current };
  });
  // 3: stand in the slag until death, retry from the death screen (real button), then solve
  await run('dieAndRetry', () => {
    const { g, solve, step, click, SOLVE } = window.__T;
    g.startTutorial(false, 3);
    g.player.yaw = 0;
    let f = 0;
    for (; f < 60 * 30 && g.state === 'playing'; f++) {
      const z = g.player.body.pos.z - g.level.current.origin.z;
      g.input.held.fwd = z > 0.5; g.input.held.back = z < -0.5;
      step();
    }
    g.input.held.fwd = g.input.held.back = false;
    for (let i = 0; i < 120 && g.state !== 'dead'; i++) step();
    const died = g.state === 'dead';
    const clicked = click('retryLevel');
    step(5);
    const back = g.state === 'playing' && g.tutorial.station === 3 && !g.tutorial.done;
    const r = solve(3, 600, SOLVE[3], { keep: true });
    r.died = died; r.clicked = clicked; r.back = back;
    r.done = r.done && died && clicked && back;
    return r;
  });
  // 6: pause mid-station (real ESC), resume with the real button, and the progress must persist
  await run('pauseResume', () => {
    const { g, solve, step, click, SOLVE } = window.__T;
    const info = {};
    const r = solve(6, 1500, (f, p, pl, m) => {
      if (f === 90) {
        const hops = g.tutorial.counts.bhop || 0;
        g.input.pressed.pause = true; step();
        info.paused = g.state === 'paused' && g.menus.current === 'pause';
        step(30); // the world must stay frozen while paused
        info.clicked = click('resume');
        info.resumed = g.state === 'playing' && (g.tutorial.counts.bhop || 0) === hops;
      }
      return SOLVE[6](f, p, pl, m);
    });
    Object.assign(r, info);
    r.done = r.done && !!info.paused && !!info.resumed;
    return r;
  });
  // 0: walk to the green terminal, read it with USE, close it with USE, then finish the station
  await run('terminal', () => {
    const { g, solve, step, walkTo, apply } = window.__T;
    g.startTutorial(false, 0);
    const t = g.level.current.terminals[0];
    let f = 0;
    for (; f < 900 && !g.nearestTerminal(); f++) { apply(walkTo(t.pos.x, t.pos.z, f)); step(); }
    apply({});
    g.input.pressed.use = true; step();
    const opened = g.state === 'terminal';
    step(20);
    g.input.pressed.use = true; step();
    const closed = g.state === 'playing';
    const r = solve(0, 600, () => ({ hold: ['back'] }), { keep: true });
    r.opened = opened; r.closed = closed;
    r.done = r.done && opened && closed;
    return r;
  });
  // SKIP TRAINING from the pause menu: from NEW DESCENT it goes straight into level 1-1;
  // from the TRAINING menu entry it ends on the training-complete screen
  // (the pause key ignores presses within 350 ms of the last pause: wait that out in real time)
  await run('skipFromDescent', async () => {
    const { g, step, click } = window.__T;
    g.profile.v.tutorialDone = false;
    g.newCampaign(0);
    const inTraining = g.mode === 'tutorial';
    step(10);
    await new Promise((r) => setTimeout(r, 400));
    g.input.pressed.pause = true; step();
    const clicked = click('skipTraining');
    step(10);
    const camp = g.mode === 'campaign' && g.campaign.active;
    return { done: inTraining && clicked && camp && g.state === 'playing' && g.campaign.levelIdx === 0 && g.profile.v.tutorialDone, mode: g.mode, state: g.state, level: camp ? g.campaign.level.id : null };
  });
  await run('skipFromMenu', async () => {
    const { g, step, click } = window.__T;
    g.startTutorial(false, 4);
    step(10);
    await new Promise((r) => setTimeout(r, 400));
    g.input.pressed.pause = true; step();
    const clicked = click('skipTraining');
    step(5);
    const menu = g.menus.current;
    const begin = click('beginDescent');
    step(10);
    return { done: clicked && menu === 'tutdone' && begin && g.mode === 'campaign' && g.state === 'playing', menu, mode: g.mode, state: g.state };
  });

  // ---- one continuous playthrough through the real doors, then BEGIN THE DESCENT
  await run('fullDeck', () => {
    const { g, SOLVE, loc, apply, release, walkTo, step, click } = window.__T;
    g.profile.v.tutorialDone = false;
    g.newCampaign(0);
    const log = [];
    let station = -1, sf = 0, mem = {}, f = 0, stuck = null;
    for (; f < 60 * 60 * 6; f++) {
      if (g.state !== 'playing') break;
      if (g.tutorial.station !== station) { station = g.tutorial.station; sf = 0; mem = {}; g.player.yaw = 0; g.player.pitch = 0; log.push(station + '@' + Math.round(f / 60)); }
      let k;
      if (!g.tutorial.done) k = SOLVE[station](sf, loc(), g.player, mem);
      else {
        g.input.fire = false;
        const room = g.level.current, nx = g.level.next;
        if (nx) k = walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3), f);
        else { const d = room.exitDoors[0]; k = walkTo(room.wx(d.x), room.wz(d.z) + 1.5, f); }
      }
      apply(k);
      step();
      if (++sf > 60 * 60) { stuck = 'station ' + station + ': ' + g.tutorial.objective; break; }
    }
    release();
    const end = { state: g.state, menu: g.menus.current, graduated: g.profile.v.tutorialDone };
    const begin = click('beginDescent');
    step(30);
    const ok = !stuck && end.menu === 'tutdone' && end.graduated && begin && g.mode === 'campaign' && g.state === 'playing';
    return { done: ok, stations: log.join(' '), stuck, end, after: { mode: g.mode, state: g.state, level: g.campaign.level && g.campaign.level.id }, seconds: Math.round(f / 60), err: g.lastError };
  });

  const failed = Object.entries(results).filter(([, v]) => !v.done).map(([k]) => k);
  if (errors.length) { console.log('ERRORS', errors); process.exitCode = 1; }
  if (failed.length) { console.log('NOT SOLVED WITH REAL INPUT:', failed.join(', ')); process.exitCode = 1; } else console.log('ALL TRAINING STATIONS + ADVERSARIAL ORDERS SOLVED WITH REAL INPUT');
} finally {
  await browser.close();
  server.kill();
}
