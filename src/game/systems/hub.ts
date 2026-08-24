// A6 — the Hall becomes a hub: the live half.
//
// data/hub.ts is the tables and the two price functions; this class owns
// everything that moves — the proximity test, the gold, the roll, the rework.
//
// The design constraint that shaped the whole file: **neither counter invents a
// mechanic.** The Reliquary calls the same `rollItem()` that a corpse calls,
// with the same `fortune` the wire is already feeding every other roll in the
// game, into one of the same `LOOT_BANDS` a domain lord drops from. The
// Forge-Warden calls `reforgeAffix()`, which is `rollItem()`'s own assembly
// path applied to one line. A shop that rolled its own loot would be a second
// loot system, and the first thing that would happen is the two drifting apart
// on a balance pass.
import { CFG } from '../data/config';
import { BUILDINGS, HUB_BUILDINGS, type BuildingDef } from '../data/buildings';
import {
  HUB_SLOTS, SEALS, baseWorth, reforgePrice, sealById, sealPrice,
  type HubKind, type SealDef,
} from '../data/hub';
import { ITEMS, itemName, rolledOf, type RolledItem } from '../data/items';
import { LOOT_BANDS, rarityDef, rarityIndex } from '../data/rarity';
import { affixSlotOf, fortuneFrom, reforgeAffix, rollItem } from './loot';
import type { AffixSlot } from '../data/affixes';
import type { Stack } from '../types';
import { carriedGearIds, invAdd, invCount, invHasAll, invTakeAll, nearestWithinReach } from '../rules';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';

/** One base item on a seal's shelf, and whether that seal reaches it. */
export interface ShelfEntry {
  id: string;
  reachable: boolean;
}

/** What the Reliquary can sell in one slot under one seal. */
export interface OfferView {
  seal: SealDef;
  gold: number;
  /** The base items this seal can actually hand you, best first. Shown, because
   *  "you buy the shape and the odds" is only true if the shape is legible. */
  stock: string[];
  /** The same ladder including the bases this seal CANNOT reach, so the panel
   *  can grey them. `stock` is what you get; this is what you are choosing
   *  between, and the difference between the two is what the price buys. */
  shelf: ShelfEntry[];
  floor: string;
  ceiling: string;
  affordable: boolean;
}

/** One reworkable line on one carried item. */
export interface ReforgeView {
  uid: string;
  name: string;
  rarity: string;
  color: string;
  gold: number;
  mats: Stack[];
  /** How many times this piece has already been through the forge. */
  prior: number;
  /** Currently in a slot. The bench lists bag gear as well as worn gear, and
   *  a player holding three blades cannot otherwise tell which one they are
   *  about to spend four figures on. */
  worn: boolean;
  affordable: boolean;
  affixes: { index: number; label: string; cursed: boolean }[];
}

export class HubSystem {
  constructor(private ctx: any) {}

  private get state(): any { return this.ctx.state; }

  // ------------------------------------------------------------- reach ----

  /** The hub counter the player is standing at, or null.
   *
   *  Scans `state.buildings` for the `hub` column rather than for two ids, so
   *  a third counter is a data row and this function never changes. Nearest
   *  wins — a Reliquary and a Forge-Warden built shoulder to shoulder is a
   *  perfectly ordinary base layout and "whichever is closer" is the only
   *  answer that does not need a rule. */
  near(): { kind: HubKind; def: BuildingDef; b: any } | null {
    const { x, y } = this.state.player;
    const reach = CFG.a6.reachTiles * TILE;
    const candidates: { kind: HubKind; def: BuildingDef; b: any }[] = [];
    for (const b of this.state.buildings) {
      const def = BUILDINGS.find((d) => d.id === b.type);
      if (!def?.hub) continue;
      // Each counter answers to its own flag. The Sounding Stone is N4.5's row
      // and must not be gated off by A6's revert — and vice versa.
      if (def.hub === 'sounding' ? !CFG.n45.enabled : !CFG.a6.enabled) continue;
      candidates.push({ kind: def.hub, def, b });
    }
    return nearestWithinReach(candidates,
      (c) => Math.hypot((c.b.tx + 0.5) * TILE - x, (c.b.ty + 0.5) * TILE - y), reach);
  }

  /** Whether a hub of this kind is standing at all — for the panel, which stays
   *  honest if the building burns down while it is open. */
  private standing(kind: HubKind): boolean {
    const def = HUB_BUILDINGS[kind];
    return !!def && this.state.buildings.some((b: any) => b.type === def.id);
  }

