// All UI chrome in one injected stylesheet. Kept together so the look is
// tunable in one place; uses CSS variables for the palette.
export function injectStyles() {
  if (document.getElementById('nw-styles')) return;
  const el = document.createElement('style');
  el.id = 'nw-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const CSS = `
:root {
  --ink: #dfe6f0;
  --ink-dim: #8fa0b8;
  --panel: rgba(14, 26, 44, 0.92);
  --panel-edge: #3b6ea4;
  --glow: #3b82c4;
  --good: #8fd05a;
  --bad: #e07a7a;
  --gold: #e6c86e;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
#hud { font-size: 13px; }

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
  background: var(--panel); border: 1px solid var(--panel-edge);
  border-radius: 8px; padding: 5px 9px; backdrop-filter: blur(5px);
  white-space: nowrap;
}
.nw-title { font-weight: 700; letter-spacing: 3px; color: #f4f7fc;
  text-shadow: 0 0 8px var(--glow); }
.nw-hpwrap { min-width: 108px; }
.nw-hpbar { position: relative; width: 88px; height: 9px; border-radius: 5px;
  background: #3a1420; overflow: hidden; }
.nw-hpfill { position: absolute; inset: 0; width: 100%;
  background: linear-gradient(90deg, #d05a5a, #8fd05a); transition: width .2s; }
.nw-gold { color: var(--gold); font-weight: 700; }
.nw-clock .sun { color: var(--gold); } .nw-clock .moon { color: #a9b6e6; }
.nw-domain .dn { color: #c9b6e6; } .nw-domain .dg { color: #e07a7a; letter-spacing: 1px; }
.nw-domain { max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
.nw-spacer { margin-left: auto; }

/* ---- gather progress ring (center-bottom of screen) ---- */
.nw-gather {
  position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%);
  display: none; flex-direction: column; align-items: center; gap: 4px;
  pointer-events: none; text-shadow: 0 1px 3px #000;
}
.nw-gather.on { display: flex; }
.nw-gbar { width: 120px; height: 8px; border-radius: 5px; background: #0d1a2c;
  border: 1px solid var(--panel-edge); overflow: hidden; }
.nw-gfill { height: 100%; width: 0; background: var(--good); }

/* ---- bottom action bar ---- */
.nw-actions {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center; gap: 8px;
  padding: 8px 10px calc(10px + env(safe-area-inset-bottom));
  pointer-events: none; flex-wrap: wrap;
}
.nw-btn {
  pointer-events: auto; cursor: pointer;
  background: var(--panel); border: 1px solid var(--panel-edge);
  color: var(--ink); border-radius: 10px; padding: 9px 12px;
  font: inherit; font-size: 12px; letter-spacing: .5px;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  min-width: 62px; backdrop-filter: blur(5px); user-select: none;
}
.nw-btn:hover { border-color: var(--glow); box-shadow: 0 0 12px #3b82c455; }
.nw-btn:active { transform: translateY(1px); }
.nw-btn.hot { border-color: var(--glow); box-shadow: 0 0 14px #3b82c477; }
.nw-btn.wide { flex-direction: row; }
.nw-btn .k { font-size: 10px; color: var(--ink-dim); }
.nw-btn.primary { background: #1c4a2e; border-color: var(--good); }
.nw-btn.disabled { opacity: .4; pointer-events: none; }

/* ---- build placement banner ---- */
.nw-buildbar {
  position: absolute; left: 50%; bottom: 88px; transform: translateX(-50%);
  display: none; align-items: center; gap: 12px;
  background: var(--panel); border: 1px solid var(--good); border-radius: 12px;
  padding: 8px 10px 8px 12px; backdrop-filter: blur(5px); pointer-events: auto;
  box-shadow: 0 0 22px #8fd05a44; max-width: 94vw;
}
.nw-buildbar.on { display: flex; animation: nw-buildpulse 1.1s ease-in-out infinite; }
.nw-buildbar .ico { font-size: 18px; color: var(--good); }
.nw-buildbar .txt { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
.nw-buildbar .nm { color: #f4f7fc; font-weight: 600; }
.nw-buildbar .hint { font-size: 11px; color: var(--ink-dim); }
.nw-buildbar .cancel { min-width: 0; padding: 6px 12px; border-color: var(--bad); }
@keyframes nw-buildpulse {
  0%, 100% { box-shadow: 0 0 22px #8fd05a44; border-color: var(--good); }
  50% { box-shadow: 0 0 34px #8fd05a99; border-color: #c8f0a8; }
}

/* ---- panels ---- */
.nw-scrim {
  position: absolute; inset: 0; background: rgba(4, 10, 20, .55);
  backdrop-filter: blur(2px); pointer-events: auto;
  display: flex; align-items: center; justify-content: center; padding: 12px;
}
.nw-panel {
  background: var(--panel); border: 1px solid var(--panel-edge);
  border-radius: 14px; width: min(560px, 96vw); max-height: 86vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 48px #000a, 0 0 40px #3b82c433;
}
.nw-phead { display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid #ffffff18; }
.nw-phead h2 { margin: 0; font-size: 15px; letter-spacing: 2px; color: #f4f7fc; }
.nw-tabs { display: flex; gap: 4px; margin-left: 4px; }
.nw-tab { cursor: pointer; padding: 4px 10px; border-radius: 8px; font-size: 12px;
  color: var(--ink-dim); border: 1px solid transparent; }
.nw-tab.on { color: var(--ink); border-color: var(--panel-edge); background: #ffffff10; }
.nw-x { margin-left: auto; cursor: pointer; font-size: 18px; color: var(--ink-dim);
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; }
.nw-x:hover { background: #ffffff14; color: var(--ink); }
.nw-pbody { padding: 12px 14px; overflow-y: auto; }

/* ---- item grid ---- */
.nw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 8px; }
.nw-cell { position: relative; aspect-ratio: 1; background: #0d1a2c;
  border: 1px solid #ffffff14; border-radius: 8px; display: grid; place-items: center; }
.nw-cell img { width: 82%; height: 82%; image-rendering: pixelated; }
.nw-cell .n { position: absolute; right: 3px; bottom: 1px; font-size: 11px;
  color: #fff; text-shadow: 0 1px 2px #000, 0 0 2px #000; }
.nw-cell .tag { position: absolute; left: 3px; top: 2px; font-size: 9px;
  color: var(--gold); }
.nw-empty { color: var(--ink-dim); padding: 18px; text-align: center; }

/* ---- recipe / build list rows ---- */
.nw-row { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid #ffffff12; border-radius: 10px; margin-bottom: 8px; background: #0d1a2c88; }
.nw-row img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-row .info { flex: 1; min-width: 0; }
.nw-row .name { font-weight: 600; }
.nw-row .sub { font-size: 11px; color: var(--ink-dim); margin-top: 2px; }
.nw-row .sub .have { color: var(--good); } .nw-row .sub .lack { color: var(--bad); }
.nw-make { cursor: pointer; background: #1c4a2e; border: 1px solid var(--good);
  color: var(--ink); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12px; }
.nw-make:disabled { background: #223; border-color: #445; color: #667; cursor: default; }
.nw-make.short { background: #3a2330; border-color: var(--bad); color: #f0c9c9; }
.nw-locked { opacity: .5; }

/* ---- equipment (top of the bag) ---- */
.nw-equip { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.nw-slot { display: flex; align-items: center; gap: 10px; padding: 8px;
  border: 1px solid #ffffff14; border-radius: 10px; background: #0d1a2c88; min-height: 56px; }
.nw-slot.filled { border-color: var(--panel-edge); }
.nw-slot img { width: 34px; height: 34px; image-rendering: pixelated; }
.nw-slot .ph { width: 34px; height: 34px; display: grid; place-items: center;
  font-size: 20px; color: var(--ink-dim); border: 1px dashed #ffffff20; border-radius: 8px; }
.nw-slot .meta { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.nw-slot .meta b { font-size: 10px; letter-spacing: 1px; color: var(--ink-dim); text-transform: uppercase; }
.nw-slot .meta .stat { font-size: 11px; color: var(--good); }
.nw-slot .meta .off { font-size: 12px; color: #5a6b82; }
.nw-soullv { font-size: 10px; color: #c9a0dc; letter-spacing: .5px; }
.nw-soulbar { width: 100%; height: 4px; border-radius: 3px; background: #0d1a2c;
  border: 1px solid #ffffff14; overflow: hidden; margin: 1px 0; }
.nw-soulfill { height: 100%; background: linear-gradient(90deg, #6b4a7a, #c9a0dc); }
.nw-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  font-size: 12px; color: var(--ink-dim); padding: 4px 2px 12px; }
.nw-tools .hd { color: #5a6b82; letter-spacing: 1px; text-transform: uppercase; font-size: 10px; }
.nw-cell.worn { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
.nw-cell .tag.on { color: #05060a; background: var(--good); border-radius: 4px; padding: 0 3px; left: 2px; top: 2px; }

/* ---- skills ---- */
.nw-note { font-size: 12px; color: var(--ink-dim); line-height: 1.5; margin-bottom: 12px;
  padding: 8px 10px; background: #0d1a2c88; border: 1px solid #ffffff12; border-radius: 8px; }
.nw-note b { color: var(--ink); }
.nw-skill { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.nw-skill .lv { display: flex; flex-direction: column; align-items: center; min-width: 34px; }
.nw-skill .lv b { font-size: 18px; font-weight: 800; color: var(--gold); line-height: 1; }
.nw-skill .lv i { font-size: 9px; font-style: normal; letter-spacing: 1px; color: var(--ink-dim); }
.nw-skill .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.nw-skill .nm { display: flex; align-items: center; gap: 8px; }
.nw-skill .kind { font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
  padding: 1px 6px; border-radius: 6px; border: 1px solid transparent; }
.nw-skill .kind.gather { color: #8fd05a; border-color: #8fd05a55; }
.nw-skill .kind.craft { color: #7fb8e6; border-color: #7fb8e655; }
.nw-skill .kind.combat { color: #e07a7a; border-color: #e07a7a55; }
.nw-skill .xp { font-size: 11px; color: var(--ink-dim); min-width: 74px; text-align: right; }
.nw-xpbar { height: 8px; background: #0d1a2c; border-radius: 5px; overflow: hidden;
  border: 1px solid #ffffff12; }
.nw-xpfill { height: 100%; background: linear-gradient(90deg, var(--glow), #7fb8e6); }

/* ---- event log ---- */
.nw-logrow { display: flex; align-items: baseline; gap: 8px; padding: 5px 6px;
  border-bottom: 1px solid #ffffff0c; font-size: 12px; }
.nw-logt { color: #5a6b82; font-variant-numeric: tabular-nums; font-size: 11px; min-width: 34px; }
.nw-logk { font-size: 9px; letter-spacing: .5px; text-transform: uppercase; min-width: 56px;
  color: var(--ink-dim); }
.nw-logm { flex: 1; color: var(--ink); }
.nw-log-combat .nw-logk, .nw-log-death .nw-logk { color: var(--bad); }
.nw-log-boss .nw-logk { color: #e0a13f; }
.nw-log-level .nw-logk, .nw-log-economy .nw-logk { color: var(--gold); }
.nw-log-gather .nw-logk, .nw-log-craft .nw-logk, .nw-log-build .nw-logk { color: var(--good); }
.nw-log-region .nw-logk { color: #c9b6e6; }

/* ---- toasts ---- */
.nw-toasts { position: absolute; left: 50%; top: 54px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
.nw-toast { background: var(--panel); border: 1px solid var(--panel-edge);
  border-radius: 20px; padding: 6px 14px; font-size: 12px; color: var(--ink);
  animation: nw-pop .25s ease; max-width: 92vw; text-align: center; }
.nw-toast.good { border-color: var(--good); color: #d9f6c2; }
.nw-toast.bad { border-color: var(--bad); color: #f6d2d2; }
@keyframes nw-pop { from { transform: translateY(-8px); opacity: 0; } }

/* ---- game over ---- */
.nw-gameover { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; text-align: center;
  background: radial-gradient(circle, #2a0d18cc, #05060acc); pointer-events: auto; }
.nw-gameover h1 { font-size: 30px; letter-spacing: 6px; color: #e07a7a;
  text-shadow: 0 0 20px #e07a7a55; margin: 0; }

@media (max-width: 520px) {
  .nw-title { display: none; }
  .nw-btn { min-width: 54px; padding: 8px 9px; }
}
`;
