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
