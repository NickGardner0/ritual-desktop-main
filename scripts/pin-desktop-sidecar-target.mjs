#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const index = process.argv.indexOf('--target');
const target = index >= 0 ? process.argv[index + 1] : '';
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error('A supported --target is required.');
}
const lockPath = path.resolve('apps/desktop/src-tauri/binaries/sidecar-lock.json');
const binaryRoot = path.dirname(lockPath);
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
for (const name of ['ritual-watcher', 'ritual-vision-helper']) {
  const file = `${name}-${target}`;
  const bytes = readFileSync(path.join(binaryRoot, file));
  lock.sidecars[name].targets[target] = {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
lock.shippedTargets = [...new Set([...(lock.shippedTargets || []), target])].sort();
if (lock.externalPendingTargets) delete lock.externalPendingTargets[target];
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Pinned ${target} watcher and vision helper in sidecar-lock.json.`);
