import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

const nativePath =
  process.env.MDV_NATIVE_CAPTURE ?? "parity-artifacts/native-mdv/native-window.png";
const tauriPath = process.env.MDV_TAURI_CAPTURE ?? "parity-artifacts/tauri/tauri-window.png";

const nativeImage = PNG.sync.read(await readFile(nativePath));
const tauriImage = PNG.sync.read(await readFile(tauriPath));

const native = describeImage(nativeImage);
const tauri = describeImage(tauriImage);

console.log("native", native);
console.log("tauri ", tauri);

const failures = [];
for (const [name, value] of Object.entries(tauri.regions)) {
  const baseline = native.regions[name];
  if (!baseline) continue;
  const delta = Math.abs(value.luma - baseline.luma);
  if (delta > 70) failures.push(`${name} luminance drift ${delta.toFixed(1)}`);
}

if (!native.hasThreePanels) failures.push("native capture does not expose three panels");
if (!tauri.hasThreePanels) failures.push("tauri capture does not expose three panels");
if (native.regions.document.luma < 30) {
  failures.push("native document region is black; native Markdown pane was not captured");
}
if (tauri.darkTextRatio < 0.002) failures.push("tauri capture has too little visible text");

if (failures.length > 0) {
  console.error(`visual comparison failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

function describeImage(image) {
  const { width, height } = image;
  const regions = {
    titlebar: sample(image, 0, 0, width, Math.round(height * 0.075)),
    left: sample(image, 0, Math.round(height * 0.075), Math.round(width * 0.24), height),
    document: sample(
      image,
      Math.round(width * 0.24),
      Math.round(height * 0.075),
      Math.round(width * 0.76),
      height,
    ),
    right: sample(image, Math.round(width * 0.76), Math.round(height * 0.075), width, height),
  };
  const verticalEdges = countVerticalEdges(image);
  return {
    width,
    height,
    regions,
    verticalEdges,
    hasThreePanels: verticalEdges >= 2,
    darkTextRatio: darkTextRatio(image),
  };
}

function sample(image, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = (y * image.width + x) * 4;
      r += image.data[i];
      g += image.data[i + 1];
      b += image.data[i + 2];
      count++;
    }
  }
  r /= count;
  g /= count;
  b /= count;
  return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

function countVerticalEdges(image) {
  const { width, height } = image;
  const y0 = Math.round(height * 0.12);
  const y1 = Math.round(height * 0.92);
  let edges = 0;
  for (let x = 4; x < width - 4; x++) {
    let delta = 0;
    for (let y = y0; y < y1; y += 12) {
      delta += Math.abs(lumaAt(image, x - 2, y) - lumaAt(image, x + 2, y));
    }
    if (delta / ((y1 - y0) / 12) > 18) {
      edges++;
      x += 20;
    }
  }
  return edges;
}

function darkTextRatio(image) {
  let dark = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 3) {
    for (let x = 0; x < image.width; x += 3) {
      if (lumaAt(image, x, y) < 80) dark++;
      count++;
    }
  }
  return dark / count;
}

function lumaAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
}
