import { createProxyHandler } from "@/lib/server/proxy-helper";

export const GET = createProxyHandler("/api/ai-facts", {
  tag: "ai-facts",
  timeout: 15_000,
});

export const POST = createProxyHandler("/api/ai-facts", {
  tag: "ai-fact-create",
  timeout: 20_000,
});
