import { describe, expect, it, vi } from 'vitest';
import { HandMemory, type MemoryPage } from './memory.js';

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
});
