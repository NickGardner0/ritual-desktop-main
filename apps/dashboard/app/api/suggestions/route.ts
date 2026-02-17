import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

/**
 * Personalized suggestions endpoint.
 * Returns habit suggestions (log mode) or question suggestions (chat mode).
 * Powered by Typesense search on the backend.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    const { searchParams } = new URL(request.url);

    const mode = searchParams.get("mode") || "chat";
    const q = searchParams.get("q") || "";

    const backendParams = new URLSearchParams();
    backendParams.set("mode", mode);
    if (q) backendParams.set("q", q);

    const response = await fetch(
      `${BACKEND_URL}/api/suggestions?${backendParams.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("Backend suggestions error:", response.status);
      return NextResponse.json({ suggestions: [], mode, query: q });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Suggestions API error:", error);
    return NextResponse.json({ suggestions: [], mode: "chat", query: "" });
  }
}
