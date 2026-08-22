// The bridge between game state (numbers) and Pixi (pixels) for everything
// that isn't baked into a chunk: buildings, foes, the build ghost, and
// transient combat effects. Systems call these methods; nothing here decides
// game logic.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { itemName } from '../data/items';
import { AFFIX_POWER, ELITE_RANKS, affixDef } from '../data/elites';
import { isBeamworthy, rarityTint } from '../ui/rarity';
import { TILE } from './worldgen';
import type { WorldArt } from './art';
import type { World } from './world';
import type { Foe } from '../systems/hordes';
import type { Building, GroundDrop, WorldBoss } from '../state';
import { CFG } from '../data/config';
import { BUILDINGS } from '../data/buildings';
import { ENEMIES } from '../data/enemies';

function tex(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

/** '#rrggbb' -> 0xrrggbb. Pixi wants a number; the data tables are authored in
 *  CSS hex because that is what a designer reads and what the HUD shares. */
const hexNum = (css: string) => parseInt(css.replace('#', ''), 16);

/** Blinking warning tint while a foe/boss is committed to a telegraphed hit. */
function telegraphTint(telegraphT: number, animT: number): number {
  if (telegraphT <= 0) return 0xffffff;
  return Math.floor(animT / 0.08) % 2 === 0 ? 0xffb066 : 0xff5a3a;
}

/** A foe sprite with a lazily-shown hp bar. */
class FoeView {
  cont = new Container();
  private sprite: Sprite;
  private bar = new Graphics();
  private shadow: Graphics;
  private frames: Texture[];
  private w: number;
  private sz: number;
  private heightClass: number;
  /** A2: the aura ring and the nameplate. Both null on an ordinary foe, so the
   *  99% of the horde that is not elite pays one null check per frame and no
   *  allocation at all — a wave is 40+ foes and this runs every frame for each
   *  of them. */
  private ring: Graphics | null = null;
  private plate: Text | null = null;
  private ringTints: number[] = [];
  private unseen = false;
  constructor(foe: Foe, art: WorldArt) {
    this.frames = art.enemies.get(foe.def.id)!.map(tex);
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 0.5);
    this.w = foe.def.art.size + 6;
    this.sz = foe.def.art.size;
    this.heightClass = foe.def.art.size > 24 ? 3 : foe.def.art.size > 16 ? 2 : 1;
    this.shadow = new Graphics();
    this.cont.addChild(this.shadow, this.sprite, this.bar);
    if (foe.elite) this.buildElite(foe);
  }

  /** A2 — the two things that make an elite readable before it reaches you.
   *
   *  The RING is on the ground, under the sprite and over the shadow, in the
   *  affixes' own colours. A ring rather than a tint on the body because the
   *  bodies are already the bestiary's colour language — tinting a Wisp green
   *  to say "Vigorous" would collide with the Vile Spore, and the player would
   *  learn two contradictory things from one hue. Multiple affixes draw
   *  concentric arcs, so a champion's three colours are all legible at once
   *  instead of blending into mud.
   *
   *  The NAMEPLATE is text above the hp bar, in the rank's colour: brass for an
   *  elite, violet for a champion. It names every affix, because rule 3 of the
   *  milestone is that a rolled property you discover by dying to it is not a
   *  mechanic. */
  private buildElite(foe: Foe) {
    const e = foe.elite!;
    const rank = ELITE_RANKS[e.rank];
    this.unseen = e.has.has('unseen');
    this.ringTints = e.affixes.map((id) => hexNum(affixDef(id)?.color ?? '#d8a83a'));

    const g = new Graphics();
    const base = this.sz * 0.52;
    this.ringTints.forEach((tint, i) => {
      const r = base + i * 2.5;
      // Squashed vertically to sit ON the ground plane rather than hovering as
      // a circle in screen space — the same 0.4 ratio the contact shadows use,
      // so the ring reads as painted on the dirt beneath the thing.
      g.ellipse(0, this.sz * 0.34, r, r * 0.4).stroke({ width: 1.5, color: tint, alpha: 0.85 });
    });
    this.ring = g;
    // Index 1: above the shadow, below the sprite.
    this.cont.addChildAt(g, 1);

    this.plate = new Text({
      text: e.name,
      style: {
        fontFamily: 'monospace', fontSize: 8, fontWeight: 'bold',
        fill: hexNum(rank.color), stroke: { color: 0x140f18, width: 1 },
      },
    });
    this.plate.resolution = WORLD_TEXT_RES;
    this.plate.anchor.set(0.5, 1);
    this.plate.position.set(0, -this.w / 2 - 7);
    this.cont.addChild(this.plate);
  }
  /** G1: offset shadow based on light direction (light from top-left during day = shadow to bottom-right). */
  updateShadow(lightDX: number, lightDY: number, alpha: number) {
    const { shadow, sz, heightClass } = this;
    shadow.clear();
    const ox = lightDX * heightClass * 1.5;
    const oy = sz * 0.38 + lightDY * heightClass * 1.5;
    shadow.ellipse(ox, oy, sz * 0.4, sz * 0.16).fill({ color: 0x0a080e, alpha });
  }
  sync(foe: Foe, alpha: number, revealHp = false, px = 0, py = 0) {
    const fx = foe.px + (foe.x - foe.px) * alpha;
    const fy = foe.py + (foe.y - foe.py) * alpha;
    this.sprite.texture = this.frames[Math.floor(foe.animT / 0.22) % 2];
    this.sprite.tint = telegraphTint(foe.telegraphT, foe.animT);
    this.cont.position.set(Math.round(fx), Math.round(fy));
    this.cont.zIndex = fy;

    // A2 Unseen: the body fades at range; the RING and the NAMEPLATE do not.
    // That is the whole design of the affix — it is hard to read, never hidden.
    // A foe you cannot locate at all is an unfair hit, and the counterplay to
    // "I can barely see it" is looking, which requires there to be something
    // to see.
    if (this.unseen) {
      const far = Math.hypot(px - fx, py - fy) > AFFIX_POWER.unseenTiles * TILE;
      this.sprite.alpha = far ? AFFIX_POWER.unseenAlpha : 1;
    }
    // The ring breathes. A static outline reads as a UI decal stuck to the
    // ground; one that pulses reads as something the creature is doing.
    if (this.ring) this.ring.alpha = 0.75 + 0.25 * Math.sin(foe.animT * 3 + foe.uid);
    const frac = foe.hp / foe.maxHp;
    this.bar.clear();
    // C4: 'see_foe_hp' — the Nullmaw relic and the 'of the Eye' suffix. The bar
    // already existed but only appeared once a foe was hurt, which is exactly
    // when you no longer need it. What the effect buys is APPRAISAL: seeing an
    // untouched foe's pool before you commit to it. Registered in C4 and read
    // by nothing until now.
    if (frac < 1 || revealHp) {
      const bw = this.w;
      this.bar.rect(-bw / 2, -this.w / 2 - 5, bw, 2).fill(0x110a10);
      this.bar.rect(-bw / 2, -this.w / 2 - 5, bw * frac, 2).fill(frac > 0.5 ? 0x8fd05a : frac > 0.25 ? 0xe6c86e : 0xd05a5a);
    }
  }
  destroy() { this.cont.destroy({ children: true }); }
}

