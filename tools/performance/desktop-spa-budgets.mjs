import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = join(repoRoot, 'apps/desktop-ui/dist');
const distAssets = join(distDir, 'assets');
const distHtml = join(distDir, 'index.html');
const budgetPath = join(repoRoot, 'tools/performance/desktop-spa-budgets.json');

export function desktopSpaDistExists() {
  return existsSync(distHtml) && existsSync(distAssets);
}

export function loadDesktopSpaBudgets() {
  return JSON.parse(readFileSync(budgetPath, 'utf8'));
}

function gzipBytes(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function assetFromHref(href) {
  const name = href.split('/').pop();
  if (!name) return null;
  const path = join(distAssets, name);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  return {
    name,
    bytes: statSync(path).size,
    gzipBytes: gzipSync(raw).length,
    text: name.endsWith('.js') ? raw.toString('utf8') : null,
  };
}

export function measureDesktopSpa() {
  if (!desktopSpaDistExists()) {
    return null;
  }
  const budgets = loadDesktopSpaBudgets();
  const html = readFileSync(distHtml, 'utf8');
  const script = html.match(/<script type="module"[^>]*src="([^"]+)"/);
  const stylesheet = html.match(/<link rel="stylesheet"[^>]*href="([^"]+index-[^"]+\.css)"/)
    || html.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/);
  const indexJs = script ? assetFromHref(script[1]) : null;
  const indexCss = stylesheet ? assetFromHref(stylesheet[1]) : null;
  const chunkNames = readdirSync(distAssets).filter((name) => name.endsWith('.js') || name.endsWith('.css'));
  const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((match) => match[1]);
  return { budgets, html, indexJs, indexCss, chunkNames, preloads };
}

export function assertDesktopSpaBudgets(assert) {
  const measured = measureDesktopSpa();
  if (!measured) {
    assert.fail(`desktop-ui dist missing at ${distDir}; run npm run --workspace @ritual/desktop-ui build`);
  }
  const { budgets, indexJs, indexCss, chunkNames, preloads } = measured;
  assert.ok(indexJs, 'expected index.html to load an Index JS module');
  assert.ok(indexCss, 'expected index.html to load Index CSS');
  assert.ok(
    indexJs.gzipBytes <= budgets.indexJsGzipMaxBytes,
    `Index JS gzip ${indexJs.gzipBytes} exceeded ${budgets.indexJsGzipMaxBytes} (${indexJs.name})`,
  );
  assert.ok(
    indexCss.gzipBytes <= budgets.indexCssGzipMaxBytes,
    `Index CSS gzip ${indexCss.gzipBytes} exceeded ${budgets.indexCssGzipMaxBytes} (${indexCss.name})`,
  );
  for (const needle of budgets.requiredSeparateChunks) {
    assert.ok(
      chunkNames.some((name) => name.includes(needle)),
      `expected a separate ${needle} chunk`,
    );
    assert.ok(
      !indexJs.name.includes(needle),
      `${needle} rejoined the Index entry as ${indexJs.name}`,
    );
  }
  const indexText = indexJs.text || '';
  for (const forbidden of budgets.indexMustNotContain || []) {
    assert.ok(
      !indexText.includes(forbidden),
      `Index entry ${indexJs.name} contains ${forbidden}`,
    );
  }
  for (const needle of budgets.indexHtmlMustNotPreload || []) {
    assert.ok(
      !preloads.some((href) => href.includes(needle)),
      `index.html modulepreloads ${needle}: ${preloads.join(', ')}`,
    );
  }
  return {
    indexJs: { name: indexJs.name, gzipBytes: indexJs.gzipBytes, bytes: indexJs.bytes },
    indexCss: { name: indexCss.name, gzipBytes: indexCss.gzipBytes, bytes: indexCss.bytes },
    preloads,
    chunks: chunkNames
      .filter((name) => budgets.requiredSeparateChunks.some((needle) => name.includes(needle)))
      .map((name) => ({ name, gzipBytes: gzipBytes(join(distAssets, name)) })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { strict: assert } = await import('node:assert');
  const summary = assertDesktopSpaBudgets(assert);
  console.log(JSON.stringify(summary, null, 2));
}
