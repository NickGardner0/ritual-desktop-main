import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return forwardProxyRequest(request, "/api/wearables/apple/export", {
    method: "GET",
    tag: "apple-health-export",
    timeout: 120_000,
  });
}
