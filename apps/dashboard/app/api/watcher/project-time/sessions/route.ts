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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const forceFresh = request.headers.get("x-ritual-force-fresh") === "1";
    const url = `${BACKEND_URL}/api/watcher/project-time/sessions${queryString ? `?${queryString}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: buildBackendAuthHeaders({ userId, token, forceFresh }),
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch project-time sessions" },
        { status: response.status },
      );
    }

    const data = await response.json();
    console.info("[Ritual][watcher-proxy][project-time-sessions] success", {
      duration_ms: Date.now() - startedAt,
      row_count: Array.isArray(data?.data) ? data.data.length : 0,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[Ritual][watcher-proxy][project-time-sessions] exception", {
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionUid = request.nextUrl.searchParams.get("session_uid");
    if (!sessionUid) {
      return NextResponse.json({ error: "Missing session_uid" }, { status: 400 });
    }

    const token = await getToken();
    const body = await request.json();
    const response = await fetch(
      `${BACKEND_URL}/api/watcher/project-time/sessions/${encodeURIComponent(sessionUid)}/classification`,
      {
        method: "PATCH",
        headers: buildBackendAuthHeaders({ userId, token }),
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(65000),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to update project-time session" },
        { status: response.status },
      );
    }

    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[Ritual][watcher-proxy][project-time-sessions] patch exception", {
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
