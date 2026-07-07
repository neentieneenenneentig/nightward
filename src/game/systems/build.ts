// Build mode: pick a blueprint, a ghost follows the pointer, click/tap a
// valid tile to place. Costs & rules from data; walls chain-place.
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { ITEMS } from '../data/items';
import { invCount, invHasAll, invTakeAll } from '../rules';
import { TILE } from '../world/worldgen';
import { Sound } from '../../engine/audio';

export interface BuildMode {
  def: BuildingDef;
  tx: number;
  ty: number;
  valid: boolean;
}

export class BuildSystem {
  mode: BuildMode | null = null;

  constructor(private ctx: any) {}

  enter(id: string) {
    const { state, toast } = this.ctx;
    const def = BUILDINGS.find((b) => b.id === id);
    if (!def) return;
    if (def.unique && state.buildings.some((b: any) => b.type === id)) {
      toast(`You already have a ${def.name}`, 'bad');
      return;
    }
    if (!invHasAll(state, def.cost)) {
      const miss = def.cost
        .filter((c) => invCount(state, c.id) < c.n)
        .map((c) => `${c.n - invCount(state, c.id)} more ${ITEMS[c.id].name}`)
        .join(', ');
      toast(`Need ${miss}`, 'bad');
      return;
    }
    // ghost starts at the tile in front of the player
    const tx = Math.floor(state.player.x / TILE);
    const ty = Math.floor(state.player.y / TILE) - 1;
    this.mode = { def, tx, ty, valid: false };
    this.validate();
    this.ctx.setBuildBanner?.(def.name);
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
    this.ctx.views.setGhost(m.def.id, m.tx, m.ty, m.valid);
  }

  /** Pointer pressed — try to place. */
  place(sx: number, sy: number) {
    const m = this.mode;
    if (!m) return;
    this.hover(sx, sy);
    const { state, world, toast } = this.ctx;
    if (!m.valid) {
      toast("Can't build there", 'bad');
      return;
    }
    invTakeAll(state, m.def.cost);
    const b = { uid: state.nextUid++, type: m.def.id, tx: m.tx, ty: m.ty, hp: m.def.hp };
    state.buildings.push(b);
    world.reindexBuildings();
    this.ctx.views.addBuilding(b);
    if (m.def.id === 'wall') this.ctx.views.refreshWallsAround(m.tx, m.ty);
    Sound.play('build');
    toast(`${m.def.name} built`);
    this.ctx.log?.push('build', `Built ${m.def.name} at (${m.tx},${m.ty})`, state.clock);
    if (m.def.id === 'hall') toast('The racket is open for business.', 'good');

    // keep placing (walls!) while materials last; otherwise drop out of mode
    if (!m.def.unique && invHasAll(state, m.def.cost)) this.validate();
    else this.cancel();
  }
}
