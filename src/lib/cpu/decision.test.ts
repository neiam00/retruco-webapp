import { expect, test, vi } from 'vitest';
import type { CPURequest } from '#lib/protocol.js';
import corpus from './testdata/native-policy.json';
import { DecisionSession } from './decision.js';
import { fallback } from './fallback.js';

function request(kind: 'game' | 'signal'): CPURequest {
  const base = corpus.find((c) => c.request.view.phase === 'playing')!
    .request as unknown as CPURequest;
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

test.each([
  'value-and-team-v1',
  'value-and-team-v2',
  'value-and-team-v3',
  'value-and-team-v4',
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
