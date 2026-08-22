// Gate screenshots for the 2026-08-22 balance batch.
//
// Four surfaces changed that a regression assertion cannot look at: the coin
// pile on the ground, the Scrying readout under the radar, the split Omen/Boon
// badge rows, and the Reliquary's greyed shelf ladder. Raw CDP like
// scripts/run-gauntlet.mjs and scripts/shots.mjs -- no npm deps, no playwright.
//
// Two deliberate differences from scripts/shots.mjs:
//   * it launches with its OWN throwaway --user-data-dir, so it cannot touch a
//     Chrome profile that is open on this machine
//   * it drives the game through __nw's real verbs (drops.awardGold,
//     omens.consider, mods.effects.grantBoon, ui.open) rather than by writing
//     display state, so what is photographed is what the game produces
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CDP_PORT = 9224;
const OUT = 'qa/gate-balance-0822';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = 'http://localhost:5199/?gl&seed=1234';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-shots-'));

function toText(ev) {
  const d = ev?.data !== undefined ? ev.data : ev;
  if (typeof d === 'string') return d;
  if (Buffer.isBuffer(d)) return d.toString('utf8');
  if (d instanceof ArrayBuffer) return new TextDecoder().decode(d);
  if (ArrayBuffer.isView(d)) return new TextDecoder().decode(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  return String(d);
}
function recv(ws) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('CDP timeout')), 30000);
    const h = (ev) => { clearTimeout(to); ws.removeEventListener('message', h); res(JSON.parse(toText(ev))); };
    ws.addEventListener('message', h);
  });
}
async function call(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  let r; do { r = await recv(ws); } while (r.id !== id);
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

fs.mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox',
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--disable-software-rasterizer', '--window-size=1280,760', URL_BASE,
], { stdio: 'ignore' });

