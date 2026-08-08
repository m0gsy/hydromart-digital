#!/usr/bin/env node
/**
 * Renders apps/web/public/icon-*.png from one inline SVG source.
 *
 * These files did not exist at all: `public/sw.js` has been pointing `icon`/`badge` at
 * `/icon-192.png` since web push shipped, so every notification has been rendering with
 * the browser's generic fallback. The Play listing and the launcher need them too.
 *
 * Committed as PNGs — this script only exists so the source of those pixels is a file
 * someone can edit, not a blob nobody can regenerate. Run:  node scripts/gen-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');

// Fresh Flow (1c) brand teal — --color-brand-600 in apps/web/src/app/globals.css.
const BRAND = '#0c97ac';
const DROPLET = 'M12 2.25S4.75 10.1 4.75 14.6a7.25 7.25 0 0 0 14.5 0C19.25 10.1 12 2.25 12 2.25z';

/**
 * `inset` is the fraction of the canvas left empty around the mark. Android masks a
 * maskable icon to an arbitrary shape (circle, squircle, teardrop) and may crop up to
 * 20% off each edge, so the maskable variant keeps the droplet well inside the safe
 * circle. The plain variant fills more of the square because nothing crops it.
 */
function svg(size, inset) {
  const mark = size * (1 - inset * 2);
  const offset = size * inset;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${BRAND}"/>` +
      `<svg x="${offset}" y="${offset}" width="${mark}" height="${mark}" viewBox="0 0 24 24">` +
      `<path d="${DROPLET}" fill="#ffffff"/>` +
      `</svg></svg>`,
  );
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0.18 },
  { file: 'icon-512.png', size: 512, inset: 0.18 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.26 },
];

await mkdir(OUT, { recursive: true });
for (const { file, size, inset } of TARGETS) {
  const png = await sharp(svg(size, inset)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, file), png);
  console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
