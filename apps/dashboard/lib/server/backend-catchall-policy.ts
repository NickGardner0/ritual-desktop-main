const EXPLICIT_NEXT_ADAPTER_PATHS = new Set([
  "/api/import/preview",
  "/api/screenshot/preview",
  "/api/wearables/apple/export",
]);

export type BackendCatchallPolicyResult =
  | { allowed: true }
  | { allowed: false; status: 404 | 415; error: string };

export function evaluateBackendCatchallPolicy(
  path: string,
  method: string,
  contentType: string | null,
): BackendCatchallPolicyResult {
  if (EXPLICIT_NEXT_ADAPTER_PATHS.has(path)) {
    return { allowed: false, status: 404, error: "API route has an explicit adapter" };
  }

  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return { allowed: true };
  }

  const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !normalizedContentType
    || normalizedContentType === "application/json"
    || (normalizedContentType.startsWith("application/") && normalizedContentType.endsWith("+json"))
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: 415,
    error: "The generic backend route accepts JSON operations only",
  };
}
