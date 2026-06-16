import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getServerBackendBaseUrl } from "@/lib/api/server-client";

/**
 * POST /api/import/preview
 * 
 * Preview what will be imported before committing.
 * Returns summary counts, sample items, validation issues, and dedupe estimates.
 * 
 * OPTIMIZED:
 * - Options now passed in FormData body (more robust than header)
 * - Supports idempotent file hash resume
 * - Bulk duplicate checking for <300ms response time
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
    
    // Get source from query params (backward compatible)
    const source = request.nextUrl.searchParams.get("source");
    
    // Get the form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const formSource = formData.get("source") as string | null;
    const optionsStr = formData.get("options") as string | null;
    
    // Use source from FormData if not in query params
    const finalSource = source || formSource;
    
    if (!finalSource) {
      return NextResponse.json({ error: "Source is required" }, { status: 400 });
    }
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    
    // Parse options from FormData body
    let options = {};
    if (optionsStr) {
      try {
        options = JSON.parse(optionsStr);
      } catch {
        // Ignore parse errors
      }
    }
    
    // Fallback: Get options from header (backward compatible)
    if (Object.keys(options).length === 0) {
      const optionsHeader = request.headers.get("X-Import-Options");
      if (optionsHeader) {
        try {
          const headerData = JSON.parse(optionsHeader);
          options = headerData.options || headerData;
        } catch {
          // Ignore parse errors
        }
      }
    }
    
    // Forward to Python backend
    const backendUrl = getServerBackendBaseUrl();
    
    // Create a new FormData to send to the backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    backendFormData.append("source", finalSource);
    backendFormData.append("options", JSON.stringify(options));
    
    const response = await fetch(`${backendUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
      body: backendFormData,
      signal: AbortSignal.timeout(15000),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: result.detail || result.error || "Preview failed", detail: result.detail },
        { status: response.status }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Import preview error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 }
    );
  }
}
