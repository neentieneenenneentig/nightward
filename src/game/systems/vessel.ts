// ============================================================================
// N4.6 — The Deep Vessel.
//
// Every other N4 phase measures the WIRE: what happens to a packet between here
// and somewhere else. This one measures the VESSEL — the machine and the browser
// the run is happening inside. No packets, no permission prompts, no beacons.
// Every read below is available to any page, synchronously or through a promise
// that resolves locally, and the whole file can be deleted without touching a
// single network path.
//
// ---------------------------------------------------------------------------
// Why this is worth a milestone when it sends nothing
// ---------------------------------------------------------------------------
//
// N4.1 proved the wire could be measured properly instead of inferred. The same
// argument applies inward and has been sitting unclaimed the whole time: the
// game currently guesses at load from `performance.memory.usedJSHeapSize`,
// which is a Chrome-only proxy for a thing Chrome will simply tell us. It reads
// WebGL's `RENDERER`, which on most machines returns a vendor-scrubbed string
// like "ANGLE (Intel, Intel(R) UHD Graphics...)" or, on Safari, the
// magnificently uninformative "WebKit WebGL". It has never asked how much disk
// is left, what the audio pipeline is doing, or whether the main thread is
// actually stalling.
//
// Three of those turn into real game inputs (see the NET_GAME_MAP rows this
// milestone adds). The rest are Lens content, which is a legitimate consumer in
// this codebase — `locale` has said "surfaced for the Lens only" since X1 and
// that is an honest row, not a dormant one. What would be dormant is a field
// nothing reads AT ALL, and there are none of those here.
//
// ---------------------------------------------------------------------------
// Pillar 5 in the sharpest form it takes anywhere
// ---------------------------------------------------------------------------
//
// This file runs on Safari, on Firefox, on a locked-down enterprise Chrome, and
// in a headless browser with half the APIs stubbed. Nearly every read here is
// Chromium-only or behind an origin trial somewhere. So every field carries an
// explicit `unknown` state, every fallback is the NEUTRAL value, and the Lens
// prints "unavailable" rather than a plausible-looking zero. A browser that
// tells us nothing must play exactly the same game as one that tells us
// everything — and here, unusually, that is the common case rather than the
// edge case.
//
// ---------------------------------------------------------------------------
// And one thing this file does NOT do
// ---------------------------------------------------------------------------
//
// It does not fingerprint. Every value stays in this tab, is never transmitted,
// and dies with the page — the same rule the rest of N4 follows. The reason to
// say that out loud is that this specific list of APIs is, verbatim, the list a
// fingerprinting script would read. The difference is entirely in what happens
// next, so the difference has to be written down where the next reader will
// find it: nothing here leaves the machine, and nothing here is persisted.
// ============================================================================

/** CPU pressure, as PressureObserver reports it. Ordered least → worst so the
 *  index doubles as the severity scale. */
export const PRESSURE_STATES = ['nominal', 'fair', 'serious', 'critical'] as const;
export type PressureState = typeof PRESSURE_STATES[number];

export interface VesselReading {
  // ---- identity of the machine -------------------------------------------
  /** navigator.userAgentData high-entropy: OS platform, e.g. 'Windows'. */
  platform: string;
  /** OS version string, e.g. '15.0.0'. Empty when unavailable. */
  platformVersion: string;
  /** CPU architecture, e.g. 'x86' / 'arm'. Empty when unavailable. */
  architecture: string;
  /** '64' / '32'. Empty when unavailable. */
  bitness: string;
  /** Device model — populated on Android, empty on desktop. */
  model: string;
  /** True if the browser answered getHighEntropyValues at all. Everything above
   *  is empty on Firefox and Safari, and empty must not read as "32-bit". */
  uaDeep: boolean;

  // ---- the GPU, actually named -------------------------------------------
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL, or the plain RENDERER
   *  where the extension is withheld. */
  gpuRenderer: string;
  /** UNMASKED_VENDOR_WEBGL. */
  gpuVendor: string;
  /** WebGPU adapter.info, when the adapter exists. Strictly better than the
   *  WebGL strings where present — a real vendor/architecture/device triple
   *  instead of a marketing name inside parentheses. */
  gpuArchitecture: string;
  /** True when the unmasked extension answered. Chrome withholds it under some
   *  privacy settings, and a scrubbed string is not a measurement. */
  gpuUnmasked: boolean;

