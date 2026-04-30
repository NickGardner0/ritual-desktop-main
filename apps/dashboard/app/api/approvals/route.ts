import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/approvals", {
  tag: "approvals",
  timeout: 15_000,
});
