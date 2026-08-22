// Echoes of the Slain — each domain lord, slain, leaves its echo clinging to
// you: an auto-firing ability in that lord's element. Re-killing the same lord
// (it revives stronger — existing loop) levels its echo, cap CFG.echoes.maxLevel.
// Content is rows; the generic tick lives in systems/echoes.ts.
import { CFG } from './config';

/** Numeric knobs an echo can carry. `statsFor` scales each by its perLevel row. */
export interface EchoStats {
  dmg: number;            // base damage per hit/tick (before the D5 roll)
  cooldown?: number;      // s between fires (pulse/nova/volley)
  radiusTiles?: number;   // effect radius (pulse/nova)
  rangeTiles?: number;    // targeting range (volley)
  projectiles?: number;   // lashes per volley
  slowMult?: number;      // chill: foe speed multiplier while chilled
  slowSec?: number;       // chill duration
  patchSec?: number;      // trail: patch lifetime
  patchTickSec?: number;  // trail: damage tick granularity
  orbCount?: number;      // orbit: orbs in the ring
  orbRadiusTiles?: number;// orbit: ring radius
}

/** A3: the empowered form. Every echo keeps its C1 autofire untouched and gains
 *  one of these, pressed for and paid for in Resolve.
 *
 *  Nothing here is an absolute number. Every field is a MULTIPLIER over the same
 *  `statsFor()` row the autofire reads, so an active is always "your echo, harder"
 *  and levelling the echo levels the active for free. `cost` and `cooldown` are the
 *  two exceptions and are deliberately flat: an active that got more expensive as
 *  you levelled it would punish the exact progress it is meant to reward. */
export interface ActiveDef {
  name: string;            // the deed's own name — the Veil speaks this, not the echo's
  desc: string;            // one line, what pressing it does
  cost: number;            // resolve spent per cast
  cooldown: number;        // s before it can be pressed again
  dmgMul: number;          // over the level-scaled `dmg`
  radiusMul?: number;      // pulse / nova
  rangeMul?: number;       // volley
  projectiles?: number;    // volley: a FIXED target count (the autofire's scales)
  knockTiles?: number;     // pulse: shove survivors this far outward
  freezeSec?: number;      // nova: hard freeze — reuses the C5 tower stun consumer
  lineTiles?: number;      // trail: length of the ignited line, cast along your aim
  windowSec?: number;      // orbit: how long the empowerment holds
  orbBonus?: number;       // orbit: extra orbs during the window
}

export interface EchoDef {
  id: string;
  bossId: string;         // enemy def id of the granting lord
  name: string;           // pure fantasy — the Veil speaks only this
  icon: string;           // HUD chip glyph
  color: number;          // accent for procgen visuals
  kind: 'pulse' | 'trail' | 'nova' | 'volley' | 'orbit';
  desc: string;           // one-line fiction for the chip tooltip
  base: EchoStats;
  perLevel: Partial<EchoStats>;
  active: ActiveDef;       // A3: the empowered form, on the bar
}

