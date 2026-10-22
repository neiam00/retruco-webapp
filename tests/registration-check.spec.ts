import { expect, test } from '@playwright/test';
import { mockTurnstile } from './fixtures/turnstile.js';

declare global {
  interface Window {
    turnstileTest: {
      options: { callback: (token: string) => void; 'expired-callback': () => void };
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
  await expect(page.locator('#registration-check')).toBeFocused();
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
  await expect(page.locator('#registration-check')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.turnstileTest.removed)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('registration fails closed when the verification script is unavailable and supports retry', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: route.request().url().endsWith('/matches') ? [] : null }),
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
