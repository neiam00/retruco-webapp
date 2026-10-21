import { expect, test } from '@playwright/test';
import type { Snapshot } from '../src/lib/protocol.js';

declare global {
  interface Window {
    burnedFlightSources: string[];
  }
}

test('players choose a concealed burn, keep their other card, and can reconnect', async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ ...testInfo.project.use, baseURL })),
  );
  try {
    const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
    const headers = { Origin: baseURL! };
    for (const [index, context] of contexts.entries()) {
      const guest = await context.request.post(`${api}/api/guest`, {
        headers,
        data: { name: `Burn test ${index + 1}` },
      });
      expect(guest.ok()).toBe(true);
    }
    const created = await contexts[0].request.post(`${api}/api/matches`, {
      headers,
      data: { private: true, config: { players: 2, target: 24, florRequired: false } },
    });
    expect(created.ok()).toBe(true);
    const { code } = await created.json();
    expect(
      (
        await contexts[1].request.post(`${api}/api/matches/${code}/join`, { headers, data: {} })
      ).ok(),
    ).toBe(true);
    const snapshot = async (seat = 0): Promise<Snapshot> => {
      const response = await contexts[seat].request.get(`${api}/api/matches/${code}`);
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map((page) => page.goto(`/mesa/${code}`)));
    for (const page of pages)
      await expect(page.getByText('En línea', { exact: true })).toBeVisible();
    const cutter = (await snapshot()).state!.turn;
    await pages[cutter].getByRole('button', { name: 'Partir el mazo', exact: true }).click();
    await expect(pages[0].locator('.hand-card')).toHaveCount(3);
    for (const page of pages) {
      await expect(page.locator('[data-card-flight]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Quemar carta', exact: true })).toHaveCount(0);
    }

    // Different numbers guarantee a decisive first round, using the real deal.
    const hands = await Promise.all([0, 1].map(async (seat) => (await snapshot(seat)).state!.hand));
    const firstCard = hands[0].find((card) =>
      hands[1].some((other) => other.card.number !== card.card.number),
    )!;
    const secondCard = hands[1].find((card) => card.card.number !== firstCard.card.number)!;
    const opening = [firstCard.index, secondCard.index];
    for (let play = 0; play < 2; play++) {
      const seat = (await snapshot()).state!.turn;
      await pages[seat].locator(`[data-hand-card="${opening[seat]}"]`).click();
      await expect
        .poll(async () => (await snapshot()).state!.seats[seat].plays[0].present)
        .toBe(true);
    }
    await expect.poll(async () => (await snapshot()).state!.round).toBe(1);
    const burner = (await snapshot()).state!.turn;
    const opponent = 1 - burner;
    const chosen = (await snapshot(burner)).state!.hand.find((card) => !card.used)!.index;
    const page = pages[burner];
    await page.getByRole('button', { name: 'Quemar carta', exact: true }).click();
    await expect(page.getByText('Elige una carta para quemarla y pasar el turno.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar quemado', exact: true }).click();
    await expect(page.getByText('Elige una carta para quemarla y pasar el turno.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Quemar carta', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `output/playwright/burn-controls-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      window.burnedFlightSources = [];
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof HTMLImageElement && node.dataset.cardFlight === 'play')
              window.burnedFlightSources.push(node.src);
      }).observe(document, { childList: true, subtree: true });
    });
    await page.locator(`[data-hand-card="${chosen}"]`).click();
    await expect
      .poll(async () => (await snapshot()).state!.seats[burner].plays[1].burned)
      .toBe(true);
    const afterBurn = (await snapshot(burner)).state!;
    expect(afterBurn.turn).toBe(opponent);
    expect(afterBurn.hand.find((card) => card.index === chosen)!.used).toBe(true);
    expect(afterBurn.hand.filter((card) => !card.used)).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => window.burnedFlightSources.length)).toBe(1);
    expect(await page.evaluate(() => window.burnedFlightSources[0])).toMatch(
      /\/card_back-.*\.webp$/,
    );
    const burnedCard = `[data-play-seat="${burner}"][data-play-round="1"]`;
    for (const viewer of pages) {
      await expect(viewer.locator('[data-card-flight]')).toHaveCount(0);
      await expect(viewer.locator(`${burnedCard} img`)).toHaveAttribute(
        'src',
        /card_back-.*\.webp$/,
      );
      await expect(viewer.locator(burnedCard)).toContainText('Quemada');
    }
    expect((await snapshot(opponent)).state!.seats[burner].plays[1].card).toBeUndefined();
    await page.reload();
    await expect(page.locator(`${burnedCard} img`)).toHaveAttribute('src', /card_back-.*\.webp$/);

    const reply = (await snapshot(opponent)).state!.hand.find((card) => !card.used)!.index;
    await pages[opponent].locator(`[data-hand-card="${reply}"]`).click();
    await expect.poll(async () => (await snapshot()).state!.round).toBe(2);
    for (const seat of [opponent, burner]) {
      await pages[seat].getByRole('button', { name: 'Quemar carta', exact: true }).click();
      await pages[seat].locator('.hand-card:not(:disabled)').click();
      await expect
        .poll(async () => (await snapshot()).state!.seats[seat].plays[2].burned)
        .toBe(true);
    }
    await expect(page.locator('.table-status.results')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quemar carta', exact: true })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
