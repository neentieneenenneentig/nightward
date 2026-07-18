# Handoff prompt — implement S1 "Survival Pressure"

*(Paste everything below this line into the implementing model. Written 2026-07-17.)*

---

You are implementing a milestone in **NIGHTWARD**, a browser territory-RPG (PixiJS v8 +
TypeScript + Vite, with a Rust→WebAssembly world core). Core identity: "RuneScape ×
Vampire Survivors × network monitoring" — the player's real internet connection (RTT,
bandwidth, jitter, beacon latency) drives game parameters through data-table mappings.
All game art is 100% procedurally generated. There is **no persistence** — closing the
tab deletes the character, by design. Never add save/load.

## Your task

Implement milestone **S1 — Survival Pressure** exactly per the brief at
`docs/plans/S1-survival-pressure.md`. Read that file first, in full — it is
implementation-grade: it specifies the two vitals (Vigor/Resolve), every decay/restore
rate, the network-multiplier table, the CFG block, the file list, six new Gauntlet
tests, and a live acceptance checklist. Also read `docs/plans/WORKFLOW.md` (process
rules) and skim `docs/plans/ROADMAP.md` (context). The brief's **"Stub review record"**
and **"Spec decisions locked at review"** sections are binding — they amend the main text.

## Setup

```
git checkout c1-echoes          # S1 builds on this branch — its CFG.vitals stubs and
git checkout -b s1-survival     # mapping rows live here, NOT on main (main lacks C1)
npm install                     # if node_modules missing
npm run wasm                    # REQUIRED before typecheck/build — src/wasm/pkg/ is gitignored
npm run dev                     # vite on :5173
```

Never merge to `main` and never push `main` — the user gates merges. Push only your
`s1-survival` branch. Conventional commits (`feat:`, `fix:`, `docs:`), small and scoped.

## Hard laws (violating these fails the milestone)

1. **The Veil**: fiction speaks pure fantasy — HUD/toasts/Chronicle say "vigor" and
   "resolve", NEVER "hunger bar"/"sanity"/any network vocabulary. Allowed mystical
   words: beacon, echo, resonance, pulse/flow/flux, thread, rift, realm. The campfire's
   display name is **Watchfire**.
2. **The Lens**: the O-key Observatory shows raw truth. Every vitals mapping row in
   `src/game/data/network.ts` is tagged `dormant: true` right now — **remove each flag
   only when you wire its target into real consumption** (grep `dormant: true`). A row
   whose target nothing reads must stay dimmed.
3. **Data-driven**: balance lives in `CFG` (`src/game/data/config.ts`) and data tables;
   systems read live values every tick (`NW.CFG` is console-editable — never cache a
   CFG value at construction).
4. **Rust = generic machinery only.** S1 should not need Rust changes at all.

## Landmines (each one has already burned a session — do not re-learn them)

- **netKey validity**: NET_GAME_MAP rows may only use NET_METRICS keys: `rtt`,
  `downlink`, `effectiveType`, `timeOfDay`, `cpuCores`, `deviceMemory`,
  `endpointLatency`, `echoJitter`. `effectiveType` encodes **4g=1, 3g=2, 2g=3,
  slow-2g=4**. A typo'd key fails silently into a clamp band. Gauntlet test
  `testNetMapIntegrity` pins all of this — keep it green.
- **simSpeed is applied ONCE, via `effectiveDt`**: `sim()` in `main.ts` already passes
  `effectiveDt = dt × simSpeed` to every system. `VitalsSystem.update(dt)` must use the
  dt it receives and never additionally multiply by `getGameValue('simSpeed')` — gather
  did that and scaled 1/simSpeed² (fixed in `7f9c4c9`; the comment in `gather.ts` explains).
- **`resolvePerSurviveNight` has NO mapping row yet** — it needs a night-RTT-stability
  tracker in `NetworkSystem` (percent of the night RTT stayed in its median band). Build
  it per the brief's table; add the row; that row starts and ends non-dormant.
- **Locked spec decisions**: player swings AND echo kills feed vitals; **tower kills do
  NOT** (anti-AFK rule). `foeDmgToBuildings` is a NEW config key applied at the damage
  site in `hordes.ts` (bosses share the per-foe dmg path — don't bake it there).
  `spawnRadiusTiles` becomes `spawnRadiusMinTiles`/`spawnRadiusMaxTiles`, rolled per
  spawn. Dawn hook is `HordesSystem.onDawn()` (`daynight.ts` is pure tint math).
- **Test discipline**: the Gauntlet (`src/game/systems/regression.ts`) runs against the
  LIVE network — a behavioral test must pin **every** input its code path reads
  (network snapshot, realm profile, rng seed), or it flakes. Never use a fixed
  step-count budget for "wait until X" — step-until-condition with a generous cap.
  No tautologies: a test that can't fail is worse than no test.
- **Perf gate**: `maxAlive` 250 must be proven — the horde Gauntlet test steps a 200+
  wave without frame-budget collapse, and acceptance includes night-5 at ≥50 fps.

## Definition of done (from WORKFLOW.md — mandatory)

1. `npm run typecheck` clean, `npm run build` green, `cargo test` (in
   `rust/nightward-core/`) all pass.
2. Full Gauntlet green at `http://localhost:5173/?gl&seed=1234&test` — suite goes
   **38 → 44 functions** (currently 200 assertions / 38 green). Paste the console
   output into your session record. (`window.__nw.regression.run()` re-runs it;
   `__nw.step(n)` drives the sim deterministically.)
3. Run the brief's 8-item live acceptance checklist and capture evidence via
   `window.__nw` state probes (screenshots are unreliable in headless/background tabs).
4. Update `docs/plans/S1-survival-pressure.md` with a short "shipped" record and
   `docs/plans/ROADMAP.md`'s S1 entry. Do NOT tag or merge — stop and report to the
   user with your evidence. Known gaps require user sign-off BEFORE merge, not
   disclosure after.

## Out of scope — do not touch

Stamina/energy systems, food-as-inventory-items, weather/disease, NPC vitals, the U1
Lens-UI restyle (next milestone), building rework, anything on `main`.
