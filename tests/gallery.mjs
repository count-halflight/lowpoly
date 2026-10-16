// Close-up gallery of every enemy type (idle, attack wind-up, death collapse) and every weapon
// viewmodel, for art review. Simulation is stepped deterministically; each shot renders once.
// Also writes contact sheets (sheet-1.png ...) with five enemy types per sheet.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4175', 10);
const OUT = new URL('./shots/gallery/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const CLIP = { x: 380, y: 100, width: 520, height: 520 };
let types = [];
const problems = [];
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  await page.click('[data-a="endless"]'); await page.click('[data-a="endlessRandom"]');
  await page.waitForTimeout(400);
  types = await page.evaluate(() => {
    const g = window.__vg;
    // take over the loop: step the simulation by hand, render only for screenshots
    g.frame = () => {};
    g.__render = g.render.bind(g);
    g.render = () => {};
    g.__step = (n) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
    g.debug.god(true);
    g.shownHints = null; g.hud.hint('');
    for (const id of ['breacher', 'lance', 'thumper', 'arc']) if (!g.weapons.owned.includes(id)) g.weapons.owned.push(id);
    return Object.keys(g.debug.ENEMY_INFO);
  });
  // TYPES=husk,sentry limits the run to a few enemies (and skips the weapons)
  const only = process.env.TYPES ? process.env.TYPES.split(',') : null;
  if (only) types = types.filter((t) => only.includes(t));
  for (const w of only ? [] : ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc']) {
    await page.evaluate((w) => { const g = window.__vg; g.weapons.select(w); g.__step(30); g.__render(); }, w);
    await page.screenshot({ path: OUT + 'w-' + w + '.png' });
  }
  for (const t of types) {
    for (const mode of ['idle', 'attack', 'death']) {
      const res = await page.evaluate(({ t, mode }) => {
        const g = window.__vg;
        g.enemies.clear(); g.projectiles.clear(); g.fx.clear(); g.pickups.clear(true);
        const r = g.level.current;
        const V = g.camera.position.constructor;
        const flying = t === 'wisp' || t === 'bomber';
        g.player.spawnAt(r.wx(0), r.floorAt(r.wx(0), r.wz(2.5)), r.wz(2.5), 0);
        const e = g.enemies.spawn(t, new V(r.wx(0), flying ? 2.2 : r.floorAt(r.wx(0), r.wz(-1.5)) + 0.05, r.wz(-1.5)), {});
        e.spawnT = 0.01; e.yaw = 0; e.attackCd = 99; g.fx.columns.clear();
        if (flying) e.hoverH = 2.2;
        // hold still for the portrait (but keep animating)
        const think = e.think;
        e.think = function (dt) { this.stop(dt); this.faceToward(g.player.body.pos.x, g.player.body.pos.z, dt, 6); };
        if (flying) e.physics = function () { this.body.vel.set(0, 0, 0); this.pos.y = 2.2; };
        g.__step(40);
        // real think() so telegraphs (sight lines, lanes, sparks) draw; forceAttack holds the wind-up
        if (mode === 'attack') { e.think = think; e.forceAttack(); e.canSee = true; g.__step(24); }
        let collapse = null;
        if (mode === 'death') {
          e.think = think;
          g.combat.damageEnemy(e, 1e6, { source: 'hitscan', part: 'body', point: e.centerPos().clone(), dir: new V(0.3, 0, -1).normalize(), knock: 2 });
          g.__step(16);
          collapse = g.enemies.dying.length;
        }
        // frame the camera on the enemy
        const c = e.centerPos ? e.centerPos() : e.pos;
        const eye = g.player.body.pos.y + 1.6;
        g.player.yaw = 0; g.player.pitch = Math.atan2((mode === 'death' ? c.y - 0.5 : c.y) - eye, 4.2);
        g.player.updateCamera(g.camera); g.camera.updateMatrixWorld();
        g.camera.fov = 56; g.camera.updateProjectionMatrix();
        g.pickups.clear(true); g.hud.show(false);
        g.__render();
        return { meshes: e.meshes.length, state: e.state, alive: e.alive, collapse, err: g.lastError || null };
      }, { t, mode });
      if (res.err) problems.push(`${t}/${mode}: ${res.err}`);
      if (mode === 'death' && t !== 'wisp' && t !== 'bomber' && !res.collapse) problems.push(`${t}: no collapse on a grounded body-shot kill`);
      await page.screenshot({ path: `${OUT}${mode[0]}-${t}.png`, clip: CLIP });
      if (mode === 'idle') console.log(t.padEnd(10), 'meshes', res.meshes);
    }
  }
  // contact sheets: rows = types, columns = idle / attack / death
  const per = 5;
  for (let s = 0; s * per < types.length; s++) {
    const rows = types.slice(s * per, s * per + per);
    const img = (f) => 'data:image/png;base64,' + readFileSync(OUT + f).toString('base64');
    const html = `<body style="margin:0;background:#111;font:16px monospace;color:#eee">${rows.map((t) => `<div style="display:flex;align-items:center"><div style="width:110px;padding-left:8px">${t}</div>${['i', 'a', 'd'].map((m) => `<img src="${img(`${m}-${t}.png`)}" style="width:300px;height:300px;margin:2px">`).join('')}</div>`).join('')}</body>`;
    const sheet = await browser.newPage({ viewport: { width: 1030, height: rows.length * 304 } });
    await sheet.setContent(html);
    await sheet.screenshot({ path: `${OUT}sheet-${s + 1}.png` });
    await sheet.close();
  }
} finally {
  console.log('enemy types:', types.length);
  if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  if (errors.length || problems.length) process.exitCode = 1;
  await browser.close();
  server.kill();
}
