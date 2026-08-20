// Raw CDP driver — Node 24's built-in WebSocket, no npm deps.
// Usage: node scripts/run-gauntlet.mjs
import { spawn } from 'child_process';

const CDP_PORT = 9223;
const GAME_URL = 'http://localhost:5199/?gl&seed=1234';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ---- helpers ----

async function cdpSend(ws, id, method, params = {}) {
  const msg = JSON.stringify({ id, method, params });
  ws.send(msg);
}

function toText(event) {
  // event may be a MessageEvent (with .data) or raw data
  const data = event?.data !== undefined ? event.data : event;
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return String(data);
}

function cdpRecv(ws) {
  return new Promise((resolve, reject) => {
    // 30s was too tight. This waits for the NEXT message of any kind, and the
    // exhaustive playthrough is one long synchronous JS block that emits nothing
    // between phase logs — so a slow machine looked exactly like a hung page and
    // killed 2 runs in 8 with no assertion having failed. 120s still catches a
    // genuine hang; it just stops calling a slow run a broken one.
    const timeout = setTimeout(() => reject(new Error('CDP timeout')), 120000);
    const handler = (event) => {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      try {
        resolve(JSON.parse(toText(event)));
      } catch (e) {
        reject(new Error(`CDP parse error: ${e.message} (type: ${typeof event}, ctor: ${event?.constructor?.name}, data-type: ${typeof event?.data})`));
      }
    };
    ws.addEventListener('message', handler);
  });
}

async function cdpCall(ws, id, method, params = {}) {
  cdpSend(ws, id, method, params);
  let resp;
  do { resp = await cdpRecv(ws); } while (resp.id !== id);
  if (resp.error) throw new Error(`${method}: ${resp.error.message}`);
  return resp.result;
}

// ---- launch Chrome ----

console.log('Launching headless Chrome...');
const chrome = spawn(CHROME, [
  `--headless=new`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  GAME_URL,
], { stdio: 'ignore' });

chrome.on('error', (err) => {
  console.error('Failed to launch Chrome:', err.message);
  process.exit(1);
});

// Exit non-zero unless the run is positively observed to be green.  Default
// is 1 so that a crash, a timeout, or a suite that never ran all fail loudly.
let exitCode = 1;

// Give Chrome time to start and load the page
await new Promise(r => setTimeout(r, 3000));

try {
  // Connect via WebSocket
  const listResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const pages = await listResp.json();
  const page = pages.find(p => p.url.includes('localhost:5199'));
  if (!page) throw new Error('No game page found in CDP targets');
  const wsUrl = page.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error('WebSocket error: ' + (e.message || e)));
  });

  let id = 0;
  const call = (method, params) => cdpCall(ws, ++id, method, params);

  // Enable domains
  await call('Page.enable');
  await call('Runtime.enable');

  // Wait for game to initialize
  console.log('Waiting for __nw...');
  for (let i = 0; i < 120; i++) {
    const { result } = await call('Runtime.evaluate', {
      expression: 'typeof window.__nw !== "undefined" && window.__nw.state !== undefined',
      returnByValue: true,
    });
    if (result.value) {
      console.log('Game ready.');
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Check frame count to verify rendering is live
  const { result: framesResult } = await call('Runtime.evaluate', {
    expression: '__nw.frames',
    returnByValue: true,
  });
  console.log(`Frames rendered: ${framesResult.value}`);

  // Run the Gauntlet
  console.log('\nRunning Gauntlet...');

  // Capture console output
  const consoleLogs = [];
  const exceptions = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(toText(event));
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(args);
      console.log(`  [console] ${args}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const exc = msg.params.exceptionDetails;
      exceptions.push(exc.text);
      console.error(`  [EXCEPTION] ${exc.text}`);
    }
  });

  await call('Runtime.evaluate', {
    expression: '__nw.regression.run()',
    awaitPromise: true,
    returnByValue: true,
  });

  // Wait for test output to finish
  await new Promise(r => setTimeout(r, 2000));

  // ---- summary ----
  // Derived from the console stream, not from a self-report: the suite has no
  // machine-readable result object, and a driver that asks the thing under
  // test whether it passed is not evidence.  Strip css-format noise from the
  // %c-styled suite header before matching.
  const clean = (s) => s.replace(/%c/g, '').replace(/(?:color|font)[^;]*;/g, '').trim();
  const isSuiteLine = (l) => /ASSERTIONS (PASSED|FAILED)/.test(l);

  const passes = consoleLogs.filter(l => l.includes('✅') && !isSuiteLine(l)).length;
  const fails = consoleLogs.filter(l => l.includes('❌') && !isSuiteLine(l));
  const suiteLine = consoleLogs.find(isSuiteLine);

  console.log('\n=== GAUNTLET SUMMARY ===');
  console.log(`  assertions passed : ${passes}`);
  console.log(`  assertions failed : ${fails.length}`);
  console.log(`  exceptions        : ${exceptions.length}`);
  console.log(`  suite line        : ${suiteLine ? clean(suiteLine) : '(none — suite did not report)'}`);
  for (const f of fails) console.log(`  FAIL → ${clean(f)}`);
  for (const e of exceptions) console.log(`  EXC  → ${e}`);

  // Green requires: assertions ran, none failed, nothing threw, and the suite
  // printed its own terminating line.  Any one missing is a red run.
  exitCode = (passes > 0 && fails.length === 0 && exceptions.length === 0 && !!suiteLine) ? 0 : 1;
  console.log(`\n  RESULT: ${exitCode === 0 ? 'GREEN' : 'RED'} (exit ${exitCode})`);

  ws.close();
} catch (err) {
  console.error('Error:', err.message);
  exitCode = 1;
} finally {
  chrome.kill();
  process.exit(exitCode);
}