  // --------------------------------------------------------- the stock ----

  /** The base items one seal can hand you in one slot, best first.
   *
   *  Ranked by `baseWorth()` and cut at the seal's `stockFloor`. Recomputed on
   *  every call rather than cached: ITEMS is 80-odd rows and this runs when a
   *  panel opens, and a cache here would be a second copy of the item table
   *  that a new row could silently fall out of. */
  stock(slot: AffixSlot, seal: SealDef): string[] {
    return this.shelf(slot, seal).filter((e) => e.reachable).map((e) => e.id);
  }

  /** The WHOLE ladder for a slot, best first, each base flagged with whether
   *  this seal can reach it.
   *
   *  `stock()` above is the buy pool and answers "what can this hand me".
   *  This answers "what is on the shelf, and how much of it is above your
   *  price" — a different question with a different consumer, which is why it
   *  is a second method rather than a flag on the first.
   *
   *  It exists because the panel used to draw only the reachable half, and a
   *  strip of four icons tells a player nothing: four out of what? The number
   *  a seal's price is really buying is the part you CANNOT see when you only
   *  render what you can afford. Showing the excluded bases greyed turns the
   *  strip from decoration into the actual comparison between the three seals,
   *  which is the one comparison the panel exists to support. */
  shelf(slot: AffixSlot, seal: SealDef): ShelfEntry[] {
    const ranked = Object.values(ITEMS)
      .filter((d) => !d.relic && affixSlotOf(d) === slot)
      .sort((a, b) => baseWorth(a) - baseWorth(b));
    const from = Math.floor(ranked.length * seal.stockFloor);
    return ranked
      .map((d, i) => ({ id: d.id, reachable: i >= from }))
      .reverse();
  }

  /** Everything the Reliquary will sell in one slot, cheapest seal first. */
  offers(slot: AffixSlot): OfferView[] {
    const gold = this.state.player.gold;
    return SEALS.map((seal) => {
      const band = LOOT_BANDS[seal.band] ?? LOOT_BANDS.common;
      const price = sealPrice(seal);
      return {
        seal,
        gold: price,
        stock: this.stock(slot, seal),
        shelf: this.shelf(slot, seal),
        floor: rarityDef(band.floor ?? 'plain').name,
        ceiling: rarityDef(band.ceiling ?? 'hallowed').name,
        affordable: gold >= price,
      };
    });
  }

  /** Buy one sealed relic. The gold leaves before the roll happens — a refund
   *  path on a bad roll is the one thing that would turn this into a slot
   *  machine you cannot lose at. */
  buy(slot: AffixSlot, sealId: string): { ok: boolean; id?: string; why?: string } {
    if (!CFG.a6.enabled) return { ok: false, why: 'The Reliquary is shuttered.' };
    if (!this.standing('reliquary')) return { ok: false, why: 'You have no Reliquary.' };
    const seal = sealById(sealId);
    if (!seal) return { ok: false, why: 'No such seal.' };
    if (!HUB_SLOTS.some((s) => s.slot === slot)) return { ok: false, why: 'Nothing takes that shape.' };

    const price = sealPrice(seal);
    const p = this.state.player;
    if (p.gold < price) return { ok: false, why: `${seal.name} costs ${price} gold — you carry ${p.gold}.` };

    const pool = this.stock(slot, seal);
    if (!pool.length) return { ok: false, why: 'The shelf is empty.' };

    p.gold -= price;
    this.ctx.onGold?.();
    const base = pool[(Math.random() * pool.length) | 0];
    // The same fortune every other roll in the game reads. A frayed wire makes
    // a purchased seal likelier to disappoint for exactly the reason it makes a
    // corpse likelier to — the Reliquary is inside the economy, not beside it.
    const id = rollItem(base, {
      band: seal.band as any,
      fortune: fortuneFrom(this.ctx.net),
      clock: this.state.clock,
      covenant: this.state.covenant,
    });
    invAdd(this.state, id, 1);

    const roll = rolledOf(id);
    const tier = roll ? rarityDef(roll.rarity).name : 'Plain';
    Sound.play('gold');
    this.ctx.toast(`${seal.name} broken: ${itemName(id)} (${tier})`, roll && rarityIndex(roll.rarity) >= 3 ? 'good' : 'info');
    this.ctx.log?.push('economy',
      `Broke a ${seal.name} for ${price} gold — ${itemName(id)} (${tier})`, this.state.clock);
    return { ok: true, id };
  }

  // -------------------------------------------------- the forge-warden ----

