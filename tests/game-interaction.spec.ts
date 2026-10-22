import { expect, test } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';
import type { Command } from '../src/lib/protocol.js';
import { expectClearTableCards } from './table-layout.js';

test('canto replies and dialogs keep the mobile table scale stable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 659 });
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.holding = { envido: 27, flor: 0, receta: false };
  snapshot.state!.legal = [
    { type: 'call', kind: 'truco', amount: 3 },
    { type: 'stack', card: 1, top: 2 },
    { type: 'burn', card: 1 },
  ];
  const update = await showTable(page, snapshot);
  await expect(page.getByRole('button', { name: 'Truco', exact: true })).toBeEnabled();
  const tableCard = page.locator('[data-play-seat="1"] img').first();
  const initial = (await tableCard.boundingBox())!;
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
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    scale: visualViewport?.scale ?? 1,
  }));
  expect(viewport.width).toBe(393);
  expect(viewport.documentWidth).toBeLessThanOrEqual(393);
  expect(viewport.scale).toBe(1);
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
});

test('Con mi flor disables ley calls only until the declaration changes', async ({ page }) => {
  const snapshot = tableSnapshot(4, 0, false);
  snapshot.state!.round = 0;
  snapshot.state!.legal = ['', 'con_mi_flor'].flatMap((declaration) => [
    { type: 'call', kind: 'truco', amount: 3, declaration },
    { type: 'call', kind: 'envido', declaration },
    { type: 'call', kind: 'ley_envido', declaration },
  ]);
  await showTable(page, snapshot);
  await page.getByRole('button', { name: 'Decir…', exact: true }).click();
  await page.getByRole('button', { name: 'Con mi flor…', exact: true }).click();
  await page.getByRole('button', { name: 'Más cantos', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Con mi flor, a ley, envido', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Con mi flor…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'A ley', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sin declaración', exact: true }).click();
  await page.getByRole('button', { name: 'Más cantos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'A ley, envido', exact: true })).toBeEnabled();
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

test('both ley acceptance options remain primary replies', async ({ page }) => {
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
  ];
  await showTable(page, snapshot);
  for (const name of ['Con ley, quiero', 'Sin ley, quiero', 'No quiero']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 664 },
  { width: 844, height: 390 },
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
