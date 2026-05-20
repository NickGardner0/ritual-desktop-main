import { createProxyHandler } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";

export const POST = createProxyHandler("/api/metrics/facts/rebuild", {
  tag: "metric-facts-rebuild",
  timeout: 120_000,
});
