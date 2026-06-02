import { NextRequest, NextResponse } from "next/server";

import { matchBackendOpenApiPath } from "@/lib/api/generated/backend-client";
import {
  getBackendProxyCompatibilityFallback,
  resolveBackendProxyPath,
} from "@/lib/server/backend-proxy-routing";
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
  const matchedPath = matchBackendOpenApiPath(backendApiPath);

  if (!matchedPath) {
    return NextResponse.json({ error: "Unknown API route" }, { status: 404 });
  }

  const compatibilityFallback = getBackendProxyCompatibilityFallback(
    request.method,
    backendApiPath,
    request.nextUrl.searchParams,
  );

  return forwardProxyRequest(request, backendApiPath, {
    tag: `backend:${matchedPath}`,
    timeout: 120_000,
    notFoundFallback: compatibilityFallback,
    errorFallback: compatibilityFallback,
  });
}

export const GET = proxyBackendRequest;
export const POST = proxyBackendRequest;
export const PUT = proxyBackendRequest;
export const PATCH = proxyBackendRequest;
export const DELETE = proxyBackendRequest;
