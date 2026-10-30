/// <reference lib="webworker" />
import type { CPURequest } from '#lib/protocol.js';
import { DecisionSession } from './decision.js';
import { loadPolicy } from './load-policy.js';

declare const self: DedicatedWorkerGlobalScope;

const ready = loadPolicy(
  import.meta.env.VITE_CPU_ML_ENABLED === 'true',
  import.meta.env.VITE_CPU_MODEL_MANIFEST ?? '',
).then((policy) => {
  const session = new DecisionSession(policy);
  self.postMessage({ type: 'ready' });
  return session;
});

self.onmessage = async ({ data }: MessageEvent<{ id: string; request: CPURequest }>) => {
  try {
    const session = await ready;
    self.postMessage({ type: 'decision', id: data.id, result: session.decide(data.request) });
  } catch {
    self.postMessage({ type: 'error', error: 'No pudimos calcular la jugada CPU.' });
  }
};
