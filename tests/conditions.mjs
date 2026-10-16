// Level conditions + NG+ systems: starts a practice level for every condition and fights
// its first combat room for a while (fixed 60 Hz steps), checking each condition's actual
// effect, then runs an NG+ cycle long enough for THE WARDEN to appear.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4179', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);
  const out = await page.evaluate(() => {
    const g = window.__vg;
    g.frame = () => {}; g.render = () => {};
    g.profile.v.tutorialDone = true;
    g.settings.values.cutscenes = false;
    const step = (n, fn) => { for (let f = 0; f < n; f++) { if (fn) fn(f); g.tick(1 / 60, 1 / 60); } };
    const enterFirstRoom = () => {
      const room = g.level.current;
      g.chooseExit(0);
      const nx = g.level.next;
      g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
      step(10);
      return g.level.current;
    };
    const res = {};
    const levels = { lowgrav: '3-5', dark: '1-5', ice: '3-1', conveyor: '2-3', barrels: '1-3', pads: '1-4', swarm: '5-2', snipers: '4-2', heavies: '2-4', haste: '2-5', fog: '3-2', bloodfuel: '3-3', glass: '4-5', hazards: '1-2' };
    for (const [cond, id] of Object.entries(levels)) {
      g.startPractice(id);
      g.debug.god(true);
      const room = enterFirstRoom();
      const r = { arch: room.spec.arch, cond: room.cond };
      // fight for 8 seconds, strafing and firing
      step(480, (f) => { g.input.held.left = (f / 60 | 0) % 2 === 0; g.input.held.right = !g.input.held.left; g.input.fire = f % 40 < 20; });
      g.input.fire = false; g.input.held.left = g.input.held.right = false;
      r.enemies = g.enemies.list.length;
      if (cond === 'lowgrav' || cond === 'none') {
        // jump apex
        g.player.body.vel.set(0, 0, 0);
        let apex = 0; const y0 = g.player.body.pos.y;
        g.input.pressed.jump = true;
        step(120, () => { apex = Math.max(apex, g.player.body.pos.y - y0); });
        r.jumpApex = +apex.toFixed(2);
      }
      if (cond === 'ice') r.friction = g.player.friction;
      if (cond === 'conveyor') {
        const c = room.conveyors[0];
        r.conveyors = room.conveyors.length;
        if (c) {
          g.player.spawnAt((c.wx0 + c.wx1) / 2, 0.05, (c.wz0 + c.wz1) / 2, 0);
          step(5);
          const x0 = g.player.body.pos.x;
          step(60);
          r.conveyorDrift = +(g.player.body.pos.x - x0).toFixed(2);
        }
      }
      if (cond === 'barrels') {
        r.barrels = room.barrels.length;
        const alive0 = room.barrels.filter((b) => b.alive).length;
        if (room.barrels[0]) { g.level.hitBarrel(room.barrels[0]); step(60); }
        r.barrelsAfter = room.barrels.filter((b) => b.alive).length;
        r.barrelsBlown = alive0 - r.barrelsAfter;
      }
      if (cond === 'pads') r.pads = room.pads.length;
      if (cond === 'dark') r.darkK = +g.level.darkK.toFixed(2);
      if (cond === 'fog') r.fogFar = g.scene.fog.far;
      if (cond === 'hazards') r.hazards = room.hazards.length;
      r.types = [...new Set(g.enemies.list.map((e) => e.type))].join(',');
      r.error = g.lastError || null;
      res[cond] = r;
    }
    // NG+: mirrored rooms, corrupted enemies, the Warden
    g.newCampaign(1, true);
    g.debug.god(true);
    const room = enterFirstRoom();
    const ng = { cycle: g.campaign.cycle, stratum: g.campaign.level.stratum, mirror: !!room.ctx.mirror };
    let warden = false, corrupt = 0, wisps = 0;
    step(60 * 6);
    g.director.combatT = 69; // fast-forward the linger timer
    step(60 * 12, (f) => {
      g.input.held.left = (f / 90 | 0) % 2 === 0; g.input.held.right = !g.input.held.left;
      if (g.director.warden) warden = true;
      corrupt = Math.max(corrupt, g.enemies.list.filter((e) => e.corrupt).length);
      wisps = Math.max(wisps, g.enemies.list.filter((e) => e.type === 'wisp' && e.alive).length);
    });
    ng.warden = warden; ng.corruptSeen = corrupt; ng.roomState = g.level.current.state; ng.state = g.state; ng.combatT = Math.round(g.director.combatT); ng.error = g.lastError || null;
    res.ngplus = ng;
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  const bad = [];
  if (!(out.lowgrav.jumpApex > 2.2)) bad.push('low gravity should raise the jump apex');
  if (!(out.ice.friction < 0.5)) bad.push('ice friction');
  if (out.conveyor.conveyors && Math.abs(out.conveyor.conveyorDrift) < 1) bad.push('conveyor drift');
  if (out.barrels.barrels && out.barrels.barrelsBlown < 1) bad.push('barrels did not explode');
  if (!(out.dark.darkK > 0.5)) bad.push('blackout not dark');
  if (!(out.fog.fogFar < 40)) bad.push('fog not applied');
  if (!out.ngplus.mirror || out.ngplus.stratum !== 10) bad.push('ng+ setup');
  if (!out.ngplus.warden) bad.push('warden never appeared');
  for (const [k, v] of Object.entries(out)) if (v.error) bad.push(k + ': ' + v.error);
  if (errors.length) bad.push(...errors);
  if (bad.length) { console.log('FAIL:', bad.join(' | ')); process.exitCode = 1; } else console.log('CONDITIONS + NG+ OK');
} finally {
  await browser.close();
  server.kill();
}
