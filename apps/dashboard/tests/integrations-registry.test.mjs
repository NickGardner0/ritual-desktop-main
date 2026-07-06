import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginsRoot = join(
  process.cwd(),
  "apps/dashboard/app/(dashboard)/integrations/plugins",
);

const expectedPluginFolders = [
  "whoop",
  "plaid",
  "tesla",
  "apple-health",
  "computer-tracking",
  "iphone-time",
];

const requiredIndexExports = ["id", "detailKey", "title", "buildCard", "DetailPanel"];

function readPluginIndex(folder) {
  const indexPath = join(pluginsRoot, folder, "index.ts");
  const source = readFileSync(indexPath, "utf8");
  return { indexPath, source };
}

test("integration plugin folders exist with required exports", () => {
  for (const folder of expectedPluginFolders) {
    const folderPath = join(pluginsRoot, folder);
    assert.ok(statSync(folderPath).isDirectory(), `missing plugin folder: ${folder}`);

    const { indexPath, source } = readPluginIndex(folder);
    for (const exportName of requiredIndexExports) {
      assert.match(
        source,
        new RegExp(`export\\s+(const\\s+${exportName}|\\{\\s*[^}]*\\b${exportName}\\b)`),
        `${indexPath} should export ${exportName}`,
      );
    }
  }
});

test("registry.ts lists all plugins with unique ids and detail keys", () => {
  const registrySource = readFileSync(join(pluginsRoot, "registry.ts"), "utf8");

  assert.match(registrySource, /INTEGRATION_PLUGINS/);
  assert.match(registrySource, /PLUGIN_BY_ID/);
  assert.match(registrySource, /PLUGIN_BY_DETAIL_KEY/);
  assert.match(registrySource, /satisfies readonly IntegrationPlugin\[\]/);
  assert.doesNotMatch(registrySource, /as unknown as IntegrationPlugin/);

  const ids = [];
  const detailKeys = [];

  for (const folder of expectedPluginFolders) {
    const { source } = readPluginIndex(folder);
    const idMatch = source.match(/export const id = '([^']+)'/);
    const detailKeyMatch = source.match(/export const detailKey = '([^']+)'/);
    assert.ok(idMatch, `${folder}/index.ts should export id`);
    assert.ok(detailKeyMatch, `${folder}/index.ts should export detailKey`);
    ids.push(idMatch[1]);
    detailKeys.push(detailKeyMatch[1]);
  }

  assert.equal(new Set(ids).size, ids.length, `duplicate plugin ids: ${ids.join(", ")}`);
  assert.equal(
    new Set(detailKeys).size,
    detailKeys.length,
    `duplicate plugin detail keys: ${detailKeys.join(", ")}`,
  );

  assert.deepEqual([...ids].sort(), [
    "apple-screen-time",
    "apple-watch",
    "computer",
    "plaid",
    "tesla",
    "whoop",
  ]);
  assert.deepEqual([...detailKeys].sort(), [
    "applewatch",
    "computer",
    "plaid",
    "screentime",
    "tesla",
    "whoop",
  ]);
});

test("each plugin exposes card and detail panel modules", () => {
  for (const folder of expectedPluginFolders) {
    const folderPath = join(pluginsRoot, folder);
    const files = readdirSync(folderPath);
    assert.ok(files.includes("card.tsx"), `${folder} should include card.tsx`);
    assert.ok(files.includes("detail-panel.tsx"), `${folder} should include detail-panel.tsx`);
  }
});

test("moved integration hooks live under plugin folders", () => {
  const hookPaths = [
    join(pluginsRoot, "plaid/use-plaid-integration.ts"),
    join(pluginsRoot, "tesla/use-tesla-integration.ts"),
    join(pluginsRoot, "apple-health/use-apple-health-export.ts"),
  ];

  for (const hookPath of hookPaths) {
    assert.ok(statSync(hookPath).isFile(), `expected hook at ${hookPath}`);
  }

  const legacyHookPaths = [
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/use-plaid-integration.ts"),
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/use-tesla-integration.ts"),
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/use-apple-health-export.ts"),
  ];

  for (const legacyPath of legacyHookPaths) {
    assert.throws(() => statSync(legacyPath), /ENOENT|no such file/);
  }
});

test("integrations details module no longer uses god-context renderer", () => {
  const detailsSource = readFileSync(
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/integrations-client.details.tsx"),
    "utf8",
  );

  assert.doesNotMatch(detailsSource, /IntegrationDetailRendererContext/);
  assert.doesNotMatch(detailsSource, /createIntegrationDetailRenderers/);
  assert.doesNotMatch(detailsSource, /Record<string,\s*any>/);
});

test("integration plugin context types stay explicit", () => {
  const typesSource = readFileSync(join(pluginsRoot, "types.ts"), "utf8");
  const implSource = readFileSync(
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/integrations-client.impl.tsx"),
    "utf8",
  );
  const runtimeContextSource = implSource.slice(
    implSource.indexOf("const runtimeContext"),
    implSource.indexOf("const integrationCardContext"),
  );

  assert.match(typesSource, /IntegrationPlugin</);
  assert.doesNotMatch(typesSource, /Record<string,\s*unknown>/);
  assert.doesNotMatch(runtimeContextSource, /callbackProcessedRef|oauthSessionIdRef|oauthSessionTokenRef|pollingIntervalRef/);
});

test("integrations orchestrator stays under 400 lines", () => {
  const implSource = readFileSync(
    join(process.cwd(), "apps/dashboard/app/(dashboard)/integrations/integrations-client.impl.tsx"),
    "utf8",
  );
  const lineCount = implSource.split("\n").length;
  assert.ok(lineCount < 400, `integrations-client.impl.tsx is ${lineCount} lines (expected <400)`);
});
