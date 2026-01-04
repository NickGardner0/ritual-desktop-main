import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

/**
 * Habit search endpoint with autocomplete.
 * Used by the habit logger and quick logging features.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const { searchParams } = new URL(request.url);
    
    const q = searchParams.get("q") || "";
    const limit = searchParams.get("limit") || "10";
    const includeInactive = searchParams.get("include_inactive") === "true";

    // Build query string for backend
    const backendParams = new URLSearchParams();
    backendParams.set("q", q);
    backendParams.set("limit", limit);
    if (includeInactive) backendParams.set("include_inactive", "true");

    const response = await fetch(
      `${BACKEND_URL}/api/search/habits?${backendParams.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("Backend habit search error:", response.status);
      return NextResponse.json({ hits: [], found: 0 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Habit search API error:", error);
    return NextResponse.json({ hits: [], found: 0 });
  }
}

