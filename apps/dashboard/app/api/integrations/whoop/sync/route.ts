import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

const PYTHON_API_BASE =
  process.env.PYTHON_API_URL ||
  process.env.NEXT_PUBLIC_PYTHON_API_URL ||
  'http://127.0.0.1:8000';

type WhoopSyncRequest = {
  daysBack?: number;
  days_back?: number;
  forceFullSync?: boolean;
  force_full_sync?: boolean;
  fullHistory?: boolean;
  full_history?: boolean;
};

type SafeWhoopSyncCounts = {
  recovery: number;
  sleep: number;
  workouts: number;
  cycles: number;
};

type SafeWhoopSyncResult = {
  status: string;
  syncedAt: string | null;
  syncPeriod: {
    startDate: string | null;
    endDate: string | null;
    days: number;
  };
  counts: SafeWhoopSyncCounts;
};

function parseOptionalPositiveInt(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseOptionalBoolean(value: string | boolean | null | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

async function resolveSyncRequest(req: NextRequest): Promise<{
  daysBack?: number;
  forceFullSync?: boolean;
  fullHistory?: boolean;
}> {
  const searchParams = req.nextUrl.searchParams;
  const queryDaysBack = parseOptionalPositiveInt(searchParams.get('days_back'));
  const queryForceFullSync = parseOptionalBoolean(searchParams.get('force_full_sync'));
  const queryFullHistory = parseOptionalBoolean(searchParams.get('full_history'));

  let body: WhoopSyncRequest = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  return {
    daysBack:
      queryDaysBack ??
      body.daysBack ??
      body.days_back,
    forceFullSync:
      queryForceFullSync ??
      body.forceFullSync ??
      body.force_full_sync,
    fullHistory:
      queryFullHistory ??
      body.fullHistory ??
      body.full_history,
  };
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toSafeWhoopSyncResult(raw: any): SafeWhoopSyncResult {
  const rawCounts = raw?.data ?? {};
  const rawSyncPeriod = raw?.sync_period ?? {};

  return {
    status: typeof raw?.status === 'string' ? raw.status : 'success',
    syncedAt: typeof raw?.synced_at === 'string' ? raw.synced_at : null,
    syncPeriod: {
      startDate: typeof rawSyncPeriod?.start_date === 'string' ? rawSyncPeriod.start_date : null,
      endDate: typeof rawSyncPeriod?.end_date === 'string' ? rawSyncPeriod.end_date : null,
      days: toFiniteNumber(rawSyncPeriod?.days),
    },
    counts: {
      recovery: toFiniteNumber(rawCounts?.recovery),
      sleep: toFiniteNumber(rawCounts?.sleep),
      workouts: toFiniteNumber(rawCounts?.workouts),
      cycles: toFiniteNumber(rawCounts?.cycles),
    },
  };
}

function extractBackendErrorPayload(rawText: string): {
  detail?: unknown;
  message?: string;
  displayMessage?: string;
} {
  try {
    const parsed = JSON.parse(rawText);
    return {
      detail: parsed?.detail,
      message: parsed?.message || parsed?.error,
      displayMessage:
        parsed?.display_message ||
        parsed?.detail?.display_message ||
        parsed?.detail?.message,
    };
  } catch {
    return {};
  }
}

/**
 * Whoop Sync API Route
 *
 * This route proxies Whoop sync requests to the Python backend.
 * The Python backend handles:
 * - Token refresh
 * - Data fetching from Whoop API
 * - Storage in Turso database (habit_logs)
 * - Sending to Tinybird for analytics
 *
 * POST /api/integrations/whoop/sync
 * POST /api/integrations/whoop/sync?days_back=365
 * POST /api/integrations/whoop/sync (with {"daysBack":365,"forceFullSync":true})
 */
async function handleWhoopSync(
  req: NextRequest,
  options: { daysBack?: number; forceFullSync?: boolean; fullHistory?: boolean }
) {
  // Get authenticated user from Clerk
  const { userId, getToken } = await auth();
  
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  // Don't log userId in production
  logger.info('🔄 Proxying Whoop sync request');
  
  // Get Clerk token for backend authentication
  const token = await getToken();
  
  if (!token) {
    return NextResponse.json(
      { error: 'Failed to get authentication token' },
      { status: 401 }
    );
  }
  
  const backendParams = new URLSearchParams();
  if (options.daysBack !== undefined) {
    backendParams.set('days_back', String(options.daysBack));
  }
  if (options.forceFullSync === true) {
    backendParams.set('force_full_sync', 'true');
  }
  if (options.fullHistory === true) {
    backendParams.set('full_history', 'true');
  }

  const backendUrl = `${PYTHON_API_BASE}/api/integrations/whoop/sync${
    backendParams.size ? `?${backendParams.toString()}` : ''
  }`;

  // Call Python backend sync endpoint
  const response = await fetch(
    backendUrl,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(90000),
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    const backendError = extractBackendErrorPayload(errorText);
    logger.error(`❌ Python backend sync failed: ${response.status} - ${errorText}`);
    return NextResponse.json(
      {
        error: 'Failed to sync Whoop data',
        detail: backendError.detail,
        message: backendError.message,
        display_message: backendError.displayMessage,
        details: errorText,
      },
      { status: response.status }
    );
  }
  
  const result = await response.json();
  const safeResult = toSafeWhoopSyncResult(result);
  
  logger.info('✅ Whoop sync completed successfully');
  
  return NextResponse.json({
    success: true,
    message: 'Whoop data synchronized successfully',
    data: safeResult,
  });
}

export async function GET(req: NextRequest) {
  try {
    const options = await resolveSyncRequest(req);
    return handleWhoopSync(req, options);
  } catch (error) {
    logger.error('❌ Error in Whoop sync:', error);
    return NextResponse.json(
      { error: 'Failed to sync Whoop data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const options = await resolveSyncRequest(req);
    return handleWhoopSync(req, options);
  } catch (error) {
    logger.error('❌ Error in Whoop sync:', error);
    return NextResponse.json(
      { error: 'Failed to sync Whoop data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
