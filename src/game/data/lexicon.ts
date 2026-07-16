// ============================================================================
// N2a Lexicon — deterministic epithets and mood clauses derived from live
// network variables. Pure data + pure functions. Never leaks jargon into
// fiction — these are the bridge that turns raw numbers into flavourful names.
// ============================================================================

/**
 * Region → epithet suffix mapping.
 * Deterministic: same region always gets the same epithet.
 */
export function epithetForRegion(region: string): string {
  const map: Record<string, string> = {
    'Americas': 'of the Western Water',
    'Europe': 'of the Old Roads',
    'Asia-Pacific': 'of the Dawn Lands',
    'Africa': 'of the Far Shore',
    'Global Anycast': 'of the Shimmering Veil',
  };
  return map[region] ?? 'of the Far Shore';
}

/**
 * Prefix by birth conditions. At most one prefix applies (priority: Pale > Flickering > Swift).
 * - cold route (paid DNS+TLS) → 'Pale'
 * - echo jitter at birth > 40 ms → 'Flickering'
 * - echo < 60 ms → 'Swift'
 */
export function prefixForBirth(cold: boolean, jitterAtBirth: number, echoMs: number): string | null {
  if (cold) return 'Pale';
  if (jitterAtBirth > 40) return 'Flickering';
  if (echoMs < 60) return 'Swift';
  return null;
}

/**
 * Realm-band mood clause for region-crossing toasts.
 * Uses the numeric band without naming network vars.
 */
export function moodClause(realmBand: 'calm' | 'shifting' | 'storm'): string {
  switch (realmBand) {
    case 'calm': return '— the air is still';
    case 'shifting': return '— the air is restless';
    case 'storm': return '— the air crackles';
  }
}

/**
 * Derive a realm band from median + variance.
 * calm: median < 80ms && variance < 2000
 * shifting: median < 80ms && variance >= 2000
 * storm: median >= 80ms || variance >= 8000
 */
export function realmBand(median: number, variance: number): 'calm' | 'shifting' | 'storm' {
  if (median >= 80) return 'storm';
  if (variance >= 8000) return 'storm';
  if (variance >= 2000) return 'shifting';
  return 'calm';
}
