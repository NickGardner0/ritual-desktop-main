import { NextRequest } from 'next/server';

import { handleSmsChatPost } from '@/lib/ai/chat-stream/orchestrator';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleSmsChatPost(req);
}
