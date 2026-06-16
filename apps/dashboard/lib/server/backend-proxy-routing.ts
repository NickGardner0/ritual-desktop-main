const BACKEND_PATH_ALIASES: Record<string, string> = {
  "/api/ready": "/ready",
  "/api/wearables/apple/export-history": "/api/wearables/apple/export_history",
  "/api/wearables/apple/export-schedule": "/api/wearables/apple/export_schedule",
  "/api/wearables/apple/metric-catalog": "/api/wearables/apple/metric_catalog",
  "/api/wearables/apple/metric-preferences": "/api/wearables/apple/metric_preferences",
};

const GET_COMPATIBILITY_FALLBACKS: Record<string, unknown> = {
  "/api/financial/connections": { connections: [] },
  "/api/integrations/whoop/status": { connected: false, sync_hour: 9 },
  "/api/search/habits": { hits: [], found: 0 },
  "/api/watcher/devices": { devices: [] },
  "/api/wearables/apple/devices": { devices: [] },
  "/api/wearables/apple/export_history": { history: [] },
  "/api/wearables/apple/export_schedule": { schedule: null },
  "/api/wearables/apple/metric_catalog": { categories: [] },
  "/api/wearables/apple/metric_preferences": {
    selected_metrics: [],
    preferences: {},
  },
  "/api/wearables/connections": { connections: [] },
};

export function resolveBackendProxyPath(requestedPath: string): string {
  return BACKEND_PATH_ALIASES[requestedPath] ?? requestedPath;
}

export function getBackendProxyCompatibilityFallback(
  method: string,
  backendApiPath: string,
  searchParams?: URLSearchParams,
): unknown {
  if (method !== "GET") {
    return undefined;
  }

  if (backendApiPath === "/api/suggestions") {
    return {
      suggestions: [],
      mode: searchParams?.get("mode") || "chat",
      query: searchParams?.get("q") || "",
    };
  }

  return GET_COMPATIBILITY_FALLBACKS[backendApiPath];
}
