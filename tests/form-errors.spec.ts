import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockTurnstile } from './fixtures/turnstile.js';

async function mockForms(page: Page) {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') requests.push(path);
    if (path === '/api/session') await route.fulfill({ json: null });
    else if (path === '/api/matches/events')
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    else if (path === '/api/matches' && route.request().method() === 'GET')
      await route.fulfill({ json: [] });
    else if (path === '/api/guest') {
      if (route.request().postDataJSON().name === '') {
        await route.fulfill({
          status: 400,
          json: { error: 'Usa un nombre de 2 a 24 caracteres.' },
        });
      } else {
        await route.fulfill({ json: { id: 'guest', name: 'Ana', registered: false } });
      }
    } else if (path === '/api/register')
      await route.fulfill({
        status: 409,
        json: { error: 'Ese nombre de usuario ya está ocupado.' },
      });
    else if (path === '/api/login')
      await route.fulfill({ status: 401, json: { error: 'Nombre o contraseña incorrectos.' } });
    else if (path === '/api/matches')
      await route.fulfill({
        status: 503,
        json: { error: 'No pudimos crear la mesa. Inténtalo de nuevo.' },
      });
    else await route.fulfill({ status: 404, json: { error: 'No encontramos esa mesa.' } });
  });
  await mockTurnstile(page);
  return requests;
}

async function expectFieldError(page: Page, input: Locator, message: string) {
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const description = await input.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  const error = page.locator(`#${description}`);
  await expect(error).toHaveText(message);
  const inputBounds = (await input.boundingBox())!;
  const errorBounds = (await error.boundingBox())!;
  expect(errorBounds.y).toBeGreaterThanOrEqual(inputBounds.y + inputBounds.height);
  await expect(error).toBeInViewport();
}

test('missing names and malformed codes stay beside their inputs and clear while typing', async ({
  page,
}) => {
  const requests = await mockForms(page);
  await page.goto('/');
  const name = page.getByLabel('Tu nombre en la mesa');
  const code = page.getByLabel('Código de la mesa');
  await page.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
  await expectFieldError(page, name, 'Escribe tu nombre para continuar.');
  await name.fill('Ana');
  await expect(name).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#guest-name-error')).toHaveCount(0);
  await code.fill('ABC');
  await page.locator('.join-form').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expectFieldError(page, code, 'El código tiene el formato ABCD-1234.');
  expect(requests).toEqual([]);
  await code.fill('ABCD1234');
  await expect(code).toHaveValue('ABCD-1234');
  await expect(page.locator('#room-code-error')).toHaveCount(0);
  await page.locator('.join-form').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expectFieldError(page, code, 'No encontramos una mesa con ese código.');
  await expect(page).toHaveURL(/\/$/);
  await code.fill('EFGH1234');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('account validation focuses the first invalid field and keeps errors inside the dialog', async ({
  page,
}) => {
  const requests = await mockForms(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea una cuenta', exact: true }).click();
  const username = page.getByLabel('Usuario', { exact: true });
  const password = page.getByLabel('Contraseña', { exact: true });
  const submit = page.getByRole('button', { name: 'Crear mi cuenta', exact: true });
  await submit.click();
  await expectFieldError(page, username, 'Escribe tu usuario.');
  await expect(page.locator('#password-error')).toHaveText('Escribe tu contraseña.');
  await username.fill('ana');
  await expect(page.locator('#username-error')).toHaveCount(0);
  await expect(page.locator('#password-error')).toBeVisible();
  await password.fill('short');
  await submit.click();
  await expectFieldError(page, password, 'La contraseña es demasiado corta.');
  expect(requests).toEqual([]);
  await password.fill('🙂'.repeat(20));
  await submit.click();
  await expectFieldError(page, password, 'La contraseña es demasiado larga.');
  await password.fill('test-password-123');
  await submit.click();
  await expectFieldError(page, username, 'Ese nombre de usuario ya está ocupado.');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await username.fill('beto');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ya tengo una cuenta', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(username).toBeFocused();
  await expect(page.locator('#credentials-error')).toHaveText('Nombre o contraseña incorrectos.');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await password.fill('another-password');
  await expect(page.locator('#credentials-error')).toHaveCount(0);
  await expect(username).toHaveAttribute('aria-invalid', 'false');
  await expect(password).toHaveAttribute('aria-invalid', 'false');
  await page.route('**/api/login', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'No pudimos iniciar sesión. Inténtalo de nuevo.' },
    }),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Entrar', exact: true }).click();
  const authError = page.getByRole('dialog').getByRole('alert');
  await expect(authError).toHaveText('No pudimos iniciar sesión. Inténtalo de nuevo.');
  await expect(authError).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await username.fill('carla');
  await expect(authError).toHaveCount(0);
});

test('table-list failures receive focus on initial load and manual retry', async ({ page }) => {
  await mockForms(page);
  await page.route('**/api/matches', (route) =>
    route.fulfill({ status: 503, json: { error: 'No pudimos cargar las mesas.' } }),
  );
  await page.goto('/');
  const error = page.getByRole('alert');
  await expect(error).toHaveText('No pudimos cargar las mesas.');
  await expect(error).toBeFocused();
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(error).toBeFocused();
});

test('general failures receive focus and clear on input changes', async ({ page }) => {
  await mockForms(page);
  await page.goto('/');
  await page.getByLabel('Tu nombre en la mesa').fill('Ana');
  await page.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
  const error = page.getByRole('alert');
  await expect(error).toHaveText('No pudimos crear la mesa. Inténtalo de nuevo.');
  await expect(error).toBeFocused();
  await page.getByLabel('Código de la mesa').fill('ABCD');
  await expect(error).toHaveCount(0);
});

test('an outdated response does not restore an error after editing', async ({ page }) => {
  await mockForms(page);
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/guest', async (route) => {
    requested = true;
    await response;
    await route.fulfill({ status: 400, json: { error: 'Usa un nombre de 2 a 24 caracteres.' } });
  });
  await page.goto('/');
  const name = page.getByLabel('Tu nombre en la mesa');
  await name.fill('Ana');
  await page.getByRole('button', { name: 'Crear una mesa', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await name.fill('Beto');
  release();
  await expect(page.getByRole('button', { name: 'Crear una mesa', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(name).toBeFocused();
});

test('direct room entry validates and clears the display name inline', async ({ page }) => {
  const requests = await mockForms(page);
  await page.goto('/mesa/ABCD-1234');
  const name = page.getByLabel('Tu nombre', { exact: true });
  await page.getByRole('button', { name: 'Entrar a mirar', exact: true }).click();
  await expectFieldError(page, name, 'Escribe tu nombre para continuar.');
  expect(requests).toEqual([]);
  await name.fill('Ana');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Elegir mi puesto', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('No encontramos esa mesa.');
  await expect(page.getByRole('alert')).toBeFocused();
});
