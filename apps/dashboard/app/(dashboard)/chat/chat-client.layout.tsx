'use client';

import { createChatLayoutRenderers } from './chat-client.layout.render';

export function createChatClientLayout(ctx: Record<string, any>) {
  return createChatLayoutRenderers(ctx);
}
