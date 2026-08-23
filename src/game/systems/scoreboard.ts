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

export interface RunScorecard {
  v: 2;
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
  private realLastMs = 0;

  constructor(private ctx: any) {}

  /** Called every frame with real-world dt (not sim dt). */
  updateReal(realMs: number) {
    if (this.realLastMs === 0) { this.realLastMs = realMs; return; }
    const dt = (realMs - this.realLastMs) / 1000;
    this.realLastMs = realMs;
    if (this.ctx.state.gameOver) return;
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

  /** Call on enemy kill. `elite` is the A2 rank, absent on an ordinary foe. */
  onKill(isBoss: boolean, elite?: 'elite' | 'champion' | null) {
    this.enemiesKilled++;
    if (isBoss) this.bossesSlain++;
    if (elite === 'champion') this.championsFelled++;
    else if (elite === 'elite') this.elitesFelled++;
  }

  /** SR3 — call with the actual (clamped) damage a melee hit landed. */
  onDamageDealt(dmg: number) { if (dmg > this.bestHit) this.bestHit = dmg; }

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
      v: 2,
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
      bossDamageDealt: state.reckoning?.damageDealt,
      seed: state.seed,
      engineVersion: ENGINE_VERSION,
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
    // Prune to max
    const pruned = entries.slice(0, MAX_ENTRIES);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(pruned));
    } catch { /* quota exceeded — silently drop */ }
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
  if (raw && raw.v === 2) return raw as RunScorecard;
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

/** SR9 — a category over the board that already exists: a filter plus a
 *  comparator, which is data, not a new leaderboard. Shipping three rather
 *  than the plan's full six (§6): categories nobody understands are
 *  categories nobody plays, and Time/Purity/Legacy are the three that need
 *  no explanation. Damage (`bestHit`) is shown on the death screen instead
 *  of ranked — a single-run number, not a "best of your history" claim
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
