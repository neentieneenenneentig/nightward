// Pixi v8 setup. `preference: 'webgpu'` uses the WebGPU backend where the
// browser supports it and silently falls back to WebGL elsewhere.
import { Application, Container, TextureSource } from 'pixi.js';

export interface Stage {
  app: Application;
  /** camera: everything in here is in world pixels; we move/scale this container */
  world: Container;
  ground: Container;
  entities: Container;
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

  return { app, world, ground, entities };
}

/** Integer zoom that shows roughly 11+ tiles across the smaller screen axis. */
export function zoomFor(w: number, h: number): number {
  const min = Math.min(w, h);
  return Math.max(1, Math.min(4, Math.round(min / (32 * 11))));
}
