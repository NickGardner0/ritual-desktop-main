#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { validateTrackingTrial } from '../tools/performance/launch-budget-core.mjs';
import { parseDesktopLaunchLog, trialsFromLaunchEvents } from '../tools/performance/parse-desktop-launch-log.mjs';

const REQUIRED_TRIAL_FIELDS = [
  'raw_artifact_sha256',
  'app_artifact_sha256',
  'watcher_readiness_time_ms',
  'watcher_pid',
  'watcher_rss_bytes',
];

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function positiveCount(name, fallback) {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataRootForChannel(channel) {
  if (channel === 'production') return path.join(os.homedir(), '.ritual');
  if (channel === 'qa') return path.join(os.homedir(), '.ritual-qa');
  if (channel === 'development') return path.join(os.homedir(), '.ritual-dev');
  throw new Error(`Unsupported channel: ${channel}`);
}

async function latestDesktopLog(dataRoot) {
  const logDirectory = path.join(dataRoot, 'logs');
  const entries = await fs.readdir(logDirectory);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.startsWith('ritual-desktop.log'))
      .map(async (entry) => {
        const file = path.join(logDirectory, entry);
        return { file, modified: (await fs.stat(file)).mtimeMs };
      }),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) throw new Error(`No desktop log exists in ${logDirectory}`);
  return candidates[0].file;
}

