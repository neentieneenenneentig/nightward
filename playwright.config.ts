import { defineConfig, devices } from '@playwright/test';

/**
 * NIGHTWARD QA harness.
 *
 * This is layer 3 of the test pyramid and it exists to catch what the other two
 * structurally cannot:
 *
 *   L1  cargo test / tsc / vite build     — static, no browser
 *   L2  the Gauntlet (regression.ts)      — game logic, driven by __nw.step(),
 *                                           no rAF, no input, no real time
 *   L3  this                              — a real browser, real keystrokes,
 *                                           real wall-clock, and the REAL BUILT
 *                                           BUNDLE rather than the dev server
 *
 * That last point is the one that matters most: `.github/workflows/deploy.yml`
 * publishes `dist/` to GitHub Pages, and until now nothing had ever loaded
 * `dist/` in a browser. The default target here is therefore `vite preview`
 * over a fresh build, not `vite dev`.
 *
 * Env overrides:
 *   NW_BASE_URL=http://localhost:5199   test an already-running server (skips webServer)
 *   NW_SKIP_BUILD=1                     preview the existing dist/ without rebuilding
 */

const PORT = 4173;
const BASE = process.env.NW_BASE_URL || `http://127.0.0.1:${PORT}`;

/**
 * Chromium flags. The first three are not optional and not cosmetic: an
 * occluded or backgrounded Chromium stops firing requestAnimationFrame, which
 * silently zeroes every frame-derived measurement while the run still reports
 * a pass. That exact failure produced a full sheet of green zeroes during the
 * audio verification on 2026-08-14. The boot fixture also asserts frames are
 * advancing, because flags alone are not proof.
 */
const CHROME_ARGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  // audio: the game gates Sound.init() behind a user gesture, and we want the
  // scheduler actually running so the soundtrack can be asserted on.
  '--autoplay-policy=no-user-gesture-required',
];

/** Software rasterizer, so the WebGL lane is identical on a dev box and on a CI runner with no GPU. */
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: './qa/specs',
  outputDir: './qa/.artifacts',
  // A playthrough is real-time and the game's own hard cap is ~15 minutes (L1),
  // so per-test timeouts are generous. Individual expects stay short.
  timeout: 20 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: false,       // one game at a time — these are CPU/GPU heavy
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,                 // a flaky QA gate is worse than no gate; fix the flake
  reporter: [
    ['list'],
    ['html', { outputFolder: 'qa/.report', open: 'never' }],
    ['json', { outputFile: 'qa/.report/results.json' }],
  ],

  use: {
    baseURL: BASE,
    // Traces are the point of the exercise — a full timeline with per-action
    // DOM snapshots, console, and network, scrubable in `npx playwright show-trace`.
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
  },

  projects: [
    /* ---- the everywhere lane: WebGL + software raster, runs headless on CI ---- */
    {
      name: 'webgl',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: [...CHROME_ARGS, ...SWIFTSHADER] },
      },
    },

    /* ---- the real-renderer lane: WebGPU, the path an actual player gets ----
     * Needs the full browser rather than the headless shell, so it runs headed.
     * Local + nightly; on CI it needs xvfb. */
    {
      name: 'webgpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        headless: false,
        launchOptions: { args: CHROME_ARGS },
      },
    },

    /* ---- the graceful-degradation lane ----
     * Firefox has no navigator.connection at all, which is WORKFLOW.md Pitfall 5.
     * That fallback path has only ever been checked by hand. */
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: process.env.NW_BASE_URL
    ? undefined
    : {
        command: process.env.NW_SKIP_BUILD
          ? `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`
          : `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
        url: BASE,
        timeout: 300_000,   // the wasm-pack + vite build runs inside this
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
