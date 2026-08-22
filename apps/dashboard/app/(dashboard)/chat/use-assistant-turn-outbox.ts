'use client';

import { useEffect } from 'react';
import { drainAssistantTurnOutbox } from '@/lib/chat/assistant-turn-outbox';
import { privacySettingsHeaders } from '@/lib/privacy/privacy-settings';

export function useAssistantTurnOutboxDrain(
  userId: string | undefined,
  getToken: () => Promise<string | null>,
): void {
  useEffect(() => {
    if (!userId) return;

    const drain = () => {
      void drainAssistantTurnOutbox(userId, async (item) => {
        const token = await getToken();
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json',
            ...privacySettingsHeaders(),
          },
          body: JSON.stringify(item.body),
        });
        if (!response.ok) return false;
        await response.text();
        return true;
      });
    };

    drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
  }, [getToken, userId]);
}
