import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

interface ProxyOptions {
  /** HTTP method override (defaults to request method) */
  method?: string;
  /** Timeout in ms (default 30 000) */
  timeout?: number;
  /** Log tag for console messages (e.g. "habits") */
  tag?: string;
}

/**
 * Shared proxy handler for Next.js API routes that forward to the Python backend.
 *
 * Optimisation: when the incoming request already carries a Bearer token
 * (e.g. Tauri desktop app), we skip the Clerk `auth()` round-trip entirely
 * and forward the token directly. Browser/cookie requests fall back to Clerk.
 */
export function createProxyHandler(
  backendPath: string,
  opts: ProxyOptions = {},
) {
  const tag = opts.tag ?? backendPath.replace(/^\/api\//, "");

  return async function handler(request: NextRequest) {
    const startedAt = Date.now();
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const method = opts.method ?? request.method;
    const timeout = opts.timeout ?? 30_000;

    try {
      // --- Auth: Bearer fast-path vs Clerk fallback ---
      let token: string | null = null;
      let userId: string | null = null;

      const authHeader = request.headers.get("authorization") ?? "";
      if (authHeader.toLowerCase().startsWith("bearer ")) {
        // Tauri / programmatic caller — skip Clerk entirely
        token = authHeader.slice(7);
      } else {
        const clerkAuth = await auth();
        userId = clerkAuth.userId;
        if (!userId) {
          console.warn(`[Ritual][${tag}-proxy] unauthorized`, {
            duration_ms: Date.now() - startedAt,
          });
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        token = await clerkAuth.getToken();
      }

      // --- Forward to backend ---
      const url = `${BACKEND_URL}${backendPath}${queryString ? `?${queryString}` : ""}`;

      const fetchInit: RequestInit = {
        method,
        cache: "no-store",
        headers: buildBackendAuthHeaders({ userId, token }),
        signal: AbortSignal.timeout(timeout),
      };

      // Forward body for non-GET methods
      if (method !== "GET" && method !== "HEAD") {
        fetchInit.body = await request.text();
      }

      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.warn(`[Ritual][${tag}-proxy] backend-error`, {
          duration_ms: Date.now() - startedAt,
          status: response.status,
          body: errorText.slice(0, 300),
        });
        return NextResponse.json(
          { error: errorText || `Backend error` },
          { status: response.status },
        );
      }

      const data = await response.json();
      console.info(`[Ritual][${tag}-proxy] success`, {
        duration_ms: Date.now() - startedAt,
        count: Array.isArray(data) ? data.length : undefined,
      });
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    } catch (error) {
      console.error(`[Ritual][${tag}-proxy] exception`, {
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