  // ---- headroom -----------------------------------------------------------
  /** navigator.storage.estimate().quota, bytes. 0 = unavailable. */
  storageQuota: number;
  /** …usage, bytes. */
  storageUsage: number;
  /** Free fraction of the quota, 0..1. 1 when unavailable — the neutral value,
   *  because "we could not ask" must never present as "the disk is full". */
  storageFreeFrac: number;

  // ---- the audio pipeline -------------------------------------------------
  /** AudioContext.sampleRate, Hz. 0 = no context yet. */
  sampleRate: number;
  /** baseLatency, seconds — the buffer the browser holds. */
  baseLatency: number;
  /** outputLatency, seconds — buffer plus the OS/driver path. Chromium only. */
  outputLatency: number;

  // ---- load, first-party --------------------------------------------------
  /** The last PressureObserver 'cpu' state, or 'unknown'. */
  pressure: PressureState | 'unknown';
  /** 0..1 severity from the above. 0 when unknown — neutral, see below. */
  pressureFrac: number;
  /** Longest long-animation-frame seen in the rolling window, ms. 0 = none
   *  observed, which on a healthy machine is also the true answer. */
  jankMs: number;
  /** How many LoAF entries landed in the window. */
  jankCount: number;
  /** Did LoAF report at all? Distinguishes "smooth" from "not supported",
   *  which are the same 0 and very much not the same fact. */
  jankLive: boolean;

  // ---- what is plugged in -------------------------------------------------
  /** enumerateDevices() counts. Labels are blank without permission and we
   *  never ask for permission, so counts are the entire yield — which is
   *  plenty, and is also why this needs no consent flow. */
  audioIn: number;
  audioOut: number;
  videoIn: number;
  devicesLive: boolean;

  // ---- the display --------------------------------------------------------
  screenW: number;
  screenH: number;
  dpr: number;
  /** matchMedia('(dynamic-range: high)') — an HDR-capable panel. */
  hdr: boolean;
  /** The panel's colour gamut: 'srgb' | 'p3' | 'rec2020'. */
  gamut: string;

  // ---- what the browser is asking for -------------------------------------
  reducedMotion: boolean;
  colorScheme: 'light' | 'dark';
  highContrast: boolean;
  forcedColors: boolean;

  // ---- what the browser is telling the world ------------------------------
  /** navigator.globalPrivacyControl — the successor to DNT that sites actually
   *  have to honour in some jurisdictions. */
  gpc: boolean;
  doNotTrack: boolean;
  cookiesEnabled: boolean;
  /** crossOriginIsolated — COOP/COEP, which gates SharedArrayBuffer and the
   *  high-resolution timers this project would need for a real audio worklet. */
  isolated: boolean;

  // ---- the locale, in full ------------------------------------------------
  locale: string;
  languages: string[];
  timeZone: string;
  calendar: string;
  numberingSystem: string;
}

/** Everything unknown, everything neutral. This IS the Safari reading, and it
 *  has to be a perfectly playable one. */
export function neutralVessel(): VesselReading {
  return {
    platform: '', platformVersion: '', architecture: '', bitness: '', model: '',
    uaDeep: false,
    gpuRenderer: '', gpuVendor: '', gpuArchitecture: '', gpuUnmasked: false,
    storageQuota: 0, storageUsage: 0, storageFreeFrac: 1,
    sampleRate: 0, baseLatency: 0, outputLatency: 0,
    pressure: 'unknown', pressureFrac: 0, jankMs: 0, jankCount: 0, jankLive: false,
    audioIn: 0, audioOut: 0, videoIn: 0, devicesLive: false,
    screenW: 0, screenH: 0, dpr: 1, hdr: false, gamut: 'srgb',
    reducedMotion: false, colorScheme: 'dark', highContrast: false, forcedColors: false,
    gpc: false, doNotTrack: false, cookiesEnabled: true, isolated: false,
    locale: 'en-US', languages: [], timeZone: 'UTC',
    calendar: 'gregory', numberingSystem: 'latn',
  };
}

