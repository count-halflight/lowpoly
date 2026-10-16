import * as THREE from 'three';
import { BESPOKE } from './bosses.js';
import { KitBoss } from './kit.js';
import { makeBox } from '../core/collide.js';
import { bossById } from '../data/bossdata.js';
import { Architect } from './architect.js';
import { HazardField } from './abilities.js';

// Owns the active boss (bespoke, kit-built, or the final boss), boss barriers and the
// hazard field that long-lived attack hazards (bosses' and minibosses') live in.
export class Bosses {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.barriers = [];
    this.field = new HazardField(game);
  }

  spawn(id, room, tier, opts = {}) {
    const g = this.game;
    this.field.clear();
    if (id === 'architect') this.active = new Architect(g, room, tier, opts);
    else if (BESPOKE[id]) {
      this.active = new BESPOKE[id](g, room, tier);
      const d = bossById(id);
      this.active.def = d;
      // bespoke bosses get a third phase under the same rule as kit bosses
      this.active.maxPhase = opts.ngPlus || tier >= 2 ? 3 : 2;
      this.active.hpSegments = this.active.maxPhase >= 3 ? [0.22, 0.5] : [0.5];
      if (opts.ngPlus) { this.active.hpMul *= 1.2; this.active.maxHp *= 1.2; this.active.hp = this.active.maxHp; }
    } else {
      const def = bossById(id);
      this.active = new KitBoss(g, room, def, tier, opts);
    }
    if (opts.hpScale) { this.active.maxHp *= opts.hpScale; this.active.hp = this.active.maxHp; }
    if (opts.dmgScale) this.active.dmgMul *= opts.dmgScale;
    if (g.profile && id !== 'architect') g.profile.sawBoss(id);
    return this.active;
  }

  makeBarrier(fromPos, hp, dur = 7) {
    const g = this.game;
    const pp = g.player.body.pos;
    const dx = pp.x - fromPos.x, dz = pp.z - fromPos.z, l = Math.hypot(dx, dz) || 1;
    const cx = fromPos.x + dx / l * 4, cz = fromPos.z + dz / l * 4;
    const w = 7, h = 4.5;
    const alongX = Math.abs(dz / l) > Math.abs(dx / l);
    const bx = makeBox(cx - (alongX ? w / 2 : 0.25), 0, cz - (alongX ? 0.25 : w / 2), cx + (alongX ? w / 2 : 0.25), h, cz + (alongX ? 0.25 : w / 2), { surface: 'energy', tag: 'barrier' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bx.maxX - bx.minX, h, bx.maxZ - bx.minZ), new THREE.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.set(cx, h / 2, cz);
    g.scene.add(mesh);
    const barrier = { box: bx, mesh, t: dur, hp };
    bx.ref = barrier;
    this.barriers.push(barrier);
    g.audio.play('shieldBreak', mesh.position, 0.8);
    g.hud.toast('BARRIER UP - FLANK IT OR BREAK IT', '#40c8ff', true);
  }

  update(dt) {
    const a = this.active;
    if (a && a.alive) a.update(dt);
    else if (a && a.dying && a.updateDeath) a.updateDeath(dt);
    if (this.barriers.length) {
      for (const b of this.barriers) b.t -= dt;
      this.barriers = this.barriers.filter((b) => {
        if (b.t <= 0 || b.hp <= 0) { this.game.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); return false; }
        return true;
      });
    }
    this.field.update(dt);
  }

  onDefeated(boss) { this.game.onBossDefeated(boss); }

  clear() {
    if (this.active) { this.active.remove(); this.active = null; }
    for (const b of this.barriers) { this.game.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    this.barriers = [];
    this.field.clear();
  }
}
