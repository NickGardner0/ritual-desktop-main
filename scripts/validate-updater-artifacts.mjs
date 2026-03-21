import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { latest: '', platform: 'darwin-aarch64', checkUrls: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--latest') {
      args.latest = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--platform') {
      args.platform = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--check-urls') {
      args.checkUrls = true;
    }
  }
  return args;
}

async function readLatestJson(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const response = await fetch(ref, { redirect: 'follow' });
    if (!response.ok) {
      fail(`Failed to fetch latest.json: ${response.status} ${response.statusText}`);
    }
    return { source: ref, json: await response.json() };
  }

  const resolvedPath = path.resolve(ref);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  return { source: resolvedPath, json: JSON.parse(raw) };
}

function normalizePlatformEntry(latestJson, platform) {
  if (latestJson && typeof latestJson === 'object' && latestJson.platforms && typeof latestJson.platforms === 'object') {
    return latestJson.platforms[platform] || null;
  }

  if (latestJson && typeof latestJson === 'object' && latestJson.url && latestJson.signature) {
    return latestJson;
  }

  return null;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Missing or invalid ${label}.`);
  }
}

async function checkRemoteAsset(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    fail(`Asset check failed for ${url}: ${response.status} ${response.statusText}`);
  }
}

async function main() {
  const { latest, platform, checkUrls } = parseArgs(process.argv.slice(2));

  if (!latest) {
    fail('Usage: node scripts/validate-updater-artifacts.mjs --latest <path-or-url-to-latest.json> [--platform darwin-aarch64] [--check-urls]');
  }

  const { source, json: latestJson } = await readLatestJson(latest);

  if (latestJson?.tauri?.updater || latestJson?.build?.distDir) {
    fail(`The input at ${source} looks like a Tauri config file, not a latest.json updater manifest.`);
  }

  const platformEntry = normalizePlatformEntry(latestJson, platform);

  assertString(latestJson.version, 'latest.json version');
  assertString(latestJson.pub_date, 'latest.json pub_date');
  if (!platformEntry) {
    fail(`No updater entry found for platform "${platform}".`);
  }

  assertString(platformEntry.signature, `${platform} signature`);
  assertString(platformEntry.url, `${platform} url`);

  if (!/^https:\/\//i.test(platformEntry.url) && !path.isAbsolute(platformEntry.url) && !platformEntry.url.startsWith('./')) {
    fail(`${platform} url must be https or a resolvable local path.`);
  }

  if (checkUrls && /^https:\/\//i.test(platformEntry.url)) {
    await checkRemoteAsset(platformEntry.url);
  }

  console.log('Updater artifact validation passed.');
  console.log(`  latest.json: ${source}`);
  console.log(`  version: ${latestJson.version}`);
  console.log(`  pub_date: ${latestJson.pub_date}`);
  console.log(`  platform: ${platform}`);
  console.log(`  asset url: ${platformEntry.url}`);
  console.log(`  signature length: ${platformEntry.signature.length}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
