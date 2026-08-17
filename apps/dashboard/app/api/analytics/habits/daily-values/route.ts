import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getServerBackendBaseUrl } from '@/lib/api/server-client';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

const TINYBIRD_URL = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';

function metricFactsReadsEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.METRIC_FACTS_READS || '').toLowerCase());
}

function dailyPolicyV2Enabled(userId: string): boolean {
  const raw = (process.env.RITUAL_DAILY_POLICY_V2 || '0').trim().toLowerCase();
  if (!raw || ['0', 'false', 'off', 'no'].includes(raw)) return false;
  const percentage = ['true', 'on', 'yes'].includes(raw)
    ? 100
    : Math.max(0, Math.min(100, Number.parseInt(raw.replace('%', ''), 10) || 0));
  if (percentage >= 100) return true;
  const bucket = createHash('sha256').update(userId).digest().readUInt32BE(0) % 100;
  return bucket < percentage;
}

export async function GET(request: NextRequest) {
  try {
    const clerkAuth = await auth();
    const { userId } = clerkAuth;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    if (!tinybirdToken) {
      return NextResponse.json({ error: 'Analytics service not configured' }, { status: 500 });
    }

    const searchParams = request.nextUrl.searchParams;
    const output = (searchParams.get('output') || 'summary').toLowerCase();
    const allowedOutputs = new Set(['summary', 'daily']);

    if (!allowedOutputs.has(output)) {
      return NextResponse.json({ error: 'Invalid output. Use "summary" or "daily".' }, { status: 400 });
    }

    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const habitId = searchParams.get('habit_id');
    const habitIdsParam = searchParams.get('habit_ids');

    const requestedDaysBack = Number.parseInt(searchParams.get('days_back') || '30', 10);
    const daysBack = Number.isFinite(requestedDaysBack)
      ? Math.min(Math.max(requestedDaysBack, 1), 1825)
      : 30;

    const params = new URLSearchParams({
      user_id: userId,
      policy_v2: dailyPolicyV2Enabled(userId) ? '1' : '0',
    });

    if (habitId) {
      params.set('habit_id', habitId);
    } else if (habitIdsParam) {
      const normalizedHabitIds = Array.from(
        new Set(
          habitIdsParam
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        )
      );
      if (normalizedHabitIds.length > 0) {
        params.set('habit_ids', normalizedHabitIds.join(','));
      }
    }

    if (startDate && endDate) {
      params.set('start_date', startDate);
      params.set('end_date', endDate);
    } else {
      params.set('days_back', String(daysBack));
    }

    if (metricFactsReadsEnabled()) {
      const token = await clerkAuth.getToken();
      const backendPath = output === 'daily' ? '/api/metrics/facts/daily' : '/api/metrics/facts/summary';
      const url = `${getServerBackendBaseUrl()}${backendPath}?${params.toString()}`;
      const response = await fetch(url, {
        headers: buildBackendAuthHeaders({ userId, token }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('metric facts daily-values proxy error:', response.status, errorText);
        return NextResponse.json({ error: 'Failed to fetch metric facts' }, { status: response.status });
      }

      const payload = await response.json();
      return NextResponse.json({
        success: true,
        output,
        data: payload.data || [],
        meta: {
          ...(payload.meta || {}),
          user_id: userId,
          source: 'metric_daily_facts',
          habit_id: habitId,
          habit_ids: habitId ? null : (params.get('habit_ids') || null),
          start_date: startDate,
          end_date: endDate,
          days_back: startDate && endDate ? null : daysBack,
          rows: payload.data?.length || 0,
        },
      });
    }

    const pipeName = output === 'daily' ? 'habit_daily_series' : 'habit_daily_values';
    const url = `${TINYBIRD_URL}/v0/pipes/${pipeName}.json?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('habit_daily_values Tinybird error:', response.status, errorText);
      return NextResponse.json({ error: 'Failed to fetch canonical habit values' }, { status: response.status });
    }

    const payload = await response.json();

    return NextResponse.json({
      success: true,
      output,
      data: payload.data || [],
      meta: {
        user_id: userId,
        pipe: pipeName,
        habit_id: habitId,
        habit_ids: habitId ? null : (params.get('habit_ids') || null),
        start_date: startDate,
        end_date: endDate,
        days_back: startDate && endDate ? null : daysBack,
        rows: payload.data?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching canonical habit values:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
