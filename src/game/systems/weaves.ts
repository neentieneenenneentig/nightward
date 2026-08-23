// A5 — Sockets & Weaves: the live half.
//
// data/weaves.ts is pure (threads, weave sequences, the socket ranges, the
// matcher); this class owns everything that moves: inventory movement, socket
// contents, and the three typed bonus getters the rest of the game reads.
// A weave is matched ON DEMAND — there is no cached "active weave" set to
// drift out of sync with the state it describes. Correctness beats the cache;
// the fold is a handful of carried items and runs once per read.
import { CFG } from '../data/config';
import { invAdd, carriedGearIds } from '../rules';
import { itemDef, rolledOf, threadOf } from '../data/items';
import {
  BOSS_THREAD, THREAD_ITEM, matchWeaves, threadById, weaponEvolution,
  type ThreadId, type WeaveDef, type WeaveEvolution,
} from '../data/weaves';

export class WeaveSystem {
  constructor(private ctx: any) {}

  private get state(): any { return this.ctx.state; }

  /** The ordered threads currently socketed in a rolled item ([] for an
   *  authored item or an empty row). Reads state, never a cache. */
  slotted(uid: string): ThreadId[] {
    return this.state.sockets?.[uid] ?? [];
  }

  /** How many sockets a piece of gear can hold. Authored gear: 0. */
  capacity(uid: string): number {
    return rolledOf(uid)?.sockets ?? 0;
  }

  /** True if `uid` is rolled gear with at least one free socket. */
  canSocket(uid: string): boolean {
    return this.slotted(uid).length < this.capacity(uid);
  }

  /** Slot one thread item into a free socket on rolled gear. Consumes the item
   *  from the bag; returns false if the gear can't take it or the thread isn't
   *  held. Order is preserved — this is the half that makes a weave a sequence. */
  slotThread(uid: string, threadItemId: string): boolean {
    if (!CFG.weaves.enabled) return false;
    const tid = threadOf(threadItemId);
    if (!tid) return false;
    if (!this.canSocket(uid)) return false;
    const inv = this.state.player.inv ?? {};
    if ((inv[threadItemId] ?? 0) < 1) return false;

    inv[threadItemId]--;
    const next = [...this.slotted(uid), tid];
    this.state.sockets = this.state.sockets ?? {};
    this.state.sockets[uid] = next;

    this.ctx.log?.push('weave', `Slotted ${threadById(tid).name} into ${itemDef(uid)?.name}`, this.state.clock);
    return true;
  }

  /** Pull one thread back out of a socket. Returns the thread to the bag.
   *  Removing middle threads BREAKS the weave — that is the rule, not a bug. */
  unsocket(uid: string, index: number): boolean {
    const arr = this.slotted(uid);
    if (index < 0 || index >= arr.length) return false;
    const tid = arr[index];
    const rest = arr.filter((_, i) => i !== index);
    if (rest.length) this.state.sockets[uid] = rest;
    else delete this.state.sockets[uid];
    invAdd(this.state, THREAD_ITEM[tid], 1);

    this.ctx.log?.push('weave', `Removed ${threadById(tid).name} from ${itemDef(uid)?.name}`, this.state.clock);
    return true;
  }

  /** Every completed weave across everything you carry. Carried, not just worn,
   *  on purpose — a socketed axe in hand is still gear, and the same reasoning
   *  that puts tools in carriedGearIds() puts their sockets here too. */
  activeWeaves(): WeaveDef[] {
    const out: WeaveDef[] = [];
    const seen = new Set<string>();
    for (const id of carriedGearIds(this.state)) {
      for (const w of matchWeaves(this.slotted(id))) {
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        out.push(w);
      }
    }
    return out;
  }

  hasWeave(id: string): boolean {
    return this.activeWeaves().some((w) => w.id === id);
  }

  /** The weaves a single item currently completes — for its tooltip. */
  weavesOn(uid: string): WeaveDef[] {
    return matchWeaves(this.slotted(uid));
  }

  // ---- the three typed bonuses ----------------------------------------------
  // Every weave bonus has exactly one consumer. A weave with no consumer is a
  // dormant row, and this project has learned what those cost.

  /** The Long Night: +25% damage, but only after dusk. Read by combat.resolveHit. */
  nightDmgMul(): number {
    if (!this.hasWeave('long_night')) return 1;
    return this.ctx.isNight() ? CFG.weaves.longNightDmgMul : 1;
  }

  /** Hollow Song: extra Resolve per kill. Call onKill() from the kill paths. */
  killResolve(): number {
    return this.hasWeave('hollow_song') ? CFG.weaves.hollowSongResolve : 0;
  }

  /** Called from the player-kill paths (hordes + worldbosses), next to
   *  vitals.onKill. Hollow Song stacks on top of the S1 per-kill resolve. */
  onKill() {
    const extra = this.killResolve();
    if (extra <= 0) return;
    const p = this.state.player;
    p.resolve = Math.max(0, Math.min(CFG.vitals.resolveMax, p.resolve + extra));
    this.ctx.floaters?.spawnVital?.(p.x, p.y - 32, 'resolve', `+${extra}`, '#da5', this.ctx.cam);
  }

  /** SR2 — the equipped weapon's evolution, if its rarity and current socket
   *  row earn it one. Reads `rolledOf` directly rather than through
   *  `carriedGearIds`/`activeWeaves` because evolution is deliberately
   *  narrower than either: a completed weave on a RING doesn't rename your
   *  SWORD, and an off-hand tool completing one doesn't either — "a blade
   *  becomes a named weapon" (the plan's own words) means the equipped
   *  weapon slot alone. */
  evolvedWeapon(): (WeaveEvolution & { weaveId: string }) | null {
    const uid = this.state.player.equip?.weapon;
    if (!uid) return null;
    const roll = rolledOf(uid);
    if (!roll) return null;
    return weaponEvolution(roll.rarity, this.slotted(uid));
  }

  /** Read by combat.resolveHit next to nightDmgMul, in the SAME multiplier
   *  chain — an evolved blade's bonus is not a separate damage line, it is
   *  one more factor in the one the game already computes. */
  evolvedDmgMul(): number {
    return this.evolvedWeapon()?.dmgMul ?? 1;
  }

  /** Ironwake: melee attackers take a share of their hit back, and are stunned.
   *  Returns null when the weave is not up, so damagePlayer pays nothing for the
   *  check. Read by combat.damagePlayer. */
  reflect(): { pct: number; stunSec: number } | null {
    if (!this.hasWeave('ironwake')) return null;
    return { pct: CFG.weaves.ironwakeReflectPct, stunSec: CFG.weaves.ironwakeStunSec };
  }

  /** The thread a domain lord drops, or null. Kept here so the drop site
   *  (worldbosses) and the data table can't disagree. */
  threadForBoss(bossId: string): string | null {
    const tid = BOSS_THREAD[bossId];
    return tid ? THREAD_ITEM[tid] : null;
  }
}
