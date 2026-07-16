// Network domains: each region of the map is shaped by a Network Lord whose
// influence bends the terrain and stalks the region as a world boss.
// Pure data — the region math lives in world/domains.ts.
import type { RGB } from '../../engine/procgen/palette';

export interface DomainLord {
  id: string;
  title: string;        // "the Ethernet Plains" — the lord's realm name
  bossId: string;       // enemy id (a `boss` entry in enemies.ts)
  moistureBias: number; // shifts the local biome wetter/drier
  elevBias: number;     // shifts the local biome higher/lower
  mood: RGB;            // a subtle network-tinted ambient light
}

// The network lords — each region is governed by one, chosen deterministically
// from its coordinates, so the same seed always generates the same world.
export const DOMAIN_LORDS: DomainLord[] = [
  { id: 'verdant', title: 'the Ethernet Plains', bossId: 'thornwarden',
    moistureBias: 0.13, elevBias: 0.00, mood: [120, 180, 110] },
  { id: 'ashen',   title: 'the Ashen Grid',      bossId: 'cindermaw',
    moistureBias: -0.15, elevBias: 0.03, mood: [205, 120, 85] },
  { id: 'pale',    title: 'the Pale Firewall',      bossId: 'rimewraith',
    moistureBias: -0.05, elevBias: 0.11, mood: [175, 200, 230] },
  { id: 'drowned', title: 'the Drowned Gateway',   bossId: 'tideculler',
    moistureBias: 0.07, elevBias: -0.11, mood: [85, 175, 180] },
  { id: 'gloom',   title: 'the Dead Zone',   bossId: 'nullmaw',
    moistureBias: 0.02, elevBias: 0.02, mood: [150, 105, 195] },
];

// The world begins at the Loopback — safe, static, no hunting lord.
export const ORIGIN_LORD: DomainLord = {
  id: 'loopback', title: 'the Loopback', bossId: 'thornwarden',
  moistureBias: 0.05, elevBias: 0.00, mood: [236, 240, 226],
};

export const LORD_BY_ID: Record<string, DomainLord> =
  Object.fromEntries([ORIGIN_LORD, ...DOMAIN_LORDS].map((l) => [l.id, l]));
