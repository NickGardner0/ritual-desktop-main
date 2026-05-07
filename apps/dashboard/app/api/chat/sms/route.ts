import { NextRequest } from 'next/server';

import { handleSmsChatRequest } from '@ritual/chat-runtime';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleSmsChatRequest(req);
}
