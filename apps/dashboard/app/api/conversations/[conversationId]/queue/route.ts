import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return forwardProxyRequest(request, `/api/conversations/${conversationId}/queue`, {
    tag: "conversation-queue",
    timeout: 15_000,
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return forwardProxyRequest(request, `/api/conversations/${conversationId}/queue`, {
    tag: "conversation-queue-create",
    timeout: 20_000,
  });
}
