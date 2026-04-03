import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const tauriDir = path.join(repoRoot, 'apps', 'desktop', 'src-tauri');
const baseConfigPath = path.join(tauriDir, 'tauri.conf.json');
const outputConfigPath = path.join(tauriDir, 'tauri.generated.production.conf.json');
const updaterPubkeyPath = path.join(tauriDir, 'updater.pub');

function parseRepoSlug(remoteUrl) {
  if (!remoteUrl) return null;

  const sshMatch = remoteUrl.match(/github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = remoteUrl.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

function detectRepoSlug() {
  const explicitRepo = process.env.RITUAL_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (explicitRepo) return explicitRepo;

  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseRepoSlug(remoteUrl);
  } catch {
    return null;
  }
}

const baseConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
const repoSlug = detectRepoSlug();
const updaterPubkey = (process.env.RITUAL_UPDATER_PUBKEY || fs.readFileSync(updaterPubkeyPath, 'utf8')).trim();
const defaultUpdaterRepo =
  process.env.RITUAL_UPDATER_REPOSITORY ||
  'NickGardner0/ritual-desktop-releases';

if (!updaterPubkey) {
  throw new Error(`Missing updater public key. Expected env RITUAL_UPDATER_PUBKEY or file ${updaterPubkeyPath}.`);
}

const updaterEndpoint =
  process.env.RITUAL_UPDATER_ENDPOINT ||
  `https://github.com/${defaultUpdaterRepo || repoSlug}/releases/latest/download/latest.json`;

const generatedConfig = {
  ...baseConfig,
  tauri: {
    ...baseConfig.tauri,
    updater: {
      active: true,
      dialog: false,
      endpoints: [updaterEndpoint],
      pubkey: updaterPubkey,
    },
    bundle: {
      ...baseConfig.tauri.bundle,
      macOS: {
        ...baseConfig.tauri.bundle.macOS,
        signingIdentity: null,
        providerShortName:
          process.env.APPLE_PROVIDER_SHORT_NAME ||
          baseConfig.tauri.bundle.macOS.providerShortName ||
          null,
      },
    },
  },
};

fs.writeFileSync(outputConfigPath, `${JSON.stringify(generatedConfig, null, 2)}\n`);

console.log(`Wrote ${path.relative(repoRoot, outputConfigPath)}`);
console.log(`Updater endpoint: ${updaterEndpoint}`);
