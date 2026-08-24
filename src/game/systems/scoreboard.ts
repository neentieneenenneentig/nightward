// W6/L1: Lifespan & Scoreboards. Tracks connection uptime, builds a run
// scorecard on death, and persists top runs in localStorage. Respects the
// no-persistence rule: run STATE is never saved, but run OUTCOMES (scorecard)
// may be persisted as historical records.
//
// L1: the board ranks by `legacyScore` — a transparent weighted sum of what
// you actually DID this run (nights, kills, bosses, buildings, Loom points,
// gold, years lived) — not by how long the tab happened to sit open. That
// old sort key (`connectionAge` descending, uncapped) rewarded being AFK: a
// player who walled themselves in and did nothing had the dominant strategy
// for a "high score." The hard lifespan cap (systems/lifespan.ts) bounds
// every run to roughly the same window regardless, so what's left to
// optimize is what you accomplish inside it — which is the point.
import { CFG } from '../data/config';
import { allRolled } from '../data/items';
import { bestRoll } from './loot';
import { legacyWeight } from '../data/covenants';
import { gearScore } from '../rules';
import { CHRONICLE_SERIES, type Quality } from './chronicle';
import { neutralGameValue } from '../data/network';

export interface WireSeriesBucket {
  min: number;
  med: number;
  p95: number;
  max: number;
  n: number;
  q: Quality;
}

/** SR9/SR10 — shareable run conditions, deliberately stripped of identity. */
export interface WireRecord {
  v: 1;
  series: Record<string, WireSeriesBucket>;
  values: Record<string, number>;
  shape: {
    effectiveType: string;
    saveData: boolean;
    deepLive: boolean;
    natClass: string;
    udpV6: boolean;
    protoDominant: string;
    pact: string;
    soundings: number;
    downMbps?: number;
    upMbps?: number;
    bloatGrade?: string;
  };
  vessel: {
    gpuTier: 'low' | 'mid' | 'high' | 'unknown';
    cores: number;
    pressureMean: number;
    jankP95: number;
    reducedMotion: boolean;
  };
  assist: { index: number; formula: number };
}

/** SR9/SR10: the explicit mapping outputs allowed into a shareable record. */
export const SCORED_TARGETS = [
  'simSpeed', 'goldRate', 'enemyScale', 'dayPhase', 'realmType', 'damage',
  'hordeAggression', 'siltDrag', 'fortune', 'aperture', 'gatherSpeed',
  'xpRate', 'vigorDecay', 'resolveDecay', 'mercy',
] as const;

/** SR10 — bumped whenever the assist-index formula changes meaningfully
 *  enough that a stored `assist.index` should be treated as stale. An old
 *  record keeps whatever number it was written with — this is a label, not
 *  a migration — but CATEGORIES' 'adjusted' entry never trusts the stored
 *  value anyway; it recomputes straight from `wire.values` at rank time
 *  (see adjustedLegacy below), so a formula bump fixes every existing card
 *  retroactively instead of only the ones written after it. */
export const ASSIST_FORMULA = 2;

/** SR10 — a weighted geometric mean, in log space, of how far this run's
 *  measured mapping outputs sat from their neutral (network-absent)
 *  values. >1 means the wire net helped this run, <1 means it net hurt,
 *  1.0 covers both "nothing sampled" and "sampled but it exactly
 *  cancelled out" — the index alone cannot tell those apart, which is
 *  exactly why every comparison built on it also carries `n`.
 *
 *  Weights are signed (CFG.legacy.assistWeights) so a target that gets
 *  WORSE as its number goes up (enemyScale, hordeAggression, the decays,
 *  mercy) still contributes assistance in the right direction — see each
 *  weight's own comment for the reasoning. A target weighted 0 (dayPhase,
 *  realmType, damage) is skipped entirely rather than diluting the mean
 *  with noise from a degenerate or dormant mapping. */
