// Deterministic checks for the combat mechanics layer (no rendering, fixed 60 Hz steps):
// weapon variants (all 12 fire primary + alt), touch chip re-tap, RUSH, finisher,
// perfect dodge, projectile boost, slide kick + airborne bonus, variant persistence.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4190', 10);
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.__vg && window.__vg.debug);
const r = await page.evaluate(() => {
  const g = window.__vg;
  g.frame = () => {}; g.render = () => {};
  g.profile.v.tutorialDone = true;
  try { localStorage.removeItem('vg-variants'); } catch { /* ignore */ }
  const events = {};
  g.on('*', (ev) => { events[ev] = (events[ev] || 0) + 1; });
  const step = (n) => { for (let f = 0; f < n; f++) { g.tick(1 / 60, 1 / 60); if (g.lastError) throw new Error(g.lastError); } };
  const out = {};
  g.startEndless(5);
  g.debug.god(true);
  step(30);
  const W = g.weapons, P = g.player, V3 = P.body.pos.constructor, p = P.body.pos;
  const spawnAhead = (dist, opts = {}) => { const e = g.enemies.spawn('husk', new V3(p.x, 0.05, p.z - dist), opts); e.attackCd = 1e9; step(90); e.body.pos.set(p.x, e.body.pos.y, p.z - dist); if (e.pos !== e.body.pos) e.pos.copy(e.body.pos); return e; };
  const hitBody = (e, n, src = 'hitscan') => { const h = e.hp; g.combat.damageEnemy(e, n, { source: src, part: 'body', point: e.centerPos().clone() }); return +(h - e.hp).toFixed(2); };

  // every variant of every weapon fires primary + alt without errors
  for (const id of ['breacher', 'lance', 'thumper', 'arc']) W.give(id);
  step(20);
  const ORDER = ['hammer', 'ripsaw', 'breacher', 'lance', 'thumper', 'arc'];
  out.variants = [];
  for (let wi = 0; wi < ORDER.length; wi++) {
    const id = ORDER[wi];
    W.select(id); step(30);
    for (let v = 0; v < 2; v++) {
      if (W.variant[id] !== v) { g.input.slot = wi; step(1); step(20); }
      P.yaw = 0; P.pitch = -0.05;
      for (let k = 0; k < 30; k++) { g.input.fire = true; g.input.firePressed = k % 5 === 0; step(1); }
      g.input.fire = false; step(5);
      g.input.pressed.altTap = true; g.input.alt = true; step(40); g.input.alt = false; step(4);
      g.input.pressed.altTap = true; step(20);
      out.variants.push(id + ':' + W.variantId(id));
      W.ammo[id].mag = W.magSize(id); W.reloading = false;
    }
  }
  g.debug.killAll(); step(10);
  W.select('hammer'); step(30);
  if (W.variant.hammer !== 0) { W.variant.hammer = 0; W.applyVariantVisual('hammer'); }

  // touch: tapping the held weapon's chip cycles its variant and emits 'variant'
  const ev0 = events.variant || 0;
  g.input.chipTap = 'hammer'; step(1);
  out.chip = { to: W.variantId('hammer'), ev: (events.variant || 0) - ev0, name: W.variantInfo('hammer') && W.variantInfo('hammer').name };
  g.input.chipTap = 'hammer'; step(20);

  // RUSH: activation, +damage, lifesteal; enemy-sourced damage is not boosted
  const e1 = spawnAhead(5, { hpMul: 20 });
  const plain = hitBody(e1, 10);
  P.rush = 1; g.input.pressed.rush = true; step(1);
  P.hp = 50;
  out.rush = { ev: events.rush || 0, active: P.rushT > 0, plain, rushed: hitBody(e1, 10), enemy: hitBody(e1, 10, 'enemy') };
  out.rush.healed = P.hp > 50;
  step(60 * 9);
  out.rush.ended = P.rushT <= 0;
  g.debug.killAll(); step(10);

  // finisher: a nearly dead husk in reach gets executed by a punch (heal + full mag)
  P.yaw = 0; P.pitch = -0.15; P.hp = 40; W.ammo.hammer.mag = 1;
  const e2 = spawnAhead(2.3);
  e2.hp = e2.maxHp * 0.15;
  const fin0 = events.finisher || 0;
  g.input.pressed.punch = true; step(2);
  out.finisher = { ev: (events.finisher || 0) - fin0, dead: !e2.alive, hp: P.hp, mag: W.ammo.hammer.mag };
  step(30);

  // perfect dodge: dash into a shot about to land
  P.dashCharges = 1;
  g.projectiles.spawnEnemy(new V3(p.x, p.y + 0.9, p.z - 3), new V3(0, 0, 30), 12);
  step(2);
  const pd0 = events.perfectDodge || 0;
  g.input.pressed.dash = true; g.input.held.right = true; step(1); g.input.held.right = false;
  out.dodge = { ev: (events.perfectDodge || 0) - pd0, slow: g.slowT > 0, refund: P.dashCharges >= 1 };
  step(90);

  // projectile boost: punch a fresh grenade
  W.select('thumper'); step(40);
  if (W.variantId('thumper') !== 'sticky') { W.variant.thumper = 0; W.applyVariantVisual('thumper'); }
  P.pitch = 0.1;
  g.input.fire = true; g.input.firePressed = true; step(1); g.input.fire = false; step(1);
  const gr = g.projectiles.list.find((q) => q.active && q.friendly && q.kind === 'grenade');
  const d0 = gr ? gr.dmg : 0;
  const pb0 = events.projBoost || 0;
  g.input.pressed.punch = true; step(1);
  out.boost = { ev: (events.projBoost || 0) - pb0, boosted: !!(gr && gr.boosted), mul: gr ? +(gr.dmg / d0).toFixed(2) : 0 };
  step(150);

  // slide kick launches a light enemy; airborne enemies take bonus damage
  P.yaw = 0; P.pitch = -0.2;
  const e3 = spawnAhead(2.2, { hpMul: 10 });
  g.input.held.slide = true; g.input.held.fwd = true;
  P.body.vel.set(0, 0, -13); step(1);
  e3.body.pos.set(p.x, e3.body.pos.y, p.z - 2.2); if (e3.pos !== e3.body.pos) e3.pos.copy(e3.body.pos);
  g.input.pressed.punch = true; step(1);
  g.input.held.slide = false; g.input.held.fwd = false;
  out.kick = { launched: e3.body.vel.y > 4, feed: g.style.feed.some((f) => f.name.startsWith('SLIDE KICK')) };
  step(16);
  out.kick.airDmg = hitBody(e3, 10);
  g.debug.killAll(); step(10);

  // variant picks persist across runs
  W.variant.arc = 1; W.savePrefs(); W.reset();
  out.persist = W.variantId('arc');
  return out;
});
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
check(r.variants.length === 12 && new Set(r.variants).size === 12, 'all 12 variants used: ' + r.variants.join(','));
check(r.chip.to === 'piercer' && r.chip.ev === 1 && r.chip.name === 'PIERCER', 'chip re-tap cycles variant ' + JSON.stringify(r.chip));
check(r.rush.ev === 1 && r.rush.active && r.rush.rushed > r.rush.plain && r.rush.enemy === r.rush.plain && r.rush.healed && r.rush.ended, 'rush ' + JSON.stringify(r.rush));
check(r.finisher.ev === 1 && r.finisher.dead && r.finisher.hp > 40 && r.finisher.mag === 6, 'finisher ' + JSON.stringify(r.finisher));
check(r.dodge.ev === 1 && r.dodge.slow && r.dodge.refund, 'perfect dodge ' + JSON.stringify(r.dodge));
check(r.boost.ev === 1 && r.boost.boosted && r.boost.mul >= 1.5, 'projectile boost ' + JSON.stringify(r.boost));
check(r.kick.launched && r.kick.feed && r.kick.airDmg > 10, 'slide kick ' + JSON.stringify(r.kick));
check(r.persist === 'tether', 'variant persistence ' + r.persist);
console.log(JSON.stringify(r));
if (errors.length) { console.log('ERRORS', errors); fails.push('page errors'); }
if (fails.length) { console.log('FAIL:\n  ' + fails.join('\n  ')); process.exitCode = 1; } else console.log('MECHANICS OK');
await browser.close(); server.kill();
