import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const forceFresh = request.headers.get("x-ritual-force-fresh") === "1";
    const queryString = request.nextUrl.searchParams.toString();
    const url = `${BACKEND_URL}/api/screen-time/stats/top-apps${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: buildBackendAuthHeaders({ userId, token, forceFresh }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch iPhone top apps" },
        { status: response.status },
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("Error fetching screen time top apps:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
