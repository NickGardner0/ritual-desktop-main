import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

/**
 * Forward Sendblue webhook to Python backend.
 * No Clerk auth — this is called by Sendblue's servers, not by a user.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const contentType =
      request.headers.get("content-type") || "application/json";

    const webhookSecret = request.headers.get("x-webhook-secret") || "";

    // DEBUG: log all incoming headers from SendBlue so we can identify
    // which header name SendBlue uses for the webhook secret/signature.
    const headerDump: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headerDump[key] = value;
    });
    console.log(
      "[sendblue-webhook] incoming headers:",
      JSON.stringify(headerDump),
    );

    // Forward common SendBlue header name candidates so the backend can
    // pick whichever header SendBlue actually uses.
    const forwardHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "x-webhook-secret": webhookSecret,
    };
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("x-sendblue") ||
        lower.startsWith("x-sb-") ||
        lower === "x-signature" ||
        lower === "x-signing-secret" ||
        lower === "authorization"
      ) {
        forwardHeaders[key] = value;
      }
    });

    const backendResponse = await fetch(`${BACKEND_URL}/api/sendblue/webhook`, {
      method: "POST",
      headers: forwardHeaders,
      body,
      signal: AbortSignal.timeout(15000),
    });

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });
  } catch (error) {
    console.error("Sendblue webhook proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
