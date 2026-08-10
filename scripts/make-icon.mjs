// Builds build/icon.ico (multi-resolution) from public/favicon.ico.
//
// public/favicon.ico holds a single 256x256 PNG. Windows will downscale that
// for the taskbar and Explorer's small-icon views, which looks muddy — a real
// application icon carries a purpose-made image at each size. This script
// renders all seven standard sizes with sharp and assembles a proper ICO.
//
//   node scripts/make-icon.mjs
//
// Output is committed, so packaging never depends on sharp being installed.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("public/favicon.ico");
const OUT = path.resolve("build/icon.ico");

// Sizes Windows actually asks for. Vista+ reads PNG-compressed entries, but the
// shell is happiest with uncompressed DIBs at the small sizes, so we only use
// PNG where the size saving matters.
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_FROM = 64;

/** 32bpp bottom-up DIB + AND mask, i.e. the classic ICO image format. */
function encodeDib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight — XOR bitmap + AND mask
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // DIB rows run bottom-to-top.
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // 1bpp AND mask, rows padded to 4 bytes. The alpha channel already carries
  // transparency on every Windows we target, so the mask is all-opaque zeros.
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);

  header.writeUInt32LE(xor.length + mask.length, 20); // biSizeImage
  return Buffer.concat([header, xor, mask]);
}

/** sharp cannot decode .ico, so pull the largest embedded image out by hand. */
function largestImageInIco(ico) {
  const count = ico.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const width = ico[at] || 256;
    const size = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    if (!best || width > best.width) best = { width, data: ico.subarray(offset, offset + size) };
  }
  if (!best) throw new Error(`${SRC} contains no images`);
  const isPng = best.data
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) {
    throw new Error(
      `${SRC} stores its ${best.width}px image as a raw DIB; re-export the favicon as a PNG-based .ico`,
    );
  }
  return best.data;
}

const src = largestImageInIco(await readFile(SRC));

const images = [];
for (const size of SIZES) {
  const resized = sharp(src, { pages: 1 }).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (size >= PNG_FROM) {
    images.push({ size, data: await resized.png({ compressionLevel: 9 }).toBuffer() });
  } else {
    const { data } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    images.push({ size, data: encodeDib(data, size) });
  }
}

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(images.length, 4);

const entries = Buffer.alloc(16 * images.length);
let offset = dir.length + entries.length;
images.forEach((img, i) => {
  const at = i * 16;
  entries[at] = img.size === 256 ? 0 : img.size; // 0 means 256
  entries[at + 1] = img.size === 256 ? 0 : img.size;
  entries[at + 2] = 0; // palette size
  entries[at + 3] = 0; // reserved
  entries.writeUInt16LE(1, at + 4); // planes
  entries.writeUInt16LE(32, at + 6); // bits per pixel
  entries.writeUInt32LE(img.data.length, at + 8);
  entries.writeUInt32LE(offset, at + 12);
  offset += img.data.length;
});

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.concat([dir, entries, ...images.map((i) => i.data)]));

console.log(`icon: ${images.length} sizes (${SIZES.join(", ")}) -> ${OUT}`);
