import { expect, type Page } from '@playwright/test';

/* ===========================================================================
 * A projection of game state small enough to poll several times a second.
 * Everything a player could actually perceive; nothing they couldn't.
 * ======================================================================== */
export interface Snap {
  /** seconds of real wall-clock since the run started */
  t: number;
  clock: number;          // game seconds
  day: number;            // day index (1-based)
  night: boolean;
  hp: number;
  hpFrac: number;
  gold: number;
  x: number; y: number;
  vigor: number;
  resolve: number;
  age: number;            // L1 — the run's own hard clock
  foes: number;
  nearestFoe: number | null;   // px
  /** unit vector toward the nearest foe, so a policy can close or flee */
  foeDir: { x: number; y: number } | null;
  bossHunting: boolean;
  nearestBoss: number | null;  // px
  bossDir: { x: number; y: number } | null;
  /**
   * worldbosses.nearestThreatTiles() — the exact call main.ts:597 uses to
   * compute `bossNear`, which is what actually drives the boss soundtrack.
   * `bossHunting` is NOT the same thing: a boss can be inside threat range
   * without hunting, and that still swaps the mood.
   */
  bossThreatTiles: number | null;
  warnTiles: number;
  /** px from the spawn point, for profiles that are meant to stay put or leave */
  homeDist: number;
  homeDir: { x: number; y: number };
  gatherTarget: string | null; // label of the node under the cursor, if any
  gathering: boolean;
  /** true while the build placement ghost is up — clicks place instead of attacking */
  building: boolean;
  invKinds: number;
  invTotal: number;
  buildings: number;
  nightsSurvived: number;
  gameOver: boolean;
  frames: number;
  heapMB: number | null;  // Chromium only
}

/** What a profile decides to do for one beat. */
export interface Act {
  /** desired movement direction, each component -1..1 (0,0 = stand still) */
  move?: { x: number; y: number };
  /** keys to tap once this beat: 'e' gather, ' ' attack, 'f' ignite, 'b' build, 'i' bag… */
  tap?: string[];
  /** left-click the canvas (desktop attack, or place a building while in build mode) */
  click?: boolean;
  /** how long to hold this decision, ms (the driver jitters it) */
  hold?: number;
  /** free-text note, recorded into the timeline for trace analysis */
  note?: string;
}

export interface AudioProbe {
  oscillators: number;
  waves: Record<string, number>;
  /** highpass@8000 biquads. This is the decisive drum signal — see probe(). */
  hats: number;
  /** oscillators ramped to 45Hz — the kick's unique signature */
  kicks: number;
  bufferSources: number;
}

/**
 * A player archetype. `act` is a pure function of what the player can see, so
 * a profile is reproducible given the same seed and reads like a description
 * of a person rather than a script of keystrokes.
 */
export interface Profile {
  name: string;
  /** one line, shown in the report — what kind of player this is */
  blurb: string;
  seed: number;
  /** real wall-clock minutes to play */
  minutes: number;
  /** force the WebGL path (`?gl`) rather than WebGPU */
  gl?: boolean;
  act(s: Snap, rng: () => number): Act;
  /** profile-specific expectations, run after the session */
  check?(r: RunSummary): void;
}

export interface RunSummary {
  profile: string;
  seed: number;
  realSeconds: number;
  samples: Snap[];
  audio: AudioProbe;
  errors: string[];
  /** distinct (day, night) pairs entered */
  nightsEntered: number;
  peakHeapMB: number | null;
  minFps: number;
  avgFps: number;
}

/* ===========================================================================
 * The in-page probe.
 *
 * Installed with addInitScript, so it patches the Web Audio API *before* any
 * game code runs. It is deliberately black-box: it never touches a game
 * symbol, so it works identically against the dev server and the built,
 * minified bundle that GitHub Pages actually serves.
 *
 * Why these particular counters:
 *   audio.ts renders its drum hat as burst(t, 0.04, 8000, 1, gain, 'highpass'),
 *   and `hat()` is private, is not one of the SFX step primitives
 *   (tone|burst|blip|kick|roar), and is reachable ONLY from the
 *   `if (d.drums)` branch of the music scheduler. `drums: true` appears on
 *   exactly one row of the MOODS table: 'boss'.
 *
 *   So: a highpass biquad at 8000Hz can only mean the boss soundtrack is
 *   playing. "Zero hats while no boss is hunting" is a mechanical, black-box
 *   restatement of the rule the user set after the X2 rollback — drums are for
 *   world bosses only — and it can now be asserted forever instead of
 *   listened for by hand.
 * ======================================================================== */
