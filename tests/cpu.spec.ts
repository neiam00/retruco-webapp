import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Snapshot, CPUWork, Command } from '../src/lib/protocol.js';

declare global {
  interface Window {
    cpuGame?: { data: Snapshot; cpu?: CPUWork };
    gameSocket?: WebSocket;
    cpuMoves: number;
    cpuSocketOpens: number;
    cpuSocketURLs: string[];
    cpuMemoryObservations: {
      requests: { hand: number; start: number; end: number; total: number; key: string }[];
      decisions: { hand: number; cursor: number; pageHand: number; pageTotal: number }[];
      pageRequests: number;
    };
    cpuPerformance: { startupMs: number[]; decisionMs: number[]; sources: string[] };
    cpuFlorAudit: {
      headsUpSignalRequests: number;
      teamSignalRequests: number;
      noOrdinaryFlorRequests: number;
      ordinaryFlorRequests: number;
      invalidCandidates: number;
      invalidDecisions: number;
    };
  }
}

async function observeGame(context: BrowserContext) {
  await context.addInitScript(() => {
    window.cpuMoves = 0;
    window.cpuSocketOpens = 0;
    window.cpuSocketURLs = [];
    window.cpuMemoryObservations = { requests: [], decisions: [], pageRequests: 0 };
    window.cpuPerformance = { startupMs: [], decisionMs: [], sources: [] };
    window.cpuFlorAudit = {
      headsUpSignalRequests: 0,
      teamSignalRequests: 0,
      noOrdinaryFlorRequests: 0,
      ordinaryFlorRequests: 0,
      invalidCandidates: 0,
      invalidDecisions: 0,
    };
    const claimsFlor = (value?: string) =>
      ['flor', 'presento_flor', 'flor_flor', 'con_mi_flor', 'con_flor'].includes(value ?? '');
    const validDeclaration = (view: NonNullable<Snapshot['state']>, command: Command) => {
      const declaration = command.declaration ?? '';
      const hasFlor = Boolean(view.florValid && view.holding?.flor && !view.holding.receta);
      if (command.type === 'call' && command.kind === 'envido' && hasFlor) return false;
      if (command.type === 'call' && command.kind === 'flor' && !hasFlor) return false;
      if (
        command.type === 'respond' &&
        (view.pending?.kind === 'ley_envido' || view.pending?.kind === 'flor')
      ) {
        if (declaration) return false;
        if (view.pending.mode) return !command.mode;
        if (command.mode !== (hasFlor ? 'con_ley' : 'sin_ley')) return false;
        return (
          (view.pending.kind !== 'flor' && !view.pending.florOffered) ||
          hasFlor ||
          command.kind === 'decline'
        );
      }
      if (!claimsFlor(declaration)) return true;
      if (!view.florValid || !view.holding?.flor || view.holding.receta) return false;
      const remaining = view.hand.filter((card) => !card.used).length;
      switch (command.type) {
        case 'play':
        case 'burn':
          return (
            declaration ===
            (command.type === 'burn' && view.mandatoryStack
              ? 'flor_flor'
              : remaining === 1
                ? 'presento_flor'
                : 'flor')
          );
        case 'stack':
          return declaration === 'flor_flor';
        case 'call':
          return command.kind === 'truco' && declaration === 'con_mi_flor';
        case 'respond':
          if (command.kind === 'flowers_no' || view.pending?.kind === 'privo') return false;
          return declaration === 'con_mi_flor';
        default:
          return false;
      }
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private sent = new Map<string, number>();
      private pages = new Map<string, { hand: number; total: number }>();
      private positions = new Map<string, NonNullable<Snapshot['state']>>();
      constructor(url: string | URL, options?: WorkerOptions) {
        const started = performance.now();
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'ready')
            window.cpuPerformance.startupMs.push(performance.now() - started);
          if (data.type === 'decision' && this.sent.has(data.id)) {
            const position = this.positions.get(data.id);
            if (
              position &&
              data.result?.command &&
              !validDeclaration(position, data.result.command)
            )
              window.cpuFlorAudit.invalidDecisions++;
            this.positions.delete(data.id);
            window.cpuPerformance.sources.push(data.source ?? 'unknown');
            window.cpuPerformance.decisionMs.push(performance.now() - this.sent.get(data.id)!);
            this.sent.delete(data.id);
            const memory = this.pages.get(data.id);
            if (data.source === 'learned' && memory)
              window.cpuMemoryObservations.decisions.push({
                hand: data.result.memoryHand,
                cursor: data.result.memoryCursor,
                pageHand: memory.hand,
                pageTotal: memory.total,
              });
            this.pages.delete(data.id);
          } else if (data.type === 'memory') {
            this.positions.delete(data.id);
            this.sent.delete(data.id);
            this.pages.delete(data.id);
          }
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const id = (message as { id?: string }).id;
        if (id) this.sent.set(id, performance.now());
        const request = (
          message as {
            request?: {
              kind?: string;
              view?: NonNullable<Snapshot['state']>;
              memoryKey?: string;
              memory?: { hand: number; start: number; end: number; total: number };
            };
          }
        ).request;
        if (request?.kind === 'signal') {
          if (request.view?.config.players === 2) window.cpuFlorAudit.headsUpSignalRequests++;
          if (request.view?.config.players === 4) window.cpuFlorAudit.teamSignalRequests++;
        }
        if (id && request?.view?.phase === 'playing') {
          const view = request.view;
          const ordinary = !!(view.florValid && view.holding?.flor && !view.holding.receta);
          this.positions.set(id, view);
          if (ordinary) window.cpuFlorAudit.ordinaryFlorRequests++;
          else window.cpuFlorAudit.noOrdinaryFlorRequests++;
          window.cpuFlorAudit.invalidCandidates += view.legal.filter(
            (command) => !validDeclaration(view, command),
          ).length;
        }
        if (id && request?.memory) {
          const { hand, start, end, total } = request.memory;
          this.pages.set(id, { hand, total });
          window.cpuMemoryObservations.requests.push({
            hand,
            start,
            end,
            total,
            key: request.memoryKey ?? '',
          });
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url).pathname.endsWith('/ws')) {
          window.cpuSocketURLs.push(String(url));
          window.gameSocket = this;
          this.addEventListener('open', () => window.cpuSocketOpens++);
          this.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'snapshot' || message.type === 'game_update')
              window.cpuGame = message;
          });
        }
      }
      send(data: string | Blob | BufferSource) {
        if (typeof data === 'string') {
          const input = JSON.parse(data).input;
          if (input?.cpuKind === 'memory') window.cpuMemoryObservations.pageRequests++;
          else if (input?.cpuSeat !== undefined) window.cpuMoves++;
        }
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
      expect(memory.wasmLinearBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
      if (process.env.VITE_CPU_ML_ENABLED !== 'true') expect(memory.wasmLinearBytes).toBe(0);
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
      const florAudit = await page.evaluate(() => window.cpuFlorAudit);
      expect(florAudit.headsUpSignalRequests).toBe(0);
      if (players === 4) expect(florAudit.teamSignalRequests).toBeGreaterThan(0);
      expect(florAudit.invalidCandidates).toBe(0);
      expect(florAudit.invalidDecisions).toBe(0);
      console.log('CPU flor legality:', JSON.stringify({ players, ...florAudit }));
      expect(workers).toHaveLength(1);
      const timings = await page.evaluate(() => window.cpuPerformance);
      if (process.env.VITE_CPU_ML_ENABLED === 'true') {
        expect(timings.sources).toContain('learned');
        expect(timings.sources).not.toContain('heuristic');
      }
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
    if (process.env.VITE_CPU_ML_ENABLED === 'true') {
      await expect
        .poll(() => returned.evaluate(() => window.cpuPerformance.sources))
        .toContain('learned');
      expect(await returned.evaluate(() => window.cpuPerformance.sources)).not.toContain(
        'heuristic',
      );
    }
    expect(watcher.workers()).toHaveLength(0);
    await returned.screenshot({
      path: `output/playwright/cpu-handoff-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

async function advance(page: Page) {
  const before = await page.evaluate(() => window.cpuGame!.data.state!);
  if (before.phase === 'match_over') return false;
  await humanMove(page);
  await expect
    .poll(() => page.evaluate(() => window.cpuGame!.data.state!.revision), { timeout: 15000 })
    .toBeGreaterThan(before.revision);
  return true;
}

for (const failure of ['corrupt', 'incompatible', 'unavailable'] as const) {
  test(`CPU continues with heuristic after ${failure} model assets`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(process.env.VITE_CPU_ML_ENABLED !== 'true', 'requires candidate evaluation assets');
    test.setTimeout(300000);
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    await observeGame(context);
    let intercepted = 0;
    const downloads: string[] = [];
    context.on('request', (request) => {
      if (/\.wasm(?:\?|$)/.test(request.url())) downloads.push(request.url());
    });
    if (failure === 'incompatible') {
      await context.route('**/cpu-evaluation/**/manifest.json', async (route) => {
        intercepted++;
        const response = await route.fetch();
        const manifest = await response.json();
        await route.fulfill({ response, json: { ...manifest, encoder: 999 } });
      });
    } else {
      await context.route('**/cpu-evaluation/**/policy.bin', async (route) => {
        intercepted++;
        if (failure === 'unavailable') return route.abort('connectionreset');
        const response = await route.fetch();
        const bytes = await response.body();
        bytes[bytes.length - 1] ^= 1;
        await route.fulfill({ response, body: bytes });
      });
    }
    try {
      const page = await context.newPage();
      await createFromUI(page, baseURL!, 4, [1, 2, 3]);
      for (let step = 0; step < 350 && (await advance(page)); step++) {
        /* complete actual game */
      }
      await expect
        .poll(() => page.evaluate(() => window.cpuGame?.data.state?.phase))
        .toBe('match_over');
      expect(intercepted).toBeGreaterThan(0);
      const sources = await page.evaluate(() => window.cpuPerformance.sources);
      expect(sources).toContain('heuristic');
      expect(sources).not.toContain('learned');
      expect(downloads.some((url) => /\/cpu\.wasm(?:\?|$)/.test(url))).toBe(false);
      await expect(
        page.getByRole('region', { name: 'Estado de la CPU' }).getByRole('alert'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test('learned CPU reconnects after server and browser worker restart', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    !process.env.CPU_TEST_RESTART_URL || process.env.VITE_CPU_ML_ENABLED !== 'true',
    'requires the isolated integration runner',
  );
  test.setTimeout(180000);
  const restart = new URL(process.env.CPU_TEST_RESTART_URL!);
  expect(restart.hostname).toBe('127.0.0.1');
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  await observeGame(context);
  try {
    const page = await context.newPage();
    await createFromUI(page, baseURL!, 4, [1, 2, 3]);
    for (let step = 0; step < 100; step++) {
      if (
        await page.evaluate(
          () =>
            window.cpuGame!.data.state!.legal.some((c) => c.type === 'play') &&
            window.cpuMemoryObservations.decisions.length > 0,
        )
      )
        break;
      expect(await advance(page)).toBe(true);
    }
    expect(
      await page.evaluate(() => window.cpuGame!.data.state!.legal.some((c) => c.type === 'play')),
    ).toBe(true);
    const journalsBeforeRestart = await page.evaluate(() => window.cpuMemoryObservations);
    expect(journalsBeforeRestart.decisions.length).toBeGreaterThan(0);
    await page.evaluate(() =>
      window.gameSocket!.send(
        JSON.stringify({ input: { id: crypto.randomUUID(), signal: 'perico' } }),
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.cpuGame!.data.signals.some((s) => s.seat === 0 && s.kind === 'perico'),
        ),
      )
      .toBe(true);
    const before = await page.evaluate(() => ({
      data: window.cpuGame!.data,
      opens: window.cpuSocketOpens,
    }));
    const response = await fetch(restart, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CPU_TEST_RESTART_TOKEN}` },
    });
    expect(response.ok).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.cpuSocketOpens), { timeout: 15000 })
      .toBeGreaterThan(before.opens);
    await expect
      .poll(() => page.evaluate(() => window.cpuGame!.data.state!.hand))
      .toEqual(before.data.state!.hand);
    expect(await page.evaluate(() => window.cpuGame!.data.signals)).toEqual(before.data.signals);
    expect(await page.evaluate(() => window.cpuGame!.data.state!.revision)).toBe(
      before.data.state!.revision,
    );
    await expect
      .poll(() => page.evaluate(() => window.cpuPerformance.startupMs.length))
      .toBeGreaterThan(1);
    for (const socketURL of await page.evaluate(() => window.cpuSocketURLs)) {
      expect(new URL(socketURL).searchParams.get('cpuProtocol')).toBe('2');
      expect(new URL(socketURL).searchParams.get('cpuMemory')).toBe('1');
    }
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.cpuGame?.data.state?.hand))
      .toEqual(before.data.state!.hand);
    expect(await page.evaluate(() => window.cpuGame!.data.signals)).toEqual(before.data.signals);
    for (let step = 0; step < 350 && (await advance(page)); step++) {
      /* resumes through match completion */
    }
    await expect
      .poll(() => page.evaluate(() => window.cpuGame?.data.state?.phase))
      .toBe('match_over');
    const sources = await page.evaluate(() => window.cpuPerformance.sources);
    expect(sources).toContain('learned');
    expect(sources).not.toContain('heuristic');
    const replay = await page.evaluate(() => window.cpuMemoryObservations);
    expect(replay.requests.length).toBeGreaterThan(0);
    expect(replay.requests[0].start).toBe(0);
    expect(replay.requests[0].key).not.toBe('');
    expect(replay.decisions.length).toBeGreaterThan(0);
    for (const decision of replay.decisions) {
      expect(decision.hand).toBe(decision.pageHand);
      expect(decision.cursor).toBe(decision.pageTotal);
      expect(decision.cursor).toBeGreaterThan(0);
    }
    await expect.poll(() => page.workers().length).toBe(0);
  } finally {
    await context.close();
  }
});

