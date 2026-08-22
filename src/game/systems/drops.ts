// B5 — Ground Drops. Loot lands on the floor; you walk over it to pick it up.
//
// Before this, all three loot sources (gathering, horde kills, world-boss kills)
// ended in the same two lines — invAdd + acquireGear — and the item teleported
// into the bag. This system replaces that one seam at all three sites. Every
// modifier upstream (mega-cluster area rolls, Loom double-yield, Granary,
// Battery Scarcity, material yield) still runs first and still produces the
// final Stack[]; B5 only changes where those stacks land.
//
// Three beats, and skipping any one is what makes ground loot feel WORSE than
// instant pickup rather than better:
//   1. the toss  — the item visibly leaves the tree/corpse, ~0.45 s arc
//   2. the rest  — it sits with a contact shadow, bobbing so the eye finds it
//   3. the collect — walk near, it snaps to you, it lands in the bag
import { CFG } from '../data/config';
import { GOLD_ID, ITEMS, itemDef } from '../data/items';
import { acquireGear, invAdd } from '../rules';
import { fortuneFrom, rollStacks } from './loot';
import { rarityColor, rarityIndex, rarityOf } from '../ui/rarity';
import type { RollOpts } from './loot';
import type { GameState, GroundDrop } from '../state';
import type { Stack } from '../types';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';

/** "Gear" = anything the player would be upset to lose to a timer. Derived from
 *  the existing ITEMS columns rather than a new data field, so there are no rows
 *  to maintain and a new weapon is automatically exempt. */
export function isGear(id: string): boolean {
  const it = itemDef(id);
  if (!it) return false;
  return !!(it.weaponDmg || it.armor || it.trinket || it.relic || it.toolClass);
}

/** The name a pickup toast prints. GOLD_ID has no ITEMS row by design, so
 *  itemDef() cannot answer for it and the `?? id` fallback would print "@gold". */
function dropName(id: string): string {
  return id === GOLD_ID ? 'gold' : (itemDef(id)?.name ?? id);
}

interface DropCtx {
  state: GameState;
  world: { canStand(px: number, py: number, halfW?: number): boolean };
  player: { x: number; y: number };
  toast?: (m: string, k?: string, color?: string) => void;
  particles?: { spawn(kind: string, x: number, y: number, n: number, dir?: number): void };
  /** A1: the Fortune mapping. Assigned onto the shared ctx after this system is
   *  constructed, which is fine — spawn() reads it at call time, not at
   *  construction. Optional because the Gauntlet builds drop systems headless. */
  net?: { getGameValue?(target: string): number; lastRiftTime?: number };
}

export class DropSystem {
  private lastSfxT = -999;
  /** Pickups inside CFG.drops.toastWindowSec collapse into one line. A night-2
   *  wave is 43 foes; one toast per stack is a wall of text, not feedback. */
  private pending = new Map<string, number>();
  private pendingT = -1;

  constructor(private ctx: DropCtx) {}

  get count() { return this.ctx.state.drops.length; }

