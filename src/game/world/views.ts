// The bridge between game state (numbers) and Pixi (pixels) for everything
// that isn't baked into a chunk: buildings, foes, the build ghost, and
// transient combat effects. Systems call these methods; nothing here decides
// game logic.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { TILE } from './worldgen';
import type { WorldArt } from './art';
import type { Foe } from '../systems/hordes';
import type { Building, WorldBoss } from '../state';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';

function tex(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

/** A foe sprite with a lazily-shown hp bar. */
class FoeView {
  cont = new Container();
  private sprite: Sprite;
  private bar = new Graphics();
  private frames: Texture[];
  private w: number;
  constructor(foe: Foe, art: WorldArt) {
    this.frames = art.enemies.get(foe.def.id)!.map(tex);
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 0.5);
    this.w = foe.def.art.size + 6;
    this.cont.addChild(this.sprite, this.bar);
  }
  sync(foe: Foe, alpha: number) {
    const fx = foe.px + (foe.x - foe.px) * alpha;
    const fy = foe.py + (foe.y - foe.py) * alpha;
    this.sprite.texture = this.frames[Math.floor(foe.animT / 0.22) % 2];
    this.cont.position.set(Math.round(fx), Math.round(fy));
    this.cont.zIndex = fy;
    const frac = foe.hp / foe.maxHp;
    this.bar.clear();
    if (frac < 1) {
      const bw = this.w;
      this.bar.rect(-bw / 2, -this.w / 2 - 5, bw, 2).fill(0x110a10);
      this.bar.rect(-bw / 2, -this.w / 2 - 5, bw * frac, 2).fill(frac > 0.5 ? 0x8fd05a : frac > 0.25 ? 0xe6c86e : 0xd05a5a);
    }
  }
  destroy() { this.cont.destroy({ children: true }); }
}

class BuildingView {
  cont = new Container();
  private bar = new Graphics();
  private maxHp: number;
  constructor(b: Building, art: WorldArt) {
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    this.maxHp = def.hp;
    const s = new Sprite(tex(art.buildings.get(b.type)!));
    s.anchor.set(0.5, 1);
    this.cont.addChild(s, this.bar);
    // anchored at the tile's bottom-center
    this.cont.position.set((b.tx + 0.5) * TILE, (b.ty + 1) * TILE);
    this.cont.zIndex = (b.ty + 1) * TILE;
    this.sync(b);
  }
  sync(b: Building) {
    const frac = b.hp / this.maxHp;
    this.bar.clear();
    if (frac < 1) {
      this.bar.rect(-14, -this.spriteH() - 4, 28, 3).fill(0x110a10);
      this.bar.rect(-14, -this.spriteH() - 4, 28 * frac, 3).fill(frac > 0.5 ? 0x8fd05a : 0xd05a5a);
    }
  }
  private spriteH() { return (this.cont.children[0] as Sprite).height; }
  destroy() { this.cont.destroy({ children: true }); }
}

/** A world boss: bigger sprite, a name plate, and an always-visible HP bar. */
class BossView {
  cont = new Container();
  private sprite: Sprite;
  private bar = new Graphics();
  private label: Text;
  private frames: Texture[];
  private size: number;
  constructor(b: WorldBoss, art: WorldArt) {
    const def = ENEMIES.find((e) => e.id === b.defId)!;
    this.frames = art.enemies.get(def.id)!.map(tex);
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 0.5);
    this.size = def.art.size;
    this.label = new Text({
      text: b.name,
      style: { fill: 0xffd2d2, fontSize: 10, fontFamily: 'monospace', stroke: { color: 0x000000, width: 3 } },
    });
    this.label.anchor.set(0.5, 1);
    this.cont.addChild(this.sprite, this.bar, this.label);
  }
  sync(b: WorldBoss, alpha: number) {
    const fx = b.px + (b.x - b.px) * alpha;
    const fy = b.py + (b.y - b.py) * alpha;
    this.sprite.texture = this.frames[Math.floor(b.animT / 0.25) % 2];
    this.cont.position.set(Math.round(fx), Math.round(fy));
    this.cont.zIndex = fy;
    const frac = Math.max(0, b.hp / b.maxHp);
    const bw = Math.max(34, this.size + 10);
    this.bar.clear();
    this.bar.rect(-bw / 2, -this.size / 2 - 10, bw, 4).fill(0x160a12);
    this.bar.rect(-bw / 2, -this.size / 2 - 10, bw * frac, 4).fill(frac > 0.5 ? 0xe0563f : 0xd05a5a);
    this.label.position.set(0, -this.size / 2 - 12);
  }
  destroy() { this.cont.destroy({ children: true }); }
}

export class Views {
  private foes = new Map<number, FoeView>();
  private buildings = new Map<number, BuildingView>();
  private bosses = new Map<number, BossView>();
  private ghost: { cont: Container; foot: Graphics; sprite: Sprite } | null = null;
  private fx = new Container();

  constructor(private layer: Container, private art: WorldArt) {
    layer.sortableChildren = true;
    layer.addChild(this.fx);
    this.fx.zIndex = 1e9; // effects always on top
  }

