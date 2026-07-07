# NIGHTWARD (working title)

A browser territory-RPG: you run a protection racket that accidentally becomes a
civilization. RuneScape/WoW-style skilling & crafting, Age-of-Empires tech ages
with faction-flavored branches, a xianxia cultivation track for personal power —
and at night, hordes attack from the ungoverned dark.

**Zero hosted assets.** Every tile, tree and character frame is procedurally
generated at runtime from a seed — the "asset database" is generator functions +
tiny parameter records ([src/engine/procgen/](src/engine/procgen/),
[src/game/data/](src/game/data/)). Same seed → same world, sprites and hero.

## Stack

- **PixiJS v8** — WebGPU renderer with automatic WebGL fallback (`?gl` in the URL forces WebGL)
- **TypeScript + Vite**
- Fixed-timestep sim (30 Hz) decoupled from rendering; fullscreen responsive canvas;
  DOM overlay UI; keyboard + floating touch joystick

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # static site in dist/ — host anywhere
```

The world seed lives in the URL hash (`#s=12345`) — share a URL, share a world.

## Status

- [x] **M0 — Walkable world**: infinite seeded overworld (noise biomes, domain-warped
      coasts), chunk-baked rendering, procgen tiles/trees/hero, camera follow,
      keyboard + touch input, dynamic zoom for any screen
- [x] **M1 — Skilling & crafting**: gatherable nodes (trees/rocks/veins/herbs/bushes),
      inventory with equippable **weapon + armor slots** (auto-equip on craft/loot),
      tools that speed gathering, RS-style per-skill leveling, 3 crafting professions
      (crafting/smithing/alchemy), day/night cycle with ambient tint
- [x] **M2 — The racket**: buildings (hall/hut/wall/tower), placement rules, territory
      score, population, passive tribute income (daytime only)
- [x] **M3 — Night hordes**: wave spawner scaling with night # AND territory value,
      enemies that march on the hall / chew buildings / bite the player, watchtower
      auto-fire, player arc-melee (visible slash) using your equipped weapon, armor
      that softens hits, death & respawn, game over
- [ ] M4 — Ages, factions, tech tree
- [ ] M5 — Cultivation realms & scaling rifts
- [ ] M6 — Juice (custom lighting/bloom shaders, procedural audio, title screen)

Everything is **data-driven**: tune [config.ts](src/game/data/config.ts) for balance,
or edit the tables in [src/game/data/](src/game/data/) to add items, recipes, buildings,
enemies, biomes, or gather nodes — no engine code required. In the browser console,
`window.NW.CFG` is the live config (editable at runtime). Debug hotkeys (dev only):
`.` +30s · `n` skip to night · `j` force a wave · `g` +gold · `m` +materials · `h` heal.

Full design doc: `C:\Users\User\.claude\plans\generic-petting-gadget.md`
