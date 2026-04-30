import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/artifacts", {
  tag: "artifacts",
  timeout: 15_000,
});

export const POST = createProxyHandler("/api/artifacts", {
  tag: "artifact-create",
  timeout: 20_000,
});
