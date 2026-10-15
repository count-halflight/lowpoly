// The descent: 10 strata x 5 levels = 50 level varieties. A playthrough picks 3 levels per
// stratum (30 levels) in a seeded random order, so every run and every NG+ cycle differs.
// Each level has its own name, briefing, mechanical condition and room-archetype mix.

export const CONDITIONS = {
  none: { name: '', desc: '' },
  lowgrav: { name: 'LOW GRAVITY', desc: 'Gravity generators are failing. Jumps carry far.' },
  dark: { name: 'BLACKOUT', desc: 'Most lights are dead. Enemies glow; your shoulder lamp is on.' },
  ice: { name: 'FROST', desc: 'Frozen floors. Momentum keeps carrying you.' },
  conveyor: { name: 'CONVEYORS', desc: 'The floor belts are still running.' },
  barrels: { name: 'VOLATILE STOCK', desc: 'Explosive barrels everywhere. Shoot them near enemies.' },
  pads: { name: 'LAUNCH PADS', desc: 'Jump pads fling you across rooms.' },
  swarm: { name: 'NESTING', desc: 'Wisps nest here.' },
  snipers: { name: 'CROSSFIRE', desc: 'Lancers hold the high ground.' },
  heavies: { name: 'HEAVY PLANT', desc: 'Bulwarks and Gunners guard this sector.' },
  haste: { name: 'OVERCLOCKED', desc: 'Enemies move and fire faster.' },
  fog: { name: 'SMOG', desc: 'Visibility is poor. Listen for them.' },
  bloodfuel: { name: 'BLOOD FUEL', desc: 'No health drops. Kills heal twice as much.' },
  glass: { name: 'GLASS JAW', desc: 'Everyone deals 50% more damage.' },
  hazards: { name: 'LIVE WIRING', desc: 'Most rooms are wired with hazards.' },
};

export const STRATA = [
  { n: 1, theme: 'service', name: 'SERVICE DECKS', kit: 'service', lore: 'The maintenance levels under the city, where the first workers were connected to the Grid. The lights here never go out. They are not allowed to.' },
  { n: 2, theme: 'foundry', name: 'THE FOUNDRY', kit: 'foundry', lore: 'Smelters that cast every cable, tower and pylon. The furnaces are fed with slag, coal, and things that used to be workers.' },
  { n: 3, theme: 'cryo', name: 'COLD STORAGE', kit: 'cryo', lore: 'Where the connected are kept cold until the Grid needs them. Rows upon rows of sleepers, humming.' },
  { n: 4, theme: 'reactor', name: 'REACTOR COMPLEX', kit: 'reactor', lore: 'Ghost-current reactors. Each core burns the residual charge of the dead and turns it into daylight for the towers above.' },
  { n: 5, theme: 'research', name: 'THE ARCHIVE', kit: 'archive', lore: 'The research wing and the registry of souls. Every connection is recorded here, including yours.' },
  { n: 6, theme: 'slaughter', name: 'SLAUGHTERWORKS', kit: 'slaughter', lore: 'Where bodies that are no longer useful are rendered into insulation, lubricant and fuel. Nothing is wasted. Nothing.' },
  { n: 7, theme: 'orbital', name: 'ORBITAL FOUNDRY', kit: 'orbital', lore: 'A mile-high shaft tethered to the mirror satellites. From the windows you can see the city lights, and how few of them are homes.' },
  { n: 8, theme: 'choir', name: 'THE CHOIR', kit: 'choir', lore: 'The machines that service the Grid began to sing. They built a cathedral to the current. The hymns are very loud.' },
  { n: 9, theme: 'breach', name: 'THE BREACH', kit: 'breach', lore: 'Under the reactors the current leaked through into somewhere else. Something on the other side noticed, and leaked back.' },
  { n: 10, theme: 'core', name: 'THE CORE', kit: 'core', lore: 'The seat of the Architect. Black halls, white light, and the hum of eleven million souls keeping the city bright.' },
];

const L = (s, i, name, cond, desc, arches, extra = {}) => ({ id: `${s}-${i}`, stratum: s, i, name, cond, desc, arches, ...extra });

