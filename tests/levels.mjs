// Level-design soak: builds every room archetype in every stratum theme, normal and NG+
// mirrored, over several seeds, and checks that nothing can soft-lock a room:
//   - the archetype generates without falling back (validation passes within the retries)
//   - entrance, every exit, the cache spot, terminals and secret alcoves are nav-reachable
//   - spawn cells (free nav cells) are all reachable from the entrance and not inside geometry
//   - perches stand on something, and are not buried in geometry
//   - doors are not blocked by props
// PHASE=play (default runs both) then walks into each new archetype with real AI for a while
// (god mode), checks that no enemy ends up somewhere unreachable, and clears the room.
// SHOTS=1 saves screenshots of each new archetype from the entrance and from above.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const PORT = parseInt(process.env.PORT || '4198', 10);
const PHASE = process.env.PHASE || 'all';
const SEEDS = parseInt(process.env.SEEDS || '3', 10);
const SHOTS = process.env.SHOTS ? (process.env.SHOT_DIR || '/tmp/levels-shots/') : null;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 4000); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let failed = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failed++; };

const NEW = ['crusher', 'shaft', 'tiers', 'sewer', 'rooftop', 'flooded', 'ring', 'tramyard', 'servers', 'chapel'];
const OLD = ['gauntlet', 'arena', 'warehouse', 'mezzanine', 'gallery', 'cells', 'movers', 'reactor', 'pit', 'bridges', 'tower', 'hall', 'hazard', 'survival', 'elite', 'lobby', 'cache', 'checkpoint', 'miniboss'];
const ARCHES = ONLY || [...NEW, ...OLD];

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__vg && window.__vg.debug);

  if (PHASE === 'all' || PHASE === 'static') {
    console.log('static: ' + ARCHES.length + ' archetypes x 10 themes x 2 mirror x ' + SEEDS + ' seeds');
    const res = await page.evaluate(({ ARCHES, SEEDS }) => {
      const g = window.__vg;
      g.frame = () => {}; g.render = () => {};
      g.startEndless(7);
      const L = g.level, V = g.player.body.pos.constructor;
      const issues = [], stats = {};
      const body = { r: 0.45, h: 1.7 };
      // barrels (pushable, explode) and anything low enough to step onto do not count
      const solidAt = (room, x, y, z, r = body.r, h = body.h) => room.colliders.find((b) => b.active && b.solid && !(b.ref && b.ref.fuse !== undefined) && !b.mover && b.maxY > y + 0.45 && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y + h > b.minY && y < b.maxY);
      let n = 0;
      for (const arch of ARCHES) {
        stats[arch] = { rooms: 0, retries: 0, fallbacks: 0, pockets: 0, buried: 0, free: 0 };
        for (let t = 0; t < 10; t++) for (const mirror of [false, true]) for (let sd = 0; sd < SEEDS; sd++) {
          L.seed = 1000 + sd * 7919 + t * 31;
          const index = 1 + t * 5 + (sd % 4);
          const ctx = { themeObj: L.themeFor(index), cond: 'none', mirror, route: { type: 'combat' }, terminal: sd === 0 ? 'svc-01' : undefined, miniDefs: [], miniVariant: arch === 'miniboss' ? (t + sd * 3) % 7 : undefined };
          const origin = new V(0, 0, -400 - (n++ % 4) * 120);
          let room;
          try { room = L.createRoom(index, arch, () => origin, ctx, true); } catch (e) { issues.push(`${arch} t${t} m${+mirror} s${sd}: build threw ${e.message}`); continue; }
          const st = stats[arch];
          st.rooms++;
          const log = L.genLog || [];
          st.retries += log.length - 1;
          const s = room.spec, tag = `${arch} ${room.theme.id}${mirror ? ' M' : ''} s${sd}`;
          if (s.arch !== arch) { st.fallbacks++; issues.push(`${tag}: fell back to ${s.arch} (${log.map((l) => l.fails.join('+')).join(' / ')})`); }
          const nav = room.nav;
          nav.flow(room.wx(s.entX), room.wz(s.D / 2 - 1.5));
          const reach = (x, z, r = 2) => { const k = nav.nearestFree(room.wx(x), room.wz(z), r); return k >= 0 && nav.dist[k] >= 0; };
          s.exits.forEach((x, i) => { if (!reach(x, -s.D / 2 + 1.5)) issues.push(`${tag}: exit ${i} unreachable`); });
          if (!reach(s.cachePos.x, s.cachePos.z)) issues.push(`${tag}: cache unreachable`);
          for (const tm of s.terminals) {
            if (!tm) { issues.push(`${tag}: terminal missing`); continue; }
            const side = tm.x < 0 ? -1 : 1, ty = tm.y || 0;
            if (!ty && !reach(tm.x, tm.z, 3)) issues.push(`${tag}: terminal unreachable at ${tm.x.toFixed(1)},${tm.z.toFixed(1)}`);
            // the screen and the spot in front of it must be clear
            const fx = room.wx(side * (s.W / 2 - 1.2)), fz = room.wz(tm.z);
            const hb = solidAt(room, fx, ty + 0.05, fz, 0.3, 1.5);
            if (hb) issues.push(`${tag}: terminal front blocked at ${tm.x.toFixed(1)},${tm.z.toFixed(1)} y ${ty} in box x ${(hb.minX - room.origin.x).toFixed(1)}..${(hb.maxX - room.origin.x).toFixed(1)} y ${hb.minY.toFixed(2)}..${hb.maxY.toFixed(2)} z ${(hb.minZ - room.origin.z).toFixed(1)}..${(hb.maxZ - room.origin.z).toFixed(1)} nav ${hb.nav} tag ${hb.tag}`);
          }
          for (const sc of s.secrets) if (!reach(sc.side * (s.W / 2 - 1.5), sc.z, 2)) issues.push(`${tag}: secret alcove unreachable at z ${sc.z.toFixed(1)}`);
          // every free cell is a potential spawn: it must be reachable and empty
          const c = { x: 0, z: 0 };
          let pockets = 0, buried = 0, free = 0;
          for (let k = 0; k < nav.nx * nav.nz; k++) {
            if (!nav.free(k)) continue;
            if (room.hazardAt && room.hazardAt(nav.center(k, c).x, c.z, 0)) continue;
            free++;
            nav.center(k, c);
            if (nav.dist[k] < 0) pockets++;
            const y = room.floorAt(c.x, c.z) + 0.05;
            const hit = solidAt(room, c.x, y, c.z, 0.3, 1.6);
            if (hit) { buried++; if (buried === 1) issues.push(`${tag}: buried cell at ${(c.x - room.origin.x).toFixed(1)},${(c.z - room.origin.z).toFixed(1)} y ${y.toFixed(2)} in box x ${(hit.minX - room.origin.x).toFixed(1)}..${(hit.maxX - room.origin.x).toFixed(1)} y ${hit.minY.toFixed(2)}..${hit.maxY.toFixed(2)} z ${(hit.minZ - room.origin.z).toFixed(1)}..${(hit.maxZ - room.origin.z).toFixed(1)} nav ${hit.nav} tag ${hit.tag}`); }
          }
          st.pockets += pockets; st.buried += buried; st.free += free;
          if (pockets) issues.push(`${tag}: ${pockets} free nav cells unreachable from the entrance`);
          if (buried) issues.push(`${tag}: ${buried} free nav cells inside geometry`);
          if (free < 40) issues.push(`${tag}: only ${free} free nav cells`);
          // nothing floats: raised props rest on something (or hang from the ceiling)
          for (const p of s.props) {
            if (p.y0 <= 0.05 || p.y1 >= s.H - 0.1 || p.catwalk || p.canopy || p.girder || p.sign) continue;
            const sup = [...s.props, ...s.breakables].some((q) => q !== p && Math.abs(q.y1 - p.y0) < 0.06 && q.x0 < p.x1 && q.x1 > p.x0 && q.z0 < p.z1 && q.z1 > p.z0);
            if (!sup) issues.push(`${tag}: ${p.mat} prop floats at y ${p.y0.toFixed(2)}`);
          }
          for (const c of s.cyl) if (c.y0 > 0.05 && !s.props.some((q) => Math.abs(q.y1 - c.y0) < 0.06 && q.x0 <= c.x && q.x1 >= c.x && q.z0 <= c.z && q.z1 >= c.z)) issues.push(`${tag}: ${c.mat} cylinder floats at y ${c.y0}`);
          // perches: something underneath, nothing on top
          for (const p of s.perches) {
            const x = room.wx((p.x0 + p.x1) / 2), z = room.wz((p.z0 + p.z1) / 2);
            const under = room.colliders.some((b) => b.active && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && Math.abs(b.maxY - p.y) < 0.12);
            if (!under) issues.push(`${tag}: perch at y ${p.y} floats`);
            if (solidAt(room, x, p.y + 0.05, z, 0.3, 1.6)) issues.push(`${tag}: perch at y ${p.y} is buried`);
          }
          // doors: the cells just inside the entrance / exits must be walkable
          const doorFree = (x, z) => { const k = nav.idx(room.wx(x), room.wz(z)); return k >= 0 && nav.free(k) && nav.dist[k] >= 0; };
          if (!doorFree(s.entX, s.D / 2 - 1.5) && !doorFree(s.entX + 0.6, s.D / 2 - 1.5) && !doorFree(s.entX - 0.6, s.D / 2 - 1.5)) issues.push(`${tag}: entrance blocked`);
          room.dispose();
          g.scene.remove(room.group);
          L.rooms.splice(L.rooms.indexOf(room), 1);
          L.rebuildColliders();
        }
      }
      return { issues, stats, geos: g.renderer.r.info.memory.geometries };
    }, { ARCHES, SEEDS });
    for (const [a, s] of Object.entries(res.stats)) console.log(`  ${a.padEnd(11)} rooms ${s.rooms} retries ${s.retries} fallbacks ${s.fallbacks} pockets ${s.pockets} buried ${s.buried} avgFree ${(s.free / Math.max(1, s.rooms)).toFixed(0)}`);
    const byKind = {};
    for (const i of res.issues) { const k = i.split(' ')[0] + ': ' + i.replace(/^\S+ \S+( M)? s\d+: /, '').replace(/ in box.*/, '').replace(/[-\d.,]+/g, '#'); byKind[k] = (byKind[k] || 0) + 1; }
    const LIM = parseInt(process.env.LIM || '60', 10);
    for (const i of res.issues.filter((x) => !x.includes(' M ')).slice(0, LIM)) console.log('    ' + i);
    console.log('  issue kinds:');
    for (const [k, v] of Object.entries(byKind)) console.log('    ' + String(v).padStart(4) + '  ' + k);
    ok(res.issues.length === 0, 'static: every archetype builds clean in every theme (' + res.issues.length + ' issues)');
  }

  if (PHASE === 'all' || PHASE === 'play') {
    console.log('play: walk into each archetype, let the AI run, then clear it');
    for (const arch of (ONLY || NEW)) {
      for (const mirror of [false, true]) {
        const r = await page.evaluate(({ arch, mirror }) => {
          const g = window.__vg;
          g.frame = () => {}; g.render = () => {};
          g.startEndless(31 + arch.length + (mirror ? 100 : 0));
          g.debug.god(true);
          const L = g.level;
          const orig = L.pickArch;
          L.pickArch = () => arch;
          if (mirror) { const cb = L.createRoom.bind(L); L.createRoom = (i, a, o, ctx, hc) => cb(i, a, o, { ...ctx, mirror: true }, hc); }
          const out = { violations: [], cleared: false, enemiesSeen: 0, fell: 0 };
          const step = (n) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
          // leave the lobby
          const lobby = L.current;
          if (lobby.routes.length) g.chooseExit(0);
          step(30);
          const nx = L.next;
          if (!nx) { L.pickArch = orig; return { error: 'no next room' }; }
          g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2));
          g.player.body.vel.set(0, 0, 0);
          step(90);
          const room = L.current;
          out.arch = room.spec.arch;
          const s = room.spec, nav = room.nav;
          // wander: the player strafes around the middle of the room; the AI chases
          for (let sec = 0; sec < 22; sec++) {
            for (let f = 0; f < 60; f++) {
              g.input.held.fwd = sec % 4 < 2; g.input.held.back = sec % 4 >= 2;
              g.input.held.left = sec % 3 === 0; g.input.held.right = sec % 3 === 2;
              g.tick(1 / 60, 1 / 60);
            }
            out.enemiesSeen = Math.max(out.enemiesSeen, g.enemies.list.filter((e) => e.alive).length);
            if (sec >= 6 && sec % 4 === 2) {
              nav.flow(room.wx(s.entX), room.wz(s.D / 2 - 1.5));
              for (const e of g.enemies.list) {
                if (!e.alive || e.flying || e.perch || !e.body || e.latched) continue;
                // walkers up on a deck (tiers, balconies, docks) can always step or drop off its edge:
                // the edge, and free floor beyond it, is a few cells away. Nothing walkable is above 6 m.
                const p = e.body.pos, k = nav.nearestFree(p.x, p.z, p.y > 0.5 ? 4 : 1);
                const okCell = k >= 0 && nav.dist[k] >= 0;
                if (!okCell || p.y > 6) out.violations.push(`${e.type} at ${(p.x - room.origin.x).toFixed(1)},${p.y.toFixed(2)},${(p.z - room.origin.z).toFixed(1)} ${okCell ? 'too high' : 'off-nav'} (t ${sec}s)`);
              }
            }
          }
          for (const k of ['fwd', 'back', 'left', 'right']) g.input.held[k] = false;
          // clear: kill everything until the director says the room is done
          for (let k = 0; k < 60 && room.state !== 'cleared'; k++) {
            g.debug.killAll(); g.director.waveT = -99; step(30);
          }
          out.cleared = room.state === 'cleared';
          out.state = room.state;
          L.pickArch = orig;
          return out;
        }, { arch, mirror });
        if (r.error) { ok(false, `${arch}${mirror ? ' M' : ''}: ${r.error}`); continue; }
        const uniq = [...new Set(r.violations.map((v) => v.replace(/ at .*\(t/, ' (t')))];
        if (r.violations.length) console.log('    ' + r.violations.slice(0, 6).join('\n    '));
        ok(r.arch === arch && r.cleared && r.violations.length === 0, `${arch}${mirror ? ' M' : ''}: arch=${r.arch} enemies=${r.enemiesSeen} cleared=${r.cleared} violations=${r.violations.length} ${uniq.slice(0, 3).join('; ')}`);
      }
    }
  }

  if (PHASE === 'all' || PHASE === 'features') {
    console.log('features: lifts, crushers, trams, crumbling floors, water, vents, secrets, breakables, switches');
    const r = await page.evaluate(() => {
      const g = window.__vg;
      g.frame = () => {}; g.render = () => {};
      const out = {};
      const step = (n) => { for (let i = 0; i < n; i++) g.tick(1 / 60, 1 / 60); };
      // build a cleared room of `arch` and stand at its entrance
      const enter = (arch, seed = 11) => {
        g.startEndless(seed);
        g.debug.god(true);
        const L = g.level, o = L.pickArch;
        L.pickArch = () => arch;
        g.chooseExit(0);
        L.pickArch = o;
        step(20);
        const nx = L.next;
        g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2));
        step(30);
        g.director.active = false;
        for (const e of g.enemies.list) if (e.alive) g.combat.damageEnemy(e, 1e6, { source: 'hazard', fromPlayer: false });
        step(20);
        g.player.invuln = 0;
        return L.current;
      };
      const P = g.player, b = P.body;
      // lift: stand on a lift at the bottom, ride it to the catwalk
      {
        const room = enter('shaft');
        const m = room.movers.find((x) => x.kind === 'lift');
        const t0 = room.time;
        // wait for the bottom of the cycle, then step on
        let k = 0;
        while (m.ly > 0.05 && k++ < 900) step(1);
        b.pos.set(m.col.minX + m.w / 2, m.col.maxY + 0.05, m.col.minZ + m.d / 2); b.vel.set(0, 0, 0);
        let top = 0;
        for (let i = 0; i < 9 * 60; i++) { step(1); top = Math.max(top, b.pos.y); }
        out.lift = { top: +top.toFixed(2), liftTop: m.y + m.ay, waited: k, dt: +(room.time - t0).toFixed(1) };
      }
      // crusher: stand under a head just before it drops
      {
        const room = enter('crusher');
        const c = room.crushers[0];
        let k = 0;
        const P0 = c.period;
        while (k++ < 900) { const ph = ((room.time + c.phase) % P0 + P0) % P0; if (ph > P0 - 0.5) break; step(1); }
        b.pos.set(room.wx(c.x), 0.05, room.wz(c.z)); b.vel.set(0, 0, 0);
        const hp0 = P.hp;
        let inside = 0;
        for (let i = 0; i < 90; i++) { step(1); const col = c.col; if (b.pos.x > col.minX + 0.05 && b.pos.x < col.maxX - 0.05 && b.pos.z > col.minZ + 0.05 && b.pos.z < col.maxZ - 0.05 && b.pos.y < c.bottom && b.pos.y + b.h > col.minY) inside++; }
        out.crusher = { dmg: Math.round(hp0 - P.hp), insideFrames: inside };
        // breaker: shoot the switch, presses stop
        const sw = room.switches[0];
        if (sw) { g.level.hitBarrel(sw.col.ref); step(120); out.crusher.powerOff = +room.powerOff.toFixed(1); out.crusher.headUp = room.crushers.every((x) => x.bottom > 2); }
      }
      // tram: stand on the rails in front of a tram that is about to leave
      {
        const room = enter('tramyard');
        const m = room.movers.find((x) => x.kind === 'tram');
        let k = 0;
        while (k++ < 1200) { step(1); if (m.speed > 4) break; }
        const ahead = m.dirX;
        b.pos.set(m.col.minX + m.w / 2 + ahead * (m.w / 2 + 2.5), 0.05, m.col.minZ + m.d / 2); b.vel.set(0, 0, 0);
        const hp0 = P.hp;
        let inside = 0;
        for (let i = 0; i < 120; i++) { step(1); const c = m.col; if (b.pos.x > c.minX + 0.1 && b.pos.x < c.maxX - 0.1 && b.pos.z > c.minZ + 0.1 && b.pos.z < c.maxZ - 0.1 && b.pos.y < c.maxY - 0.2) inside++; }
        out.tram = { dmg: Math.round(hp0 - P.hp), insideFrames: inside };
      }
      // crumbling crypt floor: step on a tile, it gives way, it regrows later
      {
        const room = enter('chapel');
        const d = room.destructibles.find((x) => x.type === 'crumble');
        b.pos.set(d.c.x, 0.05, d.c.z); b.vel.set(0, 0, 0);
        step(5);
        const t0 = d.t;
        step(60);
        const broken = d.broken;
        let fell = 0;
        for (let i = 0; i < 240; i++) { step(1); fell = Math.min(fell, b.pos.y); }
        const hp0 = P.hp;
        step(60 * 8);
        const regrown = !d.broken;
        // walk out of the crypt up the stairwell at its west end
        const h = room.spec.holes[0];
        b.pos.set(room.wx(h.x0 + 2.0), b.pos.y, room.wz((h.z0 + h.z1) / 2)); b.vel.set(0, 0, 0);
        P.yaw = Math.PI / 2; step(1); if (P.fwd.x > 0) P.yaw = -Math.PI / 2;
        for (let i = 0; i < 150; i++) { g.input.held.fwd = true; step(1); }
        g.input.held.fwd = false;
        out.crumble = { armed: t0 > 0, broken, fell: +fell.toFixed(1), regrown, walkedOut: b.pos.y > -0.1, voidDmg: Math.round(hp0 - P.hp) };
      }
      // water drags
      {
        const room = enter('flooded');
        const w = room.waters[0];
        const run = (x, z) => {
          b.pos.set(x, 0.05, z); b.vel.set(0, 0, 0); P.yaw = Math.PI / 2;
          for (let i = 0; i < 60; i++) { g.input.held.fwd = true; step(1); }
          g.input.held.fwd = false;
          return Math.hypot(b.vel.x, b.vel.z);
        };
        const wet = run((w.wx0 + w.wx1) / 2 + 3, (w.wz0 + w.wz1) / 2 + 4);
        const sw = room.switches[0];
        g.level.hitBarrel(sw.col.ref);
        step(150);
        const drained = run((w.wx0 + w.wx1) / 2 + 3, (w.wz0 + w.wz1) / 2 + 4);
        out.water = { wet: +wet.toFixed(1), drained: +drained.toFixed(1) };
      }
      // steam vent launches
      {
        const room = enter('shaft');
        const v = room.vents[0];
        let vy = 0;
        for (let i = 0; i < 300; i++) { if (b.grounded) b.pos.set(v.wx, 0.05, v.wz); step(1); vy = Math.max(vy, b.vel.y); }
        out.vent = { vy: +vy.toFixed(1) };
      }
      // secret: blast the cracked panel open, the alcove pays out
      {
        let room = null;
        for (let sd = 1; sd < 30 && !(room && room.secretList.length); sd++) room = enter('sewer', sd);
        const sc = room.secretList[0];
        const d = room.destructibles.find((x) => x.secret === 0);
        const ev = []; g.on('secret', () => ev.push(1));
        const before = g.pickups.list.length;
        g.level.hitBarrel(d.col.ref); // bullets only thunk
        const afterShot = d.broken;
        g.level.blastBarrels(d.c, 3);
        g.level.blastBarrels(d.c, 3);
        step(5);
        out.secret = { shotProof: !afterShot, opened: d.broken, event: ev.length, pickups: g.pickups.list.length - before, side: sc.side };
      }
      // racks short out when broken; nav opens up
      {
        const room = enter('servers');
        const d = room.destructibles.find((x) => x.type === 'rack');
        for (let i = 0; i < 10 && !d.broken; i++) g.level.hitBarrel(d.col.ref);
        step(30);
        const k = room.nav.idx(d.c.x, d.c.z);
        out.rack = { broken: d.broken, navFree: room.nav.free(k) };
      }
      return out;
    });
    console.log('  ' + JSON.stringify(r));
    ok(r.lift.top > r.lift.liftTop - 0.3, `lift carries the player up (${r.lift.top} of ${r.lift.liftTop})`);
    ok(r.crusher.dmg >= 30 && r.crusher.insideFrames === 0, `crusher hits and shoves clear (dmg ${r.crusher.dmg}, inside ${r.crusher.insideFrames})`);
    ok(r.crusher.powerOff > 0 && r.crusher.headUp, `breaker stops the presses (powerOff ${r.crusher.powerOff})`);
    ok(r.tram.dmg >= 15 && r.tram.insideFrames < 3, `tram hits and never swallows the player (dmg ${r.tram.dmg}, inside ${r.tram.insideFrames})`);
    ok(r.crumble.armed && r.crumble.broken && r.crumble.regrown && r.crumble.fell < -2 && r.crumble.fell > -3.5 && r.crumble.walkedOut, `crypt floor crumbles into a crypt you can walk out of, then regrows (${JSON.stringify(r.crumble)})`);
    ok(r.water.wet < r.water.drained - 1, `water slows you, draining it frees you (${r.water.wet} vs ${r.water.drained})`);
    ok(r.vent.vy > 10, `steam vent launches (${r.vent.vy})`);
    ok(r.secret.shotProof && r.secret.opened && r.secret.event === 1 && r.secret.pickups >= 2, `secret wall: bullet-proof, blasts open, pays out (${JSON.stringify(r.secret)})`);
    ok(r.rack.broken && r.rack.navFree, `server racks break and free the aisle (${JSON.stringify(r.rack)})`);
  }

  if (PHASE === 'all' || PHASE === 'minis') {
    console.log('minis: every miniboss arena layout with real minis (normal + mirrored)');
    const NV = 7;
    for (let v = 0; v < NV; v++) for (const mirror of [false, true]) {
      const r = await page.evaluate(({ v, mirror }) => {
        const g = window.__vg;
        g.frame = () => {}; g.render = () => {};
        g.profile.v.tutorialDone = true;
        const step = (n, fn) => { for (let f = 0; f < n; f++) { if (fn) fn(f); g.tick(1 / 60, 1 / 60); } };
        g.newCampaign(0, true);
        g.debug.god(true);
        const L = g.level, cb = L.createRoom.bind(L);
        L.createRoom = (i, a, o, ctx, hc) => cb(i, a, o, { ...ctx, miniVariant: v, mirror }, hc);
        // a different level (and so different minis and stratum) per layout
        g.debug.goLevel(v * 4 + (mirror ? 2 : 0));
        for (let k = 0; k < 3; k++) {
          const room = L.current;
          if (room.state === 'combat') { for (let t = 0; t < 40 && room.state === 'combat'; t++) { g.debug.killAll(); g.director.waveT = -99; step(20); } }
          for (const p of g.pickups.list.slice()) if (p.kind === 'cache') { g.pickups.collect(p); while (g.state === 'reward') g.chooseReward(0); }
          g.chooseExit(0);
          const nx = L.next;
          g.player.spawnAt(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2), 0);
          step(5);
          if (g.cutscene.active) g.cutscene.finish(true);
        }
        L.createRoom = cb;
        const room = L.current, s = room.spec, nav = room.nav;
        const out = { arch: s.arch, variant: s.miniVariant, name: s.name, theme: room.theme.id, minis: [], violations: [] };
        if (g.cutscene.active) g.cutscene.finish(true);
        const minis = g.director.minis.slice();
        const track = minis.map((m) => ({ id: m.def.id, x0: m.pos.x, z0: m.pos.z, moved: 0, maxY: 0 }));
        // the player circles the middle of the arena for 24 s while the minis and escorts fight
        step(60 * 24, (f) => {
          const t = f / 60;
          g.input.held.fwd = (t | 0) % 4 < 2; g.input.held.back = !g.input.held.fwd;
          g.input.held.left = (t / 3 | 0) % 2 === 0; g.input.held.right = !g.input.held.left;
          if (f % 60 === 0) minis.forEach((m, i) => { if (!m.alive) return; const tr = track[i]; tr.moved = Math.max(tr.moved, Math.hypot(m.pos.x - tr.x0, m.pos.z - tr.z0)); tr.maxY = Math.max(tr.maxY, m.pos.y); });
          if (f % 240 === 120 && f > 360) {
            nav.flow(room.wx(s.entX), room.wz(s.D / 2 - 1.5));
            for (const e of g.enemies.list) {
              if (!e.alive || e.flying || e.perch || !e.body || e.latched || e.hoverH) continue;
              const k = nav.nearestFree(e.pos.x, e.pos.z, 1.5);
              if (k < 0 || nav.dist[k] < 0) out.violations.push(`${e.mini ? 'mini ' + e.def.id : e.type} off-nav at ${(e.pos.x - room.origin.x).toFixed(1)},${(e.pos.z - room.origin.z).toFixed(1)} y ${e.pos.y.toFixed(1)}`);
            }
          }
        });
        for (const k of ['fwd', 'back', 'left', 'right']) g.input.held[k] = false;
        out.minis = track.map((t) => ({ id: t.id, moved: +t.moved.toFixed(1), maxY: +t.maxY.toFixed(1) }));
        out.anchoredMinis = minis.filter((m) => m.anchored || m.def.move === 'stationary').length;
        for (const m of minis) if (m.alive) g.combat.damageEnemy(m, 1e6, { source: 'hitscan', point: m.centerPos().clone() });
        step(60 * 4);
        for (let t = 0; t < 20 && room.state === 'combat'; t++) { g.debug.killAll(); step(30); }
        out.state = room.state;
        out.door = room.exitDoors.map((d) => d.state).join(',');
        return out;
      }, { v, mirror });
      const still = r.minis.filter((m) => m.moved < 1.5);
      if (r.violations.length) console.log('    ' + r.violations.slice(0, 4).join('\n    '));
      ok(r.arch === 'miniboss' && r.variant === v && r.state === 'cleared' && !r.violations.length && still.length <= r.anchoredMinis,
        `mini layout ${v}${mirror ? ' M' : ''} ${r.name} (${r.theme}): ${r.minis.map((m) => `${m.id} moved ${m.moved}`).join(', ')} -> ${r.state}, doors ${r.door}`);
    }
  }

  if (SHOTS) {
    console.log('shots -> ' + SHOTS);
    for (const arch of (ONLY || NEW)) {
      for (const view of ['spawn', 'top']) {
        await page.evaluate(({ arch, view }) => {
          const g = window.__vg;
          g.frame = () => {}; g.render = () => {};
          if (!g.level.current || g.level.current.spec.arch !== arch) {
            g.startEndless(5 + arch.length);
            g.debug.god(true);
            const L = g.level, orig = L.pickArch;
            L.pickArch = () => arch;
            g.chooseExit(0);
            for (let i = 0; i < 30; i++) g.tick(1 / 60, 1 / 60);
            const nx = L.next;
            g.player.body.pos.set(nx.wx(nx.spec.entX), 0.1, nx.wz(nx.D / 2 - 2));
            for (let i = 0; i < 120; i++) g.tick(1 / 60, 1 / 60);
            g.debug.killAll();
            for (let i = 0; i < 60; i++) g.tick(1 / 60, 1 / 60);
            L.pickArch = orig;
          }
          const room = g.level.current, s = room.spec, cam = g.camera;
          if (view === 'top') {
            g.player.body.pos.set(room.wx(0), 0.1, room.wz(s.D / 2 - 2));
            for (let i = 0; i < 2; i++) g.tick(1 / 60, 1 / 60);
            cam.position.set(room.wx(0), Math.min(s.H - 0.6, 40), room.wz(s.D / 2 + 0.5));
            cam.lookAt(room.wx(0), 0, room.wz(-s.D / 8));
            cam.updateMatrixWorld();
          } else {
            g.player.body.pos.set(room.wx(s.entX), 0.1, room.wz(s.D / 2 - 1.5));
            g.player.yaw = 0; g.player.pitch = -0.05;
            for (let i = 0; i < 2; i++) g.tick(1 / 60, 1 / 60);
          }
          Object.getPrototypeOf(g).render.call(g);
        }, { arch, view });
        await page.screenshot({ path: `${SHOTS}${arch}-${view}.png` });
      }
    }
  }
} catch (e) {
  console.error(e);
  failed++;
}
if (errors.length) { console.log('page errors:\n  ' + errors.slice(0, 10).join('\n  ')); failed++; }
await browser.close();
server.kill();
console.log(failed ? `LEVELS FAILED (${failed})` : 'LEVELS OK');
process.exit(failed ? 1 : 0);
