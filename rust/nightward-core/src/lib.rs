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

// ============================================================================
// R2 — fire. A per-active-chunk cellular automaton: fuel (remaining burnable
// seconds), burn (0/1 — actively on fire), wet (0..1 moisture). Only active
// chunks simulate (mirrors why night hordes only exist near the hall) —
// ephemeral fire state is simply abandoned on deactivate; PERMANENT effects
// (a tile that finished burning out) already went through set_material, which
// persists exactly like every other R1 override.
//
// Determinism discipline (load-bearing): fire_step reads a full snapshot of
// the CURRENT tick's state, collects every change into a list, and applies
// the list once at the end. This is what makes the result independent of
// HashMap iteration order — the classic CA correctness rule.
// ============================================================================

const DIRS4: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)]; // N, E, S, W

/// Deterministic bit-mixer — no mutable RNG stream to desync across replays.
fn hash_f32(mut x: u32) -> f32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b);
    x ^= x >> 16;
    (x as f32) / (u32::MAX as f32)
}

/// The ignition roll for a candidate tile at a given tick — depends only on
/// (seed, target tile, tick), NEVER on which burning neighbor proposed it or
/// what order chunks were visited in. That's what keeps spread deterministic
/// regardless of HashMap iteration order.
fn spread_roll(seed: u32, ntx: i32, nty: i32, tick: u32) -> f32 {
    let mut h = seed;
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(ntx as u32);
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(nty as u32);
    h = h.wrapping_mul(0x9e3779b1).wrapping_add(tick);
    hash_f32(h)
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
    mats_stride: usize,                  // stride of `mats`, from set_materials (finally used — R2)

    // ---- R2: fire ----
    fuel: Vec<f32>,                      // cap*256 — remaining burnable seconds; 0 = can't burn
    burn: Vec<f32>,                      // cap*256 — 0 = unlit, 1.0 = actively burning
    wet: Vec<f32>,                       // cap*256 — 0..1 moisture
    wet_next: Vec<f32>,                  // cap*256 scratch buffer, swapped with `wet` each fire tick
    campfires: HashSet<(i32, i32)>,      // tiles with a permanent, self-refueling ignition source
    wind: (f32, f32),                    // unit vector, derived once from `seed`
    fire_params: [f32; 6],               // [tick_sec, spread_base, wind_strength, wet_extinguish, wet_diffuse_rate, wet_spread_decay]
    fire_accum: f32,                     // tick(dt) accumulator — the core paces its own 10Hz
    fire_tick_n: u32,                    // monotonic tick counter — the deterministic RNG's time axis
}

#[wasm_bindgen]
impl Core {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, chunk_capacity: u32) -> Core {
        let cap = chunk_capacity as usize;
        // wind is a unit vector derived once from the seed — deterministic, constant for the
        // life of this Core, exactly what "wind deterministic from seed" (ROADMAP) asks for.
        let wind_angle = hash_f32(seed ^ 0x517c_c1b7) * std::f32::consts::TAU;
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
            mats_stride: 7,
            fuel: vec![0.0f32; cap * CHUNK_TILES],
            burn: vec![0.0f32; cap * CHUNK_TILES],
            wet: vec![0.0f32; cap * CHUNK_TILES],
            wet_next: vec![0.0f32; cap * CHUNK_TILES],
            campfires: HashSet::new(),
            wind: (wind_angle.cos(), wind_angle.sin()),
            // sane defaults (match CFG.fire's suggested values) so cargo test works without a
            // prior set_fire_params call; main.ts still calls pushFireParams() at boot for
            // live-tunability, same pattern as pushMaterials().
            fire_params: [0.1, 0.35, 0.5, 0.55, 0.15, 0.85],
            fire_accum: 0.0,
            fire_tick_n: 0,
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

