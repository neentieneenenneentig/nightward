import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../harness/fixtures';
import type { Snap } from '../harness/driver';
import { byName, MINUTES_CAP } from '../profiles';

/* ===========================================================================
 * Batch SR, end to end, with a player actually walking through it.
 *
 * Why this file exists
 * --------------------
 * The Gauntlet drives the sim with `__nw.step()`, so it can assert that the
 * act curve's NUMBERS are right without a single frame ever being drawn. The
 * playthrough specs drive real input in real time, but every profile in them
 * predates Batch SR, and `Snap` carried none of the batch's state until now —
 * so between the two suites, the shape of a run (three acts, a draft, a lord,
 * an outcome) had test coverage of exactly zero. Eleven phases shipped that
 * way.
 *
 * This is the missing lane: one player, one full lifespan, and assertions
 * about the ARC rather than about any single number inside it.
 *
 * It is a pre-release sweep, not a per-push gate — a run takes its natural
 * ~15 minutes and cannot be meaningfully truncated, because the thing under
 * test is what happens at minute twelve.
 *
 *     NW_MINUTES=99 npx playwright test qa/specs/reckoning.spec.ts
 * ======================================================================== */

const TIMELINE_DIR = join(process.cwd(), 'qa', '.artifacts', 'timelines');

const ACT_ORDER = ['gathering', 'swelling', 'reckoning'] as const;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

