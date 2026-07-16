// Pixi v8 setup. `preference: 'webgpu'` uses the WebGPU backend where the
// browser supports it and silently falls back to WebGL elsewhere.
import { Application, Container, TextureSource, Texture, Sprite, Rectangle } from 'pixi.js';

export interface Stage {
  app: Application;
  /** camera: everything in here is in world pixels; we move/scale this container */
  world: Container;
  ground: Container;
  entities: Container;
  /** painting-style grain overlay (full screen, multiply-blend, low opacity) */
  grain: Sprite;
}

/** Generate a noise-grain canvas texture — static, seeded, tilable 128×128. */
function makeGrainTexture(): Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + ((Math.random() * 64) | 0); // subtle mid-grey noise
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 18; // very low opacity per-pixel
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(c);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export async function createRenderer(mount: HTMLElement): Promise<Stage> {
  // nearest-neighbor everywhere = crisp pixels when upscaled (the hi-bit look)
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  await app.init({
    // WebGPU by default; add ?gl to the URL to force WebGL (handy for
    // debugging and for browsers with flaky WebGPU support)
    preference: new URLSearchParams(location.search).has('gl') ? 'webgl' : 'webgpu',
    background: '#0d2b47',
    resolution: Math.min(window.devicePixelRatio || 1, 2), // cap DPR: mobile GPU budget
    autoDensity: true,
    antialias: false,
    resizeTo: window,
  });
  mount.appendChild(app.canvas);

  const world = new Container();
  const ground = new Container();
  const entities = new Container();
  world.addChild(ground);
  world.addChild(entities);
  app.stage.addChild(world);

  // painting-style grain overlay: tiled across the screen, multiply-blended, very subtle
  const grain = new Sprite(makeGrainTexture());
  grain.blendMode = 'multiply';
  grain.alpha = 0.35;
  grain.zIndex = 1000;
  app.stage.addChild(grain);

  // keep grain covering the full screen
  const updateGrain = () => {
    const w = app.screen.width, h = app.screen.height;
    grain.texture.source.style.addressMode = 'repeat';
    grain.setSize(w, h);
  };
  app.renderer.on('resize', updateGrain);
  updateGrain();

  return { app, world, ground, entities, grain };
}

/** Integer zoom that shows roughly 11+ tiles across the smaller screen axis. */
export function zoomFor(w: number, h: number): number {
  const min = Math.min(w, h);
  return Math.max(1, Math.min(4, Math.round(min / (32 * 11))));
}
