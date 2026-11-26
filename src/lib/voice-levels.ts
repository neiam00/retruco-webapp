export interface MouthLevel {
  userID: string;
  level: number;
}

export interface MouthSource {
  track: MediaStreamTrack;
  seat: number;
  userID: string;
}

type MouthListener = (levels: ReadonlyMap<number, MouthLevel>) => void;

interface MouthRoom {
  listeners: Set<MouthListener>;
  levels: ReadonlyMap<number, MouthLevel>;
  sampler?: MouthSampler;
}

interface SoundInput {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
}

const empty = new Map<number, MouthLevel>();
const rooms = new Map<string, MouthRoom>();

function mouthRoom(code: string) {
  let room = rooms.get(code);
  if (!room) {
    room = { listeners: new Set(), levels: empty };
    rooms.set(code, room);
  }
  return room;
}

export function subscribeMouthLevels(code: string, listener: MouthListener): () => void {
  const room = mouthRoom(code);
  room.listeners.add(listener);
  listener(room.levels);
  room.sampler?.refresh();
  return () => {
    room.listeners.delete(listener);
    if (room.listeners.size === 0) {
      room.sampler?.stop();
      if (!room.sampler) rooms.delete(code);
    }
  };
}

// Analyzes the existing authorized tracks locally. The graph has no output
// connection, so playback, mute, and push-to-talk remain owned by VoiceSession.
export class MouthSampler {
  private readonly room: MouthRoom;
  private context?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;
  private inputs = new Map<MediaStreamTrack, SoundInput>();

  constructor(
    private readonly code: string,
    private readonly sources: () => MouthSource[],
  ) {
    this.room = mouthRoom(code);
    this.room.sampler?.stop();
    this.room.sampler = this;
  }

  private get active() {
    return this.room.sampler === this && this.room.listeners.size > 0;
  }

  resume() {
    if (!this.active || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // The game and its voice session remain usable without Web Audio.
    }
  }

  refresh() {
    if (!this.active) return;
    const sources = this.sources();
    if (sources.length) this.resume();
    this.sample(sources);
    if (this.context && sources.length) {
      this.timer ??= setInterval(() => this.sample(this.sources()), 50);
    }
  }

  private sample(sources: MouthSource[]) {
    const available = new Set(sources.map(({ track }) => track));
    for (const [track, input] of this.inputs) {
      if (!available.has(track)) {
        input.source.disconnect();
        this.inputs.delete(track);
      }
    }
    if (!sources.length) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const levels = new Map<number, MouthLevel>();
    const context = this.context;
    if (context?.state === 'running') {
      for (const { track, seat, userID } of sources) {
        if (track.readyState !== 'live' || track.muted || !track.enabled) continue;
        let input = this.inputs.get(track);
        if (!input) {
          try {
            const source = context.createMediaStreamSource(new MediaStream([track]));
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            input = { source, analyser, samples: new Float32Array(analyser.fftSize) };
            this.inputs.set(track, input);
          } catch {
            continue;
          }
        }
        input.analyser.getFloatTimeDomainData(input.samples);
        let energy = 0;
        for (const value of input.samples) energy += value * value;
        const rms = Math.sqrt(energy / input.samples.length);
        const level = Math.round(Math.min(1, Math.max(0, (rms - 0.02) * 5)) * 20) / 20;
        if (level > 0) levels.set(seat, { userID, level });
      }
    }
    this.publish(levels);
  }

  private publish(levels: ReadonlyMap<number, MouthLevel>) {
    if (this.room.sampler !== this) return;
    const previous = this.room.levels;
    if (
      levels.size === previous.size &&
      [...levels].every(([seat, reading]) => {
        const before = previous.get(seat);
        return reading.userID === before?.userID && reading.level === before.level;
      })
    )
      return;
    this.room.levels = levels;
    for (const listener of this.room.listeners) listener(levels);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const input of this.inputs.values()) input.source.disconnect();
    this.inputs.clear();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = undefined;
    this.publish(empty);
  }

  close() {
    this.stop();
    if (this.room.sampler === this) {
      this.room.sampler = undefined;
      if (this.room.listeners.size === 0) rooms.delete(this.code);
    }
  }
}
