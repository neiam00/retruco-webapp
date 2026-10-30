import { expect, test } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';
import type { HandRecap, Snapshot } from '../src/lib/protocol.js';

function recap(): HandRecap {
  return {
    handNumber: 1,
    mano: 0,
    winner: 0,
    matchWinner: -1,
    target: 24,
    reason: 'two_tricks',
    vira: { suit: 'coins', number: 1 },
    scoresBefore: [3, 5],
    scoresAfter: [8, 5],
    tricks: [
      {
        round: 0,
        status: 'won',
        winnerSeat: 0,
        winnerTeam: 0,
        plays: [
          {
            seat: 0,
            present: true,
            burned: false,
            concealed: false,
            card: { suit: 'spades', number: 7 },
          },
          {
            seat: 1,
            present: true,
            burned: false,
            concealed: false,
            card: { suit: 'cups', number: 6 },
          },
        ],
      },
      {
        round: 1,
        status: 'won',
        winnerSeat: 0,
        winnerTeam: 0,
        plays: [
          {
            seat: 0,
            present: true,
            burned: false,
            concealed: false,
            card: { suit: 'coins', number: 11 },
          },
          {
            seat: 1,
            present: true,
            burned: false,
            concealed: false,
            card: { suit: 'coins', number: 10 },
          },
        ],
      },
      { round: 2, status: 'unplayed', winnerSeat: -1, winnerTeam: -1, plays: [] },
    ],
    payouts: [
      { kind: 'envido', team: 0, points: 2 },
      { kind: 'truco', team: 0, points: 3 },
    ],
    envidoResults: [
      { seat: 0, value: 37, eligible: true },
      { seat: 1, value: 34, eligible: true },
    ],
  };
}

function finished(spectator = false): Snapshot {
  const snapshot = tableSnapshot(2, 0, spectator);
  snapshot.seats = [
    { id: 'player-0', name: 'Ana' },
    { id: 'player-1', name: 'Beto' },
  ];
  snapshot.state!.phase = 'hand_over';
  snapshot.state!.handWinner = 0;
  snapshot.state!.scores = [8, 5];
  snapshot.state!.lastHand = recap();
  snapshot.cantoHistory = [
    { id: 1, hand: 0, event: { type: 'call', kind: 'truco', amount: 100, seat: 1 } },
    { id: 2, hand: 1, event: { type: 'call', kind: 'envido', seat: 0 } },
    { id: 3, hand: 1, event: { type: 'respond', kind: 'accept', canto: 'envido', seat: 1 } },
    { id: 4, hand: 1, event: { type: 'call', kind: 'truco', amount: 3, seat: 0 } },
    { id: 5, hand: 1, event: { type: 'respond', kind: 'accept', canto: 'truco', seat: 1 } },
  ];
  return snapshot;
}