    /// Replace the materials table. Called at init and by pushMaterials(). `stride` was
    /// previously accepted-and-ignored; R2 actually reads material props (flammable/fuel/
    /// burnsTo/wetness) through it, so a future pure-numeric-field addition needs only a TS
    /// edit, no simultaneous Rust edit.
    pub fn set_materials(&mut self, props: &[f32], stride: u32) {
        self.mats = props.to_vec();
        self.mats_stride = stride as usize;
    }

    /// Bounds-checked read of one material property; 0.0 if the table hasn't been uploaded yet
    /// or `mat` is out of range. Offsets match materials.ts's packMaterials layout:
    /// 0 passable, 1 speedMult, 2 buildable, 3 flammable, 4 fuel, 5 burnsTo, 6 wetness.
    fn mat_prop(&self, mat: usize, offset: usize) -> f32 {
        let i = mat * self.mats_stride + offset;
        if self.mats_stride > 0 && i < self.mats.len() { self.mats[i] } else { 0.0 }
    }
    fn mat_flammable(&self, mat: usize) -> f32 { self.mat_prop(mat, 3) }
    fn mat_fuel(&self, mat: usize) -> f32 { self.mat_prop(mat, 4) }
    fn mat_burns_to(&self, mat: usize) -> i32 { self.mat_prop(mat, 5) as i32 }
    fn mat_wetness(&self, mat: usize) -> f32 { self.mat_prop(mat, 6) }

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

