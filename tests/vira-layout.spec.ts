import { expect, test } from '@playwright/test';
import { tableSnapshot } from './fixtures/table.js';
import { expectClearTableCards } from './table-layout.js';

for (const width of [320, 390, 768, 1280]) {
  for (const players of [2, 4]) {
    for (const spectator of [false, true]) {
      test(`vira stays clear at ${width}px with ${players} players as ${spectator ? 'spectator' : 'player'}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 800 });
        let snapshot = tableSnapshot(players, 0, spectator);
        await page.route('**/api/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/session') {
            await route.fulfill({ json: { id: 'player-0', name: 'Ana', registered: true } });
          } else if (path === '/api/matches/VIRA-1234') {
            await route.fulfill({ json: snapshot });
          } else {
            await route.fulfill({ status: 503, json: { error: 'Unavailable in layout test' } });
          }
        });
        await page.routeWebSocket('**/api/matches/VIRA-1234/ws', (socket) => {
          socket.send(JSON.stringify({ type: 'snapshot', data: snapshot }));
        });

        for (let dealer = 0; dealer < players; dealer++) {
          snapshot = tableSnapshot(players, dealer, spectator);
          await page.goto('/mesa/VIRA-1234');
          await expect(page.locator('.vira img')).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await expectClearTableCards(page);
          await expect
            .poll(() =>
              page.evaluate(
                ({ dealer, players, spectator }) => {
                  const deck = document.querySelector('.deck')!.getBoundingClientRect();
                  const table = document.querySelector('.felt-table')!.getBoundingClientRect();
                  const vira = document.querySelector('.vira img')!.getBoundingClientRect();
                  const dealerBounds = document
                    .querySelector(`[data-seat="${dealer}"]`)!
                    .getBoundingClientRect();
                  const perspective = spectator ? players - 1 : 0;
                  const relative = (dealer - perspective + players) % players;
                  const position =
                    players === 2
                      ? ['bottom', 'top'][relative]
                      : ['bottom', 'right', 'top', 'left'][relative];
                  const onDealersRight =
                    position === 'bottom'
                      ? deck.left >= table.left + table.width / 2
                      : position === 'top'
                        ? deck.left + deck.width / 2 < dealerBounds.left + dealerBounds.width / 2
                        : position === 'right'
                          ? deck.top + deck.height / 2 < dealerBounds.top + dealerBounds.height / 2
                          : deck.top + deck.height / 2 > dealerBounds.top + dealerBounds.height / 2;
                  const obstacles = document.querySelectorAll(
                    '.player-seat, .seat-tag, .speech-bubble, .seat-hand, .hand-area',
                  );
                  const overlaps = [...obstacles].some((element) => {
                    const bounds = element.getBoundingClientRect();
                    return (
                      bounds.width > 0 &&
                      bounds.height > 0 &&
                      deck.left < bounds.right &&
                      deck.right > bounds.left &&
                      deck.top < bounds.bottom &&
                      deck.bottom > bounds.top
                    );
                  });
                  return {
                    overlaps,
                    insideTable:
                      deck.left >= table.left &&
                      deck.right <= table.right &&
                      deck.top >= table.top &&
                      deck.bottom <= table.bottom,
                    largeEnough:
                      vira.width >= 40 &&
                      vira.width >
                        document.querySelector('.deck-back img')!.getBoundingClientRect().width *
                          1.3,
                    onDealersRight,
                  };
                },
                { dealer, players, spectator },
              ),
            )
            .toEqual({
              overlaps: false,
              insideTable: true,
              largeEnough: true,
              onDealersRight: true,
            });
        }
        if (players === 4 && !spectator && (width === 390 || width === 1280)) {
          await page.screenshot({ path: testInfo.outputPath('vira-layout.png'), fullPage: true });
        }
      });
    }
  }
}
