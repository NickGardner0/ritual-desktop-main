import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.WHOOP_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'Whoop configuration missing' },
        { status: 500 }
      );
    }

    // Get user ID from query parameter
    const userId = request.nextUrl.searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    // Generate a secure random state parameter and encode the user ID in it
    const randomState = crypto.randomBytes(16).toString('hex');
    const state = `${randomState}:${userId}`;

    // Whoop OAuth authorization URL with state parameter
    const scope = 'read:recovery read:sleep read:workout read:profile read:body_measurement';
    const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

    console.log('🔐 Generated OAuth state with user ID');
    console.log('🔗 Auth URL:', authUrl);

    return NextResponse.json({ authUrl, state });
  } catch (error) {
    console.error('❌ Error generating Whoop auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}