/** `stage.world` is scaled 2x, and Pixi renders `Text` into a texture at
 *  resolution 1 by default — so every world-space label was a low-res bitmap
 *  linearly upscaled, which turns a thin glyph with a dark stroke into a grey
 *  smudge. Stack counts were unreadable for exactly this reason and it looked
 *  like a colour bug until a 4x capture showed the blur. Rendering above the
 *  world scale costs a few hundred texels per label and nothing else. */
const WORLD_TEXT_RES = 4;

/** B5: a stack of loot lying on the ground. Same shape as FoeView — sprite,
 *  contact shadow, y-sorted container — so an item behind a tree renders behind
 *  the tree without any new render machinery. */
class DropView {
  cont = new Container();
  private sprite: Sprite;
  private shadow = new Graphics();
  private count: Text | null = null;
  private lastN = -1;
  /** A4: the rarity light shaft and the floating name, on Woven and above. */
  private beam: Graphics | null = null;
  private label: Text | null = null;
  private beamTint = 0;
  constructor(d: GroundDrop, art: WorldArt) {
    this.sprite = new Sprite(tex(art.itemIcon(d.id)));
    this.sprite.anchor.set(0.5, 0.5);
    this.cont.addChild(this.shadow, this.sprite);

    // A4 — the loot beam.
    //
    // B5 already put the item on the floor and made you walk to it. A beam is
    // what makes you WANT to: it is visible across the screen, it reads as
    // "that one is different" before you are close enough to see the icon, and
    // it is how every ARPG since Diablo II has solved the same problem.
    //
    // Gated at CFG.loot.beamFrom because a beam on every drop is not a signal,
    // it is a disco — a night wave drops dozens of stacks and if all of them
    // glow, none of them do.
    if (isBeamworthy(d.id, CFG.loot.beamFrom)) {
      this.beamTint = rarityTint(d.id);
      const g = new Graphics();
      // Drawn as a stack of quads narrowing and fading upward rather than one
      // gradient: Pixi v8 Graphics has no vertical gradient fill, and a texture
      // for this would be an asset (pillar 1).
      const H = 40, STEPS = 8;
      for (let i = 0; i < STEPS; i++) {
        const t = i / STEPS;
        const w = 10 * (1 - t * 0.5);
        g.rect(-w / 2, -H * (t + 1 / STEPS), w, H / STEPS)
          .fill({ color: this.beamTint, alpha: 0.5 * (1 - t) });
      }
      // A brighter, narrower core inside the shaft. One flat column of colour
      // reads as a painted rectangle; a core with a falloff around it reads as
      // light, which is the entire job of this shape.
      for (let i = 0; i < STEPS; i++) {
        const t = i / STEPS;
        g.rect(-1.5, -H * (t + 1 / STEPS), 3, H / STEPS)
          .fill({ color: 0xffffff, alpha: 0.30 * (1 - t) });
      }
      g.ellipse(0, 0, 9, 3.5).fill({ color: this.beamTint, alpha: 0.45 });
      // Additive, because a shaft of light ADDS to what is behind it. At normal
      // blending the same geometry reads as a translucent painted rectangle and
      // simply disappears over bright terrain — which is exactly what the first
      // capture showed over daytime grass.
      g.blendMode = 'add';
      this.beam = g;
      // Behind the sprite so the item reads on top of its own light.
      this.cont.addChildAt(g, 1);

      this.label = new Text({
        text: itemName(d.id),
        style: {
          fontFamily: 'monospace', fontSize: 8, fontWeight: 'bold',
          fill: this.beamTint, stroke: { color: 0x140f18, width: 1 },
        },
      });
      this.label.resolution = WORLD_TEXT_RES;
      this.label.anchor.set(0.5, 1);
      this.label.position.set(0, -19);
      this.cont.addChild(this.label);
    }
  }
  updateShadow(lightDX: number, lightDY: number, alpha: number) {
    this.shadow.clear();
    this.shadow.ellipse(lightDX * 1.5, 7 + lightDY * 1.5, 7, 3).fill({ color: 0x0a080e, alpha });
  }
  sync(d: GroundDrop, clock: number, memoryMul = 1) {
    // The bob is what makes the eye find loot on a busy floor. hopH is the toss
    // arc; the bob only runs once the item has settled, so the two never fight.
    const bob = d.hopT > 0 ? 0 : Math.sin(clock * CFG.drops.bobHz * Math.PI * 2 + d.uid) * CFG.drops.bobPx;
    this.cont.position.set(Math.round(d.x), Math.round(d.y - d.hopH - bob));
    this.cont.zIndex = d.y;
    // shadow shrinks as the item rises — the only cue that the arc is vertical
    const lift = 1 - Math.min(0.6, d.hopH / 28);
    this.shadow.scale.set(lift, lift);
    this.shadow.alpha = lift;

    // blink out the last few seconds so a despawn is never a silent theft
    const D = CFG.drops;
    const age = clock - d.bornT;
    const left = D.despawnSec * memoryMul - age;
    this.sprite.alpha = (!d.gear || !D.gearNeverDespawns) && left < D.blinkLastSec && left > 0
      ? 0.35 + 0.65 * (Math.sin(clock * 9) * 0.5 + 0.5)
      : 1;

    // The beam breathes so it reads as light rather than as a painted shape,
    // and it is the only part of the drop that does NOT bob — a shaft anchored
    // to the ground with a bobbing item inside it is the whole illusion.
    if (this.beam) {
      this.beam.position.y = d.hopH + bob;
      this.beam.alpha = 0.72 + 0.28 * Math.sin(clock * 2.2 + d.uid);
    }

    if (d.n !== this.lastN) {
      this.lastN = d.n;
      if (d.n > 1) {
        if (!this.count) {
          // fontSize 9 with a 3px stroke rendered as a dark BLOB: the stroke is
          // centred on the glyph outline, so it eats 1.5px inward — the entire
          // stem of a 9px digit — and the cream fill never survives to be seen.
          // Bigger glyph, thinner stroke, bold stems. Pixi draws the stroke OVER
          // the fill, so at width 2 on ~2.5px bold stems only a sliver of cream
          // survived; width 1 leaves the number actually reading as cream.
          this.count = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold', fill: 0xf2e9d8, stroke: { color: 0x140f18, width: 1 } } });
          // Beside the icon, NOT under it. At (0, 5) the digit was drawn straight
          // on top of its own contact shadow — the ellipse is centred at (0, 7)
          // with ry 3, so the top half of every glyph landed on the darkest
          // pixels in the frame. Forcing the fill bright red proved it: the
          // number was rendering the whole time and simply could not be seen.
          // The shadow's rx is 7, so x=8 clears it at every lift scale.
          this.count.resolution = WORLD_TEXT_RES;
          this.count.anchor.set(0, 0.5);
          this.count.position.set(8, 3);
          this.cont.addChild(this.count);
        }
        this.count.text = String(d.n);
        this.count.visible = true;
      } else if (this.count) this.count.visible = false;
    }
  }
  destroy() { this.cont.destroy({ children: true }); }
}

