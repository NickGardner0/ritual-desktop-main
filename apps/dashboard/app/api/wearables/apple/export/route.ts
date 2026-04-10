import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;

    // Forward all query params to the backend
    const { searchParams } = request.nextUrl;
    const params = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      params.set(key, value);
    }

    const backendUrl = `${API_CONFIG.PYTHON_API_URL}/api/wearables/apple/export?${params.toString()}`;
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: buildBackendAuthHeaders({ userId, token }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to export Apple health data:', error);
      return NextResponse.json({ error: 'Export failed' }, { status: response.status });
    }

    const format = searchParams.get('format') || 'markdown';
    const contentType = response.headers.get('content-type') || 'text/plain';

    if (format === 'json') {
      const data = await response.json();
      return NextResponse.json(data);
    }

    // For markdown/csv, stream the text content back
    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': response.headers.get('content-disposition') || '',
      },
    });
  } catch (error) {
    console.error('Error exporting Apple health data:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