        // R2: (re)seed this chunk's fire fields from each tile's EFFECTIVE material (after the
        // override drain above, so a repainted tile gets its new material's fuel/wetness, not
        // its base's). Ephemeral — deliberately not restored from anywhere on reactivation.
        for li in 0..CHUNK_TILES {
            let mat = self.slots[off + li] as usize;
            self.fuel[off + li] = self.mat_fuel(mat);
            self.burn[off + li] = 0.0;
            self.wet[off + li] = self.mat_wetness(mat);
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

    /// Write an ACTIVE chunk's tile if the value actually changed, pushing one (tx,ty) event.
    /// Shared by set_material's active branch and fire_step's burnout application — one code
    /// path, one place that can push an event.
    fn write_active(&mut self, slot: usize, tx: i32, ty: i32, mat: u8) -> bool {
        let idx = slot * CHUNK_TILES + local_index(tx, ty);
        if self.slots[idx] == mat {
            return false;
        }
        self.slots[idx] = mat;
        self.events.push(tx);
        self.events.push(ty);
        true
    }

    /// Write a tile's effective material. `base_mat` is the tile's procgen base
    /// (TS supplies it — Rust has no worldgen). Pushes one (tx,ty) event iff the
    /// effective value actually changed. Undo: mat == base_mat clears the override.
    pub fn set_material(&mut self, tx: i32, ty: i32, mat: u8, base_mat: u8) {
        let (cx, cy) = chunk_of(tx, ty);
        if let Some(&slot) = self.slot_of.get(&(cx, cy)) {
            self.write_active(slot, tx, ty, mat);
            return;
        }
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

    /// The simulation entry point. Paces the fire CA at its own fixed rate
    /// (fire_params[0], default 1/10s) regardless of the caller's dt — render fps
    /// and sim rate never leak into fire's tick count, which is exactly what
    /// keeps replayed spread deterministic.
    pub fn tick(&mut self, dt: f32) {
        self.fire_accum += dt;
        let step = self.fire_params[0].max(0.001);
        while self.fire_accum >= step {
            self.fire_accum -= step;
            self.fire_step();
        }
    }

    // ---- R2: fire exports ---------------------------------------------------

    /// Replace the 6 uploaded sim-tuning params: [tick_sec, spread_base, wind_strength,
    /// wet_extinguish, wet_diffuse_rate, wet_spread_decay]. Called at init and by
    /// pushFireParams() — same live-re-upload pattern as set_materials.
    pub fn set_fire_params(&mut self, p: &[f32]) {
        for i in 0..6.min(p.len()) {
            self.fire_params[i] = p[i];
        }
    }

    /// Player-deliberate ignition (torch/firemaking). Only active chunks can catch (a fire that
    /// can't be simulated can't exist). Fails if already burning, out of fuel, or too wet.
    pub fn ignite(&mut self, tx: i32, ty: i32) -> bool {
        let (cx, cy) = chunk_of(tx, ty);
        let slot = match self.slot_of.get(&(cx, cy)) {
            Some(&s) => s,
            None => return false,
        };
        let idx = slot * CHUNK_TILES + local_index(tx, ty);
        if self.burn[idx] > 0.0 || self.fuel[idx] <= 0.0 || self.wet[idx] >= self.fire_params[3] {
            return false;
        }
        self.burn[idx] = 1.0;
        true
    }

    /// A campfire building: an eternal ignition source on its tile. Force-relit every fire_step
    /// while present (see fire_step step 0) — immune to the wet-extinguish check and never
    /// decrements its own fuel, so it burns for as long as the building exists regardless of
    /// what it's built on. Removing it lets the tile decay/extinguish like any ordinary fire
    /// from whatever fuel happens to remain (usually "almost immediately," which is the point).
    pub fn add_campfire(&mut self, tx: i32, ty: i32) {
        self.campfires.insert((tx, ty));
    }
    pub fn remove_campfire(&mut self, tx: i32, ty: i32) {
        self.campfires.remove(&(tx, ty));
    }

    pub fn fuel_at(&self, tx: i32, ty: i32) -> f32 { self.fire_field_at(&self.fuel, tx, ty) }
    pub fn burn_at(&self, tx: i32, ty: i32) -> f32 { self.fire_field_at(&self.burn, tx, ty) }
    pub fn wet_at(&self, tx: i32, ty: i32) -> f32 { self.fire_field_at(&self.wet, tx, ty) }
    pub fn is_burning(&self, tx: i32, ty: i32) -> bool { self.burn_at(tx, ty) > 0.0 }

    fn fire_field_at(&self, field: &[f32], tx: i32, ty: i32) -> f32 {
        let (cx, cy) = chunk_of(tx, ty);
        match self.slot_of.get(&(cx, cy)) {
            Some(&slot) => field[slot * CHUNK_TILES + local_index(tx, ty)],
            None => 0.0, // fire fields don't exist for inactive chunks — by design, see above
        }
    }

    /// Byte offset of the chunk's 256 burn values (f32, 4 bytes/elem — unlike chunk_ptr's u8
    /// slots) for the glow overlay's zero-copy bulk read. 0 if inactive.
    pub fn burn_ptr(&self, cx: i32, cy: i32) -> u32 {
        match self.slot_of.get(&(cx, cy)) {
            Some(&slot) => (self.burn.as_ptr() as usize + slot * CHUNK_TILES * 4) as u32,
            None => 0,
        }
    }

    pub fn wind_x(&self) -> f32 { self.wind.0 }
    pub fn wind_y(&self) -> f32 { self.wind.1 }

    /// One 10Hz CA step. Read-only pass over the CURRENT snapshot, collect every change into
    /// `deltas`, apply once at the end — see the module doc comment for why this order matters.
    fn fire_step(&mut self) {
        let dt = self.fire_params[0];
        let spread_base = self.fire_params[1];
        let wind_strength = self.fire_params[2];
        let wet_extinguish = self.fire_params[3];
        let wet_diffuse = self.fire_params[4];
        let wet_decay = self.fire_params[5];
        self.fire_tick_n = self.fire_tick_n.wrapping_add(1);
        let tick = self.fire_tick_n;
        let seed = self.seed;

        // 0) force-relight campfire tiles — they participate as burning sources for this same
        // tick's spread pass below, which is why this runs first.
        let campfire_tiles: Vec<(i32, i32)> = self.campfires.iter().copied().collect();
        for (tx, ty) in campfire_tiles {
            let (cx, cy) = chunk_of(tx, ty);
            if let Some(&slot) = self.slot_of.get(&(cx, cy)) {
                self.burn[slot * CHUNK_TILES + local_index(tx, ty)] = 1.0;
            }
        }

        let active: Vec<(i32, i32, usize)> =
            self.slot_of.iter().map(|(&(cx, cy), &slot)| (cx, cy, slot)).collect();

        // 1) burn/spread pass — read-only over the current snapshot
        enum Delta {
            Fuel(usize, f32),
            Burnout(i32, i32, u8),
            Extinguish(usize),
            Ignite(usize),
        }
        let mut deltas: Vec<Delta> = Vec::new();

        for &(cx, cy, slot) in &active {
            for ly in 0..CHUNK {
                for lx in 0..CHUNK {
                    let idx = slot * CHUNK_TILES + (ly * CHUNK + lx) as usize;
                    if self.burn[idx] <= 0.0 {
                        continue;
                    }
                    let tx = cx * CHUNK + lx;
                    let ty = cy * CHUNK + ly;
                    let is_hearth = self.campfires.contains(&(tx, ty));

                    if !is_hearth && self.wet[idx] >= wet_extinguish {
                        deltas.push(Delta::Extinguish(idx));
                        continue; // water wins outright — no spread from a doused tile
                    }

                    let mat = self.slots[idx] as usize;
                    if !is_hearth {
                        let new_fuel = self.fuel[idx] - dt;
                        if new_fuel <= 0.0 {
                            let burns_to = self.mat_burns_to(mat);
                            if burns_to >= 0 {
                                deltas.push(Delta::Burnout(tx, ty, burns_to as u8));
                            } else {
                                deltas.push(Delta::Extinguish(idx)); // defensive: fireproof but lit
                            }
                            continue; // no spread from a tile that just ran out this tick
                        }
                        deltas.push(Delta::Fuel(idx, new_fuel));
                    }

                    // spread to N/E/S/W neighbors (may live in a different active chunk)
                    for &(dx, dy) in DIRS4.iter() {
                        let ntx = tx + dx;
                        let nty = ty + dy;
                        let (ncx, ncy) = chunk_of(ntx, nty);
                        let nslot = match self.slot_of.get(&(ncx, ncy)) {
                            Some(&s) => s,
                            None => continue, // unloaded neighbor chunk — fire can't cross into it
                        };
                        let nidx = nslot * CHUNK_TILES + local_index(ntx, nty);
                        if self.burn[nidx] > 0.0 || self.fuel[nidx] <= 0.0 {
                            continue;
                        }
                        let nmat = self.slots[nidx] as usize;
                        let flam = self.mat_flammable(nmat);
                        if flam <= 0.0 {
                            continue;
                        }
                        let align = (dx as f32) * self.wind.0 + (dy as f32) * self.wind.1;
                        let wind_factor = (1.0 + wind_strength * align).max(0.1);
                        let wet_guard = (1.0 - self.wet[nidx]).max(0.0);
                        let p = (spread_base * flam * wind_factor * wet_guard).clamp(0.0, 1.0);
                        // depends only on (seed, target, tick) — order-independent, see spread_roll
                        if spread_roll(seed, ntx, nty, tick) < p {
                            deltas.push(Delta::Ignite(nidx));
                        }
                    }
                }
            }
        }

        // 2) wetness diffusion — full double-buffer: EVERY active tile updates every tick (not
        // just burning ones), so this can't safely use a sparse delta list like step 1 does.
        for &(cx, cy, slot) in &active {
            for ly in 0..CHUNK {
                for lx in 0..CHUNK {
                    let idx = slot * CHUNK_TILES + (ly * CHUNK + lx) as usize;
                    let tx = cx * CHUNK + lx;
                    let ty = cy * CHUNK + ly;
                    let mat = self.slots[idx] as usize;
                    let baseline = self.mat_wetness(mat);
                    let mut neighbor_max = 0.0f32;
                    for &(dx, dy) in DIRS4.iter() {
                        let (ncx, ncy) = chunk_of(tx + dx, ty + dy);
                        if let Some(&nslot) = self.slot_of.get(&(ncx, ncy)) {
                            let nidx = nslot * CHUNK_TILES + local_index(tx + dx, ty + dy);
                            if self.wet[nidx] > neighbor_max {
                                neighbor_max = self.wet[nidx];
                            }
                        }
                    }
                    let target = baseline.max(neighbor_max * wet_decay);
                    self.wet_next[idx] = self.wet[idx] + (target - self.wet[idx]) * wet_diffuse;
                }
            }
        }
        std::mem::swap(&mut self.wet, &mut self.wet_next);

        // 3) apply every collected delta
        for d in deltas {
            match d {
                Delta::Fuel(idx, f) => self.fuel[idx] = f,
                Delta::Burnout(tx, ty, new_mat) => {
                    let (cx, cy) = chunk_of(tx, ty);
                    if let Some(&slot) = self.slot_of.get(&(cx, cy)) {
                        self.write_active(slot, tx, ty, new_mat);
                        let idx = slot * CHUNK_TILES + local_index(tx, ty);
                        let m = new_mat as usize;
                        // reset this tile's fire identity to its new material
                        self.fuel[idx] = self.mat_fuel(m);
                        self.wet[idx] = self.wet[idx].max(self.mat_wetness(m));
                        self.burn[idx] = 0.0;
                    }
                }
                Delta::Extinguish(idx) => self.burn[idx] = 0.0,
                Delta::Ignite(idx) => self.burn[idx] = 1.0, // idempotent if scheduled twice
            }
        }
    }
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

    // ---- R2: fire -----------------------------------------------------------

    /// A small stride-7 table with real material ids so tests read naturally:
    /// 1=WATER (fireproof, wet source), 3=GRASS (short fuel), 5=FOREST (long fuel), 10=ASH.
    fn test_mats() -> Vec<f32> {
        let mut m = vec![0.0f32; 11 * 7];
        let mut set = |id: usize, flam: f32, fuel: f32, burns_to: f32, wet: f32| {
            let o = id * 7;
            m[o + 3] = flam;
            m[o + 4] = fuel;
            m[o + 5] = burns_to;
            m[o + 6] = wet;
        };
        set(1, 0.0, 0.0, -1.0, 1.0); // WATER
        set(3, 0.15, 2.0, 10.0, 0.05); // GRASS
        set(5, 0.45, 6.0, 10.0, 0.1); // FOREST
        set(10, 0.0, 0.0, -1.0, 0.0); // ASH
        m
    }

    #[test]
    fn fire_ignite_and_burn_out_produces_burns_to_override() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        c.activate_chunk(0, 0, &vec![3u8; CHUNK_TILES]); // GRASS everywhere, fuel = 2s
        assert!(c.ignite(5, 5));
        assert_eq!(c.burn_at(5, 5), 1.0);
        for _ in 0..25 {
            c.tick(0.1); // 2.5s total — past GRASS's 2s fuel
        }
        assert_eq!(c.override_at(5, 5), 10); // ASH
        assert_eq!(c.burn_at(5, 5), 0.0);
    }

    #[test]
    fn fire_spread_is_deterministic_given_seed_and_ticks() {
        fn run() -> String {
            let mut c = Core::new(777, 64);
            c.set_materials(&test_mats(), 7);
            for cy in -1..=1 {
                for cx in -1..=1 {
                    c.activate_chunk(cx, cy, &vec![5u8; CHUNK_TILES]); // FOREST, room to spread
                }
            }
            c.ignite(8, 8);
            for _ in 0..50 {
                c.tick(0.1);
            }
            let mut out = String::new();
            for dy in -5..=5 {
                for dx in -5..=5 {
                    out.push_str(&format!("{},", c.override_at(8 + dx, 8 + dy)));
                }
            }
            out
        }
        // two independent Core instances (independent HashMap iteration order — Rust's default
        // hasher is randomized per-instance) must still agree bit-for-bit: proves the "read
        // snapshot, collect deltas, apply once" discipline actually decouples the result from
        // iteration order, not just seed.
        assert_eq!(run(), run());
    }

    #[test]
    fn fire_extinguished_by_rising_wetness_near_water() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        let mut base = vec![5u8; CHUNK_TILES]; // FOREST (6s fuel)
        base[5 * CHUNK as usize + 6] = 1; // WATER at local (6,5)
        c.activate_chunk(0, 0, &base);
        assert!(c.ignite(5, 5)); // FOREST tile immediately west of the water
        for _ in 0..15 {
            c.tick(0.1); // 1.5s — well under FOREST's 6s fuel
        }
        assert_eq!(c.burn_at(5, 5), 0.0, "should be extinguished by rising wetness, not burned out");
        assert!(c.fuel_at(5, 5) > 0.0, "fuel should NOT be exhausted — this is an extinguish, not a burnout");
        assert!(c.wet_at(5, 5) > 0.55);
    }