for (const players of [2, 4]) {
  test(`learned CPU survives repeated ${players}-seat matches without accumulating workers`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(
      !process.env.CPU_SOAK_MATCHES || process.env.VITE_CPU_ML_ENABLED !== 'true',
      'requires explicit local soak configuration',
    );
    const matches = Number(process.env.CPU_SOAK_MATCHES);
    expect(Number.isInteger(matches) && matches >= 2 && matches <= 100).toBe(true);
    test.setTimeout(matches * 300000);
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    await observeGame(context);
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const measurements: { match: number; worker: Record<string, number>; pageHeap: number }[] = [];
    try {
      await createFromUI(page, baseURL!, players, players === 2 ? [1] : [1, 2, 3]);
      for (let match = 0; match < matches; match++) {
        await expect.poll(() => page.workers().length).toBe(1);
        await expect
          .poll(() => page.evaluate(() => window.cpuPerformance.startupMs.length))
          .toBe(match + 1);
        const memory = await workerMemory(browser, page);
        expect(memory.wasmLinearBytes).toBeGreaterThan(0);
        expect(memory.wasmLinearBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
        if (measurements.length)
          expect(memory.wasmLinearBytes).toBe(measurements[0].worker.wasmLinearBytes);
        for (let step = 0; step < 350 && (await advance(page)); step++) {
          /* real rules, UI delays and worker */
        }
        await expect
          .poll(() => page.evaluate(() => window.cpuGame?.data.state?.phase))
          .toBe('match_over');
        await expect.poll(() => page.workers().length).toBe(0);
        await session.send('HeapProfiler.collectGarbage');
        const heap = await session.send('Runtime.getHeapUsage');
        measurements.push({ match, worker: memory, pageHeap: heap.usedSize });
        const sources = await page.evaluate(() => window.cpuPerformance.sources);
        expect(sources).toContain('learned');
        expect(sources).not.toContain('heuristic');
        if (match + 1 < matches) {
          const previous = await page.evaluate(() => window.cpuGame!.data.gameNumber);
          await page.getByRole('button', { name: 'Revancha', exact: true }).click();
          await expect
            .poll(() => page.evaluate(() => window.cpuGame!.data.gameNumber))
            .toBe((previous ?? 1) + 1);
        }
      }
      expect(measurements.at(-1)!.pageHeap - measurements[0].pageHeap).toBeLessThan(
        16 * 1024 * 1024,
      );
      await testInfo.attach('cpu-soak', {
        body: JSON.stringify({ players, matches, measurements }),
        contentType: 'application/json',
      });
    } finally {
      await session.detach();
      await context.close();
    }
  });
}
