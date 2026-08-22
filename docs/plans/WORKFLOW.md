# Changing pattern — one milestone, one worktree

Formalized workflow so each milestone is isolated, verifiable, and mergeable on its own.

## Per-milestone loop
1. **Branch a worktree from `main`:**
   ```
   git worktree add .claude/worktrees/<id>-<slug> -b feat/<id>-<slug>
   ```
   (`.claude/worktrees/` is gitignored.) Work happens inside that directory.
2. **Read the brief:** `docs/plans/ROADMAP.md` for the whole picture, `docs/plans/<id>-*.md` for the task.
3. **Implement** to the spec. Keep the non-negotiables (procgen, data-driven, determinism,
   browser-native network data only, graceful degradation, no persistence).
4. **Verify in the worktree** (static checks only — live preview CANNOT run here, see note):
   - `npm run wasm` FIRST on any fresh clone/worktree — `src/wasm/pkg/` is gitignored, so
     typecheck and build both fail until the core is built (the shared cargo target dir makes
     worktree rebuilds fast; needs `~/.cargo/bin` on PATH).
   - `cargo test` in `rust/nightward-core/` → all Rust logic tests green (this is where the core's
     logic is tested; the browser only ever runs release wasm).
   - typecheck → clean, build → green. Worktrees have no `node_modules`; junction it from main
     (`New-Item -ItemType Junction`) or run tools via the main repo's install, e.g.
     `node <mainrepo>/node_modules/typescript/bin/tsc --noEmit -p <worktree>/tsconfig.json`.
   - No save/load — there is no persistence layer (see ROADMAP: no-persistence decision). Don't add one.
5. **Commit** (conventional messages), then merge back and clean up:
   ```
   git -C <repo> merge --no-ff feat/w<n>-<slug>
   git worktree remove .claude/worktrees/w<n>-<slug>
   git branch -d feat/w<n>-<slug>
   ```
   (`git worktree remove` sometimes hits a transient "Permission denied" from OneDrive sync —
   retry `rm -rf` on the leftover folder a few seconds later + `git worktree prune`;
   `git worktree list` is the authoritative check.)
6. **Live-verify on main, AFTER the merge**: `preview_start nightward-dev` always serves the main
   project directory, never a worktree — this is a harness fact, confirmed twice. Exercise logic via
   `window.__nw.step(n)` + eval and the event log (the harness tab renders hidden, so don't rely on
   screenshots). If live verification fails, fix forward on main (or revert the merge).
7. **Tag** the verified state (e.g. `v0.16-n1-network-seed`, `v0.17-g1-visual-upgrade`).
8. **Playtest gate for look/feel milestones**: if the milestone changes how the game looks, feels,
   sounds, or is balanced (art, animation, combat feel, spawn/xp tuning, network→game mappings),
   STOP after tagging and get the user's playtest verdict before starting the next milestone.

## Conventions
- One milestone = one branch = one worktree. Don't mix milestones.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- Data-first: add a row in `src/game/data/*` before touching a system; systems stay generic.
- Every new player-facing action should emit a `log` event (after W0) and play an SFX.

## Handy commands
- Dev server: `preview_start` with `nightward-dev` (`.claude/launch.json`), port 5173. Add `?gl` to force WebGL.
- Build the Rust/wasm core: `npm run wasm` (wasm-pack → `src/wasm/pkg/`). Required once per fresh
  clone AND per fresh worktree before typecheck/build, since `pkg/` is gitignored. The cargo target
  dir is shared under `node_modules/.cargo-target` (OneDrive dodge), so worktree builds reuse the cache.
- Rust tests: `cargo test` in `rust/nightward-core/` (host-native; part of the static verify list).
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- Build: `node node_modules/vite/bin/vite.js build`
- Dev test hook: `window.__nw` — `.state`, `.ctx`, `.sys.*`, `.step(n, dt)` (advance sim deterministically),
  `.craft(id)`. Live balance: `window.NW.CFG`. Debug hotkeys: `.` `n` `g` `m` `h` `j` `y`.

