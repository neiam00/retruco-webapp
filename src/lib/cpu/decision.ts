import type { CPURequest, CPUResponse } from '#lib/protocol.js';
import { fallback } from './fallback.js';
import type { LocalPolicy } from './model.js';

const signals = ['none', 'perico', 'perica', 'seven_spades', 'seven_coins', 'receta'] as const;

// One session permanently falls back after an invalid observation or inference
// failure. A controller retry creates a fresh session and can reload the model.
export class DecisionSession {
  source: 'learned' | 'heuristic' | 'random-cut' = 'heuristic';
  constructor(private policy?: Pick<LocalPolicy, 'decide'>) {}

  decide(request: CPURequest): CPUResponse {
    this.source = request.view.phase === 'cutting' ? 'random-cut' : 'heuristic';
    const baseline = fallback(request);
    if (baseline.error || !this.policy || request.version !== 2 || request.view.phase === 'cutting')
      return baseline;
    try {
      if (
        !request.token ||
        !request.features ||
        request.features.version !== 2 ||
        !['game', 'signal'].includes(request.kind ?? '')
      )
        throw new Error('Unsupported model input');
      const signal = request.kind === 'signal';
      if (
        signal &&
        (!request.signalMask ||
          request.signalMask.length !== 6 ||
          request.signalMask[0] !== true ||
          request.signalMask.some((x) => typeof x !== 'boolean'))
      )
        throw new Error('Missing truthful signal mask');
      if (!signal && request.features.actions.length !== request.view.legal.length)
        throw new Error('Candidate mismatch');
      const index = this.policy.decide(
        request.features.state,
        request.features.actions,
        signal,
        request.entropy,
        signal ? request.signalMask : undefined,
      );
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= (signal ? signals.length : request.view.legal.length) ||
        (signal && request.signalMask?.[index] !== true)
      )
        throw new Error('Invalid selection');
      const result: CPUResponse = {
        version: 2,
        seat: request.seat,
        revision: request.view.revision,
        kind: request.kind,
        token: request.token,
      };
      if (signal) result.signal = signals[index];
      else result.command = request.view.legal[index];
      this.source = 'learned';
      return result;
    } catch {
      this.policy = undefined;
      return baseline;
    }
  }
}
