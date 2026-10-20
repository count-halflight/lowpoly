import * as THREE from 'three';
import { themeById } from './campaign.js';

// The training deck: ten short rooms, each teaching one verb. The exit stays sealed until
// the objective is met; objectives react to the real game events (no scripted fakes).

const STATIONS = [
  { name: 'WAKE UP', log: 'T1' },
  { name: 'LIVE ROUNDS' },
  { name: 'ARSENAL', log: 'T3' },
  { name: 'THE SLAG' },
  { name: 'LOW GATE' },
  { name: 'THE CHIMNEY' },
  { name: 'MOMENTUM', log: 'T2' },
  { name: 'RETURN TO SENDER' },
  { name: 'VERTICAL' },
  { name: 'LIVE FIRE' },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.objective = '';
    this.station = -1;
    this.counts = {};
    this.done = false;
    game.on('*', (ev, data) => this.onEvent(ev, data));
  }

  get stations() { return STATIONS; }

  ctxFor(n) {
    return { arch: 'tutorial', station: n, themeObj: themeById('service'), cond: 'none', kit: 'service', heat: 1, calm: true, terminal: STATIONS[n] && STATIONS[n].log, tutorial: true };
  }

  begin() {
    this.active = true;
    this.station = -1;
    this.counts = {};
    this.objective = '';
    this.done = false;
  }

  end() { this.active = false; this.objective = ''; }

  t(touchText, keyText) { return this.game.input.usingTouch ? touchText : keyText; }

  onRoomEnter(room) {
    const g = this.game;
    const n = room.ctx.station;
    this.station = n;
    this.counts = {};
    this.done = false;
    this.deadAt = null;
    this.peak = 0;
    this.room = room;
    this.startPos = g.player.body.pos.clone();
    g.enemies.lastKill = g.time;
    room.state = 'tutorial';
    for (const d of room.exitDoors) room.setDoor(d, 'locked');
    room.setSign(room.exitDoors[0], ['SEALED', STATIONS[n].name], '#ff3150');
    g.hud.banner('TRAINING ' + String(n + 1).padStart(2, '0'), STATIONS[n].name, '#7fe0b8', 2.2);
    g.audio.play('terminal', null, 0.5);
    const lx = (x) => room.wx(x), lz = (z) => room.wz(z);
    const dummy = (x, z, opts = {}) => {
      const e = g.enemies.spawn(opts.type || 'husk', new THREE.Vector3(lx(x), 0.05, lz(z)), { hpMul: opts.hpMul || 0.6, dmgMul: opts.dmg || 0, aggr: opts.aggr || 50 });
      if (!opts.live) e.attackCd = 1e9;
      e.tutorial = true;
      return e;
    };
    this.dummies = [];
    switch (n) {
      case 0:
        g.hint(this.t('Drag the LEFT side to move, the RIGHT side to look. Read terminals with USE.', 'WASD to move, mouse to look. Walk up to the green terminal and press E to read it.'), 8);
        break;
      case 1:
        this.dummies = [dummy(-4, -6), dummy(0, -8), dummy(4, -6)];
        g.hint(this.t('Hold FIRE to shoot. Drag on FIRE to aim while shooting. RLD reloads.', 'LMB to fire. Headshots deal more. R to reload.'), 7);
        break;
      case 2:
        g.weapons.give('breacher');
        g.weapons.select('hammer');
        this.dummies = [dummy(0, -8, { hpMul: 3 })];
        g.hint(this.t('Tap a weapon chip or SWAP to switch. ALT with the Hammer flips a coin: shoot the coin to ricochet.', 'Number keys / wheel / Q switch weapons. RMB with the Hammer flips a coin: shoot the coin mid-air to ricochet into the target.'), 9);
        break;
      case 3:
        g.hint(this.t('JUMP over the slag. DASH in mid-air to go further.', 'SPACE to jump, SHIFT to dash. Dash in mid-air to carry over the slag.'), 7);
        break;
      case 4:
        g.hint(this.t('Hold SLIDE while running to slide under the gate.', 'Run and hold CTRL (or C) to slide under the gate. Slides keep your speed.'), 7);
        break;
      case 5:
        g.hint(this.t('Jump into the gap by the right wall and JUMP again while touching a wall.', 'Jump into the narrow gap on the right, then press SPACE again while touching a wall to wall-jump up.'), 8);
        break;
      case 6:
        g.hint(this.t('Hold JUMP to hop the instant you land: you keep all your speed. Slide, then jump, for a burst.', 'Hold SPACE to bunny hop: jumping the instant you land keeps your speed. Steer with the mouse while strafing to gain more.'), 9);
        break;
      case 7:
        this.dummies = [dummy(0, -8, { hpMul: 40, dmg: 0.2, aggr: 0.55, live: true })];
        g.hint(this.t('Tap PARRY just before an orb hits you to send it back.', 'Press F just before an orb hits you. A parried orb flies back for huge damage and heals you.'), 8);
        break;
      case 8:
        g.hint(this.t('Step on the pad to launch onto the ledge. HOOK pulls you to walls and pulls light enemies to you.', 'Step on the pad to launch onto the ledge. G fires the hook: it pulls you to walls and yanks light enemies to you.'), 9);
        this.dummies = [dummy(-5, -8, { type: 'husk' }), dummy(5, -8, { type: 'husk' })];
        break;
      case 9:
        g.weapons.give('ripsaw');
        for (const [x, z, type] of [[-5, -6, 'husk'], [5, -6, 'husk'], [0, -9, 'gunner'], [-2, -5, 'ripper'], [2, -5, 'ripper']]) this.dummies.push(dummy(x, z, { type, hpMul: 0.8, dmg: 0.45, aggr: 1.2, live: true }));
        g.hint(this.t('Everything at once. Slide in mid-air to SLAM the ground.', 'Everything at once. Press CTRL in mid-air to ground-slam. Kills up close heal you.'), 8);
        break;
      default: break;
    }
    // give() auto-equips and emits 'swap': the station's own setup must not tick its objectives
    this.counts = {};
    this.update(0);
  }

  onEvent(ev, data) {
    if (!this.active) return;
    this.counts[ev] = (this.counts[ev] || 0) + 1;
    if (ev === 'bhop') this.bestChain = Math.max(this.bestChain || 0, data || 0);
  }

  update() {
    if (!this.active || this.done || !this.room) return;
    const g = this.game, room = this.room, c = this.counts;
    const p = g.player.body.pos;
    const lz = p.z - room.origin.z;
    const killed = this.dummies.filter((e) => !e.alive).length;
    let obj = '', ok = false;
    switch (this.station) {
      case 0: {
        const moved = p.distanceTo(this.startPos);
        obj = 'WALK TO THE DOOR';
        ok = moved > 6;
        break;
      }
      case 1: obj = 'DESTROY THE TARGETS  ' + killed + ' / 3'; ok = killed >= 3; break;
      case 2: {
        // any coin shot out of the air counts (a ricochet with no target left still proves it)
        const sw = (c.swap || 0) > 0, rs = (c.ricoshot || 0) + (c.coinhit || 0) > 0;
        // re-pressing the held weapon's key cycles the Hammer to PIERCER, which has no coin
        const noCoin = g.weapons.variantId('hammer') !== 'marksman';
        const w = g.weapons, onHammer = (w.switchTo || w.current) === 'hammer';
        obj = !sw ? 'SWITCH WEAPONS' : rs ? 'DONE'
          : !onHammer && !c.coin ? this.t('SWITCH TO THE HAMMER TO FLIP COINS', 'SWITCH TO THE HAMMER (1) TO FLIP COINS')
            : noCoin ? this.t('TAP THE HAMMER AGAIN: MARKSMAN FLIPS COINS', 'PRESS 1 ON THE HAMMER: MARKSMAN FLIPS COINS')
              : 'FLIP A COIN, THEN SHOOT IT MID-AIR' + (c.coin ? '  · ' + c.coin + ' FLIPS' : '');
        ok = sw && rs;
        this.respawnDummy(0, -8, { hpMul: 3 });
        break;
      }
      case 3: obj = 'CROSS THE SLAG'; ok = lz < -4 && g.player.body.grounded; break;
      case 4: obj = 'SLIDE UNDER THE GATE'; ok = lz < -2.2; break;
      case 5: obj = 'CLIMB OVER THE WALL  · WALL JUMPS ' + (c.walljump || 0); ok = lz < -2.5; break;
      case 6: {
        const hops = c.bhop || 0;
        const fast = g.player.speedNow;
        this.peak = Math.max(this.peak || 0, fast);
        obj = hops < 4 ? 'BUNNY HOP  ' + hops + ' / 4' : 'REACH 16 M/S  · PEAK ' + this.peak.toFixed(1);
        ok = hops >= 4 && this.peak >= 16;
        break;
      }
      case 7: {
        const n = c.parry || 0;
        obj = 'PARRY ORBS  ' + Math.min(2, n) + ' / 2';
        ok = n >= 2;
        if (!ok) this.respawnDummy(0, -8, { hpMul: 40, dmgMul: 0.2, aggr: 0.55, live: true });
        break;
      }
      case 8: {
        // getting over the ledge some other way (hook, wall tech) counts: never ask to go back
        const pad = (c.pad || 0) > 0 || lz < -2, hook = c.hook || 0;
        obj = !pad ? 'USE THE LAUNCH PAD' : hook < 2 ? 'FIRE THE HOOK  ' + hook + ' / 2' : 'CROSS THE LEDGE';
        ok = pad && hook >= 2 && lz < -2;
        break;
      }
      case 9: {
        const left = this.dummies.filter((e) => e.alive).length;
        obj = 'CLEAR THE ROOM  ' + left + ' LEFT';
        ok = left === 0;
        // the room is not in 'combat' state, so the straggler hunt never kicks in on its own
        if (!ok && g.time - (g.enemies.lastKill || 0) > 15) for (const e of this.dummies) if (e.alive && !e.flying) e.hunt = true;
        break;
      }
      default: break;
    }
    this.objective = obj;
    if (ok) this.complete();
  }

  // keep a target standing in stations that need one (a destroyed dummy comes back after a beat)
  respawnDummy(x, z, opts) {
    const g = this.game, room = this.room;
    if (this.dummies.some((e) => e.alive)) { this.deadAt = null; return; }
    if (this.deadAt == null) this.deadAt = g.time;
    if (g.time - this.deadAt < 1.2) return;
    this.deadAt = null;
    const e = g.enemies.spawn('husk', new THREE.Vector3(room.wx(x), 0.05, room.wz(z)), { hpMul: opts.hpMul || 1, dmgMul: opts.dmgMul || 0, aggr: opts.aggr || 50 });
    if (!opts.live) e.attackCd = 1e9;
    e.tutorial = true;
    this.dummies = [e];
  }

  complete() {
    const g = this.game, room = this.room;
    this.done = true;
    this.objective = 'STATION CLEAR  ·  PROCEED ^';
    room.state = 'cleared';
    const last = this.station >= STATIONS.length - 1;
    room.routes = [{ type: 'tutorial', label: last ? 'FINISH' : 'NEXT', sub: last ? 'TRAINING COMPLETE' : STATIONS[this.station + 1].name, color: '#7fe0b8' }];
    room.setDoor(room.exitDoors[0], 'choose');
    room.setSign(room.exitDoors[0], [room.routes[0].label, room.routes[0].sub], '#7fe0b8');
    g.audio.play('clear', null, 0.7);
    g.style.add('LESSON LEARNED', 30);
    g.player.heal(100);
    for (const id of g.weapons.owned) g.weapons.addAmmo(id, 3);
  }

  get isLast() { return this.station >= STATIONS.length - 1; }
}
