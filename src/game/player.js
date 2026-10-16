import * as THREE from 'three';
import { moveBody, clamp, damp } from '../core/collide.js';

const WALK = 8.6;
const GRAV = 25;
const JUMP_V = 8.8;
const DASH_SPEED = 27;
const DASH_TIME = 0.17;
const SLIDE_SPEED = 13.5;
const STAND_H = 1.75, SLIDE_H = 0.9;
const AIR_CAP = 1.7;        // Quake-style air wish cap: strafe-turning gains speed
const AIR_ACCEL = 70;
const BHOP_WINDOW = 0.11;   // seconds after landing during which a jump keeps all momentum
const MAX_BHOP = 27;
const HOOK_RANGE = 40;
const RUSH_TIME = 6;
// damage that should never count as a dodged attack (damage-over-time ticks, hazards, self)
const TIPS = { key: 'vg-mech-tips', seen: null };
const NO_DODGE = /VORTEX|SURGE|ORBITAL|SINGULARITY| TETHER|LEECH|LIVE FLOOR|MOLTEN|COOLANT|VOID|YOUR OWN|OVERPUMP/;

export function defaultStats() {
  return {
    maxHp: 100, moveMul: 1, dmgMul: 1, fireRateMul: 1, reloadMul: 1, magMul: 1, headMul: 1, spreadMul: 1,
    dashCharges: 3, dashRegen: 0.95, shieldMax: 0, shieldRegenDelay: 4, pickupMul: 1, magnet: 2.2,
    healOnKill: 0, explosiveEvery: 0, ricochet: 0, explosiveDmgMul: 1, explosiveRadiusMul: 1, launcherRateMul: 1,
    ramDash: 0, parryMul: 1, adrenaline: 0, slamMul: 1, shotgunPellets: 0, cluster: 0, lanceCharge: 1,
    deadeye: 0, arcJumps: 0, riflePierce: 0, rifleDmg: 1, vampiric: 0, chainReaction: 0, phoenix: 0, elitesMul: 1,
    coinMax: 4, hookCd: 1.0, bhopMul: 1, slideMul: 1, airDash: 0, momentumDmg: 0,
    // new-mechanic modifiers (rush / finisher / perfect dodge / projectile boost)
    rushRate: 1, rushDur: 0, rushExtend: 0, execMul: 1, execHeal: 0, execBlast: 0, counter: 0, dodgeWindow: 0, dodgeSlow: 0, boostMul: 1,
  };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), r: 0.36, h: STAND_H, grounded: false, step: 0.45, wallNormalX: 0, wallNormalZ: 0 };
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.6;
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.aimDir = new THREE.Vector3();
    this.tmp = new THREE.Vector3(); this.wishV = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.stats = defaultStats();
    this.hp = 100;
    this.shield = 0; this.shieldDelay = 0;
    this.alive = true;
    this.dashCharges = 3;
    this.dashT = 0; this.dashDir = new THREE.Vector3();
    this.sliding = false; this.slideDir = new THREE.Vector3(); this.slideSpeed = SLIDE_SPEED;
    this.slamming = false; this.slamJumpWindow = 0;
    this.coyote = 0; this.jumpBuffer = 0; this.wallJumps = 0; this.wallContactT = 0; this.wallNX = 0; this.wallNZ = 0;
    this.airTime = 0; this.lastVy = 0; this.groundT = 0; this.landT = 9; this.lastAirVy = 0;
    this.bhopChain = 0;
    this.punchCd = 0; this.punchT = 0;
    this.hurtT = 0; this.invuln = 0;
    this.lastDamage = { cause: '', tip: '' };
    this.landDip = 0; this.bob = 0; this.bobAmp = 0; this.roll = 0;
    this.speedNow = 0; this.sprint = false;
    this.phoenixUsed = false;
    this.hazardCd = 0;
    this.hook = null; this.hookCd = 0; this.hookCdMax = 1;
    this.gravityMul = 1; this.friction = 1; this.conveyor = null;
    this.body.vel.set(0, 0, 0);
    this.body.h = STAND_H;
    // RUSH overdrive: rush 0..1 fills from style, rushT > 0 while active
    this.rush = 0; this.rushT = 0; this.rushMax = RUSH_TIME;
    // perfect dodge / finisher / feel state
    this.dashStart = -9; this.dodgeArmed = false; this.dodgeCd = 0; this.counterT = 0;
    this.finisherTarget = null; this.cueT = 0;
    this.kickP = 0; this.kickPV = 0; this.kickR = 0; this.kickRV = 0;
    this.stepT = 0; this.fxT = 0;
  }

  spawnAt(x, y, z, yaw) {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.hook = null;
  }

  get speedMul() {
    let m = this.stats.moveMul;
    if (this.stats.adrenaline && this.game.style.rankIndex >= 3) m *= 1 + 0.25 * this.stats.adrenaline;
    if (this.rushT > 0) m *= 1.1;
    return m;
  }

  emit(ev, data) { this.game.emit(ev, data); }

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
    this.slamJumpWindow -= dt; this.hookCd -= dt; this.dodgeCd -= dt; this.counterT -= dt;
    if (this.dashCharges < st.dashCharges) this.dashCharges = Math.min(st.dashCharges, this.dashCharges + dt / st.dashRegen * (this.rushT > 0 ? 2 : 1));
    if (input.wasPressed('rush')) this.activateRush();
    if (this.rushT > 0) { this.rushT -= dt; if (this.rushT <= 0) this.endRush(); }
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

    // ---- jump buffer / coyote / ground time
    if (input.wasPressed('jump')) this.jumpBuffer = 0.13;
    else this.jumpBuffer -= dt;
    const holdHop = input.isHeld('jump') && b.grounded && this.groundT < BHOP_WINDOW; // hold-to-hop
    if (b.grounded) { this.coyote = 0.1; this.wallJumps = 0; this.groundT += dt; } else { this.coyote -= dt; this.groundT = 0; }
    this.wallContactT -= dt;
    this.landT += dt;

    // ---- grapple tether
    if (input.wasPressed('hook') && this.hookCd <= 0) this.fireHook();
    if (this.hook) this.updateHook(dt, input);

    // ---- dash
    if (input.wasPressed('dash') && this.dashCharges >= 1 && this.dashT <= 0) {
      this.dashCharges -= 1;
      this.dashT = DASH_TIME;
      this.dashDir.copy(wishLen > 0.1 ? wish : this.fwd);
      this.invuln = Math.max(this.invuln, DASH_TIME + 0.05 + st.dodgeWindow);
      this.sliding = false; this.slamming = false; this.hook = null;
      b.vel.y = Math.max(b.vel.y, 0);
      g.audio.play('dash', null, 0.7);
      g.addShake(0.08);
      this.kickR += this.dashDir.dot(this.right) * -0.03;
      this.dashHits = new Set();
      this.dashStart = g.time;
      this.dodgeArmed = this.dodgeCd <= 0;
      this.emit('dash');
      // a hostile shot about to connect counts as dodged through
      if (this.dodgeArmed && g.projectiles.nearMiss && g.projectiles.nearMiss(b.pos.x, b.pos.y + b.h * 0.5, b.pos.z, 0.3 + st.dodgeWindow) > 0) this.perfectDodge();
    }

    // ---- slide / slam
    const slideHeld = input.isHeld('slide');
    if (input.wasPressed('slideTap') && !b.grounded && !this.slamming && this.airTime > 0.08) {
      this.slamming = true;
      b.vel.set(0, -42, 0);
      this.dashT = 0; this.hook = null;
      g.audio.play('slamDown', null, 0.8);
    }
    if (slideHeld && b.grounded && !this.sliding && this.dashT <= 0) {
      this.sliding = true;
      const hv = Math.hypot(b.vel.x, b.vel.z);
      this.slideDir.copy(wishLen > 0.1 ? wish : (hv > 1 ? this.tmp2.set(b.vel.x, 0, b.vel.z).normalize() : this.fwd));
      // landing into a slide converts fall speed into forward speed
      const landBoost = this.landT < 0.25 ? Math.min(9, Math.abs(this.lastAirVy) * 0.35) : 0;
      this.slideSpeed = Math.min(30, Math.max(SLIDE_SPEED * this.speedMul * st.slideMul, hv) + landBoost);
      if (landBoost > 3) { g.style.add('SLIDE BOOST', 6, true); this.emit('slideboost'); }
      g.audio.play('slide', null, 0.7);
      this.emit('slide');
    }
    if (this.sliding && (!slideHeld || !b.grounded)) this.sliding = false;
    const wantH = this.sliding ? SLIDE_H : STAND_H;
    if (wantH > b.h) { const oldH = b.h; b.h = wantH; if (this.overlapsAny()) { b.h = oldH; this.sliding = b.grounded; } }
    else b.h = wantH;

    // ---- horizontal velocity
    let vx = b.vel.x, vz = b.vel.z;
    const fr = this.friction; // < 1 on ice
    if (this.hook && this.hook.pulling) {
      // handled in updateHook (vel already set)
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDir.x * DASH_SPEED * Math.sqrt(this.speedMul);
      vz = this.dashDir.z * DASH_SPEED * Math.sqrt(this.speedMul);
      b.vel.y = 0;
      if (this.dashT <= 0) { vx *= 0.42; vz *= 0.42; }
      if (st.ramDash) this.ramEnemies();
    } else if (this.sliding) {
      if (wishLen > 0.1) this.slideDir.lerp(wish, dt * 2).normalize();
      vx = this.slideDir.x * this.slideSpeed;
      vz = this.slideDir.z * this.slideSpeed;
      this.slideSpeed = Math.max(SLIDE_SPEED * 0.85 * this.speedMul, this.slideSpeed - dt * (this.slideSpeed > 16 ? 9 : 5) * fr);
    } else if (b.grounded) {
      const hv = Math.hypot(vx, vz);
      if (this.groundT < BHOP_WINDOW && hv > speed) {
        // landing grace: keep momentum and allow steering for a bunny hop
        if (wishLen > 0.1) {
          const nx = vx + (wish.x * hv - vx) * Math.min(1, dt * 6), nz = vz + (wish.z * hv - vz) * Math.min(1, dt * 6);
          const nl = Math.hypot(nx, nz) || 1;
          vx = nx / nl * hv; vz = nz / nl * hv;
        }
      } else {
        const tx = wish.x * speed * wishLen, tz = wish.z * speed * wishLen;
        const k = 1 - Math.exp(-(wishLen > 0.05 ? 16 : 11) * fr * dt);
        vx += (tx - vx) * k; vz += (tz - vz) * k;
      }
      if (this.conveyor) { vx += this.conveyor.x * dt * 30; vz += this.conveyor.z * dt * 30; }
    } else {
      // Quake-style air acceleration (strafe + turn to gain speed)
      const wishSpeed = speed * wishLen;
      if (wishLen > 0.05) {
        const along = vx * wish.x + vz * wish.z;
        const add = Math.min(AIR_CAP * st.bhopMul, wishSpeed) - along;
        if (add > 0) {
          const acc = Math.min(add, AIR_ACCEL * dt * wishSpeed / Math.max(1, speed));
          vx += wish.x * acc; vz += wish.z * acc;
        }
        // gentle classic air control when slow so new players are not punished
        const hv = Math.hypot(vx, vz);
        if (hv < speed * 0.9) {
          const k = 1 - Math.exp(-3 * dt);
          vx += (wish.x * speed - vx) * k; vz += (wish.z * speed - vz) * k;
        }
      }
    }

    // ---- jumping (incl. bhop, dash-jump, slam-jump, wall-jump)
    if (this.jumpBuffer > 0 || holdHop) {
      const hv = Math.hypot(vx, vz);
      if (this.slamJumpWindow > 0 && b.grounded) {
        b.vel.y = JUMP_V * 1.75; this.jumpBuffer = 0; this.coyote = 0; this.slamJumpWindow = 0;
        g.audio.play('jump', null, 0.9);
        g.style.add('SLAM JUMP', 15, true);
        this.camPunch(-0.7, 0);
        this.emit('slamjump');
      } else if (this.dashT > 0 && this.coyote > 0) {
        // dash-jump: carry the dash speed into a long jump
        this.dashT = 0;
        vx = this.dashDir.x * DASH_SPEED * 0.85; vz = this.dashDir.z * DASH_SPEED * 0.85;
        b.vel.y = JUMP_V * 0.92; this.jumpBuffer = 0; this.coyote = 0;
        g.audio.play('jump', null, 0.8);
        g.style.add('DASH JUMP', 8, true);
        this.camPunch(-0.3, this.dashDir.dot(this.right) * -0.4);
        this.emit('dashjump');
      } else if (this.coyote > 0) {
        const bhop = this.groundT < BHOP_WINDOW && this.landT < 0.3 && hv > speed * 0.95;
        b.vel.y = JUMP_V; this.jumpBuffer = 0; this.coyote = 0;
        if (this.sliding) { this.sliding = false; vx *= 1.08; vz *= 1.08; this.emit('slidejump'); g.style.add('SLIDE JUMP', 4, true); }
        if (bhop) {
          const boost = Math.min(MAX_BHOP * st.bhopMul, hv * 1.045);
          vx = vx / hv * boost; vz = vz / hv * boost;
          this.bhopChain++;
          if (this.bhopChain >= 2) { g.style.add('BHOP', 3 + this.bhopChain, this.bhopChain < 4); }
          this.emit('bhop', this.bhopChain);
        } else this.bhopChain = 0;
        g.audio.play('jump', null, 0.6);
        this.emit('jump');
      } else if (this.wallContactT > 0 && this.wallJumps < 3 && this.jumpBuffer > 0) {
        this.wallJumps++;
        b.vel.y = JUMP_V * 0.95;
        vx = this.wallNX * 8 + wish.x * 4; vz = this.wallNZ * 8 + wish.z * 4;
        this.jumpBuffer = 0;
        g.audio.play('jump', null, 0.7);
        g.style.add('WALL JUMP', 4, true);
        // lean away from the wall and kick some grit off it
        this.camPunch(-0.25, (this.wallNX * this.right.x + this.wallNZ * this.right.z) * -0.7);
        const wp = b.pos;
        for (let i = 0; i < (g.lowPower ? 3 : 6); i++) g.fx.dust.spawn(wp.x - this.wallNX * 0.4, wp.y + 0.4 + Math.random(), wp.z - this.wallNZ * 0.4, this.wallNX * 2 + (Math.random() - 0.5), 0.5, this.wallNZ * 2 + (Math.random() - 0.5), 0.45, 0.42, 0.38, 0.7, 0.18, 0.4, -0.3, 3);
        this.emit('walljump');
      }
    }
    if (b.grounded && this.groundT > 0.25) this.bhopChain = 0;

    // ---- gravity
    if (this.dashT <= 0 && !(this.hook && this.hook.pulling)) {
      const gmul = (b.vel.y < 0 ? 1.25 : 1) * this.gravityMul;
      if (!this.slamming) b.vel.y -= GRAV * gmul * dt;
      b.vel.y = Math.max(b.vel.y, -45);
    }
    if (!(this.hook && this.hook.pulling)) { b.vel.x = vx; b.vel.z = vz; }

    // ---- integrate
    const wasGrounded = b.grounded;
    this.lastVy = b.vel.y;
    if (!b.grounded) this.lastAirVy = b.vel.y;
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
      this.bob += dt * Math.min(this.speedNow, 14) * 1.25;
      this.bobAmp = damp(this.bobAmp, 1, 8, dt);
    } else this.bobAmp = damp(this.bobAmp, 0, 8, dt);
    const strafe = input.axis().x;
    this.roll = damp(this.roll, -strafe * 0.018 + (this.sliding ? 0.04 : 0) + (this.hook && this.hook.pulling ? -strafe * 0.04 : 0), 8, dt);
    // camera punch springs (mostly roll so recoil feel never drags the aim)
    const sdt = Math.min(dt, 0.033);
    this.kickPV += (-240 * this.kickP - 24 * this.kickPV) * sdt; this.kickP += this.kickPV * sdt;
    this.kickRV += (-200 * this.kickR - 20 * this.kickRV) * sdt; this.kickR += this.kickRV * sdt;
    this.movementFx(dt);

    // ---- punch / parry
    if (input.wasPressed('punch') && this.punchCd <= 0) this.punch();
    this.updateFinisherCue(dt);
    if (g.touch && g.touch.setRushReady) g.touch.setRushReady(this.rush >= 1 && this.rushT <= 0);
    const hpB = this.hp < st.maxHp * 0.25 ? 2 : this.hp < st.maxHp * 0.45 ? 1 : 0;
    if (g.audio.setLowHp) g.audio.setLowHp(hpB);

    // ---- level props (jump pads, conveyors handled via level)
    g.level.applyPlayerProps(this, dt);

    // ---- hazards / out of bounds
    const room = g.level.current;
    if (room && b.grounded) {
      const hz = room.hazardAt(b.pos.x, b.pos.z, b.pos.y);
      if (hz && this.hazardCd <= 0) {
        this.hazardCd = 0.25;
        const names = { electric: 'LIVE FLOOR', molten: 'MOLTEN SLAG', coolant: 'TOXIC COOLANT' };
        this.damage(hz.dps * 0.25, null, names[hz.type], hz.type === 'electric' ? 'Electric floors pulse: cross while they are dark, or jump across.' : 'Do not stand in the glowing pools.');
        g.audio.play(hz.type === 'electric' ? 'zap' : 'sizzle', null, 0.5);
      }
    }
    if (b.pos.y < -15 && room) {
      this.spawnAt(room.wx(room.spec.entX), 0.1, room.wz(room.D / 2 - 2), 0);
      this.damage(15, null, 'THE VOID', 'Stay on solid ground.');
    }
  }

  // ---------------------------------------------------------------- grapple tether
  fireHook() {
    const g = this.game;
    const cam = g.camera;
    const dir = cam.getWorldDirection(this.aimDir).clone();
    const o = cam.position.clone();
    this.hookCdMax = this.stats.hookCd;
    this.hookCd = this.hookCdMax;
    const hit = g.combat.raycast(o, dir, HOOK_RANGE);
    g.audio.play('hook', null, 0.8);
    this.emit('hook');
    if (!hit) {
      this.hook = { pulling: false, t: 0.15, miss: o.clone().addScaledVector(dir, HOOK_RANGE * 0.6) };
      return;
    }
    if (hit.kind === 'enemy') {
      const e = hit.enemy;
      if (e.heavy || e.mini) {
        this.hook = { pulling: true, t: 0.9, target: e, point: hit.point.clone() };
      } else {
        // yank a light enemy to you
        const d = new THREE.Vector3().subVectors(o, e.pos).setY(0).normalize();
        e.body.vel.set(d.x * 16, 7, d.z * 16);
        e.stagger = Math.max(e.stagger, 0.8);
        e.hooked = 0.6;
        g.style.add('YANKED', 15);
        this.hook = { pulling: false, t: 0.25, enemy: e };
        this.emit('yank');
      }
    } else if (hit.kind === 'boss') {
      this.hook = { pulling: true, t: 0.9, point: hit.point.clone() };
    } else {
      this.hook = { pulling: true, t: 1.0, point: hit.point.clone() };
    }
    if (this.hook.pulling) { this.sliding = false; this.slamming = false; this.dashT = 0; }
  }

  updateHook(dt, input) {
    const g = this.game;
    const h = this.hook;
    h.t -= dt;
    const hand = g.weapons.muzzleWorld().clone();
    let end = h.point || h.miss;
    if (h.target) end = h.target.alive ? h.target.centerPos().clone() : end;
    if (h.enemy) end = h.enemy.alive ? h.enemy.centerPos().clone() : hand;
    g.fx.beam(hand, end, 0xffd060, 0.035, 0.03, false);
    if (h.pulling) {
      const p = this.body.pos;
      const to = new THREE.Vector3(end.x - p.x, end.y - 1.0 - p.y, end.z - p.z);
      const d = to.length();
      if (d < 2.2 || h.t <= 0 || input.wasPressed('jump') || (h.target && !h.target.alive)) {
        // release: keep momentum, small upward pop
        this.body.vel.y = Math.max(this.body.vel.y, 5);
        this.hook = null;
        return;
      }
      to.multiplyScalar(1 / d);
      const sp = 30;
      this.body.vel.lerp(to.multiplyScalar(sp), Math.min(1, dt * 10));
    } else if (h.t <= 0) this.hook = null;
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
    this.landT = 0;
    this.groundT = 0;
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
      this.kickPV -= 1.4;
      this.emit('slam');
    } else if (impact > 0.3) {
      g.audio.play('land', null, 0.6 * impact);
      this.kickPV -= 0.9 * impact;
      // heavy landings kick up a ring of grit
      if (impact > 0.45) {
        const p = this.body.pos;
        const n = g.lowPower ? 5 : 9;
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2;
          g.fx.dust.spawn(p.x + Math.cos(a) * 0.3, p.y + 0.05, p.z + Math.sin(a) * 0.3, Math.cos(a) * 3 * impact, 0.6, Math.sin(a) * 3 * impact, 0.45, 0.42, 0.38, 0.7, 0.22, 0.45, -0.3, 3);
        }
      }
    }
  }

  // Footfalls, slide sparks and dash streaks: pure feedback, never touches movement.
  movementFx(dt) {
    const g = this.game, b = this.body;
    this.fxT -= dt;
    if (b.grounded && !this.sliding && this.speedNow > 3) {
      this.stepT += dt * Math.min(this.speedNow, 14) * 0.2;
      if (this.stepT >= 1) { this.stepT -= 1; g.audio.play('step', null, Math.min(0.35, 0.12 + this.speedNow * 0.012)); }
    }
    if (this.fxT > 0) return;
    this.fxT = 0.03;
    const p = b.pos;
    if (this.sliding && b.grounded) {
      const bx = -this.slideDir.x, bz = -this.slideDir.z;
      g.fx.sparks.spawn(p.x + this.right.x * 0.25, p.y + 0.05, p.z + this.right.z * 0.25, bx * 4 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, bz * 4 + (Math.random() - 0.5) * 2, 1, 0.75, 0.35, 1, 0.06, 0.25, 12, 1, p.y);
    }
    if (this.dashT > 0) {
      // speed streaks behind the dash
      for (let i = 0; i < 2; i++) {
        const ox = (Math.random() - 0.5) * 1.2, oy = 0.4 + Math.random() * 1.3, oz = (Math.random() - 0.5) * 1.2;
        g.fx.sparks.spawn(p.x + ox, p.y + oy, p.z + oz, -this.dashDir.x * 14, 0, -this.dashDir.z * 14, 0.6, 0.85, 1, 0.8, 0.07, 0.12, 0, 0);
      }
    }
    if (this.rushT > 0 && Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      g.fx.sparks.spawn(p.x + Math.cos(a) * 0.6, p.y + 0.2 + Math.random() * 1.2, p.z + Math.sin(a) * 0.6, 0, 1.5, 0, 1, 0.24, 0.94, 1, 0.07, 0.3, -2, 0);
    }
  }

  // Short camera punch (radians/s impulses) that springs back; mostly roll so it never drags aim.
  camPunch(pitch, roll) { this.kickPV += pitch; this.kickRV += roll; }

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
      this.camPunch(0.5, 0.4);
      this.emit('parry');
      return;
    }
    // punching your own fresh grenade / mine / rocket / core bats it forward
    const boosted = g.projectiles.tryBoost ? g.projectiles.tryBoost(eye, dir, 3.4, this.stats.boostMul) : null;
    if (boosted) {
      g.audio.play('boost', null, 1);
      g.hitstop(0.05);
      g.addShake(0.18);
      this.camPunch(0.4, -0.3);
      g.style.add('BOOSTED', 25);
      this.emit('projBoost', boosted);
      return;
    }
    // punching a coin launches it forward (feeds coin tricks)
    if (g.weapons.punchCoin(eye, dir)) return;
    // finisher: staggered or nearly dead enemies in reach get executed
    const ft = this.findFinisher(eye, dir, 4.6);
    if (ft) { this.execute(ft); return; }
    let hitAny = false;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const c = e.centerPos();
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 2.6 + e.radius) continue;
      if ((dx * dir.x + dy * dir.y + dz * dir.z) / d < 0.55) continue;
      const momentum = this.speedNow > 14 ? 1 + (this.speedNow - 14) * 0.08 : 1;
      g.combat.damageEnemy(e, 22 * this.stats.dmgMul * momentum, { source: 'punch', dir, knock: 12 * momentum, stagger: 0.5, point: c });
      if (momentum > 1.3) g.style.add('MOMENTUM', 15);
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
    if (hitAny) { g.addShake(0.15); g.hitstop(0.04); this.camPunch(0.3, 0.35); this.emit('punchhit'); }
  }

  // ---------------------------------------------------------------- finisher
  canExecute(e) {
    if (!e.alive || !e.targetable || e.boss || !(e.maxHp > 0)) return false;
    const m = this.stats.execMul;
    if (e.mini) return e.hp <= e.maxHp * 0.12 * m;
    if (e.hp <= e.maxHp * 0.2 * m) return true;
    return (e.stagger > 0.05 || e.stun > 0) && e.hp <= e.maxHp * 0.45 * m;
  }

  findFinisher(eye, dir, reach) {
    let best = null, bs = -1;
    for (const e of this.game.enemies.list) {
      if (!this.canExecute(e)) continue;
      const c = e.centerPos();
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > reach + e.radius) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.01, d);
      if (dot < 0.5) continue;
      const score = dot - d * 0.05;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  execute(e) {
    const g = this.game, st = this.stats;
    const c = e.centerPos().clone();
    const b = this.body;
    // short lunge so the blow lands even from the edge of reach
    const dx = c.x - b.pos.x, dz = c.z - b.pos.z, dl = Math.hypot(dx, dz);
    if (dl > 2) { b.vel.x = dx / dl * 15; b.vel.z = dz / dl * 15; }
    const d = new THREE.Vector3(dx, 0.35 * (dl || 1), dz).normalize();
    g.combat.damageEnemy(e, 1, { source: 'punch', finisher: true, dir: d, knock: 15, point: c, part: 'body' });
    this.heal(12 + st.execHeal);
    if (g.weapons.onFinisher) g.weapons.onFinisher();
    g.hitstop(0.11);
    g.addShake(0.4);
    g.flash(0xff2040, 0.22);
    this.camPunch(0.8, 0.7);
    g.audio.play('finisher', null, 1);
    g.fx.blood(c, d, 3.5, e.bloodColor);
    g.fx.chunks(c, 0x5a1010, g.lowPower ? 5 : 9, 8, 0.14);
    g.fx.sparksBurst(c, 0xff3050, 16, 7, 0.35);
    g.fx.ring(c.x, e.pos.y + 0.05, c.z, 2.4, 0xff3050, 0.3, 0.1);
    g.style.add('EXECUTION', 60);
    this.addRush(0.1);
    if (st.execBlast) {
      g.fx.ring(c.x, e.pos.y + 0.1, c.z, 5, 0xff6040, 0.35, 0.05);
      for (const o of g.enemies.list) if (o.alive && o !== e && !o.mini && o.centerPos().distanceTo(c) < 5) o.stagger = Math.max(o.stagger, o.heavy ? 0.3 : 0.9);
      g.combat.radialDamage(c, 5, 30 * st.execBlast * st.dmgMul, { source: 'punch', knock: 10, noSelf: true });
    }
    this.emit('finisher', e);
  }

  // Marks executable enemies (pooled sparks over their heads) and exposes the one in reach.
  updateFinisherCue(dt) {
    const g = this.game;
    const eye = g.camera.position;
    const dir = g.camera.getWorldDirection(this.tmp);
    this.finisherTarget = this.findFinisher(eye, dir, 4.6);
    this.cueT -= dt;
    if (this.cueT > 0) return;
    this.cueT = 0.12;
    const p = this.body.pos;
    for (const e of g.enemies.list) {
      if (!this.canExecute(e)) continue;
      if (Math.abs(e.pos.x - p.x) > 16 || Math.abs(e.pos.z - p.z) > 16) continue;
      const h = e.headPos();
      const hot = e === this.finisherTarget;
      if (!e.mini) this.tipOnce('exec', 'Red marker: that enemy is broken. PUNCH it (F) to EXECUTE it for health, ammo and style.', 'Red marker: that enemy is broken. Hit PARRY next to it to EXECUTE it for health and ammo.');
      g.fx.sparks.spawn(h.x, h.y + 0.45 + (e.mini ? 1.2 : 0), h.z, 0, 0.6, 0, 1, hot ? 1 : 0.2, hot ? 1 : 0.25, 1, hot ? 0.22 : 0.15, 0.16, 0, 0);
    }
  }

  // One-line pointers to the newer mechanics: shown in combat, at most twice per browser,
  // never in the training deck (it teaches them itself or keeps them out of the way).
  tipOnce(key, kb, touch) {
    const g = this.game;
    if (g.mode === 'tutorial' || g.state !== 'playing' || !g.onceHint) return;
    if (!TIPS.seen) { try { TIPS.seen = JSON.parse(localStorage.getItem(TIPS.key) || '{}') || {}; } catch { TIPS.seen = {}; } }
    if ((TIPS.seen[key] | 0) >= 2 || (g.shownHints && g.shownHints.has('m-' + key))) return;
    TIPS.seen[key] = (TIPS.seen[key] | 0) + 1;
    try { localStorage.setItem(TIPS.key, JSON.stringify(TIPS.seen)); } catch { /* storage blocked */ }
    g.onceHint('m-' + key, g.input.usingTouch ? touch : kb, 5);
  }

  // ---------------------------------------------------------------- RUSH overdrive
  addRush(v) {
    if (this.rushT > 0 || !this.alive || !(v > 0)) return;
    const before = this.rush;
    this.rush = Math.min(1, this.rush + v * this.stats.rushRate);
    if (before < 1 && this.rush >= 1) {
      const g = this.game;
      g.audio.play('rushReady', null, 0.8);
      g.hud.toast(g.input.usingTouch ? 'RUSH READY · TAP RUSH' : 'RUSH READY · PRESS X', '#ff3df0');
      this.tipOnce('rush', 'RUSH is full. Press X for a few seconds of faster fire, harder hits and lifesteal.', 'RUSH is full. Tap the pink RUSH button for faster fire, harder hits and lifesteal.');
    }
  }

  activateRush() {
    const g = this.game;
    if (this.rush < 1 || this.rushT > 0 || !this.alive || g.state !== 'playing') return;
    this.rush = 0;
    this.rushMax = RUSH_TIME + this.stats.rushDur;
    this.rushT = this.rushMax;
    this.dashCharges = this.stats.dashCharges;
    if (g.weapons.onRush) g.weapons.onRush();
    g.flash(0xff3df0, 0.5);
    g.hitstop(0.08);
    g.addShake(0.35);
    this.camPunch(0.6, 0);
    g.audio.play('rush', null, 1);
    if (g.audio.setRush) g.audio.setRush(true);
    const p = this.body.pos;
    g.fx.ring(p.x, p.y + 0.1, p.z, 6, 0xff3df0, 0.45, 0.05);
    g.fx.sparksBurst(p.clone().setY(p.y + 1), 0xff3df0, 30, 9, 0.5);
    g.style.add('RUSH', 30);
    this.emit('rush');
  }

  endRush() {
    const g = this.game;
    this.rushT = 0;
    g.audio.play('rushEnd', null, 0.7);
    if (g.audio.setRush) g.audio.setRush(false);
  }

  // ---------------------------------------------------------------- perfect dodge
  perfectDodge() {
    const g = this.game, st = this.stats;
    if (!this.dodgeArmed) return;
    this.dodgeArmed = false;
    this.dodgeCd = 0.6;
    g.slowT = Math.max(g.slowT || 0, 0.4 + st.dodgeSlow);
    this.invuln = Math.max(this.invuln, 0.35);
    this.dashCharges = Math.min(st.dashCharges, this.dashCharges + 1);
    if (st.counter) this.counterT = 2;
    g.audio.play('perfectDodge', null, 1);
    g.flash(0x7fe0ff, 0.16);
    const p = this.body.pos;
    // afterimage where the hit would have landed
    for (let i = 0; i < (g.lowPower ? 10 : 18); i++) {
      g.fx.sparks.spawn(p.x + (Math.random() - 0.5) * 0.6, p.y + Math.random() * 1.8, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 0.5, (Math.random() - 0.5) * 1.5, 0.5, 0.9, 1, 1, 0.12, 0.45, -1, 1);
    }
    g.style.add('PERFECT DODGE', 45);
    this.addRush(0.08);
    this.emit('perfectDodge');
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
    if (this.invuln > 0 && cause !== 'THE VOID') {
      // an attack that lands inside the dash's i-frames was dodged at the last moment
      if (this.dodgeArmed && g.time - this.dashStart < DASH_TIME + 0.08 + this.stats.dodgeWindow && amount >= 4 && !NO_DODGE.test(cause || '')) this.perfectDodge();
      return false;
    }
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
    if (g.audio.hurt) g.audio.hurt(Math.min(1, amount / 30));
    g.addShake(Math.min(0.45, 0.12 + amount / 60));
    this.camPunch(-0.25, (Math.random() - 0.5) * 1.2 * Math.min(1, amount / 25));
    g.run.damageTaken += amount;
    g.emit('hurt', amount);
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
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.kickP, this.yaw, this.roll + this.kickR);
  }
}
