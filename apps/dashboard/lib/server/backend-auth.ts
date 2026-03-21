export function buildBackendAuthHeaders({
  userId,
  token,
  contentType = "application/json",
}: {
  userId?: string | null
  token?: string | null
  contentType?: string
}): HeadersInit {
  const headers: Record<string, string> = {}

  if (contentType) {
    headers["Content-Type"] = contentType
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const internalKey = process.env.INTERNAL_API_KEY?.trim()
  if (internalKey && userId) {
    headers["X-User-ID"] = userId
    headers["X-Internal-Key"] = internalKey
  }

  return headers
}