async function assertTrackingPreference(dataRoot, tracking) {
  const preferencePath = path.join(dataRoot, 'watcher_config.json');
  let state = 'never_enabled';
  try {
    const value = JSON.parse(await fs.readFile(preferencePath, 'utf8'));
    state = value.schema_version === 2 ? value.state : 'enabled';
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (tracking === 'enabled' && state !== 'enabled') {
    throw new Error(`Tracking capture requires an enabled watcher preference; found ${state}`);
  }
  if (tracking === 'disabled' && state === 'enabled') {
    throw new Error('Disabled capture refuses to run while the watcher preference is enabled');
  }
  return state;
}

async function waitForTrialLog(logPath, offset, tracking) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const contents = await fs.readFile(logPath, 'utf8');
    const snippet = contents.slice(offset);
    const hasNativeReady = snippet.includes('event="launch:native_ready"');
    const hasSummary = snippet.includes('event="launch:summary"');
    const hasWatcherSample = snippet.includes('event="launch:watcher_rss_sampled"');
    if (hasNativeReady && hasSummary && (tracking !== 'enabled' || hasWatcherSample)) return snippet;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${tracking} launch telemetry`);
}

async function captureTrial(context, kind, index) {
  try {
    run('osascript', ['-e', `tell application "${context.productName}" to quit`]);
  } catch {
    // The first trial commonly starts with no running app.
  }
  await delay(kind === 'cold' ? 2_000 : 750);
  const logPath = await latestDesktopLog(context.dataRoot);
  const before = await fs.readFile(logPath, 'utf8');
  run('open', ['-na', context.appPath]);
  const raw = await waitForTrialLog(logPath, before.length, context.tracking);
  const trialId = `${context.channel}-${context.architecture}-${context.tracking}-${kind}-${index}`;
  const rawFile = path.join(context.outputDirectory, `${trialId}.log`);
  await fs.writeFile(rawFile, raw);
  const parsed = trialsFromLaunchEvents(parseDesktopLaunchLog(raw));
  if (parsed.length !== 1) {
    throw new Error(`${trialId} expected one launch summary, found ${parsed.length}`);
  }
  const trial = {
    ...parsed[0],
    trial_id: trialId,
    provenance: 'live',
    raw_artifact_id: path.relative(process.cwd(), rawFile),
    raw_artifact_sha256: createHash('sha256').update(raw).digest('hex'),
    app_artifact_sha256: context.appArtifactSha256,
    source_sha: context.sourceSha,
    app_version: context.appVersion,
    architecture: context.architecture,
    channel: context.channel,
    tracking_state: context.trackingState,
    kind,
  };
  const failures = validateTrackingTrial(trial, { release: true });
  for (const field of REQUIRED_TRIAL_FIELDS) {
    if (!(field in trial)) failures.push(`${trialId} is missing ${field}`);
  }
  if (failures.length) throw new Error(`${trialId} failed evidence validation:\n- ${failures.join('\n- ')}`);
  return trial;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Launch evidence capture requires macOS');
  const channel = option('--channel', 'production');
  const tracking = option('--tracking');
  if (!['enabled', 'disabled'].includes(tracking)) {
    throw new Error('--tracking must be enabled or disabled');
  }
  const productName = channel === 'production' ? 'Ritual' : channel === 'qa' ? 'Ritual QA' : 'Ritual Dev';
  const appPath = path.resolve(option('--app', `/Applications/${productName}.app`));
  const dataRoot = dataRootForChannel(channel);
  const trackingState = await assertTrackingPreference(dataRoot, tracking);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const outputDirectory = path.resolve(option('--output', path.join('artifacts', 'launch-evidence', stamp)));
  await fs.mkdir(outputDirectory, { recursive: true });
  const architecture = run('uname', ['-m']) === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const appVersion = run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(appPath, 'Contents', 'Info.plist')]);
  const executableName = run('plutil', ['-extract', 'CFBundleExecutable', 'raw', path.join(appPath, 'Contents', 'Info.plist')]);
  const appArtifactSha256 = createHash('sha256')
    .update(await fs.readFile(path.join(appPath, 'Contents', 'MacOS', executableName)))
    .digest('hex');
  let sourceSha;
  try {
    sourceSha = run('plutil', ['-extract', 'RitualSourceSHA', 'raw', path.join(appPath, 'Contents', 'Info.plist')]);
  } catch {
    throw new Error(
      'The app does not declare RitualSourceSHA. Refusing to attribute an installed/stale binary to the current checkout.',
    );
  }
  if (!/^[a-f0-9]{40}$/i.test(sourceSha)) throw new Error(`Invalid RitualSourceSHA in app: ${sourceSha}`);
  const expectedSourceSha = option('--source-sha', run('git', ['rev-parse', 'HEAD']));
  if (sourceSha !== expectedSourceSha) {
    throw new Error(`Installed app source SHA ${sourceSha} does not match requested evidence SHA ${expectedSourceSha}`);
  }
  const appChannel = run('plutil', ['-extract', 'RitualChannel', 'raw', path.join(appPath, 'Contents', 'Info.plist')]);
  const appTarget = run('plutil', ['-extract', 'RitualTargetTriple', 'raw', path.join(appPath, 'Contents', 'Info.plist')]);
  if (appChannel !== channel || appTarget !== architecture) {
    throw new Error(`Installed app identity is ${appChannel}/${appTarget}; requested ${channel}/${architecture}`);
  }
  const executableInspection = run('/usr/bin/file', [path.join(appPath, 'Contents', 'MacOS', executableName)]);
  const expectedMachOArch = architecture === 'aarch64-apple-darwin' ? 'arm64' : 'x86_64';
  if (!executableInspection.includes('Mach-O') || !executableInspection.includes(expectedMachOArch)) {
    throw new Error(`Installed app executable architecture is invalid: ${executableInspection}`);
  }
  const context = {
    appPath,
    appArtifactSha256,
    appVersion,
    architecture,
    channel,
    dataRoot,
    outputDirectory,
    productName,
    sourceSha,
    tracking,
    trackingState,
  };

  const trials = [];
  for (const [kind, count] of [['cold', positiveCount('--cold', 5)], ['warm', positiveCount('--warm', 5)]]) {
    for (let index = 1; index <= count; index += 1) {
      console.log(`Capturing ${kind} ${index}/${count} (${tracking})...`);
      trials.push(await captureTrial(context, kind, index));
    }
  }
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify({ schema_version: 2, captured_at: new Date().toISOString(), trials }, null, 2)}\n`,
  );
  console.log(`Captured ${trials.length} validated live trials in ${manifestPath}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
