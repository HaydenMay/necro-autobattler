// All sound is synthesized in the browser with the Web Audio API: no audio files to download, license or ship.
// Two independent switches (music, sound effects), saved in the player's save. Phones only allow sound after a tap, so nothing starts
// until the first touch/click (`unlock`).
import { loadSave, updateSettings } from '../core/save.ts';

export type Sfx = 'tap' | 'summon' | 'merge' | 'hit' | 'hitArrow' | 'smash' | 'arrow' | 'death' | 'cast' | 'taunt' | 'shockwave' | 'resurrect' | 'heartLost' | 'victory' | 'defeat' | 'start'
  | 'unlock' | 'packCharge' | 'packTierUp' | 'packTear' | 'packFan' | 'packFlip' | 'packRare' | 'packEpic' | 'packLegend' | 'packCollect';
export type Mode = 'build' | 'battle';

// Music: A minor, 80 bpm, four bars looping (Am, F, C, E). Root note first, then chord tones (Hz).
const CHORDS: number[][] = [
  [110, 164.81, 220, 261.63, 329.63],
  [87.31, 130.81, 174.61, 220, 261.63],
  [130.81, 196, 261.63, 329.63, 392],
  [82.41, 123.47, 164.81, 207.65, 246.94],
];
const BEAT = 60 / 80;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode; private noiseBuf!: AudioBuffer;
  music = true; sfx = true; mode: Mode = 'build';
  private timer = 0; private nextT = 0; private beat = 0; private stamps: Record<string, number> = {};

  constructor() { const s = loadSave().settings; this.music = s.music; this.sfx = s.sfx; }

  private silent: HTMLAudioElement | null = null; private primed = false;
  /** iPhones mute Web Audio when the ringer switch is on, unless the page is playing "real" media. A silent looping <audio> element (plus the
   *  audioSession hint on newer iOS) moves the page to the playback channel, so the game is heard even with the switch on silent. */
  private playbackChannel() {
    try { const a = (navigator as any).audioSession; if (a) a.type = 'playback'; } catch { /* not supported */ }
    if (this.silent) return;
    try {
      const n = 441, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
      const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))); el.loop = true; el.volume = 0.01; el.setAttribute('playsinline', ''); this.silent = el;
      el.play().catch(() => { this.silent = null; });
    } catch { /* fine: sound still works, just follows the silent switch */ }
  }
  /** What the Settings page shows so a silent phone can be diagnosed. */
  status(): { state: string; unlocked: boolean } { return { state: this.ctx ? this.ctx.state : 'not started', unlocked: !!this.ctx && this.ctx.state === 'running' }; }
  /** The Settings page's Test sound button: unlock and make a clearly audible sound. */
  test() { this.unlock(); const t = () => { this.play('victory'); }; if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().then(t).catch(() => {}); else t(); }

  /** Call from a user gesture (tap/click). Safe to call repeatedly. */
  unlock() {
    this.playbackChannel();
    if (!this.ctx) {
      const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return;
      const ctx: AudioContext = this.ctx = new C();
      const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
      this.musicBus = ctx.createGain(); this.musicBus.connect(this.master); this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
      ctx.onstatechange = () => { window.dispatchEvent(new Event('necro-audio-state')); };
      const len = ctx.sampleRate; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});             // 'suspended' or (iOS) 'interrupted'
    if (!this.primed) { this.primed = true; try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch { /* ignore */ } }
    this.applyGains(); this.syncMusic();
  }

  setMusic(on: boolean) { this.music = on; updateSettings({ music: on }); this.applyGains(); this.syncMusic(); window.dispatchEvent(new Event('necro-settings')); }
  setSfx(on: boolean) { this.sfx = on; updateSettings({ sfx: on }); this.applyGains(); window.dispatchEvent(new Event('necro-settings')); if (on) this.play('tap'); }
  /** Re-read the saved switches (the shell's Settings page changes them too). */
  reload() { const s = loadSave().settings; this.music = s.music; this.sfx = s.sfx; this.applyGains(); this.syncMusic(); }
  setMode(m: Mode) { this.mode = m; }

  private applyGains() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.music ? 0.5 : 0, t, 0.15); this.sfxBus.gain.setTargetAtTime(this.sfx ? 0.8 : 0, t, 0.05);
  }

  // ------------------------------------------------------------------------------------------ music
  private syncMusic() {
    if (!this.ctx) return;
    if (this.music && !this.timer) { this.nextT = this.ctx.currentTime + 0.15; this.timer = window.setInterval(() => this.tick(), 200); }
    if (!this.music && this.timer) { clearInterval(this.timer); this.timer = 0; }
  }
  private tick() {
    const ctx = this.ctx!; if (ctx.state !== 'running') { this.nextT = ctx.currentTime + 0.15; return; }
    while (this.nextT < ctx.currentTime + 0.6) { this.playBeat(this.beat, this.nextT); this.nextT += BEAT; this.beat = (this.beat + 1) % 16; }
  }
  private playBeat(beat: number, t: number) {
    const chord = CHORDS[Math.floor(beat / 4)], inBar = beat % 4, battle = this.mode === 'battle';
    if (inBar === 0) for (const f of chord) this.voice(f, 'triangle', t, BEAT * 4 + 0.8, 0.045, 0.9, 900);   // slow pad
    if (inBar === 0 || inBar === 2) this.voice(chord[0], 'sine', t, BEAT * 1.6, 0.16, 0.02, 400);          // bass
    if (battle) {
      this.kick(t, 0.32); if (inBar === 2) this.kick(t + BEAT * 0.5, 0.18);
      this.noise(t + BEAT * 0.5, 0.05, 0.05, 'highpass', 7000); this.noise(t + BEAT * 1.5 % BEAT, 0.05, 0.03, 'highpass', 7000);
      for (let i = 0; i < 2; i++) this.voice(chord[1 + ((beat * 2 + i) % 4)] * 2, 'triangle', t + i * BEAT / 2, 0.22, 0.05, 0.005, 2500);   // pluck arpeggio
    }
  }
  private voice(freq: number, type: OscillatorType, t: number, dur: number, gain: number, attack: number, lp: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = lp;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + Math.max(0.005, attack)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  private kick(t: number, gain: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25);
  }
  private noise(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, bus: GainNode = this.musicBus, sweepTo?: number) {
    const ctx = this.ctx!, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(bus); n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------------------------------ sound effects
  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number, attack = 0.005, lp = 8000) {
    const ctx = this.ctx!, t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    f.type = 'lowpass'; f.frequency.value = lp; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  private hiss(dur: number, gain: number, type: BiquadFilterType, freq: number, delay = 0, sweepTo?: number) { this.noise(this.ctx!.currentTime + delay, dur, gain, type, freq, this.sfxBus, sweepTo); }
  private throttle(key: string, ms: number) { const n = performance.now(); if (n - (this.stamps[key] || 0) < ms) return false; this.stamps[key] = n; return true; }

  play(name: Sfx) {
    if (!this.ctx || !this.sfx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'tap': if (!this.throttle('tap', 40)) return; this.tone(760, 0.06, 'sine', 0.22, 0, 1100); break;
      case 'summon': this.hiss(0.4, 0.14, 'bandpass', 500, 0, 2500); this.tone(220, 0.4, 'sawtooth', 0.1, 0, 660, 0.05, 1800); this.tone(1320, 0.2, 'sine', 0.1, 0.18); break;
      case 'merge': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.2, i * 0.07)); this.hiss(0.5, 0.08, 'highpass', 5000, 0.1); this.tone(110, 0.3, 'sine', 0.35, 0, 50); this.tone(1568, 0.5, 'sine', 0.08, 0.3); break;
      case 'hit': if (!this.throttle('hit', 45)) return; this.hiss(0.07, 0.24, 'lowpass', 1800); this.tone(170, 0.09, 'sine', 0.22, 0, 80); break;
      case 'hitArrow': if (!this.throttle('hitA', 45)) return; this.hiss(0.05, 0.14, 'bandpass', 3000); this.tone(700, 0.06, 'triangle', 0.06, 0, 400); break;
      case 'smash': this.tone(95, 0.38, 'sine', 0.5, 0, 34); this.hiss(0.32, 0.35, 'lowpass', 1000, 0, 200); break;
      case 'arrow': if (!this.throttle('arrow', 60)) return; this.hiss(0.14, 0.1, 'bandpass', 1800, 0, 4200); break;
      case 'death': if (!this.throttle('death', 70)) return; this.tone(300, 0.4, 'sawtooth', 0.14, 0, 70, 0.01, 900); break;
      case 'cast': this.tone(300, 0.45, 'sine', 0.18, 0, 900, 0.05); this.tone(450, 0.45, 'sine', 0.1, 0.05, 1350, 0.05); this.tone(1800, 0.25, 'sine', 0.05, 0.3); break;
      case 'taunt': this.tone(196, 0.5, 'square', 0.08, 0, 180, 0.03, 700); this.tone(147, 0.5, 'sawtooth', 0.08, 0.02, 140, 0.03, 600); break;
      case 'shockwave': this.tone(220, 1.1, 'sine', 0.5, 0, 28, 0.02); this.hiss(1.0, 0.35, 'lowpass', 3000, 0, 150); this.tone(880, 0.8, 'sine', 0.08, 0, 220); break;
      case 'resurrect': [220, 277, 330, 440, 554].forEach((f, i) => this.tone(f, 1.1, 'triangle', 0.1, i * 0.12, f * 1.12, 0.3)); this.hiss(0.9, 0.06, 'highpass', 4500, 0.2); break;
      case 'heartLost': this.tone(110, 0.7, 'sawtooth', 0.28, 0, 50, 0.01, 450); this.hiss(0.18, 0.2, 'lowpass', 900); this.tone(233, 0.5, 'square', 0.05, 0.02, 220, 0.01, 500); break;
      case 'victory': [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.16, i * 0.11)); this.tone(196, 0.9, 'sine', 0.2); break;
      case 'defeat': [330, 294, 247, 196].forEach((f, i) => this.tone(f, 0.7, 'triangle', 0.16, i * 0.28, f * 0.97)); this.tone(82, 1.6, 'sine', 0.3, 0.3); break;
      case 'unlock': [0.35, 0.47, 0.59, 0.71].forEach((d, i) => { this.hiss(0.05, 0.22, 'bandpass', 900 + i * 120, d); this.tone(170 + i * 12, 0.07, 'square', 0.06, d, undefined, 0.002, 600); }); [784, 1046, 1318].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.16, 1.15 + i * 0.07)); this.hiss(0.5, 0.09, 'highpass', 5000, 1.2); this.tone(110, 0.3, 'sine', 0.25, 1.15, 60); break;
      case 'packCharge': this.tone(90, 1.05, 'sine', 0.25, 0, 260, 0.2); this.hiss(0.95, 0.12, 'lowpass', 300, 0, 2200); this.tone(180, 1.0, 'triangle', 0.06, 0.1, 520, 0.3); break;
      case 'packTierUp': [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.2, i * 0.06)); this.tone(1760, 0.6, 'sine', 0.09, 0.2); this.hiss(0.4, 0.1, 'highpass', 5000, 0.1); break;
      case 'packTear': this.hiss(0.35, 0.3, 'bandpass', 1500, 0, 6000); this.tone(120, 0.45, 'sine', 0.4, 0.05, 40); [1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.1, 0.12 + i * 0.05)); break;
      case 'packFan': this.hiss(0.5, 0.1, 'highpass', 3000); this.tone(660, 0.45, 'sine', 0.1, 0, 1320); break;
      case 'packFlip': this.hiss(0.08, 0.15, 'bandpass', 2500); this.tone(500, 0.12, 'sine', 0.14, 0, 800); break;
      case 'packRare': this.play('packFlip'); [784, 988].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.14, 0.05 + i * 0.09)); break;
      case 'packEpic': this.play('packFlip'); [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.7, 'triangle', 0.16, i * 0.07)); this.tone(110, 0.5, 'sine', 0.3, 0, 60); break;
      case 'packLegend': this.play('packFlip'); [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 1.1, 'triangle', 0.16, i * 0.08)); this.tone(82, 0.9, 'sine', 0.35, 0, 50); this.hiss(0.8, 0.1, 'highpass', 5000, 0.1); this.tone(2093, 0.7, 'sine', 0.07, 0.4); break;
      case 'packCollect': [659, 988].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.09)); break;
      case 'start': this.tone(147, 0.9, 'sawtooth', 0.13, 0, 150, 0.15, 650); this.tone(220, 0.9, 'sawtooth', 0.09, 0.05, 224, 0.15, 650); this.hiss(0.6, 0.06, 'lowpass', 600); break;
    }
  }
}

export const audio = new AudioEngine();
(window as any).__audio = audio;

// Phones only allow sound after a touch: the first tap anywhere unlocks it. Every button also gets a small click.
// iOS only accepts an unlock from a FINISHED tap (touchend / click), not from the start of one, so listen to all of them.
const unlockOnce = () => audio.unlock();
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlockOnce, { capture: true });
document.addEventListener('click', (e) => { const el = e.target as HTMLElement | null; if (el && el.closest && el.closest('button, a.btn, .rail a')) audio.play('tap'); }, true);
document.addEventListener('visibilitychange', () => { const c = (audio as any).ctx as AudioContext | null; if (!c) return; if (document.hidden) c.suspend(); else if (audio.music || audio.sfx) c.resume(); });
window.addEventListener('necro-settings-changed', () => audio.reload());
