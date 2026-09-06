import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveDashboardViewMode } from "../lib/dashboard/view-mode-route.mjs";

const unifiedAnalyticsSourceUrl = new URL(
  "../components/analytics/unified-analytics-client.tsx",
  import.meta.url,
);

test("dashboard view follows Metrics and resets to Index when the view parameter is removed", () => {
  const metricsUrl = new URL("https://ritual.local/dashboard?view=metrics");
  assert.equal(resolveDashboardViewMode(metricsUrl.searchParams), "metrics");

  const indexUrl = new URL("https://ritual.local/dashboard");
  assert.equal(resolveDashboardViewMode(indexUrl.searchParams), "overview");
});

test("dashboard view defaults safely to Index for unrelated or unsupported parameters", () => {
  const unrelatedUrl = new URL(
    "https://ritual.local/dashboard?ritual_detached_sidebar=1",
  );
  assert.equal(resolveDashboardViewMode(unrelatedUrl.searchParams), "overview");

  const unsupportedUrl = new URL("https://ritual.local/dashboard?view=unknown");
  assert.equal(resolveDashboardViewMode(unsupportedUrl.searchParams), "overview");
});

test("the unified dashboard applies the URL resolver when search parameters change", async () => {
  const source = await readFile(unifiedAnalyticsSourceUrl, "utf8");

  assert.match(
    source,
    /setViewMode\(resolveDashboardViewMode\(searchParams\)\)/,
  );
});