export function computeAssistIndex(values: Record<string, number>): number {
  const weights = CFG.legacy.assistWeights;
  let weightedLogSum = 0;
  let weightMagnitude = 0;
  for (const target of SCORED_TARGETS) {
    const weight = weights[target] ?? 0;
    if (weight === 0) continue;
    const value = values[target];
    const neutral = neutralGameValue(target);
    if (!(value > 0) || !(neutral > 0)) continue;
    weightedLogSum += weight * Math.log(value / neutral);
    weightMagnitude += Math.abs(weight);
  }
  return weightMagnitude > 0 ? Math.exp(weightedLogSum / weightMagnitude) : 1.0;
}

type WireAccumulator = { sum: number; sec: number };

function wireSeries(chronicle: any): Record<string, WireSeriesBucket> {
  const out: Record<string, WireSeriesBucket> = {};
  for (const meta of CHRONICLE_SERIES) {
    const buckets = chronicle?.get?.(meta.key)?.buckets;
    if (!Array.isArray(buckets)) continue;
    out[meta.key] = buckets.reduce((stats: WireSeriesBucket, bucket: any) => ({
      min: Math.min(stats.min, bucket.min), med: bucket.med,
      p95: bucket.p95, max: Math.max(stats.max, bucket.max),
      n: stats.n + bucket.n, q: bucket.q,
    }), { min: Infinity, med: 0, p95: 0, max: -Infinity, n: 0, q: 'unavailable' });
    if (out[meta.key].n === 0) delete out[meta.key];
  }
  return out;
}

function gpuTier(reading: any): WireRecord['vessel']['gpuTier'] {
  const tier = reading?.gpuTier;
  return tier === 'low' || tier === 'mid' || tier === 'high' ? tier : 'unknown';
}

function buildWireRecord(ctx: any): WireRecord {
  const net = ctx.net;
  const snap = net?.snap ?? {};
  const vessel = net?.vessel?.reading ?? {};
  const sounding = ctx.sounding?.last ?? {};
  const values: Record<string, number> = {};
  for (const target of SCORED_TARGETS) {
    const sampled = ctx.wireAcc?.[target];
    const value = sampled?.sec > 0 ? sampled.sum / sampled.sec : Number(net?.getGameValue?.(target));
    if (Number.isFinite(value)) values[target] = Math.round(value * 100) / 100;
  }
  const proto = net?.protocolReality?.()?.dominant;
  const pressure = Number(vessel.pressureFrac);
  const jank = Number(vessel.jankMs);
  return {
    v: 1,
    series: wireSeries(ctx.chronicle),
    values,
    shape: {
      effectiveType: typeof snap.effectiveType === 'string' ? snap.effectiveType : 'unknown',
      saveData: !!snap.saveData,
      deepLive: !!snap.deepLive,
      natClass: typeof snap.natClass === 'string' ? snap.natClass : 'unknown',
      udpV6: !!snap.udpV6,
      protoDominant: typeof proto === 'string' ? proto : 'unknown',
      pact: ctx.state?.covenant ?? 'quiet',
      soundings: Number(ctx.sounding?.count) || 0,
      downMbps: sounding.live && Number.isFinite(Number(sounding.downMbps)) ? Number(sounding.downMbps) : undefined,
      upMbps: sounding.live && Number.isFinite(Number(sounding.upMbps)) ? Number(sounding.upMbps) : undefined,
      bloatGrade: sounding.live && typeof sounding.bloatGrade === 'string' && sounding.bloatGrade !== '?'
        ? sounding.bloatGrade : undefined,
    },
    vessel: {
      gpuTier: gpuTier(vessel),
      cores: Number(vessel.cores) || 0,
      pressureMean: Number.isFinite(pressure) ? Math.round(pressure * 100) / 100 : 0,
      jankP95: Number.isFinite(jank) ? Math.round(jank * 100) / 100 : 0,
      reducedMotion: !!vessel.reducedMotion,
    },
    assist: { index: computeAssistIndex(values), formula: ASSIST_FORMULA },
  };
}

