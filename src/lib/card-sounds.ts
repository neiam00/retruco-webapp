import { DEAL_DURATION_MS, DEAL_INTERVAL_MS, PLAY_DURATION_MS } from './card-timing.js';
import type { Snapshot } from './protocol.js';

type CardSound = 'deal' | 'play';

/** Local effects only; voice chat owns a separate audio connection. */
export class CardSounds {
  private context?: AudioContext;
  private buffers = new Map<CardSound, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private muted = false;
  private closed = false;
  private dealEnds = 0;

  /** Call directly from a pointer or keyboard gesture to respect autoplay rules. */
  unlock() {
    if (this.muted || this.closed) return;
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch {
      // Unsupported or blocked audio must never interrupt the game.
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stop();
  }

  stop() {
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.dealEnds = 0;
  }

  close() {
    this.closed = true;
    this.stop();
    this.buffers.clear();
    void this.context?.close().catch(() => {});
  }

  update(previous: Snapshot | null, next: Snapshot) {
    const before = previous?.state;
    const after = next.state;
    if (
      !before ||
      !after ||
      before.handNumber !== after.handNumber ||
      previous?.seat !== next.seat ||
      previous?.perspective !== next.perspective ||
      after.phase === 'cutting' ||
      this.closed ||
      this.muted ||
      document.hidden ||
      this.context?.state !== 'running'
    ) {
      this.stop();
      return;
    }
    const now = this.context.currentTime;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (before.phase === 'cutting' && after.phase === 'playing') {
      this.stop();
      const cards = next.config.players * 3;
      for (let index = 0; index < cards; index++) {
        this.play('deal', now + (index * DEAL_INTERVAL_MS) / 1000);
      }
      this.dealEnds = now + ((cards - 1) * DEAL_INTERVAL_MS + DEAL_DURATION_MS) / 1000;
      return;
    }
    const finished = after.phase === 'hand_over' || after.phase === 'match_over';
    if (finished) this.stop();
    for (const [seat, player] of after.seats.entries()) {
      const played = player.plays.filter(
        (play, round) => play.present && !before.seats[seat]?.plays[round]?.present,
      );
      if (played.length) {
        // Pegado lands as one pair, so avoid doubling the volume with two taps.
        const landing =
          reducedMotion || finished ? now : Math.max(now, this.dealEnds) + PLAY_DURATION_MS / 1000;
        this.play('play', landing);
      }
    }
  }

  private play(kind: CardSound, when: number) {
    const context = this.context!;
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      buffer = this.makeBuffer(context, kind);
      this.buffers.set(kind, buffer);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    source.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    this.sources.add(source);
    source.start(when);
  }

  private makeBuffer(context: AudioContext, kind: CardSound): AudioBuffer {
    const duration = kind === 'deal' ? 0.09 : 0.14;
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let paper = 0;
    let low = 0;
    for (let index = 0; index < samples.length; index++) {
      const time = index / context.sampleRate;
      // Filtered noise gives the paper swish; a quiet low tap adds the landing.
      paper = 0.65 * paper + 0.35 * (Math.random() * 2 - 1);
      low = 0.95 * low + 0.05 * paper;
      const attack = Math.min(1, time / 0.003);
      const fade = Math.max(0, 1 - time / duration);
      const swish = (paper - low) * Math.exp(-time * 35);
      const tap =
        kind === 'play' ? Math.sin(2 * Math.PI * 150 * time) * Math.exp(-time * 65) * 0.3 : 0;
      samples[index] = (swish + tap) * attack * fade * (kind === 'deal' ? 0.28 : 0.4);
    }
    return buffer;
  }
}
