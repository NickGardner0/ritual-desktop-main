import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';

/**
 * POST /api/watcher/devices/[deviceId]/start
 * Start the watcher for a device
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deviceId } = await params;

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices/${deviceId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to start watcher:', error);
      return NextResponse.json({ error: 'Failed to start watcher' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error starting watcher:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

