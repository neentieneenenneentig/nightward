// Body parts for the 360°-rotating parametric player rig: small independent
// canvases (torso/head/legs/arm/tool), each baked once per seed as if facing
// "forward" along local +x. The rig container does the actual aiming by
// rotating the whole part group toward `facing` — these textures never rotate
// pre-baked, `rig.ts` + `rigview.ts` transform them live.
import { mulberry32 } from '../rng';
import { type RGB, PLAYER_POOL, darken } from './palette';
import { Pix } from './sprites';

export interface PlayerParts {
  torso: HTMLCanvasElement;
  head: HTMLCanvasElement;
  legL: HTMLCanvasElement;
  legR: HTMLCanvasElement;
  weapon: HTMLCanvasElement;
}

/** Rolls a palette from the seed (same pools as the old baked frames) and bakes each part. */
export function makePlayerParts(seed: number): PlayerParts {
  const rand = mulberry32(seed ^ 0x4e40);
  const pick = (a: RGB[]) => a[(rand() * a.length) | 0];
  const skin = pick(PLAYER_POOL.skin);
  const hair = pick(PLAYER_POOL.hair);
  const tunic = pick(PLAYER_POOL.cloth);
  const pants = pick(PLAYER_POOL.pants);
  const boots = pick(PLAYER_POOL.boots);
  const belt = darken(tunic, 20);
  const eye: RGB = [26, 26, 36];
  const outline: RGB = [20, 18, 28];

  const torso = new Pix(14, 15);
  torso.rect(1, 0, 12, 9, tunic);
  torso.rect(1, 9, 12, 14, belt);
  torso.outline(outline);

  const head = new Pix(11, 11);
  head.rect(1, 2, 9, 10, skin);
  head.rect(0, 0, 10, 3, hair);
  head.rect(0, 0, 2, 6, hair);       // a little hair trailing the "back" (local -x) side
  head.set(8, 5, eye);               // eye toward local +x — reads as "this way is front"
  head.outline(outline);

  const leg = (): HTMLCanvasElement => {
    const p = new Pix(4, 9);
    p.rect(0, 0, 3, 4, pants);
    p.rect(0, 4, 3, 8, boots);
    p.outline(outline);
    return p.done();
  };

  // the arm+held-tool as one swinging unit, anchored at the grip (bottom of the
  // canvas): rig.ts pivots it there, so the whole thing extends "away" from the
  // hand and rotating it around the grip is a full swing, hand and blade together.
  const weapon = new Pix(5, 15);
  weapon.rect(1, 10, 3, 14, skin);           // hand/forearm nearest the grip
  weapon.rect(2, 3, 3, 10, [56, 42, 32]);    // haft
  weapon.rect(0, 0, 4, 3, [140, 148, 160]);  // head/blade at the tip
  weapon.outline(outline);

  return { torso: torso.done(), head: head.done(), legL: leg(), legR: leg(), weapon: weapon.done() };
}
