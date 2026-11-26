import { expect, test, type Locator } from '@playwright/test';
import { showTable, tableSnapshot } from './fixtures/table.js';

const focusName = 'Enfocar al jugador que canta';

async function touchBounds(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.99 });
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(
    await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    }),
  ).toBe(true);
  return box;
}

for (const size of [
  { width: 1512, height: 786 },
  { width: 360, height: 740 },
  { width: 740, height: 360 },
]) {
  test(`room controls keep the score and vira clear at ${size.width}×${size.height}`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const desktop = size.width === 1512;
    const portrait = size.width === 360;
    test.skip(
      Boolean(testInfo.project.use.hasTouch) === desktop,
      'Runs with the matching input project.',
    );
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const snapshot = tableSnapshot(4, 1, !desktop && !portrait);
    snapshot.state!.seats.forEach((seat) => (seat.plays = []));
    if (desktop || portrait) {
      snapshot.state!.holding = { envido: 22, flor: 0, receta: false };
      snapshot.state!.pending = {
        kind: 'envido',
        caller: 1,
        value: 2,
        previous: 0,
        terminal: false,
      };
      snapshot.state!.legal = [
        { type: 'respond', kind: 'accept' },
        { type: 'respond', kind: 'decline' },
        { type: 'respond', kind: 'raise', amount: 2 },
      ];
    }
    await showTable(page, snapshot);

    const menu = page.getByRole('button', { name: 'Detalles de la partida', exact: true });
    const vira = page.getByRole('button', { name: 'La vira · 12 de copas', exact: true });
    const score = page.getByLabel('Marcador', { exact: true });
    const panel = page.getByRole('complementary', { name: 'Detalles de la partida', exact: true });
    const room = page.getByRole('button', {
      name: `Copiar código de la mesa ${snapshot.code}`,
      exact: true,
    });
    const focus = page.getByRole('switch', { name: focusName, exact: true });
    await expect(page.getByRole('application')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(menu).toHaveText('Detalles');
    const scoreBounds = (await score.boundingBox())!;
    const menuBounds = await touchBounds(menu);
    expect(scoreBounds.x + scoreBounds.width).toBeLessThan(menuBounds.x);
    if (portrait) {
      await expect(room).toHaveCount(0);
    } else {
      const roomBounds = await touchBounds(room);
      expect(scoreBounds.x + scoreBounds.width).toBeLessThan(roomBounds.x);
      expect(roomBounds.x + roomBounds.width).toBeLessThan(menuBounds.x);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('room-menu-closed.png') });

    async function copyCode() {
      await touchBounds(room);
      if (desktop) await room.click();
      else await room.tap();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(snapshot.code);
      await expect(page.getByText('Código copiado.', { exact: true })).toBeAttached();
    }

    if (desktop) {
      await copyCode();
      await menu.press('Enter');
    } else await menu.tap();
    await expect(panel).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('heading', { name: 'Vista y cámara' })).toBeVisible();
    const panelBounds = (await panel.boundingBox())!;
    const viraBounds = await touchBounds(vira);
    expect(viraBounds.y + viraBounds.height).toBeLessThan(panelBounds.y);
    expect(panelBounds.y + panelBounds.height).toBeLessThan(size.height);
    if (desktop) expect(panelBounds.height).toBeLessThan(560);
    if (portrait) {
      const hand = (await page
        .getByRole('region', { name: 'Tu mano', exact: true })
        .boundingBox())!;
      expect(panelBounds.y + panelBounds.height).toBeLessThan(hand.y);
    }
    await expect(focus).toBeChecked();
    await touchBounds(focus);
    await page.screenshot({ path: testInfo.outputPath('room-menu-open.png') });

    if (desktop || portrait) {
      if (portrait) await copyCode();
      const copyInvite = panel.getByRole('button', { name: 'Copiar enlace', exact: true });
      await copyInvite.click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(`${baseURL}/mesa/${snapshot.code}`);
      await expect(page.getByText('Invitación copiada.', { exact: true })).toBeAttached();
    }

    await focus.press('Space');
    await expect(focus).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(menu).toBeFocused();
    await menu.press('Space');
    await expect(focus).not.toBeChecked();
    if (desktop) await vira.click();
    else await vira.tap();
    await expect(panel).toHaveCount(0);
    await expect(vira).toHaveAttribute('aria-expanded', 'true');

    if (desktop) {
      await page.reload();
      await menu.click();
      await expect(focus).not.toBeChecked();
      const share = panel.getByRole('button', { name: 'Compartir invitación', exact: true });
      await share.click();
      const invite = page.getByRole('dialog', { name: 'Invitar a mis amigos', exact: true });
      await expect(invite).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(invite).toHaveCount(0);
      await expect(share).toBeFocused();
      await expect(panel.getByRole('region', { name: 'Voz de la mesa' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Jerarquía de las cartas' })).toBeVisible();
      await panel.getByText('Historial de cantos', { exact: true }).click();
      await expect(panel.getByRole('region', { name: 'Historial de cantos' })).toBeVisible();

      await page.unroute('**/api/**');
      await page.goto('/aprender');
      await expect(page.getByRole('application')).toBeVisible();
      await page.getByText('Vista y cámara', { exact: true }).click();
      await expect(focus).not.toBeChecked();
    }
  });
}
