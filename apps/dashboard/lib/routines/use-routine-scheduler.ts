'use client';

import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@/lib/desktop-session';
import { useQueryClient } from '@tanstack/react-query';

import { apiOperationWithAuth } from '@/lib/api/client';

const TICK_MS = 60_000;

/**
 * Background routine scheduler: on app launch and once a minute, asks the
 * backend to materialize due routine runs (idempotent; missed occurrences are
 * caught up server-side — one run, older ones recorded as skipped). Queued AI
 * runs are then executed by the backend workflow loop.
 */
export function useRoutineScheduler() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await apiOperationWithAuth(
          'generate_due_routines_api_routines_generate_due_post',
          getToken,
          {},
          userId,
        );
        if ((result.queued ?? 0) > 0 || (result.skipped ?? 0) > 0) {
          void queryClient.invalidateQueries({ queryKey: ['routines', userId] });
          void queryClient.invalidateQueries({ queryKey: ['routine-runs', 'routines-page', userId] });
          void queryClient.invalidateQueries({ queryKey: ['workflow-runs', 'routines-page', userId] });
          if ((result.generated_tasks ?? 0) > 0) {
            void queryClient.invalidateQueries({ queryKey: ['tasks', userId] });
          }
        }
      } catch {
        // Offline or backend unavailable — the next tick retries.
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    return () => window.clearInterval(timer);
  }, [user?.id, getToken, queryClient]);
}
