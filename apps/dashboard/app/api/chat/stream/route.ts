import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  handleChatStreamRequest,
  type ChatStreamRequestBody,
} from '@ritual/chat-runtime';
import { privacyBlockResponse } from '@/lib/privacy/server-policy';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const privacyBlock = privacyBlockResponse(req, {
    dataClass: 'ai_content',
    destination: 'openai',
    purpose: 'ai',
  });
  if (privacyBlock) return privacyBlock;

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
  return handleChatStreamRequest({ token, body });
}
