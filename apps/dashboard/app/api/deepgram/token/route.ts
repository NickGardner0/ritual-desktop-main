import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Deepgram is not configured' }, { status: 503 });
  }

  const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ttl_seconds: 120,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Failed to grant Deepgram token');
    return NextResponse.json(
      { error: 'Failed to create Deepgram token', details: error },
      { status: response.status },
    );
  }

  const payload = await response.json();
  return NextResponse.json({
    token: payload.access_token,
    expiresIn: payload.expires_in,
  });
}
