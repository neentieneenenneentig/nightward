// Procedural audio. Like the art, nothing is hosted: music and every sound
// effect are synthesised live with the Web Audio API. A lookahead scheduler
// plays a slow generative melody over a drone; the "mood" (day / night / boss)
// swaps the scale, tempo and timbre. Must be started from a user gesture.
//
// Learning note: an oscillator makes a pitch, a GainNode shapes its volume
// envelope (fade in/out so notes don't click), and we schedule everything
// against audioCtx.currentTime — a rock-steady audio clock independent of the
// frame rate. That's the whole trick behind browser music.

export type Mood = 'day' | 'night' | 'boss' | 'dead';

interface MoodDef {
  root: number;        // base frequency (Hz)
  scale: number[];     // semitone offsets used for the melody
  beat: number;        // seconds per step
  wave: OscillatorType;
  droneHz: number;     // sustained low tone under it all (0 = none)
  droneGain: number;
  noteGain: number;
  drums: boolean;
}

const semi = (root: number, s: number) => root * Math.pow(2, s / 12);

const MOODS: Record<Mood, MoodDef> = {
  day:   { root: 220.0, scale: [0, 2, 4, 7, 9, 12], beat: 0.60, wave: 'triangle', droneHz: 55,  droneGain: 0.05, noteGain: 0.16, drums: false },
  night: { root: 146.8, scale: [0, 3, 5, 7, 10],    beat: 0.72, wave: 'sine',     droneHz: 49,  droneGain: 0.10, noteGain: 0.13, drums: false },
  boss:  { root: 110.0, scale: [0, 1, 3, 6, 7, 10], beat: 0.34, wave: 'sawtooth', droneHz: 41,  droneGain: 0.14, noteGain: 0.12, drums: true  },
  dead:  { root: 98.0,  scale: [0, 3, 7],           beat: 1.10, wave: 'sine',     droneHz: 44,  droneGain: 0.07, noteGain: 0.10, drums: false },
};

// ---- data-driven SFX: a recipe is a list of steps over the synth primitives
// below (tone/burst/blip/kick/roar). Adding a sound = adding a table row.
type SfxPrimitive = 'tone' | 'burst' | 'blip' | 'kick' | 'roar';

interface SfxStep {
  type: SfxPrimitive;
  at?: number;                 // seconds after the sound starts (default 0)
  hz?: number;
  dur?: number;
  wave?: OscillatorType;
  gain?: number;
  q?: number;                  // burst: filter Q
  filter?: BiquadFilterType;   // burst: filter type (default 'bandpass')
  sweepTo?: number;            // burst: ramp the filter's frequency to this by the end
  bend?: number;               // blip: exponential frequency bend multiplier (default 1)
}

const arp = (root: number, degrees: number[], step: number, dur: number, wave: OscillatorType, gain: number, kind: 'tone' | 'blip' = 'blip'): SfxStep[] =>
  degrees.map((d, i) => ({ type: kind, at: i * step, hz: semi(root, d), dur, wave, gain }));

