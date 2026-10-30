import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LobbyFeed, LobbyState } from './lobby-stream.js';
import { api } from './api.js';
import type { Listing } from './protocol.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));
const table = (code: string, players = 1): Listing => ({
  code,
  players,
  capacity: 4,
  target: 24,
  florRequired: true,
  started: false,
  host: code,
});
const snapshot = (rows: Listing[], revision = 0, epoch = 'server-a') => ({
  type: 'listings_snapshot',
  epoch,
  revision,
  listings: rows,
});
const delta = (revision: number, upserts: Listing[] = [], removed: string[] = []) => ({
  type: 'listings_delta',
  epoch: 'server-a',
  baseRevision: revision - 1,
  revision,
  upserts,
  removed,
});

test('applies complete public baselines, batched upserts and removals without resurrecting duplicates', () => {
  const state = new LobbyState();
  expect(state.apply(snapshot([table('B'), table('A')]))?.map((row) => row.code)).toEqual([
    'A',
    'B',
  ]);
  expect(state.apply(delta(1, [table('B', 3), table('C')], ['A']))).toEqual([
    table('B', 3),
    table('C'),
  ]);
  expect(state.apply(delta(1, [table('A')]))).toBeUndefined();
  expect(state.apply(snapshot([table('A')], 0))).toBeUndefined();
  expect(state.apply(delta(2, [], ['B']))).toEqual([table('C')]);
});

test('rejects gaps, wrong epochs and malformed frames atomically and recovers with a baseline', () => {
  const state = new LobbyState();
  state.apply(snapshot([table('A')]));
  for (const value of [
    delta(2),
    { ...delta(1), epoch: 'other' },
    delta(1, [table('B')], ['B']),
    { ...delta(1), upserts: [{ code: 'broken' }] },
  ]) {
    expect(() => state.apply(value)).toThrow();
  }
  expect(state.apply(delta(1, [table('B')]))).toEqual([table('A'), table('B')]);
  expect(state.apply(snapshot([table('C')], 0, 'server-b'))).toEqual([table('C')]);
  expect(state.apply([table('D')])).toEqual([table('D')]);
  expect(() => state.apply(delta(1))).toThrow();
});

class FakeEventSource {
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  static initialReadyState = 1;
  readyState = FakeEventSource.initialReadyState;
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  FakeEventSource.initialReadyState = FakeEventSource.OPEN;
  vi.mocked(api).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('ignores stale HTTP and closed stream callbacks; reconnect requires a fresh baseline', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const change = vi.fn();
  const error = vi.fn();
  const feed = new LobbyFeed(change, error);
  feed.start();
  const old = FakeEventSource.instances[0];
  expect(old.url).toContain('transport=2');
  old.message(snapshot([table('A')]));
  old.message(delta(1, [], ['A']));
  finish(snapshot([table('A')]));
  await feed.refresh();
  expect(change).toHaveBeenLastCalledWith([]);
  old.message(delta(3));
  expect(old.close).toHaveBeenCalled();
  old.message(snapshot([table('STALE')]));
  await vi.advanceTimersByTimeAsync(500);
  const fresh = FakeEventSource.instances[1];
  fresh.message(snapshot([table('NEW')], 3));
  expect(change).toHaveBeenLastCalledWith([table('NEW')]);
  feed.stop();
  fresh.message(snapshot([table('LATE')], 4));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(change).toHaveBeenLastCalledWith([table('NEW')]);
  expect(FakeEventSource.instances).toHaveLength(2);
  expect(error).not.toHaveBeenCalled();
});

test('deduplicates outage HTTP refreshes and accepts legacy responses during rollout', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const change = vi.fn();
  const feed = new LobbyFeed(change, vi.fn());
  feed.start();
  FakeEventSource.instances[0].readyState = 0;
  await vi.advanceTimersByTimeAsync(16_000);
  expect(api).toHaveBeenCalledTimes(1);
  finish([table('OLD')]);
  await feed.refresh();
  expect(change).toHaveBeenLastCalledWith([table('OLD')]);
  FakeEventSource.instances[0].message([]);
  expect(change).toHaveBeenLastCalledWith([]);
  feed.stop();
});

test('fallback polling cannot postpone a longer SSE retry indefinitely during a sustained outage', async () => {
  vi.mocked(api).mockResolvedValue([]);
  FakeEventSource.initialReadyState = FakeEventSource.CLOSED;
  const change = vi.fn();
  const feed = new LobbyFeed(change, vi.fn());
  feed.start();
  try {
    // Repeated stream failures exhaust short backoffs. The long retry delay
    // then exceeds the eight-second fallback polling interval.
    await vi.advanceTimersByTimeAsync(48_000);
    const attemptsBeforeRecovery = FakeEventSource.instances.length;
    FakeEventSource.initialReadyState = FakeEventSource.OPEN;
    await vi.advanceTimersByTimeAsync(48_000);
    expect(FakeEventSource.instances.length).toBeGreaterThan(attemptsBeforeRecovery);
    const recovered = FakeEventSource.instances.at(-1)!;
    expect(recovered.readyState).toBe(FakeEventSource.OPEN);
    recovered.message(snapshot([table('RECOVERED')]));
    expect(change).toHaveBeenLastCalledWith([table('RECOVERED')]);
  } finally {
    feed.stop();
  }
});
