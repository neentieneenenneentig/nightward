// The hero: seeded procgen frames, axis-separated collision (slide along
// walls), interpolation between sim steps, plus hit-flash and teleport hooks
// the combat system drives. Position is mirrored into game state each step so
// saves just work.
import { Sprite, Texture } from 'pixi.js';
import { makePlayerFrames } from '../../engine/procgen/sprites';
import { CFG } from '../data/config';

export type Facing = 'down' | 'up' | 'left' | 'right';

export class Player {
  x: number; y: number;
  px: number; py: number; // position at the previous sim step
  facing: Facing = 'down';
  moving = false;
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

  update(dt: number, ax: number, ay: number, canStand: (x: number, y: number) => boolean): boolean {
    this.px = this.x;
    this.py = this.y;
    this.flashT -= dt;
    let moved = false;
    if (ax || ay) {
      const speed = CFG.player.speed;
      const nx = this.x + ax * speed * dt;
      if (canStand(nx, this.y)) this.x = nx;
      const ny = this.y + ay * speed * dt;
      if (canStand(this.x, ny)) this.y = ny;
      this.facing = Math.abs(ax) >= Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : (ay < 0 ? 'up' : 'down');
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
    this.sprite.scale.x = this.facing === 'left' ? -1 : 1;
    this.sprite.tint = this.flashT > 0 ? 0xff5555 : 0xffffff;
    this.sprite.position.set(fx, fy);
    return [fx, fy];
  }
}
