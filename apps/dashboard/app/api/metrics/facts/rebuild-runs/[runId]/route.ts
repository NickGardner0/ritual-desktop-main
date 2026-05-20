import { NextRequest } from "next/server";
import { forwardProxyRequest } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { runId } = await context.params;
  return forwardProxyRequest(
    request,
    `/api/metrics/facts/rebuild-runs/${encodeURIComponent(runId)}`,
    {
      tag: "metric-facts-rebuild-run",
      timeout: 30_000,
    },
  );
}
