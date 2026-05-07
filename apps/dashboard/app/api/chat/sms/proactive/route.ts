import { NextRequest } from 'next/server';

import { handleSmsProactiveRequest } from '@ritual/chat-runtime';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return handleSmsProactiveRequest(req);
}