class BuildingView {
  cont = new Container();
  private sprite: Sprite;
  private bar = new Graphics();
  private shadow: Graphics;
  private maxHp: number;
  private isWall: boolean;
  private heightClass: number;
  constructor(b: Building, private art: WorldArt, mask = 0) {
    const def = BUILDINGS.find((d) => d.id === b.type)!;
    this.maxHp = b.maxHp ?? def.hp;   // B3.a: the Loom can raise a building's ceiling
    this.isWall = def.art === 'wall';
    this.sprite = new Sprite(tex(this.isWall ? art.wall(mask) : art.buildings.get(b.type)!));
    this.sprite.anchor.set(0.5, 1);
    this.heightClass = def.art === 'hall' ? 3 : def.art === 'tower' ? 3 : def.art === 'hut' ? 2 : 1;
    this.shadow = new Graphics();
    this.cont.addChild(this.shadow, this.sprite, this.bar);
    // anchored at the tile's bottom-center
    this.cont.position.set((b.tx + 0.5) * TILE, (b.ty + 1) * TILE);
    this.cont.zIndex = (b.ty + 1) * TILE;
    this.sync(b);
  }
  /** G1: offset shadow based on light direction. Buildings are anchored bottom-center. */
  updateShadow(lightDX: number, lightDY: number, alpha: number) {
    const { shadow, sprite, heightClass } = this;
    shadow.clear();
    const ox = lightDX * heightClass * 1.5;
    const oy = -2 + lightDY * heightClass * 1.5;
    shadow.ellipse(ox, oy, sprite.width * 0.35, sprite.width * 0.14).fill({ color: 0x0a080e, alpha });
  }
  sync(b: Building) {
    const frac = b.hp / (b.maxHp ?? this.maxHp);
    this.bar.clear();
    if (frac < 1) {
      this.bar.rect(-14, -this.sprite.height - 4, 28, 3).fill(0x110a10);
      this.bar.rect(-14, -this.sprite.height - 4, 28 * frac, 3).fill(frac > 0.5 ? 0x8fd05a : 0xd05a5a);
    }
  }
  /** Re-pick the wall art for a new neighbor mask (auto-connect). */
  refreshWall(mask: number) {
    if (!this.isWall) return;
    this.sprite.texture = tex(this.art.wall(mask));
  }
  destroy() { this.cont.destroy({ children: true }); }
}

