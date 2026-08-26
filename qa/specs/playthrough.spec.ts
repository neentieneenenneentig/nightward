import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../harness/fixtures';
import type { RunSummary } from '../harness/driver';
import { PROFILES, capped, MINUTES_CAP } from '../profiles';

/** Timelines land here as plain JSON — the trace zips inside the HTML report
 *  are not something you can point a script at. */
const TIMELINE_DIR = join(process.cwd(), 'qa', '.artifacts', 'timelines');

/**
 * Timed playthroughs, one per player archetype.
 *
 * Everything here happens in real wall-clock time through real DOM input, so
 * these exercise frame pacing, streaming, memory and the input path — none of
 * which the Gauntlet touches, because it drives the sim with __nw.step().
 *
 * NW_MINUTES caps each profile's length (default 1). `NW_MINUTES=99` runs each
 * at its natural length — that's the pre-release sweep, ~40 minutes.
 */

/**
 * Frame-rate floors, per lane.
 *
 * The `webgl` lane renders through ANGLE/SwiftShader — software rasterization
 * on the CPU. It measured ~3 fps here, which says nothing about the game: it
 * is a statement about the rasterizer. That lane is a CORRECTNESS lane, and
 * its only frame-rate question is "did the loop die". Real performance numbers
 * have to come from the headed WebGPU lane, on an actual GPU.
 */
const FPS_FLOOR: Record<string, number> = { webgl: 0.5, firefox: 0.5, webgpu: 15 };

/** Invariants that must hold for every archetype. This is the release gate. */
function assertUniversal(r: RunSummary, lane: string) {
  const s = r.samples;
  expect(s.length, 'no samples were taken').toBeGreaterThan(2);

  const first = s[0], last = s[s.length - 1];

  // 1. the render loop never died
  expect(last.frames, 'frame counter did not advance across the session').toBeGreaterThan(first.frames);
  const floor = FPS_FLOOR[lane] ?? 0.5;
  expect(
    r.avgFps,
    `averaged ${r.avgFps} fps over the session, below the ${lane} floor of ${floor}`,
  ).toBeGreaterThan(floor);

  // 2. time actually passed in the world
  expect(last.clock, 'game clock did not advance').toBeGreaterThan(first.clock);

  // 3. no NaN leaked into anything the player can see.
  //    WORKFLOW.md Pitfall 4: a bad transform turns values into NaN and the
  //    game keeps running while every number quietly becomes garbage.
  for (const x of s) {
    for (const k of ['hp', 'gold', 'x', 'y', 'clock', 'vigor', 'resolve', 'age'] as const) {
      expect(Number.isFinite(x[k]), `${k} was ${x[k]} at t=${x.t.toFixed(1)}s`).toBe(true);
    }
    expect(x.hp, `hp went negative at t=${x.t.toFixed(1)}s`).toBeGreaterThanOrEqual(0);
  }

  // 4. heap growth. A 1-minute run that doubles the heap is a leak worth
  //    seeing before a 15-minute one runs out of memory.
  const heaps = s.map((x) => x.heapMB).filter((x): x is number => x !== null);
  if (heaps.length > 10) {
    const early = heaps[Math.floor(heaps.length * 0.2)];
    const end = heaps[heaps.length - 1];
    expect(
      end,
      `heap grew from ${early}MB to ${end}MB over ${r.realSeconds.toFixed(0)}s — suspected leak`,
    ).toBeLessThan(early * 3 + 120);
  }

  /* 5. the soundtrack rule — drums are for world bosses only.
   *
   * The predicate has to be threat RANGE, not `hunting`: main.ts:597 computes
   * `bossNear` from worldbosses.nearestThreatTiles() < CFG.worldBoss.warnTiles,
   * and a boss sitting inside that radius swaps the mood whether or not it has
   * decided to hunt. A wandering profile like `explorer` walks into boss
   * territory routinely, and drums there are correct. */
  /* 6. SR2 — no session may END inside a draft.
   *
   * A draft freezes the whole sim, so a session that finishes with one still
   * on screen did not play for as long as its timeline claims: the wall clock
   * kept running while the world stood still. Either the driver failed to
   * answer the offer, or the offer refused to close. */
  const lastSample = s[s.length - 1];
  expect(
    lastSample.drafting,
    'the session ended with a draft still on screen — the world was frozen for the tail of this run',
  ).toBe(false);

  const everInBossRange = s.some(
    (x) => x.bossThreatTiles !== null && x.bossThreatTiles < x.warnTiles,
  );
  if (!everInBossRange) {
    const closest = Math.min(...s.map((x) => x.bossThreatTiles ?? Infinity));
    expect(
      r.audio.hats,
      `${r.audio.hats} drum hits during a session where the player was never inside a world ` +
      `boss's threat range (closest approach ${closest.toFixed(1)} tiles, threat range ` +
      `${s[0].warnTiles}). Drums are for world bosses only (the X2 rollback, db343c1).`,
    ).toBe(0);
  }
}

