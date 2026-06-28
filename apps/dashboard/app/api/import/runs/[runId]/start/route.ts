import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getServerBackendBaseUrl } from "@/lib/api/server-client";

interface RouteParams {
  params: Promise<{
    runId: string;
  }>;
}

/**
 * POST /api/import/runs/[runId]/start
 * 
 * Start the import process for a prepared import run.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Failed to get auth token" }, { status: 401 });
    }
    
    const { runId } = await params;
    const body = await request.json();
    
    const backendUrl = getServerBackendBaseUrl();
    
    const response = await fetch(`${backendUrl}/api/import/runs/${runId}/start`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: result.detail || result.error || "Failed to start import" },
        { status: response.status }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Start import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start import" },
      { status: 500 }
    );
  }
}
