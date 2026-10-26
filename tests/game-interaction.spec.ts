import { expect, test } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';
import type { Command } from '../src/lib/protocol.js';
import { expectClearTableCards } from './table-layout.js';

test('card hover labels show suit and value without exposing backs or blocking plays', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.legal = [{ type: 'play', card: 1 }];
  const sent: Command[] = [];
  const update = await showTable(page, snapshot, (command) => sent.push(command));
  const label = page.getByRole('tooltip');
  const usedCard = page.locator('[data-hand-card="0"] img');
  await usedCard.hover();
  await expect(label).toHaveText('1 de espadas');
  const cardBounds = (await usedCard.boundingBox())!;
  const labelBounds = (await label.boundingBox())!;
  expect(labelBounds.y).toBeGreaterThanOrEqual(cardBounds.y);
  expect(labelBounds.y).toBeLessThan(cardBounds.y + cardBounds.height);
  expect(labelBounds.x + labelBounds.width).toBeGreaterThan(cardBounds.x);
  expect(labelBounds.x).toBeLessThan(cardBounds.x + cardBounds.width);
  await page.mouse.click(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2);
  expect(sent).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('card-hover-label.png') });
  await page.locator('.vira img').hover();
  await expect(label).toHaveText('12 de copas');
  await page.locator('[data-deck] img').hover();
  await expect(label).toHaveCount(0);
  await page.locator('[data-hand-card="1"] img').hover();
  await expect(label).toHaveText('2 de espadas');
  await page.locator('[data-hand-card="1"]').click();
  await expect.poll(() => sent).toEqual([{ type: 'play', card: 1, declaration: '' }]);
  const otherTurn = structuredClone(snapshot);
  otherTurn.state!.revision++;
  otherTurn.state!.turn = 1;
  otherTurn.state!.legal = [];
  update(otherTurn);
  const unavailable = page.locator('[data-hand-card="2"]');
  await expect(unavailable).toBeDisabled();
  await unavailable.locator('img').hover();
  await expect(label).toHaveText('3 de espadas');
  const unavailableBounds = (await unavailable.boundingBox())!;
  await page.mouse.click(
    unavailableBounds.x + unavailableBounds.width / 2,
    unavailableBounds.y + unavailableBounds.height / 2,
  );
  expect(sent).toHaveLength(1);
});

test('card hover labels can be disabled and the preference survives reload', async ({ page }) => {
  await showTable(page, tableSnapshot(4, 0, false));
  const setting = page.getByRole('checkbox', {
    name: 'Mostrar valor y palo al pasar el cursor',
    exact: true,
  });
  await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await page
    .getByRole('complementary', { name: 'Detalles de la partida' })
    .getByRole('button', { name: 'Cerrar detalles', exact: true })
    .click();
  await page.locator('.vira img').hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
  await expect(setting).not.toBeChecked();
  await setting.check();
  await page
    .getByRole('complementary', { name: 'Detalles de la partida' })
    .getByRole('button', { name: 'Cerrar detalles', exact: true })
    .click();
  await page.locator('.vira img').hover();
  await expect(page.getByRole('tooltip')).toHaveText('12 de copas');
});

