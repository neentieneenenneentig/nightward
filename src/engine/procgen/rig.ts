// The parametric rig: a rig is an ordered set of parts with a pivot; `pose()`
// is a pure function turning (locomotion state, time, attack state) into a
// per-part local transform. Nothing here touches Pixi — `world/rigview.ts` is
// the only thing that reads a Pose and moves sprites. Facing (which way the
// whole rig points) is NOT part of the local pose: the rig container rotates
// as a rigid whole toward `facing` in rigview, like a cutout on a turntable,
// and these local transforms animate on top of that rotation.
import type { PlayerParts } from './parts';

export type PartId = 'torso' | 'head' | 'legL' | 'legR' | 'weapon';

export interface RigPart {
  id: PartId;
  tex: HTMLCanvasElement;
  pivot: [number, number]; // anchor within the texture, 0..1
  z: number;               // draw order baseline (higher = drawn later/"closer")
}

export interface Rig {
  parts: RigPart[];
}

export function buildPlayerRig(p: PlayerParts): Rig {
  return {
    parts: [
      { id: 'legL', tex: p.legL, pivot: [0.5, 0], z: 0 },
      { id: 'legR', tex: p.legR, pivot: [0.5, 0], z: 0 },
      { id: 'torso', tex: p.torso, pivot: [0.5, 0.5], z: 1 },
      { id: 'head', tex: p.head, pivot: [0.5, 0.5], z: 2 },
      { id: 'weapon', tex: p.weapon, pivot: [0.5, 1], z: 3 }, // pivots at the grip
    ],
  };
}

export interface PartTransform { x: number; y: number; rot: number; z: number }
export type Pose = Record<PartId, PartTransform>;

export interface AttackState { t: number; dur: number } // t counts UP from 0 to dur

const GRIP: [number, number] = [2, -1]; // where the weapon is held, in rig-local space
// the weapon texture is drawn extending "up" (-y) from its grip pivot; rotating
// it by +90° swings that into "forward" (+x, local-space, pre-facing-rotation) —
// so FORWARD is the local-rotation value that means "held out dead ahead."
const FORWARD = Math.PI / 2;

/** Idle/walk/attack are all just different local transforms — pure function of time. */
export function pose(locomotion: 'idle' | 'walk', tLoc: number, meleeArcRad: number, attack: AttackState | null): Pose {
  const walking = locomotion === 'walk';
  const stridePhase = walking ? (tLoc / 0.32) % 1 : 0;
  const lift = walking ? Math.sin(stridePhase * Math.PI * 2) : 0;
  const bob = walking ? Math.abs(Math.sin(stridePhase * Math.PI * 2)) * 1.2 : 0;

  // resting weapon angle: held forward and slightly down, ready but not aggressive
  let weaponRot = FORWARD - 0.35;
  if (attack) {
    const half = meleeArcRad / 2;
    const frac = attack.dur > 0 ? Math.min(1, Math.max(0, attack.t / attack.dur)) : 1;
    weaponRot = FORWARD + (-half + half * 2 * frac);
  }

  return {
    legL: { x: -2, y: -3 - Math.max(0, lift) * 1.5, rot: 0, z: 0 },
    legR: { x: -2, y: 3 + Math.max(0, -lift) * 1.5, rot: 0, z: 0 },
    torso: { x: -bob * 0.15, y: -bob, rot: 0, z: 1 },
    head: { x: 1 - bob * 0.1, y: -bob - 1, rot: 0, z: 2 },
    weapon: { x: GRIP[0], y: GRIP[1], rot: weaponRot, z: 3 },
  };
}
