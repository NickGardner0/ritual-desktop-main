import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    artifactId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { artifactId } = await params;
  return forwardProxyRequest(request, `/api/artifacts/${artifactId}/links`, {
    tag: "artifact-links",
    timeout: 15_000,
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { artifactId } = await params;
  return forwardProxyRequest(request, `/api/artifacts/${artifactId}/links`, {
    tag: "artifact-link-create",
    timeout: 20_000,
  });
}
