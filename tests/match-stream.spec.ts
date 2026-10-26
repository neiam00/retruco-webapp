import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type { Snapshot } from '../src/lib/protocol.js';
import { tableSnapshot } from './fixtures/table.js';

async function session(page: Page) {
  const snapshotReads: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') {
      await route.fulfill({ json: { id: 'player-0', name: 'Ana', registered: true } });
    } else {
      snapshotReads.push(path);
      await route.fulfill({ status: 503, json: { error: 'Unexpected HTTP request' } });
    }
  });
  return snapshotReads;
}

function current(snapshot: Snapshot) {
  const { chat, events, cantoHistory, ...data } = snapshot;
  void [chat, events, cantoHistory];
  return data;
}

test('uses one socket baseline, reconstructs chat updates, and blocks play until a gap is resynced', async ({
  page,
}) => {
  const snapshotReads = await session(page);
  const initial = tableSnapshot(4, 0, false);
  initial.state!.legal = [{ type: 'play', card: 1 }];
  let socket: WebSocketRoute | undefined;
  const requests: object[] = [];
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', (route) => {
    socket = route;
    route.onMessage((message) => requests.push(JSON.parse(message.toString())));
    route.send(
      JSON.stringify({
        type: 'snapshot',
        data: initial,
        stream: { epoch: 'first-connection', sequence: 1 },
      }),
    );
  });
  await page.goto('/mesa/VIRA-1234');
  const card = page.locator('[data-hand-card="1"]');
  await expect(card).toBeEnabled();
  await page.getByRole('button', { name: 'Abrir chat', exact: true }).click();
  const chat = { id: 10, name: 'Luis', text: 'Vamos a jugar', spectator: false };
  socket!.send(
    JSON.stringify({
      type: 'game_update',
      data: { ...current(initial), sequence: 2 },
      stream: { epoch: 'first-connection', sequence: 2, baseSequence: 1 },
      history: { chat: { reset: false, items: [chat], keep: 100 } },
    }),
  );
  await expect(page.getByRole('log', { name: 'Chat de la mesa' })).toContainText('Vamos a jugar');
  socket!.send(
    JSON.stringify({
      type: 'game_update',
      data: { ...current(initial), sequence: 4 },
      stream: { epoch: 'first-connection', sequence: 4, baseSequence: 3 },
    }),
  );
  await expect.poll(() => requests).toEqual([{ resync: true }]);
  await expect(card).toBeDisabled();
  await expect(page.getByLabel('Mensaje', { exact: true })).toBeDisabled();
  socket!.send(
    JSON.stringify({
      type: 'snapshot',
      data: { ...initial, sequence: 4, chat: [chat] },
      stream: { epoch: 'first-connection', sequence: 5 },
    }),
  );
  await expect(page.getByLabel('Mensaje', { exact: true })).toBeEnabled();
  await expect(page.getByRole('log', { name: 'Chat de la mesa' })).toContainText('Vamos a jugar');
  expect(snapshotReads).toEqual([]);
});

for (const status of [401, 404]) {
  test(`shows actionable ${status} handshake errors without retrying or fetching a snapshot`, async ({
    page,
  }) => {
    const snapshotReads = await session(page);
    let connections = 0;
    await page.clock.install();
    await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', async (socket) => {
      connections++;
      socket.send(JSON.stringify({ type: 'error', status, error: `Error ${status} de la mesa` }));
      await socket.close();
    });
    await page.goto('/mesa/VIRA-1234');
    await expect(page.getByText(`Error ${status} de la mesa`, { exact: true })).toBeVisible();
    await page.clock.fastForward(60_000);
    expect(connections).toBe(1);
    expect(snapshotReads).toEqual([]);
  });
}

