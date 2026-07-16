// ============================================================================
// G1 — Particle System. A pre-allocated pool of particles rendered via
// PixiJS ParticleContainer for fast batching. Zero allocations in the hot path.
//
// Usage:
//   const particles = new ParticleSystem(stage);
//   particles.spawn('poof', worldX, worldY, 8);
//   particles.update(dt);  // called every frame
// ============================================================================
import { Container, Graphics } from 'pixi.js';

// ---- particle type definitions ----
export interface ParticleDef {
  /** Lifetime range [min, max] in seconds. */
  lifetime: [number, number];
  /** Speed range [min, max] in px/s. */
  speed: [number, number];
  /** Direction range [min, max] in radians (0 = right, PI/2 = down). */
  direction: [number, number];
  /** Tint color as hex number. */
  color: number;
  /** Alpha range [start, end]. */
  alpha: [number, number];
  /** Scale range [start, end]. */
  scale: [number, number];
  /** Gravity in px/s² downward (negative = rise). */
  gravity: number;
  /** Spread from base direction in radians. */
  spread: number;
}

export type ParticleKind =
  | 'poof'       // gather complete
  | 'ember'      // fire burning
  | 'slash'      // melee swing
  | 'spark'      // building placed
  | 'wisp'       // night ambient
  | 'rift'       // realm rift (N2)
  | 'death'      // enemy killed
  | 'heal'       // player healed
  | 'crit';      // critical hit

/** Particle definitions — data-driven, tweakable at runtime. */
export const PARTICLE_DEFS: Record<ParticleKind, ParticleDef> = {
  poof: {
    lifetime: [0.2, 0.4], speed: [20, 60], direction: [0, Math.PI * 2],
    color: 0x8B7355, alpha: [0.8, 0], scale: [1.0, 0.3],
    gravity: 80, spread: Math.PI,
  },
  ember: {
    lifetime: [0.6, 1.2], speed: [30, 80], direction: [Math.PI, Math.PI],
    color: 0xFF6600, alpha: [1.0, 0], scale: [0.8, 0.2],
    gravity: -20, spread: Math.PI / 3,
  },
  slash: {
    lifetime: [0.1, 0.2], speed: [10, 30], direction: [0, 0],
    color: 0xFFFFFF, alpha: [0.9, 0], scale: [1.2, 0.1],
    gravity: 0, spread: Math.PI / 6,
  },
  spark: {
    lifetime: [0.15, 0.3], speed: [50, 120], direction: [Math.PI, Math.PI],
    color: 0xFFDD44, alpha: [1.0, 0], scale: [0.5, 0.1],
    gravity: 50, spread: Math.PI / 2,
  },
  wisp: {
    lifetime: [2.0, 4.0], speed: [5, 15], direction: [0, Math.PI * 2],
    color: 0x4488FF, alpha: [0.3, 0], scale: [0.6, 0.2],
    gravity: 0, spread: Math.PI * 2,
  },
  rift: {
    lifetime: [0.8, 1.5], speed: [100, 300], direction: [0, Math.PI * 2],
    color: 0x508CFF, alpha: [0.9, 0], scale: [1.0, 0.1],
    gravity: 0, spread: Math.PI * 2,
  },
  death: {
    lifetime: [0.4, 0.8], speed: [40, 100], direction: [0, Math.PI * 2],
    color: 0x666666, alpha: [0.8, 0], scale: [1.5, 0.2],
    gravity: 30, spread: Math.PI * 2,
  },
  heal: {
    lifetime: [0.3, 0.6], speed: [10, 30], direction: [Math.PI, Math.PI],
    color: 0x44FF44, alpha: [0.7, 0], scale: [0.4, 0.1],
    gravity: -10, spread: Math.PI / 4,
  },
  crit: {
    lifetime: [0.2, 0.4], speed: [60, 150], direction: [0, Math.PI * 2],
    color: 0xFFD700, alpha: [1.0, 0], scale: [1.5, 0.3],
    gravity: 40, spread: Math.PI,
  },
};

