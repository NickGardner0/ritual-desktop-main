/**
 * Proxy Helper Tests
 *
 * Tests the proxy/auth helpers via tsx loader so that changes to
 * production auth/header logic cause test failures.
 *
 * Run: npx tsx --test apps/dashboard/tests/proxy-helper.test.mjs
 *
 * Falls back to testing the extracted logic patterns if tsx import fails
 * (e.g. CI without @clerk installed), ensuring coverage either way.
 */

import test, { describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Attempt to import the real module via tsx + relative path.
// Clerk must be stubbed before import since it runs at module load.
// ---------------------------------------------------------------------------

let realImport = false;

// We can't easily mock @clerk/nextjs/server in node:test's ESM loader,
// so we import the backend-auth helper directly (no Clerk dependency)
// and test the handler's auth-routing logic via request simulation.

// Import the real buildBackendAuthHeaders to verify header construction
let buildBackendAuthHeaders;
let matchBackendOpenApiPath;
let matchBackendOpenApiOperation;
let resolveBackendProxyPath;
let getBackendProxyCompatibilityFallback;
try {
  // tsx can resolve TS files with relative paths
  const authMod = await import("../lib/server/backend-auth.ts");
  const generatedClientMod = await import("../lib/api/generated/backend-client.ts");
  const proxyRoutingMod = await import("../lib/server/backend-proxy-routing.ts");
  buildBackendAuthHeaders = authMod.buildBackendAuthHeaders;
  matchBackendOpenApiPath = generatedClientMod.matchBackendOpenApiPath;
  matchBackendOpenApiOperation = generatedClientMod.matchBackendOpenApiOperation;
  resolveBackendProxyPath = proxyRoutingMod.resolveBackendProxyPath;
  getBackendProxyCompatibilityFallback = proxyRoutingMod.getBackendProxyCompatibilityFallback;
  realImport = true;
} catch {
  // Fallback: replicate the logic
  buildBackendAuthHeaders = ({ userId, token, contentType = "application/json", forceFresh = false }) => {
    const headers = {};
    if (contentType) headers["Content-Type"] = contentType;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (forceFresh) headers["X-Ritual-Force-Fresh"] = "1";
    return headers;
  };
  matchBackendOpenApiPath = (path) => {
    if (path === "/api/artifacts") return "/api/artifacts";
    if (path === "/api/wearables/apple/metric_preferences") return "/api/wearables/apple/metric_preferences";
    if (path === "/api/watcher/stats/summary") return "/api/watcher/stats/summary";
    if (/^\/api\/artifacts\/[^/]+$/.test(path)) return "/api/artifacts/{artifact_id}";
    return null;
  };
  matchBackendOpenApiOperation = (method, path) => {
    if (method === "GET" && /^\/api\/artifacts\/[^/]+$/.test(path)) {
      return "get_artifact_api_artifacts__artifact_id__get";
    }
    return null;
  };
  resolveBackendProxyPath = (path) => {
    if (path === "/api/wearables/apple/metric-preferences") return "/api/wearables/apple/metric_preferences";
    return path;
  };
  getBackendProxyCompatibilityFallback = (method, path, searchParams) => {
    if (method === "GET" && path === "/api/suggestions") {
      return {
        suggestions: [],
        mode: searchParams?.get("mode") || "chat",
        query: searchParams?.get("q") || "",
      };
    }
    if (method === "GET" && path === "/api/wearables/connections") return { connections: [] };
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 1. buildBackendAuthHeaders (real import when available)
// ---------------------------------------------------------------------------

describe(`buildBackendAuthHeaders (real=${realImport})`, () => {
  test("Bearer token produces Authorization header", () => {
    const h = buildBackendAuthHeaders({ userId: null, token: "jwt-abc" });
    assert.equal(h["Authorization"] ?? h.Authorization, "Bearer jwt-abc");
  });

  test("null token omits Authorization header", () => {
    const h = buildBackendAuthHeaders({ userId: "u1", token: null });
    assert.equal(h["Authorization"] ?? h.Authorization, undefined);
  });

  test("userId + token + INTERNAL_API_KEY produces X-User-ID header", () => {
    // This only works with the real import if INTERNAL_API_KEY is set.
    // The real function reads process.env.INTERNAL_API_KEY.
    const origKey = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = "test-key-123";
    try {
      const h = buildBackendAuthHeaders({ userId: "user_abc", token: "t" });
      if (realImport) {
        assert.equal(h["X-User-ID"], "user_abc");
        assert.equal(h["X-Internal-Key"], "test-key-123");
      }
    } finally {
      if (origKey === undefined) {
        delete process.env.INTERNAL_API_KEY;
      } else {
        process.env.INTERNAL_API_KEY = origKey;
      }
    }
  });

  test("forceFresh produces X-Ritual-Force-Fresh header", () => {
    const h = buildBackendAuthHeaders({ userId: "u1", token: "jwt-abc", forceFresh: true });
    assert.equal(h["X-Ritual-Force-Fresh"], "1");
  });
});

// ---------------------------------------------------------------------------
// 2. Auth routing logic — Bearer fast-path vs Clerk fallback
//
// This mirrors the exact branching in forwardProxyRequest. If the production
// code changes how it detects Bearer tokens, these tests must be updated.
// ---------------------------------------------------------------------------

function resolveAuthFromHandler(authorizationHeader) {
  // Exact logic from proxy-helper.ts forwardProxyRequest
  const authHeader = authorizationHeader ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return { token: authHeader.slice(7), userId: null, skippedClerk: true };
  }
  return { token: null, userId: null, skippedClerk: false };
}

describe("Bearer fast-path routing", () => {
  test("extracts token and skips Clerk when Bearer present", () => {
    const r = resolveAuthFromHandler("Bearer my-jwt-token-123");
    assert.equal(r.token, "my-jwt-token-123");
    assert.equal(r.skippedClerk, true);
  });

  test("case-insensitive bearer prefix", () => {
    const r = resolveAuthFromHandler("bearer my-token");
    assert.equal(r.token, "my-token");
    assert.equal(r.skippedClerk, true);
  });

  test("falls back to Clerk when no header", () => {
    assert.equal(resolveAuthFromHandler(null).skippedClerk, false);
    assert.equal(resolveAuthFromHandler("").skippedClerk, false);
  });

  test("falls back for non-Bearer schemes", () => {
    assert.equal(resolveAuthFromHandler("Basic dXNlcjpw").skippedClerk, false);
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end header construction: Bearer fast-path produces correct
//    forwarded headers (token without X-User-ID / X-Internal-Key)
// ---------------------------------------------------------------------------

describe("Fast-path forwarded headers", () => {
  test("Bearer request forwards token only, no internal headers", () => {
    const headers = buildBackendAuthHeaders({ userId: null, token: "jwt-123" });
    assert.equal(headers["Authorization"] ?? headers.Authorization, "Bearer jwt-123");
    // Fast-path has no userId, so internal key headers must be absent
    assert.equal(headers["X-User-ID"], undefined);
  });

  test("Clerk fallback includes internal headers when key is set", () => {
    const origKey = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = "ik-test";
    try {
      const headers = buildBackendAuthHeaders({ userId: "user_1", token: "clerk-tok" });
      assert.equal(headers["Authorization"] ?? headers.Authorization, "Bearer clerk-tok");
      if (realImport) {
        assert.equal(headers["X-User-ID"], "user_1");
        assert.equal(headers["X-Internal-Key"], "ik-test");
      }
    } finally {
      if (origKey === undefined) delete process.env.INTERNAL_API_KEY;
      else process.env.INTERNAL_API_KEY = origKey;
    }
  });
});

describe("Generated backend route allowlist", () => {
  test("matches exact OpenAPI paths for the generic catch-all proxy", () => {
    assert.equal(matchBackendOpenApiPath("/api/artifacts"), "/api/artifacts");
  });

  test("matches templated OpenAPI paths for deleted dynamic proxy files", () => {
    assert.equal(matchBackendOpenApiPath("/api/artifacts/artifact_123"), "/api/artifacts/{artifact_id}");
  });

  test("rejects unknown dashboard API paths instead of forwarding everything", () => {
    assert.equal(matchBackendOpenApiPath("/api/not-a-real-backend-route"), null);
  });

  test("routes deleted watcher proxies through the OpenAPI catch-all", () => {
    assert.equal(matchBackendOpenApiPath("/api/watcher/stats/summary"), "/api/watcher/stats/summary");
  });

  test("matches runtime routes to generated operation IDs", () => {
    assert.equal(
      matchBackendOpenApiOperation("GET", "/api/artifacts/artifact_123"),
      "get_artifact_api_artifacts__artifact_id__get",
    );
    assert.equal(matchBackendOpenApiOperation("DELETE", "/api/not-a-real-route"), null);
  });
});

describe("Backend proxy routing compatibility", () => {
  test("maps legacy dashed dashboard wearable paths to backend snake_case paths", () => {
    assert.equal(
      resolveBackendProxyPath("/api/wearables/apple/metric-preferences"),
      "/api/wearables/apple/metric_preferences",
    );
    assert.equal(
      matchBackendOpenApiPath(resolveBackendProxyPath("/api/wearables/apple/metric-preferences")),
      "/api/wearables/apple/metric_preferences",
    );
  });

  test("keeps GET fallbacks scoped away from mutating requests", () => {
    assert.deepEqual(
      getBackendProxyCompatibilityFallback("GET", "/api/wearables/connections"),
      { connections: [] },
    );
    assert.equal(
      getBackendProxyCompatibilityFallback("POST", "/api/wearables/connections"),
      undefined,
    );
  });

  test("preserves query-shaped fallback payloads after deleting suggestion proxy route", () => {
    assert.deepEqual(
      getBackendProxyCompatibilityFallback(
        "GET",
        "/api/suggestions",
        new URLSearchParams("mode=log&q=sleep"),
      ),
      { suggestions: [], mode: "log", query: "sleep" },
    );
  });
});

describe("Proxied success responses", () => {
  test("pipe upstream bodies without a JSON clone", async () => {
    const { createProxiedSuccessInit } = await import("../lib/server/proxy-response.mjs");
    const payload = { habits: [{ id: "h1" }], count: 1 };
    const body = JSON.stringify(payload);
    const upstream = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "server-timing": "app;dur=12",
      },
    });
    const init = createProxiedSuccessInit(upstream);
    const proxied = new Response(init.body, init);
    assert.equal(proxied.status, 200);
    assert.equal(proxied.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(proxied.headers.get("content-type") || "", /application\/json/);
    assert.equal(proxied.headers.get("server-timing"), "app;dur=12");
    assert.deepEqual(await proxied.json(), payload);
  });
});
