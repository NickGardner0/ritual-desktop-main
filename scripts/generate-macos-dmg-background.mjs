#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const repoRoot = process.cwd();
const outputPng =
  process.argv[2] ??
  path.join(repoRoot, "apps/desktop/src-tauri/dmg/ritual-dmg-background.png");
const outputDir = path.dirname(outputPng);
const output2xPng = path.join(outputDir, "ritual-dmg-background@2x.png");
const outputTiff = path.join(outputDir, "ritual-dmg-background.tiff");

const width = 640;
const height = 440;

const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#FEFEFE"/>

  <g opacity="0.9">
    <path d="M248 200H392" stroke="#7A7A7A" stroke-width="9" stroke-linecap="round"/>
    <path d="M368 176L394 200L368 224" stroke="#7A7A7A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <text
    x="320"
    y="384"
    fill="#333333"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="14"
    font-weight="500"
    letter-spacing="0"
    text-anchor="middle"
    text-rendering="geometricPrecision"
  >Drag Ritual to the Applications folder to install</text>
</svg>
`;

fs.mkdirSync(outputDir, { recursive: true });

const svgBuffer = Buffer.from(svg);

async function renderPng(filePath, density) {
  await sharp(svgBuffer, { density })
    .png()
    .withMetadata({ density })
    .toFile(filePath);
}

await renderPng(outputPng, 72);
await renderPng(output2xPng, 144);

let wroteTiff = false;
try {
  execFileSync(
    "tiffutil",
    ["-cathidpicheck", outputPng, output2xPng, "-out", outputTiff],
    { stdio: "pipe" },
  );
  wroteTiff = fs.existsSync(outputTiff);
} catch {
  wroteTiff = false;
}

console.log(path.relative(repoRoot, outputPng));
console.log(path.relative(repoRoot, output2xPng));
if (wroteTiff) {
  console.log(path.relative(repoRoot, outputTiff));
}
