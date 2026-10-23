import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Snapshot, CPUWork } from '../src/lib/protocol.js';

declare global {
  interface Window {
    cpuGame?: { data: Snapshot; cpu?: CPUWork };
    gameSocket?: WebSocket;
    cpuMoves: number;
    cpuPerformance: { startupMs: number[]; decisionMs: number[] };
  }
}

async function observeGame(context: BrowserContext) {
  await context.addInitScript(() => {
    window.cpuMoves = 0;
    window.cpuPerformance = { startupMs: [], decisionMs: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private sent = new Map<string, number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        const started = performance.now();
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'ready')
            window.cpuPerformance.startupMs.push(performance.now() - started);
          if (data.type === 'decision' && this.sent.has(data.id)) {
            window.cpuPerformance.decisionMs.push(performance.now() - this.sent.get(data.id)!);
            this.sent.delete(data.id);
          }
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const id = (message as { id?: string }).id;
        if (id) this.sent.set(id, performance.now());
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url).pathname.endsWith('/ws')) {
          window.gameSocket = this;
          this.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'snapshot') window.cpuGame = message;
          });
        }
      }
      send(data: string | Blob | BufferSource) {
        if (typeof data === 'string' && JSON.parse(data).input?.cpuSeat !== undefined)
          window.cpuMoves++;
        super.send(data);
      }
    };
  });
}

async function humanMove(page: Page) {
  return page.evaluate(() => {
    const view = window.cpuGame?.data.state;
    if (!view || view.phase === 'hand_over' || view.phase === 'match_over') return false;
    const command =
      view.legal.find((action) => action.type === 'cut') ??
      view.legal.find((action) => action.type === 'respond' && action.kind === 'accept') ??
      view.legal.find((action) => action.type === 'respond') ??
      view.legal.find((action) => action.type === 'play') ??
      view.legal.find((action) => action.type === 'stack');
    if (!command || window.gameSocket?.readyState !== WebSocket.OPEN) return false;
    window.gameSocket.send(
      JSON.stringify({
        input: { id: crypto.randomUUID(), revision: view.revision, command },
      }),
    );
    return true;
  });
}

async function workerMemory(browser: Browser, page: Page) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = await session.send('Target.getTargets');
    const target = targetInfos.find(
      (item) => item.type === 'worker' && item.url === page.workers()[0].url(),
    );
    if (!target) throw new Error('CPU worker inspection target missing');
    const { sessionId } = await session.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    let sequence = 0;
    async function command<T>(method: string, params: object = {}): Promise<T> {
      const id = ++sequence;
      let listener: ((event: { sessionId: string; message: string }) => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Worker inspection timed out')), 5000);
        listener = (event) => {
          if (event.sessionId !== sessionId) return;
          const message = JSON.parse(event.message);
          if (message.id !== id) return;
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        };
        session.on('Target.receivedMessageFromTarget', listener);
      });
      try {
        await session.send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        });
        return await response;
      } finally {
        clearTimeout(timer);
        if (listener) session.off('Target.receivedMessageFromTarget', listener);
      }
    }
    const memory = await command<Record<string, number>>('Runtime.getHeapUsage');
    const prototype = await command<{ result: { objectId: string } }>('Runtime.evaluate', {
      expression: 'WebAssembly.Memory.prototype',
    });
    const objects = await command<{ objects: { objectId: string } }>('Runtime.queryObjects', {
      prototypeObjectId: prototype.result.objectId,
    });
    const sizes = await command<{ result: { value: number[] } }>('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      functionDeclaration: 'function () { return this.map(memory => memory.buffer.byteLength); }',
      returnByValue: true,
    });
    memory.wasmLinearBytes = sizes.result.value.reduce((sum, size) => sum + size, 0);
    await session.send('Target.detachFromTarget', { sessionId });
    return memory;
  } finally {
    await session.detach();
  }
}

