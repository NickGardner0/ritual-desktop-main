import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/action-profiles", {
  tag: "action-profiles",
  timeout: 15_000,
});
