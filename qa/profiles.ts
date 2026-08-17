import type { Act, Profile, Snap } from './harness/driver';

/* ===========================================================================
 * Player archetypes.
 *
 * The point of profiles is that a single scripted playthrough only ever finds
 * bugs on the path that script walks. Different kinds of player stress
 * different systems, and — more usefully — produce different *balance* data:
 * six of these gives you a picture of the difficulty curve without playing
 * the game forty times by hand.
 *
 * Each `act` is a pure function of what the player can currently see, plus a
 * seeded RNG, so a given (profile, seed) replays identically.
 * ======================================================================== */

/** Smooth deterministic wander — a heading that drifts with the game clock. */
const wander = (s: Snap) => {
  const a = Math.sin(s.clock * 0.037) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
};

/** Away from the spawn point (or just wandering, if we're standing on it). */
const outward = (s: Snap) =>
  s.homeDist < 8 ? wander(s) : { x: -s.homeDir.x, y: -s.homeDir.y };

const SWING = 60;   // px — close enough that a player would take a swing

export const PROFILES: Profile[] = [
  {
    name: 'rusher',
    blurb: 'Sprints away from camp looking for a fight, swings first, gathers only what is free.',
    seed: 1234,
    minutes: 4,
    act(s, _rng): Act {
      if (s.nearestFoe !== null && s.nearestFoe < SWING)
        return { tap: [' '], move: s.foeDir!, hold: 180, note: 'swing' };
      if (s.nearestFoe !== null && s.nearestFoe < 340)
        return { move: s.foeDir!, hold: 220, note: 'close in' };
      if (s.gatherTarget && !s.gathering) return { tap: ['e'], hold: 200, note: 'free loot' };
      return { move: outward(s), hold: 400, note: 'push out' };
    },
    check(r) {
      // A profile that runs at the horde all night and never trades a blow
      // means combat never engaged — the run proved nothing.
      const sawFoes = r.samples.some((x) => x.foes > 0);
      if (!sawFoes) throw new Error('rusher never encountered a single foe — combat was never exercised');
    },
  },

  {
    name: 'turtle',
    blurb: 'Never leaves camp. Gathers what is in reach, builds when it can afford to, fights only what comes.',
    seed: 2201,
    minutes: 4,
    act(s, rng): Act {
      if (s.building) return { click: true, tap: ['b'], hold: 300, note: 'place, then leave build mode' };
      if (s.homeDist > 240) return { move: s.homeDir, hold: 320, note: 'back to camp' };
      if (s.nearestFoe !== null && s.nearestFoe < SWING) return { tap: [' '], hold: 180, note: 'defend' };
      if (s.gathering) return { hold: 320, note: 'gathering' };
      if (s.gatherTarget) return { tap: ['e'], hold: 220, note: 'gather' };
      if (s.gold > 20 && rng() < 0.04) return { tap: ['b'], hold: 320, note: 'enter build mode' };
      return { move: wander(s), hold: 340, note: 'patrol camp' };
    },
    check(r) {
      const last = r.samples[r.samples.length - 1];
      if (last && last.homeDist > 600)
        throw new Error(`turtle ended ${last.homeDist.toFixed(0)}px from camp — the leash logic did not hold`);
    },
  },

  {
    name: 'explorer',
    blurb: 'Walks in one direction and never stops. The chunk-streaming and heap-growth canary.',
    seed: 777,
    minutes: 5,
    act(_s): Act {
      return { move: { x: 0.92, y: 0.31 }, hold: 500, note: 'due east, forever' };
    },
    check(r) {
      const first = r.samples[0], last = r.samples[r.samples.length - 1];
      if (!first || !last) throw new Error('no samples');
      const travelled = Math.hypot(last.x - first.x, last.y - first.y);
      if (travelled < 500)
        throw new Error(
          `explorer only travelled ${travelled.toFixed(0)}px — either input is not reaching the game ` +
          `(window focus?) or movement is broken`,
        );
    },
  },

  {
    name: 'hoarder',
    blurb: 'Gathers every node it can find and keeps opening the craft screen. Stresses inventory, economy and panel rebuilds.',
    seed: 3141,
    minutes: 4,
    act(s, rng): Act {
      if (s.gathering) return { hold: 300, note: 'gathering' };
      if (s.gatherTarget) return { tap: ['e'], hold: 200, note: 'gather' };
      if (s.nearestFoe !== null && s.nearestFoe < SWING) return { tap: [' '], hold: 180, note: 'shoo' };
      // open and immediately close a panel — exercises the full rebuild path
      if (rng() < 0.05) return { tap: ['c', 'Escape'], hold: 250, note: 'peek at craft' };
      if (rng() < 0.04) return { tap: ['i', 'Escape'], hold: 250, note: 'peek at bag' };
      return { move: wander(s), hold: 320, note: 'forage' };
    },
    check(r) {
      const gained = r.samples.some((x) => x.invTotal > (r.samples[0]?.invTotal ?? 0));
      if (!gained) throw new Error('hoarder gathered for the whole session and its inventory never grew');
    },
  },

  {
    name: 'idler',
    blurb: 'Boots the game and does absolutely nothing. Proves the world survives neglect — and that night is genuinely dangerous.',
    seed: 909,
    minutes: 3,
    act(): Act {
      return { hold: 1000, note: 'afk' };
    },
  },

  {
    name: 'flailer',
    blurb: 'Seeded input fuzz across the whole key surface. The crash finder — no expectations beyond "nothing throws".',
    seed: 66613,
    minutes: 3,
    act(_s, rng): Act {
      const KEYS = ['e', ' ', 'f', 'b', 'i', 'c', 'k', 'l', 'o', 'v', 'Tab', 'Escape', 'G'];
      const a: Act = { hold: 120 + rng() * 180, note: 'fuzz' };
      if (rng() < 0.55) a.move = { x: rng() * 2 - 1, y: rng() * 2 - 1 };
      if (rng() < 0.45) a.tap = [KEYS[Math.floor(rng() * KEYS.length)]];
      if (rng() < 0.15) a.click = true;
      return a;
    },
  },

  {
    name: 'pilgrim',
    blurb: 'A competent generalist playing one entire life, start to death screen. The full-playthrough profile.',
    seed: 4242,
    minutes: 17,   // L1 caps a run at ~15 real minutes; this outlasts it on purpose
    act(s, rng): Act {
      if (s.building) return { click: true, tap: ['b'], hold: 300, note: 'place' };
      // survival first
      if (s.hpFrac < 0.35 && s.nearestFoe !== null && s.nearestFoe < 200)
        return { move: { x: -s.foeDir!.x, y: -s.foeDir!.y }, hold: 350, note: 'disengage' };
      if (s.nearestFoe !== null && s.nearestFoe < SWING) return { tap: [' '], hold: 180, note: 'fight' };
      // day is for gathering, night is for holding camp
      if (s.night) {
        if (s.homeDist > 200) return { move: s.homeDir, hold: 320, note: 'home before dark' };
        return { move: wander(s), hold: 300, note: 'hold camp' };
      }
      if (s.gathering) return { hold: 320, note: 'gathering' };
      if (s.gatherTarget) return { tap: ['e'], hold: 220, note: 'gather' };
      if (s.gold > 30 && rng() < 0.03) return { tap: ['b'], hold: 320, note: 'build' };
      if (rng() < 0.03) return { tap: ['c', 'Escape'], hold: 250, note: 'craft check' };
      return { move: wander(s), hold: 340, note: 'forage' };
    },
    check(r) {
      const last = r.samples[r.samples.length - 1];
      if (!last?.gameOver)
        throw new Error(
          `pilgrim played ${r.realSeconds.toFixed(0)}s and the run never ended — L1's lifespan cap ` +
          `(target ~15 min) did not fire`,
        );
    },
  },
];

/**
 * Wall-clock budget per profile. The default keeps the whole suite inside a
 * couple of minutes so it can gate every push; `NW_MINUTES=99` runs each
 * profile at its natural length for a pre-release sweep.
 */
export const MINUTES_CAP = Number(process.env.NW_MINUTES ?? 1);

export const capped = (p: Profile): Profile => ({ ...p, minutes: Math.min(p.minutes, MINUTES_CAP) });

export const byName = (n: string) => {
  const p = PROFILES.find((x) => x.name === n);
  if (!p) throw new Error(`no profile "${n}" (have: ${PROFILES.map((x) => x.name).join(', ')})`);
  return p;
};