for (const base of PROFILES) {
  const profile = capped(base);

  test(`playthrough — ${profile.name}: ${profile.blurb}`, async ({ launch }, testInfo) => {
    test.setTimeout((profile.minutes + 4) * 60 * 1000);
    // The full-life profiles (pilgrim, speedrunner) only mean anything at
    // their natural length. Keyed off the declared length rather than the
    // name, so a third one does not silently run truncated and fail its check.
    test.skip(
      base.minutes >= 16 && MINUTES_CAP < 16,
      'full-life run — set NW_MINUTES=99 for the pre-release sweep',
    );

    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: profile.seed, gl });

    const summary = await nw.play(profile);

    /* Artifacts. The per-second timeline is the interesting one: it is a
     * balance dataset, not just a pass/fail — hp, gold, foe counts and
     * inventory over time, per archetype, per seed. */
    const body = JSON.stringify(summary, null, 2);
    await testInfo.attach(`${profile.name}-timeline.json`, { body, contentType: 'application/json' });
    mkdirSync(TIMELINE_DIR, { recursive: true });
    writeFileSync(join(TIMELINE_DIR, `${testInfo.project.name}-${profile.name}-${profile.seed}.json`), body);

    const first = summary.samples[0];
    const last = summary.samples[summary.samples.length - 1];
    // state.clock is seeded to the real time-of-day at boot (main.ts), so only
    // the delta is meaningful — the absolute value is not elapsed time.
    // eslint-disable-next-line no-console
    console.log(
      `\n  [${profile.name}] ${summary.realSeconds.toFixed(0)}s real / ${(last.clock - first.clock).toFixed(0)}s game` +
      ` · day ${last.day}${last.night ? ' (night)' : ''}` +
      ` · hp ${last.hp} · gold ${last.gold} · inv ${last.invTotal}` +
      ` · built ${last.buildings} · nights ${last.nightsSurvived}` +
      ` · fps ${summary.avgFps} avg / ${summary.minFps} min` +
      ` · heap ${summary.peakHeapMB ?? '—'}MB` +
      ` · osc ${summary.audio.oscillators} hats ${summary.audio.hats}\n`,
    );

    // Frame-rate-independent invariants always run. These are the release gate.
    assertUniversal(summary, testInfo.project.name);

    /* The per-profile checks are FIDELITY assertions — "did this archetype
     * actually do the thing it exists to do". They need the session to have
     * covered enough game world to be meaningful, and under software
     * rasterization it may not: the fixed-timestep loop clamps `acc` at 250ms
     * per frame (main.ts), so at ~3 fps the world advances at roughly a
     * quarter of wall-clock. Asserting behaviour anyway would make the release
     * gate flaky on a GPU-less CI runner, which is worse than not asserting.
     * So skip them, loudly, rather than pretending they were checked. */
    const gameSeconds = last.clock - first.clock;
    if (gameSeconds < 40) {
      const note =
        `behavioural checks SKIPPED — only ${gameSeconds.toFixed(0)}s of game time elapsed in ` +
        `${summary.realSeconds.toFixed(0)}s real at ${summary.avgFps} fps (frame starvation). ` +
        `Run the webgpu lane for behavioural fidelity.`;
      testInfo.annotations.push({ type: 'fidelity', description: note });
      // eslint-disable-next-line no-console
      console.log(`  ⚠ [${profile.name}] ${note}`);
    } else {
      profile.check?.(summary);
    }
  });
}
