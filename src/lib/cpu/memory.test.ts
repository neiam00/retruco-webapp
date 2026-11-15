import { describe, expect, it, vi } from 'vitest';
import { HandMemory, MemoryReplayRequired, type MemoryPage } from './memory.js';

function runtime() {
  let state = new Float32Array(32);
  return {
    resetMemory: () => {
      state = new Float32Array(32);
    },
    saveMemory: () => state.slice(),
    restoreMemory: (saved: Float32Array) => {
      state = saved.slice();
    },
    advanceMemory: vi.fn((event: ArrayLike<number>) => {
      state[0] += event[0];
    }),
  };
}
function page(start = 0, end = 2, hand = 1): MemoryPage {
  return {
    version: 1,
    hand,
    start,
    end,
    total: 2,
    complete: true,
    events: Array.from({ length: end - start }, () => Array(768).fill(1)),
  };
}

describe('authorized hand memory', () => {
  it('isolates seats, consumes duplicates once, and reconstructs after worker replacement', () => {
    const policy = runtime(),
      memory = new HandMemory(policy);
    expect(memory.advance('match:seat0:model1', page(0, 1))).toBe(false);
    expect(memory.advance('match:seat2:model1', page())).toBe(true);
    expect(memory.advance('match:seat0:model1', page(1, 2))).toBe(true);
    expect(policy.saveMemory()[0]).toBe(2);
    memory.advance('match:seat0:model1', page());
    expect(policy.advanceMemory).toHaveBeenCalledTimes(4);
    const replacement = runtime(),
      restored = new HandMemory(replacement);
    restored.advance('match:seat0:model1', page());
    expect(replacement.saveMemory()).toEqual(policy.saveMemory());
    memory.advance('match:seat0:model1', page(0, 1, 2));
    expect(policy.saveMemory()[0]).toBe(1);
  });

  it('rejects gaps, incomplete traces, conflicting replays and obsolete hands', () => {
    const policy = runtime(),
      memory = new HandMemory(policy);
    expect(() => memory.advance('key', page(1, 2))).toThrow('Full hand');
    expect(() => memory.advance('key', { ...page(), complete: false })).toThrow('Incomplete');
    memory.advance('key', page());
    const conflict = page();
    conflict.events[0][0] = 2;
    expect(() => memory.advance('key', conflict)).toThrow('Conflicting');
    memory.advance('key', page(0, 1, 2));
    expect(() => memory.advance('key', page())).toThrow('Obsolete');
  });

  it('checks an overlapping replay prefix and consumes only its new suffix', () => {
    const policy = runtime();
    const memory = new HandMemory(policy);
    const first = { ...page(), total: 4 };
    first.events[1][0] = 2;
    expect(memory.advance('key', first)).toBe(false);
    const overlap = {
      ...page(),
      start: 1,
      end: 4,
      total: 4,
      events: [2, 3, 4].map((value) => [value, ...Array(767).fill(0)]),
    };
    // The prefix is byte-identical, including the rest of the feature vector.
    overlap.events[0] = first.events[1].slice();
    expect(memory.advance('key', overlap)).toBe(true);
    expect(policy.saveMemory()[0]).toBe(10);
    expect(policy.advanceMemory).toHaveBeenCalledTimes(4);
    expect(memory.advance('key', overlap)).toBe(true);
    expect(policy.advanceMemory).toHaveBeenCalledTimes(4);
    overlap.events[0][0] = 9;
    expect(() => memory.advance('key', overlap)).toThrow('Conflicting');
    expect(policy.saveMemory()[0]).toBe(10);
  });

  it('rejects altered replay events even when their old short fingerprints collide', () => {
    const policy = runtime();
    const memory = new HandMemory(policy);
    const first = { ...page(0, 1), total: 1 };
    first.events[0] = [1, 2, ...Array(766).fill(0)];
    memory.advance('key', first);
    // [1, 2] and [3, -0.01171875] share the previous word-wise FNV32
    // fingerprint. Their authorized float32 event contents are not equal.
    const altered = { ...first, events: [[3, -0.01171875, ...Array(766).fill(0)]] };
    expect(() => memory.advance('key', altered)).toThrow('Conflicting');
    expect(policy.saveMemory()[0]).toBe(1);
    expect(policy.advanceMemory).toHaveBeenCalledTimes(1);
  });

  it('rolls back a partially computed page and commits it once on retry', () => {
    const policy = runtime();
    const advance = policy.advanceMemory.getMockImplementation()!;
    let fail = true;
    policy.advanceMemory.mockImplementation((event) => {
      advance(event);
      if (event[0] === 3 && fail) throw new Error('runtime failure');
    });
    const memory = new HandMemory(policy);
    memory.advance('key', { ...page(0, 1), total: 3 });
    const next = {
      ...page(),
      start: 1,
      end: 3,
      total: 3,
      events: [2, 3].map((value) => [value, ...Array(767).fill(0)]),
    };
    expect(() => memory.advance('key', next)).toThrow('runtime failure');
    expect(policy.saveMemory()[0]).toBe(1);
    fail = false;
    expect(memory.advance('key', next)).toBe(true);
    expect(policy.saveMemory()[0]).toBe(6);
    expect(memory.advance('key', next)).toBe(true);
    expect(policy.saveMemory()[0]).toBe(6);
  });

  it('bounds cached identities and requires full replay after eviction', () => {
    const memory = new HandMemory(runtime());
    for (let index = 0; index < 5; index++) memory.advance(`identity-${index}`, page());
    expect(() => memory.advance('identity-0', page(1, 2))).toThrow(MemoryReplayRequired);
    expect(memory.advance('identity-0', page())).toBe(true);
  });

  it('rejects non-progressing pages and values that overflow the runtime representation', () => {
    const policy = runtime();
    const memory = new HandMemory(policy);
    expect(() => memory.advance('key', { ...page(0, 0), total: 1 })).toThrow('invalid');
    const overflow = page();
    overflow.events[1][0] = 1e300;
    expect(() => memory.advance('key', overflow)).toThrow('invalid');
    expect(policy.advanceMemory).not.toHaveBeenCalled();
  });
});
