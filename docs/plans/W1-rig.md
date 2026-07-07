# W1 — 360° parametric rig animator (player pass)

Branch: `feat/w1-rig`. Scope for this pass: **the player only** (per ROADMAP's own
suggestion to split W1 into player-first, then foes/bosses as a follow-up). Read
`ROADMAP.md` for the architectural decision this implements.

## The approach

Rather than independently rotating every body part (a full inverse-kinematics rig,
overkill for pixel-blob characters), the rig is **one rigid part-group that rotates
as a whole toward `facing`** (a float, radians — 0 = pointing right, matching the
existing swing-angle convention in `combat.ts`), like a paper cutout on a pin. Parts
are laid out and baked in a single "facing = 0" reference pose; `body.rotation =
facing` does all the aiming. This is the pseudo-3D-in-2D trick: a flat cutout on a
turntable, not real 3D geometry, but the turntable itself is real, continuous, and
functional — any of the 360 angles is just `body.rotation = <that angle>`, no baked
frames.

On top of the rigid rotation, individual parts get **local** animation inside that
rotated frame (which is the "skeletal" part of "parametric skeletal rig"):
- **legs**: alternate lift for a walk cycle (existing bob logic, now parametric —
  `pose()` computes the offset from `t`, not a frame index).
- **arm + tool**: swing through an arc during an attack, sourced from the same
  `meleeArc` config the hit-detection already uses, so the visual and the hitbox
  agree. This finally gives the attack a readable animation (the original playtest
  complaint — "attack needs more clear animation, can't really see much").

## Visible slow-motion turning

`facing` (target) is computed instantly from input (`atan2(ay, ax)`), but the
value actually fed to `body.rotation` — call it the *smoothed* facing — slews
toward the target at a capped angular rate (`CFG.player.turnSpeed`, rad/s), taking
the shortest way around the circle. That's what makes turning a visible, readable
animation instead of an instant snap; tune the feel by editing
`CFG.player.turnSpeed` live via `window.NW.CFG`. The smoothing happens in the fixed
30 Hz sim step (deterministic, same as everything else), and is interpolated for
render the same way position already is (`px/py` → `x/y` by `alpha`).

## Files

- `engine/procgen/parts.ts` (new): `makePlayerParts(seed)` bakes torso/head/legL/
  legR/arm/tool as small independent canvases, palette-rolled exactly like the old
  `makePlayerFrames` (reuses `PLAYER_POOL`) so a given seed still "feels like the
  same hero," just decomposed into parts instead of whole-body frames.
- `engine/procgen/rig.ts` (new): `Rig` (ordered parts with pivot/baseOffset/z),
  `pose(locomotion, tLoc, attack) → Pose` — a pure function, no state. `attack` is
  `{ t, dur } | null`; when present it overrides the arm/tool local transform with
  the swing sweep, independent of whatever the legs are doing (you can still move
  while swinging, matching the current combat system).
- `world/rigview.ts` (new): a `Container` per rig instance; `update(locomotion, t,
  facing, attack)` sets `body.rotation = facing` and applies `pose()`'s per-part
  transforms to each child sprite. One class, reused by the player now, by foes/
  bosses in the follow-up pass.
- `world/player.ts`: drop `makePlayerFrames`/the direction-keyed texture sets;
  `facing`/`targetFacing`/`pFacing` are floats; `playAttack()` starts the swing
  timer that `render()` turns into the `attack` pose argument; `sprite` becomes
  `view: RigView` (`view.cont` is the addChild target).
- `main.ts`: `player.sprite` → `player.view.cont` (2 call sites).
- `systems/combat.ts`: drop the `FACING_ANGLE` string→radians table — `player.facing`
  is already the angle; call `player.playAttack()` alongside the existing slash VFX
  so the character's own arm visibly swings, not just a detached crescent effect.

## Explicitly out of scope for this pass (deferred)

- Foe/boss rigs (2–3 part versions derived from `EnemyDef.art`) — separate follow-up
  using the same `RigView`/`pose()` machinery once the player pass is proven.
- Mouse-aim facing (ROADMAP marks this optional; movement-direction facing already
  delivers full 360° aiming with much less risk — revisit if it's actually missed).
- The full windup→active→recovery attack state machine (that's W3, "needs W1" —
  this pass only needs to make *an* attack pose exist and be driven by a timer;
  W3 replaces the timer with the real state machine and reuses the same pose).

## Accept

- `player.facing` is a float; moving in any direction (not just the 4 cardinals)
  visibly aims the character that way.
- Reversing direction turns smoothly over a fraction of a second, not an instant
  flip — tunable via `CFG.player.turnSpeed`.
- Attacking visibly swings the arm/tool through the melee arc.
- No baked frame lookup remains for the player — `pose()` is the only source of
  per-part transforms.
