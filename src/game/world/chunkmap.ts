// Streaming renderer for the infinite world: 16×16-tile chunks baked into ONE
// texture each. Gathering a node or a respawn triggers a rebake of just that
// chunk — the rest of the world doesn't notice.
import { Container, Sprite, Texture } from 'pixi.js';
import { hash2 } from '../../engine/rng';
import { valueNoise } from '../../engine/noise';
import { darken, lighten, scale, type RGB } from '../../engine/procgen/palette';
import { TILE, MEGA_SCAN, type MegaCluster } from './worldgen';
import { M, MATERIALS } from '../data/materials';
import { CFG } from '../data/config';
import type { World } from './world';
import type { WorldArt } from './art';
import { buildReliefField, shadeInto, sunAt, RELIEF_N, RELIEF_PAD, RELIEF_DIM, type ReliefField, type SunDir } from './relief';

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
/** G1: the relief overlay — a 66×66 greyscale texture stretched over the chunk
 * with linear filtering and multiplied onto it. Same "chunk owns a secondary
 * overlay" pattern as foam and glow; the normals are baked once and only the
 * shade pass reruns as the sun moves. */
interface Relief { view: Sprite; tex: Texture; ctx: CanvasRenderingContext2D; img: ImageData; field: ReliefField }
interface Chunk { sprite: Sprite; tex: Texture; foam: Foam | null; glow: Glow | null; relief: Relief | null }

const RELIGHT_COS = Math.cos((2 * Math.PI) / 180); // re-shade once the sun has moved ~2°
const RELIGHT_PER_FRAME = 3;                       // chunks re-shaded per frame — amortises a relight
const RELIEF_BUILD_PER_FRAME = 3;                  // NEW normal fields per frame (~1ms each) — amortises streaming
const RELIEF_OVER = (RELIEF_PAD / RELIEF_N) * CHUNK_PX; // px the overlay hangs past the chunk

const SPIRE_ROCK = 0.11;  // per-tile chance of a spire on mountain (G5)
const SPIRE_SNOW = 0.09;  // sparser on snow — the caps read better half-bare

/** G4 chamfer, widest+faintest first — see the corner-cut pass. */
const CORNER_LAYERS: [number, number][] = [[13, 0.3], [9, 0.5], [5, 0.8]];
/** the four (x,y) diagonal directions, as sign pairs */
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const CLIFF_BAND = 9;         // px of ledge on a one-step drop (hill → ground)
const CLIFF_BAND_STEEP = 20;  // px of real rock face on a two-step drop (mountain → ground)

const GLOW_RADIUS = 20; // px — bleeds a few px past the 32px tile so neighboring flame reads as one glow

export class ChunkMap {
  private chunks = new Map<string, Chunk>();
  private foamFrame = -1;
  private lastGlowMs = -1;

  // G1 relief lighting
  private reliefOn: boolean;
  private reliefSeed: number;
  private sun: SunDir = sunAt(0);
  private relightQueue: string[] = [];
  /** QA: bumped every time the sun moves far enough to enqueue a relight. A
   *  test that moves the world clock has to wait for the RELIGHT, and "the
   *  queue is empty" is not that signal — the queue is also empty in the window
   *  between setting the clock and tickRelief() next running, so waiting on it
   *  alone returns instantly and samples the OLD sun. */
  private sunGen = 0;


  constructor(
    private world: World,
    private art: WorldArt,
    private layer: Container,
    opts: { relief?: boolean; seed?: number } = {},
  ) {
    this.reliefOn = opts.relief !== false;
    this.reliefSeed = (opts.seed ?? 0) ^ 0x5e11ef;
  }

  /** G1 gate switch: turn relief lighting on/off live so the two looks can be
   *  compared side by side without a reload. Rebuilds every loaded chunk's
   *  overlay, or tears them all down. */
  setRelief(on: boolean) {
    if (on === this.reliefOn) return;
    this.reliefOn = on;
    for (const [key, c] of this.chunks) {
      if (c.relief) { c.relief.view.destroy(); c.relief.tex.destroy(true); c.relief = null; }
      if (!on) continue;
      // the gate wants both looks the instant the key is pressed, so eat the stall
      const [cx, cy] = key.split(',').map(Number);
      c.relief = this.makeRelief(cx, cy);
    }
  }

  get reliefEnabled() { return this.reliefOn; }


  /** Keep chunks loaded around world-pixel (px, py) for a view of viewW×viewH. */
  ensureAround(px: number, py: number, viewW: number, viewH: number) {
    const r = Math.ceil(Math.max(viewW, viewH) / 2 / CHUNK_PX) + 1;
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);

