import { expect, test } from '@playwright/test';
import { mockTurnstile } from './fixtures/turnstile.js';

declare global {
  interface Window {
    turnstileTest: {
      options: {
        action: string;
        callback: (token: string) => void;
        'expired-callback': () => void;
      };
      id: string;
      removed: boolean;
    };
  }
}

test('registration verifies, invalidates expired tokens, refreshes used tokens and cleans up', async ({
  page,
}) => {
  const registrations: Record<string, string>[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/register') {
      registrations.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: { error: 'Ese nombre de usuario ya está ocupado.' },
      });
    } else if (path === '/api/matches/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    } else await route.fulfill({ json: path === '/api/matches' ? [] : null });
  });
  await mockTurnstile(page, false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea una cuenta', exact: true }).click();
  await page.getByLabel('Usuario', { exact: true }).fill('player');
  await page.getByLabel('Contraseña', { exact: true }).fill('valid-password');
  const submit = page.getByRole('button', { name: 'Crear mi cuenta', exact: true });
  const verify = page.getByRole('button', { name: 'Verificar prueba' });
  await expect(verify).toBeVisible();
  await submit.click();
  await expect(page.locator('#auth-check')).toBeFocused();
  expect(registrations).toEqual([]);
  await verify.click();
  await page.evaluate(() => window.turnstileTest.options['expired-callback']());
  await submit.click();
  expect(registrations).toEqual([]);
  await verify.click();
  await submit.click();
  await expect(page.locator('#username-error')).toContainText('ocupado');
  expect(registrations).toEqual([
    { username: 'player', password: 'valid-password', turnstileToken: 'test-token-1' },
  ]);
  await page.getByLabel('Usuario', { exact: true }).fill('another_player');
  await expect(verify).toBeVisible();
  await submit.click();
  expect(registrations).toHaveLength(1);
  await verify.click();
  await submit.click();
  await expect.poll(() => registrations.length).toBe(2);
  expect(registrations[1].turnstileToken).toBe('test-token-2');
  await page.getByRole('button', { name: 'Ya tengo una cuenta', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.turnstileTest.options.action)).toBe('login');
  await expect(page.getByText('Verificación completada.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('registration fails closed when the verification script is unavailable and supports retry', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: new URL(route.request().url()).pathname === '/api/matches' ? [] : null }),
  );
  await mockTurnstile(page, false);
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.abort(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea una cuenta', exact: true }).click();
  await expect(page.getByText('No se pudo cargar la verificación de seguridad.')).toBeVisible();
  await page.unroute('https://challenges.cloudflare.com/turnstile/v0/api.js*');
  await mockTurnstile(page, false);
  await page.getByRole('button', { name: 'Reintentar verificación' }).click();
  await expect(page.getByRole('button', { name: 'Verificar prueba' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.turnstileTest.removed)).toBe(true);
});

test('login requires its own fresh verification and retries after incorrect credentials', async ({
  page,
}) => {
  const logins: Record<string, string>[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/login') {
      logins.push(route.request().postDataJSON());
      if (logins.length === 1) {
        await route.fulfill({ status: 401, json: { error: 'Nombre o contraseña incorrectos.' } });
      } else {
        await route.fulfill({ json: { id: 'player', name: 'player', registered: true } });
      }
    } else if (path === '/api/matches/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    } else await route.fulfill({ json: path === '/api/matches' ? [] : null });
  });
  await mockTurnstile(page, false);
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Entrar', exact: true }).click();
  const verify = page.getByRole('button', { name: 'Verificar prueba' });
  await expect(verify).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.turnstileTest.options.action)).toBe('login');
  await verify.click();
  await page.getByRole('button', { name: 'Quiero crear una cuenta', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.turnstileTest.options.action))
    .toBe('register');
  await expect(page.getByText('Verificación completada.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ya tengo una cuenta', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.turnstileTest.options.action)).toBe('login');
  await page.getByLabel('Usuario', { exact: true }).fill('player');
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong-password');
  const submit = page.getByRole('dialog').getByRole('button', { name: 'Entrar', exact: true });
  await submit.click();
  await expect(page.locator('#auth-check')).toBeFocused();
  expect(logins).toHaveLength(0);
  await verify.click();
  await page.evaluate(() => window.turnstileTest.options['expired-callback']());
  await submit.click();
  expect(logins).toHaveLength(0);
  await verify.click();
  await submit.click();
  await expect(page.locator('#credentials-error')).toBeVisible();
  expect(logins).toEqual([
    { username: 'player', password: 'wrong-password', turnstileToken: 'test-token-3' },
  ]);
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-password');
  await expect(verify).toBeVisible();
  await submit.click();
  expect(logins).toHaveLength(1);
  await verify.click();
  await submit.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(logins[1]).toEqual({
    username: 'player',
    password: 'correct-password',
    turnstileToken: 'test-token-4',
  });
  await expect(page.getByRole('button', { name: 'Mi historial', exact: true })).toBeVisible();
});
