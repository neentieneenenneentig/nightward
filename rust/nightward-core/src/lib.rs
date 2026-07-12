use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

/// Boundary smoke test: scalar across the JS<->wasm boundary. (R0)
#[wasm_bindgen]
pub fn ping() -> u32 {
    42
}

/// R0 demo: state lives inside the module; JS reads it through a zero-copy view
/// into linear memory (ptr + len, no copying). Kept as the pipeline smoke test.
#[wasm_bindgen]
pub struct Spike {
    buf: Vec<u8>,
    w: u32,
    h: u32,
}

#[wasm_bindgen]
impl Spike {
    #[wasm_bindgen(constructor)]
    pub fn new(w: u32, h: u32) -> Spike {
        let mut buf = vec![0u8; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                buf[(y * w + x) as usize] = if (x / 8 + y / 8) % 2 == 0 { 255 } else { 0 };
            }
        }
        Spike { buf, w, h }
    }
    pub fn ptr(&self) -> *const u8 { self.buf.as_ptr() }
    pub fn len(&self) -> u32 { self.buf.len() as u32 }
    pub fn width(&self) -> u32 { self.w }
    pub fn height(&self) -> u32 { self.h }
}

// ============================================================================
// R1 — the writable world.
//
// The infinite world stays a pure function (procgen is the DEFAULT VALUE of
// every tile). This core stores only diffs: a sparse override layer on top of
// the procgen base. Active chunks keep a dense 256-byte effective array (so the
// R2+ simulation reads them at full speed); inactive chunks keep their diffs in
// a sparse map. Memory grows with what players change, not with world size.
//
// Undo rule (load-bearing): writing a tile's BASE material back clears its
// override entirely — a tile "has an override" iff effective != base.
// ============================================================================

const CHUNK: i32 = 16;
const CHUNK_TILES: usize = 256; // 16 * 16

#[inline]
fn chunk_of(tx: i32, ty: i32) -> (i32, i32) {
    (tx.div_euclid(CHUNK), ty.div_euclid(CHUNK))
}

#[inline]
fn local_index(tx: i32, ty: i32) -> usize {
    (ty.rem_euclid(CHUNK) * CHUNK + tx.rem_euclid(CHUNK)) as usize
}

#[wasm_bindgen]
pub struct Core {
    #[allow(dead_code)]
    seed: u32,
    #[allow(dead_code)]
    cap: usize,                          // chunk slot capacity
    #[allow(dead_code)]
    mats: Vec<f32>,                      // materials table, stride 6 (read by R2+)
    slots: Vec<u8>,                      // cap*256 effective materials — allocated ONCE, never grows
    base: Vec<u8>,                       // cap*256 base materials (for diffing) — allocated ONCE
    slot_of: HashMap<(i32, i32), usize>, // (cx,cy) -> slot
    free: Vec<usize>,                    // free slot indices
    overrides: HashMap<(i32, i32), u8>,  // (tx,ty) -> mat, for tiles in INACTIVE chunks only
    // (cx,cy) -> tile keys with an override in that (inactive) chunk. Lets activate_chunk drain
    // exactly this chunk's overrides (R2 prereq) instead of scanning every override in the world —
    // fire mass-produces standing overrides while chunks stream in and out during normal play.
    overrides_by_chunk: HashMap<(i32, i32), HashSet<(i32, i32)>>,
    events: Vec<i32>,                    // flat (tx,ty) pairs since last clear; may grow/realloc
}

