import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { showTable, tableSnapshot } from './fixtures/table.js';

async function digitHeights(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
) {
  const png = await page.screenshot({ clip, scale: 'css' });
  const pixels = await sharp(png).removeAlpha().raw().toBuffer();
  const spans: number[] = [];
  let top = clip.height;
  let bottom = -1;
  for (let x = 0; x <= clip.width; x++) {
    let hasInk = false;
    for (let y = 0; y < clip.height && x < clip.width; y++) {
      const offset = (y * clip.width + x) * 3;
      const [red, green, blue] = pixels.subarray(offset, offset + 3);
      if (red < 125 && red > green && green > blue) {
        hasInk = true;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (!hasInk && bottom >= 0) {
      spans.push(bottom - top + 1);
      top = clip.height;
      bottom = -1;
    }
  }
  return spans.filter((height) => height >= 6);
}

test('distant card ranks are painted at a readable size and respect concealed and burned plays', async ({
  page,
}, { project }) => {
  test.skip(!project.use.hasTouch, 'The far edge is tested at phone size.');
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    localStorage.setItem('retruco.table.mode', '3d');
    localStorage.setItem('retruco.table.quality', 'mobile-low');
  });
  // Blank paper isolates the distant-rank ink from the printed illustrations.
  const paper = await sharp({
    create: { width: 2048, height: 2304, channels: 3, background: '#fffdf5' },
  })
    .webp({ lossless: true })
    .toBuffer();
  await page.route('**/table3d/cards.webp', (route) =>
    route.fulfill({ contentType: 'image/webp', body: paper }),
  );

  const table = tableSnapshot(4, 2, false);
  const game = table.state!;
  game.vira = { suit: 'clubs', number: 10 };
  const face = game.seats[2].plays[0];
  face.card = { suit: 'cups', number: 12 };
  face.concealed = true;
  const update = await showTable(page, table);
  await expect(page.getByRole('application')).toBeVisible();

  const vira = { x: 34, y: 410, width: 45, height: 26 };
  const opposite = { x: 212, y: 403, width: 50, height: 35 };
  await expect.poll(async () => (await digitHeights(page, vira)).length).toBe(2);
  expect(await digitHeights(page, opposite)).toEqual([]);

  face.concealed = false;
  table.sequence++;
  game.revision++;
  update(structuredClone(table));
  await expect.poll(async () => (await digitHeights(page, opposite)).length).toBe(2);

  face.burned = true;
  table.sequence++;
  game.revision++;
  update(structuredClone(table));
  await expect.poll(() => digitHeights(page, opposite)).toEqual([]);
});
