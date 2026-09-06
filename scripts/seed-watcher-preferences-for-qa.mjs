#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 2;

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

export function normalizeWatcherPreference(value) {
  if (value?.schema_version === SCHEMA_VERSION) {
    if (!['never_enabled', 'enabled', 'disabled_by_user'].includes(value.state)) {
      throw new Error(`Unsupported watcher preference state: ${String(value.state)}`);
    }
    if (value.state === 'enabled' && !value.config) {
      throw new Error('Enabled watcher preference is missing its configuration');
    }
    return {
      schema_version: SCHEMA_VERSION,
      state: value.state,
      config: value.config ?? null,
    };
  }
  if (value?.device_id && value?.user_id) {
    return {
      schema_version: SCHEMA_VERSION,
      state: 'enabled',
      config: value,
    };
  }
  throw new Error('Source is neither a watcher preference v2 file nor a legacy watcher config');
}

export async function seedWatcherPreferences({ sourceRoot, targetRoot, force = false }) {
  const sourcePath = path.join(sourceRoot, 'watcher_config.json');
  const targetPath = path.join(targetRoot, 'watcher_config.json');
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const preference = normalizeWatcherPreference(source);

  if (!force) {
    try {
      await fs.access(targetPath);
      throw new Error(`QA watcher preference already exists at ${targetPath}; pass --force to replace it`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  await fs.mkdir(targetRoot, { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(preference, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, targetPath);
  return { sourcePath, targetPath, state: preference.state };
}

async function main() {
  const sourceRoot = optionValue(process.argv, '--source-root') ?? path.join(os.homedir(), '.ritual');
  const targetRoot = optionValue(process.argv, '--target-root') ?? path.join(os.homedir(), '.ritual-qa');
  const result = await seedWatcherPreferences({
    sourceRoot,
    targetRoot,
    force: process.argv.includes('--force'),
  });
  console.log(`Seeded QA watcher preference (${result.state}) at ${result.targetPath}.`);
  console.log('No activity database, captured activity, auth token, vault, or outbox data was copied.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
