import type { LocalPolicy } from './model.js';

export interface MemoryPage {
  version: number;
  hand: number;
  start: number;
  end: number;
  total: number;
  complete: boolean;
  events: number[][];
}

// Experimental evaluation adapter. Production still rejects recurrent manifests
// until negotiated journal transport and the release gates are connected.
export class HandMemory {
  private states = new Map<
    string,
    { hand: number; cursor: number; state: Float32Array; hashes: number[] }
  >();
  constructor(
    private readonly policy: Pick<
      LocalPolicy,
      'resetMemory' | 'advanceMemory' | 'saveMemory' | 'restoreMemory'
    >,
  ) {}

  // key must bind match identity, seat, model hash and memory/encoder versions.
  advance(key: string, page: MemoryPage): boolean {
    if (
      page.version !== 1 ||
      page.complete !== true ||
      !Number.isSafeInteger(page.hand) ||
      page.hand < 1 ||
      ![page.start, page.end, page.total].every(Number.isSafeInteger) ||
      page.start < 0 ||
      page.start > page.end ||
      page.end > page.total ||
      page.total > 2048 ||
      page.events.length !== page.end - page.start ||
      page.events.length > 32 ||
      page.events.some((row) => row.length !== 768 || row.some((x) => !Number.isFinite(x)))
    )
      throw new Error('Incomplete or invalid authorized memory');
    let previous = this.states.get(key);
    if (previous && page.hand < previous.hand) throw new Error('Obsolete memory hand');
    if (!previous || previous.hand !== page.hand) {
      if (page.start !== 0) throw new Error('Full hand replay required');
      this.policy.resetMemory();
      previous = { hand: page.hand, cursor: 0, state: this.policy.saveMemory(), hashes: [] };
    } else this.policy.restoreMemory(previous.state);
    const hashes = page.events.map((event) => {
      let hash = 2166136261;
      for (const word of new Uint32Array(Float32Array.from(event).buffer))
        hash = Math.imul(hash ^ word, 16777619);
      return hash;
    });
    if (page.total < previous.cursor) throw new Error('Obsolete memory cursor');
    if (page.end <= previous.cursor) {
      if (hashes.some((hash, index) => hash !== previous.hashes[page.start + index]))
        throw new Error('Conflicting memory replay');
      return previous.cursor === page.total;
    }
    if (page.start !== previous.cursor) throw new Error('Memory cursor gap');
    // Commit only after every row succeeds. A later attempt restores the last
    // committed state, so partial computation never advances a cursor twice.
    for (const event of page.events) this.policy.advanceMemory(event);
    this.states.set(key, {
      hand: page.hand,
      cursor: page.end,
      state: this.policy.saveMemory(),
      hashes: previous.hashes.concat(hashes),
    });
    return page.end === page.total;
  }

  clear() {
    this.states.clear();
    this.policy.resetMemory();
  }
}
