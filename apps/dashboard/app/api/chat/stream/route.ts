import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  streamChatTurn,
  type ChatStreamRequestBody,
} from '@ritual/chat-runtime';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;
  let token: string | null = null;

  if (headerToken) {
    token = headerToken;
  } else {
    try {
      const authResult = await auth();
      if (authResult.userId) {
        token = await authResult.getToken();
      }
    } catch {
      token = null;
    }
  }

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json() as ChatStreamRequestBody;
  return streamChatTurn({ token, body });
}