    #[test]
    fn fire_does_not_ignite_wet_tile() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        let mut base = vec![5u8; CHUNK_TILES];
        base[5 * CHUNK as usize + 6] = 1; // WATER neighbor
        c.activate_chunk(0, 0, &base);
        for _ in 0..15 {
            c.tick(0.1); // let wetness diffuse in WITHOUT igniting first
        }
        assert!(c.wet_at(5, 5) > 0.55);
        assert!(!c.ignite(5, 5), "a sufficiently wet tile should refuse to ignite");
    }

    #[test]
    fn fire_wind_is_deterministic_from_seed() {
        let a = Core::new(42, 4);
        let b = Core::new(42, 4);
        assert_eq!(a.wind_x(), b.wind_x());
        assert_eq!(a.wind_y(), b.wind_y());
        let len = (a.wind_x() * a.wind_x() + a.wind_y() * a.wind_y()).sqrt();
        assert!((len - 1.0).abs() < 1e-4);
    }

    #[test]
    fn fire_does_not_cross_into_inactive_chunk() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        c.activate_chunk(0, 0, &vec![5u8; CHUNK_TILES]); // FOREST
        c.ignite(15, 5); // east edge of chunk (0,0); chunk (1,0) is never activated
        for _ in 0..80 {
            c.tick(0.1); // plenty of ticks for spread to have crossed if it could
        }
        assert!(c.activate_chunk(1, 0, &vec![5u8; CHUNK_TILES]));
        assert_eq!(c.override_at(16, 5), -1); // never touched while inactive
        assert_eq!(c.burn_at(16, 5), 0.0);
    }

    #[test]
    fn campfire_refuels_indefinitely() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        c.activate_chunk(0, 0, &vec![3u8; CHUNK_TILES]); // GRASS, natural fuel only 2s
        c.add_campfire(5, 5);
        for _ in 0..100 {
            c.tick(0.1); // 10s — far past GRASS's natural fuel
        }
        assert_eq!(c.burn_at(5, 5), 1.0, "a campfire should still be lit long past its ground's natural fuel");
    }

    #[test]
    fn campfire_removed_lets_fire_die_naturally() {
        let mut c = Core::new(1, 8);
        c.set_materials(&test_mats(), 7);
        c.activate_chunk(0, 0, &vec![3u8; CHUNK_TILES]); // GRASS
        c.add_campfire(5, 5);
        c.tick(0.1);
        assert_eq!(c.burn_at(5, 5), 1.0);
        c.remove_campfire(5, 5);
        for _ in 0..25 {
            c.tick(0.1); // GRASS's ~2s natural fuel should now run out
        }
        assert_eq!(c.burn_at(5, 5), 0.0);
        assert_eq!(c.override_at(5, 5), 10); // burns out to ASH like any ordinary grass fire
    }

    #[test]
    fn set_materials_uses_uploaded_stride() {
        let mut c = Core::new(1, 4);
        let mut m = vec![0.0f32; 3 * 7];
        m[2 * 7 + 6] = 0.42; // material id 2, wetness offset 6
        c.set_materials(&m, 7);
        assert_eq!(c.mat_wetness(2), 0.42);
    }
}
