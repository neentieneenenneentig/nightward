import { test, expect } from '../harness/fixtures';
import type { RunSummary } from '../harness/driver';
import { PROFILES, capped, MINUTES_CAP } from '../profiles';

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

  // 5. the soundtrack rule — drums are for world bosses only.
  const everSawBoss = s.some((x) => x.bossHunting);
  if (!everSawBoss) {
    expect(
      r.audio.hats,
      `${r.audio.hats} drum hits during a session where no world boss ever hunted. ` +
      `Drums are for world bosses only (the X2 rollback, db343c1).`,
    ).toBe(0);
  }
}

for (const base of PROFILES) {
  const profile = capped(base);

  test(`playthrough — ${profile.name}: ${profile.blurb}`, async ({ launch }, testInfo) => {
    test.setTimeout((profile.minutes + 4) * 60 * 1000);
    // pilgrim only means anything at its natural length
    test.skip(
      profile.name === 'pilgrim' && MINUTES_CAP < 16,
      'full-life run — set NW_MINUTES=99 for the pre-release sweep',
    );

    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: profile.seed, gl });

    const summary = await nw.play(profile);

    /* Artifacts. The per-second timeline is the interesting one: it is a
     * balance dataset, not just a pass/fail — hp, gold, foe counts and
     * inventory over time, per archetype, per seed. */
    await testInfo.attach(`${profile.name}-timeline.json`, {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });

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

    assertUniversal(summary, testInfo.project.name);
    profile.check?.(summary);
  });
}
