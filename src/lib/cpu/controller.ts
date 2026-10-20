import type { Command, CPUResponse, CPUWork } from '#lib/protocol.js';

export type CPUStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error';

// One controller owns one Worker for the lifetime of a server-granted lease.
// It never sends a result for an obsolete revision or after losing the lease.
export class CPUController {
  private worker?: Worker;
  private work?: CPUWork;
  private pending?: string;
  private lastSubmitted?: string;
  private ready = false;
  private failed = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  private delay?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly send: (seat: number, revision: number, command: Command) => void,
    private readonly changed: (status: CPUStatus, error?: string) => void,
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
    return work?.view ? `${work.seat}:${work.view.revision}` : undefined;
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
        this.fail(data.error);
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
        seat: work.seat,
        entropy: crypto.getRandomValues(new Uint32Array(1))[0],
        view: work.view,
      },
    });
  }

  private accept(key: string, result: CPUResponse) {
    if (!this.work?.view || key !== this.pending || key !== this.key(this.work)) return;
    clearTimeout(this.watchdog);
    if (
      result.error ||
      result.version !== this.work.version ||
      result.revision !== this.work.view.revision ||
      result.seat !== this.work.seat ||
      !result.command
    ) {
      this.fail(result.error ?? 'La respuesta del motor CPU no coincide con esta mano.');
      return;
    }
    // A short visible pause makes calls and card plays readable. The decision
    // itself has already finished off the main thread.
    this.delay = setTimeout(() => {
      if (this.pending !== key || this.key(this.work) !== key) return;
      this.lastSubmitted = key;
      this.pending = undefined;
      this.send(result.seat, result.revision, result.command!);
      this.changed('ready');
    }, 650);
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
    this.ready = false;
    this.failed = false;
    this.changed('idle');
  }
}
