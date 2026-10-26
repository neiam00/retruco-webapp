import type { CPUWork, GameEvent, Snapshot } from './protocol.js';

export interface StreamPosition {
  epoch: string;
  sequence: number;
}

export interface HistoryUpdate<T> {
  reset: boolean;
  items: T[];
  keep: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  data: Snapshot;
  cpu?: CPUWork;
  stream?: StreamPosition;
}

export interface GameUpdateMessage {
  type: 'game_update';
  data: Omit<Snapshot, 'chat' | 'events' | 'cantoHistory'>;
  cpu?: CPUWork;
  stream: StreamPosition & { baseSequence: number };
  history?: {
    chat?: HistoryUpdate<Snapshot['chat'][number]>;
    events?: HistoryUpdate<GameEvent>;
    cantoHistory?: HistoryUpdate<GameEvent>;
  };
}

function updateHistory<T>(previous: T[], change?: HistoryUpdate<T>): T[] {
  if (!change) return previous;
  if (
    typeof change.reset !== 'boolean' ||
    !Array.isArray(change.items) ||
    !Number.isSafeInteger(change.keep) ||
    change.keep < 0
  ) {
    throw new Error('Invalid history update');
  }
  if (change.keep === 0) return [];
  const items = change.reset ? change.items : [...previous, ...change.items];
  return items.length > change.keep ? items.slice(-change.keep) : items;
}

// Owns one socket's baseline. A missing sequence never partially updates the
// displayed game: the caller requests a complete authorized snapshot instead.
export class MatchStream {
  private snapshot?: Snapshot;
  private position?: StreamPosition;

  receive(message: SnapshotMessage | GameUpdateMessage): Snapshot | null {
    if (message.type === 'snapshot') {
      this.snapshot = message.data;
      this.position = message.stream;
      return this.snapshot;
    }
    const previous = this.snapshot;
    const position = this.position;
    const next = message.stream;
    if (
      !previous ||
      !position ||
      !next ||
      next.epoch !== position.epoch ||
      next.baseSequence !== position.sequence ||
      next.sequence !== position.sequence + 1
    ) {
      return null;
    }
    // Reconstruct everything before advancing the cursor, including on invalid
    // history data, so a subsequent full baseline always recovers cleanly.
    const snapshot: Snapshot = {
      ...message.data,
      chat: updateHistory(previous.chat, message.history?.chat),
      events: updateHistory(previous.events ?? [], message.history?.events),
      cantoHistory: updateHistory(previous.cantoHistory ?? [], message.history?.cantoHistory),
    };
    this.snapshot = snapshot;
    this.position = next;
    return snapshot;
  }
}
