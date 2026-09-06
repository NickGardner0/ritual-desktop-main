/**
 * Process entry for the desktop chat sidecar.
 * esbuild bundles this for `node dist/sidecar.bundle.js`; bun --compile
 * turns that bundle into the ritual-agent Mach-O. Always listen — compiled
 * binaries do not have a JS argv path that passes isDirectRun().
 */
import { startAgentSidecar } from './sidecar.js';

startAgentSidecar().catch((error) => {
  console.error(error);
  process.exit(1);
});
