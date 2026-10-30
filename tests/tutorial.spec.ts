import { expect, test } from '@playwright/test';
import { tableSnapshot } from './fixtures/table.js';
import type { Command, GameView } from '../src/lib/protocol.js';

// These public-view fixtures exercise the lesson UI. The backend lesson tests
// independently own the rules, card order, legal moves, and settled score.
function lesson() {
  const base = tableSnapshot(2, 1, false).state!;
  base.config = { players: 2, target: 12, florRequired: true };
  base.phase = 'playing';
  base.round = 0;
  base.mano = 0;
  base.turn = 0;
  base.scores = [0, 0];
  base.vira = { suit: 'coins', number: 1 };
  base.holding = { envido: 37, flor: 0, receta: false };
  base.hand = [
    { index: 0, card: { suit: 'coins', number: 11 }, used: false },
    { index: 1, card: { suit: 'cups', number: 7 }, used: false },
    { index: 2, card: { suit: 'spades', number: 6 }, used: false },
  ];
  base.seats = [0, 1].map((seat) => ({
    seat,
    team: seat,
    remaining: 3,
    plays: Array.from({ length: 3 }, () => ({ present: false, burned: false, concealed: false })),
  }));
  const actions: { id: string; command?: Command }[] = [
    { id: 'vira' },
    { id: 'pieces' },
    { id: 'envido', command: { type: 'call', kind: 'envido' } },
    { id: 'envido-accepted' },
    { id: 'first-card', command: { type: 'play', card: 1 } },
    { id: 'first-trick' },
    { id: 'truco', command: { type: 'call', kind: 'truco', amount: 3 } },
    { id: 'truco-accepted' },
    { id: 'perico', command: { type: 'play' } },
    { id: 'recap' },
  ];
  return {
    version: 1,
    steps: actions.map((action, index) => {
      const view: GameView = structuredClone(base);
      view.revision = index + 2;
      view.legal = action.command ? [action.command] : [];
      if (index >= 5) {
        view.round = 1;
        view.hand[1].used = true;
        view.seats[0].remaining = view.seats[1].remaining = 2;
        view.seats[0].plays[0] = {
          card: { suit: 'cups', number: 7 },
          present: true,
          burned: false,
          concealed: false,
        };
        view.seats[1].plays[0] = {
          card: { suit: 'cups', number: 4 },
          present: true,
          burned: false,
          concealed: false,
        };
      }
      if (index >= 7) view.trucoValue = 3;
      if (index === 9) {
        view.phase = 'hand_over';
        view.handWinner = 0;
        view.scores = [5, 0];
        view.hand[0].used = true;
        view.seats[0].remaining = view.seats[1].remaining = 1;
        view.seats[0].plays[1] = {
          card: { suit: 'coins', number: 11 },
          present: true,
          burned: false,
          concealed: false,
        };
        view.seats[1].plays[1] = {
          card: { suit: 'coins', number: 10 },
          present: true,
          burned: false,
          concealed: false,
        };
        view.payouts = [
          { kind: 'envido', team: 0, points: 2 },
          { kind: 'truco', team: 0, points: 3 },
        ];
        view.envidoResults = [
          { seat: 0, value: 37, eligible: true },
          { seat: 1, value: 34, eligible: true },
        ];
        view.lastHand = {
          handNumber: 1,
          mano: 0,
          winner: 0,
          matchWinner: -1,
          target: 12,
          reason: 'two_tricks',
          scoresBefore: [0, 0],
          scoresAfter: [5, 0],
          tricks: [0, 1].map((round) => ({
            round,
            status: 'won',
            winnerSeat: 0,
            winnerTeam: 0,
            plays: view.seats.map((seat) => ({ seat: seat.seat, ...seat.plays[round] })),
          })),
          payouts: view.payouts,
          envidoResults: view.envidoResults,
        };
      }
      return { ...action, view };
    }),
  };
}

