import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@clerk/nextjs/server';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = process.env.WHOOP_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'Whoop configuration missing' },
        { status: 500 }
      );
    }

    // Generate a secure random state parameter bound to authenticated user.
    const randomState = crypto.randomBytes(16).toString('hex');
    const statePayload = {
      source: 'web',
      userId,
      nonce: randomState,
    };
    const state = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64');

    // Whoop OAuth authorization URL with state parameter
    const scope = 'read:recovery read:sleep read:workout read:profile read:body_measurement';
    const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

    console.log(`🔐 Generated OAuth state for user ${userId}`);
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
