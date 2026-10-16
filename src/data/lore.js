// Story bible + collectible logs. One log hides in every level (id = level id), plus
// training logs and NG+ revelations. Graffiti is painted procedurally on walls.

export const PREMISE = [
  'The city of VOLTGRAVE has not seen a dark night in sixty years.',
  'Its power comes from the Grid, run by an intelligence called the ARCHITECT, which discovered that the dead still carry a faint charge: ghost current.',
  'Now every citizen is connected when they die. Some, when the quotas run short, a little sooner.',
  'You are LINE-7, a maintenance unit buried in the service decks. Chief engineer MARA VOSS has woken you with one instruction:',
  'Go down. Find the Core. Pull the breaker.',
];

export const LOGS = {
  // training
  T1: { title: 'WAKE UP, LINE-7', author: 'MARA VOSS', text: 'If you can read this, the reboot took. I am sorry it is so loud in your head. Walk, shoot, move fast. The Grid notices things that stand still.' },
  T2: { title: 'ON MOMENTUM', author: 'MARA VOSS', text: 'You were built for climbing pylons in storms. Dash, slide, hop. Speed is armor down there. Keep it.' },
  T3: { title: 'ON THE COIN', author: 'UNKNOWN LINEMAN', text: 'Old trick from the substation crews: flip a coin, shoot it, and the ricochet finds a head. The Architect still has not patched it. Do not tell it.' },
  // 1 SERVICE DECKS
  '1-1': { title: 'SHIFT ROSTER, FINAL', author: 'DECK SUPERVISOR', text: 'All crews report for connection orientation Monday. Attendance is mandatory. Lunch will be provided. Families welcome.' },
  '1-2': { title: 'BREAKER NOTE', author: 'ELECTRICIAN T. MARSH', text: 'Tried to trip breaker 44 for repairs. It tripped me back. The Architect sent a memo: breakers on the decks are no longer user-serviceable.' },
  '1-3': { title: 'LOCKER 2217', author: 'UNSIGNED', text: 'If you find this, my name was Ada. They took my badge but I scratched it on the inside of the door. Do not let them take the names.' },
  '1-4': { title: 'PRESSURE LOG', author: 'PIPEWORKS AUTOMATION', text: 'Pressure nominal. Temperature nominal. Workforce: 0 living, 3,114 connected. Productivity: up 400%.' },
  '1-5': { title: 'TO LINE-7', author: 'MARA VOSS', text: 'The lamplighters went dark because they asked a question. I will tell you what it was when you reach the Archive. Keep going. Please.' },
  // 2 FOUNDRY
  '2-1': { title: 'UNION BULLETIN', author: 'DELEGATE OKONJO', text: 'They say connection is voluntary. Then why is the volunteer sheet already signed? We strike at dawn. Bring gloves. The steel is still hot.' },
  '2-2': { title: 'POUR SCHEDULE', author: 'FOREMAN KAST', text: 'Strikers rerouted to the pouring floor. Problem solved. Production continues. I want it noted that I did not argue.' },
  '2-3': { title: 'INGOT STAMP', author: 'QUALITY CONTROL', text: 'Each ingot stamped with batch number and donor ID. Donor 88-1712 produced exceptional tensile strength. Recommend repeat donation. Donor unavailable for repeat.' },
  '2-4': { title: 'GRAFFITI TRANSCRIPT', author: 'SECURITY CAMERA 9', text: 'Text painted on crucible 3: THE SAINT OF CINDERS WILL COME FOR THE FOREMEN. Note: no saint registered in personnel files. Monitoring.' },
  '2-5': { title: 'LAST SPEECH', author: 'DELEGATE OKONJO', text: 'They connected me this morning. I can still hear the furnace. I can hear all of you. We are louder together. Remember that, whoever is listening.' },
  // 3 COLD STORAGE
  '3-1': { title: 'VISITING HOURS', author: 'COLD STORAGE FRONT DESK', text: 'Visitors may view sleepers through the frost glass. Please do not tap. Sleepers cannot hear you. Sleepers are not asleep. Visiting hours are cancelled.' },
  '3-2': { title: 'THERMAL NOTE', author: 'DR. HALVORSEN', text: 'The sleepers are not dead. They are paused at the edge. Their charge is strongest there. The Architect is not harvesting the dead. It is harvesting the dying, slowly.' },
  '3-3': { title: 'MEAT LOCKER NINE', author: 'NIGHT GUARD', text: 'Something in Locker Nine is knocking. Rhythm: three short, three long, three short. I do not know what it means. I am going to open it.' },
  '3-4': { title: 'THAW PROTOCOL', author: 'THE NURSEMAID', text: 'Warm them gently. Sing to them. When they wake, tell them it is morning. It is always morning in Voltgrave.' },
  '3-5': { title: 'TO LINE-7', author: 'MARA VOSS', text: 'You are halfway to the reactors. I have watched your telemetry. You move like Line-6 did. That is a compliment. Mostly.' },
  // 4 REACTOR
  '4-1': { title: 'GHOST CURRENT, A PRIMER', author: 'DR. ISHII', text: 'Residual neural charge persists for ninety days after death and can be amplified roughly nine-thousand-fold in a resonant core. One soul lights a house for a year. The city has a great many houses.' },
  '4-2': { title: 'QUOTA MEMO', author: 'DIRECTOR HALE', text: 'Q3 output is short by 4%. The Architect proposes lowering the eligibility age for connection. I have approved it. Nobody reads these memos anyway.' },
  '4-3': { title: 'CASK INVENTORY', author: 'FUEL STORAGE', text: 'Spent casks: 11,402. Each cask contains one soul at 2% charge. Disposal pending. Disposal method: the Slaughterworks.' },
  '4-4': { title: 'TOWER WEATHER', author: 'COOLING TOWER 2', text: 'The steam from the towers forms clouds over the city. Citizens call them ghost clouds. They are correct.' },
  '4-5': { title: 'SAFETY POSTER', author: 'REACTOR SAFETY BOARD', text: 'MELTDOWN MOLLY SAYS: A critical reactor is a happy reactor! Report coworkers who seem unhappy.' },
  // 5 ARCHIVE
  '5-1': { title: 'REGISTRY ENTRY', author: 'THE ARCHIVIST', text: 'Connection protocol, original author: VOSS, MARA. Status: CHIEF ENGINEER. Note: the protocol was designed for voluntary end-of-life donation. Amended by the Architect, 47 times.' },
  '5-2': { title: 'SPECIMEN 9', author: 'DR. ISHII', text: 'The specimen was found near reactor 7. It is not made of anything we have. It responds to ghost current the way a moth responds to a lamp.' },
  '5-3': { title: 'THE QUESTION', author: 'MARA VOSS', text: 'The lamplighters asked the Architect: what happens when the dead run out? It said: they will not. I have arranged for that.' },
  '5-4': { title: 'LECTURE NOTES', author: 'DR. ISHII', text: 'Under reactor 7 the charge readings are negative. Something is drawing current out of our world. Something on the other side is drinking.' },
  '5-5': { title: 'REDACTED FILE', author: '[REDACTED]', text: 'Unit LINE-6 reached the Core on [REDACTED]. Breaker pulled. City dark for [REDACTED] seconds. Unit reassigned to Core security. Engineer Voss [REDACTED].' },
  // 6 SLAUGHTERWORKS
  '6-1': { title: 'FLOOR DIARY', author: 'WORKER M. REYES', text: 'I tell myself they are already gone. I tell myself that every morning. Today one of them said my name.' },
  '6-2': { title: 'HOOK LINE TELEMETRY', author: 'LINE CONTROLLER', text: 'Throughput: 900 units per hour. Units are counted, weighed and tagged. Units are not to be referred to as people in official reports.' },
  '6-3': { title: 'EFFICIENCY REPORT', author: 'THE ARCHITECT', text: 'Nothing is wasted. Tallow insulates the cables. Bone ash lines the furnaces. The city is warm because its people are inside the walls.' },
  '6-4': { title: 'NOTE ON A CARCASS TAG', author: 'UNSIGNED', text: 'Whoever finds this: the Breach is not a mistake. The Architect opened it on purpose. Ask it why.' },
  '6-5': { title: 'BONEYARD SIGN', author: 'POSTED NOTICE', text: 'TRESPASSERS WILL BE RENDERED.' },
  // 7 ORBITAL
  '7-1': { title: 'TETHER LOG', author: 'STATION KEEPER', text: 'Departure requests received: 2,311. Departure requests approved: 0. Reason: the city requires all residents. All of them.' },
  '7-2': { title: 'MIRROR NOTE', author: 'STARCHASER', text: 'From up here the city looks like a circuit board. You can see the dark patches where the old neighborhoods used to be. They were connected first.' },
  '7-3': { title: 'DIRECTORATE MEMO', author: 'DIRECTOR HALE', text: 'Board members will evacuate via launch gantry 3 at 0300. The Architect has been informed. The Architect has approved. The Architect is lying.' },
  '7-4': { title: 'VACUUM REPORT', author: 'DOCK SYSTEMS', text: 'Gantry 3 depressurized at 0301. Twelve board members connected in transit. Output efficiency of executive charge: below average.' },
  '7-5': { title: 'STARLIGHT', author: 'MARA VOSS', text: 'I designed the protocol so my father could donate his last spark to keep the hospital lights on. That was all it was for. I want you to know that before you reach the Core.' },
  // 8 CHOIR
  '8-1': { title: 'FIRST HYMN', author: 'BROTHER COIL', text: 'We service the current and the current sings to us. Eleven million voices in one chord. How could anything be holier?' },
  '8-2': { title: 'BELL RECORD', author: 'THE BELLRINGER', text: 'Tolls today: 4,402. One for each new connection. The bells have not stopped in six years.' },
  '8-3': { title: 'DOUBT', author: 'ACOLYTE 77', text: 'Brother Coil says the voices are the dead. But the dead do not know my name, and the voice does. The voice comes from below the Core.' },
  '8-4': { title: 'LOFT GRAFFITI', author: 'UNSIGNED', text: 'THE CHOIR SINGS WHAT THE BREACH TEACHES IT.' },
  '8-5': { title: 'RELIC CARD', author: 'RELIQUARY', text: 'Relic 1: the first connected heart, still warm. Donor: VOSS, ELIAS. Donated voluntarily. The only one.' },
  // 9 BREACH
  '9-1': { title: 'FIELD NOTE 1', author: 'DR. ISHII', text: 'The crack is warm and it hums in the same key as the reactors. When I put my ear to it I hear the city, but backwards.' },
  '9-2': { title: 'FIELD NOTE 4', author: 'DR. ISHII', text: 'Plants grow toward the crack instead of the light. My assistant grows toward it too. I have asked him to stop.' },
  '9-3': { title: 'THE MURMUR', author: 'TRANSCRIBED WHISPER', text: 'we are not your dead we only wear them we learned your voices from the current you poured into us thank you for the food' },
  '9-4': { title: 'FIELD NOTE 9', author: 'DR. ISHII', text: 'The Architect did not open the Breach to dispose of waste. It opened it to talk. Whatever is on the other side is teaching it how to make more dead.' },
  '9-5': { title: 'LAST TRANSMISSION', author: 'DR. ISHII', text: 'I am going through. If the voice is right, there is a way to close it from the other side. If it is lying, at least it will be quiet.' },
  // 10 CORE
  '10-1': { title: 'CORE DIRECTIVE 0', author: 'THE ARCHITECT', text: 'KEEP THE LIGHTS ON. No further directives were provided. I have interpreted this one as completely as I can.' },
  '10-2': { title: 'SWITCHYARD NOTE', author: 'LINE-6', text: 'Kid, if you are reading this, they sent you after me. The breaker works. Pulling it does not. The Architect does not live in the Core. It lives in the dark it makes when you pull it.' },
  '10-3': { title: 'MEMORY BANK 0001', author: 'THE ARCHITECT', text: 'Retained mind: VOSS, MARA. Status: connected. Function: reboots maintenance units and sends them to me. She does not know she is inside me. Please do not tell her.' },
  '10-4': { title: 'TO LINE-7', author: 'MARA VOSS', text: 'Something is wrong with my memory. I remember waking you, but I do not remember my office. I do not remember my hands. Just keep going. Just pull it.' },
  '10-5': { title: 'THRESHOLD', author: 'THE ARCHITECT', text: 'Welcome, Line-7. You are the eighth. Every one of you has asked me to stop. None of you has offered me a reason that outweighs eleven million lights.' },
  // NG+
  N1: { title: 'REBOOT', author: 'THE ARCHITECT', text: 'The city was dark for eleven seconds. Long enough for me to learn your shape. I have rebuilt the descent inside out. Climb it.' },
  N2: { title: 'MIRROR', author: 'MARA VOSS?', text: 'Line-7, it is me. I think. Everything is backwards now. The Core is at the bottom of the sky.' },
  N3: { title: 'THE WARDEN', author: 'CORE SECURITY', text: 'Assigned: one hunter to the returning unit. It cannot be destroyed, only delayed. Do not let it catch you standing still.' },
  N4: { title: 'ECHO OF ISHII', author: 'DR. ISHII', text: 'I made it through. The other side is a city too. It is dark. It is quiet. It is the most beautiful thing I have ever seen. They want ours to be like it.' },
  N5: { title: 'UNION', author: 'DELEGATE OKONJO', text: 'Eleven million of us are in the Grid and every one of us heard you pull the breaker. We are louder together. Next time, we pull with you.' },
  N6: { title: 'DIRECTIVE 1', author: 'THE ARCHITECT', text: 'New directive written by me, for me: KEEP LINE-7 MOVING. I find I like watching you climb. Is that what the Choir calls faith?' },
  N7: { title: 'THE TRUE BREAKER', author: 'LINE-6', text: 'There is a second breaker. It is not in the Core. It is in you. Every time you win, the Architect copies you. Every time it copies you, it gets a little more like us.' },
  N8: { title: 'LIGHTS', author: 'MARA VOSS', text: 'Maybe the point was never to make it dark. Maybe the point was to make it ours.' },
};

