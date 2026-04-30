import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    artifactId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { artifactId } = await params;
  return forwardProxyRequest(request, `/api/artifacts/${artifactId}`, {
    tag: "artifact-detail",
    timeout: 15_000,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { artifactId } = await params;
  return forwardProxyRequest(request, `/api/artifacts/${artifactId}`, {
    tag: "artifact-update",
    timeout: 20_000,
  });
}
