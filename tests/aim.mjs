// Aim-down-sights + quick-scope check (deterministic stepping, real input flags):
//   - firing works while aiming (both at once), aiming narrows the FOV factor and the spread
//   - railcannon: scope in and fire inside the window -> QUICKSCOPE (+ bonus); slow scope -> none
//   - revolver: aimed headshot right after raising the sights -> QUICKSCOPE
//   - railcannon fired from the hip at full charge, kill at range -> NO SCOPE
//   - touch AIM button latches and frees FIRE for the other thumb
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4197', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failed++; };
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const r = await page.evaluate(() => {
    const g = window.__vg;
    g.frame = () => {}; g.render = () => {};
    g.startEndless(12345);
    g.debug.god(true);
    const out = {};
    const ev = {};
    g.on('*', (e, d) => { ev[e] = (ev[e] || 0) + 1; });
    const step = (n = 1) => { for (let i = 0; i < n; i++) { g.tick(1 / 60, 1 / 60); } };
    const room = g.level.current;
    const P = g.player;
    const aimAt = (q) => { const c = g.camera.position, dx = q.x - c.x, dy = q.y - c.y, dz = q.z - c.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
    const target = (dist, hp = 60) => {
      for (const e of g.enemies.list) if (e.alive) g.combat.damageEnemy(e, 1e6, { source: 'hitscan', quiet: true });
      step(30);
      dist = Math.min(dist, room.D - 5);
      const p = P.body.pos.clone().addScaledVector(P.fwd, dist);
      const e = g.enemies.spawn('husk', new (P.body.pos.constructor)(p.x, 0.05, p.z), { hpMul: hp, dmgMul: 0, aggr: 0.01 });
      e.attackCd = 1e9; e.spawnT = 0; e.targetable = true; e.speed = 0;
      step(40);
      return e;
    };
    const styleSince = (from) => g.style.feed ? g.style.feed.filter((x) => x.t >= from).map((x) => x.label || x.text) : [];
    // put the player in the middle of the room facing -z, nothing else alive
    P.spawnAt(room.wx(0), 0.05, room.wz(room.D / 2 - 3), 0);
    for (const id of ['lance', 'breacher']) g.weapons.give(id);
    step(60);

    // 1) fire while aiming (revolver): hold aim, fire 3 shots
    g.weapons.select('hammer'); step(40);
    out.cur = g.weapons.current;
    let e = target(12, 100);
    g.input.held.zoom = true; step(20);
    out.zoomHammer = +g.weapons.adsZoom.toFixed(2);
    out.adsWhileFire = [];
    const mag0 = g.weapons.ammo.hammer.mag;
    for (let i = 0; i < 3; i++) { aimAt(e.headPos()); g.input.fire = true; g.input.firePressed = true; step(1); out.adsWhileFire.push(g.input.ads); g.input.fire = false; step(20); }
    out.shotsWhileAiming = mag0 - g.weapons.ammo.hammer.mag;
    g.input.held.zoom = false; step(20);

    // 2) revolver quick-scope: raise sights, headshot inside the window
    e = target(12, 100);
    const qs0 = ev.quickscope || 0;
    g.input.held.zoom = true; step(12);
    aimAt(e.headPos()); g.input.fire = true; g.input.firePressed = true; step(1); g.input.fire = false;
    out.hammerQS = (ev.quickscope || 0) - qs0;
    step(30); g.input.held.zoom = false; step(20);

    // 3) railcannon quick-scope: hold fire to charge, scope in, release inside the window
    g.weapons.select('lance'); step(40);
    e = target(22, 100);
    const q1 = ev.quickscope || 0;
    aimAt(e.headPos()); g.input.fire = true; step(20);
    g.input.held.zoom = true; step(14);
    out.scopeK = +g.weapons.scopeK.toFixed(2);
    out.zoomLance = +g.weapons.adsZoom.toFixed(2);
    aimAt(e.headPos()); g.input.fire = false; step(2);
    out.lanceQS = (ev.quickscope || 0) - q1;
    g.input.held.zoom = false; step(60);

    // 4) slow scope: scope in for 1.5 s, then charge and fire -> no quick-scope
    e = target(22, 100);
    const q2 = ev.quickscope || 0;
    g.input.held.zoom = true; step(90);
    aimAt(e.headPos()); g.input.fire = true; step(40); g.input.fire = false; step(2);
    out.slowScopeQS = (ev.quickscope || 0) - q2;
    g.input.held.zoom = false; step(60);

    // 5) no-scope: hip fire at full charge, kill at > 20 m
    e = target(26, 1);
    const n0 = ev.noscope || 0;
    aimAt(e.headPos()); g.input.fire = true; step(50); aimAt(e.headPos()); g.input.fire = false; step(2);
    out.noscope = (ev.noscope || 0) - n0;
    out.noscopeDist = +e.pos.distanceTo(P.body.pos).toFixed(1); out.roomD = room.D;
    out.noscopeKilled = !e.alive;

    // 6) touch AIM latch
    g.touch.setAim(true); step(20);
    out.touchAds = g.input.ads && g.weapons.adsK > 0.5;
    g.touch.setAim(false); step(20);
    out.touchOff = !g.input.ads;
    // 7) right mouse in aim mode is wired to aiming
    g.settings.set('rmbMode', 'aim');
    g.input.aimMouse = true; step(10); out.rmbAim = g.input.ads; g.input.aimMouse = false; step(5);
    g.settings.set('rmbMode', 'alt');
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.shotsWhileAiming === 3 && r.adsWhileFire.every(Boolean), 'fires while aiming (3 shots, ADS held throughout)');
  ok(r.zoomHammer < 0.85 && r.zoomLance < 0.5, 'aiming narrows the view (hammer ' + r.zoomHammer + ', lance ' + r.zoomLance + ')');
  ok(r.hammerQS === 1, 'revolver quick-scope headshot');
  ok(r.scopeK > 0.5 && r.lanceQS === 1, 'railcannon quick-scope through the scope');
  ok(r.slowScopeQS === 0, 'no quick-scope after a slow scope-in');
  ok(r.noscope === 1 && r.noscopeKilled, 'hip-fired full charge kill at range (>15 m) counts as NO SCOPE');
  ok(r.touchAds && r.touchOff, 'touch AIM button latches on and off');
  ok(r.rmbAim, 'right mouse aims when set to AIM');
  if (errors.length) { console.log('page errors', errors); failed++; }
} catch (e) { console.log('FAILED', e.message); failed++; }
await browser.close(); server.kill();
console.log(failed ? 'AIM FAILED' : 'AIM OK');
process.exitCode = failed ? 1 : 0;
