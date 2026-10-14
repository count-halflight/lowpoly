import * as THREE from 'three';
import { segPointDist2, raySphere } from '../core/collide.js';

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
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.d = new THREE.Vector3();
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
        if (player.alive && segPointDist2(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, pcx, pcy, pcz) < (p.r + 0.55) ** 2 &&
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
            if (p.explode) this.detonate(p, e);
            else g.combat.damageEnemy(e, p.dmg, { source: p.parried ? 'parry' : 'projectile', point: p.pos.clone(), dir: d.clone(), knock: 6, stagger: 0.4 });
            consumed = true; break;
          }
        }
        const boss = g.bosses.active;
        if (!consumed && boss && boss.alive && len > 0) {
          for (const hb of boss.hitboxes()) {
            const t = raySphere(p.prev.x, p.prev.y, p.prev.z, d.x, d.y, d.z, hb.x, hb.y, hb.z, hb.r + p.r, len + 0.01);
            if (t >= 0) {
              if (p.explode) this.detonate(p, null, hb);
              else g.combat.damageBoss(boss, p.dmg, { source: p.parried ? 'parry' : 'projectile', part: hb, point: p.pos.clone() });
              if (p.parried) g.style.add('RETURN TO SENDER', 40);
              consumed = true; break;
            }
          }
        }
      }
      if (!consumed && hitWorld) {
        p.pos.copy(p.prev).addScaledVector(d, Math.max(0, hitWorld.t - 0.05));
        if (p.explode) this.detonate(p, null);
        else g.fx.impact(p.pos, new THREE.Vector3(hitWorld.nx, hitWorld.ny, hitWorld.nz), 'energy', 0.6);
        consumed = true;
      }
      if (consumed) { p.active = false; if (p.marker) { p.marker.life = 0; p.marker.mesh.visible = false; p.marker = null; } this.hide(i++); continue; }
      // trail
      if (p.trail && Math.random() < (g.lowPower ? 0.35 : 0.7)) {
        g.fx.sparks.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, p.color.r * 0.8, p.color.g * 0.8, p.color.b * 0.8, 1, p.size * 1.4, 0.15, 0, 0);
      }
      // render
      p.spin += dt * 8;
      this.q.setFromAxisAngle(this.tmp.set(0.3, 1, 0.2).normalize(), p.spin);
      const s = p.size;
      this.s.set(s, s, s);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.kind === 'grenade' ? new THREE.Color(0.25, 0.25, 0.28) : p.color);
      this.s.set(s * 2.2, s * 2.2, s * 2.2);
      this.m.compose(p.pos, this.q, this.s);
      this.glow.setMatrixAt(i, this.m);
      this.glow.setColorAt(i, p.color);
      i++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  hide(i) {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
    this.glow.setMatrixAt(i, this.m);
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
      g.combat.radialDamage(pos, p.explode, p.dmg, { source: p.parried ? 'parry' : 'explosion', knock: 10, selfKnock: 15 });
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
