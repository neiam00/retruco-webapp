import { expect, test, type Page } from '@playwright/test';

const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
const profilePath = '/api/profile/appearance';

async function openWardrobe(page: Page) {
  await page.getByRole('button', { name: 'Mi personaje', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mi personaje', exact: true });
  await expect(dialog.getByLabel('Modelo', { exact: true })).toBeEnabled();
  return dialog;
}

test('a guest can identify and save a wardrobe without WebGL and recover it after reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, kind: string, options?: unknown) {
        return kind.includes('webgl') ? null : Reflect.apply(real, this, [kind, options]);
      },
    });
  });
  await page.goto('/');
  const name = page.getByLabel('Tu nombre en la mesa', { exact: true });
  await page.getByRole('button', { name: 'Mi personaje', exact: true }).click();
  await expect(name).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Mi personaje' })).toHaveCount(0);
  await name.fill('Invitada vestuario');
  const dialog = await openWardrobe(page);
  await expect(dialog.getByText('La vista 3D no está disponible.', { exact: true })).toBeVisible();
  const choices = [
    ['Modelo', '3'],
    ['Peinado', '4'],
    ['Sombrero', '2'],
    ['Gafas', '1'],
    ['Tono de piel', '5'],
    ['Camisa', '6'],
  ];
  for (const [label, value] of choices)
    await dialog.getByLabel(label, { exact: true }).selectOption(value);
  await dialog.getByRole('button', { name: 'Guardar personaje', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Personaje guardado.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(name).toHaveCount(0);
  const reopened = await openWardrobe(page);
  for (const [label, value] of choices)
    await expect(reopened.getByLabel(label, { exact: true })).toHaveValue(value);
});

test('a visitor can save before claiming the last seat and a delayed host save cannot edit a started match', async ({
  browser,
  page: host,
  baseURL,
}, testInfo) => {
  const visitorContext = await browser.newContext({
    viewport: testInfo.project.use.viewport,
    baseURL,
  });
  const headers = { Origin: baseURL! };
  const waitForSave = Promise.withResolvers<void>();
  const releaseSave = Promise.withResolvers<void>();
  try {
    const visitor = await visitorContext.newPage();
    for (const [page, name] of [
      [host, 'Dueña vestuario'],
      [visitor, 'Visitante vestuario'],
    ] as const) {
      await page.addInitScript(() => localStorage.setItem('retruco.table.mode', '3d'));
      const response = await page.request.post(`${api}/api/guest`, { headers, data: { name } });
      expect(response.ok()).toBe(true);
    }
    const creation = await host.request.post(`${api}/api/matches`, {
      headers,
      data: { private: true, config: { players: 2, target: 12, florRequired: false } },
    });
    expect(creation.ok()).toBe(true);
    const { code } = (await creation.json()) as { code: string };
    await Promise.all([host.goto(`/mesa/${code}`), visitor.goto(`/mesa/${code}`)]);
    const hostCharacters = host.getByRole('region', { name: 'Personajes de la mesa' });
    const visitorCharacters = visitor.getByRole('region', { name: 'Personajes de la mesa' });
    const hostPreview = hostCharacters.getByRole('img', { name: 'Vista 3D de Dueña vestuario' });
    const visitorPreview = visitorCharacters.getByRole('img', {
      name: 'Vista 3D de Dueña vestuario',
    });
    await expect(hostPreview).toBeVisible();
    await expect(visitorPreview).toBeVisible();
    const originalPreview = await visitorPreview.screenshot();

    const ownerDialog = await openWardrobe(host);
    await expect(hostCharacters.locator('canvas')).toHaveCount(0);
    await ownerDialog.getByLabel('Modelo', { exact: true }).selectOption('2');
    await ownerDialog.getByLabel('Camisa', { exact: true }).selectOption('6');
    await ownerDialog.getByRole('button', { name: 'Guardar personaje', exact: true }).click();
    await expect(ownerDialog).toHaveCount(0);
    await expect(hostPreview).toBeVisible();
    const visibleAppearance = visitorCharacters.getByLabel('Apariencia de Dueña vestuario');
    await expect(visibleAppearance).toContainText('Modelo 3');
    await expect(visibleAppearance).toContainText('Malva');
    await expect
      .poll(async () => (await visitorPreview.screenshot()).equals(originalPreview))
      .toBe(false);
    await visitorCharacters.screenshot({ path: testInfo.outputPath('personajes-en-la-mesa.png') });

    const visitorDialog = await openWardrobe(visitor);
    await visitorDialog.getByLabel('Sombrero', { exact: true }).selectOption('3');
    await visitorDialog.getByRole('button', { name: 'Guardar personaje', exact: true }).click();
    await expect(visitorDialog).toHaveCount(0);
    const lastSeat = visitor.getByRole('button', {
      name: 'Elegir puesto 2, equipo 2',
      exact: true,
    });
    await expect(lastSeat).toBeVisible();

    await host.route(`**${profilePath}`, async (route) => {
      if (route.request().method() === 'POST') {
        waitForSave.resolve();
        await releaseSave.promise;
      }
      await route.continue();
    });
    const delayedDialog = await openWardrobe(host);
    await delayedDialog.getByLabel('Modelo', { exact: true }).selectOption('1');
    const response = host.waitForResponse(
      (reply) => reply.url().endsWith(profilePath) && reply.request().method() === 'POST',
    );
    await delayedDialog.getByRole('button', { name: 'Guardar personaje', exact: true }).click();
    await waitForSave.promise;
    const joined = visitor.waitForResponse((reply) =>
      reply.url().endsWith(`/api/matches/${code}/join`),
    );
    await lastSeat.click();
    expect((await joined).ok()).toBe(true);
    const snapshot = await visitor.request.get(`${api}/api/matches/${code}`, { headers });
    expect(snapshot.ok()).toBe(true);
    const match = await snapshot.json();
    expect(match.state).toBeTruthy();
    expect(match.seats[0].appearance.base).toBe(2);
    expect(match.seats[1].appearance.hat).toBe(3);
    releaseSave.resolve();
    expect((await response).status()).toBe(409);
    const saved = await host.request.get(`${api}${profilePath}`, { headers });
    expect(await saved.json()).toMatchObject({ appearance: { base: 2 } });
    await expect(host.getByRole('button', { name: 'Mi personaje', exact: true })).toHaveCount(0);
    await expect(hostCharacters).toHaveCount(0);
    await expect(visitorCharacters).toHaveCount(0);
  } finally {
    releaseSave.resolve();
    await visitorContext.close();
  }
});
