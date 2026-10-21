// Real-input campaign bot. Plays with injected inputs only: mouse aim (yaw/pitch), fresh trigger
// presses, strafing, dashes, jumps, punches/parries, weapon keys, USE, and walks to caches and
// doors through the room NavGrid. God mode stays OFF; health is topped up when it runs low so a
// weak bot still sees every room. Scenarios (env, defaults in brackets):
//   LEVELS [3]   campaign levels from a new game (minibosses, both checkpoints, the boss)
//   NG [1]       NG+ levels (mirrored rooms, corrupted enemies, the Warden)
//   ENDLESS [6]  endless rooms (a boss every 5)
//   ROUTES [1]   one room of every endless route type (combat, hazard, elite, cache, survival,
//                boss), shallow and deep
// Fails on: a room whose fight stops making progress or that never clears once empty, a cleared
// room whose door the bot cannot get through, falling out of the world, being stuck inside
// geometry, any page error or caught game error.
//   PORT=4430 node tests/bot-campaign.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4182', 10);
const LEVELS = parseInt(process.env.LEVELS || '3', 10);
const NG = parseInt(process.env.NG || '1', 10);
const ENDLESS = parseInt(process.env.ENDLESS || '6', 10);
const ROUTES = parseInt(process.env.ROUTES || '1', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

function install() {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
  const DT = 1 / 60;
  const B = { f: 0, issues: [], warns: [], log: [], levels: 0, rooms: 0, tmp: g.camera.position.clone() };
  const eye = () => g.camera.position;
  const aimAt = (q) => { const c = eye(), dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(dy, Math.hypot(dx, dz)))); };
  const lookFlat = (x, z) => { const p = g.player.body.pos; g.player.yaw = Math.atan2(-(x - p.x), -(z - p.z)); g.player.pitch = 0; };
  const local = () => { const r = g.level.current, p = g.player.body.pos; return [+(p.x - r.origin.x).toFixed(1), +p.y.toFixed(1), +(p.z - r.origin.z).toFixed(1)]; };
  const where = () => (g.mode === 'campaign' ? 'L' + g.campaign.levelIdx + (g.campaign.cycle ? '+' + g.campaign.cycle : '') : 'E') + ':' + (g.level.current ? g.level.current.index : '-');
  const issue = (kind, extra = {}) => { const r = g.level.current; B.issues.push({ kind, at: where(), arch: r && r.spec.arch, route: r && r.route && r.route.type, t: Math.round(B.f / 60), pos: r ? local() : null, ...extra }); };
  const hold = (...a) => { for (const k of a) g.input.held[k] = true; };

  // ---- walking: flow field inside a room, straight lines through corridors; hop when blocked
  B.navStep = (x, z) => {
    const pp = g.player.body.pos, room = g.level.current;
    if (room && room.nav && room.containsXZ(x, z) && room.containsXZ(pp.x, pp.z) && Math.hypot(x - pp.x, z - pp.z) > 2) {
      room.nav.flow(x, z);
      const s = room.nav.step(pp.x, pp.z, { x: 0, z: 0 });
      if (s) return s;
    }
    return { x, z };
  };
  B.unstick = () => {
    const pp = g.player.body.pos;
    const moved = Math.hypot(pp.x - (B.lastX ?? pp.x), pp.z - (B.lastZ ?? pp.z));
    B.lastX = pp.x; B.lastZ = pp.z;
    B.slowT = moved < 0.02 ? (B.slowT || 0) + DT : 0;
    if (B.slowT > 0.6 && g.player.body.grounded) { g.input.pressed.jump = true; if (B.slowT > 1.5) hold(B.f % 120 < 60 ? 'left' : 'right'); }
  };
  // look where we walk (navigation between fights)
  B.walkTo = (x, z) => {
    const pp = g.player.body.pos, s = B.navStep(x, z);
    lookFlat(s.x, s.z);
    if (Math.hypot(x - pp.x, z - pp.z) > 0.4) hold('fwd');
    B.unstick();
  };
  // move toward a point with WASD while the mouse aims elsewhere
  B.moveToward = (x, z) => {
    const pp = g.player.body.pos, s = B.navStep(x, z);
    let dx = s.x - pp.x, dz = s.z - pp.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const y = g.player.yaw, a = dx * -Math.sin(y) + dz * -Math.cos(y), b = dx * Math.cos(y) + dz * -Math.sin(y);
    if (a > 0.38) hold('fwd'); else if (a < -0.38) hold('back');
    if (b > 0.38) hold('right'); else if (b < -0.38) hold('left');
    B.unstick();
  };

  // ---- fighting
  const hostileOrb = () => {
    let best = null, bd = 1e9;
    const e = eye();
    for (const p of g.projectiles.list) {
      if (!p.active || p.friendly || !p.parryable) continue;
      const d = p.pos.distanceTo(e);
      if (d < bd) { bd = d; best = p; }
    }
    return best && { p: best, d: bd };
  };
  const bossPoint = (b) => {
    const hbs = b.hitboxes() || [];
    const hb = hbs.find((h) => h.weak && !h.shielded) || hbs.find((h) => !h.shielded) || hbs[0];
    return hb ? B.tmp.set(hb.x, hb.y, hb.z) : b.pos;
  };
  const ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc']; // number keys 1-6
  B.pickWeapon = () => {
    const w = g.weapons;
    const usable = w.owned.filter((id) => { const a = w.ammo[id]; return a.mag > 0 || a.reserve > 0; });
    const id = usable[Math.floor(Math.random() * usable.length)] || 'hammer';
    if (id !== w.current && !w.switchTo) g.input.slot = ORDER.indexOf(id);
  };
  B.fight = (room) => {
    const pp = g.player.body.pos;
    // parry anything parryable that is about to hit
    const orb = hostileOrb();
    const b = g.bosses.active;
    if (orb && orb.d < 2.6 && B.f - (B.parryF || 0) > 26) {
      // a parried shot flies where the crosshair points: send it at the boss when the orb is in
      // the parry cone that way (shielded bosses only break to their own reflected shots)
      const e = eye(), op = orb.p.pos;
      let aimP = op;
      if (b && b.alive) {
        const bp = bossPoint(b), ox = op.x - e.x, oy = op.y - e.y, oz = op.z - e.z, bx = bp.x - e.x, by = bp.y - e.y, bz = bp.z - e.z;
        const cos = (ox * bx + oy * by + oz * bz) / ((Math.hypot(ox, oy, oz) * Math.hypot(bx, by, bz)) || 1);
        if (cos > 0.55 || orb.d < 0.5) aimP = bp;
      }
      aimAt(aimP); g.input.pressed.punch = true; B.parryF = B.f; return;
    }
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) { if (!e.alive || !e.targetable) continue; const d = e.pos.distanceTo(pp); if (d < bd) { bd = d; best = e; } }
    const bossUp = b && b.alive && b.state !== 'dead';
    let point = null, dist = 0, tgt = null;
    if (bossUp && (!best || b.shieldUp || (B.f / 240 | 0) % 2 === 0)) { point = bossPoint(b); tgt = b; }
    else if (best) { point = (B.f / 90 | 0) % 3 === 0 && !best.flying ? best.headPos() : best.centerPos(); tgt = best; }
    if (point) {
      aimAt(point);
      dist = Math.hypot(point.x - pp.x, point.z - pp.z);
      g.input.fire = true;
      if (B.f % 6 === 0) g.input.firePressed = true;
      if (dist < 3 && B.f % 30 === 0) g.input.pressed.punch = true;
    }
    // weapon variety, reload when dry
    const w = g.weapons, a = w.ammo[w.current];
    if (B.f % 480 === 0 || (a.mag <= 0 && a.reserve <= 0)) B.pickWeapon();
    else if (a.mag <= 0 && !w.reloading && B.f % 20 === 0) g.input.pressed.reload = true;
    // movement: strafe, close in or back off, hop and dash now and then
    const side = (B.f / 70 | 0) % 2 ? 'left' : 'right';
    hold(side);
    if (tgt && !g.combat.losClear(eye(), point)) {
      // no line of sight: walk toward the target through the flow field instead
      g.input.held[side] = false;
      B.moveToward(tgt.pos.x, tgt.pos.z);
    } else if (dist > 14) hold('fwd');
    else if (dist && dist < 4) hold('back');
    if (B.f % 150 === 0) g.input.pressed.jump = true;
    if (B.f % 200 === 100) g.input.pressed.dash = true;
  };

  // ---- one frame of bot decisions + one game tick
  B.frame = () => {
    if (B.stopAtRoom && g.mode === 'endless' && g.level.current.index >= B.stopAtRoom && g.level.current.state === 'cleared') { B.done = true; return; }
    for (const k of KEYS) g.input.held[k] = false;
    g.input.fire = false;
    const st = g.state;
    if (st === 'reward') g.input.slot = 0; // key 1 takes the first card
    else if (st === 'terminal') g.input.pressed.use = true;
    else if (st === 'cutscene') hold('jump'); // hold to skip
    else if (st === 'dead') {
      if (!B.deadSeen) { B.deadSeen = true; issue('DIED', { cause: g.player.lastDamage && g.player.lastDamage.cause }); }
      const btn = [...document.querySelectorAll('[data-a="retryCheckpoint"],[data-a="retryLevel"],[data-a="restart"]')].find((x) => x.offsetParent !== null);
      if (btn) btn.click();
    } else if (st === 'paused') g.resume();
    else if (st === 'results') {
      B.levels++;
      B.log.push('RESULTS ' + g.campaign.level.id + ' t=' + Math.round(B.f / 60));
      if (B.stopAtResults && B.levels >= B.stopAtResults) { B.done = true; return; }
      g.input.pressed.confirm = true;
    } else if (st === 'playing') {
      B.deadSeen = false;
      const room = g.level.current;
      const pl = g.player;
      if (pl.hp < pl.stats.maxHp * 0.5) pl.hp = pl.stats.maxHp; // top-up (god mode stays off)
      if (room.state === 'combat') B.fight(room);
      else {
        // claim the cache, then walk into a door and on through the corridor
        const cache = g.pickups.list.find((p) => p.kind === 'cache' && room.containsXZ(p.pos.x, p.pos.z));
        const nx = g.level.next;
        if (cache) B.walkTo(cache.pos.x, cache.pos.z);
        else if (nx) B.walkTo(nx.wx(nx.spec.entX), nx.wz(nx.D / 2 - 3));
        else if (room.routes && room.routes.length) {
          const k = Math.min(room.routes.length - 1, B.routeK || 0);
          const d = room.exitDoors[k];
          B.walkTo(room.wx(d.x), room.wz(d.z) + 1.2);
        } else if (g.breaker && !g.breaker.pulled) {
          B.walkTo(g.breaker.pos.x, g.breaker.pos.z);
          if (Math.hypot(g.breaker.pos.x - pl.body.pos.x, g.breaker.pos.z - pl.body.pos.z) < 2.5) g.input.pressed.use = true;
        }
        if (room.state === 'cleared') {
          B.doorT = (B.doorT || 0) + DT;
          if (B.doorT > 45 && !B.doorReported) {
            B.doorReported = true;
            issue('DOOR_STUCK', { chosen: room.chosenExit, doors: room.exitDoors.map((x) => x.state), routes: (room.routes || []).map((x) => x.type), caches: g.pickups.list.filter((p) => p.kind === 'cache').length, next: !!nx, err: g.lastError });
          }
        }
      }
      if (g.input.fire && B.f % 6 === 0) g.input.firePressed = true;
    }
    const before = g.level.current;
    g.tick(DT, DT);
    B.f++;
    B.watch(before);
  };

  // ---- watchdogs
  B.progress = () => {
    let s = 0;
    for (const e of g.enemies.list) if (e.alive) s += Math.max(0, e.hp || 0) + Math.max(0, e.shield || 0);
    const b = g.bosses.active;
    if (b && b.alive) s += Math.max(0, b.hp);
    return s;
  };
  B.watch = (before) => {
    const room = g.level.current;
    if (room !== before) {
      B.rooms++;
      B.roomT = 0; B.doorT = 0; B.doorReported = false; B.stuckReported = false; B.emptyT = 0; B.noProgT = 0; B.bestHp = Infinity;
      B.routeK = Math.random() < 0.5 ? 0 : 1;
      B.log.push(where() + ':' + room.spec.arch + (room.ctx.miniDefs ? '[' + room.ctx.miniDefs.map((m) => m.id).join(',') + ']' : '') + (room.ctx.bossId ? '[' + room.ctx.bossId + ']' : '') + ' t=' + Math.round(B.f / 60));
    }
    if (g.state !== 'playing') return;
    const p = g.player.body.pos;
    if (p.y < -4 && !B.fellReported) { B.fellReported = true; issue('FELL', { y: +p.y.toFixed(1) }); }
    if (p.y > -1) B.fellReported = false;
    B.inWallT = g.player.overlapsAny() ? (B.inWallT || 0) + DT : 0;
    if (B.inWallT > 1 && !B.wallReported) { B.wallReported = true; issue('IN_GEOMETRY', { mantle: !!g.player.mantle, wallRun: !!g.player.wallRun }); }
    if (B.inWallT === 0) B.wallReported = false;
    if (g.lastError && g.lastError !== B.lastErr) { B.lastErr = g.lastError; issue('GAME_ERROR', { err: g.lastError.slice(0, 300) }); }
    if (room.state !== 'combat') return;
    B.roomT = (B.roomT || 0) + DT;
    const alive = g.enemies.aliveCount, b = g.bosses.active;
    // an empty room in combat must clear on its own
    B.emptyT = alive === 0 && !(b && b.alive) ? (B.emptyT || 0) + DT : 0;
    // a live fight must keep making progress (total enemy health going down, or kills)
    const hp = B.progress();
    // (a boss fight without escorts has alive === 0 too: only its health counts then)
    if (hp < (B.bestHp ?? Infinity) - 1 || (alive === 0 && !(b && b.alive))) { B.bestHp = hp; B.noProgT = 0; } else B.noProgT = (B.noProgT || 0) + DT;
    if ((B.emptyT > 12 || B.noProgT > 90) && !B.stuckReported) {
      B.stuckReported = true;
      const d = g.director;
      issue(B.emptyT > 12 ? 'NEVER_CLEARS' : 'NO_PROGRESS', {
        roomT: Math.round(B.roomT), alive: g.enemies.list.filter((e) => e.alive).map((e) => ({ type: e.type, id: e.def && e.def.id, tg: e.targetable, hp: Math.round(e.hp), pos: [+(e.pos.x - room.origin.x).toFixed(1), +e.pos.y.toFixed(1), +(e.pos.z - room.origin.z).toFixed(1)], hidden: !!e.hidden, perch: !!e.perch })),
        dir: { active: d.active, waveIdx: d.waveIdx, waves: d.waves.length, pending: d.pendingBackup, minis: d.minis.map((m) => m.alive), severed: !!d.severed },
        boss: b && { type: b.type, alive: b.alive, hp: Math.round(b.hp), state: b.state, phase: b.phase },
      });
    }
    // keep the run going past a reported problem
    if (B.stuckReported && (B.emptyT > 20 || B.noProgT > 120)) { g.debug.killAll(); if (b && b.alive) g.debug.bossHit(1); B.noProgT = 0; }
    if (B.roomT > 420 && !B.slowReported) { B.slowReported = true; B.warns.push({ SLOW: where(), arch: room.spec.arch, boss: b && b.type }); }
  };

  B.run = (frames) => {
    const end = B.f + frames;
    while (B.f < end && !B.done) B.frame();
    return { f: B.f, done: !!B.done, at: where(), state: g.state, issues: B.issues.length };
  };
  B.start = (kind, arg) => {
    B.done = false; B.levels = 0; B.stopAtResults = 0; B.stopAtRoom = 0;
    g.profile.v.tutorialDone = true;
    if (kind === 'campaign') { g.newCampaign(arg.cycle || 0, true); B.stopAtResults = arg.levels; }
    else if (kind === 'route') {
      // one endless room of a given route type at a given depth: every exit leads there
      g.startEndless(arg.seed);
      const lobby = g.level.current;
      lobby.index = arg.index - 1;
      const reward = { cache: 'supply', hazard: 'rare', elite: 'rare', boss: 'boss' }[arg.type] || 'standard';
      g.applyRoutes(lobby, lobby.exitDoors.map(() => ({ type: arg.type, label: arg.type.toUpperCase(), sub: 'TEST', color: '#3ef0d0', reward, picks: arg.type === 'survival' ? 2 : 1 })));
      B.stopAtRoom = arg.index;
    } else { g.startEndless(arg.seed); B.stopAtRoom = arg.rooms; }
    B.log.push('START ' + kind + ' ' + JSON.stringify(arg));
  };
  window.__BOT = B;
}

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
await page.evaluate(install);
const summary = [];
async function scenario(name, kind, arg, maxMinutes) {
  await page.evaluate(([k, a]) => window.__BOT.start(k, a), [kind, arg]);
  const maxF = maxMinutes * 3600;
  let st;
  for (let n = 0; n * 3600 < maxF; n++) {
    st = await page.evaluate(() => window.__BOT.run(3600));
    console.log(`  ${name} t=${Math.round(st.f / 60)}s ${st.at} ${st.state} issues=${st.issues}`);
    if (st.done) break;
  }
  const rep = await page.evaluate(() => { const B = window.__BOT; const out = { log: B.log.slice(), issues: B.issues.slice(), warns: B.warns.slice() }; B.log = []; B.issues = []; B.warns = []; return out; });
  const finished = !!(st && st.done);
  summary.push({ name, finished, issues: rep.issues.length });
  console.log(`${name}: ${finished ? 'finished' : 'DID NOT FINISH in ' + maxMinutes + ' game minutes'}`);
  console.log('  rooms: ' + rep.log.join(' | '));
  for (const w of rep.warns) console.log('  warn: ' + JSON.stringify(w));
  for (const i of rep.issues) console.log('  ISSUE: ' + JSON.stringify(i).slice(0, 900));
  if (!finished) rep.issues.push({ kind: 'UNFINISHED' });
  return rep;
}

let bad = 0;
if (LEVELS > 0) bad += (await scenario('campaign', 'campaign', { cycle: 0, levels: LEVELS }, 22 * LEVELS)).issues.length;
if (NG > 0) bad += (await scenario('ng+', 'campaign', { cycle: 1, levels: NG }, 25 * NG)).issues.length;
if (ENDLESS > 0) bad += (await scenario('endless', 'endless', { seed: 9137, rooms: ENDLESS }, 4 * ENDLESS + 6)).issues.length;
// every endless route type, shallow and deep: it clears and its exits open
if (ROUTES) {
  for (const type of ['combat', 'hazard', 'elite', 'cache', 'survival', 'boss']) {
    for (const index of type === 'boss' ? [5, 15] : [2, 12]) bad += (await scenario('route ' + type + ' @' + index, 'route', { seed: 500 + index * 7 + type.length, type, index }, 5)).issues.length;
  }
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 8));
console.log(JSON.stringify(summary));
if (bad || errs.length) { console.log('FAIL: the bot hit problems (see ISSUE lines)'); process.exitCode = 1; } else console.log('BOT CAMPAIGN OK');
await browser.close(); server.kill();