async function createFromUI(
  page: Page,
  baseURL: string,
  players: number,
  seats: number[],
  name = 'Ana CPU',
) {
  await page.goto(baseURL);
  await page.getByLabel('Tu nombre en la mesa').fill(name);
  await page
    .getByRole('button', { name: players === 2 ? '1 vs 1' : '2 vs 2', exact: true })
    .click();
  await page.getByRole('button', { name: '12', exact: true }).click();
  if (seats.length) await page.getByText('Opciones de mesa', { exact: true }).click();
  for (const seat of seats) {
    const label =
      players === 2
        ? 'Jugar contra la CPU'
        : seat === 2
          ? 'Tu compañero: CPU'
          : `Oponente ${seat === 1 ? 1 : 2}: CPU`;
    await page.getByRole('checkbox', { name: label, exact: true }).check();
  }
  await page.getByRole('button', { name: /Crear una mesa/ }).click();
  await expect(page).toHaveURL(/\/mesa\/[A-Z]{4}-\d{4}/);
  await expect.poll(() => page.evaluate(() => !!window.cpuGame)).toBe(true);
  return page.url().split('/').at(-1)!;
}

test('human-only matches never load the CPU engine', async ({ browser, baseURL }, testInfo) => {
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ viewport: testInfo.project.use.viewport })),
  );
  const engineRequests: string[] = [];
  for (const context of contexts) {
    await observeGame(context);
    context.on('request', (request) => {
      if (/\.wasm(?:\?|$)/.test(request.url())) engineRequests.push(request.url());
    });
  }
  try {
    const first = await contexts[0].newPage();
    const code = await createFromUI(first, baseURL!, 2, []);
    const second = await contexts[1].newPage();
    await second.goto(`${baseURL}/mesa/${code}`);
    await second.getByLabel('Tu nombre', { exact: true }).fill('Beto humano');
    await second.getByRole('button', { name: 'Elegir mi puesto', exact: true }).click();
    await second.getByRole('button', { name: 'Elegir puesto 2, equipo 2' }).click();
    await expect
      .poll(() => first.evaluate(() => window.cpuGame?.data.state?.phase))
      .toBe('cutting');
    expect(first.workers()).toHaveLength(0);
    expect(second.workers()).toHaveLength(0);
    expect(engineRequests).toEqual([]);
    await first.evaluate(() =>
      window.gameSocket!.send(
        JSON.stringify({
          input: {
            id: crypto.randomUUID(),
            revision: window.cpuGame!.data.state!.revision,
            command: { type: 'leave' },
          },
        }),
      ),
    );
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

for (const players of [2, 4]) {
  test(`${players} seats can finish a match with browser CPU players`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(180000);
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    await observeGame(context);
    const page = await context.newPage();
    if (testInfo.project.name === 'mobile') {
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    try {
      await createFromUI(page, baseURL!, players, players === 2 ? [1] : [1, 2, 3]);
      await expect(
        page.getByRole('region', { name: 'Estado de la CPU' }).getByRole('alert'),
      ).toHaveCount(0);
      await expect.poll(() => page.workers().length).toBe(1);
      await expect.poll(() => page.evaluate(() => window.cpuPerformance.startupMs.length)).toBe(1);
      const memory = await workerMemory(browser, page);
      expect(memory.usedSize).toBeGreaterThan(0);
      expect(memory.wasmLinearBytes).toBeGreaterThan(0);
      const downloads = await page.workers()[0].evaluate(() =>
        (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .filter((entry) => /\.wasm(?:\?|$)/.test(entry.name))
          .map((entry) => ({
            durationMs: entry.duration,
            encodedBytes: entry.encodedBodySize,
            decodedBytes: entry.decodedBodySize,
          })),
      );
      for (let step = 0; step < 350; step++) {
        const before = await page.evaluate(() => window.cpuGame!.data.state!);
        if (before.phase === 'match_over') break;
        if (before.phase === 'hand_over') {
          const sampled = await workerMemory(browser, page);
          for (const [key, value] of Object.entries(sampled))
            memory[key] = Math.max(memory[key] ?? 0, value);
        }
        await humanMove(page);
        await expect
          .poll(() => page.evaluate(() => window.cpuGame!.data.state!.revision), { timeout: 12000 })
          .toBeGreaterThan(before.revision);
        await expect(
          page.getByRole('region', { name: 'Estado de la CPU' }).getByRole('alert'),
        ).toHaveCount(0);
      }
      await expect
        .poll(() => page.evaluate(() => window.cpuGame?.data.state?.phase))
        .toBe('match_over');
      expect(await page.evaluate(() => window.cpuMoves)).toBeGreaterThan(0);
      expect(workers).toHaveLength(1);
      const timings = await page.evaluate(() => window.cpuPerformance);
      const durations = timings.decisionMs.sort((a, b) => a - b);
      expect(durations.length).toBeGreaterThan(0);
      const report = {
        players,
        profile: testInfo.project.name,
        cpuThrottling: testInfo.project.name === 'mobile' ? 4 : 1,
        browser: browser.version(),
        downloads,
        startupMs: timings.startupMs[0],
        decisions: durations.length,
        medianDecisionMs: durations[Math.floor(durations.length / 2)],
        p95DecisionMs:
          durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
        maxDecisionMs: durations.at(-1),
        workerMemoryBytes: memory,
      };
      await testInfo.attach('cpu-performance', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
      console.log('CPU performance:', JSON.stringify(report));
      await expect.poll(() => page.workers().length).toBe(0);
      await page.screenshot({
        path: `output/playwright/cpu-${players}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
}

test('mixed CPU room keeps human seats open and transfers one worker between players', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () =>
      browser.newContext({ viewport: testInfo.project.use.viewport }),
    ),
  );
  for (const context of contexts) await observeGame(context);
  const [creator, partner, watcher] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  try {
    const name = `Ana ${Date.now().toString(36)}`;
    const code = await createFromUI(creator, baseURL!, 4, [1, 3], name);
    await expect(creator.getByRole('heading', { name: 'Falta 1 para repartir.' })).toBeVisible();
    await partner.goto(baseURL!);
    await partner.getByLabel('Tu nombre en la mesa').fill('Beto CPU');
    const room = partner
      .locator('.table-row')
      .filter({ hasText: `Mesa de ${name}` })
      .filter({ hasText: '3/4 jugadores' })
      .last();
    await expect(room.getByText('2 jugadores CPU', { exact: true })).toBeVisible();
    await room.getByRole('button', { name: 'Sentarme', exact: true }).click();
    await expect(partner).toHaveURL(new RegExp(`/mesa/${code}$`));
    await partner.getByRole('button', { name: 'Elegir puesto 3, equipo 1' }).click();
    await expect.poll(() => partner.evaluate(() => window.cpuGame?.data.seat)).toBe(2);
    await watcher.goto(`${baseURL}/mesa/${code}`);
    await watcher.getByLabel('Tu nombre').fill('Carla mira');
    await watcher.getByRole('button', { name: /mirar/i }).click();
    await expect.poll(() => watcher.evaluate(() => window.cpuGame?.data.seat)).toBe(-1);
    await expect.poll(() => creator.workers().length).toBe(1);
    expect(partner.workers()).toHaveLength(0);
    expect(watcher.workers()).toHaveLength(0);
    await creator.close();
    await expect.poll(() => partner.workers().length).toBe(1);
    const beforePause = await partner.evaluate(() => window.cpuGame!.data.state!.revision);
    await partner.close();
    await expect(watcher.getByRole('status').filter({ hasText: 'Partida en pausa' })).toBeVisible();
    await expect(watcher.getByText('Esperando a los jugadores.', { exact: true })).toBeVisible();
    expect(await watcher.evaluate(() => window.cpuGame!.data.state!.revision)).toBe(beforePause);
    const returned = await contexts[1].newPage();
    await returned.goto(`${baseURL}/mesa/${code}`);
    await expect.poll(() => returned.workers().length).toBe(1);
    await expect.poll(() => returned.evaluate(() => window.cpuGame?.data.cpuPaused)).toBe(false);
    const returnedCreator = await contexts[0].newPage();
    await returnedCreator.goto(`${baseURL}/mesa/${code}`);
    await expect.poll(() => returnedCreator.evaluate(() => window.cpuGame?.data.seat)).toBe(0);
    expect(returnedCreator.workers()).toHaveLength(0);
    for (
      let step = 0;
      step < 12 && (await returned.evaluate(() => window.cpuMoves)) === 0;
      step++
    ) {
      const revision = await returned.evaluate(() => window.cpuGame!.data.state!.revision);
      await humanMove(returned);
      await humanMove(returnedCreator);
      await expect
        .poll(() => returned.evaluate(() => window.cpuGame!.data.state!.revision), {
          timeout: 10000,
        })
        .toBeGreaterThan(revision);
    }
    expect(await returned.evaluate(() => window.cpuMoves)).toBeGreaterThan(0);
    expect(watcher.workers()).toHaveLength(0);
    await returned.screenshot({
      path: `output/playwright/cpu-handoff-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
