/// <reference lib="webworker" />
import './vendor/wasm_exec.js';
import engineURL from './vendor/cpu.wasm?url';
import type { CPURequest, CPUResponse } from '#lib/protocol.js';

declare const self: DedicatedWorkerGlobalScope & {
  Go: new () => {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  };
  retrucoCPUDecide?: (request: string) => string;
};

async function initialize() {
  const go = new self.Go();
  const response = await fetch(engineURL);
  if (!response.ok) throw new Error('No pudimos descargar el motor CPU.');
  const { instance } = await WebAssembly.instantiateStreaming(response, go.importObject);
  // Go's main remains alive to receive decisions; this promise resolves only
  // when the runtime exits, not when initialization finishes.
  void go
    .run(instance)
    .catch(() => self.postMessage({ type: 'error', error: 'El motor CPU se detuvo.' }));
  if (!self.retrucoCPUDecide) throw new Error('El motor CPU no pudo iniciar.');
  self.postMessage({ type: 'ready' });
}

const ready = initialize();
void ready.catch((error: unknown) => {
  self.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : 'No pudimos iniciar la CPU.',
  });
});

self.onmessage = async ({ data }: MessageEvent<{ id: string; request: CPURequest }>) => {
  try {
    await ready;
    const result = JSON.parse(self.retrucoCPUDecide!(JSON.stringify(data.request))) as CPUResponse;
    self.postMessage({ type: 'decision', id: data.id, result });
  } catch {
    self.postMessage({ type: 'error', error: 'No pudimos calcular la jugada CPU.' });
  }
};
