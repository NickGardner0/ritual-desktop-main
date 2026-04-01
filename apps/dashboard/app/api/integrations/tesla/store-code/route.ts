/**
 * Temporary Tesla OAuth Code Storage (for desktop polling).
 */

import { NextRequest, NextResponse } from 'next/server';

const codeStore = new Map<string, { code: string; sessionToken: string; timestamp: number }>();

// Clean up expired codes every minute
setInterval(() => {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  for (const [sessionId, data] of codeStore.entries()) {
    if (now - data.timestamp > FIVE_MINUTES) {
      codeStore.delete(sessionId);
    }
  }
}, 60_000);

export async function POST(request: NextRequest) {
  try {
    const { code, sessionId, sessionToken } = await request.json();
    if (!code || !sessionId || !sessionToken) {
      return NextResponse.json({ error: 'Missing code, sessionId, or sessionToken' }, { status: 400 });
    }
    codeStore.set(sessionId, { code, sessionToken, timestamp: Date.now() });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to store code' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    const sessionToken = request.nextUrl.searchParams.get('sessionToken');
    if (!sessionId || !sessionToken) {
      return NextResponse.json({ error: 'Missing sessionId or sessionToken' }, { status: 400 });
    }
    const stored = codeStore.get(sessionId);
    if (!stored || stored.sessionToken !== sessionToken) {
      return NextResponse.json({ found: false });
    }
    codeStore.delete(sessionId);
    return NextResponse.json({ found: true, code: stored.code });
  } catch {
    return NextResponse.json({ error: 'Failed to retrieve code' }, { status: 500 });
  }
}
