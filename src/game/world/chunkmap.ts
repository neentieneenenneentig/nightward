// Streaming renderer for the infinite world: 16×16-tile chunks baked into ONE
// texture each. Gathering a node or a respawn triggers a rebake of just that
// chunk — the rest of the world doesn't notice.
import { Container, Sprite, Texture } from 'pixi.js';
import { hash2 } from '../../engine/rng';
import { TILE } from './worldgen';
import type { World } from './world';
import type { WorldArt } from './art';

const CHUNK = 16;               // tiles per chunk side
export const CHUNK_PX = CHUNK * TILE;

export class ChunkMap {
  private chunks = new Map<string, { sprite: Sprite; tex: Texture }>();

  constructor(
    private world: World,
    private art: WorldArt,
    private layer: Container,
  ) {}

  /** Keep chunks loaded around world-pixel (px, py) for a view of viewW×viewH. */
  ensureAround(px: number, py: number, viewW: number, viewH: number) {
    const r = Math.ceil(Math.max(viewW, viewH) / 2 / CHUNK_PX) + 1;
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);

    for (let cy = ccy - r; cy <= ccy + r; cy++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const key = cx + ',' + cy;
        if (!this.chunks.has(key)) this.chunks.set(key, this.bake(cx, cy));
      }
    }
    for (const [key, c] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) > r + 2) {
        c.sprite.destroy();
        c.tex.destroy(true);
        this.chunks.delete(key);
      }
    }
  }

  /** Re-bake the chunk containing a tile (e.g. after gathering/respawn). */
  rebakeTile(tx: number, ty: number) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    this.rebuild(cx, cy);
    // tall sprites (trees) poke into the chunk above across its south border
    if (((ty % CHUNK) + CHUNK) % CHUNK === 0) this.rebuild(cx, cy - 1);
  }

  /** Re-bake every chunk touched by a batch of changed tiles (from the world
   * core's event drain), each at most once. Deduping is what keeps R2's fire
   * from thrashing the baker. Returns how many loaded chunks were rebuilt. */
  rebakeTiles(tiles: [number, number][]): number {
    if (!tiles.length) return 0;
    const dirty = new Set<string>();
    for (const [tx, ty] of tiles) {
      const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
      dirty.add(cx + ',' + cy);
      // south-border tree rule: tall sprites poke up into the chunk above
      if (((ty % CHUNK) + CHUNK) % CHUNK === 0) dirty.add(cx + ',' + (cy - 1));
    }
    let n = 0;
    for (const key of dirty) {
      if (!this.chunks.has(key)) continue; // not loaded — will bake fresh when scrolled in
      const [cx, cy] = key.split(',').map(Number);
      this.rebuild(cx, cy);
      n++;
    }
    return n;
  }

  private rebuild(cx: number, cy: number) {
    const key = cx + ',' + cy;
    const c = this.chunks.get(key);
    if (!c) return; // not loaded — will bake fresh when scrolled into view
    c.sprite.destroy();
    c.tex.destroy(true);
    this.chunks.set(key, this.bake(cx, cy));
  }

  private bake(cx: number, cy: number) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d')!;

    // ground — read the EFFECTIVE material (procgen base + any override), never
    // gen.tileAt directly, so painted tiles bake with their new material's art
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        ctx.drawImage(this.art.tile(this.world.materialAt(gtx, gty), gtx, gty), tx * TILE, ty * TILE);
      }
    }
    // features — include one extra row south of the chunk, because tall
    // sprites poke upward across the border; both chunks draw them identically
    for (let ty = 0; ty <= CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const f = this.world.featureAt(gtx, gty);
        if (!f) continue;

        let img: HTMLCanvasElement;
        if (this.world.isDepleted(gtx, gty)) {
          if (f.depleted !== 'stump') continue;
          img = this.art.stump;
        } else {
          img = this.art.feature(f.id, gtx, gty);
        }
        // deterministic jitter breaks the grid-planted look; x stays within
        // the tile so sprites never cross a chunk's side border
        const jx = ((hash2(gtx, gty, 0x1a17) * 7) | 0) - 3;
        const jy = (hash2(gtx, gty, 0x9b3) * 4) | 0;
        ctx.drawImage(img, tx * TILE + ((TILE - img.width) >> 1) + jx, ty * TILE + TILE - img.height + jy);
      }
    }

    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    const sprite = new Sprite(tex);
    sprite.position.set(cx * CHUNK_PX, cy * CHUNK_PX);
    this.layer.addChild(sprite);
    return { sprite, tex };
  }
}
