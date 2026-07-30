#!/usr/bin/env node
/*
 * Turn a local headshot into the self-contained ASCII SVG used by this
 * profile. It deliberately uses Sharp only: the source photo never leaves the
 * local machine and the generated SVG can be committed directly to GitHub.
 *
 * Usage:
 *   NODE_PATH=/path/to/node_modules node scripts/make_portrait.cjs photo.png ascii.svg --crop 100,75,430,560
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const RAMP = " .`:-=+*cs#%@";
const COLS = 90;
const ROW_RATIO = 0.48;
const CHAR_W = 7.74;
const FONT_SIZE = 12.9;
const LINE_H = 15;
const ROW_DELAY = 0.09;

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function parseCrop(value) {
  if (!value) return undefined;
  const values = value.split(",").map((part) => Number.parseInt(part, 10));
  if (values.length !== 4 || values.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error("--crop must be left,top,right,bottom with non-negative pixel values.");
  }

  const [left, top, right, bottom] = values;
  if (right <= left || bottom <= top) throw new Error("--crop must have a positive width and height.");
  return { left, top, width: right - left, height: bottom - top };
}

function svg(lines) {
  const pad = 14;
  const width = Math.round(COLS * CHAR_W + pad * 2);
  const height = lines.length * LINE_H + pad * 2;
  const rows = lines.map((line, index) => {
    const y = pad + index * LINE_H;
    const durationStart = (index * ROW_DELAY).toFixed(2);
    const durationEnd = ((index + 1) * ROW_DELAY).toFixed(2);
    const rowWidth = Math.max(line.length, 1) * CHAR_W;
    return `<clipPath id="row-${index}"><rect x="${pad}" y="${y}" height="${LINE_H}" width="0"><animate attributeName="width" from="0" to="${rowWidth.toFixed(1)}" begin="${durationStart}s" dur="${ROW_DELAY}s" fill="freeze" /></rect></clipPath><g clip-path="url(#row-${index})"><text xml:space="preserve" x="${pad}" y="${(y + 11.2).toFixed(1)}" class="portrait" font-size="${FONT_SIZE}">${escapeXml(line)}</text></g><rect y="${y + 1}" width="6" height="12" class="portrait" opacity="0"><animate attributeName="x" from="${pad}" to="${(pad + rowWidth).toFixed(1)}" begin="${durationStart}s" dur="${ROW_DELAY}s" fill="freeze" /><set attributeName="opacity" to="0.8" begin="${durationStart}s" /><set attributeName="opacity" to="0" begin="${durationEnd}s" /></rect>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"><style>.portrait{fill:#6e7681}@media(prefers-color-scheme:dark){.portrait{fill:#c9d1d9}}</style>${rows}</svg>`;
}

function isPortraitSubject(column, row, width, height) {
  const x = column / Math.max(width - 1, 1);
  const y = row / Math.max(height - 1, 1);
  const head = ((x - 0.51) / 0.35) ** 2 + ((y - 0.34) / 0.32) ** 2 <= 1;
  const neck = y >= 0.5 && y <= 0.67 && Math.abs(x - 0.51) <= 0.2;
  const torsoHalfWidth = Math.min(0.68, 0.24 + Math.max(0, y - 0.53) * 1.05);
  const torso = y >= 0.53 && Math.abs(x - 0.5) <= torsoHalfWidth;
  return head || neck || torso;
}

async function main() {
  const [source, output = "ascii.svg", ...options] = process.argv.slice(2);
  if (!source) throw new Error("Usage: make_portrait.cjs photo.png [ascii.svg] [--crop left,top,right,bottom]");
  const cropFlag = options.indexOf("--crop");
  const crop = cropFlag >= 0 ? parseCrop(options[cropFlag + 1]) : undefined;
  if (cropFlag >= 0 && !options[cropFlag + 1]) throw new Error("--crop requires a value.");

  let image = sharp(source).rotate();
  if (crop) image = image.extract(crop);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("Could not read the source image dimensions.");
  const rows = Math.max(1, Math.round(COLS * (height / width) * ROW_RATIO));
  const { data } = await image
    .resize(COLS, rows, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lines = [];
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let column = 0; column < COLS; column += 1) {
      const luminance = isPortraitSubject(column, row, COLS, rows)
        ? data[row * COLS + column]
        : 255;
      const darkness = Math.pow(Math.max(0, 1 - luminance / 255), 1.35);
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(darkness * RAMP.length))];
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();

  fs.writeFileSync(output, svg(lines), "utf8");
  console.log(`Wrote ${path.resolve(output)} (${lines.length} rows).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
