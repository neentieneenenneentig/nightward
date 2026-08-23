// ============================================================================
// SR7 — Ground decals. Blood pools that persist for the night, then fade with
// it. A separate pooled-Graphics layer rather than a long-lived ParticleKind:
// a decal has to sit BELOW entities (a foe walks over a pool, not in front of
// it) while ParticleSystem's whole container sits above everything on
// purpose, and a night's worth of kills living for ~100 seconds each would
// crowd out slash/crit/ember's shared 300-particle budget for the pool
// duration. Same pattern as ParticleSystem regardless — pre-allocated ring
// buffer, one Graphics object cleared and redrawn per frame.
// ============================================================================
import { Container, Graphics } from 'pixi.js';

interface Decal {
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
  active: boolean;
}

export class DecalLayer {
  private pool: Decal[] = [];
  private next = 0;
  private container: Container;
  private gfx: Graphics;

  /** `parent` is the camera container; `before` is the child decals must
   *  render behind (pass `stage.entities` — ground stays further back still
   *  because it was inserted first and this call lands right in front of it). */
  constructor(parent: Container, before: Container, size = 96) {
    this.container = new Container();
    this.container.label = 'decals';
    parent.addChildAt(this.container, parent.getChildIndex(before));
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);
    for (let i = 0; i < size; i++) {
      this.pool.push({ x: 0, y: 0, r: 0, born: 0, life: 0, active: false });
    }
  }

  /** World pixels. `life` in seconds — pass the time left until dawn so a
   *  pool never bleeds into daylight. */
  spawn(x: number, y: number, life: number) {
    if (life <= 0) return;
    const d = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    d.x = x + (Math.random() - 0.5) * 6;
    d.y = y + (Math.random() - 0.5) * 6;
    d.r = 4 + Math.random() * 4;
    d.born = performance.now() / 1000;
    d.life = life;
    d.active = true;
  }

  /** Dawn: the night's pools go with it. */
  clear() {
    for (const d of this.pool) d.active = false;
  }

  render() {
    const g = this.gfx;
    g.clear();
    const now = performance.now() / 1000;
    for (const d of this.pool) {
      if (!d.active) continue;
      const age = now - d.born;
      if (age >= d.life) { d.active = false; continue; }
      // fade in over the first second (a pool doesn't SNAP into being), hold,
      // then fade out over the last three seconds of its life rather than
      // popping when clear() sweeps it at dawn.
      const fade = age < 1 ? age : age > d.life - 3 ? Math.max(0, (d.life - age) / 3) : 1;
      g.circle(d.x, d.y, d.r).fill({ color: 0x430c0c, alpha: 0.45 * fade });
    }
  }
}
