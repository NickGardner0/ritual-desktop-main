import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    factId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { factId } = await params;
  return forwardProxyRequest(request, `/api/ai-facts/${factId}/events`, {
    tag: "ai-fact-events",
    timeout: 15_000,
  });
}
