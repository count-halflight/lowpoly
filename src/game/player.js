import * as THREE from 'three';
import { moveBody, clamp, damp } from '../core/collide.js';

const WALK = 8.6;
const GRAV = 25;
const JUMP_V = 8.8;
const DASH_SPEED = 27;
const DASH_TIME = 0.17;
const SLIDE_SPEED = 13.5;
const STAND_H = 1.75, SLIDE_H = 0.9;

export function defaultStats() {
  return {
    maxHp: 100, moveMul: 1, dmgMul: 1, fireRateMul: 1, reloadMul: 1, magMul: 1, headMul: 1, spreadMul: 1,
    dashCharges: 3, dashRegen: 0.95, shieldMax: 0, shieldRegenDelay: 4, pickupMul: 1, magnet: 2.2,
    healOnKill: 0, explosiveEvery: 0, ricochet: 0, explosiveDmgMul: 1, explosiveRadiusMul: 1, launcherRateMul: 1,
    ramDash: 0, parryMul: 1, adrenaline: 0, slamMul: 1, shotgunPellets: 0, cluster: 0, lanceCharge: 1,
    deadeye: 0, arcJumps: 0, riflePierce: 0, rifleDmg: 1, vampiric: 0, chainReaction: 0, phoenix: 0, elitesMul: 1,
  };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), r: 0.36, h: STAND_H, grounded: false, step: 0.45, wallNormalX: 0, wallNormalZ: 0 };
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.6;
    this.reset();
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.aimDir = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.wishV = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  reset() {
    this.stats = defaultStats();
    this.hp = 100;
    this.shield = 0;
    this.shieldDelay = 0;
    this.alive = true;
    this.dashCharges = 3;
    this.dashT = 0; this.dashDir = new THREE.Vector3();
    this.sliding = false; this.slideDir = new THREE.Vector3();
    this.slamming = false; this.slamJumpWindow = 0;
    this.coyote = 0; this.jumpBuffer = 0; this.wallJumps = 0; this.wallContactT = 0; this.wallNX = 0; this.wallNZ = 0;
    this.airTime = 0; this.lastVy = 0;
    this.punchCd = 0; this.punchT = 0;
    this.hurtT = 0; this.invuln = 0;
    this.lastDamage = { cause: '', tip: '' };
    this.landDip = 0;
    this.bob = 0; this.bobAmp = 0;
    this.roll = 0;
    this.speedNow = 0;
    this.sprint = false;
    this.phoenixUsed = false;
    this.hazardCd = 0;
    this.body.vel.set(0, 0, 0);
    this.body.h = STAND_H;
  }

  spawnAt(x, y, z, yaw) {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
  }

  get speedMul() {
    let m = this.stats.moveMul;
    if (this.stats.adrenaline && this.game.style.rankIndex >= 3) m *= 1 + 0.25 * this.stats.adrenaline;
    return m;
  }

  update(dt, input) {
    const g = this.game;
    const b = this.body;
    const st = this.stats;

    // ---- look
    const fovK = g.camera.fov / 90;
    this.yaw -= input.lookDX * fovK;
    this.pitch -= input.lookDY * fovK;
    this.pitch = clamp(this.pitch, -1.53, 1.53);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.fwd.set(-sy, 0, -cy);
    this.right.set(cy, 0, -sy);

    // ---- timers
    this.punchCd -= dt; this.punchT -= dt; this.hurtT -= dt; this.invuln -= dt; this.hazardCd -= dt;
    this.slamJumpWindow -= dt;
    if (this.dashCharges < st.dashCharges) this.dashCharges = Math.min(st.dashCharges, this.dashCharges + dt / st.dashRegen);
    if (st.shieldMax > 0) {
      this.shieldDelay -= dt;
      if (this.shieldDelay <= 0) this.shield = Math.min(st.shieldMax, this.shield + dt * st.shieldMax * 0.5);
    }

    const ax = input.axis();
    const wish = this.wishV.set(0, 0, 0).addScaledVector(this.fwd, ax.y).addScaledVector(this.right, ax.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0.001) wish.normalize();

    this.sprint = input.isHeld('dash') || input.touchSprint || input.stickSprint;
    const speed = WALK * this.speedMul * (this.sprint && b.grounded && !this.sliding ? 1.22 : 1);

    // ---- jump buffer / coyote
    if (input.wasPressed('jump')) this.jumpBuffer = 0.13;
    else this.jumpBuffer -= dt;
    if (b.grounded) { this.coyote = 0.1; this.wallJumps = 0; } else this.coyote -= dt;
    this.wallContactT -= dt;

    // ---- dash
    if (input.wasPressed('dash') && this.dashCharges >= 1 && this.dashT <= 0) {
      this.dashCharges -= 1;
      this.dashT = DASH_TIME;
      this.dashDir.copy(wishLen > 0.1 ? wish : this.fwd);
      this.invuln = Math.max(this.invuln, DASH_TIME + 0.05);
      this.sliding = false; this.slamming = false;
      b.vel.y = Math.max(b.vel.y, 0);
      g.audio.play('dash', null, 0.7);
      g.addShake(0.08);
      this.dashHits = new Set();
    }

    // ---- slide / slam
    const slideHeld = input.isHeld('slide');
    if (input.wasPressed('slideTap') && !b.grounded && !this.slamming && this.airTime > 0.08) {
      this.slamming = true;
      b.vel.set(0, -42, 0);
      this.dashT = 0;
      g.audio.play('slamDown', null, 0.8);
    }
    if (slideHeld && b.grounded && !this.sliding && this.dashT <= 0) {
      this.sliding = true;
      const hv = Math.hypot(b.vel.x, b.vel.z);
      this.slideDir.copy(wishLen > 0.1 ? wish : (hv > 1 ? this.tmp2.set(b.vel.x, 0, b.vel.z).normalize() : this.fwd));
      this.slideSpeed = Math.max(SLIDE_SPEED * this.speedMul, hv);
      g.audio.play('slide', null, 0.7);
    }
    if (this.sliding && (!slideHeld || !b.grounded)) {
      this.sliding = false;
    }
    // stand up only if room overhead
    const wantH = this.sliding ? SLIDE_H : STAND_H;
    if (wantH > b.h) {
      const oldH = b.h; b.h = wantH;
      if (this.overlapsAny()) b.h = oldH;
    } else b.h = wantH;

    // ---- horizontal velocity
    let vx = b.vel.x, vz = b.vel.z;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDir.x * DASH_SPEED * Math.sqrt(this.speedMul);
      vz = this.dashDir.z * DASH_SPEED * Math.sqrt(this.speedMul);
      b.vel.y = 0;
      if (this.dashT <= 0) { vx *= 0.42; vz *= 0.42; }
      if (st.ramDash) this.ramEnemies();
    } else if (this.sliding) {
      // slight steering while sliding
      if (wishLen > 0.1) { this.slideDir.lerp(wish, dt * 2).normalize(); }
      vx = this.slideDir.x * this.slideSpeed;
      vz = this.slideDir.z * this.slideSpeed;
      this.slideSpeed = Math.max(SLIDE_SPEED * 0.85 * this.speedMul, this.slideSpeed - dt * 6);
    } else if (b.grounded) {
      const tx = wish.x * speed * wishLen, tz = wish.z * speed * wishLen;
      const k = 1 - Math.exp(-(wishLen > 0.05 ? 16 : 11) * dt);
      vx += (tx - vx) * k; vz += (tz - vz) * k;
    } else {
      // air control: accelerate toward wish without killing momentum
      const tx = wish.x * speed * wishLen, tz = wish.z * speed * wishLen;
      const cur = Math.hypot(vx, vz);
      const k = 1 - Math.exp(-3.2 * dt);
      const nvx = vx + (tx - vx) * k, nvz = vz + (tz - vz) * k;
      const nl = Math.hypot(nvx, nvz);
      // do not let air control reduce speed built from dashes/slides below walk speed limit
      if (wishLen > 0.05 && nl < cur && cur > speed) { vx = nvx / nl * cur; vz = nvz / nl * cur; }
      else if (wishLen > 0.05) { vx = nvx; vz = nvz; }
    }

    // ---- jumping
    if (this.jumpBuffer > 0) {
      if (this.slamJumpWindow > 0 && b.grounded) {
        b.vel.y = JUMP_V * 1.75; this.jumpBuffer = 0; this.coyote = 0; this.slamJumpWindow = 0;
        g.audio.play('jump', null, 0.9);
        g.style.add('SLAM JUMP', 15, true);
      } else if (this.coyote > 0) {
        b.vel.y = JUMP_V; this.jumpBuffer = 0; this.coyote = 0;
        if (this.sliding) { this.sliding = false; vx *= 1.08; vz *= 1.08; }
        g.audio.play('jump', null, 0.6);
      } else if (this.wallContactT > 0 && this.wallJumps < 3) {
        this.wallJumps++;
        b.vel.y = JUMP_V * 0.95;
        vx = this.wallNX * 8 + wish.x * 4; vz = this.wallNZ * 8 + wish.z * 4;
        this.jumpBuffer = 0;
        g.audio.play('jump', null, 0.7);
        g.style.add('WALL JUMP', 4, true);
      }
    }

    // ---- gravity
    if (this.dashT <= 0) {
      const gmul = b.vel.y < 0 ? 1.25 : 1;
      if (!this.slamming) b.vel.y -= GRAV * gmul * dt;
      b.vel.y = Math.max(b.vel.y, -45);
    }
    b.vel.x = vx; b.vel.z = vz;

    // ---- integrate
    const wasGrounded = b.grounded;
    this.lastVy = b.vel.y;
    const hit = moveBody(b, b.vel.x * dt, b.vel.y * dt, b.vel.z * dt, g.level.colliders);
    if ((hit & 1) && !b.grounded) {
      this.wallContactT = 0.18;
      this.wallNX = b.wallNormalX; this.wallNZ = b.wallNormalZ;
      const l = Math.hypot(this.wallNX, this.wallNZ) || 1;
      this.wallNX /= l; this.wallNZ /= l;
    }
    if (b.grounded) {
      if (!wasGrounded) this.onLand(this.lastVy);
      this.airTime = 0;
    } else this.airTime += dt;

    this.speedNow = Math.hypot(b.vel.x, b.vel.z);

    // ---- camera feel
    const targetEye = this.sliding ? 0.78 : 1.6;
    this.eye = damp(this.eye, targetEye, 14, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
    if (b.grounded && this.speedNow > 1 && !this.sliding) {
      this.bob += dt * this.speedNow * 1.25;
      this.bobAmp = damp(this.bobAmp, 1, 8, dt);
    } else this.bobAmp = damp(this.bobAmp, 0, 8, dt);
    const strafe = input.axis().x;
    this.roll = damp(this.roll, -strafe * 0.018 + (this.sliding ? 0.04 : 0), 8, dt);

    // ---- punch / parry
    if (input.wasPressed('punch') && this.punchCd <= 0) this.punch();

    // ---- hazards / out of bounds
    const room = g.level.current;
    if (room && b.grounded) {
      const hz = room.hazardAt(b.pos.x, b.pos.z, b.pos.y);
      if (hz && this.hazardCd <= 0) {
        this.hazardCd = 0.25;
        const names = { electric: 'LIVE FLOOR', molten: 'MOLTEN SLAG', coolant: 'TOXIC COOLANT' };
        this.damage(hz.dps * 0.25, null, names[hz.type], hz.type === 'electric' ? 'Electric floors pulse: cross while they are dark, or jump across.' : 'Do not stand in the glowing pools.');
        if (hz.type === 'electric') g.audio.play('zap', null, 0.5); else g.audio.play('sizzle', null, 0.6);
      }
    }
    if (b.pos.y < -15 && room) {
      this.spawnAt(room.wx(room.spec.entX), 0.1, room.wz(room.D / 2 - 2), 0);
      this.damage(15, null, 'THE VOID', 'Stay on solid ground.');
    }
  }

  overlapsAny() {
    const b = this.body, cs = this.game.level.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.active || !c.solid) continue;
      if (b.pos.x + b.r > c.minX && b.pos.x - b.r < c.maxX && b.pos.z + b.r > c.minZ && b.pos.z - b.r < c.maxZ && b.pos.y + b.h > c.minY && b.pos.y < c.maxY) return true;
    }
    return false;
  }

  onLand(vy) {
    const g = this.game;
    const impact = Math.min(1, Math.abs(vy) / 30);
    this.landDip = -0.12 * impact - 0.03;
    if (this.slamming) {
      this.slamming = false;
      this.slamJumpWindow = 0.28;
      const r = 3.6 + (this.stats.slamMul > 1 ? 2 : 0);
      const p = this.body.pos;
      g.fx.ring(p.x, p.y + 0.05, p.z, r, 0x9ad8ff, 0.35, 0.1);
      g.fx.sparksBurst(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0x9ad8ff, 16, 8, 0.4);
      g.audio.play('slam', null, 0.9);
      g.addShake(0.35);
      g.combat.radialDamage(p.clone().setY(p.y + 0.5), r, 22 * this.stats.slamMul, { source: 'slam', knock: 9, noSelf: true, launch: 7 });
    } else if (impact > 0.3) g.audio.play('land', null, 0.6 * impact);
  }

  ramEnemies() {
    const g = this.game;
    const p = this.body.pos;
    for (const e of g.enemies.list) {
      if (!e.alive || this.dashHits.has(e)) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
      if (dx * dx + dz * dz < (e.radius + 1.0) ** 2 && Math.abs(e.pos.y - p.y) < 2.5) {
        this.dashHits.add(e);
        g.combat.damageEnemy(e, 40 * this.stats.ramDash * this.stats.dmgMul, { source: 'ram', dir: this.dashDir, knock: 10, stagger: 0.6, point: e.centerPos() });
        g.style.add('RAMMED', 25);
      }
    }
  }

  punch() {
    const g = this.game;
    this.punchCd = 0.42;
    this.punchT = 0.25;
    g.weapons.onPunch();
    const eye = g.camera.position;
    const dir = g.camera.getWorldDirection(this.aimDir);
    // parry projectiles first
    const window = 3.2 * this.stats.parryMul;
    const parried = g.projectiles.tryParry(eye, dir, window);
    if (parried) {
      g.audio.play('parry', null, 1);
      g.hitstop(0.12);
      g.flash(0xffffff, 0.25);
      g.addShake(0.25);
      this.heal(15 + (this.stats.parryMul > 1 ? 15 : 0), true);
      g.style.add('PARRY', 60);
      g.hud.toast('PARRY', '#ffe23a');
      return;
    }
    // melee
    let hitAny = false;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const c = e.centerPos();
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 2.6 + e.radius) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / d < 0.55) continue;
      g.combat.damageEnemy(e, 22 * this.stats.dmgMul, { source: 'punch', dir, knock: 12, stagger: 0.5, point: c });
      hitAny = true;
    }
    if (g.bosses.active) {
      const boss = g.bosses.active;
      for (const hb of boss.hitboxes()) {
        const dx = hb.x - eye.x, dy = hb.y - eye.y, dz = hb.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 2.6 + hb.r && (dx * dir.x + dy * dir.y + dz * dir.z) / d > 0.5) {
          g.combat.damageBoss(boss, 22 * this.stats.dmgMul, { source: 'punch', point: new THREE.Vector3(hb.x, hb.y, hb.z), part: hb });
          hitAny = true; break;
        }
      }
    }
    g.audio.play('punch', null, hitAny ? 1 : 0.5);
    if (hitAny) { g.addShake(0.15); g.hitstop(0.04); }
  }

  heal(n, silent = false) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    if (!silent && this.hp > before) this.game.hud.healPulse();
  }

  damage(amount, from, cause, tip) {
    const g = this.game;
    if (!this.alive || g.state !== 'playing') return false;
    if (this.invuln > 0 && cause !== 'THE VOID') return false;
    amount *= g.director.playerDamageMul();
    this.lastDamage = { cause, tip };
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
      if (this.shield <= 0) g.audio.play('shieldBreak', null, 0.8);
    }
    this.shieldDelay = this.stats.shieldRegenDelay;
    this.hp -= amount;
    this.hurtT = 0.3;
    this.invuln = 0.12;
    g.hud.damage(amount, from);
    g.style.onPlayerHit(amount);
    g.audio.play('hurt', null, 0.8);
    g.addShake(Math.min(0.45, 0.12 + amount / 60));
    g.run.damageTaken += amount;
    if (this.hp <= 0) {
      if (this.stats.phoenix && !this.phoenixUsed) {
        this.phoenixUsed = true;
        this.hp = this.stats.maxHp * 0.5;
        this.invuln = 2;
        g.flash(0xffa040, 0.6);
        g.hud.toast('PHOENIX MODULE ENGAGED', '#ffa040');
        g.combat.radialDamage(this.body.pos.clone().setY(1), 7, 120, { source: 'phoenix', knock: 14, noSelf: true });
        g.fx.explosion(this.body.pos.clone().setY(1), 6, 0xffa040);
        g.audio.play('explosion', null, 1);
        return true;
      }
      this.hp = 0;
      this.alive = false;
      g.onPlayerDeath();
    }
    return true;
  }

  knock(vx, vy, vz) {
    this.body.vel.x += vx; this.body.vel.y = Math.max(this.body.vel.y, 0) + vy; this.body.vel.z += vz;
  }

  updateCamera(cam) {
    const b = this.body;
    const bobY = Math.sin(this.bob * 2) * 0.035 * this.bobAmp;
    cam.position.set(b.pos.x, b.pos.y + this.eye + bobY + this.landDip, b.pos.z);
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
    cam.rotation.z = this.roll;
  }
}
