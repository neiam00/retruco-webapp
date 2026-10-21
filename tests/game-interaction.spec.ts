import { expect, test } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';
import type { Command } from '../src/lib/protocol.js';
import { expectClearTableCards } from './table-layout.js';

test('card hover keeps its hit area still, even after repeated pointer sweeps', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Touch devices do not have pointer hover.');
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
