import type { Page } from '@playwright/test';

/** Simulates only Cloudflare's widget SDK; application token handling stays real. */
export async function mockTurnstile(page: Page, automatic = true) {
  await page.route('**/api/registration', (route) =>
    route.fulfill({ json: { siteKey: 'test-site-key' } }),
  );
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        let next = 0;
        const widgets = new Map();
        window.turnstile = {
          render(container, options) {
            const id = String(++next);
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Verificar prueba';
            button.onclick = () => options.callback('test-token-' + id);
            container.append(button);
            widgets.set(id, container);
            window.turnstileTest = { options, id, removed: false };
            if (${automatic}) queueMicrotask(button.onclick);
            return id;
          },
          remove(id) {
            widgets.get(id)?.replaceChildren();
            widgets.delete(id);
            window.turnstileTest.removed = true;
          }
        };
      `,
    }),
  );
}
