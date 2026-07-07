// Limited sight. A soft radial-gradient vignette sits in screen space, centred
// on the (always-centred) player: clear in the middle, dark at the edges, so
// the unexplored world stays literally in shadow. One baked texture, scaled to
// cover the viewport — cheap. Darker at night and while a boss looms.
import { Application, Container, Sprite, Texture } from 'pixi.js';

function vignetteTexture(): Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.14, S / 2, S / 2, S * 0.5);
  grd.addColorStop(0, 'rgba(4,6,14,0)');
  grd.addColorStop(0.42, 'rgba(4,6,14,0)');
  grd.addColorStop(1, 'rgba(4,6,14,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = Texture.from(c);
  t.source.scaleMode = 'linear';
  return t;
}

export class Fog {
  private sprite: Sprite;

  constructor(private app: Application, parent: Container) {
    this.sprite = new Sprite(vignetteTexture());
    this.sprite.anchor.set(0.5);
    parent.addChild(this.sprite);
  }

  /** intensity 0..~0.8 — overall darkness of the edges this frame. */
  update(intensity: number) {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.sprite.position.set(w / 2, h / 2);
    // scale so the opaque ring always reaches past the screen corners
    const cover = (Math.hypot(w, h) / 256) * 1.15;
    this.sprite.scale.set(cover);
    this.sprite.alpha = intensity;
  }
}
