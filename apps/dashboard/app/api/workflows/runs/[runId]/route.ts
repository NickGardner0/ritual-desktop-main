import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    runId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  return forwardProxyRequest(request, `/api/workflows/runs/${runId}`, {
    tag: "workflow-run-detail",
    timeout: 15_000,
  });
}