  // --- buildings ---
  addBuilding(b: Building) {
    const v = new BuildingView(b, this.art);
    this.buildings.set(b.uid, v);
    this.layer.addChild(v.cont);
  }
  syncBuilding(b: Building) { this.buildings.get(b.uid)?.sync(b); }
  removeBuilding(uid: number) {
    this.buildings.get(uid)?.destroy();
    this.buildings.delete(uid);
  }

  // --- foes ---
  addFoe(f: Foe) {
    const v = new FoeView(f, this.art);
    this.foes.set(f.uid, v);
    this.layer.addChild(v.cont);
  }
  removeFoe(uid: number) {
    this.foes.get(uid)?.destroy();
    this.foes.delete(uid);
  }
  syncFoes(foes: Foe[], alpha: number) {
    for (const f of foes) this.foes.get(f.uid)?.sync(f, alpha);
  }

  // --- world bosses ---
  addBoss(b: WorldBoss) {
    if (this.bosses.has(b.uid)) this.removeBoss(b.uid);
    const v = new BossView(b, this.art);
    this.bosses.set(b.uid, v);
    this.layer.addChild(v.cont);
  }
  removeBoss(uid: number) {
    this.bosses.get(uid)?.destroy();
    this.bosses.delete(uid);
  }
  syncBosses(bosses: WorldBoss[], alpha: number) {
    for (const b of bosses) this.bosses.get(b.uid)?.sync(b, alpha);
  }

  // --- build ghost ---
  setGhost(type: string | null, tx = 0, ty = 0, valid = false) {
    if (!type) { this.ghost?.cont.destroy({ children: true }); this.ghost = null; return; }
    if (!this.ghost) {
      const cont = new Container();
      cont.zIndex = 2e9;
      const foot = new Graphics();          // tile outline on the ground
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      sprite.alpha = 0.75;
      cont.addChild(foot, sprite);
      this.layer.addChild(cont);
      this.ghost = { cont, foot, sprite };
    }
    const { foot, sprite } = this.ghost;
    sprite.texture = tex(this.art.buildings.get(type)!);
    sprite.tint = valid ? 0x9fe08a : 0xe07a7a;
    sprite.position.set((tx + 0.5) * TILE, (ty + 1) * TILE);
    const col = valid ? 0x8fe07a : 0xe06a6a;
    foot.clear();
    foot.rect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2)
      .fill({ color: col, alpha: 0.22 })
      .stroke({ width: 2, color: col, alpha: 0.9 });
  }

  // --- transient effects ---
  addHitFlash(x: number, y: number) {
    const g = new Graphics();
    g.star(0, 0, 6, 9, 4).fill(0xfff2b0);   // spark burst
    g.circle(0, 0, 4).fill(0xffffff);
    g.position.set(x, y - 6);
    this.fx.addChild(g);
    this.animate(g, 0.18, (t) => { g.scale.set(0.7 + t * 1.6); g.alpha = 1 - t; g.rotation = t * 1.2; });
  }

  /** A bright crescent that sweeps through the melee arc — reads even on a miss. */
  addSlash(x: number, y: number, angle: number, range: number, arc: number) {
    const g = new Graphics();
    g.position.set(x, y - 6);
    g.rotation = angle;
    this.fx.addChild(g);
    const r = range, inner = range * 0.5;
    this.animate(g, 0.2, (t) => {
      g.clear();
      // the crescent slides across the arc as the swing progresses
      const span = arc * 0.55;
      const a0 = -arc / 2 + (arc - span) * t;
      const a1 = a0 + span;
      const N = 10;
      g.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
      for (let i = 0; i <= N; i++) { const a = a0 + (a1 - a0) * (i / N); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      for (let i = N; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / N); g.lineTo(Math.cos(a) * inner, Math.sin(a) * inner); }
      g.fill({ color: 0xdff2ff, alpha: (1 - t) * 0.8 });
      g.stroke({ width: 2, color: 0xffffff, alpha: 1 - t });
    });
  }
  addShot(fromX: number, fromY: number, toX: number, toY: number) {
    const g = new Graphics();
    g.moveTo(fromX, fromY).lineTo(toX, toY).stroke({ width: 1.5, color: 0xffe6a3 });
    this.fx.addChild(g);
    this.animate(g, 0.12, (t) => { g.alpha = 1 - t; });
  }

  private animate(obj: Container, dur: number, step: (t: number) => void) {
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / (dur * 1000);
      if (t >= 1 || obj.destroyed) { if (!obj.destroyed) obj.destroy(); return; }
      step(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** After a full state reload, drop every view and rebuild from state. */
  reset(buildings: Building[]) {
    for (const v of this.foes.values()) v.destroy();
    for (const v of this.buildings.values()) v.destroy();
    for (const v of this.bosses.values()) v.destroy();
    this.foes.clear();
    this.buildings.clear();
    this.bosses.clear();
    for (const b of buildings) this.addBuilding(b);
  }
}
