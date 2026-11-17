import { expect, test, vi } from 'vitest';
import type { CPUMemoryPage, CPURequest } from '#lib/protocol.js';
import corpus from './testdata/native-policy.json';
import { DecisionSession } from './decision.js';
import { fallback } from './fallback.js';

function request(kind: 'game' | 'signal'): CPURequest {
  const base = corpus.find(
    (c) => c.request.view.phase === 'playing' && c.request.view.config.players === 4,
  )!.request as unknown as CPURequest;
  return {
    ...base,
    version: 2,
    kind,
    token: 'work-token',
    signalMask: [true, true, true, true, true, true],
    features: {
      version: 2,
      state: new Array(768).fill(0),
      actions: base.view.legal.map(() => new Array(48).fill(0)),
    },
  };
}
test('maps signal logits separately from legal game actions', () => {
  const decide = vi.fn().mockReturnValue(5);
  const result = new DecisionSession({ decide }).decide(request('signal'));
  expect(result).toMatchObject({ signal: 'receta', token: 'work-token', kind: 'signal' });
  expect(result.command).toBeUndefined();
});
test('silences a legacy heads-up signal request without disabling game inference', () => {
  const decide = vi.fn().mockReturnValue(0);
  const session = new DecisionSession({ decide });
  const input = request('signal');
  input.view = { ...input.view, config: { ...input.view.config, players: 2 } };
  input.seat = 1;
  expect(session.decide(input).signal).toBe('none');
  expect(decide).not.toHaveBeenCalled();
  expect(session.decide(request('game')).command).toBeDefined();
  expect(decide).toHaveBeenCalledTimes(1);
  expect(session.source).toBe('learned');
});
test('falls back to none when a model ignores the truthful signal mask', () => {
  const input = request('signal');
  input.signalMask = [true, false, false, false, false, false];
  expect(new DecisionSession({ decide: () => 5 }).decide(input).signal).toBe('none');
});
test('falls back for the whole session after invalid model output', () => {
  const decide = vi.fn().mockReturnValue(-1);
  const session = new DecisionSession({ decide });
  const input = request('game');
  expect(session.decide(input)).toEqual(fallback(input));
  expect(session.decide(input)).toEqual(fallback(input));
  expect(decide).toHaveBeenCalledTimes(1);
  expect(session.decide(request('signal')).signal).toBe('none');
});
test('uses the original complete candidate including declaration and mode', () => {
  const input = request('game');
  const last = input.view.legal.length - 1;
  expect(new DecisionSession({ decide: () => last }).decide(input).command).toBe(
    input.view.legal[last],
  );
});

function recurrentPolicy() {
  let state = new Float32Array(128);
  return {
    recurrent: true,
    memoryIdentity: 'model-hash:runtime-hash:2:1',
    resetMemory: () => {
      state = new Float32Array(128);
    },
    saveMemory: () => state.slice(),
    restoreMemory: (value: Float32Array) => {
      state = value.slice();
    },
    advanceMemory: vi.fn((event: ArrayLike<number>) => {
      state[0] += event[0];
    }),
    decide: vi.fn(
      (_features: number[], actions: number[][]) => Math.trunc(state[0]) % actions.length,
    ),
  };
}

function recurrentRequest(start: number, end: number, total: number, hand = 1): CPURequest {
  const input = request('game');
  const memory: CPUMemoryPage = {
    version: 1,
    hand,
    start,
    end,
    total,
    complete: true,
    events: Array.from({ length: end - start }, (_, i) => [start + i + 1, ...Array(767).fill(0)]),
  };
  return {
    ...input,
    view: { ...input.view, handNumber: hand },
    memoryKey: 'match-seat-lease',
    memory,
  };
}

test('replays authorized pages before inference and acknowledges complete memory', () => {
  const policy = recurrentPolicy();
  const session = new DecisionSession(policy);
  const first = recurrentRequest(0, 1, 3);
  expect(session.process(first)).toEqual({
    type: 'memory',
    request: { seat: first.seat, token: first.token, memoryHand: 1, memoryCursor: 1 },
  });
  expect(session.source).toBe('replay');
  expect(policy.decide).not.toHaveBeenCalled();
  const last = recurrentRequest(1, 3, 3);
  const result = session.decide(last);
  expect(result).toMatchObject({ memoryHand: 1, memoryCursor: 3 });
  expect(result.command).toBe(last.view.legal[6 % last.view.legal.length]);
  expect(session.source).toBe('learned');
  session.decide(last);
  expect(policy.advanceMemory).toHaveBeenCalledTimes(3);
  expect(policy.saveMemory()[0]).toBe(6);
});

