// B6 — Level-Up Flourish.
//
// Before this, a level-up was a toast in the corner and — at two of the seven
// call sites — a sound. Firemaking and Combat levelled up in total silence.
// The ask was for "a level up animation for stuff? like wow maybe?", and the
// thing WoW actually does is put the event ON the character: you do not read
// that you levelled, you see it happen to you.
//
// One helper rather than seven copies, because the seven sites had already
// drifted apart once (two played the sound, five did not) and would again.
import { CFG } from '../data/config';
import { Sound } from '../../engine/audio';

/** Fires on SKILL levels only.
 *
 *  Not soul-gear levels and not Loom points, both of which are frequent: a
 *  flourish that fires several times a minute stops reading as an achievement
 *  and becomes the always-on intensity problem that got the combat-proximity
 *  music rolled back on 2026-08-14. If soul-gear should get its own beat it
 *  wants a quieter, different one — not a second copy of this. */
export function levelUpFlourish(ctx: any) {
  if (!CFG.ui.levelFlourish) return;
  const p = ctx.player;
  if (!p) return;
  // The player sprite's origin is its feet; the burst wants to sit on the body.
  ctx.views?.addLevelUpBurst?.(p.x, p.y - 4);
  ctx.particles?.spawn?.('levelup', p.x, p.y - 8, 18);
  Sound.play('levelup');
}
