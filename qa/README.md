# QA harness

Layer 3 of the test pyramid. It exists to catch what the other two structurally
cannot.

| | what it is | what it drives | what it misses |
|---|---|---|---|
| **L1** | `cargo test`, `tsc`, `vite build` | nothing — static | everything runtime |
| **L2** | the Gauntlet (`src/game/systems/regression.ts`) | `__nw.step()` — no rAF, no input, no real time | boot, rendering, input, pacing, memory, the built bundle |
| **L3** | this directory | a real browser, real keystrokes, real wall-clock | feel. Always feel. |

The single most important property: **L3 tests the built bundle, not the dev
server.** `.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages, and
before this harness existed nothing had ever loaded `dist/` in a browser.
`playwright.config.ts` therefore runs `npm run build && vite preview` by default.

## Running it

```bash
npm run qa            # webgl lane (headless, software raster) — the everywhere lane
npm run qa:webgpu     # headed, real WebGPU — the path an actual player gets
npm run qa:firefox    # graceful degradation (no navigator.connection at all)
npm run qa:all        # all three
npm run qa:report     # open the HTML report with traces
```

Environment:

| var | effect |
|---|---|
| `NW_SKIP_BUILD=1` | preview the existing `dist/` instead of rebuilding — much faster while iterating |
| `NW_BASE_URL=http://127.0.0.1:5199` | test an already-running server, skip the built-in one entirely |
| `NW_MINUTES=99` | run each profile at its natural length instead of the 1-minute cap. The pre-release sweep. |

Every run writes a Playwright trace (`trace: 'on'`). `npm run qa:report` opens a
scrubable timeline with DOM snapshots, console and network per action — plus the
per-second gameplay timeline attached as JSON.

## The two things that will bite you

**1. rAF throttling.** A Chromium window that is occluded or backgrounded stops
firing `requestAnimationFrame`. The page still loads, `__nw` still exists, every
counter still reads — and every one reads zero. A full sheet of green that means
nothing. This produced a false PASS during the 2026-08-14 audio verification.
`playwright.config.ts` sets three anti-throttling flags, and `Nightward.boot()`
refuses to proceed unless `__nw.frames` is provably advancing. Do not remove
either half.

**2. A metric that can only ever read zero is not a test.** The pair of drum
tests in `smoke.spec.ts` exists in that shape on purpose: the negative one
("ordinary foes must NOT bring in the drums") would pass just as happily if the
audio probe were broken, so the positive one ("a hunting world boss DOES bring
in the drums") proves the probe fires. Keep matched pairs for anything asserted
as an absence.

## Layout

```
playwright.config.ts     browser matrix, webServer, traces, launch flags
qa/harness/driver.ts     the page object — real input, state projection, probes
qa/harness/fixtures.ts   boot fixture + the console-error gate
qa/profiles.ts           player archetypes
qa/specs/smoke.spec.ts   does the shipped page work at all
qa/specs/gauntlet.spec.ts  the 1249-assertion suite, in a browser, on the bundle
qa/specs/playthrough.spec.ts  timed sessions, one per archetype
```

## Profiles

A profile is a player, not a script: `act(snapshot, rng)` is a pure function of
what the player can currently see, so a given `(profile, seed)` replays
identically. The point is that one scripted playthrough only finds bugs on the
path it walks.

| profile | what it stresses |
|---|---|
| `rusher` | combat, death, aggression pathing |
| `turtle` | economy, building, night defence, the leash |
| `explorer` | chunk streaming and heap growth — the leak canary |
| `hoarder` | inventory, crafting, panel rebuild churn |
| `idler` | that the world survives neglect, and that night is genuinely lethal |
| `flailer` | seeded input fuzz over the whole key surface — the crash finder |
| `pilgrim` | one entire life, start to death screen (needs `NW_MINUTES=99`) |

The per-second timeline each profile emits is a balance dataset, not just a
pass/fail: hp, gold, foe counts, inventory and frame rate over time, per
archetype, per seed.

## The audio probe

`driver.ts` patches the Web Audio API via `addInitScript`, before any game code
runs. It never touches a game symbol, so it works identically against the dev
server and the minified bundle.

`hats` counts highpass biquad filters at 8000 Hz. `audio.ts` renders its drum
hat as `burst(t, 0.04, 8000, 1, gain, 'highpass')`; `hat()` is private, is not
one of the five SFX step primitives, and is reachable only from the
`if (d.drums)` branch of the music scheduler. No SFX recipe uses a highpass
filter at all — every one is lowpass or bandpass. So a highpass-8000 filter can
only mean the drum kit is running, which makes the user's standing rule
(*drums are for world bosses only*) mechanically testable rather than something
you have to sit and listen for.

## What this does not do

It does not tell you the game is fun. A green run means "not broken", and the
playtest gate in `WORKFLOW.md` still applies to anything that changes how the
game looks, feels, sounds or is balanced.
