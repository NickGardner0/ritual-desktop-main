/**
 * Temporary OAuth Code Storage
 * 
 * This endpoint allows storing OAuth codes from the browser (no auth required)
 * The desktop app can then retrieve and exchange them (with auth)
 */

import { NextRequest, NextResponse } from 'next/server';

// In-memory storage for OAuth codes (temporary, will be lost on restart)
// In production, you'd use Redis or a database
const codeStore = new Map<string, { code: string, timestamp: number }>();

// Clean up old codes every minute
setInterval(() => {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  
  for (const [sessionId, data] of codeStore.entries()) {
    if (now - data.timestamp > FIVE_MINUTES) {
      codeStore.delete(sessionId);
      console.log(`🧹 Cleaned up expired code for session: ${sessionId}`);
    }
  }
}, 60000);

export async function POST(request: NextRequest) {
  try {
    const { code, sessionId } = await request.json();
    
    if (!code || !sessionId) {
      return NextResponse.json(
        { error: 'Missing code or sessionId' },
        { status: 400 }
      );
    }

    console.log(`💾 Storing OAuth code for session: ${sessionId}`);
    
    codeStore.set(sessionId, {
      code,
      timestamp: Date.now()
    });

    return NextResponse.json({ 
      success: true,
      message: 'Code stored successfully'
    });
    
  } catch (error) {
    console.error('❌ Error storing code:', error);
    return NextResponse.json(
      { error: 'Failed to store code' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing sessionId' },
        { status: 400 }
      );
    }

    const stored = codeStore.get(sessionId);
    
    if (!stored) {
      return NextResponse.json(
        { found: false },
        { status: 200 }
      );
    }

    console.log(`📥 Retrieved and removing code for session: ${sessionId}`);
    
    // Delete after retrieving (one-time use)
    codeStore.delete(sessionId);

    return NextResponse.json({ 
      found: true,
      code: stored.code
    });
    
  } catch (error) {
    console.error('❌ Error retrieving code:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve code' },
      { status: 500 }
    );
  }
}