for (const viewport of [
  { width: 2048, height: 1048 },
  { width: 1280, height: 650 },
  { width: 390, height: 664 },
  { width: 844, height: 390 },
]) {
  for (const players of [2, 4]) {
    for (const spectator of [false, true]) {
      test(`phase changes keep the table size at ${viewport.width}px with ${players} seats as ${spectator ? 'spectator' : 'player'}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(viewport);
        const playing = tableSnapshot(players, 0, spectator);
        playing.state!.round = 0;
        playing.state!.hand = tableSnapshot(players, 0, false).state!.hand;
        playing.state!.holding = { envido: 6, flor: 0, receta: false };
        playing.state!.legal = spectator ? [] : [{ type: 'play', card: 1 }];
        const cutting = structuredClone(playing);
        cutting.state!.phase = 'cutting';
        cutting.state!.hand = [];
        cutting.state!.holding = undefined;
        cutting.state!.vira = undefined;
        cutting.state!.legal = spectator ? [] : [{ type: 'cut', cut: 20 }];
        const update = await showTable(page, cutting);
        await expect(page.locator('.table-status')).toContainText('Antes de repartir');
        await page.evaluate(() => document.fonts.ready);
        const measure = () =>
          page.evaluate(() => {
            const table = document.querySelector('.felt-table')!.getBoundingClientRect();
            const avatar = document.querySelector('.seat-top .avatar')!.getBoundingClientRect();
            return {
              width: table.width,
              height: table.height,
              top: table.top,
              avatar: avatar.width,
            };
          });
        const original = await measure();
        const results = structuredClone(playing);
        results.state!.phase = 'hand_over';
        const nextCut = structuredClone(cutting);
        nextCut.state!.handNumber++;
        for (const [index, phase] of [playing, results, nextCut].entries()) {
          phase.state!.revision = cutting.state!.revision + index + 1;
          update(phase);
          await expect(page.locator('.table-status')).toContainText(
            phase.state!.phase === 'playing'
              ? '1.ª vuelta'
              : phase.state!.phase === 'hand_over'
                ? 'La próxima ya viene.'
                : 'Antes de repartir',
          );
          await expect
            .poll(async () => {
              const current = await measure();
              return Math.max(
                ...Object.keys(original).map((key) =>
                  Math.abs(
                    current[key as keyof typeof current] - original[key as keyof typeof original],
                  ),
                ),
              );
            })
            .toBeLessThan(1);
          if (phase.state!.phase === 'playing') {
            await expect(page.locator('[data-hand-card="2"] img')).toBeVisible();
            const availableWidth = await page
              .locator('.table-viewport')
              .evaluate((element) => element.clientWidth);
            expect((await measure()).width).toBeGreaterThan(availableWidth * 0.95);
            await expectClearTableCards(page);
            if (viewport.width === 1280 && players === 2 && !spectator) {
              await page.setViewportSize({ width: 1280, height: 900 });
              await expect
                .poll(async () => (await measure()).avatar)
                .toBeGreaterThan(original.avatar + 0.5);
              await page.setViewportSize(viewport);
              await expect
                .poll(async () => Math.abs((await measure()).avatar - original.avatar))
                .toBeLessThan(0.5);
            }
            await page.screenshot({ path: testInfo.outputPath('playing-size.png') });
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollHeight),
          ).toBeLessThanOrEqual(viewport.height);
        }
      });
    }
  }
}

for (const viewport of [
  { width: 393, height: 659 },
  { width: 1280, height: 800 },
  { width: 2498, height: 1524 },
]) {
  test(`canto replies and dialogs keep the table centered and stable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const snapshot = tableSnapshot(4, 0, false);
    snapshot.state!.holding = { envido: 27, flor: 0, receta: false };
    snapshot.state!.privando = [true, false];
    snapshot.state!.privoEnvido = [{ team: 0, value: 27 }];
    snapshot.state!.legal = [
      { type: 'call', kind: 'truco', amount: 3 },
      { type: 'stack', card: 1, top: 2 },
      { type: 'burn', card: 1 },
    ];
    const update = await showTable(page, snapshot);
    await expect(page.getByRole('button', { name: 'Truco', exact: true })).toBeEnabled();
    const tableCard = page.locator('[data-play-seat="1"] img').first();
    const initial = (await tableCard.boundingBox())!;
    const geometry = () =>
      page.evaluate(() => {
        const table = document.querySelector('.felt-table')!.getBoundingClientRect();
        const hand = document.querySelector('.hand-area')!.getBoundingClientRect();
        const center = (box: DOMRect) => box.left + box.width / 2;
        return {
          tableCenter: center(table),
          handCenter: center(hand),
          width: table.width,
          height: table.height,
          top: table.top,
        };
      });
    const original = await geometry();
    expect(Math.abs(original.tableCenter - original.handCenter)).toBeLessThan(1);
    expect(Math.abs(original.tableCenter - viewport.width / 2)).toBeLessThan(1);
    const replying = structuredClone(snapshot);
    replying.state!.revision++;
    replying.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
    replying.state!.legal = [
      { type: 'respond', kind: 'accept' },
      { type: 'respond', kind: 'decline' },
      { type: 'respond', kind: 'raise', amount: 6 },
    ];
    update(replying);
    await expect(page.getByRole('button', { name: 'Quiero', exact: true })).toBeEnabled();
    await expect
      .poll(async () => Math.abs((await tableCard.boundingBox())!.width - initial.width))
      .toBeLessThan(1);
    await page.getByRole('button', { name: 'Subir / otros', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect
      .poll(async () => Math.abs((await tableCard.boundingBox())!.width - initial.width))
      .toBeLessThan(1);
    const viewportMetrics = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scale: visualViewport?.scale ?? 1,
    }));
    expect(viewportMetrics.width).toBe(viewport.width);
    expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(viewportMetrics.scale).toBe(1);
    const tools = page.locator('.social-controls button');
    const boxes = await tools.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.x - boxes[0].x)).toBeLessThan(1);
      if (index) expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
    }
    await page.screenshot({ path: testInfo.outputPath('mobile-controls.png') });
    for (let dealer = 0; dealer < 4; dealer++) {
      const next = structuredClone(replying);
      next.state!.dealer = dealer;
      next.state!.revision += dealer + 1;
      next.events = [
        {
          id: 10 + dealer,
          hand: 1,
          event: { type: 'respond', seat: dealer, kind: 'raise', amount: 6, text: 'con_mi_flor' },
        },
      ];
      update(next);
      await expect(page.locator(`[data-seat="${dealer}"] .speech-bubble`)).toContainText(
        'Con mi flor',
      );
      await expect.poll(geometry).toEqual(original);
    }
    const finished = structuredClone(replying);
    finished.state!.phase = 'match_over';
    finished.state!.winner = 0;
    finished.state!.revision += 10;
    update(finished);
    await expect(page.locator('.table-status.results')).toBeVisible();
    await expect.poll(geometry).toEqual(original);
  });
}

