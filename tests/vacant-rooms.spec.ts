import { expect, test } from '@playwright/test';

test('the room browser recovers when the live-list endpoint is temporarily unavailable', async ({
  page,
}) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: null }));
  await page.route(/\/api\/matches(?:\?.*)?$/, (route) => route.fulfill({ json: [] }));
  let attempts = 0;
  await page.route(/\/api\/matches\/events(?:\?.*)?$/, async (route) => {
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

for (const departure of ['leave', 'disconnect', 'cpu_disconnect', 'cpu_navigate'] as const) {
  test(`vacant rooms disappear live after ${departure} and cannot be rejoined`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all(
      [0, 1, 2].map(() => browser.newContext({ baseURL, viewport: testInfo.project.use.viewport })),
    );
    const [owner, watcher, visitor] = contexts;
    const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
    const headers = { Origin: baseURL! };
    const ownerName = `Lobby ${crypto.randomUUID().slice(0, 8)}`;
    const cpuRoom = departure === 'cpu_disconnect' || departure === 'cpu_navigate';
    try {
      if (departure === 'cpu_navigate') {
        await owner.addInitScript(() => {
          const close = WebSocket.prototype.close;
          WebSocket.prototype.close = function (...args) {
            if (/^\/api\/matches\/[^/]+\/ws$/.test(new URL(this.url).pathname)) {
              // Keep the real connection receiving frames and answering control pings.
              // Navigation must release this connection without relying on close propagation.
              document.documentElement.dataset.delayedGameCloses = String(
                Number(document.documentElement.dataset.delayedGameCloses ?? 0) + 1,
              );
              return;
            }
            close.apply(this, args);
          };
        });
      }
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
      await roomBrowser.route(/\/api\/matches(?:\?.*)?$/, async (route) => {
        await route.fulfill({ json: [] });
      });
      await roomBrowser.goto('/');
      await expect.poll(() => listingStreams).toBe(1);
      const created = await owner.request.post(`${api}/api/matches`, {
        headers,
        data: {
          private: false,
          config: {
            players: cpuRoom ? 2 : 4,
            target: 12,
            florRequired: false,
          },
          options: { cpuSeats: cpuRoom ? [1] : [] },
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
      } else if (departure === 'cpu_navigate') {
        // A document marker proves both links use SPA navigation in the original tab.
        await ownerPage.evaluate(() => {
          document.documentElement.dataset.navigationMarker = 'same-document';
        });
        const departedAt = Date.now();
        await ownerPage.locator('.match-header .brand').click();
        await expect(ownerPage).toHaveURL(`${baseURL}/`);
        await expect(ownerPage.locator('html')).toHaveAttribute('data-delayed-game-closes', '1');
        expect((await owner.request.get(`${api}/api/matches/${code}`)).status()).toBe(200);

        // Keep the replacement private so the public row still identifies only the old room.
        await ownerPage.getByText('Opciones de mesa', { exact: true }).click();
        await ownerPage.getByRole('button', { name: 'Cambiar', exact: true }).click();
        await expect(ownerPage.getByText('Mesa privada', { exact: true })).toBeVisible();
        await ownerPage.getByRole('button', { name: /Crear una mesa/ }).click();
        await expect(ownerPage).toHaveURL(/\/mesa\/[A-Z]{4}-\d{4}$/);
        const replacementCode = new URL(ownerPage.url()).pathname.split('/').at(-1)!;
        expect(replacementCode).not.toBe(code);
        await expect(ownerPage.getByText('En línea', { exact: true })).toBeVisible();
        await expect(ownerPage.locator('html')).toHaveAttribute(
          'data-navigation-marker',
          'same-document',
        );

        await expect(listedRoom).toHaveCount(0, {
          timeout: Math.max(1000, 15_000 - (Date.now() - departedAt)),
        });
        expect(Date.now() - departedAt).toBeGreaterThanOrEqual(9000);
        expect(listingStreams, 'navigation does not reconnect the independent room browser').toBe(
          1,
        );
        expect((await owner.request.get(`${api}/api/matches/${replacementCode}`)).status()).toBe(
          200,
        );
        await ownerPage.getByRole('button', { name: 'Abrir chat', exact: true }).click();
        await ownerPage.getByLabel('Mensaje', { exact: true }).fill('Seguimos en la nueva mesa');
        await ownerPage.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
        await expect(
          ownerPage.getByText('Seguimos en la nueva mesa', { exact: true }),
        ).toBeVisible();
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
