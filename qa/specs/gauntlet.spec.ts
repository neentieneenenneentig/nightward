import { test, expect } from '../harness/fixtures';

/**
 * The Gauntlet, run where it has never been run before: in a real browser,
 * against the artifact that actually ships.
 *
 * regression.ts has 70+ tests and >1200 assertions, but until now it has only
 * ever executed against the vite dev server. `.github/workflows/deploy.yml`
 * publishes `dist/`, and a production build differs in ways that matter —
 * minification, `import.meta.env.DEV` false (which strips the debug hotkeys),
 * tree-shaking, and a different module graph. Running the suite against the
 * previewed build closes that gap.
 */
test.describe('Gauntlet — the in-game regression suite', () => {
  test('passes in a real browser against the built bundle', async ({ launch }, testInfo) => {
    test.setTimeout(10 * 60 * 1000);

    const gl = testInfo.project.name === 'webgl';
    const nw = await launch({ seed: 1234, gl });

    const result = await nw.gauntlet();

    await testInfo.attach('gauntlet-report.txt', {
      body: result.report,
      contentType: 'text/plain',
    });

    // eslint-disable-next-line no-console
    console.log(`\n[${testInfo.project.name}] Gauntlet: ${result.pass} passed, ${result.fail} failed, ${result.total} tests\n`);

    expect(result.total, 'the suite should have registered its tests').toBeGreaterThan(50);
    expect(result.fail, `Gauntlet failures:\n${result.report}`).toBe(0);
    expect(result.pass).toBeGreaterThan(1000);

    // the suite drives the sim hard; the renderer must still be alive afterwards
    const before = await nw.frames();
    await nw.page.waitForTimeout(1000);
    expect(await nw.frames(), 'render loop died during the suite').toBeGreaterThan(before);
  });
});
