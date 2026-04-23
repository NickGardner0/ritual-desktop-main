import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { addDays, subDays, format } from 'date-fns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type HabitMeta = {
  name?: string;
  category: string;
  icon?: string;
  unit_type?: string;
  integration_source?: string;
  metric_type?: string;
};

function parseCompletedAt(value?: string | null): Date | null {
  if (!value || typeof value !== 'string') return null;

  try {
    if (value.includes('T')) {
      const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
      const normalized = hasTimezone ? value : `${value}Z`;
      const parsed = new Date(normalized);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    if (value.includes(' ')) {
      const parsed = new Date(value.replace(' ', 'T') + 'Z');
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  } catch {
    return null;
  }

  return null;
}

function formatDateInTimeZone(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall through to UTC formatting.
  }

  return format(value, 'yyyy-MM-dd');
}

function shiftDateKey(dateValue: string, deltaDays: number): string {
  const anchor = new Date(`${dateValue}T12:00:00Z`);
  return format(addDays(anchor, deltaDays), 'yyyy-MM-dd');
}

/**
 * GET /api/analytics/habits/logs/all
 * 
 * Fetches all habit logs with optional filtering and sorting.
 * Used by the Activity page for the habit logs table.
 * 
 * Query params:
 * - q: Search query (searches habit names and notes)
 * - start_date: Start date filter (ISO format)
 * - end_date: End date filter (ISO format)
 * - categories: Comma-separated category names
 * - habits: Comma-separated habit IDs
 * - statuses: Comma-separated statuses (completed, skipped, missed)
 * - sources: Comma-separated integration sources
 * - sort: Column to sort by (date, habit, value, category, status)
 * - order: Sort order (asc, desc)
 * - limit: Max results to return (default: 500)
 * - offset: Row offset for pagination (default: 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = await getToken();
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const q = searchParams.get('q');
    const startDate = searchParams.get('start_date') || format(subDays(new Date(), 90), 'yyyy-MM-dd');
    const endDate = searchParams.get('end_date') || format(new Date(), 'yyyy-MM-dd');
    const categories = searchParams.get('categories')?.split(',').filter(Boolean) || [];
    const habits = searchParams.get('habits')?.split(',').filter(Boolean) || [];
    const statuses = searchParams.get('statuses')?.split(',').filter(Boolean) || [];
    const sources = searchParams.get('sources')?.split(',').filter(Boolean) || [];
    const sort = searchParams.get('sort') || 'time';
    const order = searchParams.get('order') || 'desc';
    const timezone = searchParams.get('timezone') || 'UTC';
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '200', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const queryStartDate = shiftDateKey(startDate, -1);
    const queryEndDate = shiftDateKey(endDate, 1);

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    const tinybirdHost = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';
    const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
    const userAgent = request.headers.get('user-agent') || '';
    const isDesktopRequest = userAgent.startsWith('RitualDesktop/');
    
    // Build Tinybird query params
    const tinybirdParams = new URLSearchParams();
    tinybirdParams.set('user_id', userId);
    tinybirdParams.set('start_date', queryStartDate);
    tinybirdParams.set('end_date', queryEndDate);
    tinybirdParams.set('limit', String(Math.min((offset + limit) * 2, 5000))); // Fetch extra for filtering + pagination
    
    const habitsMapPromise = (async () => {
      const habitsMap: Record<string, HabitMeta> = {};
      try {
        const habitsRes = await fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(isDesktopRequest ? 5000 : 10000),
        });
        if (habitsRes.ok) {
          const habitsData = await habitsRes.json();
          habitsData.forEach((h: any) => {
            habitsMap[h.id] = {
              name: h.name,
              category: h.category || 'uncategorized',
              icon: h.icon,
              unit_type: h.unit_type,
              integration_source: h.integration_source,
              metric_type: h.metric_type,
            };
          });
        }
      } catch (e) {
        console.warn('Failed to fetch habits metadata:', e);
      }
      return habitsMap;
    })();

    const normalizeWatcherHabitName = (
      log: any,
      habitsMap: Record<string, { name?: string; category: string; icon?: string; unit_type?: string }>,
    ): string => {
      const explicitName = typeof log.habit_name === 'string' ? log.habit_name.trim() : '';
      if (explicitName) {
        return explicitName;
      }

      const mappedName = typeof habitsMap[log.habit_id]?.name === 'string'
        ? habitsMap[log.habit_id]?.name?.trim()
        : '';
      if (mappedName) {
        return mappedName;
      }

      const source = String(log.source || log.integration_source || '').toLowerCase();
      const notes = String(log.notes || '').toLowerCase();
      const sourceId = String(log.source_id || '').toLowerCase();

      if (
        source === 'ritual_watcher_projection_v1' ||
        source === 'watcher' ||
        sourceId.startsWith('computer_use:') ||
        notes.includes('projected from ritual watcher')
      ) {
        return 'Computer Time';
      }

      return '';
    };

    const parseMetadataObject = (value: any) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    };

    const deriveComputerTimeValue = (
      log: any,
      metadata: Record<string, any> | null,
      unitType: string | undefined,
      habitName: string,
    ) => {
      const rawDuration = Number(log.duration || 0);
      const rawAmount = Number(log.amount || 0);
      if (rawDuration > 0 || rawAmount > 0) {
        return {
          duration: rawDuration > 0 ? rawDuration : undefined,
          amount: rawAmount > 0 ? rawAmount : undefined,
        };
      }

      if (habitName !== 'Computer Time' || !metadata) {
        return { duration: undefined, amount: undefined };
      }

      const activeMs = Math.max(
        0,
        Number(
          metadata.active_ms ??
          metadata.total_ms ??
          metadata.total_active_ms ??
          0,
        ),
      );
      const activeHours = Math.max(
        0,
        Number(
          metadata.active_hours ??
          metadata.total_hours ??
          (activeMs > 0 ? activeMs / (1000 * 60 * 60) : 0),
        ),
      );

      if (activeMs <= 0 && activeHours <= 0) {
        return { duration: undefined, amount: undefined };
      }

      const normalizedUnit = (unitType || '').toLowerCase();
      const derivedDuration = activeMs > 0 ? Math.round(activeMs / 1000) : undefined;
      const derivedAmount = normalizedUnit.includes('minute')
        ? Math.round((activeMs / (1000 * 60)) * 100) / 100
        : Math.round(activeHours * 100) / 100;

      return {
        duration: derivedDuration && derivedDuration > 0 ? derivedDuration : undefined,
        amount: derivedAmount > 0 ? derivedAmount : undefined,
      };
    };

    const normalizeLog = (
      log: any,
      habitsMap: Record<string, HabitMeta>,
    ) => {
      const habitName = normalizeWatcherHabitName(log, habitsMap);
      const habitMeta = habitsMap[log.habit_id] || null;
      const unitType = habitMeta?.unit_type || log.unit_type || log.unit;
      const metadata = parseMetadataObject(log.metadata ?? log.log_metadata);
      const derivedValue = deriveComputerTimeValue(log, metadata, unitType, habitName);
      const metricType = habitMeta?.metric_type || log.metric_type || null;
      const integrationSource = habitMeta?.integration_source || log.integration_source || log.source || 'manual';
      const timePrecision = (
        String(integrationSource).toLowerCase() === 'apple_health'
        && typeof metricType === 'string'
        && metricType.trim().length > 0
        && metricType !== 'sleep_total'
        && metricType !== 'workout'
      )
        ? 'day'
        : 'exact';
      const rawDate = typeof log.date === 'string' ? log.date.slice(0, 10) : '';
      const parsedCompletedAt = parseCompletedAt(log.timestamp || log.completed_at);
      const normalizedDate = timePrecision === 'day'
        ? rawDate
        : parsedCompletedAt
          ? formatDateInTimeZone(parsedCompletedAt, timezone)
          : rawDate;

      return {
        id: log.id,
        habit_id: log.habit_id,
        habit_name: habitName,
        category: habitMeta?.category || log.category || 'uncategorized',
        icon: habitMeta?.icon || log.icon,
        date: normalizedDate,
        raw_date: rawDate,
        completed_at: log.timestamp || log.completed_at,
        duration: derivedValue.duration,
        amount: derivedValue.amount,
        unit_type: unitType,
        status: log.status || 'completed',
        notes: log.notes,
        integration_source: integrationSource,
        metric_type: metricType,
        time_precision: timePrecision,
        metadata,
      };
    };

    const fetchBackendLogs = async () => {
      const response = await fetch(`${backendUrl}/api/habit-logs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(isDesktopRequest ? 12000 : 15000),
      });

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`);
      }

      const data = await response.json();
      const rawLogs = Array.isArray(data) ? data : data.logs || data.data || [];
      return rawLogs;
    };

    if (!tinybirdToken || isDesktopRequest) {
      const [habitsMap, backendLogs] = await Promise.all([
        habitsMapPromise,
        fetchBackendLogs(),
      ]);

      let logs = backendLogs.map((log: any) => normalizeLog(log, habitsMap));

      logs = logs.filter((log: any) => log.date >= startDate && log.date <= endDate);

      if (q) {
        const searchLower = q.toLowerCase();
        logs = logs.filter((log: any) =>
          log.habit_name?.toLowerCase().includes(searchLower) ||
          log.notes?.toLowerCase().includes(searchLower)
        );
      }

      if (categories.length > 0) {
        logs = logs.filter((log: any) =>
          categories.some((cat) => log.category?.toLowerCase() === cat.toLowerCase())
        );
      }

      if (habits.length > 0) {
        logs = logs.filter((log: any) => habits.includes(log.habit_id));
      }

      if (statuses.length > 0) {
        logs = logs.filter((log: any) => statuses.includes(log.status));
      }

      if (sources.length > 0) {
        logs = logs.filter((log: any) => {
          const logSource = log.integration_source || 'manual';
          return sources.some((src) => logSource.toLowerCase() === src.toLowerCase());
        });
      }

      logs.sort((a: any, b: any) => {
        let aVal: any;
        let bVal: any;

        switch (sort) {
          case 'date':
            aVal = new Date(a.date).getTime();
            bVal = new Date(b.date).getTime();
            break;
          case 'habit':
            aVal = a.habit_name?.toLowerCase() || '';
            bVal = b.habit_name?.toLowerCase() || '';
            break;
          case 'value':
            aVal = a.amount || a.duration || 0;
            bVal = b.amount || b.duration || 0;
            break;
          case 'category':
            aVal = a.category?.toLowerCase() || '';
            bVal = b.category?.toLowerCase() || '';
            break;
          case 'status':
            aVal = a.status || '';
            bVal = b.status || '';
            break;
          case 'time':
            aVal = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.date).getTime();
            bVal = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.date).getTime();
            break;
          default:
            aVal = a[sort] || '';
            bVal = b[sort] || '';
        }

        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
      });

      const totalFiltered = logs.length;
      const totalDuration = logs.reduce((sum: number, log: any) => sum + Number(log.duration || 0), 0);
      const totalAmount = logs.reduce((sum: number, log: any) => sum + Number(log.amount || 0), 0);
      const completedCount = logs.filter((log: any) => log.status === 'completed').length;

      const pagedLogs = logs.slice(offset, offset + limit);
      return NextResponse.json({
        success: true,
        data: pagedLogs,
        meta: {
          total: pagedLogs.length,
          totalFiltered,
          offset,
          limit,
          hasMore: offset + pagedLogs.length < totalFiltered,
          filters: { q, startDate, endDate, categories, habits, statuses, sources },
          sort: { column: sort, order },
          totals: {
            count: totalFiltered,
            totalDuration,
            totalAmount,
            completedCount,
            completionRate: totalFiltered > 0 ? (completedCount / totalFiltered) * 100 : 0,
          },
        },
      });
    }

    // Fetch from Tinybird habit_logs_time_range pipe
    const tinybirdUrl = `${tinybirdHost}/v0/pipes/habit_logs_time_range.json?${tinybirdParams.toString()}`;

    const [habitsMap, tinybirdResponse] = await Promise.all([
      habitsMapPromise,
      fetch(tinybirdUrl, {
        headers: {
          'Authorization': `Bearer ${tinybirdToken}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }).catch((error) => {
        console.warn('Failed to fetch Tinybird logs:', error);
        return null;
      }),
    ]);

    let logs: any[] = [];
    let tinybirdSucceeded = false;

    if (tinybirdResponse?.ok) {
      const result = await tinybirdResponse.json();
      logs = (result.data || []).map((log: any) => normalizeLog(log, habitsMap));
      tinybirdSucceeded = true;
    } else if (tinybirdResponse) {
      const errorText = await tinybirdResponse.text();
      console.error('Tinybird API error:', errorText);
    }

    // Avoid fetching and merging the entire backend history on the hot path.
    // That extra fetch scales with total account size and can keep the logs page
    // in a pending state for a long time in production. Tinybird already powers
    // the paginated query path; fall back to backend logs only when analytics
    // data is unavailable for the requested range.
    if (!tinybirdSucceeded) {
      const backendLogs = await fetchBackendLogs().catch((error) => {
        console.warn('Failed to fetch backend logs for fallback:', error);
        return [];
      });
      logs = backendLogs.map((log: any) => normalizeLog(log, habitsMap));
    }

    logs = logs.filter((log: any) => log.date >= startDate && log.date <= endDate);

    // Apply client-side filters
    if (q) {
      const searchLower = q.toLowerCase();
      logs = logs.filter((log: any) => 
        log.habit_name?.toLowerCase().includes(searchLower) ||
        log.notes?.toLowerCase().includes(searchLower)
      );
    }

    if (categories.length > 0) {
      logs = logs.filter((log: any) => 
        categories.some(cat => log.category?.toLowerCase() === cat.toLowerCase())
      );
    }

    if (habits.length > 0) {
      logs = logs.filter((log: any) => habits.includes(log.habit_id));
    }

    if (statuses.length > 0) {
      logs = logs.filter((log: any) => statuses.includes(log.status));
    }

    if (sources.length > 0) {
      logs = logs.filter((log: any) => {
        const logSource = log.integration_source || 'manual';
        return sources.some(src => logSource.toLowerCase() === src.toLowerCase());
      });
    }

    // Apply sorting
    logs.sort((a: any, b: any) => {
      let aVal: any;
      let bVal: any;

      switch (sort) {
        case 'date':
          aVal = new Date(a.date).getTime();
          bVal = new Date(b.date).getTime();
          break;
        case 'habit':
          aVal = a.habit_name?.toLowerCase() || '';
          bVal = b.habit_name?.toLowerCase() || '';
          break;
        case 'value':
          aVal = a.amount || a.duration || 0;
          bVal = b.amount || b.duration || 0;
          break;
        case 'category':
          aVal = a.category?.toLowerCase() || '';
          bVal = b.category?.toLowerCase() || '';
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'time':
          aVal = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.date).getTime();
          bVal = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.date).getTime();
          break;
        default:
          aVal = a[sort] || '';
          bVal = b[sort] || '';
      }

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });

    const totalFiltered = logs.length;
    const totalDuration = logs.reduce((sum: number, log: any) => sum + Number(log.duration || 0), 0);
    const totalAmount = logs.reduce((sum: number, log: any) => sum + Number(log.amount || 0), 0);
    const completedCount = logs.filter((log: any) => log.status === 'completed').length;

    // Apply pagination after filtering/sorting
    logs = logs.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: logs,
      meta: {
        total: logs.length,
        totalFiltered,
        offset,
        limit,
        hasMore: offset + logs.length < totalFiltered,
        filters: {
          q,
          startDate,
          endDate,
          categories,
          habits,
          statuses,
          sources,
        },
        sort: { column: sort, order },
        totals: {
          count: totalFiltered,
          totalDuration,
          totalAmount,
          completedCount,
          completionRate: totalFiltered > 0 ? (completedCount / totalFiltered) * 100 : 0,
        },
      },
    });

  } catch (error) {
    console.error('Error fetching habit logs:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch habit logs' 
      },
      { status: 500 }
    );
  }
}
