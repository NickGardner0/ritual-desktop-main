const BACKEND_PATH_ALIASES: Record<string, string> = {
  "/api/ready": "/ready",
  "/api/wearables/apple/export-history": "/api/wearables/apple/export_history",
  "/api/wearables/apple/export-schedule": "/api/wearables/apple/export_schedule",
  "/api/wearables/apple/metric-catalog": "/api/wearables/apple/metric_catalog",
  "/api/wearables/apple/metric-preferences": "/api/wearables/apple/metric_preferences",
};

export function resolveBackendProxyPath(requestedPath: string): string {
  return BACKEND_PATH_ALIASES[requestedPath] ?? requestedPath;
}