  /** The one call site that replaces invAdd/acquireGear at all three loot sources.
   *  (x, y) is the world-pixel origin of the toss — the node, or the corpse. */
  spawn(stacks: Stack[], x: number, y: number, opts: { spread?: number; band?: RollOpts['band'] } = {}) {
    const { state } = this.ctx;
    const D = CFG.drops;

    // A1 — the roll happens HERE, at the one seam B5 already funnelled all
    // three loot sources through (gathering, horde kills, world-boss kills).
    // Doing it at the three call sites instead would have been three chances
    // to forget one, and the one you forget is invisible: a source that never
    // rolls just quietly drops Plain forever.
    //
    // Materials pass through untouched and keep stacking. Gear becomes one
    // unique id per unit, which is also why findMergeTarget() below stops
    // merging gear for free — two rolled swords have different ids, so the
    // id-equality check that merges timber can never merge them.
    // The torn realm gives up things it should not. For CFG.loot.riftWindowSec
    // after a rift, ordinary drops roll on the `rift` band — the only route to
    // a Riftborn item in the game.
    //
    // This is what makes a rift an EVENT rather than a colour change. N4.3 gave
    // the rift its first working trigger on desktop (a hard latency step); this
    // gives it its first reason to want one. An explicit band from the caller
    // always wins, so a lord killed during a rift still rolls the lord band.
    const rift = this.ctx.net?.lastRiftTime ?? 0;
    const inRift = rift > 0 && (performance.now() - rift) < CFG.loot.riftWindowSec * 1000;

    stacks = rollStacks(stacks, {
      band: opts.band ?? (inRift ? 'rift' : 'common'),
      fortune: fortuneFrom(this.ctx.net),
      clock: state.clock,
    });

    // The escape hatch. With drops disabled this is byte-for-byte the pre-B5
    // behaviour, which is what makes a negative playtest verdict a config edit
    // rather than a revert.
    if (!D.enabled) {
      for (const d of stacks) {
        if (d.n > 0) { invAdd(state, d.id, d.n); acquireGear(state, d.id); this.queueToast(d.id, d.n); }
      }
      return;
    }

    const spread = opts.spread ?? 1;
    for (const st of stacks) {
      if (st.n <= 0) continue;
      const ang = Math.random() * Math.PI * 2;
      const spd = (D.tossSpeed[0] + Math.random() * (D.tossSpeed[1] - D.tossSpeed[0])) * spread;

      // Merge before spawning: a mega-cluster gather can roll the same id sixteen
      // times, and sixteen identical icons in one pile reads as one icon.
      const near = this.findMergeTarget(st.id, x, y);
      if (near && near.n + st.n <= D.mergeMaxN) { near.n += st.n; continue; }

      state.drops.push({
        uid: state.nextUid++,
        id: st.id,
        n: st.n,
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.7,   // squashed: the world is drawn in 3/4 view
        hopT: D.tossSec,
        hopH: 0,
        bornT: state.clock,
        magnet: false,
        gear: isGear(st.id),
      });
    }
    this.enforceCap();
  }

  /** B5 Q2 — the one seam every gold award in the game passes through.
   *
   *  It decides, from CFG, whether an award becomes a pile on the floor or a
   *  direct credit, and then does it. The decision lives HERE rather than at the
   *  two call sites for the same reason A1's rarity roll moved into spawn():
   *  two call sites is two chances to forget one, and the one you forget is
   *  invisible — a gold source that never bursts just quietly keeps teleporting.
   *
   *  `boss` is the caller's claim about the kill, not a lookup, because the two
   *  callers disagree about where that fact lives: hordes.ts reads f.def.boss
   *  off the enemy row, and worldbosses.ts has no enemy row at all — a domain
   *  lord is a boss by construction.
   */
  awardGold(amount: number, x: number, y: number, boss: boolean) {
    const { state } = this.ctx;
    amount = Math.max(0, Math.round(amount));
    if (amount <= 0) return;

    // CFG.drops.enabled is the whole ground-loot escape hatch. If it is off,
    // coins must fall back to a credit too — a build with drops disabled that
    // still scattered gold on the floor would be neither of the two behaviours
    // anyone asked for.
    const mode = CFG.drops.goldDrops;
    const burst = CFG.drops.enabled && (mode === 'all' || (mode === 'boss' && boss));
    if (!burst) { state.player.gold += amount; return; }

    const D = CFG.drops;
    const [cMin, cMax] = D.coinBurst;
    // Never more coins than gold: a 3-gold award split seven ways would need
    // fractional coins, and rounding them would either invent or destroy gold.
    const coins = Math.max(1, Math.min(amount, cMin + Math.floor(Math.random() * (cMax - cMin + 1))));

    let left = amount;
    for (let i = 0; i < coins; i++) {
      const rest = coins - i - 1;
      // Integer shares that sum to `amount` EXACTLY. Each coin takes about an
      // even share of what is left, clamped so every coin still behind it can
      // be worth at least 1, and the last one closes the books with whatever
      // remains. The total a player picks up is the total that was awarded —
      // a burst must never be a stealth nerf or a stealth buff to gold income.
      const n = i === coins - 1
        ? left
        : Math.min(left - rest, Math.max(1, Math.round(left / (coins - i))));
      left -= n;

      const ang = Math.random() * Math.PI * 2;
      const spd = (D.tossSpeed[0] + Math.random() * (D.tossSpeed[1] - D.tossSpeed[0])) * D.coinSpread;
      // Pushed directly rather than through spawn(): a pile must NOT merge (the
      // pile is the point, and mergePx would collapse all of it into one coin at
      // the corpse's own position), and it must not go through rollStacks(),
      // which would try to roll a rarity for an id that has no ITEMS row.
      state.drops.push({
        uid: state.nextUid++,
        id: GOLD_ID,
        n,
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.7,
        hopT: D.tossSec,
        hopH: 0,
        bornT: state.clock,
        magnet: false,
        gear: false,     // coins rot like any material; the pile is under your feet already
      });
    }
    this.enforceCap();
  }

