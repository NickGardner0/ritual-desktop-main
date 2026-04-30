import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/reports/runs", {
  tag: "report-runs",
  timeout: 15_000,
});
