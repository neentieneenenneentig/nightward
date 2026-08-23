// A5 — Sockets & Weaves (Hero Siege's runewords, Veil-legal).
//
// Gear rolls 0–3 SOCKETS by rarity. THREADS drop from domain lords (the closest
// thing this build has to elites until A2 ships). Slotting threads into a
// rolled item in a recognised ORDER completes a WEAVE with a named bonus:
//
//   The Long Night   Rime · Rime · Ember   +25% damage while it is night
//   Hollow Song      Null · Tide            kills restore 4 Resolve
//   Ironwake         Thorn · Thorn          reflected damage also stuns
//
// The one rule that matters is the Loom's, restated: **a run is its weave**.
// Threads are removable, but the weave BREAKS the moment they are reordered —
// the same no-respec logic as the passive tree, for the same reason. A weave is
// a sequence, not a set; `null · tide` is Hollow Song and `tide · null` is two
// loose threads.
//
// Everything here is PURE DATA + one pure matcher (`matchWeaves`). The live
// slotting, the inventory movement and the typed bonus getters live in
// systems/weaves.ts; the balance NUMBERS live in CFG.weaves like every other
// number in this game.
import { rarityIndex, type RarityId } from './rarity';

/** The five thread elements. They are the five Echoes, one step removed — a
 *  thread is the echo's residue, something you can hold and weave. */
export type ThreadId = 'rime' | 'ember' | 'null' | 'tide' | 'thorn';

export interface ThreadDef {
  id: ThreadId;
  /** Veil-legal. "Thread" is Loom vocabulary; the Loom is already about weaving. */
  name: string;
  /** CSS hex for the tooltip and any future socket display. */
  color: string;
  /** Single glyph for compact socket rows. */
  glyph: string;
}

export const THREADS: ThreadDef[] = [
  { id: 'rime',  name: 'Rime Thread',  color: '#a9c8ea', glyph: '❄' },
  { id: 'ember', name: 'Ember Thread', color: '#e8844a', glyph: '🔥' },
  { id: 'null',  name: 'Null Thread',  color: '#b98ae0', glyph: '🌑' },
  { id: 'tide',  name: 'Tide Thread',  color: '#5fc8d4', glyph: '🌊' },
  { id: 'thorn', name: 'Thorn Thread', color: '#8fc46a', glyph: '🌿' },
];

export const threadById = (id: ThreadId): ThreadDef =>
  THREADS.find((t) => t.id === id) ?? THREADS[0];

/** The inventory item that carries a thread. Data lives here so both the drop
 *  site and the socket UI agree on the mapping without importing each other. */
export const THREAD_ITEM: Record<ThreadId, string> = {
  rime: 'thread_rime',
  ember: 'thread_ember',
  null: 'thread_null',
  tide: 'thread_tide',
  thorn: 'thread_thorn',
};

/** Which thread a domain lord leaves. Lords are the elite of this build, so
 *  they are the thread source until A2's elites take over. */
export const BOSS_THREAD: Record<string, ThreadId> = {
  thornwarden: 'thorn',
  cindermaw: 'ember',
  rimewraith: 'rime',
  tideculler: 'tide',
  nullmaw: 'null',
};

/** SR2 — weapon evolution. A5 already has sockets, threads and completed
 *  weaves; this is that table read backwards. `rarityFloor` doubles as the
 *  weave's own sockets requirement in practice — Ironwake and Hollow Song
 *  need 2 sockets (Woven-and-up per SOCKET_RANGE below), Long Night needs 3
 *  (Hallowed-and-up) — so evolution never gates behind a rarity a weapon
 *  carrying the weave couldn't already have reached. `dmgMul` rides the
 *  SAME multiplier slot `nightDmgMul` already occupies in combat's dmg
 *  formula (see WeaveSystem.evolvedDmgMul, combat.ts's `weaveDmgMul`) — one
 *  more factor in a chain that already exists, not a second one. */
