import { createProxyHandler } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";

export const GET = createProxyHandler("/api/metrics/facts/summary", {
  tag: "metric-facts-summary",
  timeout: 30_000,
});
