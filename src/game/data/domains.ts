// Dream-world domains: each region of the map is the landscape *imagined* by
// the strongest being that rules it (Warlock-of-the-Magus-World energy). The
// lord bends terrain toward its nature and stalks the region as a world boss.
// Pure data — the region math lives in world/domains.ts.
import type { RGB } from '../../engine/procgen/palette';

export interface DomainLord {
  id: string;
  title: string;        // "the Verdant Dreaming" — reads as "<name>, ... of <title>"
  bossId: string;       // enemy id (a `boss` entry in enemies.ts)
  moistureBias: number; // shifts the local biome wetter/drier
  elevBias: number;     // shifts the local biome higher/lower
  mood: RGB;            // a subtle dream tint blended into the ambient light
}

// The ruling archetypes. A region's lord is chosen deterministically from its
// coordinates, so the same seed always dreams the same world.
export const DOMAIN_LORDS: DomainLord[] = [
  { id: 'verdant', title: 'the Verdant Dreaming', bossId: 'thornwarden',
    moistureBias: 0.13, elevBias: 0.00, mood: [120, 180, 110] },
  { id: 'ashen',   title: 'the Ashen Waste',      bossId: 'cindermaw',
    moistureBias: -0.15, elevBias: 0.03, mood: [205, 120, 85] },
  { id: 'pale',    title: 'the Pale Silence',      bossId: 'rimewraith',
    moistureBias: -0.05, elevBias: 0.11, mood: [175, 200, 230] },
  { id: 'drowned', title: 'the Drowned Reverie',   bossId: 'tideculler',
    moistureBias: 0.07, elevBias: -0.11, mood: [85, 175, 180] },
  { id: 'gloom',   title: 'the Gloaming Hunger',   bossId: 'nullmaw',
    moistureBias: 0.02, elevBias: 0.02, mood: [150, 105, 195] },
];

// The world begins in the one place still awake — safe, benign, no hunting lord.
export const ORIGIN_LORD: DomainLord = {
  id: 'waking', title: 'the Waking Marches', bossId: 'thornwarden',
  moistureBias: 0.05, elevBias: 0.00, mood: [236, 240, 226],
};

export const LORD_BY_ID: Record<string, DomainLord> =
  Object.fromEntries([ORIGIN_LORD, ...DOMAIN_LORDS].map((l) => [l.id, l]));
