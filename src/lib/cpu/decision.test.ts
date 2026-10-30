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
    features: {
      version: 1,
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
