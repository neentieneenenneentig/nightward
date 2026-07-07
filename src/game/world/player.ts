// The hero: a parametric rig (see engine/procgen/rig.ts) instead of baked
// direction frames — facing is a float radian, so any of the 360 degrees is
// just a rotation, not a frame lookup. Axis-separated collision (slide along
// walls), interpolation between sim steps, hit-flash and teleport hooks the
// combat system drives.
import { makePlayerParts } from '../../engine/procgen/parts';
import { buildPlayerRig } from '../../engine/procgen/rig';
import { RigView } from './rigview';
import { CFG } from '../data/config';

/** Shortest-path turn of `cur` toward `target`, capped at `maxDelta` radians. */
function turnToward(cur: number, target: number, maxDelta: number): number {
  let diff = target - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return target;
  return cur + Math.sign(diff) * maxDelta;
}

/** Shortest-path interpolation, for smoothing render-frame facing between sim steps. */
function angleLerp(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const MELEE_ARC_RAD = (CFG.player.meleeArc * Math.PI) / 180;

export class Player {
  x: number; y: number;
  px: number; py: number;      // position at the previous sim step
  targetFacing = Math.PI / 2;  // desired direction from input (down, matching the old default)
  facing = Math.PI / 2;        // smoothed — what's actually rendered/used for attacks
  pFacing = Math.PI / 2;       // facing at the previous sim step, for render interpolation
  moving = false;
  private animT = 0;
  private flashT = 0;
  private attackT = -1;        // >=0 while the swing animation plays, counts UP
  private attackDur = 0.22;
  view: RigView;

  constructor(seed: number, x: number, y: number) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.view = new RigView(buildPlayerRig(makePlayerParts(seed)));
  }

  update(dt: number, ax: number, ay: number, canStand: (x: number, y: number) => boolean): boolean {
    this.px = this.x;
    this.py = this.y;
    this.pFacing = this.facing;
    this.flashT -= dt;
    if (this.attackT >= 0) { this.attackT += dt; if (this.attackT >= this.attackDur) this.attackT = -1; }

    let moved = false;
    if (ax || ay) {
      const speed = CFG.player.speed;
      const nx = this.x + ax * speed * dt;
      if (canStand(nx, this.y)) this.x = nx;
      const ny = this.y + ay * speed * dt;
      if (canStand(this.x, ny)) this.y = ny;
      this.targetFacing = Math.atan2(ay, ax);
      this.moving = this.x !== this.px || this.y !== this.py;
      this.animT += dt;
      moved = this.moving;
    } else {
      this.moving = false;
      this.animT = 0;
    }
    this.facing = turnToward(this.facing, this.targetFacing, CFG.player.turnSpeed * dt);
    return moved;
  }

  /** Called when the hero takes a hit — brief red tint. */
  flash() { this.flashT = 0.18; }

  /** Starts the swing animation; combat.ts calls this alongside the hit-detection. */
  playAttack() { this.attackT = 0; }

  /** Hard-set position (death respawn) with no interpolation smear. */
  teleport(x: number, y: number) {
    this.x = this.px = x;
    this.y = this.py = y;
  }

  /** Position the rig at the interpolated spot; returns it for the camera. */
  render(alpha: number): [number, number] {
    const fx = lerp(this.px, this.x, alpha);
    const fy = lerp(this.py, this.y, alpha);
    const facing = angleLerp(this.pFacing, this.facing, alpha);
    const attacking = this.attackT >= 0;
    const attack = attacking ? { t: this.attackT, dur: this.attackDur } : null;
    this.view.update(this.moving ? 'walk' : 'idle', this.animT, facing, MELEE_ARC_RAD, attack);
    this.view.setTint(this.flashT > 0 ? 0xff5555 : 0xffffff);
    this.view.cont.position.set(fx, fy);
    return [fx, fy];
  }
}