export interface RunScorecard {
  v: 2 | 3;
  date: string;              // ISO date string of when the run ended
  connectionAge: number;     // seconds the tab was open (kept as a stat, no longer the sort key)
  dominantRealm: string;     // biome that had the most uptime
  riftsSurvived: number;     // count of realm transitions
  peakRtt: number;           // highest RTT recorded
  lowestDownlink: number;    // lowest bandwidth recorded
  nightsSurvived: number;
  buildingsBuilt: number;
  enemiesKilled: number;
  bossesSlain: number;
  /** A2: elites and champions felled. Optional, so every v2 card written before
   *  A2 stays valid and needs no migration — the same carve-out `trophy` took.
   *  Separate from `enemiesKilled` rather than folded into it because "I killed
   *  400 things" and "I killed 400 things, nine of which fought back properly"
   *  are different runs, and the scorecard is the only place that difference is
   *  ever recorded. */
  elitesFelled?: number;
  championsFelled?: number;
  /** N4.5/A7: the pact the run ended under. Optional, so every v2 card written
   *  before the covenants exist stays valid — the same carve-out elitesFelled
   *  took. */
  pact?: string;
  goldHoarded: number;
  finalRealm: string;        // realm at time of death
  loomPointsEarned: number;
  age: number;                                        // L1: years lived when the run ended
  causeOfDeath: 'old_age' | 'hall_fallen' | 'unknown'; // L1
  legit: boolean;                                      // L1: false if god mode was ever used this run
  legacyScore: number;                                 // L1: the ranking number — see computeLegacyScore
  /** A1 §4.2(b): the best thing this run found.
   *
   *  Pillar 3 forbids persistence except a finished run's scorecard, and this
   *  is exactly that carve-out: a name and a tier, never live state, nothing
   *  carrying into the next run. It exists because a rarity ladder compressed
   *  into fifteen minutes needs somewhere for the memory to land — the Sovereign
   *  you found on night four should still be a thing that happened after the
   *  run that found it is over.
   *
   *  Read from the roll REGISTRY rather than the bag: an item you found, wore,
   *  and lost to a death scatter still happened to you. Optional, so v2 records
   *  written before A1 stay valid and need no migration. */
  trophy?: { name: string; rarity: string; affixes: number } | null;
  /** SR3 — the run's terminal shape and the Reckoning's own numbers. All
   *  optional, the same carve-out elitesFelled/pact/trophy already took: a
   *  v2 card predates the Reckoning entirely and stays valid without a
   *  migration branch, reading as "not recorded" rather than as zeroes —
   *  a zero bossDamageDealt would read as "the fight went badly", when what
   *  actually happened is the fight never existed on that record. */
  outcome?: 'reckoned' | 'outlasted' | 'fallen' | 'unmet';
  /** Rarity + affix count over every worn slot — see rules.ts gearScore(). */
  gearScore?: number;
  /** Seconds from the summons to however the fight ended. Undefined on
   *  'unmet' — there was no fight to time. */
  reckoningSec?: number;
  /** Biggest single melee hit landed this run, win or lose. */
  bestHit?: number;
  /** SR3 §3 damage axis's other half: the most damage landed in any
   *  rolling 10-SIM-second window (a burst spread across several swings
   *  reads differently than one big hit). Sim time, not real time, for the
   *  same reason reckoningSec uses state.clock — the window has to mean
   *  "10 seconds of the fight," not "10 seconds of wall clock," or a
   *  network hitch that stalls sim time would shrink the window's content
   *  for reasons that have nothing to do with how hard the player hit. */
  bestBurst10s?: number;
  /** Damage dealt to the summoned lord specifically — what an Outlasted
   *  ending is scored on, and what makes a loss still a number to beat. */
  bossDamageDealt?: number;
  /** SR9 — the run's world seed. The same carve-out as trophy/pact: optional
   *  so every card written before this field existed stays valid. Unlike
   *  the wire block (network/geo readings — see the leaderboard's own
   *  privacy risk in the plan), a seed identifies a WORLD, not a player —
   *  it is the one field that turns "I don't believe that run" into
   *  "load ?seed=N and see for yourself", which a legacyScore number alone
   *  can never offer. */
  seed?: number;
  /** SR9 — which record contract wrote this card. Bumped by hand when the
   *  scoring formula or the shape changes meaningfully enough that an old
   *  card should be flagged rather than silently compared against a new
   *  one — see ENGINE_VERSION below. Not a build number; this project has
   *  no release pipeline that stamps one on, and inventing one only to
   *  satisfy this field would be a row serving no reader but itself. */
  engineVersion?: string;
  /** SR9/SR10 — privacy-allowlisted conditions from the run's wire and vessel. */
  wire?: WireRecord;
}

