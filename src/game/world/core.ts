// WorldCore — the TS owner of the wasm `Core` instance (the writable world).
//
// The infinite terrain stays a pure function (WorldGen); the core stores only
// the diffs the player/skills paint on top. This class drives which chunks are
// "active" (dense arrays in wasm linear memory, read zero-copy) vs "inactive"
// (sparse override map), mirroring ChunkMap's load radius so the renderer and
// the sim agree on what's live. THE effective-material path for the whole game
// goes through materialAt().
import { mem, memI32, type Core } from '../../wasm/core';
import { MATERIALS, packMaterials, STRIDE } from '../data/materials';
import { TILE, type WorldGen } from './worldgen';

const CHUNK = 16;                 // tiles per chunk side — matches CHUNK in chunkmap.ts + Rust
const CHUNK_PX = CHUNK * TILE;

/** Euclidean floor-divide / modulo so negative coords chunk correctly. */
const cdiv = (n: number) => Math.floor(n / CHUNK);
const cmod = (n: number) => ((n % CHUNK) + CHUNK) % CHUNK;

export class WorldCore {
  private active = new Map<string, number>(); // "cx,cy" -> cached chunk_ptr (byte offset)
  private pinned = new Set<string>();         // chunk keys that must never deactivate
  stats = { activations: 0, deactivations: 0, events: 0, rebakes: 0 };

  constructor(private core: Core, private gen: WorldGen) {}

  private key(cx: number, cy: number) { return cx + ',' + cy; }

  /** The 256 base (procgen) materials for a chunk — same cost as a bake's ground pass. */
  private buildBase(cx: number, cy: number): Uint8Array {
    const buf = new Uint8Array(CHUNK * CHUNK);
    for (let ly = 0; ly < CHUNK; ly++)
      for (let lx = 0; lx < CHUNK; lx++)
        buf[ly * CHUNK + lx] = this.gen.tileAt(cx * CHUNK + lx, cy * CHUNK + ly);
    return buf;
  }

  private activate(cx: number, cy: number) {
    const k = this.key(cx, cy);
    if (this.active.has(k)) return;
    const ok = this.core.activate_chunk(cx, cy, this.buildBase(cx, cy));
    if (!ok) { console.warn(`[worldcore] chunk pool exhausted at (${cx},${cy}) — read-only fallback`); return; }
    this.active.set(k, this.core.chunk_ptr(cx, cy)); // cache the ptr; array index from here on
    this.stats.activations++;
  }

  private deactivate(cx: number, cy: number) {
    const k = this.key(cx, cy);
    if (!this.active.has(k)) return;
    this.core.deactivate_chunk(cx, cy);
    this.active.delete(k);
    this.stats.deactivations++;
  }

  /** Keep chunks active around (px,py); unload beyond r+2 unless pinned. Mirrors
   * ChunkMap.ensureAround's radius math so renderer + sim stay in lock-step. */
  ensureAround(px: number, py: number, viewW: number, viewH: number) {
    const r = Math.ceil(Math.max(viewW, viewH) / 2 / CHUNK_PX) + 1;
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);
    for (let cy = ccy - r; cy <= ccy + r; cy++)
      for (let cx = ccx - r; cx <= ccx + r; cx++)
        this.activate(cx, cy);
    for (const k of [...this.active.keys()]) {
      const [cx, cy] = k.split(',').map(Number);
      if (Math.max(Math.abs(cx - ccx), Math.abs(cy - ccy)) > r + 2 && !this.pinned.has(k))
        this.deactivate(cx, cy);
    }
  }

  /** Chunk keys that must stay active (every chunk containing a building). */
  pin(keys: Set<string>) { this.pinned = keys; }

  /** THE effective-material path. Active chunk → zero-copy read at cached ptr
   * (no wasm call); inactive → sparse override else procgen base. */
  materialAt(tx: number, ty: number): number {
    const ptr = this.active.get(this.key(cdiv(tx), cdiv(ty)));
    if (ptr !== undefined) return mem()[ptr + cmod(ty) * CHUNK + cmod(tx)];
    const ov = this.core.override_at(tx, ty);
    return ov >= 0 ? ov : this.gen.tileAt(tx, ty);
  }

  /** Write a tile's material (TS supplies the procgen base — Rust has none). */
  setMaterial(tx: number, ty: number, mat: number) {
    this.core.set_material(tx, ty, mat, this.gen.tileAt(tx, ty));
  }

  /** Override material id at a tile, or -1 for "no override" (effective == base). */
  overrideAt(tx: number, ty: number): number { return this.core.override_at(tx, ty); }

  /** Drain the changed-tile events (fetch ptr fresh — the buffer may realloc). */
  drainEvents(): [number, number][] {
    const count = this.core.events_count();
    if (count === 0) return [];
    const view = memI32(this.core.events_ptr(), count * 2);
    const out: [number, number][] = [];
    for (let i = 0; i < count; i++) out.push([view[i * 2], view[i * 2 + 1]]);
    this.core.events_clear();
    this.stats.events += count;
    return out;
  }

  /** Re-pack NW.MATS and re-upload — live console tinkering keeps working. */
  pushMaterials() { this.core.set_materials(packMaterials(), STRIDE); }

  /** Record N chunk rebakes (main calls this after ChunkMap rebuilds). */
  bumpRebakes(n: number) { this.stats.rebakes += n; }

  // ---- test-only helpers (used by the acceptance script) ------------------
  _activate(cx: number, cy: number) { this.activate(cx, cy); }
  _deactivate(cx: number, cy: number) { this.deactivate(cx, cy); }
}

// re-export so callers reading materials by id don't need a second import
export { MATERIALS };