    for (let cy = ccy - r; cy <= ccy + r; cy++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const key = cx + ',' + cy;
        if (!this.chunks.has(key)) {
          this.chunks.set(key, this.bake(cx, cy));
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

  /** G1: move the sun and re-shade. A relight is queued only once the light
   *  has actually swung a couple of degrees (~4s of world clock), and the
   *  queue is drained a few chunks per frame — so the cost is a handful of
   *  64×64 dot-product passes spread over a quarter second, never a spike. */
  tickRelief(clock: number) {
    if (!this.reliefOn) return;
    const s = sunAt(clock);
    const moved = s.x * this.sun.x + s.y * this.sun.y + s.z * this.sun.z < RELIGHT_COS;
    if (moved || s.gain !== this.sun.gain) {
      this.sun = s;
      this.relightQueue = [...this.chunks.keys()];
      this.sunGen++;
    }
    for (let n = 0; n < RELIGHT_PER_FRAME && this.relightQueue.length; n++) {
      const c = this.chunks.get(this.relightQueue.pop()!);
      if (c?.relief) this.paintRelief(c.relief);
    }

    // Building a normal field costs about as much as the whole rest of a chunk
    // bake (a 68² Sobel over three octaves of fbm), so it deliberately does NOT
    // happen inside bake() — a teleport into fresh terrain would stall on 25 of
    // them at once. Chunks arrive unlit and pick up their overlay over the next
    // few frames, which at the screen edge nobody ever sees.
    let built = 0;
    for (const [key, c] of this.chunks) {
      if (c.relief) continue;
      const [cx, cy] = key.split(',').map(Number);
      c.relief = this.makeRelief(cx, cy);
      if (++built >= RELIEF_BUILD_PER_FRAME) break;
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

  /** G1/QA: how much relief work is still outstanding — queued relights plus
   *  loaded chunks that have no overlay yet.
   *
   *  Exists because the relief specs used to sleep on a fixed timer, which is a
   *  bet on frame rate. Overlays are built RELIEF_BUILD_PER_FRAME at a time and
   *  the relight queue drains RELIGHT_PER_FRAME per frame, so on the
   *  software-raster lane (~3 fps) neither had finished when the sample was
   *  taken. Worse, the queue is drained with pop() while the player's own chunk
   *  was inserted FIRST — so the tiles a test looks at are the last ones
   *  updated. Waiting on the work itself is lane-independent. */
  /** QA: see `sunGen`. Pair with debugReliefPending() === 0 to wait for a
   *  clock change to be fully reflected in the overlays. */
  debugSunGen(): number { return this.sunGen; }

  debugReliefPending(): number {
    if (!this.reliefOn) return 0;
    let missing = 0;
    for (const c of this.chunks.values()) if (!c.relief) missing++;
    return this.relightQueue.length + missing;
  }

  /** G1: the relief shade multiplier (0..1) at tile-local pixel offset
   *  (offX,offY) (default: tile centre). 1 means the surface is flat there and
   *  the bake shows through untouched. null if the chunk isn't loaded or relief
   *  is off. NOTE the gradient of a bilinear height field peaks BETWEEN tile
   *  centres, so sampling only centres systematically under-reads the shading.
   *  Same offset convention as debugPixel. */
  debugRelief(tx: number, ty: number, offX = 16, offY = 16): number | null {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const r = this.chunks.get(cx + ',' + cy)?.relief;
    if (!r) return null;
    const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
    const per = RELIEF_N / CHUNK_PX;   // texels per world pixel
    const i = RELIEF_PAD + Math.min(RELIEF_N - 1, Math.max(0, Math.floor((lx * TILE + offX) * per)));
    const j = RELIEF_PAD + Math.min(RELIEF_N - 1, Math.max(0, Math.floor((ly * TILE + offY) * per)));
    return r.img.data[(j * RELIEF_DIM + i) * 4] / 255;
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
    c.sprite?.destroy();
    c.tex?.destroy(true);
    if (c.foam) {
      c.foam.view?.destroy();
      for (const t of c.foam.texs) t?.destroy(true);
    }
    if (c.glow) {
      c.glow.view?.destroy();
      c.glow.tex?.destroy(true);
    }
    if (c.relief) {
      c.relief.view?.destroy();
      c.relief.tex?.destroy(true);
    }
  }

  /** G1: build a chunk's relief overlay. The normal field is computed once
   *  here and cached; the texture hangs RELIEF_PAD texels past the chunk on
   *  every side so linear filtering interpolates against real neighbour data
   *  instead of clamping, which would leave a flat band at every seam. */
  private makeRelief(cx: number, cy: number): Relief {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = RELIEF_DIM;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(RELIEF_DIM, RELIEF_DIM);
    const field = buildReliefField(
      cx * CHUNK, cy * CHUNK, CHUNK, this.reliefSeed,
      (tx, ty) => MATERIALS[this.world.materialAt(tx, ty)].heightClass,
    );
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'linear';   // the whole point — 8px texels blur into a gradient
    const view = new Sprite(tex);
    view.blendMode = 'multiply';
    view.position.set(cx * CHUNK_PX - RELIEF_OVER, cy * CHUNK_PX - RELIEF_OVER);
    view.setSize(CHUNK_PX + RELIEF_OVER * 2, CHUNK_PX + RELIEF_OVER * 2);
    this.layer.addChild(view);
    const r: Relief = { view, tex, ctx, img, field };
    this.paintRelief(r);
    return r;
  }

  private paintRelief(r: Relief) {
    shadeInto(r.img, r.field, this.sun);
    r.ctx.putImageData(r.img, 0, 0);
    r.tex.source.update();
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
    this.chunks.set(key, this.bake(cx, cy));
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

    // G4: corner cut. The feather pass blends TEXTURE across an edge but never
    // reshapes the OUTLINE, which is why a 32px staircase survives it intact.
    // Wherever two adjacent orthogonal neighbours are the same foreign
    // material, knock the corner off with a clipped triangle of that
    // material's own texture — the outline turns 90° steps into 45° chamfers.
    // Purely cosmetic: collision still reads the tile grid, so a corner can
    // look ~10px rounder than it walks.
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const m = this.world.materialAt(gtx, gty);
        const px0 = tx * TILE, py0 = ty * TILE;
        for (const [sx, sy] of CORNERS) {
          const a = this.world.materialAt(gtx + sx, gty);
          if (a === m || a !== this.world.materialAt(gtx, gty + sy)) continue;
          const ex = px0 + (sx > 0 ? TILE : 0), ey = py0 + (sy > 0 ? TILE : 0);
          const src = this.art.tile(a, gtx + sx, gty);
          // layered like feather(): a single hard-clipped wedge is a SPIKE at a
          // high-contrast border (dark water sawing into pale sand reads worse
          // than the staircase it replaced). Wide-and-faint to narrow-and-solid
          // makes the same chamfer read as a soft rounding.
          for (const [depth, alpha] of CORNER_LAYERS) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ex - sx * depth, ey);
            ctx.lineTo(ex, ey);
            ctx.lineTo(ex, ey - sy * depth);
            ctx.closePath();
            ctx.clip();
            ctx.globalAlpha = alpha;
            ctx.drawImage(src, px0, py0);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // cliff pass — a rock FACE on the south edge wherever height drops toward
    // the viewer: per-column striation and a jittered top lip so it reads as
    // stone rather than a painted stripe. A drop into water (heightClass 0) is
    // the shoreline's job — foam already owns it, and a band there paints a
    // plank of land floating on the sea (G3).
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gtx = cx * CHUNK + tx, gty = cy * CHUNK + ty;
        const m = this.world.materialAt(gtx, gty);
        const hT = MATERIALS[m].heightClass;
        const hS = MATERIALS[this.world.materialAt(gtx, gty + 1)].heightClass;
        if (hT <= hS || hS === 0) continue;
        const steep = hT - hS >= 2;
        const band = steep ? CLIFF_BAND_STEEP : CLIFF_BAND;
        const ramp = MATERIALS[m].art.ramp;
        // proportional, never additive: snow's darkest stop is (185,196,214),
        // so an additive −30 paints a cliff face LIGHTER than the grass below it
        const face = scale(ramp[0], steep ? 0.55 : 0.76);
        const lip = lighten(ramp[ramp.length - 1], 12);
        const deep = steep ? 10 : 5, mid = steep ? 4 : 2;
        const px0 = tx * TILE, base = ty * TILE + TILE;
        for (let x = 0; x < TILE; x++) {
          // everything hashes on the WORLD pixel column, so a cliff striates
          // continuously along its length instead of repeating every tile
          const wx = gtx * TILE + x;
          // the top edge undulates on SMOOTH noise (~7px wavelength). Per-pixel
          // white noise here reads as a comb of hair, not as broken rock.
          const top = base - band + Math.round((valueNoise(wx / 7, gty * 3.7, 0x5c1f) - 0.5) * 4);
          // grooves run in 3px columns for the same reason
          const g = hash2((wx / 3) | 0, gty, 0x5c20);
          const groove = g < 0.26 ? deep : g < 0.58 ? mid : 0;
          ctx.fillStyle = css(darken(face, groove));
          ctx.fillRect(px0 + x, top, 1, base - top);
          ctx.fillStyle = css(groove ? darken(lip, 10) : lip);
          ctx.fillRect(px0 + x, top, 1, 2);
        }
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

        // G5: spires on the peaks. Render-only, so they ride the same
        // row-ordered walk (a spire further south covers the one behind it)
        // without ever entering the feature or collision tables.
        const sm = this.world.materialAt(gtx, gty);
        if (sm === M.MOUNTAIN || sm === M.SNOW) {
          if (hash2(gtx, gty, 0x5915) < (sm === M.SNOW ? SPIRE_SNOW : SPIRE_ROCK)) {
            const img = this.art.spire(sm === M.SNOW, gtx, gty);
            const jx = ((hash2(gtx, gty, 0x5916) * 13) | 0) - 6;
            const dx = tx * TILE + ((TILE - img.width) >> 1) + jx;
            const dy = ty * TILE + TILE - img.height;
            this.art.shadow(ctx, dx + img.width / 2, dy + img.height - 1, img.width * 0.55, img.width * 0.2, 0.3);
            ctx.drawImage(img, dx, dy);
          }
          continue;
        }

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
    return { sprite, tex, foam, glow: null, relief: null };
  }

}
