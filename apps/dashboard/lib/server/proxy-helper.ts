import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
const FORCE_FRESH_COOKIE = "ritual_force_fresh_until";
const FORCE_FRESH_WINDOW_MS = 10_000;

interface ProxyOptions {
  /** HTTP method override (defaults to request method) */
  method?: string;
  /** Timeout in ms (default 30 000) */
  timeout?: number;
  /** Log tag for console messages (e.g. "habits") */
  tag?: string;
  /** Compatibility payload for legacy dashboard callers when a backend resource is missing. */
  notFoundFallback?: unknown;
  /** Compatibility payload for legacy dashboard callers when the backend is unavailable. */
  errorFallback?: unknown;
}

export async function forwardProxyRequest(
  request: NextRequest,
  backendPath: string,
  opts: ProxyOptions = {},
) {
  const tag = opts.tag ?? backendPath.replace(/^\/api\//, "");
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
    const forceFreshUntil = Number(request.cookies.get(FORCE_FRESH_COOKIE)?.value ?? 0);
    const forceFreshFromCookie = Number.isFinite(forceFreshUntil) && forceFreshUntil > Date.now();
    const forceFresh = request.headers.get("x-ritual-force-fresh") === "1" || forceFreshFromCookie;
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
      headers: buildBackendAuthHeaders({ userId, token, forceFresh }),
      signal: AbortSignal.timeout(timeout),
    };

    // Forward body for non-GET methods
    if (method !== "GET" && method !== "HEAD") {
      fetchInit.body = await request.text();
    }

    const response = await fetch(url, fetchInit);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 404 && opts.notFoundFallback !== undefined) {
        console.warn(`[Ritual][${tag}-proxy] backend-not-found-fallback`, {
          duration_ms: Date.now() - startedAt,
          status: response.status,
        });
        return NextResponse.json(opts.notFoundFallback, {
          headers: { "Cache-Control": "no-store, max-age=0" },
        });
      }

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
    const nextResponse = NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
    if (shouldSetForceFreshCookie(method, backendPath)) {
      nextResponse.cookies.set(FORCE_FRESH_COOKIE, String(Date.now() + FORCE_FRESH_WINDOW_MS), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: Math.ceil(FORCE_FRESH_WINDOW_MS / 1000),
      });
    }
    return nextResponse;
  } catch (error) {
    if (opts.errorFallback !== undefined) {
      console.warn(`[Ritual][${tag}-proxy] exception-fallback`, {
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(opts.errorFallback, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    console.error(`[Ritual][${tag}-proxy] exception`, {
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function shouldSetForceFreshCookie(method: string, backendPath: string): boolean {
  if (method === "GET" || method === "HEAD") {
    return false;
  }

  return (
    backendPath === "/api/user/bootstrap/profile"
    || backendPath === "/api/user/activation/first-behavior"
    || backendPath.startsWith("/api/habits")
    || backendPath === "/api/logs/batch"
  );
}