export const ECHOES: EchoDef[] = [
  {
    id: 'thornring', bossId: 'thornwarden', name: 'Thornring',
    icon: '🌿', color: 0x5aa24a, kind: 'pulse',
    desc: 'A ring of thorns erupts around you when foes press close.',
    base: { dmg: 6, cooldown: 3.0, radiusTiles: 2.2 },
    perLevel: { dmg: 2, cooldown: -0.15, radiusTiles: 0.15 },
    active: {
      name: 'Bramblebreak', cost: 18, cooldown: 10,
      desc: 'The ring erupts outward — triple bite, and it throws back what survives.',
      dmgMul: 3.0, radiusMul: 2.0, knockTiles: 1.8,
    },
  },
  {
    id: 'cinder_trail', bossId: 'cindermaw', name: 'Cinder Trail',
    icon: '🔥', color: 0xc85a2e, kind: 'trail',
    desc: 'Your footsteps smoulder — the ground you leave burns.',
    base: { dmg: 4, patchSec: 2.5, patchTickSec: 0.5 },
    perLevel: { dmg: 1.5, patchSec: 0.3 },
    active: {
      name: 'Emberline', cost: 15, cooldown: 9,
      desc: 'Fling the smoulder ahead of you — a burning line where you are looking.',
      dmgMul: 2.0, lineTiles: 5,
    },
  },
  {
    id: 'rime_nova', bossId: 'rimewraith', name: 'Rime Nova',
    icon: '❄️', color: 0xa9c8ea, kind: 'nova',
    desc: 'Cold blooms outward, biting and slowing all it touches.',
    base: { dmg: 8, cooldown: 6.0, radiusTiles: 2.6, slowMult: 0.55, slowSec: 2.0 },
    perLevel: { dmg: 2.5, cooldown: -0.25, radiusTiles: 0.15, slowSec: 0.25 },
    active: {
      name: 'Hoarfrost', cost: 22, cooldown: 14,
      desc: 'The cold stops being a slow and becomes a wall — everything near you freezes solid.',
      dmgMul: 1.5, radiusMul: 1.55, freezeSec: 1.5,
    },
  },
  {
    id: 'tide_lash', bossId: 'tideculler', name: 'Tide Lash',
    icon: '🌊', color: 0x3fb0bd, kind: 'volley',
    desc: 'The tide reaches out and strikes the nearest foe.',
    base: { dmg: 7, cooldown: 2.6, rangeTiles: 6.5, projectiles: 1 },
    perLevel: { dmg: 2, cooldown: -0.12, projectiles: 0.5 },
    active: {
      name: 'Undertow', cost: 14, cooldown: 8,
      desc: 'The tide takes four at once, and reaches further to do it.',
      dmgMul: 1.5, rangeMul: 1.3, projectiles: 4,
    },
  },
  {
    id: 'null_orb', bossId: 'nullmaw', name: 'Null Orb',
    icon: '🌑', color: 0x8a4fc4, kind: 'orbit',
    desc: 'A hollow of the void circles you, unmaking what it grazes.',
    base: { dmg: 9, orbCount: 1, orbRadiusTiles: 1.8 },
    perLevel: { dmg: 3, orbCount: 0.34 },
    active: {
      name: 'Threefold Hollow', cost: 20, cooldown: 12,
      desc: 'The hollow splits. For a while there are three of it, and they bite twice as deep.',
      dmgMul: 2.0, windowSec: 8, orbBonus: 2,
    },
  },
];

export const echoForBoss = (bossId: string): EchoDef | undefined =>
  ECHOES.find((e) => e.bossId === bossId);

export const echoById = (id: string): EchoDef | undefined =>
  ECHOES.find((e) => e.id === id);

/** Level-scaled stats: base + perLevel × (level−1); cooldown floored, counts ≥1 int. */
/** A3: the active's effective numbers at a level. The multipliers are flat, so this
 *  is just `statsFor()` seen through the active's lens — deliberately NOT a second
 *  scaling law. One place decides how strong an echo is; the active reads it. */
export function activeStatsFor(def: EchoDef, level: number) {
  const st = statsFor(def, level);
  const a = def.active;
  return {
    dmg: st.dmg * a.dmgMul,
    radiusTiles: st.radiusTiles * (a.radiusMul ?? 1),
    rangeTiles: st.rangeTiles * (a.rangeMul ?? 1),
    projectiles: a.projectiles ?? st.projectiles,
    slowMult: st.slowMult,
    slowSec: st.slowSec,
    patchSec: st.patchSec,
    patchTickSec: st.patchTickSec,
    orbCount: st.orbCount + (a.orbBonus ?? 0),
    orbRadiusTiles: st.orbRadiusTiles,
  };
}

/** Level-scaled stats: base + perLevel × (level−1); cooldown floored, counts ≥1 int. */
export function statsFor(def: EchoDef, level: number): Required<EchoStats> {
  const lv = Math.max(1, level);
  const at = (k: keyof EchoStats, fallback = 0): number => {
    const b = def.base[k];
    if (b === undefined) return fallback;
    return b + ((def.perLevel[k] ?? 0) as number) * (lv - 1);
  };
  return {
    dmg: at('dmg'),
    cooldown: Math.max(CFG.echoes.minCooldownSec, at('cooldown', CFG.echoes.minCooldownSec)),
    radiusTiles: at('radiusTiles'),
    rangeTiles: at('rangeTiles'),
    projectiles: Math.max(1, Math.floor(at('projectiles', 1))),
    slowMult: at('slowMult', 1),
    slowSec: at('slowSec'),
    patchSec: at('patchSec'),
    patchTickSec: at('patchTickSec', 0.5),
    orbCount: Math.max(1, Math.floor(at('orbCount', 1))),
    orbRadiusTiles: at('orbRadiusTiles', 1.8),
  };
}
