#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const outputIndex = argv.indexOf('--output');
if (outputIndex < 0 || !argv[outputIndex + 1]) {
  throw new Error('Usage: merge-desktop-updater-manifests.mjs <manifest...> --output <latest.json>');
}
const inputs = argv.slice(0, outputIndex);
if (inputs.length < 2) throw new Error('Both arm64 and x86_64 updater manifests are required.');
const manifests = await Promise.all(inputs.map(async (input) => (
  JSON.parse(await readFile(path.resolve(input), 'utf8'))
)));
const versions = new Set(manifests.map((manifest) => manifest.version));
if (versions.size !== 1) throw new Error(`Updater version mismatch: ${[...versions].join(', ')}`);
const platforms = Object.assign({}, ...manifests.map((manifest) => manifest.platforms || {}));
for (const required of ['darwin-aarch64', 'darwin-x86_64']) {
  const entry = platforms[required];
  if (!entry?.url || !entry?.signature) throw new Error(`Missing complete ${required} updater entry.`);
}
const pubDate = manifests.map((manifest) => manifest.pub_date).filter(Boolean).sort().at(-1);
const merged = {
  version: manifests[0].version,
  notes: manifests[0].notes || `Desktop release ${manifests[0].version}.`,
  pub_date: pubDate,
  platforms,
};
await writeFile(path.resolve(argv[outputIndex + 1]), `${JSON.stringify(merged, null, 2)}\n`);
console.log(`Merged updater manifest for ${Object.keys(platforms).sort().join(', ')}.`);
