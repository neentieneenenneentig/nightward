// The hero: seeded procgen frames, axis-separated collision (slide along
// walls), interpolation between sim steps, plus hit-flash and teleport hooks
// the combat system drives.
import { Sprite, Texture } from 'pixi.js';
import { makePlayerFrames } from '../../engine/procgen/sprites';
import { CFG } from '../data/config';

export type Facing = 'down' | 'up' | 'left' | 'right';
export type AttackPhase = 'idle' | 'windup' | 'active' | 'recovery';

export class Player {
  x: number; y: number;
  px: number; py: number; // position at the previous sim step
  facing: Facing = 'down';
  aimAngle = Math.PI / 2; // true input direction (radians) — swings aim here, not at the 4-way facing
  moving = false;
  attackPhase: AttackPhase = 'idle';
  private animT = 0;
  private flashT = 0;
  sprite: Sprite;
  private tex: { down: Texture[]; up: Texture[]; side: Texture[] };

  constructor(seed: number, x: number, y: number) {
    this.x = this.px = x;
    this.y = this.py = y;
    const f = makePlayerFrames(seed);
    const toTex = (cs: HTMLCanvasElement[]) =>
      cs.map((c) => {
        const t = Texture.from(c);
        t.source.scaleMode = 'nearest';
        return t;
      });
    this.tex = { down: toTex(f.down), up: toTex(f.up), side: toTex(f.side) };
    this.sprite = new Sprite(this.tex.down[0]);
    this.sprite.anchor.set(0.5, 1); // anchored at the feet
  }

  update(dt: number, ax: number, ay: number, canStand: (x: number, y: number) => boolean, speedMul = 1): boolean {
    this.px = this.x;
    this.py = this.y;
    this.flashT -= dt;
    let moved = false;
    if (ax || ay) {
      // committing to a swing (windup/active) slows you — the weight of the hit;
      // the terrain under your feet (mud/ice/sand/hill) scales it too (speedMul)
      const midSwing = this.attackPhase === 'windup' || this.attackPhase === 'active';
      const speed = CFG.player.speed * (midSwing ? CFG.combat.moveSlowMult : 1) * speedMul;
      const nx = this.x + ax * speed * dt;
      if (canStand(nx, this.y)) this.x = nx;
      const ny = this.y + ay * speed * dt;
      if (canStand(this.x, ny)) this.y = ny;
      this.aimAngle = Math.atan2(ay, ax);
      // sprite facing is 4-way; on diagonals (|ax|===|ay| after normalize) keep the
      // current facing while its key is still held instead of snapping horizontal
      const keeps =
        (this.facing === 'left' && ax < 0) || (this.facing === 'right' && ax > 0) ||
        (this.facing === 'up' && ay < 0) || (this.facing === 'down' && ay > 0);
      if (!keeps) this.facing = Math.abs(ax) >= Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : (ay < 0 ? 'up' : 'down');
      this.moving = this.x !== this.px || this.y !== this.py;
      this.animT += dt;
      moved = this.moving;
    } else {
      this.moving = false;
      this.animT = 0;
    }
    return moved;
  }

  /** Called when the hero takes a hit — brief red tint. */
  flash() { this.flashT = 0.18; }

  /** Driven by CombatSystem's attack state machine — feeds tint/squash and the move-slow. */
  setAttackPhase(p: AttackPhase) { this.attackPhase = p; }

  /** Hard-set position (death respawn) with no interpolation smear. */
  teleport(x: number, y: number) {
    this.x = this.px = x;
    this.y = this.py = y;
  }

  /** Position the sprite at the interpolated spot; returns it for the camera. */
  render(alpha: number): [number, number] {
    const fx = this.px + (this.x - this.px) * alpha;
    const fy = this.py + (this.y - this.py) * alpha;
    const step = this.moving ? Math.floor(this.animT / 0.18) % 2 : 0;
    const dir = this.facing === 'left' || this.facing === 'right' ? 'side' : this.facing;
    this.sprite.texture = this.tex[dir][step];

    // attack-phase feedback (hurt-flash always wins — it's the more urgent signal)
    let tint = 0xffffff, squashX = 1, squashY = 1;
    if (this.flashT > 0) tint = 0xff5555;
    else if (this.attackPhase === 'windup') { tint = 0xfff2b0; squashX = 1.06; squashY = 0.93; }
    else if (this.attackPhase === 'recovery') tint = 0xa8a29a;

    this.sprite.scale.set((this.facing === 'left' ? -1 : 1) * squashX, squashY);
    this.sprite.tint = tint;
    this.sprite.position.set(fx, fy);
    return [fx, fy];
  }
}
