import { NextRequest } from 'next/server';

import { handleSmsChatPost } from '@ritual/chat-runtime';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleSmsChatPost(req);
}
