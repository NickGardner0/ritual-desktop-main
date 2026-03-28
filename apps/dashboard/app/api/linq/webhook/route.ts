import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

/**
 * Forward Linq webhook to Python backend.
 * No Clerk auth — this is called by Linq's servers, not by a user.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const contentType =
      request.headers.get("content-type") || "application/json";
    const webhookTimestamp =
      request.headers.get("X-Webhook-Timestamp") || "";
    const webhookSignature =
      request.headers.get("X-Webhook-Signature") || "";

    const backendResponse = await fetch(`${BACKEND_URL}/api/linq/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        // Preserve Linq's signed webhook headers for backend verification.
        "X-Webhook-Timestamp": webhookTimestamp,
        "X-Webhook-Signature": webhookSignature,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });
  } catch (error) {
    console.error("Linq webhook proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
