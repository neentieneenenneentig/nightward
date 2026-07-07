// Camera math shared by the renderer and input (screen↔world conversion for
// build-mode placement, tap targeting, etc).
import type { Application, Container } from 'pixi.js';
import { zoomFor } from '../../engine/renderer';

export class Camera {
  x = 0; y = 0; zoom = 1;
  private shakeMag = 0;

  constructor(private app: Application, private world: Container) {}

  /** Kick the camera — decays over the next few frames. */
  shake(mag: number) { this.shakeMag = Math.max(this.shakeMag, mag); }

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
}
