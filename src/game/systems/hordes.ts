// The night — and the day's prey. Night waves scale with nights survived AND
// territory score (greed = risk); they walk at the hall, chew through whatever
// blocks them, and switch to the player at close range. By day, sparse roamers
// (EnemyDef.daytime) pop up around the player to hunt for loot — they wander
// near where they spawned, never siege the hall, and melt away when left far
// behind. Knobs in config.horde / config.dayspawn.
import { CFG } from '../data/config';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { activeCovenant } from '../data/covenants';
import {
  AFFIX_POWER, ELITE_RANKS, ELITE_THREADS, affixDef, championChance, eliteChance,
  eliteName, rollAffixes, rollEliteGear, type EliteRank,
} from '../data/elites';
import { SKILLS } from '../data/skills';
import { addXp, awardSoulXp, hall, rollLoot, territoryScore } from '../rules';
import { activeEffects, armMoveBurst } from './effects';
import type { Building } from '../state';
import { TILE } from '../world/worldgen';
import { BUILDINGS } from '../data/buildings';
import { Sound } from '../../engine/audio';
import { levelUpFlourish } from './flourish';
import { phase, phaseRemaining } from './daynight';
import { actRowAt, NEUTRAL_ACT_ROW } from './acts';
import { epithetForRegion, prefixForBirth } from '../data/lexicon';

const SKILL_NAME: Record<string, string> = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

/** A2 Anchored: x damage to structures. A free function rather than a method
 *  because both call sites are inside expressions the reader is already parsing
 *  a product out of — `* anchored(f)` reads as one more factor, which is
 *  exactly what it is, and `* this.anchoredMul(f)` would not. */
const anchored = (f: { elite?: { has: Set<string> } }) =>
  f.elite?.has.has('anchored') ? AFFIX_POWER.anchoredStructureMul : 1;

export interface Foe {
  uid: number;
  def: EnemyDef;
  x: number; y: number;
  px: number; py: number;
  hp: number; maxHp: number;
  dmg: number;
  baseDmg: number;    // dmg with all birth scaling (night/net/echo) — buffs restore to THIS, never def.dmg
  atkT: number;
  telegraphT: number; // >0 while committed to a telegraphed hit landing
  animT: number;
  dayMob?: boolean;   // day prey: wanders near home, never sieges, despawns when far
  homeX?: number; homeY?: number; // wander anchor (day mobs only)
  /** A2: the rolled elite layer, or absent on an ordinary foe. A single object
   *  rather than eight loose fields, so `f.elite` is the one truth test every
   *  consumer asks and there is no way to have a nameplate without a rank. */
  elite?: EliteState;
}

/** A2: what one elite roll produced. `has` is a Set because the affix checks run
 *  in the march step and in hurt(), both of which are per-foe-per-tick paths —
 *  an includes() over an array is fine at three entries and a Set costs nothing
 *  to build once at spawn. */
export interface EliteState {
  rank: EliteRank;
  affixes: string[];
  has: Set<string>;
  /** "Vigorous Swift Brute" — precomputed, because the nameplate is rebuilt by
   *  the view on construction and the string never changes after the roll. */
  name: string;
  /** Kindled's tick accumulator. Per-foe rather than per-system: two Kindled
   *  foes standing together should burn you twice, not take turns. */
  auraT?: number;
  /** Splitting: set on the lesser copies so one generation is all there is. */
  spawned?: boolean;
}

/** X1: a ranged foe's shot in flight — advanced by the SIM tick (never
 * wall-clock timers: the game may be paused, sped, or slowed). */
interface Projectile {
  x: number; y: number;
  tx: number; ty: number; // aimed point (where the target was at fire time)
  speed: number; dmg: number;
  life: number;           // seconds of flight left
  ang: number;
  sparkT: number;         // visual: particle-trail accumulator
}

export class HordeSystem {
  foes: Foe[] = [];
  private projectiles: Projectile[] = [];
  private toSpawn = 0;
  private spawnT = 0;
  private _chillAura = false;
  private daySpawnT = 0;

  constructor(private ctx: any) {}

  /** SR1: the current act's multiplier row, read off REAL elapsed time — see
   *  main.ts's elapsedRealSec (a sim-tick count, not state.clock and not
   *  performance.now()), so a Gauntlet __nw.step() loop advances the acts
   *  exactly as many fixed steps as it asks for, deterministically, rather
   *  than freezing on whatever real time happened to elapse during a test
   *  suite's own execution overhead. Falls back to the Swelling-shaped middle
   *  row if that hook isn't wired (a bare HordeSystem built without main.ts's
   *  ctx), which is CFG.sr.actCurve[1] rather than [0] specifically so a
   *  caller that skips the act system entirely still gets elites, since
   *  today's pre-SR1 behaviour assumed they were always live. */
  private actRow() {
    if (!CFG.sr.enabled) return NEUTRAL_ACT_ROW;
    const s = this.ctx.elapsedRealSec?.();
    return s !== undefined ? actRowAt(s) : CFG.sr.actCurve[1];
  }

  onDusk(nightIndex: number) {
    // B2: the player was here when night fell — record it BEFORE the firstNight
    // early-return, so the dawn credit is gated on presence, not on whether a
    // wave happened to spawn. (With firstNight: 1 nothing is quiet today, but
    // raising it must not silently start voiding survived nights.)
    this.ctx.state.nightEntered = true;
    if (nightIndex < CFG.horde.firstNight) return;
    // M3: gold-scaled horde size — the network detects your cache
    const gold = this.ctx.state.player.gold;
    const goldSteps = Math.max(0, Math.floor((gold - CFG.horde.goldThreshold) / CFG.horde.goldThreshold));
    const goldMult = 1 + goldSteps * CFG.horde.goldMultPerThreshold;
    // SR1: a night that falls during the Reckoning thins itself — the boss is
    // the fight, not the garnish standing around it.
    const actCountMul = this.actRow().countMul;
    this.toSpawn = Math.round((
      CFG.horde.baseCount +
      CFG.horde.perNight * (nightIndex - 1) +
      CFG.horde.perTerritory * territoryScore(this.ctx.state)
    ) * goldMult * actCountMul);
    this.spawnT = 0;
    const s = this.ctx.net?.snap;
    this.ctx.toast(`Night ${nightIndex} — ${this.toSpawn} enemies converge`, 'bad');
    this.ctx.log?.push('combat', `Night ${nightIndex} falls — ${this.toSpawn} incoming (gold ${gold} → ${goldMult.toFixed(1)}× horde)`, this.ctx.state.clock);
  }

  /** Sweep the night's survivors off the field. Dawn does this; so does the end
   *  of the run. B2: this used to live inside onDawn(), so `triggerGameOver`
   *  calling it "to clear the field" also handed out a night survived — every
   *  run, at the moment it ended, worth CFG.legacy.weights.nightSurvived. */
  clearField() {
    if (CFG.horde.dawnFlee) {
      for (const f of this.foes) this.ctx.views.removeFoe(f.uid);
      this.foes = [];
    }
    this.toSpawn = 0;
  }

  /** B2: `fought` is false when this dawn ends a night the player never entered
   *  — a run that booted mid-night never saw onDusk, so there is nothing to
   *  credit. The field still clears either way; dawn is dawn. */
  onDawn(fought: boolean) {
    const { state, toast } = this.ctx;
    this.clearField();
    if (!fought) {
      this.ctx.log?.push('combat', 'Dawn breaks on a night that was already underway — no credit', state.clock);
      return;
    }
    state.nightsSurvived++;
    // N4.5/A7: the pact is scored by the nights actually lived under it, so a
    // last-minute swearing of the deep cannot reprice nine quiet nights.
    const cov = state.covenant ?? 'quiet';
    if (!state.nightsAtCovenant) state.nightsAtCovenant = {};
    state.nightsAtCovenant[cov] = (state.nightsAtCovenant[cov] ?? 0) + 1;
    toast(`Dawn breaks. Nights survived: ${state.nightsSurvived}`, 'good');
    this.ctx.log?.push('combat', `Dawn breaks — nights survived: ${state.nightsSurvived}`, state.clock);
  }

