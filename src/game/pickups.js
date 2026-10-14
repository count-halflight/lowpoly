import * as THREE from 'three';
import { DEFS } from './weapons.js';

// Health orbs, ammo boxes, and reward caches. Bounded pool; cleared per room.
export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.cap = 40;
    this.geoHp = new THREE.OctahedronGeometry(0.22, 0);
    this.geoAmmo = new THREE.BoxGeometry(0.4, 0.26, 0.28);
    this.geoCache = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.geoBeam = new THREE.CylinderGeometry(0.5, 0.5, 14, 8, 1, true);
    this.matHp = new THREE.MeshBasicMaterial({ color: 0xff3050 });
    this.matAmmo = new THREE.MeshBasicMaterial({ color: 0xffd040 });
    this.matCache = new THREE.MeshBasicMaterial({ color: 0x3ef0d0 });
    this.matBeam = new THREE.MeshBasicMaterial({ color: 0x3ef0d0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.cacheColors = { standard: 0x3ef0d0, rare: 0xc060ff, boss: 0xffc040, supply: 0x60ff90 };
  }

  spawn(kind, pos, extra = {}) {
    if (this.list.length >= this.cap) {
      const i = this.list.findIndex((p) => p.kind !== 'cache');
      if (i >= 0) this.remove(this.list[i]);
    }
    let mesh;
    if (kind === 'hp') mesh = new THREE.Mesh(this.geoHp, this.matHp);
    else if (kind === 'ammo') mesh = new THREE.Mesh(this.geoAmmo, this.matAmmo);
    else {
      mesh = new THREE.Group();
      const col = this.cacheColors[extra.reward] || 0x3ef0d0;
      const cube = new THREE.Mesh(this.geoCache, new THREE.MeshBasicMaterial({ color: col, wireframe: false }));
      const inner = new THREE.Mesh(this.geoCache, new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
      inner.scale.setScalar(0.8);
      cube.scale.set(1, 1, 1);
      const beam = new THREE.Mesh(this.geoBeam, this.matBeam.clone());
      beam.material.color.setHex(col);
      beam.position.y = 7;
      mesh.add(cube, beam);
      mesh.userData.cube = cube; mesh.userData.inner = inner; mesh.userData.beam = beam;
    }
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const p = { kind, mesh, pos: mesh.position, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3), t: 0, life: kind === 'cache' ? Infinity : 20, ...extra };
    if (kind === 'cache') p.vel.set(0, 0, 0);
    this.list.push(p);
    return p;
  }

  onEnemyKilled(e) {
    const g = this.game;
    const pl = g.player;
    const low = pl.hp < pl.stats.maxHp * 0.4;
    const c = e.centerPos().clone();
    const hpChance = (low ? 0.5 : 0.22) + (e.elite ? 0.4 : 0);
    if (Math.random() < hpChance) this.spawn('hp', c);
    const needy = g.weapons.neediest();
    if (needy && Math.random() < (e.elite ? 0.9 : 0.4)) this.spawn('ammo', c.clone().add(new THREE.Vector3(0.3, 0, 0)), { weapon: needy });
  }

  spawnCache(pos, reward) {
    this.spawn('cache', pos.clone().setY(1.0), { reward });
    this.game.audio.play('cache', pos, 0.8);
  }

  remove(p) {
    this.game.scene.remove(p.mesh);
    if (p.kind === 'cache') { p.mesh.userData.cube.material.dispose(); p.mesh.userData.inner.material.dispose(); p.mesh.userData.beam.material.dispose(); }
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  clear(keepCaches = false) {
    for (const p of this.list.slice()) if (!keepCaches || p.kind !== 'cache') this.remove(p);
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    const pp = pl.body.pos;
    const cs = g.level.colliders;
    for (const p of this.list.slice()) {
      p.t += dt;
      p.life -= dt;
      if (p.life <= 0) { this.remove(p); continue; }
      if (p.kind !== 'cache') {
        const dx = pp.x - p.pos.x, dy = pp.y + 0.9 - p.pos.y, dz = pp.z - p.pos.z;
        const d = Math.hypot(dx, dy, dz);
        const want = p.kind === 'hp' ? pl.hp < pl.stats.maxHp : this.ammoWanted(p);
        if (want && d < pl.stats.magnet && p.t > 0.4) {
          const s = 14 / Math.max(0.3, d);
          p.vel.set(dx * s * 0.3, dy * s * 0.3, dz * s * 0.3);
        } else {
          p.vel.y -= 18 * dt;
          p.vel.x *= 1 - dt * 2; p.vel.z *= 1 - dt * 2;
        }
        p.pos.addScaledVector(p.vel, dt);
        // floor
        let floor = 0;
        for (let i = 0; i < cs.length; i++) {
          const b = cs[i];
          if (!b.active) continue;
          if (p.pos.x > b.minX && p.pos.x < b.maxX && p.pos.z > b.minZ && p.pos.z < b.maxZ && b.maxY <= p.pos.y + 0.5 && b.maxY > floor) floor = b.maxY;
        }
        if (p.pos.y < floor + 0.35) { p.pos.y = floor + 0.35; p.vel.y = 0; }
        p.mesh.rotation.y += dt * 3;
        p.mesh.position.y += Math.sin(p.t * 4) * 0.003;
        if (p.life < 3) p.mesh.visible = Math.sin(p.t * 20) > -0.3;
        if (d < 1.3 && want) this.collect(p);
      } else {
        p.mesh.userData.cube.rotation.y += dt * 1.5;
        p.mesh.userData.cube.rotation.x = Math.sin(p.t) * 0.3;
        p.mesh.userData.cube.position.y = Math.sin(p.t * 2) * 0.12;
        p.mesh.userData.beam.material.opacity = 0.12 + Math.sin(p.t * 3) * 0.06;
        const d = Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z);
        if (d < 1.6 && Math.abs(pp.y - (p.pos.y - 1)) < 2 && g.state === 'playing') this.collect(p);
      }
    }
  }

  ammoWanted(p) {
    const w = this.game.weapons;
    const id = p.weapon && w.owned.includes(p.weapon) ? p.weapon : w.neediest();
    if (!id) return false;
    const d = DEFS[id];
    return w.ammo[id].reserve < d.maxReserve * this.game.player.stats.magMul;
  }

  collect(p) {
    const g = this.game;
    if (p.kind === 'hp') {
      g.player.heal(10 * g.player.stats.pickupMul);
      g.audio.play('pickupHp', null, 0.7);
      g.fx.sparksBurst(p.pos, 0xff3050, 6, 3, 0.3);
    } else if (p.kind === 'ammo') {
      const w = g.weapons;
      const id = p.weapon && w.owned.includes(p.weapon) ? p.weapon : w.neediest();
      if (id) { const n = w.addAmmo(id, 0.6); if (n > 0) g.hud.toast('+' + n + ' ' + DEFS[id].name, '#ffd040', true); }
      g.audio.play('pickupAmmo', null, 0.7);
    } else if (p.kind === 'cache') {
      g.openReward(p.reward, p.picks || 1);
    }
    this.remove(p);
  }
}