export interface WireComparison {
  metric: string;
  now: number;
  baselineMed: number;
  deltaPct: number;
  percentile: number;
  n: number;
  /** SR10 — n has reached CFG.sr.wireBaselineMinRuns. Computed here rather
   *  than left for each caller to re-check against the config constant, so
   *  a UI can render "not enough history yet" off this field instead of
   *  duplicating the threshold comparison (see ui.ts's leaderboard panel). */
  sufficient: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Compare this run's measured mapping outputs with the player's own history. */
export function compareWire(card: RunScorecard, history: RunScorecard[]): WireComparison[] {
  const nowValues = card.wire?.values;
  if (!nowValues) return [];
  const result: WireComparison[] = [];
  for (const metric of Object.keys(nowValues)) {
    const now = nowValues[metric];
    const past = history
      .filter((entry) => entry !== card && Number.isFinite(entry.wire?.values?.[metric]))
      .map((entry) => entry.wire!.values[metric]);
    const baselineMed = median(past);
    const deltaPct = baselineMed === 0 ? 0 : ((now - baselineMed) / Math.abs(baselineMed)) * 100;
    const below = past.filter((value) => value < now).length;
    result.push({
      metric,
      now,
      baselineMed,
      deltaPct,
      percentile: past.length ? (below / past.length) * 100 : 0,
      n: past.length,
      sufficient: past.length >= CFG.sr.wireBaselineMinRuns,
    });
  }
  return result;
}

/** SR9 — see RunScorecard.engineVersion. The full "seed + input log +
 *  checksum" verification insurance the plan describes stops here for now:
 *  a real input-replay hash needs a single capture point for EVERY input
 *  surface that can affect a run (movement, the attack click, the ability
 *  bar's digit keys, the build/pause menus), and today those live in
 *  separate listeners across input.ts, main.ts and ui.ts with no shared
 *  tap. Hashing only the movement axis — the one surface with an existing
 *  enumerable read — would make `inputHash` match on runs whose COMBAT
 *  diverged completely, which is worse than no hash: a verification field
 *  that lies about what it verifies. Seed alone is honest about what it
 *  proves (the world), and is the piece that ships without borrowing that
 *  claim. */
export const ENGINE_VERSION = 'sr9.0';

/** Bag of stats computeLegacyScore needs — shared by snapshot(), getLiveStats(), and v1 migration. */
export interface LegacyInputs {
  nightsSurvived: number;
  enemiesKilled: number;
  bossesSlain: number;
  buildingsBuilt: number;
  loomPointsEarned: number;
  goldHoarded: number;
  age: number;
  causeOfDeath: 'old_age' | 'hall_fallen' | 'unknown';
}

/** L1: a single transparent number for "which run was best." Weights live in
 *  CFG.legacy.weights (data, tunable live) — the Lens design law is
 *  legibility, so this stays a plain weighted sum, not a hidden curve. */
export function computeLegacyScore(inp: LegacyInputs): number {
  const w = CFG.legacy.weights;
  const yearsLived = Math.max(0, inp.age - CFG.lifespan.startAge);
  let score = inp.nightsSurvived * w.nightSurvived
    + inp.enemiesKilled * w.kill
    + inp.bossesSlain * w.bossKill
    + inp.buildingsBuilt * w.building
    + inp.loomPointsEarned * w.loomPoint
    + inp.goldHoarded * w.gold
    + yearsLived * w.yearLived;
  if (inp.causeOfDeath === 'old_age') score += w.oldAgeBonus;
  return Math.round(score);
}

const LS_KEY = 'nw.leaderboard';
const MAX_ENTRIES = 50;

export class ScoreboardSystem {
  connectionUptime = 0;      // real seconds since tab opened
  dominantRealmTally = new Map<string, number>();
  riftsSurvived = 0;
  peakRtt = 0;
  lowestDownlink = Infinity;
  enemiesKilled = 0;
  bossesSlain = 0;
  elitesFelled = 0;
  championsFelled = 0;
  buildingsBuilt = 0;
  /** SR3 — the Damage axis's "biggest single hit". Melee only (combat.ts's
   *  resolveHit loop) — echo/tower damage isn't threaded through here, which
   *  is a real gap for a total but not for THIS purpose: the axis is about
   *  the swing that hit hardest, and melee is what a player is aiming when
   *  they read "biggest hit" as a thing to beat. */
  bestHit = 0;
  /** SR3 §3 — the damage axis's other half. A ring of (clock, dmg) pairs
   *  trimmed to the trailing 10 sim-seconds on every hit; cheap because a
   *  hit lands at most a few times a second, never at frame rate. */
  bestBurst10s = 0;
  private burstWindow: { t: number; dmg: number }[] = [];
  private realLastMs = 0;
  private wireAcc: Record<string, WireAccumulator> = {};

