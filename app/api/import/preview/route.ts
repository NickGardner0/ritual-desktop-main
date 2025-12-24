import { NextRequest, NextResponse } from "next/server";
import { auth, getAuth } from "@clerk/nextjs/server";

/**
 * POST /api/import/preview
 * 
 * Preview what will be imported before committing.
 * Returns summary counts, sample items, validation issues, and dedupe estimates.
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
    
    // Get source from query params
    const source = request.nextUrl.searchParams.get("source");
    if (!source) {
      return NextResponse.json({ error: "Source is required" }, { status: 400 });
    }
    
    // Get options from header
    const optionsHeader = request.headers.get("X-Import-Options");
    let options = {};
    if (optionsHeader) {
      try {
        options = JSON.parse(optionsHeader);
      } catch {
        // Ignore parse errors
      }
    }
    
    // Get the form data (file)
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    
    // Forward to Python backend
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    
    // Create a new FormData to send to the backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    
    // Build the preview request
    const previewRequest = {
      source,
      options,
    };
    
    const response = await fetch(`${backendUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Import-Options": JSON.stringify(previewRequest),
      },
      body: backendFormData,
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: result.detail || result.error || "Preview failed" },
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

