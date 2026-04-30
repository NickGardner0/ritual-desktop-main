import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return forwardProxyRequest(request, `/api/conversations/${conversationId}/artifacts`, {
    tag: "conversation-artifact-create",
    timeout: 20_000,
  });
}
