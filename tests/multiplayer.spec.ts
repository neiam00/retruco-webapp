import { expect, test } from '@playwright/test';
import { expectClearResults, expectClearTableCards } from './table-layout.js';

test('four players surround the central cards and can choose a declaration', async ({
  browser,
}, testInfo) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({ viewport: testInfo.project.use.viewport }),
    ),
  );
  try {
    const headers = { Origin: 'http://127.0.0.1:5173' };
    const runID = Date.now().toString(36);
    for (const [index, context] of contexts.entries()) {
      const response = await context.request.post('http://127.0.0.1:8080/api/register', {
        headers,
        data: {
          username: `${['ana', 'beto', 'carla', 'diego'][index]}_${runID}`,
          password: `local-test-${runID}`,
        },
      });
      expect(response.ok()).toBe(true);
    }
    const created = await contexts[0].request.post('http://127.0.0.1:8080/api/matches', {
      headers,
      data: { private: true, config: { players: 4, target: 24, florRequired: true } },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json();
    for (const context of contexts.slice(1)) {
      const joined = await context.request.post(`http://127.0.0.1:8080/api/matches/${code}/join`, {
        headers,
        data: {},
      });
      expect(joined.ok()).toBe(true);
    }
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map((page) => page.goto(`/mesa/${code}`)));
    await Promise.all(
      pages.map((page) => expect(page.getByText('En línea', { exact: true })).toBeVisible()),
    );
    for (const page of pages) {
      const cut = page.getByRole('button', { name: 'Partir el mazo', exact: true });
      if (await cut.isVisible()) {
        await cut.click();
        break;
      }
    }
    await expect(pages[0].locator('.hand-card')).toHaveCount(3);
    for (let move = 0; move < 2; move++) {
      await expect
        .poll(async () => {
          for (const [index, page] of pages.entries()) {
            if (await page.locator('.hand-card:not(:disabled)').count()) return index;
          }
          return -1;
        })
        .not.toBe(-1);
      for (const page of pages) {
        const playable = page.locator('.hand-card:not(:disabled)');
        if (await playable.count()) {
          await playable.first().click();
          await expect(pages[0].locator('.played-card')).toHaveCount(move + 1);
          break;
        }
      }
    }
    for (const playerPage of pages) {
      await expectClearTableCards(playerPage);
    }
    const page = pages[0];
    for (const position of ['top', 'left', 'right']) {
      await expect(page.locator(`.seat-${position}`)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Decir…', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Flor flor', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Flor flor', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect
      .poll(() =>
        page
          .locator('.card-image')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: `output/playwright/four-player-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('two guests can play, chat, reconnect and forfeit a private match', async ({
  browser,
}, testInfo) => {
  const firstContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const secondContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const spectatorContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const spectator = await spectatorContext.newPage();

  try {
    await first.goto('/');
    await first.getByLabel('Tu nombre en la mesa').fill('Prueba Ana');
    await first.getByRole('button', { name: '1 vs 1', exact: true }).click();
    await first.getByRole('button', { name: '12', exact: true }).click();
    await first.getByRole('button', { name: 'Cambiar', exact: true }).click();
    await first.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
    await expect(first).toHaveURL(/\/mesa\/[A-Z]{4}-[0-9]{4}$/);
    await expect(first.getByText('Faltan 1 para repartir.')).toBeVisible();

    const tableURL = first.url();
    await second.goto(tableURL);
    await second.getByLabel('Tu nombre', { exact: true }).fill('Prueba Beto');
    await second.getByRole('button', { name: 'Sentarme a jugar' }).click();
    await expect(second.getByText('En línea', { exact: true })).toBeVisible();
    await expect(first.getByText('Mano 1', { exact: true })).toBeAttached();

    const cutButton = { name: 'Partir el mazo', exact: true };
    const cutter = (await first.getByRole('button', cutButton).isVisible()) ? first : second;
    await cutter.getByLabel('Punto de corte (1–39)').fill('19');
    await cutter.getByRole('button', cutButton).click();
    await expect(first.locator('.hand-card')).toHaveCount(3);
    await expect(first.locator('.scoreboard > div > span')).toHaveText(['Nosotros', 'Ellos']);
    await expect(second.locator('.scoreboard > div > span')).toHaveText(['Ellos', 'Nosotros']);
    await expect(first.locator('.seat-top .identity')).toContainText('Ellos');
    await expect(second.locator('.seat-bottom .identity')).toContainText('Nosotros');
    await spectator.goto(tableURL);
    await spectator.getByLabel('Tu nombre', { exact: true }).fill('Prueba Observador');
    await spectator.getByRole('button', { name: 'Entrar a mirar', exact: true }).click();
    await expect(spectator.locator('.scoreboard > div > span')).toHaveText([
      'Equipo 1',
      'Equipo 2',
    ]);
    await spectator
      .locator('.spectator-bar')
      .getByRole('button', { name: 'Prueba Beto', exact: true })
      .click();
    await expect(spectator.locator('.seat-top .identity')).toContainText('Equipo 1');
    await expect(spectator.locator('.scoreboard > div > span')).toHaveText([
      'Equipo 1',
      'Equipo 2',
    ]);
    const leyCall = { name: 'A ley, envido', exact: true };
    await expect
      .poll(
        async () =>
          (await first.getByRole('button', leyCall).isVisible()) ||
          (await second.getByRole('button', leyCall).isVisible()),
      )
      .toBe(true);
    const caller = (await first.getByRole('button', leyCall).isVisible()) ? first : second;
    const responder = caller === first ? second : first;
    await caller.getByRole('button', leyCall).click();
    await responder.getByRole('button', { name: 'Sin ley, quiero', exact: true }).click();
    await expect(first.getByLabel('Valores de envido')).not.toBeVisible();
    await caller.getByRole('button', { name: 'Truco', exact: true }).click();
    const history = first.getByRole('region', { name: 'Historial de cantos', exact: true });
    const firstHandHistory = history.getByRole('region', {
      name: 'Cantos de la mano 1',
      exact: true,
    });
    const callingTeam = caller === first ? 1 : 2;
    await expect(firstHandHistory.getByRole('listitem').nth(0)).toHaveText(
      `${callingTeam === 1 ? 'Nosotros' : 'Ellos'} A ley, envido`,
    );
    await expect(firstHandHistory.getByRole('listitem').nth(1)).toHaveText(
      `${callingTeam === 1 ? 'Ellos' : 'Nosotros'} Sin ley, quiero`,
    );
    await expect(firstHandHistory.getByRole('listitem').nth(2)).toHaveText(
      `${callingTeam === 1 ? 'Nosotros' : 'Ellos'} Truco`,
    );
    await expect(
      spectator
        .getByRole('region', { name: 'Cantos de la mano 1', exact: true })
        .getByRole('listitem')
        .nth(2),
    ).toHaveText(`Equipo ${callingTeam} Truco`);
    await expect(responder.locator('.table-status')).toContainText('Responde: Nosotros');
    await expect(caller.locator('.table-status')).toContainText('Responde: Ellos');
    await expect(spectator.locator('.table-status')).toContainText(
      `Responde: Equipo ${3 - callingTeam}`,
    );
    await expect(responder.locator('.canto-actions button')).toHaveText([
      'Quiero',
      'No quiero',
      'Quiero y retruco',
      'Quiero y vale 9',
      'Quiero y vale partida',
    ]);
    await responder.screenshot({
      path: `output/playwright/truco-replies-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await responder.getByRole('button', { name: 'Quiero', exact: true }).click();
    expect(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(first.getByRole('button', { name: 'Abrir chat', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        first
          .locator('.card-image')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await first.screenshot({
      path: `output/playwright/table-${testInfo.project.name}.png`,
      fullPage: true,
    });

    for (let move = 0; move < 6; move++) {
      const handFinished = first.getByRole('heading', { name: 'La próxima ya viene.' });
      if (await handFinished.isVisible()) break;

      const turn = async () => {
        if (await handFinished.isVisible()) return 'finished';
        if (await first.locator('.hand-card:not(:disabled)').count()) return 'first';
        if (await second.locator('.hand-card:not(:disabled)').count()) return 'second';
        return 'waiting';
      };
      await expect.poll(turn).not.toBe('waiting');
      const player = await turn();
      if (player === 'finished') break;

      const active = player === 'first' ? first : second;
      const usedBefore = await active.locator('.hand-card.used').count();
      const available = active.locator('.hand-card:not(:disabled)');
      const playBoth = active.getByRole('button', { name: 'Jugar las dos', exact: true });

      if (await playBoth.isVisible()) {
        await available.nth(0).click();
        await available.nth(1).click();
        await playBoth.click();
      } else {
        if (move === 0) {
          await active.getByRole('button', { name: 'Decir…', exact: true }).click();
          await expect(
            active.getByRole('dialog').getByRole('button', { name: 'A ley', exact: true }),
          ).toBeEnabled();
          await active
            .getByRole('dialog')
            .getByRole('button', { name: 'Flor', exact: true })
            .click();
          await available.first().press('Enter');
          const other = active === first ? second : first;
          await expect(other.locator('.speech-bubble').filter({ hasText: /^Flor$/ })).toBeVisible();
        } else {
          await available.first().click();
        }
      }
      await expect
        .poll(() => active.locator('.hand-card.used').count())
        .toBeGreaterThan(usedBefore);
      await expectClearTableCards(first);
      await expectClearTableCards(second);
      if (move === 2) {
        await first.getByRole('button', { name: 'Decir…', exact: true }).click();
        await expect(
          first.getByRole('dialog').getByRole('button', { name: 'A ley', exact: true }),
        ).toBeDisabled();
        await first.keyboard.press('Escape');
        await first.screenshot({
          path: `output/playwright/played-cards-${testInfo.project.name}.png`,
          fullPage: true,
        });
        if (testInfo.project.name === 'mobile') {
          await first.setViewportSize({ width: 320, height: 568 });
          await expectClearTableCards(first);
          await first.screenshot({
            path: 'output/playwright/played-cards-small-mobile.png',
            fullPage: true,
          });
          await first.setViewportSize(testInfo.project.use.viewport!);
        }
      }
    }
    await expect(first.getByRole('heading', { name: 'La próxima ya viene.' })).toBeVisible();
    await expect(first.getByLabel('Valores de envido')).toContainText('Prueba Ana');
    await expect(first.getByLabel('Valores de envido')).toContainText('Prueba Beto');
    await expectClearResults(first);

    await first.getByRole('button', { name: 'Abrir chat', exact: true }).click();
    await second.getByRole('button', { name: 'Abrir chat', exact: true }).click();
    await first.getByLabel('Mensaje', { exact: true }).fill('¡Buenas manos!');
    await first.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(second.getByText('¡Buenas manos!', { exact: true })).toBeVisible();

    await second.reload();
    await expect(second.getByText('En línea', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Abrir chat', exact: true }).click();
    await expect(second.getByText('¡Buenas manos!', { exact: true })).toBeVisible();

    await first.getByRole('button', { name: 'Cerrar chat', exact: true }).click();
    await second.getByRole('button', { name: 'Cerrar chat', exact: true }).click();
    await expect(first.locator('.table-meta')).toContainText('Mano 2', { timeout: 10000 });
    for (const page of [first, second]) {
      const cut = page.getByRole('button', { name: 'Partir el mazo', exact: true });
      if (await cut.isVisible()) {
        await cut.click();
        break;
      }
    }
    await expect(first.locator('.table-status')).toContainText('1.ª vuelta');
    const secondCaller = (await first
      .getByRole('button', { name: 'Truco', exact: true })
      .isVisible())
      ? first
      : second;
    await secondCaller.getByRole('button', { name: 'Truco', exact: true }).click();
    await expect(
      history.getByRole('region', { name: 'Cantos de la mano 2', exact: true }),
    ).toContainText('Truco');
    await expect(firstHandHistory).toContainText('Sin ley, quiero');
    await second.reload();
    await expect(
      second.getByRole('region', { name: 'Cantos de la mano 1', exact: true }),
    ).toContainText('Sin ley, quiero');
    await expect(
      second.getByRole('region', { name: 'Cantos de la mano 2', exact: true }),
    ).toContainText('Truco');
    expect(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await first.screenshot({
      path: `output/playwright/canto-history-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await first.getByRole('button', { name: 'Salir de la mesa', exact: true }).click();
    await first
      .getByRole('dialog')
      .getByRole('button', { name: 'Salir de la mesa', exact: true })
      .click();
    await expect(second.getByRole('heading', { name: '¡Ganamos nosotros!' })).toBeVisible();
    await expect(spectator.getByRole('heading', { name: '¡Ganó el equipo 2!' })).toBeVisible();
    await expectClearResults(second);
    await second.screenshot({
      path: `output/playwright/match-over-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await firstContext.close();
    await secondContext.close();
    await spectatorContext.close();
  }
});

test('lobby and rule book fit the viewport and the account dialog is accessible', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'El truco de aquí. Donde estés.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `output/playwright/lobby-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Crea una cuenta', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Usuario', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.goto('/reglas');
  await expect(page.getByRole('heading', { name: 'Así se juega en esta mesa.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
