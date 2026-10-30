import { API_ORIGIN } from '$app/env/public';
import { api } from './api.js';
import { ReconnectBackoff } from './reconnect.js';
import type { Listing } from './protocol.js';

export type LobbySnapshot = {
  type: 'listings_snapshot';
  epoch: string;
  revision: number;
  listings: Listing[];
};
export type LobbyDelta = {
  type: 'listings_delta';
  epoch: string;
  baseRevision: number;
  revision: number;
  upserts: Listing[];
  removed: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function listings(value: unknown): value is Listing[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item.code === 'string' &&
        item.code.length > 0 &&
        typeof item.host === 'string' &&
        revision(item.players) &&
        revision(item.capacity) &&
        revision(item.target) &&
        typeof item.florRequired === 'boolean' &&
        typeof item.started === 'boolean' &&
        (item.cpuPlayers === undefined || revision(item.cpuPlayers)),
    ) &&
    new Set(value.map((item) => item.code)).size === value.length
  );
}

// Cursor and data change together only after validating the complete frame.
export class LobbyState {
  private epoch?: string;
  private version = 0;
  private rows = new Map<string, Listing>();

  apply(value: unknown): Listing[] | undefined {
    if (listings(value)) {
      this.epoch = undefined;
      this.version = 0;
      this.rows = new Map(value.map((item) => [item.code, item]));
      return [...value];
    }
    if (
      !record(value) ||
      typeof value.epoch !== 'string' ||
      !value.epoch ||
      !revision(value.revision)
    ) {
      throw new Error('Invalid lobby frame');
    }
    if (value.type === 'listings_snapshot' && listings(value.listings)) {
      if (value.epoch === this.epoch && value.revision < this.version) return;
      this.epoch = value.epoch;
      this.version = value.revision;
      this.rows = new Map(value.listings.map((item) => [item.code, item]));
      return this.values();
    }
    if (
      value.type !== 'listings_delta' ||
      !revision(value.baseRevision) ||
      value.revision !== value.baseRevision + 1 ||
      !listings(value.upserts) ||
      !Array.isArray(value.removed) ||
      !value.removed.every((code) => typeof code === 'string' && code.length > 0) ||
      new Set(value.removed).size !== value.removed.length ||
      value.upserts.some((item) => (value.removed as string[]).includes(item.code))
    )
      throw new Error('Invalid lobby delta');
    if (value.epoch !== this.epoch) throw new Error('Lobby epoch changed');
    if (value.revision <= this.version) return;
    if (value.baseRevision !== this.version) throw new Error('Lobby revision gap');
    for (const code of value.removed) this.rows.delete(code);
    for (const item of value.upserts) this.rows.set(item.code, item);
    this.version = value.revision;
    return this.values();
  }

  private values() {
    return [...this.rows.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
}

// Browser transport owns generations so neither a stale HTTP response nor an
// already-closed EventSource can restore removed rooms. The page owns rendering.
export class LobbyFeed {
  private state = new LobbyState();
  private active = false;
  private stream?: EventSource;
  private generation = 0;
  private requestRevision = 0;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private reconnect = new ReconnectBackoff();
  private reconnectScheduled = false;

  constructor(
    private readonly change: (rows: Listing[]) => void,
    private readonly error: (message: string) => void,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    void this.refresh();
    this.connect();
    this.scheduleFallback();
  }

  stop() {
    this.active = false;
    this.generation++;
    this.requestRevision++;
    this.stream?.close();
    this.reconnect.cancel();
    this.reconnectScheduled = false;
    clearTimeout(this.timer);
  }

  refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending;
    const request = ++this.requestRevision;
    const work = api<unknown>('/matches?transport=2')
      .then((value) => {
        if (!this.active || request !== this.requestRevision) return;
        const rows = this.state.apply(value);
        if (rows) this.change(rows);
      })
      .catch((reason: unknown) => {
        if (this.active && request === this.requestRevision) {
          this.error(reason instanceof Error ? reason.message : 'No pudimos cargar las mesas.');
        }
      })
      .finally(() => {
        if (this.pending === work) this.pending = undefined;
      });
    this.pending = work;
    return work;
  }

  private connect() {
    if (!this.active) return;
    const generation = ++this.generation;
    this.stream?.close();
    const stream = new EventSource(`${API_ORIGIN}/api/matches/events?transport=2`, {
      withCredentials: true,
    });
    this.stream = stream;
    let baseline = false;
    stream.onopen = () => {
      // Automatic EventSource reconnects also begin a new baseline.
      baseline = false;
    };
    stream.onmessage = (event) => {
      if (!this.active || generation !== this.generation) return;
      try {
        const value: unknown = JSON.parse(event.data);
        if (
          !baseline &&
          !Array.isArray(value) &&
          (!record(value) || value.type !== 'listings_snapshot')
        ) {
          throw new Error('Expected lobby baseline');
        }
        const rows = this.state.apply(value);
        baseline = true;
        this.requestRevision++;
        this.reconnect.connected();
        if (rows) this.change(rows);
      } catch {
        stream.close();
        this.generation++;
        this.stream = undefined;
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    // Polling can run more frequently than the backoff. Keep its original
    // deadline instead of canceling and postponing it on every fallback tick.
    if (!this.active || this.reconnectScheduled) return;
    this.reconnectScheduled = true;
    this.reconnect.schedule(() => {
      this.reconnectScheduled = false;
      this.connect();
    });
  }

  private scheduleFallback() {
    this.timer = setTimeout(
      () => {
        if (!this.active) return;
        if (this.stream?.readyState !== EventSource.OPEN) void this.refresh();
        if (!this.stream || this.stream.readyState === EventSource.CLOSED) {
          this.scheduleReconnect();
        }
        this.scheduleFallback();
      },
      8_000 + Math.random() * 4_000,
    );
  }
}