  private findMergeTarget(id: string, x: number, y: number): GroundDrop | null {
    const r2 = CFG.drops.mergePx * CFG.drops.mergePx;
    for (const d of this.ctx.state.drops) {
      if (d.id !== id || d.hopT > 0) continue;
      const dx = d.x - x, dy = d.y - y;
      if (dx * dx + dy * dy <= r2) return d;
    }
    return null;
  }

  update(dt: number) {
    const { state, world, player } = this.ctx;
    const drops = state.drops;
    if (!drops.length) { this.flushToasts(); return; }

    const D = CFG.drops;
    const magnetR = D.magnetTiles * TILE;
    const magnetR2 = magnetR * magnetR;
    const pickR2 = D.pickupPx * D.pickupPx;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      if (d.hopT > 0) {
        // --- 1. the toss ---
        d.hopT -= dt;
        const t = 1 - Math.max(0, d.hopT) / D.tossSec;   // 0 at throw, 1 at landing
        // The arc is drawn, not simulated: a parabola over normalised time. Only
        // hopH depends on it, so the pickup maths never sees the third dimension.
        d.hopH = D.hopHeight * 4 * t * (1 - t);
        const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
        // Clamp the LANDING, not the flight: an item may sail over a cliff lip,
        // but it must never come to rest anywhere the player cannot reach it.
        if (world.canStand(nx, ny, 2)) { d.x = nx; d.y = ny; }
        else { d.vx = 0; d.vy = 0; }
        const decay = Math.pow(0.02, dt);   // ~98%/s bleed-off, frame-rate independent
        d.vx *= decay; d.vy *= decay;
        if (d.hopT <= 0) { d.hopT = 0; d.hopH = 0; d.vx = 0; d.vy = 0; }
        continue;
      }

      const dx = player.x - d.x, dy = player.y - d.y;
      const dist2 = dx * dx + dy * dy;

      // --- 3. the collect (tested first: a latched drop that has arrived should
      // not spend a frame accelerating past the player) ---
      if (dist2 <= pickR2 && this.armed(d)) { this.collect(d); drops.splice(i, 1); continue; }

      // --- 2. the magnet ---
      // Latching rather than re-testing every frame: an item that has started
      // flying at you finishes the journey instead of stalling the moment you
      // turn away, which reads as the item being yanked out of your hand.
      if (!d.magnet && dist2 <= magnetR2 && this.armed(d)) d.magnet = true;
      if (d.magnet) {
        const dist = Math.sqrt(dist2) || 1;
        d.vx += (dx / dist) * D.magnetAccel * dt;
        d.vy += (dy / dist) * D.magnetAccel * dt;
        const sp = Math.hypot(d.vx, d.vy);
        if (sp > D.magnetMaxSpeed) { d.vx = (d.vx / sp) * D.magnetMaxSpeed; d.vy = (d.vy / sp) * D.magnetMaxSpeed; }
        // no canStand clamp here — it is flying to the player, who is by
        // definition standing somewhere standable
        d.x += d.vx * dt; d.y += d.vy * dt;
        continue;
      }

      // --- 4. despawn ---
      // N4.6 Drop Memory: how long the ground remembers what fell on it, scaled
      // by the vessel's own storage headroom. A full hold lets go sooner. Gear
      // is exempt above whatever the wire says — the one thing a player must
      // never lose to a machine-shaped reason is the item they were walking to.
      if (d.gear && D.gearNeverDespawns) continue;
      const memory = D.despawnSec * (this.ctx.net?.getGameValue?.('dropMemory') ?? 1);
      if (state.clock - d.bornT >= memory) drops.splice(i, 1);
    }

