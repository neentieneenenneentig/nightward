// Versioned saves, one slot per world seed. localStorage backend for now —
// the envelope is JSON so swapping to IndexedDB later is a two-line change.
import { CFG } from './data/config';
import type { GameState } from './state';

const key = (seed: number) => CFG.save.keyPrefix + seed;

export function saveNow(state: GameState) {
  try {
    localStorage.setItem(key(state.seed), JSON.stringify(state));
    localStorage.setItem(CFG.save.keyPrefix + 'last', String(state.seed));
  } catch {
    // storage full/blocked — the game keeps running, it just won't persist
  }
}

export function loadFor(seed: number): GameState | null {
  try {
    const raw = localStorage.getItem(key(seed));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.v !== 1) return null; // future migrations hook in here
    // forward-compat: fields added after a save was written
    if (data.player && !data.player.equip) data.player.equip = {};
    if (!data.worldBosses) data.worldBosses = [];
    if (data.region == null) data.region = '';
    if (!data.explored) data.explored = {};
    return data as GameState;
  } catch {
    return null;
  }
}

export function lastSeed(): number | null {
  const raw = localStorage.getItem(CFG.save.keyPrefix + 'last');
  return raw ? parseInt(raw, 10) : null;
}
