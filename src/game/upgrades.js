import { DEFS, WEAPON_ORDER } from './weapons.js';
import { defaultStats } from './player.js';

// Every upgrade has a concrete, implemented effect on player stats or weapon behaviour.
export const UPGRADES = [
  // ---- common
  { id: 'hairtrigger', name: 'HAIR TRIGGER', rarity: 'common', max: 4, desc: '+15% fire rate on all weapons.', apply: (s) => { s.fireRateMul *= 1.15; } },
  { id: 'quickhands', name: 'QUICK HANDS', rarity: 'common', max: 3, desc: '+30% reload speed.', apply: (s) => { s.reloadMul *= 1.3; } },
  { id: 'frame', name: 'REINFORCED FRAME', rarity: 'common', max: 4, desc: '+25 max health and heal 25.', apply: (s, g) => { s.maxHp += 25; g.player.heal(25); } },
  { id: 'servo', name: 'SERVO LEGS', rarity: 'common', max: 3, desc: '+10% move, dash and slide speed.', apply: (s) => { s.moveMul *= 1.1; } },
  { id: 'mags', name: 'EXTENDED MAGS', rarity: 'common', max: 3, desc: '+30% magazine size and ammo capacity.', apply: (s, g) => { s.magMul *= 1.3; for (const id of g.weapons.owned) g.weapons.ammo[id].mag = g.weapons.magSize(id); } },
  { id: 'headhunter', name: 'HEADHUNTER', rarity: 'common', max: 3, desc: '+40% weak-point and headshot damage.', apply: (s) => { s.headMul *= 1.4; } },
  { id: 'steady', name: 'STEADY GRIP', rarity: 'common', max: 2, desc: '-35% spread, -40% recoil.', apply: (s) => { s.spreadMul *= 0.65; } },
  { id: 'scavenger', name: 'SCAVENGER', rarity: 'common', max: 2, desc: 'Pickups give +50% more and are pulled in from further away.', apply: (s) => { s.pickupMul *= 1.5; s.magnet += 3; } },
  { id: 'secondwind', name: 'SECOND WIND', rarity: 'common', max: 2, desc: '+1 dash charge and faster dash recharge.', apply: (s, g) => { s.dashCharges += 1; s.dashRegen *= 0.85; g.player.dashCharges = s.dashCharges; } },
  { id: 'hardlight', name: 'HARDLIGHT SHIELD', rarity: 'common', max: 3, desc: '+25 shield that regenerates 4s after taking damage.', apply: (s, g) => { s.shieldMax += 25; g.player.shield = s.shieldMax; } },
  { id: 'bloodlust', name: 'BLOODLUST', rarity: 'common', max: 3, desc: 'Every kill heals 4 HP (close kills already heal).', apply: (s) => { s.healOnKill += 4; } },
  { id: 'powercell', name: 'POWER CELLS', rarity: 'common', max: 5, desc: '+12% damage with everything.', apply: (s) => { s.dmgMul *= 1.12; } },
  // ---- rare
  { id: 'detonator', name: 'DETONATOR ROUNDS', rarity: 'rare', max: 2, desc: 'Every 5th bullet hit (every 3rd at level 2) triggers a small explosion.', apply: (s) => { s.explosiveEvery += 1; } },
  { id: 'ricochet', name: 'RICOCHET', rarity: 'rare', max: 2, desc: 'Bullets that kill bounce into the nearest enemy.', apply: (s) => { s.ricochet += 1; } },
  { id: 'payload', name: 'HEAVY PAYLOAD', rarity: 'rare', max: 2, trade: true, desc: '+50% explosion damage, +20% blast radius. Thumper fires 20% slower.', apply: (s) => { s.explosiveDmgMul *= 1.5; s.explosiveRadiusMul *= 1.2; s.launcherRateMul *= 0.8; } },
  { id: 'glass', name: 'GLASS CANNON', rarity: 'rare', max: 1, trade: true, desc: '+35% damage. -30 max health.', apply: (s, g) => { s.dmgMul *= 1.35; s.maxHp = Math.max(40, s.maxHp - 30); g.player.hp = Math.min(g.player.hp, s.maxHp); } },
  { id: 'ram', name: 'RAMMING DASH', rarity: 'rare', max: 2, desc: 'Dashing through enemies deals 40 damage and staggers them.', apply: (s) => { s.ramDash += 1; } },
  { id: 'parry', name: 'PARRY MASTER', rarity: 'rare', max: 1, desc: 'Bigger parry window, parried shots hit twice as hard and heal +15 more.', apply: (s) => { s.parryMul = 2; } },
  { id: 'adrenaline', name: 'ADRENALINE', rarity: 'rare', max: 2, desc: 'At style rank A or higher: +25% fire rate and move speed.', apply: (s) => { s.adrenaline += 1; } },
  { id: 'crater', name: 'SLAM CRATER', rarity: 'rare', max: 1, desc: 'Ground slam (crouch in mid-air) deals 3x damage in a bigger radius.', apply: (s) => { s.slamMul = 3; } },
  { id: 'elitekiller', name: 'GIANT SLAYER', rarity: 'rare', max: 2, desc: '+25% damage to elites and bosses.', apply: (s) => { s.elitesMul *= 1.25; } },
  // ---- weapon specific
  { id: 'buckshot', name: 'BUCKSHOT+', rarity: 'common', max: 2, weapon: 'breacher', desc: 'Breacher fires 4 extra pellets.', apply: (s) => { s.shotgunPellets += 4; } },
  { id: 'cluster', name: 'CLUSTER MUNITIONS', rarity: 'rare', max: 2, weapon: 'thumper', desc: 'Thumper grenades burst into 3 bomblets.', apply: (s) => { s.cluster += 1; } },
  { id: 'prism', name: 'PRISM CAPACITOR', rarity: 'rare', max: 2, weapon: 'lance', desc: 'Lance charges 40% faster. Multi-kills refund a cell.', apply: (s) => { s.lanceCharge *= 1.4; } },
  { id: 'deadeye', name: 'DEADEYE', rarity: 'rare', max: 2, weapon: 'hammer', desc: 'Hammer headshots refund the round and deal +50% damage.', apply: (s) => { s.deadeye += 1; } },
  { id: 'tesla', name: 'TESLA COIL', rarity: 'common', max: 2, weapon: 'arc', desc: 'Arc Caster chains to 2 more enemies.', apply: (s) => { s.arcJumps += 2; } },
  { id: 'hollow', name: 'HOLLOW POINTS', rarity: 'common', max: 2, weapon: 'ripsaw', desc: 'Ripsaw +25% damage and bullets pierce one enemy.', apply: (s) => { s.rifleDmg *= 1.25; s.riflePierce = 1; } },
  // ---- legendary (boss / elite rewards)
  { id: 'overclock', name: 'OVERCLOCK CORE', rarity: 'legendary', max: 2, desc: '+20% damage, +20% fire rate, +10% move speed.', apply: (s) => { s.dmgMul *= 1.2; s.fireRateMul *= 1.2; s.moveMul *= 1.1; } },
  { id: 'phoenix', name: 'PHOENIX MODULE', rarity: 'legendary', max: 1, desc: 'Once per run: survive a lethal hit at 50% HP with a huge blast.', apply: (s) => { s.phoenix = 1; } },
  { id: 'vampiric', name: 'VAMPIRIC FIELD', rarity: 'legendary', max: 2, desc: '3% of all damage you deal heals you.', apply: (s) => { s.vampiric += 1; } },
  { id: 'chain', name: 'CHAIN REACTION', rarity: 'legendary', max: 1, desc: 'Enemies killed by explosions explode too.', apply: (s) => { s.chainReaction = 1; } },
];