/** Seconds of LoAF history kept. Short, because the number the game wants is
 *  "is this machine stuttering NOW" and a peak from ninety seconds ago is a
 *  memory, not a measurement. */
const JANK_WINDOW_SEC = 20;

export class Vessel {
  reading: VesselReading = neutralVessel();
  /** Set once the async half (storage, devices, WebGPU) has resolved. Until
   *  then the sync half is already populated — nothing waits on a promise to
   *  become playable. */
  ready = false;

  private jank: { at: number; ms: number }[] = [];
  private pressureObs: any = null;
  private loafObs: any = null;
  private started = false;

  /** Read everything readable. Safe to call more than once; the observers
   *  install exactly once and the synchronous reads simply refresh.
   *
   *  Never throws. Every probe is individually wrapped, because these APIs fail
   *  in genuinely creative ways — `matchMedia` with an unknown feature throws
   *  in older Safari, `enumerateDevices` rejects under a permissions policy,
   *  and `PressureObserver` exists but throws on `observe()` when the origin
   *  trial has expired. One bad probe must not cost the other twenty. */
  start(audioCtx?: { sampleRate?: number; baseLatency?: number; outputLatency?: number } | null) {
    this.readSync(audioCtx);
    if (!this.started) {
      this.started = true;
      this.observePressure();
      this.observeJank();
      void this.readAsync();
    }
  }

  /** Everything available without a promise. Cheap enough to re-run on a poll:
   *  the display and preference reads are the ones that actually change during
   *  a session (a window dragged to a second monitor, a theme switched, an
   *  accessibility setting toggled mid-run). */
  readSync(audioCtx?: { sampleRate?: number; baseLatency?: number; outputLatency?: number } | null) {
    const r = this.reading;

    try {
      const mm = (q: string) => { try { return matchMedia(q).matches; } catch { return false; } };
      r.reducedMotion = mm('(prefers-reduced-motion: reduce)');
      r.colorScheme = mm('(prefers-color-scheme: light)') ? 'light' : 'dark';
      r.highContrast = mm('(prefers-contrast: more)');
      r.forcedColors = mm('(forced-colors: active)');
      r.hdr = mm('(dynamic-range: high)');
      r.gamut = mm('(color-gamut: rec2020)') ? 'rec2020' : mm('(color-gamut: p3)') ? 'p3' : 'srgb';
    } catch { /* neutral */ }

    try {
      r.screenW = screen?.width ?? 0;
      r.screenH = screen?.height ?? 0;
      r.dpr = devicePixelRatio || 1;
    } catch { /* neutral */ }

    try {
      const nav = navigator as any;
      r.gpc = nav.globalPrivacyControl === true;
      r.doNotTrack = nav.doNotTrack === '1' || nav.doNotTrack === 'yes';
      r.cookiesEnabled = nav.cookieEnabled !== false;
      r.isolated = (globalThis as any).crossOriginIsolated === true;
      r.languages = Array.isArray(nav.languages) ? nav.languages.slice(0, 6) : [];
      r.locale = nav.language || r.locale;
    } catch { /* neutral */ }

    try {
      const o = Intl.DateTimeFormat().resolvedOptions();
      r.timeZone = o.timeZone || r.timeZone;
      r.calendar = (o as any).calendar || r.calendar;
      r.numberingSystem = (o as any).numberingSystem || r.numberingSystem;
    } catch { /* neutral */ }

    // The AudioContext is passed IN rather than constructed here. The engine
    // already owns one, a second would be a second hardware pipeline for no
    // reason, and constructing one before a user gesture leaves it suspended —
    // at which point `outputLatency` reads 0 and we would have recorded a
    // fabricated measurement instead of an honest absence.
    if (audioCtx) {
      try {
        r.sampleRate = audioCtx.sampleRate ?? 0;
        r.baseLatency = audioCtx.baseLatency ?? 0;
        r.outputLatency = audioCtx.outputLatency ?? 0;
      } catch { /* neutral */ }
    }

    this.readGpu();
  }

