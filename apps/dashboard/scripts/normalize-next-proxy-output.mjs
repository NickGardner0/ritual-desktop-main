import fs from 'node:fs/promises';
import path from 'node:path';

const serverDir = path.resolve(process.cwd(), '.next/server');
const middlewareJs = path.join(serverDir, 'middleware.js');
const middlewareNft = path.join(serverDir, 'middleware.js.nft.json');
const proxyJs = path.join(serverDir, 'proxy.js');
const proxyNft = path.join(serverDir, 'proxy.js.nft.json');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(serverDir)) || !(await exists(middlewareJs))) {
    console.warn('[normalize-next-proxy-output] Skipping: Next server output not found.');
    return;
  }

  if (!(await exists(proxyJs))) {
    await fs.copyFile(middlewareJs, proxyJs);
    console.log('[normalize-next-proxy-output] Created proxy.js from middleware.js');
  }

  if ((await exists(middlewareNft)) && !(await exists(proxyNft))) {
    await fs.copyFile(middlewareNft, proxyNft);
    console.log('[normalize-next-proxy-output] Created proxy.js.nft.json from middleware.js.nft.json');
  }
}

await main();
