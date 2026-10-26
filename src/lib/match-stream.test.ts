import { expect, test } from 'vitest';
import { MatchStream, type GameUpdateMessage } from './match-stream.js';
import type { Snapshot } from './protocol.js';

function baseline(): Snapshot {
  return {
    code: 'TABLE',
    private: true,
    config: { players: 4, target: 24, florRequired: true },
    seats: [{ id: 'ana', name: 'Ana' }],
    seat: 0,
    perspective: 0,
    sequence: 8,
    deadline: '2026-10-26T10:00:30Z',
    serverTime: '2026-10-26T10:00:00Z',
    chat: [{ id: 7, name: 'Ana', text: 'Hola', spectator: false }],
    signals: [{ id: 8, seat: 0, kind: 'smile' }],
    events: [{ id: 6, hand: 1, event: { type: 'call', seat: 0, kind: 'truco' } }],
    cantoHistory: [{ id: 6, hand: 1, event: { type: 'call', seat: 0, kind: 'truco' } }],
  };
}

function update(data: Snapshot, sequence = 2): GameUpdateMessage {
  // The wire update deliberately has no history fields.
  const { chat, events, cantoHistory, ...current } = data;
  void [chat, events, cantoHistory];
  return {
    type: 'game_update',
    data: current,
    stream: { epoch: 'connection-a', sequence, baseSequence: sequence - 1 },
  };
}

test('reconstructs current state and capped histories without mutating previous snapshots', () => {
  const stream = new MatchStream();
  const first = baseline();
  stream.receive({ type: 'snapshot', data: first, stream: { epoch: 'connection-a', sequence: 1 } });
  const second = { ...first, sequence: 9, updating: true, signals: [], cpuController: 2 };
  const message = update(second);
  const chat = { id: 9, name: 'Luis', text: 'Buenas', spectator: true };
  message.history = { chat: { reset: false, items: [chat], keep: 1 } };
  const result = stream.receive(message)!;
  expect(result).toEqual({ ...second, chat: [chat] });
  expect(first.chat).toEqual([{ id: 7, name: 'Ana', text: 'Hola', spectator: false }]);
  expect(result.events).toBe(first.events);
  expect(result.cantoHistory).toBe(first.cantoHistory);

  const reset = update({ ...second, sequence: 10 }, 3);
  delete reset.data.updating;
  reset.history = {
    events: { reset: true, items: [], keep: 0 },
    cantoHistory: { reset: true, items: [], keep: 0 },
  };
  const resumed = stream.receive(reset);
  expect(resumed).toMatchObject({ chat: [chat], events: [], cantoHistory: [] });
  expect(resumed).not.toHaveProperty('updating');
});

test.each(['missing baseline', 'sequence gap', 'wrong base', 'new epoch'])(
  'requires a full resync on %s and accepts the replacement perspective',
  (failure) => {
    const stream = new MatchStream();
    const first = baseline();
    if (failure !== 'missing baseline') {
      stream.receive({
        type: 'snapshot',
        data: first,
        stream: { epoch: 'connection-a', sequence: 1 },
      });
    }
    const message = update({ ...first, sequence: 9 });
    if (failure === 'sequence gap') message.stream.sequence = 3;
    if (failure === 'wrong base') message.stream.baseSequence = 0;
    if (failure === 'new epoch') message.stream.epoch = 'connection-b';
    expect(stream.receive(message)).toBeNull();
    const replacement = { ...first, perspective: 3, chat: [], events: [], cantoHistory: [] };
    expect(
      stream.receive({
        type: 'snapshot',
        data: replacement,
        stream: { epoch: 'connection-b', sequence: 10 },
      }),
    ).toEqual(replacement);
    const next = update({ ...replacement, sequence: 12 });
    next.stream = { epoch: 'connection-b', sequence: 11, baseSequence: 10 };
    expect(stream.receive(next)).toEqual({ ...replacement, sequence: 12 });
  },
);

test('supports legacy full snapshots during mixed-version deployments', () => {
  const stream = new MatchStream();
  const first = baseline();
  expect(stream.receive({ type: 'snapshot', data: first })).toEqual(first);
  const next = { ...first, cpuPaused: true, deadline: '0001-01-01T00:00:00Z' };
  expect(stream.receive({ type: 'snapshot', data: next })).toEqual(next);
  expect(stream.receive(update(next))).toBeNull();
});

test('does not advance the stream after a malformed history update', () => {
  const stream = new MatchStream();
  const first = baseline();
  stream.receive({ type: 'snapshot', data: first, stream: { epoch: 'connection-a', sequence: 1 } });
  const message = update({ ...first, sequence: 9 });
  message.history = { chat: { reset: false, items: [], keep: -1 } };
  expect(() => stream.receive(message)).toThrow('Invalid history update');
  delete message.history;
  expect(stream.receive(message)?.sequence).toBe(9);
});