  constructor(private ctx: any) {}

  /** Called every frame with real-world dt (not sim dt). */
  updateReal(realMs: number) {
    if (this.realLastMs === 0) { this.realLastMs = realMs; return; }
    const dt = (realMs - this.realLastMs) / 1000;
    this.realLastMs = realMs;
    if (this.ctx.state.gameOver) return;
    this.sampleWire(dt);
    this.connectionUptime += dt;

    // Track realm uptime
    const biome = this.ctx.net?.currentBiome?.name ?? 'Unknown';
    this.dominantRealmTally.set(biome, (this.dominantRealmTally.get(biome) ?? 0) + dt);

    // Track RTT peaks and downlink lows
    const rtt = this.ctx.net?.snap?.rtt ?? 0;
    if (rtt > this.peakRtt) this.peakRtt = rtt;
    const dl = this.ctx.net?.snap?.downlink ?? Infinity;
    if (dl < this.lowestDownlink) this.lowestDownlink = dl;
  }

  /** Keep consequences as time-weighted means; a death-time read would lie. */
  private sampleWire(dtSec: number) {
    const net = this.ctx.net;
    if (!net?.getGameValue || dtSec <= 0) return;
    for (const target of SCORED_TARGETS) {
      const value = Number(net.getGameValue(target));
      if (!Number.isFinite(value)) continue;
      const sample = this.wireAcc[target] ??= { sum: 0, sec: 0 };
      sample.sum += value * dtSec;
      sample.sec += dtSec;
    }
  }

  /** Call on enemy kill. `elite` is the A2 rank, absent on an ordinary foe. */
  onKill(isBoss: boolean, elite?: 'elite' | 'champion' | null) {
    this.enemiesKilled++;
    if (isBoss) this.bossesSlain++;
    if (elite === 'champion') this.championsFelled++;
    else if (elite === 'elite') this.elitesFelled++;
  }

  /** SR3 — call with the actual (clamped) damage a melee hit landed. */
  onDamageDealt(dmg: number) {
    if (dmg > this.bestHit) this.bestHit = dmg;
    const t = this.ctx.state?.clock ?? 0;
    this.burstWindow.push({ t, dmg });
    while (this.burstWindow.length && this.burstWindow[0].t < t - 10) this.burstWindow.shift();
    let sum = 0;
    for (const e of this.burstWindow) sum += e.dmg;
    if (sum > this.bestBurst10s) this.bestBurst10s = sum;
  }

  /** Call on building placed. */
  onBuild() { this.buildingsBuilt++; }

  /** Call on rift/transition. */
  onRift() { this.riftsSurvived++; }

  private loomPointsEarned(): number {
    const { state } = this.ctx;
    return (state.player?.loomPoints ?? 0)
      + Object.values(state.player?.loomNodes ?? {} as Record<string, number>).reduce((s: number, r: number) => s + r, 0);
  }

  private dominantRealm(): string {
    let dominantRealm = 'Unknown', maxT = 0;
    for (const [realm, t] of this.dominantRealmTally) {
      if (t > maxT) { maxT = t; dominantRealm = realm; }
    }
    return dominantRealm;
  }