test.describe('The Reckoning — one full run, start to outcome', () => {
  test('a player walks the whole arc: three acts, a draft, a lord, an ending', async ({ launch }, testInfo) => {
    const profile = byName('speedrunner');
    test.setTimeout((profile.minutes + 5) * 60 * 1000);
    test.skip(
      MINUTES_CAP < 16,
      'a full-lifespan run — set NW_MINUTES=99 (the thing under test happens at minute twelve)',
    );

    const nw = await launch({ seed: profile.seed, gl: testInfo.project.name === 'webgl' });
    const r = await nw.play(profile);
    const s = r.samples;

    const body = JSON.stringify(r, null, 2);
    await testInfo.attach('reckoning-timeline.json', { body, contentType: 'application/json' });
    mkdirSync(TIMELINE_DIR, { recursive: true });
    writeFileSync(join(TIMELINE_DIR, `${testInfo.project.name}-reckoning-${profile.seed}.json`), body);

    const inAct = (a: string) => s.filter((x) => x.act === a);
    const last = s[s.length - 1];

    // eslint-disable-next-line no-console
    console.log(
      `\n  [reckoning] ${r.realSeconds.toFixed(0)}s real` +
      ` · acts ${JSON.stringify(r.actSeconds)}` +
      ` · drafts ${r.draftsTaken} · loom ${last.loomNodes} nodes` +
      ` · peak foes ${Math.max(...s.map((x) => x.foes))}` +
      ` · peak elites ${Math.max(...s.map((x) => x.elites))}` +
      ` · outcome ${last.outcome ?? '—'}\n`,
    );

    /* -- SR1: the run has three acts, in order ---------------------------- */

    // Sampled once a second, so a fifteen-minute run cannot miss a boundary.
    for (const a of ACT_ORDER) {
      expect(inAct(a).length, `the run never entered "${a}" — actSeconds ${JSON.stringify(r.actSeconds)}`)
        .toBeGreaterThan(0);
    }

    // ...and it never runs backwards. The act is a pure function of a
    // monotonic sim-tick count, so a regression here means someone rewired it
    // to a clock that can be rewound.
    let seen = -1;
    for (const x of s) {
      const i = ACT_ORDER.indexOf(x.act as (typeof ACT_ORDER)[number]);
      expect(i, `unknown act "${x.act}" at t=${x.t.toFixed(0)}s`).toBeGreaterThanOrEqual(0);
      expect(i, `the act went backwards (${ACT_ORDER[seen]} → ${x.act}) at t=${x.t.toFixed(0)}s`)
        .toBeGreaterThanOrEqual(seen);
      seen = Math.max(seen, i);
    }

    /* -- SR1: the acts DO something, rather than relabelling the HUD ------- */

    // The Gathering gates elites off (CFG.sr.actCurve[0].elites === false).
    // Asserted for the Gathering only: an elite rolled during the Swelling can
    // legitimately still be alive once the Reckoning starts, so their absence
    // later is not a property the curve promises.
    const eliteEarly = inAct('gathering').find((x) => x.elites > 0);
    expect(
      eliteEarly?.elites ?? 0,
      `an elite was alive during the Gathering (t=${eliteEarly?.t.toFixed(0)}s) — ` +
      'CFG.sr.actCurve gates elites off for that act',
    ).toBe(0);

    // The field thins for the Reckoning (countMul 1.4 → 0.2). Compared as
    // means over the sampled window rather than as peaks, because one lucky
    // spawn burst should not get to decide it.
    const swellFoes = mean(inAct('swelling').map((x) => x.foes));
    const reckFoes = mean(inAct('reckoning').map((x) => x.foes));
    expect(
      reckFoes,
      `the field did not thin for the Reckoning: ${swellFoes.toFixed(1)} mean foes in the Swelling ` +
      `against ${reckFoes.toFixed(1)} in the Reckoning. The lord is meant to be the fight, not the ` +
      'garnish standing around it.',
    ).toBeLessThan(swellFoes);

    /* -- SR2: the draft fired, and the world started again afterwards ----- */

    expect(
      r.draftsTaken,
      'no draft fired across a full run — either no Loom point was ever granted, or loom.ts ' +
      'stopped calling ui.openDraft() at the grant moment',
    ).toBeGreaterThan(0);

    // A draft freezes the sim outright. Prove the world moved again after the
    // last one, rather than the run having quietly stopped at a level-up.
    const draftIdx = s.map((x, i) => (x.drafting ? i : -1)).filter((i) => i >= 0);
    const lastDraft = draftIdx.length ? draftIdx[draftIdx.length - 1] : undefined;
    if (lastDraft !== undefined && lastDraft < s.length - 1) {
      expect(
        last.elapsed,
        'the act clock did not advance after the final draft — the sim never resumed',
      ).toBeGreaterThan(s[lastDraft].elapsed);
    }

    /* -- SR3: a lord was summoned, and the run has an ending -------------- */

    const summoned = s.find((x) => x.reckoning !== null);
    expect(
      summoned,
      `the Reckoning never summoned a lord across ${r.realSeconds.toFixed(0)}s ` +
      `(the run reached act "${last.act}") — the summons never fired, or summonReckoning() ` +
      'found nothing to summon',
    ).toBeTruthy();

    expect(
      summoned!.act,
      `the lord arrived during "${summoned!.act}" — the summons and the field thinning read the ` +
      'same clock on purpose, so they must land in the same act',
    ).toBe('reckoning');

    expect(
      s.some((x) => x.bossHpFrac !== null),
      'a Reckoning was active but its lord was never found in state.worldBosses',
    ).toBe(true);

    // Read the terminal state LIVE rather than off the timeline. Sampling is a
    // lossy view of a run by construction, and "how did this end" is precisely
    // the question that must not depend on whether the ending landed on a
    // sample boundary.
    const ended = await nw.page.evaluate(() => {
      const s = (window as any).__nw.state;
      return { gameOver: !!s.gameOver, outcome: s.outcome ?? null, cause: s.gameOverCause ?? null };
    });

    expect(ended.gameOver, `the run never ended across ${r.realSeconds.toFixed(0)}s`).toBe(true);
    expect(['reckoned', 'outlasted', 'fallen', 'unmet']).toContain(ended.outcome);

    // SR3's own invariant: a won run has no cause of death, because nothing
    // killed you. This is the exact confusion the scoring inversion came from.
    if (ended.outcome === 'reckoned') {
      expect(ended.cause, 'a won run reported a cause of death').toBeNull();
    }

    /* -- SR3/SR9: the scorecard agrees with what actually happened -------- */

    const card = await nw.page.evaluate(() => {
      try {
        const raw = localStorage.getItem('nw.leaderboard');
        const list = raw ? JSON.parse(raw) : [];
        // newest-first is not guaranteed by the store, so pick by date
        return list.sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))[0] ?? null;
      } catch { return null; }
    });

    expect(card, 'the finished run wrote no scorecard to the leaderboard').toBeTruthy();
    expect(card.v, 'the scorecard is not a v3 record').toBe(3);
    expect(card.outcome, "the scorecard's outcome disagrees with the run's").toBe(ended.outcome);

    // The SR3 scoring fix, asserted against a real card rather than against
    // the weights table. Before the fix, a win was scored through
    // `causeOfDeath` — which is null on a victory, because nothing killed you
    // — so the ending bonus was forfeited and a won run landed ~700 BELOW an
    // Outlasted one in the board's headline category.
    if (card.outcome === 'reckoned') {
      const w = await nw.page.evaluate(() => (window as any).NW?.CFG?.legacy?.weights ?? null);
      expect(w?.reckonedBonus, 'CFG.legacy.weights carries no reckonedBonus').toBeGreaterThan(0);
      expect(
        w.reckonedBonus,
        'winning the Reckoning is worth less than letting the clock run out on the lord',
      ).toBeGreaterThan(w.oldAgeBonus);
      expect(
        card.legacyScore,
        `a won run scored ${card.legacyScore}, below the win bonus alone (${w.reckonedBonus}) — ` +
        'the ending bonus was never applied',
      ).toBeGreaterThanOrEqual(w.reckonedBonus);
    }

    /* -- and it is still a run: no NaN, no negative hp -------------------- */
    for (const x of s as Snap[]) {
      for (const k of ['hp', 'gold', 'age', 'elapsed'] as const) {
        expect(Number.isFinite(x[k]), `${k} was ${x[k]} at t=${x.t.toFixed(1)}s`).toBe(true);
      }
      expect(x.hp, `hp went negative at t=${x.t.toFixed(1)}s`).toBeGreaterThanOrEqual(0);
    }
  });
});
