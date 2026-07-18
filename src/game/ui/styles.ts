// U1 — Lens UI Unification. RPGUI pixel-art chrome is gone; all panels, buttons,
// badges, and toasts now use the Lens aesthetic: dark translucent backgrounds,
// monospace fonts, 1px #334 borders, clean typography. The O-key Observatory is
// the reference — its look is copied outward, not edited.
//
// No rpgui imports, no Press Start 2P, no border-images, no pixel-art cursors.

export function injectStyles() {
  if (document.getElementById('nw-styles')) return;
  const el = document.createElement('style');
  el.id = 'nw-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const CSS = `
:root {
  --bg: #0a0a16;
  --bg-lighter: #111122;
  --border: #334;
  --border-light: #445;
  --ink: #ccc;
  --ink-dim: #888;
  --ink-bright: #f4f4f6;
  --accent: #f96;
  --glow: #f96;
  --good: #8fd05a;
  --bad: #e07a7a;
  --gold: #e6c86e;
  --font-pixel: ui-monospace, 'Consolas', 'Courier New', monospace;
  --font-body: ui-monospace, 'Consolas', 'Courier New', monospace;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body, canvas { cursor: default; }
#hud { font-size: max(11px, calc(13px * var(--scale))); font-family: var(--font-body); }
#hud .nw-btn, #hud .nw-make, #hud .nw-x, #hud .nw-tab, #hud .nw-cell, #hud .nw-slot {
  cursor: pointer; }

/* ---- dark scrollbars (game-wide, keeps the white OS bar out) ---- */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: #0a0a12; }
::-webkit-scrollbar-thumb { background: #334; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #556; }
::-webkit-scrollbar-corner { background: #0a0a12; }
/* Firefox */
html, body, #nw-observatory, .nw-pbody {
  scrollbar-width: thin;
  scrollbar-color: #334 #0a0a12;
}

/* keyboard focus ring */
.nw-tab:focus-visible, .nw-x:focus-visible, .nw-cell:focus-visible,
.nw-slot:focus-visible, .nw-make:focus-visible, .nw-btn:focus-visible {
  outline: 2px solid var(--glow);
  outline-offset: -2px;
}

/* ---- top status bar ---- */
.nw-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: calc(10px * var(--scale)); flex-wrap: wrap;
  padding: calc(6px * var(--scale) + env(safe-area-inset-top)) calc(10px * var(--scale)) calc(6px * var(--scale));
  pointer-events: none;
}
.nw-badge {
  pointer-events: auto;
  display: flex; align-items: center; gap: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: calc(5px * var(--scale)) calc(9px * var(--scale));
  color: var(--ink);
  white-space: nowrap;
}
.nw-title { font-family: var(--font-pixel); font-size: max(10px, calc(12px * var(--scale))); color: var(--ink-bright);
  font-weight: 700; letter-spacing: 0.5px; }
.nw-hpwrap { min-width: calc(108px * var(--scale)); }
.nw-hpbar { position: relative; width: calc(88px * var(--scale)); height: calc(10px * var(--scale));
  background: #1a0a10; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.nw-hpfill { position: absolute; inset: 0; width: 100%;
  background: #c03a3a; transition: width .2s; }
.nw-gold { color: var(--gold); font-weight: 700; }
.nw-clock .sun { color: var(--gold); } .nw-clock .moon { color: #a9b6e6; }
.nw-domain .dn { color: #c9b6e6; } .nw-domain .dg { color: #e07a7a; letter-spacing: 1px; }
.nw-domain { max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
.nw-spacer { margin-left: auto; }

/* ---- gather progress (center-bottom of screen) ---- */
.nw-gather {
  position: absolute; left: 50%; bottom: calc(128px * var(--scale)); transform: translateX(-50%);
  display: none; flex-direction: column; align-items: center; gap: calc(4px * var(--scale));
  pointer-events: none; color: var(--ink);
}
.nw-gather.on { display: flex; }
.nw-gbar { width: calc(120px * var(--scale)); height: calc(10px * var(--scale));
  background: #0a0a12; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.nw-gfill { height: 100%; width: 0; background: var(--good); }

/* ---- bottom action bar ---- */
.nw-actions {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center; gap: calc(8px * var(--scale));
  padding: calc(8px * var(--scale)) calc(10px * var(--scale)) calc(10px * var(--scale) + env(safe-area-inset-bottom));
  pointer-events: none; flex-wrap: wrap;
}
.nw-btn {
  pointer-events: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--ink); font-weight: 700;
  padding: max(6px, calc(10px * var(--scale))) max(8px, calc(12px * var(--scale))) max(8px, calc(12px * var(--scale)));
  font-family: var(--font-pixel); font-size: max(9px, calc(10px * var(--scale)));
  display: flex; flex-direction: column; align-items: center; gap: max(2px, calc(3px * var(--scale)));
  min-width: max(48px, calc(66px * var(--scale))); user-select: none;
  transition: background .12s, border-color .12s;
}
.nw-btn:hover { background: var(--bg-lighter); border-color: var(--border-light); }
.nw-btn:active { transform: translateY(1px); background: #0d0d1a; }
.nw-btn.hot { background: var(--bg-lighter); border-color: var(--border-light); }
.nw-btn.wide { flex-direction: row; }
.nw-btn .k { font-size: max(8px, calc(9px * var(--scale))); color: var(--ink-dim); }
.nw-btn.primary { border-color: var(--accent); }
.nw-btn.primary:hover { border-color: #fa7; background: #1a1410; }
.nw-btn.disabled { opacity: .4; pointer-events: none; }

/* button icon — rendered at body size so emoji are legible */
.nw-btn-icon { font-size: max(14px, calc(16px * var(--scale))); font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif; line-height: 1; }
.nw-btn-label { font-family: var(--font-pixel); font-size: max(8px, calc(9px * var(--scale))); line-height: 1.2; }

/* ---- build placement banner ---- */
.nw-buildbar {
  position: absolute; left: 50%; bottom: calc(88px * var(--scale)); transform: translateX(-50%);
  display: none; align-items: center; gap: calc(12px * var(--scale));
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: calc(8px * var(--scale)) calc(10px * var(--scale)) calc(8px * var(--scale)) calc(12px * var(--scale)); pointer-events: auto;
  color: var(--ink); max-width: 94vw;
}
.nw-buildbar.on { display: flex; animation: nw-buildpulse 1.1s ease-in-out infinite; }
.nw-buildbar .bimg { width: calc(40px * var(--scale)); height: calc(40px * var(--scale)); image-rendering: pixelated; }
.nw-buildbar .cyc { min-width: 0; padding: calc(8px * var(--scale)) calc(10px * var(--scale)) calc(10px * var(--scale)); }
.nw-buildbar .cost { font-size: calc(11px * var(--scale)); color: var(--ink-dim); }
.nw-buildbar .cost .have { color: var(--good); }
.nw-buildbar .cost .lack { color: var(--bad); }
.nw-buildbar .txt { display: flex; flex-direction: column; line-height: 1.4; min-width: 0; }
.nw-buildbar .nm { font-family: var(--font-pixel); font-size: calc(11px * var(--scale)); color: var(--ink-bright); font-weight: 700; }
.nw-buildbar .hint { font-size: calc(11px * var(--scale)); color: var(--ink-dim); }
.nw-buildbar .cancel { min-width: 0; padding: calc(6px * var(--scale)) calc(12px * var(--scale)); color: var(--bad); border-color: var(--bad); }
.nw-buildbar .cancel:hover { background: #1a1010; border-color: #f08080; }
@keyframes nw-buildpulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* ---- panels ---- */
.nw-scrim {
  position: absolute; inset: 0; background: rgba(4, 4, 12, .75);
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center; padding: calc(12px * var(--scale));
}
.nw-panel {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--ink);
  width: min(560px, 96vw); max-height: 86dvh;
  display: flex; flex-direction: column; overflow: hidden;
}
.nw-phead { display: flex; align-items: center; gap: calc(8px * var(--scale));
  padding: calc(12px * var(--scale)) calc(14px * var(--scale)) calc(10px * var(--scale));
  border-bottom: 1px solid var(--border); }
.nw-phead h2 { margin: 0; font-family: var(--font-pixel); font-size: max(11px, calc(12px * var(--scale)));
  color: var(--ink-bright); font-weight: 700; }
.nw-tabs { display: flex; gap: calc(4px * var(--scale)); margin-left: calc(4px * var(--scale)); }
.nw-tab { padding: calc(5px * var(--scale)) calc(10px * var(--scale)); font-family: var(--font-pixel);
  font-size: calc(10px * var(--scale)); color: var(--ink-dim); border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.nw-tab.on { color: var(--ink-bright); border-color: var(--border); background: var(--bg-lighter); }
.nw-x { margin-left: auto; font-size: calc(18px * var(--scale)); color: var(--ink-dim);
  width: calc(30px * var(--scale)); height: calc(30px * var(--scale)); display: grid; place-items: center;
  border-radius: 4px; cursor: pointer; }
.nw-x:hover { background: var(--bg-lighter); color: var(--ink); }
.nw-pbody { padding: calc(12px * var(--scale)) calc(14px * var(--scale)); overflow-y: auto; }

/* ---- item grid ---- */
.nw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 8px; }
.nw-cell { position: relative; aspect-ratio: 1; background: var(--bg-lighter);
  border: 1px solid var(--border); border-radius: 4px; display: grid; place-items: center; cursor: pointer; }
.nw-cell:hover { border-color: var(--border-light); background: #16162a; }
.nw-cell img { width: 82%; height: 82%; image-rendering: pixelated; }
.nw-cell .n { position: absolute; right: 3px; bottom: 1px; font-size: 11px;
  color: var(--ink-bright); }
.nw-cell .tag { position: absolute; left: 3px; top: 2px; font-size: 9px;
  color: var(--gold); }
.nw-empty { color: var(--ink-dim); padding: 18px; text-align: center; }

/* ---- recipe / build list rows ---- */
.nw-row { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid var(--border); border-radius: 4px; margin-bottom: 8px; background: var(--bg-lighter); }
.nw-row img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-row .info { flex: 1; min-width: 0; }
.nw-row .name { font-weight: 700; color: var(--ink-bright); }
.nw-row .sub { font-size: 11px; color: var(--ink-dim); margin-top: 2px; }
.nw-row .sub .have { color: var(--good); } .nw-row .sub .lack { color: var(--bad); }
.nw-make {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--ink); padding: 8px 12px 10px;
  font-family: var(--font-pixel); font-size: 10px;
  cursor: pointer;
  transition: background .12s, border-color .12s;
}
.nw-make:hover { background: var(--bg-lighter); border-color: var(--border-light); }
.nw-make:active { background: #0d0d1a; }
.nw-make:disabled { opacity: .45; cursor: default; }
.nw-make:disabled:hover { background: var(--bg); border-color: var(--border); }
.nw-make.short { color: var(--bad); border-color: var(--bad); }
.nw-make.short:hover { background: #1a1010; border-color: #f08080; }
.nw-locked { opacity: .5; }

/* ---- equipment (top of the bag) ---- */
.nw-equip { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.nw-slot { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid var(--border); border-radius: 4px; background: var(--bg-lighter); min-height: 56px; cursor: pointer; }
.nw-slot:hover { border-color: var(--border-light); }
.nw-slot.filled { border-color: var(--accent); }
.nw-slot img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-slot .ph { width: 34px; height: 34px; display: grid; place-items: center;
  font-size: 20px; color: var(--ink-dim); border: 2px dashed #ffffff22; border-radius: 4px; }
.nw-slot .meta { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.nw-slot .meta b { font-size: 10px; letter-spacing: 1px; color: var(--ink-dim); text-transform: uppercase; }
.nw-slot .meta .stat { font-size: 11px; color: var(--good); }
.nw-slot .meta .off { font-size: 12px; color: var(--ink-dim); }
.nw-soullv { font-size: 10px; color: #c9a0dc; letter-spacing: .5px; }
.nw-soulbar { width: 100%; height: 5px; background: #0a0a12;
  border: 1px solid var(--border); border-radius: 3px; overflow: hidden; margin: 1px 0; }
.nw-soulfill { height: 100%; background: #a97cc4; }
.nw-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--ink-dim); padding: 4px 2px 12px; }
.nw-tools .hd { color: var(--ink-dim); letter-spacing: 1px; text-transform: uppercase; font-size: 10px; }
.nw-cell.worn { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
.nw-cell .tag.on { color: #05060a; background: var(--good); padding: 0 3px; left: 2px; top: 2px; border-radius: 2px; }

/* ---- skills ---- */
.nw-note { font-size: 12px; color: var(--ink-dim); line-height: 1.5; margin-bottom: 12px;
  padding: 8px 10px; background: var(--bg-lighter); border: 1px solid var(--border); border-radius: 4px; }
.nw-note b { color: var(--ink); }
.nw-skill { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nw-skill .lv { display: flex; flex-direction: column; align-items: center; min-width: 34px; }
.nw-skill .lv b { font-family: var(--font-pixel); font-size: 14px; color: var(--gold); font-weight: 700; line-height: 1.2; }
.nw-skill .lv i { font-size: 9px; font-style: normal; letter-spacing: 1px; color: var(--ink-dim); }
.nw-skill .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.nw-skill .nm { display: flex; align-items: center; gap: 8px; color: var(--ink-bright); }
.nw-skill .kind { font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
  padding: 1px 6px; border: 1px solid transparent; border-radius: 3px; }
.nw-skill .kind.gather { color: #8fd05a; border-color: #8fd05a55; }
.nw-skill .kind.craft { color: #7fb8e6; border-color: #7fb8e655; }
.nw-skill .kind.combat { color: #e07a7a; border-color: #e07a7a55; }
.nw-skill .xp { font-size: 11px; color: var(--ink-dim); min-width: 74px; text-align: right; }
.nw-xpbar { height: 9px; background: #0a0a12; overflow: hidden;
  border: 1px solid var(--border); border-radius: 3px; }
.nw-xpfill { height: 100%; background: #5a8fc0; }

/* ---- event log ---- */
.nw-logrow { display: flex; align-items: baseline; gap: 8px; padding: 5px 6px;
  border-bottom: 1px solid var(--border); font-size: 12px; }
.nw-logt { color: var(--ink-dim); font-variant-numeric: tabular-nums; font-size: 11px; min-width: 34px; }
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
/* resonance log colors */
.nw-log-network .nw-logk, .nw-log-resonance-link .nw-logk,
.nw-log-resonance-rift .nw-logk { color: #00ff88; }
.nw-log-resonance-pulse .nw-logk { color: #00ccff; }
.nw-log-resonance-flow .nw-logk { color: #ffaa00; }
.nw-log-resonance-flux .nw-logk { color: #ff66cc; }
.nw-log-resonance-echo .nw-logk { color: #88ccff; }
.nw-log-resonance .nw-logk { color: #aaccff; }
/* mono abbreviation badges (Lens-feed .res-abbr keeps --font-pixel, now mono) */
.nw-logm .res-abbr {
  display: inline-block;
  font-family: var(--font-pixel);
  font-size: 9px;
  padding: 1px 4px;
  margin: 0 2px;
  border: 1px solid currentColor;
  border-radius: 2px;
  opacity: 0.85;
  vertical-align: middle;
  letter-spacing: 0;
}
.nw-logm .net-val { color: #a0d8ef; font-weight: 700; }
.nw-logm .net-unit { color: #7a8a9a; font-size: 10px; }
/* log export button */
.nw-log-export {
  margin-top: 8px; text-align: center;
}
.nw-log-export .nw-btn {
  display: inline-flex; flex-direction: row; gap: 6px;
  font-size: 10px; padding: 8px 14px;
}

/* ---- toasts ---- */
.nw-toasts { position: absolute; left: 50%; top: calc(54px * var(--scale)); transform: translateX(-50%);
  display: flex; flex-direction: column; gap: calc(6px * var(--scale)); align-items: center; pointer-events: none; }
.nw-toast {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: calc(6px * var(--scale)) calc(14px * var(--scale)); font-size: calc(12px * var(--scale)); color: var(--ink);
  animation: nw-pop .25s ease; max-width: 92vw; text-align: center;
}
.nw-toast.good { color: #d9f6c2; border-color: var(--good); }
.nw-toast.bad { color: #f6d2d2; border-color: var(--bad); }
@keyframes nw-pop { from { transform: translateY(-8px); opacity: 0; } }

/* ---- game over ---- */
.nw-gameover { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; text-align: center;
  background: rgba(6, 4, 14, .92); pointer-events: auto; }
.nw-gameover h1 { font-family: var(--font-pixel); font-size: 22px; color: var(--bad);
  font-weight: 700; margin: 0; }
.nw-gameover .nw-btn.primary {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--accent);
  padding: 10px 24px 12px;
  font-size: 11px;
}

/* ---- mobile / touch device adaptions ---- */
/* Touch devices: collapse action bar to right-side vertical stack */
[data-touch] .nw-actions {
  justify-content: flex-end;
  flex-direction: column;
  gap: calc(10px * var(--scale));
  padding: calc(16px * var(--scale));
  right: 0; left: auto; bottom: 50%;
  transform: translateY(50%);
  width: auto;
}
[data-touch] .nw-btn {
  min-width: calc(52px * var(--scale));
  min-height: calc(52px * var(--scale));
  padding: calc(8px * var(--scale));
  justify-content: center;
}
[data-touch] .nw-btn .k { display: none; }
[data-touch] .nw-btn.primary {
  min-width: calc(64px * var(--scale));
  min-height: calc(64px * var(--scale));
}

/* Narrow screens: hide secondary top-bar badges */
[data-narrow] .nw-title { display: none; }
[data-narrow] .nw-domain { display: none; }
[data-narrow] .nw-top { gap: calc(4px * var(--scale)); }

/* Very small screens: further compact the top bar */
@media (max-width: 400px) {
  .nw-title { display: none; }
  .nw-domain { max-width: 28vw; }
  .nw-hpwrap { min-width: auto; }
  .nw-hpbar { width: 56px; }
}
@media (max-width: 520px) {
  .nw-title { display: none; }
}
`;