export interface WeaveEvolution {
  rarityFloor: RarityId;
  /** The weapon's new name, replacing the rolled prefix+base+suffix in the
   *  tooltip only — the underlying ItemDef and its uid are untouched, the
   *  same way a rework changes what an item does without changing what it
   *  IS (see loot.ts reforgeAffix). */
  name: string;
  dmgMul: number;
}

export interface WeaveDef {
  id: string;
  name: string;
  /** The ordered thread sequence. Order is load-bearing — see the file header. */
  sequence: ThreadId[];
  /** One line, what the completed weave does. */
  desc: string;
  evolution?: WeaveEvolution;
}

export const WEAVES: WeaveDef[] = [
  {
    id: 'long_night',
    name: 'The Long Night',
    sequence: ['rime', 'rime', 'ember'],
    desc: '+25% damage while it is night',
    evolution: { rarityFloor: 'hallowed', name: 'Nightfang', dmgMul: 1.15 },
  },
  {
    id: 'hollow_song',
    name: 'Hollow Song',
    sequence: ['null', 'tide'],
    desc: 'kills restore 4 Resolve',
    evolution: { rarityFloor: 'woven', name: 'Hollowmourn', dmgMul: 1.08 },
  },
  {
    id: 'ironwake',
    name: 'Ironwake',
    sequence: ['thorn', 'thorn'],
    desc: 'reflected damage also stuns',
    evolution: { rarityFloor: 'woven', name: 'Wardbriar', dmgMul: 1.08 },
  },
];

export const weaveById = (id: string): WeaveDef | undefined =>
  WEAVES.find((w) => w.id === id);

/** Does `sockets` contain `seq` as a CONTIGUOUS run? A length-2 weave can sit
 *  inside a 3-socket item (null·tide·thorn completes Hollow Song); a reorder
 *  (tide·null) does not, which is the whole rule. */
function containsRun(sockets: ThreadId[], seq: ThreadId[]): boolean {
  if (!seq.length) return false;
  outer: for (let i = 0; i + seq.length <= sockets.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (sockets[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Every weave a socket row currently completes, in WEAVES order. Pure — the
 *  same function feeds the live system and the tooltip, so the two can never
 *  disagree about what is and is not a weave. */
export function matchWeaves(sockets: ThreadId[]): WeaveDef[] {
  return WEAVES.filter((w) => containsRun(sockets, w.sequence));
}

/** SR2 — is THIS specific rolled weapon (its rarity, its current socket row)
 *  evolved, and by which weave? One pure function so combat's damage
 *  multiplier and the tooltip's display name can never drift apart the way
 *  the Glass Echo remap once did (§17) by each keeping their own copy of
 *  the same check. Sockets change as threads go in and out, so this is
 *  computed live off state rather than cached on the roll at drop time. */
export function weaponEvolution(rarity: RarityId, sockets: ThreadId[]): WeaveEvolution & { weaveId: string } | null {
  for (const w of matchWeaves(sockets)) {
    if (w.evolution && rarityIndex(rarity) >= rarityIndex(w.evolution.rarityFloor)) {
      return { ...w.evolution, weaveId: w.id };
    }
  }
  return null;
}

/** Socket count by tier. Plain gear never rolls at all (it stays an authored
 *  id), so its zero here is declarative rather than executable. Touched caps at
 *  one; a 3-socket row is the privilege of Hallowed-and-up, which makes the
 *  three-thread Long Night something you EARN a vessel for, not something the
 *  ladder hands out. */
export const SOCKET_RANGE: Record<RarityId, [number, number]> = {
  plain: [0, 0],
  touched: [0, 1],
  woven: [1, 2],
  hallowed: [2, 3],
  sovereign: [3, 3],
  riftborn: [3, 3],
};

/** Roll a socket count for one rolled item. Live-random like the affix draw. */
export function rollSocketCount(rarity: RarityId): number {
  const [lo, hi] = SOCKET_RANGE[rarity] ?? [0, 0];
  if (lo === hi) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
