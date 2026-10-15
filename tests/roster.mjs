// Roster soak: spawns every one of the 30 bosses (plus THE ARCHITECT) and all 60 minibosses
// in their real arenas, lets each run its attack patterns against a god-mode player for a
// while (fixed 60 Hz steps, rendering off for speed), then kills it and checks that the room
// clears. Every 6th encounter is also rendered to tests/shots/roster-*.png.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = 4177;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const SECONDS = parseFloat(process.env.SECONDS || '14');
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  // set up: campaign mode at mid depth, deterministic stepping, rendering on demand
  const ids = await page.evaluate(async () => {
    const g = window.__vg;
    g.realRender = g.render.bind(g);
    g.render = () => {};
    g.frame = () => {};
    g.profile.v.tutorialDone = true;
    g.settings.values.cutscenes = true;
    g.newCampaign(0, true);
    return { ok: true };
  });
  void ids;
  const roster = await page.evaluate(() => {
    const g = window.__vg;
    return { bosses: g.campaign.plan.slice(0, 30).map((e) => e.bossId), minis: g.campaign.plan.slice(0, 30).flatMap((e) => e.minis) };
  });
  const list = [...roster.bosses.map((id) => ({ kind: 'boss', id })), { kind: 'boss', id: 'architect' }, ...roster.minis.map((id) => ({ kind: 'mini', id }))];
  console.log('roster:', roster.bosses.length, 'bosses (+ architect),', roster.minis.length, 'minibosses');
  const report = [];
  let n = 0;
  for (const enc of list) {
    const r = await page.evaluate(({ enc, seconds }) => {
      const g = window.__vg;
      const c = g.campaign;
      // pick the plan level that owns this encounter so the arena has the right theme
      let li = c.plan.findIndex((e) => e.bossId === enc.id || e.minis.includes(enc.id));
      if (enc.id === 'architect') li = 30;
      g.startLevel(Math.max(0, li));
      g.debug.god(true);
      const room = g.level.current;
      const route = enc.kind === 'boss' ? { type: 'boss', label: 'X', sub: '', color: '#fff' } : { type: 'mini', label: 'X', sub: '', color: '#fff' };
      const local = enc.kind === 'boss' ? 6 : 3;
      const ctx = c.ctxFor(route, local);
      if (enc.kind === 'mini') ctx.miniDefs = [g.debug.miniById(enc.id)];
      room.chosenExit = 0;
      g.level.buildNext(route, ctx);
      const nx = g.level.next;
      g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
      // step until we are in the arena and the intro started
      for (let f = 0; f < 30; f++) g.tick(1 / 60, 1 / 60);
      const cut = g.cutscene.active;
      return { entered: g.level.current === nx, cut, arch: nx.spec.arch };
    }, { enc, seconds: SECONDS });
    if (!r.entered) throw new Error('could not enter arena for ' + enc.id);
    // optionally render the intro cutscene frame
    const shoot = n % 6 === 0 || enc.id === 'architect';
    if (shoot) {
      await page.evaluate(() => { const g = window.__vg; for (let f = 0; f < 70; f++) g.tick(1 / 60, 1 / 60); g.realRender(); });
      await page.screenshot({ path: SHOTS + `roster-${String(n).padStart(2, '0')}-${enc.id}-intro.png` });
    }
    const res = await page.evaluate(({ seconds }) => {
      const g = window.__vg;
      if (g.cutscene.active) g.cutscene.finish(true);
      const b = g.bosses.active;
      const minis = g.enemies.list.filter((e) => e.mini);
      const target = b || minis[0];
      if (!target) return { err: 'no target spawned' };
      const name = target.name;
      // let it fight: the player strafes around in god mode
      let projectilesSeen = 0, attacksSeen = new Set();
      for (let f = 0; f < seconds * 60; f++) {
        const k = Math.floor(f / 90) % 4;
        g.input.held.left = k === 0; g.input.held.right = k === 2; g.input.held.fwd = k === 1; g.input.held.back = k === 3;
        if (f % 50 === 0) g.input.pressed.jump = true;
        g.tick(1 / 60, 1 / 60);
        projectilesSeen = Math.max(projectilesSeen, g.projectiles.list.filter((p) => p.active && !p.friendly).length);
        const brain = (b && b.brain) || (minis[0] && minis[0].brain);
        if (brain && brain.cur) attacksSeen.add(brain.cur.id);
        if (b && b.hands) for (const h of b.hands) if (h.state !== 'idle') attacksSeen.add('hand-' + h.state);
      }
      for (const a of ['left', 'right', 'fwd', 'back']) g.input.held[a] = false;
      const dmgTaken = Math.round(g.run.damageTaken);
      // now kill it
      for (let f = 0; f < 60 * 40 && g.level.current.state === 'combat'; f++) {
        if (g.cutscene.active) g.cutscene.finish(true);
        if (g.breaker && !g.breaker.pulled) break;
        if (f % 20 === 0) { g.debug.killAll(); if (g.bosses.active && g.bosses.active.alive) g.debug.bossHit(0.2); }
        g.director.waveT = -99;
        g.tick(1 / 60, 1 / 60);
      }
      return { name, attacks: [...attacksSeen], projectilesSeen, dmgTaken, cleared: g.level.current.state !== 'combat' || !!g.breaker, error: g.lastError || null };
    }, { seconds: SECONDS });
    if (shoot) {
      await page.evaluate(() => { const g = window.__vg; g.realRender(); });
    }
    report.push({ ...enc, ...res });
    console.log(String(n).padStart(2), enc.kind.padEnd(4), enc.id.padEnd(16), (res.name || '').padEnd(26), 'attacks:', (res.attacks || []).join(',') || '-', '| peak shots', res.projectilesSeen, '| dmg', res.dmgTaken, res.cleared ? 'OK' : 'NOT CLEARED', res.err || '', res.error || '');
    if (res.err || !res.cleared || res.error) throw new Error('encounter failed: ' + enc.id + ' ' + JSON.stringify(res));
    if (errors.length) throw new Error('page errors during ' + enc.id + ': ' + errors.join(' | '));
    if (!res.attacks.length) console.log('   WARNING: no attacks observed for', enc.id);
    n++;
  }
  const silent = report.filter((r) => !r.attacks.length).map((r) => r.id);
  console.log('ROSTER PASSED:', report.length, 'encounters', silent.length ? '(no attacks seen: ' + silent.join(',') + ')' : '');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
