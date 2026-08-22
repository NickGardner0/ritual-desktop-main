import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return forwardProxyRequest(request, "/api/screenshot/preview", {
    method: "POST",
    tag: "screenshot-preview",
    timeout: 120_000,
  });
}