## Definition of done (mandatory — P1 rule)

An implementation session may not declare a milestone complete without:

1. **Static trio green:** `npm run typecheck` clean, `npm run build` green, `cargo test` all pass.
2. **Full Gauntlet green at `?seed=1234&test`** with the console output pasted into the session
   record — all existing tests AND all behavioral tests pass. **Run `npm run build` first**: the
   Gauntlet harness drives a `vite preview` of `dist/`, so without a build it green-lights the
   previous milestone (Testing doctrine §1).
3. **The brief's acceptance checklist run live with evidence** — every item exercised and output
   captured (harness gotchas apply: verify via `window.__nw`, not screenshots).
4. **Tag pushed** to the remote.

**Known gaps are not allowed.** If something cannot be finished, stop and ask the user for explicit
sign-off BEFORE merge — not disclosure after. "I'll fix it in the next PR" is not a valid merge
strategy.

## Testing doctrine (accumulated — this is where the suite's value lives)

Six tautologies and one dead-hook certification have been found in this suite. Every one of
them was green when it was found. The rules below are what each of them cost, written as
rules so that the next one is caught by a reader rather than by an audit.

**1. Build before you run the Gauntlet.** `scripts/run-gauntlet.mjs` drives
`http://localhost:5199`, a port it does **not** start — that is a long-running `vite preview`
serving `dist/`. **The Gauntlet tests the last build, not your working tree.** Three green
runs were banked against stale code before this surfaced. `npm run build`, then
`npm run gauntlet`, every time.

**2. A negative assertion needs a positive control.** "With the effect off, nothing happened"
passes just as happily when the effect is off *and* broken. Measure with it on, measure with
it off, assert on the difference. Every matched pair in the suite exists because a one-sided
version of it was green while the feature did nothing.

**3. Never derive the expected value from the code under test.** `testXpCurve` summed
`xpToNext()` and asserted `levelFromXp()` of that sum — the identity `f(f⁻¹(L)) === L`. It was
green under `base 1 / growth 1.001` and under `base 99999 / growth 3.0`. Any test whose
expectation is *computed* rather than *written down* is tautological until a mutation proves
otherwise, and the mutation output belongs in the commit message, not a claim that it would
have failed.

**4. Driving a handler proves the handler works, never that the game calls it.** The C4 test
called `applyEffect('thorns_reflect', …)`, got 6 back and went green — and it was the only
caller of `applyEffect()` in the entire project. Seven effect hooks stayed placebo through
three milestones behind that one assertion. Assert through the path the *player* takes.

**5. Check the return value of the call your test is built on.** `testLoomKeystones` called
`allocate('keystone_glass_echo')`; the node id is `keystone_glass`. It returned `false`, the
whole `if (allocated)` body was unreachable, and the test closed on `ok(true, '…completed')`.

**6. No disjunct escape hatches.** `!state.gameOver || m.nightsSurvived >= 3` passes for any
run that merely did not end; so does `skillLevel >= beforeLevel || newLevel > 0`. If either
half can carry the assertion alone, the assertion is the weaker half.

**7. `ok(true, '…test completed')` is not a test.** It is the fossil left behind when the real
assertions above it became unreachable.

**8. Bound against what the phase can actually produce, not against a fixed number.** Phase 4
steps a live, un-paused game whose rAF loop races the suite's own stepping; measured across
three identical runs it survived 1, 4 and 6 nights. Any fixed lower bound there is a coin flip.

**9. Every new data row needs a live consumer in the same commit.** This project's cardinal
sin is a row or config knob that nothing reads. See the C4 entry in the ROADMAP for what
fifteen registered effect hooks with seven consumers actually cost.

