// Spread reconnect attempts across clients. A socket that repeatedly opens and
// immediately fails must not reset its backoff and recreate a reconnect storm.
export class ReconnectBackoff {
  private attempts = 0;
  private connectedAt?: number;
  private disconnectedAt?: number;
  private timer?: ReturnType<typeof setTimeout>;

  connected() {
    this.connectedAt ??= Date.now();
    this.disconnectedAt = undefined;
  }

  schedule(connect: () => void, minimumDelay = 0) {
    this.cancel();
    if (this.connectedAt !== undefined && Date.now() - this.connectedAt >= 10_000) {
      this.attempts = 0;
    }
    this.connectedAt = undefined;
    this.disconnectedAt ??= Date.now();
    // Empty rooms have a ten-second reconnect grace. Keep trying at least as
    // often as the legacy two-second retry during that window, even if a socket
    // has repeatedly opened and failed. Longer outages can back off further.
    const grace = Date.now() - this.disconnectedAt < 10_000;
    const ceiling = Math.min(grace ? 2_000 : 30_000, 1_000 * 2 ** Math.min(this.attempts++, 5));
    const delay = Math.max(minimumDelay, Math.round(ceiling * (0.5 + Math.random() * 0.5)));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      connect();
    }, delay);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
