import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "public/assets/budg-mark.svg"), "utf8");
// Home-screen platforms apply their own rounded masks. Give them a solid tile,
// while the website and browser favicon keep the vector's rounded corners.
const square = source.replace('rx="16"', 'rx="0"');
const render = (svg, size) => new Resvg(svg, {
  fitTo: { mode: "width", value: size },
  font: { loadSystemFonts: false },
}).render().asPng();
const save = (name, contents) => writeFile(resolve(root, "public", name), contents);

await mkdir(resolve(root, "public/icons"), { recursive: true });
await save("assets/logo-mark.svg", source);
await save("assets/budg-logo.png", render(source, 512));
await save("apple-touch-icon.png", render(square, 180));
await save("icons/icon-192.png", render(square, 192));
await save("icons/icon-512.png", render(square, 512));
// All foreground geometry fits in the maskable icon's central safe circle.
await save("icons/icon-maskable-512.png", render(square, 512));

// Classic 32-bit bitmap frames work in favicon decoders that reject PNG frames.
function bitmapFrame(size) {
  const pixels = new Resvg(source, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  }).render().pixels;
  const maskStride = Math.ceil(size / 32) * 4;
  const colorBytes = size * size * 4;
  const bitmap = Buffer.alloc(40 + colorBytes + maskStride * size);
  bitmap.writeUInt32LE(40, 0);
  bitmap.writeInt32LE(size, 4);
  bitmap.writeInt32LE(size * 2, 8);
  bitmap.writeUInt16LE(1, 12);
  bitmap.writeUInt16LE(32, 14);
  bitmap.writeUInt32LE(colorBytes + maskStride * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const row = size - 1 - y;
      const dst = 40 + (row * size + x) * 4;
      bitmap[dst] = pixels[src + 2];
      bitmap[dst + 1] = pixels[src + 1];
      bitmap[dst + 2] = pixels[src];
      bitmap[dst + 3] = pixels[src + 3];
      if (pixels[src + 3] === 0) {
        bitmap[40 + colorBytes + row * maskStride + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }
  return bitmap;
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = sizes.map(bitmapFrame);
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size;
  directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frames[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
});
await save("favicon.ico", Buffer.concat([directory, ...frames]));
console.log("BUDG: SVG, PNG, iPhone, maskable icons and multi-size favicon generated.");
