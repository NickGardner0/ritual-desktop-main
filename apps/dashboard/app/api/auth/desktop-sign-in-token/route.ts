import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 60,
    });

    return NextResponse.json(
      {
        ticket: signInToken.token,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('Failed to create desktop sign-in token:', error);
    return NextResponse.json(
      { error: 'Failed to create desktop sign-in token' },
      { status: 500 },
    );
  }
}
