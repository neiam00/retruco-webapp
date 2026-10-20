import { expect, test } from '@playwright/test';

test('built Pages worker forwards session cookies and live WebSocket snapshots', async ({
  browser,
}) => {
  const origin = process.env.RETRUCO_EDGE_URL;
  test.skip(
    !origin,
    'Set RETRUCO_EDGE_URL to a local Wrangler Pages server with its backend configured.',
  );
  if (!origin) return;

  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const health = await contexts[0].request.get(`${origin}/api/health`);
    expect(health.ok()).toBe(true);
    for (const [index, context] of contexts.entries()) {
      const guest = await context.request.post(`${origin}/api/guest`, {
        headers: { Origin: origin },
        data: { name: index === 0 ? 'Ana edge' : 'Beto edge' },
      });
      expect(guest.ok()).toBe(true);
      expect((await context.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);
      const session = await context.request.get(`${origin}/api/session`);
      expect((await session.json()).name).toBe(index === 0 ? 'Ana edge' : 'Beto edge');
    }
    const created = await contexts[0].request.post(`${origin}/api/matches`, {
      headers: { Origin: origin },
      data: { private: true, config: { players: 2, target: 12, florRequired: false } },
    });
    expect(created.status()).toBe(201);
    const { code } = await created.json();
    const joined = await contexts[1].request.post(`${origin}/api/matches/${code}/join`, {
      headers: { Origin: origin },
      data: {},
    });
    expect(joined.ok()).toBe(true);

    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map((page) => page.goto(`${origin}/mesa/${code}`)));
    for (const page of pages) {
      await expect(page.getByText('En línea', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Abrir chat', exact: true }).click();
    }
    await pages[0].getByLabel('Mensaje', { exact: true }).fill('Mensaje por el proxy');
    await pages[0].getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(pages[1].getByText('Mensaje por el proxy', { exact: true })).toBeVisible();
    await pages[1].reload();
    await expect(pages[1].getByText('En línea', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
