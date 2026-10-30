import { expect, test } from '@playwright/test';

test('players rematch through the live server and resume the same table after leaving the page', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ baseURL, viewport: testInfo.project.use.viewport })),
  );
  const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
  const headers = { Origin: baseURL! };
  try {
    for (const [index, context] of contexts.entries()) {
      expect(
        (
          await context.request.post(`${api}/api/guest`, {
            headers,
            data: { name: `Rematch ${index} ${crypto.randomUUID().slice(0, 6)}` },
          })
        ).ok(),
      ).toBe(true);
    }
    const created = await contexts[0].request.post(`${api}/api/matches`, {
      headers,
      data: { private: true, config: { players: 2, target: 12, florRequired: false } },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json();
    expect(
      (
        await contexts[1].request.post(`${api}/api/matches/${code}/join`, {
          headers,
          data: { seat: 1 },
        })
      ).ok(),
    ).toBe(true);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map((page) => page.goto(`/mesa/${code}`)));
    for (const page of pages)
      await expect(page.getByText('En línea', { exact: true })).toBeVisible();
    await pages[0].getByRole('button', { name: 'Salir de la mesa', exact: true }).click();
    await pages[0]
      .getByRole('dialog')
      .getByRole('button', { name: 'Salir de la mesa', exact: true })
      .click();
    await expect(pages[0]).toHaveURL(`${baseURL}/`);
    await expect(pages[1].getByRole('button', { name: 'Revancha', exact: true })).toBeVisible();
    await pages[0].goto(`/mesa/${code}`);
    await pages[0].getByRole('button', { name: 'Revancha', exact: true }).click();
    await expect(
      pages[0].getByRole('button', { name: 'Ya estás listo', exact: true }),
    ).toBeDisabled();
    await pages[1].getByRole('button', { name: 'Revancha', exact: true }).click();
    for (const page of pages)
      await expect(page.getByRole('button', { name: 'Ya estás listo', exact: true })).toHaveCount(
        0,
      );
    const snapshot = await (await contexts[0].request.get(`${api}/api/matches/${code}`)).json();
    expect(snapshot.gameNumber).toBe(2);
    expect(snapshot.state.phase).toBe('cutting');
    expect(snapshot.state.scores).toEqual([0, 0]);
    await Promise.all(pages.map((page) => page.locator('.match-header .brand').click()));
    for (const page of pages)
      await expect(page.getByRole('link', { name: 'Volver a mi partida' })).toBeVisible();
    // Exceed the former reconnect grace through real socket teardown and HTTP.
    await pages[0].waitForTimeout(11_000);
    const paused = await (await contexts[0].request.get(`${api}/api/matches/${code}`)).json();
    expect(paused.paused).toBe(true);
    expect(paused.state.revision).toBe(snapshot.state.revision);
    await pages[0].getByRole('link', { name: 'Volver a mi partida' }).click();
    await expect(pages[0].getByText('En línea', { exact: true })).toBeVisible();
    const resumed = await (await contexts[0].request.get(`${api}/api/matches/${code}`)).json();
    expect(resumed.paused).toBe(false);
    expect(resumed.state.revision).toBe(snapshot.state.revision);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
