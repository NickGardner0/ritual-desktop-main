import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * POST /api/habits/logs/batch
 * 
 * Create habit logs in batch with conflict resolution.
 * Supports:
 * - skip_existing: Don't modify existing data
 * - overwrite_existing: Replace existing values
 * - merge_sum: Add to existing values
 * - merge_avg: Average with existing values
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Failed to get auth token" }, { status: 401 });
    }
    
    const body = await request.json();
    
    // Validate batch size
    if (!body.logs || !Array.isArray(body.logs)) {
      return NextResponse.json(
        { error: "logs array is required" },
        { status: 400 }
      );
    }
    
    if (body.logs.length > 2000) {
      return NextResponse.json(
        { error: "Maximum 2000 logs per batch" },
        { status: 400 }
      );
    }
    
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    
    const response = await fetch(`${backendUrl}/api/habits/logs/batch`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: result.detail || result.error || "Batch log creation failed" },
        { status: response.status }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Batch log creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Batch log creation failed" },
      { status: 500 }
    );
  }
}

