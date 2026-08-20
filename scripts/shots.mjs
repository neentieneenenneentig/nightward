// Gate screenshots for the night build (B5 drops, B6 flourish, N4.2 Lens).
// Raw CDP like scripts/run-gauntlet.mjs — no npm deps, no playwright.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CDP_PORT = 9224;
const OUT = 'qa/gate-night-build';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = 'http://localhost:5199/?gl&seed=1234';

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
  '--disable-gpu', '--disable-software-rasterizer', '--window-size=1280,760', URL_BASE,
], { stdio: 'ignore' });

let code = 1;
try {
  await new Promise(r => setTimeout(r, 3500));
  const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = pages.find(p => p.url.includes('localhost:5199'));
  if (!page) throw new Error('no game page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws: ' + e.message)); });
  let id = 0;
  const ev = (expr, awaitPromise = false) => call(ws, ++id, 'Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise });

  await call(ws, ++id, 'Page.enable');
  await call(ws, ++id, 'Runtime.enable');
  for (let i = 0; i < 120; i++) {
    const { result } = await ev('typeof window.__nw !== "undefined" && !!__nw.state');
    if (result.value) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const shot = async (name) => {
    const { data } = await call(ws, ++id, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('  📸', name);
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---------------- B5: ground drops ----------------
  // Spawn a readable spread right in front of the player and let it settle,
  // then catch the same pile mid-magnet.
  await ev(`(() => {
    const nw = __nw, s = nw.state;
    s.god = true;
    s.drops.length = 0;
    const ids = ['log','plank','stone','ore_iron','berry','herb_sunleaf','charcoal','axe_flint'];
    for (let i = 0; i < ids.length; i++) {
      const a = (i / ids.length) * Math.PI * 2;
      nw.sys.drops.spawn([{ id: ids[i], n: 1 + (i % 4) }],
        nw.player.x + Math.cos(a) * 110, nw.player.y + Math.sin(a) * 70);
    }
    return s.drops.length;
  })()`);
  await wait(200); await shot('b5-01-toss');
  await wait(1400); await shot('b5-02-settled');

  // walk into the pile: the magnet should have visible work to do
  await ev(`(() => { const d = __nw.state.drops[0]; if (d) __nw.player.teleport(d.x - 40, d.y); return __nw.state.drops.length; })()`);
  await wait(120); await shot('b5-03-magnet');
  await wait(2500); await shot('b5-04-collected');

  // a real harvest, through the real path
  await ev(`(() => {
    const nw = __nw, s = nw.state;
    s.drops.length = 0;
    s.player.inv.axe_flint = 5; s.player.inv.pick_flint = 5;
    const ptx = Math.floor(nw.player.x/32), pty = Math.floor(nw.player.y/32);
    for (let r = 1; r <= 25; r++) for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
      if (!nw.world.activeFeatureAt(ptx+dx, pty+dy)) continue;
      nw.player.teleport((ptx+dx+0.5)*32 + 22, (pty+dy+0.5)*32);
      return [ptx+dx, pty+dy];
    }
    return null;
  })()`);
  await wait(700);
  await ev(`(() => { __nw.sys.gather.active = null; __nw.sys.gather.tryStart(); return !!__nw.sys.gather.active; })()`);
  await wait(3500); await shot('b5-05-harvest');

  // ---------------- B6: the level-up flourish ----------------
  await ev(`(() => { __nw.state.drops.length = 0; return 1; })()`);
  await ev(`__nw.ctx.views.addLevelUpBurst(__nw.player.x, __nw.player.y - 4), __nw.ctx.particles.spawn('levelup', __nw.player.x, __nw.player.y - 8, 18), 1`);
  await wait(90);  await shot('b6-01-burst-early');
  await wait(230); await shot('b6-02-burst-mid');

  // ---------------- N4.2: the Lens side cart ----------------
  // Give the Chronicle something to draw so the strip is not three empty boxes.
  await ev(`(() => {
    const c = __nw.chronicle, t0 = __nw.state.clock;
    for (let i = 0; i < 200; i++) {
      const t = t0 - 200 + i;
      c.push('pulse', t, 18 + Math.sin(i/9)*4 + (i===140?90:0), 'measured');
      c.push('flow',  t, 15 + Math.cos(i/13)*3, 'measured');
      c.push('fray',  t, i > 150 ? 2.2 : 0.1, 'measured');
    }
    __nw.lens.setOpen(true);
    return c.plot('pulse').length;
  })()`, true);
  const tabs = ['pulse', 'paths', 'identity', 'vessel', 'threads'];
  for (let i = 0; i < tabs.length; i++) {
    await ev(`(() => { document.querySelectorAll('#nw-observatory [data-tab]')[${i}].click(); __nw.lens.refresh(true); return 1; })()`);
    await wait(350);
    await shot(`n42-0${i + 1}-${tabs[i]}`);
  }
  // the inspect box, which had to survive the refactor
  await ev(`(() => {
    document.querySelectorAll('#nw-observatory [data-tab]')[0].click(); __nw.lens.refresh(true);
    const r = document.querySelector('#nw-lens-body [data-inspect-key]');
    if (r) r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return r ? r.getAttribute('data-inspect-key') : null;
  })()`);
  await wait(250); await shot('n42-06-inspect');
  await ev(`(__nw.lens.setOpen(false), 1)`);
  await wait(400); await shot('n42-07-closed-game-visible');

  const { result: live } = await ev(`JSON.stringify({
    deepLive: __nw.sys.net.snap.deepLive,
    pulseBest: +__nw.sys.net.get('pulseBest').toFixed(2),
    flowBest: +__nw.sys.net.get('flowBest').toFixed(2),
    fray: +__nw.sys.net.snap.fray.toFixed(4),
    silt: +__nw.sys.net.snap.silt.toFixed(4),
    l4: __nw.sys.net.deep.l4,
    deepStatus: __nw.sys.net.deep.status,
    drops: __nw.state.drops.length,
  })`);
  console.log('\nLIVE STATE:', live.value);
  fs.writeFileSync(path.join(OUT, 'live-state.json'), live.value);
  code = 0;
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  chrome.kill();
  process.exit(code);
}