  update(dt: number) {
    // C4: 'chill_aura' is read once per tick, not once per foe — activeEffects()
    // allocates a Set each call and the march step runs for every foe alive.
    this._chillAura = activeEffects(this.ctx.state).has('chill_aura');
    if (this.ctx.isNight() && this.toSpawn > 0 && this.foes.length < CFG.horde.maxAlive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        // SR1: rateMul scales the RATE, so it divides the interval — 1.5x
        // rate during the Swelling means spawns land every 2/3 the wait.
        this.spawnT = CFG.horde.spawnIntervalSec / Math.max(0.05, this.actRow().rateMul);
        this.spawn();
      }
    }
    // by day, trickle prey up to its own (small) cap
    if (!this.ctx.isNight() && !this.ctx.state.gameOver) {
      const dayCount = this.foes.reduce((n, f) => n + (f.dayMob ? 1 : 0), 0);
      if (dayCount < CFG.dayspawn.maxAlive) {
        this.daySpawnT -= dt;
        if (this.daySpawnT <= 0) {
          this.daySpawnT = CFG.dayspawn.spawnIntervalSec;
          this.spawnDayMob();
        }
      }
    }
    this.updateTraps(dt);
    for (const f of [...this.foes]) this.updateFoe(f, dt);
    // X1: projectiles fly on the sim clock. They hit the player on contact, or
    // land at their aimed point when flight time runs out (splash vs whatever
    // stands there — player nearby, else a building on the tile).
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const pNow = this.ctx.state.player;
      p.life -= dt;
      p.x += Math.cos(p.ang) * p.speed * dt;
      p.y += Math.sin(p.ang) * p.speed * dt;
      // faint spark trail so the shot is readable and dodgeable
      p.sparkT -= dt;
      if (p.sparkT <= 0) { p.sparkT = 0.06; this.ctx.particles?.spawn?.('spark', p.x, p.y, 1); }

