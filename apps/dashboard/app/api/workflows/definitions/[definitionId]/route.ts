import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    definitionId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { definitionId } = await params;
  return forwardProxyRequest(request, `/api/workflows/definitions/${definitionId}`, {
    tag: "workflow-definition-update",
    timeout: 20_000,
  });
}
