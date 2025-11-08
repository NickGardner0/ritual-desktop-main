import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!PYTHON_API_BASE) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
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
 * GET /api/integrations/whoop/sync?days_back=7
 * POST /api/integrations/whoop/sync (with days_back in query or body)
 */
async function handleWhoopSync(req: NextRequest, daysBack: number) {
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
  
  // Call Python backend sync endpoint
  const response = await fetch(
    `${PYTHON_API_BASE}/api/integrations/whoop/sync?days_back=${daysBack}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`❌ Python backend sync failed: ${response.status} - ${errorText}`);
    return NextResponse.json(
      { error: 'Failed to sync Whoop data', details: errorText },
      { status: response.status }
    );
  }
  
  const result = await response.json();
  
  logger.info('✅ Whoop sync completed successfully');
  
  return NextResponse.json({
    success: true,
    message: 'Whoop data synchronized successfully',
    data: result,
  });
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const daysBack = parseInt(searchParams.get('days_back') || '7');
    return handleWhoopSync(req, daysBack);
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
    // Support days_back from query params or body
    const searchParams = req.nextUrl.searchParams;
    let daysBack = parseInt(searchParams.get('days_back') || '7');
    
    // Try to get from body if not in query
    if (daysBack === 7) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.days_back) {
          daysBack = parseInt(String(body.days_back));
        }
      } catch {
        // Body parsing failed, use default
      }
    }
    
    return handleWhoopSync(req, daysBack);
  } catch (error) {
    logger.error('❌ Error in Whoop sync:', error);
    return NextResponse.json(
      { error: 'Failed to sync Whoop data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
