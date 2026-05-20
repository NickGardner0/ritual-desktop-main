import { createProxyHandler } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";

export const POST = createProxyHandler("/api/metrics/reconcile", {
  tag: "metric-facts-reconcile",
  timeout: 120_000,
});
