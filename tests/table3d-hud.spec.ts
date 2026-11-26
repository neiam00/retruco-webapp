import { expect, test, type Locator, type Page } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const hand = (page: Page) => page.getByRole('region', { name: 'Tu mano', exact: true });

async function expectTouchable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.99 });
  const target = await control.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return {
      width,
      height,
      hit: element.contains(document.elementFromPoint(x + width / 2, y + height / 2)),
    };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  if (await control.isEnabled()) expect(target.hit).toBe(true);
}

async function expectDockCentered(page: Page, actions: string[]) {
  const viewportCenter = page.viewportSize()!.width / 2;
  const dock = (await hand(page).boundingBox())!;
  expect(Math.abs(dock.x + dock.width / 2 - viewportCenter)).toBeLessThan(1);
  for (const name of ['Tus cartas', '35 de envido']) {
    const center = await hand(page)
      .getByText(name, { exact: true })
      .evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        const { x, width } = text.getBoundingClientRect();
        return x + width / 2;
      });
    expect(Math.abs(center - viewportCenter), `${name} center offset`).toBeLessThan(1);
  }

  const rows = new Map<number, { left: number; right: number }>();
  for (const name of actions) {
    const action = button(page, name);
    const box = (await action.boundingBox())!;
    const y = Math.round(box.y);
    const row = rows.get(y) ?? { left: box.x, right: box.x + box.width };
    rows.set(y, { left: Math.min(row.left, box.x), right: Math.max(row.right, box.x + box.width) });
    await expectTouchable(action);
  }
  for (const { left, right } of rows.values())
    expect(Math.abs((left + right) / 2 - viewportCenter)).toBeLessThan(1);

  const camera = (await page.getByRole('group', { name: 'Controles de la vista' }).boundingBox())!;
  const social = (await page
    .getByRole('group', { name: 'Herramientas de la partida' })
    .boundingBox())!;
  expect(camera.x + camera.width).toBeLessThan(dock.x);
  expect(dock.x + dock.width).toBeLessThan(social.x);
  for (const name of ['Ver mano', 'Decir…', 'Mirar las cartas', 'Abrir chat'])
    await expectTouchable(button(page, name));
  const inspect = (await button(page, 'Ver mano').boundingBox())!;
  const declare = (await button(page, 'Decir…').boundingBox())!;
  if (page.viewportSize()!.width < 740)
    expect(Math.abs((inspect.x + declare.x + declare.width) / 2 - viewportCenter)).toBeLessThan(1);
  else expect(inspect.x).toBeGreaterThan(viewportCenter);
  const online = (await page.getByText('En línea', { exact: true }).boundingBox())!;
  if (online.x + online.width >= dock.x) expect(online.y + online.height).toBeLessThan(dock.y);
}

