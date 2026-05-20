import { createProxyHandler } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";

export const GET = createProxyHandler("/api/metrics/facts/daily", {
  tag: "metric-facts-daily",
  timeout: 30_000,
});