      if (Math.hypot(pNow.x - p.x, pNow.y - p.y) < 18) {
        this.ctx.damagePlayer(p.dmg, 'a hurled bolt');
        this.projectiles.splice(i, 1);
      } else if (p.life <= 0) {
        if (Math.hypot(pNow.x - p.tx, pNow.y - p.ty) < TILE * 1.2) {
          this.ctx.damagePlayer(p.dmg, 'a hurled bolt');
        } else {
          const bt = this.ctx.world.buildingAt(Math.floor(p.tx / TILE), Math.floor(p.ty / TILE));
          if (bt) this.damageBuilding(bt, p.dmg);
        }
        // Review fix: 'hit' isn't a real ParticleKind (only poof/ember/slash/
        // spark/wisp/rift/death/heal/crit exist) — `ctx` being typed `any`
        // let this typo past tsc entirely. PARTICLE_DEFS['hit'] was
        // `undefined`, so this threw on every projectile landing, taking
        // hordes.update() (and the whole render-loop ticker callback that
        // calls it) down with it. 'spark' is the impact effect used
        // elsewhere in this file for the same kind of moment.
        this.ctx.particles?.spawn?.('spark', p.tx, p.ty, 4);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---- A2: elites & champions ---------------------------------------------
  //
  // Three methods, in the order they run: decide, apply, escort. Kept together
  // rather than scattered through spawn()/wake() because the balance guard the
  // plan warned about is only legible if the whole decision is in one place —
  // "no more than one of {Vigorous, Warded}" is enforced in data/elites.ts, and
  // "no more than N elites alive" is enforced here, and a reader needs to be
  // able to find both without grepping.

  /** How many elites (champions included) are on the field right now. */
  eliteCount(): number {
    let n = 0;
    for (const f of this.foes) if (f.elite) n++;
    return n;
  }

  /** Decide whether this spawn is an elite, and what it rolled.
   *
   *  Returns null — before touching Math.random — whenever the answer is no, so
   *  a run with CFG.a2.enabled off consumes the RNG in exactly the pre-A2
   *  sequence. That is not fastidiousness: the Gauntlet seeds worlds and
   *  compares spawn sequences, and a feature flag that shifts the random stream
   *  makes every seeded assertion in the suite disagree with itself depending
   *  on a boolean it never mentions. */
  rollElite(night: number, opts: { day?: boolean; cairn?: boolean } = {}): EliteState | null {
    const A = CFG.a2;
    if (!A.enabled) return null;
    if (opts.day && !A.inDaySpawns) return null;
    if (opts.cairn && !A.inCairns) return null;
    if (this.eliteCount() >= A.maxAlive) return null;

    // SR1: the Gathering and the Reckoning are elite-free by design — the
    // first is the build-up, the second thins the field instead. Checked
    // before Math.random(), same discipline as A.enabled just above: a gate
    // that closes silently must close BEFORE it touches the seeded stream,
    // or a Gauntlet's seed-comparison assertions disagree with themselves
    // over a boolean the test never mentions.
    const act = this.actRow();
    if (!act.elites && !act.champions) return null;

    const champ = act.champions ? championChance(night) * A.rateMul : 0;
    const elite = act.elites ? eliteChance(night) * A.rateMul : 0;
    const r = Math.random();
    // Champion is tested first and the two windows do not overlap: at night 12
    // that is a 10% champion and a further 30% elite, not 10% of a 30%. A
    // nested test would make the champion curve silently depend on the elite
    // one, so tuning either would move both.
    const rank: EliteRank | null = r < champ ? 'champion' : r < champ + elite ? 'elite' : null;
    if (!rank) return null;

    const affixes = rollAffixes(rank, night);
    // A champion that could afford nothing is not a champion. Can only happen
    // if a retune drops the night-1 budget below the cheapest affix, and it
    // would present as a violet nameplate on a foe that plays exactly like its
    // neighbours — the dormant-row failure, wearing a crown.
    if (!affixes.length) return null;
    return { rank, affixes, has: new Set(affixes), name: '' };
  }

  /** Stamp a rolled elite onto a built foe: stats, name, and the log line.
   *
   *  Takes the foe AFTER all the ordinary birth scaling (night growth, the
   *  wire, the echo) has landed, and multiplies on top of it. An elite is a
   *  modifier on the foe the night would have produced anyway — computing it
   *  from `def` would quietly discard four other systems' scaling. */
  applyElite(f: any, e: EliteState) {
    f.elite = e;
    e.name = eliteName(f.epithetName ?? f.def.name, e.affixes);

    if (e.has.has('vigorous')) {
      f.maxHp = Math.round(f.maxHp * AFFIX_POWER.vigorousHpMul);
      f.hp = f.maxHp;
    }
    // Warded and Swift are read where they are spent — hurt() and the march
    // step — rather than baked in here, because both have to compose with
    // things that change every tick (a chill, a tar pit, the Shelled soak).
    // Baking them would be the classic mistake of turning a multiplier into a
    // constant and then wondering why the slow tower stopped mattering.

    // The Chronicle gets the blurbs, the toast gets the name. A toast is read
    // in the half second before the thing reaches you and has room for one
    // fact; the Chronicle is read afterwards, when "why did that hurt so much"
    // is the question, and it is the only place the affix vocabulary is ever
    // spelled out in full. Pillar 7 holds on both: 'the air around it burns',
    // never 'fire aura, 4 dmg/s'.
    const R = ELITE_RANKS[e.rank];
    const told = e.affixes.map((id) => affixDef(id)?.blurb).filter(Boolean).join('; ');
    this.ctx.log?.push('spawn',
      `${R.name}: ${e.name} (${f.hp} hp) — ${told}`, this.ctx.state.clock);
    return f;
  }

  /** A champion's retinue: `minions` copies of the same type, each carrying ONE
   *  of the champion's affixes.
   *
   *  Sharing an affix rather than rolling fresh ones is the whole design. A pack
   *  of individually-rolled elites is noise; a pack that all does the same thing
   *  reads as a THEME — "these are the burning ones" — and a theme is something
   *  the player can form a plan against in the two seconds they have. */
  private spawnRetinue(champion: any, e: EliteState) {
    const { state, world, views } = this.ctx;
    const R = ELITE_RANKS[e.rank];
    if (R.minions <= 0) return;
    const shared = e.affixes[0];
    for (let i = 0; i < R.minions; i++) {
      if (CFG.a2.minionsRespectCap && this.foes.length >= CFG.horde.maxAlive) break;
      let mx = 0, my = 0, placed = false;
      for (let t = 0; t < 8 && !placed; t++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (1.2 + Math.random() * 1.8) * TILE;
        mx = champion.x + Math.cos(ang) * d;
        my = champion.y + Math.sin(ang) * d;
        placed = world.canStand(mx, my, 5);
      }
      if (!placed) continue;
      const hp = Math.max(1, Math.round(champion.maxHp * 0.45));
      const dmg = Math.max(1, Math.round(champion.baseDmg * 0.7));
      const minion: any = {
        uid: state.nextUid++, def: champion.def,
        x: mx, y: my, px: mx, py: my,
        hp, maxHp: hp, dmg, baseDmg: dmg,
        atkT: 0, telegraphT: 0, animT: Math.random() + i * 0.3,
        echoSoak: 0, echoMoveMul: 1, specialSkill: null,
        epithetName: champion.def.name, hitCount: 0, blinked: false,
      };
      // Rank 'elite' so the retinue reads as brass against the champion's
      // violet — a pack where every member wears the leader's colour makes the
      // leader unfindable, which is precisely the target you need to find.
      const me: EliteState = {
        rank: 'elite', affixes: [shared], has: new Set([shared]),
        name: eliteName(champion.def.name, [shared]),
        // Marked as already-spawned so a Splitting retinue cannot split: the
        // champion splits into two, each of ITS minions splitting into two more
        // is sixteen foes out of one kill.
        spawned: true,
      };
      minion.elite = me;
      this.foes.push(minion);
      views.addFoe(minion);
    }
  }

  /** A2 Splitting: one generation of lesser copies, at the corpse.
   *
   *  Called from hurt() BEFORE the loot roll, and deliberately not recursive:
   *  the copies carry `spawned: true`, which is the flag this method checks.
   *  Two generations of two is four foes from one kill and reads as a bug; the
   *  affix wants to be "and now there are two", full stop. */
  private splitFoe(parent: Foe, e: EliteState) {
    const { state, world, views } = this.ctx;
    const P = AFFIX_POWER;
    for (let i = 0; i < P.splitCount; i++) {
      if (this.foes.length >= CFG.horde.maxAlive) break;
      let sx = parent.x, sy = parent.y, placed = false;
      for (let t = 0; t < 6 && !placed; t++) {
        const ang = (i / P.splitCount) * Math.PI * 2 + Math.random();
        const d = (0.6 + Math.random() * 0.9) * TILE;
        sx = parent.x + Math.cos(ang) * d; sy = parent.y + Math.sin(ang) * d;
        placed = world.canStand(sx, sy, 5);
      }
      // Falls back to the corpse's own tile: the parent was standing there a
      // frame ago, so it is walkable by construction, and a Splitting foe that
      // silently fails to split in a corridor is a mechanic that stops working
      // exactly where the player most expects it to.
      if (!placed) { sx = parent.x; sy = parent.y; }
      const hp = Math.max(1, Math.round(parent.maxHp * P.splitHpMul));
      const dmg = Math.max(1, Math.round((parent.baseDmg ?? parent.def.dmg) * P.splitDmgMul));
      const copy: any = {
        uid: state.nextUid++, def: parent.def,
        x: sx, y: sy, px: sx, py: sy,
        hp, maxHp: hp, dmg, baseDmg: dmg,
        atkT: parent.def.atkCooldown, telegraphT: 0, animT: Math.random(),
        echoSoak: 0, echoMoveMul: 1, specialSkill: null,
        epithetName: parent.def.name, hitCount: 0, blinked: false,
        dayMob: parent.dayMob, homeX: parent.homeX, homeY: parent.homeY,
        // Carries the affix so the copies still read as the same thing that
        // just died — and `spawned` so they cannot split again.
        elite: {
          rank: 'elite' as EliteRank, affixes: ['splitting'],
          has: new Set(['splitting']), name: eliteName(parent.def.name, ['splitting']),
          spawned: true,
        },
      };
      this.foes.push(copy);
      views.addFoe(copy);
    }
    this.ctx.log?.push('combat', `${e.name} comes apart`, state.clock);
  }

  /** The base id an elite corpse is guaranteed to hand over. Uses the CURRENT
   *  night rather than the night the foe spawned on, because a foe that
   *  survived to dawn and died the next night is a foe that survived a night —
   *  and the alternative is storing a birth night on every foe in the game to
   *  serve one branch. */
  private eliteReward(f: Foe, e: EliteState): string {
    return rollEliteGear(Math.max(1, this.ctx.nightIndex?.() ?? 1));
  }

  private spawn() {
    const { state, world, views } = this.ctx;
    const n = this.ctx.nightIndex();

    // M3: gold-scaled enemy pool — at high gold, boss-type enemies can appear in night waves
    const gold = state.player.gold;
    const pool = ENEMIES.filter((e) => {
      if (e.fromNight > n) return false; // not unlocked yet
      if (e.dayOnly) return false;       // A8: the Hoarder never joins a siege
      if (e.boss) return gold >= CFG.horde.bossAtGold; // bosses only at high gold
      return true;
    });
    const totalW = pool.reduce((s, e) => s + (e.boss ? e.weight * CFG.horde.bossGoldWeight : e.weight), 0);
    let r = Math.random() * totalW;
    let def = pool[0];
    for (const e of pool) {
      const w = e.boss ? e.weight * CFG.horde.bossGoldWeight : e.weight;
      r -= w;
      if (r <= 0) { def = e; break; }
    }

    const h = hall(state);
    const cx = h ? (h.tx + 0.5) * TILE : state.player.x;
    const cy = h ? (h.ty + 0.5) * TILE : state.player.y;
    let x = cx, y = cy, placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (CFG.horde.spawnRadiusMinTiles + Math.random() * (CFG.horde.spawnRadiusMaxTiles - CFG.horde.spawnRadiusMinTiles)) * TILE * (0.9 + Math.random() * 0.35);
      x = cx + Math.cos(ang) * dist;
      y = cy + Math.sin(ang) * dist;
      placed = world.canStand(x, y, 5) && this.nearestCampfireDist(x, y) > CFG.fire.campfireFearTiles * TILE;
    }
    if (!placed) return; // hostile geography (or firelight); try again next tick

    const hpMul = Math.pow(CFG.horde.hpGrowth, n - 1);
    const dmgMul = Math.pow(CFG.horde.dmgGrowth, n - 1);
    // N1: network enemy scaling (worse connection = tougher enemies)
    // X1: 'Veil Pressure' — JS heap weight leans on foe hp too
    const netScale = (this.ctx.net?.getGameValue?.('enemyScale') ?? 1.0)
      * (this.ctx.net?.getGameValue?.('veilPressure') ?? 1.0);
    // N4.5/A7: the covenant's difficulty consequences ride ON TOP of the
    // existing product, never replacing it — the pact is the difficulty tier.
    const cov = activeCovenant(state.covenant);

    // N2a: echo-derived stats for night-wave mobs (C2)
    const echo = this.ctx.net?.lastEcho;
    const echoFresh = echo && (performance.now() - echo.tsMs < 30000);
    let echoHpMul = 1.0, echoDmgMul = 1.0, echoSoak = 0, epithetName = def.name, specialSkill: string | null = null;
    let echoMoveMul = 1.0;
    if (echoFresh) {
      // hp × (0.9 + ms/400), clamp 0.9–1.6
      echoHpMul = Math.max(0.9, Math.min(1.6, 0.9 + echo!.ms / 400));
      // damage × (0.9 + jitterAtBirth/80), clamp 0.9–1.5
      echoDmgMul = Math.max(0.9, Math.min(1.5, 0.9 + echo!.jitterAtBirth / 80));
      // defense (flat soak): cold ? 2 : 0
      echoSoak = echo!.cold ? 2 : 0;
      // move speed × (1.25 − ms/300), clamp 0.85–1.2
      echoMoveMul = Math.max(0.85, Math.min(1.2, 1.25 - echo!.ms / 300));

      // Special skills (max one per foe)
      const prof = this.ctx.net?.computeRealmProfile?.() ?? { median: echo!.ms, variance: 0 };
      if (prof.variance >= 8000) {
        specialSkill = 'Blinker'; // teleports 2 tiles away the first time hit
      } else if (echo!.cold) {
        specialSkill = 'Shelled'; // +2 extra soak until hit 3 times
        echoSoak += 2;
      }

      // Epithet name: prefix + base name + region suffix
      const prefix = prefixForBirth(echo!.cold, echo!.jitterAtBirth, echo!.ms);
      const suffix = epithetForRegion(echo!.route.region);
      epithetName = [prefix, def.name, suffix].filter(Boolean).join(' ');
    }

    const scaledDmg = Math.round(def.dmg * dmgMul * netScale * echoDmgMul * cov.dmgMul);
    const foe: any = {
      uid: state.nextUid++, def,
      x, y, px: x, py: y,
      hp: Math.round(def.hp * hpMul * netScale * echoHpMul * cov.hpMul),
      maxHp: Math.round(def.hp * hpMul * netScale * echoHpMul * cov.hpMul),
      dmg: scaledDmg, baseDmg: scaledDmg,
      atkT: 0, telegraphT: 0, animT: Math.random(),
    };
    // N2a: attach echo-derived fields
    foe.echoSoak = echoSoak;
    foe.echoMoveMul = echoMoveMul;
    foe.specialSkill = specialSkill;
    foe.epithetName = epithetName;
    foe.hitCount = 0;
    foe.blinked = false;
    // A2: rolled BEFORE the view is created, because FoeView reads `elite` in
    // its constructor to build the nameplate and the aura ring. Stamping the
    // affixes on afterwards would give the first elite of every run a plain
    // sprite until something happened to rebuild it — which is nothing, ever.
    // Bosses are excluded: a domain lord that also rolled Vigorous would be a
    // 1540-hp Nullmaw, and the five biggest fights in the game are hand-tuned
    // for a reason.
    const rolled = def.boss ? null : this.rollElite(n);
    if (rolled) this.applyElite(foe, rolled);
    this.foes.push(foe);
    views.addFoe(foe);
    if (rolled) {
      const R = ELITE_RANKS[rolled.rank];
      this.ctx.toast(`${R.name} — ${rolled.name}`, 'bad');
      this.spawnRetinue(foe, rolled);
    }
    this.toSpawn--;
    // X1: swarm enemies spawn in packs — extra copies in a cluster
    if (def.behavior?.kind === 'swarm' && (def.behavior.swarmSize ?? 1) > 1) {
      const extra = (def.behavior.swarmSize ?? 2) - 1;
      for (let s = 0; s < extra && this.foes.length < CFG.horde.maxAlive; s++) {
        const sx = x + (Math.random() - 0.5) * TILE * 2;
        const sy = y + (Math.random() - 0.5) * TILE * 2;
        if (!world.canStand(sx, sy, 5)) continue;
        const swarmFoe: any = {
          uid: state.nextUid++, def,
          x: sx, y: sy, px: sx, py: sy,
          hp: foe.maxHp, maxHp: foe.maxHp,
          dmg: foe.baseDmg, baseDmg: foe.baseDmg, atkT: 0, telegraphT: 0, animT: Math.random() + s * 0.3,
          echoSoak: 0, echoMoveMul: 1, specialSkill: null, epithetName: def.name, hitCount: 0, blinked: false,
        };
        this.foes.push(swarmFoe);
        views.addFoe(swarmFoe);
      }
    }
    // N2a: Chronicle gets fiction voice, Lens feed gets technical
    if (echoFresh) {
      this.ctx.log?.push('spawn', `A ${epithetName} joins the night wave (${foe.hp} hp)`, state.clock);
    } else {
      this.ctx.log?.push('spawn', `A ${def.name} joins the night wave (${foe.hp} hp)`, state.clock);
    }
  }

