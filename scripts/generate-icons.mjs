#!/usr/bin/env node
/**
 * Rasterises assets/icon.svg into every icon each distribution needs.
 * Idempotent — rerun with `npm run icons` whenever the source art changes.
 *
 *   apps/desktop/build/     icon.png is what electron-builder converts to .ico
 *                           /.icns if Windows or macOS are ever built. Linux
 *                           needs the explicit icons/NxN.png set instead:
 *                           handed a lone icon.png, electron-builder 24 ships
 *                           it to hicolor/0x0/apps/, a path no desktop
 *                           environment ever looks in, so the installed app
 *                           silently has no icon.
 *   apps/mobile/assets/     input for `capacitor-assets generate`, which writes
 *                           the real mipmaps into the gitignored android/ tree.
 *   apps/web/public/        favicon + apple-touch icon for the browser build.
 *
 * The coin artwork is 660px across on a 1024px canvas (64.5% — COIN_FRACTION).
 *
 * Note the adaptive-icon foreground is scaled UP, not down. capacitor-assets
 * emits `android:inset="16.7%"` on both layers, which already maps the source
 * canvas onto the adaptive icon's 66.6% safe square. Handing it art that is
 * only 64.5% of its canvas would compound the two and leave the coin at ~43%
 * of the launcher icon — a small logo adrift in background. So the foreground
 * source is a tight crop instead: the coin fills FOREGROUND_FILL of the
 * canvas, and Android's inset does the safe-zone work.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets/icon.svg');

// Render the SVG 4x oversampled, then downsample — much cleaner edges on the
// reeded rim and the thin barb strokes than rasterising straight to target.
const DENSITY = 288;

// How much of the 1024px source canvas the coin occupies, measured from the art.
const COIN_FRACTION = 660 / 1024;

// Target coin coverage of the adaptive foreground source (see header note).
// 0.96 lands the coin at ~89% of the visible circle once Android insets it.
const FOREGROUND_FILL = 0.96;

// Tailwind gray-800 — matches the app chrome behind the silver coin.
const BG = '#1f2937';

const svg = await readFile(SRC);

const render = (size) => sharp(svg, { density: DENSITY }).resize(size, size, {
  fit: 'contain',
  background: { r: 0, g: 0, b: 0, alpha: 0 },
});

async function png(outPath, size) {
  await mkdir(dirname(outPath), { recursive: true });
  await render(size).png().toFile(outPath);
  return outPath;
}

/** Art enlarged until the coin fills `fill` of a `size` canvas, then centre-cropped. */
async function cropped(outPath, size, fill) {
  const scaled = Math.round((size * fill) / COIN_FRACTION);
  const offset = Math.round((scaled - size) / 2);
  await mkdir(dirname(outPath), { recursive: true });
  await render(scaled)
    .extract({ left: offset, top: offset, width: size, height: size })
    .png()
    .toFile(outPath);
  return outPath;
}

async function solid(outPath, size, color) {
  await mkdir(dirname(outPath), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toFile(outPath);
  return outPath;
}

const written = [];

// --- Desktop (electron-builder) -------------------------------------------
written.push(await png(join(root, 'apps/desktop/build/icon.png'), 1024));
// Linux hicolor set — each file must be named exactly NxN.png.
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  written.push(await png(join(root, `apps/desktop/build/icons/${size}x${size}.png`), size));
}

// --- Android (capacitor-assets) -------------------------------------------
written.push(await png(join(root, 'apps/mobile/assets/icon.png'), 1024));
written.push(await cropped(
  join(root, 'apps/mobile/assets/icon-foreground.png'), 1024, FOREGROUND_FILL,
));
written.push(await solid(join(root, 'apps/mobile/assets/icon-background.png'), 1024, BG));

// --- Web ------------------------------------------------------------------
// The source carries ~7.7KB of C2PA provenance metadata. Keep it in assets/,
// strip it from the copy every page load fetches.
const stripped = (await readFile(SRC, 'utf8')).replace(/<metadata>[\s\S]*?<\/metadata>/, '');
await mkdir(join(root, 'apps/web/public'), { recursive: true });
await writeFile(join(root, 'apps/web/public/favicon.svg'), stripped);
written.push(join(root, 'apps/web/public/favicon.svg'));

written.push(await png(join(root, 'apps/web/public/favicon-96.png'), 96));
written.push(await png(join(root, 'apps/web/public/apple-touch-icon.png'), 180));
written.push(await png(join(root, 'apps/web/public/icon-512.png'), 512));

for (const f of written) {
  const { size, format, width, height } = await sharp(f).metadata().catch(() => ({}));
  const rel = f.replace(root + '/', '');
  console.log(
    width ? `  ${rel}  ${width}x${height} ${format}` : `  ${rel}  (svg)`,
  );
}
console.log(`\n${written.length} icons written from assets/icon.svg`);
