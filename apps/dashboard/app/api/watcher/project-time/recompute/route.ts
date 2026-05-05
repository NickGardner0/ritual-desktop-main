import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const response = await fetch(`${BACKEND_URL}/api/watcher/project-time/recompute`, {
      method: "POST",
      headers: buildBackendAuthHeaders({ userId, token }),
      body: JSON.stringify(await request.json()),
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to recompute project-time data" },
        { status: response.status },
      );
    }

    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[Ritual][watcher-proxy][project-time-recompute] exception", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
