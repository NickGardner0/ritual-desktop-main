import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      console.warn("[Ritual][watcher-proxy][daily] unauthorized", {
        duration_ms: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const url = `${BACKEND_URL}/api/watcher/stats/daily${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: buildBackendAuthHeaders({ userId, token }),
      signal: AbortSignal.timeout(65000),
    });

    if (!response.ok) {
      console.warn("[Ritual][watcher-proxy][daily] backend-error", {
        duration_ms: Date.now() - startedAt,
        status: response.status,
        query: Object.fromEntries(searchParams.entries()),
        body: await response.text().catch(() => ""),
      });
      // Return 200 with empty data so the frontend degrades gracefully instead of
      // surfacing an error overlay (common when backend is starting or auth is settling)
      return NextResponse.json(
        { success: true, data: [], start_date: null, end_date: null },
        {
          headers: { "Cache-Control": "no-store, max-age=0" },
        }
      );
    }

    const data = await response.json();
    console.info("[Ritual][watcher-proxy][daily] success", {
      duration_ms: Date.now() - startedAt,
      query: Object.fromEntries(searchParams.entries()),
      row_count: Array.isArray(data?.data) ? data.data.length : 0,
      source: Array.isArray(data?.data) && data.data.length > 0 ? data.data[0]?.source : undefined,
    });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Ritual][watcher-proxy][daily] exception", {
      duration_ms: Date.now() - startedAt,
      query: Object.fromEntries(searchParams.entries()),
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: true, data: [], start_date: null, end_date: null },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
