// Drives a parametric Rig's parts from pose() output. `cont` is the thing
// callers add to the stage and position in world space; internally `body` is
// the part that actually rotates toward `facing` — the "cutout on a turntable."
import { Container, Sprite, Texture } from 'pixi.js';
import type { Rig, PartId } from '../../engine/procgen/rig';
import { pose, type AttackState } from '../../engine/procgen/rig';

function tex(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

export class RigView {
  cont = new Container();
  private body = new Container();
  private sprites = new Map<PartId, Sprite>();

  constructor(private rig: Rig) {
    this.body.sortableChildren = true;
    this.cont.addChild(this.body);
    for (const p of rig.parts) {
      const s = new Sprite(tex(p.tex));
      s.anchor.set(p.pivot[0], p.pivot[1]);
      s.zIndex = p.z;
      this.body.addChild(s);
      this.sprites.set(p.id, s);
    }
  }

  /** facing is a float radian; the whole rig rotates to it as a rigid group. */
  update(locomotion: 'idle' | 'walk', tLoc: number, facing: number, meleeArcRad: number, attack: AttackState | null) {
    this.body.rotation = facing;
    const p = pose(locomotion, tLoc, meleeArcRad, attack);
    for (const [id, s] of this.sprites) {
      const tr = p[id];
      if (!tr) continue;
      s.position.set(tr.x, tr.y);
      s.rotation = tr.rot;
      s.zIndex = tr.z;
    }
  }

  setTint(color: number) {
    for (const s of this.sprites.values()) s.tint = color;
  }

  destroy() { this.cont.destroy({ children: true }); }
}
