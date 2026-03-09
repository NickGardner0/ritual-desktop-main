import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';

/**
 * PUT /api/watcher/devices/[deviceId]/settings
 * Update watcher settings for a device
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deviceId } = await params;
    const body = await request.json();

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices/${deviceId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to update settings:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating watcher settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

