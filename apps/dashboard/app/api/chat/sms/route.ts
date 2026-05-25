import { NextRequest } from 'next/server';

import { runSmsChatTurn } from '@ritual/chat-runtime';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return runSmsChatTurn(req);
}
