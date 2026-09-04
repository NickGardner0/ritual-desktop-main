#!/usr/bin/env node
/**
 * Pack the desktop sidecar into one JS file.
 * Packaged apps compile this with bun --compile into ritual-agent (see
 * scripts/pin-desktop-agent-sidecar.mjs). `tauri dev` still runs this file
 * with a host `node`/`bun`.
 *
 * ESM + createRequire matches OpenCode's electron-vite banner so CJS deps
 * like node-fetch can `require("stream")`.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(agentRoot, '../..');
const require = createRequire(join(repoRoot, 'package.json'));
const esbuild = require('esbuild');

const outfile = join(agentRoot, 'dist/sidecar.bundle.js');

await esbuild.build({
  absWorkingDir: agentRoot,
  entryPoints: [join(agentRoot, 'src/sidecar-bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'info',
  banner: {
    js: `/* ritual-agent-sidecar-bundle */
import { createRequire as __ritualCreateRequire } from 'node:module';
import { fileURLToPath as __ritualFileURLToPath } from 'node:url';
import { dirname as __ritualDirname } from 'node:path';
const require = __ritualCreateRequire(import.meta.url);
const __filename = __ritualFileURLToPath(import.meta.url);
const __dirname = __ritualDirname(__filename);
`,
  },
});

let code = await readFile(outfile, 'utf8');
code = code.replace(
  /throw Error\(['"]Dynamic require of ["']['"] \+ (\w+) \+ ['"]["'] is not supported['"]\)/g,
  'return require($1)',
);
await writeFile(outfile, code);

console.log(`wrote ${outfile}`);
