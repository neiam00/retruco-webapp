/// <reference lib="webworker" />
import type { CPURequest } from '#lib/protocol.js';
import { DecisionSession } from './decision.js';
import { loadPolicy } from './load-policy.js';

declare const self: DedicatedWorkerGlobalScope;

// The evaluation exception is compiled out of production and restricted to a
// developer's loopback server. It never modifies the artifact's approval flag.
const evaluation =
  import.meta.env.DEV &&
  import.meta.env.VITE_CPU_EVALUATION === 'true' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

const ready = loadPolicy(
  import.meta.env.VITE_CPU_ML_ENABLED === 'true',
  import.meta.env.VITE_CPU_MODEL_MANIFEST ?? '',
  evaluation ? 'evaluation' : 'release',
).then((policy) => {
  const session = new DecisionSession(policy);
  self.postMessage({ type: 'ready' });
  return session;
});

self.onmessage = async ({ data }: MessageEvent<{ id: string; request: CPURequest }>) => {
  try {
    const session = await ready;
    const reply = session.process(data.request);
    self.postMessage({ ...reply, id: data.id, source: session.source });
  } catch {
    self.postMessage({ type: 'error', id: data.id, error: 'No pudimos calcular la jugada CPU.' });
  }
};