test('Con mi flor blocks A ley until the declaration changes', async ({ page }) => {
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.round = 0;
  snapshot.state!.legal = ['', 'con_mi_flor'].flatMap((declaration) => [
    { type: 'call', kind: 'truco', amount: 3, declaration },
    { type: 'call', kind: 'envido', declaration },
    { type: 'call', kind: 'ley_envido', declaration },
  ]);
  const sent: Command[] = [];
  await showTable(page, snapshot, (command) => sent.push(command));
  await page.getByRole('button', { name: 'Decir…', exact: true }).click();
  await page.getByRole('button', { name: 'Con mi flor…', exact: true }).click();
  await page.getByRole('button', { name: 'Más cantos', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Con mi flor, a ley, envido', exact: true }),
  ).toBeDisabled();
  expect(sent).toEqual([]);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Con mi flor…', exact: true }).click();
  await page.getByRole('button', { name: 'Sin declaración', exact: true }).click();
  await page.getByRole('button', { name: 'Más cantos', exact: true }).click();
  await page.getByRole('button', { name: 'A ley, envido', exact: true }).click();
  await expect.poll(() => sent).toEqual([{ type: 'call', kind: 'ley_envido', declaration: '' }]);
});

for (const variant of [
  { name: 'older server', declarations: ['', 'con_mi_flor'] },
  {
    name: 'current server',
    declarations: ['', 'flor', 'presento_flor', 'flor_flor', 'con_mi_flor'],
  },
]) {
  test(`Flor keeps one A las flores no reply available from the ${variant.name}`, async ({
    page,
  }) => {
    const snapshot = tableSnapshot(4, 0, false);
    snapshot.state!.round = 0;
    snapshot.state!.florValid = true;
    snapshot.state!.holding = { envido: 33, flor: 38, receta: false };
    snapshot.state!.pending = { kind: 'envido', caller: 1, value: 2, previous: 1, terminal: false };
    snapshot.state!.legal = variant.declarations.map((declaration) => ({
      type: 'respond',
      kind: 'flowers_no',
      declaration,
    }));
    const sent: Command[] = [];
    await showTable(page, snapshot, (command) => sent.push(command));
    await page.getByRole('button', { name: 'Decir…', exact: true }).click();
    await page.getByRole('button', { name: 'Flor', exact: true }).click();
    const reply = page.getByRole('button', { name: 'A las flores no', exact: true });
    await expect(reply).toHaveCount(1);
    await expect(reply).toBeEnabled();
    await reply.click();
    await expect
      .poll(() => sent)
      .toEqual([{ type: 'respond', kind: 'flowers_no', declaration: '' }]);
  });
}

test('an incompatible update stops reconnecting and offers a working reload', async ({ page }) => {
  await page.clock.install();
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.version = 'future-version';
  let connections = 0;
  page.on('websocket', () => connections++);
  await showTable(page, snapshot);
  await expect(page.getByRole('alert')).toContainText('Actualiza la página');
  const reload = page.getByRole('button', { name: 'Actualizar juego', exact: true });
  await expect(reload).toBeVisible();
  await page.clock.fastForward(6500);
  expect(connections).toBe(1);
  snapshot.state!.version = '1';
  await reload.click();
  await expect(page.locator('.felt-table')).toBeVisible();
  await expect(reload).toHaveCount(0);
});

test('deployment notice survives downtime and clears after automatic reconnection', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const initial = tableSnapshot(4, 0, false);
  initial.state!.legal = [
    { type: 'play', card: 1 },
    { type: 'call', kind: 'truco', amount: 3 },
  ];
  const update = await showTable(page, initial);
  const card = page.locator('[data-hand-card="1"]');
  await expect(card).toBeEnabled();
  const paused = structuredClone(initial);
  paused.updating = true;
  paused.state!.legal = [];
  update(paused);
  const notice = page.getByRole('status').filter({ hasText: 'Estamos actualizando el juego.' });
  await expect(notice).toContainText('Te reconectaremos automáticamente');
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(card).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Partida en pausa' })).toBeVisible();
  await expect(page.getByLabel(/segundos restantes/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('deployment-notice.png') });
  let unavailable = true;
  let attempts = 0;
  await page.routeWebSocket(`**/api/matches/${initial.code}/ws?transport=2`, async (socket) => {
    attempts++;
    if (unavailable) {
      socket.send(JSON.stringify({ type: 'error', status: 503, error: 'Deployment maintenance' }));
      await socket.close();
    } else socket.send(JSON.stringify({ type: 'snapshot', data: paused }));
  });
  await update.disconnect();
  await page.clock.fastForward(2500);
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(notice).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  unavailable = false;
  paused.updating = false;
  paused.state!.legal = initial.state!.legal;
  await page.clock.fastForward(2500);
  await expect(notice).toHaveCount(0);
  await expect(card).toBeEnabled();
  await expect(page.locator('.felt-table')).toBeVisible();
});

