// Balance probe: a simple in-page bot plays without god mode (aims with human-like error,
// strafes, dodges, parries, collects caches, walks through doors) and reports how far it gets.
//   npm run build && node tests/bot.mjs [maxRooms] [seed]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const MAX = parseInt(process.argv[2] || '8', 10);
const SEED = process.argv[3] || '777';
const PORT = 4176;
const OUT = new URL('./shots/bot/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('voltgrave.settings.v1', JSON.stringify({ resolution: 240, music: 0, sfx: 0 })); } catch { /* */ } });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
await page.fill('#m-seed', SEED);
await page.click('[data-a="start"]');
await page.waitForTimeout(300);

// install the bot
await page.evaluate(() => {
  const g = window.__vg;
  const V = g.camera.position.constructor;
  const bot = { strafe: 1, strafeT: 0, stuckT: 0, lastPos: new V(), log: [], assists: 0, roomDmg: {} };
  window.__bot = bot;
  const aimAt = (t, err = 0.025) => {
    const cam = g.camera.position;
    const dx = t.x - cam.x, dy = t.y - cam.y, dz = t.z - cam.z;
    const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
    let d = ty - g.player.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    g.player.yaw += d * 0.35 + (Math.random() - 0.5) * err;
    g.player.pitch += (tp - g.player.pitch) * 0.35 + (Math.random() - 0.5) * err;
    return Math.abs(d) < 0.08 && Math.abs(tp - g.player.pitch) < 0.08;
  };
  const step = () => {
    requestAnimationFrame(step);
    const inp = g.input;
    if (g.state === 'reward') { g.chooseReward(Math.floor(Math.random() * Math.min(3, g.rewardCards.length))); return; }
    if (g.state !== 'playing') return;
    const room = g.level.current;
    const pp = g.player.body.pos;
    inp.moveX = 0; inp.moveY = 0; inp.fire = false;
    bot.roomDmg[room.index] = g.run.damageTaken;
    if (room.state === 'combat') {
      // pick target
      let t = null, bd = 1e9;
      const boss = g.bosses.active;
      if (boss && boss.alive && boss.state !== 'intro') {
        const hbs = boss.hitboxes().filter((h) => !h.shielded);
        for (const h of hbs) { const d = Math.hypot(h.x - pp.x, h.z - pp.z) - (h.weak ? 5 : 0); if (d < bd) { bd = d; t = new V(h.x, h.y, h.z); } }
      }
      for (const e of g.enemies.list) {
        if (!e.alive || !e.targetable) continue;
        const c = (Math.random() < 0.3 ? e.headPos() : e.centerPos()).clone();
        const d = c.distanceTo(pp) - (e.type === 'signaller' ? 20 : 0);
        if (d < bd && g.combat.losClear(g.camera.position, c)) { bd = d; t = c; }
      }
      // weapon choice
      const w = g.weapons;
      const want = bd < 7 && w.owned.includes('breacher') ? 'breacher' : bd > 20 && w.owned.includes('lance') ? 'lance' : w.owned.includes('ripsaw') && w.ammo.ripsaw.mag + w.ammo.ripsaw.reserve > 0 ? 'ripsaw' : 'hammer';
      if (w.current !== want && w.ammo[want].mag + (isFinite(w.ammo[want].reserve) ? w.ammo[want].reserve : 99) > 0) w.select(want);
      if (t) {
        const onTarget = aimAt(t);
        if (w.current === 'lance') inp.fire = !(w.charging && w.charge >= 1) ; else inp.fire = onTarget;
        if (inp.fire && !w.def().auto) inp.firePressed = Math.random() < 0.3;
      } else {
        // no LOS: walk toward the nearest enemy via straight line
        const e = g.enemies.list.find((x) => x.alive);
        if (e) { aimAt(e.centerPos().clone(), 0); inp.moveY = 0.8; }
      }
      // strafe
      bot.strafeT -= 1 / 60;
      if (bot.strafeT <= 0) { bot.strafe *= -1; bot.strafeT = 0.8 + Math.random() * 1.5; }
      inp.moveX = bot.strafe * 0.9;
      if (t) inp.moveY = bd > 14 ? 0.6 : bd < 6 ? -0.7 : 0;
      // dodge / parry incoming projectiles
      for (const pr of g.projectiles.list) {
        if (!pr.active || pr.friendly) continue;
        const d = pr.pos.distanceTo(g.camera.position);
        if (d < 2.6 && pr.parryable && Math.random() < 0.5) { inp.press('punch'); break; }
        if (d < 6 && Math.random() < 0.06) { inp.press('dash'); break; }
      }
      // jump shockwaves
      if (g.enemies.waves.length && Math.random() < 0.2) inp.press('jump');
      if (Math.random() < 0.004) inp.press('jump');
    } else {
      // cleared: grab cache, then go to an exit
      const cache = g.pickups.list.find((p) => p.kind === 'cache');
      let goal = null;
      if (cache) goal = cache.pos.clone();
      else if (room.chosenExit < 0 && room.exitDoors.length) { const d = room.exitDoors[0]; goal = new V(room.wx(d.x), 1.6, room.wz(d.z) + 0.5); }
      else if (g.level.next) { const n = g.level.next; goal = new V(n.wx(n.spec.entX), 1.6, n.wz(n.D / 2 - 3)); }
      if (goal) {
        goal.y = 1.6;
        aimAt(goal, 0);
        g.player.pitch = 0;
        inp.moveY = 1;
        // stuck handling: hop, then nav assist
        if (pp.distanceTo(bot.lastPos) < 0.02) bot.stuckT += 1 / 60; else bot.stuckT = 0;
        if (bot.stuckT > 0.6) inp.press('jump');
        if (bot.stuckT > 4) { pp.set(goal.x, 0.1, goal.z); bot.assists++; bot.stuckT = 0; }
      }
      bot.lastPos.copy(pp);
    }
  };
  requestAnimationFrame(step);
});

const t0 = Date.now();
let last = -1;
while (Date.now() - t0 < 25 * 60 * 1000) {
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => { const g = window.__vg; return { state: g.state, room: g.level.current.index, rs: g.level.current.state, hp: Math.round(g.player.hp), kills: g.run.kills, dmg: Math.round(g.run.damageTaken), enemies: g.enemies.aliveCount, boss: g.bosses.active ? Math.round(g.bosses.active.hp) : null, assists: window.__bot.assists, owned: g.weapons.owned.length, ups: g.upgrades.taken.length, err: g.lastError }; });
  if (s.room !== last) { console.log(JSON.stringify(s)); last = s.room; await page.screenshot({ path: `${OUT}room-${String(s.room).padStart(2, '0')}.png` }); }
  if (s.err) { console.log('ERROR', s.err); break; }
  if (s.state === 'dead') {
    const cause = await page.evaluate(() => window.__vg.player.lastDamage);
    console.log('DIED in room', s.room, 'cause:', cause.cause, '| kills', s.kills, '| dmg taken', s.dmg);
    await page.screenshot({ path: `${OUT}death.png` });
    break;
  }
  if (s.room > MAX) { console.log('reached room', s.room); break; }
}
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.kill();
process.exit(0);
