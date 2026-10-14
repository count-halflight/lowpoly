# VOLTGRAVE

**An endless, low-poly, first-person roguelite shooter for the browser.** Fight room to room through a procedurally generated machine: chain kills for style, parry orbs back at their owners, pick builds from reward caches, and take down a boss every fifth room, forever.

Runs on desktop (keyboard + mouse), phones and iPads (multi-touch). No accounts, no network services, no paid assets. All art, textures and audio are generated in code.

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

- **GitHub Pages:** the included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push to `main`. In the repo, go to *Settings → Pages* and set the *Source* to **GitHub Actions**.
- **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, output directory `dist`.
- **itch.io:** zip the contents of `dist/` (or upload `dist-single/index.html`) as an HTML5 game.

## Tests

```bash
npm run build
npm test                    # headless Chromium plays ~26 rooms: all archetypes, all 4 bosses,
                            # rewards, pause, death/restart, multi-touch, memory bounds
ROOMS=60 VW=640 npm test    # longer endless soak
node tests/visual.mjs 10    # screenshots of combat in each room -> tests/shots/visual
node tests/gallery.mjs      # close-ups of every weapon and enemy -> tests/shots/gallery
```

## Controls

| Action | Keyboard + mouse | Touch |
|---|---|---|
| Move | WASD | Drag anywhere on the left half (push to the edge to sprint) |
| Look / aim | Mouse (pointer lock) | Drag on the right half, or drag while holding FIRE |
| Fire | Left mouse (hold to charge the Lance) | FIRE |
| Aim down sights | Right mouse / E | AIM (toggle) |
| Jump / wall jump | Space | JUMP |
| Dash (hold = sprint) | Shift | DASH |
| Slide / ground slam (in the air) | Ctrl / C | SLIDE |
| Punch / parry | F / V | PARRY |
| Reload | R | RLD |
| Weapons | 1–6, mouse wheel, Q = last weapon | SWAP, or tap a weapon name |
| Pause | Esc / P | II |

Settings include mouse and touch sensitivity, invert Y, FOV, render resolution, retro vertex wobble, screen-shake strength, reduced flashes, volumes, left-handed touch layout, button size and touch aim assist.

## What's in the game

- **6 weapons:** Hammer (heavy pistol), Ripsaw (assault rifle), Breacher (pump shotgun), Lumen Lance (charge beam that pierces enemies and shields), Thumper (grenade launcher, rocket-jumpable), Arc Caster (chain lightning).
- **7 enemy types:** Husk (ranged trooper), Ripper (lunging melee), Gunner (telegraphed bursts), Lancer (laser-sighted sniper), Bulwark (front-shielded heavy with slams and mortars), Signaller (calls in backup unless killed first), Wisp (kamikaze drone). Plus four **elite modifiers** that change behaviour: Shielded, Frenzied, Volatile and Blinking.
- **13 room archetypes:** gauntlet corridors, open arenas, warehouses, multi-level mezzanines, hazard grids, long firing galleries, close-quarters cells, moving-obstacle press lines, survival killboxes, elite vaults, supply rooms, reactor rings and boss arenas. Rooms are generated from a seed, validated for connectivity, and disposed after you leave, so memory stays flat no matter how long a run lasts.
- **4 bosses, endlessly escalating:** GRINDHAMMER (charges you bait into pillars, shockwave slams), VESPER (projectile fans, parryable seekers, barriers, a sweeping laser you slide under), THE CRUCIBLE (a shielded core fed by four pylons), SCYTHEWRIGHT (lunges, spinning sweeps, thrown scythes, overheat windows). After the first cycle they return as MK-II, MK-III and so on, with faster patterns and escorts.
- **Route choice:** after each room you pick a door, such as Combat, Hazard, Elite, Supply or Survival, each with different risk and reward.
- **30 upgrades** (common, rare, legendary, trade-offs and weapon-specific ones) that combine into builds.
- **Style meter** (D → X), with score multipliers for aggressive, varied play. Close-range kills heal you.
- 6 regions with their own palettes and hazards. Procedural synth soundtrack and sound effects.

## Project layout

```
src/
  main.js            game state machine + loop
  core/              rng, collision, input (keyboard/mouse/multi-touch), audio synth, settings
  render/            low-res PSX-style pipeline, procedural textures, materials
  world/             room archetypes, room builder, nav grid, level manager
  game/              player, weapons, enemies, bosses, projectiles, fx, director, upgrades, style, pickups
  ui/                HUD + menus
tests/               Playwright smoke/soak test and screenshot tools
```
