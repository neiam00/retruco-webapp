import { expect, test } from '@playwright/test';

test('the room browser recovers when the live-list endpoint is temporarily unavailable', async ({
  page,
}) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: null }));
  await page.route('**/api/matches', (route) => route.fulfill({ json: [] }));
  let attempts = 0;
  await page.route('**/api/matches/events', async (route) => {
    if (++attempts === 1) {
      await route.fulfill({ status: 404, json: { error: 'Deployment in progress' } });
      return;
    }
    const rooms = [
      {
        code: 'TEST-1234',
        host: 'Recovered stream',
        players: 1,
        capacity: 4,
        target: 12,
        florRequired: false,
        started: false,
        cpuPlayers: 0,
      },
    ];
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify(rooms)}\n\n`,
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Mirar mesa de Recovered stream', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  expect(attempts).toBeGreaterThan(1);
});

for (const departure of ['leave', 'disconnect', 'cpu_disconnect'] as const) {
  test(`vacant rooms disappear live after ${departure} and cannot be rejoined`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ baseURL })));
    const [owner, watcher, visitor] = contexts;
    const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
    const headers = { Origin: baseURL! };
    const ownerName = `Lobby ${crypto.randomUUID().slice(0, 8)}`;
    try {
      for (const [context, name] of [
        [owner, ownerName],
        [watcher, 'Lobby spectator'],
      ] as const) {
        expect(
          (await context.request.post(`${api}/api/guest`, { headers, data: { name } })).ok(),
        ).toBe(true);
      }
      const roomBrowser = await visitor.newPage();
      let listingStreams = 0;
      roomBrowser.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/matches/events') listingStreams++;
      });
      // Disable polling responses: list changes must arrive through the live stream.
      await roomBrowser.route('**/api/matches', async (route) => {
        await route.fulfill({ json: [] });
      });
      await roomBrowser.goto('/');
      await expect.poll(() => listingStreams).toBe(1);
      const created = await owner.request.post(`${api}/api/matches`, {
        headers,
        data: {
          private: false,
          config: {
            players: departure === 'cpu_disconnect' ? 2 : 4,
            target: 12,
            florRequired: false,
          },
          options: { cpuSeats: departure === 'cpu_disconnect' ? [1] : [] },
        },
      });
      expect(created.ok()).toBe(true);
      const { code } = await created.json();
      const ownerPage = await owner.newPage();
      await ownerPage.goto(`/mesa/${code}`);
      await expect(ownerPage.getByText('En línea', { exact: true })).toBeVisible();
      const listedRoom = roomBrowser.getByRole('button', {
        name: `Mirar mesa de ${ownerName}`,
        exact: true,
      });
      await expect(listedRoom).toBeVisible();
      const spectatorPage = await watcher.newPage();
      await spectatorPage.goto(`/mesa/${code}`);
      await expect(spectatorPage.getByText('En línea', { exact: true })).toBeVisible();

      if (departure === 'leave') {
        await ownerPage.getByRole('button', { name: 'Salir de la mesa', exact: true }).click();
        await ownerPage
          .getByRole('dialog')
          .getByRole('button', { name: 'Salir de la mesa', exact: true })
          .click();
        await expect(ownerPage).toHaveURL(`${baseURL}/`);
        await expect(listedRoom).toHaveCount(0, { timeout: 2000 });
      } else {
        const otherTab = await owner.newPage();
        await otherTab.goto(`/mesa/${code}`);
        await expect(otherTab.getByText('En línea', { exact: true })).toBeVisible();
        await ownerPage.close();
        // Outlast the grace period: another tab belonging to the player keeps it alive.
        await otherTab.waitForTimeout(11_000);
        expect((await owner.request.get(`${api}/api/matches/${code}`)).status()).toBe(200);
        await expect(listedRoom).toBeVisible();
        await otherTab.reload();
        await expect(otherTab.getByText('En línea', { exact: true })).toBeVisible();
        const closedAt = Date.now();
        await otherTab.close();
        expect((await owner.request.get(`${api}/api/matches/${code}`)).status()).toBe(200);
        await expect(listedRoom).toHaveCount(0, { timeout: 15_000 });
        expect(Date.now() - closedAt).toBeGreaterThanOrEqual(9000);
        expect(listingStreams, 'the event stream stays open across idle heartbeats').toBe(1);
      }

      await expect(spectatorPage).toHaveURL(`${baseURL}/`);
      expect((await owner.request.get(`${api}/api/matches/${code}`)).status()).toBe(404);
      for (const context of [owner, watcher]) {
        expect(
          (
            await context.request.post(`${api}/api/matches/${code}/join`, { headers, data: {} })
          ).status(),
        ).toBe(409);
      }
      const oldLink = await owner.newPage();
      await oldLink.goto(`/mesa/${code}`);
      await expect(
        oldLink.getByRole('heading', { name: 'Esta mesa ya no está disponible.' }),
      ).toBeVisible();
      await expect(oldLink.locator('.game-surface')).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
