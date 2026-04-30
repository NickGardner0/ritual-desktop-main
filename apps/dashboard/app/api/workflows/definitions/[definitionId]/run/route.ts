import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    definitionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { definitionId } = await params;
  return forwardProxyRequest(request, `/api/workflows/definitions/${definitionId}/run`, {
    tag: "workflow-run-queue",
    timeout: 20_000,
  });
}
