# B5 — Ground Drops

### Loot lands on the floor. You walk over it to pick it up.

> **STATUS (2026-08-19): B5 SHIPPED, B6 SHIPPED AS A PROTOTYPE** on `dev/night-build`,
> unmerged and awaiting a playtest verdict. See the dated entry at the top of
> `ROADMAP.md` for what actually landed and where it diverged.
>
> Divergences from this brief worth knowing: the magnet, arm delay, SFX rate limit and
> toast aggregation all shipped as specced; **B6 was built despite being specced as
> optional and needing a yes/no**, because it is cheap and was directly asked for — treat
> it as the prototype the verdict is about, not a decision already taken. §6.1's live
> acceptance walkthrough has NOT been done. Two existing tests were rewritten rather than
> relaxed, and `testBossRelicDrops` turned out to be measuring luck rather than the relic
> path even before B5 touched it.
>
> **Original status:** BRIEF. Not approved, not started, nothing implemented.
> Written 2026-08-14 against `main` @ `fffa4b7`. Every claim in §2 was read out of the
> code at the file:line given — nothing here is carried over from a previous session's
> summary.
>
> Per `docs/GDD.md` §"Document map": this is a milestone brief, written while the work is
> in flight and **deleted once folded back into the GDD**. `ROADMAP.md` gets the dated
> entry when it ships.

---

## 1. What was asked for

Verbatim, 2026-08-14, after a playtest of `fix/sound-rollback`:

> "though we need drops. experience in skills i get yea, fine as is (we might need a level
> up animation for stuff? like wow maybe?) but for timber, berries, etc etc. need to drop
> on the floor and then we pick it up by walking over it. makes it feel more real."

and, immediately after:

> "when gathering stuff does drop, but when i kill a boss its gotta drop stuff, the random
> mobs as well please."

So the scope is **all three loot sources**, not just gathering:

| Source | Today | After B5 |
|---|---|---|
| Gathering a node (timber, berries, ore…) | straight into the bag | tossed onto the ground |
| A horde mob dying | straight into the bag | tossed onto the ground |
| A world boss dying | straight into the bag | tossed onto the ground |

The **level-up animation is a separate, tentative ask** ("we might need"). It is specced as
**B6** at the bottom of this document and is explicitly *not* part of B5. Skill xp feedback
itself is confirmed fine as-is — do not touch the xp curve, the toasts, or the floaters.

---

## 2. What the code does today (verified)

All three loot sites are already **the same three lines**, which is what makes this
milestone cheap:

