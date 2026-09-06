export const DESKTOP_WEBVIEW_ORIGINS = [
  'https://tauri.localhost',
  'http://tauri.localhost',
  'tauri://localhost',
  'http://127.0.0.1:1420',
  'http://localhost:1420',
] as const;

export function desktopWebviewCorsHeaders(
  origin: string | null | undefined,
): Record<string, string> | null {
  const trimmed = origin?.trim() ?? '';
  if (!DESKTOP_WEBVIEW_ORIGINS.includes(trimmed as (typeof DESKTOP_WEBVIEW_ORIGINS)[number])) {
    return null;
  }
  return {
    'Access-Control-Allow-Origin': trimmed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
