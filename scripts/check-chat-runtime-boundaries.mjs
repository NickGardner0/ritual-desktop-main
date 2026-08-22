#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'packages/chat-runtime/src');
const modelEngineRoot = join(sourceRoot, 'model-engine');
const errors = [];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(entry))) files.push(path);
  }
  return files;
}

function source(path) {
  return readFileSync(path, 'utf8');
}

const modelFiles = walk(modelEngineRoot);
const forbiddenModelDependencies = [
  'assistant-kernel',
  'assistant-turn-store',
  'persistence',
  'tool-batch',
  'turn-tool-loop',
  'runtime-tools',
  'executors',
  'queue',
];
for (const path of modelFiles) {
  const content = source(path);
  for (const dependency of forbiddenModelDependencies) {
    const importPattern = new RegExp(`(?:from\\s+|import\\s*\\()['\"][^'\"]*${dependency}[^'\"]*['\"]`);
    if (importPattern.test(content)) {
      errors.push(`${relative(root, path)} imports forbidden model-engine dependency ${dependency}`);
    }
  }
}

const providerOwner = join(modelEngineRoot, 'openai-adapter.ts');
const providerScanRoots = [sourceRoot, join(root, 'apps/dashboard/lib/workflows')];
for (const path of providerScanRoots.flatMap(walk)) {
  const content = source(path);
  const ownsProvider = path === providerOwner;
  if (!ownsProvider && (
    /from\s+['\"]openai['\"]/.test(content)
    || /chat\.completions\.create\s*\(/.test(content)
    || /getOpenAIClient\s*\(/.test(content)
  )) {
    errors.push(`${relative(root, path)} bypasses the model-engine adapter`);
  }
}

const chatStreamRoot = join(sourceRoot, 'chat-stream');
for (const path of walk(chatStreamRoot)) {
  const content = source(path);
  for (const dependency of ['assistant-kernel', 'assistant-turn-store', 'persistence', 'runtime-tools', 'tool-batch', 'turn-tool-loop']) {
    if (content.includes(dependency)) {
      errors.push(`${relative(root, path)} retains forbidden lifecycle dependency ${dependency}`);
    }
  }
}

for (const path of walk(sourceRoot)) {
  if (path === join(sourceRoot, 'assistant-kernel.ts')) continue;
  const content = source(path);
  if (/defaultAssistantKernel\.(?:begin|transition|commit|fail|cancel)\s*\(/.test(content)) {
    errors.push(`${relative(root, path)} transitions durable state outside AssistantKernel.runTurn`);
  }
}

const ownerMapPath = join(root, 'tools/architecture/chat-runtime-owners.json');
const ownerMap = JSON.parse(source(ownerMapPath));
for (const entry of ownerMap.entrypoints) {
  const path = join(root, entry.path);
  if (!existsSync(path)) {
    errors.push(`Chat owner map path is missing: ${entry.path}`);
    continue;
  }
  const content = source(path);
  if (!content.includes(entry.handler)) {
    errors.push(`Chat owner map handler is missing: ${entry.path}#${entry.handler}`);
  }
  if (entry.turnOwner === 'AssistantKernel.runTurn' && !content.includes('.runTurn(')) {
    errors.push(`Chat entrypoint does not delegate lifecycle to runTurn: ${entry.path}#${entry.handler}`);
  }
}

if (errors.length) {
  console.error('Chat runtime boundary check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Chat runtime boundary passed (${modelFiles.length} model-engine files, ${ownerMap.entrypoints.length} entrypoints).`);