  /** A8: open a Cairn, wake what it buried. Returns how many actually stood up.
   *
   *  Three decisions worth stating, because all three are load-bearing:
   *
   *  1. **Current-night stat scaling, not a second table.** A Cairn cracked on
   *     night 6 is a night-6 fight. The payout band is fixed (`cairn`), so the
   *     price has to be what moves, and reusing spawn()'s own hp/dmg growth
   *     means the two can never drift apart the way a parallel table would.
   *
   *  2. **Not day mobs.** A woken pack the player runs away from marches on the
   *     hall like any other foe, which is precisely what makes opening a Cairn
   *     far from home a decision instead of a formality.
   *
   *  3. **No echo/epithet machinery.** What a barrow buried was buried before
   *     this run's wire existed; naming it after a route's latency would be the
   *     Veil leaking in the wrong direction.
   *
   *  Public because gather.ts calls it, and it is the only route into the horde
   *  from outside the day/night cycle. */
  wake(x: number, y: number, count: number, radiusTiles: number): number {
    const { state, world, views } = this.ctx;
    const n = Math.max(1, this.ctx.nightIndex?.() ?? 1);
    // Bosses and the Hoarder are both excluded: a relic-bearing domain lord out
    // of a roadside cairn would trivialise the five biggest fights in the game,
    // and a Hoarder buried under stones would immediately run away from them.
    const pool = ENEMIES.filter((e) => !e.boss && !e.dayOnly && e.fromNight <= n);
    if (!pool.length) return 0;

    const hpMul = Math.pow(CFG.horde.hpGrowth, n - 1);
    const dmgMul = Math.pow(CFG.horde.dmgGrowth, n - 1);
    const netScale = (this.ctx.net?.getGameValue?.('enemyScale') ?? 1.0)
      * (this.ctx.net?.getGameValue?.('veilPressure') ?? 1.0);
    const cov = activeCovenant(state.covenant);

    let woke = 0;
    for (let i = 0; i < count && this.foes.length < CFG.horde.maxAlive; i++) {
      const def = pool[(Math.random() * pool.length) | 0];
      let fx = x, fy = y, placed = false;
      for (let t = 0; t < 8 && !placed; t++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (0.8 + Math.random() * Math.max(0.5, radiusTiles)) * TILE;
        fx = x + Math.cos(ang) * d; fy = y + Math.sin(ang) * d;
        placed = world.canStand(fx, fy, 5);
      }
      if (!placed) continue; // hostile geography — that one stays buried
      const dmg = Math.round(def.dmg * dmgMul * netScale * cov.dmgMul);
      const hp = Math.max(1, Math.round(def.hp * hpMul * netScale * cov.hpMul));
      const foe: any = {
        uid: state.nextUid++, def,
        x: fx, y: fy, px: fx, py: fy,
        hp, maxHp: hp, dmg, baseDmg: dmg,
        atkT: 0, telegraphT: 0, animT: Math.random(),
        echoSoak: 0, echoMoveMul: 1, specialSkill: null, epithetName: def.name,
        hitCount: 0, blinked: false,
      };
      // A2: a barrow can hold something that was buried with honours. Gated on
      // CFG.a2.inCairns rather than sharing the night-wave path, because a
      // Cairn is a fight the player chose to start and a night wave is one that
      // arrives whether they are ready or not — those two deserve separate
      // dials even when they currently hold the same value.
      const rolled = this.rollElite(n, { cairn: true });
      if (rolled) this.applyElite(foe, rolled);
      this.foes.push(foe);
      views.addFoe(foe);
      if (rolled) {
        this.ctx.toast(`${ELITE_RANKS[rolled.rank].name} — ${rolled.name}`, 'bad');
        this.spawnRetinue(foe, rolled);
      }
      woke++;
    }
    return woke;
  }

  /** Day prey: spawns around the PLAYER at base (night-1) stats — loot on legs. */
  private spawnDayMob() {
    const { state, world, views } = this.ctx;
    // A8: with the flag off the Hoarder leaves the day pool entirely, which is
    // the same revert the Cairn and Wardstone rows get in worldgen. Keyed on
    // the BEHAVIOUR rather than on the id, because "a thing that runs away"
    // is what the flag is actually turning off.
    const pool = ENEMIES.filter((e) => e.daytime && (CFG.a8.enabled || e.behavior?.kind !== 'flee'));
    if (!pool.length) return;
    const totalW = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW;
    let def = pool[0];
    for (const e of pool) { r -= e.weight; if (r <= 0) { def = e; break; } }

    const { minRadiusTiles: mn, maxRadiusTiles: mx } = CFG.dayspawn;
    let x = 0, y = 0, placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (mn + Math.random() * (mx - mn)) * TILE;
      x = state.player.x + Math.cos(ang) * dist;
      y = state.player.y + Math.sin(ang) * dist;
      placed = world.canStand(x, y, 5);
    }
    if (!placed) return; // hostile geography; try again next tick

