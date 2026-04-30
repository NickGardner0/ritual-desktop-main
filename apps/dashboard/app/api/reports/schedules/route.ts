import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/reports/schedules", {
  tag: "report-schedules",
  timeout: 15_000,
});