test('card hover keeps its hit area still, even after repeated pointer sweeps', async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, 'Touch devices do not have pointer hover.');
  await showTable(page, tableSnapshot(2, 0, false));
  const card = page.locator('[data-hand-card="1"]');
  await expect(card).toBeEnabled();
  await card.scrollIntoViewIfNeeded();
  const original = (await card.boundingBox())!;
  for (let sweep = 0; sweep < 12; sweep++) {
    await page.mouse.move(original.x + original.width / 2, original.y + original.height - 6);
    await page.mouse.move(original.x + original.width + 60, original.y + original.height + 12);
  }
  await page.mouse.move(original.x + original.width / 2, original.y + original.height - 6);
  await expect.poll(() => card.evaluate((element) => element.matches(':hover'))).toBe(true);
  await page.waitForTimeout(250);
  const hovered = (await card.boundingBox())!;
  expect(Math.abs(hovered.y - original.y)).toBeLessThan(1);
  expect(Math.abs(hovered.height - original.height)).toBeLessThan(1);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  expect(await card.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);

  const button = page.getByRole('button', { name: 'Decir…', exact: true });
  await button.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  expect(await button.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test('a played card lands at the scaled tabletop card size and position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  const snapshot = tableSnapshot(4, 0, false);
  const update = await showTable(page, snapshot);
  await expect(page.locator('[data-hand-card="1"]')).toBeEnabled();
  const next = structuredClone(snapshot);
  const state = next.state!;
  state.revision++;
  state.turn = 1;
  state.hand[1].used = true;
  state.seats[0].remaining--;
  state.seats[0].plays.push({
    card: state.hand[1].card,
    present: true,
    burned: false,
    concealed: false,
  });
  next.events!.push({ id: 5, hand: 1, event: { type: 'play', seat: 0 } });
  update(next);
  const flight = page.locator('[data-card-flight="play"]');
  await expect(flight).toHaveCount(1);
  const difference = await flight.evaluate(async (card) => {
    const animation = card.getAnimations()[0];
    animation.pause();
    animation.currentTime = Number(animation.effect!.getTiming().duration) - 1;
    const targetCard = document.querySelector('[data-play-seat="0"][data-play-round="1"] img')!;
    await Promise.all(targetCard.getAnimations().map((flip) => flip.finished));
    const bounds = card.getBoundingClientRect();
    const target = targetCard.getBoundingClientRect();
    const difference = Math.max(
      Math.abs(bounds.width - target.width),
      Math.abs(bounds.height - target.height),
      Math.abs(bounds.left - target.left),
      Math.abs(bounds.top - target.top),
    );
    animation.finish();
    return difference;
  });
  expect(difference).toBeLessThan(2);
});

