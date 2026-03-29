import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    
    // Forward query params
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const url = `${BACKEND_URL}/api/watcher/stats/daily${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: buildBackendAuthHeaders({ userId, token }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn(
        "[watcher/stats/daily] Backend returned",
        response.status,
        await response.text().catch(() => "")
      );
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
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[watcher/stats/daily] Error:", error);
    return NextResponse.json(
      { success: true, data: [], start_date: null, end_date: null },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
