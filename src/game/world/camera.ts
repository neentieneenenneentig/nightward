// Camera math shared by the renderer and input (screen↔world conversion for
// build-mode placement, tap targeting, etc).
import type { Application, Container } from 'pixi.js';
import { zoomFor } from '../../engine/renderer';

export class Camera {
  x = 0; y = 0; zoom = 1;
  private shakeMag = 0;

  constructor(private app: Application, private world: Container) {}

  /** N4.6: 0..1, from `prefers-reduced-motion`. At 0 the camera does not shake
   *  at all.
   *
   *  This is the one read in the whole Deep Vessel that we HONOUR rather than
   *  merely display. Every other local probe becomes flavour or a difficulty
   *  scalar; a person who has asked their operating system to stop moving
   *  things has not asked for a game stat, they have asked for the screen to
   *  hold still, and a screen shake is the single most literal violation of
   *  that request this codebase contains.
   *
   *  Scaled rather than switched, because the setting is also read for a milder
   *  vestibular preference and because a scalar leaves room for a slider later
   *  without changing any of the ten call sites. */
  motionScale = 1;

  /** Kick the camera — decays over the next few frames. */
  shake(mag: number) { this.shakeMag = Math.max(this.shakeMag, mag * this.motionScale); }

  /** Center on world-pixel (fx, fy); pixel-snapped so art never shimmers. */
  follow(fx: number, fy: number) {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.zoom = zoomFor(w, h);
    this.x = fx; this.y = fy;
    let ox = 0, oy = 0;
    if (this.shakeMag > 0.15) {
      ox = (Math.random() * 2 - 1) * this.shakeMag;
      oy = (Math.random() * 2 - 1) * this.shakeMag;
      this.shakeMag *= 0.84;
    } else this.shakeMag = 0;
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(w / 2 - fx * this.zoom + ox), Math.round(h / 2 - fy * this.zoom + oy));
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.world.position.x) / this.zoom, (sy - this.world.position.y) / this.zoom];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [this.world.position.x + wx * this.zoom, this.world.position.y + wy * this.zoom];
  }
}
