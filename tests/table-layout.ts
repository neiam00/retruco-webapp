import { expect, type Page } from '@playwright/test';

export async function expectClearResults(page: Page) {
  const panel = page.locator('.table-status.expanded');
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = document.querySelector('.table-status.expanded')?.getBoundingClientRect();
        const table = document.querySelector('.table-area')?.getBoundingClientRect();
        const hand = document.querySelector('.hand-area')?.getBoundingClientRect();
        return (
          !!panel &&
          !!table &&
          !!hand &&
          panel.bottom <= table.bottom &&
          panel.bottom < hand.top &&
          Math.abs(panel.left + panel.width / 2 - (table.left + table.width / 2)) < 1
        );
      }),
    )
    .toBe(true);
}

export async function expectClearTableCards(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const hand = document.querySelector('.hand-area')?.getBoundingClientRect();
        const deck = document.querySelector('.deck')?.getBoundingClientRect();
        const status = document
          .querySelector('.table-status:not(.expanded)')
          ?.getBoundingClientRect();
        const overlaps = (first: DOMRect, second?: DOMRect) =>
          second &&
          Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 &&
          Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1;
        const collisions: string[] = [];
        for (const seat of document.querySelectorAll('.seat')) {
          if (overlaps(seat.getBoundingClientRect(), status)) {
            collisions.push('Turn indicator overlaps a player');
          }
        }
        for (const card of document.querySelectorAll('.played-card img')) {
          const bounds = card.getBoundingClientRect();
          if (overlaps(bounds, hand)) collisions.push('Hand overlaps a played card');
          if (overlaps(bounds, status)) collisions.push('Turn indicator overlaps a played card');
          if (overlaps(bounds, deck)) collisions.push('Deck overlaps a played card');
          for (const other of document.querySelectorAll('.played-card img')) {
            if (
              card.closest('[data-play-seat]')?.getAttribute('data-play-seat') ===
              other.closest('[data-play-seat]')?.getAttribute('data-play-seat')
            )
              continue;
            if (overlaps(bounds, other.getBoundingClientRect())) {
              collisions.push('Different players’ played cards overlap');
            }
          }
        }
        return collisions;
      }),
    )
    .toEqual([]);
}
