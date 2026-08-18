/**
 * Shared API helpers for executor modules.
 *
 * These are the core utility functions that all executors depend on.
 * Extracted from orchestrator.ts during Phase 1 refactoring to
 * avoid circular imports between orchestrator ↔ executors.
 */

export const PYTHON_API_BASE = process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface PythonApiRequestOptions {
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs?: number,
) {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Python API helpers
// ---------------------------------------------------------------------------

/**
 * Parse a composite token of the form "actualToken::userId" into its parts.
 * When the SMS orchestrator calls Python API tools, the token is
 * INTERNAL_BACKEND_TOKEN::user_id so that fetchPythonApi can automatically
 * attach the x-internal-user-id header for service-level auth.
 */
function parseCompositeToken(token: string): { bearerToken: string; internalUserId?: string } {
  const sep = token.indexOf('::');
  if (sep === -1) return { bearerToken: token };
  return {
    bearerToken: token.substring(0, sep),
    internalUserId: token.substring(sep + 2),
  };
}

export async function fetchPythonApi(
  endpoint: string,
  token: string,
  params?: Record<string, string | number>,
  options?: PythonApiRequestOptions,
) {
  const url = new URL(`${PYTHON_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }

  console.log(`🐍 Calling Python API: ${url.toString()}`);

  const { bearerToken, internalUserId } = parseCompositeToken(token);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    ...(options?.extraHeaders || {}),
  };
  if (internalUserId) {
    headers['x-internal-user-id'] = internalUserId;
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers,
  }, options?.timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function fetchPythonApiPost(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
  options?: PythonApiRequestOptions,
) {
  const url = `${PYTHON_API_BASE}${endpoint}`;
  console.log(`🐍 Calling Python API (POST): ${url}`);

  const { bearerToken, internalUserId } = parseCompositeToken(token);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    ...(options?.extraHeaders || {}),
  };
  if (internalUserId) {
    headers['x-internal-user-id'] = internalUserId;
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, options?.timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API POST error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function fetchPythonApiPatch(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
  options?: PythonApiRequestOptions,
) {
  const url = `${PYTHON_API_BASE}${endpoint}`;
  console.log(`🐍 Calling Python API (PATCH): ${url}`);

  const { bearerToken, internalUserId } = parseCompositeToken(token);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    ...(options?.extraHeaders || {}),
  };
  if (internalUserId) {
    headers['x-internal-user-id'] = internalUserId;
  }

  const response = await fetchWithTimeout(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  }, options?.timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API PATCH error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function getTimezoneYmd(date: Date, timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTzDay(ts: number, timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(ts));
}

export function formatTzTimestamp(ts: number, timezone?: string): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: timezone || 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Clamping helpers
// ---------------------------------------------------------------------------

export function clampDaysBack(daysBack?: number): number {
  if (!Number.isFinite(daysBack) || !daysBack || daysBack <= 0) return 7;
  return Math.min(Math.max(Math.round(daysBack), 1), 90);
}

export function clampSearchLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return 10;
  return Math.min(Math.max(Math.round(limit), 1), 50);
}

export function formatWeeklyNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
