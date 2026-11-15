import type { CPUMemoryRequest, CPURequest, CPUResponse } from '#lib/protocol.js';
import { fallback } from './fallback.js';
import type { LocalPolicy } from './model.js';
import { HandMemory, MemoryReplayRequired } from './memory.js';

const signals = ['none', 'perico', 'perica', 'seven_spades', 'seven_coins', 'receta'] as const;

type MemoryRuntime = Pick<
  LocalPolicy,
  'resetMemory' | 'advanceMemory' | 'saveMemory' | 'restoreMemory'
>;
type SessionPolicy = Pick<LocalPolicy, 'decide' | 'choicePolicy'> &
  Partial<MemoryRuntime> & { readonly recurrent?: boolean; readonly memoryIdentity?: string };

export type CPUDecisionResult =
  { type: 'decision'; result: CPUResponse } | { type: 'memory'; request: CPUMemoryRequest };

// Replay requests never infer an action. Missing journals on older servers or
// restored legacy hands use the heuristic for that work, retaining the model
// for the next complete hand. Corrupt inputs/inference disable this session.
export class DecisionSession {
  source: 'learned' | 'heuristic' | 'random-cut' | 'replay' = 'heuristic';
  private memory?: HandMemory;

  constructor(private policy?: SessionPolicy) {}

  // Direct callers must provide a complete authorized page/replayed prefix.
  // The browser Worker uses process() to request additional pages explicitly.
  decide(request: CPURequest): CPUResponse {
    const reply = this.process(request);
    if (reply.type === 'memory')
      throw new Error('Authorized hand replay requires additional pages');
    return reply.result;
  }

  process(request: CPURequest): CPUDecisionResult {
    this.source = request.view.phase === 'cutting' ? 'random-cut' : 'heuristic';
    const baseline = fallback(request);
    const heuristic: CPUDecisionResult = { type: 'decision', result: baseline };
    if (baseline.error || !this.policy || request.version !== 2 || request.view.phase === 'cutting')
      return heuristic;
    // Older hosts may still offer a heads-up signal turn. Consume it silently
    // without querying or disabling the model; new hosts never offer one.
    if (request.kind === 'signal' && request.view.config.players !== 4) return heuristic;
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
        !signal &&
        this.policy.choicePolicy &&
        this.policy.choicePolicy !== request.features.choicePolicy
      )
        throw new Error('Host does not supply the model’s CPU choices');
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
      let acknowledgement: Pick<CPUResponse, 'memoryHand' | 'memoryCursor'> = {};
      if (this.policy.recurrent) {
        // No suffix reconstructed from the current state can replace a missing
        // historical journal. Wait for a later complete hand rather than using
        // invented or another seat's memory.
        if (!request.memory || !request.memoryKey || request.memory.complete === false)
          return heuristic;
        if (
          typeof request.memoryKey !== 'string' ||
          request.memory.hand !== request.view.handNumber ||
          typeof this.policy.memoryIdentity !== 'string' ||
          !this.policy.memoryIdentity ||
          typeof this.policy.resetMemory !== 'function' ||
          typeof this.policy.advanceMemory !== 'function' ||
          typeof this.policy.saveMemory !== 'function' ||
          typeof this.policy.restoreMemory !== 'function'
        )
          throw new Error('Invalid recurrent policy contract');
        const key = `${this.policy.memoryIdentity}:${request.memoryKey}:${request.seat}`;
        this.memory ??= new HandMemory(this.policy as MemoryRuntime);
        let complete: boolean;
        try {
          complete = this.memory.advance(key, request.memory);
        } catch (error) {
          if (!(error instanceof MemoryReplayRequired)) throw error;
          return this.replay(request, 0);
        }
        // Even a previously cached duplicate page must be acknowledged before
        // the server can move its own cursor to the next authorized page.
        if (!complete || request.memory.end < request.memory.total)
          return this.replay(request, request.memory.end);
        if (request.memory.total === 0) return heuristic;
        acknowledgement = {
          memoryHand: request.memory.hand,
          memoryCursor: request.memory.total,
        };
      }
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
        ...acknowledgement,
      };
      if (signal) result.signal = signals[index];
      else result.command = request.view.legal[index];
      this.source = 'learned';
      return { type: 'decision', result };
    } catch {
      this.policy = undefined;
      this.memory = undefined;
      return heuristic;
    }
  }

  private replay(request: CPURequest, cursor: number): CPUDecisionResult {
    this.source = 'replay';
    return {
      type: 'memory',
      request: {
        seat: request.seat,
        token: request.token!,
        memoryHand: request.memory!.hand,
        memoryCursor: cursor,
      },
    };
  }
}
