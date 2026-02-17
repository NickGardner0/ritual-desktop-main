import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

/**
 * Global federated search endpoint.
 * Proxies to Python backend which handles Typesense integration.
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
    const collections = searchParams.get("collections");
    const limit = searchParams.get("limit") || "10";

    // Build query string for backend
    const backendParams = new URLSearchParams();
    backendParams.set("q", q);
    if (collections) backendParams.set("collections", collections);
    backendParams.set("limit", limit);

    const response = await fetch(
      `${BACKEND_URL}/api/search?${backendParams.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("Backend search error:", response.status);
      // Return fallback results
      return NextResponse.json({
        query: q,
        quick_actions: getQuickActions(q),
        habits: { hits: [], found: 0 },
        logs: { hits: [], found: 0 },
        conversations: { hits: [], found: 0 },
        activity: { hits: [], found: 0 },
        fallback: true,
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { error: "Search failed", fallback: true },
      { status: 500 }
    );
  }
}

// Fallback quick actions when backend is unavailable
function getQuickActions(query: string) {
  const actions = [
    { id: "log-habit", name: "Log a habit", keywords: ["log", "track", "add"], action: "open_logger", icon: "plus" },
    { id: "search-logs", name: "Search logs", keywords: ["find", "search", "history"], action: "navigate", path: "/activity", icon: "search" },
    { id: "view-analytics", name: "View analytics", keywords: ["stats", "charts"], action: "navigate", path: "/analytics", icon: "bar-chart" },
    { id: "ai-assistant", name: "Ask AI assistant", keywords: ["ai", "chat", "ask"], action: "navigate", path: "/chat", icon: "bot" },
    { id: "import-data", name: "Import data", keywords: ["import", "upload", "csv"], action: "open_import", icon: "upload" },
    { id: "connect-wearables", name: "Connect wearables", keywords: ["whoop", "oura", "garmin"], action: "navigate", path: "/integrations", icon: "watch" },
  ];

  if (!query) return actions.slice(0, 5);

  const queryLower = query.toLowerCase();
  return actions
    .filter((a) => 
      a.name.toLowerCase().includes(queryLower) ||
      a.keywords.some((k) => k.includes(queryLower) || queryLower.includes(k))
    )
    .slice(0, 5);
}