function probe() {
  const A: any = {
    oscillators: 0,
    waves: {} as Record<string, number>,
    hats: 0,
    kicks: 0,
    bufferSources: 0,
  };
  (window as any).__audioProbe = A;

  const BAC = (window as any).BaseAudioContext?.prototype ?? (window as any).AudioContext?.prototype;
  if (!BAC) return;

  const osc0 = BAC.createOscillator;
  BAC.createOscillator = function (this: any) {
    const node = osc0.call(this);
    A.oscillators++;
    // The caller configures .type and any frequency ramp synchronously right
    // after creation, so read it back one microtask later, fully built.
    queueMicrotask(() => {
      try { A.waves[node.type] = (A.waves[node.type] ?? 0) + 1; } catch { /* node may be gone */ }
    });
    // kick() is the only voice that ramps an oscillator down to exactly 45Hz
    const ramp0 = node.frequency.exponentialRampToValueAtTime.bind(node.frequency);
    node.frequency.exponentialRampToValueAtTime = (v: number, t: number) => {
      if (v === 45) A.kicks++;
      return ramp0(v, t);
    };
    return node;
  };

  const biq0 = BAC.createBiquadFilter;
  BAC.createBiquadFilter = function (this: any) {
    const node = biq0.call(this);
    queueMicrotask(() => {
      try {
        if (node.type === 'highpass' && Math.round(node.frequency.value) === 8000) A.hats++;
      } catch { /* ignore */ }
    });
    return node;
  };

  const buf0 = BAC.createBufferSource;
  BAC.createBufferSource = function (this: any) { A.bufferSources++; return buf0.call(this); };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===========================================================================
 * The page object. One instance = one live game.
 * ======================================================================== */
export class Nightward {
  private held = new Set<string>();
  private t0 = 0;
  /** game-originated errors — these fail the run */
  readonly errors: string[] = [];
  /**
   * Cross-origin failures. The game measures real latency to ~14 public
   * endpoints as a mechanic (see data/network.ts), and every one of them can
   * rate-limit, block or time out on any given day — ipapi.co returns 429
   * readily. Those are environmental, and network.ts already fails silently on
   * them by design, so they are recorded and attached but never fail a run.
   */
  readonly externalErrors: string[] = [];
  readonly samples: Snap[] = [];
  private rng: () => number;

  private constructor(readonly page: Page, readonly seed: number) {
    this.rng = mulberry32(seed ^ 0x9e3779b9);
  }

  /** Must be called before page.goto() — installs the Web Audio probe. */
  static async installProbe(page: Page) {
    await page.addInitScript(probe);
  }

  /**
   * Boot the game and refuse to proceed unless it is genuinely running.
   *
   * The frames precondition is the important part. A Chromium window that is
   * occluded or backgrounded stops firing requestAnimationFrame; the page
   * still loads, __nw still exists, every counter still reads, and every one
   * of them reads zero — a full sheet of green that means nothing. This exact
   * failure mode produced a false PASS during the 2026-08-14 audio
   * verification. Launch flags reduce the risk; only this check rules it out.
   */
  static async boot(page: Page, opts: { seed?: number; gl?: boolean; extra?: string } = {}) {
    const seed = opts.seed ?? 1234;
    const q = new URLSearchParams();
    q.set('seed', String(seed));
    if (opts.gl) q.set('gl', '');
    const url = `/?${q.toString()}${opts.extra ? '&' + opts.extra : ''}`;

    const nw = new Nightward(page, seed);

    page.on('pageerror', (e) => nw.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (BENIGN.some((re) => re.test(text))) return;
      // Attribute the error to whoever actually produced it. Anything that did
      // not come from our own origin is a third-party beacon, not the game.
      const src = m.location()?.url ?? '';
      const ours = !src || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(src);
      (ours ? nw.errors : nw.externalErrors).push(`console.error: ${text}${src ? `  [${src}]` : ''}`);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as any).__nw?.state, null, { timeout: 60_000 });

    // A real player's first interaction. Also satisfies the autoplay gate that
    // main.ts puts in front of Sound.init().
    await page.mouse.move(640, 400);
    await page.keyboard.press('Shift');

    const f1 = await nw.frames();
    await page.waitForTimeout(1200);
    const f2 = await nw.frames();
    expect(
      f2,
      `render loop is not advancing (frames ${f1} → ${f2}). Every frame-derived ` +
      `measurement below would silently read zero and the run would "pass". ` +
      `Check the anti-throttling launch flags in playwright.config.ts.`,
    ).toBeGreaterThan(f1);

    // remember where the run began, so profiles can be told to stay or leave
    await page.evaluate(() => {
      const p = (window as any).__nw.state.player;
      (window as any).__qaHome = { x: p.x, y: p.y };
    });

    nw.t0 = Date.now();
    return nw;
  }

  frames(): Promise<number> {
    return this.page.evaluate(() => (window as any).__nw?.frames ?? 0);
  }

  /** The state projection. Deliberately small — this runs ~4×/second. */
  async snap(): Promise<Snap> {
    const raw = await this.page.evaluate(() => {
      const w = window as any;
      const nw = w.__nw, CFG = w.NW?.CFG;
      const s = nw.state, p = s.player;
      const foes = nw.sys.hordes?.foes ?? [];

      const unit = (dx: number, dy: number) => {
        const l = Math.hypot(dx, dy) || 1;
        return { x: dx / l, y: dy / l };
      };

      let nf: number | null = null, fd: { x: number; y: number } | null = null;
      for (const f of foes) {
        const dx = (f.x ?? 0) - p.x, dy = (f.y ?? 0) - p.y;
        const d = Math.hypot(dx, dy);
        if (nf === null || d < nf) { nf = d; fd = unit(dx, dy); }
      }
      let nb: number | null = null, bd: { x: number; y: number } | null = null, hunting = false;
      for (const b of s.worldBosses ?? []) {
        if (b.reviveAt !== 0) continue;
        if (b.hunting) hunting = true;
        const dx = b.x - p.x, dy = b.y - p.y;
        const d = Math.hypot(dx, dy);
        if (nb === null || d < nb) { nb = d; bd = unit(dx, dy); }
      }

      let threat: number | null = null;
      try { threat = nw.sys.worldbosses?.nearestThreatTiles?.() ?? null; } catch { /* ignore */ }

      const home = w.__qaHome ?? { x: p.x, y: p.y };
      const hdx = home.x - p.x, hdy = home.y - p.y;

      const g = nw.sys.gather;
      const cy = (CFG?.time?.daySec ?? 240) + (CFG?.time?.nightSec ?? 100);
      let invTotal = 0, invKinds = 0;
      for (const k in p.inv) { invKinds++; invTotal += p.inv[k]; }

      return {
        clock: s.clock,
        day: Math.floor(s.clock / cy) + 1,
        night: !!nw.ctx?.isNight?.(),
        hp: p.hp,
        hpFrac: p.hp / (CFG?.player?.maxHp ?? 100),
        gold: p.gold,
        x: p.x, y: p.y,
        vigor: p.vigor, resolve: p.resolve, age: p.age,
        foes: foes.length,
        nearestFoe: nf,
        foeDir: fd,
        bossHunting: hunting,
        nearestBoss: nb,
        bossDir: bd,
        bossThreatTiles: threat === null ? null : +threat.toFixed(1),
        warnTiles: CFG?.worldBoss?.warnTiles ?? 0,
        homeDist: Math.hypot(hdx, hdy),
        homeDir: unit(hdx, hdy),
        gatherTarget: g?.target?.def?.name ?? null,
        gathering: !!g?.active,
        building: !!nw.sys.build?.mode,
        invKinds, invTotal,
        buildings: s.buildings.length,
        nightsSurvived: s.nightsSurvived,
        gameOver: !!s.gameOver,
        frames: nw.frames,
        heapMB: (performance as any).memory
          ? +((performance as any).memory.usedJSHeapSize / 1048576).toFixed(1)
          : null,
      };
    });
    return { t: (Date.now() - this.t0) / 1000, ...raw } as Snap;
  }

  async audio(): Promise<AudioProbe> {
    return this.page.evaluate(() => {
      const a = (window as any).__audioProbe;
      return a
        ? { oscillators: a.oscillators, waves: { ...a.waves }, hats: a.hats, kicks: a.kicks, bufferSources: a.bufferSources }
        : { oscillators: 0, waves: {}, hats: 0, kicks: 0, bufferSources: 0 };
    });
  }

  /**
   * Sample the audio probe alongside the two conditions that are allowed to
   * change the mood, at a few Hz, entirely in-page (no round-trip jitter).
   *
   * `bossTiles` comes from worldbosses.nearestThreatTiles() — the very call
   * main.ts uses to compute `bossNear` — so the series can be compared against
   * CFG.worldBoss.warnTiles without re-deriving anything.
   */
  async watchAudio(seconds: number, hz = 4) {
    return this.page.evaluate(
      async ({ seconds, hz }) => {
        const w = window as any;
        const TILE = 32;
        const warnTiles = w.NW?.CFG?.worldBoss?.warnTiles ?? 0;
        const out: Array<{
          t: number; hats: number; kicks: number;
          bossTiles: number | null; foes: number; nearestFoeTiles: number | null;
        }> = [];
        const t0 = performance.now();
        while (performance.now() - t0 < seconds * 1000) {
          const a = w.__audioProbe, nw = w.__nw, p = nw.state.player;
          let bossTiles: number | null = null;
          try { bossTiles = nw.sys.worldbosses?.nearestThreatTiles?.() ?? null; } catch { /* ignore */ }
          const foes = nw.sys.hordes?.foes ?? [];
          let nf: number | null = null;
          for (const f of foes) {
            const d = Math.hypot((f.x ?? 0) - p.x, (f.y ?? 0) - p.y) / TILE;
            if (nf === null || d < nf) nf = d;
          }
          out.push({
            t: +((performance.now() - t0) / 1000).toFixed(2),
            hats: a.hats, kicks: a.kicks,
            bossTiles: bossTiles === null ? null : +bossTiles.toFixed(1),
            foes: foes.length,
            nearestFoeTiles: nf === null ? null : +nf.toFixed(1),
          });
          await new Promise((r) => setTimeout(r, 1000 / hz));
        }
        return { warnTiles, series: out };
      },
      { seconds, hz },
    );
  }

  /**
   * Put the world into the exact situation the user's soundtrack rule is
   * about: night, a horde on the field, a foe right next to the player, and
   * every world boss pushed out of threat range.
   */
  async provokeOrdinaryCombat() {
    return this.page.evaluate(async () => {
      const w = window as any;
      const nw = w.__nw, CFG = w.NW?.CFG, s = nw.state, p = s.player;
      const cy = (CFG.time.daySec ?? 240) + (CFG.time.nightSec ?? 100);
      // jump the clock just past dusk; main.ts's wasNight edge fires onDusk
      s.clock = Math.floor(s.clock / cy) * cy + CFG.time.daySec + 2;

      // shove every world boss far away and call off the hunt, so `bossNear`
      // cannot be what changes the mood
      for (const b of s.worldBosses ?? []) {
        b.hunting = false;
        b.provokedUntil = 0;
        b.x = p.x + 40000;
        b.y = p.y + 40000;
      }

      // wait for the horde to actually field something
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        if ((nw.sys.hordes?.foes ?? []).length > 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const foes = nw.sys.hordes?.foes ?? [];
      if (!foes.length) return { ok: false, foes: 0, reason: 'no horde spawned within 20s of dusk' };

      // park one right on top of the player — 0 tiles away, unambiguously "near"
      foes[0].x = p.x + 8;
      foes[0].y = p.y;
      return { ok: true, foes: foes.length, reason: '' };
    });
  }

  /* ------------------------------------------------------------ input ---- */

  /** Convert an analogue direction into the WASD keys a human would be holding. */
  private keysFor(move?: { x: number; y: number }): Set<string> {
    const out = new Set<string>();
    if (!move) return out;
    if (move.x > 0.3) out.add('d'); else if (move.x < -0.3) out.add('a');
    if (move.y > 0.3) out.add('s'); else if (move.y < -0.3) out.add('w');
    return out;
  }

  /** Apply one beat of intent as real DOM key/mouse events, then wait it out. */
  async perform(a: Act) {
    const want = this.keysFor(a.move);
    for (const k of [...this.held]) if (!want.has(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of want) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); }

    for (const k of a.tap ?? []) {
      await this.page.keyboard.press(k === ' ' ? 'Space' : k);
      // a human can't chord two action keys in the same millisecond
      await this.page.waitForTimeout(40 + Math.floor(this.rng() * 60));
    }
    if (a.click) await this.page.mouse.click(640, 400);

    // reaction-time jitter, seeded so a given profile+seed replays identically
    const base = a.hold ?? 250;
    await this.page.waitForTimeout(Math.round(base * (0.75 + this.rng() * 0.5)));
  }

  async releaseAll() {
    for (const k of [...this.held]) { await this.page.keyboard.up(k); this.held.delete(k); }
  }

  /* -------------------------------------------------------- the session -- */

  /**
   * Play a profile for its full duration in real wall-clock time, sampling the
   * world once a second. Returns when the time is up OR the run ends (death /
   * old age) — whichever comes first; the caller decides which was expected.
   */
  async play(profile: Profile, onSample?: (s: Snap) => void): Promise<RunSummary> {
    const endAt = Date.now() + profile.minutes * 60_000;
    let lastSampleT = -1;

    while (Date.now() < endAt) {
      const s = await this.snap();
      if (s.t - lastSampleT >= 1) {
        this.samples.push(s);
        lastSampleT = s.t;
        onSample?.(s);
      }
      if (s.gameOver) break;
      await this.perform(profile.act(s, this.rng));
    }
    await this.releaseAll();
    return this.summarize(profile);
  }

  async summarize(profile: Profile): Promise<RunSummary> {
    const s = this.samples;
    let nightsEntered = 0;
    for (let i = 1; i < s.length; i++) if (s[i].night && !s[i - 1].night) nightsEntered++;

    const fps: number[] = [];
    for (let i = 1; i < s.length; i++) {
      const dt = s[i].t - s[i - 1].t;
      if (dt > 0) fps.push((s[i].frames - s[i - 1].frames) / dt);
    }
    const heaps = s.map((x) => x.heapMB).filter((x): x is number => x !== null);

    return {
      profile: profile.name,
      seed: this.seed,
      realSeconds: s.length ? s[s.length - 1].t : 0,
      samples: s,
      audio: await this.audio(),
      errors: [...this.errors],
      nightsEntered,
      peakHeapMB: heaps.length ? Math.max(...heaps) : null,
      minFps: fps.length ? +Math.min(...fps).toFixed(1) : 0,
      avgFps: fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : 0,
    };
  }

  /* ------------------------------------------------- the Gauntlet (L2) --- */

  /** Run the in-game regression suite in this real browser. */
  async gauntlet(): Promise<{ pass: number; fail: number; total: number; report: string }> {
    return this.page.evaluate(() => (window as any).__nw.regression.run());
  }
}

/**
 * Console noise that belongs to the browser, not the game. Kept deliberately
 * tight — anything not on this list fails the run.
 *   - favicon: the page has no icon file
 *   - ERR_BLOCKED_BY_CLIENT: the browser's own telemetry endpoints
 *   - WebGPU/WebGL adapter chatter on software rasterizers
 */
const BENIGN: RegExp[] = [
  /favicon\.ico/i,
  /ERR_BLOCKED_BY_CLIENT/,
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_REFUSED)/,
  /Automatic fallback to software WebGL/i,
  /GroupMarkerNotSet/,
  /Failed to create WebGPU Context Provider/i,
];
