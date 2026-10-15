// 60 minibosses, six per stratum. Each pairs a chassis with two or three attack modules and
// an enrage set that unlocks below half health. stratum = where they are native (1-10);
// the campaign randomizes them with a bias toward the current depth.

const M = (stratum, id, name, title, chassis, colors, scale, abilities, enrage, lore, extra = {}) => ({ stratum, id, name, title, chassis, colors, scale, abilities, enrage, lore, hp: 700 + stratum * 45, ...extra });

export const MINIBOSSES = [
  // 1 SERVICE DECKS
  M(1, 'janitor', 'JANITOR PRIME', 'IT CLEANS UP AFTER', 'brute', [0x8a8a7a, 0x2a2a24, 0xffd060], 1.5, [['shockwave', {}], ['fan', { n: 5 }]], [['leap', {}]], 'Mops became flails when the cleaning crew was connected. The floors have never been cleaner.'),
  M(1, 'doorwarden', 'DOOR WARDEN', 'NO PASS, NO PASSAGE', 'knight', [0x7a7a8a, 0x22222a, 0xff3050], 1.4, [['lunge', {}], ['sweep', {}]], [['burst', {}]], 'Checks badges that expired with their owners.'),
  M(1, 'cablehound', 'CABLE HOUND', 'IT FOLLOWS THE CURRENT', 'spider', [0x5a5a6a, 0x1a1a22, 0x3ef0d0], 1.2, [['lunge', { count: 2 }], ['bounce', { n: 3 }]], [['mines', { n: 4 }]], 'Sniffs out breaks in the line. You are a break in the line.', { move: 'circle', speed: 5.5 }),
  M(1, 'fusebox', 'FUSEBOX', 'DO NOT OPEN', 'totem', [0x6a7080, 0x1a1c22, 0x40a0ff], 1.1, [['zap', {}], ['ring', { n: 14 }]], [['spokes', { n: 2 }]], 'A breaker panel that tripped once and decided never to reset.', { move: 'stationary' }),
  M(1, 'locksmith', 'THE LOCKSMITH', 'EVERY DOOR, EVERY KEY', 'walker', [0x8a7a5a, 0x2a2418, 0xffa040], 1.3, [['burst', {}], ['mortar', { n: 2 }]], [['charge', {}]], 'Holds keys to apartments that no longer have tenants.', { move: 'kite' }),
  M(1, 'dronemother', 'DRONE MOTHER', 'THE HIVE ON THE CEILING', 'swarm', [0x7a7a80, 0x202024, 0xff5030], 1.3, [['fan', { n: 6 }], ['summon', { types: ['wisp', 'wisp'], n: 2 }]], [['homing', { n: 2 }]], 'She builds wisps out of smoke detectors.'),
  // 2 FOUNDRY
  M(2, 'slagheaver', 'SLAG HEAVER', 'SHOVEL OF THE FURNACE', 'brute', [0x8a5a3a, 0x2a1a0a, 0xff7a20], 1.6, [['mortar', { n: 3 }], ['eruption', { n: 3 }]], [['flame', {}]], 'Twelve-hour shifts at the furnace mouth. It still has eleven to go.'),
  M(2, 'anvil', 'ANVIL', 'STRUCK A MILLION TIMES', 'tank', [0x6a6060, 0x201a1a, 0xff9030], 1.3, [['burst', {}], ['charge', {}]], [['shockwave', {}]], 'Every hammer blow in the Foundry landed on Anvil. Now it returns them.', { move: 'kite' }),
  M(2, 'bellows', 'BELLOWS', 'BREATHES FIRE', 'orb', [0x9a6a4a, 0x2a1810, 0xff6010], 1.3, [['flame', {}], ['pull', {}]], [['ring', {}]], 'A furnace lung that inhales anything nearby before it exhales.'),
  M(2, 'smeltwing', 'SMELTWING', 'THE GLOWING BIRD', 'hover', [0xa06040, 0x2a1008, 0xffa030], 1.3, [['fan', { n: 7 }], ['rain', { n: 8 }]], [['eruption', {}]], 'Sparks from the crucibles collected into the shape of a bird. It is very proud of itself.'),
  M(2, 'casterjack', 'CASTER JACK', 'MOLDS AND MURDERS', 'walker', [0x7a5a40, 0x2a1a10, 0xffb040], 1.4, [['mortar', { n: 3 }], ['flame', {}]], [['leap', {}]], 'Pours molds for components. Has started pouring molds of you.'),
  M(2, 'heatsinker', 'HEAT SINKER', 'IT DRINKS THE WARMTH', 'spider', [0x6a4a3a, 0x1a0e08, 0xff5020], 1.3, [['mines', {}], ['flame', {}]], [['pull', {}]], 'Crawls through cooling channels and steals the heat out of anything alive.', { move: 'circle' }),
  // 3 COLD STORAGE
  M(3, 'rimeback', 'RIMEBACK', 'THE FROZEN HAULER', 'bull', [0xa8c0d0, 0x2a3440, 0x9ff0ff], 0.9, [['charge', {}], ['shockwave', {}]], [['ring', {}]], 'Pulls sledges of sleepers between freezer halls. Hates being late.'),
  M(3, 'freezerburn', 'FREEZER BURN', 'THE COLD EYE', 'orb', [0xc0d8e8, 0x304050, 0x80e0ff], 1.3, [['spiral', { arms: 3 }], ['bounce', {}]], [['homing', { n: 3 }]], 'A thermostat that has been set to minus forever.'),
  M(3, 'iceman', 'THE ICEMAN', 'DELIVERS TO THE SLEEPERS', 'knight', [0xb0c8d8, 0x283440, 0x9ff0ff], 1.4, [['lunge', {}], ['ring', { n: 16 }]], [['zap', {}]], 'Walks the aisles of the frozen with a lantern no one asked for.'),
  M(3, 'frostlocust', 'FROST LOCUST', 'CUTS THROUGH ICE', 'mantis', [0x90b0c8, 0x202a34, 0x60d0ff], 1.3, [['lunge', { count: 2 }], ['sweep', {}]], [['blink', {}]], 'Harvest arm with a mind of its own. Prefers its harvest warm.'),
  M(3, 'hoarfrost', 'HOARFROST', 'CRYSTAL OF BREATH', 'crystal', [0xd0e8f8, 0x3a4a58, 0xa0f8ff], 1.4, [['bounce', {}], ['rain', {}]], [['spiral', {}]], 'The frozen exhalations of ten thousand sleepers, grown into a single thought.'),
  M(3, 'meatlocker', 'MEAT LOCKER', 'DOOR THAT WALKS', 'brute', [0x8a9aa8, 0x22282e, 0xff4050], 1.6, [['leap', {}], ['pull', {}]], [['summon', { types: ['ripper', 'ripper'], n: 2 }]], 'A walk-in freezer that walked out.'),
  // 4 REACTOR
  M(4, 'hotcell', 'HOT CELL', 'DO NOT TOUCH', 'orb', [0x6a9a6a, 0x1a2a1a, 0x6aff5a], 1.3, [['laser', {}], ['spiral', {}]], [['orbital', {}]], 'A shielded containment cell that got lonely.'),
  M(4, 'controlrod', 'CONTROL ROD', 'SCRAM DENIED', 'totem', [0x5a7a6a, 0x1a2a20, 0xa0ff60], 1.2, [['spokes', { n: 2 }], ['ring', {}]], [['zap', {}]], 'Refuses to drop into the core. Refuses to let you drop it either.', { move: 'stationary' }),
  M(4, 'geiger', 'GEIGER', 'CLICK CLICK CLICK', 'swarm', [0x7a8a5a, 0x22281a, 0xffff60], 1.2, [['homing', { n: 3 }], ['burst', {}]], [['mines', {}]], 'Counts particles. Counts you. You are a very high number.'),
  M(4, 'meltdownmolly', 'MELTDOWN MOLLY', 'SHE WENT CRITICAL', 'tank', [0x7a8a50, 0x22281a, 0xffa020], 1.3, [['mortar', { n: 4 }], ['flame', {}]], [['eruption', {}]], 'Reactor safety mascot. The posters had a different smile.', { move: 'kite' }),
  M(4, 'coolantcrawler', 'COOLANT CRAWLER', 'IT SWIMS IN THE TANKS', 'spider', [0x4a7a6a, 0x102a20, 0x60ffc0], 1.3, [['bounce', {}], ['mines', {}]], [['pull', {}]], 'Lives in coolant pools and only comes out to clean.', { move: 'circle' }),
  M(4, 'halfwit', 'THE HALF-WIT', 'HALF-LIFE\'S LITTLE BROTHER', 'walker', [0x6a7a5a, 0x1a2218, 0xff5050], 1.3, [['snipe', {}], ['burst', {}]], [['charge', {}]], 'Exposed to half the dose and twice the ego.', { move: 'kite', prefDist: 16 }),
  // 5 ARCHIVE
  M(5, 'librarian', 'LIBRARIAN', 'SILENCE IN THE STACKS', 'hover', [0xb0b4c0, 0x30343c, 0x40c8ff], 1.3, [['homing', { n: 3 }], ['blink', {}]], [['rain', {}]], 'Shushes gunfire. Is not polite about it.'),
  M(5, 'redactor', 'REDACTOR', 'BLACKS OUT THE TRUTH', 'knight', [0x404048, 0x101014, 0xff3050], 1.4, [['sweep', {}], ['laser', {}]], [['lunge', { count: 2 }]], 'Every line it strikes out disappears from someone\'s memory.'),
  M(5, 'footnote', 'FOOTNOTE', 'SMALL BUT RELEVANT', 'swarm', [0xa0a4b0, 0x2a2c34, 0x80e0ff], 1.1, [['bounce', {}], ['fan', { n: 6 }]], [['spiral', {}]], 'A cloud of citation drones. Please see appendix.'),
  M(5, 'index', 'INDEX', 'CROSS-REFERENCED', 'totem', [0x9098a8, 0x22262e, 0x60c0ff], 1.2, [['snipe', {}], ['ring', {}]], [['orbital', {}]], 'Knows where everything is filed, including you.', { move: 'stationary' }),
  M(5, 'specimen9', 'SPECIMEN 9', 'ESCAPED', 'spider', [0xc0b0a0, 0x302820, 0xff60a0], 1.3, [['lunge', {}], ['pull', {}]], [['summon', { types: ['ripper', 'wisp'], n: 2 }]], 'The first eight specimens are in jars. Nine got out.', { move: 'circle' }),
  M(5, 'peerreview', 'THE PEER REVIEW', 'REJECTED', 'orb', [0xb8b0c8, 0x2a2a3a, 0xffd060], 1.3, [['laser', {}], ['burst', {}]], [['blink', {}]], 'Three reviewers fused into one. All three disagree with you.'),
  // 6 SLAUGHTERWORKS
  M(6, 'hookman', 'HOOKMAN', 'ON THE LINE', 'mantis', [0xa06060, 0x2a1010, 0xff3030], 1.3, [['lunge', {}], ['pull', {}]], [['sweep', {}]], 'Hangs things on hooks. Has run out of things.'),
  M(6, 'renderer', 'RENDERER', 'MELTS IT DOWN', 'brute', [0x9a5a4a, 0x2a1210, 0xff6020], 1.6, [['flame', {}], ['leap', {}]], [['eruption', {}]], 'Takes what is left and makes it useful. Its definition of useful is broad.'),
  M(6, 'bonesaw', 'BONESAW', 'CUTTING LINE FOREMAN', 'walker', [0x8a6a6a, 0x2a1818, 0xff4040], 1.3, [['charge', {}], ['burst', {}]], [['bounce', {}]], 'Its saw stopped working years ago. It did not.'),
  M(6, 'gristle', 'GRISTLE', 'WHAT THE MACHINE SPAT OUT', 'spider', [0x8a5050, 0x200808, 0xff5050], 1.3, [['mines', {}], ['lunge', {}]], [['flame', {}]], 'Rejected by the rendering line. Holds a grudge about it.', { move: 'circle' }),
  M(6, 'stockyardbull', 'STOCKYARD BULL', 'FIRST IN LINE', 'bull', [0x8a5a4a, 0x2a1810, 0xff3020], 0.9, [['charge', {}], ['shockwave', {}]], [['mortar', {}]], 'Herded the line to the slaughter floor. Now it herds you.'),
  M(6, 'tallow', 'TALLOW', 'CANDLE OF THE WORKS', 'orb', [0xc0a070, 0x3a2a1a, 0xffc040], 1.3, [['rain', {}], ['ring', {}]], [['pull', {}]], 'Burns with a steady, terrible light.'),
  // 7 ORBITAL FOUNDRY
  M(7, 'dockmaster', 'DOCKMASTER', 'CLEARANCE DENIED', 'tank', [0x5a6a8a, 0x1a2030, 0x60c0ff], 1.3, [['snipe', {}], ['mortar', {}]], [['orbital', {}]], 'Schedules launches that never launch.', { move: 'kite' }),
  M(7, 'starchaser', 'STARCHASER', 'THE LAST PILOT', 'hover', [0x6a7aa0, 0x1a2030, 0xffd060], 1.3, [['blink', {}], ['fan', { n: 7 }]], [['laser', {}]], 'Flew the mirror satellites until the Architect revoked her license. She flies anyway.'),
  M(7, 'airlock', 'AIRLOCK', 'CYCLING', 'totem', [0x6a7080, 0x1a1c24, 0x80c0ff], 1.2, [['pull', {}], ['spokes', {}]], [['zap', {}]], 'Opens. Pulls. Closes. Repeat.', { move: 'stationary' }),
  M(7, 'satellite', 'SATELLITE', 'MIRROR IN THE DARK', 'swarm', [0xb0b0c0, 0x2a2a34, 0xffe080], 1.3, [['orbital', {}], ['homing', { n: 2 }]], [['spiral', {}]], 'A fallen mirror-sat, still aiming sunlight at whatever looks warm.'),
  M(7, 'zerogreaper', 'ZERO-G REAPER', 'NO GRAVITY, NO MERCY', 'mantis', [0x7a80a0, 0x1a1c28, 0xc080ff], 1.3, [['lunge', {}], ['blink', {}]], [['sweep', {}]], 'Learned to fight in vacuum. Gravity is just a suggestion it ignores.'),
  M(7, 'payload', 'PAYLOAD', 'HANDLE WITH CARE', 'walker', [0x8a8060, 0x2a2618, 0xff6030], 1.4, [['mortar', { n: 4 }], ['rain', {}]], [['charge', {}]], 'Cargo walker loaded with the last orbital munitions.', { move: 'kite' }),
  // 8 THE CHOIR
  M(8, 'chorister', 'CHORISTER', 'SINGS IN THE ROUND', 'hover', [0x9a80b0, 0x2a1a3a, 0xffd060], 1.3, [['ring', {}], ['homing', { n: 3 }]], [['laser', {}]], 'Always slightly sharp.'),
  M(8, 'bellringer', 'THE BELLRINGER', 'TOLLS FOR YOU', 'totem', [0x8a7a5a, 0x2a2010, 0xffc040], 1.3, [['shockwave', { rings: 2 }], ['ring', {}]], [['spokes', {}]], 'Every toll is a shockwave. It has a lot of bells.', { move: 'stationary' }),
  M(8, 'acolyte', 'ACOLYTE OF CURRENT', 'CONDUIT OF FAITH', 'knight', [0x8a70a0, 0x22182c, 0x80c0ff], 1.4, [['zap', {}], ['lunge', {}]], [['sweep', {}]], 'Converted by the Choir, armed by the Grid.'),
  M(8, 'psalm', 'PSALM', 'A VERSE IN GLASS', 'crystal', [0xd0b0e0, 0x3a2a48, 0xffe060], 1.3, [['spiral', {}], ['homing', { n: 2 }]], [['blink', {}]], 'Recites the same verse until something breaks. Usually you.'),
  M(8, 'censer', 'CENSER', 'SWINGS SMOKE', 'orb', [0x9a8060, 0x2a2010, 0xff8030], 1.3, [['flame', {}], ['rain', {}]], [['pull', {}]], 'Incense of burnt insulation. The Choir finds it holy.'),
  M(8, 'vestryguard', 'VESTRY GUARD', 'KEEPS THE ROBES', 'brute', [0x7a6a8a, 0x201828, 0xffd060], 1.6, [['leap', {}], ['shockwave', {}]], [['summon', { types: ['husk', 'signaller'], n: 2 }]], 'Guards vestments for priests that never existed.'),
  // 9 THE BREACH
  M(9, 'otherhand', 'OTHER HAND', 'IT REACHES THROUGH', 'crystal', [0x7a4a9a, 0x1a0a2a, 0x7affe0], 1.4, [['pull', {}], ['bounce', {}]], [['blink', {}]], 'A hand from the other side of the Breach. It is looking for its arm.'),
  M(9, 'wrongangle', 'THE WRONG ANGLE', 'GEOMETRY THAT HURTS', 'serpent', [0x8a4a8a, 0x2a0a2a, 0xff40e0], 1.3, [['fan', { n: 7 }], ['ring', {}]], [['rain', {}]], 'Moves in directions your eyes refuse to follow.', { move: 'circle', speed: 7 }),
  M(9, 'glasswidow', 'GLASS WIDOW', 'SEE-THROUGH SPINNER', 'spider', [0xb0a0d0, 0x2a2040, 0xc080ff], 1.3, [['mines', {}], ['snipe', {}]], [['lunge', {}]], 'Spins webs of fibre-optic cable and listens to everything that touches them.', { move: 'circle' }),
  M(9, 'tongue', 'TONGUE', 'TASTE OF THE OTHER SIDE', 'serpent', [0xa04a6a, 0x2a0a18, 0xff5090], 1.3, [['homing', { n: 3 }], ['pull', {}]], [['spiral', {}]], 'The Breach licks at the city. This is what it licks with.', { move: 'circle', speed: 7 }),
  M(9, 'nullshepherd', 'NULL SHEPHERD', 'HERDS THE EMPTY', 'swarm', [0x5a4a6a, 0x100818, 0xa060ff], 1.3, [['summon', { types: ['wisp', 'wisp', 'ripper'], n: 3 }], ['spiral', {}]], [['orbital', {}]], 'Leads lost things back to the Breach.'),
  M(9, 'faceless', 'FACELESS', 'IT TOOK YOURS', 'knight', [0x7a6a8a, 0x1a1020, 0xffffff], 1.4, [['blink', {}], ['sweep', {}]], [['laser', {}]], 'Wears the faces of the people it met. Has room for one more.'),
  // 10 THE CORE
  M(10, 'steward', 'THE STEWARD', 'CORE HOUSEKEEPING', 'walker', [0xc0c4cc, 0x202228, 0x3ef0d0], 1.4, [['burst', {}], ['laser', {}]], [['mines', {}]], 'Keeps the Architect\'s halls spotless. Considers you a stain.', { move: 'kite' }),
  M(10, 'capacitor', 'CAPACITOR', 'STORED SPITE', 'orb', [0xa0a8c0, 0x20242c, 0x40e0ff], 1.3, [['zap', {}], ['spiral', { arms: 4 }]], [['spokes', {}]], 'Holds a charge for a very long time.'),
  M(10, 'lastlineman', 'LAST LINEMAN', 'LINE-5', 'knight', [0x6a7a8a, 0x1a2028, 0x3ef0d0], 1.4, [['lunge', { count: 2 }], ['laser', {}]], [['zap', {}]], 'The unit before the unit before you. It did not make it this far on its own.'),
  M(10, 'echo', 'THE ECHO', 'YOU, BUT LATER', 'hover', [0x8a9ab0, 0x1a2030, 0xffffff], 1.3, [['blink', {}], ['homing', { n: 3 }]], [['orbital', {}]], 'The Core recorded your approach and is playing it back.'),
  M(10, 'blackbox', 'BLACK BOX', 'FLIGHT RECORDER OF THE CITY', 'totem', [0x303038, 0x101014, 0xff6030], 1.3, [['ring', {}], ['mortar', {}]], [['rain', {}]], 'It survived every disaster. It remembers every one.', { move: 'stationary' }),
  M(10, 'gridsentinel', 'GRID SENTINEL', 'FINAL CHECKPOINT', 'tank', [0x8a90a0, 0x1a1c24, 0x40ffd0], 1.4, [['burst', {}], ['orbital', {}]], [['charge', {}]], 'Nothing has passed it. You are welcome to be the first.', { move: 'kite' }),
];

export function miniById(id) { return MINIBOSSES.find((m) => m.id === id); }
