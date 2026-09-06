export function resolveProxyForwarding(contentTypeHeader: string | null | undefined) {
  const contentType = contentTypeHeader?.trim() || "";
  const isMultipart = contentType.toLowerCase().includes("multipart/form-data");
  return {
    isMultipart,
    contentType: isMultipart ? contentType : "application/json",
  };
}

export function buildBackendAuthHeaders({
  userId,
  token,
  contentType = "application/json",
  forceFresh = false,
}: {
  userId?: string | null
  token?: string | null
  contentType?: string
  forceFresh?: boolean
}): HeadersInit {
  const headers: Record<string, string> = {}

  if (contentType) {
    headers["Content-Type"] = contentType
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  if (forceFresh) {
    headers["X-Ritual-Force-Fresh"] = "1"
  }

  const internalKey = process.env.INTERNAL_API_KEY?.trim()
  if (internalKey && userId) {
    headers["X-User-ID"] = userId
    headers["X-Internal-Key"] = internalKey
  }

  return headers
}
