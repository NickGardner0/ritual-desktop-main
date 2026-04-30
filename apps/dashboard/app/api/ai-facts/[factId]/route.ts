import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    factId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { factId } = await params;
  return forwardProxyRequest(request, `/api/ai-facts/${factId}`, {
    tag: "ai-fact-update",
    timeout: 20_000,
  });
}
