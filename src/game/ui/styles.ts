// U2 — Grimdark Chrome. Warm-iron surfaces, brass plaque frames (box-shadow rings,
// not border-image), serif display type, Diablo-style action sockets — zero image
// assets, zero new dependencies. The O-key Observatory Lens stays clinically mono
// as deliberate contrast. Builds on U1's architecture (one stylesheet, CSS custom
// properties, unchanged DOM/layout).
//
// No Press Start 2P, no border-image, no hue-rotate, no --font-pixel.

export function injectStyles() {
  if (document.getElementById('nw-styles')) return;
  const el = document.createElement('style');
  el.id = 'nw-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const CSS = `
:root {
  /* surfaces — warm near-black (iron/leather), not blue-slate */
  --bg: #14100b;
  --bg-deep: #0c0906;
  --bg-lift: #1d1710;
  /* metal trim (brass/bronze ramp) */
  --metal-hi: #93794a;
  --metal: #6a5638;
  --metal-lo: #33291a;
  /* ink — bone/parchment on iron */
  --ink: #d6cbb4;
  --ink-dim: #8d8272;
  --ink-bright: #f1e6cd;
  /* accents */
  --accent: #d8a648;
  --glow: #d8a648;
  --blood: #8f1d16;
  --blood-hi: #d24a38;
  --good: #8fd05a;
  --bad: #d4553f;
  --gold: #e6c86e;
  /* type */
  --font-display: 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
  --font-body: 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body, canvas { cursor: default; }
#hud { font-size: max(11px, calc(13px * var(--scale))); font-family: var(--font-body); }
#hud .nw-btn, #hud .nw-make, #hud .nw-x, #hud .nw-tab, #hud .nw-cell, #hud .nw-slot {
  cursor: pointer; }

/* ---- dark scrollbars (brass-toned) ---- */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: #0b0806; }
::-webkit-scrollbar-thumb { background: #4a3b24; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #6a5638; }
::-webkit-scrollbar-corner { background: #0b0806; }
/* Firefox */
html, body, #nw-observatory, .nw-pbody {
  scrollbar-width: thin;
  scrollbar-color: #4a3b24 #0b0806;
}

/* keyboard focus ring — gold */
.nw-tab:focus-visible, .nw-x:focus-visible, .nw-cell:focus-visible,
.nw-slot:focus-visible, .nw-make:focus-visible, .nw-btn:focus-visible {
  outline: 2px solid var(--accent);
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
  /* thin plaque */
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 50%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), 0 2px 8px rgba(0,0,0,.4);
  padding: calc(5px * var(--scale)) calc(9px * var(--scale));
  color: var(--ink);
  white-space: nowrap;
}
.nw-title { font-family: var(--font-display); font-size: max(11px, calc(13px * var(--scale))); color: var(--accent);
  font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
.nw-hpwrap { min-width: calc(108px * var(--scale)); }
.nw-hpbar { position: relative; width: calc(88px * var(--scale)); height: calc(12px * var(--scale));
  background: var(--bg-deep); border: 1px solid #000; border-radius: 2px; overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.8); }
.nw-hpbar::after {
  content: ''; position: absolute; left: 2px; right: 2px; top: 45%; height: 1px;
  background: linear-gradient(90deg, rgba(255,255,255,.08), rgba(255,255,255,.2), rgba(255,255,255,.06));
  pointer-events: none; z-index: 2;
}
.nw-hpfill { position: absolute; inset: 0; z-index: 1; width: 100%;
  background: linear-gradient(180deg, var(--blood-hi), var(--blood) 60%, #6d130e);
  transition: width .2s; }
.nw-gold { color: var(--gold); font-weight: 700; }
/* ---- L1: age / lifespan chip — a hard, ever-draining clock ---- */
.nw-agebar { position: relative; width: calc(60px * var(--scale)); height: calc(9px * var(--scale));
  background: var(--bg-deep); border: 1px solid #000; border-radius: 2px; overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.8); }
.nw-agefill { position: absolute; inset: 0; z-index: 1; width: 100%; right: 0; left: auto;
  background: linear-gradient(180deg, #cfa860, var(--metal-hi) 60%, #6a5638);
  transition: width .3s; }
.nw-age.warn .nw-agefill { background: linear-gradient(180deg, #e0a04a, #b06a1e 60%, #6e3f10); }
.nw-age.critical .nw-agefill { background: linear-gradient(180deg, var(--blood-hi), var(--blood) 60%, #6d130e); }
.nw-age.critical { animation: nw-age-pulse 1.1s ease-in-out infinite; }
@keyframes nw-age-pulse { 0%, 100% { box-shadow: inset 0 0 0 1px var(--metal-lo), 0 2px 8px rgba(0,0,0,.4); }
  50% { box-shadow: inset 0 0 0 1px var(--blood-hi), 0 0 10px rgba(210,74,56,.5); } }
.nw-clock .sun { color: var(--gold); } .nw-clock .moon { color: #a9b6e6; }
.nw-domain .dn { color: #ccbbdd; } .nw-domain .dg { color: #d89a9a; letter-spacing: 1px; }
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
  background: var(--bg-deep); border: 1px solid #000; border-radius: 3px; overflow: hidden;
  box-shadow: inset 0 1px 3px rgba(0,0,0,.6); }
.nw-gfill { height: 100%; width: 0; background: var(--good); }

/* ---- bottom action bar ---- */
.nw-actions {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center; gap: calc(8px * var(--scale));
  padding: calc(8px * var(--scale)) calc(10px * var(--scale)) calc(10px * var(--scale) + env(safe-area-inset-bottom));
  pointer-events: none; flex-wrap: wrap;
}

/* ---- generic button (plaque — used outside the action bar) ---- */
.nw-btn {
  pointer-events: auto;
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 50%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 0 0 2px rgba(0,0,0,.5),
    inset 0 0 16px rgba(0,0,0,.35), 0 3px 12px rgba(0,0,0,.5);
  color: var(--ink); font-weight: 700;
  padding: max(6px, calc(10px * var(--scale))) max(8px, calc(12px * var(--scale))) max(8px, calc(12px * var(--scale)));
  font-family: var(--font-display); font-size: max(9px, calc(10px * var(--scale)));
  letter-spacing: 1px;
  display: flex; flex-direction: column; align-items: center; gap: max(2px, calc(3px * var(--scale)));
  min-width: max(48px, calc(66px * var(--scale))); user-select: none;
  transition: background .12s, border-color .12s, box-shadow .12s;
}
.nw-btn:hover { background: linear-gradient(180deg, #1f1810, #14100b); box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.45), inset 0 0 16px rgba(0,0,0,.3), 0 3px 14px rgba(0,0,0,.55); }
.nw-btn:active { transform: translateY(1px); background: #0e0b07; }
.nw-btn.hot { background: linear-gradient(180deg, #1f1810, #14100b); box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.45), inset 0 0 16px rgba(0,0,0,.3), 0 3px 14px rgba(0,0,0,.55); }
.nw-btn.wide { flex-direction: row; }
.nw-btn .k { font-size: max(8px, calc(9px * var(--scale))); color: var(--ink-dim); }
.nw-btn.primary { box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.5), inset 0 0 18px rgba(0,0,0,.38), 0 3px 14px rgba(0,0,0,.5); }
.nw-btn.primary:hover { box-shadow: inset 0 0 0 1px var(--metal-hi), inset 0 0 0 2px rgba(0,0,0,.42), inset 0 0 20px rgba(0,0,0,.35), 0 3px 16px rgba(0,0,0,.55), 0 0 8px rgba(216,166,72,.15); }
.nw-btn.disabled { opacity: .4; pointer-events: none; }

/* button icon — rendered at body size so emoji are legible */
.nw-btn-icon { font-size: max(14px, calc(16px * var(--scale))); font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif; line-height: 1; }
.nw-btn-label { font-family: var(--font-display); font-size: max(8px, calc(9px * var(--scale))); letter-spacing: 1px; line-height: 1.2; }

/* ---- action bar sockets (Diablo-style, scoped to .nw-actions only) ---- */
.nw-actions .nw-btn {
  /* socket: recessed square well */
  width: max(38px, calc(44px * var(--scale)));
  height: max(38px, calc(44px * var(--scale)));
  min-width: 0;
  display: grid; place-items: center;
  padding: 0;
  background: radial-gradient(circle at 50% 32%, #1b1510, #0d0a07 78%);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0,0,0,.65);
  gap: 0;
}
.nw-actions .nw-btn:hover {
  box-shadow: inset 0 0 0 1px var(--metal), 0 0 8px rgba(216,166,72,.25);
  background: radial-gradient(circle at 50% 32%, #241c14, #100d08 78%);
}
.nw-actions .nw-btn:active { transform: translateY(1px); background: #0d0a07; }
.nw-actions .nw-btn.hot {
  box-shadow: inset 0 0 0 1px var(--metal), 0 0 8px rgba(216,166,72,.25);
}
.nw-actions .nw-btn.primary {
  width: max(44px, calc(50px * var(--scale)));
  height: max(44px, calc(50px * var(--scale)));
  box-shadow: inset 0 0 0 1px var(--metal), 0 0 10px rgba(216,166,72,.3);
}
.nw-actions .nw-btn.primary:hover {
  box-shadow: inset 0 0 0 1px var(--metal-hi), 0 0 14px rgba(216,166,72,.45);
}

/* action-bar icon — muted toward bronze */
.nw-actions .nw-btn-icon {
  font-size: max(16px, calc(20px * var(--scale)));
  filter: sepia(.35) saturate(.75) brightness(.9);
}
/* label hidden in socket (DOM node kept — Gauntlet reads it) */
.nw-actions .nw-btn-label { display: none; }
/* keybind — corner tag */
.nw-actions .nw-btn .k {
  position: absolute; bottom: 1px; right: 2px;
  font-size: max(7px, calc(8px * var(--scale)));
  font-family: var(--font-display);
  color: var(--ink-dim);
  text-shadow: 0 1px 2px #000;
  letter-spacing: 1px;
}
.nw-actions .nw-btn { position: relative; }

/* ---- build placement banner ---- */
.nw-buildbar {
  position: absolute; left: 50%; bottom: calc(88px * var(--scale)); transform: translateX(-50%);
  display: none; align-items: center; gap: calc(12px * var(--scale));
  /* plaque */
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.05), transparent 55%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.55), inset 0 0 22px rgba(0,0,0,.45), 0 4px 18px rgba(0,0,0,.55);
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
.nw-buildbar .nm { font-family: var(--font-display); font-size: calc(12px * var(--scale)); color: var(--ink-bright); font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
.nw-buildbar .hint { font-size: calc(11px * var(--scale)); color: var(--ink-dim); }
.nw-buildbar .cancel { min-width: 0; padding: calc(6px * var(--scale)) calc(12px * var(--scale)); color: var(--bad); }
.nw-buildbar .cancel:hover { background: #1c100c; }
@keyframes nw-buildpulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* ---- panels ---- */
.nw-scrim {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 45%, rgba(10,6,3,.6), rgba(3,2,1,.88));
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center; padding: calc(12px * var(--scale));
}
.nw-panel {
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.05), transparent 55%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 0 0 2px rgba(0,0,0,.55),
    inset 0 0 22px rgba(0,0,0,.45), 0 4px 18px rgba(0,0,0,.55);
  color: var(--ink);
  width: min(560px, 96vw); max-height: 86dvh;
  display: flex; flex-direction: column; overflow: hidden;
  position: relative;
}
/* corner brackets */
.nw-panel::before, .nw-panel::after {
  content: ''; position: absolute; width: 9px; height: 9px; pointer-events: none; z-index: 10;
}
.nw-panel::before { top: 3px; left: 3px;
  border-top: 2px solid var(--metal-hi); border-left: 2px solid var(--metal-hi); }
.nw-panel::after { bottom: 3px; right: 3px;
  border-bottom: 2px solid var(--metal-hi); border-right: 2px solid var(--metal-hi); }

.nw-phead { position: relative; display: flex; align-items: center; gap: calc(8px * var(--scale));
  padding: calc(12px * var(--scale)) calc(14px * var(--scale)) calc(10px * var(--scale));
  border-bottom: none; }
/* fading gold rule under header */
.nw-phead::after { content: ''; position: absolute; left: 8%; right: 8%; bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--metal-hi), transparent); }
.nw-phead h2 { margin: 0; font-family: var(--font-display); font-size: max(12px, calc(14px * var(--scale)));
  color: var(--accent); font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; }
.nw-tabs { display: flex; gap: calc(4px * var(--scale)); margin-left: calc(4px * var(--scale)); }
.nw-tab { padding: calc(5px * var(--scale)) calc(10px * var(--scale)); font-family: var(--font-display);
  font-size: calc(11px * var(--scale)); color: var(--ink-dim); border: 1px solid transparent; border-radius: 3px; cursor: pointer;
  letter-spacing: 2px; text-transform: uppercase; }
.nw-tab.on { color: var(--accent); border-color: var(--metal-lo); background: var(--bg-lift); }
.nw-x { margin-left: auto; font-size: calc(18px * var(--scale)); color: var(--ink-dim);
  width: calc(30px * var(--scale)); height: calc(30px * var(--scale)); display: grid; place-items: center;
  border-radius: 3px; cursor: pointer; }
.nw-x:hover { background: var(--bg-lift); color: var(--ink); }
.nw-pbody { padding: calc(12px * var(--scale)) calc(14px * var(--scale)); overflow-y: auto; }

/* ---- item grid ---- */
.nw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 8px; }
.nw-cell { position: relative; aspect-ratio: 1;
  background: radial-gradient(circle at 50% 32%, #1b1510, #0d0a07 78%);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0,0,0,.65);
  display: grid; place-items: center; cursor: pointer; }
.nw-cell:hover { box-shadow: inset 0 0 0 1px var(--metal), 0 0 8px rgba(216,166,72,.25); }
.nw-cell img { width: 82%; height: 82%; image-rendering: pixelated; }
.nw-cell .n { position: absolute; right: 3px; bottom: 1px; font-size: 11px;
  color: var(--ink-bright); }
.nw-cell .tag { position: absolute; left: 3px; top: 2px; font-size: 9px;
  color: var(--gold); }
.nw-cell .tag.feed { color: #88ccff; }
.nw-empty { color: var(--ink-dim); padding: 18px; text-align: center; }

/* ---- W7: soul-feed slot picker ---- */
.nw-feed-picker {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: var(--bg-base);
  border: 1px solid var(--metal);
  border-radius: 4px;
  box-shadow: 0 0 24px rgba(0,0,0,.8), inset 0 0 0 1px var(--metal-lo);
  padding: 12px;
  z-index: 200;
  min-width: 220px;
  max-width: 280px;
}
.nw-feed-hd {
  font-family: var(--font-display); font-size: 11px; letter-spacing: 1px;
  color: var(--ink-bright); text-align: center; margin-bottom: 8px;
  padding-bottom: 8px; border-bottom: 1px solid var(--metal-lo);
}
.nw-feed-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border-radius: 3px; cursor: pointer; font-size: 12px; color: var(--ink);
  margin-bottom: 3px;
}
.nw-feed-row:hover { background: var(--bg-lift); color: var(--ink-bright); }
.nw-feed-row.affinity { box-shadow: inset 0 0 0 1px #88ccff44; color: #aaddff; }
.nw-feed-row.opposed { box-shadow: inset 0 0 0 1px #cc444444; color: #cc8888; }
.nw-feed-lv { font-size: 10px; color: var(--ink-dim); margin-left: auto; }
.nw-feed-aff { font-size: 9px; color: var(--gold); }
.nw-feed-cancel {
  text-align: center; padding: 6px; margin-top: 6px;
  border-top: 1px solid var(--metal-lo); cursor: pointer;
  font-size: 11px; color: var(--ink-dim);
}
.nw-feed-cancel:hover { color: var(--ink-bright); }

/* ---- recipe / build list rows ---- */
.nw-row { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid #000; border-radius: 3px; margin-bottom: 8px;
  background: var(--bg-lift);
  box-shadow: inset 0 0 0 1px var(--metal-lo); }
.nw-row img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-row .info { flex: 1; min-width: 0; }
.nw-row .name { font-weight: 700; color: var(--ink-bright); }
.nw-row .sub { font-size: 11px; color: var(--ink-dim); margin-top: 2px; }
.nw-row .sub .have { color: var(--good); } .nw-row .sub .lack { color: var(--bad); }
.nw-make {
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 50%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 0 0 2px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4);
  color: var(--ink); padding: 8px 12px 10px;
  font-family: var(--font-display); font-size: 11px; letter-spacing: 1.5px;
  cursor: pointer;
  transition: background .12s, box-shadow .12s;
}
.nw-make:hover { background: linear-gradient(180deg, #1f1810, #14100b); box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.45), 0 2px 10px rgba(0,0,0,.5); }
.nw-make:active { background: #0e0b07; }
.nw-make:disabled { opacity: .45; cursor: default; }
.nw-make:disabled:hover { background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 50%), linear-gradient(180deg, #171209, #0e0b07); box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 0 0 2px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4); }
.nw-make.short { color: var(--bad); border-color: var(--bad); }
.nw-make.short:hover { background: #1c100c; }
.nw-locked { opacity: .5; }

/* ---- equipment (top of the bag) ---- */
.nw-equip { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.nw-slot { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid #000; border-radius: 3px; background: var(--bg-lift);
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0,0,0,.65);
  min-height: 56px; cursor: pointer; }
.nw-slot:hover { box-shadow: inset 0 0 0 1px var(--metal), 0 0 8px rgba(216,166,72,.25); }
.nw-slot.filled { box-shadow: inset 0 0 0 1px var(--metal), inset 0 2px 6px rgba(0,0,0,.5); }
.nw-slot img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-slot .ph { width: 34px; height: 34px; display: grid; place-items: center;
  font-size: 20px; color: var(--ink-dim); border: 2px dashed #ffffff18; border-radius: 3px; }
.nw-slot .meta { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.nw-slot .meta b { font-size: 10px; letter-spacing: 1.5px; color: var(--ink-dim); text-transform: uppercase; font-family: var(--font-display); }
.nw-slot .meta .stat { font-size: 11px; color: var(--good); }
.nw-slot .meta .off { font-size: 12px; color: var(--ink-dim); }
.nw-soullv { font-size: 10px; color: #c9a0dc; letter-spacing: .5px; }
.nw-soulbar { width: 100%; height: 5px; background: var(--bg-deep);
  border: 1px solid #000; border-radius: 3px; overflow: hidden; margin: 1px 0;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.5); }
.nw-soulfill { height: 100%; background: #a97cc4; }
.nw-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--ink-dim); padding: 4px 2px 12px; }
.nw-tools .hd { color: var(--ink-dim); letter-spacing: 1px; text-transform: uppercase; font-size: 10px; }
.nw-cell.worn { box-shadow: inset 0 0 0 2px var(--good); }
.nw-cell .tag.on { color: #05060a; background: var(--good); padding: 0 3px; left: 2px; top: 2px; border-radius: 2px; }

/* ---- skills ---- */
.nw-note { font-size: 12px; color: var(--ink-dim); line-height: 1.5; margin-bottom: 12px;
  padding: 8px 10px; background: var(--bg-lift); border: 1px solid #000; border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo); }
.nw-note b { color: var(--ink); }
.nw-skill { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nw-skill .lv { display: flex; flex-direction: column; align-items: center; min-width: 34px; }
.nw-skill .lv b { font-family: var(--font-display); font-size: 15px; color: var(--gold); font-weight: 700; line-height: 1.2; letter-spacing: 1px; }
.nw-skill .lv i { font-size: 9px; font-style: normal; letter-spacing: 1px; color: var(--ink-dim); }
.nw-skill .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.nw-skill .nm { display: flex; align-items: center; gap: 8px; color: var(--ink-bright); }
.nw-skill .kind { font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
  padding: 1px 6px; border: 1px solid transparent; border-radius: 3px; }
.nw-skill .kind.gather { color: #8fd05a; border-color: #8fd05a55; }
.nw-skill .kind.craft { color: #7fb8e6; border-color: #7fb8e655; }
.nw-skill .kind.combat { color: #e07a7a; border-color: #e07a7a55; }
.nw-skill .xp { font-size: 11px; color: var(--ink-dim); min-width: 74px; text-align: right; }
.nw-xpbar { height: 9px; background: var(--bg-deep); overflow: hidden;
  border: 1px solid #000; border-radius: 3px; box-shadow: inset 0 1px 2px rgba(0,0,0,.5); }
.nw-xpfill { height: 100%; background: #5a8fc0; }

/* ---- event log ---- */
.nw-logrow { display: flex; align-items: baseline; gap: 8px; padding: 5px 6px;
  border-bottom: 1px solid #000; box-shadow: inset 0 -1px 0 var(--metal-lo); font-size: 12px; }
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
/* mono abbreviation badges (Lens-feed only — ui.ts emits net-abbr, not res-abbr) */
.nw-logm .net-abbr {
  display: inline-block;
  font-family: ui-monospace, 'Consolas', 'Courier New', monospace;
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
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 50%),
    linear-gradient(180deg, #171209, #0e0b07);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 0 0 2px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.45);
  padding: calc(6px * var(--scale)) calc(14px * var(--scale)); font-size: calc(12px * var(--scale)); color: var(--ink);
  animation: nw-pop .25s ease; max-width: 92vw; text-align: center;
}
.nw-toast.good { color: #d9f6c2; border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good), inset 0 0 0 2px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.45); }
.nw-toast.bad { color: #f6d2d2; border-color: var(--bad); box-shadow: inset 0 0 0 1px var(--bad), inset 0 0 0 2px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.45); }
@keyframes nw-pop { from { transform: translateY(-8px); opacity: 0; } }

/* ---- W6: leaderboard panel ---- */
.nw-lb-cur { margin-bottom: 18px; }
.nw-lb-hist { border-top: 1px solid var(--metal-lo); padding-top: 14px; }
.nw-lb-sechd {
  font-family: var(--font-display); font-size: max(10px, calc(11px * var(--scale)));
  color: var(--accent); letter-spacing: 2px; text-transform: uppercase;
  margin-bottom: 10px; font-weight: 700;
}
.nw-lb-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.nw-lb-stat {
  background: radial-gradient(circle at 50% 32%, #1b1510, #0d0a07 78%);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0,0,0,.65);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 6px;
}
.nw-lb-val { font-family: var(--font-display); font-size: max(12px, calc(14px * var(--scale))); color: var(--ink-bright); font-weight: 700; }
.nw-lb-lbl { font-size: max(8px, calc(9px * var(--scale))); color: var(--ink-dim); text-transform: uppercase; letter-spacing: 1px; }
.nw-lb-list { display: flex; flex-direction: column; gap: 3px; }
.nw-lb-row {
  display: flex; align-items: center; gap: 10px; padding: 6px 8px;
  background: radial-gradient(circle at 50% 32%, #1b1510, #0d0a07 78%);
  border: 1px solid #000;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal-lo), inset 0 2px 6px rgba(0,0,0,.65);
}
.nw-lb-row:first-child { box-shadow: inset 0 0 0 1px var(--metal-hi), inset 0 2px 8px rgba(0,0,0,.5), 0 0 8px rgba(216,166,72,.15); }
.nw-lb-row.cheat { opacity: .55; filter: grayscale(.4); }
.nw-lb-rank { font-size: max(13px, calc(15px * var(--scale))); min-width: 32px; text-align: center; color: var(--gold); }
.nw-lb-score { font-family: var(--font-display); font-size: max(12px, calc(13px * var(--scale))); color: var(--accent); font-weight: 700; min-width: 52px; }
.nw-lb-age { font-family: var(--font-display); font-size: max(11px, calc(12px * var(--scale))); color: var(--ink-bright); font-weight: 700; min-width: 70px; }
.nw-lb-detail { flex: 1; font-size: max(9px, calc(10px * var(--scale))); color: var(--ink-dim); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-lb-realm { font-size: max(9px, calc(10px * var(--scale))); color: var(--metal-hi); text-align: right; }
.nw-lb-cheat, .cheat i { color: var(--bad); font-style: italic; }

/* ---- game over ---- */
.nw-gameover { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; text-align: center;
  background: radial-gradient(ellipse at center, rgba(20,8,4,.9), rgba(5,2,1,.97)); pointer-events: auto; }
.nw-gameover h1 { font-family: var(--font-display); font-size: max(24px, calc(30px * var(--scale))); color: #b3261a;
  font-weight: 700; margin: 0; letter-spacing: 6px; text-transform: uppercase;
  text-shadow: 0 0 24px rgba(180,40,20,.5); }
.nw-gameover .nw-btn.primary {
  display: inline-flex; flex-direction: row; gap: 6px;
  background: radial-gradient(130% 100% at 50% 0%, rgba(255,214,150,.04), transparent 55%),
    linear-gradient(180deg, #1a130c, #0e0b07);
  border: 1px solid var(--metal);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px var(--metal), inset 0 0 0 2px rgba(0,0,0,.5), 0 4px 18px rgba(0,0,0,.55);
  color: var(--accent);
  font-family: var(--font-display);
  padding: 10px 24px 12px;
  font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
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
[data-touch] .nw-actions .nw-btn {
  width: max(48px, calc(52px * var(--scale)));
  height: max(48px, calc(52px * var(--scale)));
  min-width: 0;
  justify-content: center;
}
[data-touch] .nw-actions .nw-btn .k { display: none; }
[data-touch] .nw-actions .nw-btn.primary {
  width: max(56px, calc(64px * var(--scale)));
  height: max(56px, calc(64px * var(--scale)));
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

/* ---- mobile / narrow viewport overlap protection ---- */
/* Panels: ensure they don't overflow the viewport and are scrollable */
@media (max-width: 600px), (max-height: 500px) {
  .nw-panel {
    width: 100vw;
    max-height: 80dvh;
    margin: 0 2vw;
  }
  .nw-scrim {
    align-items: flex-start;
    padding-top: calc(8px * var(--scale) + env(safe-area-inset-top));
    padding-bottom: calc(70px * var(--scale) + env(safe-area-inset-bottom));
  }
  .nw-pbody {
    max-height: 60dvh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* equip grid: single column on narrow screens */
  .nw-equip {
    grid-template-columns: 1fr;
  }
  /* item grid: fewer columns, bigger tap targets */
  .nw-grid {
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 6px;
  }
  /* build bar: don't overlap gather bar or action bar */
  .nw-buildbar {
    bottom: calc(100px * var(--scale));
    max-width: 98vw;
    padding: calc(6px * var(--scale)) calc(8px * var(--scale));
  }
  .nw-buildbar .nm { font-size: calc(10px * var(--scale)); }
  .nw-buildbar .hint { display: none; }
  /* gather bar: move up to avoid action bar overlap */
  .nw-gather {
    bottom: calc(110px * var(--scale));
  }
  /* top badges: tighter */
  .nw-top {
    gap: calc(3px * var(--scale));
    padding: calc(4px * var(--scale) + env(safe-area-inset-top)) calc(6px * var(--scale)) calc(4px * var(--scale));
  }
  .nw-badge {
    padding: calc(3px * var(--scale)) calc(5px * var(--scale));
  }
  /* game over overlay: scrollable on small screens */
  .nw-gameover {
    overflow-y: auto;
    padding: 20px 12px;
    justify-content: flex-start;
    padding-top: 10vh;
  }
  /* toasts: narrower, not covering vital HUD */
  .nw-toasts {
    top: calc(40px * var(--scale));
  }
  .nw-toast {
    max-width: 88vw;
    font-size: calc(10px * var(--scale));
    padding: calc(4px * var(--scale)) calc(10px * var(--scale));
  }
}
`;
