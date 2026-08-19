// Firemaking: everything fire-adjacent that isn't the simulation itself. World/WorldCore stay
// generic CA plumbing; this is where "what does a burning tile MEAN for the game" lives — torch
// ignition, controlled-burn charcoal, entity burn damage, and campfires as eternal ignition points.
import { CFG } from '../data/config';
import { MATERIALS } from '../data/materials';
import { addXp, invAdd } from '../rules';
import { tileKey, type Building } from '../state';
import { TILE } from '../world/worldgen';
import { levelUpFlourish } from './flourish';

export class FireSystem {
  // tileKey -> the material a tracked controlled burn should yield if it's the player's doing —
  // lets onWorldEvents tell "my ignition finished" apart from "spread/paint touched this tile".
  private ignitedByPlayer = new Map<string, { expectMat: number }>();
  private dmgT = 0; // shared throttle timer for the burn-damage tick

  constructor(private ctx: any) {}

  /** F key / Ignite button: nearest eligible tile within reach, if the player carries a torch. */
  tryIgnite() {
    const { state, toast } = this.ctx;
    if ((state.player.inv.torch ?? 0) <= 0) { toast('You need a torch for that', 'bad'); return; }
    const target = this.findIgniteTarget();
    if (!target) { toast('Nothing to burn nearby', 'bad'); return; }
    this.ignite(target.tx, target.ty);
  }

  /** Nearest tile within reach that's flammable, unlit, and still has fuel — same 5x5-tile scan
   * shape as GatherSystem.findTarget. */
  private findIgniteTarget(): { tx: number; ty: number } | null {
    const { state, world, worldCore } = this.ctx;
    const { x, y } = state.player;
    const ptx = Math.floor(x / TILE), pty = Math.floor(y / TILE);
    const reachPx = CFG.fire.reachTiles * TILE;
    let best: { tx: number; ty: number } | null = null, bestD = Infinity;
    for (let ty = pty - 2; ty <= pty + 2; ty++) {
      for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
        const mat = MATERIALS[world.materialAt(tx, ty)];
        if (mat.flammable <= 0 || worldCore.isBurning(tx, ty) || worldCore.fuelAt(tx, ty) <= 0) continue;
        if (worldCore.wetAt(tx, ty) >= CFG.fire.wetExtinguish) continue; // too wet to catch — don't offer it
        const d = Math.hypot((tx + 0.5) * TILE - x, (ty + 0.5) * TILE - y);
        if (d <= reachPx && d < bestD) { best = { tx, ty }; bestD = d; }
      }
    }
    return best;
  }

  /** Direct action — also used by the console/acceptance harness. */
  ignite(tx: number, ty: number): boolean {
    const { state, world, worldCore, toast, log } = this.ctx;
    if (!worldCore.ignite(tx, ty)) { toast("That won't catch", 'bad'); return false; }
    const expectMat = MATERIALS[world.materialAt(tx, ty)].burnsTo;
    this.ignitedByPlayer.set(tileKey(tx, ty), { expectMat });
    const lvl = addXp(state, 'firemaking', CFG.fire.ignitionXp);
    toast('The flame catches.', 'good');
    log?.push('world', `Set fire to (${tx},${ty})`, state.clock);
    if (lvl) { levelUpFlourish(this.ctx); toast(`Firemaking reached level ${lvl}!`, 'good'); log?.push('level', `Firemaking reached level ${lvl}`, state.clock); }
    return true;
  }

  /** Building placed/destroyed — a campfire is literally an eternal ignition point on its tile. */
  onBuildingAdded(b: Building) { if (b.type === 'campfire') this.ctx.worldCore.addCampfire(b.tx, b.ty); }
  onBuildingRemoved(b: Building) { if (b.type === 'campfire') this.ctx.worldCore.removeCampfire(b.tx, b.ty); }

  /** Called from main.ts right after worldCore.drainEvents() — pays out charcoal for any tracked
   * controlled burn that just finished. */
  onWorldEvents(changed: [number, number][]) {
    const { world, state, toast, log } = this.ctx;
    for (const [tx, ty] of changed) {
      const key = tileKey(tx, ty);
      const tracked = this.ignitedByPlayer.get(key);
      if (!tracked) continue;
      this.ignitedByPlayer.delete(key);
      if (world.materialAt(tx, ty) !== tracked.expectMat) continue; // something else touched it
      if (Math.random() < CFG.fire.charcoalChance) {
        invAdd(state, 'charcoal', 1);
        const lvl = addXp(state, 'firemaking', CFG.fire.charcoalXp);
        toast('+1 Charcoal from the embers', 'good');
        log?.push('gather', `Collected charcoal from a controlled burn at (${tx},${ty})`, state.clock);
        if (lvl) { levelUpFlourish(this.ctx); toast(`Firemaking reached level ${lvl}!`, 'good'); log?.push('level', `Firemaking reached level ${lvl}`, state.clock); }
      }
    }
  }

  /** Sim tick: entity burn damage (throttled so it reads as periodic ticks, not per-frame spam)
   * and a sweep for tracked ignitions that were doused by wetness rather than burning out —
   * those never reach onWorldEvents (only a completed burnout pushes a changed-tile event), so
   * without this they'd sit in ignitedByPlayer for the rest of the session. */
  update(dt: number) {
    const { state, world, worldCore, hordes, damagePlayer } = this.ctx;

    for (const [key, tracked] of this.ignitedByPlayer) {
      const [tx, ty] = key.split(',').map(Number);
      if (worldCore.isBurning(tx, ty)) continue; // still burning — wait for its burnout event
      if (world.materialAt(tx, ty) !== tracked.expectMat) this.ignitedByPlayer.delete(key);
    }

    this.dmgT -= dt;
    if (this.dmgT > 0) return;
    this.dmgT = CFG.fire.burnTickSec;
    const dmg = CFG.fire.burnDmgPerSec * CFG.fire.burnTickSec;
    const ptx = Math.floor(state.player.x / TILE), pty = Math.floor(state.player.y / TILE);
    if (worldCore.isBurning(ptx, pty)) damagePlayer(dmg, 'Fire');
    for (const f of hordes.foes) {
      const ftx = Math.floor(f.x / TILE), fty = Math.floor(f.y / TILE);
      if (worldCore.isBurning(ftx, fty)) hordes.hurt(f, dmg, false);
    }
  }
}
