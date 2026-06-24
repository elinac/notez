/**
 * Generate pure-vector transparent SVG from icon-master.png.
 * Also writes icon-processed.png for raster preview / Windows icons.
 *
 * Usage: node scripts/generate-icon-svg.mjs [input.png] [output.svg]
 */
import potrace from 'potrace';
import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const trace = promisify(potrace.trace);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const defaultInput = join(root, 'src-tauri/icons/icon-master.png');
const input = process.argv[2] ?? defaultInput;
const outputSvg = process.argv[3] ?? join(root, 'src-tauri/icons/icon.svg');
const outputPng = join(dirname(outputSvg), 'icon-processed.png');
const SIZE = 1024;

if (!existsSync(input)) {
  console.error('Input not found:', input);
  process.exit(1);
}

function sampleBg(pixels, width, channels, points) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [x, y] of points) {
    const i = (y * width + x) * channels;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
    n += 1;
  }
  return [r / n, g / n, b / n];
}

function colorDist(r, g, b, bg) {
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isForeground(r, g, b, bg) {
  const maxC = Math.max(r, g, b);
  const dist = colorDist(r, g, b, bg);
  if (g > 95 || b > 115) return true;
  if (maxC > 130 && dist > 40) return true;
  if (dist > 58) return true;
  if (maxC > 72 && g >= r && b >= r) return true;
  return false;
}

function processPixels(px, width, height, channels) {
  const margin = Math.max(4, Math.floor(Math.min(width, height) * 0.02));
  const bg = sampleBg(px, width, channels, [
    [margin, margin],
    [width - margin, margin],
    [margin, height - margin],
    [width - margin, height - margin],
    [Math.floor(width / 2), margin],
    [margin, Math.floor(height / 2)],
  ]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      if (!isForeground(r, g, b, bg)) {
        px[i + 3] = 0;
      } else {
        const maxC = Math.max(r, g, b);
        const dist = colorDist(r, g, b, bg);
        let alpha = 255;
        if (dist < 72) {
          alpha = Math.round(Math.max(0, Math.min(255, ((dist - 35) / 37) * 255)));
        }
        if (maxC < 58) alpha = 0;
        else if (maxC < 88) alpha = Math.min(alpha, Math.round(((maxC - 58) / 30) * 255));
        px[i + 3] = alpha;
      }
    }
  }
}

async function rasterToSquarePng(inputPath) {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const side = Math.min(w, h);
  const left = Math.floor((w - side) / 2);
  const top = Math.floor((h - side) / 2);

  const { data, info } = await sharp(inputPath)
    .extract({ left, top, width: side, height: side })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = Buffer.from(data);
  processPixels(px, info.width, info.height, info.channels);

  const trimmed = await sharp(px, { raw: info }).trim().toBuffer({ resolveWithObject: true });

  const fill = 0.9;
  const scale = (SIZE * fill) / Math.max(trimmed.info.width, trimmed.info.height);
  const newW = Math.round(trimmed.info.width * scale);
  const newH = Math.round(trimmed.info.height * scale);

  const resized = await sharp(trimmed.data, { raw: trimmed.info })
    .resize(newW, newH, { kernel: sharp.kernel.lanczos3 })
    .extend({
      top: Math.floor((SIZE - newH) / 2),
      bottom: Math.ceil((SIZE - newH) / 2),
      left: Math.floor((SIZE - newW) / 2),
      right: Math.ceil((SIZE - newW) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const finalPx = Buffer.from(resized.data);

  return sharp(finalPx, { raw: resized.info }).png().toBuffer();
}

async function silhouettePngBuffer(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mono = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < info.width * info.height; i++) {
    // Trace logo silhouette; outer glow comes from SVG filters
    mono[i] = data[i * 4 + 3] > 140 ? 0 : 255;
  }
  return sharp(mono, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

function extractPathD(potraceSvg) {
  const match = potraceSvg.match(/<path[^>]*\sd="([^"]+)"/);
  if (!match) throw new Error('Potrace produced no path');
  return match[1];
}

function buildVectorSvg(pathD) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="NoteZ">
  <title>NoteZ</title>
  <defs>
    <linearGradient id="zBody" x1="420" y1="80" x2="620" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#d4ffff"/>
      <stop offset="18%" stop-color="#5cf0ff"/>
      <stop offset="45%" stop-color="#00c8f5"/>
      <stop offset="72%" stop-color="#0088e8"/>
      <stop offset="100%" stop-color="#0040a8"/>
    </linearGradient>
    <filter id="outerGlow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0.75
                0 0 0 0 1
                0 0 0 0.65 0" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
      </feMerge>
    </filter>
  </defs>
  <path fill="#00c8ff" fill-rule="evenodd" filter="url(#outerGlow)" d="${pathD}"/>
  <path fill="url(#zBody)" fill-rule="evenodd" d="${pathD}"/>
</svg>
`;
}

async function main() {
  const pngBuffer = await rasterToSquarePng(input);
  await sharp(pngBuffer).png().toFile(outputPng);

  const monoBuffer = await silhouettePngBuffer(pngBuffer);
  const traced = await trace(monoBuffer, {
    turdSize: 48,
    optTolerance: 0.45,
    color: '#000000',
    background: 'transparent',
  });

  const pathD = extractPathD(traced);
  writeFileSync(outputSvg, buildVectorSvg(pathD), 'utf8');

  console.log('Wrote', outputPng);
  console.log('Wrote', outputSvg, `(pure vector, path ${pathD.length} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