    // N1: network enemy scaling applied to day mobs too
    const netScale = this.ctx.net?.getGameValue?.('enemyScale') ?? 1.0;
    const dayDmg = Math.round(def.dmg * netScale);
    const foe: Foe = {
      uid: state.nextUid++, def,
      x, y, px: x, py: y,
      hp: Math.round(def.hp * netScale), maxHp: Math.round(def.hp * netScale),
      dmg: dayDmg, baseDmg: dayDmg,
      atkT: 0, telegraphT: 0, animT: Math.random(),
      dayMob: true, homeX: x, homeY: y,
    };
    // A2: off by default (CFG.a2.inDaySpawns) and wired anyway, because a flag
    // whose 'on' branch does not exist is not a flag, it is a comment. The
    // Hoarder is excluded whatever the flag says — an elite whose entire
    // behaviour is running away would just be a faster loss.
    const rolled = def.behavior?.kind === 'flee'
      ? null : this.rollElite(this.ctx.nightIndex?.() ?? 1, { day: true });
    if (rolled) this.applyElite(foe as any, rolled);
    this.foes.push(foe);
    views.addFoe(foe);
    if (rolled) this.ctx.toast(`${ELITE_RANKS[rolled.rank].name} — ${rolled.name}`, 'bad');
    const s = this.ctx.net?.snap;
    this.ctx.log?.push('spawn', `A ${def.name} prowls into view (${foe.hp} hp)`, state.clock);
  }

  private updateFoe(f: Foe, dt: number) {
    const { state, world } = this.ctx;
    f.px = f.x; f.py = f.y;
    f.atkT -= dt;
    f.animT += dt;

    // X1: poison DoT (Venom/Blight/Plague spires) — whole points, accumulated
    const efp = f as any;
    if (efp._poisonUntil > state.clock && efp._poisonDps > 0) {
      efp._poisonAcc = (efp._poisonAcc ?? 0) + efp._poisonDps * dt;
      const whole = Math.floor(efp._poisonAcc);
      if (whole > 0) {
        efp._poisonAcc -= whole;
        this.hurt(f, whole, false); // tower rule: no xp/vitals
        if (f.hp <= 0) return;
      }
    }

    const p = state.player;

    // A2 Kindled: the ring that burns. Ticked here — above the telegraph return
    // — so a Kindled foe frozen mid-swing still burns you, which is the point:
    // the affix is about PRESENCE, and a fire that pauses while its owner winds
    // up would teach the player to stand in it during exactly the wrong second.
    if (f.elite?.has.has('kindled') && !state.gameOver) {
      const e = f.elite;
      e.auraT = (e.auraT ?? 0) + dt;
      if (e.auraT >= AFFIX_POWER.kindledSec) {
        e.auraT = 0;
        const r = AFFIX_POWER.kindledTiles * TILE;
        if (Math.hypot(p.x - f.x, (p.y - 10) - f.y) < r) {
          // Routed through damagePlayer rather than subtracting hp, so armour,
          // dodge, thorns, the Resolve multiplier and the soul-gear xp all fire
          // exactly as they do for a bite. An affix that bypassed the damage
          // pipeline would be an affix your gear cannot answer.
          this.ctx.damagePlayer(AFFIX_POWER.kindledDmg, `${f.def.name}'s burning air`, f);
        }
        this.ctx.particles?.spawn?.('ember', f.x, f.y - 4, 2);
      }
    }

    // committed to an already-telegraphed hit — frozen mid-swing regardless of
    // what the player does next; only the final distance check decides hit/whiff
    if (f.telegraphT > 0) {
      f.telegraphT -= dt;
      if (f.telegraphT <= 0) {
        const dpNow = Math.hypot(p.x - f.x, (p.y - 10) - f.y);
        // N4.6 Mercy: slack is the ENEMY's forgiveness — the distance at which
        // a committed swing still connects after you moved. A machine dropping
        // long frames is one where your dodge input landed inside a stall you
        // could not see coming, so measured jank shrinks this and your dodges
        // land. 1.0 on a smooth machine, and 1.0 wherever LoAF is unsupported.
        const slack = CFG.combat.telegraphSlackPx * (this.ctx.net?.getGameValue?.('mercy') ?? 1);
        if (dpNow < 24 + slack) this.ctx.damagePlayer(f.dmg, f.def.name, f);
        else this.ctx.log?.push('combat', `${f.def.name} lunges and misses`, state.clock);
      }
      return;
    }

      // day prey left far behind fades back into the network
    if (f.dayMob && Math.hypot(p.x - f.x, p.y - f.y) > CFG.dayspawn.despawnTiles * TILE) {
      this.foes = this.foes.filter((x) => x.uid !== f.uid);
      this.ctx.views.removeFoe(f.uid);
      return;
    }

    const beh = f.def.behavior;
    const h = hall(state);
    const dp = Math.hypot(p.x - f.x, (p.y - 10) - f.y);

    // ---- A8 FLEE: the only behaviour whose win condition is your loss -------
    //
    // It never targets anything, so it has to come out of the aggro test rather
    // than be handled after it — `targetPlayer` staying true would have the
    // Hoarder turn and bite the moment you got inside 170 px.
    const isFlee = beh?.kind === 'flee';
    const spooked = isFlee && dp < (beh!.spookTiles ?? 11) * TILE;
    if (isFlee && dp > (beh!.escapeTiles ?? 21) * TILE) {
      // Gone, with the hoard. `escapeTiles` is deliberately shorter than
      // dayspawn.despawnTiles, so this branch — and its message — always wins
      // the race against the silent day-mob fade above. Losing a Hoarder has to
      // be an event; a thing that merely stops existing teaches nothing.
      this.foes = this.foes.filter((x) => x.uid !== f.uid);
      this.ctx.views.removeFoe(f.uid);
      this.ctx.toast(`${f.def.name} slips away with its hoard`, 'bad');
      this.ctx.log?.push('combat', `${f.def.name} escaped — whatever it carried went with it`, state.clock);
      return;
    }

    // day mobs are prey, not siege: aggro the player up close, otherwise wander home
    const targetPlayer = !isFlee && (dp < CFG.horde.aggroRangePx || (!h && !f.dayMob));
    let tx: number, ty: number;
    if (targetPlayer) { tx = p.x; ty = p.y - 10; }
    else if (spooked) {
      // Straight away from the player, six tiles out. No pathfinding — which is
      // exactly why trees, water and cliffs are the counterplay: the Hoarder
      // runs into terrain as blindly as everything else in this file does.
      const away = Math.atan2(f.y - (p.y - 10), f.x - p.x);
      tx = f.x + Math.cos(away) * TILE * 6;
      ty = f.y + Math.sin(away) * TILE * 6;
    }
    else if (f.dayMob) {
      tx = f.homeX! + Math.cos(f.animT * 0.35 + f.uid) * TILE * 2.5;
      ty = f.homeY! + Math.sin(f.animT * 0.28 + f.uid) * TILE * 2.5;
    } else { tx = (h!.tx + 0.5) * TILE; ty = (h!.ty + 0.9) * TILE; }
    const dist = Math.hypot(tx - f.x, ty - f.y) || 1;

    // ---- X1: Behavior-driven AI -------------------------------------------

    // RANGED: fire projectiles from preferred range, kite away if too close
    if (beh?.kind === 'ranged' && targetPlayer) {
      const prefPx = (beh.preferredRangeTiles ?? 4) * TILE;
      const projSpeed = beh.projectileSpeed ?? 180;
      if (dp < prefPx * 1.1 && f.atkT <= 0 && this.hasLineOfSight(f.x, f.y, tx, ty)) {
        f.atkT = f.def.atkCooldown;
        // fire a projectile toward the player
        this.spawnProjectile(f.x, f.y, tx, ty, projSpeed, f.dmg);
        this.ctx.log?.push('combat', `${f.def.name} fires at you`, state.clock);
      }
      // kite: move away if too close
      if (dp < prefPx * 0.6) {
        const away = Math.atan2(f.y - ty, f.x - tx);
        tx = f.x + Math.cos(away) * TILE * 5;
        ty = f.y + Math.sin(away) * TILE * 5;
      }
    }

    // SIEGE: target buildings preferentially, bonus structure damage
    if (beh?.kind === 'siege') {
      const nearestWall = this.nearestWallInRange(f.x, f.y, TILE * 8);
      if (nearestWall) {
        tx = (nearestWall.tx + 0.5) * TILE; ty = (nearestWall.ty + 0.5) * TILE;
        const wdist = Math.hypot(tx - f.x, ty - f.y);
        if (wdist < 48 && f.atkT <= 0) {
          f.atkT = f.def.atkCooldown;
          this.damageBuilding(nearestWall, Math.round(f.dmg * (beh.structureDmgMul ?? 2) * anchored(f)), f);
          return;
        }
      }
    }

    // EXPLODER: detonate on reaching melee range (suicide — no loot)
    if (beh?.kind === 'exploder' && targetPlayer && dp < 36 && f.atkT <= 0) {
      this.detonateFoe(f, beh.explodeRadiusTiles ?? 2, beh.explodeDmg ?? f.dmg * 2, true);
      return;
    }

    // BUFFER / HEALER / SUMMONER: stay behind the front line
    if (beh && (beh.kind === 'buffer' || beh.kind === 'healer' || beh.kind === 'summoner')) {
      // Keep distance from player — hover behind other foes
      const keepDist = TILE * 5;
      if (dp < keepDist) {
        const away = Math.atan2(f.y - ty, f.x - tx);
        tx = f.x + Math.cos(away) * TILE * 3;
        ty = f.y + Math.sin(away) * TILE * 3;
      }
      // BUFFER: pulse buff aura to nearby allies
      if (beh.kind === 'buffer' && f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.pulseBuff(f, beh.buffRadiusTiles ?? 4, beh.buffDmgMul ?? 1.3, beh.buffSpeedMul ?? 1.15);
      }
      // HEALER: pulse heal to nearby damaged allies
      if (beh.kind === 'healer' && f.atkT <= 0) {
        f.atkT = beh.healCooldownSec ?? 4;
        this.pulseHeal(f, beh.healRadiusTiles ?? 5, beh.healAmount ?? 10);
      }
      // SUMMONER: periodically spawn minions
      if (beh.kind === 'summoner' && f.atkT <= 0) {
        f.atkT = beh.summonCooldownSec ?? 12;
        this.summonMinions(f, beh.summonId ?? 'gnawer', beh.summonCount ?? 2, beh.summonMax ?? 6);
      }
    }

    // in reach of the player → wind up a telegraphed bite (see block above).
    // Only ranged foes (they kite instead) and exploders (contact = detonate)
    // skip this — everything else cornered by the player still fights back.
    if (targetPlayer && dp < 24 && beh?.kind !== 'ranged' && beh?.kind !== 'exploder') {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        f.telegraphT = f.def.telegraphSec;
        Sound.play('telegraph');
        this.ctx.log?.push('combat', `${f.def.name} bites at you`, state.clock);
      }
      return;
    }
    // in reach of the hall → chew the hall (day mobs never siege)
    if (!targetPlayer && !f.dayMob && dist < 42) {
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(h!, f.dmg * (beh?.structureDmgMul ?? 1) * anchored(f), f);
      }
      return;
    }

    // march (day prey ambles while wandering, runs when it has you). Terrain
    // under the foe's feet scales its speed too (mud bogs the horde down), and
    // firelight nearby makes it hesitate (no pathfinding — just a speed penalty).
    const ux = (tx - f.x) / dist, uy = (ty - f.y) / dist;
    const terrain = world.speedAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE));
    const fear = this.nearestCampfireDist(f.x, f.y) < CFG.fire.campfireFearTiles * TILE ? CFG.fire.campfireFearSpeedMult : 1;
    // C1: Rime Nova chill — the echo system stamps chillUntil/chillMult on struck foes
    const ef2 = f as any;
    const chill = ef2.chillUntil > state.clock ? (ef2.chillMult ?? 1) : 1;
    // C4: 'chill_aura' — the Rimewraith relic and the 'of the Rime' suffix.
    // Registered in C4, read by nothing until now, despite its own handler
    // comment claiming this system already checked it. Proximity rather than a
    // stamp: the cold radiates from YOU, so it lifts the moment a foe backs off,
    // and it needs no per-foe bookkeeping to expire.
    const aura = this._chillAura
      && Math.hypot(f.x - state.player.x, f.y - state.player.y) < CFG.itemEffects.chillAuraTiles * TILE
      ? CFG.itemEffects.chillAuraMult : 1;
    // C5: tower slow debuff (Frostspire etc.) — 40% speed reduction
    const towerSlow = ef2._slowedUntil > state.clock ? 0.6 : 1;
    // X1: buff aura — allies near a buffer get +speed and +dmg. Restore to
    // baseDmg on expiry, NOT def.dmg — def.dmg would silently wipe the
    // night/network/echo birth scaling off every foe.
    const buffActive = ef2._buffUntil > state.clock;
    const buffSpeedMul = buffActive ? (ef2._buffSpeedMul ?? 1) : 1;
    const baseD = f.baseDmg ?? f.def.dmg;
    f.dmg = buffActive ? Math.round(baseD * (ef2._buffDmgMul ?? 1)) : baseD;
    // C5/X1: stunned foes (Earthshaker) stand frozen
    const stunned = ef2._stunnedUntil > state.clock;
    // X1: tar pits bog foes down
    const tarSlow = ef2._tarUntil > state.clock ? (ef2._tarMul ?? 0.3) : 1;
    // N4.1: Fray — packet loss and retransmission on the real wire make the
    // horde press harder. 1.0 when the deep wire is silent, so a filtered
    // network plays a balanced game rather than an accidentally easy one.
    const fray = this.ctx.net?.getGameValue?.('hordeAggression') ?? 1;
    // N4.3: a Surge is the STEP, where fray above is the LEVEL. A link that has
    // always lost 2% plays a permanently harder game through the mapping row; a
    // link that suddenly starts losing 2% gets a named event on top of it. The
    // two are deliberately separate — steady-state hostility and a shock are not
    // the same experience.
    const surge = this.ctx.omens?.mul?.('hordeAggression') ?? 1;
    // A8: a spooked Hoarder runs at fleeSpeedMul instead of the day-mob amble.
    // Everything else in this product still applies to it — a chill, a tower
    // slow or a tar pit lands on the Hoarder exactly as it lands on a Brute,
    // which is the whole counterplay to a foe that is faster than you.
    //
    // 2026-08-22: and it now tires. See the Hoarder's row in data/enemies.ts
    // for why a 2 px/s margin made the chase undecidable rather than close.
    // The decay multiplies into `pace` rather than replacing it, so every slow
    // in the product above still stacks on top of an exhausted Hoarder exactly
    // as it stacked on a fresh one.
    let flee = beh?.fleeSpeedMul ?? 1.5;
    if (isFlee) {
      const anyF = f as any;
      const stam = beh!.staminaSec ?? 8;
      const fade = Math.max(0.001, beh!.tiredFadeSec ?? 2);
      // Winds up while running, unwinds at half rate while it thinks it is
      // safe. Clamped at both ends so a Hoarder chased across the whole map
      // cannot bank an arbitrarily long recovery debt.
      anyF._sprintT = Math.max(0, Math.min(stam + fade,
        (anyF._sprintT ?? 0) + (spooked ? dt : -dt * 0.5)));
      const over = anyF._sprintT - stam;
      if (over > 0) {
        flee += ((beh!.tiredSpeedMul ?? 0.95) - flee) * Math.min(1, over / fade);
        // Said once per exhaustion, because the moment it blows is the only
        // moment the mechanic teaches anything: a player who does not know it
        // tires has no reason to still be chasing when it does.
        if (!anyF._tiredSaid) {
          anyF._tiredSaid = true;
          this.ctx.toast(`${f.def.name} is tiring`, 'good');
        }
      } else if (anyF._sprintT <= 0) {
        anyF._tiredSaid = false;
      }
    }
    // A2 Swift: into the same product as every other speed modifier, never
    // replacing it. That is the difference between "Swift foes are faster" and
    // "Swift foes ignore your slow tower", and only the first one is a design.
    const swift = f.elite?.has.has('swift') ? AFFIX_POWER.swiftSpeedMul : 1;
    const pace = spooked ? flee : (f.dayMob && !targetPlayer ? 0.4 : 1);
    let step = f.def.speed * dt * pace * terrain * fear * chill * aura * towerSlow * tarSlow * fray * surge * swift;
    step *= buffSpeedMul;
    if (stunned) step = 0;
    let blocked: Building | null = null;
    const nx = f.x + ux * step, ny = f.y + uy * step;
    if (world.canStand(nx, f.y, 5)) f.x = nx;
    else blocked = this.obstacle(f, ux, 0) ?? blocked;
    if (world.canStand(f.x, ny, 5)) f.y = ny;
    else blocked = this.obstacle(f, 0, uy) ?? blocked;

    if (blocked && !f.dayMob) {
      // something the racket built is in the way — eat it
      if (f.atkT <= 0) {
        f.atkT = f.def.atkCooldown;
        this.damageBuilding(blocked, f.dmg, f);
      }
    } else if (f.x === f.px && f.y === f.py) {
      // stuck on terrain — sidestep randomly to slip around trees/rocks
      const j = (Math.random() - 0.5) * 2;
      const sx = f.x - uy * j * step * 2, sy = f.y + ux * j * step * 2;
      if (world.canStand(sx, sy, 5)) { f.x = sx; f.y = sy; }
    }
  }

  private obstacle(f: Foe, dx: number, dy: number): Building | null {
    const tx = Math.floor((f.x + (dx > 0 ? 10 : dx < 0 ? -10 : 0)) / TILE);
    const ty = Math.floor((f.y + (dy > 0 ? 4 : dy < 0 ? -12 : -4)) / TILE);
    return this.ctx.world.buildingAt(tx, ty);
  }

  private damageBuilding(b: Building, dmg: number, attacker?: Foe) {
    const { state, world, views, toast } = this.ctx;
    b.hp -= Math.round(dmg * (CFG.horde.foeDmgToBuildings ?? 1));
    // X1: spiked buildings (Iron Bulwark) bleed their attacker
    const bdef = BUILDINGS.find((d) => d.id === b.type);
    if (attacker && bdef?.thorns && attacker.hp > 0) {
      this.hurt(attacker, bdef.thorns, false);
    }
    if (b.hp > 0) return;
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    const wasAnchor = b.type === 'hall' || b.type === 'waystone';
    state.buildings = state.buildings.filter((x: Building) => x.uid !== b.uid);
    world.reindexBuildings();
    views.removeBuilding(b.uid);
    this.ctx.fire?.onBuildingRemoved(b);
    if (b.type === 'wall') views.refreshWallsAround(b.tx, b.ty);
    toast(`${def.name} destroyed!`, 'bad');
    this.ctx.log?.push('build', `${def.name} destroyed at (${b.tx},${b.ty})`, state.clock);
    if (b.type === 'hall') this.ctx.onHallDestroyed();

    // C2: waystone/hall destruction triggers disconnect decay cascade
    if (wasAnchor) {
      const disco = world.findDisconnected([b]);
      if (disco.length > 0) {
        this.ctx.build?.markDisconnected?.(disco);
        toast(`${disco.length} building(s) cut off — decaying!`, 'bad');
        this.ctx.log?.push('build',
          `${disco.length} buildings disconnected by ${def.name} destruction — decaying`,
          state.clock);
      }
    }
  }

  /** X1: traps fire on foes in radius. Spike/Flame deal damage on a cooldown
   *  (tower rule: no xp/vitals from trap kills); Tar stamps a slow debuff. */
  private updateTraps(dt: number) {
    const { state } = this.ctx;
    if (!this.foes.length) return;
    for (const b of state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.trap) continue;
      const eb = b as any;
      eb._trapT = (eb._trapT ?? 0) - dt;
      if (eb._trapT > 0) continue;
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      const r = def.trap.radiusTiles * TILE + 8;
      let fired = false;
      for (const f of [...this.foes]) {
        if (Math.hypot(f.x - bx, f.y - by) > r) continue;
        fired = true;
        if (def.trap.slowMul != null) {
          const ef = f as any;
          ef._tarUntil = state.clock + 2.0;
          ef._tarMul = def.trap.slowMul;
        }
        if (def.trap.damage > 0) this.hurt(f, def.trap.damage, false);
      }
      if (fired) {
        eb._trapT = def.trap.cooldownSec;
        if (def.trap.damage > 0) {
          // Review fix: same 'hit' → 'spark' typo as the projectile-impact
          // site above (PARTICLE_DEFS has no 'hit' entry — this threw on
          // every damaging trap spring).
          this.ctx.particles?.spawn?.('spark', bx, by, 6);
          Sound.play('hit');
          this.ctx.log?.push('combat', `${def.name} springs!`, state.clock);
        }
        // Flame Vent lights the real fire CA
        if (b.type === 'trap_flame') this.ctx.worldCore?.ignite?.(b.tx, b.ty);
      }
    }
  }

  // ---- X1: Behavior helpers ------------------------------------------------

  /** Simple Bresenham-ish line-of-sight check — no opaque tiles between a and b. */
  private hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (TILE / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((ax + (bx - ax) * t) / TILE);
      const ty = Math.floor((ay + (by - ay) * t) / TILE);
      if (!this.ctx.world.canStand(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 5)) return false;
    }
    return true;
  }

  /** Fire a projectile from (fx,fy) toward (tx,ty). Resolved by update(). */
  private spawnProjectile(fx: number, fy: number, tx: number, ty: number, speed: number, dmg: number) {
    const ang = Math.atan2(ty - fy, tx - fx);
    const dist = Math.hypot(tx - fx, ty - fy);
    this.projectiles.push({ x: fx, y: fy, tx, ty, speed, dmg, life: dist / speed, ang, sparkT: 0 });
  }

  /** Exploder detonates — AoE damage to player and nearby buildings.
   *  `remove` only when the foe suicides (contact detonation); a KILLED
   *  exploder detonates too but continues through hurt()'s normal death path
   *  so it still pays out loot/xp/gold like any other kill. */
  private detonateFoe(f: Foe, radiusTiles: number, dmg: number, remove: boolean) {
    const { state } = this.ctx;
    const radiusPx = radiusTiles * TILE;
    if (Math.hypot(state.player.x - f.x, state.player.y - f.y) < radiusPx) {
      this.ctx.damagePlayer(dmg, `${f.def.name} explosion`);
    }
    for (const b of [...state.buildings]) {
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      if (Math.hypot(bx - f.x, by - f.y) < radiusPx) {
        this.damageBuilding(b, Math.round(dmg * 0.6));
      }
    }
    if (remove) {
      this.foes = this.foes.filter((x) => x.uid !== f.uid);
      this.ctx.views.removeFoe(f.uid);
    }
    this.ctx.particles?.spawn?.('death', f.x, f.y, 16);
    Sound.play('hit');
    this.ctx.log?.push('combat', `${f.def.name} detonates!`, state.clock);
  }

  /** Buffer pulses a buff aura — nearby allies get +dmg and +speed for a duration. */
  private pulseBuff(f: Foe, radiusTiles: number, dmgMul: number, speedMul: number) {
    const radiusPx = radiusTiles * TILE;
    const dur = 5; // seconds
    for (const ally of this.foes) {
      if (ally.uid === f.uid) continue;
      if (Math.hypot(ally.x - f.x, ally.y - f.y) > radiusPx) continue;
      const ea = ally as any;
      ea._buffUntil = this.ctx.state.clock + dur;
      ea._buffDmgMul = dmgMul;
      ea._buffSpeedMul = speedMul;
    }
    this.ctx.particles?.spawn?.('spark', f.x, f.y, 6);
  }

  /** Healer pulses — nearby damaged allies regain HP. */
  private pulseHeal(f: Foe, radiusTiles: number, amount: number) {
    const radiusPx = radiusTiles * TILE;
    let healed = 0;
    for (const ally of this.foes) {
      if (ally.uid === f.uid) continue;
      if (ally.hp >= ally.maxHp) continue;
      if (Math.hypot(ally.x - f.x, ally.y - f.y) > radiusPx) continue;
      const before = ally.hp;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      healed += ally.hp - before;
    }
    if (healed > 0) {
      this.ctx.particles?.spawn?.('spark', f.x, f.y, 4);
    }
  }

  /** Summoner spawns minions nearby. */
  private summonMinions(f: Foe, summonId: string, count: number, maxAlive: number) {
    const { state, world, views } = this.ctx;
    // Count existing summons by this summoner
    const existingSpawns = this.foes.filter((x) => (x as any)._summonedBy === f.uid).length;
    if (existingSpawns >= maxAlive) return;
    const toSpawn = Math.min(count, maxAlive - existingSpawns);
    const def = ENEMIES.find((e) => e.id === summonId);
    if (!def) return;
    for (let i = 0; i < toSpawn; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * (1.5 + Math.random());
      const sx = f.x + Math.cos(ang) * dist;
      const sy = f.y + Math.sin(ang) * dist;
      if (!world.canStand(sx, sy, 5)) continue;
      // minions inherit the summoner's birth scaling (night/net/echo),
      // read off its hp ratio — a night-20 broodmother births night-20 gnawers
      const parentMul = f.def.hp > 0 ? f.maxHp / f.def.hp : 1;
      const mini: any = {
        uid: state.nextUid++, def,
        x: sx, y: sy, px: sx, py: sy,
        hp: Math.round(def.hp * parentMul), maxHp: Math.round(def.hp * parentMul),
        dmg: Math.round(def.dmg * parentMul), baseDmg: Math.round(def.dmg * parentMul),
        atkT: 0, telegraphT: 0, animT: Math.random(),
        _summonedBy: f.uid,
      };
      this.foes.push(mini);
      views.addFoe(mini);
    }
    this.ctx.particles?.spawn?.('spark', f.x, f.y, 5);
  }

  /** Find the nearest wall or building within range (for siege enemies). */
  private nearestWallInRange(fx: number, fy: number, rangePx: number): Building | null {
    let best: Building | null = null;
    let bestDist = rangePx;
    for (const b of this.ctx.state.buildings) {
      const bx = (b.tx + 0.5) * TILE, by = (b.ty + 0.5) * TILE;
      const d = Math.hypot(bx - fx, by - fy);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    return best;
  }

  // ---- End X1 behavior helpers ---------------------------------------------

  /** Distance (px) to the nearest campfire, or Infinity if none stand. Used for the spawn-avoid
   * radius and the march-speed hesitation penalty — no pathfinding, just proximity. */
  nearestCampfireDist(x: number, y: number): number {
    const { state } = this.ctx;
    let best = Infinity;
    for (const b of state.buildings) {
      if (b.type !== 'campfire') continue;
      best = Math.min(best, Math.hypot((b.tx + 0.5) * TILE - x, (b.ty + 0.5) * TILE - y));
    }
    return best;
  }

  /** M3: Scatter Cache — spend gold to reduce incoming horde size and pacify bosses.
   *  The network's attention is proportional to your wealth; burning some of it
   *  makes you a less interesting target. Costs scale with current gold. */
  scatterCache(): boolean {
    const { state, toast } = this.ctx;
    const cost = Math.max(60, Math.floor(state.player.gold * 0.18));
    if (state.player.gold < cost) {
      toast(`Need ${cost} gold to scatter your cache (have ${state.player.gold})`, 'bad');
      return false;
    }
    state.player.gold -= cost;
    // reduce incoming horde size for current night
    const reduced = Math.floor(this.toSpawn * 0.45);
    this.toSpawn = Math.max(0, this.toSpawn - reduced);
    // also reduce territory score temporarily for boss aggression calculations
    const s = this.ctx.net?.snap;
    toast(`Cache scattered! −${cost} gold, ${reduced} fewer enemies incoming`, 'good');
    this.ctx.log?.push('economy', `Scattered hoard: −${cost} gold, horde reduced by ${reduced} (${this.toSpawn} remaining)`, state.clock);
    return true;
  }
  hurt(f: Foe, dmg: number, awardXp = true, feedsVitals?: boolean) {
    // feedsVitals defaults to awardXp (backward compat: swings feed both,
    // towers feed neither). Echoes pass awardXp=false, feedsVitals=true.
    const feedVitals = feedsVitals ?? awardXp;
    // A2 Warded: a flat bite off every hit, and it never depletes.
    //
    // Applied BEFORE the Shelled soak on purpose. Shelled is a shield with a
    // budget, so letting Warded eat first means the shield lasts the same
    // number of HITS either way — which is what "a shell that cracks after
    // three" promises. The other order would make a Warded Shelled foe's shell
    // effectively permanent against a low-damage weapon, and nothing on screen
    // would explain why.
    //
    // The floor is 1, matching damagePlayer()'s: an attack that connects always
    // does something. Warded is meant to make chip damage bad, not to make a
    // Flint Axe literally incapable of killing.
    if (f.elite?.has.has('warded') && dmg > 0) {
      dmg = Math.max(1, dmg - AFFIX_POWER.wardedSoak);
    }
    // N2a: Shelled soak — extra soak until hit 3 times
    const ef = f as any;
    if (ef.echoSoak > 0) {
      const soaked = Math.min(dmg, ef.echoSoak);
      dmg -= soaked;
      ef.echoSoak -= soaked;
      ef.hitCount = (ef.hitCount ?? 0) + 1;
      if (ef.echoSoak <= 0 && ef.specialSkill === 'Shelled') {
        this.ctx.log?.push('combat', `${ef.epithetName ?? f.def.name}'s shell cracks`, this.ctx.state.clock);
      }
    }
    // N2a: Blinker — teleport 2 tiles away the first time hit
    if (ef.specialSkill === 'Blinker' && !ef.blinked && dmg > 0) {
      ef.blinked = true;
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * 2;
      const nx = f.x + Math.cos(ang) * dist;
      const ny = f.y + Math.sin(ang) * dist;
      if (this.ctx.world.canStand(nx, ny, 5)) { f.x = nx; f.y = ny; }
      this.ctx.log?.push('combat', `${ef.epithetName ?? f.def.name} blinks away!`, this.ctx.state.clock);
    }
    f.hp -= dmg;
    if (f.hp > 0) return;
    // X1: exploders blow up when killed too — AoE first, then the NORMAL death
    // path below still runs, so the kill pays out loot/xp/gold like any other
    if (f.def.behavior?.kind === 'exploder' && f.def.behavior.explodeOnDeath) {
      this.detonateFoe(f, f.def.behavior.explodeRadiusTiles ?? 2, f.def.behavior.explodeDmg ?? f.def.dmg * 2, false);
    }
    // X1: Plague Spire — a poisoned foe's death passes the rot to its packmates
    if (ef._poisonSpread && ef._poisonUntil > this.ctx.state.clock) {
      for (const g of this.foes) {
        if (g.uid === f.uid || Math.hypot(g.x - f.x, g.y - f.y) > 2 * TILE) continue;
        const eg = g as any;
        eg._poisonDps = ef._poisonDps;
        eg._poisonUntil = this.ctx.state.clock + 3;
        // no _poisonSpread on the secondary — one hop, not a chain reaction
      }
    }
    const { state, views, toast } = this.ctx;
    this.foes = this.foes.filter((x) => x.uid !== f.uid);
    views.removeFoe(f.uid);
    Sound.play('enemyDie');

    // S1: only player-swing & echo kills feed vitals — tower kills do NOT
    if (feedVitals) {
      this.ctx.vitals?.onKill?.(!!f.def.boss);
      // A5: Hollow Song stacks on top of the S1 resolve-per-kill
      this.ctx.weaves?.onKill?.();
    }
    // C4: 'move_burst_on_kill' — the Tideculler relic and the 'of the Tide'
    // suffix. Armed on any kill that feeds vitals (so a tower's kill does not
    // pay it, matching every other on-kill reward), read by main's movement
    // product through moveBurstMul().
    if (feedVitals && activeEffects(state).has('move_burst_on_kill')) {
      armMoveBurst(state);
      this.ctx.particles?.spawn?.('wisp', state.player.x, state.player.y - 8, 3);
    }
    // W6: track kills for scoreboard
    this.ctx.scoreboard?.onKill?.(!!f.def.boss, f.elite?.rank ?? null);

    // A2: the elite layer's payouts. Read once here so gold, xp, the loot band
    // and the thread roll all agree about what died — four separate lookups of
    // `f.elite` is four chances for one of them to be forgotten by the next
    // person to touch this function, which is the shape of every dormant row
    // this project has had to dig back out.
    const el = f.elite;
    const rank = el ? ELITE_RANKS[el.rank] : null;

    // A2 Splitting: it comes apart. Before the loot roll, so the copies are on
    // the field while the coins are still bouncing — the whole beat of the
    // affix is "you killed it and the fight got bigger", and it lands flat if
    // the copies appear a second later.
    if (el?.has.has('splitting') && !el.spawned) this.splitFoe(f, el);

    const [gMin, gMax] = f.def.gold;
    let goldWon = gMin + Math.floor(Math.random() * (gMax - gMin + 1));
    if (rank) goldWon = Math.round(goldWon * rank.goldMul);
    // X1: Miser's Charm — player kills pay out more gold
    if (awardXp && activeEffects(state).has('gold_find')) goldWon = Math.round(goldWon * 1.25);
    // B5 Q2: awardGold decides — from CFG.drops.goldDrops — whether this is a
    // direct credit or a pile on the floor. At the shipped 'boss' setting a
    // routine kill still credits instantly, so nothing is lost to a retreat,
    // and only a boss corpse bursts. Every multiplier above still applies
    // first: the burst splits the FINAL number, so a Miser's Charm boss pays
    // 25% more coins and not a coin less than it did before.
    this.ctx.drops.awardGold(goldWon, f.x, f.y, !!f.def.boss);
    // B5: the corpse drops its loot on the floor. The toast moved with it — a
    // 43-foe night wave firing one toast per stack at roll time is a wall of
    // text; drops.ts aggregates the pickups into one line per 0.4 s instead.
    // A8: `lootBand` is absent on every foe but the Hoarder, so this reads
    // 'common' exactly as it always has — and the one corpse in the game worth
    // a wide spread gets one, because a hoard that lands in a single pile does
    // not look like a hoard.
    //
    // A2: an elite corpse rolls on the `elite` band and a champion's on
    // `champion` — the two LOOT_BANDS rows A1 authored and left dormant with a
    // comment naming this milestone as their first consumer. The band OUTRANKS
    // the def's own, which only the Hoarder sets, and a Hoarder cannot be elite
    // (see spawnDayMob), so the two can never actually contend.
    const stacks = rollLoot(f.def.loot);
    if (rank) {
      // The guaranteed drop. A band sets which RUNGS are reachable; it cannot
      // conjure an item out of a loot table that rolled nothing, and "guaranteed
      // Touched+" has to mean the corpse actually produces something. Without
      // this an elite is a harder fight for a 40% chance of two berries.
      stacks.push({ id: this.eliteReward(f, el!), n: 1 });
      if (Math.random() < rank.threadChance) {
        stacks.push({ id: ELITE_THREADS[(Math.random() * ELITE_THREADS.length) | 0], n: 1 });
      }
    }
    this.ctx.drops.spawn(stacks, f.x, f.y, {
      band: rank ? rank.band : (f.def.lootBand ?? 'common'),
      spread: rank || f.def.lootBand ? 2.4 : 1,
    });
    if (awardXp) {
      const xpWon = Math.round(f.def.xp * (rank?.xpMul ?? 1));
      const lvl = addXp(state, 'combat', xpWon);
      toast(`+${xpWon} ${SKILL_NAME['combat']} xp`);
      // B6: combat levels were entirely silent before this — no sound, no flourish
      if (lvl) { levelUpFlourish(this.ctx); toast(`Combat reached level ${lvl}!`, 'good'); this.ctx.log?.push('level', `Combat reached level ${lvl}`, state.clock); }
      if (state.player.equip?.charm) {
        const cl = awardSoulXp(state, 'charm', CFG.soulgear.charmXpPerKill);
        if (cl) { toast(`Your charm drinks the kill — soul level ${cl}!`, 'good'); this.ctx.log?.push('level', `Charm reached soul level ${cl}`, state.clock); }
      }
    }
    this.ctx.log?.push('combat', `Slew a ${f.def.name}`, state.clock);
    // G1: death poof particles at foe location
    this.ctx.particles?.spawn?.('death', f.x, f.y, 12);
    // SR7: a blood pool, night kills only — a corpse in daylight doesn't
    // need one, and phaseRemaining() during the day answers "until dusk",
    // not "until dawn", which is the wrong question here. CFG.gfx.feel is
    // the real revert.
    if (CFG.gfx.feel !== false && phase(state.clock).isNight) {
      this.ctx.decals?.spawn?.(f.x, f.y, phaseRemaining(state.clock));
    }
  }
}