test('pauses reconnects while offline and cancels pending reconnects after leaving the page', async ({
  page,
  context,
}) => {
  await session(page);
  await page.clock.install();
  let connections = 0;
  let currentSocket: WebSocketRoute | undefined;
  const initial = tableSnapshot(4, 0, false);
  initial.state!.legal = [{ type: 'play', card: 1 }];
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', (socket) => {
    connections++;
    currentSocket = socket;
    socket.send(JSON.stringify({ type: 'snapshot', data: initial }));
  });
  await page.goto('/mesa/VIRA-1234');
  await expect(page.locator('[data-hand-card="1"]')).toBeEnabled();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.clock.fastForward(60_000);
  expect(connections).toBe(1);
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  // Going online bypasses any pending long backoff, without advancing timers.
  await expect.poll(() => connections).toBe(2);
  await expect(page.locator('[data-hand-card="1"]')).toBeEnabled();
  await currentSocket!.close();
  await expect(page.locator('[data-hand-card="1"]')).toBeDisabled();
  // An in-app navigation exercises component cleanup, not browser unload.
  await page.locator('.match-header .brand').click();
  await expect(page).toHaveURL(/\/$/);
  await page.clock.fastForward(60_000);
  expect(connections).toBe(2);
});

test('diagnoses rejected legacy handshakes once instead of retrying missing tables', async ({
  page,
}) => {
  await session(page);
  let diagnostics = 0;
  let connections = 0;
  await page.clock.install();
  await page.route('**/api/matches/VIRA-1234', async (route) => {
    diagnostics++;
    await route.fulfill({ status: 404, json: { error: 'No encontramos esa mesa.' } });
  });
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', async (socket) => {
    connections++;
    await socket.close();
  });
  await page.goto('/mesa/VIRA-1234');
  await expect(page.getByText('No encontramos esa mesa.', { exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  expect(diagnostics).toBe(1);
  expect(connections).toBe(1);
});

test('honors a server retry delay after temporary admission failure', async ({ page }) => {
  const snapshotReads = await session(page);
  await page.clock.install();
  let connections = 0;
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', async (socket) => {
    connections++;
    if (connections === 1) {
      socket.send(
        JSON.stringify({
          type: 'error',
          status: 503,
          error: 'Espera un momento.',
          retryAfterMs: 30_000,
        }),
      );
      await socket.close();
    } else {
      socket.send(JSON.stringify({ type: 'snapshot', data: tableSnapshot(4, 0, false) }));
    }
  });
  await page.goto('/mesa/VIRA-1234');
  await expect(page.getByText('Espera un momento.', { exact: true })).toBeVisible();
  await page.clock.fastForward(10_000);
  expect(connections).toBe(1);
  await page.clock.fastForward(30_000);
  await expect.poll(() => connections).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(snapshotReads).toEqual([]);
});

test('retries through a short outage within the existing ten-second room grace', async ({
  page,
}) => {
  await session(page);
  await page.clock.install();
  let connections = 0;
  let available = false;
  let initialSocket: WebSocketRoute | undefined;
  const initial = tableSnapshot(4, 0, false);
  initial.state!.legal = [{ type: 'play', card: 1 }];
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?transport=2', async (socket) => {
    connections++;
    if (connections === 1 || available) {
      initialSocket ??= socket;
      socket.send(JSON.stringify({ type: 'snapshot', data: initial }));
    } else {
      socket.send(
        JSON.stringify({ type: 'error', status: 503, error: `Reconectando ${connections}` }),
      );
      await socket.close();
    }
  });
  await page.goto('/mesa/VIRA-1234');
  const card = page.locator('[data-hand-card="1"]');
  await expect(card).toBeEnabled();
  await initialSocket!.close();
  await expect(card).toBeDisabled();
  // The server becomes reachable after eight seconds. No scheduled retry in
  // this grace window may be delayed by the thirty-second long-outage cap.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.clock.fastForward(2_000);
    await expect(page.getByRole('alert')).toHaveText(`Reconectando ${attempt + 1}`);
  }
  available = true;
  await page.clock.fastForward(2_000);
  await expect(card).toBeEnabled();
  expect(connections).toBe(6);
});
