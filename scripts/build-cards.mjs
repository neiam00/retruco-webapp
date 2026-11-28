import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = join(root, 'artwork/cards');
const outputDirectory = join(root, 'static/cards');
const manifestPath = join(root, 'src/lib/card-assets.json');
const suits = ['coins', 'cups', 'swords', 'clubs'];
const ranks = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

async function checkPintas(image, stem) {
  const suit = stem.split('_')[1];
  const expected = suits.indexOf(suit);
  // At the smallest normal hand size, sample each printed rule separately.
  // A single row through the ink keeps nearby illustrations out of the sample.
  const width = 40;
  const height = 60;
  const pixels = await sharp(image)
    .resize(width, height)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer();
  for (const y of [9.6, 123.4]) {
    const row = Math.floor((y * height) / 133);
    let segments = 0;
    let previousInk = false;
    for (let x = 5; x < width - 5; x++) {
      const ink = pixels[row * width + x] < 216;
      if (ink && !previousInk) segments++;
      previousInk = ink;
    }
    if (segments !== expected + 1) {
      throw new Error(
        `${stem} has ${segments} printed border segments at y=${y}; expected ${expected + 1}.`,
      );
    }
  }
}

async function checkCornerRank(image, stem) {
  // The physical print is drawn at roughly this size in the reference pack.
  // Sample each digit independently, in both opposed corners. Sampling
  // a compact figure box keeps pips and the suit rules out of this check.
  const width = 89;
  const height = 133;
  const pixels = await sharp(image)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer();
  const rank = Number(stem.split('_')[2]);
  const figures =
    rank >= 10
      ? [
          [11, 14],
          [15, 19],
        ]
      : [[11, 16]];
  for (const [left, right] of figures) {
    let inkRows = 0;
    let inkPixels = 0;
    for (let y = 11; y <= 18; y++) {
      const previous = inkPixels;
      for (let x = left; x <= right; x++) {
        const upper = pixels[y * width + x];
        const lower = pixels[(height - 1 - y) * width + width - 1 - x];
        if (Math.max(upper, lower) < 185) inkPixels++;
      }
      if (inkPixels > previous) inkRows++;
    }
    if (inkRows < 5 || inkPixels < 7) {
      throw new Error(`${stem} needs a legible rank in both corners at ${width}px wide.`);
    }
  }
}

const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.svg')).sort();
if (files.length !== 41) throw new Error('Expected 40 card faces and one back in artwork/cards.');

await mkdir(outputDirectory, { recursive: true });
const manifest = {};
let originalBytes = 0;
let generatedBytes = 0;
for (const file of files) {
  const input = await readFile(join(sourceDirectory, file));
  // Render vectors above the display resolution, then downsample. At 576px,
  // the cards stay crisp on high-density screens without live SVG rasterization.
  const image = await sharp(input, { density: 720 })
    .resize({ width: 576 })
    // Near-lossless keeps fine lines and full 576px detail while quantizing
    // imperceptible pixel differences (about 30% smaller than lossless).
    .webp({ nearLossless: true, quality: 70, effort: 6 })
    .toBuffer();
  // Traced SVG paths can leave holes in the paper. Reject transparent interiors
  // instead of masking broken source artwork with a CSS background or flatten().
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const inset = Math.ceil(info.width * 0.04);
  for (let y = inset; y < info.height - inset; y++) {
    for (let x = inset; x < info.width - inset; x++) {
      if (data[(y * info.width + x) * 4 + 3] !== 255) {
        throw new Error(`${file} has transparent paper at (${x}, ${y}); fix the source SVG.`);
      }
    }
  }
  const stem = file.slice(0, -4);
  if (stem !== 'card_back') {
    await checkPintas(image, stem);
    await checkCornerRank(image, stem);
  }
  const hash = createHash('sha256').update(image).digest('hex').slice(0, 12);
  const filename = `${stem}-${hash}.webp`;
  await writeFile(join(outputDirectory, filename), image);
  manifest[stem] = filename;
  originalBytes += input.length;
  generatedBytes += image.length;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Remove only obsolete generated card versions; leave attribution intact.
const current = new Set(Object.values(manifest));
for (const file of await readdir(outputDirectory)) {
  if (/^card_[a-z0-9_]+-[a-f0-9]{12}\.webp$/.test(file) && !current.has(file)) {
    await unlink(join(outputDirectory, file));
  }
}
console.log(
  `Generated ${files.length} WebP cards: ${originalBytes.toLocaleString()} SVG bytes → ${generatedBytes.toLocaleString()} WebP bytes.`,
);

// The tabletop addresses tiles from the upper left, with a four-pixel inset.
const tileOrder = suits.flatMap((suit) =>
  ranks.map((rank) => `card_${suit}_${String(rank).padStart(2, '0')}`),
);
tileOrder.push('card_back');
const tiles = await Promise.all(
  tileOrder.map(async (key, index) => ({
    input: await sharp(join(outputDirectory, manifest[key]))
      .resize(248, 376, { fit: 'fill' })
      .png()
      .toBuffer(),
    left: (index % 8) * 256 + 4,
    top: Math.floor(index / 8) * 384 + 4,
  })),
);
const tableDirectory = join(root, 'static/table3d');
await mkdir(tableDirectory, { recursive: true });
await sharp({ create: { width: 2048, height: 2304, channels: 4, background: '#fff' } })
  .composite(tiles)
  // Sharp chroma subsampling preserves the thin coloured ink in the small tiles.
  .webp({ quality: 88, smartSubsample: true, effort: 6, alphaQuality: 100 })
  .toFile(join(tableDirectory, 'cards.webp'));
