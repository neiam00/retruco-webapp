import type { LocalPolicy } from './model.js';
import type { CPUMemoryPage } from '#lib/protocol.js';

export type MemoryPage = CPUMemoryPage;

export class MemoryReplayRequired extends Error {}

const MAX_KEYS = 4;

// Each key binds the server's match/seat/lease identity to the loaded model and
// encoder. Only a committed cursor can be acknowledged to the server.
export class HandMemory {
  private states = new Map<
    string,
    { hand: number; cursor: number; state: Float32Array; events: Uint32Array[] }
  >();
  constructor(
    private readonly policy: Pick<
      LocalPolicy,
      'resetMemory' | 'advanceMemory' | 'saveMemory' | 'restoreMemory'
    >,
  ) {}

  advance(key: string, page: MemoryPage): boolean {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      key.length > 512 ||
      page.version !== 1 ||
      page.complete !== true ||
      !Number.isSafeInteger(page.hand) ||
      page.hand < 1 ||
      ![page.start, page.end, page.total].every(Number.isSafeInteger) ||
      page.start < 0 ||
      page.start > page.end ||
      page.end > page.total ||
      page.total > 2048 ||
      (page.end < page.total && page.end === page.start) ||
      !Array.isArray(page.events) ||
      page.events.length !== page.end - page.start ||
      page.events.length > 32 ||
      page.events.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 768 ||
          row.some((x) => !Number.isFinite(x) || !Number.isFinite(Math.fround(x))),
      )
    )
      throw new Error('Incomplete or invalid authorized memory');
    let previous = this.states.get(key);
    if (previous && page.hand < previous.hand) throw new Error('Obsolete memory hand');
    if (!previous || previous.hand !== page.hand) {
      if (page.start !== 0) throw new MemoryReplayRequired('Full hand replay required');
      this.policy.resetMemory();
      previous = { hand: page.hand, cursor: 0, state: this.policy.saveMemory(), events: [] };
    }
    // Retain the exact runtime representation: a short fingerprint can collide
    // and incorrectly accept an altered prefix. These snapshots are bounded by
    // MAX_KEYS and the maximum authorized events per hand above.
    const events = page.events.map((event) => new Uint32Array(Float32Array.from(event).buffer));
    if (page.total < previous.cursor) throw new Error('Obsolete memory cursor');
    if (page.start > previous.cursor) throw new MemoryReplayRequired('Memory cursor gap');
    const overlap = Math.min(previous.cursor, page.end) - page.start;
    for (let index = 0; index < overlap; index++) {
      if (
        events[index].some((word, feature) => word !== previous.events[page.start + index][feature])
      )
        throw new Error('Conflicting memory replay');
    }
    this.policy.restoreMemory(previous.state);
    if (page.end <= previous.cursor) {
      return previous.cursor === page.total;
    }
    // A retransmission can overlap already consumed events and include a new
    // suffix. Verify its prefix, then advance only that suffix exactly once.
    let state: Float32Array;
    try {
      for (const event of page.events.slice(overlap)) this.policy.advanceMemory(event);
      state = this.policy.saveMemory();
    } catch (error) {
      this.policy.restoreMemory(previous.state);
      throw error;
    }
    // Bound memory even across rematches/model changes. An evicted key requests
    // a complete authorized replay instead of borrowing another seat's state.
    this.states.delete(key);
    if (this.states.size >= MAX_KEYS) this.states.delete(this.states.keys().next().value!);
    this.states.set(key, {
      hand: page.hand,
      cursor: page.end,
      state,
      events: previous.events.concat(events.slice(overlap)),
    });
    return page.end === page.total;
  }

  clear() {
    this.states.clear();
    this.policy.resetMemory();
  }
}
