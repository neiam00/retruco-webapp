import { expect, test, type Page } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';
import type { Command, HistoryEntry, Statistics, User } from '../src/lib/protocol.js';

async function lobby(page: Page, account: boolean) {
  let user: User | null = account ? { id: 'player-0', name: 'Ana', registered: true } : null;
  const created: unknown[] = [];
  let snapshot = tableSnapshot(2, 0, false);
  snapshot.config.target = 12;
  snapshot.options = { cpuSeats: [1], spectatorsCanSpeak: false };
  const history: HistoryEntry[] = [
    {
      code: 'record-first',
      roomCode: 'VIRA-1234',
      gameNumber: 1,
      config: snapshot.config,
      hands: 5,
      hasCPU: false,
      scores: [12, 6],
      winner: 0,
      finished: true,
      team: 0,
      updatedAt: '2026-10-28T18:00:00Z',
      players: [
        { name: 'Ana', seat: 0, team: 0, cpu: false },
        { name: 'Beto', seat: 1, team: 1, cpu: false },
      ],
    },
    {
      code: 'record-second',
      roomCode: 'VIRA-1234',
      gameNumber: 2,
      config: snapshot.config,
      hands: 6,
      hasCPU: true,
      scores: [3, 12],
      winner: 1,
      finished: true,
      team: 0,
      updatedAt: '2026-10-29T18:00:00Z',
      players: [
        { name: 'Ana', seat: 0, team: 0, cpu: false },
        { name: 'CPU 1', seat: 1, team: 1, cpu: true },
      ],
    },
  ];
  const statistics: Statistics = {
    overall: { games: 70, wins: 42, losses: 28, winRate: 60 },
    human: { games: 50, wins: 35, losses: 15, winRate: 70 },
    cpu: { games: 20, wins: 7, losses: 13, winRate: 35 },
    partners: [
      {
        id: 'friend',
        name: 'Carla',
        human: { games: 10, wins: 7, losses: 3, winRate: 70 },
        cpu: { games: 0, wins: 0, losses: 0, winRate: 0 },
      },
    ],
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: user });
    if (path === '/api/guest') {
      user = { id: 'player-0', name: route.request().postDataJSON().name, registered: false };
      return route.fulfill({ json: user });
    }
    if (path === '/api/history') return route.fulfill({ json: history });
    if (path === '/api/statistics') return route.fulfill({ json: statistics });
    if (path === '/api/matches/resume')
      return route.fulfill({
        json: account
          ? [
              {
                code: 'VIRA-1234',
                config: snapshot.config,
                names: ['Beto'],
                reconnectDeadline: new Date(Date.now() + 90_000).toISOString(),
                lastActivity: new Date().toISOString(),
              },
            ]
          : [],
      });
    if (path === '/api/matches/events')
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: []\n\n' });
    if (path === '/api/matches' && route.request().method() === 'POST') {
      const request = route.request().postDataJSON();
      created.push(request);
      snapshot = tableSnapshot(request.config.players, 0, false);
      snapshot.config = request.config;
      snapshot.state!.config = request.config;
      snapshot.options = request.options;
      return route.fulfill({ status: 201, json: { code: snapshot.code } });
    }
    if (path === '/api/matches') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.routeWebSocket('**/api/matches/VIRA-1234/ws?*', (socket) =>
    socket.send(JSON.stringify({ type: 'snapshot', data: snapshot })),
  );
  await page.goto('/');
  return created;
}

