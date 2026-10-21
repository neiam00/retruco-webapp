import { expect, test } from '@playwright/test';
import type { Snapshot } from '../src/lib/protocol.js';

declare global {
  interface Window {
    renderGame?: Snapshot;
    renderSocket?: WebSocket;
    renderMetrics: {
      expectedPlays: number;
      terminalPlays: number;
      flights: number;
      undecoded: number;
      completed: number;
      cancelled: number;
      frames: number[];
    };
  }
}

for (const players of [2, 4]) {
  test(`Retina rendering with ${players} seats preserves CPU card animations`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 650 },
      deviceScaleFactor: 2,
      baseURL,
    });
    if (players === 4) {
      // Slow image delivery must delay the visual start, not consume the whole
      // flight before the browser has pixels to paint.
      await context.route('**/cards/*.webp', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 650));
        await route.continue();
      });
    }
    await context.addInitScript(() => {
      window.renderMetrics = {
        expectedPlays: 0,
        terminalPlays: 0,
        flights: 0,
        undecoded: 0,
        completed: 0,
        cancelled: 0,
        frames: [],
      };
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (!new URL(url).pathname.endsWith('/ws')) return;
          window.renderSocket = this;
          this.addEventListener('message', ({ data }) => {
            const message = JSON.parse(data);
            if (message.type !== 'snapshot') return;
            const previous = window.renderGame?.state;
            window.renderGame = message.data;
            const next = window.renderGame?.state;
            if (!previous || !next || previous.handNumber !== next.handNumber) return;
            for (const [seat, player] of next.seats.entries()) {
              for (const [round, play] of player.plays.entries()) {
                if (play.present && !previous.seats[seat].plays[round].present) {
                  window.renderMetrics.expectedPlays++;
                  if (next.phase === 'hand_over' || next.phase === 'match_over')
                    window.renderMetrics.terminalPlays++;
                }
              }
            }
          });
        }
      };
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLImageElement) || node.dataset.cardFlight !== 'play') continue;
            window.renderMetrics.flights++;
            if (!node.complete || !node.naturalWidth) window.renderMetrics.undecoded++;
            const animation = node.getAnimations()[0];
            if (!animation) continue;
            void animation.finished.then(
              () => {
                window.renderMetrics.completed++;
              },
              () => {
                window.renderMetrics.cancelled++;
              },
            );
            // Scroll during a real card flight: the card should move with the table,
            // not disappear because a scroll listener cancels every animation.
            if (window.renderMetrics.flights === 1) window.scrollTo(0, 80);
          }
      }).observe(document, { childList: true, subtree: true });
      let previousFrame = performance.now();
      const frame = (time: number) => {
        window.renderMetrics.frames.push(time - previousFrame);
        previousFrame = time;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const page = await context.newPage();
    try {
      const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
      const headers = { Origin: baseURL! };
      expect(
        (
          await context.request.post(`${api}/api/guest`, {
            headers,
            data: { name: 'Renderer CPU' },
          })
        ).ok(),
      ).toBe(true);
      const created = await context.request.post(`${api}/api/matches`, {
        headers,
        data: {
          private: true,
          config: { players, target: 24, florRequired: false },
          options: { cpuSeats: Array.from({ length: players - 1 }, (_, index) => index + 1) },
        },
      });
      expect(created.ok()).toBe(true);
      const { code } = await created.json();
      await page.goto(`/mesa/${code}`);
      await expect(page.getByText('En línea', { exact: true })).toBeVisible();
      for (let step = 0; step < 300; step++) {
        const done = await page.evaluate(() => {
          const state = window.renderGame?.state;
          if (!state) return false;
          if (window.renderMetrics.terminalPlays > 0 && state.phase === 'hand_over') return true;
          if (state.phase === 'match_over') return true;
          const command =
            state.legal.find((c) => c.type === 'cut') ??
            state.legal.find((c) => c.type === 'respond' && c.kind === 'accept') ??
            state.legal.find((c) => c.type === 'respond') ??
            state.legal.find((c) => c.type === 'play') ??
            state.legal.find((c) => c.type === 'stack');
          if (command)
            window.renderSocket?.send(
              JSON.stringify({
                input: { id: crypto.randomUUID(), revision: state.revision, command },
              }),
            );
          return false;
        });
        if (done) break;
        await page.waitForTimeout(100);
      }
      await expect(page.locator('[data-card-flight]')).toHaveCount(0);
      await expect(page.locator('.table-status.results')).toBeVisible();
      const metrics = await page.evaluate(() => window.renderMetrics);
      await testInfo.attach('renderer-metrics', {
        body: JSON.stringify(metrics),
        contentType: 'application/json',
      });
      expect(metrics.terminalPlays).toBeGreaterThan(0);
      expect(metrics.flights).toBe(metrics.expectedPlays);
      expect(metrics.cancelled).toBe(0);
      expect(metrics.undecoded).toBe(0);
      expect(metrics.completed).toBe(metrics.expectedPlays);
      const frames = metrics.frames.toSorted((a, b) => a - b);
      console.log(
        'Renderer:',
        JSON.stringify({
          players,
          flights: metrics.flights,
          completed: metrics.completed,
          cancelled: metrics.cancelled,
          undecoded: metrics.undecoded,
          p95FrameMs: frames[Math.floor(frames.length * 0.95)],
          maxFrameMs: frames.at(-1),
        }),
      );
      expect(frames.length).toBeGreaterThan(10);
      expect(frames[Math.floor(frames.length * 0.95)]).toBeLessThan(50);
      await page.screenshot({
        path: `output/playwright/renderer-${testInfo.project.name}.png`,
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
}