**10. State the claim in the design's units, not the implementation's.** A8's Cairn density
test could have asserted "the per-tile density is 0.00058", which is the data table read back
to itself and passes no matter how wrong the table is. It asserts "a run meets about one
Cairn" instead — and immediately caught that the shipped densities produced 0.38, because a
density is per-tile *of its biome* and three quarters of the map carries no features at all.
The assertion that can tell you the design is wrong is worth more than the one that can only
tell you the code changed.

**11. Pin a precondition, measure the thing.** `regen_boost`'s control measured 0.000 hp/s
because regen is daytime-only and the suite's clock had drifted into a night. Stubbing
`ctx.isNight` to fix that is not cheating — the claim is about the relic, and the phase is a
precondition to being able to see it. Cheating would be stubbing the regen.

**12. When you add a new source of an effect, the suite's strip-to-nothing helper is where the
fix belongs.** A8's boons made `wearOnly()` a lie: it cleared gear, sockets and the relic but
not the new thing that also feeds `activeEffects()`. Every test that isolates already calls
that helper; patching the two call sites that went red is how the third one gets missed.

**13. A parser test that only feeds it the shapes it already handles is a mirror, not a
test.** N4.4 extracted `parseDohAnswer` from a filter accepting DNS record types 1, 28 and 12
and kept only the first two — silently emptying the Vessel's ISP row forever, because type 12
is PTR and `resolvePtr()` is its only source. The extraction shipped with an adversarial
parser test of nine malformed inputs, and it stayed green, because every input it tried was a
type the new code already knew. **Enumerate the accepted set as a named table and have the
test walk it**, so a dropped case fails at the parser instead of going quiet three files
downstream. The generalisation: when you narrow an input domain, the test must be written
against the CALLERS' needs, not against the new code's behaviour.

**14. A test that moves a clock forward has to move it back.** The A4 radar test stamped
`minimap.draw`'s throttle to `performance.now() + 2e6` to defeat the 10 Hz gate, and never
restored it — so any `?test` run froze the player's own radar for the following half hour.
Anything a test pushes into the future (a throttle, a cooldown, a respawn timer) is world
state in a suite that shares one live world, and belongs in the same `finally` as the rest.

**15. When a value is only correct RELATIVE to another value, assert the relation, not the
two numbers.** A6 gave the hub counters `reachTiles: 2.4` under a comment reading "TIGHTER
than CFG.gather.reachTiles (3.2)". Gather reach is **1.6**. The comment was wrong, the
tie-break was therefore inverted, and a Reliquary raised beside a tree would have stolen
the chop — the exact failure the comment claimed to prevent. Two assertions pinning 2.4 and
1.6 would both have passed. `ok(CFG.a6.reachTiles < CFG.gather.reachTiles)` failed on the
first run. **A comment that quotes a constant from another file is a claim with no test
behind it, and it decays silently the moment either file is retuned.** If the relation
matters, it is the assertion.

**16. Build a fixture through the game's own verb, or measure a world the game cannot
produce.** The A6 forge test wore a blade by writing `state.player.equip.weapon = uid`, and
then measured the player's damage at **0.000 forever** — because `wornStat()` reads
`soulItems[slot]`, and only `toggleEquip()` binds that. The assertion was not wrong about
the game; it was right about a state no player can reach. Driving `ui.hooks.equip()` instead
both fixed it and proved main's equip wiring for free. Where the game has a verb for
reaching a state, the test uses the verb.

**17. Scope an assertion to the subject its message names.** `ok(state.drops.length === 0,
'a Wardstone pays in a blessing, not in loot')` claimed something about a Wardstone and
measured *the entire world for eight game-seconds* — the length of the harvest it was
holding down. It went red about one run in five and blamed A8 for a drop A8 had nothing to
do with. The failure message is part of the test: an assertion whose scope is wider than its
wording will one day accuse the wrong system, and send the next reader to the wrong file
with a confident sentence in their hand. It now measures within three tiles of the stone,
names whatever it finds, and carries a matched control proving that measurement can see a
drop at all.

### The shared-world hazards

`regression.ts` tests all run against **one live world**, in order, and `ok()` **throws**.
Both facts have bitten:

