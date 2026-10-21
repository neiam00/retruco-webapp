import { expect, test } from '@playwright/test';
import type { Snapshot } from '../src/lib/protocol.js';
import { expectClearTableCards } from './table-layout.js';

function tableSnapshot(players: number, dealer: number, spectator: boolean): Snapshot {
  const config = { players, target: 24, florRequired: true };
  return {
    code: 'VIRA-1234',
    private: true,
    config,
    seats: Array.from({ length: players }, (_, seat) => ({
      id: `player-${seat}`,
      name: seat === 0 ? 'Un nombre bastante largo' : `CPU ${seat}`,
      cpu: seat !== 0,
    })),
    seat: spectator ? -1 : 0,
    perspective: spectator ? players - 1 : 0,
    sequence: 1,
    chat: [],
    signals: [],
    events: Array.from({ length: players }, (_, seat) => ({
      id: seat + 1,
      hand: 1,
      event: { type: 'respond', seat, kind: 'decline' },
    })),
    cantoHistory: [],
    serverTime: new Date().toISOString(),
    deadline: new Date(Date.now() + 30_000).toISOString(),
    state: {
      config,
      version: '2',
      revision: 1,
      phase: 'playing',
      handNumber: 1,
      dealer,
      mano: (dealer + 1) % players,
      turn: 0,
      round: 1,
      scores: [3, 5],
      winner: -1,
      handWinner: -1,
      vira: { suit: 'cups', number: 12 },
      trucoValue: 1,
      mandatoryStack: false,
      florValid: false,
      hand: spectator
        ? []
        : [1, 2, 3].map((number, index) => ({
            index,
            card: { suit: 'spades' as const, number },
            used: index === 0,
          })),
      seats: Array.from({ length: players }, (_, seat) => ({
        seat,
        team: seat % 2,
        remaining: 2,
        plays: [
          {
            card: { suit: 'spades' as const, number: seat + 1 },
            present: true,
            burned: false,
            concealed: false,
          },
        ],
      })),
      payouts: [],
      envidoResults: [],
      legal: [],
    },
  };
}

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
                    largeEnough: vira.width >= (innerWidth <= 650 ? 52 : 72),
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
