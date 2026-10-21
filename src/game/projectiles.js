import * as THREE from 'three';
import { segPointDist2, raySphere } from '../core/collide.js';
import { BB } from './fx.js';

const ROCKET_FIRE = { mode: 0, drag: 2 };
const TRAIL_SMOKE = { mode: 1, drag: 1.5, grav: -0.4 };

// All projectiles live in one bounded pool rendered by a single instanced mesh.
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.cap = game.lowPower ? 140 : 220;
    this.list = [];
    for (let i = 0; i < this.cap; i++) this.list.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), color: new THREE.Color() });
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = this.cap;
    const c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < this.cap; i++) this.mesh.setColorAt(i, c);
    game.scene.add(this.mesh);
    // glow shells (additive, larger) for readability
    this.glow = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), this.cap);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    for (let i = 0; i < this.cap; i++) this.glow.setColorAt(i, c);
    game.scene.add(this.glow);
    // motion streaks: a tapered additive tail behind every shot, bright at the shot and fading
    // out behind it (vertex colours), so direction and speed read at a glance. One more draw.
    const tail = new THREE.ConeGeometry(1, 1, 5, 1, true);
    tail.rotateX(Math.PI / 2); tail.translate(0, 0, 0.5);
    const tp = tail.getAttribute('position'), tcol = new Float32Array(tp.count * 3);
    for (let i = 0; i < tp.count; i++) { const k = 1 - tp.getZ(i); tcol[i * 3] = tcol[i * 3 + 1] = tcol[i * 3 + 2] = k * k; }
    tail.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    this.tail = new THREE.InstancedMesh(tail, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), this.cap);
    this.tail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tail.frustumCulled = false;
    for (let i = 0; i < this.cap; i++) this.tail.setColorAt(i, c);
    game.scene.add(this.tail);
    this.white = new THREE.Color(1, 1, 1); this.yellow = new THREE.Color(0xffe23a); this.tc = new THREE.Color(); this.gc = new THREE.Color();
    this.zAxis = new THREE.Vector3(0, 0, 1); this.q2 = new THREE.Quaternion();
    this.eye = new THREE.Vector3(); this.parryR = 3.2;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.d = new THREE.Vector3(); this.rd = new THREE.Vector3();
    this.dark = new THREE.Color(0.25, 0.25, 0.28);
  }

  alloc() {
    for (const p of this.list) if (!p.active) return p;
    // recycle the oldest
    let o = this.list[0];
    for (const p of this.list) if (p.age > o.age) o = p;
    return o;
  }

  spawn(opts) {
    const p = this.alloc();
    p.active = true;
    p.pos.copy(opts.pos); p.prev.copy(opts.pos);
    p.vel.copy(opts.vel);
    p.dmg = opts.dmg || 10;
    p.r = opts.radius || 0.18;
    p.size = opts.size || p.r;
    p.color.setHex(opts.color || 0xff5030);
    p.life = opts.life || 5;
    p.age = 0;
    p.kind = opts.kind || 'orb';
    p.friendly = !!opts.friendly;
    p.gravity = opts.gravity || 0;
    p.parryable = opts.parryable !== false;
    p.explode = opts.explode || 0;
    p.homing = opts.homing || 0;
    p.cause = opts.cause || 'ENEMY FIRE';
    p.tip = opts.tip || 'Strafe and dash to dodge projectiles. Parry them back with the punch.';
    p.owner = opts.owner || null;
    p.cluster = opts.cluster || 0;
    p.marker = opts.marker || null;
    p.spin = Math.random() * 6;
    p.trail = opts.trail !== false;
    p.bounces = opts.kind === 'saw' ? 3 : (opts.bounces || 0);
    p.hitMap = null;
    p.stuck = false; p.stuckTo = null;
    p.dodged = false; p.boosted = false; p.frozen = false; p.freezeAt = opts.freezeAt || 0;
    p.cued = false;
    p.direct = opts.direct || 0;
    return p;
  }

  spawnEnemy(pos, vel, dmg, opts = {}) {
    return this.spawn({ pos, vel, dmg, ...opts, friendly: false });
  }

  spawnGrenade(pos, vel, opts) {
    return this.spawn({ pos, vel, dmg: opts.dmg, radius: 0.16, size: 0.14, color: 0xff4020, life: 3, kind: 'grenade', friendly: true, gravity: 16, explode: opts.radius, parryable: false, cluster: opts.cluster });
  }

  // Mortar shot with a ground telegraph at the predicted impact point.
  spawnMortar(from, target, dmg, radius, flightTime, opts = {}) {
    const g = 18;
    const vel = new THREE.Vector3(
      (target.x - from.x) / flightTime,
      (target.y - from.y + 0.5 * g * flightTime * flightTime) / flightTime,
      (target.z - from.z) / flightTime,
    );
    const marker = this.game.fx.telegraphDisc(target.x, target.y, target.z, radius, opts.color || 0xff5020, flightTime);
    return this.spawn({ pos: from, vel, dmg, radius: 0.3, size: 0.32, color: opts.color || 0xff7020, life: flightTime + 1, kind: 'mortar', gravity: g, explode: radius, marker, cause: opts.cause || 'MORTAR', tip: 'Mortars show a red circle where they will land. Leave it before it fills.', parryable: true });
  }

  tryParry(eye, dir, range) {
    let best = null, bd = range;
    for (const p of this.list) {
      if (!p.active || p.friendly || !p.parryable) continue;
      const v = this.tmp.subVectors(p.pos, eye);
      const d = v.length();
      if (d > bd) continue;
      if (d > 0.5 && v.dot(dir) / d < 0.45) continue;
      bd = d; best = p;
    }
    if (!best) return null;
    const g = this.game;
    best.friendly = true;
    best.homing = 0;
    best.gravity = 0;
    if (best.marker) { best.marker.life = 0; best.marker.mesh.visible = false; best.marker = null; }
    const speed = Math.max(45, best.vel.length() * 1.6);
    // aim the reflected shot at whatever the crosshair points at, or straight ahead
    best.vel.copy(dir).multiplyScalar(speed);
    best.dmg = best.dmg * 4 * g.player.stats.parryMul + 30;
    best.explode = Math.max(best.explode, 2.5);
    best.color.setHex(0xffe23a);
    best.life = 3;
    best.parried = true;
    g.fx.sparksBurst(best.pos, 0xffe23a, 18, 8, 0.4);
    return best;
  }

  // Perfect-dodge probe: hostile shots whose path passes through the player within `horizon`
  // seconds are marked dodged (they fly through instead of hitting). Returns how many.
  nearMiss(cx, cy, cz, horizon) {
    let n = 0;
    for (const p of this.list) {
      if (!p.active || p.friendly || p.dodged) continue;
      const rx = cx - p.pos.x, ry = cy - p.pos.y, rz = cz - p.pos.z;
      const vv = p.vel.lengthSq();
      if (vv < 1) continue;
      const tc = (rx * p.vel.x + ry * p.vel.y + rz * p.vel.z) / vv;
      if (tc < 0 || tc > horizon) continue;
      const mx = rx - p.vel.x * tc, my = ry - p.vel.y * tc, mz = rz - p.vel.z * tc;
      const rr = p.r + 0.85 + (p.explode ? 0.5 : 0);
      if (mx * mx + my * my * 0.5 + mz * mz < rr * rr) { p.dodged = true; n++; }
    }
    return n;
  }

  // Punch boost: bat your own grenade / mine / rocket / core shell along the aim direction.
  tryBoost(eye, dir, range, mul = 1) {
    let best = null, bd = range;
    for (const p of this.list) {
      if (!p.active || !p.friendly || p.parried || p.boosted) continue;
      if (p.kind !== 'grenade' && p.kind !== 'sticky' && p.kind !== 'rocket' && p.kind !== 'core') continue;
      if (p.stuckTo) continue; // mines on enemies stay put
      const v = this.tmp.subVectors(p.pos, eye);
      const d = v.length();
      if (d > bd) continue;
      if (d > 0.6 && v.dot(dir) / d < 0.4) continue;
      bd = d; best = p;
    }
    if (!best) return null;
    const p = best;
    const sp = Math.max(40, p.vel.length() * 1.8);
    p.vel.copy(dir).multiplyScalar(sp);
    p.stuck = false; p.frozen = false; p.freezeAt = 0;
    p.gravity *= 0.2;
    p.dmg *= 1.5 * mul;
    p.explode = Math.max(2.5, p.explode * 1.25);
    p.life = Math.max(p.life, 2.5);
    if (p.kind === 'sticky') p.kind = 'grenade'; // a batted mine detonates on contact
    p.boosted = true;
    p.color.setHex(0xffe6a0);
    this.game.fx.sparksBurst(p.pos, 0xffd060, 14, 7, 0.3);
    return p;
  }

  kill(p) {
    p.active = false;
    if (p.marker) { p.marker.life = 0; p.marker.mesh.visible = false; p.marker = null; }
  }

  clear() {
    for (const p of this.list) {
      if (p.marker) { p.marker.life = 0; p.marker.mesh.visible = false; p.marker = null; }
      p.active = false;
    }
  }

  update(dt) {
    const g = this.game;
    const player = g.player;
    const pp = player.body.pos;
    const pcx = pp.x, pcy = pp.y + player.body.h * 0.5, pcz = pp.z;
    // parry cue: hostile parryable shots flare yellow as they enter punch range
    this.eye.copy(g.camera.position);
    this.parryR = 3.2 * (player.stats.parryMul || 1);
    let i = 0;
    for (const p of this.list) {
      if (!p.active) { this.hide(i++); continue; }
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) { this.detonate(p, null); this.hide(i++); continue; }
      if (p.homing && !p.friendly) {
        const to = this.tmp.set(pcx - p.pos.x, pcy - p.pos.y, pcz - p.pos.z).normalize();
        const sp = p.vel.length();
        p.vel.normalize().lerp(to, Math.min(1, p.homing * dt)).normalize().multiplyScalar(sp);
      }
      if (p.stuck) {
        if (p.stuckTo) { if (p.stuckTo.alive) p.pos.copy(p.stuckTo.centerPos()).add(p.stuckOff); else p.stuckTo = null; }
        if (Math.random() < 0.15) g.fx.sparks.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0.5, 0, 1, 0.2, 0.1, 1, 0.1, 0.2, 0, 0);
        this.render(p, i++, dt);
        continue;
      }
      // freezeframe rockets hang in place (their timer pauses) until released
      if (p.freezeAt > 0 && p.age >= p.freezeAt) { p.freezeAt = 0; p.frozen = true; }
      if (p.frozen) {
        p.life += dt;
        if (Math.random() < 0.2) g.fx.sparks.spawn(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), 0.5, 0.85, 1, 1, 0.09, 0.3, 0, 0);
        this.render(p, i++, dt);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      // world collision along the segment
      const d = this.d.subVectors(p.pos, p.prev);
      const len = d.length();
      let hitWorld = null;
      if (len > 0) {
        d.multiplyScalar(1 / len);
        hitWorld = g.combat.rayWorld(p.prev, d, len + p.r * 0.5);
      }
      // actor collision
      let consumed = false;
      if (!p.friendly) {
        if (player.alive && !p.dodged && segPointDist2(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, pcx, pcy, pcz) < (p.r + 0.55) ** 2 &&
            Math.abs(p.pos.y - pcy) < player.body.h * 0.5 + p.r + 0.1) {
          if (p.explode) this.detonate(p, null);
          else {
            const hurt = player.damage(p.dmg, p.prev, p.cause, p.tip);
            if (hurt) { g.fx.blood(p.pos, d, 0.5, [0.8, 0.1, 0.1]); }
          }
          consumed = true;
        }
      } else {
        // enemies
        for (const e of g.enemies.list) {
          if (!e.alive || e === p.owner) continue;
          const c = e.centerPos();
          const rr = e.radius + p.r + 0.15;
          if (segPointDist2(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, c.x, c.y, c.z) < rr * rr * 1.6) {
            if (p.kind === 'saw') {
              if (!p.hitMap) p.hitMap = new Map();
              if ((p.hitMap.get(e) || 0) < g.time) { p.hitMap.set(e, g.time + 0.25); g.combat.damageEnemy(e, p.dmg, { source: 'hitscan', point: p.pos.clone(), dir: d.clone(), knock: 2, stagger: 0.2, quiet: true }); g.fx.blood(p.pos, d, 0.6, e.bloodColor); }
              continue;
            }
            if (p.kind === 'sticky') { p.stuck = true; p.stuckTo = e; p.stuckOff = p.pos.clone().sub(c).multiplyScalar(0.6); p.vel.set(0, 0, 0); g.audio.play('stick', p.pos, 0.6); break; }
            if (p.direct) g.combat.damageEnemy(e, p.direct, { source: 'explosion', point: p.pos.clone(), dir: d.clone(), knock: 4, stagger: 0.3, quiet: true });
            if (p.explode) this.detonate(p, e);
            else g.combat.damageEnemy(e, p.dmg, { source: p.parried ? 'parry' : 'projectile', point: p.pos.clone(), dir: d.clone(), knock: 6, stagger: 0.4 });
            consumed = true; break;
          }
        }
        if (p.stuck) { this.render(p, i++, dt); continue; }
        const boss = g.bosses.active;
        if (!consumed && boss && boss.alive && len > 0) {
          for (const hb of boss.hitboxes()) {
            const t = raySphere(p.prev.x, p.prev.y, p.prev.z, d.x, d.y, d.z, hb.x, hb.y, hb.z, hb.r + p.r, len + 0.01);
            if (t >= 0 && p.kind === 'saw') {
              if ((p.bossHitT || 0) < g.time) { p.bossHitT = g.time + 0.2; g.combat.damageBoss(boss, p.dmg, { source: 'hitscan', part: hb, point: p.pos.clone(), quiet: true }); }
              break;
            }
            if (t >= 0 && p.kind === 'sticky') { p.stuck = true; p.vel.set(0, 0, 0); break; }
            if (t >= 0) {
              if (p.explode) this.detonate(p, null, hb);
              else g.combat.damageBoss(boss, p.dmg, { source: p.parried ? 'parry' : 'projectile', part: hb, point: p.pos.clone() });
              if (p.parried) g.style.add('RETURN TO SENDER', 40);
              consumed = true; break;
            }
          }
        }
      }
      if (!consumed && hitWorld && p.bounces > 0) {
        p.bounces--;
        p.pos.copy(p.prev).addScaledVector(d, Math.max(0, hitWorld.t - 0.05));
        const n = new THREE.Vector3(hitWorld.nx, hitWorld.ny, hitWorld.nz);
        p.vel.addScaledVector(n, -2 * p.vel.dot(n));
        g.fx.sparksBurst(p.pos, 0xc8f8ff, 6, 5, 0.2);
        g.audio.play('ricochet', p.pos, 0.5);
        this.render(p, i++, dt);
        continue;
      }
      if (!consumed && hitWorld && p.kind === 'sticky' && !p.stuck) {
        p.pos.copy(p.prev).addScaledVector(d, Math.max(0, hitWorld.t - 0.05));
        p.stuck = true; p.vel.set(0, 0, 0);
        g.audio.play('stick', p.pos, 0.6);
        this.render(p, i++, dt);
        continue;
      }
      if (!consumed && hitWorld) {
        p.pos.copy(p.prev).addScaledVector(d, Math.max(0, hitWorld.t - 0.05));
        if (hitWorld.box.tag === 'barrel' && hitWorld.box.ref) g.level.hitBarrel(hitWorld.box.ref);
        if (p.explode) this.detonate(p, null);
        else g.fx.impact(p.pos, new THREE.Vector3(hitWorld.nx, hitWorld.ny, hitWorld.nz), 'energy', 0.6);
        consumed = true;
      }
      if (consumed) { p.active = false; if (p.marker) { p.marker.life = 0; p.marker.mesh.visible = false; p.marker = null; } this.hide(i++); continue; }
      if (p.trail && Math.random() < (g.lowPower ? 0.35 : 0.7)) {
        g.fx.sparks.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, p.color.r * 0.8, p.color.g * 0.8, p.color.b * 0.8, 1, p.size * (p.boosted ? 2.4 : 1.4), p.boosted ? 0.3 : 0.15, 0, 0);
        if (p.kind === 'rocket') {
          // exhaust flame at the nozzle and a smoke ribbon behind
          const k = p.size * 1.6 / Math.max(1, p.vel.length());
          g.fx.fire.spawn(p.pos.x - p.vel.x * k, p.pos.y - p.vel.y * k, p.pos.z - p.vel.z * k, -p.vel.x * 0.05, -p.vel.y * 0.05, -p.vel.z * 0.05, p.size * 2.2, p.size * 0.6, BB.FIRE0, BB.FIRE1, 0.12, 1, 1, 1, 1, ROCKET_FIRE);
          g.fx.dust.spawn(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, 0.35, 0.35, 0.38, 0.55, 0.22, 0.5, -0.3, 1.5);
        } else if ((p.kind === 'grenade' || p.kind === 'sticky' || p.kind === 'core') && Math.random() < 0.5) {
          // lobbed shells trail a thin smoke line and a fizzing fuse
          g.fx.smoke.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0.3, 0, p.size * 0.6, p.size * 2.2, BB.SMOKE + (Math.random() * 4 | 0), BB.SMOKE + 3, 0.45, 0.45, 0.45, 0.48, 0.55, TRAIL_SMOKE);
          g.fx.sparks.spawn(p.pos.x, p.pos.y + p.size, p.pos.z, (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, 1, 0.85, 0.4, 1, 0.04, 0.18, 6, 0);
        }
      }
      this.render(p, i++, dt);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.tail.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    if (this.tail.instanceColor) this.tail.instanceColor.needsUpdate = true;
  }

  render(p, i, dt) {
    const g = this.game;
    p.spin += dt * (p.kind === 'saw' ? 40 : p.frozen ? 2 : 8);
    if (p.kind === 'saw') this.q.setFromAxisAngle(this.tmp.set(0, 1, 0), p.spin);
    else if (p.kind === 'rocket') this.q.setFromUnitVectors(this.tmp.set(0, 0, 1), this.rd.copy(p.vel).normalize());
    else this.q.setFromAxisAngle(this.tmp.set(0.3, 1, 0.2).normalize(), p.spin);
    const s = p.size;
    if (p.kind === 'saw') this.s.set(s * 1.6, s * 0.25, s * 1.6);
    else if (p.kind === 'rocket') this.s.set(s * 0.7, s * 0.7, s * 2.2);
    else this.s.set(s, s, s);
    this.m.compose(p.pos, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    // hostile shots get a white-hot core inside their coloured glow so they read against any wall
    const shell = (p.kind === 'grenade' || p.kind === 'sticky' || p.kind === 'rocket') && !p.boosted;
    this.mesh.setColorAt(i, shell ? this.dark : p.friendly ? p.color : this.tc.copy(p.color).lerp(this.white, 0.55));
    let cue = 0;
    if (!p.friendly && p.parryable) {
      const ex = this.eye.x - p.pos.x, ey = this.eye.y - p.pos.y, ez = this.eye.z - p.pos.z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (ex * p.vel.x + ey * p.vel.y + ez * p.vel.z > 0) cue = Math.min(1, Math.max(0, (this.parryR + 2.5 - d) / 2.5));
      if (d < this.parryR && !p.cued && g.player.alive) { p.cued = true; g.fx.glint(p.pos, 0xffe23a, 0.22 + p.size, 0.08); }
    }
    let gs = p.stuck || p.frozen ? s * (2 + Math.sin(g.time * 20) * 0.6) : s * (p.boosted ? 3 : 2.2);
    if (cue > 0) gs *= 1 + cue * (0.15 + 0.1 * Math.sin(g.time * 40));
    this.s.set(gs, gs, gs);
    this.m.compose(p.pos, this.q, this.s);
    this.glow.setMatrixAt(i, this.m);
    const gcol = cue > 0 ? this.gc.copy(p.color).lerp(this.yellow, cue) : p.color;
    this.glow.setColorAt(i, gcol);
    // tail streak along the flight path
    const sp = p.vel.length();
    if (sp > 3 && !p.stuck && !p.frozen) {
      this.rd.copy(p.vel).multiplyScalar(-1 / sp);
      this.q2.setFromUnitVectors(this.zAxis, this.rd);
      const len = Math.min(2.6, sp * (p.friendly ? 0.03 : 0.045)) * (p.kind === 'mortar' ? 0.6 : 1) * Math.min(1, p.age * 12 + 0.2);
      const wd = s * (p.kind === 'saw' ? 0.5 : p.friendly ? 0.75 : 0.95);
      this.s.set(wd, wd, len);
      this.m.compose(p.pos, this.q2, this.s);
    } else this.m.makeScale(0, 0, 0);
    this.tail.setMatrixAt(i, this.m);
    this.tail.setColorAt(i, gcol);
  }

  hide(i) {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
    this.glow.setMatrixAt(i, this.m);
    this.tail.setMatrixAt(i, this.m);
  }

  detonate(p, enemy, bossPart) {
    const g = this.game;
    p.active = false;
    if (p.marker) { p.marker.life = 0; p.marker.mesh.visible = false; p.marker = null; }
    if (!p.explode) return;
    const pos = p.pos.clone();
    const col = p.friendly ? (p.parried ? 0xffe23a : 0xff7a30) : 0xff4020;
    g.fx.explosion(pos, p.explode, col);
    g.audio.play('explosion', pos, 1);
    g.addShake(Math.max(0, 0.5 - pos.distanceTo(g.player.body.pos) * 0.03));
    if (p.friendly) {
      if (p.boosted) { g.fx.ring(pos.x, pos.y, pos.z, p.explode * 1.2, 0xffe6a0, 0.3, 0.2); g.hitstop(0.03); }
      g.combat.radialDamage(pos, p.explode, p.dmg, { source: p.parried ? 'parry' : 'explosion', knock: p.boosted ? 14 : 10, selfKnock: 15, boosted: p.boosted });
      if (p.cluster) {
        for (let k = 0; k < 3 * p.cluster; k++) {
          const v = new THREE.Vector3((Math.random() - 0.5) * 9, 6 + Math.random() * 4, (Math.random() - 0.5) * 9);
          this.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.4, 0)), vel: v, dmg: p.dmg * 0.35, radius: 0.12, size: 0.1, color: 0xff9030, life: 1.2, kind: 'grenade', friendly: true, gravity: 18, explode: 2.2, parryable: false });
        }
      }
    } else {
      g.combat.radialDamage(pos, p.explode, p.dmg, { source: 'explosion', friendly: true, knock: 6, cause: p.cause, tip: p.tip });
    }
  }
}