const SFX: Record<string, SfxStep[]> = {
  chop: [
    { type: 'burst', dur: 0.12, hz: 380, q: 4, gain: 0.5, filter: 'lowpass' },
    { type: 'blip', hz: 150, dur: 0.1, wave: 'triangle', gain: 0.25, bend: 0.6 },
    { type: 'blip', at: 0.05, hz: 110, dur: 0.08, wave: 'triangle', gain: 0.15, bend: 0.7 },
  ],
  chop2: [
    { type: 'burst', dur: 0.1, hz: 340, q: 4, gain: 0.45, filter: 'lowpass' },
    { type: 'blip', hz: 170, dur: 0.09, wave: 'triangle', gain: 0.22, bend: 0.65 },
    { type: 'blip', at: 0.06, hz: 120, dur: 0.07, wave: 'triangle', gain: 0.14, bend: 0.75 },
  ],
  mine: [
    { type: 'blip', hz: 760, dur: 0.06, wave: 'square', gain: 0.2, bend: 0.8 },
    { type: 'blip', at: 0.06, hz: 560, dur: 0.07, wave: 'square', gain: 0.18, bend: 0.7 },
    { type: 'burst', dur: 0.05, hz: 2600, q: 3, gain: 0.15 },
  ],
  mine2: [
    { type: 'blip', hz: 820, dur: 0.05, wave: 'square', gain: 0.18, bend: 0.8 },
    { type: 'blip', at: 0.05, hz: 600, dur: 0.06, wave: 'square', gain: 0.16, bend: 0.7 },
    { type: 'burst', dur: 0.05, hz: 2400, q: 3, gain: 0.14 },
  ],
  forage: [
    { type: 'blip', hz: 520, dur: 0.12, wave: 'sine', gain: 0.22, bend: 1.5 },
    { type: 'blip', at: 0.05, hz: 700, dur: 0.07, wave: 'sine', gain: 0.12, bend: 1.3 },
  ],
  forage2: [
    { type: 'blip', hz: 470, dur: 0.1, wave: 'sine', gain: 0.2, bend: 1.6 },
    { type: 'blip', at: 0.04, hz: 640, dur: 0.06, wave: 'sine', gain: 0.11, bend: 1.4 },
  ],
  craft: [
    { type: 'blip', hz: 440, dur: 0.09, wave: 'triangle', gain: 0.22 },
    { type: 'blip', at: 0.09, hz: 660, dur: 0.12, wave: 'triangle', gain: 0.22 },
  ],
  build: [
    { type: 'blip', hz: 120, dur: 0.16, wave: 'sine', gain: 0.35, bend: 0.7 },
    { type: 'burst', dur: 0.14, hz: 500, q: 2, gain: 0.3, filter: 'lowpass' },
  ],
  swing: [
    { type: 'burst', dur: 0.14, hz: 1200, q: 0.8, gain: 0.28, filter: 'bandpass', sweepTo: 300 },
  ],
  windup: [
    { type: 'blip', hz: 260, dur: 0.09, wave: 'triangle', gain: 0.16, bend: 1.3 },
  ],
  telegraph: [
    { type: 'blip', hz: 500, dur: 0.08, wave: 'square', gain: 0.16, bend: 1.4 },
  ],
  hit: [
    { type: 'burst', dur: 0.09, hz: 2000, q: 2, gain: 0.35 },
    { type: 'blip', hz: 200, dur: 0.06, wave: 'square', gain: 0.15, bend: 0.5 },
  ],
  enemyDie: [
    { type: 'blip', hz: 300, dur: 0.18, wave: 'sawtooth', gain: 0.25, bend: 0.4 },
    { type: 'burst', dur: 0.12, hz: 1400, q: 1, gain: 0.2, filter: 'lowpass' },
  ],
  hurt: [
    { type: 'blip', hz: 300, dur: 0.22, wave: 'sawtooth', gain: 0.35, bend: 0.35 },
  ],
  gold: [
    { type: 'blip', hz: 1180, dur: 0.05, wave: 'square', gain: 0.2, bend: 1.2 },
    { type: 'blip', at: 0.05, hz: 1560, dur: 0.09, wave: 'square', gain: 0.18, bend: 1.2 },
  ],
  levelup: arp(523, [0, 4, 7, 12], 0.08, 0.16, 'triangle', 0.22),
  nightfall: [
    { type: 'blip', hz: 130, dur: 0.9, wave: 'sine', gain: 0.28, bend: 0.7 },
    { type: 'burst', dur: 0.9, hz: 300, q: 0.6, gain: 0.14, filter: 'lowpass' },
  ],
  dawn: arp(330, [0, 5, 9], 0.12, 0.6, 'triangle', 0.14, 'tone'),
  // A3: an active goes off. Deliberately a soft swell rather than a hit -- the
  // damage that follows already has 'hit' cues of its own, and stacking a bang on
  // a bang is how an ability bar starts sounding like a slot machine.
  cast: [
    { type: 'blip', hz: 330, dur: 0.14, wave: 'triangle', gain: 0.2, bend: 1.9 },
    { type: 'burst', at: 0.02, dur: 0.26, hz: 900, q: 0.7, gain: 0.16, filter: 'bandpass', sweepTo: 2400 },
  ],
  // ...and the refusal: dull, low, over quickly. It has to be legible as "no"
  // without being a punishment you flinch from.
  castFail: [
    { type: 'blip', hz: 150, dur: 0.13, wave: 'triangle', gain: 0.16, bend: 0.6 },
  ],
  bossRoar: [{ type: 'roar' }],
  discover: arp(392, [0, 7, 12], 0.1, 0.3, 'sine', 0.18),
};
SFX.place = SFX.build; // alias — placing is just a build confirmation chime

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private drone!: OscillatorNode;
  private droneGain!: GainNode;

  enabled = true;
  private mood: Mood = 'day';
  private step = 0;
  private nextT = 0;
  private timer: number | null = null;

  /** Call from a click/keypress. Safe to call repeatedly. */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.85 : 0.0001;
    this.master.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = 0.55; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);

    // one second of white noise, reused for every percussive/whoosh effect
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // the ever-present drone, retuned when the mood changes
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneGain.connect(this.music);
    this.drone = ctx.createOscillator(); this.drone.type = 'sine';
    this.drone.frequency.value = MOODS[this.mood].droneHz;
    this.drone.connect(this.droneGain); this.drone.start();

    this.applyMood();
    this.nextT = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.85 : 0.0001, this.ctx.currentTime, 0.05);
  }
  toggle() { this.setEnabled(!this.enabled); return this.enabled; }

  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    this.applyMood();
  }

  private applyMood() {
    if (!this.ctx) return;
    const d = MOODS[this.mood];
    this.drone.frequency.setTargetAtTime(d.droneHz, this.ctx.currentTime, 0.3);
    this.droneGain.gain.setTargetAtTime(d.droneGain, this.ctx.currentTime, 0.4);
  }

  // ---- generative music: lookahead scheduler ----------------------------
  private schedule() {
    const ctx = this.ctx; if (!ctx) return;
    const d = MOODS[this.mood];
    while (this.nextT < ctx.currentTime + 0.15) {
      this.playStep(this.nextT, d);
      this.nextT += d.beat;
      this.step++;
    }
  }

  private playStep(t: number, d: MoodDef) {
    // sparse melody: skip some steps so it breathes instead of noodling
    const r = Math.random();
    const density = this.mood === 'boss' ? 0.85 : 0.5;
    if (r < density) {
      const deg = d.scale[Math.floor(Math.random() * d.scale.length)];
      const oct = Math.random() < 0.25 ? 12 : 0;
      this.tone(t, semi(d.root, deg + oct), d.beat * 1.6, d.wave, d.noteGain);
    }
    // boss mode gets a driving kick + hat to raise the pulse
    if (d.drums) {
      if (this.step % 2 === 0) this.kick(t);
      if (this.step % 2 === 1) this.hat(t, 0.05);
    }
  }

  // ---- synth voices ------------------------------------------------------
  private tone(t: number, hz: number, dur: number, wave: OscillatorType, gain: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = wave; o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.music);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(t: number, dur: number, hz: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!; const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + dur + 0.02);
    return f;
  }

  private kick(t: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.18);
  }
  private hat(t: number, gain: number) { this.burst(t, 0.04, 8000, 1, gain, 'highpass'); }

  private blip(t: number, hz: number, dur: number, wave: OscillatorType, gain: number, bend = 1) {
    const ctx = this.ctx!; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = wave; o.frequency.setValueAtTime(hz, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(hz * bend, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- one-shot sound effects: look up the recipe, render each step ------
  play(name: string) {
    const ctx = this.ctx; if (!ctx || !this.enabled) return;
    const steps = SFX[name];
    if (!steps) return;
    const t = ctx.currentTime + 0.001;
    for (const s of steps) this.renderStep(t, s);
  }

  private renderStep(t: number, s: SfxStep) {
    const at = t + (s.at ?? 0);
    switch (s.type) {
      case 'tone': this.tone(at, s.hz!, s.dur!, s.wave ?? 'sine', s.gain!); break;
      case 'blip': this.blip(at, s.hz!, s.dur!, s.wave ?? 'sine', s.gain!, s.bend ?? 1); break;
      case 'burst': {
        const f = this.burst(at, s.dur!, s.hz!, s.q ?? 1, s.gain!, s.filter ?? 'bandpass');
        if (s.sweepTo != null) f.frequency.exponentialRampToValueAtTime(s.sweepTo, at + s.dur!);
        break;
      }
      case 'kick': this.kick(at); break;
      case 'roar': this.roar(at); break;
    }
  }

  private roar(t: number) {
    const ctx = this.ctx!;
    // stacked detuned saws sliding down = a big menacing bellow
    [55, 55.6, 82, 41].forEach((hz) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(hz * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + 0.9);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 1.4);
    });
    this.burst(t, 1.1, 220, 0.5, 0.25, 'lowpass');
  }
}

export const Sound = new AudioEngine();
