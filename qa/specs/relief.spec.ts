import { test, expect } from '../harness/fixtures';

/**
 * Batch G — the terrain reads as terrain.
 *
 * Every assertion here is a MATCHED PAIR: the claim, plus a positive control
 * proving its precondition actually held. "No cliff band was painted into the
 * sea" is worthless if the run never found a shoreline, so each test fails on
 * a missing control before it ever reaches the real claim.
 *
 * heightClass comes off `window.NW.MATS`, the live material table the game
 * itself renders from — not a copy in the spec that could drift.
 */

const MOUNTAIN = 7, SNOW = 8, HILL = 6, GRASS = 3, MEADOW = 4;

/** Block until every loaded chunk has an overlay and the relight queue is
 *  empty. See ChunkMap.debugReliefPending() for why a fixed sleep was wrong.
 *  Bounded, so a genuine stall still fails the test rather than hanging. */
async function settleRelief(page: import('@playwright/test').Page, timeout = 40_000) {
  await page.waitForFunction(
    () => ((window as any).__nw?.chunks?.debugReliefPending?.() ?? 1) === 0,
    undefined,
    { timeout, polling: 100 },
  );
}

test.describe('Batch G — terrain reads as terrain', () => {
  test('height reads as height: mountain lighter than hill, hill lighter than grass', async ({ launch }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    // Sampled off the BAKED canvas — what the player's eye actually receives.
    // debugPixel reads the base bake, so the relief overlay is excluded and
    // this measures the palette alone.
    const bands = await nw.page.evaluate(async (ids) => {
      const g = (window as any).__nw;
      const acc: Record<string, number[]> = { mtn: [], hill: [], grass: [] };
      const bucket = (m: number) =>
        m === ids.MOUNTAIN || m === ids.SNOW ? 'mtn'
          : m === ids.HILL ? 'hill'
            : (m === ids.GRASS || m === ids.MEADOW) ? 'grass' : null;
      for (let hop = 0; hop < 40; hop++) {
        const px = Math.floor(g.player.x / 32), py = Math.floor(g.player.y / 32);
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const tx = px + dx, ty = py + dy;
            const b = bucket(g.world.materialAt(tx, ty));
            if (!b) continue;
            const p = g.chunks.debugPixel(tx, ty, 16, 10);   // above any cliff band
            if (p) acc[b].push(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
          }
        }
        if (acc.mtn.length > 200 && acc.hill.length > 200 && acc.grass.length > 200) break;
        g.player.x = g.player.px = (((hop * 977) % 1600) - 800) * 32;
        g.player.y = g.player.py = (((hop * 613) % 1600) - 800) * 32;
        await new Promise((r) => setTimeout(r, 450));
      }
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return {
        mtn: mean(acc.mtn), hill: mean(acc.hill), grass: mean(acc.grass),
        n: { mtn: acc.mtn.length, hill: acc.hill.length, grass: acc.grass.length },
      };
    }, { MOUNTAIN, SNOW, HILL, GRASS, MEADOW });

    // eslint-disable-next-line no-console
    console.log(`\n  mean luminance — mountain ${bands.mtn.toFixed(1)} (n=${bands.n.mtn})  ` +
      `hill ${bands.hill.toFixed(1)} (n=${bands.n.hill})  grass ${bands.grass.toFixed(1)} (n=${bands.n.grass})\n`);
    await testInfo.attach('bands.json', { body: JSON.stringify(bands, null, 2), contentType: 'application/json' });

    expect(bands.n.mtn, 'never found a mountain tile to sample').toBeGreaterThan(50);
    expect(bands.n.hill, 'never found a hill tile to sample').toBeGreaterThan(50);
    expect(bands.n.grass, 'never found a grass/meadow tile to sample').toBeGreaterThan(50);

    expect(
      bands.mtn,
      `mountain (${bands.mtn.toFixed(1)}) must be LIGHTER than hill (${bands.hill.toFixed(1)}). ` +
      'A peak darker than the ground beside it reads as a pit — the G2 value inversion.',
    ).toBeGreaterThan(bands.hill);

    expect(
      bands.hill,
      `hill (${bands.hill.toFixed(1)}) must be lighter than grass (${bands.grass.toFixed(1)})`,
    ).toBeGreaterThan(bands.grass);
  });

  test('relief darkens height boundaries and leaves level ground alone', async ({ launch }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const nw = await launch({ seed: 4242, gl: testInfo.project.name === 'webgl' });
    await nw.page.evaluate(() => { (window as any).__nw.state.clock = 40; });   // low sun, long shadows
    await settleRelief(nw.page);

    const r = await nw.page.evaluate(async () => {
      const g = (window as any).__nw;
      const H = (tx: number, ty: number) => (window as any).NW.MATS[g.world.materialAt(tx, ty)].heightClass;
      // A bilinear height field is steepest BETWEEN tile centres, so a tile is
      // scored by the darkest point across its own footprint, not its centre.
      const OFF = [4, 16, 28];
      const level: number[] = [], step: number[] = [];
      let brightest = 0, all = 0, nAll = 0;
      for (let hop = 0; hop < 30; hop++) {
        const px = Math.floor(g.player.x / 32), py = Math.floor(g.player.y / 32);
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const tx = px + dx, ty = py + dy;
            if (g.chunks.debugRelief(tx, ty) == null) continue;
            let lo = 1;
            for (const oy of OFF) {
              for (const ox of OFF) {
                const s = g.chunks.debugRelief(tx, ty, ox, oy) as number;
                if (s < lo) lo = s;
                if (s > brightest) brightest = s;
                all += s; nAll++;
              }
            }
            const h = H(tx, ty);
            const uniform = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]
              .every(([a, b]) => H(tx + a, ty + b) === h);
            (uniform ? level : step).push(lo);
          }
        }
        if (level.length > 250 && step.length > 250) break;
        g.player.x = g.player.px = (((hop * 811) % 1400) - 700) * 32;
        g.player.y = g.player.py = (((hop * 449) % 1400) - 700) * 32;
        // Relief overlays are built off the bake path a few per frame, so a
        // fresh region needs longer than a bake to finish lighting. Wait for
        // the WORK rather than for a timer: the old fixed 1400ms was a bet on
        // frame rate, and on the software-raster lane it lost — most tiles
        // still read null, which is how a terrain test came to sample nine
        // height boundaries and report the relief system broken.
        for (let i = 0; i < 400; i++) {
          if ((g.chunks.debugReliefPending?.() ?? 1) === 0) break;
          await new Promise((k) => setTimeout(k, 50));
        }
      }
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return {
        level: mean(level), step: mean(step), darkest: step.length ? Math.min(...step) : 1,
        brightest, overall: all / Math.max(1, nAll), nLevel: level.length, nStep: step.length,
      };
    });

    // eslint-disable-next-line no-console
    console.log(`\n  relief — level ground ${r.level.toFixed(3)} (n=${r.nLevel})  height step ${r.step.toFixed(3)} ` +
      `(n=${r.nStep})  darkest ${r.darkest.toFixed(3)}  brightest ${r.brightest.toFixed(3)}  ` +
      `overall mean ${r.overall.toFixed(3)}\n`);
    await testInfo.attach('relief.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });

    expect(r.nLevel, 'never sampled a tile whose whole neighbourhood is one height class').toBeGreaterThan(50);
    expect(r.nStep, 'never sampled a tile on a height-class boundary').toBeGreaterThan(50);

    // The control that matters. A flat grey tint over everything would sail
    // through a naive "boundaries are darker" check, so the overlay has to
    // reach a true 1.0 somewhere and average close to it — otherwise it is
    // quietly re-grading the palette instead of lighting the terrain.
    expect(
      r.brightest,
      `the relief overlay never reaches 1.0 (peak ${r.brightest.toFixed(3)}) — it is dimming the whole ` +
      'world rather than shading real slopes, which would undo the G2 palette.',
    ).toBeGreaterThan(0.999);
    expect(
      r.overall,
      `the overlay averages ${r.overall.toFixed(3)} — that is a global tint, not relief lighting.`,
    ).toBeGreaterThan(0.9);

    expect(
      r.step,
      `height boundaries (${r.step.toFixed(3)}) are not measurably darker than level ground ` +
      `(${r.level.toFixed(3)}) — the height field is not producing usable normals.`,
    ).toBeLessThan(r.level - 0.01);

    expect(r.darkest, 'no slope anywhere reached a real shadow').toBeLessThan(0.85);
  });

  test('the sun moves the shadows', async ({ launch }, testInfo) => {
    test.setTimeout(2 * 60 * 1000);
    const nw = await launch({ seed: 4242, gl: testInfo.project.name === 'webgl' });

    const at = async (clock: number) => {
      await nw.page.evaluate((c: number) => { (window as any).__nw.state.clock = c; }, clock);
      await settleRelief(nw.page);          // let the relight queue actually drain
      return nw.page.evaluate(() => {
        const g = (window as any).__nw;
        const px = Math.floor(g.player.x / 32), py = Math.floor(g.player.y / 32);
        const out: number[] = [];
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const s = g.chunks.debugRelief(px + dx, py + dy);
            out.push(s == null ? -1 : s);
          }
        }
        return out;
      });
    };

    const dawn = await at(15);
    const dusk = await at(225);
    expect(dawn.filter((v) => v >= 0).length, 'no relief samples at all').toBeGreaterThan(50);
    expect(dusk.length).toBe(dawn.length);

    let moved = 0, maxD = 0, n = 0;
    for (let i = 0; i < dawn.length; i++) {
      if (dawn[i] < 0 || dusk[i] < 0) continue;
      n++;
      const d = Math.abs(dawn[i] - dusk[i]);
      if (d > 0.02) moved++;
      if (d > maxD) maxD = d;
    }
    // eslint-disable-next-line no-console
    console.log(`\n  ${moved}/${n} samples changed between dawn and dusk, max Δ=${maxD.toFixed(3)}\n`);

    expect(
      moved,
      `the light swung from dawn to dusk and only ${moved}/${n} shade samples moved (max Δ ` +
      `${maxD.toFixed(3)}). Relief is baked to a fixed sun instead of following the world clock.`,
    ).toBeGreaterThan(n * 0.1);
  });

  test('no cliff band where land meets water, and real land cliffs still get one', async ({ launch }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    const r = await nw.page.evaluate(async () => {
      const g = (window as any).__nw;
      const H = (m: number) => (window as any).NW.MATS[m].heightClass;
      const L = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      // luminance step between a tile's upper body and its south edge: a cliff
      // face is a big dark drop there, a plain shoreline should be near zero
      const drop = (tx: number, ty: number) => {
        const mid = g.chunks.debugPixel(tx, ty, 16, 8);
        const low = g.chunks.debugPixel(tx, ty, 16, 28);
        return mid && low ? L(mid) - L(low) : null;
      };
      // materialAt is a cheap pure query, so LOOK for the two configurations
      // first and only then teleport to bake them. Wandering at random found
      // shorelines easily and inland cliffs almost never, which would have left
      // the positive control silently unfired.
      const want = (kind: 'shore' | 'cliff') => {
        for (let k = 0; k < 60000; k++) {
          const tx = ((Math.random() * 2400) | 0) - 1200, ty = ((Math.random() * 2400) | 0) - 1200;
          let hits = 0;
          for (let d = -5; d <= 5; d++) {
            const h = H(g.world.materialAt(tx + d, ty)), hs = H(g.world.materialAt(tx + d, ty + 1));
            if (h < 1) continue;
            if (kind === 'shore' ? hs === 0 : h - hs >= 1 && hs >= 1) hits++;
          }
          if (hits >= 4) return [tx, ty];
        }
        return null;
      };

      const shore: number[] = [], cliff: number[] = [];
      for (const kind of ['shore', 'cliff'] as const) {
        for (let visit = 0; visit < 14; visit++) {
          const at = want(kind);
          if (!at) break;
          g.player.x = g.player.px = at[0] * 32 + 16;
          g.player.y = g.player.py = at[1] * 32 + 16;
          await new Promise((k) => setTimeout(k, 550));
          const px = Math.floor(g.player.x / 32), py = Math.floor(g.player.y / 32);
          for (let dy = -6; dy <= 6; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
              const tx = px + dx, ty = py + dy;
              const h = H(g.world.materialAt(tx, ty));
              const hs = H(g.world.materialAt(tx, ty + 1));
              if (h < 1) continue;
              const d = drop(tx, ty);
              if (d == null) continue;
              if (hs === 0) shore.push(d);
              else if (h - hs >= 1) cliff.push(d);
            }
          }
          if (kind === 'shore' ? shore.length > 60 : cliff.length > 40) break;
        }
      }
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return { shore: mean(shore), cliff: mean(cliff), nShore: shore.length, nCliff: cliff.length };
    });

    // eslint-disable-next-line no-console
    console.log(`\n  upper-body → south-edge luminance drop: shoreline ${r.shore.toFixed(1)} (n=${r.nShore})  ` +
      `real cliff ${r.cliff.toFixed(1)} (n=${r.nCliff})\n`);

    expect(r.nShore, 'never found a land tile with water to its south — nothing was tested').toBeGreaterThan(20);
    expect(r.nCliff, 'never found a land-to-land height drop — the positive control never fired').toBeGreaterThan(15);

    expect(
      r.cliff,
      `a real land cliff only darkened by ${r.cliff.toFixed(1)} — the cliff pass is not drawing at all, ` +
      'which would make the shoreline check below pass for entirely the wrong reason.',
    ).toBeGreaterThan(10);

    expect(
      r.shore,
      `land above water darkened by ${r.shore.toFixed(1)} at its south edge, against ${r.cliff.toFixed(1)} ` +
      'for a real cliff. That band is the floating-plank artifact (G3): a rock face painted onto the sea. ' +
      'Foam owns the shoreline.',
    ).toBeLessThan(r.cliff * 0.45);
  });

  test('?norelief boots the flat look and leaves no overlay behind', async ({ launch }, testInfo) => {
    const nw = await launch({ seed: 99, gl: testInfo.project.name === 'webgl', extra: 'norelief' });
    await nw.page.waitForTimeout(1500);
    const r = await nw.page.evaluate(() => {
      const g = (window as any).__nw;
      const px = Math.floor(g.player.x / 32), py = Math.floor(g.player.y / 32);
      let any = 0, n = 0;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -7; dx <= 7; dx++) { n++; if (g.chunks.debugRelief(px + dx, py + dy) != null) any++; }
      }
      return { any, n, enabled: g.chunks.reliefEnabled };
    });
    expect(r.n, 'nothing was sampled').toBeGreaterThan(50);
    expect(r.enabled, '?norelief did not disable relief').toBe(false);
    expect(r.any, `${r.any} tiles still carry a relief overlay under ?norelief`).toBe(0);
  });
});
