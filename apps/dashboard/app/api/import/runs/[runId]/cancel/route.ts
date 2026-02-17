import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

interface RouteParams {
  params: Promise<{
    runId: string;
  }>;
}

/**
 * POST /api/import/runs/[runId]/cancel
 * 
 * Cancel an in-progress import run.
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
    
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    
    const response = await fetch(`${backendUrl}/api/import/runs/${runId}/cancel`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: result.detail || result.error || "Failed to cancel import" },
        { status: response.status }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Cancel import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel import" },
      { status: 500 }
    );
  }
}

