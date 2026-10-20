// Movement tech check with injected input, deterministic 60 Hz steps:
//   wall-run (fast along a wall holding forward), wall-run jump keeps speed, ledge vault onto a
//   1.4 m block, no vault on a full-height wall, dash-slide keeps the dash speed.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4199', 10);
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
    g.profile.v.tutorialDone = true;
    g.startTutorial(false, 0); // a quiet room with plain walls
    g.debug.god(true);
    const P = g.player, b = P.body, room = g.level.current;
    const KEYS = ['fwd', 'back', 'left', 'right', 'jump', 'slide', 'dash'];
    const ev = {};
    g.on('*', (e) => { ev[e] = (ev[e] || 0) + 1; });
    const run = (frames, hold, press = {}) => {
      for (let f = 0; f < frames; f++) {
        for (const k of KEYS) g.input.held[k] = hold.includes(k);
        if (press[f]) for (const k of press[f]) g.input.pressed[k] = true;
        g.tick(1 / 60, 1 / 60);
      }
      for (const k of KEYS) g.input.held[k] = false;
    };
    const out = {};
    // ---- wall-run along the west wall, facing -z, airborne with speed
    const wx = room.wx(-room.W / 2 + b.r + 0.05);
    P.spawnAt(wx + 0.3, 1.2, room.wz(room.D / 2 - 2), 0); P.yaw = 0; P.pitch = 0;
    b.vel.set(-3, 3, -12); b.grounded = false; P.airTime = 0.2;
    let maxRun = 0, minY = 99;
    for (let f = 0; f < 50; f++) { run(1, ['fwd']); if (P.wallRun) { maxRun++; minY = Math.min(minY, b.pos.y); } }
    out.wallRunFrames = maxRun; out.wallRunMinY = +minY.toFixed(2);
    out.wallRunEvent = ev.wallrun || 0;
    run(90, []);
    // jump off it
    P.spawnAt(wx + 0.3, 1.2, room.wz(room.D / 2 - 2), 0); P.yaw = 0;
    b.vel.set(-3, 3, -12); b.grounded = false; P.airTime = 0.2; P.wallRunBudget = 1.3; P.wallRunCd = 0;
    run(12, ['fwd']);
    out.runningBeforeJump = !!P.wallRun;
    run(1, ['fwd'], { 0: ['jump'] });
    out.wallRunJump = ev.wallrunjump || 0;
    out.jumpSpeed = +Math.hypot(b.vel.x, b.vel.z).toFixed(1);
    out.jumpAway = b.vel.x > 2; // away from the west wall (+x)
    run(120, []);
    // ---- vault: a 1.9 m block (too high to clear with a plain jump) 2.4 m ahead
    const cx = room.wx(0), cz = room.wz(2);
    const block = { minX: cx - 2, maxX: cx + 2, minY: 0, maxY: 1.9, minZ: cz - 9, maxZ: cz - 2.4, surface: 'metal', active: true, solid: true, shootable: true, nav: false, tag: null };
    g.level.colliders.push(block);
    P.spawnAt(cx, 0.05, cz, 0); P.yaw = 0; P.pitch = 0;
    run(10, []);
    const m0 = ev.mantle || 0;
    run(70, ['fwd'], { 6: ['jump'] });
    out.mantled = (ev.mantle || 0) - m0;
    out.onBlockY = +b.pos.y.toFixed(2);
    g.level.colliders.splice(g.level.colliders.indexOf(block), 1);
    // ---- no vault into a full-height wall
    P.spawnAt(cx, 0.05, room.wz(-room.D / 2 + 2.5), 0); P.yaw = 0;
    run(10, []);
    const m1 = ev.mantle || 0;
    run(70, ['fwd'], { 4: ['jump'], 40: ['jump'] });
    out.wallVault = (ev.mantle || 0) - m1;
    // ---- dash-slide
    P.spawnAt(cx, 0.05, room.wz(room.D / 2 - 2), 0); P.yaw = 0;
    run(20, []);
    const d0 = ev.dashslide || 0;
    P.dashCharges = 3;
    run(1, ['fwd'], { 0: ['dash'] });
    run(2, ['fwd']);
    run(2, ['fwd', 'slide']);
    out.dashSlide = (ev.dashslide || 0) - d0;
    out.slideSpeed = +P.slideSpeed.toFixed(1);
    run(30, []);
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.wallRunFrames >= 20 && r.wallRunEvent >= 1, 'wall-run starts and holds (' + r.wallRunFrames + ' frames)');
  ok(r.wallRunMinY > 0.6, 'wall-run keeps you up off the floor (min y ' + r.wallRunMinY + ')');
  ok(r.runningBeforeJump && r.wallRunJump === 1 && r.jumpSpeed >= 10 && r.jumpAway, 'wall-run jump keeps speed (' + r.jumpSpeed + ' m/s) and kicks away');
  ok(r.mantled === 1 && r.onBlockY > 1.8, 'vaults onto a 1.9 m block (y ' + r.onBlockY + ')');
  ok(r.wallVault === 0, 'no vault into a full-height wall');
  ok(r.dashSlide === 1 && r.slideSpeed > 17, 'dash-slide keeps the dash speed (' + r.slideSpeed + ' m/s)');
  if (errors.length) { console.log('page errors', errors); failed++; }
} catch (e) { console.log('FAILED', e.message); failed++; }
await browser.close(); server.kill();
console.log(failed ? 'MOVEMENT FAILED' : 'MOVEMENT OK');
process.exitCode = failed ? 1 : 0;