  /** Build the scorecard snapshot at death. */
  snapshot(): RunScorecard {
    const { state } = this.ctx;
    const loomPointsEarned = this.loomPointsEarned();
    const age = Math.floor(state.player?.age ?? CFG.lifespan.startAge);
    const causeOfDeath: RunScorecard['causeOfDeath'] = state.gameOverCause ?? 'unknown';
    const legit = !state.everGod;
    const legacyScore = Math.round(computeLegacyScore({
      nightsSurvived: state.nightsSurvived ?? 0,
      enemiesKilled: this.enemiesKilled,
      bossesSlain: this.bossesSlain,
      buildingsBuilt: this.buildingsBuilt,
      loomPointsEarned,
      goldHoarded: state.player?.gold ?? 0,
      age,
      causeOfDeath,
    }) * legacyWeight(state.nightsAtCovenant ?? {}, state.covenant ?? 'quiet'));
    return {
      v: 3,
      date: new Date().toISOString(),
      connectionAge: Math.round(this.connectionUptime),
      dominantRealm: this.dominantRealm(),
      riftsSurvived: this.riftsSurvived,
      peakRtt: Math.round(this.peakRtt),
      lowestDownlink: this.lowestDownlink === Infinity ? 0 : Math.round(this.lowestDownlink * 10) / 10,
      nightsSurvived: state.nightsSurvived ?? 0,
      buildingsBuilt: this.buildingsBuilt,
      enemiesKilled: this.enemiesKilled,
      bossesSlain: this.bossesSlain,
      elitesFelled: this.elitesFelled,
      championsFelled: this.championsFelled,
      goldHoarded: state.player?.gold ?? 0,
      finalRealm: this.ctx.net?.currentBiome?.name ?? 'Unknown',
      loomPointsEarned,
      age,
      causeOfDeath,
      legit,
      legacyScore,
      pact: state.covenant ?? 'quiet',
      trophy: (() => {
        const best = bestRoll(allRolled());
        return best ? { name: best.name, rarity: best.rarity, affixes: best.affixes.length } : null;
      })(),
      outcome: state.outcome ?? undefined,
      gearScore: gearScore(state),
      reckoningSec: state.reckoning ? Math.round(state.clock - state.reckoning.startClock) : undefined,
      bestHit: this.bestHit,
      bestBurst10s: this.bestBurst10s,
      bossDamageDealt: state.reckoning?.damageDealt,
      seed: state.seed,
      engineVersion: ENGINE_VERSION,
      wire: buildWireRecord({ ...this.ctx, chronicle: this.ctx.net?.chronicle, wireAcc: this.wireAcc }),
    };
  }

  /** Save the current run to the leaderboard. */
  saveToLeaderboard(): RunScorecard {
    const card = this.snapshot();
    const entries = loadLeaderboard();
    entries.push(card);
    // L1: legit runs ranked first (by legacyScore desc); flagged (god-mode)
    // runs are still recorded but sort after ALL legit runs regardless of
    // score — a god-mode run can never look like a top legit finish.
    entries.sort((a, b) => (Number(b.legit) - Number(a.legit)) || (b.legacyScore - a.legacyScore));

    // SR9 — quota exceeded degrades instead of silently dropping the run
    // that just triggered it. `card` was inserted into the sorted list on
    // its own merits above, so shrinking the CAP (not hand-picking which
    // record to cut) never specifically sacrifices the run that's saving —
    // it drops from the bottom of the ranking, same as a normal prune, just
    // a harder one.
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
      return card;
    } catch { /* over quota even at the full cap — try the cheaper rung next */ }