  /** The GPU, named. Two sources, and the better one wins where it exists.
   *
   *  WEBGL_debug_renderer_info is the classic route and is what everything on
   *  the web uses; Chrome has been threatening to restrict it for years and
   *  already withholds it under some privacy configurations, which is exactly
   *  why `gpuUnmasked` is a separate field. A scrubbed "WebKit WebGL" is not a
   *  weaker measurement, it is the ABSENCE of one, and the Lens has to be able
   *  to say which it got. */
  private readGpu() {
    const r = this.reading;
    if (r.gpuRenderer) return;  // one canvas per session is plenty
    try {
      const c = document.createElement('canvas');
      const gl: any = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        r.gpuRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
        r.gpuVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '');
        r.gpuUnmasked = !!r.gpuRenderer;
      }
      if (!r.gpuRenderer) {
        r.gpuRenderer = String(gl.getParameter(gl.RENDERER) ?? '');
        r.gpuVendor = String(gl.getParameter(gl.VENDOR) ?? '');
      }
      // Release the context immediately. Browsers cap live WebGL contexts (16
      // in Chrome) and the game owns one it very much needs to keep.
      gl.getExtension('WEBGL_lose_context')?.loseContext?.();
    } catch { /* neutral */ }
  }

  /** The promise-shaped half: high-entropy UA, storage, media devices, WebGPU
   *  adapter info. Fire-and-forget — nothing in the game waits for it. */
  private async readAsync() {
    const r = this.reading;

    try {
      const uaData = (navigator as any).userAgentData;
      if (uaData?.getHighEntropyValues) {
        const v = await uaData.getHighEntropyValues([
          'platform', 'platformVersion', 'architecture', 'bitness', 'model',
        ]);
        r.platform = v.platform ?? '';
        r.platformVersion = v.platformVersion ?? '';
        r.architecture = v.architecture ?? '';
        r.bitness = v.bitness ?? '';
        r.model = v.model ?? '';
        r.uaDeep = !!v.platform;
      }
    } catch { /* neutral */ }

    try {
      const est = await (navigator as any).storage?.estimate?.();
      if (est?.quota) {
        r.storageQuota = est.quota;
        r.storageUsage = est.usage ?? 0;
        r.storageFreeFrac = Math.max(0, Math.min(1, 1 - (est.usage ?? 0) / est.quota));
      }
    } catch { /* neutral */ }

    try {
      const devs = await (navigator as any).mediaDevices?.enumerateDevices?.();
      if (Array.isArray(devs)) {
        r.audioIn = devs.filter((d: any) => d.kind === 'audioinput').length;
        r.audioOut = devs.filter((d: any) => d.kind === 'audiooutput').length;
        r.videoIn = devs.filter((d: any) => d.kind === 'videoinput').length;
        r.devicesLive = true;
      }
    } catch { /* neutral */ }

    try {
      const adapter = await (navigator as any).gpu?.requestAdapter?.();
      const info = adapter?.info ?? (await adapter?.requestAdapterInfo?.());
      if (info) {
        r.gpuArchitecture = [info.vendor, info.architecture, info.device]
          .filter(Boolean).join(' ').trim();
        // WebGPU's adapter info is not privacy-scrubbed the way the WebGL
        // extension is, so where it answers it is the AUTHORITATIVE name and
        // supersedes whatever the canvas said.
        if (r.gpuArchitecture && !r.gpuUnmasked) {
          r.gpuRenderer = r.gpuArchitecture;
          r.gpuVendor = info.vendor ?? r.gpuVendor;
          r.gpuUnmasked = true;
        }
      }
    } catch { /* neutral */ }

    this.ready = true;
  }

  /** PressureObserver: a first-party CPU load signal.
   *
   *  This is the single most valuable read in the file. The game has inferred
   *  load from JS heap size since X1, which measures how much this tab has
   *  allocated and says nothing whatsoever about whether the MACHINE is
   *  struggling — a tab holding 300 MB on an idle workstation looked identical
   *  to one thrashing on a fanless laptop. PressureObserver is the OS telling
   *  the browser telling us, directly. */
  private observePressure() {
    try {
      const PO = (globalThis as any).PressureObserver;
      if (!PO) return;
      this.pressureObs = new PO((records: any[]) => {
        const last = records[records.length - 1];
        if (!last?.state) return;
        const i = PRESSURE_STATES.indexOf(last.state);
        if (i < 0) return;
        this.reading.pressure = last.state;
        // 0 at nominal so an unpressured machine and an unmeasured one produce
        // the same neutral number, and only a REAL 'fair' or worse moves the
        // game. That is pillar 5 stated as arithmetic.
        this.reading.pressureFrac = i / (PRESSURE_STATES.length - 1);
      });
      // sampleInterval is a hint; the spec rate-limits this hard regardless,
      // which is fine — thermal state does not change in 200 ms.
      this.pressureObs.observe('cpu', { sampleInterval: 2000 })?.catch?.(() => {});
    } catch { /* neutral */ }
  }

  /** Long Animation Frames: real main-thread stalls, with the browser's own
   *  definition of "long" (>50 ms) rather than a frame-time threshold we made
   *  up. Strictly better than counting slow rAF callbacks, because a stall that
   *  happens BETWEEN frames never shows up in rAF timing at all. */
  private observeJank() {
    try {
      const PO = (globalThis as any).PerformanceObserver;
      if (!PO?.supportedEntryTypes?.includes?.('long-animation-frame')) return;
      this.loafObs = new PO((list: any) => {
        const now = performance.now() / 1000;
        for (const e of list.getEntries()) this.jank.push({ at: now, ms: e.duration ?? 0 });
        this.reading.jankLive = true;
      });
      this.loafObs.observe({ type: 'long-animation-frame', buffered: true });
      this.reading.jankLive = true;
    } catch { /* neutral */ }
  }

  /** Roll the jank window forward and recompute the peak. Called from the
   *  network system's sensor poll, so this file owns no timer of its own —
   *  a second polling loop for one number is exactly the kind of machinery
   *  that outlives the reason for it. */
  tick() {
    if (!this.reading.jankLive) return;
    const cut = performance.now() / 1000 - JANK_WINDOW_SEC;
    if (this.jank.length && this.jank[0].at < cut) this.jank = this.jank.filter((j) => j.at >= cut);
    let peak = 0;
    for (const j of this.jank) if (j.ms > peak) peak = j.ms;
    this.reading.jankMs = peak;
    this.reading.jankCount = this.jank.length;
  }

  /** Stop observing. The page teardown does this for us, but a system that
   *  installs two global observers should be able to uninstall them — the
   *  Gauntlet creates worlds in a loop and leaked observers accumulate. */
  stop() {
    try { this.pressureObs?.disconnect?.(); } catch { /* ignore */ }
    try { this.loafObs?.disconnect?.(); } catch { /* ignore */ }
    this.pressureObs = null;
    this.loafObs = null;
    this.started = false;
  }
}

