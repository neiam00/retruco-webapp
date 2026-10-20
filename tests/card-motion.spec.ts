import { expect, test } from '@playwright/test';
import { expectClearTableCards } from './table-layout.js';

declare global {
  interface Window {
    cardFlights: { kind: string; source: string }[];
  }
}

for (const players of [2, 4]) {
  test(`${players} players receive cards and slide confirmed plays onto the table`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all(
      Array.from({ length: players }, () =>
        browser.newContext({
          ...testInfo.project.use,
          baseURL,
        }),
      ),
    );
    try {
      for (const context of contexts) {
        await context.addInitScript(() => {
          window.cardFlights = [];
          new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (node instanceof HTMLImageElement && node.dataset.cardFlight) {
                  window.cardFlights.push({ kind: node.dataset.cardFlight, source: node.src });
                }
              }
            }
          }).observe(document, { childList: true, subtree: true });
        });
        const register = () =>
          context.request.post(
            `${process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080'}/api/register`,
            {
              headers: { Origin: baseURL! },
              data: {
                username: `motion_${crypto.randomUUID().slice(0, 8)}`,
                password: crypto.randomUUID(),
              },
            },
          );
        let response = await register();
        if (response.status() === 429) {
          // Respect the real server's account-creation limit across projects.
          await new Promise((resolve) => setTimeout(resolve, 60_000));
          response = await register();
        }
        expect(response.ok(), `Registration returned ${response.status()}`).toBe(true);
      }
      const api = process.env.TEST_API_ORIGIN ?? 'http://127.0.0.1:8080';
      const headers = { Origin: baseURL! };
      const created = await contexts[0].request.post(`${api}/api/matches`, {
        headers,
        data: { private: true, config: { players, target: 24, florRequired: false } },
      });
      expect(created.ok()).toBe(true);
      const { code } = await created.json();
      for (const context of contexts.slice(1)) {
        const joined = await context.request.post(`${api}/api/matches/${code}/join`, {
          headers,
          data: {},
        });
        expect(joined.ok()).toBe(true);
      }
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(pages.map((page) => page.goto(`/mesa/${code}`)));
      for (const page of pages)
        await expect(page.getByText('En línea', { exact: true })).toBeVisible();
      const cutter = (
        await Promise.all(
          pages.map(
            async (page) =>
              await page.getByRole('button', { name: 'Partir el mazo', exact: true }).count(),
          ),
        )
      ).findIndex(Boolean);
      await pages[cutter].getByRole('button', { name: 'Partir el mazo', exact: true }).click();
      for (const page of pages) {
        await expect
          .poll(() =>
            page.evaluate(
              () => window.cardFlights.filter((flight) => flight.kind === 'deal').length,
            ),
          )
          .toBe(players * 3);
        expect(
          await page.evaluate(() =>
            window.cardFlights.every((flight) => flight.source.endsWith('/card_back.svg')),
          ),
        ).toBe(true);
        await expect(page.locator('[data-card-flight]')).toHaveCount(0);
        await expect(page.locator('.hand-card img:visible')).toHaveCount(3);
      }

      const player = (
        await Promise.all(pages.map((page) => page.locator('.hand-card:not(:disabled)').count()))
      ).findIndex(Boolean);
      const page = pages[player];
      // Observe the native animation at both ends without relying on frame timing.
      await page.evaluate(() => {
        const observer = new MutationObserver(() => {
          const card = document.querySelector('[data-card-flight="play"]');
          const animation = card?.getAnimations()[0];
          if (animation) {
            animation.pause();
            animation.currentTime = 0;
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true });
      });
      await page.locator('.hand-card:not(:disabled)').first().press('Enter');
      const flight = page.locator('[data-card-flight="play"]');
      await expect(flight).toHaveCount(1);
      const movement = await flight.evaluate((card) => {
        const animation = card.getAnimations()[0];
        const from = card.getBoundingClientRect();
        animation.currentTime = Number(animation.effect!.getComputedTiming().duration);
        const to = card.getBoundingClientRect();
        const target = document.querySelector('.played-card img')!.getBoundingClientRect();
        animation.play();
        return {
          distance: Math.hypot(to.x - from.x, to.y - from.y),
          landingError: Math.hypot(to.x - target.x, to.y - target.y),
        };
      });
      expect(movement.distance).toBeGreaterThan(40);
      expect(movement.landingError).toBeLessThan(2);
      await expect(flight).toHaveCount(0);
      await expectClearTableCards(page);
      await page.screenshot({
        path: `output/playwright/card-motion-${players}-${testInfo.project.name}.png`,
        fullPage: true,
      });

      await page.reload();
      await expect(page.locator('.played-card img')).toBeVisible();
      expect(await page.evaluate(() => window.cardFlights)).toEqual([]);

      // Reduced motion applies to other players' actions as well as our own.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const nextPlayer = (
        await Promise.all(pages.map((other) => other.locator('.hand-card:not(:disabled)').count()))
      ).findIndex(Boolean);
      await pages[nextPlayer].locator('.hand-card:not(:disabled)').first().press('Enter');
      await expect(page.locator('.played-card')).toHaveCount(2);
      expect(await page.evaluate(() => window.cardFlights)).toEqual([]);
      await expect(page.locator('.played-card img:visible')).toHaveCount(2);
      if (players === 2) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const stackPlayer = (
          await Promise.all(
            pages.map((other) => other.locator('.hand-card:not(:disabled)').count()),
          )
        ).findIndex(Boolean);
        const stackPage = pages[stackPlayer];
        const pegado = stackPage.getByRole('button', { name: 'Jugar pegado', exact: true });
        if (await pegado.isVisible()) await pegado.click();
        await stackPage.locator('.hand-card:not(:disabled)').first().press('Enter');
        await stackPage.locator('.hand-card:not(:disabled)').last().press('Enter');
        await stackPage.getByRole('button', { name: 'Jugar las dos', exact: true }).click();
        await expect(stackPage.locator('.played-card')).toHaveCount(4);
        const lastFlights = await stackPage.evaluate(() => window.cardFlights.slice(-2));
        expect(lastFlights).toHaveLength(2);
        expect(
          lastFlights.filter((flight) => flight.source.endsWith('/card_back.svg')),
        ).toHaveLength(1);
        await expect(stackPage.locator('[data-card-flight]')).toHaveCount(0);
        await expect(stackPage.locator('.played-card img:visible')).toHaveCount(4);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
