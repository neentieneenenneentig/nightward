// Streaming renderer for the infinite world: 16×16-tile chunks baked into ONE
// texture each. Gathering a node or a respawn triggers a rebake of just that
// chunk — the rest of the world doesn't notice.
import { Container, Sprite, Texture } from 'pixi.js';
import { hash2 } from '../../engine/rng';
import { darken, lighten, type RGB } from '../../engine/procgen/palette';
import { TILE, MEGA_SCAN, type MegaCluster } from './worldgen';
import { M, MATERIALS } from '../data/materials';
import { CFG } from '../data/config';
import type { World } from './world';
import type { WorldArt } from './art';

export const CHUNK = 16;               // tiles per chunk side
export const CHUNK_PX = CHUNK * TILE;

const EDGES: [number, number, 'N' | 'E' | 'S' | 'W'][] = [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']];
const WATER_FAMILY = new Set<number>([M.DEEP, M.WATER, M.SHALLOW]); // foam-eligible — not ICE

const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** A neighbor "outranks" a tile if it should feather ONTO the tile's edge —
 * higher heightClass wins (water blends under ground, ground under hill...);
 * ties break on material id, deterministic and symmetric-safe so exactly one
 * side of any differing border draws. */
function outranks(a: number, b: number): boolean {
  const ha = MATERIALS[a].heightClass, hb = MATERIALS[b].heightClass;
  return ha !== hb ? ha > hb : a > b;
}

interface Foam { view: Sprite; texs: Texture[] }
/** R2's fire glow: the same "chunk owns a secondary overlay sprite/texture, updated on its own
 * cadence" pattern foam pioneered — but re-rendered live from the fuel/burn fields every tick
 * instead of swapping between 3 pre-baked frames, since fire's footprint actually changes. */
interface Glow { view: Sprite; tex: Texture; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
interface Chunk { sprite: Sprite; tex: Texture; foam: Foam | null; glow: Glow | null }

const GLOW_RADIUS = 20; // px — bleeds a few px past the 32px tile so neighboring flame reads as one glow

export class ChunkMap {
  private chunks = new Map<string, Chunk>();
  private foamFrame = -1;
  private lastGlowMs = -1;

  // G1: SUBPIX LOD — player position for distance-based resolution
  private playerX = 0;
  private playerY = 0;

  constructor(
    private world: World,
    private art: WorldArt,
    private layer: Container,
  ) {}

  /** G1: Update player position for SUBPIX LOD distance calculation. */
  setPlayerPos(x: number, y: number) {
    this.playerX = x;
    this.playerY = y;
  }

  /** G1: Get SUBPIX factor for a chunk based on distance from player.
   *  SUBPIX disabled for now — needs proper micro-sprite generation from
   *  the procgen art pipeline, not just flat color blending.
   *  Near (≤3 chunks): ×4  |  Mid (3–6): ×2  |  Far (>6): ×1 */
  private subpixFactor(_cx: number, _cy: number): number {
    return 1; // SUBPIX disabled — revert to ×1 procgen tile art
  }

  /** Keep chunks loaded around world-pixel (px, py) for a view of viewW×viewH. */
  ensureAround(px: number, py: number, viewW: number, viewH: number) {
    const r = Math.ceil(Math.max(viewW, viewH) / 2 / CHUNK_PX) + 1;
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);

    for (let cy = ccy - r; cy <= ccy + r; cy++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const key = cx + ',' + cy;
        if (!this.chunks.has(key)) {
          const sf = this.subpixFactor(cx, cy);
          this.chunks.set(key, sf > 1 ? this.bakeSubpix(cx, cy, sf) : this.bake(cx, cy));
        }
      }
    }
    for (const [key, c] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) > r + 2) {
        this.destroyChunk(c);
        this.chunks.delete(key);
      }
    }
  }

  /** Re-bake the chunk containing a tile (e.g. after gathering/respawn). */
  rebakeTile(tx: number, ty: number) {
    const dirty = new Set<string>();
    this.dirtyFor(tx, ty, dirty);
    for (const key of dirty) {
      const [cx, cy] = key.split(',').map(Number);
      this.rebuild(cx, cy);
    }
  }

  /** Re-bake every chunk touched by a batch of changed tiles (from the world
   * core's event drain), each at most once. Deduping is what keeps R2's fire
   * from thrashing the baker. Returns how many loaded chunks were rebuilt. */
  rebakeTiles(tiles: [number, number][]): number {
    if (!tiles.length) return 0;
    const dirty = new Set<string>();
    for (const [tx, ty] of tiles) this.dirtyFor(tx, ty, dirty);
    let n = 0;
    for (const key of dirty) {
      if (!this.chunks.has(key)) continue; // not loaded — will bake fresh when scrolled in
      const [cx, cy] = key.split(',').map(Number);
      this.rebuild(cx, cy);
      n++;
    }
    return n;
  }

  /** Swap every loaded chunk's foam overlay to the current 5 Hz frame. Called
   * once per render frame. R2's fire glow reuses this per-chunk secondary
   * overlay pattern — don't invent a second mechanism, extend this one. */
  tickFoam(nowMs: number) {
    const frame = Math.floor(nowMs / 200) % 3;
    if (frame === this.foamFrame) return;
    this.foamFrame = frame;
    for (const c of this.chunks.values()) {
      if (c.foam) c.foam.view.texture = c.foam.texs[frame];
    }
  }

  /** Redraw every loaded chunk's fire glow overlay from the live burn[] field, ≤ CFG.fire.glowHz.
   * Lazily creates the overlay when a chunk first catches and tears it down once it's fully out
   * — most of the map pays nothing, same as foam. Called once per render frame from main.ts. */
  tickGlow(nowMs: number) {
    if (nowMs - this.lastGlowMs < 1000 / CFG.fire.glowHz) return;
    this.lastGlowMs = nowMs;
    for (const [key, c] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      const burn = this.world.core.burnView(cx, cy);
      let hasFire = false;
      if (burn) {
        for (let i = 0; i < burn.length; i++) {
          if (burn[i] > 0) { hasFire = true; break; }
        }
      }
      if (!hasFire) {
        if (c.glow) {
          c.glow.view.destroy();
          c.glow.tex.destroy(true);
          c.glow = null;
        }
        continue;
      }
      if (!c.glow) c.glow = this.makeGlow(cx, cy);
      this.redrawGlow(c.glow, burn!, cx, cy, nowMs);
    }
  }

  // ---- test-only debug hooks (acceptance checklist) -----------------------

  /** Sample one pixel from a loaded chunk's baked canvas at tile-local pixel
   * offset (offX,offY) (default: tile center). null if the chunk isn't loaded. */
  debugPixel(tx: number, ty: number, offX = 16, offY = 16): [number, number, number, number] | null {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const c = this.chunks.get(cx + ',' + cy);
    if (!c) return null;
    const canvas = (c.tex.source as any).resource as HTMLCanvasElement;
    const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
    const d = canvas.getContext('2d')!.getImageData(lx * TILE + offX, ly * TILE + offY, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  hasFoam(tx: number, ty: number): boolean {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    return !!this.chunks.get(cx + ',' + cy)?.foam;
  }

  hasGlow(tx: number, ty: number): boolean {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    return !!this.chunks.get(cx + ',' + cy)?.glow;
  }

  /** Sample one pixel from a loaded chunk's fire glow overlay canvas (not the base bake). null
   * if the chunk isn't loaded or has no active glow. */
  debugGlowPixel(tx: number, ty: number, offX = 16, offY = 16): [number, number, number, number] | null {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const glow = this.chunks.get(cx + ',' + cy)?.glow;
    if (!glow) return null;
    const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
    const d = glow.ctx.getImageData(lx * TILE + offX, ly * TILE + offY, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  // ---------------------------------------------------------------------

  /** Every chunk a changed tile's rendering might affect: its own chunk, plus
   * whichever neighbor chunk(s) it borders — dual-grid feathering and cliff
   * ledges read N/E/S/W neighbors, which may sit in an adjacent chunk. */
  private dirtyFor(tx: number, ty: number, dirty: Set<string>) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
    dirty.add(cx + ',' + cy);
    if (ly === 0) dirty.add(cx + ',' + (cy - 1));           // north chunk: tree-poke + feather/cliff
    if (ly === CHUNK - 1) dirty.add(cx + ',' + (cy + 1));   // south chunk's north-edge feather
    if (lx === 0) dirty.add((cx - 1) + ',' + cy);           // west chunk's east-edge feather
    if (lx === CHUNK - 1) dirty.add((cx + 1) + ',' + cy);   // east chunk's west-edge feather
  }

  private destroyChunk(c: Chunk) {
    c.sprite.destroy();
    c.tex.destroy(true);
    if (c.foam) {
      c.foam.view.destroy();
      for (const t of c.foam.texs) t.destroy(true);
    }
    if (c.glow) {
      c.glow.view.destroy();
      c.glow.tex.destroy(true);
    }
  }

  /** Lazily create a chunk's fire glow overlay — additive-blended, drawn on top of everything
   * else in the layer (base bake + foam), redrawn live by tickGlow. */
  private makeGlow(cx: number, cy: number): Glow {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d')!;
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    const view = new Sprite(tex);
    view.blendMode = 'add';
    view.position.set(cx * CHUNK_PX, cy * CHUNK_PX);
    this.layer.addChild(view);
    return { view, tex, canvas, ctx };
  }

  /** Redraw a chunk's glow canvas from its live burn[] snapshot (256 f32s) and re-upload the
   * texture. Flicker is entirely render-side — a hash of (global tile, time bucket) — decoupled
   * from the sim's strictly on/off `burn` value, which is the whole point of the boundary. */
  private redrawGlow(glow: Glow, burn: Float32Array, cx: number, cy: number, nowMs: number) {
    const { ctx } = glow;
    ctx.clearRect(0, 0, CHUNK_PX, CHUNK_PX);
    const timeBucket = Math.floor(nowMs / 80);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const i = ly * CHUNK + lx;
        if (burn[i] <= 0) continue;
        const tx = cx * CHUNK + lx, ty = cy * CHUNK + ly;
        const flicker = 0.75 + 0.25 * hash2(tx, ty, timeBucket ^ 0x2f1e);
        this.art.glow(ctx, lx * TILE + TILE / 2, ly * TILE + TILE / 2, GLOW_RADIUS, 0.5 * flicker);
      }
    }
    glow.tex.source.update();
  }

  private rebuild(cx: number, cy: number) {
    const key = cx + ',' + cy;
    const c = this.chunks.get(key);
    if (!c) return; // not loaded — will bake fresh when scrolled into view
    this.destroyChunk(c);
    const sf = this.subpixFactor(cx, cy);
    this.chunks.set(key, sf > 1 ? this.bakeSubpix(cx, cy, sf) : this.bake(cx, cy));
  }

  private isShoreTile(tx: number, ty: number): boolean {
    if (!WATER_FAMILY.has(this.world.materialAt(tx, ty))) return false;
    for (const [dx, dy] of EDGES) {
      if (!WATER_FAMILY.has(this.world.materialAt(tx + dx, ty + dy))) return true;
    }
    return false;
  }

  private bake(cx: number, cy: number): Chunk {
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

    // dual-grid transition pass — feather a differing neighbor's own texture
    // across the shared edge wherever it outranks this tile (see `outranks`)
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const m = this.world.materialAt(gtx, gty);
        for (const [dx, dy, edge] of EDGES) {
          const ngtx = gtx + dx, ngty = gty + dy;
          const nm = this.world.materialAt(ngtx, ngty);
          if (nm === m || !outranks(nm, m)) continue;
          this.art.feather(ctx, nm, ngtx, ngty, edge, tx * TILE, ty * TILE);
        }
      }
    }

    // cliff pass — a darker south-edge strip + a light top lip wherever height
    // drops toward the viewer; painter's-algorithm depth, zero geometry
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const m = this.world.materialAt(gtx, gty);
        const hT = MATERIALS[m].heightClass;
        const hS = MATERIALS[this.world.materialAt(gtx, gty + 1)].heightClass;
        if (hT <= hS) continue;
        const steep = hT - hS >= 2;
        const band = steep ? 10 : 7;
        const ramp = MATERIALS[m].art.ramp;
        const px0 = tx * TILE, py0 = ty * TILE + TILE - band;
        ctx.fillStyle = css(darken(ramp[0], steep ? 45 : 35));
        ctx.fillRect(px0, py0, TILE, band);
        ctx.fillStyle = css(lighten(ramp[2], 30));
        ctx.fillRect(px0, py0, TILE, 2);
      }
    }

    // G1: ambient occlusion — darken tiles adjacent to higher-height-class
    // neighbors. Baked once per chunk (zero per-frame cost). Max 15% darker.
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const hHere = MATERIALS[this.world.materialAt(gtx, gty)].heightClass;
        let ao = 0;
        for (const [dx, dy] of EDGES) {
          const hN = MATERIALS[this.world.materialAt(gtx + dx, gty + dy)].heightClass;
          if (hN > hHere) ao += 0.03;
        }
        if (ao <= 0) continue;
        const capped = Math.min(ao, 0.15);
        ctx.fillStyle = `rgba(0,0,0,${capped})`;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }

    // features — one per tile, plus mega-clusters drawn as ONE big chunky
    // sprite each. Both kinds anchor their feet to a row's south edge, so a
    // single top-to-bottom row walk keeps painter's-order depth: a thing
    // standing further south draws over the canopy of the thing behind it.
    // Mega roots can sit outside this chunk while the sprite pokes in, so
    // rows/columns scan a margin all around; both chunks draw them
    // identically, so there is no seam.
    const MM = MEGA_SCAN + 2;
    // collect every mega root whose sprite could touch this chunk
    const megaRoots: MegaCluster[] = [];
    for (let ty = -MM; ty <= CHUNK + MM; ty++) {
      for (let tx = -MM; tx < CHUNK + MM; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const mega = this.world.megaClusterAt(gtx, gty);
        if (mega && mega.rootTx === gtx && mega.rootTy === gty) megaRoots.push(mega);
      }
    }
    for (let ty = -MM; ty <= CHUNK + MM; ty++) {
      // mega clusters whose FEET land on this row (south edge = row bottom)
      for (const mega of megaRoots) {
        if (mega.rootTy + mega.size - 1 - cy * CHUNK !== ty) continue;

        const depleted = this.world.isDepleted(mega.rootTx, mega.rootTy);
        if (depleted && mega.def.depleted !== 'stump') continue;
        const img = depleted
          ? this.art.megaStump(mega.size)
          : this.art.megaFeature(mega.def.id, mega.rootTx, mega.rootTy, mega.size);

        const centerX = (mega.rootTx + mega.size / 2) * TILE - cx * CHUNK_PX;
        const southY = (mega.rootTy + mega.size) * TILE - cy * CHUNK_PX;
        const dx = Math.round(centerX - img.width / 2);
        const dy = southY - img.height;
        this.art.shadow(ctx, centerX, southY - 4, img.width * 0.42, img.width * 0.15, depleted ? 0.12 : 0.3);
        ctx.drawImage(img, dx, dy);
      }

      // ordinary single-tile features in this row
      if (ty < 0 || ty > CHUNK) continue;
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        if (this.world.megaClusterAt(gtx, gty)) continue;
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
        const dx = tx * TILE + ((TILE - img.width) >> 1) + jx;
        const dy = ty * TILE + TILE - img.height + jy;
        this.art.shadow(ctx, dx + img.width / 2, dy + img.height - 2, img.width * 0.35, img.width * 0.14, 0.3);
        ctx.drawImage(img, dx, dy);
      }
    }

    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    const sprite = new Sprite(tex);
    sprite.position.set(cx * CHUNK_PX, cy * CHUNK_PX);
    this.layer.addChild(sprite);

    // shoreline foam overlay — only for chunks that actually border water,
    // so most of the map (deep ocean, inland) pays nothing extra
    let foam: Foam | null = null;
    let hasShore = false;
    for (let ty = 0; ty < CHUNK && !hasShore; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        if (this.isShoreTile(cx * CHUNK + tx, cy * CHUNK + ty)) { hasShore = true; break; }
      }
    }
    if (hasShore) {
      const texs: Texture[] = [];
      for (let f = 0; f < 3; f++) {
        const fc = document.createElement('canvas');
        fc.width = fc.height = CHUNK_PX;
        const fctx = fc.getContext('2d')!;
        for (let ty = 0; ty < CHUNK; ty++) {
          for (let tx = 0; tx < CHUNK; tx++) {
            const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
            if (!this.isShoreTile(gtx, gty)) continue;
            fctx.drawImage(this.art.foam(f as 0 | 1 | 2), tx * TILE, ty * TILE);
          }
        }
        const ftex = Texture.from(fc);
        ftex.source.scaleMode = 'nearest';
        texs.push(ftex);
      }
      const view = new Sprite(texs[Math.max(this.foamFrame, 0)]);
      view.position.set(cx * CHUNK_PX, cy * CHUNK_PX);
      this.layer.addChild(view);
      foam = { view, texs };
    }

    // fire glow overlay is created lazily by tickGlow — fire state changes independently of
    // terrain bakes (a chunk can catch/lose fire between bakes without a rebake happening)
    return { sprite, tex, foam, glow: null };
  }

  // ---- G1: SUBPIX rendering (×2 / ×4 micro-tile resolution) ----------------

  /** Bake a chunk at SUBPIX resolution with smooth edge blending.
   *  factor: 2 or 4 — how many micro-tiles per sim-tile per axis. */
  private bakeSubpix(cx: number, cy: number, factor: number): Chunk {
    const MT = TILE / factor; // micro-tile pixel size
    const CPX = CHUNK_PX * factor; // chunk canvas pixels
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CPX;
    const ctx = canvas.getContext('2d')!;

    // Pre-fetch material colors for blending
    const matColor = (matId: number): [number, number, number] => {
      const ramp = MATERIALS[matId]?.art?.ramp;
      if (ramp && ramp[1]) return ramp[1]; // mid-tone from palette ramp
      return [100, 100, 100]; // fallback gray
    };

    // Render each micro-tile
    for (let mty = 0; mty < CHUNK * factor; mty++) {
      for (let mtx = 0; mtx < CHUNK * factor; mtx++) {
        const gtx = cx * CHUNK + Math.floor(mtx / factor);
        const gty = cy * CHUNK + Math.floor(mty / factor);
        const subX = mtx % factor; // 0..factor-1 within sim tile
        const subY = mty % factor;

        const here = this.world.materialAt(gtx, gty);
        const col = matColor(here);

        // Blend toward neighboring materials at edges for smooth transitions
        let r = col[0], g = col[1], b = col[2];
        let blendWeight = 0;

        // Check N/S/E/W neighbors — blend if different material and at tile edge
        const neighbors: [number, number, number][] = [
          [0, -1, subY],       // N: blend strength = how close to top edge
          [0, 1, factor - 1 - subY], // S
          [-1, 0, subX],       // W
          [1, 0, factor - 1 - subX], // E
        ];

        for (const [dx, dy, edgeDist] of neighbors) {
          if (edgeDist <= 0) continue; // not at this edge
          const nm = this.world.materialAt(gtx + dx, gty + dy);
          if (nm === here) continue;
          const ncol = matColor(nm);
          const w = (factor - edgeDist) / factor; // 1 at edge, 0 at center
          if (w <= 0) continue;
          r = r * (1 - w) + ncol[0] * w;
          g = g * (1 - w) + ncol[1] * w;
          b = b * (1 - w) + ncol[2] * w;
          blendWeight += w;
        }

        // Clamp blend
        if (blendWeight > 1) {
          const s = 1 / blendWeight;
          r = col[0] + (r - col[0]) * s;
          g = col[1] + (g - col[1]) * s;
          b = col[2] + (b - col[2]) * s;
        }

        // Add subtle micro-variation (noise) for texture
        const noise = ((hash2(gtx * 1000 + mtx, gty * 1000 + mty, 0x7f3d) - 0.5) * 12) | 0;
        ctx.fillStyle = `rgb(${(r + noise).toFixed(0)},${(g + noise).toFixed(0)},${(b + noise).toFixed(0)})`;
        ctx.fillRect(mtx * MT, mty * MT, MT, MT);
      }
    }

    // Cliff shadows — at micro-tile level
    for (let mty = 0; mty < CHUNK * factor; mty++) {
      for (let mtx = 0; mtx < CHUNK * factor; mtx++) {
        const gtx = cx * CHUNK + Math.floor(mtx / factor);
        const gty = cy * CHUNK + Math.floor(mty / factor);
        const m = this.world.materialAt(gtx, gty);
        const hT = MATERIALS[m].heightClass;
        const hS = MATERIALS[this.world.materialAt(gtx, gty + 1)].heightClass;
        if (hT <= hS) continue;
        const subY = mty % factor;
        if (subY < factor - 1) continue; // only bottom row of micro-tiles
        const steep = hT - hS >= 2;
        const band = steep ? 10 : 7;
        const ramp = MATERIALS[m].art.ramp;
        ctx.fillStyle = css(darken(ramp[0], steep ? 45 : 35));
        ctx.fillRect(mtx * MT, mty * MT + MT - band, MT, band);
        ctx.fillStyle = css(lighten(ramp[2], 30));
        ctx.fillRect(mtx * MT, mty * MT + MT - band, MT, 2);
      }
    }

    // AO — darken micro-tiles adjacent to higher neighbors
    for (let mty = 0; mty < CHUNK * factor; mty++) {
      for (let mtx = 0; mtx < CHUNK * factor; mtx++) {
        const gtx = cx * CHUNK + Math.floor(mtx / factor);
        const gty = cy * CHUNK + Math.floor(mty / factor);
        const hHere = MATERIALS[this.world.materialAt(gtx, gty)].heightClass;
        let ao = 0;
        const subX = mtx % factor, subY = mty % factor;
        // Only check sim-tile-level neighbors
        if (subX === 0 || subX === factor - 1 || subY === 0 || subY === factor - 1) {
          for (const [dx, dy] of EDGES) {
            const hN = MATERIALS[this.world.materialAt(gtx + dx, gty + dy)].heightClass;
            if (hN > hHere) ao += 0.03;
          }
        }
        if (ao <= 0) continue;
        ctx.fillStyle = `rgba(0,0,0,${Math.min(ao, 0.15)})`;
        ctx.fillRect(mtx * MT, mty * MT, MT, MT);
      }
    }

    // Features — same y-ordered walk as the main bake, scaled by the subpix
    // factor. Mega clusters draw as one big sprite here too.
    const MMs = MEGA_SCAN + 2;
    const megaRootsS: MegaCluster[] = [];
    for (let ty = -MMs; ty <= CHUNK + MMs; ty++) {
      for (let tx = -MMs; tx < CHUNK + MMs; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const mega = this.world.megaClusterAt(gtx, gty);
        if (mega && mega.rootTx === gtx && mega.rootTy === gty) megaRootsS.push(mega);
      }
    }
    for (let ty = -MMs; ty <= CHUNK + MMs; ty++) {
      for (const mega of megaRootsS) {
        if (mega.rootTy + mega.size - 1 - cy * CHUNK !== ty) continue;
        const depleted = this.world.isDepleted(mega.rootTx, mega.rootTy);
        if (depleted && mega.def.depleted !== 'stump') continue;
        const img = depleted
          ? this.art.megaStump(mega.size)
          : this.art.megaFeature(mega.def.id, mega.rootTx, mega.rootTy, mega.size);
        const w = img.width * factor, h = img.height * factor;
        const dx = ((mega.rootTx + mega.size / 2) * TILE - cx * CHUNK_PX) * factor - w / 2;
        const dy = ((mega.rootTy + mega.size) * TILE - cy * CHUNK_PX) * factor - h;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(dx + 2, dy + 2, w, h);
        ctx.drawImage(img, dx, dy, w, h);
      }

      if (ty < 0 || ty > CHUNK) continue;
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        if (this.world.megaClusterAt(gtx, gty)) continue;
        const f = this.world.featureAt(gtx, gty);
        if (!f) continue;
        let img: HTMLCanvasElement;
        if (this.world.isDepleted(gtx, gty)) {
          if (f.depleted !== 'stump') continue;
          img = this.art.stump;
        } else {
          img = this.art.feature(f.id, gtx, gty);
        }
        const jx = ((hash2(gtx, gty, 0x1a17) * 7) | 0) - 3;
        const jy = (hash2(gtx, gty, 0x9b3) * 4) | 0;
        // Scale features to fit the subpix tile grid
        const dx = tx * TILE * factor + ((TILE * factor - img.width) >> 1) + jx * factor;
        const dy = ty * TILE * factor + TILE * factor - img.height + jy * factor;
        // Simple drop shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(dx + 2, dy + 2, img.width, img.height);
        ctx.drawImage(img, dx, dy);
      }
    }

    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    const sprite = new Sprite(tex);
    // Scale sprite down so it covers the same world area as a ×1 chunk
    sprite.position.set(cx * CHUNK_PX, cy * CHUNK_PX);
    sprite.setSize(CHUNK_PX, CHUNK_PX); // scale to fit CHUNK_PX×CHUNK_PX world space
    this.layer.addChild(sprite);

    // SUBPIX chunks skip foam/glow overlays for now — the higher res compensates
    return { sprite, tex, foam: null, glow: null };
  }
}