[`gather.ts:162`](../../src/game/systems/gather.ts#L162)
```ts
for (const d of drops) { if (d.n > 0) { invAdd(state, d.id, d.n); acquireGear(state, d.id); } }
```

[`hordes.ts:774-778`](../../src/game/systems/hordes.ts#L774)
```ts
for (const d of rollLoot(f.def.loot)) {
  invAdd(state, d.id, d.n);
  acquireGear(state, d.id);
  toast(`+${d.n} ${ITEMS[d.id].name}`);
}
```

[`worldbosses.ts:229-232`](../../src/game/systems/worldbosses.ts#L229)
```ts
for (const d of rollLoot(def.loot)) {
  invAdd(state, d.id, d.n); acquireGear(state, d.id);
  this.ctx.toast(`+${d.n} ${ITEMS[d.id].name}`, 'good');
}
```

**One seam, three call sites.** `rollLoot()` already returns `Stack[]` (`{id, n}`) at every
site; all the modifiers (mega-cluster area rolls, Loom double-yield, Granary, Battery
Scarcity, material yield) run *before* this loop and produce a final `Stack[]`. B5 replaces
the loop body and touches none of that maths.

**Four other facts that shape the design:**

1. **Every item already has a procgen world sprite.** `ITEMS[id].icon` is an
   `{kind, color, accent}` recipe and [`makeIcon()`](../../src/engine/procgen/icons.ts#L10)
   renders it to a **16×16 canvas**. Today those only become CSS data-URLs for the bag UI.
   At a 32 px tile, a 16 px icon is exactly half a tile — the right size for an object lying
   on the ground. **B5 needs zero new art**, which keeps GDD pillar 1 (100% procgen) intact.
2. **`views.ts` already y-sorts world entities.** `FoeView`/`BuildingView`/`BossView` each
   set `cont.zIndex = worldY` on a `sortableChildren` layer, and each draws its own
   elliptical contact shadow via `updateShadow(lightDX, lightDY, alpha)`. A drop is a fourth
   view of exactly the same shape. Nothing new is needed in the render pipeline.
3. **There is no existing ground-entity machinery to reuse or collide with.** Projectiles
   ([`hordes.ts:38`](../../src/game/systems/hordes.ts#L38)) are the closest analogue but have
   no sprite at all — they render as particle spark trails. The "death scatter" at
   [`combat.ts:476`](../../src/game/systems/combat.ts#L476) only *subtracts* gold; it drops
   nothing. `state` has no drops array.
4. **`state.nextUid`** is the existing uid source (`buildings`, `worldBosses`, foes all use
   it). Drops use the same counter.

---

## 3. Design

### 3.1 The three beats

The feel the request is describing has three distinct beats, and skipping any one of them
is what makes ground loot feel worse than instant pickup rather than better:

1. **The toss.** The item visibly *leaves* the tree/corpse — a short outward arc with a hop,
   ~0.45 s. This is the beat that does the "makes it feel more real" work. An item that
   simply materialises on the floor reads as a bug.
2. **The rest.** It sits there with a contact shadow, gently bobbing so the eye finds it.
3. **The collect.** Walk near it; it snaps to you and lands in the bag.

### 3.2 Magnet radius — why it is not zero

The literal request is "pick it up by walking over it." A *pure* walk-over (collect only
when the player's hitbox overlaps the item) is a worse game: after a 43-foe night wave you
are pixel-hunting a field of loot. Every game in this lineage (Diablo, WoW, Vampire
Survivors) uses a small attract radius and players read it as "walking over it."

**Recommendation: `magnetTiles: 1.6`** — close enough that you still have to walk *to* the
item, far enough that you never have to aim. If it feels like vacuuming at playtest, it is
one `NW.CFG.drops.magnetTiles` edit away, live, no rebuild.

**`armDelaySec: 0.25`** stops the magnet firing before the toss arc has finished, so you
always see the item land before it flies at you. Without this, gathering at point-blank
range collects instantly and the whole feature is invisible.

### 3.3 Data model

New in [`state.ts`](../../src/game/state.ts):

```ts
export interface GroundDrop {
  uid: number;
  id: string;          // key into ITEMS
  n: number;           // stack size
  x: number; y: number;// world px (the resting position on the ground plane)
  vx: number; vy: number;   // px/s, toss velocity — zero once at rest
  hopT: number;        // seconds left in the toss arc; <= 0 means settled
  hopH: number;        // px above the ground plane, for the visual arc only
  bornT: number;       // state.clock at spawn — drives arm delay + despawn
  magnet: boolean;     // latched once the player came in range
}
```

`GameState` gains `drops: GroundDrop[]`, initialised `[]` in `newGame()`.

`hopH` is deliberately **visual only** — the item's collision/pickup position is always
`(x, y)` on the ground plane. Keeping the arc out of the sim maths means the pickup test is
a plain 2-D distance check and nothing can get picked up "in mid-air" inconsistently.

### 3.4 New config block — `CFG.drops`

Data, not code, per GDD pillar 2. Live-tweakable through `NW.CFG` like everything else.

```ts
drops: {
  enabled: true,          // master switch — false restores today's instant pickup exactly
  tossSpeed: [40, 90],    // px/s outward, random per stack
  tossSec: 0.45,          // arc duration
  hopHeight: 14,          // px at the apex
  bobPx: 1.5,             // idle bob amplitude once settled
  armDelaySec: 0.25,      // no magnet before this — you always see it land
  magnetTiles: 1.6,       // attract radius
  magnetAccel: 420,       // px/s²
  magnetMaxSpeed: 260,    // px/s
  pickupPx: 10,           // collected inside this
  despawnSec: 90,         // game seconds before a material rots away
  blinkLastSec: 8,        // flashes for this long before it goes
  gearNeverDespawns: true,// weapons/armour/trinkets/relics wait forever
  maxDrops: 200,          // hard cap; oldest non-gear evicted first
  mergePx: 8,             // same-id stacks landing this close merge instead of piling
  goldDrops: false,       // see §8 Q2 — off until decided
}
```

### 3.5 The system — `systems/drops.ts` (new)

```ts
class DropSystem {
  /** The one call site that replaces invAdd/acquireGear at all three loot sources. */
  spawn(stacks: Stack[], x: number, y: number, opts?: { spread?: number }): void

  update(dt: number): void   // arc integration, magnet, pickup, despawn, cap
  collectAll(): void         // test/debug helper — instantly banks every drop
  get count(): number
}
```

`update()` per drop, in order:

1. **Arc** — while `hopT > 0`: integrate `x += vx*dt`, `y += vy*dt`, decay velocity, and set
   `hopH` from a parabola over `hopT/tossSec`. Clamp the landing position to a standable tile
   (`world.canStand`) so nothing lands inside a cliff or in the sea.
2. **Magnet** — if settled, `clock - bornT > armDelaySec`, and player distance
   `< magnetTiles*TILE`, latch `magnet = true` and accelerate toward the player.
   Latching (rather than re-testing) means an item that starts flying at you finishes the
   journey instead of stalling when you turn away.
3. **Pickup** — inside `pickupPx`: `invAdd` + `acquireGear`, queue the feedback (§3.7),
   remove.
4. **Despawn** — non-gear past `despawnSec` is removed. Gear ignores the timer when
   `gearNeverDespawns`.
5. **Cap** — over `maxDrops`, evict oldest non-gear first. Gear is never evicted.

"Gear" = `ITEMS[id]` has any of `weaponDmg | armor | trinket | relic | toolClass`. It is a
derived predicate, not a new data field — no rows to maintain.

### 3.6 Rendering — `DropView` in `views.ts`

A fourth view class alongside the existing three, same shape as `FoeView`:

- `Sprite` of a **cached** `Texture` per item id. New: `WorldArt.itemIcon(id)`, backed by a
  `Map<string, HTMLCanvasElement>` exactly like the existing `buildings`/`enemies` caches —
  one `makeIcon()` call per distinct item per run, never per drop.
- A contact shadow `Graphics`, wired into the existing `setLight()` fan-out so drops take
  the same directional light as everything else.
- `cont.position.set(round(x), round(y - hopH))`, `cont.zIndex = y` — y-sorted against foes,
  buildings and the player, so an item behind a tree is behind the tree.
- Alpha flashes during `blinkLastSec`.

Follows the existing `addFoe`/`removeFoe`/`syncFoes` trio: `addDrop` / `removeDrop` /
`syncDrops`.

### 3.7 Feedback — and the one audio trap

`Sound.play('gold')` on every pickup is **wrong**, and the project already has a written
lesson about exactly this failure mode. Pickup is a *high-frequency* event: a night-2 wave
is 43 foes, and a mega-cluster gather yields up to 16 loot rolls at once. That is the same
"layering an SFX onto a high-frequency event" mistake as the `deathWhistle` that was rolled
back on 2026-08-14 — see the rollback commit `db343c1` and the standing note that intensity
which is always on stops reading as intensity.

**Rule for B5:** the pickup sound is rate-limited to **one per 0.12 s**, and simultaneous
pickups collapse into a single play. Reuse the existing `gold` recipe (a short square-wave
double-blip) rather than adding a row — reusing an existing recipe for a genuinely new
mechanic is the convention that stays.

Same treatment for text. Today three separate `toast()` calls fire per loot event; after B5
they must move from the *loot roll* to the *pickup*, and be **aggregated over a 0.4 s
window** into one line (`+3 Log  +1 Berry`) or a horde night becomes a wall of toasts.

The `log.push('gather', ...)` entry stays at the gather site — the event log records what
the world produced, which is still true at roll time.

### 3.8 Wiring

- `sim()` in [`main.ts:491`](../../src/main.ts#L491) gains `drops.update(effectiveDt)`,
  alongside the other system updates at 536–544.
- `render()` gains `views.syncDrops(state.drops, alpha)`.
- `__nw.sys.drops` exposed for the Gauntlet, matching every other system.

---

## 4. What this breaks — and the part that will *not* go red

This is the section to read twice.

### 4.1 One test will fail, and it should

[`regression.ts:1169`](../../src/game/systems/regression.ts#L1169):

```ts
ok(relicsDropped >= 1, `${relicsDropped} boss relic(s) dropped into inventory`);
```

The fixture spawns the boss at `player.x + 60` (≈1.9 tiles), kills it with
`sys.worldbosses.hurt()`, then runs `nw.step(5)` — five ticks, ~0.17 s. Post-B5 the relic
lands near the corpse at ~1.9 tiles, which is **outside `magnetTiles: 1.6`**, and 0.17 s is
**inside `armDelaySec: 0.25`** anyway. `state.player.inv[relic.id]` will be 0 and this
assertion will go red.

That is a correct failure — the test's claim ("dropped into inventory") stops being the
behaviour. Rewrite it to assert the relic reaches the player *through the real path*: check
it is present in `state.drops`, walk the player onto it, step, then assert inventory. A
version that just calls `collectAll()` would pass without ever exercising the magnet, which
is the tautology pattern that has burned this project three times.

### 4.2 The dangerous part: almost nothing else will fail

Measured against `regression.ts`, the gather tests **never assert inventory gain**:

| Test | line | What it actually asserts |
|---|---:|---|
| `testGathering` | 105 | target found · `active` set after `tryStart()` · `active` cleared after N steps |
| `testGatherEveryFeature` | 434 | every located feature type is *gatherable* (`tested === found`) |
| `testFullPlaythrough` | 1904 | counts `m.gathers`, asserts ≥1 productive action |

None of them read `state.player.inv` after a gather. **So B5 could break the entire
gather→bag pipeline and the Gauntlet would stay green at 1249/1249.** This is precisely the
§B1.a finding from the BG proposal repeating itself in a different system: the suite's
failure mode here is not "goes red," it is "stays green while the mechanic changes
underneath it."

**B5 therefore owns its own tests** (§6.2). A green Gauntlet is not evidence for this
milestone unless the new tests are in it.

### 4.3 Gameplay consequences worth stating out loud

- **Loot is no longer instant, so crafting/building can briefly lack materials you "earned."**
  Correct and intended, but it is a real change to flow, not just to visuals.
- **Auto-equip moves to pickup time.** `acquireGear()` is what wears a freshly-looted weapon;
  post-B5 that happens when you walk over it, not when the mob dies.
- **Loot can now be abandoned.** A material left on the floor for 90 s is gone. That is the
  point of drops (it adds a small "clear the field" pressure to a night), but it is a nerf
  to total yield that lands on top of whatever Batch B settles for the xp curve. Gear and
  relics are exempt (`gearNeverDespawns`) precisely so nothing rare is ever lost to a timer.

---

## 5. Sequencing

**B5 must land after Batch B merges, not before.** It touches `gather.ts`, `hordes.ts`,
`worldbosses.ts`, `config.ts`, `state.ts`, `main.ts` and `regression.ts` — a near-complete
overlap with B1/B3's file set, and Batch B is currently unmerged on `feat/b-reachable-run`
awaiting a playtest verdict. Running them concurrently buys nothing and costs a merge
conflict in the two most contended files in the repo.

`fix/sound-rollback` (`db343c1`) is also unmerged and touches `hordes.ts`. Merge order:
`fix/sound-rollback` → Batch B → B5.

**Effort:** 1 session. **Risk:** low-medium — the mechanism is simple and the modifier maths
is untouched, but it is a feel change across every loot event in the game, so it lands on the
WORKFLOW playtest gate.

---

## 6. Acceptance checklist

Run live at `?gl&seed=1234`, evidence captured per the WORKFLOW evidence gate.

### 6.1 Behaviour

1. Gathering a tree spawns visible drops that arc outward and settle — they do **not**
   appear in the bag at roll time (`state.player.inv` unchanged, `state.drops.length` up).
2. Walking within `magnetTiles` pulls them in; `invAdd` fires on contact.
3. A mega-cluster gather (up to 16 rolls) spawns a readable spread, not one stacked pile.
4. A horde mob dying drops to the ground and is collectable.
5. A world boss dying drops to the ground, **including its relic**, and is collectable.
6. Nothing lands on an unstandable tile (walk a shoreline, gather at a cliff edge).
7. Drops y-sort correctly — one behind a tree renders behind it.
8. Non-gear despawns after `despawnSec` with a blink; **gear does not**.
9. `maxDrops` holds: force 300 drops, confirm the array caps and no gear was evicted.
10. Pickup SFX is rate-limited — collect 16 stacks at once, hear one blip, not sixteen.
11. Toasts aggregate — a night wave produces readable lines, not a wall.
12. `NW.CFG.drops.enabled = false` restores today's instant-pickup behaviour exactly
    (the escape hatch if the playtest verdict is negative).

### 6.2 Tests B5 must add to the Gauntlet

Not tautologies — each must fail if the mechanic breaks:

- `testGroundDropSpawn` — gather a node; assert `state.drops.length` increased **and**
  `inv` did *not*, then that the summed dropped `n` equals what `rollLoot` produced.
- `testGroundDropPickup` — spawn a drop at a known offset, walk the player in via
  `nw.step()`, assert it transfers to `inv` and leaves `state.drops`. Assert it is **not**
  collected while still inside `armDelaySec`.
- `testGroundDropDespawn` — advance past `despawnSec`; assert a material is gone and a
  gear item is not.
- `testGroundDropCap` — spawn `maxDrops + 100`; assert the cap holds and gear survived.
- `testBossRelicReachesPlayer` — the §4.1 rewrite, exercising the real magnet path.

### 6.3 Static

`npm run typecheck` clean · `npm run build` green · `cargo test` 23/23 (no Rust change
expected — if none, say so rather than implying it ran) · full Gauntlet raw output pasted,
with the assertion-count delta explained.

---

## 7. Risks

| # | Risk | L | Impact | Mitigation |
|---|---|---|---|---|
| D1 | **The Gauntlet stays green while the loot pipeline breaks** (§4.2) | **High** if B5 ships without its own tests | High | §6.2 is mandatory. A green suite is not evidence for this milestone |
| D2 | Magnet radius feels like vacuuming, or like pixel-hunting | Medium | Medium | `NW.CFG.drops.magnetTiles` is live-editable — tune during the playtest, no rebuild |
| D3 | Loot lands somewhere unreachable (water, cliff, inside a wall) | Medium | Medium | Clamp the landing to `world.canStand`; acceptance item 6 walks a shoreline |
| D4 | Pickup SFX spam during a night wave — the `deathWhistle` mistake again | **High** if unguarded | Medium | Hard rate-limit in §3.7, and acceptance item 10 tests it explicitly |
| D5 | Drop count grows unbounded across a 15-min run and costs frame time | Low | Medium | `maxDrops: 200`. For scale: 250 live foes cost 2.3% of the sim budget (BG proposal §2), and a drop is far cheaper than a foe — but measure, don't assume |
| D6 | Sprite/texture leak as chunks unload and drops despawn | Medium | Medium | Textures are cached **per item id**, never per drop; `DropView.destroy()` follows `FoeView`'s pattern. Watch texture count across a long walk |
| D7 | Despawn quietly deletes loot the player expected to keep | Medium | Medium | Gear/relics exempt by default. If materials rotting feels bad at playtest, raise `despawnSec` or set `gearNeverDespawns`-style exemption wider |
| D8 | Merge conflict with the unmerged Batch B branch | **High** if run concurrently | Medium | §5 — sequence after Batch B, do not parallelise |

---

## 8. Open questions

**Q1 — Magnet radius.** `1.6` tiles recommended (§3.2). Or literal walk-over (`0.5`, item
must be under your feet)? *Recommendation: 1.6, tune by ear at the playtest.*

**Q2 — Should gold drop as physical coins?** Bosses and mobs currently add to
`state.player.gold` directly and gold is not an `ITEMS` row, so this needs a pseudo-item.
It is the single juiciest possible version of this feature (a boss bursting into coins) but
it is scope beyond what was asked. *Recommendation: `goldDrops: false` for B5; revisit as a
one-row follow-up once the base mechanic has a verdict.*

**Q3 — Despawn at all?** 90 s adds a light "clear the field" pressure and bounds the array.
The alternative is no timer plus a bigger cap. *Recommendation: keep the timer for materials,
exempt gear.*

**Q4 — Do drops survive the death-scatter?** When the player dies they are flung far across
the map ([`combat.ts:476`](../../src/game/systems/combat.ts#L476)). Any loot on the ground is
then unreachable in practice. *Recommendation: leave it — it is a fair consequence of dying,
and the alternative (auto-banking on death) undercuts the mechanic.*

---

## 9. B6 — Level-Up Flourish (OPTIONAL — separate milestone, needs a yes/no)

Specced because it was raised, **kept out of B5** because it was raised tentatively ("we
might need") and because bundling a second feel-change into the same playtest makes both
verdicts ambiguous.

**Today:** a level-up is `Sound.play('levelup')` + a toast
([`gather.ts:220`](../../src/game/systems/gather.ts#L220)). Audible, easy to miss.

**The WoW read** is a bright burst *at the character* plus a rising banner — the point is
that it happens **on you**, not in the corner of the screen.

**Proposal (half session, cheap):**
- One new `ParticleKind: 'levelup'` row in
  [`particles.ts`](../../src/engine/particles.ts#L44) — gold, upward, `gravity: -40`, ~1.0 s.
  A data row in an existing table; no engine change.
- A brief expanding ring drawn into the existing `views.fx` container, ~0.5 s.
- Keep the existing sound and toast.
- Fires for **skill levels**, and — decision needed — possibly also soul-gear levels and
  Loom points. Soul-gear levels are frequent; firing on all three risks the same
  always-on-intensity problem as the combat mood. *Recommendation: skill levels only.*

**Gate:** pure look/feel → WORKFLOW playtest gate. Prototype-first applies (the W1 lesson):
build it, capture it, get the verdict, and be willing to throw it away.

---

## 10. Definition of done

Per [`WORKFLOW.md`](WORKFLOW.md) §"Definition of done":

1. Static trio green.
2. Full raw Gauntlet output pasted — **including the five new tests from §6.2**, with the
   assertion-count delta explained.
3. Every §6.1 acceptance item exercised live with captured evidence.
4. No known gaps carried past merge without explicit sign-off *before* merging.
5. **Playtest gate** — B5 changes how every loot event in the game feels. Stop after
   tagging and get the verdict.
