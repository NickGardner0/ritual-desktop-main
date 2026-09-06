#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const channelIndex = process.argv.indexOf('--channel');
const channel = channelIndex >= 0 ? process.argv[channelIndex + 1] : 'development';
if (!['production', 'qa', 'development'].includes(channel)) {
  throw new Error(`Unsupported desktop channel: ${channel}`);
}
const productName = channel === 'production' ? 'Ritual' : channel === 'qa' ? 'Ritual QA' : 'Ritual Dev';
const configName = channel === 'qa' ? 'tauri.qa.conf.json' : 'tauri.dev.conf.json';
const binaryIndex = process.argv.indexOf('--binary');
let binary = binaryIndex >= 0 ? path.resolve(process.argv[binaryIndex + 1]) : '';

if (!binary && channel === 'production') {
  binary = '/Applications/Ritual.app/Contents/MacOS/Ritual';
}
if (!binary) {
  const build = spawnSync(
    '../../node_modules/.bin/tauri',
    ['build', '--debug', '--no-bundle', '--config', `src-tauri/${configName}`, '--features', 'qa-tools'],
    {
      cwd: 'apps/desktop',
      encoding: 'utf8',
      env: {
        ...process.env,
        RITUAL_CHANNEL: channel,
        RITUAL_ENV: channel === 'qa' ? 'staging' : 'development',
      },
    },
  );
  if (build.status !== 0) {
    process.stderr.write(build.stderr || build.stdout);
    process.exit(build.status || 1);
  }
  binary = path.resolve('apps/desktop/src-tauri/target/debug', productName);
}
if (!existsSync(binary)) throw new Error(`Desktop diagnostics binary is missing: ${binary}`);

const result = spawnSync(
  binary,
  ['--diagnostics'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      RITUAL_CHANNEL: channel,
      RITUAL_ENV: channel === 'production' ? 'production' : channel === 'qa' ? 'staging' : 'development',
    },
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
const marker = result.stdout.indexOf('{\n  "schemaVersion"');
if (marker < 0) {
  process.stderr.write(result.stdout);
  throw new Error('Desktop diagnostics JSON was not emitted.');
}
process.stdout.write(`${result.stdout.slice(marker).trim()}\n`);
