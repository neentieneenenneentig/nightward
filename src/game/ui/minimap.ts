// A4 — the minimap.
//
// `state.explored` has carried the comment `// region key → 1 (for fog /
// future minimap)` since it was written. This is that future.
//
// It is deliberately a LOCAL radar rather than a world map, because the four
// questions a minimap answers in an ARPG are all local: where am I, where is
// home, where is the loot, where is the danger. A zoomed-out world map answers
// none of them well and costs a terrain render every frame.
//
// Nothing here samples terrain. Every mark is an entity the sim already keeps
// in an array, so a frame costs one clear plus a few dozen rects — which is why
// it can run at 10 Hz without a budget conversation. A terrain tint would mean
// ~1000 world lookups per refresh for something the player can already see by
// looking at the actual screen.
import { CFG } from '../data/config';
import { TILE } from '../world/worldgen';
import { rarityColor, rarityOf } from './rarity';
import type { GameState } from '../state';

const SIZE = 124;          // css px
const RADIUS_TILES = 58;   // how much world fits in the disc
const HZ = 10;

export class Minimap {
  private cvs: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lastT = -999;

  constructor(private root: HTMLElement) {
    this.cvs = document.createElement('canvas');
    this.cvs.id = 'nw-map';
    // Backing store at 2x so the marks stay crisp on a HiDPI screen without
    // any of them being drawn at a fractional device pixel.
    this.cvs.width = SIZE * 2;
    this.cvs.height = SIZE * 2;
    this.cvs.style.width = SIZE + 'px';
    this.cvs.style.height = SIZE + 'px';
    this.g = this.cvs.getContext('2d')!;
    this.attach();
  }

  /** The HUD root is rebuilt from scratch by the Ui constructor
   *  (`this.root.innerHTML = ''`), which silently deletes anything another
   *  system appended to it first. Re-attaching on demand — the same pattern the
   *  tooltip host uses — makes this immune to construction order instead of
   *  dependent on it. It cost one live capture to find and would have cost
   *  another every time either file was reordered. */
  private attach() {
    if (!this.cvs.isConnected) this.root.appendChild(this.cvs);
  }

  setVisible(v: boolean) { this.attach(); this.cvs.style.display = v ? 'block' : 'none'; }

  /** `foes` is passed rather than read off a system so this stays a pure view:
   *  it can be driven from a test, or from a replay, without a HordeSystem.
   *  `sight` is the Scrying multiplier (N4.4): fast DNS widens the radar,
   *  slow DNS narrows it. Default 1 = the authored radius, unchanged. */
  draw(state: GameState, nowMs: number, foes: { x: number; y: number; def?: any }[] = [], sight = 1) {
    if (nowMs - this.lastT < 1000 / HZ) return;
    this.lastT = nowMs;

    const g = this.g;
    const C = SIZE;                       // logical size; the context is scaled
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, C, C);

    const px = state.player.x, py = state.player.y;
    const span = RADIUS_TILES * TILE * Math.max(0.5, Math.min(2, sight));
    const half = C / 2;
    const k = half / span;                // world px → map px

    // The disc. Everything is clipped to it so a mark near the corner cannot
    // sit outside the frame and read as UI rather than as world.
    g.save();
    g.beginPath();
    g.arc(half, half, half - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(12,9,6,0.55)';
    g.fillRect(0, 0, C, C);

    const to = (wx: number, wy: number) => [half + (wx - px) * k, half + (wy - py) * k] as const;
    const dot = (wx: number, wy: number, r: number, color: string) => {
      const [x, y] = to(wx, wy);
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };

    // ---- buildings: your territory, which is the shape of your run ----
    for (const b of state.buildings) {
      const wx = (b.tx + 0.5) * TILE, wy = (b.ty + 0.5) * TILE;
      const [x, y] = to(wx, wy);
      if (b.type === 'hall') {
        // The hall is the one thing whose loss ends the run, so it is the one
        // mark that never scales down and never shares a colour.
        g.fillStyle = '#e8c34a';
        g.save();
        g.translate(x, y);
        g.rotate(Math.PI / 4);
        g.fillRect(-3.5, -3.5, 7, 7);
        g.restore();
      } else {
        g.fillStyle = 'rgba(147,121,74,0.85)';
        g.fillRect(x - 1, y - 1, 2.5, 2.5);
      }
    }

    // ---- ground drops: rarity-coloured, which is the whole point ----
    for (const d of state.drops) {
      const r = rarityOf(d.id);
      dot(d.x, d.y, r === 'plain' ? 1.2 : 2.2, r === 'plain' ? 'rgba(214,203,180,0.5)' : rarityColor(d.id));
    }

    // ---- danger ----
    for (const f of foes) dot(f.x, f.y, 1.6, 'rgba(214,90,90,0.9)');
    for (const b of state.worldBosses ?? []) {
      const [x, y] = to(b.x, b.y);
      g.fillStyle = '#ff5a4a';
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(x + 3.6, y + 3);
      g.lineTo(x - 3.6, y + 3);
      g.closePath();
      g.fill();
    }

    // ---- you ----
    g.fillStyle = '#f1e6cd';
    g.beginPath();
    g.arc(half, half, 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // ---- the ring, drawn outside the clip so it stays a clean 1px ----
    g.strokeStyle = 'rgba(147,121,74,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(half, half, half - 1, 0, Math.PI * 2);
    g.stroke();

    // A hall off the edge of the radar is the single most useful thing this can
    // tell you at 3am on night five, so it gets an arrow on the rim rather than
    // simply vanishing.
    const hall = state.buildings.find((b) => b.type === 'hall');
    if (hall) {
      const hx = (hall.tx + 0.5) * TILE, hy = (hall.ty + 0.5) * TILE;
      const dx = hx - px, dy = hy - py;
      if (Math.hypot(dx, dy) > span) {
        const a = Math.atan2(dy, dx);
        const rr = half - 7;
        g.save();
        g.translate(half + Math.cos(a) * rr, half + Math.sin(a) * rr);
        g.rotate(a);
        g.fillStyle = '#e8c34a';
        g.beginPath();
        g.moveTo(4, 0);
        g.lineTo(-3, -3);
        g.lineTo(-3, 3);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  }
}

export const MINIMAP_ENABLED = () => CFG.loot.minimap !== false;