for (const type of ['play', 'stack', 'burn']) {
  test(`${type} clears only that player's canto bubble and preserves history`, async ({ page }) => {
    const snapshot = tableSnapshot(4, 0, false);
    snapshot.cantoHistory = structuredClone(snapshot.events);
    const update = await showTable(page, snapshot);
    const bubble = page.locator('[data-seat="1"] .speech-bubble');
    await expect(bubble).toHaveText('No quiero');
    const next = structuredClone(snapshot);
    next.state!.revision++;
    next.sequence++;
    next.events!.push({ id: 5, hand: 1, event: { type, seat: 1 } });
    update(next);
    await expect(bubble).toHaveCount(0);
    await expect(page.locator('[data-seat="2"] .speech-bubble')).toHaveText('No quiero');
    await expect(page.locator('.canto-history')).toContainText('No quiero');
  });
}

test('secondary raises remain reachable and send the selected command', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
  snapshot.state!.legal = [
    { type: 'respond', kind: 'accept' },
    { type: 'respond', kind: 'decline' },
    { type: 'respond', kind: 'raise', amount: 6 },
  ];
  const sent: Command[] = [];
  await showTable(page, snapshot, (command) => sent.push(command));
  await page.getByRole('button', { name: 'Subir / otros', exact: true }).click();
  await page.getByRole('button', { name: 'Quiero y retruco', exact: true }).click();
  await expect.poll(() => sent).toEqual([{ type: 'respond', kind: 'raise', amount: 6 }]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Historial de cantos' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Historial de cantos' })).toHaveCount(0);
});

