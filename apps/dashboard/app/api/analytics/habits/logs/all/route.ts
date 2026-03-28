import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { subDays, format } from 'date-fns';

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
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '200', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    const tinybirdHost = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';
    const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
    
    // Build Tinybird query params
    const tinybirdParams = new URLSearchParams();
    tinybirdParams.set('user_id', userId);
    tinybirdParams.set('start_date', startDate);
    tinybirdParams.set('end_date', endDate);
    tinybirdParams.set('limit', String(Math.min((offset + limit) * 2, 5000))); // Fetch extra for filtering + pagination
    
    const habitsMapPromise = (async () => {
      const habitsMap: Record<string, { category: string; icon?: string; unit_type?: string }> = {};
      try {
        const habitsRes = await fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        });
        if (habitsRes.ok) {
          const habitsData = await habitsRes.json();
          habitsData.forEach((h: any) => {
            habitsMap[h.id] = {
              category: h.category || 'uncategorized',
              icon: h.icon,
              unit_type: h.unit_type,
            };
          });
        }
      } catch (e) {
        console.warn('Failed to fetch habits metadata:', e);
      }
      return habitsMap;
    })();

    const normalizeLog = (
      log: any,
      habitsMap: Record<string, { category: string; icon?: string; unit_type?: string }>,
    ) => ({
      id: log.id,
      habit_id: log.habit_id,
      habit_name: log.habit_name,
      category: habitsMap[log.habit_id]?.category || log.category || 'uncategorized',
      icon: habitsMap[log.habit_id]?.icon || log.icon,
      date: log.date,
      completed_at: log.timestamp || log.completed_at,
      duration: log.duration,
      amount: log.amount,
      unit_type: habitsMap[log.habit_id]?.unit_type || log.unit_type || log.unit,
      status: log.status || 'completed',
      notes: log.notes,
      integration_source: log.integration_source || log.source || 'manual',
      metadata:
        log.metadata
          ? (typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata)
          : null,
    });

    const backendLogsPromise = (async () => {
      const response = await fetch(`${backendUrl}/api/habit-logs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`);
      }

      const data = await response.json();
      const rawLogs = Array.isArray(data) ? data : data.logs || data.data || [];
      return rawLogs;
    })();

    if (!tinybirdToken) {
      const [habitsMap, backendLogs] = await Promise.all([
        habitsMapPromise,
        backendLogsPromise,
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

    const tinybirdResponsePromise = fetch(tinybirdUrl, {
      headers: {
        'Authorization': `Bearer ${tinybirdToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const [habitsMap, backendLogs, tinybirdResponse] = await Promise.all([
      habitsMapPromise,
      backendLogsPromise.catch((error) => {
        console.warn('Failed to fetch backend logs for merge:', error);
        return [];
      }),
      tinybirdResponsePromise.catch((error) => {
        console.warn('Failed to fetch Tinybird logs:', error);
        return null;
      }),
    ]);

    let logs: any[] = [];

    if (tinybirdResponse?.ok) {
      const result = await tinybirdResponse.json();
      logs = (result.data || []).map((log: any) => normalizeLog(log, habitsMap));
    } else if (tinybirdResponse) {
      const errorText = await tinybirdResponse.text();
      console.error('Tinybird API error:', errorText);
    }

    const normalizedBackendLogs = backendLogs.map((log: any) => normalizeLog(log, habitsMap));
    const mergedById = new Map<string, any>();

    for (const log of logs) {
      if (log?.id) {
        mergedById.set(log.id, log);
      }
    }

    for (const log of normalizedBackendLogs) {
      if (!log?.id) continue;
      const existing = mergedById.get(log.id);
      mergedById.set(log.id, existing ? { ...existing, ...log } : log);
    }

    logs = Array.from(mergedById.values());

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