    // SR10 — the wire block is the cheaper rung the comment above used to
    // promise before it existed: strip it from the OLDEST half of the
    // board BY DATE (not by rank — a legacy-topping run from last week
    // keeps its wire over yesterday's #40) rather than shrinking the
    // record count at all. `card` is always the newest date on the board,
    // so this can never strip the run that's saving right now. A stripped
    // record keeps every other field and still ranks; it just stops
    // carrying the ~800-byte block that made it expensive.
    const byDate = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const oldestHalf = new Set(byDate.slice(0, Math.floor(byDate.length / 2)));
    const wireStripped = entries.map((e) => (oldestHalf.has(e) && e.wire ? { ...e, wire: undefined } : e));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(wireStripped.slice(0, MAX_ENTRIES)));
      return card;
    } catch { /* still over quota — fall through to shrinking the count */ }

    for (const cap of [25, 10, 3, 1]) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(wireStripped.slice(0, cap)));
        return card;
      } catch { /* try the next, smaller cap */ }
    }
    this.ctx.toast?.('This run finished, but the leaderboard could not save it — local storage is full.', 'bad');
    return card;
  }

  /** Live stats for the current run — safe to call every frame. */
  getLiveStats() {
    const { state } = this.ctx;
    const rtt = this.ctx.net?.snap?.rtt ?? 0;
    const dl = this.ctx.net?.snap?.downlink ?? 0;
    const loomPointsEarned = this.loomPointsEarned();
    const age = Math.floor(state.player?.age ?? CFG.lifespan.startAge);
    // The run isn't over — no old-age bonus counted until it actually ends.
    const legacyScore = Math.round(computeLegacyScore({
      nightsSurvived: state.nightsSurvived ?? 0,
      enemiesKilled: this.enemiesKilled,
      bossesSlain: this.bossesSlain,
      buildingsBuilt: this.buildingsBuilt,
      loomPointsEarned,
      goldHoarded: state.player?.gold ?? 0,
      age,
      causeOfDeath: 'unknown',
    }) * legacyWeight(state.nightsAtCovenant ?? {}, state.covenant ?? 'quiet'));
    return {
      connectionAge: Math.round(this.connectionUptime),
      dominantRealm: this.dominantRealm(),
      riftsSurvived: this.riftsSurvived,
      peakRtt: Math.round(Math.max(this.peakRtt, rtt)),
      lowestDownlink: Math.min(this.lowestDownlink, dl),
      enemiesKilled: this.enemiesKilled,
      bossesSlain: this.bossesSlain,
      buildingsBuilt: this.buildingsBuilt,
      nightsSurvived: state.nightsSurvived ?? 0,
      goldHoarded: state.player?.gold ?? 0,
      age,
      legit: !state.everGod,
      legacyScore,
      minutesRemaining: this.ctx.lifespan?.minutesRemaining?.() ?? 0,
    };
  }
}

/** v1 records predate age/causeOfDeath/legit/legacyScore entirely — migrate
 *  them in place so old local run history doesn't vanish or crash the UI.
 *  Best-effort score: no age/old-age term (unknown), `legit: true` by
 *  default since v1 never tracked god-mode use (generous, not punitive, for
 *  runs that predate the tracking existing at all). */
function migrate(raw: any): RunScorecard {
  if (raw && (raw.v === 2 || raw.v === 3)) return raw as RunScorecard;
  const legacyScore = computeLegacyScore({
    nightsSurvived: raw?.nightsSurvived ?? 0,
    enemiesKilled: raw?.enemiesKilled ?? 0,
    bossesSlain: raw?.bossesSlain ?? 0,
    buildingsBuilt: raw?.buildingsBuilt ?? 0,
    loomPointsEarned: raw?.loomPointsEarned ?? 0,
    goldHoarded: raw?.goldHoarded ?? 0,
    age: CFG.lifespan.startAge,
    causeOfDeath: 'unknown',
  });
  return {
    v: 2,
    date: raw?.date ?? new Date(0).toISOString(),
    connectionAge: raw?.connectionAge ?? 0,
    dominantRealm: raw?.dominantRealm ?? 'Unknown',
    riftsSurvived: raw?.riftsSurvived ?? 0,
    peakRtt: raw?.peakRtt ?? 0,
    lowestDownlink: raw?.lowestDownlink ?? 0,
    nightsSurvived: raw?.nightsSurvived ?? 0,
    buildingsBuilt: raw?.buildingsBuilt ?? 0,
    enemiesKilled: raw?.enemiesKilled ?? 0,
    bossesSlain: raw?.bossesSlain ?? 0,
    goldHoarded: raw?.goldHoarded ?? 0,
    finalRealm: raw?.finalRealm ?? 'Unknown',
    loomPointsEarned: raw?.loomPointsEarned ?? 0,
    age: CFG.lifespan.startAge,
    causeOfDeath: 'unknown',
    legit: true,
    legacyScore,
  };
}

