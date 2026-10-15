/**
 * Tiny synthesised sound effects via Web Audio – no audio files to download.
 * The AudioContext is created lazily on the first user gesture (required by
 * mobile browsers).
 */
type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  /** Call from a user gesture to unlock audio on iOS/Android. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: Wave = 'square', vol = 0.08, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  coin(): void {
    this.tone(988, 0.07, 'square', 0.05);
    this.tone(1319, 0.12, 'square', 0.05, undefined, 0.06);
  }
  jump(): void {
    this.tone(320, 0.18, 'triangle', 0.1, 640);
  }
  slide(): void {
    this.tone(260, 0.16, 'sawtooth', 0.04, 120);
  }
  lane(): void {
    this.tone(520, 0.04, 'triangle', 0.04);
  }
  bump(): void {
    this.tone(110, 0.08, 'square', 0.06);
  }
  powerup(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.1, 'square', 0.05, undefined, i * 0.06));
  }
  shieldBreak(): void {
    this.tone(700, 0.25, 'sawtooth', 0.06, 150);
  }
  whistle(): void {
    // Police whistle trill.
    for (let i = 0; i < 4; i++) this.tone(i % 2 ? 2350 : 2600, 0.06, 'sine', 0.05, undefined, i * 0.06);
  }
  agbero(): void {
    // Gruff "oya!" shout.
    this.tone(180, 0.12, 'sawtooth', 0.07, 240);
    this.tone(240, 0.16, 'sawtooth', 0.06, 150, 0.12);
  }
  milestone(): void {
    this.tone(784, 0.1, 'triangle', 0.07);
    this.tone(1175, 0.18, 'triangle', 0.07, undefined, 0.1);
  }
  crash(): void {
    this.tone(200, 0.45, 'sawtooth', 0.12, 40);
    // "Horn" – the classic danfo honk.
    this.tone(415, 0.22, 'square', 0.05, undefined, 0.05);
    this.tone(392, 0.3, 'square', 0.05, undefined, 0.28);
  }
}
