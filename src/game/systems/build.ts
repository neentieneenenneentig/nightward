// Build mode: pick a blueprint, a ghost follows the pointer, click/tap a
// valid tile to place. Costs & rules from data; walls chain-place.
import { CFG } from '../data/config';
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { MATERIALS } from '../data/materials';
import { invCount, invHasAll, invTakeAll } from '../rules';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface BuildMode {
  def: BuildingDef;
  tx: number;
  ty: number;
  valid: boolean;
  lastTx: number; // tile just built on (silences the re-place toast on release)
  lastTy: number;
}

export class BuildSystem {
  mode: BuildMode | null = null;
  private enteredAt = 0; // guards against the entry click falling through to the canvas
  private idx = 0;       // carousel position, remembered across build sessions

  constructor(private ctx: any) {}

  /** Blueprints you can currently pick: everything except already-built uniques.
   * Missing materials do NOT hide a blueprint — you can browse it, just not place. */
  private selectable(): BuildingDef[] {
    const { state } = this.ctx;
    return BUILDINGS.filter((b) => !(b.unique && state.buildings.some((x: any) => x.type === b.id)));
  }

  /** B key / Build button: enter placement browsing where you left off. */
  start() {
    const list = this.selectable();
    if (!list.length) return;
    this.idx = Math.min(this.idx, list.length - 1);
    this.beginWith(list[this.idx]);
  }

  /** Jump straight to one blueprint (kept for hooks/tests). */
  enter(id: string) {
    const def = BUILDINGS.find((b) => b.id === id);
    if (!def) return;
    if (def.unique && this.ctx.state.buildings.some((b: any) => b.type === id)) {
      this.ctx.toast(`You already have a ${def.name}`, 'bad');
      return;
    }
    const at = this.selectable().findIndex((b) => b.id === id);
    if (at >= 0) this.idx = at;
    this.beginWith(def);
  }

  private beginWith(def: BuildingDef) {
    const { state } = this.ctx;
    // keep the ghost where it was if already browsing; else start in front of the player
    const tx = this.mode ? this.mode.tx : Math.floor(state.player.x / TILE);
    const ty = this.mode ? this.mode.ty : Math.floor(state.player.y / TILE) - 1;
    this.mode = { def, tx, ty, valid: false, lastTx: NaN, lastTy: NaN };
    this.enteredAt = performance.now();
    this.validate();
    this.updateBanner();
  }

  /** Tab / wheel / arrow buttons: flip to the next (or previous) blueprint. */
  cycle(dir: number) {
    const m = this.mode;
    if (!m) return;
    const list = this.selectable();
    if (!list.length) return;
    const cur = list.findIndex((b) => b.id === m.def.id);
    this.idx = ((cur >= 0 ? cur : this.idx) + dir + list.length) % list.length;
    m.def = list[this.idx];
    m.lastTx = NaN; m.lastTy = NaN;
    this.validate();
    this.updateBanner();
  }

  /** How many more of the current blueprint the inventory can pay for. */
  private affordable(): number {
    const m = this.mode!;
    if (m.def.unique) return 1;
    return Math.min(...m.def.cost.map((c) => Math.floor(invCount(this.ctx.state, c.id) / c.n)));
  }

  private updateBanner() {
    const m = this.mode;
    this.ctx.setBuildBanner?.(m ? { def: m.def, afford: this.affordable() } : null);
  }

  cancel() {
    this.mode = null;
    this.ctx.views.setGhost(null);
    this.ctx.setBuildBanner?.(null);
  }

  /** Pointer moved over the canvas (screen px). */
  hover(sx: number, sy: number) {
    if (!this.mode) return;
    const [wx, wy] = this.ctx.cam.toWorld(sx, sy);
    this.mode.tx = Math.floor(wx / TILE);
    this.mode.ty = Math.floor(wy / TILE);
    this.validate();
  }

  private validate() {
    const m = this.mode!;
    const { state, world } = this.ctx;
    m.valid =
      world.canPlaceAt(m.tx, m.ty, m.def.id === 'hall') &&
      invHasAll(state, m.def.cost);
    const rangePx = m.def.tower ? m.def.tower.rangeTiles * TILE : 0;
    this.ctx.views.setGhost(m.def.id, m.tx, m.ty, m.valid, rangePx);
  }

  /** Pointer released — try to place at the release point. */
  place(sx: number, sy: number) {
    const m = this.mode;
    if (!m) return;
    // the click that chose the blueprint (or its spam-siblings) must not fall
    // through the closing menu and place — placement needs a deliberate click
    if (performance.now() - this.enteredAt < 350) return;
    this.hover(sx, sy);
    if (!m.valid) {
      // releasing on the tile a drag-paint just filled isn't an error
      if (m.tx !== m.lastTx || m.ty !== m.lastTy) this.ctx.toast(this.placeError(), 'bad');
      return;
    }
    this.commit();
  }

  /** Why the current spot is invalid — mirrors world.canPlaceAt's checks, in
   * the same order, so the toast names the actual blocker instead of a
   * generic catch-all (R1.5: playtest flagged the old message as unhelpful). */
  private placeError(): string {
    const m = this.mode!;
    const { state, world } = this.ctx;
    if (!invHasAll(state, m.def.cost)) return 'Not enough materials';
    if (world.buildingAt(m.tx, m.ty)) return "Something's already built there";
    const f = world.featureAt(m.tx, m.ty);
    if (f && f.blocking && !world.isDepleted(m.tx, m.ty)) return `Blocked by ${f.name} — clear it first`;
    const mat = MATERIALS[world.materialAt(m.tx, m.ty)];
    if (!mat.passable || !mat.buildable) return `Can't build on ${cap(mat.name)}`;
    const h = state.buildings.find((b: any) => b.type === 'hall');
    if (m.def.id !== 'hall') {
      if (!h) return 'Build the Racket Hall first — everything roots to it';
      const d = Math.max(Math.abs(m.tx - h.tx), Math.abs(m.ty - h.ty));
      if (d > CFG.build.maxDistFromHall) return `Too far from the Hall (max ${CFG.build.maxDistFromHall} tiles)`;
    }
    return "Can't build there";
  }

  /** Pointer dragged with the button held — paint walls along the path. */
  paint(sx: number, sy: number) {
    const m = this.mode;
    if (!m || !m.def.dragPaint) { this.hover(sx, sy); return; }
    if (performance.now() - this.enteredAt < 350) return;
    this.hover(sx, sy);
    if (m.valid && (m.tx !== m.lastTx || m.ty !== m.lastTy)) this.commit();
  }

  private commit() {
    const m = this.mode!;
    const { state, world, toast } = this.ctx;
    invTakeAll(state, m.def.cost);
    const b = { uid: state.nextUid++, type: m.def.id, tx: m.tx, ty: m.ty, hp: m.def.hp };
    state.buildings.push(b);
    world.reindexBuildings();
    this.ctx.views.addBuilding(b);
    this.ctx.fire?.onBuildingAdded(b);
    if (m.def.id === 'wall') this.ctx.views.refreshWallsAround(m.tx, m.ty);
    m.lastTx = m.tx; m.lastTy = m.ty;
    Sound.play('build');
    toast(`${m.def.name} built`);
    this.ctx.log?.push('build', `Built ${m.def.name} at (${m.tx},${m.ty})`, state.clock);
    if (m.def.id === 'hall') toast('The racket is open for business.', 'good');

    // keep placing (walls!) while materials last; otherwise drop out of mode
    if (!m.def.unique && invHasAll(state, m.def.cost)) { this.validate(); this.updateBanner(); }
    else this.cancel();
  }
}
