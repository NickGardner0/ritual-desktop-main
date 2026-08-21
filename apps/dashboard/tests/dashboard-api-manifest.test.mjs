import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const apiRoot = join(root, "apps/dashboard/app/api");
const manifest = JSON.parse(
  readFileSync(join(root, "tools/dashboard-api-routes.manifest.json"), "utf8"),
);

function routeFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...routeFiles(path));
    } else if (entry === "route.ts") {
      files.push(relative(root, path));
    }
  }
  return files.sort();
}

describe("dashboard API route manifest", () => {
  test("covers every remaining Next API route", () => {
    assert.deepEqual(routeFiles(apiRoot), Object.keys(manifest.routes).sort());
  });

  test("keeps deleted pure backend proxies out of app/api", () => {
    const deletedProxyRoutes = [
      "apps/dashboard/app/api/analytics/correlation/route.ts",
      "apps/dashboard/app/api/analytics/habits/daily-values/route.ts",
      "apps/dashboard/app/api/analytics/habits/logs/all/route.ts",
      "apps/dashboard/app/api/analytics/habits/logs/route.ts",
      "apps/dashboard/app/api/analytics/habits/summary/route.ts",
      "apps/dashboard/app/api/analytics/habits/trends/route.ts",
      "apps/dashboard/app/api/analytics/heart-rate/series/route.ts",
      "apps/dashboard/app/api/analytics/heart-rate/summary/route.ts",
      "apps/dashboard/app/api/computer-activity/breakdown/route.ts",
      "apps/dashboard/app/api/financial/connections/route.ts",
      "apps/dashboard/app/api/integrations/whoop/status/route.ts",
      "apps/dashboard/app/api/integrations/whoop/sync/route.ts",
      "apps/dashboard/app/api/search/habits/route.ts",
      "apps/dashboard/app/api/search/route.ts",
      "apps/dashboard/app/api/suggestions/route.ts",
      "apps/dashboard/app/api/watcher/stats/summary/route.ts",
      "apps/dashboard/app/api/wearables/apple/metric-preferences/route.ts",
    ];

    for (const route of deletedProxyRoutes) {
      assert.equal(existsSync(join(root, route)), false, `${route} should be handled by the catch-all proxy`);
    }
  });

  test("requires custom remaining routes to declare a boundary reason", () => {
    for (const [route, entry] of Object.entries(manifest.routes)) {
      assert.ok(entry.category, `${route} must declare a category`);
      assert.ok(entry.reason.length >= 20, `${route} must explain why it remains in Next app/api`);
    }
  });
});
