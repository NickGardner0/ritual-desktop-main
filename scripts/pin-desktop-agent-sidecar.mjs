#!/usr/bin/env node
/**
 * Compile packages/agent/dist/sidecar.bundle.js into ritual-agent with a
 * pinned bun, then hash-lock it next to ritual-watcher.
 *
 * Usage: node scripts/pin-desktop-agent-sidecar.mjs [--target aarch64-apple-darwin]
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'apps/desktop/src-tauri/binaries/sidecar-lock.json');
const binariesDir = join(root, 'apps/desktop/src-tauri/binaries');
const bundlePath = join(root, 'packages/agent/dist/sidecar.bundle.js');

const BUN_VERSION = '1.2.19';
const COMPILERS = {
  'aarch64-apple-darwin': {
    bunTarget: 'bun-darwin-arm64',
    url: `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-aarch64.zip`,
    archiveSha256: '674a48378342efaadc3c291596b573010f3c2388958f7c44678d87f6fb759991',
    member: 'bun-darwin-aarch64/bun',
    file: 'ritual-agent-aarch64-apple-darwin',
  },
};

function sha256Buffer(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function parseTarget() {
  const index = process.argv.indexOf('--target');
  if (index >= 0) return process.argv[index + 1];
  if (process.arch === 'arm64' && process.platform === 'darwin') return 'aarch64-apple-darwin';
  throw new Error('Pass --target aarch64-apple-darwin (Ritual ships Apple Silicon only).');
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed downloading ${url}: ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  return result;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function waitForHealth(origin, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) {
        return response.json();
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`ritual-agent health timed out: ${lastError}`);
}

async function smokeCompiledAgent(binary) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(binary, [], {
    env: {
      PATH: '/usr/bin:/bin',
      RITUAL_CHAT_RUNTIME_PORT: String(port),
      RITUAL_CHAT_RUNTIME_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  child.stdout.on('data', (chunk) => stderr.push(String(chunk)));
  try {
    const body = await waitForHealth(origin).catch((error) => {
      error.message += `\n${stderr.join('')}`;
      throw error;
    });
    if (body?.ok !== true || body?.agent !== true || body?.service !== 'ritual-chat-runtime') {
      throw new Error(`unexpected ritual-agent health: ${JSON.stringify(body)}\n${stderr.join('')}`);
    }
  } finally {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}

function hostBunPath() {
  const result = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  if (String(result.stdout || '').trim() !== BUN_VERSION) return '';
  const which = spawnSync('which', ['bun'], { encoding: 'utf8' });
  return which.status === 0 ? String(which.stdout || '').trim() : '';
}

async function ensurePinnedBun(spec) {
  const hostBun = hostBunPath();
  if (hostBun) {
    console.log(`Using host bun ${BUN_VERSION} at ${hostBun}`);
    return hostBun;
  }

  const cacheDir = join(tmpdir(), `ritual-bun-compiler-${BUN_VERSION}`);
  const bunBin = join(cacheDir, spec.member);
  if (existsSync(bunBin)) {
    return bunBin;
  }

  mkdirSync(cacheDir, { recursive: true });
  const archivePath = join(tmpdir(), `bun-v${BUN_VERSION}-${spec.bunTarget}.zip`);
  console.log(`Downloading bun ${BUN_VERSION} for compile (${spec.bunTarget})...`);
  await download(spec.url, archivePath);
  const archiveHash = sha256File(archivePath);
  if (archiveHash !== spec.archiveSha256) {
    unlinkSync(archivePath);
    throw new Error(`bun archive hash mismatch.\n  expected ${spec.archiveSha256}\n  actual   ${archiveHash}`);
  }
  run('unzip', ['-o', archivePath, spec.member, '-d', cacheDir]);
  unlinkSync(archivePath);
  run('chmod', ['755', bunBin]);
  if (!existsSync(bunBin)) {
    throw new Error(`Extracted bun missing at ${bunBin}`);
  }
  return bunBin;
}

function buildAgentBundle() {
  console.log('Building @ritual/agent sidecar bundle...');
  run('npm', ['run', '--workspace', '@ritual/agent', 'build'], {
    cwd: root,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (!existsSync(bundlePath)) {
    throw new Error(`Missing sidecar bundle at ${bundlePath}`);
  }
}

async function main() {
  const target = parseTarget();
  const spec = COMPILERS[target];
  if (!spec) {
    throw new Error(`No bun compile target for ${target}`);
  }

  mkdirSync(binariesDir, { recursive: true });
  const dest = join(binariesDir, spec.file);
  buildAgentBundle();
  const sourceSha = sha256File(bundlePath);

  if (existsSync(dest) && existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const sidecar = lock.sidecars?.['ritual-agent'];
    const expected = sidecar?.targets?.[target]?.sha256;
    const expectedSource = sidecar?.compiler?.sourceSha256;
    if (
      expected &&
      expectedSource === sourceSha &&
      sidecar?.compiler?.version === BUN_VERSION &&
      sha256File(dest) === expected
    ) {
      console.log(`Pinned ritual-agent already current: ${dest}`);
      return;
    }
  }

  const bunBin = await ensurePinnedBun(spec);
  const tmpDest = `${dest}.tmp`;
  if (existsSync(tmpDest)) unlinkSync(tmpDest);
  console.log(`Compiling ritual-agent with bun ${BUN_VERSION} (${spec.bunTarget})...`);
  run(bunBin, ['build', bundlePath, '--compile', `--outfile=${tmpDest}`, `--target=${spec.bunTarget}`], {
    cwd: root,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  run('chmod', ['755', tmpDest]);
  await smokeCompiledAgent(tmpDest);
  renameSync(tmpDest, dest);
  const agentSha = sha256File(dest);

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.sidecars = lock.sidecars || {};
  delete lock.sidecars['ritual-node'];
  lock.sidecars['ritual-agent'] = {
    optionalInRepo: true,
    compiler: {
      name: 'bun',
      version: BUN_VERSION,
      target: spec.bunTarget,
      url: spec.url,
      archiveSha256: spec.archiveSha256,
      source: 'packages/agent/dist/sidecar.bundle.js',
      sourceSha256: sourceSha,
    },
    targets: {
      ...(lock.sidecars['ritual-agent']?.targets || {}),
      [target]: {
        file: spec.file,
        sha256: agentSha,
      },
    },
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Pinned ritual-agent at ${dest} (${agentSha})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
