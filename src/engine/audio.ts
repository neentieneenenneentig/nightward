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

  // ---- one-shot sound effects -------------------------------------------
  play(name: string) {
    const ctx = this.ctx; if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + 0.001;
    switch (name) {
      case 'chop':   this.burst(t, 0.12, 380, 4, 0.5, 'lowpass'); this.blip(t, 150, 0.1, 'triangle', 0.25, 0.6); break;
      case 'mine':   this.blip(t, 760, 0.06, 'square', 0.2, 0.8); this.blip(t + 0.06, 560, 0.07, 'square', 0.18, 0.7); this.burst(t, 0.05, 2600, 3, 0.15); break;
      case 'forage': this.blip(t, 520, 0.12, 'sine', 0.22, 1.5); break;
      case 'craft':  this.blip(t, 440, 0.09, 'triangle', 0.22); this.blip(t + 0.09, 660, 0.12, 'triangle', 0.22); break;
      case 'build':  this.blip(t, 120, 0.16, 'sine', 0.35, 0.7); this.burst(t, 0.14, 500, 2, 0.3, 'lowpass'); break;
      case 'swing':  this.burst(t, 0.14, 1200, 0.8, 0.28, 'bandpass').frequency.exponentialRampToValueAtTime(300, t + 0.14); break;
      case 'hit':    this.burst(t, 0.09, 2000, 2, 0.35); this.blip(t, 200, 0.06, 'square', 0.15, 0.5); break;
      case 'enemyDie': this.blip(t, 300, 0.18, 'sawtooth', 0.25, 0.4); this.burst(t, 0.12, 1400, 1, 0.2, 'lowpass'); break;
      case 'hurt':   this.blip(t, 300, 0.22, 'sawtooth', 0.35, 0.35); break;
      case 'gold':   this.blip(t, 1180, 0.05, 'square', 0.2, 1.2); this.blip(t + 0.05, 1560, 0.09, 'square', 0.18, 1.2); break;
      case 'levelup': [0, 4, 7, 12].forEach((s, i) => this.blip(t + i * 0.08, semi(523, s), 0.16, 'triangle', 0.22)); break;
      case 'place':  this.play('build'); break;
      case 'nightfall': this.blip(t, 130, 0.9, 'sine', 0.28, 0.7); this.burst(t, 0.9, 300, 0.6, 0.14, 'lowpass'); break;
      case 'dawn':   [0, 5, 9].forEach((s, i) => this.tone(t + i * 0.12, semi(330, s), 0.6, 'triangle', 0.14)); break;
      case 'bossRoar': this.roar(t); break;
      case 'discover': [0, 7, 12].forEach((s, i) => this.blip(t + i * 0.1, semi(392, s), 0.3, 'sine', 0.18)); break;
      default: break;
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
