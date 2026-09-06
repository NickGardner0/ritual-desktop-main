import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(agentRoot, 'dist/sidecar.bundle.js');

async function freePort() {
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

async function waitForHealth(origin, timeoutMs = 8000) {
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
  throw new Error(`sidecar health timed out: ${lastError}`);
}

test('packaged sidecar bundle starts without workspace node_modules', async () => {
  const source = await readFile(bundlePath, 'utf8');
  const bundleScript = await readFile(join(agentRoot, 'scripts/bundle-sidecar.mjs'), 'utf8');
  assert.match(bundleScript, /sidecar-bin\.ts/);
  assert.match(source, /ritual-agent-sidecar-bundle/);
  assert.doesNotMatch(source, /from ['"]@ritual\/chat-runtime['"]/);
  assert.doesNotMatch(source, /from ['"]@ritual\/agent['"]/);
  assert.doesNotMatch(source, /ritual-chat-runtime listening/);

  const isolated = await mkdtemp(join(tmpdir(), 'ritual-sidecar-bundle-'));
  const resourceDir = join(isolated, 'Contents', 'Resources', 'agent');
  const packagedScript = join(resourceDir, 'sidecar.mjs');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child;
  try {
    await mkdir(resourceDir, { recursive: true });
    await copyFile(bundlePath, packagedScript);
    child = spawn(process.execPath, [packagedScript], {
      cwd: isolated,
      env: {
        PATH: '/usr/bin:/bin',
        RITUAL_CHAT_RUNTIME_PORT: String(port),
        RITUAL_CHAT_RUNTIME_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.on('exit', (code, signal) => {
      if (code && code !== 0) {
        stderr.push(`exited ${code} ${signal || ''}`.trim());
      }
    });
    const body = await waitForHealth(origin).catch((error) => {
      error.message += `\n${stderr.join('')}`;
      throw error;
    });
    assert.equal(body.ok, true);
    assert.equal(body.agent, true);
    assert.equal(body.service, 'ritual-chat-runtime');
  } finally {
    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(isolated, { recursive: true, force: true });
  }
});