for (const size of [
  { width: 945, height: 656 },
  { width: 360, height: 740 },
  { width: 740, height: 360 },
]) {
  test(`the 3D hand dock centers its label and actions at ${size.width}×${size.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      Boolean(testInfo.project.use.hasTouch) !== size.width < 900,
      'This viewport runs in its matching input project.',
    );
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
    const snapshot = tableSnapshot(4, 1, false);
    snapshot.state!.holding = { envido: 35, flor: 0, receta: false };
    snapshot.state!.legal = [
      { type: 'call', kind: 'truco', amount: 3 },
      { type: 'call', kind: 'envido' },
      { type: 'call', kind: 'ley_envido' },
    ];
    const update = await showTable(page, snapshot);
    await expect(button(page, 'Mirar las cartas')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('hand-dock.png') });
    await expectDockCentered(page, ['Truco', 'Envido', 'Más cantos']);

    const playing = structuredClone(snapshot);
    playing.state!.revision++;
    playing.state!.preview = { suit: 'clubs', number: 12 };
    playing.state!.legal.push({ type: 'stack', card: 1, top: 2 }, { type: 'burn', card: 1 });
    update(playing);
    await expect(button(page, 'Jugar pegado')).toBeVisible();
    await expectDockCentered(page, [
      'Jugar pegado',
      'Quemar carta',
      'Truco',
      'Envido',
      'Más cantos',
    ]);
    if (size.width >= 740) {
      const burn = (await button(page, 'Quemar carta').boundingBox())!;
      const truco = (await button(page, 'Truco').boundingBox())!;
      expect(Math.abs(burn.y - truco.y)).toBeLessThan(1);
    }
    await button(page, 'Jugar pegado').click();
    await expect(hand(page).getByRole('status')).toHaveText(
      'Primero elige abajo; después, arriba.',
    );
    await expectDockCentered(page, [
      'Jugando pegado',
      'Quemar carta',
      'Jugar las dos',
      'Truco',
      'Envido',
      'Más cantos',
    ]);
    await button(page, 'Quemar carta').click();
    await expect(hand(page).getByRole('status')).toHaveText(
      'Elige una carta para quemarla y pasar el turno.',
    );
    await expectDockCentered(page, [
      'Jugar pegado',
      'Cancelar quemado',
      'Truco',
      'Envido',
      'Más cantos',
    ]);

    const bidding = structuredClone(playing);
    bidding.state!.revision++;
    bidding.state!.pending = { kind: 'truco', caller: 1, value: 3, previous: 1, terminal: false };
    bidding.state!.legal = [
      { type: 'respond', kind: 'accept' },
      { type: 'respond', kind: 'decline' },
      { type: 'respond', kind: 'raise', amount: 6 },
    ];
    bidding.events!.push({
      id: 5,
      hand: 1,
      event: { type: 'call', seat: 1, kind: 'truco', amount: 3 },
    });
    update(bidding);
    await expect(button(page, 'Quiero')).toBeVisible();
    const caption = page.getByRole('application').getByRole('status');
    await expect(caption).toHaveText('CPU 1 Truco');
    const cue = (await caption.boundingBox())!;
    expect(cue.y + cue.height).toBeLessThan((await hand(page).boundingBox())!.y);
    await expectDockCentered(page, ['Quiero', 'No quiero', 'Subir / otros']);
  });
}

test('the 3D card readout shows public faces and follows the hand and spectator seat', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.use.hasTouch,
    'The mobile view exercises card HUD space beside other controls.',
  );
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
  const snapshot = tableSnapshot(4, 1, false);
  const played = (name: string) => page.getByRole('list', { name, exact: true });
  const own = played('Tus cartas jugadas');
  snapshot.state!.seats[0].plays = [];
  const update = await showTable(page, snapshot);
  const vira = button(page, 'La vira · 12 de copas');
  await expectTouchable(vira);
  await expect(vira.locator('img')).toHaveAttribute('src', /card_cups_12-.*\.webp$/);
  await expect
    .poll(() =>
      vira
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(own).toHaveCount(0);

  const firstPlay = structuredClone(snapshot);
  firstPlay.state!.revision++;
  firstPlay.state!.seats[0].plays = [
    { present: true, burned: false, concealed: false, card: { suit: 'coins', number: 7 } },
  ];
  update(firstPlay);
  await expect(own.getByRole('listitem')).toHaveText(/1\.ª\s*7 de oros/);
  await expect(own.locator('img')).toHaveAttribute('src', /card_coins_07-.*\.webp$/);

  const hidden = structuredClone(firstPlay);
  hidden.state!.revision++;
  hidden.state!.seats[0].plays.push(
    { present: true, burned: true, concealed: false },
    { present: true, burned: false, concealed: true },
  );
  hidden.state!.hand.forEach((card) => (card.used = true));
  update(hidden);
  const items = own.getByRole('listitem');
  await expect(items).toHaveText([/1\.ª\s*7 de oros/, /2\.ª\s*Quemada/, /3\.ª\s*Tapada/]);
  for (const index of [1, 2])
    await expect(items.nth(index).locator('img')).toHaveAttribute('src', /card_back-.*\.webp$/);
  const scene = page.getByRole('application');
  for (let i = 0; i < 7; i++) await scene.press('ArrowUp');
  await expect(own).toBeInViewport({ ratio: 1 });
  await expectTouchable(vira);
  await page.screenshot({ path: testInfo.outputPath('visible-played-cards.png') });
  await vira.tap();
  await expect(vira).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('img', { name: 'La vira: 12 de copas' })).toBeVisible();
  await expect(items).toHaveText([/1\.ª\s*7 de oros/, /2\.ª\s*Quemada/, /3\.ª\s*Tapada/]);

  const sameHand = structuredClone(hidden);
  sameHand.state!.revision++;
  sameHand.state!.scores = [3, 6];
  update(sameHand);
  await expect(page.getByLabel('Marcador', { exact: true })).toContainText('6');
  await expect(vira).toHaveAttribute('aria-expanded', 'true');

  const spectator = structuredClone(hidden);
  spectator.state!.revision += 2;
  spectator.seat = -1;
  spectator.perspective = 2;
  spectator.seats[2].name = 'Una jugadora con nombre';
  spectator.state!.seats[2].plays = structuredClone(hidden.state!.seats[0].plays);
  spectator.state!.seats[2].plays[0].card = { suit: 'clubs', number: 3 };
  update(spectator);
  await expect(vira).toHaveAttribute('aria-expanded', 'false');
  await expect(own).toHaveCount(0);
  const watched = played('Cartas jugadas de Una jugadora con nombre');
  await expect(watched.getByRole('listitem').first()).toHaveText(/1\.ª\s*3 de bastos/);
  const seatPicker = page.getByRole('combobox', { name: 'Estás mirando desde el puesto de' });
  await expectTouchable(seatPicker);
  await vira.tap();
  await expect(vira).toHaveAttribute('aria-expanded', 'true');
  await expectTouchable(seatPicker);

  const fresh = structuredClone(spectator);
  fresh.state!.revision++;
  fresh.state!.handNumber++;
  fresh.state!.phase = 'cutting';
  fresh.state!.vira = undefined;
  fresh.state!.seats.forEach((seat) => (seat.plays = []));
  update(fresh);
  await expect(watched).toHaveCount(0);
  await expect(vira).toHaveCount(0);
  fresh.state!.revision++;
  fresh.state!.phase = 'playing';
  fresh.state!.vira = { suit: 'cups', number: 5 };
  update(fresh);
  const newVira = button(page, 'La vira · 5 de copas');
  await expect(newVira).toHaveAttribute('aria-expanded', 'false');
  await expect(newVira.locator('img')).toHaveAttribute('src', /card_cups_05-.*\.webp$/);
  await expect(watched).toHaveCount(0);
});