/** A world boss: bigger sprite, a name plate, and an always-visible HP bar. */
class BossView {
  cont = new Container();
  private sprite: Sprite;
  private bar = new Graphics();
  private shadow: Graphics;
  private label: Text;
  private frames: Texture[];
  private size: number;
  private heightClass: number;
  constructor(b: WorldBoss, art: WorldArt) {
    const def = ENEMIES.find((e) => e.id === b.defId)!;
    this.frames = art.enemies.get(def.id)!.map(tex);
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5, 0.5);
    this.size = def.art.size;
    this.heightClass = this.size > 32 ? 4 : this.size > 24 ? 3 : 2;
    this.shadow = new Graphics();
    this.label = new Text({
      text: b.name,
      style: { fill: 0xffd2d2, fontSize: 10, fontFamily: 'monospace', stroke: { color: 0x000000, width: 3 } },
    });
    this.label.resolution = WORLD_TEXT_RES;   // same blur, same fix
    this.label.anchor.set(0.5, 1);
    this.cont.addChild(this.shadow, this.sprite, this.bar, this.label);
  }
  /** G1: offset shadow based on light direction. */
  updateShadow(lightDX: number, lightDY: number, alpha: number) {
    const { shadow, size, heightClass } = this;
    shadow.clear();
    const ox = lightDX * heightClass * 2;
    const oy = size * 0.38 + lightDY * heightClass * 2;
    shadow.ellipse(ox, oy, size * 0.42, size * 0.17).fill({ color: 0x0a080e, alpha });
  }
  sync(b: WorldBoss, alpha: number) {
    const fx = b.px + (b.x - b.px) * alpha;
    const fy = b.py + (b.y - b.py) * alpha;
    this.sprite.texture = this.frames[Math.floor(b.animT / 0.25) % 2];
    this.sprite.tint = telegraphTint(b.telegraphT, b.animT);
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
  private drops = new Map<number, DropView>();
  private ghost: { cont: Container; foot: Graphics; sprite: Sprite } | null = null;
  private fx = new Container();

  // G1: directional light — shadows cast opposite the light source
  private lightDX = 0;
  private lightDY = 0;
  private shadowAlpha = 0.3;

  constructor(private layer: Container, private art: WorldArt, private world: World) {
    layer.sortableChildren = true;
    layer.addChild(this.fx);
    this.fx.zIndex = 1e9; // effects always on top
  }

  /** G1: set light direction for directional drop shadows.
   *  dirX, dirY: shadow offset direction (light from opposite).
   *  Day: light from top-left → shadow toward bottom-right (+0.7, +0.7).
   *  Night: omnidirectional → shadow directly below (0, +0.3).
   *  alpha: shadow opacity (0.5 day, 0.3 night). */
  setLight(dirX: number, dirY: number, alpha: number) {
    if (this.lightDX === dirX && this.lightDY === dirY && this.shadowAlpha === alpha) return;
    this.lightDX = dirX;
    this.lightDY = dirY;
    this.shadowAlpha = alpha;
    // Update all existing views
    for (const v of this.foes.values()) v.updateShadow(dirX, dirY, alpha);
    for (const v of this.buildings.values()) v.updateShadow(dirX, dirY, alpha);
    for (const v of this.bosses.values()) v.updateShadow(dirX, dirY, alpha);
    for (const v of this.drops.values()) v.updateShadow(dirX, dirY, alpha);
  }

  // --- buildings ---
  addBuilding(b: Building) {
    const v = new BuildingView(b, this.art, this.wallMask(b.tx, b.ty));
    v.updateShadow(this.lightDX, this.lightDY, this.shadowAlpha);
    this.buildings.set(b.uid, v);
    this.layer.addChild(v.cont);
  }
  syncBuilding(b: Building) { this.buildings.get(b.uid)?.sync(b); }
  removeBuilding(uid: number) {
    this.buildings.get(uid)?.destroy();
    this.buildings.delete(uid);
  }

  private wallMask(tx: number, ty: number): number {
    const isWall = (x: number, y: number) => this.world.buildingAt(x, y)?.type === 'wall';
    let m = 0;
    if (isWall(tx, ty - 1)) m |= 1; // N
    if (isWall(tx + 1, ty)) m |= 2; // E
    if (isWall(tx, ty + 1)) m |= 4; // S
    if (isWall(tx - 1, ty)) m |= 8; // W
    return m;
  }

  /** After a wall is placed/destroyed at (tx,ty), re-pick its neighbors' art. */
  refreshWallsAround(tx: number, ty: number) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nb = this.world.buildingAt(tx + dx, ty + dy);
      if (nb && nb.type === 'wall') this.buildings.get(nb.uid)?.refreshWall(this.wallMask(nb.tx, nb.ty));
    }
  }

  // --- foes ---
  addFoe(f: Foe) {
    const v = new FoeView(f, this.art);
    v.updateShadow(this.lightDX, this.lightDY, this.shadowAlpha);
    this.foes.set(f.uid, v);
    this.layer.addChild(v.cont);
  }
  removeFoe(uid: number) {
    this.foes.get(uid)?.destroy();
    this.foes.delete(uid);
  }
  /** A2 added `px`/`py`: the Unseen affix fades a body by DISTANCE, and the
   *  view layer has no other way to know where the player is standing. Defaulted
   *  rather than required so the two dozen call sites in the Gauntlet that drive
   *  a redraw without a player keep working. */
  syncFoes(foes: Foe[], alpha: number, revealHp = false, px = 0, py = 0) {
    for (const f of foes) this.foes.get(f.uid)?.sync(f, alpha, revealHp, px, py);
  }

  // --- world bosses ---
  addBoss(b: WorldBoss) {
    if (this.bosses.has(b.uid)) this.removeBoss(b.uid);
    const v = new BossView(b, this.art);
    v.updateShadow(this.lightDX, this.lightDY, this.shadowAlpha);
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

  // --- B5 ground drops ---
  /** Diffed against state.drops each frame rather than driven by add/remove
   *  callbacks: drops are created and destroyed inside the sim (magnet pickup,
   *  despawn, cap eviction) where no view handle is in scope, and a missed
   *  callback would leak a sprite forever. */
  /** N4.6 added `memoryMul`: DropSystem scales the despawn timer by the
   *  vessel's storage headroom, and the blink-out warning has to be scaled by
   *  the SAME number or the item starts blinking at a time that has nothing to
   *  do with when it actually vanishes. A warning that fires at the wrong
   *  moment is worse than no warning — it teaches the player a schedule the
   *  game is not keeping. */
  syncDrops(drops: GroundDrop[], clock: number, memoryMul = 1) {
    for (const d of drops) {
      let v = this.drops.get(d.uid);
      if (!v) {
        v = new DropView(d, this.art);
        v.updateShadow(this.lightDX, this.lightDY, this.shadowAlpha);
        this.drops.set(d.uid, v);
        this.layer.addChild(v.cont);
      }
      v.sync(d, clock, memoryMul);
    }
    if (this.drops.size !== drops.length) {
      const live = new Set(drops.map((d) => d.uid));
      for (const [uid, v] of this.drops) {
        if (live.has(uid)) continue;
        v.destroy();
        this.drops.delete(uid);
      }
    }
  }

  // --- build ghost ---
  setGhost(type: string | null, tx = 0, ty = 0, valid = false, rangePx = 0) {
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
    // faint tile grid around the cursor so placement reads as grid-based
    const G = 5; // half-extent in tiles
    for (let i = -G; i <= G + 1; i++) {
      foot.moveTo((tx + i) * TILE, (ty - G) * TILE).lineTo((tx + i) * TILE, (ty + G + 1) * TILE)
        .moveTo((tx - G) * TILE, (ty + i) * TILE).lineTo((tx + G + 1) * TILE, (ty + i) * TILE);
    }
    foot.stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
    // tower range ring — the whole point of picking a spot
    if (rangePx > 0) {
      foot.circle((tx + 0.5) * TILE, (ty + 0.5) * TILE, rangePx)
        .fill({ color: 0x9fd0ff, alpha: 0.05 })
        .stroke({ width: 1.5, color: 0x9fd0ff, alpha: 0.7 });
    }
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

  /** C1: an expanding ring — echo pulses and novas (color carries the element). */
  addPulseRing(x: number, y: number, radius: number, color: number) {
    const g = new Graphics();
    g.position.set(x, y - 6);
    this.fx.addChild(g);
    this.animate(g, 0.35, (t) => {
      g.clear();
      g.circle(0, 0, radius * (0.25 + t * 0.75))
        .fill({ color, alpha: (1 - t) * 0.12 })
        .stroke({ width: 2.5, color, alpha: (1 - t) * 0.9 });
    });
  }

  /** B6: the level-up flourish — two rings racing outward and a soft ground
   *  bloom, drawn ON the character. The WoW read the request was pointing at is
   *  that a level-up happens to YOU; a toast in the corner is information, not
   *  an event. Deliberately gold and deliberately brief — this fires on every
   *  skill level, and an effect that outstays its welcome at level 4 is
   *  unbearable by level 40. */
  addLevelUpBurst(x: number, y: number) {
    const g = new Graphics();
    g.position.set(x, y - 6);
    this.fx.addChild(g);
    this.animate(g, 0.65, (t) => {
      g.clear();
      const ease = 1 - (1 - t) * (1 - t);        // fast out, slow settle
      // ground bloom first so the rings read on top of it
      g.ellipse(0, 12, 26 * ease, 10 * ease).fill({ color: 0xffd870, alpha: (1 - t) * 0.22 });
      g.circle(0, 0, 10 + 34 * ease)
        .stroke({ width: 3 - 2 * t, color: 0xfff0b8, alpha: (1 - t) * 0.95 });
      // the second ring trails the first, which is what stops it reading as a
      // single expanding circle and starts it reading as a pulse
      const t2 = Math.max(0, t - 0.18) / 0.82;
      if (t2 > 0) {
        g.circle(0, 0, 6 + 26 * (1 - (1 - t2) * (1 - t2)))
          .stroke({ width: 2, color: 0xffc24d, alpha: (1 - t2) * 0.6 });
      }
    });
  }

  /** C1: a smouldering ground patch (Cinder Trail) — glows, gutters, fades. */
  addBurnPatch(x: number, y: number, sec: number) {
    const g = new Graphics();
    g.position.set(x, y);
    this.fx.addChild(g);
    this.animate(g, sec, (t) => {
      g.clear();
      const flicker = 0.85 + Math.sin(t * 40) * 0.15;
      g.ellipse(0, 0, 11 * flicker, 6 * flicker).fill({ color: 0xc85a2e, alpha: (1 - t) * 0.45 });
      g.ellipse(0, 0, 6 * flicker, 3.5 * flicker).fill({ color: 0xffb347, alpha: (1 - t) * 0.6 });
    });
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
    for (const v of this.drops.values()) v.destroy();
    this.foes.clear();
    this.buildings.clear();
    this.bosses.clear();
    this.drops.clear();
    for (const b of buildings) this.addBuilding(b);
  }
}