test('the guided hand teaches through card choices and cantos without creating a game or requiring an account', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    await route.fulfill(
      path === '/api/tutorial'
        ? { json: lesson() }
        : { status: 500, json: { error: 'Unexpected game request' } },
    );
  });
  await page.goto('/aprender');
  await expect(
    page.getByRole('heading', { name: 'Primero, mira la vira', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Sin reloj ni cuenta.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '¿Por qué?', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Explicación de este paso' })).toContainText(
    'La vira no se juega',
  );
  await page.getByRole('button', { name: 'Ver las cartas más fuertes', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 6 de espadas', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('11 de oros');
  await expect(
    page.getByRole('heading', { name: 'Encuentra tu perico', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tutorial-choice.png'), fullPage: true });
  const perico = page.getByRole('button', { name: 'Elegir 11 de oros', exact: true });
  await perico.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Canta envido antes de jugar', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Cantar envido', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'La CPU dice «Quiero»', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('34', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Jugar la primera carta', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 11 de oros', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('también sería válida');
  await page.getByRole('button', { name: 'Elegir 7 de copas', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ganaste la primera vuelta', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Probar un truco', exact: true }).click();
  await page.getByRole('button', { name: 'Cantar truco', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'El truco ahora vale 3', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resolver la segunda vuelta', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 11 de oros', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ya jugaste tu primera mano', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Piedras ganadas')).toContainText('Tú: +2 de envido');
  await expect(page.getByLabel('Piedras ganadas')).toContainText('Tú: +3 de truco');
  await expect(page.getByLabel('Piedras ganadas')).toContainText('Marcador: 5 — 0');
  expect(requests).toEqual(['GET /api/tutorial']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('tutorial-complete.png'), fullPage: true });
  await page.getByRole('button', { name: 'Repetir práctica', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Primero, mira la vira', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('progressbar', { name: 'Progreso de la práctica' })).toHaveAttribute(
    'value',
    '1',
  );
  expect(requests).toHaveLength(1);
});

test('a failed lesson load offers retry without leaving a partial practice', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/tutorial', (route) => {
    attempts++;
    return route.fulfill(
      attempts === 1
        ? { status: 503, json: { error: 'La práctica está temporalmente fuera de línea.' } }
        : { json: lesson() },
    );
  });
  await page.goto('/aprender');
  await expect(page.getByRole('alert')).toHaveText(
    'La práctica está temporalmente fuera de línea.',
  );
  await expect(page.getByLabel('Mesa de práctica')).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Primero, mira la vira', exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});

test('the live tutorial completes anonymously with the engine-produced 5–0 result', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push(`${request.method()} ${path}`);
  });
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/tutorial',
  );
  await page.goto('/aprender');
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const actual = await response.json();
  await page.getByRole('button', { name: 'Ver las cartas más fuertes', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 11 de oros', exact: true }).click();
  await page.getByRole('button', { name: 'Cantar envido', exact: true }).click();
  await page.getByRole('button', { name: 'Jugar la primera carta', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 7 de copas', exact: true }).click();
  await page.getByRole('button', { name: 'Probar un truco', exact: true }).click();
  await page.getByRole('button', { name: 'Cantar truco', exact: true }).click();
  await page.getByRole('button', { name: 'Resolver la segunda vuelta', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir 11 de oros', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ya jugaste tu primera mano', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Piedras ganadas')).toContainText('Marcador: 5 — 0');
  const final = actual.steps.at(-1).view;
  expect(final.scores).toEqual([5, 0]);
  expect(final.envidoResults).toEqual([
    { seat: 0, value: 37, eligible: true },
    { seat: 1, value: 34, eligible: true },
  ]);
  await page.getByText('Ver el resultado explicado', { exact: true }).click();
  await expect(page.getByLabel('Resultado explicado de la mano 1')).toContainText('37');
  await expect(page.getByLabel('Resultado explicado de la mano 1')).toContainText('34');
  expect(requests).toEqual(['GET /api/tutorial']);
  expect(
    (await page.context().cookies()).filter((cookie) => cookie.name === 'retruco_session'),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('tutorial-live-complete.png'),
    fullPage: true,
  });
});