test('recap explains ordered payments and stays on the selected hand while play advances', async ({
  page,
}, testInfo) => {
  const snapshot = finished();
  const update = await showTable(page, snapshot);
  await page.getByRole('button', { name: 'Ver resumen de la mano', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Resumen de la mano 1', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('El mismo equipo ganó las dos primeras vueltas.');
  await expect(dialog.getByRole('region', { name: 'Cambio del marcador' })).toContainText(
    '3 → 8 (+5)',
  );
  await expect(dialog.locator('.recap-payments li')).toHaveText([
    'Envido · Nosotros +2 piedras',
    'Truco · Nosotros +3 piedras',
  ]);
  await expect(
    dialog.getByRole('region', { name: 'Cantos y respuestas de esta mano' }),
  ).toContainText('Quiero');
  await expect(
    dialog.getByRole('region', { name: 'Cantos y respuestas de esta mano' }),
  ).not.toContainText('Vale partida');
  await expect(dialog.getByRole('img', { name: '7 de espadas', exact: true })).toBeVisible();
  await expect(dialog).toContainText('Vira de esta mano: 1 de oros.');
  await expect(dialog).toContainText('La partida sigue y los tiempos continúan');
  await page.screenshot({ path: testInfo.outputPath('hand-recap.png'), fullPage: true });

  const next = structuredClone(snapshot);
  next.state!.revision++;
  next.state!.phase = 'playing';
  next.state!.handNumber = 3;
  next.state!.lastHand = {
    ...recap(),
    handNumber: 2,
    reason: 'truco_declined',
    scoresBefore: [8, 5],
    scoresAfter: [9, 5],
    payouts: [{ kind: 'truco', team: 0, points: 1 }],
  };
  update(next);
  await expect(
    dialog.getByRole('heading', { name: 'Resumen de la mano 1', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('Vira de esta mano: 1 de oros.');
  await expect(dialog).not.toContainText('No se aceptó el truco');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const details = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
  await expect(details).toBeFocused();
  await details.click();
  await page.getByRole('button', { name: 'Resumen de la última mano', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Resumen de la mano 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('No se aceptó el truco');
});

test('recap keeps concealed and burned card identities hidden and uses spectator team labels', async ({
  page,
}, testInfo) => {
  const snapshot = finished(true);
  const result = snapshot.state!.lastHand!;
  result.reason = 'visible_first_and_third';
  result.tricks[1] = {
    round: 1,
    status: 'hidden',
    winnerSeat: -1,
    winnerTeam: -1,
    plays: [
      {
        seat: 0,
        present: true,
        concealed: true,
        burned: false,
        card: { suit: 'clubs', number: 12 },
      },
      {
        seat: 1,
        present: true,
        concealed: false,
        burned: true,
        card: { suit: 'coins', number: 12 },
      },
    ],
  };
  result.tricks[2] = {
    round: 2,
    status: 'won',
    winnerSeat: 0,
    winnerTeam: 0,
    plays: [
      {
        seat: 0,
        present: true,
        burned: false,
        concealed: false,
        card: { suit: 'spades', number: 1 },
      },
      { seat: 1, present: true, burned: true, concealed: false },
    ],
  };
  await showTable(page, snapshot);
  await page.getByRole('button', { name: 'Ver resumen de la mano', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ganó las cartas: Equipo 1.');
  await expect(dialog).not.toContainText('Nosotros');
  await expect(dialog).toContainText('Cartas de abajo sin revelar');
  await expect(dialog.getByText('Sin revelar', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Quemada', { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('img', { name: '12 de bastos', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('img', { name: '12 de oros', exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText('12 de bastos');
  await expect(dialog).not.toContainText('12 de oros');
  await page.screenshot({ path: testInfo.outputPath('hand-recap-spectator.png'), fullPage: true });
});

test('a match decided by earlier envido payments names its match winner separately from the cards', async ({
  page,
}) => {
  const snapshot = finished();
  snapshot.state!.phase = 'match_over';
  snapshot.state!.winner = 1;
  snapshot.state!.lastHand = {
    ...recap(),
    target: 12,
    matchWinner: 1,
    scoresBefore: [3, 11],
    scoresAfter: [3, 13],
    payouts: [{ kind: 'envido', team: 1, points: 2 }],
  };
  await showTable(page, snapshot);
  await page.getByRole('button', { name: 'Ver resumen de la mano', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ganó las cartas: Nosotros.');
  await expect(dialog).toContainText('Ganó la partida: Ellos.');
  await expect(dialog.locator('.recap-payments li')).toHaveText(['Envido · Ellos +2 piedras']);
  await expect(dialog).toContainText('No se sumaron pagos posteriores.');
});

test('a concession explains the match result without inventing card wins or stones', async ({
  page,
}) => {
  const snapshot = finished();
  snapshot.state!.phase = 'match_over';
  snapshot.state!.winner = 1;
  snapshot.state!.lastHand = {
    ...recap(),
    reason: 'forfeit',
    winner: -1,
    matchWinner: 1,
    scoresBefore: [3, 5],
    scoresAfter: [3, 5],
    payouts: [],
  };
  await showTable(page, snapshot);
  await page.getByRole('button', { name: 'Ver resumen de la mano', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('La salida no añade piedras al marcador.');
  await expect(dialog).toContainText('Ganó la partida: Ellos.');
  await expect(dialog).not.toContainText('Ganó las cartas');
  await expect(dialog).toContainText('No se añadieron piedras en este cierre.');
  await expect(dialog.locator('.recap-payments')).toHaveCount(0);
});
