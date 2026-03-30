import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      console.warn("[Ritual][watcher-proxy][summary] unauthorized", {
        duration_ms: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const url = `${BACKEND_URL}/api/watcher/stats/summary${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: buildBackendAuthHeaders({ userId, token }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn("[Ritual][watcher-proxy][summary] backend-error", {
        duration_ms: Date.now() - startedAt,
        status: response.status,
        query: Object.fromEntries(searchParams.entries()),
      });
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch computer time summary" },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.info("[Ritual][watcher-proxy][summary] success", {
      duration_ms: Date.now() - startedAt,
      query: Object.fromEntries(searchParams.entries()),
      source: data?.data?.source,
    });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Ritual][watcher-proxy][summary] exception", {
      duration_ms: Date.now() - startedAt,
      query: Object.fromEntries(searchParams.entries()),
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
