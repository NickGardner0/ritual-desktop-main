#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? args[targetIndex + 1] : '';
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error('Use --target aarch64-apple-darwin or --target x86_64-apple-darwin.');
}

const binariesDir = 'apps/desktop/src-tauri/binaries';
const sourceLock = JSON.parse(readFileSync(join(binariesDir, 'sidecar-lock.json'), 'utf8'));
const sidecars = {};

for (const [name, source] of Object.entries(sourceLock.sidecars ?? {})) {
  const targetSpec = source.targets?.[target];
  if (!targetSpec?.file) {
    throw new Error(`No ${target} lock entry exists for ${name}.`);
  }
  const path = join(binariesDir, targetSpec.file);
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  sidecars[name] = { targets: { [target]: { sha256 } } };
}

if (Object.keys(sidecars).length === 0) {
  throw new Error('The source sidecar lock contains no sidecars.');
}

process.stdout.write(JSON.stringify({ sidecars }));
