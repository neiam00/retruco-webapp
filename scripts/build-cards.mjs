import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = join(root, 'artwork/cards');
const outputDirectory = join(root, 'static/cards');
const manifestPath = join(root, 'src/lib/card-assets.json');
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
    .webp({ lossless: true, effort: 6 })
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
