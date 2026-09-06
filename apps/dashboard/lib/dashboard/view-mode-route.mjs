/**
 * Resolve the dashboard panel from its URL.
 *
 * Index intentionally uses the canonical `/dashboard` URL, so a missing
 * `view` parameter must reset the client-side panel to overview.
 *
 * @param {{ get(name: string): string | null }} searchParams
 * @returns {"overview" | "metrics"}
 */
export function resolveDashboardViewMode(searchParams) {
  return searchParams.get("view") === "metrics" ? "metrics" : "overview";
}