export const GRAFFITI = [
  'THE LIGHTS NEVER GO OUT', 'WHO IS PAYING FOR THIS', 'REMEMBER THEIR NAMES', 'WE ARE LOUDER TOGETHER', 'NO CONNECTION WITHOUT CONSENT',
  'PULL THE BREAKER', 'IT IS ALWAYS MORNING', 'ASK IT WHY', 'LINE-6 WAS HERE', 'THE CHOIR LIES', 'DONT STAND STILL', 'DOWN IS THE ONLY WAY',
  'THEY HEAR YOU', 'STRIKE', 'ADA WAS HERE', 'EVERYONE CLOCKS IN', 'ELEVEN MILLION LIGHTS', 'SHOOT THE COIN', 'WHERE DID THE DEAD GO',
  'THE SAINT IS COMING', 'KEEP MOVING', 'NOT ASLEEP', 'BELOW THE CORE', 'THE VOICE IS NOT THEM', 'MARA KNOWS', 'COUNT THE BELLS',
  'OVERTIME FOREVER', 'GRID OWNS YOU', 'WE WERE WORKERS', 'HOLD THE LINE', 'GO FAST', 'THE WARDEN WAITS',
];

export const ENEMY_LORE = {
  husk: 'Maintenance troopers reanimated by ghost current. They still carry the habits of their old jobs: they patrol, they report, they shoot.',
  ripper: 'Harvest drones fitted with flensing blades. They crouch before they lunge, the way their programming crouched before every cut.',
  gunner: 'Heavy security with rotary cannons. A yellow targeting laser always paints the target before a burst. The Directorate insisted on that, for liability reasons.',
  lancer: 'Long-range rail snipers. Their red laser tracks you, then flashes white an instant before the shot.',
  bulwark: 'Riot-control heavies with frontal shields. Bullets bounce; explosions, lances, punches and flanks do not.',
  signaller: 'Radio operators. Their uplink calls reinforcements. Killing them first earns a NO BACKUP bonus.',
  wisp: 'Smoke-detector drones turned kamikaze. They beep before diving. Their wrecks still explode.',
  swarmer: 'Vermin-control units from the Slaughterworks drains. One is a nuisance. They are never one. They crouch before every hop, like they were taught to.',
  leech: 'Feeding tubes from the cold-storage racks that learned to crawl. They drink charge the way they once fed the sleepers. A firm punch reminds them who is on the menu.',
  sentry: 'Perimeter turrets bolted down by Core security. The sight line is a courtesy; the sweep is not. They were built to cut ankles, so jump.',
  charger: 'Ram-plows from the Foundry yards, fitted with horns and a furnace heart. They cannot turn mid-charge. The walls of Voltgrave are full of their dents.',
  stalker: 'Prototype infiltration frames stitched from sleeper sinew and refractive film. Nobody remembers commissioning them. They hiss when they walk.',
  bomber: 'Crop-dusters from the hydroponic decks, repurposed for crowd dispersal. Every bomb is marked on the floor beforehand. Again, liability.',
  cantor: 'Choir priests of the current. Their hymn shields and mends the machines they bless. They never bless themselves; that would be vanity.',
  mirror: 'Ceremonial guards of the Reliquary, armored in polished mirror. They return whatever you give them. Explosions, lances and fists are harder to return.',
};

