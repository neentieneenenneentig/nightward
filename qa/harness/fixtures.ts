import { test as base, expect } from '@playwright/test';
import { Nightward } from './driver';

type BootOpts = { seed?: number; gl?: boolean; extra?: string };

export const test = base.extend<{ launch: (o?: BootOpts) => Promise<Nightward> }>({
  launch: async ({ page }, use, testInfo) => {
    await Nightward.installProbe(page);
    let game: Nightward | null = null;

    await use(async (o: BootOpts = {}) => {
      game = await Nightward.boot(page, o);
      return game;
    });

    /* ---- teardown: the console-error gate -------------------------------
     * Any uncaught exception or console.error the game produced during the
     * session fails the run, even if every explicit assertion passed. A game
     * that throws while looking fine is exactly what ships broken.
     *
     * Only applied when the body itself passed, so a real failure is never
     * masked by this. */
    if (game) {
      await game.releaseAll().catch(() => {});
      const errs = game.errors;
      if (errs.length) {
        await testInfo.attach('console-errors.txt', { body: errs.join('\n'), contentType: 'text/plain' });
      }
      // Recorded for visibility, never fatal — the game's latency beacons hit
      // third-party endpoints that rate-limit and block on their own schedule.
      if (game.externalErrors.length) {
        await testInfo.attach('third-party-errors.txt', {
          body: game.externalErrors.join('\n'),
          contentType: 'text/plain',
        });
      }
      if (testInfo.status === 'passed' && errs.length) {
        throw new Error(
          `${errs.length} console error(s) / uncaught exception(s) during the session:\n  ` +
          errs.slice(0, 20).join('\n  '),
        );
      }
    }
  },
});

export { expect };