test('a replacement worker requests a complete replay instead of losing the learned policy', () => {
  const policy = recurrentPolicy();
  const replacement = new DecisionSession(policy);
  const suffix = recurrentRequest(2, 3, 3);
  expect(replacement.process(suffix)).toMatchObject({
    type: 'memory',
    request: { memoryHand: 1, memoryCursor: 0 },
  });
  expect(policy.decide).not.toHaveBeenCalled();
  replacement.process(recurrentRequest(0, 2, 3));
  const result = replacement.decide(suffix);
  const uninterruptedPolicy = recurrentPolicy();
  const uninterrupted = new DecisionSession(uninterruptedPolicy);
  expect(result).toEqual(uninterrupted.decide(recurrentRequest(0, 3, 3)));
  expect(policy.saveMemory()).toEqual(uninterruptedPolicy.saveMemory());
});

test('cached duplicate prefixes still acknowledge server pagination and keep seats isolated', () => {
  const policy = recurrentPolicy();
  const session = new DecisionSession(policy);
  const input = recurrentRequest(0, 3, 3);
  session.decide(input);
  expect(session.process(recurrentRequest(0, 1, 3))).toMatchObject({
    type: 'memory',
    request: { memoryCursor: 1 },
  });
  expect(policy.advanceMemory).toHaveBeenCalledTimes(3);
  const other = {
    ...recurrentRequest(0, 1, 1),
    seat: (input.seat + 1) % input.view.config.players,
  };
  session.decide(other);
  expect(policy.saveMemory()[0]).toBe(1);
  session.decide(recurrentRequest(2, 3, 3));
  expect(policy.saveMemory()[0]).toBe(6);
  expect(policy.advanceMemory).toHaveBeenCalledTimes(4);
});

test('old-server or incomplete-hand fallback does not disable a later valid hand', () => {
  const policy = recurrentPolicy();
  const session = new DecisionSession(policy);
  expect(session.decide(request('game'))).toEqual(fallback(request('game')));
  const missing = recurrentRequest(0, 1, 1);
  missing.memory!.complete = false;
  expect(session.decide(missing)).toEqual(fallback(missing));
  expect(policy.decide).not.toHaveBeenCalled();
  session.decide(recurrentRequest(0, 1, 1, 2));
  expect(policy.decide).toHaveBeenCalledTimes(1);
  expect(session.source).toBe('learned');
});

test('mismatched hands and conflicting memory fail closed for the learned session', () => {
  const policy = recurrentPolicy();
  const session = new DecisionSession(policy);
  const input = recurrentRequest(0, 1, 1);
  session.decide(input);
  const conflict = recurrentRequest(0, 1, 1);
  conflict.memory!.events[0][0] = 9;
  expect(session.decide(conflict)).toEqual(fallback(conflict));
  session.decide(recurrentRequest(0, 1, 1, 2));
  expect(policy.decide).toHaveBeenCalledTimes(1);
  const wrongHand = recurrentRequest(0, 1, 1);
  wrongHand.view.handNumber = 2;
  const otherPolicy = recurrentPolicy();
  expect(new DecisionSession(otherPolicy).decide(wrongHand)).toEqual(fallback(wrongHand));
  expect(otherPolicy.decide).not.toHaveBeenCalled();
});

test.each([
  'value-and-team-v1',
  'value-and-team-v2',
  'value-and-team-v3',
  'value-and-team-v4',
  'value-and-team-v5',
  'value-and-team-v6',
  'value-and-team-v7',
  'value-and-team-v8',
  'value-and-team-v9',
  'value-and-team-v10',
  'value-and-team-v11',
  'value-and-team-v12',
  'value-and-team-v13',
  'value-and-team-v14',
  'value-and-team-v15',
  'value-and-team-v16',
  'value-and-team-v17',
] as const)('only uses candidates prepared for %s', (choicePolicy) => {
  const input = request('game');
  const decide = vi.fn().mockReturnValue(0);
  const policy = { decide, choicePolicy };
  input.features!.choicePolicy =
    choicePolicy === 'value-and-team-v1' ? 'value-and-team-v2' : 'value-and-team-v1';
  expect(new DecisionSession(policy).decide(input)).toEqual(fallback(input));
  expect(decide).not.toHaveBeenCalled();
  input.features!.choicePolicy = policy.choicePolicy;
  expect(new DecisionSession(policy).decide(input).command).toEqual(input.view.legal[0]);
  expect(decide).toHaveBeenCalledOnce();
});
