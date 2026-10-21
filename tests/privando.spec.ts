import { expect, test, type Page } from '@playwright/test';
import type { Command, CPUWork, Snapshot } from '../src/lib/protocol.js';

declare global {
  interface Window {
    privoDealFlights: number;
  }
}

// A public protocol fixture, not a game simulator. Engine tests own the result
// of each command; these checks protect its labels, visibility and wire payload.
function pendingPrivo(): Snapshot {
  const config = { players: 4, target: 24, florRequired: true };
  const announcement = {
    id: 2,
    hand: 9,
    event: { type: 'privo', seat: -1, team: 0, kind: 'envido', amount: 37, automatic: true },
  };
  return {
    code: 'PRIV-1234',
    private: true,
    config,
    seats: [
      { id: 'ana', name: 'Ana' },
      { id: 'beto', name: 'Beto' },
      { id: 'carla', name: 'Carla' },
      { id: 'diego', name: 'Diego' },
    ],
    seat: 1,
    perspective: 1,
    sequence: 2,
    chat: [],
    signals: [],
    events: [announcement],
    cantoHistory: [announcement],
    serverTime: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    state: {
      config,
      version: '2',
      revision: 41,
      phase: 'playing',
      handNumber: 9,
      dealer: 0,
      mano: 1,
      turn: 1,
      round: 0,
      scores: [23, 20],
      winner: -1,
      handWinner: -1,
      vira: { suit: 'spades', number: 4 },
      trucoValue: 1,
      mandatoryStack: false,
      pending: { kind: 'privo', caller: 0, value: 2, previous: 1, terminal: true },
      privando: [true, false],
      privoEnvido: [{ team: 0, value: 37 }],
      holding: { envido: 33, flor: 38, receta: false },
      florValid: true,
      hand: [7, 6, 5].map((number, index) => ({
        index,
        card: { suit: 'cups' as const, number },
        used: false,
      })),
      seats: [0, 1, 2, 3].map((seat) => ({ seat, team: seat % 2, remaining: 3, plays: [] })),
      payouts: [],
      envidoResults: [],
      legal: ['accept', 'decline', 'present_flor'].map((kind) => ({ type: 'respond', kind })),
    },
  };
}

async function showPrivo(
  page: Page,
  snapshot: Snapshot,
  onCommand: (input: { command: Command; cpuSeat?: number }) => void,
  cpu?: CPUWork,
  reply?: Snapshot,
) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') {
      await route.fulfill({ json: { id: 'beto', name: 'Beto', registered: true } });
    } else if (path === '/api/matches/PRIV-1234') {
      await route.fulfill({ json: snapshot });
    } else {
      await route.fulfill({ status: 503, json: { error: 'Voice unavailable in this UI test' } });
    }
  });
  await page.routeWebSocket('**/api/matches/PRIV-1234/ws', (socket) => {
    socket.send(JSON.stringify({ type: 'snapshot', data: snapshot, cpu }));
    socket.onMessage((message) => {
      const input = JSON.parse(message.toString()).input;
      if (input) {
        onCommand(input);
        if (reply) socket.send(JSON.stringify({ type: 'snapshot', data: reply }));
      }
    });
  });
  await page.goto('/mesa/PRIV-1234');
}

for (const [label, kind] of [
  ['Privo y Truco', 'accept'],
  ['No jugar', 'decline'],
  ['Presentar flor', 'present_flor'],
]) {
  test(`privando shows the public team value and sends ${kind}`, async ({ page }, testInfo) => {
    const snapshot = pendingPrivo();
    const sent: Command[] = [];
    await showPrivo(page, snapshot, (input) => sent.push(input.command));
    const summary = page.getByRole('region', { name: 'Equipos privando', exact: true });
    await expect(summary).toContainText('Ellos · Privando');
    await expect(summary).toContainText('37 de envido');
    await expect(summary).not.toContainText('Ana');
    await expect(summary).not.toContainText('Carla');
    await expect(page.getByLabel('Piedras para subir')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decir…', exact: true })).toHaveCount(0);
    await expect(page.locator('.hand-card:not(:disabled)')).toHaveCount(0);
    const details = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
    if (await details.isVisible()) await details.click();
    await expect(page.getByRole('region', { name: 'Historial de cantos' })).toContainText(
      'Privando: 37 de envido',
    );
    await expect(page.getByRole('region', { name: 'Historial de cantos' })).not.toContainText(
      'Tiempo agotado',
    );
    const closeDetails = page
      .locator('.match-details')
      .getByRole('button', { name: 'Cerrar detalles', exact: true });
    if (await closeDetails.isVisible()) await closeDetails.click();
    for (const name of ['Privo y Truco', 'No jugar', 'Presentar flor']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (kind === 'accept')
      await page.screenshot({
        path: `output/playwright/privando-${testInfo.project.name}.png`,
        fullPage: true,
      });
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => sent).toEqual([{ type: 'respond', kind }]);
  });
}

test('the shipped CPU WebAssembly handles the fixed privo response', async ({ page }) => {
  const snapshot = pendingPrivo();
  const commands: { command: Command; cpuSeat?: number }[] = [];
  await showPrivo(page, snapshot, (input) => commands.push(input), {
    version: 1,
    controlled: true,
    seat: 1,
    view: snapshot.state,
  });
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].cpuSeat).toBe(1);
  expect(commands[0].command).toEqual({ type: 'respond', kind: 'present_flor' });
});

test('an immediate privando flor win still animates the deal before the result', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.privoDealFlights = 0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof HTMLImageElement && node.dataset.cardFlight === 'deal')
            window.privoDealFlights++;
        }
    }).observe(document, { childList: true, subtree: true });
  });
  const finished = pendingPrivo();
  const cutting = structuredClone(finished);
  cutting.state!.phase = 'cutting';
  cutting.state!.hand = [];
  cutting.state!.vira = undefined;
  cutting.state!.holding = undefined;
  cutting.state!.pending = undefined;
  cutting.state!.privoEnvido = [];
  cutting.state!.privando = [false, false];
  cutting.state!.legal = [{ type: 'cut', cut: 20 }];
  cutting.events = [];
  cutting.cantoHistory = [];
  finished.state!.revision++;
  finished.state!.phase = 'match_over';
  finished.state!.winner = 0;
  finished.state!.scores = [26, 20];
  finished.state!.pending = undefined;
  finished.state!.legal = [];
  finished.state!.payouts = [{ kind: 'flor', team: 0, points: 3 }];
  await showPrivo(page, cutting, () => {}, undefined, finished);
  await page.getByRole('button', { name: 'Partir el mazo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.privoDealFlights)).toBe(12);
  await expect(page.locator('[data-card-flight]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '¡Ganaron ellos!', exact: true })).toBeVisible();
  await expect(page.locator('.table-status.results')).not.toHaveClass(/waiting-for-cards/);
});
