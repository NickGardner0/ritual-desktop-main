import { NextRequest } from 'next/server';

import { handleSmsProactivePost } from '@/lib/ai/chat-stream/orchestrator';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleSmsProactivePost(req);
}
