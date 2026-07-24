import placeUrl from "./assets/sounds/place.wav";
import noteUrl from "./assets/sounds/note.wav";
import eraseUrl from "./assets/sounds/erase.wav";
import errorUrl from "./assets/sounds/error.wav";
import successUrl from "./assets/sounds/success.wav";

/**
 * Short, low-latency game SFX via Web Audio — the web counterpart of the Android
 * app's SoundManager (SoundPool). Clips are fetched and decoded once into
 * AudioBuffers; playing before decode finishes is a silent no-op.
 *
 * Browsers (especially iOS Safari) start the AudioContext suspended until a user
 * gesture, so [unlock] must be called from the first tap.
 */
export enum Sfx {
  PLACE = "PLACE",
  NOTE = "NOTE",
  ERASE = "ERASE",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
}

const URLS: Record<Sfx, string> = {
  [Sfx.PLACE]: placeUrl,
  [Sfx.NOTE]: noteUrl,
  [Sfx.ERASE]: eraseUrl,
  [Sfx.ERROR]: errorUrl,
  [Sfx.SUCCESS]: successUrl,
};

export class SoundManager {
  /** Toggle all audio without tearing down the context. */
  enabled = true;

  private ctx: AudioContext | null = null;
  private buffers = new Map<Sfx, AudioBuffer>();
  private unlocked = false;

  constructor() {
    // Lazily create the context on first unlock so we don't spawn a suspended
    // one before any gesture (some browsers warn about that).
  }

  /** Create/resume the AudioContext and decode all clips. Call from a tap handler. */
  unlock(): void {
    if (this.unlocked) {
      // Context may re-suspend when the tab is backgrounded; nudge it awake.
      this.ctx?.resume();
      return;
    }
    this.unlocked = true;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio — play() becomes a no-op
    this.ctx = new Ctor();
    this.ctx.resume();
    for (const sfx of Object.values(Sfx)) this.load(sfx);
  }

  private async load(sfx: Sfx): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(URLS[sfx]);
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      this.buffers.set(sfx, buffer);
    } catch {
      /* decode/fetch failed — that clip just stays silent */
    }
  }

  /**
   * A short ascending chime for completing a row/column/box — synthesized from
   * oscillators (no asset), so it stays distinct from the placement blip and the
   * full-solve fanfare.
   */
  chime(): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const freqs = [659.25, 783.99, 987.77]; // E5 · G5 · B5 — a bright major triad
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      const start = now + i * 0.06;
      const dur = 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01); // quick attack, no click
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur); // gentle decay
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  play(sfx: Sfx, volume = 1): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const buffer = this.buffers.get(sfx);
    if (!ctx || !buffer) return; // not ready yet — skip rather than throw
    if (ctx.state === "suspended") ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (volume !== 1) {
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(ctx.destination);
    } else {
      source.connect(ctx.destination);
    }
    source.start();
  }
}
