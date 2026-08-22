export function createProxiedSuccessInit(upstream) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store, max-age=0");
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  for (const headerName of [
    "server-timing",
    "x-ritual-bootstrap-duration-ms",
    "x-ritual-bootstrap-mode",
  ]) {
    const headerValue = upstream.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }
  return {
    body: upstream.body,
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  };
}
