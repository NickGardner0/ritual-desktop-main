#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const targetIndex = argv.indexOf('--target');
const target = targetIndex >= 0 ? argv[targetIndex + 1] : '';
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error('Use --target aarch64-apple-darwin or --target x86_64-apple-darwin.');
}
const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
if (config.bundle?.macOS?.minimumSystemVersion !== '14.0') {
  throw new Error('Desktop minimum macOS version must remain explicit at 14.0.');
}
const result = spawnSync(process.execPath, ['scripts/verify-desktop-sidecars.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, RITUAL_REQUIRE_SIDECAR_TRIPLE: target },
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Desktop release dry-run gate passed for ${target}.`);
