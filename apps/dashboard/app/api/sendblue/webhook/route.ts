import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
const WEBHOOK_PROXY_TIMEOUT_MS = Number(
  process.env.SENDBLUE_WEBHOOK_PROXY_TIMEOUT_MS || 45000,
);

export const maxDuration = 60;

/**
 * Forward Sendblue webhook to Python backend.
 * No Clerk auth — this is called by Sendblue's servers, not by a user.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const contentType =
      request.headers.get("content-type") || "application/json";

    // SendBlue sends the shared secret in the `sb-signing-secret` header.
    // Fall back to `x-webhook-secret` for any other caller.
    const webhookSecret =
      request.headers.get("sb-signing-secret") ||
      request.headers.get("x-webhook-secret") ||
      "";

    const backendResponse = await fetch(`${BACKEND_URL}/api/sendblue/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "x-webhook-secret": webhookSecret,
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_PROXY_TIMEOUT_MS),
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
