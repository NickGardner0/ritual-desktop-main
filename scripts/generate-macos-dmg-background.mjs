#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const repoRoot = process.cwd();
const outputPath =
  process.argv[2] ??
  path.join(
    repoRoot,
    "apps/desktop/src-tauri/dmg/ritual-dmg-background.png",
  );

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
    font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
    font-size="14"
    font-weight="600"
    letter-spacing="-0.12"
    text-anchor="middle"
  >Drag Ritual to the Applications folder to install</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

await sharp(Buffer.from(svg))
  .png()
  .toFile(outputPath);

console.log(path.relative(repoRoot, outputPath));