const RARITY_W = {
  standard: { common: 80, rare: 19, legendary: 1 },
  rare: { common: 35, rare: 55, legendary: 10 },
  boss: { common: 0, rare: 40, legendary: 60 },
  supply: { common: 70, rare: 28, legendary: 2 },
};

export class Upgrades {
  constructor(game) {
    this.game = game;
    this.reset();
  }
  reset() { this.stacks = {}; this.taken = []; }

  // checkpoint support: rebuild player stats by re-applying every stack
  snapshot() { return { stacks: { ...this.stacks }, taken: this.taken.slice() }; }
  restore(s) {
    const g = this.game;
    this.stacks = {};
    this.taken = s.taken.slice();
    g.player.stats = defaultStats();
    for (const [id, n] of Object.entries(s.stacks)) {
      const u = UPGRADES.find((x) => x.id === id);
      if (!u) continue;
      for (let k = 0; k < n; k++) { this.stacks[id] = (this.stacks[id] || 0) + 1; u.apply(g.player.stats, g); }
    }
  }

  available(u) {
    if ((this.stacks[u.id] || 0) >= u.max) return false;
    if (u.weapon && !this.game.weapons.owned.includes(u.weapon)) return false;
    return true;
  }

  // Build a list of reward cards. Each card: {kind:'upgrade'|'weapon'|'heal', ...}
  offer(kind, rng) {
    const g = this.game;
    const cards = [];
    const locked = WEAPON_ORDER.filter((id) => !g.weapons.owned.includes(id));
    const roomIdx = g.level.current ? g.level.current.index : 0;
    // weapon cards: guaranteed early shotgun, supply rooms and bosses offer new weapons
    if (locked.length) {
      if (kind === 'boss' || kind === 'supply' || (roomIdx === 2 && locked.includes('breacher'))) {
        const pick = roomIdx === 2 && locked.includes('breacher') ? 'breacher' : locked[Math.floor(rng.next() * locked.length)];
        cards.push(this.weaponCard(pick));
        if (kind === 'boss' && locked.length > 1) {
          const other = locked.filter((x) => x !== pick);
          cards.push(this.weaponCard(other[Math.floor(rng.next() * other.length)]));
        }
      }
    }
    const w = RARITY_W[kind] || RARITY_W.standard;
    const pool = UPGRADES.filter((u) => this.available(u));
    let guard = 0;
    while (cards.length < 3 && pool.length && guard++ < 50) {
      const u = rng.weighted(pool, (x) => w[x.rarity] * (x.weapon && x.weapon === g.weapons.current ? 1.6 : 1));
      pool.splice(pool.indexOf(u), 1);
      cards.push({ kind: 'upgrade', id: u.id, name: u.name, desc: u.desc, rarity: u.rarity, trade: !!u.trade, stack: (this.stacks[u.id] || 0) + 1, max: u.max, weapon: u.weapon });
    }
    if (cards.length < 3) cards.push({ kind: 'heal', name: 'FIELD REPAIR', desc: 'Restore 60 health and refill reserve ammo.', rarity: 'common' });
    return cards;
  }

  weaponCard(id) {
    const d = DEFS[id];
    return { kind: 'weapon', id, name: d.full, desc: d.desc, rarity: 'weapon', color: d.color };
  }

  take(card) {
    const g = this.game;
    if (card.kind === 'weapon') {
      g.weapons.give(card.id);
      g.hud.toast('NEW WEAPON: ' + DEFS[card.id].name, DEFS[card.id].color);
      this.taken.push(DEFS[card.id].name);
      return;
    }
    if (card.kind === 'heal') {
      g.player.heal(60);
      for (const id of g.weapons.owned) g.weapons.addAmmo(id, 3);
      return;
    }
    const u = UPGRADES.find((x) => x.id === card.id);
    if (!u || !this.available(u)) return;
    this.stacks[u.id] = (this.stacks[u.id] || 0) + 1;
    u.apply(g.player.stats, g);
    this.taken.push(u.name);
  }
}
