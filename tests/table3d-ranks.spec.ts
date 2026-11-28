import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { showTable, tableSnapshot } from './fixtures/table.js';

type CardRegion = { x: number; y: number; width: number; height: number };

const vira = { x: 34, y: 410, width: 45, height: 28 };
const opposite = { x: 212, y: 405, width: 50, height: 36 };

async function cardPixels(page: Page, clip: CardRegion) {
  return sharp(await page.screenshot({ clip, scale: 'css' }))
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function paperAndInk(page: Page, clip: CardRegion) {
  const pixels = await cardPixels(page, clip);
  let paper = 0;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const [red, green, blue] = pixels.subarray(i, i + 3);
    if (red > 165 && green > 145 && blue > 110) paper++;
    if (red < 125 && red > green && green > blue) ink++;
  }
  return { paper, ink };
}

function colorDifference(left: Buffer, right: Buffer) {
  const total = left.reduce((sum, channel, index) => sum + Math.abs(channel - right[index]), 0);
  return total / left.length;
}

function distantCards() {
  const table = tableSnapshot(4, 2, false);
  table.state!.vira = { suit: 'clubs', number: 10 };
  table.state!.seats[2].plays[0].card = { suit: 'cups', number: 12 };
  return table;
}

test.describe('printed card faces on a phone', () => {
  test.beforeEach(async ({ page }, { project }) => {
    test.skip(!project.use.hasTouch, 'The far edge is tested at phone size.');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(() => {
      localStorage.setItem('retruco.table.mode', '3d');
      localStorage.setItem('retruco.table.quality', 'mobile-low');
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('camera distance and tilt leave unprinted card stock blank', async ({ page }) => {
    const paper = await sharp({
      create: { width: 2048, height: 2304, channels: 3, background: '#fffdf5' },
    })
      .webp({ lossless: true })
      .toBuffer();
    await page.route('**/table3d/cards.webp', (route) =>
      route.fulfill({ contentType: 'image/webp', body: paper }),
    );
    await showTable(page, distantCards());
    const scene = page.getByRole('application');
    await expect(scene).toBeVisible();

    const expectBlank = async (region: CardRegion) => {
      await expect.poll(async () => (await paperAndInk(page, region)).paper).toBeGreaterThan(100);
      expect((await paperAndInk(page, region)).ink).toBe(0);
    };

    await expectBlank(vira);
    await expectBlank(opposite);
    await scene.press('ArrowLeft');
    await scene.press('ArrowLeft');
    await expectBlank({ x: 117, y: 407, width: 42, height: 26 });
    await scene.press('ArrowRight');
    await scene.press('ArrowRight');
    await page.setViewportSize({ width: 740, height: 315 });
    await expectBlank({ x: 262, y: 189, width: 40, height: 21 });
  });

  test('revealing a play shows its printed face and burning it restores the back', async ({
    page,
  }) => {
    const table = distantCards();
    const game = table.state!;
    const play = game.seats[2].plays[0];
    play.concealed = true;
    const update = await showTable(page, table);
    await expect(page.getByRole('application')).toBeVisible();
    await expect.poll(async () => (await paperAndInk(page, opposite)).paper).toBeGreaterThan(100);
    const concealed = await cardPixels(page, opposite);

    play.concealed = false;
    table.sequence++;
    game.revision++;
    update(structuredClone(table));
    await expect
      .poll(async () => colorDifference(concealed, await cardPixels(page, opposite)))
      .toBeGreaterThan(16);
    const revealed = await cardPixels(page, opposite);

    play.burned = true;
    table.sequence++;
    game.revision++;
    update(structuredClone(table));
    await expect
      .poll(async () => {
        const burned = await cardPixels(page, opposite);
        return colorDifference(burned, revealed) - colorDifference(burned, concealed);
      })
      .toBeGreaterThan(12);
  });
});
