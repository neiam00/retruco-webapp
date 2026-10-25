import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const assets = JSON.parse(await readFile(new URL('src/lib/card-assets.json', root), 'utf8'));
const dataURL = async (path, type) =>
  `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
const replacements = {
  font: await dataURL(
    'node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2',
    'font/woff2',
  ),
  coins: await dataURL(`static/cards/${assets.card_coins_07}`, 'image/webp'),
  clubs: await dataURL(`static/cards/${assets.card_clubs_01}`, 'image/webp'),
  swords: await dataURL(`static/cards/${assets.card_swords_01}`, 'image/webp'),
};
const source = await readFile(new URL('artwork/social-preview.html', root), 'utf8');
const html = source.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!replacements[key]) throw new Error(`Unknown social preview asset: ${key}`);
  return replacements[key];
});

// This is an explicit artwork task, not part of deployment builds. CI serves the
// committed PNG and does not need a browser or any external rendering service.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('850 86px "Nunito Variable"')) {
      throw new Error('Nunito Variable did not load.');
    }
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  const screenshot = await page.screenshot({ type: 'png' });
  const image = await sharp(screenshot).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(new URL('static/og-image.png', root), image);
  console.log(`Generated static/og-image.png (1200 × 630, ${Math.round(image.length / 1024)} KB).`);
} finally {
  await browser.close();
}
