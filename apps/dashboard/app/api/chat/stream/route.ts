import { NextRequest } from 'next/server';

import { handleChatStreamPost } from '@/lib/ai/chat-stream/orchestrator';

export async function POST(req: NextRequest) {
  return handleChatStreamPost(req);
}
