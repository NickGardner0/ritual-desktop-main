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

const width = 700;
const height = 500;

const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="64" y1="36" x2="640" y2="468" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FBFBFC"/>
      <stop offset="0.56" stop-color="#F5F6F8"/>
      <stop offset="1" stop-color="#EFF1F4"/>
    </linearGradient>
    <radialGradient id="leftGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(150 250) rotate(90) scale(106 106)">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.82"/>
      <stop offset="0.5" stop-color="#FBFBFC" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#F3F4F6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rightGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(550 250) rotate(90) scale(106 106)">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.82"/>
      <stop offset="0.5" stop-color="#FBFBFC" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#F3F4F6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="180" y1="88" x2="520" y2="414" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.42"/>
      <stop offset="0.45" stop-color="#ECEEF2" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#E2E5EA" stop-opacity="0.18"/>
    </linearGradient>
    <filter id="softBlur" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="arrowShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#C3C8D0" flood-opacity="0.08"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <g opacity="0.42" filter="url(#softBlur)">
    <ellipse cx="350" cy="262" rx="190" ry="108" fill="url(#sheen)"/>
    <ellipse cx="350" cy="388" rx="142" ry="64" fill="#ECEEF1"/>
  </g>

  <circle cx="150" cy="250" r="96" fill="url(#leftGlow)"/>
  <circle cx="550" cy="250" r="96" fill="url(#rightGlow)"/>

  <g filter="url(#arrowShadow)" opacity="0.82">
    <path d="M323 250H381" stroke="#A6ACB5" stroke-width="5" stroke-linecap="round"/>
    <path d="M366 233L383 250L366 267" stroke="#A6ACB5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

await sharp(Buffer.from(svg))
  .png()
  .toFile(outputPath);

console.log(path.relative(repoRoot, outputPath));
