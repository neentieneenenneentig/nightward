// W6: Lifespan & Scoreboards. Tracks connection uptime, builds a run
// scorecard on death, and persists top-10 runs in localStorage.
// Respects the no-persistence rule: run STATE is never saved, but run
// OUTCOMES (scorecard) may be persisted as historical records.

export interface RunScorecard {
  v: 1;
  date: string;              // ISO date string of when the run ended
  connectionAge: number;     // seconds the tab was open
  dominantRealm: string;     // biome that had the most uptime
  riftsSurvived: number;     // count of realm transitions
  peakRtt: number;           // highest RTT recorded
  lowestDownlink: number;    // lowest bandwidth recorded
  nightsSurvived: number;
  buildingsBuilt: number;
  enemiesKilled: number;
  bossesSlain: number;
  goldHoarded: number;
  finalRealm: string;        // realm at time of death
  loomPointsEarned: number;
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
  buildingsBuilt = 0;
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

  /** Call on enemy kill. */
  onKill(isBoss: boolean) {
    this.enemiesKilled++;
    if (isBoss) this.bossesSlain++;
  }

  /** Call on building placed. */
  onBuild() { this.buildingsBuilt++; }

  /** Call on rift/transition. */
  onRift() { this.riftsSurvived++; }

  /** Build the scorecard snapshot at death. */
  snapshot(): RunScorecard {
    const { state } = this.ctx;
    let dominantRealm = 'Unknown';
    let maxT = 0;
    for (const [realm, t] of this.dominantRealmTally) {
      if (t > maxT) { maxT = t; dominantRealm = realm; }
    }
    return {
      v: 1,
      date: new Date().toISOString(),
      connectionAge: Math.round(this.connectionUptime),
      dominantRealm,
      riftsSurvived: this.riftsSurvived,
      peakRtt: Math.round(this.peakRtt),
      lowestDownlink: this.lowestDownlink === Infinity ? 0 : Math.round(this.lowestDownlink * 10) / 10,
      nightsSurvived: state.nightsSurvived ?? 0,
      buildingsBuilt: this.buildingsBuilt,
      enemiesKilled: this.enemiesKilled,
      bossesSlain: this.bossesSlain,
      goldHoarded: state.player?.gold ?? 0,
      finalRealm: this.ctx.net?.currentBiome?.name ?? 'Unknown',
      loomPointsEarned: (state.player?.loomPoints ?? 0)
        + Object.values(state.player?.loomNodes ?? {} as Record<string, number>).reduce((s: number, r: number) => s + r, 0),
    };
  }

  /** Save the current run to the leaderboard. */
  saveToLeaderboard() {
    const card = this.snapshot();
    const entries = loadLeaderboard();
    entries.push(card);
    // Sort by connection age descending
    entries.sort((a, b) => b.connectionAge - a.connectionAge);
    // Prune to max
    const pruned = entries.slice(0, MAX_ENTRIES);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(pruned));
    } catch { /* quota exceeded — silently drop */ }
    return card;
  }
}

export function loadLeaderboard(): RunScorecard[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RunScorecard[];
  } catch { return []; }
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
