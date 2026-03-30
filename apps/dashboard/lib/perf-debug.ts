'use client'

import { isTauri } from '@/lib/tauri-utils'
import type { QueryClient } from '@tanstack/react-query'

type PerfPayload = Record<string, unknown>

const PERF_PREFIX = '[Ritual][perf]'

function shouldEmitPerfLogs() {
  if (typeof window === 'undefined') return true

  try {
    if (window.localStorage.getItem('ritual_perf_debug') === '0') {
      return false
    }
    if (window.localStorage.getItem('ritual_perf_debug') === '1') {
      return true
    }
  } catch {
    // ignore storage errors
  }

  return isTauri() || process.env.NODE_ENV !== 'production'
}

function safeConsole(
  level: 'info' | 'warn' | 'error',
  scope: string,
  event: string,
  payload?: PerfPayload,
) {
  if (!shouldEmitPerfLogs()) return

  const logger = console[level] ?? console.info
  if (payload && Object.keys(payload).length > 0) {
    logger(`${PERF_PREFIX}[${scope}] ${event}`, payload)
  } else {
    logger(`${PERF_PREFIX}[${scope}] ${event}`)
  }
}

export function perfInfo(scope: string, event: string, payload?: PerfPayload) {
  safeConsole('info', scope, event, payload)
}

export function perfWarn(scope: string, event: string, payload?: PerfPayload) {
  safeConsole('warn', scope, event, payload)
}

export function perfError(scope: string, event: string, payload?: PerfPayload) {
  safeConsole('error', scope, event, payload)
}

export function startPerfTimer(scope: string, event: string, payload?: PerfPayload) {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
  perfInfo(scope, `${event}:start`, payload)

  return (resultPayload?: PerfPayload) => {
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now()
    perfInfo(scope, `${event}:end`, {
      duration_ms: Number((end - start).toFixed(2)),
      ...(resultPayload ?? {}),
    })
  }
}

export function auditLocalStorage(scope: string, keys: string[]) {
  if (typeof window === 'undefined') return

  try {
    const snapshot = keys.map((key) => {
      const value = window.localStorage.getItem(key)
      return {
        key,
        bytes: value ? value.length : 0,
        present: Boolean(value),
      }
    })

    perfInfo(scope, 'localStorage-audit', { keys: snapshot })
  } catch (error) {
    perfWarn(scope, 'localStorage-audit-failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function auditQueryCache(scope: string, queryClient: QueryClient) {
  try {
    const queries = queryClient.getQueryCache().getAll()
    const snapshot = queries.map((query) => {
      let dataBytes = 0
      try {
        dataBytes = JSON.stringify(query.state.data).length
      } catch {
        dataBytes = -1
      }

      return {
        key: JSON.stringify(query.queryKey),
        status: query.state.status,
        fetch_status: query.state.fetchStatus,
        data_bytes: dataBytes,
        updated_at: query.state.dataUpdatedAt,
      }
    })

    perfInfo(scope, 'query-cache-audit', {
      query_count: snapshot.length,
      total_data_bytes: snapshot.reduce(
        (sum, query) => sum + Math.max(query.data_bytes, 0),
        0,
      ),
      queries: snapshot,
    })
  } catch (error) {
    perfWarn(scope, 'query-cache-audit-failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
