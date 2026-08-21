import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const windowPath =
  process.env.MDV_NATIVE_CAPTURE ?? "parity-artifacts/native-mdv/native-window.png";
const documentPath = windowPath.replace(/\.png$/, "-document.png");

const windowImage = PNG.sync.read(await readFile(windowPath));
const documentImage = PNG.sync.read(await readFile(documentPath));

const scale = windowImage.width / 1080;
const target = {
  x: Math.round(256 * scale),
  y: Math.round(52 * scale),
  width: Math.round(583 * scale),
  height: Math.round(616 * scale),
};

for (let y = 0; y < target.height; y++) {
  for (let x = 0; x < target.width; x++) {
    const sourceIndex = (y * documentImage.width + x) * 4;
    const targetIndex = ((target.y + y) * windowImage.width + target.x + x) * 4;
    const sourceLuma = lumaAt(documentImage, x, y);
    const isTransparentBackground = sourceLuma < 20 && brightestNeighbor(documentImage, x, y) < 200;
    if (isTransparentBackground) {
      windowImage.data[targetIndex] = 255;
      windowImage.data[targetIndex + 1] = 255;
      windowImage.data[targetIndex + 2] = 255;
    } else {
      windowImage.data[targetIndex] = documentImage.data[sourceIndex];
      windowImage.data[targetIndex + 1] = documentImage.data[sourceIndex + 1];
      windowImage.data[targetIndex + 2] = documentImage.data[sourceIndex + 2];
    }
    windowImage.data[targetIndex + 3] = 255;
  }
}

await writeFile(windowPath, PNG.sync.write(windowImage));
console.log(`composited native Markdown pane into ${windowPath}`);

function brightestNeighbor(image, x, y) {
  let brightest = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
      brightest = Math.max(brightest, lumaAt(image, nx, ny));
    }
  }
  return brightest;
}

function lumaAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
}
