import { test, expect } from '../harness/fixtures';

/**
 * The fast release gate. Everything here is a thing that, if broken, means the
 * page a visitor loads is broken — regardless of how green the logic tests are.
 */
test.describe('Smoke — does the shipped page actually work', () => {
  test('boots, renders, and responds to a real keypress', async ({ launch }, testInfo) => {
    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: 1234, gl });

    const start = await nw.snap();
    expect(start.clock, 'game clock should be running').toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(start.hp) && start.hp > 0, 'player should spawn alive').toBe(true);

    // Real DOM keystrokes, through the game's own window listeners — not __nw.step().
    await nw.perform({ move: { x: 1, y: 0 }, hold: 1500 });
    await nw.perform({ move: { x: 0, y: 1 }, hold: 1500 });
    await nw.releaseAll();

    const moved = await nw.snap();
    const dist = Math.hypot(moved.x - start.x, moved.y - start.y);
    expect(
      dist,
      'the player did not move in response to held WASD keys — input is not reaching the game ' +
      '(a headed window that lost focus will do this: input.ts clears its key set on window blur)',
    ).toBeGreaterThan(20);

    // the simulation advanced in real time, without anyone calling step()
    expect(moved.clock, 'game clock did not advance in real time').toBeGreaterThan(start.clock);
  });

  test('the procedural soundtrack actually starts', async ({ launch }, testInfo) => {
    test.skip(testInfo.project.name === 'firefox', 'audio is asserted on the Chromium lanes');
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    await nw.perform({ move: { x: 1, y: 0 }, hold: 6000 });
    await nw.releaseAll();

    const audio = await nw.audio();
    expect(audio.oscillators, 'no oscillators were ever created — audio never started').toBeGreaterThan(0);
    expect(
      Object.keys(audio.waves).length,
      'oscillators were created but none ever got a waveform — the melody is not playing',
    ).toBeGreaterThan(0);
  });

  /* =======================================================================
   * The soundtrack rule.
   *
   * The user's standing direction after the X2 rollback: drums and sawtooth
   * are for WORLD BOSSES ONLY — the music must never key off ordinary combat
   * or foe proximity.
   *
   * `hats` counts highpass biquad filters at 8000Hz. audio.ts renders its drum
   * hat as burst(t, 0.04, 8000, 1, gain, 'highpass'); hat() is private, is not
   * one of the five SFX step primitives, and is reachable only from the
   * `if (d.drums)` branch of the music scheduler. No SFX recipe in the table
   * uses a highpass filter at all — every one of them is lowpass or bandpass.
   * So a highpass-8000 filter can only mean the drum kit is running.
   *
   * The two tests below are a matched pair on purpose. The negative one alone
   * would pass just as happily if the probe counted nothing; the positive one
   * proves the probe fires. They can only both pass if the probe works AND the
   * mood table is correct.
   * ==================================================================== */

  test('ordinary foes must NOT bring in the drums', async ({ launch }, testInfo) => {
    test.skip(testInfo.project.name === 'firefox', 'audio is asserted on the Chromium lanes');
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    await nw.perform({ move: { x: 1, y: 0 }, hold: 3000 });
    await nw.releaseAll();

    const provoked = await nw.provokeOrdinaryCombat();
    expect(provoked.ok, `could not stage ordinary combat: ${provoked.reason}`).toBe(true);

    const { warnTiles, series } = await nw.watchAudio(8, 4);
    await testInfo.attach('audio-series.json', {
      body: JSON.stringify({ warnTiles, series }, null, 2),
      contentType: 'application/json',
    });

    const first = series[0], last = series[series.length - 1];

    // the window has to be clean, or nothing below means anything
    const bossEverNear = series.some((s) => s.bossTiles !== null && s.bossTiles < warnTiles);
    expect(bossEverNear, 'a world boss came into threat range — the observation window was not clean').toBe(false);
    const foeEverNear = series.some((s) => s.nearestFoeTiles !== null && s.nearestFoeTiles < 10);
    expect(foeEverNear, 'no foe was ever inside the 10-tile combat radius — the test proved nothing').toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `\n  ordinary combat window: foes ${last.foes}, nearest ${last.nearestFoeTiles} tiles, ` +
      `boss ${last.bossTiles ?? '—'} tiles (warn at ${warnTiles}), ` +
      `hats ${first.hats} → ${last.hats}, kicks ${first.kicks} → ${last.kicks}\n`,
    );

    expect(
      last.hats - first.hats,
      `The drum kit played ${last.hats - first.hats} hits during ${series[series.length - 1].t}s of ORDINARY ` +
      `combat — a foe ${last.nearestFoeTiles} tiles away and the nearest world boss ` +
      `${last.bossTiles ?? '—'} tiles away (threat range is ${warnTiles}). Drums are for world bosses only.`,
    ).toBe(0);
  });

  test('a hunting world boss DOES bring in the drums', async ({ launch }, testInfo) => {
    test.skip(testInfo.project.name === 'firefox', 'audio is asserted on the Chromium lanes');
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    await nw.perform({ move: { x: 1, y: 0 }, hold: 3000 });
    await nw.releaseAll();

    const provoked = await nw.page.evaluate(() => {
      const nw = (window as any).__nw;
      const b = (nw.state.worldBosses ?? []).find((x: any) => x.reviveAt === 0);
      if (!b) return false;
      // direct object mutation — the sanctioned way to drive state (WORKFLOW.md)
      b.hunting = true;
      b.x = nw.state.player.x + 20;
      b.y = nw.state.player.y;
      return true;
    });
    expect(provoked, 'no living world boss existed to provoke').toBe(true);

    const { warnTiles, series } = await nw.watchAudio(8, 4);
    const first = series[0], last = series[series.length - 1];

    // eslint-disable-next-line no-console
    console.log(
      `\n  boss window: boss ${last.bossTiles} tiles (warn at ${warnTiles}), ` +
      `hats ${first.hats} → ${last.hats}, kicks ${first.kicks} → ${last.kicks}\n`,
    );

    expect(last.bossTiles!, 'the provoked boss never registered as a threat').toBeLessThan(warnTiles);
    expect(
      last.hats - first.hats,
      'a world boss is hunting the player and the drum kit never came in — either the boss mood is ' +
      'no longer reached, or the audio probe is not wired to anything',
    ).toBeGreaterThan(0);
  });
});
