import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/workflows/runs", {
  tag: "workflow-runs",
  timeout: 15_000,
});