for (const mode of [
  { label: '1 vs 1', target: 12, players: 2, cpuSeats: [1] },
  { label: '2 vs 2', target: 24, players: 4, cpuSeats: [1, 2, 3] },
]) {
  test(`CPU shortcut validates the name and follows the selected ${mode.label} and ${mode.target} points`, async ({
    page,
  }, testInfo) => {
    const created = await lobby(page, false);
    await page.getByRole('button', { name: mode.label, exact: true }).click();
    await page.getByRole('button', { name: String(mode.target), exact: true }).click();
    await expect(page.locator('.practice-note')).toHaveText(
      `Sin espera · ${mode.label} · ${mode.target} piedras`,
    );
    await expect(
      page.getByRole('heading', { name: 'Todavía no hay mesas abiertas' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Jugar ahora contra la CPU', exact: true }).click();
    await expect(page.getByLabel('Tu nombre en la mesa')).toBeFocused();
    expect(created).toHaveLength(0);
    await page.getByLabel('Tu nombre en la mesa').fill('Ana');
    await page.screenshot({ path: testInfo.outputPath('lobby-cpu.png'), fullPage: true });
    await page.getByRole('button', { name: 'Jugar contra la CPU', exact: true }).click();
    await expect(page).toHaveURL(/\/mesa\/VIRA-1234$/);
    await expect(page.getByText('En línea', { exact: true })).toBeVisible();
    expect(created).toEqual([
      {
        private: true,
        config: { players: mode.players, target: mode.target, florRequired: true },
        options: { spectatorsCanSpeak: false, cpuSeats: mode.cpuSeats },
      },
    ]);
  });
}

test('returning players can resume and inspect lifetime statistics separately from recent results', async ({
  page,
}, testInfo) => {
  await lobby(page, true);
  await expect(page.getByRole('link', { name: 'Volver a mi partida' })).toHaveAttribute(
    'href',
    '/mesa/VIRA-1234',
  );
  await page.getByRole('button', { name: 'Mi historial', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const statistics = dialog.getByRole('region', { name: 'Estadísticas de toda tu historia' });
  await expect(statistics).toContainText('70');
  await expect(dialog.locator('.history-row')).toHaveCount(2);
  await dialog.getByText('Resultados con tus compañeros', { exact: true }).click();
  await expect(dialog.getByText('Carla', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Con CPU', exact: true }).click();
  await expect(statistics).toContainText('35%');
  await expect(dialog.locator('.history-row')).toHaveCount(1);
  await expect(dialog.locator('.history-row')).toContainText('Partida 2');
  await dialog.getByText('Detalles de la partida', { exact: true }).click();
  await expect(dialog.locator('.history-row')).toContainText('6 manos');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'CPU 1' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('history.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Volver a mi partida' }).click();
  await expect(page.getByText('En línea', { exact: true })).toBeVisible();
});

test('rematch voting stays at the same table and updates the result screen from server acknowledgements', async ({
  page,
}, testInfo) => {
  const snapshot = tableSnapshot(2, 0, false);
  snapshot.seats[1].cpu = false;
  snapshot.state!.phase = 'match_over';
  snapshot.state!.winner = 0;
  snapshot.state!.scores = [24, 12];
  snapshot.state!.legal = [];
  snapshot.rematchVotes = [];
  const commands: Command[] = [];
  const update = await showTable(page, snapshot, (command) => commands.push(command));
  await page.getByRole('button', { name: 'Revancha', exact: true }).click();
  await expect.poll(() => commands).toEqual([{ type: 'rematch' }]);
  const voted = structuredClone(snapshot);
  voted.rematchVotes = [0];
  update(voted);
  await expect(page.getByRole('button', { name: 'Ya estás listo', exact: true })).toBeDisabled();
  await expect(
    page.getByText('1 de 2 jugadores listos · Mismos equipos y reglas', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('rematch.png'), fullPage: true });
  const next = structuredClone(snapshot);
  next.gameNumber = 2;
  next.state!.revision++;
  next.state!.phase = 'cutting';
  next.state!.scores = [0, 0];
  next.state!.winner = -1;
  next.state!.turn = 0;
  update(next);
  await expect(page.getByRole('button', { name: 'Revancha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Partir el mazo', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/mesa\/VIRA-1234$/);
});

test('invitations provide a local QR, native sharing, cancellation and a copy fallback', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        document.documentElement.dataset.sharedURL = data.url;
        throw new DOMException('Cancelled', 'AbortError');
      },
    });
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        document.documentElement.dataset.copiedURL = text;
      },
    });
  });
  await showTable(page, tableSnapshot(2, 0, false));
  await page.getByRole('button', { name: 'Compartir invitación', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('img', { name: 'Código QR para entrar a la mesa VIRA-1234' }),
  ).toHaveAttribute('src', /^data:image\/png;base64,/);
  const url = new URL('/mesa/VIRA-1234', page.url()).href;
  await expect(dialog.getByLabel('Enlace de la mesa')).toHaveValue(url);
  await dialog.getByRole('button', { name: 'Compartir invitación', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-shared-u-r-l', url);
  await expect(dialog.getByText('No pudimos abrir el menú', { exact: false })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Copiar enlace', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Invitación copiada.');
  await expect(page.locator('html')).toHaveAttribute('data-copied-u-r-l', url);
  await page.screenshot({ path: testInfo.outputPath('invitation.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Compartir invitación', exact: true }),
  ).toBeFocused();
});
