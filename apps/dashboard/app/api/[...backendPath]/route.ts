import { NextRequest, NextResponse } from "next/server";

import { matchBackendOpenApiOperation, matchBackendOpenApiPath } from "@/lib/api/generated/backend-client";
import { evaluateBackendCatchallPolicy } from "@/lib/server/backend-catchall-policy";
import { resolveBackendProxyPath } from "@/lib/server/backend-proxy-routing";
import { forwardProxyRequest } from "@/lib/server/proxy-helper";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ backendPath: string[] }>;
}

async function proxyBackendRequest(request: NextRequest, context: RouteContext) {
  const { backendPath } = await context.params;
  const requestedPath = `/api/${backendPath.map(encodeURIComponent).join("/")}`;
  const backendApiPath = resolveBackendProxyPath(requestedPath);
  const policy = evaluateBackendCatchallPolicy(
    backendApiPath,
    request.method,
    request.headers.get("content-type"),
  );

  if (!policy.allowed) {
    return NextResponse.json({ error: policy.error }, { status: policy.status });
  }

  const matchedPath = matchBackendOpenApiPath(backendApiPath);
  const matchedOperation = matchBackendOpenApiOperation(request.method, backendApiPath);

  if (!matchedPath || !matchedOperation) {
    return NextResponse.json({ error: "Unknown API route" }, { status: 404 });
  }

  return forwardProxyRequest(request, backendApiPath, {
    tag: `backend:${matchedOperation}`,
    timeout: 120_000,
  });
}

export const GET = proxyBackendRequest;
export const POST = proxyBackendRequest;
export const PATCH = proxyBackendRequest;
export const PUT = proxyBackendRequest;
export const DELETE = proxyBackendRequest;
