import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    factId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { factId } = await params;
  return forwardProxyRequest(request, `/api/ai-facts/${factId}/dismiss`, {
    tag: "ai-fact-dismiss",
    timeout: 20_000,
  });
}