test('ley acceptance and Sin ley refusal options remain primary replies', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.pending = {
    kind: 'ley_envido',
    caller: 1,
    value: 2,
    previous: 1,
    terminal: false,
  };
  snapshot.state!.legal = [
    { type: 'respond', kind: 'accept', mode: 'con_ley' },
    { type: 'respond', kind: 'accept', mode: 'sin_ley' },
    { type: 'respond', kind: 'decline' },
    { type: 'respond', kind: 'decline', mode: 'sin_ley' },
  ];
  await showTable(page, snapshot);
  for (const name of ['Con ley, quiero', 'Sin ley, quiero', 'No quiero', 'Sin ley, no quiero']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 664 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1194, height: 400 },
  { width: 1280, height: 650 },
  { width: 1440, height: 900 },
]) {
  test(`table, hand and replies fit within ${viewport.width}×${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const snapshot = tableSnapshot(4, 0, false);
    snapshot.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
    snapshot.state!.legal = [
      { type: 'respond', kind: 'accept' },
      { type: 'respond', kind: 'decline' },
      ...[6, 9, 100].map((amount) => ({ type: 'respond', kind: 'raise', amount })),
      { type: 'call', kind: 'envido' },
      { type: 'call', kind: 'ley_envido' },
    ];
    const update = await showTable(page, snapshot);
    await expect(page.getByRole('button', { name: 'Quiero', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const selectors = ['.table-area', '.hand-cards', '.canto-actions', '.social-controls'];
          return selectors.filter((selector) => {
            const box = document.querySelector(selector)!.getBoundingClientRect();
            return (
              box.top < 0 ||
              box.left < 0 ||
              box.right > innerWidth + 1 ||
              box.bottom > innerHeight + 1
            );
          });
        }),
      )
      .toEqual([]);
    await expect(page.getByRole('button', { name: 'Quiero', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByRole('button', { name: 'No quiero', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expectClearTableCards(page);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );
    await page.screenshot({ path: testInfo.outputPath('viewport.png') });
    const playing = structuredClone(snapshot);
    playing.state!.pending = undefined;
    playing.state!.revision++;
    playing.state!.legal = [
      { type: 'call', kind: 'truco', amount: 3 },
      { type: 'stack', card: 1, top: 2 },
      { type: 'burn', card: 1 },
    ];
    update(playing);
    await page.getByRole('button', { name: 'Jugar pegado', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Jugar las dos', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByRole('button', { name: 'Truco', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expectClearTableCards(page);
  });
}

for (const viewport of [
  { width: 568, height: 320 },
  { width: 844, height: 390 },
  { width: 1194, height: 400 },
]) {
  test(`chat and details stay reachable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await showTable(page, tableSnapshot(4, 0, false));
    await page.getByRole('button', { name: 'Abrir chat', exact: true }).click();
    await expect(page.locator('.chat-panel')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Enviar mensaje', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.getByRole('button', { name: 'Detalles de la partida', exact: true }).click();
    await expect(page.locator('.match-details')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );
  });
}

for (const viewport of [
  { width: 1132, height: 786 },
  { width: 390, height: 664 },
  { width: 568, height: 320 },
]) {
  for (const players of [2, 4]) {
    test(`cutting controls stay inside their panel at ${viewport.width}px with ${players} seats`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const snapshot = tableSnapshot(players, 0, false);
      snapshot.state!.phase = 'cutting';
      snapshot.state!.hand = [];
      snapshot.state!.vira = undefined;
      snapshot.state!.seats.forEach((seat) => (seat.plays = []));
      snapshot.state!.legal = Array.from({ length: 39 }, (_, index) => ({
        type: 'cut',
        cut: index + 1,
      }));
      const sent: Command[] = [];
      await showTable(page, snapshot, (command) => sent.push(command));
      const panel = page.locator('.table-status');
      const input = page.getByRole('spinbutton', { name: 'Punto de corte (1–39)' });
      const submit = page.getByRole('button', { name: 'Partir el mazo', exact: true });
      await expect(submit).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: testInfo.outputPath('cutting-panel.png') });
      await expect(panel).toBeInViewport({ ratio: 1 });
      const bounds = (await panel.boundingBox())!;
      for (const control of [input, submit]) {
        // WebKit rounds native number-input intersections by a fraction of a pixel.
        await expect(control).toBeInViewport({ ratio: 0.999 });
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
      const description = (await panel
        .getByText('Elige dónde cortar las 40 cartas.')
        .boundingBox())!;
      expect((await input.boundingBox())!.y).toBeGreaterThan(description.y + description.height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );
      await input.fill('13');
      await submit.click();
      await expect.poll(() => sent).toEqual([{ type: 'cut', cut: 13 }]);
    });
  }
}

test('landscape cutting and spectator controls fit without page scrolling', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 568, height: 320 });
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.phase = 'cutting';
  snapshot.state!.legal = [{ type: 'cut', cut: 20 }];
  const update = await showTable(page, snapshot);
  await expect(page.getByRole('button', { name: 'Partir el mazo', exact: true })).toBeInViewport({
    ratio: 1,
  });
  const spectator = tableSnapshot(4, 0, true);
  spectator.state!.revision++;
  update(spectator);
  await expect(page.locator('.spectator-bar')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.table-viewport')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('spectator-landscape.png') });
});
