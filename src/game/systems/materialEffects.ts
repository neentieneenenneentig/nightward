// N2b: Material Effect Hooks — per-tile gameplay effects driven by the
// material the player is standing on. Data-driven: effects are rows on
// MaterialDef; the system is a generic function over GameState.
//
// Each tick the system checks the player's current tile, fires enter/exit
// effects on tile change, and applies stay effects (damage, regen, etc.).
// Modifier effects (gather yield, XP, build speed) are exposed as getters
// so other systems can read them without knowing about materials internals.
import { CFG } from '../data/config';
import { MATERIALS, type MaterialEffects } from '../data/materials';
import { TILE } from '../world/worldgen';
import { type GameState } from '../state';

export interface ActiveMaterialMods {
  /** Multiplier on natural HP regen (1.0 = normal). */
  regenMult: number;
  /** Multiplier on gather yield (1.0 = normal). */
  gatherYieldMult: number;
  /** Multiplier on all XP gain (1.0 = normal). */
  xpMult: number;
  /** Multiplier on soul-gear XP gain (1.0 = normal). */
  soulXpMult: number;
  /** Multiplier on building construction speed (1.0 = normal). */
  buildSpeedMult: number;
  /** Whether gathering is blocked on the current tile. */
  noGathering: boolean;
  /** The material id the player is standing on, or -1 if unknown. */
  materialId: number;
}

const NEUTRAL: ActiveMaterialMods = {
  regenMult: 1, gatherYieldMult: 1, xpMult: 1,
  soulXpMult: 1, buildSpeedMult: 1, noGathering: false, materialId: -1,
};

export class MaterialEffectSystem {
  private lastTx = -9999;
  private lastTy = -9999;
  private lastMatId = -1;

  /** Remaining stun time in seconds (from stunOnEnterMs). */
  private stunRemaining = 0;
  /** Remaining speed burst time in seconds (from speedBurstOnExit). */
  private speedBurstRemaining = 0;
  /** Speed burst multiplier currently active. */
  private speedBurstMult = 1;

  /** Active modifiers from the current tile — read by other systems. */
  mods: ActiveMaterialMods = { ...NEUTRAL };

  constructor(private ctx: {
    state: GameState;
    damagePlayer: (dmg: number, source: string) => void;
    toast: (msg: string, kind: string) => void;
  }) {}

  /** Called every sim tick with effectiveDt. */
  update(dt: number) {
    const { state } = this.ctx;
    if (state.gameOver) return;

    const p = state.player;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);

    // Detect tile change → enter/exit effects
    const tileChanged = tx !== this.lastTx || ty !== this.lastTy;
    if (tileChanged) {
      this.onExit(this.lastTx, this.lastTy, dt);
      this.onEnter(tx, ty, dt);
      this.lastTx = tx;
      this.lastTy = ty;
    }

    // Get current material
    let matId = -1;
    try {
      // Access worldCore through the global ctx — avoids circular deps
      const core = (this.ctx as any).worldCore;
      if (core) matId = core.materialAt?.(tx, ty) ?? -1;
    } catch {
      matId = -1;
    }
    this.lastMatId = matId;

    const mat = matId >= 0 && matId < MATERIALS.length ? MATERIALS[matId] : null;
    const fx = mat?.effects;

    // Apply stay effects
    this.applyStay(fx, dt);

    // Update active mods for other systems to read
    this.mods = fx ? {
      regenMult: fx.regenMult ?? 1,
      gatherYieldMult: fx.gatherYieldMult ?? 1,
      xpMult: fx.xpMult ?? 1,
      soulXpMult: fx.soulXpMult ?? 1,
      buildSpeedMult: fx.buildSpeedMult ?? 1,
      noGathering: fx.noGathering ?? false,
      materialId: matId,
    } : { ...NEUTRAL, materialId: matId };

    // Decay stun and speed burst
    if (this.stunRemaining > 0) this.stunRemaining = Math.max(0, this.stunRemaining - dt);
    if (this.speedBurstRemaining > 0) {
      this.speedBurstRemaining = Math.max(0, this.speedBurstRemaining - dt);
      if (this.speedBurstRemaining <= 0) this.speedBurstMult = 1;
    }
  }

  /** Whether the player is currently stunned (from a material onEnter effect). */
  get isStunned(): boolean {
    return this.stunRemaining > 0;
  }

  /** Current speed burst multiplier (includes material exit bursts). */
  get speedBurst(): number {
    return this.speedBurstMult;
  }

  // ---- internal ----------------------------------------------------------

  private onEnter(tx: number, ty: number, _dt: number) {
    const matId = this.lastMatId;
    const mat = matId >= 0 && matId < MATERIALS.length ? MATERIALS[matId] : null;
    const fx = mat?.effects;
    if (!fx) return;

    // Stun on enter
    if (fx.stunOnEnterMs && fx.stunOnEnterMs > 0) {
      this.stunRemaining = fx.stunOnEnterMs / 1000;
      this.ctx.toast?.(`${mat.name} disorients you!`, 'bad');
    }
  }

  private onExit(tx: number, ty: number, _dt: number) {
    if (tx === -9999 && ty === -9999) return; // first frame, no previous tile

    // Need to get the material of the tile we just left
    let prevMatId = -1;
    try {
      const core = (this.ctx as any).worldCore;
      if (core) prevMatId = core.materialAt?.(tx, ty) ?? -1;
    } catch {
      prevMatId = -1;
    }

    const mat = prevMatId >= 0 && prevMatId < MATERIALS.length ? MATERIALS[prevMatId] : null;
    const fx = mat?.effects;
    if (!fx) return;

    // Speed burst on exit
    if (fx.speedBurstOnExit && fx.speedBurstMs && fx.speedBurstMs > 0) {
      this.speedBurstMult = fx.speedBurstOnExit;
      this.speedBurstRemaining = fx.speedBurstMs / 1000;
    }
  }

  private applyStay(fx: MaterialEffects | undefined, dt: number) {
    if (!fx) return;
    const { state, damagePlayer } = this.ctx;

    // Damage over time
    if (fx.damagePerSec && fx.damagePerSec > 0) {
      damagePlayer(fx.damagePerSec * dt, 'material');
    }

    // Regen boost — apply bonus regen beyond the normal rate
    if (fx.regenMult && fx.regenMult > 1 && state.player.hp < CFG.player.maxHp) {
      const baseRegen = CFG.player.regenPerSec;
      const extraRegen = baseRegen * (fx.regenMult - 1) * dt;
      state.player.hp = Math.min(CFG.player.maxHp, state.player.hp + extraRegen);
    }
  }
}
