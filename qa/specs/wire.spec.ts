import { test, expect } from '../harness/fixtures';

const RESOLVER_HOSTS = ['cloudflare-dns.com', 'dns.google'];
/** `speed.cloudflare.com` is N4.1's Deep Wire probe — DEEP_PROBE_URL, which is
 *  `__down?bytes=1`. One byte of body, rate-limited to one call per 20s, and
 *  the whole point of it is that the interesting data is in the HEADERS. It is
 *  NOT the N4.5 throughput sounding, which lives on the same host, spends real
 *  megabytes, and is refused outright at the default `quiet` covenant
 *  (`budgetMB <= 0` — sounding.ts blocked()). That consent gate is asserted by
 *  covenant.spec.ts; allowing the host here does not weaken it.
 *
 *  The list had bare `cloudflare.com` and never picked up the subdomain, so
 *  this spec has failed on every push since the Deep Wire shipped — which,
 *  because deploy.yml runs a wider gate than ci.yml, is part of why the game
 *  never actually reached Pages. */
const ALLOWED = [...RESOLVER_HOSTS, 'cloudflare.com', 'speed.cloudflare.com', '127.0.0.1', 'localhost', '[::1]'];

const BEACON_HOSTS = [
  'www.yandex.ru', 'www.naver.com', 'www.baidu.com', 'www.yahoo.co.jp',
  'www.microsoft.com', 'www.bbc.co.uk', 'timesofindia.indiatimes.com',
  'www.abc.net.au', 'www.news24.com', 'www.lemonde.fr', 'www.google.com',
  'www.elmundo.es', 'www.uol.com.br', 'api.ipify.org', 'ipapi.co',
];

test.describe('The Wire — outbound traffic discipline', () => {
  test('a swing cannot emit a packet, and no beacon host is ever contacted', async ({ launch }, testInfo) => {
    test.setTimeout(4 * 60 * 1000);
    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: 1234, gl, net: true });

    const hits = new Map<string, number>();
    nw.page.on('request', (r) => {
      let h = '';
      try { h = new URL(r.url()).hostname; } catch { return; }
      hits.set(h, (hits.get(h) ?? 0) + 1);
    });

    const t0 = Date.now();
    const SECONDS = 70;
    let swings = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      await nw.page.keyboard.press('Space');
      swings++;
      await nw.page.waitForTimeout(120);
    }
    const realSeconds = (Date.now() - t0) / 1000;

    const third = [...hits.entries()].filter(([h]) => !ALLOWED.includes(h));
    const forbidden = [...hits.entries()].filter(([h]) => BEACON_HOSTS.includes(h));
    const total = [...hits.entries()]
      .filter(([h]) => !['127.0.0.1', 'localhost', '[::1]'].includes(h))
      .reduce((a, [, n]) => a + n, 0);

    const table = [...hits.entries()].sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `  ${String(n).padStart(4)}  ${h}`).join('\n');
    await testInfo.attach('request-hosts.txt', { body: table, contentType: 'text/plain' });
    // eslint-disable-next-line no-console
    console.log(`\n  ${swings} swings in ${realSeconds.toFixed(0)}s → ${total} outbound requests\n${table}\n`);

    expect(
      forbidden,
      `Contacted hosts that never invited us: ${forbidden.map(([h, n]) => `${h}×${n}`).join(', ')}. ` +
      `Beacon hosts must be RESOLVED via DoH, never fetched (N4.0).`,
    ).toEqual([]);

    expect(
      third.map(([h]) => h).sort(),
      `Unexpected third-party hosts contacted: ${third.map(([h, n]) => `${h}×${n}`).join(', ')}`,
    ).toEqual(third.map(([h]) => h).sort().filter((h) => ALLOWED.includes(h)));

    const perMin = (total / realSeconds) * 60;
    expect(
      perMin,
      `${total} outbound requests in ${realSeconds.toFixed(0)}s = ${perMin.toFixed(1)}/min while swinging ` +
      `${swings} times. The gate allows 20/min sustained. Swing rate must not drive request rate.`,
    ).toBeLessThan(40);
  });

  test('routes resolve to real addresses through a real resolver', async ({ launch }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: 4242, gl, net: true });

    await nw.page.waitForTimeout(45_000);

    const probes = await nw.page.evaluate(() => {
      const n = (window as any).__nw?.sys?.net ?? (window as any).NW?.NET;
      return (n?.snap?.endpointProbes ?? []).map((p: any) => ({
        label: p.label, rtt: p.rtt, ip: p.ip, ttl: p.ttl, resolver: p.resolver,
      }));
    });

    // eslint-disable-next-line no-console
    console.log(`\n  resolved ${probes.length}: ` +
      probes.map((p: any) => `${p.label}→${p.ip || '—'} ${p.rtt}ms via ${p.resolver ?? '—'}`).join(' | ') + '\n');
    await testInfo.attach('routes.json', { body: JSON.stringify(probes, null, 2), contentType: 'application/json' });

    expect(probes.length, 'the scheduler resolved nothing in 45s').toBeGreaterThan(0);

    const good = probes.filter((p: any) => p.rtt > 0 && p.ip);
    expect(
      good.length,
      `no route produced a real address — DoH may be blocked here. Got: ${JSON.stringify(probes)}`,
    ).toBeGreaterThan(0);

    for (const p of good) {
      expect(p.ip, `${p.label} resolved to a non-address`).toMatch(/^[0-9a-fA-F.:]+$/);
      expect(['1.1.1.1', '8.8.8.8'], `${p.label} has no resolver attribution`).toContain(p.resolver);
    }
  });

  test('nonet mode emits zero third-party requests', async ({ launch }, testInfo) => {
    test.setTimeout(2 * 60 * 1000);
    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: 99, gl });

    const third: string[] = [];
    nw.page.on('request', (r) => {
      try {
        const h = new URL(r.url()).hostname;
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(h)) third.push(h);
      } catch { /* data: / blob: */ }
    });

    for (let i = 0; i < 60; i++) {
      await nw.page.keyboard.press('Space');
      await nw.page.waitForTimeout(200);
    }

    expect(
      [...new Set(third)],
      `?nonet must make the game hermetic, but it contacted: ${[...new Set(third)].join(', ')}`,
    ).toEqual([]);
  });
});