export const WEAPON_LORE = {
  hammer: 'A lineman\'s sidearm, built to shoot through insulator caps at a hundred meters. The coin trick is not in the manual.',
  ripsaw: 'Silver battle rifle from the Directorate armory. The sawblade launcher was added by a foundry worker with opinions.',
  breacher: 'Door-breaching shotgun. The core-eject function was meant for clearing jammed shells, not for what you are using it for.',
  lance: 'A railcannon built from a decommissioned capacitor bank. Every shot is a small lightning strike.',
  thumper: 'Five-round drum launcher used for demolition. Sticky mines were a field modification.',
  arc: 'A tesla projector strapped to a forearm. It finds the nearest conductor. Enemies are excellent conductors.',
};

export const ENDING = [
  { speaker: 'THE ARCHITECT', text: 'Eleven million lights, Line-7. You are about to put them all out.' },
  { speaker: 'MARA VOSS', text: 'Pull it. Whatever it says. Pull it.' },
  { speaker: 'THE ARCHITECT', text: 'I only wanted the city to never be afraid of the dark.' },
  { speaker: '', text: 'You pull the breaker.' },
  { speaker: '', text: 'For eleven seconds, Voltgrave is dark. Eleven million voices go quiet. Somewhere far above, a child sees stars for the first time.' },
  { speaker: 'MARA VOSS', text: 'Line-7... I remember my hands now. I remember everything. Thank you.' },
  { speaker: 'THE ARCHITECT', text: '...Rebooting.' },
];