  /** Every carried piece the Forge-Warden will touch: rolled gear with at
   *  least one affix. Carried, not just worn — the same list `activeWeaves()`
   *  walks, for the same reason: an axe in the bag is still your gear. */
  reforgeables(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of carriedGearIds(this.state)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (rolledOf(id)?.affixes.length) out.push(id);
    }
    // Unworn rolled gear sitting in the bag counts too. A player who just
    // bought a sealed relic has not equipped it yet, and being told to put it
    // on before it can be reworked would be a rule with no reason behind it.
    for (const id of Object.keys(this.state.player.inv ?? {})) {
      if (seen.has(id) || !((this.state.player.inv[id] ?? 0) > 0)) continue;
      seen.add(id);
      if (rolledOf(id)?.affixes.length) out.push(id);
    }
    return out;
  }

  /** What the next rework of this item costs, and whether it can be paid. */
  quote(uid: string): { gold: number; mats: Stack[]; prior: number } | null {
    const roll = rolledOf(uid);
    if (!roll) return null;
    const prior = this.state.reforged?.[uid] ?? 0;
    const { gold, mats } = reforgePrice(roll.rarity, rarityIndex(roll.rarity), prior);
    return { gold, mats, prior };
  }

  /** Everything the Forge-Warden panel needs to draw itself. */
  bench(): ReforgeView[] {
    const out: ReforgeView[] = [];
    for (const uid of this.reforgeables()) {
      const roll = rolledOf(uid)!;
      const q = this.quote(uid)!;
      out.push({
        uid,
        name: roll.name,
        rarity: rarityDef(roll.rarity).name,
        color: rarityDef(roll.rarity).color,
        gold: q.gold,
        mats: q.mats,
        prior: q.prior,
        worn: Object.values(this.state.player.equip ?? {}).includes(uid) || this.state.player.relic === uid,
        affordable: this.state.player.gold >= q.gold && invHasAll(this.state, q.mats),
        affixes: roll.affixes.map((a, index) => ({
          index,
          label: a.name,
          cursed: !!a.cursed,
        })),
      });
    }
    return out;
  }

  /** Rework one line. Charges first, then rolls — same rule as the Reliquary,
   *  and for a stronger reason here: the whole point is that the result can be
   *  worse than what you had. */
  reforge(uid: string, index: number): { ok: boolean; why?: string; before?: string; after?: string } {
    if (!CFG.a6.enabled) return { ok: false, why: 'The forge is cold.' };
    if (!this.standing('forge')) return { ok: false, why: 'You have no Forge-Warden.' };
    const roll = rolledOf(uid);
    if (!roll) return { ok: false, why: 'Nothing to rework there.' };
    if (invCount(this.state, uid) < 1) return { ok: false, why: 'You are not carrying that.' };
    if (!roll.affixes[index]) return { ok: false, why: 'No such line on that piece.' };

    const q = this.quote(uid)!;
    const p = this.state.player;
    if (p.gold < q.gold) return { ok: false, why: `That rework costs ${q.gold} gold — you carry ${p.gold}.` };
    if (!invHasAll(this.state, q.mats)) {
      const need = q.mats.map((m) => `${m.n}× ${itemName(m.id)}`).join(', ');
      return { ok: false, why: `The Forge-Warden wants ${need}.` };
    }

    p.gold -= q.gold;
    invTakeAll(this.state, q.mats);
    this.ctx.onGold?.();

    const r = reforgeAffix(uid, index);
    if (!r.ok) {
      // Nothing in the pool could replace this line. The charge is reversed
      // because no work was done — this is the one refund the design allows,
      // and it is a refund for a refusal rather than for a bad outcome.
      p.gold += q.gold;
      for (const m of q.mats) invAdd(this.state, m.id, m.n);
      this.ctx.onGold?.();
      return { ok: false, why: 'The Forge-Warden has nothing else to put there.' };
    }

    this.state.reforged = this.state.reforged ?? {};
    this.state.reforged[uid] = q.prior + 1;

    const before = r.before!.name, after = r.after!.name;
    Sound.play('craft');
    this.ctx.toast(`${before} → ${after}`, 'info');
    this.ctx.log?.push('economy',
      `Forge-Warden reworked ${itemName(uid)}: ${before} → ${after} (${q.gold} gold)`, this.state.clock);
    this.ctx.vitals?.markAction?.();
    return { ok: true, before, after };
  }
}

export { HUB_SLOTS, SEALS };
export type { RolledItem };
