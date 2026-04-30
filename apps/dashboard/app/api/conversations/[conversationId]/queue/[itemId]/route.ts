import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    conversationId: string;
    itemId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { conversationId, itemId } = await params;
  return forwardProxyRequest(request, `/api/conversations/${conversationId}/queue/${itemId}`, {
    tag: "conversation-queue-update",
    timeout: 20_000,
  });
}
