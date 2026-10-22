import { expect, test } from '@playwright/test';

test('chosen teammates, CPU seats and the winner appear in registered match history', async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL, viewport: testInfo.project.use.viewport })),
  );
  const [owner, partner, opponent] = contexts;
  const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
  const headers = { Origin: baseURL! };
  const username = `seat_${crypto.randomUUID().slice(0, 8)}`;
  try {
    expect(
      (
        await owner.request.post(`${api}/api/register`, {
          headers,
          data: {
            username,
            password: 'seat-selection-test-password',
            turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
          },
        })
      ).ok(),
    ).toBe(true);
    const created = await owner.request.post(`${api}/api/matches`, {
      headers,
      data: {
        private: true,
        config: { players: 4, target: 12, florRequired: false },
        options: { cpuSeats: [3] },
      },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json();
    const ownerPage = await owner.newPage();
    await ownerPage.goto(`/mesa/${code}`);
    await expect(ownerPage.getByText('En línea', { exact: true })).toBeVisible();

    const partnerPage = await partner.newPage();
    await partnerPage.goto('/');
    await partnerPage.getByLabel('Tu nombre en la mesa').fill('Mi compañero');
    const invitation = partnerPage.getByLabel('Código de la mesa', { exact: true });
    await invitation.fill('abcd1234');
    await expect(invitation).toHaveValue('ABCD-1234');
    await invitation.press('Backspace');
    await expect(invitation).toHaveValue('ABCD-123');
    await invitation.fill(code.replace('-', '').toLowerCase());
    await expect(invitation).toHaveValue(code);
    await partnerPage
      .locator('.join-form')
      .getByRole('button', { name: 'Entrar', exact: true })
      .click();
    const selector = partnerPage.getByRole('region', { name: 'Elige tu puesto', exact: true });
    await expect(selector.getByRole('region', { name: 'Equipo 1', exact: true })).toContainText(
      username,
    );
    await expect(selector.getByRole('region', { name: 'Equipo 2', exact: true })).toContainText(
      'CPU 3',
    );
    await expect(selector.getByRole('button', { name: 'Elegir puesto 4, equipo 2' })).toHaveCount(
      0,
    );
    const selectorBounds = await selector.boundingBox();
    const spectatorBounds = await partnerPage.locator('.spectator-bar').boundingBox();
    expect(selectorBounds).not.toBeNull();
    expect(spectatorBounds).not.toBeNull();
    expect(spectatorBounds!.y + spectatorBounds!.height).toBeLessThanOrEqual(selectorBounds!.y);
    await partnerPage.screenshot({
      path: `output/playwright/seat-selector-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await partnerPage.getByRole('button', { name: 'Elegir puesto 3, equipo 1' }).click();
    await expect(selector).not.toBeVisible();
    const partnerSnapshot = await partner.request.get(`${api}/api/matches/${code}`);
    expect((await partnerSnapshot.json()).seat).toBe(2);

    const opponentPage = await opponent.newPage();
    await opponentPage.goto(`/mesa/${code}`);
    await opponentPage.getByLabel('Tu nombre', { exact: true }).fill('Mi rival');
    await opponentPage.getByRole('button', { name: 'Elegir mi puesto', exact: true }).click();
    await expect(
      opponentPage.getByRole('button', { name: 'Elegir puesto 3, equipo 1' }),
    ).toHaveCount(0);
    // A stale or forged selection cannot steal the teammate's occupied seat.
    const rejected = await opponent.request.post(`${api}/api/matches/${code}/join`, {
      headers,
      data: { seat: 2 },
    });
    expect(rejected.status()).toBe(409);
    await opponentPage.getByRole('button', { name: 'Elegir puesto 2, equipo 2' }).click();
    await expect(ownerPage.getByText('Mano 1', { exact: true })).toBeAttached();
    await expect(ownerPage.locator('.scoreboard > div > span')).toHaveText(['Nosotros', 'Ellos']);
    await ownerPage.getByRole('button', { name: 'Salir de la mesa', exact: true }).click();
    await ownerPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Salir de la mesa', exact: true })
      .click();
    await expect(ownerPage).toHaveURL('/');
    await ownerPage.getByRole('button', { name: 'Mi historial', exact: true }).click();
    const history = ownerPage.getByRole('dialog');
    await expect(history).toContainText('Jugaste en el equipo 1 · Nosotros');
    await expect(history).toContainText('Ganador: Ellos · Equipo 2');
    await expect(history).toContainText('Mi compañero');
    await expect(history).toContainText('Mi rival');
    await expect(history).toContainText('CPU 3');
    await expect(history).toContainText('Puesto 4 · CPU');
    expect(
      await ownerPage.evaluate(async () => {
        await document.fonts.ready;
        return (
          document.fonts.check('650 16px "Nunito Variable"') &&
          getComputedStyle(document.body).fontFamily.includes('Nunito Variable')
        );
      }),
    ).toBe(true);
    await ownerPage.screenshot({
      path: `output/playwright/match-history-${testInfo.project.name}.png`,
      fullPage: true,
    });
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
