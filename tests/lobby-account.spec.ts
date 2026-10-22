import { expect, test } from '@playwright/test';

test('public browsing, spectator switching, account history and private code joining work together', async ({
  browser,
}, testInfo) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({ viewport: testInfo.project.use.viewport }),
    ),
  );
  const [owner, guest, spectator, returning] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const username = `panas_${Date.now().toString(36)}`;
  const password = `local-test-${Date.now()}`;

  try {
    await owner.goto('/');
    await owner.getByRole('button', { name: 'Crea una cuenta', exact: true }).click();
    await owner.getByLabel('Usuario', { exact: true }).fill(username);
    await owner.getByLabel('Contraseña', { exact: true }).fill(password);
    await owner.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click();
    await expect(owner.getByRole('dialog')).not.toBeVisible();
    await owner.getByRole('button', { name: '1 vs 1', exact: true }).click();
    await owner.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
    await expect(owner).toHaveURL(/\/mesa\/[A-Z]{4}-[0-9]{4}$/);
    const publicCode = owner.url().split('/').at(-1)!;

    await guest.goto('/');
    await guest.getByLabel('Tu nombre en la mesa').fill('Beto público');
    const publicTable = guest.getByRole('article').filter({ hasText: `Mesa de ${username}` });
    await expect(publicTable).toBeVisible();
    await publicTable.getByRole('button', { name: 'Sentarme', exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/mesa/${publicCode}$`));
    await guest.getByRole('button', { name: 'Elegir puesto 2, equipo 2' }).click();
    await expect(guest.getByText('En línea', { exact: true })).toBeVisible();

    await spectator.goto('/');
    await spectator.getByLabel('Tu nombre en la mesa').fill('Observador');
    await spectator.getByRole('button', { name: `Mirar mesa de ${username}`, exact: true }).click();
    await expect(spectator.getByText('Estás mirando', { exact: true })).toBeVisible();

    const cut = { name: 'Partir el mazo', exact: true };
    const cutter = (await owner.getByRole('button', cut).isVisible()) ? owner : guest;
    await cutter.getByRole('button', cut).click();
    await expect(owner.locator('.hand-card')).toHaveCount(3);
    await expect(guest.locator('.hand-card')).toHaveCount(3);
    await expect(spectator.locator('.hand-card')).toHaveCount(3);
    const cardNames = async (page: typeof owner) =>
      page
        .locator('.hand-card')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
    await expect.poll(() => cardNames(spectator)).toEqual(await cardNames(owner));
    await spectator
      .locator('.spectator-bar')
      .getByRole('button', { name: 'Beto público', exact: true })
      .click();
    await expect.poll(() => cardNames(spectator)).toEqual(await cardNames(guest));
    await expect(spectator.locator('.hand-card:not(:disabled)')).toHaveCount(0);

    await owner.getByRole('button', { name: 'Salir de la mesa', exact: true }).click();
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: 'Salir de la mesa', exact: true })
      .click();
    await expect(owner).toHaveURL('/');
    await owner.getByRole('button', { name: 'Mi historial', exact: true }).click();
    await expect(owner.getByRole('dialog')).toContainText(publicCode);
    await expect(owner.getByRole('dialog')).toContainText('Terminada');
    await expect(owner.getByRole('dialog')).toContainText('Jugaste en el equipo 1 · Nosotros');
    await expect(owner.getByRole('dialog')).toContainText('Ganador: Ellos · Equipo 2');
    await expect(owner.getByRole('dialog')).toContainText('Beto público');
    await owner.keyboard.press('Escape');

    // A fresh browser context has no session cookie from the account creation.
    await returning.goto('/');
    await returning
      .getByRole('navigation')
      .getByRole('button', { name: 'Entrar', exact: true })
      .click();
    await returning.getByLabel('Usuario', { exact: true }).fill(username);
    await returning.getByLabel('Contraseña', { exact: true }).fill(password);
    await returning
      .getByRole('dialog')
      .getByRole('button', { name: 'Entrar', exact: true })
      .click();
    await expect(returning.getByRole('dialog')).not.toBeVisible();
    await returning.getByRole('button', { name: 'Mi historial', exact: true }).click();
    await expect(returning.getByRole('dialog')).toContainText(publicCode);

    await owner.getByText('Opciones de mesa', { exact: true }).click();
    await owner.getByRole('button', { name: 'Cambiar', exact: true }).click();
    await owner.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
    await expect(owner).toHaveURL(/\/mesa\/[A-Z]{4}-[0-9]{4}$/);
    const privateCode = owner.url().split('/').at(-1)!;
    await guest.goto('/');
    await expect(guest.getByRole('article').filter({ hasText: `Mesa de ${username}` })).toHaveCount(
      0,
    );
    await guest
      .getByLabel('Código de la mesa', { exact: true })
      .pressSequentially(privateCode.replace('-', '').toLowerCase());
    await expect(guest.getByLabel('Código de la mesa', { exact: true })).toHaveValue(privateCode);
    await guest.locator('.join-form').getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/mesa/${privateCode}$`));
    await guest.getByRole('button', { name: 'Elegir puesto 2, equipo 2' }).click();
    await expect(guest.getByText('En línea', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
