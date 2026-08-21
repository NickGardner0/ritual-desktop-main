'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  ActivityBreakdownSource,
  BreakdownResponse,
  UsageBreakdownKind,
} from '@/lib/computerActivity/contracts';
import { QUERY_POLICY } from '@/lib/query-policies';
import { getReadConsistencyHeaders } from '@/lib/read-consistency';

export interface UsageBreakdownParams {
  source?: ActivityBreakdownSource;
  kind: UsageBreakdownKind;
  key: string;
  start: string;
  end: string;
  enabled?: boolean;
}

function isValidDateString(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (current.getTime() <= last.getTime()) {
    const year = current.getFullYear();
    const month = `${current.getMonth() + 1}`.padStart(2, '0');
    const day = `${current.getDate()}`.padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function formatLocalTime(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function shapeUsageBreakdown(payload: {
  kind: UsageBreakdownKind;
  key: string;
  start: string;
  end: string;
  rows: Array<{
    day?: string;
    active_ms?: number;
    total_seconds?: number;
    active_seconds?: number;
    first_start_ms?: number;
    last_end_ms?: number;
  }>;
}): BreakdownResponse {
  const valueByDate = new Map(
    payload.rows.map((row) => {
      const activeMs = Math.max(
        0,
        Number(row.active_ms || 0) || Number(row.total_seconds || row.active_seconds || 0) * 1000,
      );
      return [
        String(row.day || ''),
        {
          activeMs,
          seconds: Math.round(activeMs / 1000),
          startTime: formatLocalTime(row.first_start_ms),
          endTime: formatLocalTime(row.last_end_ms),
        },
      ] as const;
    }),
  );

  const points = buildDateRange(payload.start, payload.end).map((date) => {
    const entry = valueByDate.get(date);
    return {
      date,
      activeMs: entry?.activeMs || 0,
      seconds: entry?.seconds || 0,
      startTime: entry?.startTime || null,
      endTime: entry?.endTime || null,
    };
  });
  const totalMs = points.reduce((sum, point) => sum + point.activeMs, 0);

  return {
    kind: payload.kind,
    key: payload.key,
    start: payload.start,
    end: payload.end,
    points,
    totalSeconds: Math.round(totalMs / 1000),
    totalMs,
  };
}

export function useUsageBreakdown({
  source = 'desktop',
  kind,
  key,
  start,
  end,
  enabled = true,
}: UsageBreakdownParams) {
  return useQuery({
    queryKey: ['usage-breakdown', source, kind, key, start, end],
    queryFn: async () => {
      if ((kind !== 'app' && kind !== 'website') || (source !== 'desktop' && source !== 'iphone')) {
        throw new Error('Invalid usage breakdown request');
      }
      if (!key || !isValidDateString(start) || !isValidDateString(end)) {
        throw new Error('Invalid start/end date');
      }

      const params = new URLSearchParams({
        kind,
        key,
        start_date: start,
        end_date: end,
      });
      const upstream = source === 'iphone' ? '/api/screen-time/breakdown' : '/api/watcher/breakdown';
      const response = await fetch(`${upstream}?${params.toString()}`, {
        headers: {
          ...getReadConsistencyHeaders(),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.detail || 'Failed to fetch usage breakdown');
      }

      const data = await response.json();
      const rows = Array.isArray(data?.data) ? data.data : [];
      return shapeUsageBreakdown({ kind, key, start, end, rows });
    },
    enabled: enabled && !!kind && !!key && !!start && !!end,
    staleTime: QUERY_POLICY.computerBreakdown.staleTime,
    gcTime: QUERY_POLICY.computerBreakdown.gcTime,
  });
}
