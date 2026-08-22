import { test, expect } from '../harness/fixtures';

/**
 * N4.5/A7 — the Sounding and the Covenants, exercised the way a player would:
 * the picker through a real keypress and a real click, the stone through the
 * interact path, and the consequences read off the live built bundle.
 *
 * The one-selector contract is the thing under test here: the pact is BOTH the
 * difficulty tier and the data budget, every tier's megabyte cost is stated in
 * the panel (not a tooltip, not the Lens), and a pact can only ever be sworn
 * deeper.
 */
test.describe('Covenant & Sounding — the N4.5/A7 selector', () => {
  test('the picker states every megabyte cost, and a deeper pact sticks', async ({ launch }, testInfo) => {
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    // Open the panel with the real key, not a direct ui.open().
    await nw.page.keyboard.press('p');
    await nw.page.waitForSelector('.nw-panel');
    await expect(nw.page.locator('.nw-phead h2')).toHaveText('THE COVENANT');

    // Every tier's megabyte cost is stated in the panel. "spends none of your
    // data" is the quiet pact's honest sentence — it must be there too.
    const body = await nw.page.locator('.nw-pbody').innerText();
    for (const cost of ['spends none of your data', '3 MB', '12 MB', '40 MB', '100 MB']) {
      expect(body, `the picker must state "${cost}"`).toContain(cost);
    }

    // Swear the Deep Pact by clicking its row's button, the way a player would.
    const row = nw.page.locator('.nw-row.nw-seal', { hasText: 'The Deep Pact' });
    await row.locator('button').click();

    const covenant = await nw.page.evaluate(() => (window as any).__nw.state.covenant);
    expect(covenant, 'clicking Swear must set the held pact').toBe('deep');

    // The clicked row now reads as sworn, and the shallower pact is unreachable.
    await expect(nw.page.locator('.nw-row.nw-seal', { hasText: 'The Deep Pact' }).locator('button'))
      .toHaveText('Sworn');
    const listening = nw.page.locator('.nw-row.nw-seal', { hasText: 'The Listening Pact' });
    await expect(listening.locator('button'), 'a pact can only be sworn deeper').toBeDisabled();
  });

  test('the Sounding Stone panel shows the budget and the blocked reason verbatim', async ({ launch }, testInfo) => {
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    // Under the Quiet Pact the stone refuses with the consent sentence.
    const blocked = await nw.page.evaluate(() => (window as any).__nw.sys.sounding.blocked());
    expect(blocked, 'a stone that spends nothing must say why').toContain('Quiet Pact');

    // The proximity scan is data-driven off the `hub` column: drop a stone on
    // the player's tile and it becomes the hub counter without any new code path.
    const kind = await nw.page.evaluate(() => {
      const nw = (window as any).__nw;
      const p = nw.state.player;
      nw.state.buildings.push({
        uid: nw.state.nextUid++, type: 'sounding_stone',
        tx: Math.floor(p.x / 32), ty: Math.floor(p.y / 32), hp: 200, maxHp: 200,
      });
      return nw.sys.hub.near()?.kind ?? null;
    });
    expect(kind, 'the hub scan must find the Sounding Stone by its data row').toBe('sounding');

    // Open the panel the way the interact key would, and read it.
    await nw.page.evaluate(() => (window as any).__nw.ui.open('sounding'));
    await nw.page.waitForSelector('.nw-panel');
    await expect(nw.page.locator('.nw-phead h2')).toHaveText('THE SOUNDING STONE');

    const panel = await nw.page.locator('.nw-pbody').innerText();
    expect(panel).toContain('0.0 of 0 MB');          // budget spent of left
    expect(panel).toContain('the Quiet Pact spends nothing');  // blocked() verbatim
  });

  test('swearing deep hardens the nights and opens the budget, in the live bundle', async ({ launch }, testInfo) => {
    const nw = await launch({ seed: 1234, gl: testInfo.project.name === 'webgl' });

    await nw.page.keyboard.press('p');
    await nw.page.waitForSelector('.nw-panel');
    await nw.page.locator('.nw-row.nw-seal', { hasText: 'The Deep Pact' }).locator('button').click();

    const live = await nw.page.evaluate(() => {
      const nw = (window as any).__nw;
      const pact = nw.sys.sounding.pact();
      return {
        id: pact.id,
        hpMul: pact.hpMul,
        dmgMul: pact.dmgMul,
        budgetMB: pact.budgetMB,
        budgetLeft: nw.sys.sounding.budgetLeft(),
        // the loot-floor overlay is the covenant reaching the roll, live
        floor: nw.mods.loot.covenantBand({ floor: 'plain', ceiling: 'hallowed' }, 'deep').floor,
      };
    });

    expect(live.id).toBe('deep');
    expect(live.hpMul).toBe(1.35);
    expect(live.dmgMul).toBe(1.25);
    expect(live.budgetMB).toBe(12);
    expect(live.budgetLeft).toBe(12_000_000);
    expect(live.floor).toBe('touched');
  });
});
