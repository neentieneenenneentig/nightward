// Which network lord rules a given tile. A "region" is a big square of tiles; each is
// deterministically assigned a lord, a name, and a danger rating that climbs
// the further you wander from the Loopback — so the map feels vast and the
// stakes rise as you push into the unknown. Pure function of (tile, seed).
import { hash2 } from '../../engine/rng';
import { DOMAIN_LORDS, ORIGIN_LORD, type DomainLord } from '../data/domains';
import { TILE } from './worldgen';

export const REGION = 40; // tiles per domain side (40 * 32px = 1280px ≈ a screenful)

export interface Domain {
  gx: number; gy: number;
  ring: number;    // chebyshev distance from the origin region
  danger: number;  // scales with ring — deeper network, deadlier lord
  lord: DomainLord;
  name: string;
  key: string;
}

const PREFIX = ['The Whispering', 'The Sunken', 'The Hollow', 'The Gilded', 'The Weeping',
  'The Silent', 'The Fevered', 'The Wandering', 'The Shrouded', 'The Riven', 'The Latent', 'The Amber'];
const NOUN = ['Reach', 'Expanse', 'Sector', 'Gateway', 'Grid', 'Threshold',
  'Vale', 'Mire', 'Steppe', 'Fen', 'Barrows', 'Span'];

const pick = <T>(arr: T[], h: number) => arr[Math.floor(h * arr.length) % arr.length];

export const regionOf = (tx: number, ty: number): [number, number] =>
  [Math.floor(tx / REGION), Math.floor(ty / REGION)];
export const regionKey = (gx: number, gy: number) => gx + ':' + gy;
export const regionCenterPx = (gx: number, gy: number): [number, number] =>
  [(gx + 0.5) * REGION * TILE, (gy + 0.5) * REGION * TILE];

/** Cheap lookup for the hot terrain path — the lord only, no name string. */
export function lordAtRegion(gx: number, gy: number, seed: number): DomainLord {
  if (gx === 0 && gy === 0) return ORIGIN_LORD;
  return pick(DOMAIN_LORDS, hash2(gx, gy, seed ^ 0xd0a1));
}
export function lordAt(tx: number, ty: number, seed: number): DomainLord {
  const [gx, gy] = regionOf(tx, ty);
  return lordAtRegion(gx, gy, seed);
}

/** Full domain descriptor — used on region crossings and in the HUD, not per tile. */
export function domainAtRegion(gx: number, gy: number, seed: number): Domain {
  const ring = Math.max(Math.abs(gx), Math.abs(gy));
  const isOrigin = gx === 0 && gy === 0;
  const lord = lordAtRegion(gx, gy, seed);
  const name = isOrigin ? 'The Loopback'
    : `${pick(PREFIX, hash2(gx, gy, seed ^ 0x0011))} ${pick(NOUN, hash2(gx, gy, seed ^ 0x0022))}`;
  return { gx, gy, ring, danger: ring, lord, name, key: regionKey(gx, gy) };
}
export function domainAt(tx: number, ty: number, seed: number): Domain {
  const [gx, gy] = regionOf(tx, ty);
  return domainAtRegion(gx, gy, seed);
}
