// Day/night clock math + the ambient tint. The tint is applied as a
// multiply-blended fullscreen layer: white = untouched daylight, blue = night.
import { CFG } from '../data/config';

export const cycleLen = () => CFG.time.daySec + CFG.time.nightSec;

export interface Phase {
  tc: number;        // seconds into the current cycle
  isNight: boolean;
  dayIndex: number;  // 1-based; night N follows day N
}

export function phase(clock: number): Phase {
  const cy = cycleLen();
  const tc = clock % cy;
  return { tc, isNight: tc >= CFG.time.daySec, dayIndex: Math.floor(clock / cy) + 1 };
}

/** B2.1 — the clock a run begins at. Always dawn, whatever the wall clock says.
 *
 *  This overturns decision D2 (2026-07-16), which set the starting phase from the
 *  player's real local time-of-day. D2 was right for an unbounded run, where the
 *  starting phase was flavour that washed out over an hour of play. L1 made the run
 *  15 minutes — 2.65 cycles — and scored it on a leaderboard, at which point the
 *  starting phase stopped being flavour and became a large, uncontrolled fraction of
 *  the result:
 *
 *    boot at 16:50 local → ~6 s of daylight before the first horde
 *    boot at 16:56–23:59 → start inside the night (29.4% of the real day)
 *    boot at 00:05       → the full 240 s day to prepare
 *
 *  Post-B2.2 that lottery inverted rather than closing: a run booting mid-night now
 *  skips that night's wave entirely (no dusk edge, so nothing spawns) and still gets
 *  a full day afterwards, so 29.4% of the real day handed out an *easier* run. Either
 *  polarity is a leaderboard comparing runs that were not asked the same question, and
 *  it contradicts GDD pillar 4 — determinism from seed — for the one input that now
 *  decides the score.
 *
 *  The real clock keeps its gameplay voice: `data/network.ts` still reads `timeOfDay`
 *  for the witching-hours `resolveNightMult` (2.5× resolve drain at 2–5am). That is
 *  where the "your world is your connection" coupling belongs — a texture over the
 *  whole run, not a difficulty roll at second zero.
 *
 *  The argument is deliberately unused: it is the seam the old rule read from, kept
 *  visible so this stays a decision rather than a forgotten constant. */
export function startClock(_realTimeOfDay: number): number {
  return 0;
}

/** Seconds until the current phase (day or night) ends — for the HUD clock. */
export function phaseRemaining(clock: number): number {
  const { tc, isNight } = phase(clock);
  return isNight ? cycleLen() - tc : CFG.time.daySec - tc;
}

type C3 = [number, number, number];
const lerp3 = (a: C3, b: C3, t: number): C3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Ambient tint for a moment in time: day → dusk → night → dawn → day. */
export function tintAt(clock: number): C3 {
  const { tc } = phase(clock);
  const D = CFG.time.daySec, T = CFG.time.transitionSec, cy = cycleLen();
  const { tintDay: day, tintDusk: dusk, tintNight: night, tintDawn: dawn } = CFG.time;

  if (tc < D - T) return day;
  if (tc < D) {
    const t = (tc - (D - T)) / T;
    return t < 0.5 ? lerp3(day, dusk, t * 2) : lerp3(dusk, night, (t - 0.5) * 2);
  }
  if (tc < cy - T) return night;
  const t = (tc - (cy - T)) / T;
  return t < 0.5 ? lerp3(night, dawn, t * 2) : lerp3(dawn, day, (t - 0.5) * 2);
}
