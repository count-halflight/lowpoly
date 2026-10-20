# VOLTGRAVE

Browser FPS inspired by ULTRAKILL and PS1-era games. three.js r170 + Vite 5, plain ES modules (no
TypeScript). Everything is procedural: no external assets, no network at runtime.

## Commands
- `npx vite build` builds `dist/` (tests serve it with `vite preview`).
- `npx vite build --mode single` builds `dist-single/index.html` (everything inlined).
- Tests are Playwright scripts: `PORT=<free port> node tests/<name>.mjs`. Core set: regressions,
  checkpoints, tutorial-input, aim, movement, mechanics, bot-firstlevel, menus, smoke; long ones:
  roster, campaign, conditions. Level soak: `PHASE=static|features|minis|play node tests/levels.mjs`
  (every archetype x stratum, normal + mirrored). The machine is small: run one browser test at a time.

## Layout
- `src/main.js` Game (modes endless/campaign/tutorial, room flow, death/checkpoints).
- `src/game/` campaign, director, enemies, bosses (kit/chassis/abilities/bosses/architect), player,
  weapons, projectiles, combat, style, pickups, upgrades, fx, meta, tutorial, cutscene.
- `src/world/` rooms (archetype specs), level (Room builder, NavGrid), kits, features, beacon.
- `src/render/` renderer (low-res target + post shader), materials, textures.
- `src/ui/` hud (canvas HUD), menus (DOM menus), pixel. `src/core/` input, audio, settings, collide.

## Rules
- UI MUST STAY MINIMAL. The player has asked repeatedly for a less cluttered, readable UI. Do not add
  new always-on HUD elements; new information replaces or merges into an existing element, appears
  only when relevant, and fades out. Readable text is crisp, high-contrast, on a dark plate, never
  glitched/scrambled (only with the `textFx` setting). Check desktop 1280x720 and a phone
  (844x390, touch, DPR 3) screenshot for every HUD change: nothing may overlap.
- No soft-locks: a room must always be clearable and its door must open. Every past user-reported
  bug was a sealed door; add a real-input regression test for any new one.
- Performance: never add/remove THREE lights at runtime, reuse geometry/materials, pool effects,
  dispose per-room objects, no per-frame allocations in hot loops.
- No manipulative engagement mechanics (gambling, energy timers, streak guilt).
- Match the surrounding code style: 2-space indent, single quotes, semicolons, terse comments.
