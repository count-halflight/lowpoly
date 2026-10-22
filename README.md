# VOLTGRAVE

**A low-poly, PS1-style first-person shooter for the browser.** Descend through ten strata of a city-sized machine, fight 30 bosses and 60 minibosses, read the logs the dead left behind, and pull the breaker on THE ARCHITECT. Then do it again, inside out.

Runs on desktop (keyboard + mouse), phones and iPads (multi-touch). No accounts, no network services, no paid assets. All art, textures and audio are generated in code; fonts are bundled.

**▶ Play it in your browser: https://count-halflight.github.io/lowpoly/**  (rebuilt automatically from this branch on every push)

## Modes

- **The Descent (campaign).** 10 strata × 5 levels = 50 hand-named levels; each playthrough picks 3 per stratum (30 levels) in a seeded order, then the final level. Every level has its own briefing, a mechanical condition (low gravity, ice, blackout, conveyors, launch pads, smog, blood fuel, glass jaw…) and its own mix of room archetypes dressed in the stratum's kit. Each level hides two minibosses, a boss at the end and a lore terminal. Levels are ranked D, C, B, A, S and P on time, style and damage. Progress saves at the start of every level.
- **NG+.** After the ending, the next cycle climbs back up: strata run in reverse, every room is mirrored, killed machines sometimes rise again, THE WARDEN hunts anyone who lingers, every boss gains a third phase, and new logs explain what happened. Weapons and upgrades carry over.
- **Training deck.** Ten short rooms that each teach one verb (move, shoot, swap and coin-flip, jump-dash, slide, wall-jump, bunny hop, parry, launch pad and hook, live fire). Exits only open once you have really done it.
- **Endless.** The original roguelite: room after room, a boss every fifth door, random or custom seed, and a daily seed.
- **Level select.** Replay any level you have reached for a better rank.

## What's in the game

- **Bosses:** 30, each with its own name, title, intro lines and lore, built from a chassis (brute, knight, spider, tank, hover, orb, serpent, crystal, mantis, totem…) plus attack modules and a gimmick: pylons to destroy, armor to strip, servants that halve damage, a shield only a parry breaks, a weak point that opens while it vents, darkness, live floors, rising slag, pillars to charge it into. Four are fully bespoke (GRINDHAMMER, VESPER, THE CRUCIBLE, SCYTHEWRIGHT).
- **THE ARCHITECT:** three acts. Colossal hands slam and sweep (break one to expose the core), then it summons echoes of bosses you killed while the floor goes live, then the lights die and its core only cracks under parries, coin shots and explosions. Then you walk up and pull the breaker yourself.
- **Minibosses:** 60, six native to each stratum, randomized across levels, each with its own moves and an enrage set at half health.
- **Cutscenes:** in-engine letterboxed shots with typewriter dialogue and name cards for every boss and miniboss, phase changes and the ending. Hold SPACE (or hold a finger anywhere) to skip; they can be turned off in Settings.
- **Movement:** bunny hopping (jump on landing to keep speed, Quake-style air strafing), slide boosts, dash-jumps, slide-jumps, slam-jumps, wall-jumps, a grapple hook, launch pads and conveyors.
- **Weapons and alt-fires:** Hammer revolver (flip coins and shoot them to ricochet into heads), Ripsaw rifle (bouncing sawblade), Breacher shotgun (eject a core and shoot it), Lumen Lance (scope), Thumper (sticky mines), Arc Caster (EMP). Six weapon finishes unlock through medals.
- **Lore:** 61 logs on terminals, graffiti on the walls, a codex of bosses, minibosses, machines, weapons and strata.
- **Medals:** 30 mastery goals. There are no timers, streaks or randomized purchases.

## Play locally

```bash
npm install
npm run dev          # http://localhost:5173
```

## Build and deploy

```bash
npm run build        # static site in dist/ (relative paths, works from any sub-folder)
npm run build:single # everything inlined into dist-single/index.html (one file)
npm run preview      # serve the production build locally
```

`dist/` is a plain static site. Any free static host works:

- **GitHub Pages:** the included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push to the game branch (or `main`) and tries to switch Pages on by itself; if the first run reports that Pages is not enabled, go to *Settings → Pages*, set the *Source* to **GitHub Actions**, and re-run it.
- **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, output directory `dist`.
- **itch.io:** zip the contents of `dist/` (or upload `dist-single/index.html`) as an HTML5 game.

## Tests

All tests serve the production build with `vite preview` and drive a headless Chromium.

```bash
npm run build
npm test                         # endless: ~26 rooms, all archetypes, bespoke bosses, rewards,
                                 # pause, death/restart, multi-touch, memory bounds
node tests/campaign.mjs          # training -> 3 levels -> THE ARCHITECT -> ending -> credits -> NG+
node tests/roster.mjs            # all 30 bosses, THE ARCHITECT and 60 minibosses fight and clear
node tests/tutorial-input.mjs    # movement stations solved with injected key input only
node tests/menus.mjs             # every menu at desktop and phone size
node tests/visual.mjs 10         # combat screenshots -> tests/shots/visual
node tests/gallery.mjs           # weapon and enemy close-ups -> tests/shots/gallery
```

## Controls

| Action | Keyboard + mouse | Touch |
|---|---|---|
| Move | WASD | Drag anywhere on the left half (push to the edge to sprint) |
| Look / aim | Mouse (pointer lock) | Drag on the right half, or drag while holding FIRE |
| Fire | Left mouse | FIRE |
| Alt-fire (coin, saw, core, scope, mine, EMP) | Right mouse | ALT |
| Jump / wall jump / hold to bunny hop | Space | JUMP |
| Dash (hold = sprint) | Shift | DASH |
| Slide / ground slam (in the air) | Ctrl / C | SLIDE |
| Punch / parry | F / V | PARRY |
| Grapple hook | G | HOOK |
| Read terminals, pull breakers | E | USE |
| Reload | R | RLD |
| Weapons | 1–6, mouse wheel, Q = last weapon | SWAP, or tap a weapon chip |
| Zoom | Z | — |
| Pause | Esc / P | II |

Settings include mouse and touch sensitivity, invert Y, FOV, render resolution, retro vertex wobble, screen shake, reduced flashes, cutscenes on/off, volumes, left-handed touch layout, button size and touch aim assist.

## Project layout

```
src/
  main.js            game state machine, modes, room flow, ending
  core/              rng, collision, input (keyboard/mouse/multi-touch), audio synth, settings
  render/            low-res PSX-style pipeline, procedural textures, materials
  world/             room archetypes, stratum kits, room builder (pads, conveyors, barrels,
                     terminals, graffiti), nav grid, level manager
  game/              player, weapons, enemies, director, campaign, tutorial, cutscenes,
                     bosses (bespoke + data-driven chassis/abilities), THE ARCHITECT, meta profile
  data/              bosses, minibosses, levels/strata/conditions, lore
  ui/                pixel canvas HUD, menus, pixel text helpers
tests/               Playwright tests and screenshot tools
```
