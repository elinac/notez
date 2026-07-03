/**
 * One-off fix: icon-master.png has an opaque near-white canvas background
 * outside the rounded-square backplate (should be transparent). This flood
 * fills the background region (starting from the image border, which only
 * touches the background — the rounded square never reaches the edge) and
 * sets it fully transparent, then feathers the mask by ~1.5px so the
 * anti-aliased edge of the rounded square stays smooth.
 *
 * Usage: node scripts/fix-icon-master-background.mjs [input.png]
 */
import sharp from 'sharp';
import { existsSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const input = process.argv[2] ?? join(root, 'src-tauri/icons/icon-master.png');

if (!existsSync(input)) {
  console.error('Input not found:', input);
  process.exit(1);
}

const backupPath = input.replace(/\.png$/, '-original.png');
if (!existsSync(backupPath)) {
  copyFileSync(input, backupPath);
  console.log('Backed up original to', backupPath);
}

const BG_THRESHOLD = 90; // color distance under which a pixel counts as "background-like"

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

function sample(x, y) {
  const i = (y * width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

// The rounded-square backplate touches the canvas edge along its flat sides, so only the
// 4 true corner pixels are guaranteed to sample the background (mid-edge points can land
// on the plate itself).
const samples = [
  sample(0, 0),
  sample(width - 1, 0),
  sample(0, height - 1),
  sample(width - 1, height - 1),
];
const bg = samples.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]).map((v) => v / samples.length);

function dist(x, y) {
  const [r, g, b] = sample(x, y);
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const mask = new Uint8Array(width * height); // 1 = background (to become transparent)
const visited = new Uint8Array(width * height);
const queue = new Int32Array(width * height);
let qHead = 0;
let qTail = 0;

function tryEnqueue(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = y * width + x;
  if (visited[idx]) return;
  visited[idx] = 1;
  if (dist(x, y) < BG_THRESHOLD) {
    mask[idx] = 1;
    queue[qTail++] = idx;
  }
}

// Seed the flood fill from every border pixel; background always touches the edge.
for (let x = 0; x < width; x++) {
  tryEnqueue(x, 0);
  tryEnqueue(x, height - 1);
}
for (let y = 0; y < height; y++) {
  tryEnqueue(0, y);
  tryEnqueue(width - 1, y);
}

while (qHead < qTail) {
  const idx = queue[qHead++];
  const x = idx % width;
  const y = (idx / width) | 0;
  tryEnqueue(x + 1, y);
  tryEnqueue(x - 1, y);
  tryEnqueue(x, y + 1);
  tryEnqueue(x, y - 1);
}

let bgCount = 0;
for (let i = 0; i < mask.length; i++) {
  if (mask[i]) {
    data[i * channels + 3] = 0;
    bgCount++;
  }
}
console.log(`Marked ${bgCount} / ${mask.length} pixels as transparent background (${((bgCount / mask.length) * 100).toFixed(1)}%)`);

// Feather the new alpha edge slightly so the rounded-square boundary stays anti-aliased
// instead of a hard-cut transparent/opaque line.
const alphaOnly = Buffer.alloc(width * height);
for (let i = 0; i < width * height; i++) {
  alphaOnly[i] = data[i * channels + 3];
}
const blurredAlpha = await sharp(alphaOnly, { raw: { width, height, channels: 1 } })
  .blur(1.2)
  .raw()
  .toBuffer();
for (let i = 0; i < width * height; i++) {
  // Only let feathering soften pixels that were near the boundary; keep fully-background
  // pixels transparent and fully-interior pixels opaque to avoid a visible white halo.
  if (mask[i]) {
    data[i * channels + 3] = Math.min(data[i * channels + 3], blurredAlpha[i]);
  } else {
    data[i * channels + 3] = Math.max(data[i * channels + 3], blurredAlpha[i]);
  }
}

await sharp(data, { raw: { width, height, channels } }).png().toFile(input);
console.log('Wrote transparent-background master to', input);
