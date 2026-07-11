// All UI chrome in one injected stylesheet. Skinned with RPGUI's frame/button
// art (zlib license, bundled at build time — no runtime fetches) + the OFL
// "Press Start 2P" pixel font for headings/labels. Layout and class names are
// unchanged from the flat skin; only the look moved. RPGUI's own CSS is NOT
// imported — we consume just its images so nothing fights our layout.
import frame from 'rpgui/img/border-image.png';
import frameGold from 'rpgui/img/border-image-golden.png';
import bgDark from 'rpgui/img/background-image.png';
import bgGold from 'rpgui/img/background-image-golden.png';
import btnUp from 'rpgui/img/button.png';
import btnHover from 'rpgui/img/button-hover.png';
import btnDown from 'rpgui/img/button-down.png';
import hr from 'rpgui/img/hr.png';
import curDefault from 'rpgui/img/cursor/default.png';
import curPoint from 'rpgui/img/cursor/point.png';
import pixelFont from './fonts/PressStart2P-Regular.ttf';

export function injectStyles() {
  if (document.getElementById('nw-styles')) return;
  const el = document.createElement('style');
  el.id = 'nw-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// RPGUI frame slices (from its own stylesheet): plain = 6px slice, golden = 4px.
const framed = (width: string) => `
  border-style: solid;
  border-image: url(${frame}) 6 repeat;
  border-image-width: ${width};
  background: url(${bgDark});
  image-rendering: pixelated;`;
const framedGold = (width: string) => `
  border-style: solid;
  border-image: url(${frameGold}) 4 repeat;
  border-image-width: ${width};
  background: url(${bgGold});
  image-rendering: pixelated;`;
const buttonSkin = (img: string) => `
  border: none; border-radius: 0;
  background: url(${img}) no-repeat;
  background-size: 100% 100%;
  image-rendering: pixelated;`;

const CSS = `
@font-face {
  font-family: 'Press Start 2P';
  src: url(${pixelFont}) format('truetype');
  font-display: swap;
}
:root {
  --ink: #e8dfc8;
  --ink-dim: #a89878;
  --glow: #e6c86e;
  --good: #8fd05a;
  --bad: #e07a7a;
  --gold: #e6c86e;
  --font-pixel: 'Press Start 2P', monospace;
  --font-body: 'Consolas', 'Courier New', monospace;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body, canvas { cursor: url(${curDefault}), auto; }
#hud { font-size: 13px; font-family: var(--font-body); }
#hud .nw-btn, #hud .nw-make, #hud .nw-x, #hud .nw-tab, #hud .nw-cell {
  cursor: url(${curPoint}) 10 0, pointer; }

/* ---- top status bar ---- */
.nw-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: calc(6px + env(safe-area-inset-top)) 10px 6px;
  pointer-events: none;
}
.nw-badge {
  pointer-events: auto;
  display: flex; align-items: center; gap: 6px;
  ${framed('10px')}
  padding: 5px 9px;
  color: var(--ink);
  white-space: nowrap;
}
.nw-title { font-family: var(--font-pixel); font-size: 10px; color: #f4e8c8;
  text-shadow: 2px 2px 0 #000; letter-spacing: 0; }
.nw-hpwrap { min-width: 108px; }
.nw-hpbar { position: relative; width: 88px; height: 10px;
  background: #2a0d10; border: 2px solid #000; overflow: hidden; }
.nw-hpfill { position: absolute; inset: 0; width: 100%;
  background: #c03a3a; border-right: 2px solid #7a1f1f; transition: width .2s; }
.nw-gold { color: var(--gold); font-weight: 700; }
.nw-clock .sun { color: var(--gold); } .nw-clock .moon { color: #a9b6e6; }
.nw-domain .dn { color: #c9b6e6; } .nw-domain .dg { color: #e07a7a; letter-spacing: 1px; }
.nw-domain { max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
.nw-spacer { margin-left: auto; }

/* ---- gather progress (center-bottom of screen) ---- */
.nw-gather {
  position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%);
  display: none; flex-direction: column; align-items: center; gap: 4px;
  pointer-events: none; text-shadow: 1px 1px 0 #000; color: var(--ink);
}
.nw-gather.on { display: flex; }
.nw-gbar { width: 120px; height: 10px; background: #14100a;
  border: 2px solid #000; overflow: hidden; }
.nw-gfill { height: 100%; width: 0; background: var(--good); }

/* ---- bottom action bar ---- */
.nw-actions {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center; gap: 8px;
  padding: 8px 10px calc(10px + env(safe-area-inset-bottom));
  pointer-events: none; flex-wrap: wrap;
}
.nw-btn {
  pointer-events: auto;
  ${buttonSkin(btnUp)}
  color: #3a2a18; font-weight: 700;
  padding: 10px 12px 12px;
  font-family: var(--font-pixel); font-size: 8px;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  min-width: 66px; user-select: none;
}
.nw-btn:hover { background-image: url(${btnHover}); }
.nw-btn:active { background-image: url(${btnDown}); transform: translateY(1px); }
.nw-btn.hot { background-image: url(${btnHover}); }
.nw-btn.wide { flex-direction: row; }
.nw-btn .k { font-size: 7px; color: #7a6448; }
.nw-btn.primary { filter: hue-rotate(70deg) saturate(1.2); }
.nw-btn.disabled { opacity: .4; pointer-events: none; }

/* ---- build placement banner ---- */
.nw-buildbar {
  position: absolute; left: 50%; bottom: 88px; transform: translateX(-50%);
  display: none; align-items: center; gap: 12px;
  ${framedGold('14px')}
  padding: 8px 10px 8px 12px; pointer-events: auto;
  color: var(--ink); max-width: 94vw;
}
.nw-buildbar.on { display: flex; animation: nw-buildpulse 1.1s ease-in-out infinite; }
.nw-buildbar .bimg { width: 40px; height: 40px; image-rendering: pixelated; }
.nw-buildbar .cyc { min-width: 0; padding: 8px 10px 10px; }
.nw-buildbar .cost { font-size: 11px; color: var(--ink-dim); }
.nw-buildbar .cost .have { color: var(--good); }
.nw-buildbar .cost .lack { color: var(--bad); }
.nw-buildbar .txt { display: flex; flex-direction: column; line-height: 1.4; min-width: 0; }
.nw-buildbar .nm { font-family: var(--font-pixel); font-size: 9px; color: #fff2c8;
  text-shadow: 1px 1px 0 #000; }
.nw-buildbar .hint { font-size: 11px; color: var(--ink-dim); }
.nw-buildbar .cancel { min-width: 0; padding: 6px 12px; filter: hue-rotate(-40deg); }
@keyframes nw-buildpulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* ---- panels ---- */
.nw-scrim {
  position: absolute; inset: 0; background: rgba(8, 6, 2, .6);
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center; padding: 12px;
}
.nw-panel {
  ${framed('18px')}
  color: var(--ink);
  width: min(560px, 96vw); max-height: 86vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.nw-phead { display: flex; align-items: center; gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 4px solid transparent;
  border-image: url(${hr}) 4 repeat; border-image-width: 0 0 4px 0; }
.nw-phead h2 { margin: 0; font-family: var(--font-pixel); font-size: 11px;
  color: #f4e8c8; text-shadow: 2px 2px 0 #000; }
.nw-tabs { display: flex; gap: 4px; margin-left: 4px; }
.nw-tab { padding: 5px 10px; font-family: var(--font-pixel); font-size: 8px;
  color: var(--ink-dim); border: 2px solid transparent; }
.nw-tab.on { color: #f4e8c8; border-color: #00000055; background: #00000033; }
.nw-x { margin-left: auto; font-size: 18px; color: var(--ink-dim);
  width: 30px; height: 30px; display: grid; place-items: center; }
.nw-x:hover { background: #00000044; color: var(--ink); }
.nw-pbody { padding: 12px 14px; overflow-y: auto; }

/* ---- item grid ---- */
.nw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 8px; }
.nw-cell { position: relative; aspect-ratio: 1; background: #14100acc;
  border: 2px solid #00000066; display: grid; place-items: center; }
.nw-cell img { width: 82%; height: 82%; image-rendering: pixelated; }
.nw-cell .n { position: absolute; right: 3px; bottom: 1px; font-size: 11px;
  color: #fff; text-shadow: 1px 1px 0 #000; }
.nw-cell .tag { position: absolute; left: 3px; top: 2px; font-size: 9px;
  color: var(--gold); }
.nw-empty { color: var(--ink-dim); padding: 18px; text-align: center; }

/* ---- recipe / build list rows ---- */
.nw-row { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 2px solid #00000055; margin-bottom: 8px; background: #14100a88; }
.nw-row img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-row .info { flex: 1; min-width: 0; }
.nw-row .name { font-weight: 700; color: #f4e8c8; }
.nw-row .sub { font-size: 11px; color: var(--ink-dim); margin-top: 2px; }
.nw-row .sub .have { color: var(--good); } .nw-row .sub .lack { color: var(--bad); }
.nw-make {
  ${buttonSkin(btnUp)}
  color: #3a2a18; padding: 8px 12px 10px;
  font-family: var(--font-pixel); font-size: 8px;
}
.nw-make:hover { background-image: url(${btnHover}); }
.nw-make:active { background-image: url(${btnDown}); }
.nw-make:disabled { opacity: .45; filter: grayscale(.8); cursor: default; }
.nw-make.short { filter: hue-rotate(-40deg) saturate(1.3); }
.nw-locked { opacity: .5; }

/* ---- equipment (top of the bag) ---- */
.nw-equip { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.nw-slot { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 2px solid #00000055; background: #14100a88; min-height: 56px; }
.nw-slot.filled { border-color: #a8894466; }
.nw-slot img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-slot .ph { width: 34px; height: 34px; display: grid; place-items: center;
  font-size: 20px; color: var(--ink-dim); border: 2px dashed #ffffff22; }
.nw-slot .meta { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.nw-slot .meta b { font-size: 10px; letter-spacing: 1px; color: var(--ink-dim); text-transform: uppercase; }
.nw-slot .meta .stat { font-size: 11px; color: var(--good); }
.nw-slot .meta .off { font-size: 12px; color: #7a6a52; }
.nw-soullv { font-size: 10px; color: #c9a0dc; letter-spacing: .5px; }
.nw-soulbar { width: 100%; height: 5px; background: #14100a;
  border: 1px solid #00000088; overflow: hidden; margin: 1px 0; }
.nw-soulfill { height: 100%; background: #a97cc4; }
.nw-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--ink-dim); padding: 4px 2px 12px; }
.nw-tools .hd { color: #7a6a52; letter-spacing: 1px; text-transform: uppercase; font-size: 10px; }
.nw-cell.worn { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
.nw-cell .tag.on { color: #05060a; background: var(--good); padding: 0 3px; left: 2px; top: 2px; }

/* ---- skills ---- */
.nw-note { font-size: 12px; color: var(--ink-dim); line-height: 1.5; margin-bottom: 12px;
  padding: 8px 10px; background: #14100a88; border: 2px solid #00000055; }
.nw-note b { color: var(--ink); }
.nw-skill { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nw-skill .lv { display: flex; flex-direction: column; align-items: center; min-width: 34px; }
.nw-skill .lv b { font-family: var(--font-pixel); font-size: 14px; color: var(--gold); line-height: 1.2; }
.nw-skill .lv i { font-size: 9px; font-style: normal; letter-spacing: 1px; color: var(--ink-dim); }
.nw-skill .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.nw-skill .nm { display: flex; align-items: center; gap: 8px; color: #f4e8c8; }
.nw-skill .kind { font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
  padding: 1px 6px; border: 1px solid transparent; }
.nw-skill .kind.gather { color: #8fd05a; border-color: #8fd05a55; }
.nw-skill .kind.craft { color: #7fb8e6; border-color: #7fb8e655; }
.nw-skill .kind.combat { color: #e07a7a; border-color: #e07a7a55; }
.nw-skill .xp { font-size: 11px; color: var(--ink-dim); min-width: 74px; text-align: right; }
.nw-xpbar { height: 9px; background: #14100a; overflow: hidden;
  border: 2px solid #00000066; }
.nw-xpfill { height: 100%; background: #5a8fc0; }

/* ---- event log ---- */
.nw-logrow { display: flex; align-items: baseline; gap: 8px; padding: 5px 6px;
  border-bottom: 1px solid #ffffff10; font-size: 12px; }
.nw-logt { color: #7a6a52; font-variant-numeric: tabular-nums; font-size: 11px; min-width: 34px; }
.nw-logk { font-size: 9px; letter-spacing: .5px; text-transform: uppercase; min-width: 56px;
  color: var(--ink-dim); }
.nw-logm { flex: 1; color: var(--ink); }
.nw-log-combat .nw-logk, .nw-log-death .nw-logk { color: var(--bad); }
.nw-log-boss .nw-logk { color: #e0a13f; }
.nw-log-level .nw-logk, .nw-log-economy .nw-logk { color: var(--gold); }
.nw-log-gather .nw-logk, .nw-log-craft .nw-logk, .nw-log-build .nw-logk { color: var(--good); }
.nw-log-region .nw-logk { color: #c9b6e6; }
.nw-log-spawn .nw-logk { color: #7fb8e6; }
.nw-log-world .nw-logk { color: #6fd3c0; }

/* ---- toasts ---- */
.nw-toasts { position: absolute; left: 50%; top: 54px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
.nw-toast {
  ${framed('8px')}
  padding: 6px 14px; font-size: 12px; color: var(--ink);
  animation: nw-pop .25s ease; max-width: 92vw; text-align: center;
}
.nw-toast.good { color: #d9f6c2; }
.nw-toast.bad { color: #f6d2d2; }
@keyframes nw-pop { from { transform: translateY(-8px); opacity: 0; } }

/* ---- game over ---- */
.nw-gameover { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; text-align: center;
  background: radial-gradient(circle, #2a0d18cc, #05060acc); pointer-events: auto; }
.nw-gameover h1 { font-family: var(--font-pixel); font-size: 22px; color: #e07a7a;
  text-shadow: 3px 3px 0 #000; margin: 0; }

@media (max-width: 520px) {
  .nw-title { display: none; }
  .nw-btn { min-width: 54px; padding: 8px 9px; }
}
`;