// ---------------------------------------------------------------------------
// The veil translations. Pillar 7: the HUD and the Chronicle name the SENSE,
// never the instrument — so a 'serious' CPU pressure state becomes "the vessel
// labours", and the Lens is the one place allowed to print both.
// ---------------------------------------------------------------------------

export function pressureFiction(p: PressureState | 'unknown'): string {
  switch (p) {
    case 'nominal': return 'the vessel rests easy';
    case 'fair': return 'the vessel is working';
    case 'serious': return 'the vessel labours';
    case 'critical': return 'the vessel is at its limit';
    default: return 'the vessel keeps its counsel';
  }
}

/** A short, honest description of the machine, for the Chronicle's boot line.
 *  Assembled from whatever answered — never a template with holes in it. */
export function vesselLine(r: VesselReading): string {
  const bits: string[] = [];
  if (r.uaDeep) {
    bits.push([r.platform, r.platformVersion].filter(Boolean).join(' ')
      + (r.architecture ? ` (${r.architecture}${r.bitness ? '/' + r.bitness : ''})` : ''));
  }
  if (r.gpuUnmasked && r.gpuRenderer) bits.push(r.gpuRenderer);
  if (r.screenW) bits.push(`${r.screenW}x${r.screenH}@${r.dpr}x${r.hdr ? ' HDR' : ''}`);
  if (r.sampleRate) bits.push(`${(r.sampleRate / 1000).toFixed(1)} kHz`);
  return bits.length ? bits.join(' · ') : 'a vessel that does not name itself';
}