- **Restore stubbed globals in `finally`, never inline.** Because `ok()` throws, an inline
  restore leaks the stub into every later test the first time that assertion goes red. This
  has applied to `Math.random`, `state.god`, `state.buildings` and `ctx.net.rollDamageMul`.
- **A leaked `state.god = true` silently disarms every damage assertion after it.**
  `damagePlayer` early-returns under god mode, so the later tests do not fail — they stop
  measuring.
- **Any new test that consumes `Math.random()` shifts the global stream for every test
  downstream**, shaking latent flakes loose. Seen eight times now (vigor-starve, the Ironwake
  dodge, the uniform-corridor Loom flake, the D5 resonance band, A8's three — the boon leak
  through `wearOnly`, the night-phase regen control, the chill march on blocked ground — and
  N4.4's ability-bar Resolve arithmetic). A red test in a file you did not touch is usually
  this, not a regression. **A milestone that changes worldgen shifts more than the stream** —
  A8 added two blocking feature types, so `canStand()` answers differently around wherever a
  test left the player. **A milestone that changes network cadence shifts it too**: N4.4's
  AAAA retry altered how many requests are in flight, which moved the frame timing the whole
  suite rides on.
- **An exact-arithmetic assertion needs the ambient world held still, not just the subject.**
  The ability bar's "it spends exactly 18 resolve" measured 86 against 82 because Bramblebreak
  killed a foe and `resolvePerKill` landed inside the same synchronous `cast()`. Nothing about
  the bar was wrong. Before asserting an exact delta, ask what ELSE can move that number in
  the window you are measuring, and pin it.
- **Never measure movement on ground you did not choose.** `findUniformCorridor()` exists for
  this. Two separate tests have now measured 0.00px in both halves of a matched pair because
  the foe or the player was against water, a cliff or a tree, and reported it as a failure of
  the multiplier under test.
- **Isolate what you are measuring from everything else that produces the same number.**
  `combat.update()` also ticks the towers, so a "nothing burns" control measured 52 damage
  from a tower built forty tests earlier. Ironwake's control cleared the sockets but not the
  gear, so it measured two independent reflect sources and called it one.
- **Assertion counts drift a few either way run to run** (1872–1874 before A8, 2055–2058
  after) from RNG-dependent assertion loops. An exact count is a weak regression signal; the
  test *names* are the strong one.
- **`GameLog` is a 2000-entry ring buffer.** `entries.slice(rememberedLength)` returns nothing
  once it is full, so a test asserting "the Chronicle said so" silently stops looking. Use
  `log.recent(n)`.

## Debugging & troubleshooting

### The preview harness
The VSCode preview tab runs the live game but has important limitations:
- **`document.hidden === true`** in the preview tab: `requestAnimationFrame` never fires. The render
  loop doesn't run. Screenshots hang. This is a browser security/privacy feature — background tabs
  don't get animation frames.
- **Workaround for render-dependent checks:** foreground the preview panel (click into it) so
  `document.hidden` becomes `false`. rAF will start firing. You can verify with `__nw.frames > 0`.
- **Workaround for render-free verification:** drive the sim directly via `__nw.step(n)` and inspect
  state via `__nw.state.*`, `__nw.sys.*`. The event log (`__nw.log`) captures system outputs without
  needing the render loop.

### Console-driven verification pattern
When the preview harness can't render (backgrounded tab), use this pattern:
```js
// 1. Check sim is advancing
__nw.state.clock.tick  // should be > 0

// 2. Drive sim forward
__nw.step(60)  // advance 60 sim ticks

// 3. Inspect state
__nw.state.gold       // should have changed if economy is ticking
__nw.state.clock.dayPhase  // should have advanced

// 4. Check network data (N1+)
NW.NET.snap.rtt       // current RTT value
NW.NET.get('rtt')     // mapped value (after transform)

// 5. Inject test values
NW.NET.snap.rtt = 500  // simulate bad connection
NW.NET.mappings[0].transform = (v) => 0.3  // override mapping

// 6. Check Rust core (if wasm loaded)
__nw.core.net_params  // or whatever WorldCore exposes
```

### Network-specific debugging (N1+)
```js
// Check what the browser exposes
navigator.connection  // undefined in Firefox — that's expected
navigator.onLine      // true/false
navigator.hardwareConcurrency  // e.g., 8
navigator.deviceMemory  // e.g., 8 (Chrome only)

// Simulate different connection types
NW.NET.snap.connectionType = 'wifi'
NW.NET.snap.effectiveType = '3g'
NW.NET.snap.rtt = 200
NW.NET.snap.downlink = 2.5

// Trigger a transition manually (for testing rift events)
NW.NET.snap.connectionType = 'cellular'  // the detectTransitions() should fire next frame

// Force offline
NW.NET.snap.online = false

// Check mappings are live-tweakable
NW.NET.mappings.find(m => m.netKey === 'rtt').transform = (v) => 0.5
// Next sim tick should use the new transform
```

### Rust/wasm debugging
- `cargo test` in `rust/nightward-core/` runs host-native tests — these test Rust logic without
  needing a browser. The wasm boundary is NOT tested here (wasm-bindgen is only exercised in the
  browser).
- To add a Rust test: add `#[test]` functions in `lib.rs` (or a `tests/` directory). Tests use
  deterministic seeds — no randomness in test assertions.
- If wasm build fails (`npm run wasm`): check that `wasm32-unknown-unknown` target is installed
  (`rustup target list --installed`). Check that `wasm-pack` is available (`npx wasm-pack --version`).
  Remember: wasm-pack does NOT honor `.cargo/config.toml`'s `build.target-dir` — the npm script
  `scripts/wasm.mjs` sets `CARGO_TARGET_DIR` explicitly.
- If wasm functions return unexpected values: check the `Float32Array` layout — TS and Rust must
  agree on indices. The layout contract is documented in `N1-network-seed.md` (for network params)
  and `lib.rs` (for materials). A mismatch = silently wrong values, not a crash.

### Build failures: common causes
1. **`src/wasm/pkg/` missing:** run `npm run wasm` first. `pkg/` is gitignored and must be
   regenerated on every fresh clone/worktree.
2. **`node_modules/.cargo-target` permission issue:** OneDrive may lock files. Retry after a
   few seconds. If persistent, `rm -rf node_modules/.cargo-target` and rebuild.
3. **Type errors after Rust changes:** the `.d.ts` files in `pkg/` are regenerated by wasm-pack.
   If you added a `#[wasm_bindgen]` method, run `npm run wasm` to regenerate the type declarations.
4. **`cargo test` fails with "use of unstable library feature":** check your Rust toolchain version
   (`rustup show`). The project targets stable — no nightly features.
5. **Vite build fails with wasm-related errors:** Vite needs the wasm plugin configured correctly.
   The existing `vite.config.ts` handles this — if it breaks, check that `wasm.mjs` is correctly
   setting the cargo target dir and that wasm-pack output goes to `src/wasm/pkg/`.

## Common pitfalls (accumulated — read before starting a milestone)

### Pitfall 1: Forgetting `npm run wasm` on a fresh worktree
**Symptom:** `npm run typecheck` fails with "Cannot find module '../wasm/pkg/nightward_core'" or
similar. **Fix:** `npm run wasm` first. The shared cargo target dir makes this fast (~5s for
incremental rebuild).

### Pitfall 2: Using `await` in the render loop
**Symptom:** Render loop stalls, frame rate drops. **Rule:** `update()` methods must be synchronous.
If a metric requires `fetch()`, fire the fetch in `update()` but attach a `.then()` callback —
do NOT `await` it. The callback updates the snapshot when the fetch resolves. See N1 brief for
the correct pattern.

### Pitfall 3: Allocating in the hot path
**Symptom:** GC pauses, frame time spikes. **Rule:** no `new` in `update()` or `render()` methods.
Pre-allocate arrays/buffers. Mutate in place. The `Float32Array` for `packForCore()` is the
exception — it's 52 bytes, young-gen, and collected quickly. But if you find yourself writing
`new Something()` inside the render loop, restructure.

### Pitfall 4: Network mapping transforms returning NaN
**Symptom:** Game values become NaN, everything breaks. **Cause:** a `compute()` or `transform()`
function divides by zero or accesses undefined. **Fix:** every transform function must have
guardrails (min/max clamp). Every `compute()` is wrapped in try/catch in `get()`. The mapping
interface enforces `min`/`max` fields — USE them.

### Pitfall 5: Forgetting that `navigator.connection` is Chrome-only
**Symptom:** `navigator.connection` is `undefined` in Firefox/Safari. **Rule:** every access to
`navigator.connection` uses optional chaining (`con?.rtt`) and falls back to a documented default.
Test in at least Chrome AND Firefox before merging.

### Pitfall 6: Transition detection without debouncing
**Symptom:** Rift events fire 10 times per second on WiFi. **Cause:** WiFi can flap between
`'wifi'` and `'unknown'` rapidly. **Fix:** implement the transition debouncing spec from N1.
5-second stability window. Ignore `'unknown'` ↔ `'wifi'` transitions.

### Pitfall 7: OneDrive locking worktree files
**Symptom:** `git worktree remove` fails with "Permission denied." **Fix:** wait a few seconds
for OneDrive to release the lock, then `rm -rf` the leftover folder + `git worktree prune`.
If persistent, create worktrees outside the OneDrive path. `git worktree list` is authoritative
for checking stale worktrees.

### Pitfall 8: Sub-pixel rendering without the prototype gate
**Symptom:** You spend 3 sessions building SUBPIX, the user says "I can't tell the difference."
**Fix:** DON'T BUILD FIRST. Prototype first — 2-3 screenshots, user verdict, THEN build. This
is the W1 lesson. It's written in the ROADMAP non-negotiables. It's repeated in the G1 brief.
If you skip the gate, you're ignoring documented project history.

### Pitfall 9: Post-processing affects the UI layer
**Symptom:** HUD text is blurry, color-shifted, or has bloom applied. **Fix:** the UI layer
(menus, HUD, text) must be rendered AFTER the post-processing pipeline. The display list order
is: terrain → entities → shadows → particles → post-processing → UI. UI is never touched by
bloom/AO/grading/vignette.

### Pitfall 10: Live-tuning changes don't take effect
**Symptom:** Editing `NW.CFG.x`, `NW.MATS.y`, or `NW.NET.mappings[z]` has no effect.
**Cause:** the value was copied at boot and never re-read. **Fix:** systems must read from
the live object every frame (or every tick, for sim values). The convention: `NW.CFG.x` is
the source of truth — systems read it, never a cached copy. If a value is read once at boot
and cached, it's not live-tweakable.

## CI considerations

Currently, there's no CI pipeline — verification is manual. If CI is added:

### GitHub Actions (suggested)
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run wasm
      - run: npm run typecheck
      - run: npm run build
      - name: Rust tests
        run: |
          rustup target add wasm32-unknown-unknown
          cargo test --manifest-path rust/nightward-core/Cargo.toml
```

### Pre-merge checklist (manual, for now)
1. `npm run wasm` (if Rust changed)
2. `npm run typecheck` — CLEAN (zero errors, zero warnings)
3. `npm run build` — GREEN (Vite outputs to `dist/`)
4. `cargo test` — ALL PASS (in `rust/nightward-core/`)
5. Live verify on main (after merge): `?seed=1234`, exercise the acceptance checklist from
   the milestone brief
6. If the milestone changes visuals: get user playtest verdict BEFORE starting next milestone

## Network batch verification (N1+)

The network batch adds browser-API-dependent features. Verification must cover multiple
browser scenarios:

### Test matrix
| Scenario | Browser | Connection | Expected behavior |
|----------|---------|------------|-------------------|
| Chrome, fast ethernet | Chrome | RTT ~5ms, DL ~100Mbps, ethernet, 4g | Sim fast (~1.5×), gold fast, enemies normal, Ethernet Plains realm |
| Chrome, throttled 3g | Chrome (DevTools throttling) | RTT ~150ms, DL ~1.5Mbps, cellular, 3g | Sim slow (~0.3×), gold slow, enemies 1.4×, Cellular Chaos realm |
| Chrome, offline | Chrome (DevTools offline) | offline | Sim paused, "CONNECTION LOST" overlay, game not playable until reconnected |
| Firefox | Firefox | No `navigator.connection` | All fallback defaults (RTT 50ms, DL 10Mbps, 4g, ethernet). Game plays identically to Chrome with defaults. No errors. |
| Safari | Safari (if available) | No `navigator.connection` | Same as Firefox — graceful degradation |
| WebGL fallback | Chrome with `?gl` | Any | Post-processing degrades (no bloom, tint overlay instead of LUT). Particles capped at 200. 30fps target. |

### Simulating network conditions in Chrome DevTools
1. Open DevTools → Network tab
2. Click "No throttling" dropdown → select "Slow 3G" or "Fast 3G" or add a custom profile
3. Custom profile for testing: RTT 200ms, downlink 1.5 Mbps, uplink 0.75 Mbps
4. To simulate offline: check "Offline" checkbox
5. To simulate connection type change: use the "Network conditions" tab → "User agent" →
   this doesn't actually change `navigator.connection.type`. Use the console instead:
   `NW.NET.snap.connectionType = 'cellular'`
6. **Important:** DevTools throttling only affects `fetch()` timing, NOT
   `navigator.connection.*` values. Those are set by the browser based on the actual
   network interface. To test `navigator.connection` changes, you need to actually
   switch networks (WiFi → Ethernet → hotspot) or inject values via the console.

### Quick smoke test (run this after every merge)
```js
// In the browser console, at ?seed=1234:
// 1. Core systems alive?
__nw.state.clock.tick > 0            // sim is ticking
__nw.state.gold !== undefined         // economy exists
NW.NET.snap.rtt !== undefined         // network data exists

// 2. Mappings work?
NW.NET.get('rtt') > 0                 // mapping returns a number
NW.NET.get('downlink') > 0            // mapping returns a number

// 3. Live-tuning works?
const before = NW.NET.get('rtt')
NW.NET.mappings.find(m => m.netKey === 'rtt').transform = () => 999
NW.NET.get('rtt') === 999             // mapping updated immediately

// 4. Rust core alive?
__nw.core !== undefined               // core exists
typeof __nw.core.set_network_params === 'function'  // method exists

// 5. HUD toggle works?
// Press 'I' key → HUD should appear/disappear

// 6. No obvious errors?
// Check console — no red errors, no undefined access warnings
```

## Tag format

Tags follow a consistent format: `v<major>.<minor>-<milestone>-<descriptor>`.

- `v0.16-n1-network-seed`
- `v0.17-n2-wire-realm`
- `v0.18-g1-visual-upgrade`
- `v0.19-w6-scoreboards`
- `v0.20-g2-juice-pass`
- `v0.21-n3-living-network`
- `v0.22-a1-local-agent` (if built)

Patch tags for fixes: `v0.16.1-n1-fix-<thing>`.

The version number increments with each merged milestone. The `-<milestone>` segment makes it
obvious which milestone the tag belongs to. The `-<descriptor>` is a very short slug.

### Tagging workflow
```bash
# After live-verifying on main:
git tag -a v0.16-n1-network-seed -m "N1: Network Seed — data plumbing complete"
git push origin v0.16-n1-network-seed
```

Tags are lightweight annotations — the tag message is a one-line summary. Tags are never
moved or deleted. If a fix is needed after tagging, tag a new patch version.
