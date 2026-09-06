'use client';

import { useEffect, useState } from 'react';
import { Button } from '@ritual/ui/button';
import {
  getChatSessionUi,
  setChatPermissionAsk,
  subscribeChatSessionUi,
  type PermissionAsk,
} from './chat-session-ui';
import { getChatStreamUrl } from '@/lib/chat-stream-url';
import { rememberAlwaysToolScope } from '@/lib/chat-permission-memory';

async function decide(ask: PermissionAsk, decision: 'once' | 'always' | 'deny') {
  if (!ask) return;
  if (decision === 'always') {
    rememberAlwaysToolScope(ask.scope);
  }
  if (ask.protocol === 'agent' && ask.askSeq != null) {
    const mapped = decision === 'once' ? 'allow' : decision === 'always' ? 'always_allow' : 'deny';
    getChatSessionUi().agentApprove?.(mapped, ask.askSeq);
    setChatPermissionAsk(null);
    return;
  }
  try {
    await fetch(getChatStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getChatSessionUi().authToken ? { Authorization: `Bearer ${getChatSessionUi().authToken}` } : {}),
      },
      body: JSON.stringify({
        messages: [],
        permission: { id: ask.id, decision, scope: ask.scope },
      }),
    });
  } catch {
    // Sidecar may still hold the waiter even if this request fails.
  }
  setChatPermissionAsk(null);
}

export function ChatPermissionDock() {
  const [ask, setAsk] = useState<PermissionAsk>(getChatSessionUi().permissionAsk);

  useEffect(() => subscribeChatSessionUi(() => {
    setAsk(getChatSessionUi().permissionAsk);
  }), []);

  if (!ask) return null;

  return (
    <div className="pointer-events-auto mt-3 w-full max-w-xl rounded-md border border-[var(--ritual-border-default)] bg-[var(--ritual-surface-raised)] px-3 py-2 shadow-sm">
      <div className="text-[13px] text-[var(--ritual-text-primary)]">
        Allow <span className="font-medium">{ask.name}</span> to run?
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--ritual-text-muted)]">
        Profile {ask.profile}. This dock does not freeze the composer.
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="compact" onClick={() => void decide(ask, 'once')}>Once</Button>
        <Button type="button" size="compact" variant="secondary" onClick={() => void decide(ask, 'always')}>Always</Button>
        <Button type="button" size="compact" variant="ghost" onClick={() => void decide(ask, 'deny')}>Deny</Button>
      </div>
    </div>
  );
}
