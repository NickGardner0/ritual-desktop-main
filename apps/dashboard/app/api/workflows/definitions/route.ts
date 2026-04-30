import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/workflows/definitions", {
  tag: "workflow-definitions",
  timeout: 15_000,
});