#[wasm_bindgen]
impl Core {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, chunk_capacity: u32) -> Core {
        let cap = chunk_capacity as usize;
        Core {
            seed,
            cap,
            mats: Vec::new(),
            // preallocated at full capacity so their pointers are stable for the
            // lifetime of the instance (only `events` may realloc).
            slots: vec![0u8; cap * CHUNK_TILES],
            base: vec![0u8; cap * CHUNK_TILES],
            slot_of: HashMap::new(),
            free: (0..cap).collect(),
            overrides: HashMap::new(),
            overrides_by_chunk: HashMap::new(),
            events: Vec::new(),
        }
    }

    /// Insert/replace an override, keeping `overrides_by_chunk` in lockstep.
    fn override_insert(&mut self, tx: i32, ty: i32, mat: u8) {
        self.overrides.insert((tx, ty), mat);
        self.overrides_by_chunk.entry(chunk_of(tx, ty)).or_default().insert((tx, ty));
    }

    /// Remove an override, keeping `overrides_by_chunk` in lockstep.
    fn override_remove(&mut self, tx: i32, ty: i32) {
        self.overrides.remove(&(tx, ty));
        let key = chunk_of(tx, ty);
        if let Some(set) = self.overrides_by_chunk.get_mut(&key) {
            set.remove(&(tx, ty));
            if set.is_empty() {
                self.overrides_by_chunk.remove(&key);
            }
        }
    }

    /// Replace the materials table. Called at init and by pushMaterials().
    pub fn set_materials(&mut self, props: &[f32], _stride: u32) {
        self.mats = props.to_vec();
    }

    /// Bring a chunk online: copy its 256 base bytes into both arrays, then drain
    /// every override belonging to this chunk into the slot (ownership moves to
    /// the slot). Returns false if the pool is exhausted. Pushes NO events.
    pub fn activate_chunk(&mut self, cx: i32, cy: i32, base: &[u8]) -> bool {
        if self.slot_of.contains_key(&(cx, cy)) {
            return true; // already active — nothing to do
        }
        let slot = match self.free.pop() {
            Some(s) => s,
            None => return false, // pool exhausted; world still works read-only via fallback
        };
        let off = slot * CHUNK_TILES;
        let n = base.len().min(CHUNK_TILES);
        self.slots[off..off + n].copy_from_slice(&base[..n]);
        self.base[off..off + n].copy_from_slice(&base[..n]);
        self.slot_of.insert((cx, cy), slot);

        // apply + remove this chunk's overrides (they now live in the dense slot) — looked up
        // directly via the chunk index, O(overrides in THIS chunk), not O(world overrides)
        if let Some(keys) = self.overrides_by_chunk.remove(&(cx, cy)) {
            for (tx, ty) in keys {
                if let Some(mat) = self.overrides.remove(&(tx, ty)) {
                    self.slots[off + local_index(tx, ty)] = mat;
                }
            }
        }
        true
    }

    /// Take a chunk offline: spill every tile that differs from base back into
    /// the sparse override map, return the slot to the pool. Pushes NO events.
    pub fn deactivate_chunk(&mut self, cx: i32, cy: i32) {
        let slot = match self.slot_of.remove(&(cx, cy)) {
            Some(s) => s,
            None => return,
        };
        let off = slot * CHUNK_TILES;
        for li in 0..CHUNK_TILES {
            if self.slots[off + li] != self.base[off + li] {
                let tx = cx * CHUNK + (li as i32 % CHUNK);
                let ty = cy * CHUNK + (li as i32 / CHUNK);
                self.override_insert(tx, ty, self.slots[off + li]);
            }
        }
        self.free.push(slot);
    }

    /// Absolute byte offset of the chunk's 256-byte effective array in linear
    /// memory; 0 if inactive. JS reads a tile as an array index into `mem()`.
    pub fn chunk_ptr(&self, cx: i32, cy: i32) -> u32 {
        match self.slot_of.get(&(cx, cy)) {
            Some(&slot) => (self.slots.as_ptr() as usize + slot * CHUNK_TILES) as u32,
            None => 0,
        }
    }

    /// Write a tile's effective material. `base_mat` is the tile's procgen base
    /// (TS supplies it — Rust has no worldgen). Pushes one (tx,ty) event iff the
    /// effective value actually changed. Undo: mat == base_mat clears the override.
    pub fn set_material(&mut self, tx: i32, ty: i32, mat: u8, base_mat: u8) {
        let (cx, cy) = chunk_of(tx, ty);
        if let Some(&slot) = self.slot_of.get(&(cx, cy)) {
            let idx = slot * CHUNK_TILES + local_index(tx, ty);
            if self.slots[idx] == mat {
                return;
            }
            self.slots[idx] = mat;
        } else {
            let key = (tx, ty);
            let prev_eff = *self.overrides.get(&key).unwrap_or(&base_mat);
            if prev_eff == mat {
                return;
            }
            if mat == base_mat {
                self.override_remove(tx, ty);
            } else {
                self.override_insert(tx, ty, mat);
            }
        }
        self.events.push(tx);
        self.events.push(ty);
    }

    /// The override material id at a tile, or -1 for "no override" (effective == base).
    pub fn override_at(&self, tx: i32, ty: i32) -> i32 {
        let (cx, cy) = chunk_of(tx, ty);
        if let Some(&slot) = self.slot_of.get(&(cx, cy)) {
            let idx = slot * CHUNK_TILES + local_index(tx, ty);
            if self.slots[idx] != self.base[idx] {
                self.slots[idx] as i32
            } else {
                -1
            }
        } else {
            match self.overrides.get(&(tx, ty)) {
                Some(&m) => m as i32,
                None => -1,
            }
        }
    }

    /// Byte offset of the changed-tile event buffer. `events` may realloc, so JS
    /// fetches this fresh at every drain.
    pub fn events_ptr(&self) -> u32 {
        self.events.as_ptr() as u32
    }
    /// Number of (tx,ty) PAIRS recorded since the last clear.
    pub fn events_count(&self) -> u32 {
        (self.events.len() / 2) as u32
    }
    pub fn events_clear(&mut self) {
        self.events.clear();
    }

    /// The simulation entry point. Empty in R1 — the fire CA (R2) fills it. The
    /// seam exists now so the main-loop wiring lands with this milestone.
    pub fn tick(&mut self, _dt: f32) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_is_42() {
        assert_eq!(ping(), 42);
    }

    #[test]
    fn checker_pattern() {
        let s = Spike::new(16, 16);
        assert_eq!(s.len(), 256);
        assert_eq!(s.buf[0], 255); // first cell of first 8x8 block
        assert_eq!(s.buf[8], 0); // first cell of second block
    }

    // ---- R1 Core ----------------------------------------------------------

    fn base_grass() -> Vec<u8> {
        vec![3u8; CHUNK_TILES] // material 3 = grass everywhere in the chunk
    }

    #[test]
    fn override_survives_deactivate_reactivate() {
        let mut c = Core::new(1, 8);
        assert!(c.activate_chunk(0, 0, &base_grass()));
        c.set_material(5, 5, 11, 3); // paint ICE over grass
        assert_eq!(c.override_at(5, 5), 11);
        c.deactivate_chunk(0, 0);
        assert_eq!(c.override_at(5, 5), 11); // inactive path still remembers it
        assert!(c.activate_chunk(0, 0, &base_grass())); // re-supply base
        assert_eq!(c.override_at(5, 5), 11); // still there after reactivation
    }

    #[test]
    fn set_material_on_inactive_applies_on_activation() {
        let mut c = Core::new(1, 8);
        c.set_material(5, 5, 11, 3); // inactive chunk — stored sparsely
        assert_eq!(c.override_at(5, 5), 11);
        assert!(c.activate_chunk(0, 0, &base_grass()));
        assert_eq!(c.override_at(5, 5), 11); // drained into the dense slot
        let slot = c.slot_of[&(0, 0)];
        assert_eq!(c.slots[slot * CHUNK_TILES + local_index(5, 5)], 11);
    }

    #[test]
    fn repaint_to_base_clears_override_active() {
        let mut c = Core::new(1, 8);
        c.activate_chunk(0, 0, &base_grass());
        c.set_material(5, 5, 11, 3);
        assert_eq!(c.override_at(5, 5), 11);
        c.set_material(5, 5, 3, 3); // repaint base → undo
        assert_eq!(c.override_at(5, 5), -1);
    }

    #[test]
    fn repaint_to_base_clears_override_inactive() {
        let mut c = Core::new(1, 8);
        c.set_material(5, 5, 11, 3); // inactive
        assert_eq!(c.override_at(5, 5), 11);
        c.set_material(5, 5, 3, 3); // repaint base → undo, override removed
        assert_eq!(c.override_at(5, 5), -1);
        assert!(!c.overrides.contains_key(&(5, 5)));
    }

    #[test]
    fn events_record_exactly_effective_changes() {
        let mut c = Core::new(1, 8);
        c.activate_chunk(0, 0, &base_grass());
        c.events_clear();
        c.set_material(5, 5, 11, 3);
        assert_eq!(c.events_count(), 1);
        c.set_material(5, 5, 11, 3); // no-op — same value
        assert_eq!(c.events_count(), 1);
        c.set_material(6, 6, 3, 3); // base over base — no change
        assert_eq!(c.events_count(), 1);
        c.set_material(6, 6, 12, 3); // MUD — a real change
        assert_eq!(c.events_count(), 2);
        c.events_clear();
        assert_eq!(c.events_count(), 0);
    }

    #[test]
    fn events_record_on_inactive_path() {
        let mut c = Core::new(1, 8);
        c.events_clear();
        c.set_material(5, 5, 11, 3); // inactive add
        assert_eq!(c.events_count(), 1);
        c.set_material(5, 5, 11, 3); // same override — no event
        assert_eq!(c.events_count(), 1);
        c.set_material(5, 5, 3, 3); // clear override — effective changed
        assert_eq!(c.events_count(), 2);
    }

    #[test]
    fn pool_exhaustion_returns_false_and_stays_sane() {
        let mut c = Core::new(1, 1); // capacity 1 chunk
        assert!(c.activate_chunk(0, 0, &base_grass()));
        assert!(!c.activate_chunk(1, 0, &base_grass())); // exhausted
        // still sane: the active chunk works, the un-activated one falls back
        c.set_material(1, 1, 11, 3);
        assert_eq!(c.override_at(1, 1), 11);
        // (16,0) is in the un-activated chunk (1,0) → sparse override path
        c.set_material(16, 0, 12, 3);
        assert_eq!(c.override_at(16, 0), 12);
    }

    // ---- R2 prereq: chunk-keyed override index ----------------------------

    #[test]
    fn activate_chunk_cost_independent_of_total_overrides() {
        let mut c = Core::new(1, 20_000);
        // scatter 50,000 overrides across 50,000 distinct, never-activated, far-apart chunks
        for i in 0..50_000i32 {
            let tx = i * (CHUNK * 4); // stride guarantees a distinct chunk per override
            c.set_material(tx, 0, 11, 3);
        }
        assert_eq!(c.overrides.len(), 50_000);

        let start = std::time::Instant::now();
        for i in 0..100i32 {
            assert!(c.activate_chunk(1_000_000 + i, 0, &base_grass()));
        }
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 500,
            "activate_chunk took {:?} for 100 activations with 50k unrelated overrides present \
             — looks like an O(world) regression in the override drain",
            elapsed
        );
    }

    #[test]
    fn overrides_by_chunk_index_stays_consistent() {
        let mut c = Core::new(1, 8);
        // inactive add, inactive undo — the index must track both
        c.set_material(5, 5, 11, 3);
        assert!(c.overrides_by_chunk.get(&(0, 0)).unwrap().contains(&(5, 5)));
        c.set_material(5, 5, 3, 3); // repaint base → undo
        assert!(!c.overrides_by_chunk.contains_key(&(0, 0)));

        // deactivate spilling into the sparse map also updates the index
        c.activate_chunk(1, 1, &base_grass());
        c.set_material(1 * CHUNK + 2, 1 * CHUNK + 2, 12, 3);
        c.deactivate_chunk(1, 1);
        assert!(c.overrides_by_chunk.get(&(1, 1)).unwrap().contains(&(18, 18)));

        // activating again drains exactly that chunk's entry out of the index
        c.activate_chunk(1, 1, &base_grass());
        assert!(!c.overrides_by_chunk.contains_key(&(1, 1)));
    }
}
