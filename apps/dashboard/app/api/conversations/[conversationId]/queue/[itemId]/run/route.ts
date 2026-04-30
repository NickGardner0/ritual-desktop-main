import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    conversationId: string;
    itemId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { conversationId, itemId } = await params;
  return forwardProxyRequest(request, `/api/conversations/${conversationId}/queue/${itemId}/run`, {
    tag: "conversation-queue-run",
    timeout: 20_000,
  });
}
