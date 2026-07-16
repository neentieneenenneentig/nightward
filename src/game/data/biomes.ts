// ============================================================================
// Biome definitions for N2 "The Wire Realm." Each biome maps to a connection
// type and defines a full visual + gameplay profile for that realm.
// Pure data — live at runtime as NW.NET.biomes.
// ============================================================================
import type { RGB } from '../../engine/procgen/palette';

export interface BiomeDef {
  /** Biome id — matches connection type string. */
  id: string;
  /** Display name shown in HUD. */
  name: string;
  /** Connection type that maps to this biome. */
  connectionType: string;
  /** Accent color for HUD, particles, rift effects. */
  color: RGB;
  /** Hex string for CSS use. */
  hex: string;
  /** Day ambient tint override (null = use default). */
  tintDay?: RGB;
  /** Night ambient tint override. */
  tintNight?: RGB;
  /** Description shown on realm entry. */
  description: string;
  /** Difficulty tier (0 = Loopback/neutral, 1 = normal, 2 = hard, 3 = chaos). */
  tier: number;
  /** Ambient particle type spawned in this realm. */
  ambientParticle: 'none' | 'spark' | 'wisp' | 'glitch';
  /** Wind strength multiplier for fire CA. */
  windMult: number;
  /** Resource density multiplier. */
  resourceMult: number;
}

/** The four biomes — one per connection type. */
export const BIOMES: BiomeDef[] = [
  {
    id: 'ethernet',
    name: 'Ethernet Plains',
    connectionType: 'ethernet',
    color: [100, 200, 80],
    hex: '#64C850',
    tintDay: [255, 252, 245],
    tintNight: [65, 80, 150],
    description: 'Stable, civilized. The heart of the network.',
    tier: 1,
    ambientParticle: 'spark',
    windMult: 0.7,
    resourceMult: 1.0,
  },
  {
    id: 'wifi',
    name: 'WiFi Wilds',
    connectionType: 'wifi',
    color: [80, 140, 255],
    hex: '#508CFF',
    tintDay: [250, 248, 255],
    tintNight: [50, 60, 160],
    description: 'Wild, unpredictable. Rich but risky.',
    tier: 2,
    ambientParticle: 'wisp',
    windMult: 1.2,
    resourceMult: 1.3,
  },
  {
    id: 'cellular',
    name: 'Cellular Chaos',
    connectionType: 'cellular',
    color: [255, 100, 50],
    hex: '#FF6432',
    tintDay: [255, 245, 240],
    tintNight: [70, 40, 120],
    description: 'Hostile, shifting. High risk, high reward.',
    tier: 3,
    ambientParticle: 'glitch',
    windMult: 1.6,
    resourceMult: 1.6,
  },
  {
    id: 'loopback',
    name: 'Loopback',
    connectionType: 'unknown',
    color: [180, 180, 190],
    hex: '#B4B4BE',
    tintDay: [240, 240, 242],
    tintNight: [80, 82, 100],
    description: 'Static, neutral. The offline realm.',
    tier: 0,
    ambientParticle: 'none',
    windMult: 0.5,
    resourceMult: 0.8,
  },
];

/** Lookup biome by connection type string. Returns null for 'unknown'/"no signal" —
 *  caller should use profile-based selection (biomeForProfile). */
export function biomeForConnection(type: string): BiomeDef | null {
  if (type === 'unknown' || type === 'none' || !type) return null;
  return BIOMES.find(b => b.connectionType === type) ?? null;
}

/**
 * Derive a biome from the beacon-echo latency profile (D1).
 * - median < 80ms && variance < 2000  → Ethernet Plains (civilized)
 * - median < 80ms && variance >= 2000 → WiFi Wilds (wild)
 * - median >= 80ms || variance >= 8000  → Cellular Chaos (chaos)
 * - no data → null (caller should use fallback)
 */
export function biomeForProfile(median: number, variance: number): BiomeDef | null {
  if (median <= 0) return null; // no data
  if (median >= 80) return BIOMES[2]; // Cellular Chaos
  if (variance >= 8000) return BIOMES[2]; // very unstable → chaos
  if (variance >= 2000) return BIOMES[1]; // WiFi Wilds
  return BIOMES[0]; // Ethernet Plains (stable + fast)
}

/** Biome index by id. */
export const BIOME_BY_ID: Record<string, BiomeDef> =
  Object.fromEntries(BIOMES.map(b => [b.id, b]));
