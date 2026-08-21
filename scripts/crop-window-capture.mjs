import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const [sourcePath, outputPath, x, y, width, height, displayWidth, displayHeight] =
  process.argv.slice(2);

if (!displayHeight) {
  throw new Error(
    "usage: crop-window-capture source output x y width height displayWidth displayHeight",
  );
}

const source = PNG.sync.read(await readFile(sourcePath));
const scaleX = source.width / Number(displayWidth);
const scaleY = source.height / Number(displayHeight);
const crop = {
  x: Math.round(Number(x) * scaleX),
  y: Math.round(Number(y) * scaleY),
  width: Math.round(Number(width) * scaleX),
  height: Math.round(Number(height) * scaleY),
};

const target = new PNG({ width: crop.width, height: crop.height });
for (let row = 0; row < crop.height; row++) {
  for (let col = 0; col < crop.width; col++) {
    const sourceIndex = ((crop.y + row) * source.width + crop.x + col) * 4;
    const targetIndex = (row * crop.width + col) * 4;
    target.data[targetIndex] = source.data[sourceIndex];
    target.data[targetIndex + 1] = source.data[sourceIndex + 1];
    target.data[targetIndex + 2] = source.data[sourceIndex + 2];
    target.data[targetIndex + 3] = source.data[sourceIndex + 3];
  }
}

await writeFile(outputPath, PNG.sync.write(target));
