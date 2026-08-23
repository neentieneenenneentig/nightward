// SR1 — The Three Acts. The fifteen minutes stop being flat: one curve, three
// named acts, driven off a clock the game already keeps. `elapsedSec` MUST be
// real-time-shaped, not `state.clock` (sim time, stretched by simSpeed and
// hit-stop). main.ts's `elapsedRealSec()` — a count of fixed sim() steps, not
// performance.now() — is the source: it tracks real time closely during live
// play (the accumulator that drives sim() IS a real-time clock, quantized to
// one STEP) while staying exactly reproducible under a Gauntlet __nw.step()
// loop, which controls the step count directly rather than waiting on
// wall-clock time nobody is going to sit through.
import { CFG } from '../data/config';

export type Act = 'gathering' | 'swelling' | 'reckoning';

export const ACT_LABEL: Record<Act, string> = {
  gathering: 'The Gathering',
  swelling: 'The Swelling',
  reckoning: 'The Reckoning',
};

/** The row for whichever act `elapsedSec` falls in. Past the last row's
 *  `untilSec` (a run can run long — Lifespan's target is seeded, not fixed),
 *  the last row holds — the Reckoning does not un-thin the field just because
 *  the clock overran. */
export function actRowAt(elapsedSec: number) {
  const rows = CFG.sr.actCurve;
  for (const row of rows) if (elapsedSec < row.untilSec) return row;
  return rows[rows.length - 1];
}

export function actFor(elapsedSec: number): Act {
  return actRowAt(elapsedSec).id as Act;
}

/** CFG.sr.enabled's real revert: every multiplier neutral, both gates open —
 *  bit-identical to the pre-SR1 horde, which never heard of acts. */
export const NEUTRAL_ACT_ROW = {
  id: 'gathering' as Act, untilSec: Infinity, countMul: 1, rateMul: 1, elites: true, champions: true,
};
