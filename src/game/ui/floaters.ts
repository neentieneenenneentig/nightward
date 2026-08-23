// Floating network-stat numbers — WoW-style combat text that rises from
// action locations showing which network metric influenced the outcome.
// Rendered as PixiJS Text objects, positioned via camera world→screen.
import { Text, TextStyle, Container } from 'pixi.js';
import type { Camera } from '../world/camera';
import type { NetworkSystem } from '../systems/network';

interface Floater {
  text: Text;
  born: number;
  life: number; // seconds
  vx: number;
  vy: number;
}

const FLOAT_LIFE = 2.2;    // seconds before removal
const FLOAT_RISE = -32;     // px/s upward drift
const FONT_SIZE = 11;

/** Color per metric type — warm for latency, cool for bandwidth, etc. */
const METRIC_COLORS: Record<string, string> = {
  rtt: '#ff9966',
  downlink: '#66ccff',
  jitter: '#ffcc66',
  effectiveType: '#ff6666',
  connectionType: '#99ccff',
  simSpeed: '#ffcc00',
  goldRate: '#ffdd44',
  enemyScale: '#ff4444',
};

export class FloaterSystem {
  private floaters: Floater[] = [];
  private layer: Container;
  private style: TextStyle;

  constructor(parent: Container) {
    this.layer = new Container();
    this.layer.zIndex = 999;
    parent.addChild(this.layer);
    this.style = new TextStyle({
      fontFamily: 'Consolas, monospace',
      fontSize: FONT_SIZE,
      fill: '#ffffff',
      stroke: '#000000',
    });
  }

  /** Spawn a network-stat floater at world (wx, wy), converted to screen via camera. */
  spawn(wx: number, wy: number, label: string, value: number, unit: string, cam: Camera) {
    const color = METRIC_COLORS[label] || '#ffffff';
    const s = new TextStyle({ ...this.style, fill: color });
    const display = unit ? `${label}: ${value.toFixed(1)}${unit}` : `${label}: ${value.toFixed(2)}×`;
    const text = new Text({ text: display, style: s });
    text.anchor.set(0.5, 0.5);

    const [sx, sy] = cam.worldToScreen(wx, wy);
    text.position.set(sx, sy - 20);

    this.layer.addChild(text);
    this.floaters.push({
      text,
      born: performance.now() / 1000,
      life: FLOAT_LIFE,
      vx: (Math.random() - 0.5) * 10,
      vy: FLOAT_RISE,
    });
  }

  /** Spawn a generic info floater (not network-specific). */
  spawnInfo(wx: number, wy: number, msg: string, color: string, cam: Camera) {
    const s = new TextStyle({ ...this.style, fill: color });
    const text = new Text({ text: msg, style: s });
    text.anchor.set(0.5, 0.5);
    const [sx, sy] = cam.worldToScreen(wx, wy);
    text.position.set(sx, sy - 20);
    this.layer.addChild(text);
    this.floaters.push({
      text,
      born: performance.now() / 1000,
      life: 1.4,  // shorter life for vitals floaters
      vx: (Math.random() - 0.5) * 6,
      vy: FLOAT_RISE * 0.7,
    });
  }

  /** SR7 — a landed-hit damage number. Bigger, warmer and slower the heavier
   *  the hit, so a crit reads as a crit before the player parses the digits.
   *  `severity` 0..1 is the caller's own damage-multiplier headroom, not a
   *  fresh HP-relative calc — reusing combat's existing totalMul means a
   *  boss fight and a trash pack agree on what "heavy" means. */
  spawnDamage(wx: number, wy: number, amount: number, severity: number, cam: Camera) {
    const s = Math.max(0, Math.min(1, severity));
    const size = FONT_SIZE + s * 10;
    const color = s > 0.6 ? '#ffcc00' : s > 0.25 ? '#ffffff' : '#dddddd';
    const style = new TextStyle({ ...this.style, fontSize: size, fill: color, fontWeight: s > 0.6 ? 'bold' : 'normal' });
    const text = new Text({ text: `${Math.round(amount)}`, style });
    text.anchor.set(0.5, 0.5);
    const [sx, sy] = cam.worldToScreen(wx, wy);
    text.position.set(sx + (Math.random() - 0.5) * 8, sy - 22);
    this.layer.addChild(text);
    this.floaters.push({
      text,
      born: performance.now() / 1000,
      life: 0.85 + s * 0.6,
      vx: (Math.random() - 0.5) * (10 + s * 20),
      vy: FLOAT_RISE * (1 + s * 0.6),
    });
  }

  /** S1: spawn a vital-change floater (smaller, quicker). */
  spawnVital(wx: number, wy: number, _label: string, msg: string, color: string, cam: Camera) {
    this.spawnInfo(wx, wy, msg, color, cam);
  }

  /** Call every frame with current time in seconds. */
  update(nowSec: number, cam: Camera) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      const age = nowSec - f.born;
      if (age >= f.life) {
        f.text.destroy();
        this.floaters.splice(i, 1);
        continue;
      }
      const alpha = age < 0.3 ? age / 0.3 : age > f.life - 0.5 ? (f.life - age) / 0.5 : 1;
      f.text.alpha = alpha;
      f.text.position.y += f.vy * (1 / 60); // approx per-frame
      f.text.position.x += f.vx * (1 / 60);
    }
  }

  clear() {
    for (const f of this.floaters) f.text.destroy();
    this.floaters = [];
  }
}