let code = 1;
const notes = {};
try {
  await new Promise(r => setTimeout(r, 3500));
  const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = pages.find(p => p.url.includes('localhost:5199'));
  if (!page) throw new Error('no game page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws: ' + e.message)); });
  let id = 0;
  const ev = async (expr, awaitPromise = false) => {
    const { result, exceptionDetails } = await call(ws, ++id, 'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise });
    if (exceptionDetails) {
      throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'eval failed').split('\n')[0]);
    }
    return result.value;
  };

  await call(ws, ++id, 'Page.enable');
  await call(ws, ++id, 'Runtime.enable');
  for (let i = 0; i < 120; i++) {
    if (await ev('typeof window.__nw !== "undefined" && !!__nw.state')) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const shot = async (name) => {
    const { data } = await call(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('  📸', name);
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------------- B5 Q2: the coin pile ----------------
  // Through awardGold(), the same seam a boss kill uses, so what is photographed
  // is what a boss actually produces -- number of coins, spread and all.
  notes.bossBurst = await ev(`(() => {
    const nw = __nw, s = nw.state;
    s.god = true;
    s.drops.length = 0;
    const before = s.player.gold;
    nw.sys.drops.awardGold(240, nw.player.x + 26, nw.player.y - 16, true);
    return { rows: s.drops.length, onFloor: s.drops.reduce((t, d) => t + d.n, 0),
             credited: s.player.gold - before };
  })()`);
  await wait(220); await shot('gold-01-burst');
  await wait(1600); await shot('gold-02-settled-and-on-the-radar');

  // The contrast case: a routine kill's award leaves nothing to walk to.
  notes.routineAward = await ev(`(() => {
    const nw = __nw, s = nw.state;
    s.drops.length = 0;
    const before = s.player.gold;
    nw.sys.drops.awardGold(37, nw.player.x + 26, nw.player.y, false);
    return { rows: s.drops.length, credited: s.player.gold - before };
  })()`);
  await wait(400); await shot('gold-03-routine-kill-credits-instead');

  // ---------------- N4.4: the Scrying readout ----------------
  // Three states of the same line. The interesting thing about a readout is
  // that it MOVES -- one pinned at a single value is a label, not a reading.
  const scry = async (dns, tag) => {
    notes['scrying_' + tag] = await ev(`(() => {
      const nw = __nw;
      nw.state.drops.length = 0;
      nw.sys.net.snap.dnsMedianMs = ${dns};
      const sight = nw.sys.net.getGameValue('scrying');
      // lastT is the 10 Hz throttle inside draw(); reset it so the redraw is
      // not silently swallowed by the rate limit on a paused headless page.
      nw.minimap.lastT = -1e9;
      nw.minimap.draw(nw.state, performance.now(), nw.sys.hordes.foes, sight);
      return +sight.toFixed(3);
    })()`);
    await wait(260); await shot('scrying-' + tag);
  };
  await scry(25, '01-sharp-25ms');
  await scry(50, '02-neutral-50ms');
  await scry(70, '03-poor-70ms');
  await ev(`(() => { __nw.sys.net.snap.dnsMedianMs = 50; return 1; })()`);

  // ---------------- A8/N4.3: the split badge rows ----------------
  // Omens through consider(), which is the same call the Chronicle makes when a
  // real step lands on the wire. Boons through grantBoon(), the Wardstone's own
  // verb. Neither row is hand-written HTML.
  notes.badgeRows = await ev(`(() => {
    const nw = __nw, t = nw.state.clock;
    nw.omens.active.length = 0;
    nw.omens.consider({ t, key: 'flow',  label: 'flow',  dir: 'down', from: 20, to: 5,  sigma: -6 });
    nw.omens.consider({ t, key: 'pulse', label: 'pulse', dir: 'down', from: 90, to: 22, sigma: -5 });
    const fx = nw.mods.effects;
    nw.state.boons = nw.state.boons || [];
    nw.state.boons.length = 0;
    fx.grantBoon(nw.state, { id: 'ember_ward', name: 'Ember Ward',
      blurb: 'the stone breathes fire — it clings to you',
      effects: ['fire_aura'], color: '#e8844a', sec: 95 });
    fx.grantBoon(nw.state, { id: 'rime_ward', name: 'Rime Ward',
      blurb: 'the cold pours off you — what comes near slows',
      effects: ['chill_aura'], color: '#a9c8ea', sec: 95 });
    nw.ui.refresh();
    const o = document.getElementById('nw-omens'), b = document.getElementById('nw-boons');
    return { omenRow: o && o.textContent.trim(), boonRow: b && b.textContent.trim(),
             omenShown: o && o.style.display !== 'none', boonShown: b && b.style.display !== 'none' };
  })()`);
  await wait(450); await shot('hud-01-omen-row-and-boon-row');

  // The control a screenshot can show: with the boons lifted the second row is
  // not an empty gap in the HUD, it is gone.
  notes.badgeRowsAfterLift = await ev(`(() => {
    const nw = __nw;
    nw.state.boons.length = 0;
    nw.ui.refresh();
    const o = document.getElementById('nw-omens'), b = document.getElementById('nw-boons');
    return { omenShown: o && o.style.display !== 'none', boonShown: b && b.style.display !== 'none' };
  })()`);
  await wait(320); await shot('hud-02-boons-lifted-row-gone');
  await ev(`(() => { __nw.omens.active.length = 0; __nw.ui.refresh(); return 1; })()`);

  // ---------------- A6: the greyed shelf ladder ----------------
  // All three seals render in one panel, so one shot per slot shows the whole
  // comparison: the Lesser Seal's shelf runs the length of the ladder, the
  // Lord's Seal starts two thirds up it.
  const shelf = async (slot, tag) => {
    notes['shelf_' + tag] = await ev(`(() => {
      const nw = __nw, s = nw.state;
      s.drops.length = 0;
      s.buildings = s.buildings.filter((b) => b.type !== 'reliquary');
      const tx = Math.floor(nw.player.x / 32), ty = Math.floor(nw.player.y / 32);
      s.buildings.push({ uid: s.nextUid++, type: 'reliquary', tx, ty, hp: 240 });
      s.player.gold = 50000;
      nw.ui.hubSlot = '${slot}';
      nw.ui.open('reliquary');
      const rows = [...document.querySelectorAll('.nw-hub-stock')].map((el) => ({
        icons: el.querySelectorAll('img').length,
        greyed: el.querySelectorAll('img.off').length,
      }));
      return rows;
    })()`);
    await wait(500); await shot('shelf-' + tag);
  };
  await shelf('weapon', '01-weapons');
  await shelf('armor', '02-armour');
  await ev(`(__nw.ui.close(), 1)`);
  await wait(300);

  console.log('\nMEASURED:\n' + JSON.stringify(notes, null, 2));
  fs.writeFileSync(path.join(OUT, 'measured.json'), JSON.stringify(notes, null, 2));
  code = 0;
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  chrome.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