    this.flushToasts();
  }

  private armed(d: GroundDrop): boolean {
    // Without this, gathering at point-blank range collects instantly and the
    // whole feature is invisible — you never see the item exist.
    return this.ctx.state.clock - d.bornT >= CFG.drops.armDelaySec;
  }

  /** Where a picked-up stack actually goes. Gold is a scalar on the player, not
   *  a row in the bag: handing GOLD_ID to invAdd would create an inventory entry
   *  for an item that does not exist, and acquireGear would ask itemDef() about
   *  it and get undefined. One function, so the magnet path and collectAll()
   *  cannot drift apart on it. */
  private bank(id: string, n: number) {
    const { state } = this.ctx;
    if (id === GOLD_ID) { state.player.gold += n; return; }
    invAdd(state, id, n);
    acquireGear(state, id);            // auto-equip now happens at pickup, not at roll
  }

  private collect(d: GroundDrop) {
    const { state } = this.ctx;
    this.bank(d.id, d.n);
    this.queueToast(d.id, d.n);
    this.playSfx();
    this.ctx.particles?.spawn?.('spark', d.x, d.y, 3);
  }

  /** Pickup is a HIGH-FREQUENCY event — 43 foes a night, 16 rolls per mega-cluster.
   *  An unguarded blip per stack is the same mistake as the deathWhistle that was
   *  rolled back on 2026-08-14: intensity that is always on stops reading as
   *  intensity. Hard-limited to one play per sfxMinGapSec. */
  private playSfx() {
    const now = this.ctx.state.clock;
    if (now - this.lastSfxT < CFG.drops.sfxMinGapSec) return;
    this.lastSfxT = now;
    Sound.play('gold');
  }

  private queueToast(id: string, n: number) {
    this.pending.set(id, (this.pending.get(id) ?? 0) + n);
    if (this.pendingT < 0) this.pendingT = this.ctx.state.clock;
  }

  private flushToasts() {
    if (this.pendingT < 0) return;
    if (this.ctx.state.clock - this.pendingT < CFG.drops.toastWindowSec) return;
    const parts: string[] = [];
    // A4: the collapsed line takes the colour of the BEST thing in it. A window
    // that collapsed a Hallowed blade in with four stacks of timber and printed
    // the whole line in bone would bury the one event worth noticing.
    let best = 'plain', color: string | undefined;
    for (const [id, n] of this.pending) {
      parts.push(`+${n} ${dropName(id)}`);
      const r = rarityOf(id);
      if (rarityIndex(r) > rarityIndex(best as any)) { best = r; color = rarityColor(id); }
    }
    this.pending.clear();
    this.pendingT = -1;
    if (parts.length) this.ctx.toast?.(parts.join('  '), undefined, color);
  }

  /** Over the cap, evict oldest non-gear first. Gear is never evicted — losing a
   *  relic to an array limit is not a gameplay consequence, it is a bug. */
  private enforceCap() {
    const drops = this.ctx.state.drops;
    let over = drops.length - CFG.drops.maxDrops;
    if (over <= 0) return;
    for (let i = 0; i < drops.length && over > 0; ) {
      if (drops[i].gear) { i++; continue; }
      drops.splice(i, 1); over--;
    }
  }

  /** Test/debug helper. Deliberately NOT used by any acceptance test for the
   *  magnet — a test that banks loot through this path would pass without ever
   *  exercising the mechanic, which is the tautology pattern that has burned
   *  this project three times. */
  collectAll() {
    const drops = this.ctx.state.drops;
    for (const d of drops) this.bank(d.id, d.n);
    drops.length = 0;
  }
}
