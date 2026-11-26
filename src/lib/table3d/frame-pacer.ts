const frameIntervalMs = 1000 / 60;
const timestampToleranceMs = 1.5;

// Keep the deadline on a 60 Hz timeline across display refresh rates. Using
// the previous draw as the deadline would yield one draw per two callbacks at 90 Hz.
export class FramePacer {
  private deadline?: number;
  private lastDraw?: number;

  drawTime(timestamp: number): number | undefined {
    const deadline = this.deadline;
    if (deadline !== undefined && timestamp + timestampToleranceMs < deadline) return undefined;

    const elapsed = this.lastDraw === undefined ? frameIntervalMs : timestamp - this.lastDraw;
    this.lastDraw = timestamp;
    const missedFrame = deadline === undefined || timestamp - deadline >= frameIntervalMs;
    this.deadline = (missedFrame ? timestamp : deadline) + frameIntervalMs;
    return Math.min(0.1, elapsed / 1000);
  }

  reset() {
    this.deadline = this.lastDraw = undefined;
  }
}