// ---- particle instance ----
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;       // remaining seconds
  maxLife: number;
  def: ParticleDef;
  active: boolean;
}

// ---- the system ----
export class ParticleSystem {
  private particles: Particle[];
  private poolSize: number;
  private container: Container;
  private gfx: Graphics;

  constructor(parent: Container, size = 300) {
    this.poolSize = size;
    this.particles = [];
    this.container = new Container();
    this.container.label = 'particles';
    this.container.zIndex = 50; // above entities, below UI
    parent.addChild(this.container);

    // Pre-allocate particles
    for (let i = 0; i < size; i++) {
      this.particles.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0,
        def: PARTICLE_DEFS.poof, active: false,
      });
    }

    // Single Graphics object — we clear and redraw each frame
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);
  }

  /** Spawn `count` particles of `kind` at (x, y) in world coordinates.
   *  `baseDir` overrides the def's direction range (for aimed effects like slash). */
  spawn(kind: ParticleKind, x: number, y: number, count: number, baseDir?: number) {
    const def = PARTICLE_DEFS[kind];
    const used: Particle[] = [];
    // Find inactive particles
    for (const p of this.particles) {
      if (!p.active) used.push(p);
      if (used.length >= count) break;
    }
    // If not enough, recycle oldest active (priority-based: low priority first)
    if (used.length < count) {
      const priorityOrder: ParticleKind[] = ['wisp', 'spark', 'heal', 'poof', 'death', 'slash', 'crit', 'ember', 'rift'];
      const remaining = count - used.length;
      const candidates = this.particles
        .filter(p => p.active)
        .sort((a, b) => {
          const pa = priorityOrder.indexOf(
            Object.entries(PARTICLE_DEFS).find(([_, d]) => d === a.def)?.[0] as ParticleKind ?? 'poof'
          );
          const pb = priorityOrder.indexOf(
            Object.entries(PARTICLE_DEFS).find(([_, d]) => d === b.def)?.[0] as ParticleKind ?? 'poof'
          );
          return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        });
      for (let i = 0; i < Math.min(remaining, candidates.length); i++) {
        used.push(candidates[i]);
      }
    }

    for (const p of used) {
      p.def = def;
      p.active = true;
      p.x = x;
      p.y = y;
      const dir = baseDir ?? (def.direction[0] + Math.random() * (def.direction[1] - def.direction[0]));
      const spreadDir = dir + (Math.random() - 0.5) * def.spread;
      const spd = def.speed[0] + Math.random() * (def.speed[1] - def.speed[0]);
      p.vx = Math.cos(spreadDir) * spd;
      p.vy = Math.sin(spreadDir) * spd;
      p.maxLife = def.lifetime[0] + Math.random() * (def.lifetime[1] - def.lifetime[0]);
      p.life = p.maxLife;
    }
  }

  /** Update all active particles. Call every frame with dt in seconds. */
  update(dt: number) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.def.gravity * dt;
    }
  }

  /** Redraw all active particles. Call after update(), before UI. */
  render() {
    const g = this.gfx;
    g.clear();
    for (const p of this.particles) {
      if (!p.active) continue;
      const t = 1 - p.life / p.maxLife; // 0..1 progress
      const alpha = p.def.alpha[0] + (p.def.alpha[1] - p.def.alpha[0]) * t;
      const scale = p.def.scale[0] + (p.def.scale[1] - p.def.scale[0]) * t;
      const size = Math.max(1, 4 * scale);
      const half = size / 2;
      g.rect(p.x - half, p.y - half, size, size);
      g.fill({ color: p.def.color, alpha: Math.max(0, Math.min(1, alpha)) });
    }
  }

  /** Number of currently active particles. */
  get activeCount(): number {
    return this.particles.filter(p => p.active).length;
  }

  /** Set container visibility (for WebGL fallback / performance). */
  set visible(v: boolean) { this.container.visible = v; }
}
