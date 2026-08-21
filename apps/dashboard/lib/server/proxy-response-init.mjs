export function createProxiedSuccessInit(upstream) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store, max-age=0");
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  return {
    body: upstream.body,
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  };
}