export function loadLeaderboard(): RunScorecard[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];
    return parsed.map(migrate);
  } catch { return []; }
}

/** SR10 — legacyScore with the run's own assist index divided out, so a run
 *  the wire measurably helped ranks BELOW its raw legacyScore and one it
 *  measurably hurt ranks above. Recomputed from `wire.values` every call
 *  rather than trusting the stored `assist.index` — that is what lets an
 *  old card (formula 1, or no `assist` block at all, pre-SR10) get scored
 *  under the CURRENT formula instead of reading as permanently 0/unhelped;
 *  see the plan's own M5 note that the formula is versioned specifically so
 *  it can be applied retroactively. Falls back to the plain legacyScore
 *  when there's no wire block to recompute from at all — nothing was ever
 *  measured on that run, so there is nothing to adjust. */
export function adjustedLegacy(card: RunScorecard): number {
  const values = card.wire?.values;
  if (!values) return card.legacyScore;
  const index = computeAssistIndex(values);
  return Number.isFinite(index) && index > 0 ? Math.round(card.legacyScore / index) : card.legacyScore;
}

/** SR9/SR10 — a category over the board that already exists: a filter plus
 *  a comparator, which is data, not a new leaderboard. The plan's risk
 *  table shipped three of five deliberately — "categories nobody
 *  understands are categories nobody plays", add the rest only if asked
 *  for — and 'adjusted' is the one being asked for now that assist.index
 *  is real. 'pact' (covenant-weighted) stays deferred: legacyWeight()
 *  already folds the covenant multiplier into every `legacy` ranking, and
 *  nothing has specified what a SEPARATE pact axis would sort or filter
 *  on — inventing that ordering blind is exactly the "nobody understands
 *  it" failure the mitigation exists to prevent, not a gap to fill on
 *  spec. Damage (`bestHit`) is shown on the death screen instead of
 *  ranked — a single-run number, not a "best of your history" claim
 *  worth its own board. */
export interface LeaderboardCategory {
  id: string;
  label: string;
  filter: (c: RunScorecard) => boolean;
  cmp: (a: RunScorecard, b: RunScorecard) => number; // ascending: a before b if negative
}
export const CATEGORIES: LeaderboardCategory[] = [
  { id: 'legacy', label: 'Legacy', filter: () => true, cmp: (a, b) => b.legacyScore - a.legacyScore },
  { id: 'time', label: 'Fastest Reckoning',
    filter: (c) => c.outcome === 'reckoned',
    cmp: (a, b) => (a.reckoningSec ?? Infinity) - (b.reckoningSec ?? Infinity) },
  // "Purity": the win with the LEAST gear — ascending gearScore, same as
  // Time's ascending seconds. The category speedrunners actually love,
  // because it rewards a build decision rather than time invested.
  { id: 'purity', label: 'Lowest Gear, Won',
    filter: (c) => c.outcome === 'reckoned',
    cmp: (a, b) => (a.gearScore ?? Infinity) - (b.gearScore ?? Infinity) },
  { id: 'adjusted', label: 'Adjusted Legacy', filter: () => true,
    cmp: (a, b) => adjustedLegacy(b) - adjustedLegacy(a) },
];

/** Entries in `cat`'s order, legit runs still ranked before flagged ones
 *  regardless of category — the same rule saveToLeaderboard's own sort
 *  already applies for Legacy, now uniform across all three. */
export function rankFor(catId: string, entries: RunScorecard[]): RunScorecard[] {
  const cat = CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0];
  return entries.filter(cat.filter).sort((a, b) => (Number(b.legit) - Number(a.legit)) || cat.cmp(a, b));
}

/** Format seconds into "12h 34m 56s" or "5m 12s" or "42s". */
export function formatAge(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
