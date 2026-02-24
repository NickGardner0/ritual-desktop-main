#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');
const OUTPUT_SPRITE = path.join(
  ROOT,
  'apps',
  'dashboard',
  'public',
  'icons',
  'lucide-sprite.svg',
);
const OUTPUT_NAMES = path.join(
  ROOT,
  'apps',
  'dashboard',
  'data',
  'lucide-icon-names.json',
);

const escapeAttribute = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const iconNodeToSvgBody = (iconNode) =>
  iconNode
    .map(([tag, attrs]) => {
      const attrString = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
        .join(' ');
      return `<${tag} ${attrString}></${tag}>`;
    })
    .join('');

const extractIconNode = (source) => {
  const match = source.match(/const __iconNode = (\[[\s\S]*?\n\]);/m);
  if (!match) return null;
  // Source is trusted dependency code in node_modules.
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${match[1]});`)();
};

const main = async () => {
  const files = (await fs.readdir(ICONS_DIR))
    .filter((file) => file.endsWith('.js') && file !== 'index.js')
    .sort((a, b) => a.localeCompare(b));

  const symbolParts = [];
  const names = [];

  for (const file of files) {
    const iconName = file.replace(/\.js$/, '');
    const absPath = path.join(ICONS_DIR, file);
    const source = await fs.readFile(absPath, 'utf8');
    const iconNode = extractIconNode(source);

    if (!iconNode) {
      // Skip helper files that are not icon modules.
      continue;
    }

    const body = iconNodeToSvgBody(iconNode);
    names.push(iconName);
    symbolParts.push(`<symbol id="${iconName}" viewBox="0 0 24 24">${body}</symbol>`);
  }

  const sprite = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
    '<defs>',
    ...symbolParts,
    '</defs>',
    '</svg>',
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(OUTPUT_SPRITE), { recursive: true });
  await fs.mkdir(path.dirname(OUTPUT_NAMES), { recursive: true });
  await fs.writeFile(OUTPUT_SPRITE, sprite, 'utf8');
  await fs.writeFile(OUTPUT_NAMES, `${JSON.stringify(names, null, 2)}\n`, 'utf8');

  console.log(`Generated ${names.length} Lucide icons`);
  console.log(`Sprite: ${OUTPUT_SPRITE}`);
  console.log(`Names: ${OUTPUT_NAMES}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
