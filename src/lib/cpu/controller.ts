import type { Command, CPUMemoryRequest, CPUResponse, CPUWork } from '#lib/protocol.js';

export type CPUStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error';

// One controller owns one Worker for the lifetime of a server-granted lease.
// It never sends a result for an obsolete revision or after losing the lease.
export class CPUController {
  private worker?: Worker;
  private work?: CPUWork;
  private pending?: string;
  private lastSubmitted?: string;
  private lastMemoryRequest?: string;
  private ready = false;
  private failed = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  private delay?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly send: (
      seat: number,
      revision: number,
      command: Command | undefined,
      decision?: CPUResponse,
    ) => void,
    private readonly changed: (status: CPUStatus, error?: string) => void,
    private readonly presentationBusy: () => boolean = () => false,
    private readonly requestMemory?: (request: CPUMemoryRequest) => void,
  ) {}

  update(work?: CPUWork) {
    if (!work?.controlled) {
      this.stop();
      return;
    }
    const previousKey = this.key(this.work);
    this.work = work;
    if (previousKey !== this.key(work)) {
      this.pending = undefined;
      this.lastSubmitted = undefined;
      this.lastMemoryRequest = undefined;
      clearTimeout(this.delay);
      if (this.ready) clearTimeout(this.watchdog);
    }
    if (this.failed) return;
    if (!this.worker) {
      try {
        this.start();
      } catch {
        this.fail('Este navegador no pudo iniciar el motor CPU.');
        return;
      }
    }
    if (this.ready) this.decide();
  }

  retry() {
    const work = this.work;
    this.stop();
    this.update(work);
  }

  private key(work?: CPUWork) {
    if (!work?.view) return undefined;
    return work.version === 2 ? work.token : `${work.seat}:${work.view.revision}`;
  }

  private start() {
    this.changed('loading');
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'retruco-cpu',
    });
    this.worker = worker;
    this.watchdog = setTimeout(
      () => this.fail('El motor CPU tardó demasiado en iniciar. Inténtalo de nuevo.'),
      15000,
    );
    worker.onerror = () => {
      if (this.worker === worker) {
        this.fail('No pudimos cargar el motor CPU. Revisa la conexión e inténtalo de nuevo.');
      }
    };
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      if (data.type === 'ready') {
        clearTimeout(this.watchdog);
        this.ready = true;
        this.changed('ready');
        this.decide();
      } else if (data.type === 'error') {
        if (data.id !== undefined && (data.id !== this.pending || data.id !== this.key(this.work)))
          return;
        this.fail(data.error);
      } else if (data.type === 'memory') {
        this.acceptMemory(data.id, data.request as CPUMemoryRequest);
      } else if (data.type === 'decision') {
        this.accept(data.id, data.result as CPUResponse);
      }
    };
  }

  private decide() {
    const work = this.work;
    const key = this.key(work);
    if (!work?.view || !key) {
      this.changed('ready');
      return;
    }
    if (this.pending === key || this.lastSubmitted === key) return;
    this.pending = key;
    this.changed('thinking');
    this.watchdog = setTimeout(
      () => this.fail('La CPU tardó demasiado en responder. Inténtalo de nuevo.'),
      5000,
    );
    this.worker?.postMessage({
      id: key,
      request: {
        version: work.version,
        kind: work.kind,
        token: work.token,
        features: work.features,
        signalMask: work.signalMask,
        memoryKey: work.memoryKey,
        memory: work.memory,
        seat: work.seat,
        entropy: crypto.getRandomValues(new Uint32Array(1))[0],
        view: work.view,
      },
    });
  }

  private acceptMemory(key: string, request: CPUMemoryRequest) {
    const work = this.work;
    if (!work?.view || key !== this.pending || key !== this.key(work)) return;
    const page = work.memory;
    if (
      !this.requestMemory ||
      !page ||
      page.version !== 1 ||
      page.complete !== true ||
      request.seat !== work.seat ||
      request.token !== work.token ||
      request.memoryHand !== page.hand ||
      !Number.isSafeInteger(request.memoryCursor) ||
      !(request.memoryCursor === page.end || (request.memoryCursor === 0 && page.start > 0))
    ) {
      this.fail('El motor CPU no pudo sincronizar esta mano. Inténtalo de nuevo.');
      return;
    }
    const identity = `${key}:${request.memoryHand}:${request.memoryCursor}`;
    if (this.lastMemoryRequest === identity) return;
    this.lastMemoryRequest = identity;
    // Keep the pending token until the server publishes the next page. Duplicate
    // snapshots cannot repeatedly acknowledge a page or rewind a fresh worker.
    this.requestMemory(request);
  }

  private accept(key: string, result: CPUResponse) {
    if (!this.work?.view || key !== this.pending || key !== this.key(this.work)) return;
    clearTimeout(this.watchdog);
    if (
      result.error ||
      result.version !== this.work.version ||
      result.revision !== this.work.view.revision ||
      result.seat !== this.work.seat ||
      (this.work.version === 2 &&
        (result.token !== this.work.token || result.kind !== this.work.kind)) ||
      ((result.memoryHand !== undefined || result.memoryCursor !== undefined) &&
        (!this.work.memory ||
          this.work.memory.complete !== true ||
          result.memoryHand !== this.work.memory.hand ||
          result.memoryCursor !== this.work.memory.total ||
          this.work.memory.end !== this.work.memory.total)) ||
      (this.work.kind === 'signal'
        ? !result.signal ||
          !['none', 'perico', 'perica', 'seven_spades', 'seven_coins', 'receta'].includes(
            result.signal,
          ) ||
          !!result.command
        : !result.command)
    ) {
      this.fail(result.error ?? 'La respuesta del motor CPU no coincide con esta mano.');
      return;
    }
    // A short visible pause makes calls and card plays readable. The decision
    // itself has already finished off the main thread.
    const submit = () => {
      if (this.pending !== key || this.key(this.work) !== key) return;
      // Let dealt cards arrive before a CPU plays one. Decisions are still
      // computed immediately; only the existing presentation pause is extended.
      if (result.kind !== 'signal' && this.presentationBusy()) {
        this.delay = setTimeout(submit, 50);
        return;
      }
      this.lastSubmitted = key;
      this.pending = undefined;
      if (result.version === 2) this.send(result.seat, result.revision, result.command, result);
      else this.send(result.seat, result.revision, result.command!);
      this.changed('ready');
    };
    this.delay = setTimeout(submit, result.kind === 'signal' ? 0 : 650);
  }

  private fail(error: string) {
    const work = this.work;
    this.stop();
    this.work = work;
    this.failed = true;
    this.changed('error', error);
  }

  stop() {
    clearTimeout(this.watchdog);
    clearTimeout(this.delay);
    this.worker?.terminate();
    this.worker = undefined;
    this.work = undefined;
    this.pending = undefined;
    this.lastSubmitted = undefined;
    this.lastMemoryRequest = undefined;
    this.ready = false;
    this.failed = false;
    this.changed('idle');
  }
}
