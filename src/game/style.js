// Style meter: rewards aggressive, varied play with score multipliers. Ranks decay over
// time and drop when you get hit.
export const RANKS = [
  { l: 'D', w: 'DULL', c: '#9aa0a8', mult: 1 },
  { l: 'C', w: 'CRISP', c: '#3ef0d0', mult: 1.25 },
  { l: 'B', w: 'BRUTAL', c: '#7aff7a', mult: 1.5 },
  { l: 'A', w: 'ARDENT', c: '#ffe23a', mult: 2 },
  { l: 'S', w: 'SAVAGE', c: '#ff8a1a', mult: 2.5 },
  { l: 'SS', w: 'SUPERNOVA', c: '#ff3050', mult: 3 },
  { l: 'X', w: 'VOLTGRAVE', c: '#ff3df0', mult: 4 },
];

export class Style {
  constructor(game) {
    this.game = game;
    this.reset();
  }
  reset() {
    this.rankIndex = 0;
    this.meter = 0;
    this.score = 0;
    this.feed = [];
    this.routeMult = 1;
    this.peak = 0;
    this.idle = 0;
  }
  get rank() { return RANKS[this.rankIndex]; }

  add(name, pts, quiet = false) {
    const g = this.game;
    if (g.state !== 'playing' && name !== 'ROOM CLEAR') return;
    const gain = pts * (1 / (1 + this.rankIndex * 0.3));
    this.meter += gain;
    this.idle = 0;
    const scored = Math.round(pts * this.rank.mult * this.routeMult);
    this.score += scored;
    while (this.meter >= 100) {
      if (this.rankIndex < RANKS.length - 1) {
        this.rankIndex++;
        this.meter -= 100;
        this.peak = Math.max(this.peak, this.rankIndex);
        g.audio.play('rankUp', null, 0.6);
      } else { this.meter = 100; break; }
    }
    if (quiet) return;
    const last = this.feed[0];
    if (last && last.name === name && g.time - last.t < 1.2) {
      last.count++; last.pts += scored; last.t = g.time;
    } else {
      this.feed.unshift({ name, pts: scored, count: 1, t: g.time });
      if (this.feed.length > 6) this.feed.pop();
    }
  }

  onPlayerHit(dmg) {
    this.meter -= dmg * 2.2;
    this.normalize();
  }

  normalize() {
    while (this.meter < 0) {
      if (this.rankIndex > 0) { this.rankIndex--; this.meter += 70; }
      else { this.meter = 0; break; }
    }
  }

  update(dt, inCombat) {
    this.idle += dt;
    if (inCombat) {
      const decay = 5 + this.rankIndex * 4.5;
      this.meter -= decay * dt * (this.idle > 2 ? 1.6 : 1);
      this.normalize();
    } else if (this.rankIndex > 0 || this.meter > 0) {
      // slow cool-down between rooms
      this.meter -= 8 * dt;
      this.normalize();
    }
    const now = this.game.time;
    this.feed = this.feed.filter((f) => now - f.t < 4);
  }
}
