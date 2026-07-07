# W2 — Soul Gear (weapon/armor/tools pass)

Branch: `feat/w2-soulgear`. Scope for this pass: weapon, armor, and the two profession
tools (axe, pick) — the equippables that already exist in-game. Rings/amulets/charms
and the "Soul Satchel" (inventory size) are explicitly deferred (see below).

## The key simplification

The ROADMAP originally framed Soul Gear as uid'd item *instances*. Once actually
designing it against this codebase, a simpler model fits the existing equip system
much better and is still fully "soul-bound, congenital, leveled by use, RS-scale
grind": **the equip SLOT itself is the soul-bound tool, not any physical item.**

A slot's soul tool "reincarnates" into whatever's the best physical item you
currently wield there — that's just its base stat — but its cultivated `level`/`xp`
(the actual grind) persists across every upgrade, forever, forged into your soul
rather than the metal. This needs zero inventory-model change (materials and gear
both stay in the existing stackable `inv` count-map) and reuses the existing
equip/autoEquip machinery almost entirely, instead of building a parallel uid'd
instance system + new inventory UI. `data/soulgear.ts` holds one growth curve per
slot (`weapon`/`armor`/`tool_axe`/`tool_pick`); `state.player.soulItems` holds one
`{ templateId, level, xp }` per slot.

## Files

- `data/soulgear.ts` (new): `SoulSlot` type, `SOULGEAR` growth-per-level table,
  `baseStatFor(slot, itemId)` reading the physical item's raw stat from `data/items.ts`.
- `state.ts`: `player.soulItems: Partial<Record<SoulSlot,SoulItem>>`; `newState()`
  soul-binds the starting axe/pick at level 1 so tool progression starts immediately.
- `rules.ts` (extended, no new systems file — this is where equip/xp logic already
  lives): `soulXpToNext/soulLevelFromXp/soulXpProgress` (RS-scale curve, config.soulgear),
  `soulStat(state, slot)` (base + growth×(level-1)), `bindSoulItem` (create-or-retarget),
  `awardSoulXp`, and `acquireGear` (autoEquip + keep the relevant soul item(s) bound —
  the new single call site replacing `autoEquip` wherever gear enters the bag).
  `equippedWeaponDmg`/`armorDef` now read the soul-scaled stat instead of the item's
  flat one. `toggleEquip` (manual re-gear in the Bag UI) re-binds on equip so soul
  stats never go stale if you manually swap to a different owned item.
- `config.ts`: `soulgear: { xpBase, xpGrowth, maxLevel, weaponXpPerSwing,
  armorXpPerHit, toolXpPerUse }` — tune live via `window.NW.CFG`.
- `systems/gather.ts`: tool speed uses the soul-scaled power; a successful gather
  awards the matching tool slot xp.
- `systems/combat.ts`: a landed swing awards weapon xp; taking a hit while armor is
  worn awards armor xp.
- `systems/{crafting,hordes,worldbosses}.ts`: swapped `autoEquip` → `acquireGear`.
- `ui.ts`/`styles.ts`: the Bag's weapon/armor slot cells show a soul-level chip + xp
  bar; the tools line shows each tool's soul level.

## Explicitly deferred (not this pass)

- Rings, amulets, charms — new slot *types* need new items/art/balance, not just
  systems work; a natural next slice once this spine is proven.
- The "Soul Satchel" (inventory-size upgrade) — there's no inventory cap in the game
  at all right now (`inv` is an unbounded map), so this is a new mechanic, not a
  re-skin of something that exists. Deferred with the ring/amulet/charm content.
- "Feed materials" to level gear directly (an idle-game-style sink) — passive
  use-based xp is the core loop implemented here; feeding is an enhancement on top.

## Accept

- Owning any axe/pick soul-binds it immediately (starting gear included).
- Gathering/landing hits/taking hits (while worn) grants the matching slot xp and
  levels it on the config'd curve.
- Damage/armor/gather-speed numbers reflect the soul-scaled stat, not the raw item.
- Manually re-gearing to a different owned weapon/armor re-binds correctly (no
  stale stat mismatch between what's worn and what's computed).
