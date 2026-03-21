import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

/**
 * POST /api/watcher/devices/[deviceId]/stop
 * Stop the watcher for a device
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deviceId } = await params;
    const token = await getToken();

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices/${deviceId}/stop`, {
      method: 'POST',
      headers: buildBackendAuthHeaders({ userId, token }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to stop watcher:', error);
      return NextResponse.json({ error: 'Failed to stop watcher' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error stopping watcher:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
