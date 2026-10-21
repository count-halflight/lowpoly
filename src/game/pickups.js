import * as THREE from 'three';
import { DEFS } from './weapons.js';

// Health orbs, ammo boxes, and reward caches. Bounded pool; cleared per room.
// Each pickup is a root (physics) with a bobbing, spinning visual child, a glow halo and a
// soft light pool on the floor under it. Geometry and materials are shared; only caches own
// per-instance materials (their colour), which remove() disposes.
export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.cap = 40;
    const add = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.geoHp = new THREE.OctahedronGeometry(0.2, 0);
    this.geoHpCore = new THREE.OctahedronGeometry(0.09, 0);
    this.geoHalo = new THREE.IcosahedronGeometry(0.34, 0);
    this.geoAmmo = new THREE.BoxGeometry(0.36, 0.22, 0.26);
    this.geoBand = new THREE.BoxGeometry(0.38, 0.05, 0.28);
    this.geoStripe = new THREE.BoxGeometry(0.06, 0.012, 0.2);
    this.geoDisc = new THREE.CircleGeometry(0.5, 12); this.geoDisc.rotateX(-Math.PI / 2);
    this.geoCache = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    this.geoCage = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08));
    this.geoCrystal = new THREE.OctahedronGeometry(0.34, 0);
    this.geoBeam = new THREE.CylinderGeometry(0.5, 0.5, 14, 8, 1, true);
    this.matHp = new THREE.MeshBasicMaterial({ color: 0xff2848 });
    this.matHpCore = new THREE.MeshBasicMaterial({ color: 0xffe0e6 });
    this.matHpHalo = add(0xff3050, 0.35);
    this.matAmmo = new THREE.MeshLambertMaterial({ color: 0x2a2c34 });
    this.matBand = new THREE.MeshBasicMaterial({ color: 0xffd040 });
    this.matAmmoHalo = add(0xffd040, 0.22);
    this.matDisc = { hp: add(0xff3050, 0.22), ammo: add(0xffd040, 0.18) };
    this.stripeMats = {};
    this.matCacheCore = new THREE.MeshLambertMaterial({ color: 0x14161c });
    this.matBeam = new THREE.MeshBasicMaterial({ color: 0x3ef0d0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.cacheColors = { standard: 0x3ef0d0, rare: 0xc060ff, boss: 0xffc040, supply: 0x60ff90 };
    this.tmp = new THREE.Vector3();
  }

  stripeMat(id) {
    const col = (id && DEFS[id] && DEFS[id].color) || '#ffd040';
    if (!this.stripeMats[col]) this.stripeMats[col] = new THREE.MeshBasicMaterial({ color: col });
    return this.stripeMats[col];
  }

  spawn(kind, pos, extra = {}) {
    if (this.list.length >= this.cap) {
      const i = this.list.findIndex((p) => p.kind !== 'cache');
      if (i >= 0) this.remove(this.list[i]);
    }
    const mesh = new THREE.Group();
    const vis = new THREE.Group();
    mesh.add(vis);
    let halo = null, disc = null;
    if (kind === 'hp') {
      // a red crystal with a white-hot heart inside a soft halo
      vis.add(new THREE.Mesh(this.geoHp, this.matHp), new THREE.Mesh(this.geoHpCore, this.matHpCore));
      halo = new THREE.Mesh(this.geoHalo, this.matHpHalo);
      disc = new THREE.Mesh(this.geoDisc, this.matDisc.hp);
    } else if (kind === 'ammo') {
      // dark ammo can with a lit band and a stripe in the colour of the gun it feeds
      vis.add(new THREE.Mesh(this.geoAmmo, this.matAmmo), new THREE.Mesh(this.geoBand, this.matBand));
      const st = new THREE.Mesh(this.geoStripe, this.stripeMat(extra.weapon));
      st.position.y = 0.116;
      vis.add(st);
      halo = new THREE.Mesh(this.geoHalo, this.matAmmoHalo);
      halo.scale.set(1.3, 0.9, 1.3);
      disc = new THREE.Mesh(this.geoDisc, this.matDisc.ammo);
    } else {
      // reward cache: dark core in a glowing wire cage round a spinning crystal, under a beam
      const col = this.cacheColors[extra.reward] || 0x3ef0d0;
      const cube = new THREE.Mesh(this.geoCache, this.matCacheCore);
      const cage = new THREE.LineSegments(this.geoCage, new THREE.LineBasicMaterial({ color: col }));
      const crystal = new THREE.Mesh(this.geoCrystal, new THREE.MeshBasicMaterial({ color: col }));
      const beam = new THREE.Mesh(this.geoBeam, this.matBeam.clone());
      beam.material.color.setHex(col);
      beam.position.y = 7;
      cube.scale.setScalar(0.62);
      vis.add(cube, cage, crystal);
      mesh.add(beam);
      halo = new THREE.Mesh(this.geoHalo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(2.4);
      mesh.userData.cube = cage; mesh.userData.crystal = crystal; mesh.userData.beam = beam; mesh.userData.core = cube;
    }
    if (halo) vis.add(halo);
    if (disc) mesh.add(disc);
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const p = { kind, mesh, vis, halo, disc, pos: mesh.position, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3), t: Math.random() * 3, life: kind === 'cache' ? Infinity : 20, pull: false, ...extra };
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
    const bloodfuel = this.game.level.current && this.game.level.current.cond === 'bloodfuel';
    if (!bloodfuel && Math.random() < hpChance) this.spawn('hp', c);
    const needy = g.weapons.neediest();
    if (needy && Math.random() < (e.elite ? 0.9 : 0.4)) this.spawn('ammo', c.clone().add(new THREE.Vector3(0.3, 0, 0)), { weapon: needy });
  }

  spawnCache(pos, reward) {
    // sits a metre above whatever floor it was placed on (raised platforms included)
    this.spawn('cache', pos.clone().setY(Math.max(0, Math.min(pos.y, 4)) + 1.0), { reward });
    this.game.audio.play('cache', pos, 0.8);
  }

  remove(p) {
    this.game.scene.remove(p.mesh);
    if (p.kind === 'cache') { const u = p.mesh.userData; u.cube.material.dispose(); u.crystal.material.dispose(); u.beam.material.dispose(); p.halo.material.dispose(); }
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
        p.pull = want && d < pl.stats.magnet && p.t > 0.4;
        if (p.pull) {
          const s = 14 / Math.max(0.3, d);
          p.vel.set(dx * s * 0.3, dy * s * 0.3, dz * s * 0.3);
          // a streak of light as it flies to you
          if (Math.random() < 0.6) g.fx.sparks.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, p.kind === 'hp' ? 1 : 1, p.kind === 'hp' ? 0.25 : 0.8, p.kind === 'hp' ? 0.35 : 0.2, 1, 0.08, 0.18, 0, 0);
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
        // spin, bob and pulse; the floor glow stays on the floor
        const bob = Math.sin(p.t * 3.2) * 0.07 + 0.05;
        p.vis.position.y = bob;
        p.vis.rotation.y += dt * (p.kind === 'hp' ? 2.6 : 1.8);
        if (p.kind === 'hp') p.vis.rotation.x = Math.sin(p.t * 1.7) * 0.4;
        else p.vis.rotation.z = Math.sin(p.t * 2.1) * 0.15;
        const pulse = 1 + Math.sin(p.t * 6) * 0.12;
        if (p.halo) p.halo.scale.setScalar(p.kind === 'ammo' ? pulse * 1.15 : pulse);
        if (p.disc) {
          p.disc.position.y = floor - p.pos.y + 0.02;
          p.disc.visible = p.pos.y - floor < 1.2;
          p.disc.scale.setScalar(0.8 + 0.15 * Math.sin(p.t * 3.2));
        }
        if (p.life < 3) p.mesh.visible = Math.sin(p.t * 20) > -0.3;
        if (d < 1.3 && want) this.collect(p);
      } else {
        const u = p.mesh.userData;
        p.vis.position.y = Math.sin(p.t * 2) * 0.12;
        u.cube.rotation.y += dt * 1.5;
        u.cube.rotation.x = Math.sin(p.t) * 0.3;
        u.core.rotation.copy(u.cube.rotation);
        u.crystal.rotation.y -= dt * 3;
        u.crystal.rotation.x = Math.sin(p.t * 1.3) * 0.5;
        u.crystal.scale.setScalar(1 + Math.sin(p.t * 5) * 0.08);
        u.beam.material.opacity = 0.12 + Math.sin(p.t * 3) * 0.06;
        p.halo.material.opacity = 0.16 + Math.sin(p.t * 4) * 0.05;
        // motes drift up round the cage
        if (Math.random() < dt * 8) {
          const a = Math.random() * Math.PI * 2, c = u.crystal.material.color;
          g.fx.sparks.spawn(p.pos.x + Math.cos(a) * 0.7, p.pos.y - 0.6, p.pos.z + Math.sin(a) * 0.7, -Math.sin(a) * 0.6, 1.2 + Math.random(), Math.cos(a) * 0.6, c.r, c.g, c.b, 1, 0.07, 0.8, -0.5, 0);
        }
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

  // pickup pop: a burst in the pickup's colour, a quick ring and a glint at the spot
  pop(p, hex) {
    const g = this.game, at = this.tmp.copy(p.pos);
    at.y += p.vis ? p.vis.position.y : 0;
    g.fx.sparksBurst(at, hex, 12, 4, 0.35);
    g.fx.glint(at, hex, 0.9, 0.12);
    g.fx.ring(at.x, at.y - 0.2, at.z, 0.9, hex, 0.25, 0.2);
  }

  collect(p) {
    const g = this.game;
    if (p.kind === 'hp') {
      g.player.heal(10 * g.player.stats.pickupMul);
      g.audio.play('pickupHp', null, 0.7);
      this.pop(p, 0xff3050);
      g.flash(0xff3050, 0.05);
    } else if (p.kind === 'ammo') {
      const w = g.weapons;
      const id = p.weapon && w.owned.includes(p.weapon) ? p.weapon : w.neediest();
      if (id) { const n = w.addAmmo(id, 0.6); if (n > 0) g.hud.toast('+' + n + ' ' + DEFS[id].name, '#ffd040', true); }
      g.audio.play('pickupAmmo', null, 0.7);
      this.pop(p, 0xffd040);
    } else if (p.kind === 'cache') {
      const c = p.mesh.userData.crystal.material.color.getHex();
      this.pop(p, c);
      g.fx.ring(p.pos.x, p.pos.y - 0.9, p.pos.z, 2.2, c, 0.4, 0.1);
      g.openReward(p.reward, p.picks || 1);
    }
    this.remove(p);
  }
}