export const LEVELS = [
  // 1 SERVICE DECKS
  L(1, 1, 'NIGHT SHIFT', 'none', 'The first deck. The lights flicker on as you pass, like they are glad to see someone moving.', { gauntlet: 3, arena: 2, cells: 2, warehouse: 1 }),
  L(1, 2, 'BREAKER ROW', 'hazards', 'A corridor of live breakers. Somebody left them all on, forever.', { hazard: 3, gauntlet: 2, movers: 1, cells: 1 }),
  L(1, 3, 'LOCKER CITY', 'barrels', 'Locker rooms for ten thousand workers. The lockers still have names on them.', { cells: 3, warehouse: 2, arena: 1 }),
  L(1, 4, 'THE PIPEWORKS', 'pads', 'Steam pipes, pressure valves, and launch pads left by the maintenance crews.', { tower: 3, mezzanine: 2, bridges: 1, arena: 1 }),
  L(1, 5, 'LAMPLIGHTER\'S WAY', 'dark', 'The only dark corridor on the decks. The lamplighters went in to fix it. The lamplighters are still in there.', { gauntlet: 2, cells: 2, arena: 1, hall: 1 }),
  // 2 FOUNDRY
  L(2, 1, 'SLAG CATHEDRAL', 'none', 'A cooling hall so tall it has weather. Ash falls like snow.', { arena: 3, pit: 2, reactor: 1, mezzanine: 1 }),
  L(2, 2, 'THE POURING FLOOR', 'hazards', 'Rivers of molten steel run in open channels across the floor.', { bridges: 3, hazard: 2, pit: 1 }),
  L(2, 3, 'INGOT YARD', 'conveyor', 'Conveyor belts carry fresh ingots toward the rolling mills. And you.', { movers: 2, warehouse: 2, arena: 1, gallery: 1 }),
  L(2, 4, 'CRUCIBLE STACKS', 'heavies', 'The heavy plant. Bulwarks stand guard over the crucibles.', { mezzanine: 2, arena: 2, tower: 1, pit: 1 }),
  L(2, 5, 'BLOWER HALL', 'haste', 'Giant bellows breathe through the hall. Everything moves faster in the draft.', { arena: 2, gauntlet: 2, movers: 1, survival: 1 }),
  // 3 COLD STORAGE
  L(3, 1, 'THE SLEEPER AISLES', 'ice', 'Endless racks of frozen sleepers. Your breath fogs. Theirs does not.', { warehouse: 3, gauntlet: 2, cells: 1 }),
  L(3, 2, 'FROST VAULT', 'fog', 'A vault so cold the air itself has crystallized into a mist.', { arena: 2, cells: 2, pit: 1, hall: 1 }),
  L(3, 3, 'MEAT LOCKER NINE', 'bloodfuel', 'The freezer that was not supposed to be opened. Someone opened it.', { cells: 3, gauntlet: 1, survival: 1 }),
  L(3, 4, 'THAW CHAMBER', 'hazards', 'Where sleepers are warmed for harvest. The coolant spills are toxic.', { hazard: 2, reactor: 2, bridges: 1, arena: 1 }),
  L(3, 5, 'CRYO SPIRE', 'lowgrav', 'A vertical tower of cryo-pods. Its gravity plating has frozen too.', { tower: 3, mezzanine: 2, pit: 1 }),
  // 4 REACTOR
  L(4, 1, 'CONTAINMENT', 'hazards', 'Coolant trenches surround the reactor cores. Do not fall in.', { reactor: 3, hazard: 2, pit: 1 }),
  L(4, 2, 'CONTROL ROOM', 'snipers', 'Glass-walled control galleries with long sightlines. Lancers love it.', { gallery: 3, mezzanine: 2, gauntlet: 1 }),
  L(4, 3, 'FUEL ROD STORAGE', 'barrels', 'Spent fuel casks stacked high. Some of them are still warm.', { warehouse: 3, arena: 1, cells: 1 }),
  L(4, 4, 'THE COOLING TOWERS', 'lowgrav', 'Hollow towers vented to the sky. Updrafts make you light.', { tower: 3, pit: 2, bridges: 1 }),
  L(4, 5, 'CRITICAL MASS', 'glass', 'A reactor running at 140%. Everything hits harder here, including you.', { arena: 2, reactor: 2, survival: 1, movers: 1 }),
  // 5 ARCHIVE
  L(5, 1, 'THE REGISTRY', 'none', 'Filing cabinets the size of houses. Every soul in the city has a drawer.', { warehouse: 3, cells: 2, hall: 1 }),
  L(5, 2, 'SPECIMEN HALL', 'swarm', 'Research specimens in glass tanks. Some of the glass is broken.', { cells: 2, arena: 2, gallery: 1, survival: 1 }),
  L(5, 3, 'THE STACKS', 'dark', 'Data stacks in permanent darkness. The servers hum like a crowd.', { warehouse: 2, gauntlet: 2, mezzanine: 1, cells: 1 }),
  L(5, 4, 'LECTURE THEATRE', 'snipers', 'Tiered seating around a demonstration floor. You are the demonstration.', { mezzanine: 3, pit: 2, gallery: 1 }),
  L(5, 5, 'REDACTION WING', 'haste', 'Where inconvenient records are destroyed. The shredders never stop.', { movers: 2, gauntlet: 2, arena: 1, hazard: 1 }),
  // 6 SLAUGHTERWORKS
  L(6, 1, 'THE KILLING FLOOR', 'bloodfuel', 'Grated floors over drainage channels. You do not want to know what drains.', { arena: 2, bridges: 2, hazard: 1, survival: 1 }),
  L(6, 2, 'HOOK LINE', 'conveyor', 'An overhead line of hooks still moving bodies toward the renderers.', { movers: 3, gauntlet: 2, warehouse: 1 }),
  L(6, 3, 'RENDERING VATS', 'hazards', 'Vats of boiling tallow. The smell is a physical presence.', { pit: 3, hazard: 2, reactor: 1 }),
  L(6, 4, 'CARCASS COLD ROOM', 'ice', 'Hung carcasses swing as you pass. Some swing back.', { cells: 2, warehouse: 2, gauntlet: 1, arena: 1 }),
  L(6, 5, 'THE BONEYARD', 'heavies', 'Where the rendered remains are piled. The piles are guarded.', { arena: 3, mezzanine: 1, survival: 1, tower: 1 }),
  // 7 ORBITAL
  L(7, 1, 'TETHER BASE', 'lowgrav', 'The bottom of the orbital tether. Gravity already feels optional.', { tower: 2, arena: 2, bridges: 1, mezzanine: 1 }),
  L(7, 2, 'MIRROR ASSEMBLY', 'snipers', 'Clean rooms where the orbital mirrors are polished. Every surface reflects you.', { gallery: 3, hall: 1, mezzanine: 1 }),
  L(7, 3, 'LAUNCH GANTRY', 'pads', 'Launch rails and cargo catapults. Ride them.', { tower: 3, bridges: 2, arena: 1 }),
  L(7, 4, 'VACUUM DOCKS', 'fog', 'Docking bays venting atmosphere. The air is thin and full of frost.', { warehouse: 2, arena: 2, pit: 1, movers: 1 }),
  L(7, 5, 'STARLIGHT CONCOURSE', 'haste', 'A grand concourse under a glass roof. You can see the mirror-sats wheeling overhead.', { hall: 2, arena: 2, survival: 1, gallery: 1 }),
  // 8 CHOIR
  L(8, 1, 'NAVE OF CURRENT', 'none', 'The great nave. Pews of conduit, an altar of transformers.', { hall: 3, arena: 2, mezzanine: 1 }),
  L(8, 2, 'THE BELFRY', 'lowgrav', 'A bell tower whose bells are capacitors. Every toll lifts you off your feet.', { tower: 3, pit: 1, bridges: 1 }),
  L(8, 3, 'CLOISTER OF WIRES', 'dark', 'Quiet cloisters where the acolytes pray in the dark.', { cells: 2, gauntlet: 2, hall: 1, arena: 1 }),
  L(8, 4, 'CHOIR LOFT', 'snipers', 'Galleries above the nave. The choir looks down on you.', { mezzanine: 3, gallery: 2, hall: 1 }),
  L(8, 5, 'THE RELIQUARY', 'glass', 'Relics of the first connected. Touching them is a sin. So is everything you are about to do.', { arena: 2, survival: 1, pit: 1, reactor: 1 }),
  // 9 BREACH
  L(9, 1, 'FIRST CRACK', 'none', 'The rift began here as a hairline fracture in a reactor wall.', { arena: 2, bridges: 2, pit: 1, hazard: 1 }),
  L(9, 2, 'INVERTED GARDENS', 'lowgrav', 'Plants from somewhere else grow down from the ceiling. Gravity is confused.', { tower: 2, pit: 2, arena: 1 }),
  L(9, 3, 'THE MURMUR', 'fog', 'A fog that whispers. Some of the whispers are true.', { cells: 2, gauntlet: 2, arena: 1 }),
  L(9, 4, 'GLASS SHORE', 'hazards', 'A beach of black glass beside a sea that is not water.', { bridges: 3, hazard: 2, arena: 1 }),
  L(9, 5, 'THE WOUND', 'swarm', 'The widest point of the Breach. Things pour through.', { survival: 2, arena: 2, pit: 1, reactor: 1 }),
  // 10 CORE
  L(10, 1, 'BLACK HALLS', 'dark', 'Corridors of polished black stone, lit by nothing but the current.', { hall: 3, gauntlet: 2, cells: 1 }),
  L(10, 2, 'THE SWITCHYARD', 'hazards', 'A forest of switches routing the city\'s power. Every one is live.', { hazard: 2, movers: 2, bridges: 1, arena: 1 }),
  L(10, 3, 'MEMORY BANKS', 'heavies', 'Where the Architect keeps the minds it has not finished using.', { warehouse: 2, mezzanine: 2, arena: 1, gallery: 1 }),
  L(10, 4, 'THE LAST SUBSTATION', 'haste', 'The final relay before the Core itself. Everything here is in a hurry.', { arena: 2, survival: 1, movers: 1, tower: 1 }),
  L(10, 5, 'THRESHOLD', 'glass', 'The doors of the Core. Behind them, the Architect is waiting for you specifically.', { arena: 2, hall: 2, pit: 1 }),
];

export const FINAL_LEVEL = { id: 'X', stratum: 10, name: 'THE ARCHITECT', cond: 'none', desc: 'The center of the Grid. The breaker is behind it.' };

export function stratumOf(level) { return STRATA[level.stratum - 1]; }
